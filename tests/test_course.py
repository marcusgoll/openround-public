from openround import course, db


SQUARE_FAIRWAY = [(0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]
GREEN_INSIDE = [(0.4, 0.4), (0.4, 0.6), (0.6, 0.6), (0.6, 0.4), (0.4, 0.4)]

FEATURES = {
    "bbox": (-1, -1, 2, 2),
    "polygons": [
        {"kind": "fairway", "points": SQUARE_FAIRWAY, "ref": None, "par": None},
        {"kind": "green", "points": GREEN_INSIDE, "ref": None, "par": None},
    ],
    "lines": [{"kind": "hole", "points": [(0, 0), (1, 1)], "ref": "1", "par": "4"}],
}


def test_point_in_polygon():
    assert course.point_in_polygon(0.5, 0.5, SQUARE_FAIRWAY)
    assert not course.point_in_polygon(1.5, 0.5, SQUARE_FAIRWAY)
    # boundary-adjacent points don't crash
    assert course.point_in_polygon(0.5, 0.0001, SQUARE_FAIRWAY)


def test_classify_priority_green_beats_fairway():
    assert course.classify_point(0.5, 0.5, FEATURES) == "green"
    assert course.classify_point(0.2, 0.2, FEATURES) == "fairway"
    assert course.classify_point(1.5, 1.5, FEATURES) is None


def test_grade_verdicts():
    assert course.grade(FEATURES)["verdict"] == "partial"
    many = {
        "bbox": None,
        "polygons": [{"kind": "green", "points": GREEN_INSIDE}] * 18
        + [{"kind": "fairway", "points": SQUARE_FAIRWAY}] * 14,
        "lines": [],
    }
    assert course.grade(many)["verdict"] == "well-mapped"
    assert course.grade({"bbox": None, "polygons": [], "lines": []})["verdict"] == "unmapped"


def test_fairway_crosscheck(con):
    rnd = {
        "source": "test", "source_id": "cc", "played_at": "2026-08-20", "course": "Test GC",
        "holes": [
            {"number": 1, "par": 4, "strokes": 4, "putts": 2, "fairway": "hit",
             "shots": [{"seq": 1, "lie": "tee", "lat": -0.5, "lon": 0.5,
                        "end_lat": 0.2, "end_lon": 0.2}]},          # OSM says fairway: agree
            {"number": 2, "par": 4, "strokes": 5, "putts": 2, "fairway": "hit",
             "shots": [{"seq": 1, "lie": "tee", "lat": -0.5, "lon": 0.5,
                        "end_lat": 1.5, "end_lon": 1.5}]},          # OSM says nothing: outside
        ],
    }
    db.upsert_round(con, rnd)
    x = course.fairway_crosscheck(con, "Test GC", FEATURES)
    assert x["checked"] == 2
    assert x["agree"] == 1
    assert x["outside_map"] == 1
    assert x["disagree"] == 0


def test_slug():
    assert course.slug("Squaw Valley GC - Lakes Course") == "squaw-valley-gc-lakes-course"
