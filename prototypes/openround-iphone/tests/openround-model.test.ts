import assert from "node:assert/strict";
import test from "node:test";
import { estimateCameraPinDistance } from "../src/openroundCameraPin.ts";
import {
  EQUIPMENT_LIMIT,
  addEquipment,
  CLUB_PROFILES,
  countRecordedStrokes,
  createDefaultEquipment,
  DEFAULT_DISPERSION_RADIUS_YARDS,
  getClubProfile,
  getDispersionEnvelope,
  getDispersionPresentation,
  getShotBias,
  loadStoredEquipment,
  loadStoredRoundLog,
  parseStoredEquipment,
  parseStoredRoundLog,
  removeEquipment,
  type RoundEvent,
  storeRoundLog,
  updateEquipment,
} from "../src/openroundModel.ts";
import {
  DEMO_OPENROUND_COURSE,
  OPEN_GOLF_API_ADAPTER,
  getHoleReadiness,
  normalizeOpenGolfCourse,
} from "../src/openroundCourseData.ts";
import {
  createCourseCatalogIndex,
  findNearbyCourses,
  isCourseCatalogArtifact,
  isCourseCatalogIndex,
  isCourseCatalogManifest,
  isCourseSelectionCurrent,
  mergeCourseCatalogEntries,
  parseCourseSelection,
  searchCourses,
  storeCourseSelection,
} from "../src/openroundCourseCatalog.ts";
import { getPersonalCourseHolePar, PERSONAL_COURSE_ENTRIES } from "../src/openroundPersonalCourses.ts";
import { buildOverpassHoleQuery, createGeometryProjection, fetchOverpassGeometryPayload, findAutomaticGreenLandingPoint, isGeoPositionInsideGeometry, isGeoPositionInsideGeometryOrBoundary, normalizeOverpassHoleGeometry, webMercatorGeoPoint, webMercatorWorldPixel } from "../src/openroundGeometry.ts";
import { fetchBundledHoleGeometry, geometryCacheArtifact, geometryCacheKey, isGeometryCacheManifest, isLoadedHoleGeometry, sha256Hex } from "../src/openroundGeometryCache.ts";
import { resolveGeometryRuntimePolicy } from "../src/openroundProviderPolicy.ts";
import {
  PIN_OVERRIDE_STORAGE_KEY,
  loadStoredPinOverride,
  parseStoredPinOverrides,
  removeStoredPinOverride,
  storePinOverride,
} from "../src/openroundPinStorage.ts";
import {
  FIELD_LOG_LIMIT,
  FIELD_LOG_STORAGE_KEY,
  appendFieldLogRun,
  clearFieldLog,
  loadStoredFieldLog,
  parseStoredFieldLog,
  removeFieldLogRun,
  storeFieldLog,
  type FieldLogPayload,
  type FieldLogRun,
} from "../src/openroundFieldLog.ts";

test("production geometry policy stays bundle-only unless live Overpass is explicitly enabled", () => {
  assert.deepEqual(resolveGeometryRuntimePolicy({ dev: false }), { allowLiveOverpass: false, mode: "bundle-only" });
  assert.equal(resolveGeometryRuntimePolicy({ dev: true }).allowLiveOverpass, true);
  assert.equal(resolveGeometryRuntimePolicy({ dev: false, allowLiveOverpass: "true" }).mode, "prototype-overpass");
  assert.equal(resolveGeometryRuntimePolicy({ dev: false, allowLiveOverpass: "TRUE" }).allowLiveOverpass, false);
});

test("Overpass geometry retries transient rate limits before failing closed", async () => {
  const responses = [
    { ok: false, status: 429, headers: { get: () => "0" } },
    { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ elements: [] }) },
  ];
  let calls = 0;
  const payload = await fetchOverpassGeometryPayload(
    { lat: 32.25769, lon: -97.72271 },
    async () => responses[calls++] as unknown as Response,
    2200,
    "https://overpass-api.de/api/interpreter",
  );
  assert.deepEqual(payload, { elements: [] });
  assert.equal(calls, 2);
});

test("7 Iron derives a centered 40-shot aim-relative pattern", () => {
  const profile = getClubProfile("7i");
  const envelope = getDispersionEnvelope(profile.offsets);
  const bias = getShotBias(profile.offsets);

  assert.equal(profile.offsets.length, 40);
  assert.deepEqual(envelope, { leftYards: 8, rightYards: 8, shortYards: 9, longYards: 10 });
  assert.deepEqual(bias, { lateralYards: 0, distanceYards: 0 });
});

test("dispersion stays circular until a club has enough tracked shots", () => {
  const sparse = getDispersionPresentation([
    { lateralYards: -4, distanceYards: -3 },
    { lateralYards: 2, distanceYards: 1 },
  ]);
  assert.equal(sparse.circular, true);
  assert.deepEqual(sparse.envelope, {
    leftYards: DEFAULT_DISPERSION_RADIUS_YARDS,
    rightYards: DEFAULT_DISPERSION_RADIUS_YARDS,
    shortYards: DEFAULT_DISPERSION_RADIUS_YARDS,
    longYards: DEFAULT_DISPERSION_RADIUS_YARDS,
  });

  const enough = Array.from({ length: 10 }, (_, index) => ({
    lateralYards: index % 2 === 0 ? -4 : 6,
    distanceYards: index % 2 === 0 ? -3 : 5,
  }));
  const learned = getDispersionPresentation(enough);
  assert.equal(learned.circular, false);
  assert.deepEqual(learned.envelope, { leftYards: 4, rightYards: 6, shortYards: 3, longYards: 5 });
});

test("every club profile contains finite prototype fixture offsets", () => {
  assert.equal(CLUB_PROFILES.length, 14);
  assert.deepEqual(CLUB_PROFILES.map((profile) => profile.id), [
    "driver", "3w", "4h", "4i", "pw", "9i", "8i", "7i", "6i", "5i", "gw", "sw", "lw", "putter",
  ]);
  assert.equal(CLUB_PROFILES.find((profile) => profile.id === "driver")?.totalYards, 258);
  assert.equal(CLUB_PROFILES.find((profile) => profile.id === "7i")?.totalYards, 162);

  for (const profile of CLUB_PROFILES) {
    assert.equal(profile.provenance, "prototype_fixture");
    assert.equal(profile.offsets.length, 40);

    for (const offset of profile.offsets) {
      assert.ok(Number.isFinite(offset.lateralYards));
      assert.ok(Number.isFinite(offset.distanceYards));
    }
  }
});

