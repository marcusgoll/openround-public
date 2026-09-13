# OpenRound course-library operations

## Pinned release

The PWA currently pins the OpenGolfAPI US `v2.1.0` release in `prototypes/openround-iphone/public/course-data/`.

- Raw artifact: `opengolfapi-us-v2.1.0.geojson`
- SHA-256: `fb4aa24aa8bce2fe338812bc316a2067720c6ffb7874429f5c037b31578300db`
- Normalized discovery index: `opengolfapi-us-v2.1.0.index.json`
- Manifest: `opengolfapi-us-v2.1.0.manifest.json`
- Release source: <https://github.com/opengolfapi/data/releases/tag/v2.1.0>
- Geometry snapshot: `opengolfapi-us-v2.1.5.geometry.manifest.json` (versioned carry-forward of the v2.1.4 cache plus a checksum-verified Pinehurst refresh through the optional free Overpass mirror; the catalog identifies Pinehurst as a 14-hole course)
- Attribution: `© OpenStreetMap contributors (ODbL 1.0) via OpenGolfAPI`

The bulk release is a discovery/scorecard catalog. It does not prove that a course has usable hole geometry. Hole layers are loaded on demand from OpenStreetMap via Overpass, graded, and kept separate from the catalog metadata.

## Free personal-project provider decision

**CADDIE.100 is parked:** it is currently closed beta and is not a selectable dependency. Do not request credentials or build a CADDIE-specific client.

**Default zero-cost stack:** OpenGolfAPI for the US catalog and scorecard discovery, plus validated OpenStreetMap/Overpass geometry captured into versioned local bundles. OpenGolfAPI's [free API terms](https://courses.opengolfapi.org/legal/terms) allow 1,000 anonymous requests/day per IP or 10,000/day with a free key, and its downloadable data is ODbL-licensed with required attribution. The pinned release means the round-time PWA does not depend on the hosted API. OSM data itself has no license fee, but every derived database must preserve ODbL attribution/share-alike obligations.

Live Overpass remains development/prototype-only. The personal PWA should use the checked-in geometry bundles for round-time behavior; refreshes can be run manually or from a personal scheduled job. A course with incomplete tee, green, path, or hazard layers stays graded and suppresses unsafe distances. When `overpass-api.de` is rate-limited or unavailable, the opportunistic HTTPS mirror `https://maps.mail.ru/osm/tools/overpass/api/interpreter` is an optional development refresh endpoint; it has passed the current sample probes but is not a reliability guarantee. It must never replace the pinned bundle or bypass the same normalization and quality checks.

