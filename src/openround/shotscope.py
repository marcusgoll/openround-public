"""Shot Scope dashboard client: login, fetch round history, normalize.

Runs entirely locally with your own credentials — nothing leaves your machine
except the login/API requests to dashboard.shotscope.com itself.

Endpoints (mapped from public reconnaissance, 2026-08; the dashboard is an
ASP.NET MVC app whose /api authorizes off the login session cookie):

  GET  /Account/Login          -> sets the __RequestVerificationToken cookie and
                                  emits the matching hidden form field (a pair —
                                  both must come from the same session)
  POST /Account/Login          -> form fields __RequestVerificationToken, Email,
                                  Password; success = auth cookie, failure = the
                                  form re-rendered with a validation summary
  GET  /api/Rounds/slim        -> {"rounds": [...], "usingYards": bool}; the
                                  round list (401 when not logged in — used as
                                  the login check)
  GET  /api/v2/rounds/{id}     -> per-hole structure with per-shot GPS; all
                                  distances in METERS

Field semantics (per prior art and Shot Scope's own docs): putts are the shots
whose lie is "Green"; a lost-ball flag implies a penalty stroke; per-shot
strokes gained is NOT in the API (dashboard computes it client-side), so we
recompute SG ourselves later from positions + lies.
"""

from __future__ import annotations

import math
import re
from html import unescape
from pathlib import Path
from typing import Any

import requests

BASE = "https://dashboard.shotscope.com"
_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) openround/0.1 (personal data export)"

_LIE_MAP = {
    "tee": "tee",
    "fairway": "fairway",
    "rough": "rough",
    "semi-rough": "rough",
    "bunker": "sand",
    "sand": "sand",
    "green": "green",
    "fringe": "rough",
    "hazard": "penalty",
    "penalty": "penalty",
}


class LoginError(RuntimeError):
    pass


class ShotScopeClient:
    def __init__(self, session: requests.Session | None = None):
        self.s = session or requests.Session()
        self.s.headers["User-Agent"] = _UA

    def login(self, email: str, password: str) -> None:
        r = self.s.get(f"{BASE}/Account/Login", timeout=30)
        r.raise_for_status()
        m = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', r.text)
        if not m:
            raise LoginError("login page did not contain the anti-forgery token — layout changed?")
        self.s.post(
            f"{BASE}/Account/Login",
            data={
                "__RequestVerificationToken": unescape(m.group(1)),
                "Email": email,
                "Password": password,
            },
            timeout=30,
            allow_redirects=True,
        )
        # The POST status alone is unreliable; the API's auth check is the truth.
        check = self.s.get(
            f"{BASE}/api/Rounds/slim", headers={"Accept": "application/json"}, timeout=30
        )
        if check.status_code == 401:
            raise LoginError("login rejected (check email/password)")
        check.raise_for_status()
        self._slim_cache = check.json()

    def rounds_slim(self) -> dict:
        if getattr(self, "_slim_cache", None) is not None:
            return self._slim_cache
        r = self.s.get(f"{BASE}/api/Rounds/slim", headers={"Accept": "application/json"}, timeout=30)
        r.raise_for_status()
        return r.json()

    def round_detail(self, round_id: int) -> dict:
        r = self.s.get(
            f"{BASE}/api/v2/rounds/{round_id}", headers={"Accept": "application/json"}, timeout=30
        )
        r.raise_for_status()
        return r.json()


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371000.0 * math.asin(math.sqrt(a))


def _norm_lie(raw: Any) -> str | None:
    if not raw:
        return None
    return _LIE_MAP.get(str(raw).strip().lower(), str(raw).strip().lower())


def _pin(hole: dict) -> tuple[float | None, float | None]:
    pin = hole.get("pin")
    if isinstance(pin, dict):
        return (
            pin.get("lat", pin.get("latitude")),
            pin.get("lng", pin.get("longitude")),
        )
    if isinstance(pin, (list, tuple)) and len(pin) == 2:
        return pin[0], pin[1]
    return None, None


