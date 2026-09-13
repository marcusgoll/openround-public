import {
  EQUIPMENT_SLOT_TO_CLUB_ID,
  type ApproachClubId,
  type EquipmentClub,
  type RoundEvent,
  type RoundLog,
} from "./openroundModel.ts";
import type { OnCourseStorage } from "./openroundOnCoursePersistence.ts";

export type MapLayer = "satellite" | "illustration";
export type GreenMapMode = "off" | "approach" | "putt_breaks";
export type LieType = "tee" | "fairway" | "rough" | "bunker" | "recovery" | "green";
export type WindDirection = "crosswind" | "headwind" | "tailwind";
export type MissTarget = "fairway" | "green";
export type MissDirection = "left" | "right" | "short" | "long" | "wide";
export type WeatherSource = "live" | "cached" | "fixture";
export type ShotDistanceSampleKind = "gps" | "automatic_drive";

export type OnCourseConditions = {
  windMph: number;
  windDirection: WindDirection;
  elevationYards: number;
  temperatureF: number;
};

export type WeatherSnapshot = {
  source: WeatherSource;
  capturedAt: string;
  temperatureF: number;
  highF: number;
  lowF: number;
  windMph: number;
  windDirection: WindDirection;
  condition: string;
  forecast: string;
};

export type RoundTargets = {
  birdies: number;
  pars: number;
  gir: number;
  fairways: number;
};

export type MissDetail = {
  id: string;
  holeNumber: number;
  target: MissTarget;
  direction: MissDirection;
  lie: LieType;
  createdAt: string;
};

export type HoleOutcome = {
  holeNumber: number;
  par: number;
  score: number;
  putts: number | null;
  gir: boolean | null;
  fairway: boolean | null;
  missDetails: MissDetail[];
  updatedAt: string;
};

export type ShotDistanceSample = {
  id: string;
  eventId: string;
  holeNumber: number;
  clubId: string;
  clubName: string;
  yards: number;
  kind: ShotDistanceSampleKind;
  savedToBag: boolean;
  createdAt: string;
};

export type OnCourseState = {
  version: 1;
  roundId: string;
  courseId: string;
  holeNumber: number;
  mapLayer: MapLayer;
  greenMapMode: GreenMapMode;
  distanceArcs: boolean;
  blindShot: boolean;
  autoZoom: boolean;
  lie: LieType;
  conditions: OnCourseConditions;
  weather: WeatherSnapshot;
  targets: RoundTargets;
  holes: HoleOutcome[];
  missDetails: MissDetail[];
  shotSamples: ShotDistanceSample[];
};

export type ClubRecommendationSource = "tracked sample" | "bag carry";

export type ClubRecommendation = {
  clubId: string;
  clubName: string;
  distanceYards: number;
  source: ClubRecommendationSource;
};

export type RuleOf12Slope = "uphill" | "level" | "downhill";

export type RuleOf12Projection = {
  clubId: string;
  clubName: string;
  carryYards: number;
  rolloutYards: number;
  ratio: number;
};

export function projectRuleOf12({
  carryYards,
  rolloutYards,
  slope,
  equipment,
}: {
  carryYards: number;
  rolloutYards: number;
  slope: RuleOf12Slope;
  equipment: readonly EquipmentClub[];
}): RuleOf12Projection | undefined {
  if (!Number.isFinite(carryYards) || !Number.isFinite(rolloutYards) || carryYards <= 0 || rolloutYards <= 0) return undefined;
  const ratio = Math.round(rolloutYards / carryYards) + (slope === "uphill" ? 1 : slope === "downhill" ? -1 : 0);
  if (ratio < 2 || ratio > 6) return undefined;
  const nominalClubNumber = 12 - ratio;
  const club = equipment
    .filter((candidate) => candidate.status === "active")
    .map((candidate) => ({ candidate, id: EQUIPMENT_SLOT_TO_CLUB_ID[candidate.slot - 1] }))
    .filter(({ id }) => id === "6i" || id === "7i" || id === "8i" || id === "9i" || id === "pw")
    .map(({ candidate, id }) => ({ candidate, clubNumber: id === "pw" ? 10 : Number(id![0]) }))
    .sort((left, right) => Math.abs(left.clubNumber - nominalClubNumber) - Math.abs(right.clubNumber - nominalClubNumber) || right.clubNumber - left.clubNumber)[0]?.candidate;
  return club ? {
    clubId: club.id,
    clubName: club.name,
    carryYards: Math.round(carryYards),
    rolloutYards: Math.round(rolloutYards),
    ratio,
  } : undefined;
}