test("equipment bag defaults to fourteen validated slots and supports immutable CRUD", () => {
  const defaults = createDefaultEquipment();
  assert.equal(defaults.length, EQUIPMENT_LIMIT);
  assert.deepEqual(defaults.map((club) => club.slot), Array.from({ length: 14 }, (_, index) => index + 1));
  assert.equal(new Set(defaults.map((club) => club.id)).size, EQUIPMENT_LIMIT);
  assert.deepEqual(defaults.map((club) => club.name), [
    "Driver", "3 Wood", "4 Hybrid", "4 Iron", "5 Iron", "6 Iron", "7 Iron", "8 Iron", "9 Iron",
    "Pitching Wedge", "Gap Wedge", "Sand Wedge", "Lob Wedge", "Putter",
  ]);
  assert.deepEqual(defaults.map((club) => club.loft), [9, 16, 21, 22, 25, 28, 31, 35, 40, 46, 52, 56, 60, 3]);
  assert.ok(defaults.every((club) => club.brand === "Stix" && club.model === "Nicholas Edition"));

  const edited = updateEquipment(defaults, "club-7", { brand: "Titleist", model: "T150", loft: 31 });
  assert.equal(defaults[6]?.brand, "Stix");
  assert.deepEqual(edited[6], { ...defaults[6], brand: "Titleist", model: "T150", loft: 31 });

  const distanceEdited = updateEquipment(defaults, "club-7", { carryYards: 160 });
  assert.equal(distanceEdited[6]?.carryYards, 160);
  assert.equal(distanceEdited[6]?.totalYards, 168);
  const explicitTotal = updateEquipment(defaults, "club-7", { carryYards: 160, totalYards: 172 });
  assert.equal(explicitTotal[6]?.totalYards, 172);

  const deleted = removeEquipment(edited, "club-14");
  assert.equal(deleted.length, 13);
  const added = addEquipment(deleted, { name: "Utility", brand: "Ping", model: "G430", type: "hybrid", loft: 20, carryYards: 200 });
  assert.equal(added.length, EQUIPMENT_LIMIT);
  assert.equal(added.find((club) => club.slot === 14)?.name, "Utility");
  assert.equal(addEquipment(added, { name: "Extra", brand: "", model: "", type: "wood", loft: 15, carryYards: 200 }).length, EQUIPMENT_LIMIT);
});

test("equipment storage parsing fails closed and preserves valid local edits", () => {
  const defaults = createDefaultEquipment();
  const storage = new Map<string, string>();
  storage.set("openround:equipment:v2", JSON.stringify({ version: 2, equipment: defaults.map((club) => club.id === "club-7" ? { ...club, brand: "Titleist" } : club) }));
  assert.equal(loadStoredEquipment({ getItem: (key) => storage.get(key) ?? null }).find((club) => club.id === "club-7")?.brand, "Titleist");
  storage.clear();
  storage.set("openround:equipment:v1", JSON.stringify({ version: 1, equipment: defaults.map((club) => club.id === "club-7" ? { ...club, name: "7 Iron", brand: "Unbranded", model: "", loft: 32 } : club) }));
  const migrated = loadStoredEquipment({ getItem: (key) => storage.get(key) ?? null });
  assert.deepEqual(migrated.map((club) => club.name), [
    "Driver", "3 Wood", "4 Hybrid", "4 Iron", "5 Iron", "6 Iron", "7 Iron", "8 Iron", "9 Iron",
    "Pitching Wedge", "Gap Wedge", "Sand Wedge", "Lob Wedge", "Putter",
  ]);
  assert.equal(migrated.find((club) => club.id === "club-7")?.brand, "Stix");
  assert.equal(migrated.find((club) => club.id === "club-7")?.loft, 31);
  assert.equal(parseStoredEquipment(JSON.stringify({ version: 1, equipment: [{ ...defaults[0], slot: 2 }, { ...defaults[1], slot: 2 }] })), undefined);
  assert.equal(parseStoredEquipment(JSON.stringify({ version: 1, equipment: [{ ...defaults[0], status: "broken" }] })), undefined);
  assert.equal(parseStoredEquipment(JSON.stringify({ version: 1, equipment: [{ ...defaults[0], status: undefined }] }))?.[0]?.status, "active");
  assert.equal(loadStoredEquipment({ getItem: () => "not-json" }).length, EQUIPMENT_LIMIT);
});

test("equipment status is immutable and separates retired clubs from active inventory", () => {
  const defaults = createDefaultEquipment();
  const retired = updateEquipment(defaults, "club-14", { status: "retired" });

  assert.equal(defaults[13]?.status, "active");
  assert.equal(retired[13]?.status, "retired");
  assert.equal(updateEquipment(retired, "club-14", { status: "active" })[13]?.status, "active");
});

test("round log validates deterministic manual events and has independent local fallback", () => {
  const log = {
    version: 1 as const,
    roundId: "demo:7",
    courseId: "demo",
    holeNumber: 7,
    score: 5,
    events: [
      {
        id: "event-1",
        kind: "manual_shot" as const,
        holeNumber: 7,
        sequence: 1,
        clubId: "club-7",
        clubName: "7 Iron",
        distanceYards: null,
        strokes: 1,
        evidence: "manual" as const,
        createdAt: "2026-08-30T00:00:00.000Z",
      },
    ],
  };
  const storage = new Map<string, string>();

  assert.deepEqual(parseStoredRoundLog(log), log);
  assert.equal(parseStoredRoundLog({ ...log, events: [{ ...log.events[0], distanceYards: 154 }] }), undefined);
  assert.equal(parseStoredRoundLog({ ...log, events: [{ ...log.events[0], clubId: null }] }), undefined);
  assert.equal(parseStoredRoundLog({ ...log, events: [{ ...log.events[0], strokes: 0 }] }), undefined);
  assert.equal(parseStoredRoundLog({ ...log, events: [{ ...log.events[0], kind: "not-an-event" }] }), undefined);
  storeRoundLog({ setItem: (key, value) => storage.set(key, value) }, log);
  assert.deepEqual(loadStoredRoundLog({ getItem: (key) => storage.get(key) ?? null }), log);
  assert.deepEqual(loadStoredRoundLog({ getItem: () => "not-json" }), {
    version: 1,
    roundId: "",
    courseId: "",
    holeNumber: 1,
    score: 0,
    events: [],
  });
});