def normalize_round(slim: dict, detail: dict) -> dict:
    """Convert one Shot Scope round (slim entry + v2 detail) to the normalized
    format in docs/data-format.md."""
    holes_raw = detail.get("holes") or []
    # Per-hole putt counts are trustworthy only when the putter tag was in use:
    # if NO shot in the whole round has a green lie, "0 green shots" means
    # untracked putts, not zero putts — leave them None so the vendor round
    # total backfills instead.
    putter_tracked = any(
        _norm_lie(s.get("lie")) == "green"
        for h in holes_raw
        for s in (h.get("shots") or [])
    )

    holes_out = []
    for hole in holes_raw:
        shots_raw = hole.get("shots") or []
        shots_out = []
        green_shots = 0
        penalties = 0
        for i, shot in enumerate(shots_raw, start=1):
            lie = _norm_lie(shot.get("lie"))
            if lie == "green":
                green_shots += 1
            lost = bool(shot.get("lostBall") or shot.get("lost"))
            water = bool(shot.get("waterHazard"))
            if lost or water:
                penalties += 1
            lat, lon = shot.get("startLat"), shot.get("startLng")
            end_lat, end_lon = shot.get("endLat"), shot.get("endLng")
            # prefer the vendor-computed distance (meters); fall back to haversine
            distance = shot.get("distance")
            if distance is None and None not in (lat, lon, end_lat, end_lon):
                distance = round(haversine_m(lat, lon, end_lat, end_lon), 1)
            club = shot.get("club")
            if isinstance(club, dict):  # real v2 shape: {name, type, tag, color}
                club = club.get("name") or club.get("tag")
            normalized_shot = {
                "seq": i,
                "club": club,
                "lat": lat,
                "lon": lon,
                "end_lat": end_lat,
                "end_lon": end_lon,
                "distance_m": distance,
                "distance_type": "total_gps",
                "lie": lie,
                "remaining_m": shot.get("remaining"),
                "positional": bool(shot.get("positional")),
                "lost_ball": lost,
                "water_hazard": water,
                "timestamp": shot.get("dateTime"),
            }
            if "source_event_id" in shot:
                normalized_shot["source_event_id"] = shot["source_event_id"]
            elif "sourceEventId" in shot:
                normalized_shot["source_event_id"] = shot["sourceEventId"]
            shots_out.append(normalized_shot)

        fir = hole.get("fairwayInRegulation")
        par = hole.get("par")
        pin_lat, pin_lon = _pin(hole)
        holes_out.append(
            {
                "number": hole.get("holeNum"),
                "par": par,
                "strokes": hole.get("score"),
                "putts": green_shots if (shots_raw and putter_tracked) else None,
                "fairway": (None if par is None or par < 4 or fir is None
                            else ("hit" if fir else "missed")),
                "gir": (None if hole.get("greenInRegulation") is None
                        else int(bool(hole.get("greenInRegulation")))),
                "penalties": penalties,
                "pin_lat": pin_lat,
                "pin_lon": pin_lon,
                "shots": shots_out,
            }
        )

    return {
        "source": "shotscope",
        "source_id": str(slim["roundID"]),
        "played_at": str(slim.get("startedDate") or "")[:10],
        "course": slim.get("courseName"),
        "tees": slim.get("tees"),
        "score": slim.get("totalShots"),
        "putts_total": slim.get("putts"),
        "holes": holes_out,
    }


def fetch_all(client: ShotScopeClient | None, raw_dir: Path, out_dir: Path,
              progress=print) -> list[dict]:
    """Fetch every Active round, dump raw + normalized JSON, return normalized.

    With client=None (offline mode), re-normalizes from the raw files already
    in raw_dir — used to rebuild after normalizer changes without logging in.
    """
    import json
    import time

    raw_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    if client is None:
        items = [(None, p) for p in sorted(raw_dir.glob("*.json"))]
        progress(f"offline: {len(items)} cached round(s) in {raw_dir}")
    else:
        slim = client.rounds_slim()
        rounds = [r for r in (slim.get("rounds") or []) if (r.get("state") or "Active") == "Active"]
        progress(f"{len(rounds)} active round(s) on Shot Scope")
        items = [(entry, raw_dir / f"{entry['roundID']}.json") for entry in rounds]

    normalized = []
    for entry, raw_path in items:
        if raw_path.exists():
            cached = json.loads(raw_path.read_text())
            entry, detail = cached.get("slim", entry), cached["detail"]
        else:
            detail = client.round_detail(entry["roundID"])
            raw_path.write_text(json.dumps({"slim": entry, "detail": detail}, indent=1))
            time.sleep(0.5)  # be polite to their server
        rnd = normalize_round(entry, detail)
        out_path = out_dir / f"{rnd['played_at']}-{rnd['source_id']}.json"
        out_path.write_text(json.dumps(rnd, indent=1))
        normalized.append(rnd)
        progress(f"  {rnd['played_at']}  {rnd.get('course', '?')} -> {out_path.name}")
    return normalized