export function recommendPitchClubId(equipment: readonly EquipmentClub[]): ApproachClubId | undefined {
  return (["sw", "gw", "pw", "lw"] as const).find((clubId) => equipment.some((club) =>
    club.status === "active" && EQUIPMENT_SLOT_TO_CLUB_ID[club.slot - 1] === clubId));
}

export type CoachAdvice = {
  title: string;
  detail: string;
  cue: string;
};

export type BlindShotGuide = {
  distanceYards: number;
  signedOffsetYards: number;
  callout: string;
};

export type TeeShotHazard = {
  id: string;
  label: string;
  kind: "bunker" | "water" | "waste" | "out_of_bounds";
  distanceYards: number;
  direction: "left" | "right" | "center";
};

export type TeeShotPlan = {
  summary: string;
  avoidZones: string[];
  note: string;
};

export type HoleInsights = {
  holeNumber: number;
  par: number;
  score: number | null;
  scoreToPar: number | null;
  putts: number | null;
  gir: boolean | null;
  fairway: boolean | null;
  measuredShots: number;
  penalties: number;
  misses: number;
};

export type RoundStats = {
  holesPlayed: number;
  score: number;
  scoreToPar: number;
  putts: number | null;
  birdies: number;
  pars: number;
  gir: number;
  fairways: number;
  girKnown: number;
  fairwaysKnown: number;
  measuredShots: number;
  penalties: number;
  misses: number;
};

export type TargetProgress = RoundTargets;

export type OnCourseIdentity = {
  roundId: string;
  courseId: string;
  holeNumber: number;
};

export type OnCourseAction =
  | { type: "set-map-layer"; layer: MapLayer }
  | { type: "set-green-map"; mode: GreenMapMode }
  | { type: "toggle-distance-arcs" }
  | { type: "toggle-blind-shot" }
  | { type: "toggle-auto-zoom" }
  | { type: "set-lie"; lie: LieType }
  | { type: "set-conditions"; conditions: OnCourseConditions }
  | { type: "set-weather"; weather: WeatherSnapshot; syncConditions?: boolean }
  | { type: "adjust-target"; target: keyof RoundTargets; delta: number }
  | { type: "record-hole-outcome"; outcome: HoleOutcome }
  | { type: "add-miss-detail"; detail: MissDetail }
  | { type: "record-gps-event"; event: RoundEvent; equipment: readonly EquipmentClub[] }
  | { type: "save-shot-to-bag"; sampleId: string }
  | { type: "reset"; identity: OnCourseIdentity; conditions?: OnCourseConditions };

export type OnCourseProjectionInput = {
  identity: OnCourseIdentity;
  baseTargetYards: number | undefined;
  signedOffsetYards: number;
  par: number;
  roundLog: RoundLog;
  equipment: readonly EquipmentClub[];
  hazards: readonly TeeShotHazard[];
  trackedShotReviewId?: string | null;
  clubStatisticSamples?: readonly ShotDistanceSample[];
};

export type OnCourseProjection = {
  conditionAdjustmentYards: number;
  playsLikeYards: number | undefined;
  currentTargetYards: number | undefined;
  autoZoomActive: boolean;
  roundStats: RoundStats;
  holeInsights: HoleInsights;
  targetProgress: TargetProgress;
  clubRecommendation: ClubRecommendation | undefined;
  coachAdvice: CoachAdvice;
  blindShotGuide: BlindShotGuide;
  teeShotPlan: TeeShotPlan;
  trackedShotReview: ShotDistanceSample | undefined;
};

export const ON_COURSE_STORAGE_KEY = "openround:on-course:v1";
export const ON_COURSE_STATE_VERSION = 1 as const;
export const ON_COURSE_MAX_SHOT_SAMPLES = 400;
export const ON_COURSE_MAX_MISS_DETAILS = 200;
export const ON_COURSE_MAX_HOLE_OUTCOMES = 18;
export const DEFAULT_ON_COURSE_CONDITIONS: OnCourseConditions = {
  windMph: 8,
  windDirection: "crosswind",
  elevationYards: 2,
  temperatureF: 72,
};
export const DEFAULT_ON_COURSE_WEATHER: WeatherSnapshot = {
  source: "fixture",
  capturedAt: "2026-08-30T12:00:00.000Z",
  temperatureF: 72,
  highF: 78,
  lowF: 64,
  windMph: 8,
  windDirection: "crosswind",
  condition: "Partly cloudy",
  forecast: "Dry for the next 3 hours",
};
export const DEFAULT_ROUND_TARGETS: RoundTargets = {
  birdies: 2,
  pars: 10,
  gir: 10,
  fairways: 8,
};

