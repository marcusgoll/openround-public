"""Strokes gained, recomputed from raw shot positions.

SG per shot = J(start_dist, start_lie) - J(end_dist, end_lie) - strokes_cost,
where J is a user-supplied expected-strokes-to-hole-out benchmark
configured with OPENROUND_SG_BASELINE and strokes_cost is 1 plus 1 for a penalty
(lost ball / water). J(holed) = 0.

Distances: start distance is computed from the shot's GPS start position to the
hole's pin (Shot Scope stores both); end distance prefers the vendor's
remaining-to-hole, falling back to end-position-to-pin, then to the next shot's
start distance. Categories follow the Shot Scope rules: green lie = putt; tee
lie on par 4/5 = tee; otherwise >50 yd = approach (par-3 tee shots included),
<=50 yd = short game.
"""

from __future__ import annotations

import json
import math
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from .shotscope import haversine_m

M_PER_YD = 0.9144
FT_PER_M = 3.28084
class BaselineUnavailable(ValueError):
    """SG cannot be calculated without a valid, explicitly supplied benchmark."""


def load_baseline() -> dict:
    """Load and validate the optional JSON benchmark, without import-time I/O."""
    path = os.environ.get("OPENROUND_SG_BASELINE")
    if not path:
        raise BaselineUnavailable("set OPENROUND_SG_BASELINE to an authorized benchmark JSON file")
    try:
        data = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as exc:
        raise BaselineUnavailable(f"cannot read OPENROUND_SG_BASELINE: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("name"), str) or not data["name"].strip():
        raise BaselineUnavailable("benchmark must provide a nonempty provenance name")
    off_green = data.get("off_green_yd")
    if not isinstance(off_green, dict):
        raise BaselineUnavailable("benchmark must provide off_green_yd tables")
    tables = {"putting_ft": data.get("putting_ft")}
    tables.update({lie: off_green.get(lie) for lie in ("tee", "fairway", "rough", "sand", "recovery")})
    for name, table in tables.items():
        if not isinstance(table, list) or not table:
            raise BaselineUnavailable(f"{name}: expected a nonempty table")
        previous = -1.0
        for row in table:
            if not isinstance(row, list) or len(row) != 2:
                raise BaselineUnavailable(f"{name}: each row must be [distance, expected_strokes]")
            try:
                valid = all(type(v) in (int, float) and math.isfinite(v) and v >= 0 for v in row)
            except OverflowError:
                valid = False
            if not valid or row[0] <= previous:
                raise BaselineUnavailable(f"{name}: finite nonnegative values and strictly ascending distances required")
            previous = row[0]
    return data

CATEGORIES = ("tee", "approach", "short", "putt")
_LIE_TO_TABLE = {
    "tee": "tee",
    "fairway": "fairway",
    "rough": "rough",
    "sand": "sand",
    "penalty": "recovery",
}


def _interp(table: list[list[float]], x: float) -> float:
    """Piecewise-linear lookup; clamps to the first/last row outside the range."""
    if x <= table[0][0]:
        return table[0][1]
    if x >= table[-1][0]:
        return table[-1][1]
    for (x0, y0), (x1, y1) in zip(table, table[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    raise AssertionError("unreachable: table not ascending")


def expected_strokes(dist_m: float | None, lie: str | None) -> float | None:
    """Baseline expected strokes to hole out from this distance and lie."""
    return _expected_strokes(load_baseline(), dist_m, lie)


def _expected_strokes(baseline: dict, dist_m: float | None, lie: str | None) -> float | None:
    if dist_m is None:
        return None
    if dist_m <= 0.1:  # float-noise guard only; real holed shots have remaining NULL/0
        return 0.0
    if lie == "green":
        return _interp(baseline["putting_ft"], dist_m * FT_PER_M)
    table = baseline["off_green_yd"].get(_LIE_TO_TABLE.get(lie or "", "rough"))
    if table is None:
        table = baseline["off_green_yd"]["rough"]
    return _interp(table, dist_m / M_PER_YD)


@dataclass
class ShotSG:
    round_id: int
    hole: int
    seq: int
    club: str | None
    lie: str | None
    category: str
    start_dist_m: float
    sg: float
    penalty: bool


def _category(lie: str | None, par: int | None, start_dist_m: float) -> str:
    if lie == "green":
        return "putt"
    if lie == "tee" and par is not None and par >= 4:
        return "tee"
    if start_dist_m > 50 * M_PER_YD:
        return "approach"
    return "short"


def round_shot_sg(con: sqlite3.Connection, round_id: int) -> tuple[list[ShotSG], list[str]]:
    """Per-shot strokes gained for one round; returns (shots, warnings)."""
    baseline = load_baseline()
    holes = {
        h["number"]: h
        for h in con.execute("SELECT * FROM holes WHERE round_id = ?", (round_id,))
    }
    out: list[ShotSG] = []
    warnings: list[str] = []

    for hole_num, hole in sorted(holes.items()):
        shots = con.execute(
            "SELECT * FROM shots WHERE round_id = ? AND hole = ? ORDER BY seq",
            (round_id, hole_num),
        ).fetchall()
        if not shots:
            continue
        pin = (hole["pin_lat"], hole["pin_lon"])
        has_pin = None not in pin

        # Start distance per shot. The vendor's remaining-to-hole chain is the
        # authoritative geometry (it is what their app displayed and what the
        # golfer signed off); raw GPS-to-pin is the fallback for first shots
        # and gaps — pins are occasionally misplaced in the exported data.
        starts: list[float | None] = []
        for i, s in enumerate(shots):
            d = None
            if i > 0 and shots[i - 1]["remaining_m"] is not None:
                d = shots[i - 1]["remaining_m"]
            elif has_pin and s["lat"] is not None and s["lon"] is not None:
                d = haversine_m(s["lat"], s["lon"], pin[0], pin[1])
            starts.append(d)

        for i, s in enumerate(shots):
            start = starts[i]
            if start is None:
                warnings.append(f"hole {hole_num} shot {s['seq']}: no start distance, skipped")
                continue
            if s["lie"] == "green":
                if start > 40:  # no green is 40 m deep: pin or shot GPS is corrupt
                    warnings.append(
                        f"hole {hole_num} shot {s['seq']}: implausible putt distance "
                        f"({start:.0f} m) — pin data suspect, shot excluded"
                    )
                    continue
                start = max(start, 0.61)  # Shot Scope inserts undetected putts as 2 ft
            last = i == len(shots) - 1
            if last:
                end, end_lie = 0.0, "holed"  # scored rounds end holed (pickups have no shot rows after)
            else:
                end = s["remaining_m"]
                if end is None and has_pin and s["end_lat"] is not None:
                    end = haversine_m(s["end_lat"], s["end_lon"], pin[0], pin[1])
                if end is None:
                    end = starts[i + 1]
                end_lie = shots[i + 1]["lie"]
            if end is None:
                warnings.append(f"hole {hole_num} shot {s['seq']}: no end distance, skipped")
                continue

            j_start = _expected_strokes(baseline, start, s["lie"])
            j_end = 0.0 if end_lie == "holed" else _expected_strokes(baseline, end, end_lie)
            penalty = bool(s["lost_ball"] or s["water_hazard"])
            cost = 1 + (1 if penalty else 0)
            out.append(
                ShotSG(
                    round_id=round_id,
                    hole=hole_num,
                    seq=s["seq"],
                    club=s["club"],
                    lie=s["lie"],
                    category=_category(s["lie"], hole["par"], start),
                    start_dist_m=start,
                    sg=round(j_start - j_end - cost, 3),
                    penalty=penalty,
                )
            )
    return out, warnings


def by_category(shots: list[ShotSG]) -> dict[str, float]:
    totals = {c: 0.0 for c in CATEGORIES}
    for s in shots:
        totals[s.category] += s.sg
    return {c: round(v, 2) for c, v in totals.items()}


APPROACH_BUCKETS_YD = ((50, 100), (100, 150), (150, 200), (200, 900))


def approach_buckets(shots: list[ShotSG]) -> dict[str, tuple[int, float]]:
    """Approach SG grouped by start-distance bucket: {label: (count, total_sg)}."""
    out: dict[str, tuple[int, float]] = {}
    for lo, hi in APPROACH_BUCKETS_YD:
        label = f"{lo}-{hi}yd" if hi < 900 else f"{lo}yd+"
        picks = [
            s for s in shots
            if s.category == "approach" and lo <= s.start_dist_m / M_PER_YD < hi
        ]
        out[label] = (len(picks), round(sum(s.sg for s in picks), 2))
    return out


def by_club(shots: list[ShotSG]) -> dict[str, tuple[int, float]]:
    out: dict[str, list] = {}
    for s in shots:
        if s.category == "putt" or s.club is None:
            continue
        out.setdefault(s.club, [0, 0.0])
        out[s.club][0] += 1
        out[s.club][1] += s.sg
    return {k: (n, round(v, 2)) for k, (n, v) in sorted(out.items())}
