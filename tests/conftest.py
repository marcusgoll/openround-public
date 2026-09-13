import pytest

from openround import db


def make_hole(number, par, strokes, putts, fairway=None, penalties=0, **kw):
    hole = {
        "number": number,
        "par": par,
        "strokes": strokes,
        "putts": putts,
        "fairway": fairway,
        "penalties": penalties,
    }
    hole.update(kw)
    return hole


@pytest.fixture
def fixture_round():
    """A 9-hole round with known, hand-checkable stats.

    Hole  Par Strokes Putts FW     GIR(derived)         Scramble        Dbl+
    1     4   5       2     left   5-2=3 > 2  miss      5>4 missed      -
    2     4   4       1     hit    4-1=3 > 2  miss      4<=4 converted  -
    3     3   3       2     -      3-2=1 <= 1 HIT       -               -
    4     5   7       2     right  7-2=5 > 3  miss      7>5 missed      double
    5     4   4       2     hit    4-2=2 <= 2 HIT       -               -
    6     4   6       3     left   6-3=3 > 2  miss      6>4 missed      double
    7     3   2       1     -      2-1=1 <= 1 HIT       -               -
    8     4   5       2     hit    5-2=3 > 2  miss      5>4 missed      -
    9     5   5       2     hit    5-2=3 <= 3 HIT       -               -
    Totals: score 41, par 36 (+5), FW 4/7, GIR 4, putts 17,
            scramble 1/5, doubles 2, penalties 1 (on hole 4).
    """
    holes = [
        make_hole(1, 4, 5, 2, "left"),
        make_hole(2, 4, 4, 1, "hit"),
        make_hole(3, 3, 3, 2),
        make_hole(4, 5, 7, 2, "right", penalties=1),
        make_hole(5, 4, 4, 2, "hit"),
        make_hole(6, 4, 6, 3, "left"),
        make_hole(7, 3, 2, 1),
        make_hole(8, 4, 5, 2, "hit"),
        make_hole(9, 5, 5, 2, "hit"),
    ]
    holes[0]["shots"] = [
        {"seq": 1, "club": "Driver", "lat": 32.335, "lon": -97.706, "distance_m": 215.0, "lie": "tee"},
        {"seq": 2, "club": "7 Iron", "distance_m": 140.0, "lie": "rough"},
    ]
    return {
        "source": "test",
        "source_id": "r1",
        "played_at": "2026-08-17",
        "course": "Squaw Valley GC - Lakes",
        "tees": "Blue",
        "holes": holes,
    }


@pytest.fixture
def con(tmp_path):
    return db.connect(tmp_path / "test.db")