const MAP_LAYERS: readonly MapLayer[] = ["satellite", "illustration"];
const GREEN_MAP_MODES: readonly GreenMapMode[] = ["off", "approach", "putt_breaks"];
const LIE_TYPES: readonly LieType[] = ["tee", "fairway", "rough", "bunker", "recovery", "green"];
const WIND_DIRECTIONS: readonly WindDirection[] = ["crosswind", "headwind", "tailwind"];
const MISS_TARGETS: readonly MissTarget[] = ["fairway", "green"];
const MISS_DIRECTIONS: readonly MissDirection[] = ["left", "right", "short", "long", "wide"];
const WEATHER_SOURCES: readonly WeatherSource[] = ["live", "cached", "fixture"];
const SAMPLE_KINDS: readonly ShotDistanceSampleKind[] = ["gps", "automatic_drive"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function isOptionalString(value: unknown, maximum: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maximum);
}

function isBoundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isIsoTimestamp(value: unknown): value is string {
  return isBoundedString(value, 80) && Number.isFinite(Date.parse(value));
}

function isMapLayer(value: unknown): value is MapLayer {
  return typeof value === "string" && MAP_LAYERS.includes(value as MapLayer);
}

function isGreenMapMode(value: unknown): value is GreenMapMode {
  return typeof value === "string" && GREEN_MAP_MODES.includes(value as GreenMapMode);
}

function isLieType(value: unknown): value is LieType {
  return typeof value === "string" && LIE_TYPES.includes(value as LieType);
}

function isWindDirection(value: unknown): value is WindDirection {
  return typeof value === "string" && WIND_DIRECTIONS.includes(value as WindDirection);
}

function isMissTarget(value: unknown): value is MissTarget {
  return typeof value === "string" && MISS_TARGETS.includes(value as MissTarget);
}

function isMissDirection(value: unknown): value is MissDirection {
  return typeof value === "string" && MISS_DIRECTIONS.includes(value as MissDirection);
}

function isWeatherSource(value: unknown): value is WeatherSource {
  return typeof value === "string" && WEATHER_SOURCES.includes(value as WeatherSource);
}

function isSampleKind(value: unknown): value is ShotDistanceSampleKind {
  return typeof value === "string" && SAMPLE_KINDS.includes(value as ShotDistanceSampleKind);
}

function isOnCourseConditions(value: unknown): value is OnCourseConditions {
  if (!isRecord(value)) return false;
  return isIntegerInRange(value.windMph, 0, 60)
    && isWindDirection(value.windDirection)
    && isIntegerInRange(value.elevationYards, -100, 100)
    && isIntegerInRange(value.temperatureF, -40, 140);
}

function isWeatherSnapshot(value: unknown): value is WeatherSnapshot {
  if (!isRecord(value)) return false;
  return isWeatherSource(value.source)
    && isIsoTimestamp(value.capturedAt)
    && isIntegerInRange(value.temperatureF, -40, 140)
    && isIntegerInRange(value.highF, -40, 160)
    && isIntegerInRange(value.lowF, -80, 140)
    && value.highF >= value.lowF
    && isIntegerInRange(value.windMph, 0, 60)
    && isWindDirection(value.windDirection)
    && isBoundedString(value.condition, 80)
    && isBoundedString(value.forecast, 160);
}

function isRoundTargets(value: unknown): value is RoundTargets {
  if (!isRecord(value)) return false;
  return isIntegerInRange(value.birdies, 0, 18)
    && isIntegerInRange(value.pars, 0, 18)
    && isIntegerInRange(value.gir, 0, 18)
    && isIntegerInRange(value.fairways, 0, 18);
}

function isMissDetail(value: unknown): value is MissDetail {
  if (!isRecord(value)) return false;
  return isBoundedString(value.id, 120)
    && isIntegerInRange(value.holeNumber, 1, 18)
    && isMissTarget(value.target)
    && isMissDirection(value.direction)
    && isLieType(value.lie)
    && isIsoTimestamp(value.createdAt);
}

