"""Generate the Shot Atlas: an HTML page of shot traces over OSM course
geometry, colored by per-shot strokes gained.

Output is a self-contained fragment (title + styles + markup + a little JS)
suitable both for opening locally and for publishing as an artifact. Colors
follow the project's validated diverging ramp (two one-hue ordinal arms
around a neutral midpoint; each arm validator-passed in both themes).
"""

from __future__ import annotations

import html
import json
import math
import sqlite3
from pathlib import Path

from . import sg as sg_mod
from .course import slug

M_PER_YD = 0.9144
TERRAIN = ("water_hazard", "fairway", "green", "bunker", "tee")

BINS = (  # (upper bound on sg, css class); read top-down
    (-0.75, "b0"), (-0.25, "b1"), (0.25, "b2"), (0.75, "b3"), (float("inf"), "b4"),
)


def _bin(sg_value: float) -> str:
    for bound, cls in BINS:
        if sg_value < bound or bound == float("inf"):
            return cls
    return "b2"


class _Proj:
    def __init__(self, lats, lons, margin_m: float = 120.0, width: float = 920.0):
        lat0 = sum(lats) / len(lats)
        self.lon0, self.lat0 = sum(lons) / len(lons), lat0
        self.mx = 111_320.0 * math.cos(math.radians(lat0))
        self.my = 110_540.0
        xs = [(lo - self.lon0) * self.mx for lo in lons]
        ys = [-(la - self.lat0) * self.my for la in lats]
        self.x0, self.y0 = min(xs) - margin_m, min(ys) - margin_m
        w = (max(xs) - self.x0) + margin_m
        h = (max(ys) - self.y0) + margin_m
        self.s = width / w
        self.width, self.height = width, max(280.0, min(1600.0, h * self.s))

    def xy(self, lat: float, lon: float) -> tuple[float, float]:
        x = ((lon - self.lon0) * self.mx - self.x0) * self.s
        y = (-(lat - self.lat0) * self.my - self.y0) * self.s
        return round(x, 1), round(y, 1)


def _terrain_paths(features: dict, proj: _Proj) -> str:
    out = []
    for kind in TERRAIN:
        for poly in features.get("polygons", []):
            if poly["kind"] != kind:
                continue
            pts = [proj.xy(la, lo) for la, lo in poly["points"]]
            d = "M" + "L".join(f"{x},{y}" for x, y in pts) + "Z"
            out.append(f'<path class="t-{kind}" d="{d}"/>')
    return "".join(out)


def _load_features(data_dir: Path, course: str) -> dict:
    p = data_dir / "osm" / f"{slug(course)}.json"
    if p.exists():
        return json.loads(p.read_text())
    return {"polygons": [], "lines": []}