test("field log preserves evaluator-shaped evidence and fails closed", () => {
  const run: FieldLogRun = {
    id: "field-run-1",
    device: "Marcus iPhone",
    courseId: "personal-squaw-valley-links-osm-v1",
    hole: 1,
    teeBox: "blue",
    geometryGrade: "A",
    geometryVersion: "v2.1.1",
    gps: [{ expectedYards: 100, recordedYards: 99, accuracyMeters: 5, fixAgeSeconds: 4 }],
    alignment: { lateralYards: 6, longitudinalYards: 8 },
    imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true },
    note: "1x and 2x overlay stayed aligned",
    createdAt: "2026-08-30T00:00:00.000Z",
  };
  const payload: FieldLogPayload = { version: 1, runs: [run] };
  const storage = new Map<string, string>();

  assert.deepEqual(parseStoredFieldLog(payload), payload);
  storeFieldLog({ setItem: (key, value) => storage.set(key, value) }, payload);
  assert.deepEqual(loadStoredFieldLog({ getItem: (key) => storage.get(key) ?? null }), payload);
  assert.equal(storage.has(FIELD_LOG_STORAGE_KEY), true);
  assert.deepEqual(parseStoredFieldLog({ ...payload, runs: [{ ...run, id: "field-run-1" }, { ...run, id: "field-run-1" }] }), undefined);
  assert.deepEqual(parseStoredFieldLog({ ...payload, runs: [{ ...run, geometryGrade: "C", alignment: run.alignment }] }), undefined);
  assert.deepEqual(parseStoredFieldLog({ ...payload, runs: [{ ...run, imagery: { ...run.imagery, provider: "unknown" } }] }), undefined);
  assert.deepEqual(parseStoredFieldLog({ ...payload, runs: [{ ...run, teeBox: "red" }] }), { ...payload, runs: [{ ...run, teeBox: "red" }] });
  assert.deepEqual(parseStoredFieldLog({ ...payload, runs: [{ ...run, teeBox: "black" }] }), { ...payload, runs: [{ ...run, teeBox: "black" }] });
  assert.deepEqual(parseStoredFieldLog({ ...payload, runs: [{ ...run, teeBox: "orange" }] }), undefined);
  assert.deepEqual(parseStoredFieldLog({ ...payload, runs: [{ ...run, gps: [{ expectedYards: 0, recordedYards: 99, accuracyMeters: 5 }] }] }), undefined);
  assert.deepEqual(parseStoredFieldLog({ ...payload, runs: [{ ...run, gps: [{ ...run.gps[0]!, fixAgeSeconds: 301 }] }] }), undefined);
  assert.deepEqual(parseStoredFieldLog({ ...payload, runs: [{ ...run, gps: [{ ...run.gps[0]!, fixAgeSeconds: "4" }] }] }), undefined);
  assert.deepEqual(loadStoredFieldLog({ getItem: () => "not-json" }), clearFieldLog());
});

test("field log append/remove is bounded and preserves missing measurements", () => {
  const base: FieldLogPayload = clearFieldLog();
  const incomplete: FieldLogRun = {
    id: "field-run-incomplete",
    device: "Marcus iPhone",
    courseId: "course-control",
    hole: 2,
    geometryGrade: "C",
    geometryVersion: "v2.1.1",
    gps: [],
    imagery: { provider: "bundled", attributionVisible: false, overlayAligned: false },
    createdAt: "2026-08-30T00:00:00.000Z",
  };
  const appended = appendFieldLogRun(base, incomplete);
  assert.deepEqual(appended.runs[0], incomplete);
  assert.deepEqual(removeFieldLogRun(appended, incomplete.id), clearFieldLog());

  let bounded = clearFieldLog();
  for (let index = 0; index < FIELD_LOG_LIMIT; index += 1) {
    bounded = appendFieldLogRun(bounded, { ...incomplete, id: `field-run-${index}` });
  }
  assert.equal(bounded.runs.length, FIELD_LOG_LIMIT);
  assert.throws(() => appendFieldLogRun(bounded, { ...incomplete, id: "field-run-over-limit" }), /limit/i);
  assert.deepEqual(parseStoredFieldLog({ version: 1, runs: Array.from({ length: FIELD_LOG_LIMIT + 1 }, (_, index) => ({ ...incomplete, id: `run-${index}` })) }), undefined);
});

test("field log preserves two-point phone GPS provenance and rejects incomplete pairs", () => {
  const run: FieldLogRun = {
    id: "field-run-pair",
    device: "Marcus iPhone",
    courseId: "course-control",
    hole: 1,
    geometryGrade: "A",
    geometryVersion: "v2.1.1",
    gps: [{
      expectedYards: 100,
      recordedYards: 100,
      accuracyMeters: 5,
      fixAgeSeconds: 1,
      source: "phone_pair",
      start: { lat: 32, lon: -97 },
      end: { lat: 32.00082, lon: -97 },
      startFixAgeSeconds: 2,
      endFixAgeSeconds: 1,
    }],
    imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true },
    createdAt: "2026-08-30T00:00:00.000Z",
  };

  assert.deepEqual(parseStoredFieldLog({ version: 1, runs: [run] }), { version: 1, runs: [run] });
  assert.equal(parseStoredFieldLog({ version: 1, runs: [{ ...run, gps: [{ ...run.gps[0]!, end: undefined }] }] }), undefined);
  assert.equal(parseStoredFieldLog({ version: 1, runs: [{ ...run, gps: [{ ...run.gps[0]!, source: "manual" }] }] }), undefined);
});

test("normalizes an OpenGolfAPI course while preserving provenance and geometry layers", () => {
  const course = normalizeOpenGolfCourse({
    id: "course-7",
    name: "Lake View Golf Club",
    country: "US",
    state: "IL",
    city: "Chicago",
    latitude: 41.88,
    longitude: -87.62,
    source_version: "2026-08-28",
    scorecard: [{ hole: 7, par: 4, handicap: 11 }],
    holes: [
      {
        number: 7,
        par: 4,
        handicap: 11,
        tees: [
          {
            id: "blue",
            name: "Blue",
            rating: 72.1,
            slope: 130,
            yardages: [{ hole: 7, yards: 420 }],
            point: { type: "Point", coordinates: [-87.621, 41.881] },
          },
        ],
        features: [
          { id: "tee-7", kind: "tee", geometry: { type: "Point", coordinates: [-87.621, 41.881] } },
          {
            id: "green-7",
            kind: "green",
            geometry: {
              type: "Polygon",
              coordinates: [[[-87.615, 41.887], [-87.614, 41.887], [-87.614, 41.888], [-87.615, 41.887]]],
            },
          },
          {
            id: "centerline-7",
            kind: "centerline",
            geometry: { type: "LineString", coordinates: [[-87.621, 41.881], [-87.615, 41.887]] },
          },
          {
            id: "bunker-7",
            kind: "bunker",
            geometry: { type: "Point", coordinates: [-87.618, 41.884] },
            carry_yards: 145,
            clear_yards: 153,
          },
        ],
      },
    ],
  });

  const hole = course.holes[0];
  assert.equal(course.id, "course-7");
  assert.deepEqual(course.center, { lat: 41.88, lon: -87.62 });
  assert.deepEqual(course.source, {
    provider: "opengolfapi",
    sourceId: "course-7",
    license: "ODbL-1.0",
    version: "2026-08-28",
  });
  assert.equal(hole.tees[0]?.holeYards["7"], 420);
  assert.equal(hole.features.find((feature) => feature.kind === "bunker")?.clearYards, 153);
  assert.deepEqual(getHoleReadiness(hole), {
    status: "ready",
    ready: true,
    missing: [],
    optionalMissing: [],
  });
  assert.equal(OPEN_GOLF_API_ADAPTER.provider, "opengolfapi");
  assert.equal(OPEN_GOLF_API_ADAPTER.normalize({ id: "adapter-course" }).source.provider, "opengolfapi");
});

