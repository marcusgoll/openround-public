"""Regression tests for the 2026-08-20 adversarial review findings."""

from copy import deepcopy

import pytest

from openround import db, roadmap, shotscope, stats
from test_roadmap import MINI_ROADMAP, _stats_and_base
from test_shotscope import DETAIL, SLIM


def test_escaped_pipe_in_course_cell_survives_fill(con, fixture_round):
    all_stats, base = _stats_and_base(con, fixture_round)
    text = MINI_ROADMAP.replace(
        "Squaw Valley GC - Lakes, Blue", r"Squaw Valley \| Lakes, Blue"
    )
    out = roadmap.updated_text(text, all_stats, base, today="2026-08-20")
    row = next(l for l in out.splitlines() if l.startswith("| 2026-08-17"))
    assert r"Squaw Valley \| Lakes, Blue" in row   # cell intact
    assert "85 (+13)" in row                       # score still in the Score column
    assert "| 4/7 |" in row                        # FW landed in the right column


def test_unchanged_baseline_does_not_churn_on_a_later_day(con, fixture_round):
    all_stats, base = _stats_and_base(con, fixture_round)
    day1 = roadmap.updated_text(MINI_ROADMAP, all_stats, base, today="2026-08-20")
    day2 = roadmap.updated_text(day1, all_stats, base, today="2026-08-21")
    assert day1 == day2  # same stats next day: no rewrite, no backup churn


def test_header_without_separator_raises_instead_of_duplicating(con, fixture_round):
    all_stats, base = _stats_and_base(con, fixture_round)
    text = "# Note\n\n| Date | Course / tees | Score | FW | GIR | Putts | Up-and-down | Penalties | Doubles+ | Notes |\n"
    with pytest.raises(ValueError):
        roadmap.updated_text(text, all_stats, base, today="2026-08-20")


def test_tracked_round_without_putter_tag_leaves_putts_none():
    detail = deepcopy(DETAIL)
    for hole in detail["holes"]:
        for shot in hole["shots"]:
            if shot["lie"] == "Green":
                shot["lie"] = "Fairway"  # putter tag absent: no green lies anywhere
    rnd = shotscope.normalize_round(SLIM, detail)
    assert all(h["putts"] is None for h in rnd["holes"])  # not 0


def test_normalizer_tolerates_null_fields():
    slim = dict(SLIM, startedDate=None, totalShots=None)
    rnd = shotscope.normalize_round(slim, {"holes": None})
    assert rnd["played_at"] == ""
    assert rnd["holes"] == []

    detail = deepcopy(DETAIL)
    rnd2 = shotscope.normalize_round(slim, detail)
    assert rnd2["played_at"] == ""


def test_score_summed_when_vendor_total_is_null(con):
    slim = dict(SLIM, totalShots=None)
    rnd = shotscope.normalize_round(slim, DETAIL)
    rid = db.upsert_round(con, rnd)
    assert con.execute("SELECT score FROM rounds WHERE id=?", (rid,)).fetchone()[0] == 9


def test_null_state_round_is_not_dropped():
    kept = [
        r
        for r in [dict(SLIM, state=None), dict(SLIM, roundID=2, state="Deleted")]
        if (r.get("state") or "Active") == "Active"
    ]
    assert len(kept) == 1 and kept[0]["state"] is None


def test_new_idless_round_is_rejected(con, fixture_round):
    with pytest.raises(db.ImportValidationError, match="source_id"):
        db.upsert_round(con, dict(fixture_round, source="manual", source_id=None))


def test_null_penalties_imports_as_zero(con, fixture_round):
    fixture_round["holes"][0]["penalties"] = None
    rid = db.upsert_round(con, fixture_round)
    s = stats.round_stats(con, rid)
    assert s.penalties == 1  # only hole 4's real penalty
