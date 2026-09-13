import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ON_COURSE_WEATHER,
  ON_COURSE_STORAGE_KEY,
  createDefaultOnCourseState,
  loadOnCourseState,
  projectRuleOf12,
  projectOnCourseState,
  recommendPitchClubId,
  reduceOnCourseState,
  saveOnCourseState,
  type OnCourseConditions,
  type OnCourseIdentity,
  type OnCourseState,
} from "../src/openroundOnCourseModel.ts";
import { createMemoryOnCourseStorage } from "../src/openroundOnCoursePersistence.ts";
import { createOpenMeteoWeatherPort } from "../src/openroundOnCourseWeather.ts";
import { createDefaultEquipment, type RoundEvent, type RoundLog } from "../src/openroundModel.ts";
import { loadRounds, saveRounds, roundTotals, type SavedRound } from "../src/openroundRounds.ts";

const identity: OnCourseIdentity = { roundId: "demo:7", courseId: "demo", holeNumber: 7 };
const conditions: OnCourseConditions = {
  windMph: 10,
  windDirection: "headwind",
  elevationYards: 5,
  temperatureF: 50,
};

function gpsEvent(overrides: Partial<RoundEvent> = {}): RoundEvent {
  return {
    id: "event-gps-1",
    kind: "gps_shot",
    holeNumber: 7,
    sequence: 1,
    clubId: "club-1",
    clubName: "Driver",
    distanceYards: 258,
    strokes: 1,
    evidence: "total_gps",
    createdAt: "2026-08-30T12:00:00.000Z",
    ...overrides,
  };
}

function emptyLog(events: RoundEvent[] = []): RoundLog {
  return {
    version: 1,
    roundId: identity.roundId,
    courseId: identity.courseId,
    holeNumber: identity.holeNumber,
    score: 5,
    events,
  };
}

test("the deep seam creates a complete deterministic default and round-scoped persistence record", () => {
  const state = createDefaultOnCourseState(identity);
  assert.equal(ON_COURSE_STORAGE_KEY, "openround:on-course:v1");
  assert.deepEqual(state, {
    version: 1,
    ...identity,
    mapLayer: "satellite",
    greenMapMode: "off",
    distanceArcs: true,
    blindShot: false,
    autoZoom: true,
    lie: "fairway",
    conditions: { windMph: 8, windDirection: "crosswind", elevationYards: 2, temperatureF: 72 },
    weather: DEFAULT_ON_COURSE_WEATHER,
    targets: { birdies: 2, pars: 10, gir: 10, fairways: 8 },
    holes: [],
    missDetails: [],
    shotSamples: [],
  });

  const storage = createMemoryOnCourseStorage({ "other-key": "preserve" });
  saveOnCourseState(storage, state);
  assert.equal(storage.getItem("other-key"), "preserve");
  assert.deepEqual(loadOnCourseState(storage, identity), state);
});

test("malformed or stale storage fails closed without touching unrelated local data", () => {
  const storage = createMemoryOnCourseStorage({ "other-key": "preserve" });
  const valid = createDefaultOnCourseState(identity);
  storage.setItem(ON_COURSE_STORAGE_KEY, "not-json");
  assert.deepEqual(loadOnCourseState(storage, identity), valid);

  storage.setItem(ON_COURSE_STORAGE_KEY, JSON.stringify({ ...valid, mapLayer: "terrain" }));
  assert.deepEqual(loadOnCourseState(storage, identity), valid);

  storage.setItem(ON_COURSE_STORAGE_KEY, JSON.stringify({
    ...valid,
    roundId: "another-round",
    conditions: { ...valid.conditions, windMph: 99 },
  }));
  assert.deepEqual(loadOnCourseState(storage, identity), valid);
  assert.equal(storage.getItem("other-key"), "preserve");
});