test("normalization fails closed for malformed coordinates and partial geometry", () => {
  const course = normalizeOpenGolfCourse({
    id: "partial-course",
    name: "Partial Course",
    latitude: "not-a-number",
    longitude: null,
    holes: [{ number: 1, par: 4 }],
  });

  assert.equal(course.center, undefined);
  assert.equal(course.geometryStatus, "unmapped");
  assert.deepEqual(getHoleReadiness(course.holes[0]!), {
    status: "unmapped",
    ready: false,
    missing: ["tee", "green", "aim path"],
    optionalMissing: ["hazards"],
  });

  const outOfBounds = normalizeOpenGolfCourse({
    id: "out-of-bounds-course",
    name: "Out of Bounds Course",
    latitude: 95,
    longitude: 181,
    holes: [{ number: 1, features: [{ id: "bad-green", kind: "green", geometry: { type: "Point", coordinates: [181, 0] } }] }],
  });
  assert.equal(outOfBounds.center, undefined);
  assert.equal(outOfBounds.holes[0]?.features.length, 0);
});

test("demo course remains explicitly partial and fixture-owned", () => {
  assert.equal(DEMO_OPENROUND_COURSE.source.provider, "prototype_fixture");
  assert.equal(DEMO_OPENROUND_COURSE.source.license, "internal-demo-fixture");
  assert.equal(DEMO_OPENROUND_COURSE.geometryStatus, "partial");
  assert.equal(getHoleReadiness(DEMO_OPENROUND_COURSE.holes[0]!).ready, false);
});

test("catalog index deduplicates records and supports deterministic search and nearby matching", () => {
  const index = createCourseCatalogIndex(
    {
      features: [
        { id: "a", properties: { name: "Pine Club", aliases: ["Pinehurst-style test alias"], state: "IL", city: "Chicago", lat: 41.9, lon: -87.6 } },
        { id: "a", properties: { name: "Duplicate Pine Club", state: "IL", lat: 41.9, lon: -87.6 } },
        { id: "b", properties: { name: "Lake Club", state: "WI", city: "Kenosha", lat: 42.6, lon: -87.8 } },
      ],
    },
    "v2.1.0",
  );
  assert.equal(index.courseCount, 2);
  assert.equal(searchCourses(index, "pine chicago")[0]?.id, "a");
  assert.equal(searchCourses(index, "pinehurst-style test alias")[0]?.id, "a");
  assert.equal(findNearbyCourses(index, { lat: 41.9, lon: -87.6 }, 2)[0]?.entry.id, "a");
  const merged = mergeCourseCatalogEntries(index, [
    { ...index.entries[0]!, name: "Duplicate display name" },
    { id: "personal", name: "Personal course", country: "US", state: "TX", city: "Glen Rose", sourceVersion: "personal-v1" },
  ]);
  assert.equal(merged.courseCount, 3);
  assert.equal(merged.entries.filter((entry) => entry.id === "a").length, 1);
  assert.equal(merged.entries.find((entry) => entry.id === "personal")?.name, "Personal course");
  const locationIndex = mergeCourseCatalogEntries(index, [
    ...Array.from({ length: 12 }, (_, position) => ({
      id: `glen-decoy-${position}`,
      name: `Glen ${String.fromCharCode(65 + position)} Golf Club`,
      country: "US",
      state: "FL",
      city: "DeBary",
      sourceVersion: "v2.1.0",
    })),
    ...PERSONAL_COURSE_ENTRIES,
  ]);
  assert.deepEqual(
    searchCourses(locationIndex, "glen rose, tx", 2).map((entry) => entry.id),
    ["personal-squaw-valley-lakes-pending-v1", "personal-squaw-valley-links-osm-v1"],
  );
  assert.deepEqual(
    searchCourses(locationIndex, "Glen Rose", 2).map((entry) => entry.id),
    ["personal-squaw-valley-lakes-pending-v1", "personal-squaw-valley-links-osm-v1"],
  );
  assert.equal(searchCourses(locationIndex, "Texas", 2)[0]?.state, "TX");
  const storage = new Map<string, string>();
  const selection = storeCourseSelection({ setItem: (key, value) => storage.set(key, value) }, index.entries[0]!, 7, "2026-08-28T00:00:00.000Z");
  assert.deepEqual(parseCourseSelection(JSON.parse(storage.values().next().value!)), selection);
  assert.equal(isCourseSelectionCurrent(selection, index.entries[0]!), true);
  assert.equal(isCourseSelectionCurrent({ ...selection, sourceVersion: "v2.0.0" }, index.entries[0]!), false);
  assert.equal(isCourseSelectionCurrent({ ...selection, holeNumber: 99 }, { ...index.entries[0]!, holes: 18 }), false);
  assert.equal(isCourseCatalogIndex(index), true);
  assert.equal(isCourseCatalogIndex({ ...index, entries: [], courseCount: 0 }), false);
  assert.equal(isCourseCatalogIndex({ ...index, courseCount: 99 }), false);
  assert.equal(isCourseCatalogIndex({ ...index, entries: [index.entries[0], index.entries[0]] }), false);
  assert.equal(isCourseCatalogIndex({ ...index, entries: [{ ...index.entries[0]!, country: "CA" }, index.entries[1]!] }), false);
  const manifest = {
    provider: "opengolfapi",
    release: "v2.1.0",
    generatedAt: index.generatedAt,
    artifact: "opengolfapi-us-v2.1.0.geojson",
    format: "GeoJSON FeatureCollection",
    sha256: "fb4aa24aa8bce2fe338812bc316a2067720c6ffb7874429f5c037b31578300db",
    courseCount: index.courseCount,
    geometryCoverage: "catalog centers only",
    sourceUrl: "https://github.com/opengolfapi/data/releases/tag/v2.1.0",
    license: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors",
  };
  assert.equal(isCourseCatalogManifest(manifest), true);
  assert.equal(isCourseCatalogManifest({ ...manifest, courseCount: 0 }), false);
  assert.equal(isCourseCatalogManifest({ ...manifest, sha256: "bad" }), false);
  assert.equal(isCourseCatalogArtifact({ type: "FeatureCollection", features: [{ properties: { id: "a", name: "Pine Club", country: "US" }, geometry: { type: "Point", coordinates: [-87.6, 41.9] } }] }), true);
  assert.equal(isCourseCatalogArtifact({ type: "FeatureCollection", features: [] }), false);
  assert.equal(isCourseCatalogArtifact({ type: "FeatureCollection", features: [{ properties: { id: "a", name: "Not US", country: "CA" }, geometry: { type: "Point", coordinates: [-87.6, 41.9] } }] }), false);
});

