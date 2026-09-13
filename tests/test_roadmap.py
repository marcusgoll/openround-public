from openround import db, roadmap, stats

MINI_ROADMAP = """# Scratch Golf Roadmap

Baseline (fill in when known):

| Measure | Baseline | Date |
|---|---|---|
| Handicap Index | 12.1 | 2026-08-19 |
| Fairways / round | | |
| GIR / round | | |
| Putts / round | | |
| Scrambling % | | |
| Doubles+ / round | | |

## Round log

| Date | Course / tees | Score | FW | GIR | Putts | Up-and-down | Penalties | Doubles+ | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 2026-08-17 | Squaw Valley GC - Lakes, Blue | 85 (+13) | | | | | | 2 | Birdie on 8. |
"""


def _stats_and_base(con, fixture_round):
    db.upsert_round(con, fixture_round)
    new = dict(
        fixture_round,
        source_id="r18",
        played_at="2026-08-24",
        holes=fixture_round["holes"]
        + [dict(h, number=h["number"] + 9) for h in fixture_round["holes"]],
    )
    db.upsert_round(con, new)
    all_stats = stats.all_round_stats(con)
    return all_stats, stats.baseline(all_stats)


def test_fills_existing_row_preserving_score_and_notes(con, fixture_round):
    all_stats, base = _stats_and_base(con, fixture_round)
    out = roadmap.updated_text(MINI_ROADMAP, all_stats, base, today="2026-08-20")
    row = next(l for l in out.splitlines() if l.startswith("| 2026-08-17"))
    assert "85 (+13)" in row          # existing score untouched
    assert "Birdie on 8." in row      # notes untouched
    assert "| 4/7 |" in row           # FW filled
    assert "| 17 |" in row            # putts filled
    assert "| 2 |" in row             # existing Doubles+ cell preserved


def test_appends_missing_round_and_fills_baseline(con, fixture_round):
    all_stats, base = _stats_and_base(con, fixture_round)
    out = roadmap.updated_text(MINI_ROADMAP, all_stats, base, today="2026-08-20")
    assert any(l.startswith("| 2026-08-24") for l in out.splitlines())
    row = next(l for l in out.splitlines() if l.startswith("| 2026-08-24"))
    assert "82 (+10)" in row          # 2x41 strokes vs 2x36 par
    base_row = next(l for l in out.splitlines() if l.startswith("| GIR / round"))
    assert "8.0" in base_row
    hcp = next(l for l in out.splitlines() if l.startswith("| Handicap Index"))
    assert "12.1" in hcp and "2026-08-19" in hcp  # never touched


def test_second_run_is_idempotent(con, fixture_round):
    all_stats, base = _stats_and_base(con, fixture_round)
    once = roadmap.updated_text(MINI_ROADMAP, all_stats, base, today="2026-08-20")
    twice = roadmap.updated_text(once, all_stats, base, today="2026-08-20")
    assert once == twice