test("reducer owns overlay, condition, target, and reset transitions immutably", () => {
  const initial = createDefaultOnCourseState(identity);
  const next = reduceOnCourseState(initial, { type: "set-map-layer", layer: "illustration" });
  const withOverlays = reduceOnCourseState(next, { type: "set-green-map", mode: "approach" });
  const withToggles = reduceOnCourseState(
    reduceOnCourseState(
      reduceOnCourseState(withOverlays, { type: "toggle-distance-arcs" }),
      { type: "toggle-blind-shot" },
    ),
    { type: "toggle-auto-zoom" },
  );
  const withConditions = reduceOnCourseState(withToggles, { type: "set-conditions", conditions });
  const withLie = reduceOnCourseState(withConditions, { type: "set-lie", lie: "rough" });
  const withTargets = reduceOnCourseState(withLie, { type: "adjust-target", target: "birdies", delta: 3 });

  assert.equal(initial.mapLayer, "satellite");
  assert.equal(withTargets.mapLayer, "illustration");
  assert.equal(withTargets.greenMapMode, "approach");
  assert.equal(withTargets.distanceArcs, false);
  assert.equal(withTargets.blindShot, true);
  assert.equal(withTargets.autoZoom, false);
  assert.deepEqual(withTargets.conditions, conditions);
  assert.equal(withTargets.lie, "rough");
  assert.equal(withTargets.targets.birdies, 5);

  const withLiveWeather = reduceOnCourseState(withConditions, {
    type: "set-weather",
    weather: { ...DEFAULT_ON_COURSE_WEATHER, source: "live", temperatureF: 50, windMph: 16 },
    syncConditions: true,
  });
  assert.equal(withLiveWeather.weather.source, "live");
  assert.equal(withLiveWeather.conditions.windMph, 16);
  assert.equal(withLiveWeather.conditions.temperatureF, 50);

  const reset = reduceOnCourseState(withTargets, { type: "reset", identity: { ...identity, holeNumber: 8, roundId: "demo:8" }, conditions });
  assert.equal(reset.roundId, "demo:8");
  assert.equal(reset.holeNumber, 8);
  assert.deepEqual(reset.conditions, conditions);
  assert.equal(reset.mapLayer, "satellite");
  assert.notEqual(reset, withTargets);
});

test("GPS sample creation is reducer-owned, excludes manual events, and save-to-bag is explicit", () => {
  const equipment = createDefaultEquipment();
  const automatic = gpsEvent();
  let state = createDefaultOnCourseState(identity);
  state = reduceOnCourseState(state, { type: "record-gps-event", event: automatic, equipment });
  assert.equal(state.shotSamples.length, 1);
  assert.equal(state.shotSamples[0]?.kind, "automatic_drive");
  assert.equal(state.shotSamples[0]?.savedToBag, false);
  assert.equal(state.shotSamples[0]?.yards, 258);

  state = reduceOnCourseState(state, {
    type: "record-gps-event",
    event: gpsEvent({ id: "manual", kind: "manual_shot", evidence: "manual", distanceYards: null }),
    equipment,
  });
  state = reduceOnCourseState(state, {
    type: "record-gps-event",
    event: gpsEvent({ id: "invalid-gps", distanceYards: null }),
    equipment,
  });
  assert.equal(state.shotSamples.length, 1);

  const saved = reduceOnCourseState(state, { type: "save-shot-to-bag", sampleId: state.shotSamples[0]!.id });
  assert.equal(saved.shotSamples[0]?.savedToBag, true);
  assert.equal(state.shotSamples[0]?.savedToBag, false);
});