test("Overpass geometry normalizer grades layers and never marks hazards usable without complete path layers", () => {
  const payload = {
    elements: [
      { type: "way", id: 1, tags: { golf: "hole", ref: "7" }, geometry: [{ lat: 41.0, lon: -87.0 }, { lat: 41.01, lon: -86.99 }] },
      { type: "way", id: 2, tags: { golf: "tee" }, geometry: [{ lat: 41.0, lon: -87.0 }, { lat: 41.0, lon: -87.001 }, { lat: 41.0, lon: -87.0 }] },
      { type: "way", id: 3, tags: { golf: "green" }, geometry: [{ lat: 41.01, lon: -86.99 }, { lat: 41.011, lon: -86.99 }, { lat: 41.01, lon: -86.99 }] },
      { type: "way", id: 4, tags: { golf: "bunker" }, geometry: [{ lat: 41.005, lon: -86.995 }, { lat: 41.006, lon: -86.995 }, { lat: 41.005, lon: -86.995 }] },
      { type: "node", id: 5, lat: 41.0105, lon: -86.99, tags: { golf: "pin", ref: "7" } },
    ],
  };
  const loaded = normalizeOverpassHoleGeometry(payload, 7, "osm-test");
  assert.equal(loaded.quality.grade, "A");
  assert.equal(loaded.quality.hazardsUsable, true);
  assert.equal(loaded.quality.pinUsable, true);
  assert.equal(loaded.hole.features.filter((feature) => feature.kind === "centerline").length, 1);
  assert.match(buildOverpassHoleQuery({ lat: 41.9, lon: -87.6 }), /golf/);

  const noHazards = normalizeOverpassHoleGeometry({
    elements: payload.elements.filter((element) => element.id !== 4),
  }, 7, "osm-test");
  assert.equal(noHazards.quality.grade, "B");
  assert.equal(noHazards.quality.hazardsUsable, false);
  assert.equal(noHazards.quality.pinUsable, true);
  assert.equal(isLoadedHoleGeometry(noHazards), true);
  assert.equal(isLoadedHoleGeometry({
    ...noHazards,
    quality: { ...noHazards.quality, hazardsUsable: true },
  }), false);
  const pinWithoutGreen = normalizeOverpassHoleGeometry({ elements: payload.elements.filter((element) => element.id !== 3) }, 7, "osm-test");
  assert.equal(pinWithoutGreen.quality.pinUsable, false);
  assert.equal(isLoadedHoleGeometry(pinWithoutGreen), true);
  assert.equal(isLoadedHoleGeometry({
    ...noHazards,
    quality: { ...noHazards.quality, grade: "A", hazardsUsable: true },
  }), false);
  assert.equal(isLoadedHoleGeometry({
    ...noHazards,
    hole: {
      ...noHazards.hole,
      features: noHazards.hole.features.map((feature, index) => index === 0
        ? { ...feature, geometry: { type: "Point", coordinates: [181, 0] } }
        : feature),
    },
  }), false);

  const incomplete = normalizeOverpassHoleGeometry({ elements: [{ type: "way", id: 9, tags: { golf: "green" }, geometry: [{ lat: 41, lon: -87 }, { lat: 41.001, lon: -87 }, { lat: 41, lon: -87 }] }] }, 7);
  assert.equal(incomplete.quality.hazardsUsable, false);
  assert.deepEqual(incomplete.quality.missing, ["tee", "green", "aim path"]);
});

test("real-course projection is normalized, padded, and round-trips feature coordinates", () => {
  const loaded = normalizeOverpassHoleGeometry({
    elements: [
      { type: "way", id: 1, tags: { golf: "hole", ref: "1" }, geometry: [{ lat: 41, lon: -87 }, { lat: 41.01, lon: -86.99 }] },
      { type: "way", id: 2, tags: { golf: "tee" }, geometry: [{ lat: 41, lon: -87 }, { lat: 41, lon: -87.001 }, { lat: 41, lon: -87 }] },
      { type: "way", id: 3, tags: { golf: "green" }, geometry: [{ lat: 41.01, lon: -86.99 }, { lat: 41.011, lon: -86.99 }, { lat: 41.01, lon: -86.99 }] },
    ],
  }, 1);
  const projection = createGeometryProjection(loaded.hole.features);
  assert.ok(projection);
  const source: [number, number] = [-86.995, 41.005];
  const projected = projection.project(source);
  assert.ok(projected.x >= 0.08 && projected.x <= 0.92);
  assert.ok(projected.y >= 0.08 && projected.y <= 0.92);
  const roundTrip = projection.unproject(projected);
  assert.ok(Math.abs(roundTrip[0] - source[0]) < 1e-9);
  assert.ok(Math.abs(roundTrip[1] - source[1]) < 1e-9);
});

test("satellite and feature overlays share the same Web Mercator world transform", () => {
  const center = { lat: 36.578125, lon: -121.95741 };
  const centerPixel = webMercatorWorldPixel(center, 18, 256);
  const samePixel = webMercatorWorldPixel(center, 18, 256);
  assert.deepEqual(samePixel, centerPixel);

  const eastPixel = webMercatorWorldPixel({ lat: center.lat, lon: center.lon + 0.001 }, 18, 256);
  const northPixel = webMercatorWorldPixel({ lat: center.lat + 0.001, lon: center.lon }, 18, 256);
  assert.ok(eastPixel.x > centerPixel.x);
  assert.ok(northPixel.y < centerPixel.y);
  const roundTripCenter = webMercatorGeoPoint(centerPixel, 18, 256);
  assert.ok(Math.abs(roundTripCenter.lat - center.lat) < 1e-12);
  assert.ok(Math.abs(roundTripCenter.lon - center.lon) < 1e-12);
});

test("real pin placement accepts only taps inside the mapped green", () => {
  const green = {
    type: "Polygon",
    coordinates: [[[-87.001, 41], [-86.999, 41], [-86.999, 41.002], [-87.001, 41.002], [-87.001, 41]]],
  };
  assert.equal(isGeoPositionInsideGeometry([-87, 41.001], green), true);
  assert.equal(isGeoPositionInsideGeometry([-87.01, 41.001], green), false);
  const boundaryGreen = { type: "Polygon", coordinates: [[[-87.001, 41], [-87, 41], [-87, 41.001], [-87.001, 41]]] };
  assert.equal(isGeoPositionInsideGeometryOrBoundary([-87, 41.0005], boundaryGreen), true);
  assert.equal(isGeoPositionInsideGeometryOrBoundary([-87.00095, 41.0005], boundaryGreen), false);
});

test("camera pin estimate rejects weak observations and marks long locks low confidence", () => {
  assert.equal(estimateCameraPinDistance({ observedFlagPixels: 11, frameHeightPixels: 900 }), null);
  assert.deepEqual(
    estimateCameraPinDistance({ observedFlagPixels: 32, frameHeightPixels: 900 }),
    { yards: 144, confidence: "high" },
  );
  assert.deepEqual(
    estimateCameraPinDistance({ observedFlagPixels: 16, frameHeightPixels: 900 }),
    { yards: 289, confidence: "low" },
  );
});

