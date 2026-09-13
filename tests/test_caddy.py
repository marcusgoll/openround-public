import math

import pytest

from openround import db
from openround.caddy import (
    ClubProfile,
    CaddyContext,
    Recommendation,
    format_recommendation,
    recommend,
)
from openround.__main__ import main


def profile(
    club,
    *,
    carry=None,
    total=None,
    dispersion=8.0,
    samples=20,
    reviewed=True,
):
    return ClubProfile(
        club=club,
        carry_yd=carry,
        total_yd=total,
        dispersion_yd=dispersion,
        sample_count=samples,
        reviewed=reviewed,
    )


def test_plays_like_and_carry_first_selection():
    result = recommend(
        CaddyContext(target_yd=150, wind_adjustment_yd=4, elevation_adjustment_yd=2),
        [
            profile("8 Iron", carry=145, total=151, dispersion=7, samples=24),
            profile("7 Iron", carry=156, total=164, dispersion=9, samples=24),
        ],
    )

    assert result.status == "ready"
    assert result.club == "7 Iron"
    assert result.plays_like_yd == 156
    assert result.distance_basis == "carry"
    assert result.carry_yd == 156
    assert result.total_yd == 164
    assert result.confidence == "low"


def test_total_only_profile_is_explicitly_provisional():
    result = recommend(
        CaddyContext(target_yd=158),
        [profile("7 Iron", total=162, dispersion=8, samples=35, reviewed=False)],
    )

    assert result.status == "ready"
    assert result.club == "7 Iron"
    assert result.distance_basis == "total_gps"
    assert result.carry_yd is None
    assert result.total_yd == 162
    assert result.confidence == "provisional"
    assert "carry profile unavailable; using GPS total" in result.assumptions
    assert "profile samples are not yet marked reviewed" in result.assumptions


def test_carry_clearance_blocks_total_only_profiles():
    result = recommend(
        CaddyContext(target_yd=158, carry_clearance_yd=150),
        [profile("7 Iron", total=162, dispersion=8, samples=35, reviewed=False)],
    )

    assert result.status == "blocked"
    assert result.club is None
    assert result.confidence == "blocked"
    assert result.rationale == "Carry profile required for the requested clearance; no eligible carry profile exists."


def test_carry_clearance_filters_short_carry_and_keeps_alternative():
    result = recommend(
        CaddyContext(target_yd=150, carry_clearance_yd=148),
        [
            profile("8 Iron", carry=146, total=151, samples=40),
            profile("7 Iron", carry=154, total=162, samples=40),
            profile("6 Iron", carry=166, total=174, samples=40),
        ],
    )

    assert result.club == "7 Iron"
    assert result.alternative_club == "6 Iron"
    assert result.status == "ready"
    assert result.distance_basis == "carry"
    assert result.confidence == "personalized"


def test_no_profiles_returns_blocked_result():
    result = recommend(CaddyContext(target_yd=158), [])

    assert result.status == "blocked"
    assert result.club is None
    assert result.alternative_club is None
    assert result.confidence == "blocked"


@pytest.mark.parametrize(
    ("mode", "expected_club"),
    [
        ("safe", "7 Iron"),
        ("standard", "7 Iron"),
        ("aggressive", "8 Iron"),
    ],
)
def test_each_mode_is_deterministic(mode, expected_club):
    profiles = [
        profile("8 Iron", carry=145, dispersion=0),
        profile("7 Iron", carry=155, dispersion=0),
    ]

    results = [
        recommend(CaddyContext(target_yd=150, mode=mode), profiles)
        for _ in range(3)
    ]

    assert [result.club for result in results] == [expected_club] * 3


def test_unhashable_mode_raises_value_error():
    with pytest.raises(ValueError):
        recommend(CaddyContext(target_yd=150, mode=[]), [])


def test_negative_carry_clearance_raises_value_error():
    with pytest.raises(ValueError):
        recommend(CaddyContext(target_yd=150, carry_clearance_yd=-1), [])


def test_negative_adjusted_plays_like_distance_raises_value_error():
    with pytest.raises(ValueError):
        recommend(
            CaddyContext(target_yd=10, wind_adjustment_yd=-11),
            [profile("Wedge", carry=10)],
        )