test("projection centralizes plays-like math, recommendations, advice, planner, and review data", () => {
  const equipment = createDefaultEquipment();
  let state = createDefaultOnCourseState(identity, conditions);
  state = reduceOnCourseState(state, { type: "record-gps-event", event: gpsEvent(), equipment });
  state = reduceOnCourseState(state, {
    type: "record-hole-outcome",
    outcome: {
      holeNumber: 7,
      par: 4,
      score: 3,
      putts: 2,
      gir: true,
      fairway: true,
      missDetails: [],
      updatedAt: "2026-08-30T12:00:00.000Z",
    },
  });
  state = reduceOnCourseState(state, {
    type: "add-miss-detail",
    detail: {
      id: "miss-7-1",
      holeNumber: 7,
      target: "green",
      direction: "short",
      lie: "rough",
      createdAt: "2026-08-30T12:00:00.000Z",
    },
  });

  const projection = projectOnCourseState(state, {
    identity,
    baseTargetYards: 160,
    signedOffsetYards: -4,
    par: 4,
    roundLog: emptyLog([gpsEvent(), { ...gpsEvent(), id: "penalty", kind: "penalty_stroke", clubId: null, clubName: null, distanceYards: null, evidence: "manual", sequence: 2 }]),
    equipment,
    hazards: [
      { id: "bunker-left", label: "Left bunker", kind: "bunker", distanceYards: 245, direction: "left" },
      { id: "water-right", label: "Right water", kind: "water", distanceYards: 258, direction: "right" },
    ],
  });

  assert.equal(projection.conditionAdjustmentYards, 13);
  assert.equal(projection.playsLikeYards, 173);
  assert.equal(projection.currentTargetYards, 173);
  assert.equal(projection.autoZoomActive, true);
  assert.equal(projection.clubRecommendation?.source, "bag carry");
  assert.equal(projection.coachAdvice.title, "FAIRWAY LIE");
  assert.deepEqual(projection.blindShotGuide, { distanceYards: 173, signedOffsetYards: -4, callout: "173 YD · 4 LEFT" });
  assert.deepEqual(projection.teeShotPlan.avoidZones, ["LEFT BUNKER", "RIGHT WATER"]);
  assert.equal(projection.trackedShotReview?.id, "sample-event-gps-1");
  assert.equal(projection.holeInsights.scoreToPar, -1);
  assert.equal(projection.holeInsights.misses, 1);
  assert.equal(projection.roundStats.measuredShots, 1);
  assert.equal(projection.roundStats.penalties, 1);
  assert.equal(projection.targetProgress.birdies, 1);
});

test("projection recommendations use saved sample medians and exclude retired clubs", () => {
  const equipment = createDefaultEquipment();
  let state = createDefaultOnCourseState(identity, { windMph: 0, windDirection: "crosswind", elevationYards: 0, temperatureF: 72 });
  state = reduceOnCourseState(state, {
    type: "record-gps-event",
    event: gpsEvent({ id: "3w-a", clubId: "club-2", clubName: "3 Wood", distanceYards: 230 }),
    equipment,
  });
  state = reduceOnCourseState(state, { type: "save-shot-to-bag", sampleId: "sample-3w-a" });
  const retired = equipment.map((club) => club.id === "club-2" ? { ...club, status: "retired" as const } : club);
  const projection = projectOnCourseState(state, {
    identity,
    baseTargetYards: 231,
    signedOffsetYards: 0,
    par: 4,
    roundLog: emptyLog(),
    equipment: retired,
    hazards: [],
  });
  assert.notEqual(projection.clubRecommendation?.clubId, "club-2");
  assert.equal(projection.clubRecommendation?.source, "bag carry");
});

test("tailwind and downhill adjustments stay negative while plays-like distance stays nonnegative", () => {
  const state = createDefaultOnCourseState(identity, {
    windMph: 10, windDirection: "tailwind", elevationYards: -5, temperatureF: 72,
  });
  const project = (baseTargetYards: number) => projectOnCourseState(state, {
    identity, baseTargetYards, signedOffsetYards: 0, par: 4,
    roundLog: emptyLog(), equipment: createDefaultEquipment(), hazards: [],
  });
  assert.equal(project(150).conditionAdjustmentYards, -9);
  assert.equal(project(150).playsLikeYards, 141);
  assert.equal(project(5).conditionAdjustmentYards, -9);
  assert.equal(project(5).playsLikeYards, 0);
});