def build_html(con: sqlite3.Connection, data_dir: Path) -> str:
    rounds = con.execute(
        "SELECT id, played_at, course FROM rounds"
        " WHERE EXISTS (SELECT 1 FROM shots s WHERE s.round_id = rounds.id AND s.lat IS NOT NULL)"
        " ORDER BY played_at"
    ).fetchall()

    try:
        benchmark = sg_mod.load_baseline()
        sg_status = "Strokes gained vs " + benchmark["name"]
    except sg_mod.BaselineUnavailable as exc:
        benchmark = None
        sg_status = f"SG unavailable: {exc}"

    sg_lookup: dict[tuple[int, int, int], object] = {}
    season: list = []
    for rnd in rounds if benchmark is not None else []:
        shots_sg, _ = sg_mod.round_shot_sg(con, rnd["id"])
        season.extend(shots_sg)
        for s in shots_sg:
            sg_lookup[(s.round_id, s.hole, s.seq)] = s

    cats = sg_mod.by_category(season) if season else {c: 0.0 for c in sg_mod.CATEGORIES}
    n = max(1, len(rounds))

    by_course: dict[str, list] = {}
    for rnd in rounds:
        by_course.setdefault(rnd["course"] or "Unknown course", []).append(rnd)

    chips = ['<button class="chip on" data-rd="all">All rounds</button>']
    for i, rnd in enumerate(rounds):
        label = html.escape(f"{rnd['played_at'][5:]} {(rnd['course'] or '?').split(' - ')[0]}")
        chips.append(f'<button class="chip on" data-rd="rd{i}">{label}</button>')
    rd_index = {rnd["id"]: f"rd{i}" for i, rnd in enumerate(rounds)}

    # per-(round, hole) strokes-gained sums for the hole-zoom captions
    hole_sg: dict[tuple[int, int], float] = {}
    for s in season:
        hole_sg[(s.round_id, s.hole)] = hole_sg.get((s.round_id, s.hole), 0.0) + s.sg

    sections = []
    for sec_i, (course, course_rounds) in enumerate(by_course.items()):
        features = _load_features(data_dir, course)
        round_ids = ",".join(str(r["id"]) for r in course_rounds)
        rows = con.execute(
            "SELECT * FROM shots WHERE round_id IN (%s) AND lat IS NOT NULL" % round_ids
        ).fetchall()
        hole_rows = con.execute(
            "SELECT * FROM holes WHERE round_id IN (%s)" % round_ids
        ).fetchall()
        lats = [r["lat"] for r in rows] + [r["end_lat"] for r in rows if r["end_lat"]]
        lons = [r["lon"] for r in rows] + [r["end_lon"] for r in rows if r["end_lon"]]
        if not lats:
            continue
        proj = _Proj(lats, lons)
        hole_pts: dict[int, list[tuple[float, float]]] = {}
        for h in hole_rows:  # pins anchor each hole's zoom box even with few shots
            if h["pin_lat"] is not None:
                hole_pts.setdefault(h["number"], []).append(proj.xy(h["pin_lat"], h["pin_lon"]))
        marks = []
        for r in rows:
            s = sg_lookup.get((r["round_id"], r["hole"], r["seq"]))
            cls = _bin(s.sg) if s else "unavailable"
            rd_cls = rd_index[r["round_id"]]
            date = next(x["played_at"] for x in course_rounds if x["id"] == r["round_id"])
            yd = f"{(r['distance_m'] or 0) / M_PER_YD:.0f}"
            sg_txt = f"{s.sg:+.2f}" if s else "n/a"
            pen = " · penalty" if (r["lost_ball"] or r["water_hazard"]) else ""
            tip = html.escape(
                f"{date} · Hole {r['hole']}, shot {r['seq']} · {r['club'] or '?'}"
                f" · {yd} yd · SG {sg_txt}{pen}", quote=True)
            x1, y1 = proj.xy(r["lat"], r["lon"])
            hole_pts.setdefault(r["hole"], []).append((x1, y1))
            if r["lie"] == "green" or r["end_lat"] is None:
                marks.append(
                    f'<circle class="sh {cls} {rd_cls}" cx="{x1}" cy="{y1}" r="2.6"'
                    f' data-r="2.6" data-tip="{tip}"/>')
                continue
            x2, y2 = proj.xy(r["end_lat"], r["end_lon"])
            hole_pts[r["hole"]].append((x2, y2))
            dash = ' stroke-dasharray="5 4"' if pen else ""
            ve = ' vector-effect="non-scaling-stroke"'
            marks.append(
                f'<g class="shg {rd_cls}" data-tip="{tip}">'
                f'<line class="hit" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"{ve}/>'
                f'<line class="sh {cls}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"{dash}{ve}/>'
                f'<circle class="sh {cls}" cx="{x2}" cy="{y2}" r="3" data-r="3"/></g>')
        # hole-zoom data: bbox per hole (30 m margin, in viewBox units) + caption
        pars: dict[int, int] = {}
        scores: dict[int, list[str]] = {}
        for h in sorted(hole_rows, key=lambda x: x["number"]):
            if h["par"] is not None:
                pars.setdefault(h["number"], h["par"])
            date = next(x["played_at"] for x in course_rounds if x["id"] == h["round_id"])
            if h["strokes"] is not None and h["par"] is not None:
                diff = h["strokes"] - h["par"]
                vs = "E" if diff == 0 else f"{diff:+d}"
                sg_h = hole_sg.get((h["round_id"], h["number"]))
                sg_txt = f", SG {sg_h:+.2f}" if sg_h is not None else ""
                scores.setdefault(h["number"], []).append(f"{date[5:]}: {h['strokes']} ({vs}){sg_txt}")
        m = 30.0 * proj.s
        holes_json = {}
        for num, pts in sorted(hole_pts.items()):
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            vb = [round(min(xs) - m, 1), round(min(ys) - m, 1),
                  round(max(xs) - min(xs) + 2 * m, 1), round(max(ys) - min(ys) + 2 * m, 1)]
            par_txt = f"par {pars[num]} · " if num in pars else ""
            holes_json[str(num)] = {
                "vb": vb,
                "cap": f"Hole {num} — {par_txt}" + " · ".join(scores.get(num, [])),
            }
        hchips = ['<button class="chip hchip on" data-h="all">Full course</button>'] + [
            f'<button class="chip hchip" data-h="{n}">{n}</button>' for n in sorted(hole_pts)
        ]
        mapped = "mapped" if features["polygons"] else "no OSM geometry cached — shots on blank ground"
        sections.append(f"""
<section>
  <h2>{html.escape(course)}</h2>
  <p class="coursenote">{len(course_rounds)} round(s) · {len(rows)} shots · {mapped}</p>
  <div class="chips holechips">{"".join(hchips)}</div>
  <p class="holecap" hidden></p>
  <div class="map-wrap"><svg viewBox="0 0 {proj.width:.0f} {proj.height:.0f}"
       width="100%" role="img" aria-label="Shot map of {html.escape(course, quote=True)}">
    <rect class="ground" x="0" y="0" width="{proj.width:.0f}" height="{proj.height:.0f}"/>
    {_terrain_paths(features, proj)}{"".join(marks)}
  </svg></div>
  <script type="application/json" class="holedata">{json.dumps(holes_json)}</script>
</section>""")

    dates = [r["played_at"] for r in rounds]
    tiles = "".join(
        f'<div class="tile"><div class="tlabel">{label}</div>'
        f'<div class="tval">{format(cats[key] / n, "+.2f") if season else "n/a"}</div><div class="tsub">per round</div></div>'
        for key, label in (("tee", "SG Tee"), ("approach", "SG Approach"),
                           ("short", "SG Short game"), ("putt", "SG Putting"))
    )

    legend_sg = "".join(
        f'<span class="lg"><i class="sw {cls}"></i>{lab}</span>'
        for cls, lab in (("b0", "≤ −0.75"), ("b1", "−0.75 … −0.25"), ("b2", "± 0.25"),
                         ("b3", "+0.25 … +0.75"), ("b4", "≥ +0.75")))
    if not season:
        legend_sg = ""
    legend_t = "".join(
        f'<span class="lg"><i class="sw t {k}"></i>{k.replace("_", " ")}</span>'
        for k in ("fairway", "green", "bunker", "water_hazard", "tee"))

    return f"""<title>OpenRound Shot Atlas</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root {{
  --page:#f7f8f5; --surface:#fcfdfb; --ink:#141a15; --ink2:#4e564f; --muted:#8a8f88;
  --hair:#e2e5de; --ground:#f2f4ee;
  --b0:#9c211f; --b1:#c33a38; --b2:#8a8880; --b3:#256abf; --b4:#0d366b;
  --t-fairway:#e0e8d5; --t-green:#cfe0c2; --t-bunker:#efe4c8; --t-water:#d3e4ee; --t-tee:#dde3d9;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --page:#101210; --surface:#171a17; --ink:#f2f4f0; --ink2:#b7bdb4; --muted:#838881;
    --hair:#262a26; --ground:#1b1e1b;
    --b0:#e66767; --b1:#b04846; --b2:#56544f; --b3:#2f7ad0; --b4:#6da7ec;
    --t-fairway:#222a1e; --t-green:#273420; --t-bunker:#363019; --t-water:#1c2b36; --t-tee:#262c26;
  }}
}}
:root[data-theme="dark"] {{
  --page:#101210; --surface:#171a17; --ink:#f2f4f0; --ink2:#b7bdb4; --muted:#838881;
  --hair:#262a26; --ground:#1b1e1b;
  --b0:#e66767; --b1:#b04846; --b2:#56544f; --b3:#2f7ad0; --b4:#6da7ec;
  --t-fairway:#222a1e; --t-green:#273420; --t-bunker:#363019; --t-water:#1c2b36; --t-tee:#262c26;
}}
body {{ background:var(--page); color:var(--ink); margin:0;
  font:16px/1.55 "IBM Plex Sans", system-ui, -apple-system, sans-serif; }}
main {{ max-width:980px; margin:0 auto; padding:32px 20px 72px; }}
.eyebrow {{ font:500 12px/1 "IBM Plex Mono", ui-monospace, monospace; letter-spacing:.14em;
  color:var(--muted); text-transform:uppercase; }}
h1 {{ font-size:34px; font-weight:700; margin:6px 0 2px; text-wrap:balance; }}
h2 {{ font-size:20px; font-weight:600; margin:40px 0 2px; }}
.sub, .coursenote {{ color:var(--ink2); margin:0 0 8px; font-size:14px; }}
.tiles {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:22px 0; }}
.tile {{ background:var(--surface); border:1px solid var(--hair); border-radius:6px; padding:12px 14px; }}
.tlabel {{ font-size:12px; color:var(--ink2); }}
.tval {{ font-size:26px; font-weight:700; font-variant-numeric:tabular-nums; }}
.tsub {{ font-size:11px; color:var(--muted); }}
.note {{ font-size:12px; color:var(--muted); margin:-12px 0 18px; }}
.chips {{ display:flex; flex-wrap:wrap; gap:8px; margin:0 0 6px; }}
.chip {{ font:500 13px/1 "IBM Plex Sans",sans-serif; color:var(--ink2); background:var(--surface);
  border:1px solid var(--hair); border-radius:999px; padding:7px 12px; cursor:pointer; }}
.chip.on {{ color:var(--ink); border-color:var(--ink2); }}
.chip:focus-visible {{ outline:2px solid var(--b3); outline-offset:2px; }}
.holechips {{ margin-top:10px; }}
.hchip {{ padding:6px 10px; min-width:34px; }}
.holecap {{ font-size:13.5px; color:var(--ink2); margin:8px 0; font-variant-numeric:tabular-nums; }}
.map-wrap {{ background:var(--surface); border:1px solid var(--hair); border-radius:8px;
  overflow-x:auto; }}
svg {{ display:block; }}
.ground {{ fill:var(--ground); }}
path[class^="t-"] {{ stroke:var(--hair); stroke-width:.6; }}
.t-fairway {{ fill:var(--t-fairway); }} .t-green {{ fill:var(--t-green); }}
.t-bunker {{ fill:var(--t-bunker); }} .t-water_hazard {{ fill:var(--t-water); }}
.t-tee {{ fill:var(--t-tee); }}
line.sh {{ stroke-width:2.2; stroke-linecap:round; fill:none; pointer-events:none; }}
line.hit {{ stroke:#000; stroke-opacity:0; stroke-width:11; stroke-linecap:round; }}
circle.sh {{ stroke:var(--surface); stroke-width:1; }}
.b0 {{ stroke:var(--b0); fill:var(--b0); }} .b1 {{ stroke:var(--b1); fill:var(--b1); }}
.b2 {{ stroke:var(--b2); fill:var(--b2); }} .b3 {{ stroke:var(--b3); fill:var(--b3); }}
.unavailable {{ stroke:var(--b2); fill:var(--b2); }}
.b4 {{ stroke:var(--b4); fill:var(--b4); }}
line.b0 {{ fill:none; }} line.b1 {{ fill:none; }} line.b2 {{ fill:none; }}
line.b3 {{ fill:none; }} line.b4 {{ fill:none; }}
.hidden {{ display:none; }}
.legend {{ display:flex; flex-wrap:wrap; gap:14px; align-items:center; margin:14px 0 4px; }}
.lg {{ display:inline-flex; align-items:center; gap:6px; font-size:12.5px; color:var(--ink2); }}
.sw {{ width:14px; height:14px; border-radius:3px; display:inline-block; }}
.sw.b0 {{ background:var(--b0); }} .sw.b1 {{ background:var(--b1); }} .sw.b2 {{ background:var(--b2); }}
.sw.b3 {{ background:var(--b3); }} .sw.b4 {{ background:var(--b4); }}
.sw.t.fairway {{ background:var(--t-fairway); border:1px solid var(--hair); }}
.sw.t.green {{ background:var(--t-green); border:1px solid var(--hair); }}
.sw.t.bunker {{ background:var(--t-bunker); border:1px solid var(--hair); }}
.sw.t.water_hazard {{ background:var(--t-water); border:1px solid var(--hair); }}
.sw.t.tee {{ background:var(--t-tee); border:1px solid var(--hair); }}
#tip {{ position:fixed; z-index:9; background:var(--ink); color:var(--page); font-size:12.5px;
  padding:6px 9px; border-radius:5px; pointer-events:none; display:none; max-width:320px; }}
footer {{ color:var(--muted); font-size:12px; margin-top:44px; }}
</style>
<main>
  <div class="eyebrow">OpenRound</div>
  <h1>Shot Atlas</h1>
  <p class="sub">{len(rounds)} rounds · {dates[0] if dates else ""} → {dates[-1] if dates else ""} ·
    every shot over OpenStreetMap course geometry. {html.escape(sg_status)}</p>
  <div class="tiles">{tiles}</div>
  <p class="note">Season averages across all {len(rounds)} rounds (partials included), when SG data is available. Implausible putt distances are excluded.</p>
  <div class="eyebrow">Rounds</div>
  <div class="chips">{"".join(chips)}</div>
  <div class="legend">{legend_sg}<span class="lg" style="margin-left:8px">strokes gained / shot</span></div>
  <div class="legend">{legend_t}</div>
  {"".join(sections)}
  <footer>Generated by openround · distances are GPS totals · dashed = penalty shot ·
    dots without lines are putts and lost balls</footer>
</main>
<div id="tip" role="status"></div>
<script>
const tip = document.getElementById("tip");
document.querySelectorAll("[data-tip]").forEach(el => {{
  el.addEventListener("mousemove", e => {{
    tip.textContent = el.dataset.tip;
    tip.style.display = "block";
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 330) + "px";
    tip.style.top = (e.clientY + 14) + "px";
  }});
  el.addEventListener("mouseleave", () => tip.style.display = "none");
}});
const chips = [...document.querySelectorAll(".chip[data-rd]")];
function apply() {{
  const on = new Set(chips.filter(c => c.classList.contains("on")).map(c => c.dataset.rd));
  document.querySelectorAll(".shg, circle.sh").forEach(el => {{
    const rd = [...el.classList].find(c => c.startsWith("rd"));
    if (!rd) return;
    el.classList.toggle("hidden", !(on.has("all") || on.has(rd)));
  }});
}}
chips.forEach(c => c.addEventListener("click", () => {{
  if (c.dataset.rd === "all") {{
    const turnOn = !c.classList.contains("on");
    chips.forEach(x => x.classList.toggle("on", turnOn));
  }} else {{
    c.classList.toggle("on");
    chips.find(x => x.dataset.rd === "all").classList.remove("on");
  }}
  apply();
}}));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
document.querySelectorAll("section").forEach(sec => {{
  const svg = sec.querySelector("svg");
  const dataEl = sec.querySelector(".holedata");
  if (!svg || !dataEl) return;
  const holes = JSON.parse(dataEl.textContent);
  const full = svg.getAttribute("viewBox").split(" ").map(Number);
  const cap = sec.querySelector(".holecap");
  const circles = [...svg.querySelectorAll("circle[data-r]")];
  let anim;
  function setVB(vb) {{
    svg.setAttribute("viewBox", vb.map(v => v.toFixed(1)).join(" "));
    const k = Math.max(vb[2] / full[2], vb[3] / full[3]);
    circles.forEach(c => c.setAttribute("r", (parseFloat(c.dataset.r) * Math.max(k, 0.12)).toFixed(2)));
  }}
  function go(to) {{
    if (reduceMotion) return setVB(to);
    cancelAnimationFrame(anim);
    const from = svg.getAttribute("viewBox").split(" ").map(Number);
    const t0 = performance.now();
    function step(t) {{
      const p = Math.min(1, (t - t0) / 260), e = 1 - (1 - p) * (1 - p);
      setVB(from.map((v, i) => v + (to[i] - v) * e));
      if (p < 1) anim = requestAnimationFrame(step);
    }}
    anim = requestAnimationFrame(step);
  }}
  sec.querySelectorAll(".hchip").forEach(ch => ch.addEventListener("click", () => {{
    sec.querySelectorAll(".hchip").forEach(x => x.classList.toggle("on", x === ch));
    if (ch.dataset.h === "all") {{ go(full); cap.hidden = true; }}
    else {{
      const h = holes[ch.dataset.h];
      go(h.vb); cap.textContent = h.cap; cap.hidden = false;
    }}
  }}));
}});
</script>
"""


def write_shotmap(con: sqlite3.Connection, data_dir: Path, out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build_html(con, data_dir), encoding="utf-8")
    return out
