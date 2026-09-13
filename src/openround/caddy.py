import math
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal


Mode = Literal["safe", "standard", "aggressive"]
DistanceBasis = Literal["carry", "total_gps", "unknown"]
Status = Literal["ready", "blocked"]
Confidence = Literal["provisional", "low", "personalized", "blocked"]


_MODE_WEIGHTS: Mapping[Mode, tuple[float, float, float]] = MappingProxyType(
    {
        "safe": (2.0, 1.0, 1.0),
        "standard": (1.0, 1.0, 0.5),
        "aggressive": (0.75, 1.25, 0.25),
    }
)


@dataclass(frozen=True, slots=True)
class ClubProfile:
    club: str
    carry_yd: float | None = None
    total_yd: float | None = None
    dispersion_yd: float | None = None
    sample_count: int = 0
    reviewed: bool = False


@dataclass(frozen=True, slots=True)
class CaddyContext:
    target_yd: float
    wind_adjustment_yd: float = 0.0
    elevation_adjustment_yd: float = 0.0
    mode: Mode = "standard"
    carry_clearance_yd: float | None = None
    preferred_miss: str | None = None


@dataclass(frozen=True, slots=True)
class Recommendation:
    status: Status
    mode: Mode
    club: str | None
    alternative_club: str | None
    plays_like_yd: float
    carry_yd: float | None
    total_yd: float | None
    dispersion_yd: float | None
    distance_basis: DistanceBasis
    confidence: Confidence
    preferred_miss: str | None
    rationale: str
    assumptions: tuple[str, ...]


def recommend(context: CaddyContext, profiles: list[ClubProfile]) -> Recommendation:
    """Return a deterministic club recommendation for the supplied context."""

    _validate_context(context)
    plays_like_yd = round(
        context.target_yd
        + context.wind_adjustment_yd
        + context.elevation_adjustment_yd,
        1,
    )
    _require_finite(plays_like_yd, "plays_like_yd")
    if plays_like_yd <= 0:
        raise ValueError("plays_like_yd must be greater than zero")

    weights = _MODE_WEIGHTS[context.mode]
    candidates: list[tuple[float, float, str, ClubProfile, DistanceBasis]] = []

    valid_profiles = [profile for profile in profiles if _is_valid_profile(profile)]
    _reject_duplicate_club_names(valid_profiles)

    for profile in valid_profiles:
        if profile.carry_yd is not None:
            selection_yd = profile.carry_yd
            distance_basis: DistanceBasis = "carry"
        elif context.carry_clearance_yd is None and profile.total_yd is not None:
            selection_yd = profile.total_yd
            distance_basis = "total_gps"
        else:
            continue

        if (
            context.carry_clearance_yd is not None
            and profile.carry_yd < context.carry_clearance_yd
        ):
            continue

        undershoot = max(0.0, plays_like_yd - selection_yd)
        overshoot = max(0.0, selection_yd - plays_like_yd)
        score = (
            undershoot * weights[0]
            + overshoot * weights[1]
            + (profile.dispersion_yd or 0.0) * weights[2]
        )
        candidates.append(
            (
                score,
                abs(selection_yd - plays_like_yd),
                profile.club,
                profile,
                distance_basis,
            )
        )

    candidates.sort(key=lambda candidate: candidate[:3])

    if not candidates:
        if context.carry_clearance_yd is not None:
            rationale = (
                "Carry profile required for the requested clearance; "
                "no eligible carry profile exists."
            )
        else:
            rationale = "No club profile is available for this distance."
        return Recommendation(
            status="blocked",
            mode=context.mode,
            club=None,
            alternative_club=None,
            plays_like_yd=plays_like_yd,
            carry_yd=None,
            total_yd=None,
            dispersion_yd=None,
            distance_basis="unknown",
            confidence="blocked",
            preferred_miss=context.preferred_miss,
            rationale=rationale,
            assumptions=(),
        )

    selected = candidates[0][3]
    distance_basis = candidates[0][4]
    assumptions: list[str] = []
    if distance_basis == "total_gps":
        assumptions.append("carry profile unavailable; using GPS total")
    if not selected.reviewed:
        assumptions.append("profile samples are not yet marked reviewed")

    if distance_basis == "carry":
        rationale = "Selected the closest carry profile."
    else:
        rationale = "Selected the closest GPS-total profile; carry is unavailable."

    alternative_club = candidates[1][3].club if len(candidates) > 1 else None
    return Recommendation(
        status="ready",
        mode=context.mode,
        club=selected.club,
        alternative_club=alternative_club,
        plays_like_yd=plays_like_yd,
        carry_yd=selected.carry_yd,
        total_yd=selected.total_yd,
        dispersion_yd=selected.dispersion_yd,
        distance_basis=distance_basis,
        confidence=_confidence_for(selected),
        preferred_miss=context.preferred_miss,
        rationale=rationale,
        assumptions=tuple(assumptions),
    )