test("putt totals require every scored hole and reject putts exceeding the hole score", () => {
  const initial = createDefaultOnCourseState(identity);
  const first = {
    holeNumber: 7,
    par: 4,
    score: 4,
    putts: 2,
    gir: null,
    fairway: null,
    missDetails: [],
    updatedAt: "2026-08-30T12:00:00.000Z",
  };
  const invalid = { ...first, putts: 5 };
  assert.equal(reduceOnCourseState(initial, { type: "record-hole-outcome", outcome: invalid }), initial);
  const storage = createMemoryOnCourseStorage();
  saveOnCourseState(storage, { ...initial, holes: [invalid] });
  assert.deepEqual(loadOnCourseState(storage, identity), initial);

  const projectPutts = (state: OnCourseState) => projectOnCourseState(state, {
    identity,
    baseTargetYards: 150,
    signedOffsetYards: 0,
    par: 4,
    roundLog: emptyLog(),
    equipment: createDefaultEquipment(),
    hazards: [],
  }).roundStats.putts;
  let state = reduceOnCourseState(initial, { type: "record-hole-outcome", outcome: first });
  assert.equal(projectPutts(initial), null);
  assert.equal(projectPutts(state), 2);
  state = reduceOnCourseState(state, { type: "record-hole-outcome", outcome: { ...first, holeNumber: 8, putts: null } });
  assert.equal(projectPutts(state), null);
  state = reduceOnCourseState(state, { type: "record-hole-outcome", outcome: { ...first, holeNumber: 8, putts: 0 } });
  assert.equal(projectPutts(state), 2);
});

test("Rule of 12 projects level and slope-adjusted clubs", () => {
  const equipment = createDefaultEquipment();

  assert.deepEqual(projectRuleOf12({ carryYards: 8, rolloutYards: 32, slope: "level", equipment }), {
    clubId: "club-8",
    clubName: "8 Iron",
    carryYards: 8,
    rolloutYards: 32,
    ratio: 4,
  });
  assert.equal(projectRuleOf12({ carryYards: 8, rolloutYards: 32, slope: "uphill", equipment })?.clubName, "7 Iron");
  assert.equal(projectRuleOf12({ carryYards: 8, rolloutYards: 32, slope: "downhill", equipment })?.clubName, "9 Iron");

  const withoutEightIron = equipment.map((club) => club.name === "8 Iron" ? { ...club, status: "retired" as const } : club);
  assert.equal(projectRuleOf12({ carryYards: 8, rolloutYards: 32, slope: "level", equipment: withoutEightIron })?.clubName, "9 Iron");
});

test("Rule of 12 fails closed outside its supported shot", () => {
  const equipment = createDefaultEquipment();

  for (const [carryYards, rolloutYards] of [[0, 32], [8, 0], [8, 8], [8, 56], [Number.NaN, 32]]) {
    assert.equal(projectRuleOf12({ carryYards, rolloutYards, slope: "level", equipment }), undefined);
  }
  assert.equal(projectRuleOf12({
    carryYards: 8,
    rolloutYards: 32,
    slope: "level",
    equipment: equipment.map((club) => ({ ...club, status: "retired" as const })),
  }), undefined);
});

test("short-game pitch fallback avoids lob wedge until standard pitch clubs are unavailable", () => {
  const equipment = createDefaultEquipment();

  assert.equal(recommendPitchClubId(equipment), "sw");
  assert.equal(recommendPitchClubId(
    equipment.map((club) => club.name === "Sand Wedge" ? { ...club, status: "retired" as const } : club),
  ), "gw");
  assert.equal(recommendPitchClubId(
    equipment.map((club) => ["Sand Wedge", "Gap Wedge", "Pitching Wedge"].includes(club.name)
      ? { ...club, status: "retired" as const }
      : club),
  ), "lw");
  assert.equal(recommendPitchClubId(
    equipment.map((club) => club.type === "wedge" ? { ...club, status: "retired" as const } : club),
  ), undefined);
});

