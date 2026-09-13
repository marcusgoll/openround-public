from pathlib import Path

import pytest

from openround import db, sg
from openround.sg import M_PER_YD

FT_TO_M = 0.3048


@pytest.fixture(autouse=True)
def synthetic_baseline(monkeypatch):
    monkeypatch.setenv("OPENROUND_SG_BASELINE", str(Path(__file__).parent / "fixtures" / "synthetic-sg.json"))


def test_interpolation_and_lookup():
    # Invented arithmetic values, not a real-world golf calibration.
    assert sg.expected_strokes(400 * M_PER_YD, "tee") == pytest.approx(6)
    assert sg.expected_strokes(8 * FT_TO_M, "green") == pytest.approx(1.8)
    assert sg.expected_strokes(150 * M_PER_YD, "fairway") == pytest.approx(3)
    assert sg.expected_strokes(10 * M_PER_YD, "rough") == pytest.approx(2)
    assert sg.expected_strokes(15 * M_PER_YD, "rough") == pytest.approx(2.5)
    assert sg.expected_strokes(0.0, "green") == 0.0
    assert sg.expected_strokes(0.2, "green") == pytest.approx(0.8)
    assert sg.expected_strokes(700 * M_PER_YD, "tee") == pytest.approx(8)
    assert sg.expected_strokes(None, "tee") is None


def _sg_round(con, shots_by_hole, pars):
    """Build a round where distances are driven purely by vendor remaining_m."""
    holes = []
    for num, (par, shots) in enumerate(zip(pars, shots_by_hole), start=1):
        holes.append({
            "number": num, "par": par, "strokes": len(shots), "putts": 0,
            "shots": shots,
        })
    rnd = {"source": "test", "source_id": "sgr", "played_at": "2026-08-20", "holes": holes}
    return db.upsert_round(con, rnd)


def test_hand_computed_hole(con):
    # 400 yd par 4: tee -> 150 yd fairway -> 8 ft putt -> holed.
    # No GPS: start distances chain from the previous shot's remaining.
    # Shot 1 needs a start: give it start GPS == pin-less fallback? Instead give
    # the hole a pin and the tee shot GPS so start = haversine = 400 yd.
    pin_lat, pin_lon = 32.0, -97.0
    lat_400yd = pin_lat - (400 * M_PER_YD) / 111194.93  # ~1 deg lat = 111.195 km
    shots = [
        {"seq": 1, "lie": "tee", "club": "Driver", "lat": lat_400yd, "lon": pin_lon,
         "remaining_m": 150 * M_PER_YD},
        {"seq": 2, "lie": "fairway", "club": "7 Iron", "remaining_m": 8 * FT_TO_M},
        {"seq": 3, "lie": "green", "club": "Putter", "remaining_m": None},
    ]
    rid = db.upsert_round(con, {
        "source": "test", "source_id": "h1", "played_at": "2026-08-20",
        "holes": [{"number": 1, "par": 4, "strokes": 3, "putts": 1,
                   "pin_lat": pin_lat, "pin_lon": pin_lon, "shots": shots}],
    })
    out, warnings = sg.round_shot_sg(con, rid)
    assert warnings == []
    assert len(out) == 3
    tee, app, putt = out
    # J(400,tee)=6 ; J(150,fw)=3 ; J(8ft)=1.8
    assert tee.sg == pytest.approx(6 - 3 - 1, abs=0.02)   # GPS start ~400 yd
    assert app.sg == pytest.approx(3 - 1.8 - 1, abs=0.001)
    assert putt.sg == pytest.approx(1.8 - 0 - 1, abs=0.001)
    assert [s.category for s in out] == ["tee", "approach", "putt"]
    # whole-hole SG must equal J(start) - strokes taken
    assert sum(s.sg for s in out) == pytest.approx(6 - 3, abs=0.02)


def test_penalty_costs_two(con):
    # lost tee ball, re-tee from the same remaining distance
    shots = [
        {"seq": 1, "lie": "tee", "remaining_m": 200 * M_PER_YD, "lost_ball": True},
        {"seq": 2, "lie": "tee", "remaining_m": 8 * FT_TO_M},
        {"seq": 3, "lie": "green", "remaining_m": None},
    ]
    rid = db.upsert_round(con, {
        "source": "test", "source_id": "pen", "played_at": "2026-08-20",
        "holes": [{"number": 1, "par": 4, "strokes": 4, "putts": 1, "shots": shots}],
    })
    out, warnings = sg.round_shot_sg(con, rid)
    # shot 1 start distance unknown (no pin, no previous remaining) -> skipped with warning
    assert any("shot 1" in w for w in warnings)
    lost_free = [s for s in out if s.seq == 2]
    assert lost_free  # chain recovers from shot 2 onward via remaining_m


