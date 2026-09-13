from openround import db, stats


def test_round_stats_hand_checked_values(con, fixture_round):
    rid = db.upsert_round(con, fixture_round)
    s = stats.round_stats(con, rid)
    assert s.score == 41
    assert s.par == 36
    assert s.score_vs_par == "+5"
    assert (s.fw_hit, s.fw_opps) == (4, 7)
    assert s.gir == 4
    assert s.putts == 17
    assert (s.scramble_converted, s.scramble_attempts) == (1, 5)
    assert s.doubles == 2
    assert s.penalties == 1
    assert s.warnings == []


def test_explicit_flags_override_derivation(con, fixture_round):
    fixture_round["holes"][0]["gir"] = 1  # recorded GIR despite strokes-putts saying miss
    fixture_round["holes"][3]["up_and_down"] = "converted"
    rid = db.upsert_round(con, fixture_round)
    s = stats.round_stats(con, rid)
    assert s.gir == 5
    assert s.scramble_attempts == 4  # hole 1 no longer a miss
    assert s.scramble_converted == 2  # hole 2 derived + hole 4 recorded


def test_baseline_excludes_nine_hole_rounds(con, fixture_round):
    db.upsert_round(con, fixture_round)  # 9 holes
    eighteen = dict(
        fixture_round,
        source_id="r18",
        played_at="2026-08-24",
        holes=fixture_round["holes"]
        + [dict(h, number=h["number"] + 9) for h in fixture_round["holes"]],
    )
    db.upsert_round(con, eighteen)
    base = stats.baseline(stats.all_round_stats(con))
    assert base.rounds == 1
    assert base.excluded_nines == 1
    assert base.gir_avg == 8.0
    assert base.putts_avg == 34.0
    assert base.doubles_avg == 4.0
    assert round(base.scramble_pct) == 20


def test_missing_putts_yields_warning_not_garbage(con, fixture_round):
    fixture_round["holes"][2]["putts"] = None
    rid = db.upsert_round(con, fixture_round)
    s = stats.round_stats(con, rid)
    assert s.putts is None
    assert any("putts" in w for w in s.warnings)