test("historical club samples drive recommendations without replacing current-round review", () => {
  const equipment = createDefaultEquipment();
  const state = reduceOnCourseState(createDefaultOnCourseState(identity), {
    type: "record-gps-event",
    event: gpsEvent({ id: "current", clubId: "club-1", clubName: "Driver", distanceYards: 258 }),
    equipment,
  });
  const historical = [
    {
      id: "sample-history",
      eventId: "history",
      holeNumber: 3,
      clubId: "club-6",
      clubName: "6 Iron",
      yards: 166,
      kind: "gps" as const,
      savedToBag: true,
      createdAt: "2026-08-29T12:00:00.000Z",
    },
  ];
  const projection = projectOnCourseState(state, {
    identity,
    baseTargetYards: 165,
    signedOffsetYards: 0,
    par: 4,
    roundLog: emptyLog(),
    equipment,
    hazards: [],
    clubStatisticSamples: historical,
  });

  assert.equal(projection.clubRecommendation?.clubId, "club-6");
  assert.equal(projection.clubRecommendation?.source, "tracked sample");
  assert.equal(projection.trackedShotReview?.id, "sample-current");
});

test("Open-Meteo is an injectable weather port with bounded normalized output", async () => {
  let requestedUrl = "";
  const port = createOpenMeteoWeatherPort(async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        current: { temperature_2m: 68.4, wind_speed_10m: 11.2, weather_code: 2 },
        daily: { temperature_2m_max: [75.5], temperature_2m_min: [57.1] },
      }),
    } as Response;
  });
  const snapshot = await port({ lat: 33.123456, lon: -97.987654 });
  assert.match(requestedUrl, /latitude=33\.12346/);
  assert.match(requestedUrl, /longitude=-97\.98765/);
  assert.deepEqual({
    source: snapshot.source,
    temperatureF: snapshot.temperatureF,
    highF: snapshot.highF,
    lowF: snapshot.lowF,
    windMph: snapshot.windMph,
    windDirection: snapshot.windDirection,
    condition: snapshot.condition,
  }, {
    source: "live",
    temperatureF: 68,
    highF: 76,
    lowF: 57,
    windMph: 11,
    windDirection: "crosswind",
    condition: "Partly cloudy",
  });

  const invalidPort = createOpenMeteoWeatherPort(async () => ({ ok: true, json: async () => ({}) } as Response));
  await assert.rejects(() => invalidPort({ lat: 99, lon: 0 }));
});

test("a provided fallback condition set hydrates defaults without changing the fixture weather", () => {
  const storage = createMemoryOnCourseStorage();
  const loaded = loadOnCourseState(storage, identity, conditions);
  assert.deepEqual(loaded.conditions, conditions);
  assert.equal(loaded.weather.source, "fixture");
  assert.notEqual(loaded, createDefaultOnCourseState(identity));
});

test("storage failures are isolated from foreground model behavior", () => {
  const failingStorage = {
    getItem: () => { throw new Error("read failed"); },
    setItem: () => { throw new Error("write failed"); },
  };
  const loaded = loadOnCourseState(failingStorage, identity);
  assert.equal(loaded.roundId, identity.roundId);
  assert.doesNotThrow(() => saveOnCourseState(failingStorage, loaded));
});

test("round archive rejects cross-hole records and does not turn shot drafts into scores", () => {
  const storage = createMemoryOnCourseStorage();
  const log = emptyLog([gpsEvent()]);
  const round: SavedRound = {
    id: "round-1", courseId: identity.courseId, courseName: "Test course", teeBox: "blue",
    startedAt: "2026-09-08T12:00:00Z", endedAt: null, golfers: [],
    holes: [{ holeNumber: 7, session: JSON.stringify(log), log, onCourse: createDefaultOnCourseState(identity), friendScores: {} }],
  };
  assert.equal(saveRounds(storage, [round]), true);
  assert.deepEqual(loadRounds(storage, () => true), [round]);
  assert.deepEqual(roundTotals(round), { holes: 0, score: 0, putts: null, gpsShots: 1 });
  round.holes[0]!.onCourse.holeNumber = 8;
  saveRounds(storage, [round]);
  assert.deepEqual(loadRounds(storage, () => true), []);
  assert.equal(saveRounds({ getItem: () => null, setItem: () => { throw new Error("full"); } }, [round]), false);
});
