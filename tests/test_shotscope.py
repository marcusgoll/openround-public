from copy import deepcopy

from openround import db, shotscope, stats

SLIM = {
    "roundID": 98765,
    "courseName": "Squaw Valley GC - Lakes",
    "startedDate": "2026-08-17T13:05:00",
    "tees": "Blue",
    "totalShots": 9,
    "putts": 4,
    "playedHoles": 2,
    "state": "Active",
}

# Shapes mirror the real /api/v2/rounds/{id} payload (captured 2026-08-20):
# club is a dict {name, type, tag, color}; shots carry vendor distance/remaining
# in meters, positional/lostBall/waterHazard flags, and a dateTime.
# Two holes. Hole 1: drive into rough, approach to green, two putts (putter tag
# present -> putts derivable from lie=="Green"). Hole 2: par 3, tee shot lost
# (penalty), re-tee to green, two putts.
def _club(name, tag, ctype=None):
    return {"name": name, "type": ctype or name, "tag": tag, "color": "FDC758"}


DETAIL = {
    "holes": [
        {
            "holeNum": 1,
            "par": 4,
            "score": 4,
            "scoreToPar": 0,
            "fairwayInRegulation": False,
            "greenInRegulation": True,
            "pin": {"lat": 32.3350, "lng": -97.7060, "dateTime": "2026-08-17T14:10:00"},
            "shots": [
                {"startLat": 32.3300, "startLng": -97.7000, "endLat": 32.3320,
                 "endLng": -97.7030, "lie": "Tee", "club": _club("Driver", "D"),
                 "distance": 215.4, "remaining": 130.0, "positional": False,
                 "lostBall": False, "waterHazard": False,
                 "dateTime": "2026-08-17T14:02:11"},
                {"startLat": 32.3320, "startLng": -97.7030, "endLat": 32.3349,
                 "endLng": -97.7059, "lie": "Rough", "club": _club("7 Iron", "7i", "Iron"),
                 "distance": 128.0, "remaining": 4.2, "positional": False,
                 "lostBall": False, "waterHazard": False,
                 "dateTime": "2026-08-17T14:05:40"},
                {"startLat": 32.3349, "startLng": -97.7059, "endLat": 32.33495,
                 "endLng": -97.70595, "lie": "Green", "club": _club("Putter", "P"),
                 "distance": 3.4, "remaining": 0.5, "positional": False,
                 "lostBall": False, "waterHazard": False,
                 "dateTime": "2026-08-17T14:08:02"},
                {"startLat": 32.33495, "startLng": -97.70595, "endLat": 32.3350,
                 "endLng": -97.7060, "lie": "Green", "club": _club("Putter", "P"),
                 "distance": 0.5, "remaining": None, "positional": False,
                 "lostBall": False, "waterHazard": False,
                 "dateTime": "2026-08-17T14:08:40"},
            ],
        },
        {
            "holeNum": 2,
            "par": 3,
            "score": 5,
            "scoreToPar": 2,
            "fairwayInRegulation": None,
            "greenInRegulation": False,
            "pin": {"latitude": 32.3400, "longitude": -97.7100},  # alternate key shape
            "shots": [
                # lost ball: no end point, no vendor distance -> haversine fallback impossible
                {"startLat": 32.3380, "startLng": -97.7080, "endLat": None,
                 "endLng": None, "lie": "Tee", "club": _club("6 Iron", "6i", "Iron"),
                 "distance": None, "remaining": None, "positional": False,
                 "lostBall": True, "waterHazard": False, "dateTime": "2026-08-17T14:20:00"},
                # re-tee: no vendor distance either -> exercises the haversine fallback
                {"startLat": 32.3380, "startLng": -97.7080, "endLat": 32.3399,
                 "endLng": -97.7099, "lie": "Tee", "club": _club("6 Iron", "6i", "Iron"),
                 "remaining": 6.0, "positional": False,
                 "lostBall": False, "waterHazard": False, "dateTime": "2026-08-17T14:22:00"},
                {"startLat": 32.3399, "startLng": -97.7099, "endLat": 32.3400,
                 "endLng": -97.7100, "lie": "Green", "club": _club("Putter", "P"),
                 "distance": 6.0, "remaining": 0.8, "positional": False,
                 "lostBall": False, "waterHazard": False, "dateTime": "2026-08-17T14:24:00"},
                {"startLat": 32.3400, "startLng": -97.7100, "endLat": 32.3400,
                 "endLng": -97.7100, "lie": "Green", "club": _club("Putter", "P"),
                 "distance": 0.8, "remaining": None, "positional": False,
                 "lostBall": False, "waterHazard": False, "dateTime": "2026-08-17T14:25:00"},
            ],
        },
    ]
}