test("personal course scorecards expose reviewed per-hole pars", () => {
  assert.equal(getPersonalCourseHolePar("personal-squaw-valley-lakes-pending-v1", 1), 4);
  assert.equal(getPersonalCourseHolePar("personal-squaw-valley-lakes-pending-v1", 2), 5);
  assert.equal(getPersonalCourseHolePar("personal-squaw-valley-links-osm-v1", 2), 3);
  assert.equal(getPersonalCourseHolePar("unknown", 1), undefined);
});

test("automatic green landing uses the first boundary crossing and one-yard inset", () => {
  const green = {
    type: "Polygon",
    coordinates: [[[-0.001, 0], [0.004, 0], [0.004, 0.01], [-0.001, 0.01], [-0.001, 0]]],
  } as const;
  const ball: [number, number] = [-0.01, 0.005];
  const pin: [number, number] = [0.003, 0.005];
  const landing = findAutomaticGreenLandingPoint(ball, pin, green);

  assert.ok(landing);
  assert.equal(isGeoPositionInsideGeometry(landing, green), true);
  const oneYardInDegrees = 1 / (111_320 * 1.093_613_3);
  assert.ok(Math.abs(landing[0] - (-0.001 + oneYardInDegrees)) < 1e-7);

  assert.equal(findAutomaticGreenLandingPoint(ball, [0.01, 0.005], green), undefined);
  assert.equal(findAutomaticGreenLandingPoint([-0.01, 0.02], [-0.005, 0.02], green), undefined);
});

test("automatic green landing does not skip a narrow earlier multipolygon crossing", () => {
  const green = {
    type: "MultiPolygon",
    coordinates: [
      [[[-0.00505, 0], [-0.00495, 0], [-0.00495, 0.01], [-0.00505, 0.01], [-0.00505, 0]]],
      [[[0.01, 0], [0.04, 0], [0.04, 0.01], [0.01, 0.01], [0.01, 0]]],
    ],
  } as const;
  const landing = findAutomaticGreenLandingPoint([-0.02, 0.005], [0.03, 0.005], green);

  assert.ok(landing);
  assert.ok(landing[0] > -0.00505 && landing[0] < -0.00495);

  const underOneYardGreen = {
    type: "MultiPolygon",
    coordinates: [
      [[[-0.005001, 0], [-0.005, 0], [-0.005, 0.01], [-0.005001, 0.01], [-0.005001, 0]]],
      [[[0.01, 0], [0.04, 0], [0.04, 0.01], [0.01, 0.01], [0.01, 0]]],
    ],
  } as const;
  assert.equal(findAutomaticGreenLandingPoint([-0.02, 0.005], [0.03, 0.005], underOneYardGreen), undefined);
});

test("automatic green landing follows a diagonal non-equatorial path for one yard", () => {
  const green = {
    type: "Polygon",
    coordinates: [[[-87, 41.0], [-86.98, 41.0], [-86.98, 41.02], [-87, 41.02], [-87, 41.0]]],
  } as const;
  const ball: [number, number] = [-87.01, 40.995];
  const pin: [number, number] = [-86.985, 41.015];
  const landing = findAutomaticGreenLandingPoint(ball, pin, green);

  assert.ok(landing);
  assert.ok(landing[0] > -87 && landing[1] > 41);
  const entry: [number, number] = [-87, 41.003];
  const latitudeOne = (entry[1] * Math.PI) / 180;
  const latitudeTwo = (landing[1] * Math.PI) / 180;
  const deltaLatitude = ((landing[1] - entry[1]) * Math.PI) / 180;
  const deltaLongitude = ((landing[0] - entry[0]) * Math.PI) / 180;
  const haversine = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(latitudeOne) * Math.cos(latitudeTwo) * Math.sin(deltaLongitude / 2) ** 2;
  const distanceYards = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)) * 6_371_000 * 1.093_613_3;
  assert.ok(Math.abs(distanceYards - 1) < 0.001);
});

