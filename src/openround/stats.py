"""Per-round and baseline stat derivation for the Scratch Golf Roadmap.

Definitions used (standard, stated explicitly so the numbers are auditable):
- Fairway opportunity: any hole with par >= 4 and a recorded fairway outcome.
- GIR: recorded flag when present; otherwise derived as (strokes - putts) <= (par - 2),
  which misses fringe-putt edge cases but matches how every tracker derives it.
- Scrambling attempt: a hole that missed GIR. Converted: recorded 'converted', or
  derived as missed GIR with strokes <= par.
- Doubles+: strokes >= par + 2.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field


@dataclass
class RoundStats:
    round_id: int
    played_at: str
    course: str | None
    hole_count: int
    score: int | None
    par: int | None
    fw_hit: int = 0
    fw_opps: int = 0
    gir: int = 0
    gir_known: int = 0
    putts: int | None = None
    scramble_converted: int = 0
    scramble_attempts: int = 0
    doubles: int = 0
    penalties: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def score_vs_par(self) -> str:
        if self.score is None or self.par is None:
            return ""
        diff = self.score - self.par
        return "E" if diff == 0 else f"{diff:+d}"


def hole_gir(hole: sqlite3.Row | dict) -> bool | None:
    gir = hole["gir"]
    if gir is not None:
        return bool(gir)
    par, strokes, putts = hole["par"], hole["strokes"], hole["putts"]
    if par is None or strokes is None or putts is None:
        return None
    return (strokes - putts) <= (par - 2)


def round_stats(con: sqlite3.Connection, round_id: int) -> RoundStats:
    rnd = con.execute("SELECT * FROM rounds WHERE id = ?", (round_id,)).fetchone()
    if rnd is None:
        raise ValueError(f"no round with id {round_id}")
    holes = con.execute(
        "SELECT * FROM holes WHERE round_id = ? ORDER BY number", (round_id,)
    ).fetchall()

    pars = [h["par"] for h in holes]
    stats = RoundStats(
        round_id=round_id,
        played_at=rnd["played_at"],
        course=rnd["course"],
        hole_count=len(holes),
        score=rnd["score"],
        par=sum(pars) if pars and None not in pars else None,
    )

    putts_seen = 0
    putts_total = 0
    for hole in holes:
        par, strokes = hole["par"], hole["strokes"]

        if par is not None and par >= 4 and hole["fairway"] is not None:
            stats.fw_opps += 1
            if hole["fairway"] == "hit":
                stats.fw_hit += 1

        gir = hole_gir(hole)
        if gir is not None:
            stats.gir_known += 1
            if gir:
                stats.gir += 1
            else:
                stats.scramble_attempts += 1
                if hole["up_and_down"] is not None:
                    if hole["up_and_down"] == "converted":
                        stats.scramble_converted += 1
                elif strokes is not None and par is not None and strokes <= par:
                    stats.scramble_converted += 1

        if hole["putts"] is not None:
            putts_seen += 1
            putts_total += hole["putts"]
        if strokes is not None and par is not None and strokes >= par + 2:
            stats.doubles += 1
        stats.penalties += hole["penalties"] or 0

    if putts_seen == len(holes) and holes:
        stats.putts = putts_total
    elif rnd["putts"] is not None:
        stats.putts = rnd["putts"]  # vendor round total (e.g. Shot Scope without putter tag)
        stats.warnings.append("putts from vendor round total; per-hole putts incomplete")
    elif putts_seen:
        stats.warnings.append(f"putts recorded on only {putts_seen}/{len(holes)} holes")
    if stats.gir_known < len(holes):
        stats.warnings.append(f"GIR derivable on only {stats.gir_known}/{len(holes)} holes")
    return stats


@dataclass
class Baseline:
    rounds: int
    fw_hit_avg: float
    fw_opps_avg: float
    gir_avg: float
    putts_avg: float | None
    scramble_pct: float | None
    doubles_avg: float
    excluded_nines: int

    @property
    def fw_pct(self) -> float:
        return 100.0 * self.fw_hit_avg / self.fw_opps_avg if self.fw_opps_avg else 0.0


def baseline(all_stats: list[RoundStats]) -> Baseline | None:
    """Average the 18-hole rounds (9-hole rounds are excluded, counted separately)."""
    eighteens = [s for s in all_stats if s.hole_count >= 18]
    if not eighteens:
        return None
    n = len(eighteens)
    with_putts = [s for s in eighteens if s.putts is not None]
    attempts = sum(s.scramble_attempts for s in eighteens)
    converted = sum(s.scramble_converted for s in eighteens)
    return Baseline(
        rounds=n,
        fw_hit_avg=sum(s.fw_hit for s in eighteens) / n,
        fw_opps_avg=sum(s.fw_opps for s in eighteens) / n,
        gir_avg=sum(s.gir for s in eighteens) / n,
        putts_avg=(sum(s.putts for s in with_putts) / len(with_putts)) if with_putts else None,
        scramble_pct=(100.0 * converted / attempts) if attempts else None,
        doubles_avg=sum(s.doubles for s in eighteens) / n,
        excluded_nines=len(all_stats) - n,
    )


def all_round_stats(con: sqlite3.Connection) -> list[RoundStats]:
    ids = [r["id"] for r in con.execute("SELECT id FROM rounds ORDER BY played_at")]
    return [round_stats(con, rid) for rid in ids]