def test_normalize_round_shapes_and_semantics():
    rnd = shotscope.normalize_round(SLIM, DETAIL)
    assert rnd["source"] == "shotscope"
    assert rnd["source_id"] == "98765"
    assert rnd["played_at"] == "2026-08-17"
    assert rnd["putts_total"] == 4

    h1, h2 = rnd["holes"]
    assert (h1["number"], h1["par"], h1["strokes"]) == (1, 4, 4)
    assert h1["fairway"] == "missed"
    assert h1["gir"] == 1
    assert h1["putts"] == 2                      # two lie=="Green" shots
    assert h1["pin_lat"] == 32.3350
    assert h1["shots"][1]["lie"] == "rough"
    assert h1["shots"][0]["club"] == "Driver"    # dict club -> name
    assert h1["shots"][0]["distance_m"] == 215.4 # vendor distance preferred
    assert h1["shots"][0]["remaining_m"] == 130.0
    assert h1["shots"][0]["timestamp"] == "2026-08-17T14:02:11"

    assert h2["fairway"] is None                 # par 3: no fairway stat
    assert h2["penalties"] == 1                  # lost ball
    assert h2["pin_lon"] == -97.7100             # alternate pin key shape
    assert h2["shots"][0]["distance_m"] is None  # lost ball: no end point, no vendor distance
    assert h2["shots"][0]["lost_ball"] is True
    assert h2["shots"][1]["distance_m"] > 100    # haversine fallback when vendor distance absent


def test_normalize_round_preserves_only_explicit_event_ids():
    detail = deepcopy(DETAIL)
    detail["holes"][0]["shots"][0]["source_event_id"] = "evt-raw"
    detail["holes"][0]["shots"][1]["sourceEventId"] = "evt-camel"
    rnd = shotscope.normalize_round(SLIM, detail)
    assert rnd["holes"][0]["shots"][0]["source_event_id"] == "evt-raw"
    assert rnd["holes"][0]["shots"][1]["source_event_id"] == "evt-camel"
    assert "source_event_id" not in rnd["holes"][1]["shots"][0]


def test_haversine_sanity():
    # one degree of latitude is ~111.2 km
    d = shotscope.haversine_m(32.0, -97.0, 33.0, -97.0)
    assert abs(d - 111_195) < 300


def test_end_to_end_normalize_import_stats(con):
    rnd = shotscope.normalize_round(SLIM, DETAIL)
    rid = db.upsert_round(con, rnd)
    s = stats.round_stats(con, rid)
    assert s.score == 9
    assert s.par == 7
    assert s.score_vs_par == "+2"
    assert (s.fw_hit, s.fw_opps) == (0, 1)
    assert s.gir == 1
    assert s.putts == 4
    assert s.penalties == 1
    assert s.doubles == 1                        # hole 2: 5 on a par 3


def test_vendor_putts_fallback_when_no_putter_tag(con):
    detail = {
        "holes": [
            {**DETAIL["holes"][0], "shots": []},
            {**DETAIL["holes"][1], "shots": []},
        ]
    }
    rnd = shotscope.normalize_round(SLIM, detail)
    assert all(h["putts"] is None for h in rnd["holes"])
    rid = db.upsert_round(con, rnd)
    s = stats.round_stats(con, rid)
    assert s.putts == 4                          # slim round total backfills
    assert any("vendor round total" in w for w in s.warnings)