test("real pin overrides persist only for the matching course, hole, and geometry revision", () => {
  const storage = new Map<string, string>();
  const position = [-97.7221, 32.2581] as [number, number];
  const record = {
    courseId: "personal-squaw-valley-lakes-pending-v1",
    holeNumber: 1,
    sourceVersion: "personal-osm-lakes-v1",
    position,
    updatedAt: "2026-08-30T00:00:00.000Z",
  };

  storePinOverride({ setItem: (key, value) => storage.set(key, value) }, record);
  assert.deepEqual(loadStoredPinOverride({ getItem: (key) => storage.get(key) ?? null }, record.courseId, 1, record.sourceVersion), position);
  assert.equal(loadStoredPinOverride({ getItem: (key) => storage.get(key) ?? null }, record.courseId, 1, "personal-osm-lakes-v2"), undefined);
  assert.equal(loadStoredPinOverride({ getItem: (key) => storage.get(key) ?? null }, record.courseId, 2, record.sourceVersion), undefined);
  assert.equal(storage.has(PIN_OVERRIDE_STORAGE_KEY), true);

  assert.equal(parseStoredPinOverrides(JSON.stringify({ version: 1, overrides: [{ ...record, position: [181, 32.2581] }] })), undefined);
  assert.equal(parseStoredPinOverrides(JSON.stringify({ version: 1, overrides: [{ ...record }, { ...record }] })), undefined);
  assert.equal(parseStoredPinOverrides("not-json"), undefined);

  removeStoredPinOverride({ getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, record.courseId, 1, record.sourceVersion);
  assert.equal(loadStoredPinOverride({ getItem: (key) => storage.get(key) ?? null }, record.courseId, 1, record.sourceVersion), undefined);
});

test("geometry ownership derives from numbered anchors when no hole way exists", () => {
  const loaded = normalizeOverpassHoleGeometry({
    elements: [
      { type: "way", id: 10, tags: { golf: "tee", ref: "1" }, geometry: [{ lat: 41, lon: -87 }, { lat: 41, lon: -87.001 }, { lat: 41, lon: -87 }] },
      { type: "way", id: 11, tags: { golf: "green", ref: "1" }, geometry: [{ lat: 41.01, lon: -86.99 }, { lat: 41.011, lon: -86.99 }, { lat: 41.01, lon: -86.99 }] },
      { type: "way", id: 12, tags: { golf: "fairway", ref: "1" }, geometry: [{ lat: 41, lon: -87 }, { lat: 41.01, lon: -86.99 }] },
      { type: "way", id: 13, tags: { golf: "bunker" }, geometry: [{ lat: 41.005, lon: -86.995 }, { lat: 41.006, lon: -86.995 }, { lat: 41.005, lon: -86.995 }] },
      { type: "way", id: 14, tags: { golf: "bunker" }, geometry: [{ lat: 41.1, lon: -86.9 }, { lat: 41.101, lon: -86.9 }, { lat: 41.1, lon: -86.9 }] },
    ],
  }, 1);
  assert.equal(loaded.quality.status, "complete");
  assert.equal(loaded.hole.features.some((feature) => feature.sourceId === "14"), false);
  assert.equal(loaded.hole.features.some((feature) => feature.sourceId === "13"), true);
  assert.equal(loaded.quality.hazardsUsable, true);
});

test("geometry ownership keeps unnumbered features with their nearest numbered hole", () => {
  const loaded = normalizeOverpassHoleGeometry({
    elements: [
      { type: "way", id: 101, tags: { golf: "hole", ref: "1" }, geometry: [{ lat: 41, lon: -87 }, { lat: 41, lon: -86.999 }] },
      { type: "way", id: 102, tags: { golf: "hole", ref: "2" }, geometry: [{ lat: 41, lon: -86.99 }, { lat: 41, lon: -86.989 }] },
      { type: "way", id: 103, tags: { golf: "tee" }, geometry: [{ lat: 41, lon: -87 }, { lat: 41, lon: -87.0001 }, { lat: 41, lon: -87 }] },
      { type: "way", id: 104, tags: { golf: "green" }, geometry: [{ lat: 41, lon: -86.999 }, { lat: 41.0001, lon: -86.999 }, { lat: 41, lon: -86.999 }] },
      { type: "way", id: 105, tags: { golf: "fairway" }, geometry: [{ lat: 41, lon: -87 }, { lat: 41, lon: -86.999 }] },
      { type: "way", id: 106, tags: { golf: "bunker" }, geometry: [{ lat: 41, lon: -86.9995 }, { lat: 41.0001, lon: -86.9995 }, { lat: 41, lon: -86.9995 }] },
      { type: "node", id: 107, lat: 41.00005, lon: -86.999, tags: { golf: "pin" } },
      { type: "way", id: 201, tags: { golf: "tee" }, geometry: [{ lat: 41, lon: -86.99 }, { lat: 41, lon: -86.9901 }, { lat: 41, lon: -86.99 }] },
      { type: "way", id: 202, tags: { golf: "green" }, geometry: [{ lat: 41, lon: -86.989 }, { lat: 41.0001, lon: -86.989 }, { lat: 41, lon: -86.989 }] },
      { type: "way", id: 203, tags: { golf: "fairway" }, geometry: [{ lat: 41, lon: -86.99 }, { lat: 41, lon: -86.989 }] },
      { type: "way", id: 204, tags: { golf: "bunker" }, geometry: [{ lat: 41, lon: -86.9895 }, { lat: 41.0001, lon: -86.9895 }, { lat: 41, lon: -86.9895 }] },
      { type: "node", id: 205, lat: 41.00005, lon: -86.989, tags: { golf: "pin" } },
    ],
  }, 1);
  assert.equal(loaded.quality.grade, "A");
  assert.deepEqual(loaded.hole.features.map((feature) => feature.sourceId), ["101", "103", "104", "105", "106", "107"]);
  assert.equal(loaded.hole.features.some((feature) => feature.sourceId === "201"), false);
  assert.equal(loaded.hole.features.some((feature) => feature.sourceId === "205"), false);
});

test("geometry ownership with a numbered centerline withholds distant unnumbered hazards", () => {
  const loaded = normalizeOverpassHoleGeometry({
    elements: [
      { type: "way", id: 301, tags: { golf: "hole", ref: "1" }, geometry: [{ lat: 41, lon: -87 }, { lat: 41.01, lon: -86.99 }] },
      { type: "way", id: 302, tags: { golf: "tee" }, geometry: [{ lat: 41, lon: -87 }, { lat: 41, lon: -87.0001 }, { lat: 41, lon: -87 }] },
      { type: "way", id: 303, tags: { golf: "green" }, geometry: [{ lat: 41.01, lon: -86.99 }, { lat: 41.0101, lon: -86.99 }, { lat: 41.01, lon: -86.99 }] },
      { type: "way", id: 304, tags: { golf: "bunker" }, geometry: [{ lat: 41.005, lon: -86.995 }, { lat: 41.0051, lon: -86.995 }, { lat: 41.005, lon: -86.995 }] },
      { type: "way", id: 305, tags: { golf: "bunker" }, geometry: [{ lat: 41.04, lon: -86.965 }, { lat: 41.0401, lon: -86.965 }, { lat: 41.04, lon: -86.965 }] },
      { type: "node", id: 306, lat: 41.04, lon: -86.965, tags: { golf: "pin" } },
    ],
  }, 1, "osm-test");

  assert.equal(loaded.hole.features.some((feature) => feature.sourceId === "304"), true);
  assert.equal(loaded.hole.features.some((feature) => feature.sourceId === "305"), false);
  assert.equal(loaded.hole.features.some((feature) => feature.sourceId === "306"), false);
  assert.equal(loaded.quality.hazardsUsable, true);
});

test("explicit Overpass layout selection prevents two local courses from being mixed", () => {
  const payload = {
    elements: [
      { type: "way", id: 101, tags: { golf: "tee", ref: "1" }, geometry: [{ lat: 32, lon: -97 }, { lat: 32, lon: -97.0001 }, { lat: 32, lon: -97 }] },
      { type: "way", id: 102, tags: { golf: "fairway", ref: "1" }, geometry: [{ lat: 32, lon: -97 }, { lat: 32, lon: -96.99 }] },
      { type: "way", id: 103, tags: { golf: "green", ref: "1" }, geometry: [{ lat: 32, lon: -96.99 }, { lat: 32.0001, lon: -96.99 }, { lat: 32, lon: -96.99 }] },
      { type: "way", id: 104, tags: { golf: "bunker" }, geometry: [{ lat: 32.005, lon: -96.995 }, { lat: 32.0051, lon: -96.995 }, { lat: 32.005, lon: -96.995 }] },
      { type: "way", id: 201, tags: { golf: "hole", ref: "1" }, geometry: [{ lat: 32.1, lon: -97.1 }, { lat: 32.1, lon: -97.09 }] },
      { type: "way", id: 202, tags: { golf: "tee" }, geometry: [{ lat: 32.1, lon: -97.1 }, { lat: 32.1, lon: -97.1001 }, { lat: 32.1, lon: -97.1 }] },
      { type: "way", id: 203, tags: { golf: "fairway" }, geometry: [{ lat: 32.1, lon: -97.1 }, { lat: 32.1, lon: -97.09 }] },
      { type: "way", id: 204, tags: { golf: "green" }, geometry: [{ lat: 32.1, lon: -97.09 }, { lat: 32.1001, lon: -97.09 }, { lat: 32.1, lon: -97.09 }] },
      { type: "way", id: 205, tags: { golf: "bunker" }, geometry: [{ lat: 32.1, lon: -97.095 }, { lat: 32.1001, lon: -97.095 }, { lat: 32.1, lon: -97.095 }] },
      { type: "node", id: 206, tags: { golf: "pin" }, lat: 32.1, lon: -97.09 },
    ],
  };

  const links = normalizeOverpassHoleGeometry(payload, 1, "personal-osm-links-v2", "ref_features");
  assert.equal(links.quality.grade, "B");
  assert.equal(links.quality.hazardsUsable, true);
  assert.equal(links.quality.pinUsable, false);
  assert.equal(links.hole.features.some((feature) => feature.sourceId === "201"), false);
  assert.equal(links.hole.features.some((feature) => feature.sourceId === "104"), true);

  const lakes = normalizeOverpassHoleGeometry(payload, 1, "personal-osm-lakes-v1", "hole_centerlines");
  assert.equal(lakes.quality.grade, "A");
  assert.equal(lakes.quality.pinUsable, true);
  assert.equal(lakes.hole.features.some((feature) => feature.sourceId === "101"), false);
  assert.equal(lakes.hole.features.some((feature) => feature.sourceId === "205"), true);
});

test("hole-centerline layout repairs a missing layer from the matching referenced feature", () => {
  const loaded = normalizeOverpassHoleGeometry({
    elements: [
      { type: "way", id: 301, tags: { golf: "hole", ref: "1" }, geometry: [{ lat: 32, lon: -97 }, { lat: 32.01, lon: -96.99 }] },
      { type: "way", id: 302, tags: { golf: "tee", ref: "1" }, geometry: [{ lat: 32, lon: -97 }, { lat: 31.9999, lon: -97 }, { lat: 32, lon: -97 }] },
      { type: "way", id: 303, tags: { golf: "fairway", ref: "1" }, geometry: [{ lat: 32, lon: -97 }, { lat: 32.01, lon: -96.99 }] },
      { type: "way", id: 304, tags: { golf: "green", ref: "1" }, geometry: [{ lat: 32.01, lon: -96.99 }, { lat: 32.0101, lon: -96.99 }, { lat: 32.01, lon: -96.99 }] },
      { type: "way", id: 305, tags: { golf: "bunker" }, geometry: [{ lat: 32.005, lon: -96.995 }, { lat: 32.0051, lon: -96.995 }, { lat: 32.005, lon: -96.995 }] },
      { type: "node", id: 306, tags: { golf: "pin" }, lat: 32.01, lon: -96.99 },
    ],
  }, 1, "osm-test", "hole_centerlines");

  assert.equal(loaded.quality.grade, "A");
  assert.equal(loaded.quality.hazardsUsable, true);
  assert.equal(loaded.quality.pinUsable, true);
  assert.equal(loaded.hole.features.some((feature) => feature.sourceId === "304"), true);
});

test("geometry cache manifests reject duplicate keys and loader verifies artifact checksums", async () => {
  const loaded = normalizeOverpassHoleGeometry({
    elements: [
      { type: "way", id: 1, tags: { golf: "hole", ref: "1" }, geometry: [{ lat: 41, lon: -87 }, { lat: 41.01, lon: -86.99 }] },
      { type: "way", id: 2, tags: { golf: "tee", ref: "1" }, geometry: [{ lat: 41, lon: -87 }, { lat: 41, lon: -87.001 }, { lat: 41, lon: -87 }] },
      { type: "way", id: 3, tags: { golf: "green", ref: "1" }, geometry: [{ lat: 41.01, lon: -86.99 }, { lat: 41.011, lon: -86.99 }, { lat: 41.01, lon: -86.99 }] },
    ],
  }, 1, "v2.1.0");
  const artifact = geometryCacheArtifact("course-1", 1, "v2.1.0");
  const artifactText = `${JSON.stringify(loaded, null, 2)}\n`;
  assert.equal(await sha256Hex(artifactText.replaceAll("\n", "\r\n")), await sha256Hex(artifactText));
  const record = {
    key: geometryCacheKey("course-1", 1),
    courseId: "course-1",
    holeNumber: 1,
    artifact,
    sha256: await sha256Hex(artifactText),
    sourceVersion: loaded.sourceVersion,
    quality: loaded.quality,
    attribution: loaded.quality.attribution,
  };
  const manifest = {
    provider: "openstreetmap-overpass",
    version: "v2.1.0",
    generatedAt: "2026-08-28T00:00:00.000Z",
    attribution: loaded.quality.attribution,
    records: [record],
  };
  assert.equal(isGeometryCacheManifest(manifest), true);
  assert.equal(isGeometryCacheManifest({ ...manifest, records: [record, record] }), false);
  assert.equal(isGeometryCacheManifest({ ...manifest, records: [{ ...record, key: "wrong-key" }] }), false);
  assert.equal(isGeometryCacheManifest({ ...manifest, records: [{ ...record, artifact: "geometry/../escape/hole-1.json" }] }), false);
  const fetcher = async (url: string) => ({
    status: 200,
    ok: true,
    json: async () => manifest,
    text: async () => artifactText,
  }) as unknown as Response;
  const restored = await fetchBundledHoleGeometry("course-1", 1, fetcher);
  assert.equal(restored?.sourceVersion, "v2.1.0");
  assert.deepEqual(restored?.hole.features.map((feature) => feature.kind), ["centerline", "tee", "green"]);
});

test("countRecordedStrokes counts scoring strokes per hole and ignores observations", () => {
  const events: RoundEvent[] = [
    { id: "e1", kind: "gps_shot", holeNumber: 1, sequence: 1, clubId: "club-1", clubName: "Driver", distanceYards: 240, strokes: 1, evidence: "total_gps", createdAt: "2026-08-31T00:00:00.000Z" },
    { id: "e2", kind: "missed_tracked_shot", holeNumber: 1, sequence: 2, clubId: null, clubName: null, distanceYards: null, strokes: 0, evidence: "manual", createdAt: "2026-08-31T00:01:00.000Z" },
    { id: "e3", kind: "manual_shot", holeNumber: 1, sequence: 3, clubId: "club-14", clubName: "Putter", distanceYards: null, strokes: 1, evidence: "manual", createdAt: "2026-08-31T00:02:00.000Z" },
    { id: "e4", kind: "penalty_stroke", holeNumber: 1, sequence: 4, clubId: null, clubName: null, distanceYards: null, strokes: 1, evidence: "manual", createdAt: "2026-08-31T00:03:00.000Z" },
    { id: "e5", kind: "gps_shot", holeNumber: 2, sequence: 5, clubId: "club-1", clubName: "Driver", distanceYards: 230, strokes: 1, evidence: "total_gps", createdAt: "2026-08-31T00:04:00.000Z" },
  ];
  assert.equal(countRecordedStrokes(events, 1), 3);
  assert.equal(countRecordedStrokes(events, 2), 1);
  assert.equal(countRecordedStrokes(events, 3), 0);
});
