"""Per-club distance distributions and gapping analysis.

Discipline (mirroring Shot Scope's P-AVG idea, stated explicitly so numbers
are auditable):
- putts, positional/layup-flagged shots, and penalty shots are excluded;
- partial swings are filtered: any shot shorter than 40% of the club's median
  is treated as a punch/pitch, not a full swing;
- the reported average is a 10% two-sided trimmed mean of what remains.

Distances are GPS start-to-rest TOTALS (bounce and roll included) — not carry.
Never compare them raw against openflight radar carries; that's what the
distance_type column is for.
"""

from __future__ import annotations

import sqlite3
import statistics
from dataclasses import dataclass

M_PER_YD = 0.9144
MIN_FULL_SWINGS = 4       # below this, stats are anecdotes; shown but not gap-checked
PARTIAL_FLOOR = 0.4       # of the club median
TRIM_FRACTION = 0.1


@dataclass
class ClubStats:
    club: str
    total_shots: int
    full_swings: int
    pavg_yd: float          # trimmed mean, yards
    median_yd: float
    sigma_yd: float
    longest_yd: float


def club_distances(con: sqlite3.Connection) -> dict[str, list[float]]:
    rows = con.execute(
        "SELECT club, distance_m FROM shots"
        " WHERE distance_type = 'total_gps'"
        " AND club IS NOT NULL AND club != 'Putter'"
        " AND lie IS NOT NULL AND lie != 'green'"
        " AND positional = 0 AND lost_ball = 0 AND water_hazard = 0"
        " AND distance_m IS NOT NULL AND distance_m > 0"
    )
    out: dict[str, list[float]] = {}
    for r in rows:
        out.setdefault(r["club"], []).append(r["distance_m"])
    return out


def _trimmed_mean(values: list[float], frac: float = TRIM_FRACTION) -> float:
    vals = sorted(values)
    k = int(len(vals) * frac)
    core = vals[k: len(vals) - k] if len(vals) > 2 * k else vals
    return statistics.mean(core)


def club_stats(dists_m: list[float], club: str) -> ClubStats:
    med = statistics.median(dists_m)
    full = [d for d in dists_m if d >= PARTIAL_FLOOR * med]
    return ClubStats(
        club=club,
        total_shots=len(dists_m),
        full_swings=len(full),
        pavg_yd=round(_trimmed_mean(full) / M_PER_YD, 1),
        median_yd=round(statistics.median(full) / M_PER_YD, 1),
        sigma_yd=round((statistics.stdev(full) / M_PER_YD) if len(full) > 1 else 0.0, 1),
        longest_yd=round(max(full) / M_PER_YD, 1),
    )


def all_club_stats(con: sqlite3.Connection) -> list[ClubStats]:
    stats = [club_stats(d, club) for club, d in club_distances(con).items()]
    return sorted(stats, key=lambda s: s.pavg_yd, reverse=True)


@dataclass
class GapFlag:
    longer: str
    shorter: str
    gap_yd: float
    kind: str  # 'overlap' | 'chasm'


def gap_flags(stats: list[ClubStats],
              overlap_yd: float = 8.0, chasm_yd: float = 25.0) -> list[GapFlag]:
    """Flag suspicious gaps between adjacent clubs (only well-sampled ones)."""
    solid = [s for s in stats if s.full_swings >= MIN_FULL_SWINGS]
    flags = []
    for longer, shorter in zip(solid, solid[1:]):
        gap = round(longer.pavg_yd - shorter.pavg_yd, 1)
        if gap < overlap_yd:
            flags.append(GapFlag(longer.club, shorter.club, gap, "overlap"))
        elif gap > chasm_yd:
            flags.append(GapFlag(longer.club, shorter.club, gap, "chasm"))
    return flags