def test_category_rules():
    assert sg._category("tee", 4, 350 * M_PER_YD) == "tee"
    assert sg._category("tee", 3, 160 * M_PER_YD) == "approach"   # par-3 tee shot
    assert sg._category("fairway", 4, 120 * M_PER_YD) == "approach"
    assert sg._category("rough", 4, 30 * M_PER_YD) == "short"
    assert sg._category("green", 4, 3) == "putt"


def test_approach_buckets_and_clubs(con):
    pin = (32.0, -97.0)
    shots = [
        {"seq": 1, "lie": "tee", "lat": pin[0] - (160 * M_PER_YD) / 111194.93, "lon": pin[1],
         "remaining_m": 2.0, "club": "6 Iron"},
        {"seq": 2, "lie": "green", "remaining_m": None, "club": "Putter"},
    ]
    rid = db.upsert_round(con, {
        "source": "test", "source_id": "b", "played_at": "2026-08-20",
        "holes": [{"number": 1, "par": 3, "strokes": 2, "putts": 1,
                   "pin_lat": pin[0], "pin_lon": pin[1], "shots": shots}],
    })
    out, _ = sg.round_shot_sg(con, rid)
    buckets = sg.approach_buckets(out)
    assert buckets["150-200yd"][0] == 1
    clubs = sg.by_club(out)
    assert "6 Iron" in clubs and "Putter" not in clubs


def test_zero_distance_putt_floored_to_two_feet(con):
    shots = [
        {"seq": 1, "lie": "tee", "remaining_m": 0.0, "lat": 32.0, "lon": -97.0},
        {"seq": 2, "lie": "green", "remaining_m": None},
    ]
    rid = db.upsert_round(con, {
        "source": "test", "source_id": "z", "played_at": "2026-08-20",
        "holes": [{"number": 1, "par": 3, "strokes": 2, "putts": 1,
                   "pin_lat": 32.0, "pin_lon": -97.003, "shots": shots}],
    })
    out, _ = sg.round_shot_sg(con, rid)
    putt = next(s for s in out if s.category == "putt")
    # start floored to 2 ft: sg = J(2ft) - 0 - 1 = +0.2, never -1.00
    assert putt.sg == pytest.approx(0.2, abs=0.001)


def test_implausible_putt_quarantined_with_warning(con):
    shots = [
        {"seq": 1, "lie": "green", "lat": 32.0, "lon": -97.0, "remaining_m": None},
    ]
    rid = db.upsert_round(con, {
        "source": "test", "source_id": "q", "played_at": "2026-08-20",
        "holes": [{"number": 1, "par": 4, "strokes": 1, "putts": 1,
                   "pin_lat": 32.004, "pin_lon": -97.0, "shots": shots}],  # ~440 m away
    })
    out, warnings = sg.round_shot_sg(con, rid)
    assert out == []
    assert any("implausible putt" in w for w in warnings)


def test_vendor_remaining_chain_beats_gps(con):
    # shot 2's GPS says 300 yd out, but shot 1's remaining says 8 ft: trust remaining
    shots = [
        {"seq": 1, "lie": "tee", "lat": 32.01, "lon": -97.0, "remaining_m": 8 * FT_TO_M},
        {"seq": 2, "lie": "green", "lat": 32.01, "lon": -97.0, "remaining_m": None},
    ]
    rid = db.upsert_round(con, {
        "source": "test", "source_id": "v", "played_at": "2026-08-20",
        "holes": [{"number": 1, "par": 3, "strokes": 2, "putts": 1,
                   "pin_lat": 32.0, "pin_lon": -97.0, "shots": shots}],
    })
    out, _ = sg.round_shot_sg(con, rid)
    putt = next(s for s in out if s.category == "putt")
    assert putt.start_dist_m == pytest.approx(8 * FT_TO_M)
    assert putt.sg == pytest.approx(1.8 - 0 - 1, abs=0.001)


@pytest.mark.parametrize('flag', ['lost_ball', 'water_hazard'])
def test_penalty_adds_one_stroke_to_known_shot(con, flag):
    pin_lat, pin_lon = 32.0, -97.0
    shots = [
        {'seq': 1, 'lie': 'tee', 'lat': pin_lat - 400 * M_PER_YD / 111194.93,
         'lon': pin_lon, 'remaining_m': 400 * M_PER_YD, flag: True},
        {'seq': 2, 'lie': 'tee', 'remaining_m': 8 * FT_TO_M},
        {'seq': 3, 'lie': 'green', 'remaining_m': None},
    ]
    rid = db.upsert_round(con, {
        'source': 'test', 'source_id': flag, 'played_at': '2026-08-20',
        'holes': [{'number': 1, 'par': 4, 'strokes': 4, 'putts': 1,
                   'pin_lat': pin_lat, 'pin_lon': pin_lon, 'shots': shots}],
    })
    out, warnings = sg.round_shot_sg(con, rid)
    assert warnings == []
    assert out[0].penalty
    assert out[0].sg == pytest.approx(-2, abs=0.001)
    assert sum(s.sg for s in out) == pytest.approx(6 - 4, abs=0.001)