function isHoleOutcome(value: unknown): value is HoleOutcome {
  if (!isRecord(value) || !Array.isArray(value.missDetails)) return false;
  return isIntegerInRange(value.holeNumber, 1, 18)
    && isIntegerInRange(value.par, 3, 6)
    && isIntegerInRange(value.score, 1, 20)
    && (value.putts === null || isIntegerInRange(value.putts, 0, value.score))
    && (value.gir === null || typeof value.gir === "boolean")
    && (value.fairway === null || typeof value.fairway === "boolean")
    && value.missDetails.length <= ON_COURSE_MAX_MISS_DETAILS
    && value.missDetails.every(isMissDetail)
    && isIsoTimestamp(value.updatedAt);
}

function isShotDistanceSample(value: unknown): value is ShotDistanceSample {
  if (!isRecord(value)) return false;
  return isBoundedString(value.id, 120)
    && isBoundedString(value.eventId, 120)
    && isIntegerInRange(value.holeNumber, 1, 18)
    && isBoundedString(value.clubId, 80)
    && isBoundedString(value.clubName, 80)
    && isBoundedNumber(value.yards, 1, 500)
    && isSampleKind(value.kind)
    && typeof value.savedToBag === "boolean"
    && isIsoTimestamp(value.createdAt);
}

export function createDefaultOnCourseState(
  identity: OnCourseIdentity,
  conditions: OnCourseConditions = DEFAULT_ON_COURSE_CONDITIONS,
): OnCourseState {
  return {
    version: ON_COURSE_STATE_VERSION,
    roundId: identity.roundId,
    courseId: identity.courseId,
    holeNumber: identity.holeNumber,
    mapLayer: "satellite",
    greenMapMode: "off",
    distanceArcs: true,
    blindShot: false,
    autoZoom: true,
    lie: "fairway",
    conditions: { ...conditions },
    weather: { ...DEFAULT_ON_COURSE_WEATHER },
    targets: { ...DEFAULT_ROUND_TARGETS },
    holes: [],
    missDetails: [],
    shotSamples: [],
  };
}

export function parseStoredOnCourseState(value: unknown): OnCourseState | undefined {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!isRecord(candidate)) return undefined;
  const state = candidate as Partial<OnCourseState>;
  if (
    state.version !== ON_COURSE_STATE_VERSION
    || !isBoundedString(state.roundId, 160)
    || !isBoundedString(state.courseId, 160)
    || !isIntegerInRange(state.holeNumber, 1, 18)
    || !isMapLayer(state.mapLayer)
    || !isGreenMapMode(state.greenMapMode)
    || typeof state.distanceArcs !== "boolean"
    || typeof state.blindShot !== "boolean"
    || typeof state.autoZoom !== "boolean"
    || !isLieType(state.lie)
    || !isOnCourseConditions(state.conditions)
    || !isWeatherSnapshot(state.weather)
    || !isRoundTargets(state.targets)
    || !Array.isArray(state.holes)
    || state.holes.length > ON_COURSE_MAX_HOLE_OUTCOMES
    || !state.holes.every(isHoleOutcome)
    || !Array.isArray(state.missDetails)
    || state.missDetails.length > ON_COURSE_MAX_MISS_DETAILS
    || !state.missDetails.every(isMissDetail)
    || !Array.isArray(state.shotSamples)
    || state.shotSamples.length > ON_COURSE_MAX_SHOT_SAMPLES
    || !state.shotSamples.every(isShotDistanceSample)
  ) {
    return undefined;
  }

  const holes = state.holes.map((hole) => ({ ...hole, missDetails: hole.missDetails.map((miss) => ({ ...miss })) }));
  const missDetails = state.missDetails.map((miss) => ({ ...miss }));
  const shotSamples = state.shotSamples.map((sample) => ({ ...sample }));
  if (new Set(holes.map((hole) => hole.holeNumber)).size !== holes.length) return undefined;
  if (new Set(missDetails.map((miss) => miss.id)).size !== missDetails.length) return undefined;
  if (new Set(shotSamples.map((sample) => sample.id)).size !== shotSamples.length) return undefined;
  if (new Set(shotSamples.map((sample) => sample.eventId)).size !== shotSamples.length) return undefined;

  return {
    version: ON_COURSE_STATE_VERSION,
    roundId: state.roundId,
    courseId: state.courseId,
    holeNumber: state.holeNumber,
    mapLayer: state.mapLayer,
    greenMapMode: state.greenMapMode,
    distanceArcs: state.distanceArcs,
    blindShot: state.blindShot,
    autoZoom: state.autoZoom,
    lie: state.lie,
    conditions: { ...state.conditions },
    weather: { ...state.weather },
    targets: { ...state.targets },
    holes,
    missDetails,
    shotSamples,
  };
}