For imagery, use the no-key [USGSImageryOnly service](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer) as the free US aerial fallback and the Google Satellite path only when the user supplies a key. Real-course views request a display-only, high-density viewport from the USGS NAIP Plus `ImageServer/exportImage` endpoint and keep level-16 tiles underneath as a fallback; both use the same Web Mercator world-pixel transform as the vector overlays. Neither path is an offline guarantee. Google imagery is display-only and must retain attribution; Google policies prohibit bulk download, unauthorized caching/offline use, tracing, and geodata extraction. If imagery is unavailable or a key is not desired, the rangefinder must still work from vector geometry and an open basemap. See the [Map Tiles API policies](https://developers.google.com/maps/documentation/tile/policies), [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/), and [USGS service metadata](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer) (reviewed 2026-08-30).

Paid services such as iGolf Connect or Golf Intelligence/StrackaGolf remain optional future upgrades, not requirements for this personal build.

## Refresh procedure

The local refresh candidate is currently `v2.1.5` (69 records, `A=31`, `B=35`, `C=1`, `D=2`). Sites version 18 remains the public `v2.1.4` deployment until a separately authorized Sites promotion; never treat the local `current` alias as proof of public deployment.

1. Run `npm run refresh:course-library:job -- --release vX.Y.Z` in the PWA directory (or set `OPENROUND_COURSE_LIBRARY_RELEASE` in the scheduler). The job downloads only the named GitHub release, verifies the upstream SHA-256, promotes the versioned artifact and checksum through per-file temporary replacements (with process-scoped names, cleanup, bounded Windows retry, and a narrow open-file fallback), then rebuilds the deduplicated index, manifest, and `current` aliases.
2. The underlying `refresh:course-library` and `prepare:course-catalog` commands remain available separately for investigation or rollback preparation.
3. For verified real hole layers, run `npm run refresh:course-geometry:job -- --release vX.Y.Z --course-id <id> --hole <number>` once per course/hole (repeat the flags for a batch), or use `--all-holes` to pin the catalog hole count. The job verifies the pinned catalog first, then delegates to the geometry refresh and verifies the complete cache before reporting success. The underlying `refresh:course-geometry` command remains available for investigation or rollback preparation. Both paths accept pinned catalog IDs and the personal seeds in `src/openroundPersonalCourses.ts`; they fetch one provider payload per course, normalize every requested hole, store geometry under a versioned path, record its quality and ODbL attribution, write a SHA-256 geometry checksum file, and refuse to overwrite a changed key inside an existing release. Repeat `--endpoint <https-url>` to provide an ordered free-provider fallback; every endpoint is HTTPS-validated and the operation writes no artifacts if all endpoints fail. A smaller `--radius-meters` may be used for a large course; any resulting incomplete hole remains explicitly graded and distance-suppressed.
4. Run `npm run verify:course-catalog` to verify the raw GeoJSON, SHA-256, index, manifest, release, timestamp, and unique course count.
5. Run `npm run verify:course-cache` to verify every bundled artifact's path, SHA-256, payload schema, and manifest quality before the build.
6. Run `npm run test:model`, and `npm run build`. The build runs both catalog and geometry verifiers before TypeScript/Vite packaging, so a stale or tampered snapshot cannot ship as a compile-only success.
7. Run `npm run verify:course-geometry` to probe Egyptian, Pinehurst No. 2, Pebble Beach, and both personal Squaw Valley layout cohorts. The command verifies that every returned feature stays inside the normalized map envelope with a zero-drift round trip and uses the explicit layout selector for Links versus Lakes. Transient 429/5xx responses are retried up to three times, honoring a numeric `Retry-After` when supplied. Set `OPENROUND_OVERPASS_ENDPOINT` for one alternate HTTPS instance, or set comma-separated `OPENROUND_OVERPASS_ENDPOINTS` for an ordered list; the default `overpass-api.de` endpoint is always appended as the final fallback. Any unresolved probe error exits non-zero.
8. After field capture, run `npm run evaluate:course-field-log -- path/to/field-log.json --personal-beta`. The personal-beta profile requires a `version: 1` payload plus unique run IDs, geometry versions, and capture timestamps; exactly one iPhone; both Squaw Valley course IDs (Links and Lakes); a third control course; valid GPS evidence for every course; per-course GPS thresholds; and grade-A/B alignment evidence from at least two courses. Any incomplete hole may be logged without alignment, but its identity and capture metadata must still be present.
9. Review the generated manifests and release notes before distributing the PWA. Keep the old versioned catalog and geometry artifacts until the new build is accepted so rollback is a file/version selection, not a data reconstruction.

## Runtime rules

- Search and nearby matching use only the pinned index and phone GPS; a course is not active until the golfer confirms it.
- The selected course and hole are stored as a versioned local selection (`openround:course-selection:v1`); reload restores it only when the catalog source version and hole range still match, otherwise the selection is cleared and must be confirmed again.
- The PWA loads the compact index and its current manifest together, and rejects mismatched release, generation timestamp, course count, duplicate IDs, bad provenance, or invalid coordinates before enabling discovery.
- Bundled geometry is loaded and checksum-verified before falling back to live Overpass. Overpass geometry is normalized to tee, green, fairway/centerline, hazard, and pin features. A hole is graded A/B/C/D; no pin or hazard-distance number is displayed unless the required layers pass validation. Grade B may be complete tee/green/path geometry without hazards, and remains hazard-distance suppressed until at least one mapped hazard is present. When an Overpass response contains an unnumbered facility-wide cohort, features must fall within the target hole's numbered centerline (about 165 m) or they are withheld; path-segment distance is used so midpoint hazards are not mistaken for neighboring-hole data.
- Live Overpass fallback is prototype-only: it is available in Vite development or when `VITE_OPENROUND_ALLOW_LIVE_OVERPASS=true` is explicitly set. A production build with that flag unset is bundle-only and fails closed when a validated bundle has not supplied the selected hole.
- GPS shot start/end and total distance remain phone evidence. They are never projected onto an unverified course map.
- OpenGolfAPI plus validated OSM/Overpass bundles are the default free geometry boundary for this personal project. Keep source version, attribution, checksum, and quality metadata with every bundle. When one facility contains multiple OSM layouts, select the layout cohort explicitly before pinning; never merge child features by hole number alone. CADDIE.100 and other paid providers remain optional upgrades only.
- Google satellite tiles remain a live display service only. OpenRound must not scrape, bulk-download, or trace Google imagery into the course database. If a Google key is absent, the prototype uses the no-key USGS/USDA NAIP service as a visual fallback; vector geometry and hazard distances must remain usable without paid imagery.

## Automated job shape

Run the catalog and geometry job wrappers from CI on a release-driven schedule (for example weekly release polling plus an explicit release pin). The jobs should fail closed on a missing asset, checksum mismatch, malformed JSON, duplicate-ID drift, or coordinate/schema validation failure. Publish the generated artifacts and manifests together, then run the PWA build and field checks before promotion.