@pytest.mark.parametrize(
    "invalid_profile",
    [
        profile("NaN carry", carry=math.nan),
        profile("NaN total", total=math.nan),
        profile("NaN dispersion", carry=150, dispersion=math.nan),
    ],
)
def test_nan_profiles_are_ignored_and_blocked(invalid_profile):
    result = recommend(CaddyContext(target_yd=150), [invalid_profile])

    assert result.status == "blocked"
    assert result.club is None
    assert result.rationale == "No club profile is available for this distance."


@pytest.mark.parametrize(
    "invalid_profile",
    [
        profile("negative carry", carry=-1),
        profile("zero total", total=0),
        profile("infinite dispersion", carry=150, dispersion=math.inf),
        profile("negative samples", carry=150, samples=-1),
        profile("fractional samples", carry=150, samples=20.5),
        profile("missing dispersion", carry=150, dispersion=None),
    ],
)
def test_invalid_profiles_are_ignored_and_blocked(invalid_profile):
    result = recommend(CaddyContext(target_yd=150), [invalid_profile])

    assert result.status == "blocked"
    assert result.club is None


def test_duplicate_valid_club_names_raise_value_error():
    with pytest.raises(ValueError):
        recommend(
            CaddyContext(target_yd=150),
            [
                profile("7 Iron", carry=150),
                profile("7 Iron", carry=155),
            ],
        )


def test_formatter_escapes_control_characters():
    result = recommend(
        CaddyContext(target_yd=150, preferred_miss="short\nleft"),
        [profile("7\nIron", carry=150)],
    )

    formatted = format_recommendation(result)

    assert "club 7\\nIron" in formatted
    assert "preferred miss short\\nleft" in formatted
    assert "club 7\nIron" not in formatted


def test_formatter_rejects_non_finite_numeric_fields():
    recommendation = Recommendation(
        status="ready",
        mode="standard",
        club="7 Iron",
        alternative_club=None,
        plays_like_yd=math.inf,
        carry_yd=150,
        total_yd=160,
        dispersion_yd=8,
        distance_basis="carry",
        confidence="personalized",
        preferred_miss=None,
        rationale="Selected the closest carry profile.",
        assumptions=(),
    )

    with pytest.raises(ValueError):
        format_recommendation(recommendation)


def test_caddy_cli_exposes_total_basis(capsys, tmp_path):
    db_path = tmp_path / "cli.db"
    cli_con = db.connect(db_path)
    db.upsert_round(
        cli_con,
        {
            "source": "test",
            "source_id": "caddy-cli",
            "played_at": "2026-08-22",
            "holes": [
                {
                    "number": 1,
                    "par": 4,
                    "strokes": 4,
                    "putts": 2,
                    "shots": [
                        {"seq": 1, "club": "7 Iron", "distance_m": 148 * 0.9144, "lie": "fairway"},
                        {"seq": 2, "club": "8 Iron", "distance_m": 136 * 0.9144, "lie": "fairway"},
                    ],
                }
            ],
        },
    )
    cli_con.close()

    code = main(["--db", str(db_path), "caddy", "--target", "145"])
    output = capsys.readouterr().out

    assert code == 0
    assert "basis total_gps" in output
    assert "basis carry" not in output
    assert "carry unavailable" in output


def test_caddy_cli_blocks_total_profiles_with_carry_clearance(capsys, tmp_path):
    db_path = tmp_path / "blocked.db"
    cli_con = db.connect(db_path)
    db.upsert_round(
        cli_con,
        {
            "source": "test",
            "source_id": "caddy-cli-blocked",
            "played_at": "2026-08-22",
            "holes": [
                {
                    "number": 1,
                    "par": 4,
                    "strokes": 4,
                    "putts": 2,
                    "shots": [
                        {"seq": 1, "club": "7 Iron", "distance_m": 148 * 0.9144, "lie": "fairway"},
                    ],
                }
            ],
        },
    )
    cli_con.close()

    code = main(
        [
            "--db",
            str(db_path),
            "caddy",
            "--target",
            "145",
            "--carry-clearance",
            "140",
        ]
    )
    output = capsys.readouterr().out

    assert code == 2
    assert "status blocked" in output
    assert "carry profile required" in output.lower()