def format_recommendation(recommendation: Recommendation) -> str:
    """Format a recommendation as stable, line-oriented text."""

    lines = [
        f"status {recommendation.status}",
        f"mode {recommendation.mode}",
        f"plays-like {_format_yards(recommendation.plays_like_yd)} yd",
    ]
    if recommendation.club is not None:
        lines.append(f"club {_escape_text(recommendation.club)}")
    lines.append(f"basis {recommendation.distance_basis}")
    if recommendation.carry_yd is not None:
        lines.append(f"carry {_format_yards(recommendation.carry_yd)} yd")
    elif (
        recommendation.status == "ready"
        and recommendation.distance_basis == "total_gps"
    ):
        lines.append("carry unavailable")
    if recommendation.total_yd is not None:
        lines.append(f"total {_format_yards(recommendation.total_yd)} yd")
    if recommendation.dispersion_yd is not None:
        lines.append(
            f"dispersion ±{_format_yards(recommendation.dispersion_yd)} yd"
        )
    lines.append(f"confidence {recommendation.confidence}")
    if recommendation.alternative_club is not None:
        lines.append(f"alternative {_escape_text(recommendation.alternative_club)}")
    if recommendation.preferred_miss is not None:
        lines.append(f"preferred miss {_escape_text(recommendation.preferred_miss)}")
    lines.append(f"rationale {_escape_text(recommendation.rationale)}")
    lines.extend(
        f"assumption {_escape_text(assumption)}"
        for assumption in recommendation.assumptions
    )
    return "\n".join(lines)


def _confidence_for(profile: ClubProfile) -> Confidence:
    if not profile.reviewed or profile.sample_count < 10:
        return "provisional"
    if profile.sample_count <= 30:
        return "low"
    return "personalized"


def _format_yards(value: float) -> str:
    _require_finite(value, "yards")
    rounded = round(float(value), 1)
    if rounded == 0:
        rounded = 0.0
    if rounded.is_integer():
        return f"{rounded:.0f}"
    return f"{rounded:.1f}"


def _validate_context(context: CaddyContext) -> None:
    if not isinstance(context.mode, str) or context.mode not in _MODE_WEIGHTS:
        raise ValueError(f"unsupported mode: {context.mode!r}")
    _require_finite(context.target_yd, "target_yd")
    if context.target_yd <= 0:
        raise ValueError("target_yd must be greater than zero")
    _require_finite(context.wind_adjustment_yd, "wind_adjustment_yd")
    _require_finite(context.elevation_adjustment_yd, "elevation_adjustment_yd")
    if context.carry_clearance_yd is not None:
        _require_finite(context.carry_clearance_yd, "carry_clearance_yd")
        if context.carry_clearance_yd < 0:
            raise ValueError("carry_clearance_yd must be non-negative")


def _is_valid_profile(profile: ClubProfile) -> bool:
    if not isinstance(profile.club, str):
        return False
    if not _is_valid_distance(profile.carry_yd):
        return False
    if not _is_valid_distance(profile.total_yd):
        return False
    if (
        profile.dispersion_yd is None
        or not _is_finite(profile.dispersion_yd)
        or profile.dispersion_yd < 0
    ):
        return False
    if (
        isinstance(profile.sample_count, bool)
        or not isinstance(profile.sample_count, int)
        or profile.sample_count < 0
    ):
        return False
    return profile.carry_yd is not None or profile.total_yd is not None


def _is_valid_distance(value: float | None) -> bool:
    return value is None or (_is_finite(value) and value > 0)


def _reject_duplicate_club_names(profiles: list[ClubProfile]) -> None:
    names = [profile.club for profile in profiles]
    if len(names) != len(set(names)):
        raise ValueError("duplicate valid club names")


def _escape_text(value: str) -> str:
    escapes = {
        "\a": r"\a",
        "\b": r"\b",
        "\t": r"\t",
        "\n": r"\n",
        "\v": r"\v",
        "\f": r"\f",
        "\r": r"\r",
    }
    escaped: list[str] = []
    for character in value:
        if character in escapes:
            escaped.append(escapes[character])
        elif character.isprintable():
            escaped.append(character)
        else:
            codepoint = ord(character)
            if codepoint <= 0xFF:
                escaped.append(f"\\x{codepoint:02x}")
            elif codepoint <= 0xFFFF:
                escaped.append(f"\\u{codepoint:04x}")
            else:
                escaped.append(f"\\U{codepoint:08x}")
    return "".join(escaped)


def _is_finite(value: object) -> bool:
    try:
        return math.isfinite(value)
    except (TypeError, ValueError, OverflowError):
        return False


def _require_finite(value: float, name: str) -> None:
    try:
        finite = math.isfinite(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not finite:
        raise ValueError(f"{name} must be a finite number")
