"""Auto-fill the Scratch Golf Roadmap note in Obsidian from the OpenRound database.

Touches exactly two things in the note, nothing else:
- the Baseline table's five derived-stat rows (never the Handicap Index row)
- the Round log table: fills empty stat cells on existing rows (matched by date)
  and appends rows for rounds the log doesn't have yet (Notes left for the human)

Default is a dry run that prints a unified diff; --write applies it after
backing the file up to ~/.cache/openround/backups/.
"""

from __future__ import annotations

import datetime as _dt
import difflib
import re
import shutil
from pathlib import Path

from .stats import Baseline, RoundStats

DEFAULT_ROADMAP = Path.home() / "Documents" / "Obsidian Homelab Vault" / "17 - Golf" / "Scratch Golf Roadmap.md"
BACKUP_DIR = Path.home() / ".cache" / "openround" / "backups"

_BASELINE_HEADER = ["Measure", "Baseline", "Date"]
_LOG_HEADER = ["Date", "Course / tees", "Score", "FW", "GIR", "Putts", "Up-and-down", "Penalties", "Doubles+", "Notes"]


def _cells(line: str) -> list[str]:
    inner = line.strip()
    if inner.startswith("|"):
        inner = inner[1:]
    if inner.endswith("|") and not inner.endswith("\\|"):
        inner = inner[:-1]
    # split on unescaped pipes only, so "\|" inside a cell survives round-trips
    return [c.strip() for c in re.split(r"(?<!\\)\|", inner)]


def _is_separator(line: str) -> bool:
    cells = _cells(line)
    return bool(cells) and all(re.fullmatch(r":?-+:?", c) for c in cells)


def _row(cells: list[str]) -> str:
    return "| " + " | ".join(cells) + " |"


def _is_table_row(line: str) -> bool:
    return line.lstrip().startswith("|")


def _find_table(lines: list[str], header: list[str]) -> tuple[int, int] | None:
    """Return (first_data_row_index, end_index_exclusive) for the table with this header."""
    for i, line in enumerate(lines):
        if _is_table_row(line) and _cells(line) == header:
            if i + 1 >= len(lines) or not _is_separator(lines[i + 1]):
                continue  # header without a |---| separator row is not a real table
            start = i + 2
            end = start
            while end < len(lines) and _is_table_row(lines[end]):
                end += 1
            return start, end
    return None


def _fmt(value: float | None, digits: int = 1) -> str:
    return "" if value is None else f"{value:.{digits}f}"


def baseline_cells(b: Baseline) -> dict[str, str]:
    return {
        "Fairways / round": f"{b.fw_hit_avg:.1f}/{b.fw_opps_avg:.0f} ({b.fw_pct:.0f}%)",
        "GIR / round": _fmt(b.gir_avg),
        "Putts / round": _fmt(b.putts_avg),
        "Scrambling %": "" if b.scramble_pct is None else f"{b.scramble_pct:.0f}%",
        "Doubles+ / round": _fmt(b.doubles_avg),
    }


def _log_cells(s: RoundStats) -> dict[str, str]:
    score = f"{s.score} ({s.score_vs_par})" if s.score is not None and s.score_vs_par else _fmt(s.score, 0)
    return {
        "Score": score,
        "FW": f"{s.fw_hit}/{s.fw_opps}" if s.fw_opps else "",
        "GIR": str(s.gir) if s.gir_known else "",
        "Putts": "" if s.putts is None else str(s.putts),
        "Up-and-down": f"{s.scramble_converted}/{s.scramble_attempts}" if s.scramble_attempts else "",
        "Penalties": str(s.penalties),
        "Doubles+": str(s.doubles),
    }


def updated_text(text: str, stats: list[RoundStats], base: Baseline | None, today: str | None = None) -> str:
    today = today or _dt.date.today().isoformat()
    lines = text.splitlines()

    if base is not None:
        span = _find_table(lines, _BASELINE_HEADER)
        if span is None:
            raise ValueError("Baseline table not found (header '| Measure | Baseline | Date |')")
        targets = baseline_cells(base)
        for i in range(*span):
            cells = _cells(lines[i])
            if cells and cells[0] in targets:
                cells += [""] * (3 - len(cells))
                # compare the value only: the date is stamped when the value
                # changes, so an unchanged baseline never churns the file
                if cells[1] != targets[cells[0]]:
                    lines[i] = _row([cells[0], targets[cells[0]], today])

    span = _find_table(lines, _LOG_HEADER)
    if span is None:
        raise ValueError("Round log table not found (header '| Date | Course / tees | ... |')")
    start, end = span
    by_date: dict[str, int] = {}
    for i in range(start, end):
        cells = _cells(lines[i])
        if cells:
            by_date.setdefault(cells[0], i)

    appended: list[str] = []
    for s in sorted(stats, key=lambda s: s.played_at):
        wanted = _log_cells(s)
        if s.played_at in by_date:
            i = by_date[s.played_at]
            cells = _cells(lines[i])
            if len(cells) > len(_LOG_HEADER):
                continue  # malformed row (more cells than columns): leave it alone
            cells += [""] * (len(_LOG_HEADER) - len(cells))
            changed = False
            for col, value in wanted.items():
                idx = _LOG_HEADER.index(col)
                if not cells[idx] and value:
                    cells[idx] = value
                    changed = True
            if changed:
                lines[i] = _row(cells)
        else:
            course = f"{s.course}" if s.course else ""
            cells = [s.played_at, course] + [""] * (len(_LOG_HEADER) - 2)
            for col, value in wanted.items():
                cells[_LOG_HEADER.index(col)] = value
            appended.append(_row(cells))

    lines[end:end] = appended
    out = "\n".join(lines)
    if text.endswith("\n"):
        out += "\n"
    return out


def apply(path: Path, stats: list[RoundStats], base: Baseline | None, write: bool) -> str:
    """Return the unified diff; write the file (with backup) only when write=True."""
    original = path.read_text()
    new = updated_text(original, stats, base)
    diff = "".join(
        difflib.unified_diff(
            original.splitlines(keepends=True),
            new.splitlines(keepends=True),
            fromfile=str(path),
            tofile=str(path) + " (updated)",
        )
    )
    if write and diff:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(path, BACKUP_DIR / f"{path.name}.{stamp}")
        path.write_text(new)
    return diff