function updateOnCourseState(
  state: OnCourseState,
  patch: Partial<Pick<OnCourseState, "mapLayer" | "greenMapMode" | "distanceArcs" | "blindShot" | "autoZoom" | "lie" | "conditions" | "weather" | "targets">>,
): OnCourseState {
  return {
    ...state,
    ...patch,
    conditions: patch.conditions ? { ...state.conditions, ...patch.conditions } : { ...state.conditions },
    weather: patch.weather ? { ...state.weather, ...patch.weather } : { ...state.weather },
    targets: patch.targets ? { ...state.targets, ...patch.targets } : { ...state.targets },
    holes: state.holes.map((hole) => ({ ...hole, missDetails: hole.missDetails.map((miss) => ({ ...miss })) })),
    missDetails: state.missDetails.map((miss) => ({ ...miss })),
    shotSamples: state.shotSamples.map((sample) => ({ ...sample })),
  };
}

function recordHoleOutcome(state: OnCourseState, outcome: HoleOutcome): OnCourseState {
  const next = state.holes.filter((hole) => hole.holeNumber !== outcome.holeNumber);
  return {
    ...state,
    holes: [...next, { ...outcome, missDetails: outcome.missDetails.map((miss) => ({ ...miss })) }].sort((left, right) => left.holeNumber - right.holeNumber),
  };
}

function addMissDetail(state: OnCourseState, detail: MissDetail): OnCourseState {
  const nextMisses = [...state.missDetails.filter((miss) => miss.id !== detail.id), { ...detail }].slice(-ON_COURSE_MAX_MISS_DETAILS);
  const outcome = state.holes.find((hole) => hole.holeNumber === detail.holeNumber);
  const next = outcome
    ? recordHoleOutcome({ ...state, missDetails: nextMisses }, {
        ...outcome,
        missDetails: [...outcome.missDetails.filter((miss) => miss.id !== detail.id), { ...detail }],
      })
    : { ...state, missDetails: nextMisses };
  return next;
}

function addShotDistanceSample(state: OnCourseState, sample: ShotDistanceSample): OnCourseState {
  return {
    ...state,
    shotSamples: [...state.shotSamples.filter((candidate) => candidate.id !== sample.id), { ...sample }].slice(-ON_COURSE_MAX_SHOT_SAMPLES),
  };
}

function saveShotSampleToBag(state: OnCourseState, sampleId: string): OnCourseState {
  return {
    ...state,
    shotSamples: state.shotSamples.map((sample) => sample.id === sampleId ? { ...sample, savedToBag: true } : { ...sample }),
  };
}

export function getConditionAdjustments(conditions: OnCourseConditions) {
  const windAdjustment = conditions.windDirection === "headwind"
    ? conditions.windMph * 0.65
    : conditions.windDirection === "tailwind"
      ? -conditions.windMph * 0.45
      : conditions.windMph * 0.1;
  const temperatureAdjustment = (72 - conditions.temperatureF) * 0.08;
  return { wind: windAdjustment, elevation: conditions.elevationYards, temperature: temperatureAdjustment };
}

function calculateConditionAdjustmentYards(conditions: OnCourseConditions): number {
  const adjustment = getConditionAdjustments(conditions);
  return adjustment.wind + adjustment.elevation + adjustment.temperature;
}

function calculatePlaysLikeYards(baseYards: number, conditions: OnCourseConditions): number {
  const safeBase = Number.isFinite(baseYards) ? Math.max(0, baseYards) : 0;
  return Math.max(0, Math.round(safeBase + calculateConditionAdjustmentYards(conditions)));
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle];
}

function savedDistanceForClub(
  club: EquipmentClub,
  samples: readonly ShotDistanceSample[],
): number | undefined {
  const tracked = median(samples.filter((sample) => sample.clubId === club.id && sample.savedToBag).map((sample) => sample.yards));
  return tracked ?? club.carryYards ?? undefined;
}

