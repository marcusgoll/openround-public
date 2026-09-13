"""CLI: uv run python -m openround <command>.

Commands:
  init-db                     create the database (idempotent)
  import PATH [PATH...]       import normalized round JSON files or directories
  stats                       print per-round stats and the baseline
  roadmap [--write]           diff (default) or apply the Obsidian roadmap update
  caddy [options]             deterministic local caddy recommendation
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import db, roadmap, stats as stats_mod


def _iter_json(paths: list[str]):
    for p in paths:
        path = Path(p)
        files = sorted(path.glob("*.json")) if path.is_dir() else [path]
        for f in files:
            yield f


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="openround")
    parser.add_argument("--db", default=str(db.DEFAULT_DB), help="database path")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init-db")

    p_import = sub.add_parser("import")
    p_import.add_argument("paths", nargs="+")

    sub.add_parser("stats")

    p_roadmap = sub.add_parser("roadmap")
    p_roadmap.add_argument("--path", default=str(roadmap.DEFAULT_ROADMAP))
    p_roadmap.add_argument("--write", action="store_true")

    sub.add_parser("sg", help="strokes gained per round (vs supplied benchmark), from raw shot positions")

    sub.add_parser("clubs", help="per-club distance distributions and gapping chart (GPS totals)")

    p_caddy = sub.add_parser("caddy", help="deterministic local caddy recommendation")
    p_caddy.add_argument("--target", type=float, required=True, help="base target distance in yards")
    p_caddy.add_argument("--wind", type=float, default=0.0, help="plays-like wind adjustment in yards")
    p_caddy.add_argument("--elevation", type=float, default=0.0, help="plays-like elevation adjustment in yards")
    p_caddy.add_argument("--mode", choices=("safe", "standard", "aggressive"), default="standard")
    p_caddy.add_argument(
        "--carry-clearance",
        type=float,
        default=None,
        help="required carry in yards; blocks total-only profiles",
    )

    sub.add_parser("courses", help="fetch + grade OSM geometry for played courses; cross-check FW flags")

    p_map = sub.add_parser("shotmap", help="generate the Shot Atlas HTML (shots over OSM, colored by SG)")
    p_map.add_argument("--out", default=None, help="output path (default <data>/shotmap.html)")

    p_ss = sub.add_parser("shotscope", help="log into dashboard.shotscope.com and export all rounds")
    p_ss.add_argument("--email", default=None, help="or set OPENROUND_SS_EMAIL")
    p_ss.add_argument("--out", default=None, help="normalized JSON dir (default <repo>/data/rounds)")
    p_ss.add_argument("--offline", action="store_true",
                      help="no login: rebuild from data/shotscope-raw and re-import")

    args = parser.parse_args(argv)
    con = db.connect(args.db)

    if args.cmd == "init-db":
        print(f"database ready: {args.db}")

    elif args.cmd == "import":
        try:
            imported = [(f, json.loads(f.read_text())) for f in _iter_json(args.paths)]
            round_ids = db.import_rounds(con, [rnd for _, rnd in imported])
        except (json.JSONDecodeError, UnicodeDecodeError, OSError, db.ImportValidationError) as exc:
            print(f"import failed: {exc}", file=sys.stderr)
            return 1
        for (f, rnd), rid in zip(imported, round_ids):
            print(f"imported {f.name} -> round {rid} ({rnd.get('played_at')} {rnd.get('course', '')})")
        print(f"{len(imported)} round(s) imported")

    elif args.cmd == "stats":
        all_stats = stats_mod.all_round_stats(con)
        if not all_stats:
            print("no rounds in the database yet")
            return 0
        for s in all_stats:
            putts = "?" if s.putts is None else s.putts
            print(
                f"{s.played_at}  {s.course or '?':<32} {s.score or '?':>3} ({s.score_vs_par:>3})"
                f"  FW {s.fw_hit}/{s.fw_opps}  GIR {s.gir}  Putts {putts}"
                f"  U&D {s.scramble_converted}/{s.scramble_attempts}"
                f"  Pen {s.penalties}  Dbl+ {s.doubles}"
            )
            for w in s.warnings:
                print(f"    ! {w}")
        base = stats_mod.baseline(all_stats)
        if base:
            cells = roadmap.baseline_cells(base)
            print(f"\nBaseline over {base.rounds} eighteen-hole round(s)"
                  + (f" ({base.excluded_nines} nine(s) excluded)" if base.excluded_nines else "") + ":")
            for k, v in cells.items():
                print(f"  {k:<18} {v}")

    elif args.cmd == "sg":
        from . import sg as sg_mod

        try:
            benchmark = sg_mod.load_baseline()
        except sg_mod.BaselineUnavailable as exc:
            print(f"SG unavailable: {exc}", file=sys.stderr)
            return 1

        rounds = con.execute(
            "SELECT id, played_at, course FROM rounds ORDER BY played_at"
        ).fetchall()
        season: list = []
        n_rounds = 0
        for rnd in rounds:
            shots, warnings = sg_mod.round_shot_sg(con, rnd["id"])
            if not shots:
                continue
            n_rounds += 1
            season.extend(shots)
            cats = sg_mod.by_category(shots)
            total = round(sum(cats.values()), 2)
            print(f"{rnd['played_at']}  {rnd['course'] or '?':<40}"
                  f" tee {cats['tee']:+.2f}  app {cats['approach']:+.2f}"
                  f"  short {cats['short']:+.2f}  putt {cats['putt']:+.2f}  | total {total:+.2f}")
            for w in warnings:
                print(f"    ! {w}")
        if not season:
            print("no shot-level data in the database")
            return 1
        cats = sg_mod.by_category(season)
        print(f"\nSeason totals over {n_rounds} round(s) vs {benchmark['name']}:")
        for c in sg_mod.CATEGORIES:
            print(f"  {c:<10} {cats[c]:+.2f}   ({cats[c] / n_rounds:+.2f}/round)")
        print("\nApproach SG by start distance:")
        for label, (n, v) in sg_mod.approach_buckets(season).items():
            per = f"  ({v / n:+.2f}/shot)" if n else ""
            print(f"  {label:<10} {n:>3} shots  {v:+.2f}{per}")
        print("\nSG by club (non-putts):")
        for club, (n, v) in sorted(sg_mod.by_club(season).items(), key=lambda kv: kv[1][1]):
            print(f"  {club:<12} {n:>3} shots  {v:+.2f}  ({v / n:+.2f}/shot)")

    elif args.cmd == "clubs":
        from . import gapping

        stats_list = gapping.all_club_stats(con)
        if not stats_list:
            print("no full-swing shot data in the database")
            return 1
        print("club            swings  P-AVG   median  sigma  longest   (yards, GPS total: carry+roll)")
        max_yd = max(s.pavg_yd for s in stats_list)
        for s in stats_list:
            bar = "#" * int(round(30 * s.pavg_yd / max_yd))
            note = "" if s.full_swings >= gapping.MIN_FULL_SWINGS else "  (small sample)"
            print(f"{s.club:<15} {s.full_swings:>3}/{s.total_shots:<3} {s.pavg_yd:>6.1f}"
                  f"  {s.median_yd:>6.1f}  {s.sigma_yd:>5.1f}  {s.longest_yd:>6.1f}  {bar}{note}")
        flags = gapping.gap_flags(stats_list)
        if flags:
            print("\nGapping flags:")
            for f in flags:
                what = "overlap — clubs do the same job" if f.kind == "overlap" else "chasm — no club covers this range"
                print(f"  {f.longer} -> {f.shorter}: {f.gap_yd:.0f} yd ({what})")

    elif args.cmd == "caddy":
        from . import caddy, gapping

        profiles = [
            caddy.ClubProfile(
                club=item.club,
                carry_yd=None,
                total_yd=item.pavg_yd,
                dispersion_yd=item.sigma_yd,
                sample_count=item.full_swings,
                reviewed=False,
            )
            for item in gapping.all_club_stats(con)
        ]
        context = caddy.CaddyContext(
            target_yd=args.target,
            wind_adjustment_yd=args.wind,
            elevation_adjustment_yd=args.elevation,
            mode=args.mode,
            carry_clearance_yd=args.carry_clearance,
        )
        result = caddy.recommend(context, profiles)
        print(caddy.format_recommendation(result))
        return 2 if result.status == "blocked" else 0

    elif args.cmd == "shotmap":
        from . import shotmap

        data_dir = Path(args.db).parent
        out = Path(args.out) if args.out else data_dir / "shotmap.html"
        shotmap.write_shotmap(con, data_dir, out)
        print(f"wrote {out}")

    elif args.cmd == "courses":
        from . import course as course_mod

        names = [r["course"] for r in con.execute(
            "SELECT DISTINCT course FROM rounds WHERE course IS NOT NULL ORDER BY course")]
        if not names:
            print("no courses in the database")
            return 1
        osm_dir = Path(args.db).parent / "osm"
        for name in names:
            bbox = course_mod.course_bbox(con, name)
            if bbox is None:
                print(f"{name}: no shot coordinates, skipped")
                continue
            cache = osm_dir / f"{course_mod.slug(name)}.json"
            try:
                features = course_mod.fetch_features(bbox, cache)
            except Exception as e:  # Overpass hiccups shouldn't kill the report
                print(f"{name}: OSM fetch failed ({e})")
                continue
            g = course_mod.grade(features)
            counts = ", ".join(f"{k}:{v}" for k, v in sorted(g["counts"].items())) or "nothing"
            print(f"{name}\n  OSM: {g['verdict']}  ({counts})")
            if g["verdict"] != "unmapped":
                x = course_mod.fairway_crosscheck(
                    con, name, features, unmapped_is_rough=(g["verdict"] == "well-mapped"))
                print(f"  FW cross-check vs Shot Scope: {x['agree']}/{x['checked']} agree,"
                      f" {x['disagree']} disagree, {x['outside_map']} outside mapped areas")
            if g["verdict"] != "well-mapped":
                print("  -> worth a FairwayMapper/JOSM session; delete the cache file after mapping to re-fetch")

    elif args.cmd == "shotscope":
        import getpass
        import os

        from . import shotscope

        data_root = Path(args.db).parent
        out_dir = Path(args.out) if args.out else data_root / "rounds"
        if args.offline:
            client = None
        else:
            email = args.email or os.environ.get("OPENROUND_SS_EMAIL") or input("Shot Scope email: ")
            password = os.environ.get("OPENROUND_SS_PASSWORD") or getpass.getpass("Shot Scope password: ")
            client = shotscope.ShotScopeClient()
            try:
                client.login(email, password)
            except shotscope.LoginError as e:
                print(f"login failed: {e}")
                return 1
        try:
            normalized = shotscope.fetch_all(client, data_root / "shotscope-raw", out_dir)
            db.import_rounds(con, normalized)
        except (json.JSONDecodeError, UnicodeDecodeError, OSError, db.ImportValidationError) as exc:
            print(f"shotscope failed: {exc}", file=sys.stderr)
            return 1
        print(f"\n{len(normalized)} round(s) exported and imported into {args.db}")
        print("next: uv run python -m openround stats   (then: roadmap --write)")

    elif args.cmd == "roadmap":
        all_stats = stats_mod.all_round_stats(con)
        if not all_stats:
            print("no rounds in the database yet — import first")
            return 1
        base = stats_mod.baseline(all_stats)
        diff = roadmap.apply(Path(args.path), all_stats, base, write=args.write)
        if not diff:
            print("roadmap already up to date")
        else:
            print(diff, end="")
            if args.write:
                print(f"\napplied (backup in {roadmap.BACKUP_DIR})")
            else:
                print("\ndry run — re-run with --write to apply")
    return 0


if __name__ == "__main__":
    sys.exit(main())
