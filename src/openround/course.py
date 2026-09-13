"""OpenStreetMap golf-course geometry: fetch, cache, grade, classify.

OSM maps golf features as closed ways tagged golf=fairway/green/bunker/tee/
water_hazard inside leisure=golf_course. Coverage varies per course, so every
course gets a completeness grade and the app degrades gracefully (worldwide
only about half of greens are micromapped). Multipolygon relations are rare
for golf features and are skipped in v0 — noted in the grade output.

Data flows: shots in the DB give each course a bounding box; one Overpass
query per course is cached in data/osm/ forever (re-fetch by deleting the
file after a mapping session).
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

import requests

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
GOLF_TAGS = ("fairway", "green", "bunker", "tee", "rough", "water_hazard", "hole", "pin")
# classification priority: most specific first
_PRIORITY = ("green", "tee", "bunker", "water_hazard", "fairway", "rough")


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (name or "unknown").lower()).strip("-")


def course_bbox(con: sqlite3.Connection, course: str, margin_deg: float = 0.003):
    row = con.execute(
        "SELECT MIN(s.lat) a, MAX(s.lat) b, MIN(s.lon) c, MAX(s.lon) d"
        " FROM shots s JOIN rounds r ON r.id = s.round_id"
        " WHERE r.course = ? AND s.lat IS NOT NULL",
        (course,),
    ).fetchone()
    if row["a"] is None:
        return None
    return (row["a"] - margin_deg, row["c"] - margin_deg,
            row["b"] + margin_deg, row["d"] + margin_deg)  # south, west, north, east


def fetch_features(bbox, cache_path: Path, session: requests.Session | None = None) -> dict:
    """Fetch golf-tagged ways in the bbox via Overpass; cache as JSON."""
    if cache_path.exists():
        return json.loads(cache_path.read_text())
    s, w, n, e = bbox
    query = f"""[out:json][timeout:60];
(
  way["golf"]({s},{w},{n},{e});
  way["leisure"="golf_course"]({s},{w},{n},{e});
);
out geom;"""
    sess = session or requests.Session()
    r = sess.post(OVERPASS_URL, data={"data": query},
                  headers={"User-Agent": "openround/0.1 (personal golf stats)"}, timeout=90)
    r.raise_for_status()
    features = {"bbox": bbox, "polygons": [], "lines": []}
    for el in r.json().get("elements", []):
        tags = el.get("tags", {})
        kind = tags.get("golf") or ("course" if tags.get("leisure") == "golf_course" else None)
        geom = [(p["lat"], p["lon"]) for p in el.get("geometry", [])]
        if not kind or len(geom) < 2:
            continue
        closed = geom[0] == geom[-1] and len(geom) >= 4
        entry = {"kind": kind, "points": geom, "ref": tags.get("ref"), "par": tags.get("par")}
        (features["polygons"] if closed else features["lines"]).append(entry)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(features))
    return features


def grade(features: dict) -> dict:
    counts: dict[str, int] = {}
    for p in features["polygons"]:
        counts[p["kind"]] = counts.get(p["kind"], 0) + 1
    for line in features["lines"]:
        if line["kind"] == "hole":
            counts["hole"] = counts.get("hole", 0) + 1
    greens, fairways = counts.get("green", 0), counts.get("fairway", 0)
    if greens >= 9 and fairways >= 9:
        verdict = "well-mapped"
    elif greens or fairways:
        verdict = "partial"
    else:
        verdict = "unmapped"
    return {"counts": counts, "verdict": verdict}


def point_in_polygon(lat: float, lon: float, points: list) -> bool:
    """Even-odd ray casting; fine at golf-course scale."""
    inside = False
    n = len(points)
    for i in range(n):
        y1, x1 = points[i]
        y2, x2 = points[(i + 1) % n]
        if (y1 > lat) != (y2 > lat):
            x_cross = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lon < x_cross:
                inside = not inside
    return inside


def classify_point(lat: float, lon: float, features: dict) -> str | None:
    """Most specific golf feature containing the point, or None."""
    hit: dict[str, bool] = {}
    for p in features["polygons"]:
        if p["kind"] in _PRIORITY and p["kind"] not in hit:
            if point_in_polygon(lat, lon, p["points"]):
                hit[p["kind"]] = True
    for kind in _PRIORITY:
        if hit.get(kind):
            return kind
    return None


def fairway_crosscheck(con: sqlite3.Connection, course: str, features: dict,
                       unmapped_is_rough: bool = False) -> dict:
    """Compare vendor fairway-hit flags with OSM containment of tee-shot end points.

    On a well-mapped course, pass unmapped_is_rough=True: rough is usually not
    drawn as polygons, so "in no polygon" IS the miss signal, not missing data.
    """
    rows = con.execute(
        "SELECT h.fairway AS vendor, s.end_lat, s.end_lon"
        " FROM holes h"
        " JOIN rounds r ON r.id = h.round_id"
        " JOIN shots s ON s.round_id = h.round_id AND s.hole = h.number AND s.seq = 1"
        " WHERE r.course = ? AND h.fairway IS NOT NULL"
        " AND s.end_lat IS NOT NULL AND s.lie = 'tee' AND h.par >= 4",
        (course,),
    ).fetchall()
    agree = disagree = unknown = 0
    for r in rows:
        osm = classify_point(r["end_lat"], r["end_lon"], features)
        if osm is None and not unmapped_is_rough:
            unknown += 1
        elif (osm == "fairway") == (r["vendor"] == "hit"):
            agree += 1
        else:
            disagree += 1
    return {"checked": len(rows), "agree": agree, "disagree": disagree, "outside_map": unknown}