function recommendClub(
  targetYards: number,
  equipment: readonly EquipmentClub[],
  samples: readonly ShotDistanceSample[],
): ClubRecommendation | undefined {
  if (!Number.isFinite(targetYards) || targetYards <= 0) return undefined;
  const candidates = equipment
    .filter((club) => club.status === "active" && club.type !== "putter")
    .map((club) => {
      const distanceYards = savedDistanceForClub(club, samples);
      return distanceYards === undefined ? undefined : {
        club,
        distanceYards,
        source: samples.some((sample) => sample.clubId === club.id && sample.savedToBag) ? "tracked sample" as const : "bag carry" as const,
      };
    })
    .filter((candidate): candidate is { club: EquipmentClub; distanceYards: number; source: ClubRecommendationSource } => Boolean(candidate));
  const best = candidates.sort((left, right) => {
    const distanceDelta = Math.abs(left.distanceYards - targetYards) - Math.abs(right.distanceYards - targetYards);
    return distanceDelta || left.club.slot - right.club.slot;
  })[0];
  return best
    ? { clubId: best.club.id, clubName: best.club.name, distanceYards: Math.round(best.distanceYards), source: best.source }
    : undefined;
}

function createShotDistanceSample(event: RoundEvent, equipment: readonly EquipmentClub[]): ShotDistanceSample | undefined {
  if (event.kind !== "gps_shot" || event.evidence !== "total_gps" || event.distanceYards === null || event.distanceYards <= 0 || event.strokes !== 1 || event.clubId === null || event.clubName === null) return undefined;
  const club = equipment.find((candidate) => candidate.id === event.clubId);
  if (!club) return undefined;
  return {
    id: `sample-${event.id}`,
    eventId: event.id,
    holeNumber: event.holeNumber,
    clubId: club.id,
    clubName: event.clubName,
    yards: event.distanceYards,
    kind: /driver/i.test(event.clubName) ? "automatic_drive" : "gps",
    savedToBag: false,
    createdAt: event.createdAt,
  };
}

function getCoachAdvice(lie: LieType, context: { targetYards: number; windDirection: WindDirection; windMph: number }): CoachAdvice {
  const wind = `${context.windMph} MPH ${context.windDirection}`;
  if (lie === "tee") return { title: "TEE LIE", detail: `Pick the widest line before chasing distance. ${wind} is already in the plan.`, cue: "START SMOOTH · FIND FAIRWAY" };
  if (lie === "fairway") return { title: "FAIRWAY LIE", detail: `Ball is sitting clean for ${context.targetYards} yd. Start at the center of the window and commit.`, cue: "CLEAN LIE · CENTER START" };
  if (lie === "rough") return { title: "ROUGH LIE", detail: `Take one more club if the grass is grabbing the face. Keep the ${wind} target conservative.`, cue: "CHECK GRASS · TAKE MARGIN" };
  if (lie === "bunker") return { title: "BUNKER LIE", detail: `Use a shallow splash and clear the lip before the ${context.targetYards} yd target.`, cue: "SAND FIRST · CLEAR LIP" };
  if (lie === "recovery") return { title: "RECOVERY LIE", detail: "Choose the safest playable window. Advance only when the next miss still leaves a shot. ", cue: "RESET THE HOLE · PLAY OUT" };
  return { title: "GREEN LIE", detail: `Match pace to the ${context.targetYards} yd putt line and let the break work. ${wind} is a surface cue only.`, cue: "PACE FIRST · TRUST BREAK" };
}

function getBlindShotGuide(distanceYards: number, signedOffsetYards: number): BlindShotGuide {
  const safeDistance = Math.max(0, Math.round(distanceYards));
  const safeOffset = Math.round(signedOffsetYards);
  const offset = Math.abs(safeOffset) < 1 ? "CENTER" : `${Math.abs(safeOffset)} ${safeOffset < 0 ? "LEFT" : "RIGHT"}`;
  return { distanceYards: safeDistance, signedOffsetYards: safeOffset, callout: `${safeDistance} YD · ${offset}` };
}

function getTeeShotPlan(hazards: readonly TeeShotHazard[]): TeeShotPlan {
  const avoidZones = hazards
    .filter((hazard) => hazard.distanceYards > 0)
    .sort((left, right) => left.distanceYards - right.distanceYards)
    .map((hazard) => {
      const direction = hazard.direction === "center" ? "CENTER" : hazard.direction.toUpperCase();
      const label = hazard.label.toUpperCase().replace(/^(LEFT|RIGHT|CENTER)\s+/, "");
      return `${direction} ${label}`;
    });
  if (avoidZones.length === 0) {
    return { summary: "START AT THE WIDEST FAIRWAY", avoidZones: [], note: "No verified tee hazards are loaded; use the fairway center as the deterministic fallback." };
  }
  return {
    summary: "START AWAY FROM THE FIRST TROUBLE · FIND FAIRWAY",
    avoidZones,
    note: "Carry values are tied to the loaded hole geometry; the plan never invents a hazard distance.",
  };
}

