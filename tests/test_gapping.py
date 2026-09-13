from openround import db, gapping
from openround.gapping import M_PER_YD


def _shot(club, dist_yd, lie="fairway", **kw):
    s = {"club": club, "distance_m": dist_yd * M_PER_YD, "lie": lie, "seq": 1}
    s.update(kw)
    return s


def _import(con, shots):
    holes = [{"number": i + 1, "par": 4, "strokes": 4, "putts": 2, "shots": [s]}
             for i, s in enumerate(shots)]
    db.upsert_round(con, {"source": "test", "source_id": "g",
                          "played_at": "2026-08-20", "holes": holes})


def test_partial_swings_filtered_and_trimmed_mean(con):
    # eight full 7-irons around 150 plus one 45-yd punch: punch excluded
    shots = [_shot("7 Iron", d) for d in (145, 148, 150, 150, 151, 152, 153, 155, 45)]
    _import(con, shots)
    s = gapping.all_club_stats(con)[0]
    assert s.total_shots == 9
    assert s.full_swings == 8
    assert 148 <= s.pavg_yd <= 153
    assert s.longest_yd == 155.0


def test_exclusions(con):
    shots = [
        _shot("9 Iron", 130),
        _shot("9 Iron", 128),
        _shot("9 Iron", 131, positional=True),           # layup: excluded
        _shot("9 Iron", 60, lost_ball=True),             # penalty: excluded
        _shot("Putter", 5, lie="fringe"),                # putter: excluded entirely
        {"club": "9 Iron", "distance_m": 3.0, "lie": "green", "seq": 1},  # putt lie: excluded
    ]
    _import(con, shots)
    stats_list = gapping.all_club_stats(con)
    assert [s.club for s in stats_list] == ["9 Iron"]
    assert stats_list[0].total_shots == 2


def test_club_distances_only_use_gps_totals(con):
    _import(
        con,
        [
            _shot("7 Iron", 150, distance_type="total_gps"),
            _shot("7 Iron", 160, distance_type="carry_radar"),
        ],
    )

    assert gapping.club_distances(con)["7 Iron"] == [150 * M_PER_YD]


def test_gap_flags(con):
    shots = (
        [_shot("Driver", d) for d in (230, 232, 235, 238)]
        + [_shot("3 Wood", d) for d in (228, 230, 231, 233)]      # overlap with Driver
        + [_shot("7 Iron", d) for d in (150, 152, 154, 156)]      # 79-yd chasm from 3W
        + [_shot("8 Iron", d) for d in (140, 141)]                # small sample: ignored
    )
    _import(con, shots)
    stats_list = gapping.all_club_stats(con)
    flags = gapping.gap_flags(stats_list)
    kinds = {(f.longer, f.shorter): f.kind for f in flags}
    assert kinds[("Driver", "3 Wood")] == "overlap"
    assert kinds[("3 Wood", "7 Iron")] == "chasm"
    assert not any("8 Iron" in pair for pair in kinds)