function shouldAutoZoom(enabled: boolean, distanceToGreenYards: number | undefined): boolean {
  return enabled && distanceToGreenYards !== undefined && Number.isFinite(distanceToGreenYards) && distanceToGreenYards <= 220;
}

function deriveHoleInsights(log: RoundLog, state: OnCourseState, holeNumber: number, par = 4): HoleInsights {
  const outcome = state.holes.find((candidate) => candidate.holeNumber === holeNumber);
  const events = log.events.filter((event) => event.holeNumber === holeNumber);
  const score = outcome?.score ?? (log.holeNumber === holeNumber ? log.score : null);
  const misses = state.missDetails.filter((miss) => miss.holeNumber === holeNumber).length;
  return {
    holeNumber,
    par: outcome?.par ?? par,
    score,
    scoreToPar: score === null ? null : score - (outcome?.par ?? par),
    putts: outcome?.putts ?? null,
    gir: outcome?.gir ?? null,
    fairway: outcome?.fairway ?? null,
    measuredShots: events.filter((event) => event.kind === "gps_shot" && event.distanceYards !== null).length,
    penalties: events.filter((event) => event.kind === "penalty_stroke").length,
    misses,
  };
}

export function deriveRoundStats(log: RoundLog, state: OnCourseState): RoundStats {
  const outcomes = [...state.holes].sort((left, right) => left.holeNumber - right.holeNumber);
  const score = outcomes.length > 0 ? outcomes.reduce((sum, hole) => sum + hole.score, 0) : log.score;
  const par = outcomes.reduce((sum, hole) => sum + hole.par, 0);
  const puttValues = outcomes.map((hole) => hole.putts).filter((putts): putts is number => putts !== null);
  const events = log.events;
  const penalties = events.filter((event) => event.kind === "penalty_stroke").length;
  const measuredShots = events.filter((event) => event.kind === "gps_shot" && event.distanceYards !== null).length;
  const misses = state.missDetails.length;
  return {
    holesPlayed: outcomes.length,
    score,
    scoreToPar: outcomes.length > 0 ? score - par : 0,
    putts: outcomes.length > 0 && puttValues.length === outcomes.length ? puttValues.reduce((sum, value) => sum + value, 0) : null,
    birdies: outcomes.filter((hole) => hole.score < hole.par).length,
    pars: outcomes.filter((hole) => hole.score === hole.par).length,
    gir: outcomes.filter((hole) => hole.gir === true).length,
    fairways: outcomes.filter((hole) => hole.fairway === true).length,
    girKnown: outcomes.filter((hole) => hole.gir !== null).length,
    fairwaysKnown: outcomes.filter((hole) => hole.fairway !== null).length,
    measuredShots,
    penalties,
    misses,
  };
}

function getTargetProgress(targets: RoundTargets, stats: RoundStats): TargetProgress {
  return {
    birdies: Math.min(targets.birdies, stats.birdies),
    pars: Math.min(targets.pars, stats.pars),
    gir: Math.min(targets.gir, stats.gir),
    fairways: Math.min(targets.fairways, stats.fairways),
  };
}

function isTargetKey(value: unknown): value is keyof RoundTargets {
  return value === "birdies" || value === "pars" || value === "gir" || value === "fairways";
}

function sameOnCourseIdentity(state: OnCourseState, identity: OnCourseIdentity): boolean {
  return state.roundId === identity.roundId
    && state.courseId === identity.courseId
    && state.holeNumber === identity.holeNumber;
}

/**
 * The only state-transition seam for on-course behavior. UI adapters dispatch
 * intent here; validation, bounded updates, sample creation, and immutable
 * normalization stay inside this module.
 */
export function reduceOnCourseState(state: OnCourseState, action: OnCourseAction): OnCourseState {
  switch (action.type) {
    case "set-map-layer":
      return isMapLayer(action.layer) ? updateOnCourseState(state, { mapLayer: action.layer }) : state;
    case "set-green-map":
      return isGreenMapMode(action.mode) ? updateOnCourseState(state, { greenMapMode: action.mode }) : state;
    case "toggle-distance-arcs":
      return updateOnCourseState(state, { distanceArcs: !state.distanceArcs });
    case "toggle-blind-shot":
      return updateOnCourseState(state, { blindShot: !state.blindShot });
    case "toggle-auto-zoom":
      return updateOnCourseState(state, { autoZoom: !state.autoZoom });
    case "set-lie":
      return isLieType(action.lie) ? updateOnCourseState(state, { lie: action.lie }) : state;
    case "set-conditions":
      return isOnCourseConditions(action.conditions) ? updateOnCourseState(state, { conditions: action.conditions }) : state;
    case "set-weather":
      if (!isWeatherSnapshot(action.weather)) return state;
      return updateOnCourseState(state, {
        weather: action.weather,
        conditions: action.syncConditions === false
          ? { ...state.conditions }
          : {
              ...state.conditions,
              windMph: action.weather.windMph,
              temperatureF: action.weather.temperatureF,
            },
      });
    case "adjust-target":
      if (!isTargetKey(action.target) || !Number.isFinite(action.delta)) return state;
      return updateOnCourseState(state, {
        targets: {
          ...state.targets,
          [action.target]: Math.max(0, Math.min(18, Math.round(state.targets[action.target] + action.delta))),
        },
      });
    case "record-hole-outcome":
      return isHoleOutcome(action.outcome) ? recordHoleOutcome(state, action.outcome) : state;
    case "add-miss-detail":
      return isMissDetail(action.detail) ? addMissDetail(state, action.detail) : state;
    case "record-gps-event": {
      const sample = createShotDistanceSample(action.event, action.equipment);
      return sample ? addShotDistanceSample(state, sample) : state;
    }
    case "save-shot-to-bag":
      return isBoundedString(action.sampleId, 120) ? saveShotSampleToBag(state, action.sampleId) : state;
    case "reset":
      return createDefaultOnCourseState(action.identity, action.conditions);
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

/**
 * The only read seam for on-course behavior. It exposes normalized values for
 * the current field shell and future Home/Round Overview consumers.
 */
export function projectOnCourseState(
  state: OnCourseState,
  input: OnCourseProjectionInput,
): OnCourseProjection {
  const conditionAdjustmentYards = Math.round(calculateConditionAdjustmentYards(state.conditions));
  const playsLikeYards = input.baseTargetYards !== undefined && Number.isFinite(input.baseTargetYards)
    ? calculatePlaysLikeYards(input.baseTargetYards, state.conditions)
    : undefined;
  const currentTargetYards = playsLikeYards;
  const roundStats = deriveRoundStats(input.roundLog, state);
  const holeInsights = deriveHoleInsights(input.roundLog, state, input.identity.holeNumber, input.par);
  const trackedShotReview = input.trackedShotReviewId
    ? state.shotSamples.find((sample) => sample.id === input.trackedShotReviewId)
    : [...state.shotSamples].reverse().find((sample) => !sample.savedToBag);

  return {
    conditionAdjustmentYards,
    playsLikeYards,
    currentTargetYards,
    autoZoomActive: shouldAutoZoom(state.autoZoom, currentTargetYards),
    roundStats,
    holeInsights,
    targetProgress: getTargetProgress(state.targets, roundStats),
    clubRecommendation: recommendClub(currentTargetYards ?? 0, input.equipment, input.clubStatisticSamples ?? state.shotSamples),
    coachAdvice: getCoachAdvice(state.lie, {
      targetYards: currentTargetYards ?? 0,
      windDirection: state.conditions.windDirection,
      windMph: state.conditions.windMph,
    }),
    blindShotGuide: getBlindShotGuide(currentTargetYards ?? 0, input.signedOffsetYards),
    teeShotPlan: getTeeShotPlan(input.hazards),
    trackedShotReview,
  };
}

export function loadOnCourseState(
  storage: OnCourseStorage | undefined,
  identity: OnCourseIdentity,
  fallbackConditions: OnCourseConditions = DEFAULT_ON_COURSE_CONDITIONS,
): OnCourseState {
  const fallback = createDefaultOnCourseState(identity, fallbackConditions);
  if (!storage) return fallback;
  try {
    const stored = parseStoredOnCourseState(storage.getItem(ON_COURSE_STORAGE_KEY) ?? "");
    return stored && sameOnCourseIdentity(stored, identity) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function saveOnCourseState(storage: OnCourseStorage | undefined, state: OnCourseState): void {
  if (!storage) return;
  try {
    storage.setItem(ON_COURSE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Foreground on-course behavior remains usable when storage is unavailable.
  }
}
