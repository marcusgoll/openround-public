import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "@fontsource/roboto-condensed/latin-400.css";
import "@fontsource/roboto-condensed/latin-500.css";
import "@fontsource/roboto-condensed/latin-900.css";
import {
  ActivityLogIcon,
  BackpackIcon,
  BarChartIcon,
  CheckCircledIcon,
  ChevronRightIcon,
  Cross2Icon,
  DoubleArrowDownIcon,
  DoubleArrowUpIcon,
  HamburgerMenuIcon,
  DotsHorizontalIcon,
  HomeIcon,
  MinusIcon,
  Pencil2Icon,
  PlusIcon,
  ReloadIcon,
  SewingPinFilledIcon,
  TargetIcon,
  TriangleRightIcon,
} from "@radix-ui/react-icons";
import { BottomSheet, KeyboardInput, useKeyboard } from "./mobile";
import { SmartTrackingSheet } from "./SmartTrackingSheet";
import { nativeTracking, nativeTrackingAvailable } from "./nativeTracking";
import { distanceBetweenYards } from "./openroundSmartTracking";
import {
  type ApproachClubId,
  type ClubProfile,
  CLUB_PROFILES,
  DEFAULT_APPROACH_CLUB_ID,
  DEFAULT_TEE_CLUB_ID,
  EQUIPMENT_LIMIT,
  EQUIPMENT_SLOT_TO_CLUB_ID,
  EQUIPMENT_TYPES,
  type EquipmentClub,
  type EquipmentClubInput,
  type EquipmentStatus,
  type EquipmentType,
  addEquipment,
  countRecordedStrokes,
  createDefaultEquipment,
  getClubProfile,
  getDispersionPresentation,
  getShotBias,
  type ShotOffset,
  DEFAULT_DISPERSION_RADIUS_YARDS,
  MIN_DISPERSION_SAMPLES,
  loadStoredEquipment,
  loadStoredRoundLog,
  removeEquipment,
  type RoundEvent,
  type RoundLog,
  storeRoundLog,
  storeEquipment,
  updateEquipment,
} from "./openroundModel";
import {
  type GreenMapMode,
  type HoleOutcome,
  type LieType,
  type MissDirection,
  type MissTarget,
  type MissDetail,
  type OnCourseConditions,
  type RoundStats,
  type RoundTargets,
  type RuleOf12Slope,
  type TeeShotHazard,
  projectRuleOf12,
  deriveRoundStats,
  getConditionAdjustments,
  recommendPitchClubId,
} from "./openroundOnCourseModel";
import { getBrowserOnCourseStorage } from "./openroundOnCoursePersistence";
import { loadRounds, saveRounds, roundTotals, type SavedRound, type SavedHole } from "./openroundRounds";
import { estimateCameraPinDistance, type CameraPinEstimate } from "./openroundCameraPin";
import { projectClubEvidence } from "./openroundClubEvidence";
import {
  ingestClubStatistics,
  loadClubStatistics,
  projectClubStatisticSamples,
  saveClubStatistics,
} from "./openroundClubStatistics";
import { useOpenRoundOnCourse } from "./useOpenRoundOnCourse";
import { DEMO_OPENROUND_COURSE, getHoleReadiness, type GeoJsonGeometry, type GeoJsonPosition } from "./openroundCourseData";
import {
  COURSE_SELECTION_STORAGE_KEY,
  COURSE_CATALOG_INDEX_URL,
  COURSE_CATALOG_MANIFEST_URL,
  type CourseCatalogEntry,
  type CourseCatalogIndex,
  type CourseSelection,
  findNearbyCourses,
  isCourseCatalogIndex,
  isCourseCatalogManifest,
  isCourseSelectionCurrent,
  loadStoredCourseSelection,
  mergeCourseCatalogEntries,
  searchCourses,
  storeCourseSelection,
} from "./openroundCourseCatalog";
import { createGeometryProjection, fetchOverpassHoleGeometry, findAutomaticGreenLandingPoint, isGeoPositionInsideGeometry, isGeoPositionInsideGeometryOrBoundary, type LoadedHoleGeometry, webMercatorGeoPoint, webMercatorWorldPixel } from "./openroundGeometry";
import { fetchBundledHoleGeometry } from "./openroundGeometryCache";
import { DEFAULT_OPENROUND_COURSE, getPersonalCourseHolePar, getPersonalCourseTeeSets, PERSONAL_COURSE_ENTRIES, PERSONAL_COURSE_IDS } from "./openroundPersonalCourses";
import { loadStoredPinOverride, removeStoredPinOverride, storePinOverride } from "./openroundPinStorage";
import { resolveGeometryRuntimePolicy } from "./openroundProviderPolicy";
import {
  appendFieldLogRun,
  clearFieldLog,
  FIELD_LOG_MAX_FIX_AGE_SECONDS,
  FIELD_LOG_LIMIT,
  FIELD_LOG_MAX_RECORDED_FIX_AGE_SECONDS,
  loadStoredFieldLog,
  removeFieldLogRun,
  storeFieldLog,
  type FieldLogDraft,
  type FieldLogGeometryGrade,
  type FieldLogImageryProvider,
  type FieldLogPayload,
  type FieldLogRun,
  type FieldLogTeeBox,
} from "./openroundFieldLog";

type GeoPoint = {
  lat: number;
  lon: number;
};

type LockedShot = {
  id: number;
  number: number;
  club: string;
  totalGps: number;
  start: GeoPoint;
  end: GeoPoint;
  evidence: "total_gps" | "demo_manual";
  provenance: ClubProfile["provenance"] | null;
  reviewed: boolean;
  clubProfileId: ApproachClubId | null;
  caddyAim: AimPlan | null;
  plannedAim: AimPlan | null;
  realPlannedAim: RealAimPlan | null;
};

type TrackingLeg = {
  number: number;
  club: string;
  start: GeoPoint;
};

type ActiveSheet = "smart" | "menu" | "club" | "equipment" | "pin" | "score" | "add" | "course" | "conditions" | "field-log" | "weather" | "coach" | "planner" | "targets" | "insights" | "track" | "miss" | "end-round" | null;
type GpsHealth = "fresh" | "stale" | "unavailable";
type PinPlacement = "front" | "center" | "back" | "gps" | "custom";
type WindDirection = "crosswind" | "headwind" | "tailwind";
type CaddyAggressiveness = "safe" | "standard" | "aggressive";

type TeeBox = FieldLogTeeBox;
type RoundGameType = "none" | "stroke" | "match";
type RoundScoringSystem = "stroke" | "stableford";

type RoundSetup = {
  version: 1;
  playerName: string;
  teeBox: TeeBox;
  tournamentMode: boolean;
  handicapScoring: boolean;
  trackFitness: boolean;
  gameType: RoundGameType;
  scoringSystem: RoundScoringSystem;
  golfers?: string[];
};

type StartView = "start" | "field";
type StartFlowScreen = "home" | "round";
type PrototypeVariant = "a" | "b" | "c";
type ActiveRoundStatus = "ready" | "tracking" | "paused" | "complete";

type ActiveRoundSummary = {
  version: 1;
  courseId: string;
  courseName: string;
  layoutLabel: string;
  holeNumber: number;
  teeBox: TeeBox;
  status: ActiveRoundStatus;
  updatedAt: string;
};

type CaddyAggressivenessConfig = {
  label: string;
  lateralAdjustmentYards: number;
  distanceAdjustmentYards: number;
  realAimFraction: number;
};

const CADDY_AGGRESSIVENESS: Record<CaddyAggressiveness, CaddyAggressivenessConfig> = {
  safe: {
    label: "SAFE",
    lateralAdjustmentYards: -4,
    distanceAdjustmentYards: -6,
    realAimFraction: 0.66,
  },
  standard: {
    label: "STANDARD",
    lateralAdjustmentYards: 0,
    distanceAdjustmentYards: 0,
    realAimFraction: 0.72,
  },
  aggressive: {
    label: "AGGRESSIVE",
    lateralAdjustmentYards: 4,
    distanceAdjustmentYards: 6,
    realAimFraction: 0.78,
  },
};

const CADDY_STRATEGY_CYCLE: Record<CaddyAggressiveness, CaddyAggressiveness> = {
  standard: "aggressive",
  aggressive: "safe",
  safe: "standard",
};

const CADDY_STRATEGY_SHORT_LABEL: Record<CaddyAggressiveness, string> = {
  standard: "STD",
  aggressive: "AGG",
  safe: "SAFE",
};

type PlayingConditions = OnCourseConditions;

type ManualEntryKind = "Manual shot" | "Missed tracked shot" | "Penalty stroke";

type ManualEntry = {
  id: number;
  eventId: string;
  sequence: number;
  kind: ManualEntryKind;
  clubId: string | null;
  clubName: string | null;
  createdAt: string;
};

type StoredRoundSession = {
  version: 1;
  roundId: string;
  courseId: string;
  holeNumber: number;
  score: number;
  lockedShots: LockedShot[];
  manualEntries: ManualEntry[];
  tracking?: TrackingLeg | null;
  selectedClubId?: ApproachClubId;
  teeShotClubId?: ApproachClubId;
};

type MapPoint = {
  x: number;
  y: number;
};

type AimSource = "caddy_path" | "manual";

type CoursePoint = {
  eastYards: number;
  forwardYards: number;
};

type AimPlan = {
  geometryId: string;
  point: CoursePoint;
  source: AimSource;
};

type RealAimPlan = {
  point: GeoJsonPosition;
  source: "caddy" | "manual";
};

type StoredAimPlan = {
  version: 1;
  plan: AimPlan;
};

type DemoHoleGeometry = {
  id: string;
  status: "prototype_fixture";
  frame: {
    widthYards: number;
    heightYards: number;
  };
  ball: CoursePoint;
  pin: CoursePoint;
  fairwayEntry: CoursePoint;
  defaultAim: CoursePoint;
  fairwayExit: CoursePoint;
};

type MapSize = {
  width: number;
  height: number;
};

type SatelliteProvider = "google" | "usgs";

type MapView = {
  scale: number;
  panX: number;
  panY: number;
};

type PinPlacementReturnView = {
  visualCenter: GeoPoint;
  effectiveScale: number;
};

type MapPointer = {
  x: number;
  y: number;
};

type PinchGesture = {
  distance: number;
  midpoint: MapPointer;
  view: MapView;
};

type MapPanGesture = {
  pointerId: number;
  clientX: number;
  clientY: number;
  view: MapView;
};

type MapTile = {
  x: number;
  y: number;
  left: number;
  top: number;
  renderSize: number;
  url: string;
};

type AimPointerStart = {
  pointerId: number;
  clientX: number;
  clientY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  dragging: boolean;
};

type CatalogLoadState = "idle" | "loading" | "ready" | "error";
type GeometryLoadState = "idle" | "loading" | "ready" | "error";
type LocationLoadState = "idle" | "loading" | "ready" | "error";

type LiveGpsFix = {
  point: GeoPoint;
  accuracy: number;
  capturedAt: number;
};

type FieldLogGpsPair = {
  start: LiveGpsFix;
  startAgeSeconds: number;
  end: LiveGpsFix;
  endAgeSeconds: number;
};

type FieldLogGpsPairState = "idle" | "capturing-start" | "waiting-end" | "capturing-end" | "ready";

type EquipmentFormDraft = {
  name: string;
  brand: string;
  model: string;
  type: EquipmentType;
  loft: string;
  carryYards: string;
  totalYards: string;
};

const EARTH_RADIUS_METERS = 6_371_008.8;
const YARDS_PER_METER = 1.093_613_3;
const MAX_FIX_AGE_MS = 20_000;
const MAX_FIX_ACCURACY_METERS = 12;
const AIM_DRAG_SLOP_PX = 8;
const AIM_TOUCH_RADIUS_PX = 28;
const AIM_LABEL_FLIP_PX = 58;
const MAP_TILE_SIZE_PX = 256;
// Real-course geometry and the free USGS/USDA NAIP tiles share this level so
// a full tee→green hole remains visible after the fixed top-facing rotation.
const MAP_TILE_ZOOM = 16;
const GOOGLE_MAP_TILE_MAX_ZOOM = 22;
const MAP_ZOOM_MIN = 1;
// Ordinary hole planning stays within a glanceable full-hole range.
const MAP_ZOOM_MAX = 3.2;
// Pin placement gets its own tighter scale range. Opening at twice the normal
// ceiling makes the green large enough for precise fixed-pin placement
// without changing the normal map's interaction contract.
const PIN_PLACEMENT_ZOOM_MIN = MAP_ZOOM_MAX;
const PIN_PLACEMENT_ZOOM_INITIAL = 6.4;
const PIN_PLACEMENT_ZOOM_MAX = 8;
// Keep detail overlays out of the glance view until the player deliberately
// pinches into the map. Real-course planning starts at 1.6×, so this threshold
// avoids treating the automatic focus scale as a manual detail request.
const MAP_DETAIL_ZOOM_SCALE = 2.05;
const REAL_PLANNING_FOCUS_SCALE = 1.6;
const MAP_GESTURE_MIN_DISTANCE_PX = 18;
const MAP_FOCUS_DISTANCE_YARDS = 220;
const GREEN_PIN_BOUNDS = { minX: 0.44, maxX: 0.63, minY: 0.02, maxY: 0.2 };
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? "";
// The USGS NAIP Plus image service exposes a viewport exportImage endpoint in
// addition to its level-16 tile cache. Requesting a small, display-only
// viewport raster at 4× density keeps the free fallback readable at the
// planning scale without changing the Web Mercator geometry transform.
const WEB_MERCATOR_HALF_WORLD_METERS = 20_037_508.342_789_244;
const WEB_MERCATOR_WORLD_METERS = WEB_MERCATOR_HALF_WORLD_METERS * 2;
const USGS_VIEWPORT_EXPORT_OVERSAMPLE = 4;
const USGS_VIEWPORT_EXPORT_MAX_DIMENSION = 2_400;
const GEOMETRY_RUNTIME_POLICY = resolveGeometryRuntimePolicy({
  dev: import.meta.env.DEV,
  allowLiveOverpass: import.meta.env.VITE_OPENROUND_ALLOW_LIVE_OVERPASS,
});
// Visual calibration keeps the statistical window glanceable; it is not a geographic scale.
const VISUAL_DISPERSION_LATERAL_PX_PER_YARD = 3.5;
const VISUAL_DISPERSION_DISTANCE_PX_PER_YARD = 5.5;
const VISUAL_DISPERSION_MIN_WIDTH_PX = 52;

function approachAutoZoomScale(enabled: boolean, distanceToPinYards: number | undefined): number {
  if (!enabled || distanceToPinYards === undefined || !Number.isFinite(distanceToPinYards) || distanceToPinYards > MAP_FOCUS_DISTANCE_YARDS) return 1;
  if (distanceToPinYards <= 10) return 3.6;
  if (distanceToPinYards <= 30) return 3 + (30 - distanceToPinYards) / 20 * 0.6;
  if (distanceToPinYards <= 60) return 2.4 + (60 - distanceToPinYards) / 30 * 0.6;
  if (distanceToPinYards <= 120) return 1.6 + (120 - distanceToPinYards) / 60 * 0.8;
  return 1 + (MAP_FOCUS_DISTANCE_YARDS - distanceToPinYards) / 100 * 0.6;
}
const VISUAL_DISPERSION_MAX_WIDTH_PX = 76;
const VISUAL_DISPERSION_MIN_DEPTH_PX = 88;
const VISUAL_DISPERSION_MAX_DEPTH_PX = 120;
const VISUAL_DISPERSION_CIRCLE_DIAMETER_PX = 72;
// Real-course planning opens at a tighter map scale; keep the visible aim
// envelope compact while preserving the independent 64px drag hit target.
const REAL_AIM_FACE_SCALE = 0.58;
const AIM_STORAGE_KEY = "openround:round-demo:hole-7:shot-2:aim:v2";
const LEGACY_AIM_STORAGE_KEY = "openround:round-demo:hole-7:shot-2:aim";
const CONDITIONS_STORAGE_KEY = "openround:playing-conditions:v1";
const CADDY_STRATEGY_STORAGE_KEY = "openround:caddy-aggressiveness:v1";
const ROUND_SETUP_STORAGE_KEY = "openround:round-setup:v1";
const ACTIVE_ROUND_STORAGE_KEY = "openround:active-round:v1";
const START_VIEW_STORAGE_KEY = "openround:start-view:v1";
const ROUND_SESSION_STORAGE_KEY = "openround:round-session:v1";
const DEFAULT_PLAYING_CONDITIONS: PlayingConditions = { windMph: 8, windDirection: "crosswind", elevationYards: 2, temperatureF: 72 };
const DEFAULT_ROUND_SETUP: RoundSetup = {
  version: 1,
  playerName: "Marcus Gollahon",
  teeBox: "blue",
  tournamentMode: false,
  handicapScoring: true,
  trackFitness: true,
  gameType: "none",
  scoringSystem: "stroke",
};
const TEE_BOX_OPTIONS: readonly { id: TeeBox; label: string; detail: string }[] = [
  { id: "blue", label: "BLUE", detail: "CHAMPIONSHIP" },
  { id: "white", label: "WHITE", detail: "STANDARD" },
  { id: "gold", label: "GOLD", detail: "FORWARD" },
];
const ROUND_GAME_TYPE_OPTIONS: readonly { id: RoundGameType; label: string }[] = [
  { id: "none", label: "NONE" },
  { id: "stroke", label: "STROKE PLAY" },
  { id: "match", label: "MATCH PLAY" },
];
const ROUND_SCORING_OPTIONS: readonly { id: RoundScoringSystem; label: string }[] = [
  { id: "stroke", label: "STROKE PLAY" },
  { id: "stableford", label: "STABLEFORD" },
];
const MAP_WIDTH_YARDS = 160;
const MAP_HEIGHT_YARDS = 440;
const PLAYS_LIKE_ADJUSTMENT_YARDS = 4;
const MIN_INTERACTIVE_MAP_SIZE: MapSize = { width: 320, height: 235 };

const FALLBACK_MAP_SIZE: MapSize = { width: 393, height: 340 };

const TEE: GeoPoint = { lat: 36.578_125, lon: -121.957_41 };

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function destinationPoint(start: GeoPoint, yards: number, bearingDegrees: number): GeoPoint {
  const angularDistance = yards / YARDS_PER_METER / EARTH_RADIUS_METERS;
  const bearing = toRadians(bearingDegrees);
  const latitude = toRadians(start.lat);
  const longitude = toRadians(start.lon);

  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const destinationLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
    );

  return { lat: toDegrees(destinationLatitude), lon: toDegrees(destinationLongitude) };
}

const MAP_FOCUS_GEO = destinationPoint(TEE, MAP_FOCUS_DISTANCE_YARDS, 2);
const DEMO_BALL_PLACEMENT_AVAILABLE = import.meta.env.DEV;

// This is an authored prototype fixture, not claimed production course-provider geometry.
const HOLE_7_GEOMETRY: DemoHoleGeometry = {
  id: "openround-demo-hole-7-v1",
  status: "prototype_fixture",
  frame: { widthYards: MAP_WIDTH_YARDS, heightYards: MAP_HEIGHT_YARDS },
  ball: { eastYards: 73.6, forwardYards: 149.6 },
  pin: { eastYards: 85.6, forwardYards: 409.2 },
  fairwayEntry: { eastYards: 72.8, forwardYards: 220 },
  defaultAim: { eastYards: 74.56, forwardYards: 303.6 },
  fairwayExit: { eastYards: 80.8, forwardYards: 360.8 },
};

const HOLE_7_TEE: CoursePoint = { eastYards: 67.2, forwardYards: 4.4 };

function mapPointFromCoursePoint(point: CoursePoint): MapPoint {
  return {
    x: point.eastYards / HOLE_7_GEOMETRY.frame.widthYards,
    y: 1 - point.forwardYards / HOLE_7_GEOMETRY.frame.heightYards,
  };
}

function coursePointFromMapPoint(point: MapPoint): CoursePoint {
  return {
    eastYards: point.x * HOLE_7_GEOMETRY.frame.widthYards,
    forwardYards: (1 - point.y) * HOLE_7_GEOMETRY.frame.heightYards,
  };
}

function geoPointFromDemoCoursePoint(point: CoursePoint): GeoPoint {
  const eastYards = point.eastYards - HOLE_7_TEE.eastYards;
  const forwardYards = point.forwardYards - HOLE_7_TEE.forwardYards;
  return destinationPoint(TEE, Math.hypot(eastYards, forwardYards), toDegrees(Math.atan2(eastYards, forwardYards)));
}

function demoCoursePointFromGeoPoint(point: GeoPoint): CoursePoint {
  const northYards = toRadians(point.lat - TEE.lat) * EARTH_RADIUS_METERS * YARDS_PER_METER;
  const eastYards = toRadians(point.lon - TEE.lon)
    * Math.cos(toRadians((point.lat + TEE.lat) / 2))
    * EARTH_RADIUS_METERS
    * YARDS_PER_METER;
  return {
    eastYards: HOLE_7_TEE.eastYards + eastYards,
    forwardYards: HOLE_7_TEE.forwardYards + northYards,
  };
}

const CURRENT_BALL_MAP_POINT = mapPointFromCoursePoint(HOLE_7_GEOMETRY.ball);
const TEE_MAP_POINT = mapPointFromCoursePoint(HOLE_7_TEE);
const DEFAULT_AIM_POINT = mapPointFromCoursePoint(HOLE_7_GEOMETRY.defaultAim);
const CADDY_FAIRWAY_ENTRY = mapPointFromCoursePoint(HOLE_7_GEOMETRY.fairwayEntry);
const CADDY_FAIRWAY_EXIT = mapPointFromCoursePoint(HOLE_7_GEOMETRY.fairwayExit);
const DEFAULT_AIM_PLAN: AimPlan = {
  geometryId: HOLE_7_GEOMETRY.id,
  point: HOLE_7_GEOMETRY.defaultAim,
  source: "caddy_path",
};

const DEMO_HOLE_7_READINESS = getHoleReadiness(DEMO_OPENROUND_COURSE.holes[0]!);

function gpsLabel(health: GpsHealth, accuracyMeters: number | null) {
  if (health === "stale") return "GPS STALE";
  if (health === "unavailable") return "GPS OFF";
  return accuracyMeters !== null ? `GPS ±${accuracyMeters}m` : "GPS READY";
}

function gpsAccessibleLabel(health: GpsHealth, accuracyMeters: number | null) {
  if (health === "stale") return "GPS fix is stale. Open Round Controls.";
  if (health === "unavailable") return "GPS is off. Open Round Controls.";
  return accuracyMeters !== null
    ? `GPS accuracy plus or minus ${accuracyMeters} meters. Open Round Controls.`
    : "GPS is ready; reported accuracy is pending. Open Round Controls.";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isMapPoint(value: unknown): value is MapPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<MapPoint>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isCoursePoint(value: unknown): value is CoursePoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<CoursePoint>;
  return Number.isFinite(point.eastYards) && Number.isFinite(point.forwardYards);
}

function isAimSource(value: unknown): value is AimSource {
  return value === "caddy_path" || value === "manual";
}

function clampCoursePoint(point: CoursePoint): CoursePoint {
  const minimumEast = (54 / MIN_INTERACTIVE_MAP_SIZE.width) * HOLE_7_GEOMETRY.frame.widthYards;
  const maximumEast = (1 - 98 / MIN_INTERACTIVE_MAP_SIZE.width) * HOLE_7_GEOMETRY.frame.widthYards;
  const minimumForward =
    (AIM_TOUCH_RADIUS_PX / MIN_INTERACTIVE_MAP_SIZE.height) * HOLE_7_GEOMETRY.frame.heightYards;
  const maximumForward =
    (1 - AIM_TOUCH_RADIUS_PX / MIN_INTERACTIVE_MAP_SIZE.height) * HOLE_7_GEOMETRY.frame.heightYards;

  return {
    eastYards: clamp(point.eastYards, minimumEast, maximumEast),
    forwardYards: clamp(point.forwardYards, minimumForward, maximumForward),
  };
}

function aimPlanFromCoursePoint(point: CoursePoint, source: AimSource): AimPlan {
  return {
    geometryId: HOLE_7_GEOMETRY.id,
    point: clampCoursePoint(point),
    source,
  };
}

function aimPlanFromMapPoint(point: MapPoint, source: AimSource): AimPlan {
  return aimPlanFromCoursePoint(coursePointFromMapPoint(point), source);
}

function offsetPointRelativeToTarget(
  origin: CoursePoint,
  target: CoursePoint,
  lateralYards: number,
  distanceYards: number,
): CoursePoint {
  const deltaEast = target.eastYards - origin.eastYards;
  const deltaForward = target.forwardYards - origin.forwardYards;
  const length = Math.hypot(deltaEast, deltaForward);
  if (length === 0) return target;

  const forwardEast = deltaEast / length;
  const forwardNorth = deltaForward / length;
  const rightEast = forwardNorth;
  const rightNorth = -forwardEast;

  return {
    eastYards: target.eastYards + rightEast * lateralYards + forwardEast * distanceYards,
    forwardYards: target.forwardYards + rightNorth * lateralYards + forwardNorth * distanceYards,
  };
}

function getCaddyPlan(
  profile: ClubProfile,
  bias = getShotBias(profile.offsets),
  aggressiveness: CaddyAggressiveness = "standard",
  origin: CoursePoint = HOLE_7_GEOMETRY.ball,
  target: CoursePoint = HOLE_7_GEOMETRY.defaultAim,
): AimPlan {
  const strategy = CADDY_AGGRESSIVENESS[aggressiveness];
  const point = offsetPointRelativeToTarget(
    origin,
    target,
    strategy.lateralAdjustmentYards - clamp(bias.lateralYards, -6, 6),
    strategy.distanceAdjustmentYards - clamp(bias.distanceYards, -8, 8),
  );
  return aimPlanFromCoursePoint(point, "caddy_path");
}

function snapshotAimPlan(plan: AimPlan): AimPlan {
  return { ...plan, point: { ...plan.point } };
}

function clubTrackingLabel(profile: ClubProfile) {
  return profile.label.toUpperCase();
}

function lockedShotEvidenceLabel(shot: LockedShot) {
  return shot.evidence === "total_gps" ? "TOTAL GPS" : "DEMO MANUAL";
}

function clubAbbreviation(id: ApproachClubId) {
  return id === "driver" ? "DR" : id === "putter" ? "PT" : id.toUpperCase();
}

function isCaddyAggressiveness(value: unknown): value is CaddyAggressiveness {
  return value === "safe" || value === "standard" || value === "aggressive";
}

function loadStoredCaddyAggressiveness(): CaddyAggressiveness {
  if (typeof window === "undefined") return "standard";
  try {
    const storedValue = window.localStorage.getItem(CADDY_STRATEGY_STORAGE_KEY);
    return isCaddyAggressiveness(storedValue) ? storedValue : "standard";
  } catch {
    return "standard";
  }
}

function loadStoredAimPlan(): AimPlan {
  if (typeof window === "undefined") return DEFAULT_AIM_PLAN;

  try {
    const storedValue = window.localStorage.getItem(AIM_STORAGE_KEY);
    if (storedValue) {
      const parsedValue: unknown = JSON.parse(storedValue);
      if (parsedValue && typeof parsedValue === "object") {
        const storedPlan = parsedValue as Partial<StoredAimPlan>;
        const plan = storedPlan.plan as Partial<AimPlan> | undefined;
        if (
          storedPlan.version === 1 &&
          plan?.geometryId === HOLE_7_GEOMETRY.id &&
          isCoursePoint(plan.point) &&
          isAimSource(plan.source)
        ) {
          return aimPlanFromCoursePoint(plan.point, plan.source);
        }
      }
      // A present but invalid/version-mismatched record fails closed.
      return DEFAULT_AIM_PLAN;
    }

    const legacyValue = window.localStorage.getItem(LEGACY_AIM_STORAGE_KEY);
    if (!legacyValue) return DEFAULT_AIM_PLAN;
    const legacyPoint: unknown = JSON.parse(legacyValue);
    return isMapPoint(legacyPoint) ? aimPlanFromMapPoint(legacyPoint, "manual") : DEFAULT_AIM_PLAN;
  } catch {
    return DEFAULT_AIM_PLAN;
  }
}

function isWindDirection(value: unknown): value is WindDirection {
  return value === "crosswind" || value === "headwind" || value === "tailwind";
}

function isTeeBox(value: unknown): value is TeeBox {
  return value === "blue" || value === "white" || value === "gold" || value === "black" || value === "red";
}

function courseTeeBoxOptions(course: CourseCatalogEntry | null) {
  return getPersonalCourseTeeSets(course?.id).flatMap((tee) => isTeeBox(tee.id)
    ? [{ id: tee.id, label: tee.name.toUpperCase(), detail: tee.totalYards ? `${tee.totalYards.toLocaleString("en-US")} YD` : "COURSE TEE" }]
    : []);
}

function isRoundGameType(value: unknown): value is RoundGameType {
  return value === "none" || value === "stroke" || value === "match";
}

function isRoundScoringSystem(value: unknown): value is RoundScoringSystem {
  return value === "stroke" || value === "stableford";
}

function isStartView(value: unknown): value is StartView {
  return value === "start" || value === "field";
}

function isActiveRoundStatus(value: unknown): value is ActiveRoundStatus {
  return value === "ready" || value === "tracking" || value === "paused" || value === "complete";
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isGeoPoint(value: unknown): value is GeoPoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Partial<GeoPoint>;
  return typeof point.lat === "number" && Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90
    && typeof point.lon === "number" && Number.isFinite(point.lon) && point.lon >= -180 && point.lon <= 180;
}

function isGeoPosition(value: unknown): value is GeoJsonPosition {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === "number" && Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180
    && typeof value[1] === "number" && Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;
}

function isStoredAimPlan(value: unknown): value is AimPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Partial<AimPlan>;
  return typeof plan.geometryId === "string" && plan.geometryId.length > 0 && isCoursePoint(plan.point) && isAimSource(plan.source);
}

function isStoredRealAimPlan(value: unknown): value is RealAimPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Partial<RealAimPlan>;
  return isGeoPosition(plan.point) && (plan.source === "caddy" || plan.source === "manual");
}

function isManualEntryKind(value: unknown): value is ManualEntryKind {
  return value === "Manual shot" || value === "Missed tracked shot" || value === "Penalty stroke";
}

function isStoredLockedShot(value: unknown): value is LockedShot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const shot = value as Partial<LockedShot>;
  return (
    typeof shot.id === "number" && Number.isInteger(shot.id) && shot.id > 0
    && typeof shot.number === "number" && Number.isInteger(shot.number) && shot.number > 0
    && typeof shot.club === "string" && shot.club.length > 0 && shot.club.length <= 80
    && typeof shot.totalGps === "number" && Number.isFinite(shot.totalGps) && shot.totalGps > 0 && shot.totalGps <= 1_000
    && isGeoPoint(shot.start)
    && isGeoPoint(shot.end)
    && (shot.evidence === "total_gps" || shot.evidence === "demo_manual")
    && (shot.provenance === null || shot.provenance === "prototype_fixture")
    && typeof shot.reviewed === "boolean"
    && (shot.clubProfileId === null || shot.clubProfileId === "5w" || CLUB_PROFILES.some((profile) => profile.id === shot.clubProfileId))
    && (shot.caddyAim === null || isStoredAimPlan(shot.caddyAim))
    && (shot.plannedAim === null || isStoredAimPlan(shot.plannedAim))
    && (shot.realPlannedAim === null || isStoredRealAimPlan(shot.realPlannedAim))
  );
}

function isStoredManualEntry(value: unknown): value is ManualEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<ManualEntry>;
  return (
    typeof entry.id === "number" && Number.isInteger(entry.id) && entry.id > 0
    && typeof entry.eventId === "string" && entry.eventId.length > 0 && entry.eventId.length <= 120
    && typeof entry.sequence === "number" && Number.isInteger(entry.sequence) && entry.sequence > 0
    && isManualEntryKind(entry.kind)
    && (entry.clubId === null || (typeof entry.clubId === "string" && entry.clubId.length > 0 && entry.clubId.length <= 80))
    && (entry.clubName === null || (typeof entry.clubName === "string" && entry.clubName.length > 0 && entry.clubName.length <= 80))
    && isIsoTimestamp(entry.createdAt)
    && (entry.kind !== "Manual shot" || (entry.clubId !== null && entry.clubName !== null))
  );
}

function parseStoredRoundSession(value: unknown): StoredRoundSession | undefined {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const stored = candidate as Partial<StoredRoundSession>;
  if (
    stored.version !== 1
    || typeof stored.roundId !== "string" || stored.roundId.trim().length === 0 || stored.roundId.length > 160
    || typeof stored.courseId !== "string" || stored.courseId.trim().length === 0 || stored.courseId.length > 160
    || typeof stored.holeNumber !== "number" || !Number.isInteger(stored.holeNumber) || stored.holeNumber < 1 || stored.holeNumber > 18
    || typeof stored.score !== "number" || !Number.isInteger(stored.score) || stored.score < 0 || stored.score > 200
    || !Array.isArray(stored.lockedShots) || stored.lockedShots.length > 200 || !stored.lockedShots.every(isStoredLockedShot)
    || !Array.isArray(stored.manualEntries) || stored.manualEntries.length > 2_000 || !stored.manualEntries.every(isStoredManualEntry)
    || (stored.tracking != null && (!Number.isInteger(stored.tracking.number) || stored.tracking.number < 1 || stored.tracking.number > 200 || typeof stored.tracking.club !== "string" || stored.tracking.club.length > 80 || !isGeoPoint(stored.tracking.start)))
    || (stored.selectedClubId !== undefined && !CLUB_PROFILES.some((profile) => profile.id === stored.selectedClubId))
    || (stored.teeShotClubId !== undefined && !CLUB_PROFILES.some((profile) => profile.id === stored.teeShotClubId))
  ) {
    return undefined;
  }

  const lockedShots = stored.lockedShots.map((shot) => ({
    ...shot,
    start: { ...shot.start },
    end: { ...shot.end },
    caddyAim: shot.caddyAim ? snapshotAimPlan(shot.caddyAim) : null,
    plannedAim: shot.plannedAim ? snapshotAimPlan(shot.plannedAim) : null,
    realPlannedAim: shot.realPlannedAim ? { point: [...shot.realPlannedAim.point] as GeoJsonPosition, source: shot.realPlannedAim.source } : null,
  }));
  const manualEntries = stored.manualEntries.map((entry) => ({ ...entry }));
  const ids = new Set(lockedShots.map((shot) => shot.id));
  const manualIds = new Set(manualEntries.map((entry) => entry.id));
  const eventIds = new Set(manualEntries.map((entry) => entry.eventId));
  if (ids.size !== lockedShots.length || manualIds.size !== manualEntries.length || eventIds.size !== manualEntries.length) return undefined;

  return {
    version: 1,
    roundId: stored.roundId,
    courseId: stored.courseId,
    holeNumber: stored.holeNumber,
    score: stored.score,
    lockedShots,
    manualEntries,
    tracking: stored.tracking,
    selectedClubId: stored.selectedClubId,
    teeShotClubId: stored.teeShotClubId,
  };
}

function loadStoredRoundSession(storage: Pick<Storage, "getItem"> | undefined): StoredRoundSession | null {
  if (!storage) return null;
  try {
    return parseStoredRoundSession(storage.getItem(ROUND_SESSION_STORAGE_KEY) ?? "") ?? null;
  } catch {
    return null;
  }
}

function storeRoundSession(storage: Pick<Storage, "setItem"> | undefined, session: StoredRoundSession): void {
  storage?.setItem(ROUND_SESSION_STORAGE_KEY, JSON.stringify(session));
}

function createRoundLogForRound(courseId: string, holeNumber: number, score = 4, events: RoundEvent[] = []): RoundLog {
  return {
    version: 1,
    roundId: `${courseId}:${holeNumber}`,
    courseId,
    holeNumber,
    score,
    events,
  };
}

function isActiveRoundSummary(value: unknown): value is ActiveRoundSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const summary = value as Partial<ActiveRoundSummary>;
  return (
    summary.version === 1 &&
    typeof summary.courseId === "string" &&
    summary.courseId.trim().length > 0 &&
    summary.courseId.length <= 160 &&
    typeof summary.courseName === "string" &&
    summary.courseName.trim().length > 0 &&
    summary.courseName.length <= 160 &&
    typeof summary.layoutLabel === "string" &&
    summary.layoutLabel.trim().length > 0 &&
    summary.layoutLabel.length <= 64 &&
    typeof summary.holeNumber === "number" &&
    Number.isInteger(summary.holeNumber) &&
    summary.holeNumber >= 1 &&
    summary.holeNumber <= 18 &&
    isTeeBox(summary.teeBox) &&
    isActiveRoundStatus(summary.status) &&
    isIsoTimestamp(summary.updatedAt)
  );
}

function loadStoredStartView(): StartView {
  if (typeof window === "undefined") return "start";
  try {
    const storedValue = window.localStorage.getItem(START_VIEW_STORAGE_KEY);
    return isStartView(storedValue) ? storedValue : "start";
  } catch {
    return "start";
  }
}

function loadStoredActiveRound(): ActiveRoundSummary | null {
  if (typeof window === "undefined") return null;
  try {
    const storedValue = window.localStorage.getItem(ACTIVE_ROUND_STORAGE_KEY);
    if (!storedValue) return null;
    const parsed: unknown = JSON.parse(storedValue);
    if (isActiveRoundSummary(parsed)) return parsed;
    window.localStorage.removeItem(ACTIVE_ROUND_STORAGE_KEY);
    return null;
  } catch {
    try {
      window.localStorage.removeItem(ACTIVE_ROUND_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures; the invalid record is still ignored.
    }
    return null;
  }
}

function activeRoundLayoutLabel(course: CourseCatalogEntry | null): string {
  if (!course || course.id === DEMO_OPENROUND_COURSE.id) return "DEMO FIXTURE";
  const layout = course.name.split("·").at(-1)?.trim();
  return layout ? layout.toUpperCase() : "COURSE";
}

function activeRoundStatusLabel(status: ActiveRoundStatus): string {
  if (status === "tracking") return "GPS TRACKING";
  if (status === "paused") return "PAUSED · GPS REQUIRED";
  if (status === "complete") return "ROUND COMPLETE";
  return "READY TO PLAY";
}

function createActiveRoundSummary(
  course: CourseCatalogEntry | null,
  holeNumber: number,
  teeBox: TeeBox,
  status: ActiveRoundStatus,
): ActiveRoundSummary {
  return {
    version: 1,
    courseId: course?.id ?? DEMO_OPENROUND_COURSE.id,
    courseName: course?.name ?? "DEMO COURSE",
    layoutLabel: activeRoundLayoutLabel(course),
    holeNumber: clamp(Math.round(holeNumber), 1, 18),
    teeBox,
    status,
    updatedAt: new Date().toISOString(),
  };
}

function loadStoredRoundSetup(): RoundSetup {
  if (typeof window === "undefined") return DEFAULT_ROUND_SETUP;

  try {
    const storedValue = window.localStorage.getItem(ROUND_SETUP_STORAGE_KEY);
    if (!storedValue) return DEFAULT_ROUND_SETUP;
    const parsedValue: unknown = JSON.parse(storedValue);
    if (!parsedValue || typeof parsedValue !== "object") return DEFAULT_ROUND_SETUP;
    const stored = parsedValue as Partial<RoundSetup>;
    const playerName = typeof stored.playerName === "string" ? stored.playerName.trim().slice(0, 40) : "";
    if (
      stored.version !== 1 ||
      !playerName ||
      !isTeeBox(stored.teeBox) ||
      typeof stored.tournamentMode !== "boolean" ||
      typeof stored.handicapScoring !== "boolean" ||
      typeof stored.trackFitness !== "boolean" ||
      !isRoundGameType(stored.gameType) ||
      !isRoundScoringSystem(stored.scoringSystem)
    ) {
      return DEFAULT_ROUND_SETUP;
    }
    return {
      version: 1,
      playerName,
      teeBox: stored.teeBox,
      tournamentMode: stored.tournamentMode,
      handicapScoring: stored.handicapScoring,
      trackFitness: stored.trackFitness,
      gameType: stored.gameType,
      scoringSystem: stored.scoringSystem,
      golfers: Array.isArray(stored.golfers) ? [...new Set(stored.golfers.filter((name): name is string => typeof name === "string" && name.trim().length > 0 && name.length <= 40))].slice(0, 3) : [],
    };
  } catch {
    return DEFAULT_ROUND_SETUP;
  }
}

function loadStoredPlayingConditions(): PlayingConditions {
  if (typeof window === "undefined") return DEFAULT_PLAYING_CONDITIONS;

  try {
    const storedValue = window.localStorage.getItem(CONDITIONS_STORAGE_KEY);
    if (!storedValue) return DEFAULT_PLAYING_CONDITIONS;
    const parsedValue: unknown = JSON.parse(storedValue);
    if (!parsedValue || typeof parsedValue !== "object") return DEFAULT_PLAYING_CONDITIONS;
    const conditions = parsedValue as Partial<PlayingConditions>;
    const windMph = conditions.windMph;
    const windDirection = conditions.windDirection;
    const elevationYards = conditions.elevationYards;
    const temperatureF = conditions.temperatureF === undefined ? DEFAULT_PLAYING_CONDITIONS.temperatureF : conditions.temperatureF;
    if (
      typeof windMph !== "number" ||
      !Number.isFinite(windMph) ||
      !Number.isInteger(windMph) ||
      windMph < 0 ||
      windMph > 30 ||
      !isWindDirection(windDirection) ||
      typeof elevationYards !== "number" ||
      !Number.isFinite(elevationYards) ||
      !Number.isInteger(elevationYards) ||
      elevationYards < -20 ||
      elevationYards > 20 ||
      typeof temperatureF !== "number" ||
      !Number.isFinite(temperatureF) ||
      !Number.isInteger(temperatureF) ||
      temperatureF < -40 ||
      temperatureF > 140
    ) {
      return DEFAULT_PLAYING_CONDITIONS;
    }
    return {
      windMph,
      windDirection,
      elevationYards,
      temperatureF,
    };
  } catch {
    return DEFAULT_PLAYING_CONDITIONS;
  }
}

function windDirectionLabel(direction: WindDirection) {
  if (direction === "headwind") return "HEADWIND";
  if (direction === "tailwind") return "TAILWIND";
  return "CROSSWIND";
}

function formatSignedYards(value: number) {
  return `${value > 0 ? "+" : ""}${value} YD`;
}

function getAimMetrics(point: CoursePoint, pin = HOLE_7_GEOMETRY.pin, origin = HOLE_7_GEOMETRY.ball) {
  const aimEast = point.eastYards - origin.eastYards;
  const aimForward = point.forwardYards - origin.forwardYards;
  const pinEast = pin.eastYards - origin.eastYards;
  const pinForward = pin.forwardYards - origin.forwardYards;
  const centerlineLength = Math.hypot(pinEast, pinForward);
  const signedOffset = centerlineLength > 0
    ? (pinForward * aimEast - pinEast * aimForward) / centerlineLength
    : 0;

  return {
    playsLikeYards: Math.round(Math.hypot(aimEast, aimForward) + PLAYS_LIKE_ADJUSTMENT_YARDS),
    signedOffsetYards: Math.round(signedOffset),
  };
}

function courseDistanceYards(left: CoursePoint, right: CoursePoint) {
  return Math.round(Math.hypot(right.eastYards - left.eastYards, right.forwardYards - left.forwardYards));
}

function formatAimLabel(signedOffsetYards: number) {
  if (Math.abs(signedOffsetYards) < 1) return "CENTER";
  return `${Math.abs(signedOffsetYards)} YD ${signedOffsetYards < 0 ? "LEFT" : "RIGHT"}`;
}

function formatCompactAim(signedOffsetYards: number) {
  if (Math.abs(signedOffsetYards) < 1) return "CTR";
  return `${Math.abs(signedOffsetYards)}${signedOffsetYards < 0 ? "L" : "R"}`;
}

function equipmentFormFromClub(club: EquipmentClub): EquipmentFormDraft {
  return {
    name: club.name,
    brand: club.brand,
    model: club.model,
    type: club.type,
    loft: club.loft === null ? "" : String(club.loft),
    carryYards: club.carryYards === null ? "" : String(club.carryYards),
    totalYards: club.totalYards === null ? "" : String(club.totalYards),
  };
}

function emptyEquipmentForm(): EquipmentFormDraft {
  return { name: "New Club", brand: "", model: "", type: "iron", loft: "", carryYards: "", totalYards: "" };
}

function emptyFieldLogDraft(provider: FieldLogImageryProvider = "usgs"): FieldLogDraft {
  return {
    device: "Marcus iPhone",
    provider,
    expectedYards: "",
    recordedYards: "",
    accuracyMeters: "",
    fixAgeSeconds: "",
    lateralYards: "",
    longitudinalYards: "",
    attributionVisible: true,
    alignmentAtOneX: false,
    alignmentAtTwoX: false,
    note: "",
  };
}

function fixAgeSecondsForTimestamp(capturedAt: number, now = Date.now()): number | null {
  if (!Number.isFinite(capturedAt) || capturedAt <= 0 || !Number.isFinite(now) || now < capturedAt) return null;
  const ageSeconds = Math.round((now - capturedAt) / 1000);
  return ageSeconds <= FIELD_LOG_MAX_RECORDED_FIX_AGE_SECONDS ? ageSeconds : null;
}

function parseFieldLogMeasurement(value: string, minimum: number, maximum: number): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) return undefined;
  return parsed;
}

function equipmentInputFromForm(draft: EquipmentFormDraft): { input?: EquipmentClubInput; error?: string } {
  const name = draft.name.trim();
  if (!name) return { error: "Add a club name before saving." };
  if (name.length > 40) return { error: "Club names must be 40 characters or fewer." };

  const parseMeasurement = (value: string, maximum: number): number | null | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
      return undefined;
    }
    return parsed;
  };

  if (!EQUIPMENT_TYPES.includes(draft.type)) return { error: "Choose a valid club type." };
  const loft = parseMeasurement(draft.loft, 80);
  if (loft === undefined) return { error: "Loft must be between 0 and 80 degrees." };
  const carryYards = parseMeasurement(draft.carryYards, 400);
  if (carryYards === undefined) return { error: "Carry must be between 0 and 400 yards." };
  const totalYards = parseMeasurement(draft.totalYards, 500);
  if (totalYards === undefined) return { error: "Total must be between 0 and 500 yards." };
  if (totalYards !== null && carryYards !== null && totalYards < carryYards) return { error: "Total must be at least as long as carry." };

  return {
    input: {
      name,
      brand: draft.brand.trim().slice(0, 40),
      model: draft.model.trim().slice(0, 60),
      type: draft.type,
      loft,
      carryYards,
      totalYards,
    },
  };
}

function routeSegmentStyle(from: MapPoint, to: MapPoint, mapSize: MapSize): CSSProperties {
  const deltaX = (to.x - from.x) * mapSize.width;
  const deltaY = (to.y - from.y) * mapSize.height;

  return {
    left: `${from.x * 100}%`,
    top: `${from.y * 100}%`,
    width: `${Math.hypot(deltaX, deltaY)}px`,
    transform: `translateY(-50%) rotate(${Math.atan2(deltaY, deltaX) * (180 / Math.PI)}deg)`,
  };
}

function mapPointStyle(point: MapPoint): CSSProperties {
  return {
    left: `${point.x * 100}%`,
    top: `${point.y * 100}%`,
  };
}

function createUsgsViewportExportUrl(mapSize: MapSize, center: GeoPoint, detailScale = 1): string | null {
  const width = Math.round(mapSize.width);
  const height = Math.round(mapSize.height);
  if (width < 2 || height < 2 || !Number.isFinite(center.lat) || !Number.isFinite(center.lon)) return null;

  const worldSize = MAP_TILE_SIZE_PX * 2 ** MAP_TILE_ZOOM;
  const metersPerWorldPixel = WEB_MERCATOR_WORLD_METERS / worldSize;
  const centerWorld = webMercatorWorldPixel(center, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
  const centerMeters = {
    x: centerWorld.x * metersPerWorldPixel - WEB_MERCATOR_HALF_WORLD_METERS,
    y: WEB_MERCATOR_HALF_WORLD_METERS - centerWorld.y * metersPerWorldPixel,
  };
  const halfWidthMeters = (width / (2 * detailScale)) * metersPerWorldPixel;
  const halfHeightMeters = (height / (2 * detailScale)) * metersPerWorldPixel;
  const bbox = [
    centerMeters.x - halfWidthMeters,
    centerMeters.y - halfHeightMeters,
    centerMeters.x + halfWidthMeters,
    centerMeters.y + halfHeightMeters,
  ].map((value) => value.toFixed(3)).join(",");
  const oversample = Math.min(
    USGS_VIEWPORT_EXPORT_OVERSAMPLE,
    USGS_VIEWPORT_EXPORT_MAX_DIMENSION / Math.max(width, height),
  );
  const exportWidth = Math.max(2, Math.round(width * oversample));
  const exportHeight = Math.max(2, Math.round(height * oversample));
  const query = new URLSearchParams({
    bbox,
    bboxSR: "3857",
    imageSR: "3857",
    size: `${exportWidth},${exportHeight}`,
    format: "jpg",
    compressionQuality: "100",
    f: "image",
  });
  return `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage?${query.toString()}`;
}

function satelliteTileZoom(provider: SatelliteProvider, detailScale: number): number {
  if (provider !== "google") return Math.min(MAP_TILE_ZOOM, 16);
  const scale = Number.isFinite(detailScale) ? Math.max(1, detailScale) : 1;
  return Math.min(GOOGLE_MAP_TILE_MAX_ZOOM, MAP_TILE_ZOOM + Math.ceil(Math.log2(scale)));
}

function createSatelliteTiles(
  mapSize: MapSize,
  provider: SatelliteProvider,
  session: string | null,
  mapCenter = MAP_FOCUS_GEO,
  detailCenter = mapCenter,
  detailScale = 1,
): MapTile[] {
  // The USGS cache serves NAIP imagery through level 16 for the course areas
  // used by this prototype. Keep the imagery and Web Mercator geometry at the
  // same level so a free-key fallback stays aligned with the course layers.
  const tileZoom = satelliteTileZoom(provider, detailScale);
  const renderScale = 2 ** (MAP_TILE_ZOOM - tileZoom);
  const mapCenterWorld = webMercatorWorldPixel(mapCenter, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
  const mapTopLeft = {
    x: mapCenterWorld.x - mapSize.width / 2,
    y: mapCenterWorld.y - mapSize.height / 2,
  };
  const visibleScale = Number.isFinite(detailScale) && detailScale > 0 ? detailScale : 1;
  const visibleCenter = webMercatorWorldPixel(detailCenter, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
  // A viewport diagonal covers every corner, including when the hole is rotated.
  const visibleWidth = Math.hypot(mapSize.width, mapSize.height) / visibleScale;
  const visibleHeight = visibleWidth;
  const visibleTopLeft = {
    x: visibleCenter.x - visibleWidth / 2,
    y: visibleCenter.y - visibleHeight / 2,
  };
  const renderedTileSize = MAP_TILE_SIZE_PX * renderScale;
  const firstTileX = Math.floor(visibleTopLeft.x / renderedTileSize) - 1;
  const lastTileX = Math.ceil((visibleTopLeft.x + visibleWidth) / renderedTileSize) + 1;
  const firstTileY = Math.floor(visibleTopLeft.y / renderedTileSize) - 1;
  const lastTileY = Math.ceil((visibleTopLeft.y + visibleHeight) / renderedTileSize) + 1;
  const tileCount = 2 ** tileZoom;
  const tiles: MapTile[] = [];

  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue;
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
      const url =
        provider === "google" && session
          ? `https://tile.googleapis.com/v1/2dtiles/${tileZoom}/${wrappedTileX}/${tileY}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`
          : `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${tileZoom}/${tileY}/${wrappedTileX}`;

      tiles.push({
        x: wrappedTileX,
        y: tileY,
        left: tileX * renderedTileSize - mapTopLeft.x,
        top: tileY * renderedTileSize - mapTopLeft.y,
        renderSize: renderedTileSize,
        url,
      });
    }
  }

  return tiles;
}

function SatelliteLayer({
  mapSize,
  center = MAP_FOCUS_GEO,
  detailCenter = center,
  detailScale = 1,
  viewportExport = false,
  onProviderChange,
}: {
  mapSize: MapSize;
  center?: GeoPoint;
  detailCenter?: GeoPoint;
  detailScale?: number;
  viewportExport?: boolean;
  onProviderChange?: (provider: SatelliteProvider) => void;
}) {
  const [googleSession, setGoogleSession] = useState<string | null>(null);
  const [loadedProvider, setLoadedProvider] = useState<SatelliteProvider | null>(null);
  const [viewportExportLoaded, setViewportExportLoaded] = useState(false);
  const [viewportExportFailed, setViewportExportFailed] = useState(false);
  const googleConfigured = GOOGLE_MAPS_API_KEY.length > 0;

  useEffect(() => {
    let cancelled = false;
    setGoogleSession(null);
    if (!googleConfigured) return () => undefined;

    fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapType: "satellite", language: "en-US", region: "US" }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Google Maps session unavailable"))))
      .then((payload: unknown) => {
        if (!cancelled && payload && typeof payload === "object" && typeof (payload as { session?: unknown }).session === "string") {
          setGoogleSession((payload as { session: string }).session);
        }
      })
      .catch(() => {
        if (!cancelled) setGoogleSession(null);
      });

    return () => {
      cancelled = true;
    };
  }, [googleConfigured]);

  const provider: SatelliteProvider = googleConfigured && googleSession ? "google" : "usgs";
  const coverageSize = Math.ceil(Math.hypot(mapSize.width, mapSize.height));
  const viewportExportUrl = provider === "usgs" && viewportExport
    ? createUsgsViewportExportUrl({ width: coverageSize, height: coverageSize }, detailCenter, detailScale)
    : null;
  const tileZoom = satelliteTileZoom(provider, detailScale);
  const tiles = createSatelliteTiles(mapSize, provider, googleSession, center, detailCenter, detailScale);
  const liveReady = viewportExportLoaded || loadedProvider === provider;
  const baseCenterWorld = webMercatorWorldPixel(center, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
  const detailCenterWorld = webMercatorWorldPixel(detailCenter, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
  const detailWidth = coverageSize / detailScale;
  const detailHeight = detailWidth;
  const detailImageStyle: CSSProperties = {
    left: mapSize.width / 2 + detailCenterWorld.x - baseCenterWorld.x - detailWidth / 2,
    top: mapSize.height / 2 + detailCenterWorld.y - baseCenterWorld.y - detailHeight / 2,
    width: detailWidth,
    height: detailHeight,
  };

  useEffect(() => {
    onProviderChange?.(provider);
  }, [onProviderChange, provider]);

  useEffect(() => {
    setViewportExportLoaded(false);
    setViewportExportFailed(false);
  }, [provider, viewportExportUrl]);

  return (
    <div
      className="satellite-layer"
      data-provider={provider}
      data-live={liveReady ? "true" : "false"}
      data-tile-zoom={tileZoom}
      data-detail-scale={detailScale.toFixed(2)}
      data-viewport-export={viewportExportUrl ? (viewportExportLoaded ? "ready" : viewportExportFailed ? "failed" : "pending") : "off"}
      aria-label={provider === "google" ? "Google satellite imagery" : "USGS and USDA NAIP aerial imagery fallback"}
    >
      {viewportExportUrl ? (
        <img
          className="satellite-viewport-export"
          src={viewportExportUrl}
          alt=""
          aria-hidden="true"
          decoding="async"
          style={detailImageStyle}
          onLoad={() => setViewportExportLoaded(true)}
          onError={() => setViewportExportFailed(true)}
        />
      ) : null}
      {tiles.map((tile) => (
        <img
          className="satellite-tile"
          key={`${tile.x}-${tile.y}-${tile.url}`}
          src={tile.url}
          alt=""
          aria-hidden="true"
          style={{ left: `${tile.left}px`, top: `${tile.top}px`, width: `${tile.renderSize}px`, height: `${tile.renderSize}px` }}
          onLoad={() => setLoadedProvider(provider)}
        />
      ))}
      <span className="map-attribution" aria-hidden="true">
        {provider === "google" ? "Google Maps" : googleConfigured ? "USGS / USDA NAIP · GOOGLE UNAVAILABLE" : "USGS / USDA NAIP · add Google key"}
      </span>
    </div>
  );
}

function geometryPositions(geometry: GeoJsonGeometry): GeoJsonPosition[] {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "LineString") return geometry.coordinates;
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  return geometry.coordinates.flat(2);
}

function geoDistanceYards(left: GeoJsonPosition, right: GeoJsonPosition) {
  const dLat = toRadians(right[1] - left[1]);
  const dLon = toRadians(right[0] - left[0]);
  const latitude = toRadians((left[1] + right[1]) / 2);
  return Math.hypot(dLat, dLon * Math.cos(latitude)) * EARTH_RADIUS_METERS * YARDS_PER_METER;
}

function localDeltaYards(origin: GeoPoint, target: GeoPoint) {
  const latitude = toRadians((origin.lat + target.lat) / 2);
  const metersPerDegree = EARTH_RADIUS_METERS * Math.PI / 180;
  return {
    eastYards: (target.lon - origin.lon) * metersPerDegree * Math.cos(latitude) * YARDS_PER_METER,
    northYards: (target.lat - origin.lat) * metersPerDegree * YARDS_PER_METER,
  };
}

function shotOffsetFromStoredAim(shot: LockedShot): ShotOffset | null {
  if (!shot.realPlannedAim) return null;

  const aim = shot.realPlannedAim.point;
  const aimDelta = localDeltaYards(shot.start, { lat: aim[1], lon: aim[0] });
  const shotDelta = localDeltaYards(shot.start, shot.end);
  const aimDistance = Math.hypot(aimDelta.eastYards, aimDelta.northYards);
  if (!Number.isFinite(aimDistance) || aimDistance < 1) return null;

  const forwardEast = aimDelta.eastYards / aimDistance;
  const forwardNorth = aimDelta.northYards / aimDistance;
  const rightEast = forwardNorth;
  const rightNorth = -forwardEast;

  return {
    lateralYards: shotDelta.eastYards * rightEast + shotDelta.northYards * rightNorth,
    distanceYards: shotDelta.eastYards * forwardEast + shotDelta.northYards * forwardNorth - aimDistance,
  };
}

function geoGeometryDistanceYards(origin: GeoJsonPosition, geometry: GeoJsonGeometry) {
  const paths: GeoJsonPosition[][] = geometry.type === "Point"
    ? [[geometry.coordinates]]
    : geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.type === "Polygon"
        ? geometry.coordinates
        : geometry.coordinates.flat();
  const originLatitude = toRadians(origin[1]);
  const metersPerDegree = EARTH_RADIUS_METERS * Math.PI / 180;
  const metersPerLongitudeDegree = metersPerDegree * Math.cos(originLatitude);
  const toLocalMeters = ([longitude, latitude]: GeoJsonPosition) => ({
    x: (longitude - origin[0]) * metersPerLongitudeDegree,
    y: (latitude - origin[1]) * metersPerDegree,
  });
  let nearestMeters = Number.POSITIVE_INFINITY;
  for (const path of paths) {
    for (let index = 0; index < path.length; index += 1) {
      const current = toLocalMeters(path[index]!);
      nearestMeters = Math.min(nearestMeters, Math.hypot(current.x, current.y));
      const nextPosition = path[index + 1];
      if (!nextPosition) continue;
      const next = toLocalMeters(nextPosition);
      const dx = next.x - current.x;
      const dy = next.y - current.y;
      const lengthSquared = dx * dx + dy * dy;
      const projection = lengthSquared > 0
        ? clamp(-(current.x * dx + current.y * dy) / lengthSquared, 0, 1)
        : 0;
      nearestMeters = Math.min(nearestMeters, Math.hypot(current.x + dx * projection, current.y + dy * projection));
    }
  }
  return nearestMeters * YARDS_PER_METER;
}

function nearestGeoPosition(origin: GeoJsonPosition, geometry: GeoJsonGeometry): GeoJsonPosition | undefined {
  const paths: GeoJsonPosition[][] = geometry.type === "Point"
    ? [[geometry.coordinates]]
    : geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.type === "Polygon"
        ? geometry.coordinates
        : geometry.coordinates.flat();
  const originLatitude = toRadians(origin[1]);
  const metersPerDegree = EARTH_RADIUS_METERS * Math.PI / 180;
  const metersPerLongitudeDegree = metersPerDegree * Math.cos(originLatitude);
  const toLocalMeters = ([longitude, latitude]: GeoJsonPosition) => ({
    x: (longitude - origin[0]) * metersPerLongitudeDegree,
    y: (latitude - origin[1]) * metersPerDegree,
  });
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  let nearestPosition: GeoJsonPosition | undefined;
  const consider = (position: GeoJsonPosition, local: { x: number; y: number }) => {
    const distanceSquared = local.x * local.x + local.y * local.y;
    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared;
      nearestPosition = position;
    }
  };

  for (const path of paths) {
    for (let index = 0; index < path.length; index += 1) {
      const currentPosition = path[index]!;
      const current = toLocalMeters(currentPosition);
      consider(currentPosition, current);
      const nextPosition = path[index + 1];
      if (!nextPosition) continue;
      const next = toLocalMeters(nextPosition);
      const dx = next.x - current.x;
      const dy = next.y - current.y;
      const lengthSquared = dx * dx + dy * dy;
      const projection = lengthSquared > 0
        ? clamp(-(current.x * dx + current.y * dy) / lengthSquared, 0, 1)
        : 0;
      consider(
        [
          currentPosition[0] + (nextPosition[0] - currentPosition[0]) * projection,
          currentPosition[1] + (nextPosition[1] - currentPosition[1]) * projection,
        ],
        { x: current.x + dx * projection, y: current.y + dy * projection },
      );
    }
  }
  return nearestPosition;
}

function meanGeoPosition(positions: GeoJsonPosition[]): GeoJsonPosition | undefined {
  if (positions.length === 0) return undefined;
  return [
    positions.reduce((sum, [longitude]) => sum + longitude, 0) / positions.length,
    positions.reduce((sum, [, latitude]) => sum + latitude, 0) / positions.length,
  ];
}

/**
 * A facility-wide OSM extract can contain tee polygons for several nearby
 * layouts. Keep the tee set on the tee-side of the selected green so the
 * top-facing map does not render another hole's tees above the target. The
 * selection is made in Web Mercator space, so it follows the same bearing as
 * the map rotation and remains stable across viewport sizes.
 */
function teeFeaturesForTargetGreen(
  features: LoadedHoleGeometry["hole"]["features"],
  green: GeoJsonPosition | undefined,
) {
  const teeFeatures = features.filter((feature) => feature.kind === "tee");
  // A normal hole snapshot has two to four tee boxes. Only apply the
  // facility-wide cluster heuristic when an extract contains more than that;
  // otherwise preserve every authored tee marker (including the four Lakes
  // tee boxes).
  if (!green || teeFeatures.length <= 4) return teeFeatures;
  const teeCenters = teeFeatures.map((feature) => ({
    feature,
    center: meanGeoPosition(geometryPositions(feature.geometry)),
  })).filter((entry): entry is { feature: (typeof teeFeatures)[number]; center: GeoJsonPosition } => Boolean(entry.center));
  if (teeCenters.length < 3) return teeFeatures;
  const centroid = meanGeoPosition(teeCenters.map((entry) => entry.center));
  if (!centroid) return teeFeatures;
  const centroidWorld = webMercatorWorldPixel({ lat: centroid[1], lon: centroid[0] }, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
  const greenWorld = webMercatorWorldPixel({ lat: green[1], lon: green[0] }, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
  const forwardX = greenWorld.x - centroidWorld.x;
  const forwardY = greenWorld.y - centroidWorld.y;
  const forwardLength = Math.hypot(forwardX, forwardY);
  if (forwardLength < 1) return teeFeatures;
  const selected = teeCenters
    .filter((entry) => {
      const world = webMercatorWorldPixel({ lat: entry.center[1], lon: entry.center[0] }, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
      const dot = (world.x - centroidWorld.x) * forwardX + (world.y - centroidWorld.y) * forwardY;
      return dot <= 0;
    })
    .map((entry) => entry.feature);
  return selected.length >= 2 ? selected : teeFeatures;
}

function linePointAtFraction(positions: GeoJsonPosition[], fraction: number): GeoJsonPosition | undefined {
  if (positions.length === 0) return undefined;
  if (positions.length === 1) return positions[0];
  const clampedFraction = clamp(fraction, 0, 1);
  const lengths = positions.slice(1).map((position, index) => geoDistanceYards(positions[index]!, position));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!Number.isFinite(total) || total <= 0) return positions[Math.round((positions.length - 1) * clampedFraction)];
  let remaining = total * clampedFraction;
  for (let index = 1; index < positions.length; index += 1) {
    const segment = lengths[index - 1]!;
    if (remaining <= segment) {
      const ratio = segment > 0 ? remaining / segment : 0;
      const [fromLon, fromLat] = positions[index - 1]!;
      const [toLon, toLat] = positions[index]!;
      return [fromLon + (toLon - fromLon) * ratio, fromLat + (toLat - fromLat) * ratio];
    }
    remaining -= segment;
  }
  return positions.at(-1);
}

function approachTurnDegrees(origin: GeoJsonPosition, aim: GeoJsonPosition, pin: GeoJsonPosition) {
  const incoming = localDeltaYards({ lon: origin[0], lat: origin[1] }, { lon: aim[0], lat: aim[1] });
  const outgoing = localDeltaYards({ lon: aim[0], lat: aim[1] }, { lon: pin[0], lat: pin[1] });
  const incomingLength = Math.hypot(incoming.eastYards, incoming.northYards);
  const outgoingLength = Math.hypot(outgoing.eastYards, outgoing.northYards);
  if (incomingLength < 1 || outgoingLength < 1) return 180;
  const cosine = clamp(
    (incoming.eastYards * outgoing.eastYards + incoming.northYards * outgoing.northYards) / (incomingLength * outgoingLength),
    -1,
    1,
  );
  return Math.acos(cosine) * 180 / Math.PI;
}

function geoMapPair(point: GeoPoint, mapCenter: GeoPoint, mapSize: MapSize) {
  const mapWidth = Math.max(1, mapSize.width);
  const mapHeight = Math.max(1, mapSize.height);
  const world = webMercatorWorldPixel(point, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
  const centerWorld = webMercatorWorldPixel(mapCenter, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
  return {
    x: ((mapWidth / 2 + world.x - centerWorld.x) / mapWidth) * 100,
    y: ((mapHeight / 2 + world.y - centerWorld.y) / mapHeight) * 100,
  };
}

/**
 * Return the fixed course rotation that puts the tee at the bottom of the
 * viewport and the green at the top. The map layer and every geometry overlay
 * share this transform, so their relative alignment is preserved.
 */
function topFacingRotationDegrees(tee: GeoJsonPosition | undefined, green: GeoJsonPosition | undefined) {
  if (!tee || !green) return 0;
  const teeWorld = webMercatorWorldPixel({ lat: tee[1], lon: tee[0] }, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
  const greenWorld = webMercatorWorldPixel({ lat: green[1], lon: green[0] }, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
  const deltaX = greenWorld.x - teeWorld.x;
  const deltaY = greenWorld.y - teeWorld.y;
  if (Math.hypot(deltaX, deltaY) < 1) return 0;

  // atan2(deltaX, -deltaY) measures the tee→green bearing from screen-up.
  // Negating it is the CSS rotation needed to bring that bearing to 12 o'clock.
  const rawDegrees = -(Math.atan2(deltaX, -deltaY) * 180) / Math.PI;
  return ((rawDegrees + 180) % 360 + 360) % 360 - 180;
}

function rotatedMapCoverScale(mapSize: MapSize, rotationRadians: number) {
  const width = Math.max(1, mapSize.width);
  const height = Math.max(1, mapSize.height);
  const cosine = Math.abs(Math.cos(rotationRadians));
  const sine = Math.abs(Math.sin(rotationRadians));
  const rotatedWidth = width * cosine + height * sine;
  const rotatedHeight = width * sine + height * cosine;
  // A small edge buffer keeps anti-aliased corners from exposing the map
  // container when the course bearing is close to a diagonal.
  return Math.max(1, rotatedWidth / width, rotatedHeight / height) * 1.02;
}

function midpointGeoPosition(left: GeoJsonPosition | undefined, right: GeoJsonPosition | undefined): GeoJsonPosition | undefined {
  if (!left || !right) return undefined;
  return interpolateGeoPosition(left, right, 0.5);
}

function interpolateGeoPosition(left: GeoJsonPosition | undefined, right: GeoJsonPosition | undefined, fraction: number): GeoJsonPosition | undefined {
  if (!left || !right) return undefined;
  const leftWorld = webMercatorWorldPixel({ lat: left[1], lon: left[0] }, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
  const rightWorld = webMercatorWorldPixel({ lat: right[1], lon: right[0] }, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
  const t = clamp(fraction, 0, 1);
  const midpoint = webMercatorGeoPoint(
    { x: leftWorld.x + (rightWorld.x - leftWorld.x) * t, y: leftWorld.y + (rightWorld.y - leftWorld.y) * t },
    MAP_TILE_ZOOM,
    MAP_TILE_SIZE_PX,
  );
  return [midpoint.lon, midpoint.lat];
}

function RealCourseGeometryOverlay({
  geometry,
  mapCenter,
  mapSize,
  origin,
  planningFocus,
  rotationDeg,
  mapScale,
  targetGreenId,
  teeFeatureIds,
  selectedHazardId,
  onHazardSelect,
}: {
  geometry: LoadedHoleGeometry;
  mapCenter: GeoPoint;
  mapSize: MapSize;
  origin?: GeoJsonPosition;
  planningFocus: boolean;
  rotationDeg: number;
  mapScale: number;
  targetGreenId?: string;
  teeFeatureIds?: ReadonlySet<string>;
  selectedHazardId: string | null;
  onHazardSelect: (featureId: string) => void;
}) {
  // Validate that the feature set has finite coordinates before rendering. The
  // actual projection below intentionally matches SatelliteLayer's Web Mercator
  // transform so OSM features stay aligned with the live imagery at every size.
  if (!createGeometryProjection(geometry.hole.features)) return null;
  const projectPair = ([longitude, latitude]: GeoJsonPosition) => {
    const projected = geoMapPair({ lat: latitude, lon: longitude }, mapCenter, mapSize);
    const x = projected.x;
    const y = projected.y;
    return { x: x.toFixed(2), y: y.toFixed(2) };
  };
  const project = (position: GeoJsonPosition) => {
    const point = projectPair(position);
    return `${point.x},${point.y}`;
  };
  // Keep point markers as tiny blue dots while the map zooms. Their geometry
  // remains attached to the course projection, but the visual marker should
  // not balloon into a second target at detail scale.
  const pointRadius = Math.max(0.42, Math.min(1.7, 1.7 / Math.max(1, mapScale)));
  const teePositions = geometry.hole.features
    .filter((feature) => feature.kind === "tee" && (!teeFeatureIds || teeFeatureIds.has(feature.id)))
    .flatMap((feature) => geometryPositions(feature.geometry));
  const teeOrigin: GeoJsonPosition | undefined = teePositions.length > 0
    ? [teePositions.reduce((sum, [longitude]) => sum + longitude, 0) / teePositions.length, teePositions.reduce((sum, [, latitude]) => sum + latitude, 0) / teePositions.length]
    : undefined;
  const distanceOrigin = origin ?? teeOrigin;
  const hazardCallouts = geometry.quality.hazardsUsable && distanceOrigin
    ? geometry.hole.features
      .filter((feature) => ["bunker", "water", "waste", "out_of_bounds"].includes(feature.kind))
      .map((feature) => {
        const featurePositions = geometryPositions(feature.geometry);
        const nearest = geoGeometryDistanceYards(distanceOrigin, feature.geometry);
        const center = meanGeoPosition(featurePositions);
        const anchor = distanceOrigin ? nearestGeoPosition(distanceOrigin, feature.geometry) ?? center : center;
        return anchor && Number.isFinite(nearest) ? { feature, center: anchor, nearest } : undefined;
      })
      .filter((callout): callout is { feature: (typeof geometry.hole.features)[number]; center: GeoJsonPosition; nearest: number } => Boolean(callout))
      .filter((callout) => callout.feature.id === selectedHazardId)
      .sort((left, right) => left.nearest - right.nearest)
    : [];

  return (
    <svg className="real-geometry-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Loaded OpenStreetMap hole geometry">
      {geometry.hole.features.map((feature) => {
        // A few OSM extracts include an adjacent/duplicate green in the same
        // hole query. Render only the target green chosen by the verified pin
        // so placement taps and the visible map use one unambiguous surface.
        if (feature.kind === "green" && targetGreenId && feature.id !== targetGreenId) return null;
        // Keep only the tee-side cluster selected for this target green. OSM
        // can return adjacent layout tees in the same facility response.
        if (feature.kind === "tee" && teeFeatureIds && !teeFeatureIds.has(feature.id)) return null;
        const points = geometryPositions(feature.geometry).map(project).join(" ");
        const closed = ["tee", "green", "fairway", "bunker", "water", "waste", "out_of_bounds"].includes(feature.kind);
        const isHazard = ["bunker", "water", "waste", "out_of_bounds"].includes(feature.kind);
        const hazardClass = isHazard && selectedHazardId === feature.id ? " real-geometry-hazard-selected" : "";
        const handleHazardPointerDown = isHazard
          ? (event: ReactPointerEvent<SVGElement>) => event.stopPropagation()
          : undefined;
        const handleHazardClick = isHazard
          ? (event: ReactMouseEvent<SVGElement>) => {
              event.preventDefault();
              event.stopPropagation();
              onHazardSelect(feature.id);
            }
          : undefined;
        const handleHazardKeyDown = isHazard
          ? (event: ReactKeyboardEvent<SVGElement>) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onHazardSelect(feature.id);
            }
          : undefined;
        if (feature.kind === "tee" && feature.geometry.type !== "Point") {
          const teeCenter = meanGeoPosition(geometryPositions(feature.geometry));
          if (!teeCenter) return null;
          const point = projectPair(teeCenter);
          return (
            <circle
              key={feature.id}
              cx={point.x}
              cy={point.y}
              r={Math.max(0.12, 0.32 / Math.max(1, mapScale))}
              className="real-geometry-point real-geometry-tee"
              pointerEvents="none"
              aria-label="Tee location"
            />
          );
        }
        if (feature.geometry.type === "Point") {
          const point = projectPair(feature.geometry.coordinates);
          return (
            <circle
              key={feature.id}
              cx={point.x}
              cy={point.y}
              r={pointRadius}
              className={`real-geometry-point real-geometry-${feature.kind}${hazardClass}`}
              data-hazard-id={isHazard ? feature.id : undefined}
              pointerEvents={isHazard ? "auto" : "none"}
              role={isHazard ? "button" : undefined}
              tabIndex={isHazard ? 0 : undefined}
              aria-label={isHazard ? `Select ${feature.kind.replaceAll("_", " ")} hazard distance` : undefined}
              onPointerDown={handleHazardPointerDown}
              onClick={handleHazardClick}
              onKeyDown={handleHazardKeyDown}
            />
          );
        }
        return closed ? (
          <polygon
            key={feature.id}
            points={points}
            className={`real-geometry-shape real-geometry-${feature.kind}${hazardClass}`}
            data-hazard-id={isHazard ? feature.id : undefined}
            pointerEvents={isHazard ? "auto" : "none"}
            role={isHazard ? "button" : undefined}
            tabIndex={isHazard ? 0 : undefined}
            aria-label={isHazard ? `Select ${feature.kind.replaceAll("_", " ")} hazard distance` : undefined}
            onPointerDown={handleHazardPointerDown}
            onClick={handleHazardClick}
            onKeyDown={handleHazardKeyDown}
          />
        ) : (
          <polyline
            key={feature.id}
            points={points}
            className={`real-geometry-line real-geometry-${feature.kind}${hazardClass}`}
            data-hazard-id={isHazard ? feature.id : undefined}
            pointerEvents={isHazard ? "auto" : "none"}
            role={isHazard ? "button" : undefined}
            tabIndex={isHazard ? 0 : undefined}
            aria-label={isHazard ? `Select ${feature.kind.replaceAll("_", " ")} hazard distance` : undefined}
            onPointerDown={handleHazardPointerDown}
            onClick={handleHazardClick}
            onKeyDown={handleHazardKeyDown}
          />
        );
      })}
      {hazardCallouts.map(({ feature, center, nearest }, index) => {
        const point = projectPair(center);
        const pointX = Number(point.x);
        const pointY = Number(point.y);
        // Keep the compact planning callout in the map gutter. The fairway,
        // aim line, and dispersion window remain unobstructed while the
        // distance stays anchored to the same validated hazard geometry.
        const rotationRadians = (rotationDeg * Math.PI) / 180;
        const cosine = Math.cos(rotationRadians);
        const sine = Math.sin(rotationRadians);
        const rotatedY = 50 + sine * (pointX - 50) + cosine * (pointY - 50);
        // The left gutter is reserved for the active planning callout so it
        // never competes with the floating action rail on the right.
        const targetScreenX = planningFocus ? 18 : pointX;
        const targetScreenY = planningFocus ? clamp(clamp(rotatedY, 24, 70) + index * 48, 24, 82) : pointY;
        const renderedScale = Math.max(1, mapScale);
        const preScaleX = 50 + (targetScreenX - 50) / renderedScale;
        const preScaleY = 50 + (targetScreenY - 50) / renderedScale;
        const labelX = planningFocus
          ? clamp(50 + cosine * (preScaleX - 50) + sine * (preScaleY - 50), 8, 92)
          : pointX;
        const labelY = planningFocus
          ? clamp(50 - sine * (preScaleX - 50) + cosine * (preScaleY - 50), 10, 90)
          : pointY;
        return (
          <g key={`${feature.id}-distance`} className="real-hazard-distance" data-hazard-id={feature.id}>
            <line
              className="real-hazard-leader"
              x1={pointX}
              y1={pointY}
              x2={labelX}
              y2={labelY}
              aria-hidden="true"
            />
            <g transform={`rotate(${-rotationDeg} ${labelX} ${labelY})`}>
              <rect x={labelX - 7} y={labelY - 3.8} width="14" height="4.6" rx="0.8" />
              <text x={labelX} y={labelY - 0.7} textAnchor="middle">{`${feature.kind.toUpperCase()} · ${Math.round(nearest)} TO`}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

function RealPlanOverlay({
  origin,
  aim,
  target,
  mapCenter,
  mapSize,
  rotationDeg,
  aimYards,
  aimToPinYards,
  showDistances,
  distanceLabelMode,
  mapScale,
}: {
  origin?: GeoJsonPosition;
  aim?: GeoJsonPosition;
  target?: GeoJsonPosition;
  mapCenter: GeoPoint;
  mapSize: MapSize;
  rotationDeg: number;
  aimYards?: number;
  aimToPinYards?: number;
  showDistances: boolean;
  distanceLabelMode: "number" | "split-labels";
  mapScale: number;
}) {
  if (!origin || !aim) return null;
  const start = geoMapPair({ lat: origin[1], lon: origin[0] }, mapCenter, mapSize);
  const landing = geoMapPair({ lat: aim[1], lon: aim[0] }, mapCenter, mapSize);
  const pin = target ? geoMapPair({ lat: target[1], lon: target[0] }, mapCenter, mapSize) : undefined;
  const aimLabel = {
    x: start.x + (landing.x - start.x) * 0.62,
    y: start.y + (landing.y - start.y) * 0.62,
  };
  const pinLabel = pin
    ? {
      x: landing.x + (pin.x - landing.x) * 0.52,
      y: landing.y + (pin.y - landing.y) * 0.52,
    }
    : undefined;
  const renderedScale = Math.max(1, mapScale);
  const uprightDistanceTransform = (point: { x: number; y: number }) => {
    const radians = rotationDeg * (Math.PI / 180);
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const aspect = mapSize.height > 0 ? mapSize.width / mapSize.height : 1;
    return `translate(${point.x} ${point.y}) matrix(${cosine} ${-aspect * sine} ${sine} ${aspect * cosine} 0 0)`;
  };
  const distanceLabel = (
    kind: "to-aim" | "aim-to-pin",
    yards: number,
    point: { x: number; y: number },
  ) => distanceLabelMode === "split-labels" ? (
    <g
      className="real-plan-distance-number"
      data-testid={kind === "to-aim" ? "real-plan-aim-distance" : "real-plan-pin-distance"}
      data-distance-kind={kind}
      transform={`${uprightDistanceTransform(point)} scale(${1 / Math.max(0.01, mapScale)})`}
      aria-hidden="true"
    >
      <text x="0" y="0" style={{ fontSize: `${2000 / Math.max(1, mapSize.width)}px`, strokeWidth: `${180 / Math.max(1, mapSize.width)}px` }}>{yards}</text>
    </g>
  ) : (
    <text
      className="real-plan-distance"
      data-testid={kind === "to-aim" ? "real-plan-aim-distance" : "real-plan-pin-distance"}
      data-distance-kind={kind}
      x={point.x}
      y={point.y}
      transform={`rotate(${-rotationDeg} ${point.x} ${point.y})`}
      aria-hidden="true"
    >
      {yards}
    </text>
  );
  return (
    <svg className="real-plan-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Course aim plan">
      <line x1={start.x} y1={start.y} x2={landing.x} y2={landing.y} className="real-plan-route" style={{ strokeWidth: 2.8 / renderedScale }} />
      {pin ? <line x1={landing.x} y1={landing.y} x2={pin.x} y2={pin.y} className="real-plan-pin-route" style={{ strokeWidth: 2 / renderedScale }} /> : null}
      <circle
        cx={start.x}
        cy={start.y}
        r={Math.max(0.12, 0.32 / Math.max(1, mapScale))}
        className="real-plan-origin"
      />
      {showDistances && aimYards !== undefined ? (
        distanceLabel("to-aim", aimYards, aimLabel)
      ) : null}
      {showDistances && pinLabel && aimToPinYards !== undefined && aimToPinYards > 0 ? (
        distanceLabel("aim-to-pin", aimToPinYards, pinLabel)
      ) : null}
    </svg>
  );
}

function RealShotHistoryOverlay({
  shots,
  mapCenter,
  mapSize,
  rotationDeg,
  mapScale,
}: {
  shots: LockedShot[];
  mapCenter: GeoPoint;
  mapSize: MapSize;
  rotationDeg: number;
  mapScale: number;
}) {
  if (shots.length === 0) return null;
  const renderedScale = Math.max(1, mapScale);
  return (
    <svg className="real-shot-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Tracked shot history">
      {shots.map((shot) => {
        const start = geoMapPair(shot.start, mapCenter, mapSize);
        const end = geoMapPair(shot.end, mapCenter, mapSize);
        return (
          <g key={`real-shot-${shot.id}`} className="real-shot-group">
            <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} className="real-shot-line" style={{ strokeWidth: 2.6 / renderedScale }} />
            <circle cx={start.x} cy={start.y} r="0.3" className="real-shot-start" />
            <circle cx={end.x} cy={end.y} r="0.36" className="real-shot-end" />
          </g>
        );
      })}
    </svg>
  );
}

function RealPinOverlay({
  position,
  mapCenter,
  mapSize,
  mapScale,
  placementActive,
  source,
}: {
  position: GeoJsonPosition | undefined;
  mapCenter: GeoPoint;
  mapSize: MapSize;
  mapScale: number;
  placementActive: boolean;
  source?: "center" | "custom";
}) {
  if (!position) return null;
  const point = geoMapPair({ lat: position[1], lon: position[0] }, mapCenter, mapSize);
  // A three-pixel dot stays small across viewport aspect ratios and zoom.
  return (
    <svg className="real-pin-layer" data-pin-source={source} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={placementActive ? "Pin placement target" : source === "custom" ? "Custom pin location" : "Mapped pin location"}>
      <ellipse
        cx={point.x}
        cy={point.y}
        rx={150 / Math.max(mapSize.width, 1) / Math.max(mapScale, 1)}
        ry={150 / Math.max(mapSize.height, 1) / Math.max(mapScale, 1)}
        style={{ strokeWidth: 0.7 / Math.max(mapScale, 1) }}
        className="real-pin-dot"
      />
    </svg>
  );
}

function IllustrationMapLayer({ courseIsDemo }: { courseIsDemo: boolean }) {
  return (
    <div className="illustration-map-layer" data-testid="illustration-map-layer" aria-label="Offline illustration map">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect width="100" height="100" className="illustration-map-paper" />
        <path d="M12 96 C28 78 28 67 42 58 S58 40 53 4" className="illustration-fairway" />
        <path d="M45 100 C50 82 48 70 56 56 S66 32 60 0" className="illustration-rough" />
        <path d="M29 76 C35 67 42 64 50 65 C58 66 64 73 66 82 C59 89 46 91 35 87 Z" className="illustration-green" />
        <path d="M0 83 Q20 77 39 86 T76 82 T100 88" className="illustration-contour" />
        <path d="M4 23 Q23 17 43 24 T78 20 T100 26" className="illustration-contour" />
        <circle cx="22" cy="31" r="4.5" className="illustration-bunker" />
        <circle cx="78" cy="48" r="5" className="illustration-bunker" />
      </svg>
      <span>{courseIsDemo ? "BUNDLED HOLE ILLUSTRATION" : "OFFLINE COURSE ILLUSTRATION"}</span>
    </div>
  );
}

function GreenMapOverlay({ mode, courseIsDemo, sampleCount }: { mode: GreenMapMode; courseIsDemo: boolean; sampleCount: number }) {
  if (mode === "off") return null;
  const isApproach = mode === "approach";
  if (!courseIsDemo) {
    return (
      <div
        className="green-map-overlay green-map-unavailable"
        data-mode={mode}
        data-testid="green-map-overlay"
        aria-label={isApproach ? "Approach shot green heatmap unavailable" : "Putt break green map unavailable"}
      >
        <div className="green-map-heading">
          <strong>{isApproach ? "APPROACH HEAT" : "PUTT BREAKS"}</strong>
          <small>COURSE CONTOURS REQUIRED</small>
        </div>
        <span className="green-map-footnote">NO VERIFIED GREEN MAP DATA FOR THIS HOLE</span>
      </div>
    );
  }
  return (
    <div className="green-map-overlay" data-mode={mode} data-testid="green-map-overlay" aria-label={isApproach ? "Approach shot green heatmap" : "Putt break green map"}>
      <div className="green-map-heading">
        <strong>{isApproach ? "APPROACH HEAT" : "PUTT BREAKS"}</strong>
        <small>{isApproach ? `${sampleCount} LOCAL SHOTS` : "DETERMINISTIC CONTOUR"}</small>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <ellipse cx="50" cy="56" rx="28" ry="19" className="green-map-green" />
        <ellipse cx="50" cy="56" rx="22" ry="14" className="green-map-contour" />
        <ellipse cx="50" cy="56" rx="13" ry="8" className="green-map-contour" />
        {isApproach ? (
          <>
            <circle cx="39" cy="63" r="6" className="green-map-heat green-map-heat-cool" />
            <circle cx="57" cy="51" r="8" className="green-map-heat green-map-heat-hot" />
            <circle cx="67" cy="62" r="4" className="green-map-heat green-map-heat-warm" />
          </>
        ) : (
          <path d="M19 62 Q39 42 70 55 Q80 59 86 47" className="green-map-break" />
        )}
      </svg>
    </div>
  );
}

function DistanceArcsOverlay({
  target,
  origin,
  mapSize,
  toTargetYards,
  clearYards,
  referenceYards,
  showDetail,
}: {
  target: MapPoint | undefined;
  origin: MapPoint | undefined;
  mapSize: MapSize;
  toTargetYards: number | undefined;
  clearYards: number | undefined;
  referenceYards: number | undefined;
  showDetail: boolean;
}) {
  if (!target || !origin || !showDetail) return null;
  const centerX = origin.x * 100;
  const centerY = origin.y * 100;
  const mapWidth = Math.max(1, mapSize.width);
  const mapHeight = Math.max(1, mapSize.height);
  const referenceDistancePx = Math.hypot(
    (target.x - origin.x) * mapWidth,
    (target.y - origin.y) * mapHeight,
  );
  const calibrationYards = Number.isFinite(referenceYards) && (referenceYards ?? 0) > 0
    ? referenceYards!
    : Number.isFinite(toTargetYards) && (toTargetYards ?? 0) > 0
      ? toTargetYards!
      : undefined;
  const yardsPerPixel = calibrationYards && referenceDistancePx > 1
    ? calibrationYards / referenceDistancePx
    : undefined;
  const radiusForYards = (yards: number | undefined) => {
    if (!Number.isFinite(yards) || yards === undefined || yards <= 0 || !yardsPerPixel) return null;
    const radiusPx = yards / yardsPerPixel;
    return {
      rx: (radiusPx / mapWidth) * 100,
      ry: (radiusPx / mapHeight) * 100,
    };
  };
  const pinRadius = radiusForYards(toTargetYards);
  const clearRadius = radiusForYards(clearYards);
  const labels = [
    pinRadius
      ? {
          key: "pin",
          text: `PIN ${toTargetYards}`,
          x: Math.min(94, centerX + pinRadius.rx * 0.72),
          y: Math.max(7, centerY - pinRadius.ry * 0.7),
          className: "distance-arc-label-pin",
        }
      : null,
    clearRadius
      ? {
          key: "clear",
          text: `CLEAR ${clearYards}`,
          x: Math.min(94, centerX + clearRadius.rx * 0.72),
          y: Math.min(94, centerY + clearRadius.ry * 0.7),
          className: "distance-arc-label-clear",
        }
      : null,
  ].filter((label): label is { key: string; text: string; x: number; y: number; className: string } => Boolean(label));
  return (
    <svg className="distance-arcs-overlay" data-testid="distance-arcs-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Scale-aware distance rings from current position">
      {pinRadius ? <ellipse cx={centerX} cy={centerY} rx={pinRadius.rx} ry={pinRadius.ry} className="distance-arc distance-arc-pin" /> : null}
      {clearRadius ? <ellipse cx={centerX} cy={centerY} rx={clearRadius.rx} ry={clearRadius.ry} className="distance-arc distance-arc-hazard" /> : null}
      <g className="distance-arc-labels">
        {labels.map((label) => <text key={label.key} className={label.className} x={label.x} y={label.y}>{label.text}</text>)}
      </g>
    </svg>
  );
}

function ActionButton({
  label,
  onClick,
  children,
  badge,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <button className="map-action" type="button" onClick={onClick} aria-label={label}>
      {children}
      <span>{label}</span>
      {badge ? <b className="map-action-badge">{badge}</b> : null}
    </button>
  );
}

function StartBrand() {
  return (
    <div className="start-brand" aria-label="OpenRound GPS golf caddy">
      <span className="start-brand-mark" aria-hidden="true"><span /></span>
      <span className="start-brand-copy">
        <strong>OPENROUND</strong>
        <small>GPS GOLF CADDY</small>
      </span>
    </div>
  );
}

function PrototypeSwitcher({
  variant,
  onChange,
}: {
  variant: PrototypeVariant;
  onChange: (variant: PrototypeVariant) => void;
}) {
  const variants: readonly PrototypeVariant[] = ["a", "b", "c"];
  const names = { a: "ROUND DASHBOARD", b: "SCORECARD INDEX", c: "CLUBHOUSE MENU" } as const;

  function cycle(direction: -1 | 1) {
    const index = variants.indexOf(variant);
    onChange(variants[(index + direction + variants.length) % variants.length]);
  }

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [variant]);

  return (
    <nav className="prototype-switcher" aria-label="Prototype variants">
      <button type="button" onClick={() => cycle(-1)} aria-label="Previous prototype variant">←</button>
      <span><small>VARIANT {variant.toUpperCase()}</small><strong>{names[variant]}</strong></span>
      <button type="button" onClick={() => cycle(1)} aria-label="Next prototype variant">→</button>
    </nav>
  );
}

function MainMenuButton({
  index,
  icon,
  label,
  meta,
  onClick,
}: {
  index: string;
  icon: ReactNode;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button className="main-menu-button" type="button" onClick={onClick}>
      <b>{index}</b>
      <span className="main-menu-icon" aria-hidden="true">{icon}</span>
      <span><strong>{label}</strong><small>{meta}</small></span>
      <ChevronRightIcon aria-hidden="true" />
    </button>
  );
}

function RoundReview({ round }: { round: SavedRound }) {
  const exportRound = () => {
    const blob = new Blob([JSON.stringify({ format: "openround.review.v1", round }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `openround-${round.startedAt.slice(0, 10)}-${round.id}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="round-review" aria-label="Saved round review">
    <h2>Scorecard</h2>
    <table aria-label="Round scorecard"><thead><tr><th>Hole</th><th>Par</th><th>You</th><th>Putts</th>{round.golfers.map((name) => <th key={name}>{name}</th>)}</tr></thead>
      <tbody>{round.holes.map((hole) => {
        const outcome = hole.onCourse.holes.find((item) => item.holeNumber === hole.holeNumber);
        return <tr key={hole.holeNumber}><th>{hole.holeNumber}</th><td>{outcome?.par ?? "—"}</td><td>{outcome?.score ?? "—"}</td><td>{outcome?.putts ?? "—"}</td>{round.golfers.map((name) => <td key={name}>{Object.hasOwn(hole.friendScores, name) ? hole.friendScores[name] : "—"}</td>)}</tr>;
      })}</tbody>
    </table>
    <p>— means not recorded. Scores are gross and need your review before posting for handicap.</p>
    <button className="sheet-secondary-button" type="button" onClick={exportRound}>EXPORT ROUND DATA</button>
    <h2>Shot record</h2>
    {round.holes.map((hole) => <details key={hole.holeNumber}><summary>Hole {hole.holeNumber} · {hole.log.events.length} events</summary>
      {hole.log.events.length === 0 ? <p>No shots recorded.</p> : <ol>{hole.log.events.map((event) => <li key={event.id}>{event.clubName ?? event.kind.replaceAll("_", " ")} · {event.distanceYards === null ? "manual · no measured distance" : `${event.distanceYards} yd GPS total`}</li>)}</ol>}
    </details>)}
  </section>;
}

function StartScreen({
  activeRound,
  savedRounds,
  roundSaveError,
  variant,
  equipmentCount,
  roundStats,
  onResume,
  onNewRound,
  onDemoRound,
  onEndRound,
  onEquipment,
  onSmartTracking,
}: {
  activeRound: ActiveRoundSummary | null;
  savedRounds: SavedRound[];
  roundSaveError: boolean;
  variant: PrototypeVariant;
  equipmentCount: number;
  roundStats: RoundStats;
  onResume: () => void;
  onNewRound: () => void;
  onDemoRound: () => void;
  onEndRound: () => void;
  onEquipment: () => void;
  onSmartTracking: () => void;
}) {
  const [detail, setDetail] = useState<"rounds" | "statistics" | "handicap" | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const completedRounds = savedRounds.filter((round) => round.endedAt !== null);
  const review = savedRounds.find((round) => round.id === reviewId);
  const totals = savedRounds.map(roundTotals);
  const scoredHoles = totals.reduce((sum, round) => sum + round.holes, 0);
  const totalScore = totals.reduce((sum, round) => sum + round.score, 0);

  if (detail) {
    return (
      <section className="start-screen main-menu-detail-screen start-flow-screen" data-testid="start-screen" data-variant={variant} aria-label="OpenRound main menu">
        <header className="start-screen-header">
          <button className="main-menu-back" type="button" onClick={() => setDetail(null)} aria-label="Back to main menu">←</button>
          <StartBrand />
          <span className="start-screen-kicker">LOCAL · PERSONAL BETA</span>
        </header>
        <main className="main-menu-detail" data-testid="main-menu-detail">
          {detail === "rounds" ? (
            <>
              <span className="main-menu-kicker">ROUND HISTORY</span>
              <h1>Rounds</h1>
              {nativeTrackingAvailable && <button className="sheet-secondary-button" onClick={onSmartTracking}>REVIEW SMART TRACKING</button>}
              {activeRound ? (
                <article className="main-menu-round-record">
                  <span>CURRENT ROUND</span>
                  <strong>{activeRound.courseName}</strong>
                  <small>{activeRound.layoutLabel} · HOLE {activeRound.holeNumber} · {activeRoundStatusLabel(activeRound.status)}</small>
                  <button type="button" onClick={onResume}>RESUME ROUND <ChevronRightIcon /></button>
                </article>
              ) : (
                completedRounds.length === 0 ? <div className="main-menu-detail-empty"><TargetIcon /><strong>NO ROUNDS YET</strong><span>Finish a round to review it here.</span></div> : null
              )}
              {[...completedRounds].reverse().map((round) => (
                <article className="main-menu-round-record" key={round.id} data-testid="completed-round">
                  <span>{new Date(round.startedAt).toLocaleDateString()} · {round.teeBox.toUpperCase()} TEES</span>
                  <strong>{round.courseName}</strong>
                  <small>{roundTotals(round).holes} SCORED HOLES · {roundTotals(round).score} STROKES · {roundTotals(round).putts ?? "—"} PUTTS</small>
                  <button type="button" onClick={() => setReviewId(reviewId === round.id ? null : round.id)}>REVIEW ROUND</button>
                </article>
              ))}
              {review ? <RoundReview round={review} /> : null}
            </>
          ) : detail === "statistics" ? (
            <>
              <span className="main-menu-kicker">LOCAL ROUND STATISTICS</span>
              <h1>Statistics</h1>
              <div className="main-menu-stats-card">
                <div><span>SCORED HOLES</span><strong>{scoredHoles || (activeRound ? roundStats.holesPlayed : 0)}</strong></div>
                <div><span>STROKES</span><strong data-testid="main-menu-stat-strokes">{savedRounds.length ? totalScore : activeRound ? roundStats.score : 0}</strong></div>
                <div><span>GPS SHOTS</span><strong>{totals.reduce((sum, round) => sum + round.gpsShots, 0)}</strong></div>
                <div><span>AVG / SCORED HOLE</span><strong>{scoredHoles ? (totalScore / scoredHoles).toFixed(1) : "—"}</strong></div>
              </div>
              <p>{completedRounds.length} completed rounds. Scores include only entered holes. Club distance evidence is in Equipment.</p>
              <p>Strokes gained: unavailable. Shot lies and distances to the hole must be recorded before a comparison can be calculated.</p>
            </>
          ) : (
            <>
              <span className="main-menu-kicker">LOCAL HANDICAP</span>
              <h1>Handicap Index</h1>
              <div className="main-menu-index-readout"><strong>—</strong><span>OFFICIAL INDEX<br />NOT CONNECTED</span></div>
              <p>Handicap scoring and submission are not connected. Review your saved scorecard in Rounds, then post it through your handicap provider.</p>
              <div className="main-menu-handicap-state"><span>ROUND SCORING</span><strong>GROSS SCORES ONLY</strong></div>
            </>
          )}
        </main>
      </section>
    );
  }

  return (
    <section className="start-screen main-menu-screen start-flow-screen" data-testid="start-screen" data-variant={variant} aria-label="OpenRound main menu">
      <header className="start-screen-header">
        <StartBrand />
        <span className="start-screen-kicker">LOCAL · PERSONAL BETA</span>
      </header>

      <main className="main-menu-content">
        <div className="main-menu-heading">
          <p className="main-menu-kicker">{variant === "a" ? "ROUND DASHBOARD" : variant === "b" ? "PLAYER CARD" : "CLUBHOUSE"}</p>
          <h1>{activeRound ? "Round in play." : "Ready to play."}</h1>
          <span>{activeRound ? "Everything resumes exactly where you left it." : "Start a round or open your golf record."}</span>
        </div>
        {roundSaveError ? <p role="alert">Round changes are in memory only. Browser storage is unavailable.</p> : null}

        <article className="main-menu-round" data-testid={activeRound ? "active-round-card" : "start-empty-state"}>
          <div className="main-menu-round-copy">
            <span>{activeRound ? "ACTIVE ROUND" : "TODAY'S ROUND"}</span>
            <strong>{activeRound?.courseName ?? "NO ROUND IN PROGRESS"}</strong>
            <small>{activeRound ? `${activeRound.layoutLabel} · HOLE ${activeRound.holeNumber} · ${activeRoundStatusLabel(activeRound.status)}` : "Course, tee, and starting hole stay on this phone."}</small>
          </div>
          <button className="main-menu-primary" type="button" onClick={activeRound ? onResume : onNewRound}>
            {activeRound ? "RESUME ROUND" : "START ROUND"} <ChevronRightIcon aria-hidden="true" />
          </button>
          {activeRound ? <button className="main-menu-end" type="button" onClick={onEndRound}>END ROUND</button> : null}
        </article>

        <nav className="main-menu-nav" aria-label="OpenRound destinations">
          <MainMenuButton index="01" icon={<ActivityLogIcon />} label="ROUNDS" meta={activeRound ? "CURRENT ROUND · LOCAL LOG" : "LOCAL ROUND HISTORY"} onClick={() => setDetail("rounds")} />
          <MainMenuButton index="02" icon={<BarChartIcon />} label="STATISTICS" meta="ROUND & CLUB TRENDS" onClick={() => setDetail("statistics")} />
          <MainMenuButton index="03" icon={<BackpackIcon />} label="EQUIPMENT" meta={`${equipmentCount}/14 CLUBS IN BAG`} onClick={onEquipment} />
          <MainMenuButton index="04" icon={<TargetIcon />} label="HANDICAP INDEX" meta="NOT CONNECTED" onClick={() => setDetail("handicap")} />
        </nav>

        <button className="start-demo-button" type="button" onClick={onDemoRound}>DEMO ROUND</button>
        <small className="start-storage-note">ROUND DATA STAYS ON THIS PHONE · GPS EVIDENCE STAYS LOCAL</small>
      </main>

      <footer className="start-screen-footer">
        <span>DETERMINISTIC CADDY</span>
        <span aria-hidden="true">·</span>
        <span>NO LLM</span>
      </footer>
    </section>
  );
}

function StartRoundScreen({
  variant,
  course,
  setup,
  holeNumber,
  onBack,
  onChangeCourse,
  onTeeChange,
  onHoleChange,
  onGolfersChange,
  onStart,
}: {
  variant: PrototypeVariant;
  course: CourseCatalogEntry | null;
  setup: RoundSetup;
  holeNumber: number;
  onBack: () => void;
  onChangeCourse: () => void;
  onTeeChange: (tee: TeeBox) => void;
  onHoleChange: (hole: number) => void;
  onGolfersChange: (names: string[]) => void;
  onStart: () => void;
}) {
  const keyboard = useKeyboard();
  const [addGolfersForScoring, setAddGolfersForScoring] = useState(false);
  const [golferNameDraft, setGolferNameDraft] = useState("");
  const golferNames = setup.golfers ?? [];
  const holeCount = Math.min(course?.holes ?? 18, 18);
  const courseName = course?.name ?? "LOADING SAVED COURSE";
  const coursePlace = course ? [course.city, course.state].filter(Boolean).join(", ") || course.country : "LOCAL COURSE CATALOG";
  const courseTeeOptions = variant === "c" ? courseTeeBoxOptions(course) : [];
  const teeOptions = courseTeeOptions.length > 0 ? courseTeeOptions : TEE_BOX_OPTIONS;
  const teeSource = variant === "c" ? courseTeeOptions.length > 0 ? "course" : "manual" : "prototype";
  const teePicker = (
    <div className="start-round-field tee-field">
      <span>TEE BOX</span>
      <div className="start-tee-options" role="group" aria-label="Tee box" data-tee-source={teeSource}>
        {teeOptions.map((tee) => (
          <button key={tee.id} type="button" aria-pressed={setup.teeBox === tee.id} data-selected={setup.teeBox === tee.id} onClick={() => onTeeChange(tee.id)}>
            <strong>{tee.label}</strong><small>{teeSource === "manual" ? "MANUAL" : tee.detail}</small>
          </button>
        ))}
      </div>
    </div>
  );
  const holePicker = (
    <label className="start-round-field hole-field">
      <span>STARTING HOLE</span>
      <select aria-label="START HOLE" value={holeNumber} onChange={(event) => onHoleChange(Number(event.target.value))}>
        {Array.from({ length: holeCount }, (_, index) => index + 1).map((hole) => <option key={hole} value={hole}>HOLE {hole}</option>)}
      </select>
    </label>
  );
  const courseCard = (
    <section className="start-round-course course-current-card" aria-label="Selected course">
      <span>TODAY'S COURSE</span>
      <strong>{courseName}</strong>
      <small>{coursePlace} · HOLE {holeNumber}</small>
      <button type="button" onClick={onChangeCourse}>CHANGE COURSE</button>
    </section>
  );
  const trimmedGolferName = golferNameDraft.trim();
  const canAddGolfer = golferNames.length < 3 && trimmedGolferName.length > 0 && !golferNames.some((name) => name.toLowerCase() === trimmedGolferName.toLowerCase());
  const addGolfer = () => {
    if (!canAddGolfer) return;
    onGolfersChange([...golferNames, trimmedGolferName]);
    setGolferNameDraft("");
    keyboard.hide();
  };
  const scorecardOptions = (
    <div className="start-round-option-list" role="group" aria-label="Round options">
      <button type="button" disabled>
        <span><strong>HANDICAP INDEX SCORING</strong><small>GROSS SCORES ONLY · NOT CONNECTED</small></span>
        <b>—</b>
      </button>
      <button type="button" aria-haspopup="dialog" aria-expanded={addGolfersForScoring} onClick={() => setAddGolfersForScoring(true)}>
        <span><strong>ADD GOLFERS FOR SCORING</strong><small>KEEP THE GROUP'S SCORES</small></span>
        <b>{golferNames.length > 0 ? `${golferNames.length} ADDED` : "ADD"}</b>
      </button>
      <BottomSheet
        open={addGolfersForScoring}
        onOpenChange={setAddGolfersForScoring}
        title="Add golfers"
        description="Enter a name for each golfer you want to score."
        snap={0.72}
      >
        <div className="start-round-golfers">
          <form onSubmit={(event) => { event.preventDefault(); addGolfer(); }}>
            <KeyboardInput
              aria-label="Golfer name"
              value={golferNameDraft}
              onChange={(event) => setGolferNameDraft(event.target.value)}

              placeholder="GOLFER NAME"
              maxLength={40}
              autoComplete="off"
            />
            <button type="submit" disabled={!canAddGolfer} onPointerDown={(event) => { event.preventDefault(); addGolfer(); }}>ADD GOLFER</button>
          </form>
          {golferNames.length > 0 ? (
            <ul aria-label="Golfers added for scoring">
              {golferNames.map((name) => (
                <li key={name}><span>{name}</span><button type="button" aria-label={`Remove ${name}`} onClick={() => onGolfersChange(golferNames.filter((golfer) => golfer !== name))}><Cross2Icon /></button></li>
              ))}
            </ul>
          ) : null}
        </div>
      </BottomSheet>
    </div>
  );
  const startButton = <button className="start-round-action" type="button" disabled={!course} onClick={onStart}>BEGIN ROUND <ChevronRightIcon /></button>;

  return (
    <section className="start-round-screen start-flow-screen" data-testid="start-round-screen" data-variant={variant} aria-label="Start a new round">
      <header className="start-round-header">
        <button type="button" onClick={onBack} aria-label="Back to start">←</button>
        <StartBrand />
        <span>NEW ROUND</span>
      </header>

      {variant === "a" ? (
        <main className="start-round-content start-round-a">
          <div className="start-round-title"><span>FIRST TEE CHECKLIST</span><h1>Set the round.</h1><p>Three choices, then OpenRound locks the first GPS position.</p></div>
          <div className="first-tee-line" aria-hidden="true"><i /><i /><i /><i /></div>
          {courseCard}{teePicker}{holePicker}{scorecardOptions}{startButton}
        </main>
      ) : variant === "b" ? (
        <main className="start-round-content start-round-b">
          <div className="course-canvas"><span className="course-canvas-pin" /><small>COURSE READY</small><strong>{courseName}</strong><p>{coursePlace}</p></div>
          <div className="course-control-deck">{teePicker}{holePicker}{scorecardOptions}{startButton}<button className="course-change-inline" type="button" onClick={onChangeCourse}>CHOOSE ANOTHER COURSE</button></div>
        </main>
      ) : (
        <main className="start-round-content start-round-c">
          <div className="setup-scorecard-title"><span>OPENROUND · NEW</span><strong>ROUND SETUP</strong><small>LOCAL / {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase()}</small></div>
          {courseCard}
          <div className="setup-scorecard-row"><b>01</b>{teePicker}</div>
          <div className="setup-scorecard-row"><b>02</b>{scorecardOptions}</div>
          {startButton}
        </main>
      )}
      <small className="start-round-local-note">PRECISE GPS IS REQUESTED ONLY WHEN YOU START</small>
    </section>
  );
}

export default function Prototype() {
  const keyboard = useKeyboard();
  const [initialCourseSelection] = useState<CourseSelection | undefined>(() => {
    if (typeof window === "undefined") return storeCourseSelection(undefined, DEFAULT_OPENROUND_COURSE, 1, DEFAULT_OPENROUND_COURSE.updatedAt);
    const stored = loadStoredCourseSelection(window.localStorage);
    if (stored || loadStoredActiveRound()?.courseId === DEMO_OPENROUND_COURSE.id) return stored;
    return storeCourseSelection(undefined, DEFAULT_OPENROUND_COURSE, 1, DEFAULT_OPENROUND_COURSE.updatedAt);
  });
  const [initialRoundState] = useState(() => {
    if (typeof window === "undefined") {
      return { session: null as StoredRoundSession | null, log: createRoundLogForRound(DEFAULT_OPENROUND_COURSE.id, 1) };
    }

    const selection = initialCourseSelection;
    const courseId = selection?.courseId ?? DEMO_OPENROUND_COURSE.id;
    const holeNumber = selection?.holeNumber ?? 7;
    const roundId = `${courseId}:${holeNumber}`;
    const storedSession = loadStoredRoundSession(window.localStorage);
    const session = storedSession?.roundId === roundId && storedSession.courseId === courseId && storedSession.holeNumber === holeNumber
      ? storedSession
      : null;
    const storedLog = loadStoredRoundLog(window.localStorage);
    const log = storedLog.roundId === roundId && storedLog.courseId === courseId && storedLog.holeNumber === holeNumber
      ? storedLog
      : createRoundLogForRound(courseId, holeNumber, session?.score ?? 4);
    // A restored score below the strokes already recorded for this hole
    // contradicts the evidence (possible after an older version saved it);
    // reconcile upward instead of reloading a contradiction.
    const floor = countRecordedStrokes(log.events, holeNumber);
    const reconciledScore = Math.max(session?.score ?? 4, floor, log.score ?? 0);
    if (session && session.score !== reconciledScore) {
      session.score = reconciledScore;
    }
    const reconciledLog = log.score !== reconciledScore
      ? { ...log, score: reconciledScore }
      : log;

    return { session, log: reconciledLog };
  });
  const [legacyPlayingConditions] = useState<PlayingConditions>(loadStoredPlayingConditions);
  const restoredLastShot = initialRoundState.session?.lockedShots.at(-1) ?? null;
  const [lockedShots, setLockedShots] = useState<LockedShot[]>(() => initialRoundState.session?.lockedShots ?? []);
  const [tracking, setTracking] = useState<TrackingLeg | null>(() =>
    initialRoundState.session?.tracking !== undefined ? initialRoundState.session.tracking : restoredLastShot
      ? restoredLastShot.number === 1
        ? { number: 2, club: clubTrackingLabel(getClubProfile(DEFAULT_APPROACH_CLUB_ID)), start: restoredLastShot.end }
        : null
      : initialCourseSelection
        ? null
        : { number: 1, club: clubTrackingLabel(getClubProfile(DEFAULT_TEE_CLUB_ID)), start: TEE },
  );
  const [currentBall, setCurrentBall] = useState<GeoPoint>(() => initialRoundState.session?.tracking?.start ?? restoredLastShot?.end ?? TEE);
  const [gpsHealth, setGpsHealth] = useState<GpsHealth>("fresh");
  const [gpsAccuracyMeters, setGpsAccuracyMeters] = useState<number | null>(4);
  const [lastGpsFixCapturedAt, setLastGpsFixCapturedAt] = useState<number | null>(null);
  const [liveTrackingFix, setLiveTrackingFix] = useState<(LiveGpsFix & { shotNumber: number; yards: number }) | null>(null);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [startView, setStartView] = useState<StartView>(loadStoredStartView);
  const [startFlowScreen, setStartFlowScreen] = useState<StartFlowScreen>("home");
  const [prototypeVariant, setPrototypeVariant] = useState<PrototypeVariant>(() => {
    if (typeof window === "undefined") return "a";
    const candidate = new URLSearchParams(window.location.search).get("variant");
    return candidate === "b" || candidate === "c" ? candidate : "a";
  });
  const [activeRound, setActiveRound] = useState<ActiveRoundSummary | null>(loadStoredActiveRound);
  const [savedRounds, setSavedRounds] = useState(() => loadRounds(getBrowserOnCourseStorage(), parseStoredRoundSession));
  const savedRoundsRef = useRef(savedRounds);
  const [roundRecordId, setRoundRecordId] = useState<string | null>(() => [...savedRounds].reverse().find((round) => round.endedAt === null && round.courseId === loadStoredActiveRound()?.courseId)?.id ?? null);
  const roundRecordIdRef = useRef(roundRecordId);
  const [roundSaveError, setRoundSaveError] = useState(false);
  const [nativeTransitionError, setNativeTransitionError] = useState("");
  const nativeTransitionBusy = useRef(false);
  const [friendScores, setFriendScores] = useState<Record<string, number>>(() => savedRounds.find((round) => round.id === roundRecordId)?.holes.find((hole) => hole.holeNumber === initialCourseSelection?.holeNumber)?.friendScores ?? {});
  const startRequestRef = useRef(0);
  const [selectedClubId, setSelectedClubId] = useState<ApproachClubId>(initialRoundState.session?.selectedClubId ?? DEFAULT_APPROACH_CLUB_ID);
  const [teeShotClubId, setTeeShotClubId] = useState<ApproachClubId>(initialRoundState.session?.teeShotClubId ?? DEFAULT_TEE_CLUB_ID);
  const [clubPickerPreviewId, setClubPickerPreviewId] = useState<ApproachClubId>(DEFAULT_APPROACH_CLUB_ID);
  const [caddyAggressiveness, setCaddyAggressiveness] = useState<CaddyAggressiveness>(loadStoredCaddyAggressiveness);
  const [ruleOf12Slope, setRuleOf12Slope] = useState<RuleOf12Slope>("level");
  const [equipment, setEquipment] = useState<EquipmentClub[]>(() =>
    typeof window === "undefined" ? createDefaultEquipment() : loadStoredEquipment(window.localStorage),
  );
  const [equipmentEditorId, setEquipmentEditorId] = useState<string | "new" | null>(null);
  const [equipmentDraft, setEquipmentDraft] = useState<EquipmentFormDraft | null>(null);
  const [equipmentError, setEquipmentError] = useState("");
  const [equipmentStatusFilter, setEquipmentStatusFilter] = useState<EquipmentStatus>("active");
  const [fieldLog, setFieldLog] = useState<FieldLogPayload>(() =>
    typeof window === "undefined" ? clearFieldLog() : loadStoredFieldLog(window.localStorage),
  );
  const [fieldLogDraft, setFieldLogDraft] = useState<FieldLogDraft>(() => emptyFieldLogDraft());
  const [fieldLogError, setFieldLogError] = useState("");
  const [fieldLogGpsCaptureState, setFieldLogGpsCaptureState] = useState<"idle" | "capturing">("idle");
  const [fieldLogGpsPairState, setFieldLogGpsPairState] = useState<FieldLogGpsPairState>("idle");
  const [fieldLogGpsPair, setFieldLogGpsPair] = useState<FieldLogGpsPair | null>(null);
  const [pinPlacement, setPinPlacement] = useState<PinPlacement>("center");
  const [pinPoint, setPinPoint] = useState<CoursePoint>(HOLE_7_GEOMETRY.pin);
  const [realPinOverride, setRealPinOverride] = useState<GeoJsonPosition | null>(null);
  const [realAimOverride, setRealAimOverride] = useState<GeoJsonPosition | null>(null);
  const [realAimDraft, setRealAimDraft] = useState<GeoJsonPosition | null>(null);
  const [realAimDragging, setRealAimDragging] = useState(false);
  const [pinPlacementActive, setPinPlacementActive] = useState(false);
  const [cameraPinLockActive, setCameraPinLockActive] = useState(false);
  const [cameraPinMarks, setCameraPinMarks] = useState<number[]>([]);
  const [cameraPinEstimate, setCameraPinEstimate] = useState<CameraPinEstimate | null>(null);
  const [cameraPinUnavailable, setCameraPinUnavailable] = useState(false);
  const cameraPinVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraPinStreamRef = useRef<MediaStream | null>(null);
  const [score, setScore] = useState(() => initialRoundState.session?.score ?? (initialRoundState.log.score || 4));
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>(() => initialRoundState.session?.manualEntries ?? []);
  const [roundLog, setRoundLog] = useState<RoundLog>(() => initialRoundState.log);
  const [courseCatalog, setCourseCatalog] = useState<CourseCatalogIndex | null>(null);
  const [catalogLoadState, setCatalogLoadState] = useState<CatalogLoadState>("idle");
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogMode, setCatalogMode] = useState<"search" | "nearby">("search");
  const [nearbyLocation, setNearbyLocation] = useState<GeoPoint | null>(null);
  const [locationLoadState, setLocationLoadState] = useState<LocationLoadState>("idle");
  const [roundSetup, setRoundSetup] = useState<RoundSetup>(loadStoredRoundSetup);
  const [courseSelection, setCourseSelection] = useState<CourseSelection | undefined>(() =>
    initialCourseSelection,
  );
  const [pendingCourse, setPendingCourse] = useState<CourseCatalogEntry | null>(null);
  const [pendingHoleNumber, setPendingHoleNumber] = useState(1);
  const [selectedCourse, setSelectedCourse] = useState<CourseCatalogEntry | null>(null);
  const [selectedHoleNumber, setSelectedHoleNumber] = useState(initialCourseSelection?.holeNumber ?? 7);
  const [geometryLoadState, setGeometryLoadState] = useState<GeometryLoadState>("idle");
  const [loadedHoleGeometry, setLoadedHoleGeometry] = useState<LoadedHoleGeometry | null>(null);
  const [loadedGeometryCourseId, setLoadedGeometryCourseId] = useState<string | null>(null);
  const [committedAim, setCommittedAim] = useState<AimPlan>(loadStoredAimPlan);
  const [draftAim, setDraftAim] = useState<MapPoint | null>(null);
  const [mapSize, setMapSize] = useState<MapSize>(FALLBACK_MAP_SIZE);
  const [mapProvider, setMapProvider] = useState<SatelliteProvider>("usgs");
  const [mapView, setMapView] = useState<MapView>({ scale: 1, panX: 0, panY: 0 });
  const [realPlanningFocus, setRealPlanningFocus] = useState(false);
  const [selectedHazardId, setSelectedHazardId] = useState<string | null>(null);
  const [missTargetDraft, setMissTargetDraft] = useState<MissTarget>("fairway");
  const [missDirectionDraft, setMissDirectionDraft] = useState<MissDirection>("left");
  const [puttsDraft, setPuttsDraft] = useState<number | null>(null);
  const [outcomeGirDraft, setOutcomeGirDraft] = useState<boolean | null>(null);
  const [outcomeFairwayDraft, setOutcomeFairwayDraft] = useState<boolean | null>(null);
  const [trackedShotReviewId, setTrackedShotReviewId] = useState<string | null>(null);
  const [aimPressed, setAimPressed] = useState(false);
  const [aimDragging, setAimDragging] = useState(false);
  const [aimAnnouncement, setAimAnnouncement] = useState("");
  const mapRef = useRef<HTMLElement>(null);
  const clubLadderRef = useRef<HTMLDivElement>(null);
  const [clubLadderEdge, setClubLadderEdge] = useState<"top" | "middle" | "bottom">("middle");
  const aimPointerStartRef = useRef<AimPointerStart | null>(null);
  const mapPointersRef = useRef<Map<number, MapPointer>>(new Map());
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const mapPanGestureRef = useRef<MapPanGesture | null>(null);
  const realAimPointerRef = useRef<number | null>(null);
  const manualMapCenterRef = useRef<GeoPoint | null>(null);
  const ruleOf12PreviousClubRef = useRef<ApproachClubId | null>(null);
  const restoredPinMapSizeRef = useRef<MapSize | null>(null);
  const pinPlacementReturnViewRef = useRef<PinPlacementReturnView | null>(null);
  const pendingPinPlacementRestoreRef = useRef<PinPlacementReturnView | null>(null);
  const demoBallUndoRef = useRef<{
    mapView: MapView;
    committedAim: AimPlan;
    realAimOverride: GeoJsonPosition | null;
    selectedClubId: ApproachClubId;
    teeShotClubId: ApproachClubId;
    clubPickerPreviewId: ApproachClubId;
  } | null>(null);
  const suppressMapClickUntilRef = useRef(0);
  const nextLegLockNotBeforeRef = useRef(0);
  const fieldLogGpsPairStartRef = useRef<{ fix: LiveGpsFix; ageSeconds: number } | null>(null);
  const nextManualEntryIdRef = useRef(Math.max(0, ...((initialRoundState.session?.manualEntries ?? []).map((entry) => entry.id))) + 1);
  const nextRoundEventSequenceRef = useRef(Math.max(0, ...(initialRoundState.log.events.map((event) => event.sequence))) + 1);

  useEffect(() => {
    if (typeof window !== "undefined") storeEquipment(window.localStorage, equipment);
  }, [equipment]);

  useEffect(() => {
    try {
      storeFieldLog(window.localStorage, fieldLog);
    } catch {
      // The capture sheet remains usable in memory when local storage is unavailable.
    }
  }, [fieldLog]);

  useEffect(() => {
    // A persisted real-course selection is restored asynchronously after the
    // catalog validates. Do not let the initial demo-shaped render overwrite
    // that course's local shot session before the selection is ready.
    if (courseSelection && !selectedCourse) return;

    const courseId = selectedCourse?.id ?? DEMO_OPENROUND_COURSE.id;
    const holeNumber = selectedCourse ? selectedHoleNumber : 7;
    const roundId = `${courseId}:${holeNumber}`;
    const log = createRoundLogForRound(courseId, holeNumber, score, roundLog.events);
    const session: StoredRoundSession = {
      version: 1,
      roundId,
      courseId,
      holeNumber,
      score,
      lockedShots,
      manualEntries,
      tracking,
      selectedClubId,
      teeShotClubId,
    };

    try {
      storeRoundLog(window.localStorage, log);
    } catch {
      // The in-memory round remains usable when local storage is unavailable.
    }
    try {
      storeRoundSession(window.localStorage, session);
    } catch {
      // GPS and manual state remain usable for this foreground session.
    }
  }, [courseSelection, selectedCourse, selectedHoleNumber, score, roundLog.events, lockedShots, manualEntries, tracking, selectedClubId, teeShotClubId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(START_VIEW_STORAGE_KEY, startView);
    } catch {
      // The start screen remains usable when local storage is unavailable.
    }
  }, [startView]);

  useEffect(() => {
    try {
      if (activeRound) {
        window.localStorage.setItem(ACTIVE_ROUND_STORAGE_KEY, JSON.stringify(activeRound));
      } else {
        window.localStorage.removeItem(ACTIVE_ROUND_STORAGE_KEY);
      }
    } catch {
      // The round remains usable in memory when local storage is unavailable.
    }
  }, [activeRound]);

  useEffect(() => {
    manualMapCenterRef.current = null;
  }, [selectedCourse?.id, selectedHoleNumber, startView]);

  useEffect(() => {
    setRuleOf12Slope("level");
  }, [lockedShots.length]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CADDY_STRATEGY_STORAGE_KEY, caddyAggressiveness);
    } catch {
      // Strategy still applies for this session if local storage is unavailable.
    }
  }, [caddyAggressiveness]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ROUND_SETUP_STORAGE_KEY, JSON.stringify(roundSetup));
    } catch {
      // Round setup remains usable in memory when local storage is unavailable.
    }
  }, [roundSetup]);

  useEffect(() => {
    if (prototypeVariant === "c" && courseSelection && !selectedCourse) return;
    const courseOptions = prototypeVariant === "c" ? courseTeeBoxOptions(selectedCourse) : [];
    const available = courseOptions.length > 0 ? courseOptions : TEE_BOX_OPTIONS;
    if (available.some((tee) => tee.id === roundSetup.teeBox)) return;
    const next = available.find((tee) => tee.id === "blue") ?? available[0];
    if (next) setRoundSetup((current) => ({ ...current, teeBox: next.id }));
  }, [courseSelection, prototypeVariant, roundSetup.teeBox, selectedCourse]);

  useEffect(() => {
    setActiveRound((current) => current && current.teeBox !== roundSetup.teeBox
      ? { ...current, teeBox: roundSetup.teeBox, updatedAt: new Date().toISOString() }
      : current);
  }, [roundSetup.teeBox]);

  useEffect(() => {
    // Selecting a course moves the player from search into setup. Dismiss the
    // search keyboard before the taller setup card is presented so its action
    // buttons remain reachable on a phone.
    if (pendingCourse) keyboard.hide();
  }, [pendingCourse]);

  const latestLockedShot: LockedShot | null = lockedShots.at(-1) ?? null;
  const driverShot = lockedShots.find((shot) => shot.number === 1) ?? null;
  const activeEquipment = equipment.filter((club) => club.status === "active");
  const retiredEquipment = equipment.filter((club) => club.status === "retired");
  const profileForClubId = (id: ApproachClubId): ClubProfile => {
    const profile = getClubProfile(id);
    const slot = EQUIPMENT_SLOT_TO_CLUB_ID.indexOf(id) + 1;
    const equipmentClub = activeEquipment.find((club) => club.slot === slot);
    return equipmentClub
      ? {
          ...profile,
          label: equipmentClub.name,
          carryYards: equipmentClub.carryYards ?? profile.carryYards,
          totalYards: equipmentClub.totalYards ?? profile.totalYards,
        }
      : profile;
  };
  const equipmentForClubId = (id: ApproachClubId): EquipmentClub | undefined => {
    const slot = EQUIPMENT_SLOT_TO_CLUB_ID.indexOf(id);
    return slot < 0 ? undefined : activeEquipment.find((club) => club.slot === slot + 1);
  };
  const selectedProfile = profileForClubId(selectedClubId);
  const teeShotProfile = profileForClubId(teeShotClubId);
  const teeShotPending = driverShot === null;
  const currentClubId = teeShotPending ? teeShotClubId : selectedClubId;
  const currentProfile = teeShotPending ? teeShotProfile : selectedProfile;
  const latestManualShot = latestLockedShot?.evidence === "demo_manual" ? latestLockedShot : undefined;
  const demoBallCoursePoint = latestManualShot ? demoCoursePointFromGeoPoint(latestManualShot.end) : HOLE_7_GEOMETRY.ball;
  const selectedBias = getShotBias(selectedProfile.offsets);
  const caddyStrategy = CADDY_AGGRESSIVENESS[caddyAggressiveness];
  const demoTargetDistance = courseDistanceYards(demoBallCoursePoint, pinPoint);
  const demoTargetRatio = demoTargetDistance > 0 ? Math.min(1, selectedProfile.totalYards / demoTargetDistance) : 1;
  const demoCaddyTarget = latestManualShot
    ? {
        eastYards: demoBallCoursePoint.eastYards + (pinPoint.eastYards - demoBallCoursePoint.eastYards) * demoTargetRatio,
        forwardYards: demoBallCoursePoint.forwardYards + (pinPoint.forwardYards - demoBallCoursePoint.forwardYards) * demoTargetRatio,
      }
    : HOLE_7_GEOMETRY.defaultAim;
  const currentCaddyPlan = getCaddyPlan(selectedProfile, selectedBias, caddyAggressiveness, demoBallCoursePoint, demoCaddyTarget);
  const displayedHeroClub = clubAbbreviation(currentClubId);
  const trackingActive = tracking !== null;
  const courseIsDemo = !selectedCourse || selectedCourse.id === DEMO_OPENROUND_COURSE.id;
  const selectedTrackedShotOffsets = lockedShots
    .filter((shot) => shot.evidence === "total_gps" && shot.clubProfileId === selectedClubId)
    .map(shotOffsetFromStoredAim)
    .filter((offset): offset is ShotOffset => offset !== null);
  const selectedDispersionOffsets = courseIsDemo ? currentProfile.offsets : selectedTrackedShotOffsets;
  const selectedDispersion = getDispersionPresentation(selectedDispersionOffsets);
  const selectedEnvelope = selectedDispersion.envelope;
  const dispersionIsCircular = selectedDispersion.circular;
  const visibleEquipment = equipmentStatusFilter === "active" ? activeEquipment : retiredEquipment;
  const shotLegCompleted = !selectedCourse && !trackingActive && latestLockedShot?.number === 2;
  const realShotLegCompleted = Boolean(selectedCourse && !trackingActive && (latestLockedShot?.number ?? 0) >= 2);
  const aimEditable = !shotLegCompleted && !realShotLegCompleted;
  const gpsReady = gpsHealth === "fresh";
  const displayedPlan = shotLegCompleted && latestLockedShot?.plannedAim ? latestLockedShot.plannedAim : committedAim;
  const effectiveAimPlan = draftAim ? aimPlanFromMapPoint(draftAim, "manual") : displayedPlan;
  const effectiveAimPoint = mapPointFromCoursePoint(effectiveAimPlan.point);
  const effectiveAimCourse = effectiveAimPlan.point;
  const effectiveAimSource = effectiveAimPlan.source;
  const reticleSourceCopy = shotLegCompleted ? "SHOT" : effectiveAimSource === "manual" ? "CUSTOM" : "CADDY";
  const reticleAccessibleSource = shotLegCompleted
    ? "locked shot aim"
    : effectiveAimSource === "manual"
      ? "custom override"
      : "caddy suggestion";
  const pinMapPoint = mapPointFromCoursePoint(pinPoint);
  const loadedHoleGeometryIsCurrent = loadedGeometryCourseId === selectedCourse?.id && loadedHoleGeometry?.hole.number === selectedHoleNumber;
  const currentHoleGeometry = loadedHoleGeometryIsCurrent ? loadedHoleGeometry : null;
  const realGreenFeatures = currentHoleGeometry?.hole.features.filter((feature) => feature.kind === "green") ?? [];
  // Some OSM hole bundles contain a nearby/duplicate green polygon. Prefer the
  // polygon that contains the verified provider pin so the map, pin layer, and
  // aim-to-pin distance all share the same target geometry.
  const realProviderPin = currentHoleGeometry?.quality.pinUsable && realGreenFeatures.length > 0
    ? currentHoleGeometry.hole.features.find((feature) => feature.kind === "pin" && geometryPositions(feature.geometry).some((position) => realGreenFeatures.some((green) => isGeoPositionInsideGeometryOrBoundary(position, green.geometry))))
    : undefined;
  const realProviderPinPosition = realProviderPin ? geometryPositions(realProviderPin.geometry)[0] : undefined;
  const realGreenFeature = realProviderPinPosition
    ? realGreenFeatures.find((feature) => geometryPositions(feature.geometry).some((position) => isGeoPositionInsideGeometryOrBoundary(realProviderPinPosition, feature.geometry))) ?? realGreenFeatures[0]
    : realGreenFeatures[0];
  const realGreenPositions = realGreenFeature ? geometryPositions(realGreenFeature.geometry) : [];
  const realGreenCenter = meanGeoPosition(realGreenPositions);
  const realTeeFeatures = currentHoleGeometry ? teeFeaturesForTargetGreen(currentHoleGeometry.hole.features, realGreenCenter) : [];
  const realTeeFeatureIds = realTeeFeatures.length > 0 ? new Set(realTeeFeatures.map((feature) => feature.id)) : undefined;
  const realTeePositions = realTeeFeatures.flatMap((feature) => geometryPositions(feature.geometry));
  const realTeeOrigin = meanGeoPosition(realTeePositions);
  const realMapRotationDeg = topFacingRotationDegrees(realTeeOrigin, realGreenCenter);
  const realMapRotationRad = (realMapRotationDeg * Math.PI) / 180;
  const mapCoverScale = courseIsDemo ? 1 : rotatedMapCoverScale(mapSize, realMapRotationRad);
  const mapContentScale = mapCoverScale;
  const realPinPosition = realPinOverride ?? realGreenCenter;
  const realPinSource = realPinOverride ? "custom" : realGreenCenter ? "center" : undefined;
  const realReferenceOrigin = tracking?.start
    ? [tracking.start.lon, tracking.start.lat] as GeoJsonPosition
    : latestLockedShot
      ? [latestLockedShot.end.lon, latestLockedShot.end.lat] as GeoJsonPosition
      : realTeeOrigin;
  const realBallOnGreen = Boolean(realReferenceOrigin && realGreenFeature && isGeoPositionInsideGeometryOrBoundary(realReferenceOrigin, realGreenFeature.geometry));
  const demoBallOnGreen = Boolean(latestManualShot && courseDistanceYards(demoBallCoursePoint, pinPoint) <= 18);
  const puttingActive = trackingActive && (courseIsDemo ? demoBallOnGreen : realBallOnGreen);
  const teePlannerOrigin = realTeeOrigin ?? realReferenceOrigin;
  const realGreenDistances = realReferenceOrigin && realGreenPositions.length > 0
    ? realGreenPositions.map((position) => geoDistanceYards(realReferenceOrigin, position))
    : [];
  const realFrontYards = realGreenDistances.length > 0 ? Math.round(Math.min(...realGreenDistances)) : undefined;
  const realBackYards = realGreenDistances.length > 0 ? Math.round(Math.max(...realGreenDistances)) : undefined;
  const realCenterYards = realGreenDistances.length > 0 ? Math.round(realGreenDistances.reduce((sum, value) => sum + value, 0) / realGreenDistances.length) : undefined;
  const realTargetDistanceYards = realReferenceOrigin && realPinPosition
    ? geoDistanceYards(realReferenceOrigin, realPinPosition)
    : undefined;
  const realTargetYards = realTargetDistanceYards !== undefined
    ? Math.round(realTargetDistanceYards)
    : realCenterYards;
  const puttingDistanceYards = courseIsDemo
    ? Math.round(courseDistanceYards(demoBallCoursePoint, pinPoint))
    : realTargetYards ?? 0;
  const currentHoleNumber = courseIsDemo ? 7 : selectedHoleNumber;
  const headerMaximumHole = courseIsDemo ? 7 : Math.min(selectedCourse?.holes ?? 18, 18);
  // A score below the strokes already recorded for this hole contradicts the
  // evidence, so the stepper cannot draft one. Event adds can still raise the
  // floor above a drafted score; saveHoleOutcome blocks that at save time.
  const minimumScoreForHole = Math.max(1, countRecordedStrokes(roundLog.events, currentHoleNumber));
  const currentHolePar = courseIsDemo
    ? 4
    : currentHoleGeometry?.hole.par ?? getPersonalCourseHolePar(selectedCourse?.id, currentHoleNumber) ?? 4;
  const headerHolePar = courseIsDemo || currentHoleGeometry ? currentHolePar : undefined;
  const realCenterlineFeature = currentHoleGeometry?.hole.features.find((feature) => feature.kind === "centerline");
  const realHazardFeatures = currentHoleGeometry?.quality.hazardsUsable
    ? currentHoleGeometry.hole.features.filter((feature) => ["bunker", "water", "waste", "out_of_bounds"].includes(feature.kind))
    : [];
  const longestApproachYards = activeEquipment
    .filter((club) => club.type !== "driver" && club.type !== "putter")
    .reduce((longest, club) => Math.max(longest, club.totalYards ?? club.carryYards ?? 0), 0);
  const realCaddyAimPosition = (strategy: CaddyAggressiveness, origin = realReferenceOrigin): GeoJsonPosition | undefined => {
    if (!origin) return realGreenCenter;
    if (realGreenFeature && isGeoPositionInsideGeometryOrBoundary(origin, realGreenFeature.geometry)) return realPinPosition;
    const frontYards = realGreenPositions.length > 0
      ? Math.min(...realGreenPositions.map((position) => geoDistanceYards(origin, position)))
      : Number.POSITIVE_INFINITY;
    if (longestApproachYards >= frontYards) return strategy === "aggressive" ? realPinPosition : realGreenCenter;
    const centerline = realCenterlineFeature ? geometryPositions(realCenterlineFeature.geometry) : [];
    if (centerline.length === 0) return realGreenCenter;
    if (strategy === "standard") return linePointAtFraction(centerline, CADDY_AGGRESSIVENESS.standard.realAimFraction) ?? realGreenCenter;
    const fractions = strategy === "safe" ? [0.58, 0.62, 0.66, 0.70] : [0.74, 0.78, 0.82];
    const candidates = fractions
      .map((fraction) => linePointAtFraction(centerline, fraction))
      .filter((position): position is GeoJsonPosition => Boolean(position));
    if (strategy === "safe" && realHazardFeatures.length > 0) {
      return candidates.sort((left, right) =>
        Math.min(...realHazardFeatures.map((feature) => geoGeometryDistanceYards(right, feature.geometry)))
        - Math.min(...realHazardFeatures.map((feature) => geoGeometryDistanceYards(left, feature.geometry))),
      )[0] ?? realGreenCenter;
    }
    if (strategy === "aggressive" && realPinPosition) {
      // ponytail: centerline turn angle is the prototype's best-angle proxy; replace it when verified lie and obstacle scoring exists.
      return candidates.sort((left, right) => approachTurnDegrees(origin, left, realPinPosition) - approachTurnDegrees(origin, right, realPinPosition))[0] ?? realGreenCenter;
    }
    return linePointAtFraction(centerline, CADDY_AGGRESSIVENESS[strategy].realAimFraction) ?? realGreenCenter;
  };
  const realMapPositions = currentHoleGeometry?.hole.features.flatMap((feature) => geometryPositions(feature.geometry)) ?? [];
  // Center the real hole on the tee→green corridor so the top-facing view
  // keeps both the tee boxes and target green in the glanceable frame. The
  // fallback still uses the full feature mean for incomplete geometry.
  const realMapCenterPosition = midpointGeoPosition(realTeeOrigin, realGreenCenter) ?? meanGeoPosition(realMapPositions);
  const realAimDefaultPosition = realCaddyAimPosition(caddyAggressiveness);
  const ruleOf12Visible = !courseIsDemo
    && !puttingActive
    && realTargetDistanceYards !== undefined
    && realTargetDistanceYards <= 50;
  const automaticRuleOf12LandingPoint = ruleOf12Visible
    && aimEditable
    && realReferenceOrigin
    && realPinPosition
    && realGreenFeature
    ? findAutomaticGreenLandingPoint(realReferenceOrigin, realPinPosition, realGreenFeature.geometry)
    : undefined;
  const automaticRuleOf12CarryYards = automaticRuleOf12LandingPoint && realReferenceOrigin
    ? Math.round(geoDistanceYards(realReferenceOrigin, automaticRuleOf12LandingPoint))
    : undefined;
  const automaticRuleOf12RolloutYards = automaticRuleOf12LandingPoint && realPinPosition
    ? Math.round(geoDistanceYards(automaticRuleOf12LandingPoint, realPinPosition))
    : undefined;
  const levelRuleOf12Projection = automaticRuleOf12CarryYards !== undefined && automaticRuleOf12RolloutYards !== undefined
    ? projectRuleOf12({ carryYards: automaticRuleOf12CarryYards, rolloutYards: automaticRuleOf12RolloutYards, slope: "level", equipment })
    : undefined;
  const ruleOf12AutomaticActive = Boolean(levelRuleOf12Projection);
  const liveRealAimPosition = ruleOf12AutomaticActive ? automaticRuleOf12LandingPoint : realAimDraft ?? realAimOverride ?? realAimDefaultPosition;
  const storedRealAim = realShotLegCompleted ? latestLockedShot?.realPlannedAim : undefined;
  const realAimPosition = storedRealAim?.point ?? liveRealAimPosition;
  const realAimOnGreen = Boolean(realAimPosition && realGreenFeature && isGeoPositionInsideGeometryOrBoundary(realAimPosition, realGreenFeature.geometry));
  const realAimSource = storedRealAim?.source ?? (realAimOverride ? "manual" : "caddy");
  const realAimReferenceOrigin = storedRealAim && latestLockedShot
    ? [latestLockedShot.start.lon, latestLockedShot.start.lat] as GeoJsonPosition
    : realReferenceOrigin;
  const realPlanOrigin = realShotLegCompleted && latestLockedShot
    ? [latestLockedShot.start.lon, latestLockedShot.start.lat] as GeoJsonPosition
    : realReferenceOrigin;
  const realPlanningOrigin = realShotLegCompleted && latestLockedShot
    ? [latestLockedShot.start.lon, latestLockedShot.start.lat] as GeoJsonPosition
    : realReferenceOrigin;
  const realPlanningTargetPosition = ruleOf12AutomaticActive ? automaticRuleOf12LandingPoint : realAimDefaultPosition;
  const realPlanningCenterPosition = realPlanningFocus
    // Bias the focus center toward the target so the aim handle and green stay
    // in the readable middle of the map instead of clipping against the top
    // edge at the tighter planning scale.
    ? interpolateGeoPosition(realPlanningOrigin, realPlanningTargetPosition, 0.62) ?? realMapCenterPosition
    : realMapCenterPosition;
  const plannedMapCenter = realPlanningCenterPosition
    ? { lat: realPlanningCenterPosition[1], lon: realPlanningCenterPosition[0] }
    : selectedCourse?.center ?? MAP_FOCUS_GEO;
  const activeMapCenter = latestManualShot && manualMapCenterRef.current ? manualMapCenterRef.current : plannedMapCenter;
  const realAimMapPoint = realAimPosition
    ? geoMapPair({ lat: realAimPosition[1], lon: realAimPosition[0] }, activeMapCenter, mapSize)
    : undefined;
  const realAimYards = realAimReferenceOrigin && realAimPosition
    ? Math.round(geoDistanceYards(realAimReferenceOrigin, realAimPosition))
    : undefined;
  const realAimToPinYards = realAimPosition && realPinPosition
    ? Math.round(geoDistanceYards(realAimPosition, realPinPosition))
    : undefined;
  const ruleOf12Projection = ruleOf12AutomaticActive
    ? projectRuleOf12({ carryYards: automaticRuleOf12CarryYards!, rolloutYards: automaticRuleOf12RolloutYards!, slope: ruleOf12Slope, equipment })
    : undefined;
  const ruleOf12ClubId = ruleOf12Projection
    ? EQUIPMENT_SLOT_TO_CLUB_ID[(equipment.find((club) => club.id === ruleOf12Projection.clubId)?.slot ?? 0) - 1]
    : undefined;

  useEffect(() => {
    if (teeShotPending) return;
    if (!ruleOf12AutomaticActive) {
      const priorRuleClubId = ruleOf12PreviousClubRef.current;
      if (!priorRuleClubId) return;
      const pitchClubId = recommendPitchClubId(equipment) ?? priorRuleClubId;
      const pitchProfile = profileForClubId(pitchClubId);
      if (pitchClubId !== selectedClubId) setSelectedClubId(pitchClubId);
      setClubPickerPreviewId(pitchClubId);
      setTracking((openLeg) => openLeg && openLeg.number > 1
        ? { ...openLeg, club: clubTrackingLabel(pitchProfile) }
        : openLeg);
      ruleOf12PreviousClubRef.current = null;
      return;
    }
    const pitchClubId = recommendPitchClubId(equipment);
    const nextClubId = ruleOf12ClubId ?? ruleOf12PreviousClubRef.current ?? pitchClubId;
    if (!nextClubId) return;

    if (ruleOf12ClubId) ruleOf12PreviousClubRef.current ??= pitchClubId ?? selectedClubId;
    else ruleOf12PreviousClubRef.current = null;
    if (nextClubId === selectedClubId) return;

    const nextProfile = profileForClubId(nextClubId);
    setSelectedClubId(nextClubId);
    setClubPickerPreviewId(nextClubId);
    setTracking((openLeg) => openLeg && openLeg.number > 1
      ? { ...openLeg, club: clubTrackingLabel(nextProfile) }
      : openLeg);
  }, [equipment, ruleOf12AutomaticActive, ruleOf12ClubId, selectedClubId, teeShotPending]);

  const { playsLikeYards: basePlaysLikeYards, signedOffsetYards } = getAimMetrics(effectiveAimCourse, pinPoint, demoBallCoursePoint);
  const baseTargetYards = courseIsDemo ? basePlaysLikeYards : realTargetYards;
  const realPinMapPoint = realPinPosition
    ? (() => {
        const point = geoMapPair({ lat: realPinPosition[1], lon: realPinPosition[0] }, activeMapCenter, mapSize);
        return { x: point.x / 100, y: point.y / 100 };
      })()
    : undefined;
  const realReferenceMapPoint = realReferenceOrigin
    ? (() => {
        const point = geoMapPair({ lat: realReferenceOrigin[1], lon: realReferenceOrigin[0] }, activeMapCenter, mapSize);
        return { x: point.x / 100, y: point.y / 100 };
      })()
    : undefined;
  const teeShotHazards: TeeShotHazard[] = courseIsDemo
    ? [
        { id: "demo-left-bunker", label: "LEFT BUNKER", kind: "bunker", distanceYards: 145, direction: "left" },
        { id: "demo-front-bunker", label: "FRONT BUNKER", kind: "bunker", distanceYards: 142, direction: "center" },
      ]
    : currentHoleGeometry?.quality.hazardsUsable && teePlannerOrigin
      ? currentHoleGeometry.hole.features
          .filter((feature) => ["bunker", "water", "waste", "out_of_bounds"].includes(feature.kind))
          .map((feature) => {
            const positions = geometryPositions(feature.geometry);
            const center = meanGeoPosition(positions);
            const distanceYards = feature.carryYards ?? (center ? Math.round(geoDistanceYards(teePlannerOrigin, center)) : 0);
            const mapPoint = center
              ? geoMapPair({ lat: center[1], lon: center[0] }, activeMapCenter, mapSize)
              : undefined;
            const direction: TeeShotHazard["direction"] = mapPoint && mapPoint.x < 42 ? "left" : mapPoint && mapPoint.x > 58 ? "right" : "center";
            return {
              id: feature.id,
              label: feature.kind.replaceAll("_", " ").toUpperCase(),
              kind: feature.kind as TeeShotHazard["kind"],
              distanceYards,
              direction,
            };
          })
          .filter((hazard) => Number.isFinite(hazard.distanceYards) && hazard.distanceYards > 0)
      : [];
  const onCourseCourseId = selectedCourse?.id ?? courseSelection?.courseId ?? DEMO_OPENROUND_COURSE.id;
  const onCourseHoleNumber = selectedCourse ? selectedHoleNumber : courseSelection?.holeNumber ?? 7;
  const onCourseIdentity = {
    roundId: `${onCourseCourseId}:${onCourseHoleNumber}`,
    courseId: onCourseCourseId,
    holeNumber: onCourseHoleNumber,
  } as const;
  const clubStatisticsStorage = useMemo(() => getBrowserOnCourseStorage(), []);
  const [clubStatistics, setClubStatistics] = useState(() => loadClubStatistics(clubStatisticsStorage));
  const clubStatisticSamples = useMemo(() => projectClubStatisticSamples(clubStatistics), [clubStatistics]);
  const onCourse = useOpenRoundOnCourse({
    identity: onCourseIdentity,
    roundLog,
    equipment: activeEquipment,
    baseTargetYards,
    signedOffsetYards,
    par: currentHolePar,
    score,
    active: onCourseCourseId === DEMO_OPENROUND_COURSE.id && startView === "field" && roundLog.events.some((event) => event.strokes > 0),
    hazards: teeShotHazards,
    weatherLocation: selectedCourse?.center ?? TEE,
    fallbackConditions: legacyPlayingConditions,
    trackedShotReviewId,
    clubStatisticSamples,
  });
  const onCourseState = onCourse.state;

  function persistRounds(next: SavedRound[], requireDurable = false) {
    const saved = saveRounds(getBrowserOnCourseStorage(), next);
    setRoundSaveError(!saved);
    if (saved || !requireDurable) {
      savedRoundsRef.current = next;
      setSavedRounds(next);
    }
    return saved;
  }

  function captureCurrentHole(): SavedHole {
    return {
      holeNumber: currentHoleNumber,
      session: JSON.stringify({ version: 1, roundId: onCourseIdentity.roundId, courseId: onCourseCourseId, holeNumber: currentHoleNumber, score, lockedShots, manualEntries, tracking, selectedClubId, teeShotClubId }),
      log: createRoundLogForRound(onCourseCourseId, currentHoleNumber, score, roundLog.events),
      onCourse: onCourseState,
      friendScores,
    };
  }

  function saveCurrentHole() {
    if (courseIsDemo || onCourseState.courseId !== onCourseCourseId || onCourseState.holeNumber !== currentHoleNumber) return;
    if (!roundRecordIdRef.current && activeRound && selectedCourse) {
      const record: SavedRound = { id: savedRoundsRef.current.some((round) => round.id === onCourseIdentity.roundId) ? crypto.randomUUID() : onCourseIdentity.roundId, courseId: selectedCourse.id, courseName: selectedCourse.name, teeBox: activeRound.teeBox, startedAt: activeRound.updatedAt, endedAt: null, golfers: roundSetup.golfers ?? [], holes: [] };
      roundRecordIdRef.current = record.id;
      setRoundRecordId(record.id);
      savedRoundsRef.current = [...savedRoundsRef.current, record];
    }
    if (!roundRecordIdRef.current) return;
    const hole = captureCurrentHole();
    return persistRounds(savedRoundsRef.current.map((round) => round.id === roundRecordIdRef.current && round.endedAt === null
      ? { ...round, holes: [...round.holes.filter((saved) => saved.holeNumber !== hole.holeNumber), hole].sort((a, b) => a.holeNumber - b.holeNumber) } : round));
  }

  useEffect(() => {
    if (activeRound && selectedCourse) saveCurrentHole();
  }, [roundRecordId, activeRound, selectedCourse, selectedHoleNumber, score, lockedShots, manualEntries, roundLog.events, onCourseState, friendScores, tracking, selectedClubId, teeShotClubId]);

  useEffect(() => {
    if (!courseIsDemo && (!roundRecordId || !activeRound)) return;
    setClubStatistics((current) => {
      const next = ingestClubStatistics(current, {
        mode: courseIsDemo ? "demo" : "live",
        identity: { ...onCourseIdentity, roundId: roundRecordId ?? onCourseIdentity.roundId },
        samples: onCourseState.shotSamples,
      });
      if (next === current) return current;
      saveClubStatistics(clubStatisticsStorage, next);
      return next;
    });
  }, [clubStatisticsStorage, courseIsDemo, activeRound, roundRecordId, onCourseIdentity.courseId, onCourseIdentity.holeNumber, onCourseIdentity.roundId, onCourseState.shotSamples]);
  const playingConditions = onCourseState.conditions;
  const weatherLoadState = onCourse.weatherLoadState;
  const onCourseView = onCourse.view;
  const conditionAdjustment = onCourseView.conditionAdjustmentYards;
  const distanceAdjustments = getConditionAdjustments(playingConditions);
  const adjustedRealTargetYards = onCourseView.currentTargetYards;
  const playsLikeYards = courseIsDemo
    ? onCourseView.playsLikeYards ?? basePlaysLikeYards
    : Math.max(0, basePlaysLikeYards + conditionAdjustment);
  const trackingUsesDemoDistance = courseIsDemo || latestLockedShot?.evidence === "demo_manual";
  const activeShotDistanceYards = tracking
    ? trackingUsesDemoDistance
      ? courseIsDemo ? playsLikeYards : realAimYards ?? 0
      : liveTrackingFix?.shotNumber === tracking.number ? liveTrackingFix.yards : 0
    : undefined;
  const displayedMapShot = tracking
    ? {
        number: tracking.number,
        club: tracking.club,
        totalGps: activeShotDistanceYards ?? 0,
        status: `${trackingUsesDemoDistance ? "DEMO MANUAL" : "LIVE GPS"} · TRACKING`,
      }
    : latestLockedShot
      ? {
          number: latestLockedShot.number,
          club: latestLockedShot.club,
          totalGps: latestLockedShot.totalGps,
          status: `${lockedShotEvidenceLabel(latestLockedShot)} · LOCKED`,
        }
      : null;
  const currentTargetYards = onCourseView.currentTargetYards;
  const clubSelectorTargetYards = Math.round(adjustedRealTargetYards ?? playsLikeYards ?? currentProfile.carryYards);
  const observedClubOffsets = lockedShots.reduce<Partial<Record<ApproachClubId, ShotOffset[]>>>((byClub, shot) => {
    if (shot.evidence !== "total_gps" || !shot.clubProfileId) return byClub;
    const offset = shotOffsetFromStoredAim(shot);
    if (!offset) return byClub;
    byClub[shot.clubProfileId] = [...(byClub[shot.clubProfileId] ?? []), offset];
    return byClub;
  }, {});
  const clubEvidence = projectClubEvidence({
    equipment,
    shotSamples: clubStatisticSamples,
    targetYards: clubSelectorTargetYards,
    currentClubId,
    requestedPreviewClubId: clubPickerPreviewId,
    forcedCaddyClubId: teeShotPending ? teeShotClubId : undefined,
    mode: courseIsDemo ? "demo" : "live",
    observedOffsetsByClubId: observedClubOffsets,
  });
  const clubSelectorItems = clubEvidence.rows;
  const clubSelectorCaddyId = clubEvidence.caddyClubId ?? currentClubId;
  const clubPreviewItem = clubEvidence.preview;
  const distanceRecommendedClub = clubSelectorItems.find((club) => club.clubId === clubSelectorCaddyId);

  useEffect(() => {
    if (!tracking || trackingUsesDemoDistance || startView !== "field" || typeof navigator === "undefined" || !navigator.geolocation) return;
    const trackingLeg = tracking;

    let fallbackTimer: number | undefined;
    let fallbackPending = false;
    let cancelled = false;
    let latestAcceptedTimestamp = liveTrackingFix?.shotNumber === trackingLeg.number ? liveTrackingFix.capturedAt : 0;

    function scheduleFallback() {
      if (cancelled) return;
      window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(requestFallback, 3_000);
    }

    function acceptPosition(position: GeolocationPosition) {
      const { latitude, longitude, accuracy } = position.coords;
      const ageMs = Date.now() - position.timestamp;
      if (
        cancelled
        || !Number.isFinite(latitude)
        || !Number.isFinite(longitude)
        || !Number.isFinite(accuracy)
        || accuracy < 0
        || accuracy > MAX_FIX_ACCURACY_METERS
        || !Number.isFinite(position.timestamp)
        || position.timestamp <= 0
        || position.timestamp <= latestAcceptedTimestamp
        || ageMs < -5_000
        || ageMs > MAX_FIX_AGE_MS
      ) return false;

      setGpsAccuracyMeters(Math.round(accuracy));
      setLastGpsFixCapturedAt(position.timestamp);
      setLiveTrackingFix({
        shotNumber: trackingLeg.number,
        point: { lat: latitude, lon: longitude },
        accuracy,
        capturedAt: position.timestamp,
        yards: Math.round(distanceBetweenYards(trackingLeg.start, { lat: latitude, lon: longitude })),
      });
      latestAcceptedTimestamp = position.timestamp;
      scheduleFallback();
      return true;
    }

    function requestFallback() {
      if (cancelled || fallbackPending) return;
      fallbackPending = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          fallbackPending = false;
          if (!acceptPosition(position)) scheduleFallback();
        },
        () => {
          fallbackPending = false;
          scheduleFallback();
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 8_000 },
      );
    }

    const watchId = navigator.geolocation.watchPosition(acceptPosition, undefined, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 8_000 });
    scheduleFallback();

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
      navigator.geolocation.clearWatch(watchId);
    };
  }, [tracking, trackingUsesDemoDistance, startView]);

  const recommendedClubId = (targetYards: number, strategy: CaddyAggressiveness, onGreen = false): ApproachClubId => {
    if (onGreen) return "putter";
    const candidates = clubSelectorItems.filter((item) => item.clubId !== "putter");
    if (targetYards <= 50) {
      const pitchClubId = recommendPitchClubId(equipment);
      if (pitchClubId) return pitchClubId;
    }
    if (strategy === "safe") {
      const conservativeTarget = targetYards + 8;
      return candidates
        .filter((item) => item.trueDistanceYards >= conservativeTarget)
        .sort((left, right) => left.trueDistanceYards - right.trueDistanceYards)[0]?.clubId
        ?? candidates.sort((left, right) => right.trueDistanceYards - left.trueDistanceYards)[0]?.clubId
        ?? selectedClubId;
    }
    return candidates
      .sort((left, right) => Math.abs(left.trueDistanceYards - targetYards) - Math.abs(right.trueDistanceYards - targetYards))[0]?.clubId
      ?? selectedClubId;
  };

  useEffect(() => {
    if (activeSheet !== "club") return;

    const frame = window.requestAnimationFrame(() => {
      const ladder = clubLadderRef.current;
      const caddyRow = ladder?.querySelector<HTMLElement>(`[data-club-id="${clubSelectorCaddyId}"]`);
      if (!ladder || !caddyRow) return;

      ladder.scrollTop = caddyRow.offsetTop - (ladder.clientHeight - caddyRow.offsetHeight) / 2;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeSheet, clubSelectorCaddyId]);
  const mapDetailVisible = mapView.scale >= MAP_DETAIL_ZOOM_SCALE;
  const cupFocusActive = puttingActive && !pinPlacementActive;
  const autoZoomScale = pinPlacementActive
    ? 1
    : cupFocusActive
      ? PIN_PLACEMENT_ZOOM_MAX
      : approachAutoZoomScale(
        onCourseState.autoZoom,
        courseIsDemo ? Math.round(courseDistanceYards(demoBallCoursePoint, pinPoint)) : realTargetYards,
      );
  const autoZoomActive = autoZoomScale > 1;
  const aimPointVisible = !selectedCourse || Boolean(currentHoleGeometry && realAimMapPoint);
  const renderedAimPoint = !selectedCourse
    ? effectiveAimPoint
    : realAimMapPoint
      ? { x: realAimMapPoint.x / 100, y: realAimMapPoint.y / 100 }
      : undefined;
  const renderedAimPointStyle = renderedAimPoint
    ? {
      ...mapPointStyle(renderedAimPoint),
      transform: `translate(-50%, -50%) scale(${1 / (mapView.scale * mapContentScale * autoZoomScale)})`,
    }
    : undefined;
  const currentSavedRound = savedRounds.find((round) => round.id === roundRecordId);
  const onCourseRoundStats = currentSavedRound ? deriveRoundStats(
    { ...roundLog, score: 0, events: currentSavedRound.holes.flatMap((hole) => hole.log.events) },
    { ...onCourseState, holes: currentSavedRound.holes.flatMap((hole) => hole.onCourse.holes.filter((outcome) => outcome.holeNumber === hole.holeNumber)), missDetails: currentSavedRound.holes.flatMap((hole) => hole.onCourse.missDetails) },
  ) : onCourseView.roundStats;
  const holeInsights = onCourseView.holeInsights;
  const targetProgress = onCourseView.targetProgress;
  const clubRecommendation = onCourseView.clubRecommendation;
  const coachAdvice = onCourseView.coachAdvice;
  const blindShotGuide = onCourseView.blindShotGuide;
  const teeShotPlan = onCourseView.teeShotPlan;
  const trackedShotReview = onCourseView.trackedShotReview;

  useEffect(() => {
    try {
      window.localStorage.setItem(CONDITIONS_STORAGE_KEY, JSON.stringify(playingConditions));
    } catch {
      // Conditions still apply for this session if local storage is unavailable.
    }
  }, [playingConditions]);

  function setPlayingConditions(next: PlayingConditions | ((current: PlayingConditions) => PlayingConditions)) {
    const conditions = typeof next === "function" ? next(onCourseState.conditions) : next;
    onCourse.dispatch({ type: "set-conditions", conditions });
  }

  const aimLabel = formatAimLabel(signedOffsetYards);
  const compactAimLabel = formatCompactAim(signedOffsetYards);
  const mapBallPoint = latestManualShot ? mapPointFromCoursePoint(demoBallCoursePoint) : driverShot ? CURRENT_BALL_MAP_POINT : TEE_MAP_POINT;
  const distanceArcOrigin = courseIsDemo ? mapBallPoint : realReferenceMapPoint;
  const distanceArcReferenceYards = courseIsDemo
    ? courseDistanceYards(demoBallCoursePoint, pinPoint)
    : realTargetYards;
  const planRoutePoints =
    effectiveAimSource === "caddy_path" && !latestManualShot
      ? [mapBallPoint, CADDY_FAIRWAY_ENTRY, effectiveAimPoint]
      : [mapBallPoint, effectiveAimPoint];
  const pinRoutePoints =
    effectiveAimSource === "caddy_path" && !latestManualShot
      ? [effectiveAimPoint, CADDY_FAIRWAY_EXIT, pinMapPoint]
      : [effectiveAimPoint, pinMapPoint];
  const planRouteStyles = planRoutePoints
    .slice(0, -1)
    .map((point, index) => routeSegmentStyle(point, planRoutePoints[index + 1], mapSize));
  const pinRouteStyles = pinRoutePoints
    .slice(0, -1)
    .map((point, index) => routeSegmentStyle(point, pinRoutePoints[index + 1], mapSize));
  const dispersionOrigin = mapBallPoint;
  const planAngle = Math.atan2(
    (effectiveAimPoint.y - dispersionOrigin.y) * mapSize.height,
    (effectiveAimPoint.x - dispersionOrigin.x) * mapSize.width,
  );
  const dispersionCenterCourse = offsetPointRelativeToTarget(
    demoBallCoursePoint,
    effectiveAimCourse,
    (selectedEnvelope.rightYards - selectedEnvelope.leftYards) / 2,
    (selectedEnvelope.longYards - selectedEnvelope.shortYards) / 2,
  );
  const dispersionCenter = mapPointFromCoursePoint(dispersionCenterCourse);
  const dispersionWidth = dispersionIsCircular
    ? VISUAL_DISPERSION_CIRCLE_DIAMETER_PX
    : clamp(
      (selectedEnvelope.leftYards + selectedEnvelope.rightYards) * VISUAL_DISPERSION_LATERAL_PX_PER_YARD,
      VISUAL_DISPERSION_MIN_WIDTH_PX,
      VISUAL_DISPERSION_MAX_WIDTH_PX,
    );
  const dispersionDepth = dispersionIsCircular
    ? VISUAL_DISPERSION_CIRCLE_DIAMETER_PX
    : clamp(
      (selectedEnvelope.shortYards + selectedEnvelope.longYards) * VISUAL_DISPERSION_DISTANCE_PX_PER_YARD,
      VISUAL_DISPERSION_MIN_DEPTH_PX,
      VISUAL_DISPERSION_MAX_DEPTH_PX,
    );
  // Keep the visible aim reticle keyed to the same deterministic envelope as
  // the dispersion window. Real-course maps are already rotated top-facing,
  // so subtract that world rotation before the face is rotated in map space.
  const realAimAngleDeg = realPlanOrigin && realAimPosition
    ? (() => {
      const origin = geoMapPair({ lat: realPlanOrigin[1], lon: realPlanOrigin[0] }, activeMapCenter, mapSize);
      const landing = geoMapPair({ lat: realAimPosition[1], lon: realAimPosition[0] }, activeMapCenter, mapSize);
      return Math.atan2(
        (landing.y - origin.y) * mapSize.height,
        (landing.x - origin.x) * mapSize.width,
      ) * (180 / Math.PI) + 90 - realMapRotationDeg;
    })()
    : 0;
  const aimFaceStyle = {
    "--aim-dispersion-width": `${dispersionWidth * (courseIsDemo ? 1 : REAL_AIM_FACE_SCALE)}px`,
    "--aim-dispersion-depth": `${dispersionDepth * (courseIsDemo ? 1 : REAL_AIM_FACE_SCALE)}px`,
    "--aim-dispersion-angle": `${courseIsDemo ? planAngle * (180 / Math.PI) + 90 : realAimAngleDeg}deg`,
    "--aim-auto-scale": `${1 / Math.sqrt(autoZoomScale)}`,
  } as CSSProperties;
  const renderedMapTranslation = mapTranslation(mapView);
  const mapTranslateX = renderedMapTranslation.x;
  const mapTranslateY = renderedMapTranslation.y;
  const renderedMapScale = mapView.scale * mapContentScale * autoZoomScale;
  const imageryDetailScale = courseIsDemo ? 1 : renderedMapScale;
  const imageryDetailCenter = !courseIsDemo
    ? (() => {
        const screenX = -mapTranslateX;
        const screenY = -mapTranslateY;
        const mapXOffset = (Math.cos(realMapRotationRad) * screenX + Math.sin(realMapRotationRad) * screenY) / renderedMapScale;
        const mapYOffset = (-Math.sin(realMapRotationRad) * screenX + Math.cos(realMapRotationRad) * screenY) / renderedMapScale;
        const centerWorld = webMercatorWorldPixel(activeMapCenter, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
        return webMercatorGeoPoint(
          { x: centerWorld.x + mapXOffset, y: centerWorld.y + mapYOffset },
          MAP_TILE_ZOOM,
          MAP_TILE_SIZE_PX,
        );
      })()
    : activeMapCenter;
  const mapWorldStyle: CSSProperties = {
    transform: `translate3d(${mapTranslateX}px, ${mapTranslateY}px, 0) rotate(${courseIsDemo ? 0 : realMapRotationDeg}deg) scale(${renderedMapScale})`,
    transformOrigin: "50% 50%",
  };
  const pinPlacementMapPoint: MapPoint = {
    x: 0.5 - mapView.panX / (mapSize.width * mapView.scale * mapContentScale * autoZoomScale),
    y: 0.5 - mapView.panY / (mapSize.height * mapView.scale * mapContentScale * autoZoomScale),
  };
  const pinPlacementGeoCandidate = !courseIsDemo && selectedCourse?.center
    ? (() => {
        const candidate = realViewportCenter(mapView);
        return [candidate.lon, candidate.lat] as GeoJsonPosition;
      })()
    : undefined;
  const pinPlacementCandidateValid = courseIsDemo
    ? pinPlacementMapPoint.x >= GREEN_PIN_BOUNDS.minX
      && pinPlacementMapPoint.x <= GREEN_PIN_BOUNDS.maxX
      && pinPlacementMapPoint.y >= GREEN_PIN_BOUNDS.minY
      && pinPlacementMapPoint.y <= GREEN_PIN_BOUNDS.maxY
    : Boolean(pinPlacementGeoCandidate && realGreenFeature && isGeoPositionInsideGeometry(pinPlacementGeoCandidate, realGreenFeature.geometry));

  function realViewportCenter(view: MapView, mapCenter = activeMapCenter): GeoPoint {
    const renderedScale = view.scale * mapContentScale * autoZoomScale;
    const translation = mapTranslation(view);
    const screenX = -translation.x;
    const screenY = -translation.y;
    const mapXOffset = (Math.cos(realMapRotationRad) * screenX + Math.sin(realMapRotationRad) * screenY) / renderedScale;
    const mapYOffset = (-Math.sin(realMapRotationRad) * screenX + Math.cos(realMapRotationRad) * screenY) / renderedScale;
    const centerWorld = webMercatorWorldPixel(mapCenter, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
    return webMercatorGeoPoint(
      { x: centerWorld.x + mapXOffset, y: centerWorld.y + mapYOffset },
      MAP_TILE_ZOOM,
      MAP_TILE_SIZE_PX,
    );
  }

  function mapViewForRealViewportCenter(visualCenter: GeoPoint, effectiveScale: number): MapView {
    const currentMapSize = mapRef.current
      ? { width: mapRef.current.clientWidth, height: mapRef.current.clientHeight }
      : mapSize;
    const currentMapContentScale = courseIsDemo ? 1 : rotatedMapCoverScale(currentMapSize, realMapRotationRad);
    const projected = geoMapPair(visualCenter, activeMapCenter, currentMapSize);
    const offsetX = (projected.x / 100) * currentMapSize.width - currentMapSize.width / 2;
    const offsetY = (projected.y / 100) * currentMapSize.height - currentMapSize.height / 2;
    const rotatedX = Math.cos(realMapRotationRad) * offsetX - Math.sin(realMapRotationRad) * offsetY;
    const rotatedY = Math.sin(realMapRotationRad) * offsetX + Math.cos(realMapRotationRad) * offsetY;
    const scale = effectiveScale / (currentMapContentScale * autoZoomScale);
    const translation = mapTranslation({ scale, panX: 0, panY: 0 }, currentMapSize);
    return {
      scale,
      panX: -rotatedX * effectiveScale - translation.x,
      panY: -rotatedY * effectiveScale - translation.y,
    };
  }

  function mapTranslation(view: MapView, size = mapSize): MapPoint {
    return {
      x: view.panX + (cupFocusActive ? size.width * 0.12 : 0),
      y: view.panY + (cupFocusActive ? size.height * 0.65 : 0),
    };
  }

  useLayoutEffect(() => {
    const returnViewport = pendingPinPlacementRestoreRef.current;
    if (pinPlacementActive || !returnViewport) return;
    const currentSize = mapRef.current
      ? { width: mapRef.current.clientWidth, height: mapRef.current.clientHeight }
      : mapSize;
    if (currentSize.width !== mapSize.width || currentSize.height !== mapSize.height) {
      setMapSize(currentSize);
      return;
    }
    pendingPinPlacementRestoreRef.current = null;
    restoredPinMapSizeRef.current = currentSize;
    setMapView(mapViewForRealViewportCenter(returnViewport.visualCenter, returnViewport.effectiveScale));
  }, [activeMapCenter, autoZoomScale, mapContentScale, mapSize.height, mapSize.width, pinPlacementActive, realMapRotationRad]);

  useLayoutEffect(() => {
    if (!pinPlacementActive) return;
    const currentSize = mapRef.current
      ? { width: mapRef.current.clientWidth, height: mapRef.current.clientHeight }
      : mapSize;
    if (currentSize.width !== mapSize.width || currentSize.height !== mapSize.height) {
      setMapSize(currentSize);
      return;
    }
    if (!courseIsDemo && (realPinPosition ?? realGreenCenter)) {
      setMapView(focusMapOnRealPin((realPinPosition ?? realGreenCenter)!));
      return;
    }
    setMapView(focusMapOnPin(pinMapPoint));
    // Reframe only when the placement surface itself changes size. Normal pan
    // and zoom updates intentionally stay under the player's control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinPlacementActive, mapSize.width, mapSize.height]);
  const mapZoomLabel = `${mapView.scale.toFixed(1)}×`;
  const mapProviderCue = mapProvider === "google" ? "GOOGLE READY" : "USGS READY";
  const courseDisplayName = selectedCourse?.name ?? DEMO_OPENROUND_COURSE.name;
  const courseDisplayHole = selectedCourse ? selectedHoleNumber : 7;
  // Field-log context is always derived from the active map/session. A
  // missing real geometry is deliberately represented as grade D rather than
  // filling in a synthetic grade or hazard measurement.
  const fieldLogGeometryGrade: FieldLogGeometryGrade = selectedCourse
    ? currentHoleGeometry ? currentHoleGeometry.quality.grade : "D"
    : "D";
  const fieldLogGeometryVersion = selectedCourse
    ? currentHoleGeometry ? currentHoleGeometry.sourceVersion : "unverified"
    : "demo-fixture";
  // The pinned US index has 15k+ entries. Keep the merged index and its
  // current result set stable across unrelated map/GPS renders so dragging
  // or a phone fix does not sort the full catalog again.
  const courseDiscoveryCatalog = useMemo(
    () => courseCatalog ? mergeCourseCatalogEntries(courseCatalog, PERSONAL_COURSE_ENTRIES) : null,
    [courseCatalog],
  );
  const catalogResults = useMemo(
    () => courseDiscoveryCatalog && catalogMode === "nearby"
      ? nearbyLocation
        ? findNearbyCourses(courseDiscoveryCatalog, nearbyLocation, 50).map((result) => result.entry)
        : []
      : courseDiscoveryCatalog
        ? searchCourses(courseDiscoveryCatalog, catalogQuery)
        : [],
    [catalogMode, catalogQuery, courseDiscoveryCatalog, nearbyLocation],
  );
  const pendingHoleCount = pendingCourse ? Math.min(pendingCourse.holes ?? 18, 18) : 18;
  const pendingCourseTeeOptions = prototypeVariant === "c" ? courseTeeBoxOptions(pendingCourse) : [];
  const pendingTeeOptions = pendingCourseTeeOptions.length > 0 ? pendingCourseTeeOptions : TEE_BOX_OPTIONS;

  function toggleMapLayer() {
    onCourse.dispatch({ type: "set-map-layer", layer: onCourseState.mapLayer === "satellite" ? "illustration" : "satellite" });
  }

  function cycleGreenMap() {
    const modes = ["off", "approach", "putt_breaks"] as const;
    const nextIndex = (modes.indexOf(onCourseState.greenMapMode) + 1) % modes.length;
    onCourse.dispatch({ type: "set-green-map", mode: modes[nextIndex] ?? "off" });
  }

  function toggleDistanceArcs() {
    onCourse.dispatch({ type: "toggle-distance-arcs" });
  }

  function toggleBlindShot() {
    onCourse.dispatch({ type: "toggle-blind-shot" });
  }

  function toggleAutoZoom() {
    onCourse.dispatch({ type: "toggle-auto-zoom" });
  }

  function adjustRoundTarget(key: keyof RoundTargets, delta: number) {
    onCourse.dispatch({ type: "adjust-target", target: key, delta });
  }

  function openWeatherSheet() {
    setActiveSheet("weather");
    void refreshWeather();
  }

  function selectLie(lie: LieType) {
    onCourse.dispatch({ type: "set-lie", lie });
  }

  function openInsightsSheet() {
    setPuttsDraft(holeInsights.putts);
    setOutcomeGirDraft(holeInsights.gir);
    setOutcomeFairwayDraft(holeInsights.fairway);
    setActiveSheet("insights");
  }

  function openScoreSheet() {
    openInsightsSheet();
    setActiveSheet("score");
  }

  function openTrackSheet() {
    const latestUnsaved = [...onCourseState.shotSamples].reverse().find((sample) => !sample.savedToBag);
    if (latestUnsaved) setTrackedShotReviewId(latestUnsaved.id);
    setActiveSheet("track");
  }

  function openMissSheet() {
    const existing = onCourseState.missDetails.find((detail) => detail.holeNumber === currentHoleNumber);
    if (existing) {
      setMissTargetDraft(existing.target);
      setMissDirectionDraft(existing.direction);
    }
    setActiveSheet("miss");
  }

  async function refreshWeather() {
    const result = await onCourse.refreshWeather();
    if (result.status === "superseded") return;
    if (result.status === "live") {
      return;
    }
  }

  function saveHoleOutcome() {
    // Fail closed when the entered score contradicts recorded stroke evidence:
    // GPS shots, manual shots, and penalties each recorded a stroke.
    const recordedStrokes = countRecordedStrokes(roundLog.events, currentHoleNumber);
    if (score < recordedStrokes || puttsDraft !== null && puttsDraft > score) {
      return;
    }
    const existing = onCourseState.holes.find((hole) => hole.holeNumber === currentHoleNumber);
    const outcome: HoleOutcome = {
      holeNumber: currentHoleNumber,
      par: currentHolePar,
      score,
      putts: puttsDraft,
      gir: outcomeGirDraft,
      fairway: outcomeFairwayDraft,
      missDetails: existing?.missDetails ?? onCourseState.missDetails.filter((miss) => miss.holeNumber === currentHoleNumber),
      updatedAt: new Date().toISOString(),
    };
    onCourse.dispatch({ type: "record-hole-outcome", outcome });
    setActiveSheet(null);
  }

  function saveMissDetail() {
    const detail: MissDetail = {
      id: `miss-${currentHoleNumber}-${Date.now()}`,
      holeNumber: currentHoleNumber,
      target: missTargetDraft,
      direction: missDirectionDraft,
      lie: onCourseState.lie,
      createdAt: new Date().toISOString(),
    };
    onCourse.dispatch({ type: "add-miss-detail", detail });
    setActiveSheet(null);
  }

  function saveTrackedSample() {
    if (!trackedShotReviewId) return;
    const sample = onCourseState.shotSamples.find((candidate) => candidate.id === trackedShotReviewId);
    if (!sample || sample.savedToBag) return;
    onCourse.dispatch({ type: "save-shot-to-bag", sampleId: sample.id });
  }

  function persistActiveRoundSummary(
    course: CourseCatalogEntry | null = selectedCourse,
    holeNumber = course ? selectedHoleNumber : 7,
    status?: ActiveRoundStatus,
  ) {
    const inferredStatus = status ?? (trackingActive ? "tracking" : shotLegCompleted || realShotLegCompleted ? "complete" : latestLockedShot ? "paused" : "ready");
    setActiveRound(createActiveRoundSummary(course, holeNumber, roundSetup.teeBox, inferredStatus));
  }

  function openStartScreen() {
    setActiveSheet(null);
    setStartFlowScreen("home");
    setStartView("start");
  }

  function openFieldView() {
    setStartFlowScreen("home");
    setStartView("field");
  }

  function resumeActiveRound() {
    openFieldView();
    setActiveSheet(null);
  }

  function startNewRoundFromStart() {
    if (prototypeVariant === "c") setSelectedHoleNumber(1);
    setStartFlowScreen("round");
  }

  async function prepareNativeTransition(courseID?: string, hole?: number) {
    if (!nativeTrackingAvailable) return true;
    if (nativeTransitionBusy.current) return false;
    nativeTransitionBusy.current = true;
    try {
      const current = await nativeTracking.snapshot();
      if (current.requested) {
        if (courseID && hole && current.session?.context.roundID === roundRecordIdRef.current && current.session.context.courseID === courseID) {
          await nativeTracking.start({roundID: current.session.context.roundID, courseID, hole});
        } else await nativeTracking.stop();
      }
      setNativeTransitionError("");
      return true;
    } catch {
      setNativeTransitionError("Could not update Smart Tracking. Open Menu → Smart Tracking to stop or retry before changing the round.");
      return false;
    } finally { nativeTransitionBusy.current = false; }
  }

  async function endActiveRound() {
    if (saveCurrentHole() === false) return;
    if (nativeTrackingAvailable && !await prepareNativeTransition()) return;
    const next = savedRoundsRef.current.map((round) => round.id === roundRecordIdRef.current ? { ...round, endedAt: new Date().toISOString() } : round);
    if (roundRecordIdRef.current && !persistRounds(next, true)) return;
    startRequestRef.current += 1;
    roundRecordIdRef.current = null;
    setRoundRecordId(null);
    setTracking(null);
    setActiveRound(null);
    setActiveSheet(null);
    openStartScreen();
  }

  function changePrototypeVariant(variant: PrototypeVariant) {
    setPrototypeVariant(variant);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", variant);
    window.history.replaceState(null, "", url);
  }

  function enterDemoRound() {
    openFieldView();
    resetDemo();
  }

  useEffect(() => {
    if (activeSheet !== null) return;

    const screen = document.querySelector<HTMLElement>('[data-testid="device-screen"]');
    const resetScroll = () => screen?.scrollTo({ top: 0, left: 0 });
    resetScroll();
    const frame = window.requestAnimationFrame(resetScroll);

    return () => window.cancelAnimationFrame(frame);
  }, [activeSheet]);

  useEffect(() => {
    setRealPinOverride(null);
    setRealAimOverride(null);
    setRealAimDraft(null);
    setRealAimDragging(false);
    setPinPlacement("center");
    setSelectedHazardId(null);
    setRealPlanningFocus(Boolean(selectedCourse));
    setMapView({ scale: selectedCourse ? REAL_PLANNING_FOCUS_SCALE : 1, panX: 0, panY: 0 });
  }, [selectedCourse?.id, selectedHoleNumber]);

  useEffect(() => {
    if (!selectedCourse || !currentHoleGeometry) return;
    const greens = currentHoleGeometry.hole.features.filter((feature) => feature.kind === "green");
    if (greens.length === 0) {
      setRealPinOverride(null);
      return;
    }

    const stored = typeof window === "undefined"
      ? undefined
      : loadStoredPinOverride(
        window.localStorage,
        selectedCourse.id,
        selectedHoleNumber,
        currentHoleGeometry.sourceVersion,
      );
    if (!stored || !greens.some((green) => isGeoPositionInsideGeometry(stored, green.geometry))) {
      setRealPinOverride(null);
      return;
    }

    setRealPinOverride(stored);
    setPinPlacement("custom");
  }, [selectedCourse?.id, selectedHoleNumber, currentHoleGeometry]);

  // Mode changes (including Cup Focus) resize the grid during this commit.
  // Synchronize before paint so interactions never capture the previous size.
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.clientWidth !== mapSize.width || map.clientHeight !== mapSize.height) {
      setMapSize({ width: map.clientWidth, height: map.clientHeight });
    }
  });

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const readMapSize = () => {
      const nextSize = { width: map.clientWidth, height: map.clientHeight };
      setMapSize((currentSize) =>
        currentSize.width === nextSize.width && currentSize.height === nextSize.height ? currentSize : nextSize,
      );
    };

    readMapSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(readMapSize);
    observer.observe(map);

    return () => observer.disconnect();
  }, [startView]);

  useEffect(() => {
    // Pin placement handles its own framing. Its saved geographic viewport
    // can require a scale outside ordinary gesture limits after a resize.
    const restoredSize = restoredPinMapSizeRef.current;
    if (pinPlacementActive || pendingPinPlacementRestoreRef.current
      || (restoredSize?.width === mapSize.width && restoredSize.height === mapSize.height)) return;
    restoredPinMapSizeRef.current = null;
    setMapView((current) => clampMapView(current));
  }, [mapSize.width, mapSize.height]);

  useEffect(() => {
    try {
      const storedPlan: StoredAimPlan = {
        version: 1,
        plan: committedAim,
      };
      window.localStorage.setItem(AIM_STORAGE_KEY, JSON.stringify(storedPlan));
    } catch {
      // The interaction still works if storage is unavailable in a private session.
    }
  }, [committedAim]);

  useEffect(() => {
    if ((activeSheet !== "course" && !courseSelection) || catalogLoadState !== "idle") return;
    let cancelled = false;
    setCatalogLoadState("loading");
    Promise.all([
      fetch(COURSE_CATALOG_INDEX_URL).then((response) => (response.ok ? response.json() : Promise.reject(new Error("Course catalog unavailable")))),
      fetch(COURSE_CATALOG_MANIFEST_URL).then((response) => (response.ok ? response.json() : Promise.reject(new Error("Course catalog manifest unavailable")))),
    ])
      .then(([payload, manifestPayload]: [unknown, unknown]) => {
        if (cancelled || !isCourseCatalogIndex(payload) || !isCourseCatalogManifest(manifestPayload)) throw new Error("Invalid course catalog");
        const index = payload as CourseCatalogIndex;
        const manifest = manifestPayload;
        if (index.version !== manifest.release || index.generatedAt !== manifest.generatedAt || index.courseCount !== manifest.courseCount) throw new Error("Catalog and manifest mismatch");
        setCourseCatalog(index);
        setCatalogLoadState("ready");
        const stored = courseSelection;
        if (!stored) return;
        const restoredCourse = [...index.entries, ...PERSONAL_COURSE_ENTRIES].find((entry) => entry.id === stored.courseId);
        if (restoredCourse && isCourseSelectionCurrent(stored, restoredCourse)) {
          setSelectedCourse(restoredCourse);
          setSelectedHoleNumber(stored.holeNumber);
          const session = initialRoundState.session;
          const restoredSessionMatches = session?.courseId === restoredCourse.id && session.holeNumber === stored.holeNumber;
          if (restoredSessionMatches && session) {
            const lastShot = session.lockedShots.at(-1);
            setTracking(session.tracking !== undefined ? session.tracking : lastShot?.number === 1
              ? { number: 2, club: clubTrackingLabel(getClubProfile(DEFAULT_APPROACH_CLUB_ID)), start: lastShot.end }
              : null);
            setCurrentBall(session.tracking?.start ?? lastShot?.end ?? restoredCourse.center ?? TEE);
            setLockedShots(session.lockedShots);
            setManualEntries(session.manualEntries);
            setScore(session.score);
            setRoundLog(initialRoundState.log);
          } else {
            // A persisted course selection without a matching session starts
            // paused. The demo's seeded tee fix must never leak into real
            // course yardage.
            setTracking(null);
            setCurrentBall(restoredCourse.center ?? TEE);
            setLockedShots([]);
            setManualEntries([]);
            setScore(4);
            setRoundLog(createRoundLogForRound(restoredCourse.id, stored.holeNumber));
            onCourse.reset({
              roundId: `${restoredCourse.id}:${stored.holeNumber}`,
              courseId: restoredCourse.id,
              holeNumber: stored.holeNumber,
            });
            setTrackedShotReviewId(null);
          }
          setGpsAccuracyMeters(null);
        } else if (restoredCourse) {
          setCourseSelection(undefined);
          setActiveRound(null);
          try {
            window.localStorage.removeItem(COURSE_SELECTION_STORAGE_KEY);
          } catch {
            // Storage is optional for a private/offline session.
          }
        }
      })
      .catch(() => {
        if (!cancelled) setCatalogLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [activeSheet, catalogRetry, Boolean(courseSelection)]);

  useEffect(() => {
    if (!selectedCourse?.center) {
      setLoadedHoleGeometry(null);
      setLoadedGeometryCourseId(null);
      setGeometryLoadState("idle");
      return;
    }
    let cancelled = false;
    setLoadedHoleGeometry(null);
    setLoadedGeometryCourseId(null);
    setGeometryLoadState("loading");
    (async () => {
      try {
        const bundled = await fetchBundledHoleGeometry(selectedCourse.id, selectedHoleNumber);
        if (cancelled) return;
        if (bundled) {
          setLoadedHoleGeometry(bundled);
          setLoadedGeometryCourseId(selectedCourse.id);
          setGeometryLoadState("ready");
          return;
        }
        // Personal seeds are deliberately fail-closed until their own hole set
        // is captured and confirmed; never substitute nearby live geometry.
        if (PERSONAL_COURSE_IDS.has(selectedCourse.id)) {
          setLoadedHoleGeometry(null);
          setLoadedGeometryCourseId(null);
          setGeometryLoadState("error");
          return;
        }
        if (!GEOMETRY_RUNTIME_POLICY.allowLiveOverpass) {
          setLoadedHoleGeometry(null);
          setLoadedGeometryCourseId(null);
          setGeometryLoadState("error");
          return;
        }
        const live = await fetchOverpassHoleGeometry(selectedCourse.center!, selectedHoleNumber);
        if (cancelled) return;
        setLoadedHoleGeometry(live);
        setLoadedGeometryCourseId(selectedCourse.id);
        setGeometryLoadState("ready");
      } catch {
        if (!cancelled) {
          setLoadedHoleGeometry(null);
          setLoadedGeometryCourseId(null);
          setGeometryLoadState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCourse, selectedHoleNumber]);

  useEffect(() => {
    if (catalogMode !== "nearby" || locationLoadState !== "idle") return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationLoadState("error");
      return;
    }
    setLocationLoadState("loading");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!Number.isFinite(position.coords.latitude) || !Number.isFinite(position.coords.longitude) || position.coords.accuracy > 100) {
          setLocationLoadState("error");
          return;
        }
        setGpsAccuracyMeters(Math.max(0, Math.round(position.coords.accuracy)));
        setNearbyLocation({ lat: position.coords.latitude, lon: position.coords.longitude });
        setLocationLoadState("ready");
      },
      () => setLocationLoadState("error"),
      { enableHighAccuracy: true, maximumAge: 20_000, timeout: 8_000 },
    );
  }, [catalogMode, locationLoadState]);

  function clampMapView(
    view: MapView,
    minScale = pinPlacementActive ? PIN_PLACEMENT_ZOOM_MIN : MAP_ZOOM_MIN,
    maxScale = pinPlacementActive ? PIN_PLACEMENT_ZOOM_MAX : MAP_ZOOM_MAX,
  ): MapView {
    const scale = clamp(view.scale, minScale, maxScale);
    const renderedScale = scale * mapContentScale * autoZoomScale;
    const cosine = Math.abs(Math.cos(courseIsDemo ? 0 : realMapRotationRad));
    const sine = Math.abs(Math.sin(courseIsDemo ? 0 : realMapRotationRad));
    const rotatedWidth = renderedScale * (mapSize.width * cosine + mapSize.height * sine);
    const rotatedHeight = renderedScale * (mapSize.width * sine + mapSize.height * cosine);
    const maxPanX = Math.max(0, (rotatedWidth - mapSize.width) / 2);
    const maxPanY = Math.max(0, (rotatedHeight - mapSize.height) / 2);

    return {
      scale,
      panX: clamp(view.panX, -maxPanX, maxPanX),
      panY: clamp(view.panY, -maxPanY, maxPanY),
    };
  }

  function resetMapView() {
    setMapView({
      scale: !courseIsDemo && realPlanningFocus ? REAL_PLANNING_FOCUS_SCALE : 1,
      panX: 0,
      panY: 0,
    });
  }

  function toggleRealPlanningFocus() {
    if (courseIsDemo) return;
    const nextFocus = !realPlanningFocus;
    setRealPlanningFocus(nextFocus);
    setMapView({ scale: nextFocus ? REAL_PLANNING_FOCUS_SCALE : 1, panX: 0, panY: 0 });
  }

  function openCourseSheet(keepStartFlow = false) {
    if (!keepStartFlow) openFieldView();
    setActiveSheet("course");
    if (catalogLoadState === "error") {
      setCatalogLoadState("idle");
      setCatalogRetry((value) => value + 1);
    }
  }

  async function commitCourseSelection(course: CourseCatalogEntry, requestedHoleNumber = selectedHoleNumber, newRound = false) {
    if (saveCurrentHole() === false) return;
    if (nativeTrackingAvailable && !await prepareNativeTransition(newRound ? undefined : course.id, requestedHoleNumber <= (course.holes ?? 18) ? requestedHoleNumber : 1)) return;
    startRequestRef.current += 1;
    let record = savedRoundsRef.current.find((round) => round.id === roundRecordIdRef.current);
    if (newRound || !record || record.courseId !== course.id || record.endedAt) {
      const now = new Date().toISOString();
      const previous = savedRoundsRef.current.map((round) => round.id === record?.id && !round.endedAt ? { ...round, endedAt: now } : round);
      record = { id: crypto.randomUUID(), courseId: course.id, courseName: course.name, teeBox: roundSetup.teeBox, startedAt: now, endedAt: null, golfers: roundSetup.golfers ?? [], holes: [] };
      if (!persistRounds([...previous, record], true)) return;
      roundRecordIdRef.current = record.id;
      setRoundRecordId(record.id);
    }
    const holeNumber = requestedHoleNumber <= (course.holes ?? 18) ? requestedHoleNumber : 1;
    const savedHole = record.holes.find((hole) => hole.holeNumber === holeNumber);
    const session = savedHole ? parseStoredRoundSession(savedHole.session) : undefined;
    const lastShot = session?.lockedShots.at(-1);
    const selection = storeCourseSelection(
      typeof window === "undefined" ? undefined : window.localStorage,
      course,
      holeNumber,
    );
    setSelectedCourse(course);
    setSelectedHoleNumber(holeNumber);
    setCourseSelection(selection);
    setLockedShots(session?.lockedShots ?? []);
    setTracking(session?.tracking ?? null);
    setSelectedClubId(session?.selectedClubId ?? DEFAULT_APPROACH_CLUB_ID);
    setTeeShotClubId(session?.teeShotClubId ?? DEFAULT_TEE_CLUB_ID);
    setCurrentBall(session?.tracking?.start ?? lastShot?.end ?? course.center ?? TEE);
    setGpsAccuracyMeters(null);
    setActiveRound(createActiveRoundSummary(course, holeNumber, roundSetup.teeBox, "ready"));
    setManualEntries(session?.manualEntries ?? []);
    nextManualEntryIdRef.current = Math.max(0, ...(session?.manualEntries.map((entry) => entry.id) ?? [])) + 1;
    nextRoundEventSequenceRef.current = Math.max(0, ...(savedHole?.log.events.map((event) => event.sequence) ?? [])) + 1;
    setRoundLog(savedHole?.log ?? createRoundLogForRound(course.id, holeNumber));
    setScore(session?.score ?? 4);
    setFriendScores(savedHole?.friendScores ?? {});
    onCourse.reset({ roundId: `${course.id}:${holeNumber}`, courseId: course.id, holeNumber }, savedHole?.onCourse);
    setTrackedShotReviewId(null);
    setPinPlacementActive(false);
    setRealPinOverride(null);
    setRealAimOverride(null);
    setRealAimDraft(null);
    setRealAimDragging(false);
    setPendingCourse(null);
    setActiveSheet(null);
    return holeNumber;
  }

  function changeHeaderHole(holeNumber: number) {
    if (!selectedCourse || holeNumber < 1 || holeNumber > headerMaximumHole) return;
    commitCourseSelection(selectedCourse, holeNumber);
  }

  async function startRound(course: CourseCatalogEntry, requestedHoleNumber = selectedHoleNumber) {
    const holeNumber = await commitCourseSelection(course, requestedHoleNumber, true);
    if (holeNumber === undefined) return;
    const requestId = startRequestRef.current;
    openFieldView();

    const startFix = await readLiveFix();
    if (requestId !== startRequestRef.current) return;
    if (!startFix || startFix.accuracy > MAX_FIX_ACCURACY_METERS) {
      setGpsAccuracyMeters(null);
      setTracking(null);
      setActiveRound(createActiveRoundSummary(course, holeNumber, roundSetup.teeBox, "paused"));
      return;
    }

    setCurrentBall(startFix.point);
    setGpsAccuracyMeters(Math.max(0, Math.round(startFix.accuracy)));
    setLiveTrackingFix(null);
    setTracking({ number: 1, club: clubTrackingLabel(teeShotProfile), start: startFix.point });
    setActiveRound(createActiveRoundSummary(course, holeNumber, roundSetup.teeBox, "tracking"));
  }

  async function startRoundFromStart() {
    if (!selectedCourse) return;
    await startRound(selectedCourse, prototypeVariant === "c" ? 1 : selectedHoleNumber);
  }

  async function resetSelectedCourse() {
    if (nativeTrackingAvailable && !await prepareNativeTransition()) return;
    setSelectedCourse(null);
    setCourseSelection(undefined);
    setPendingCourse(null);
    setSelectedHoleNumber(7);
    setLoadedHoleGeometry(null);
    setLoadedGeometryCourseId(null);
    setGeometryLoadState("idle");
    setLockedShots([]);
    setTeeShotClubId(DEFAULT_TEE_CLUB_ID);
    setTracking({ number: 1, club: clubTrackingLabel(getClubProfile(DEFAULT_TEE_CLUB_ID)), start: TEE });
    setCurrentBall(TEE);
    setGpsAccuracyMeters(4);
    setPinPlacement("center");
    setPinPoint(HOLE_7_GEOMETRY.pin);
    setRealPinOverride(null);
    setRealAimOverride(null);
    setRealAimDraft(null);
    setRealAimDragging(false);
    setManualEntries([]);
    nextManualEntryIdRef.current = 1;
    nextRoundEventSequenceRef.current = 1;
    setRoundLog(createRoundLogForRound(DEMO_OPENROUND_COURSE.id, 7));
    setScore(4);
    onCourse.reset({ roundId: `${DEMO_OPENROUND_COURSE.id}:7`, courseId: DEMO_OPENROUND_COURSE.id, holeNumber: 7 });
    setTrackedShotReviewId(null);
    setActiveRound(createActiveRoundSummary(null, 7, roundSetup.teeBox, "ready"));
    try {
      window.localStorage.removeItem("openround:course-selection:v1");
    } catch {
      // Storage is optional for a private/offline session.
    }
  }

  function mapPointFromClient(clientX: number, clientY: number): MapPoint {
    const map = mapRef.current;
    if (!map) return pinMapPoint;
    const bounds = map.getBoundingClientRect();
    const visualX = clientX - bounds.left;
    const visualY = clientY - bounds.top;
    const renderedScale = mapView.scale * mapContentScale * autoZoomScale;
    const mapX = (visualX - mapSize.width / 2 - mapView.panX) / renderedScale + mapSize.width / 2;
    const mapY = (visualY - mapSize.height / 2 - mapView.panY) / renderedScale + mapSize.height / 2;

    return {
      x: clamp(mapX / mapSize.width, GREEN_PIN_BOUNDS.minX, GREEN_PIN_BOUNDS.maxX),
      y: clamp(mapY / mapSize.height, GREEN_PIN_BOUNDS.minY, GREEN_PIN_BOUNDS.maxY),
    };
  }

  function geoPointFromClient(clientX: number, clientY: number): GeoPoint | undefined {
    if (!selectedCourse?.center) return undefined;
    const map = mapRef.current;
    if (!map) return undefined;
    const bounds = map.getBoundingClientRect();
    const visualX = clientX - bounds.left;
    const visualY = clientY - bounds.top;
    const screenX = visualX - mapSize.width / 2 - mapView.panX;
    const screenY = visualY - mapSize.height / 2 - mapView.panY;
    // The real map is rotated as a single layer. Undo that rotation before
    // converting the pointer back into the unrotated Web Mercator plane.
    const renderedScale = mapView.scale * mapContentScale * autoZoomScale;
    const mapXOffset = (Math.cos(realMapRotationRad) * screenX + Math.sin(realMapRotationRad) * screenY) / renderedScale;
    const mapYOffset = (-Math.sin(realMapRotationRad) * screenX + Math.cos(realMapRotationRad) * screenY) / renderedScale;
    const mapX = mapXOffset + mapSize.width / 2;
    const mapY = mapYOffset + mapSize.height / 2;
    const centerWorld = webMercatorWorldPixel(activeMapCenter, MAP_TILE_ZOOM, MAP_TILE_SIZE_PX);
    return webMercatorGeoPoint(
      {
        x: centerWorld.x + mapX - mapSize.width / 2,
        y: centerWorld.y + mapY - mapSize.height / 2,
      },
      MAP_TILE_ZOOM,
      MAP_TILE_SIZE_PX,
    );
  }

  function realAimPositionFromClient(clientX: number, clientY: number): GeoJsonPosition | undefined {
    const map = mapRef.current;
    if (!map) return realAimPosition;
    const bounds = map.getBoundingClientRect();
    const clampedX = clamp(clientX, bounds.left, bounds.right);
    const clampedY = clamp(clientY, bounds.top, bounds.bottom);
    const next = geoPointFromClient(clampedX, clampedY);
    return next ? [next.lon, next.lat] : realAimPosition;
  }

  function handleRealAimPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (courseIsDemo || pinPlacementActive || ruleOf12AutomaticActive || !realAimPosition || !aimEditable || event.button !== 0 || realAimPointerRef.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    realAimPointerRef.current = event.pointerId;
    setRealAimDraft(realAimPosition);
    setRealAimDragging(true);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is best-effort when a browser cancels the contact.
    }
  }

  function handleRealAimPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (realAimPointerRef.current !== event.pointerId || !realAimPosition) return;
    event.preventDefault();
    event.stopPropagation();
    const next = realAimPositionFromClient(event.clientX, event.clientY);
    if (next) setRealAimDraft(next);
  }

  function clearRealAimGesture() {
    realAimPointerRef.current = null;
    setRealAimDraft(null);
    setRealAimDragging(false);
  }

  function handleRealAimPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (realAimPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const next = realAimPositionFromClient(event.clientX, event.clientY);
    if (next) {
      setRealAimOverride(next);
      const nextAimYards = realReferenceOrigin
        ? Math.round(geoDistanceYards(realReferenceOrigin, next))
        : 0;
      setAimAnnouncement(`Custom aim set, ${nextAimYards} yards to target.`);
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    clearRealAimGesture();
  }

  function handleRealAimPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    if (realAimPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    clearRealAimGesture();
  }

  function handleRealAimLostPointerCapture() {
    if (realAimPointerRef.current !== null) clearRealAimGesture();
  }

  function resetRealAimToCaddyPath() {
    clearRealAimGesture();
    setRealAimOverride(null);
    setAimAnnouncement("Caddy aim restored for this hole.");
  }

  function resetRealPinToProvider() {
    if (!selectedCourse || !currentHoleGeometry) return;
    removeStoredPinOverride(
      typeof window === "undefined" ? undefined : window.localStorage,
      selectedCourse.id,
      selectedHoleNumber,
      currentHoleGeometry.sourceVersion,
    );
    setRealPinOverride(null);
    setPinPlacement("center");
    setPinPlacementActive(false);
    resetMapView();
  }

  function focusMapOnPin(point: MapPoint, constrain = true): MapView {
    const scale = PIN_PLACEMENT_ZOOM_INITIAL;
    const renderedScale = scale * mapContentScale * autoZoomScale;
    const centerX = mapSize.width / 2;
    const centerY = mapSize.height / 2;
    const pinX = point.x * mapSize.width;
    const pinY = point.y * mapSize.height;
    const anchorX = centerX;
    const anchorY = mapSize.height * 0.5;

    const focusedView = {
      scale,
      panX: anchorX - centerX - (pinX - centerX) * renderedScale,
      panY: anchorY - centerY - (pinY - centerY) * renderedScale,
    };
    return constrain ? clampMapView(focusedView, PIN_PLACEMENT_ZOOM_MIN, PIN_PLACEMENT_ZOOM_MAX) : focusedView;
  }

  function focusMapOnRealPin(position: GeoJsonPosition): MapView {
    const projected = geoMapPair({ lat: position[1], lon: position[0] }, activeMapCenter, mapSize);
    const offsetX = (projected.x / 100) * mapSize.width - mapSize.width / 2;
    const offsetY = (projected.y / 100) * mapSize.height - mapSize.height / 2;
    const rotatedX = Math.cos(realMapRotationRad) * offsetX - Math.sin(realMapRotationRad) * offsetY;
    const rotatedY = Math.sin(realMapRotationRad) * offsetX + Math.cos(realMapRotationRad) * offsetY;
    return focusMapOnPin({
      x: 0.5 + rotatedX / mapSize.width,
      y: 0.5 + rotatedY / mapSize.height,
    }, false);
  }

  function startPinPlacement() {
    if (shotLegCompleted) {
      return;
    }
    setSelectedHazardId(null);
    if (courseIsDemo) {
      openCourseSheet();
      return;
    }
    if (!currentHoleGeometry || !realGreenFeature || !realGreenCenter) {
      return;
    }
    onCourse.dispatch({ type: "set-map-layer", layer: "satellite" });
    restoredPinMapSizeRef.current = null;
    pinPlacementReturnViewRef.current = {
      visualCenter: realViewportCenter(mapView),
      effectiveScale: mapView.scale * mapContentScale * autoZoomScale,
    };
    setActiveSheet(null);
    setPinPlacementActive(true);
    setMapView(focusMapOnRealPin(realPinPosition ?? realGreenCenter));
  }

  function centerMapViewOnPoint(point: MapPoint): MapView {
    const offsetX = (point.x - 0.5) * mapSize.width;
    const offsetY = (point.y - 0.5) * mapSize.height;
    const cosine = Math.cos(courseIsDemo ? 0 : realMapRotationRad);
    const sine = Math.sin(courseIsDemo ? 0 : realMapRotationRad);
    const renderedScale = mapView.scale * mapContentScale * autoZoomScale;
    return clampMapView({
      scale: mapView.scale,
      panX: -(cosine * offsetX - sine * offsetY) * renderedScale,
      panY: -(sine * offsetX + cosine * offsetY) * renderedScale,
    });
  }

  function closePinPlacement() {
    if (cameraPinLockActive) closeCameraPinLock();
    const returnView = pinPlacementReturnViewRef.current;
    pinPlacementReturnViewRef.current = null;
    setPinPlacementActive(false);
    if (returnView) {
      pendingPinPlacementRestoreRef.current = returnView;
    }
    else resetMapView();
  }

  function closeCameraPinLock() {
    cameraPinStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraPinStreamRef.current = null;
    setCameraPinLockActive(false);
    setCameraPinMarks([]);
  }

  async function openCameraPinLock() {
    setCameraPinUnavailable(false);
    setCameraPinMarks([]);
    setCameraPinLockActive(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraPinUnavailable(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      cameraPinStreamRef.current = stream;
      if (cameraPinVideoRef.current) cameraPinVideoRef.current.srcObject = stream;
    } catch {
      setCameraPinUnavailable(true);
    }
  }

  function markCameraPin(event: ReactMouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const next = Math.round(event.clientY - bounds.top);
    setCameraPinMarks((marks) => marks.length === 2 ? [next] : [...marks, next]);
  }

  function lockCameraPinDistance() {
    const preview = cameraPinVideoRef.current?.parentElement;
    const frameHeightPixels = preview?.getBoundingClientRect().height ?? 0;
    const estimate = estimateCameraPinDistance({
      observedFlagPixels: Math.abs((cameraPinMarks[1] ?? 0) - (cameraPinMarks[0] ?? 0)),
      frameHeightPixels,
    });
    if (!estimate) return;
    setCameraPinEstimate(estimate);
    closeCameraPinLock();
    closePinPlacement();
  }

  function cancelPinPlacement() {
    closePinPlacement();
  }

  function confirmPinPlacement() {
    if (!pinPlacementCandidateValid) {
      return;
    }
    if (!courseIsDemo && pinPlacementGeoCandidate) {
      if (selectedCourse && currentHoleGeometry) {
        storePinOverride(
          typeof window === "undefined" ? undefined : window.localStorage,
          {
            courseId: selectedCourse.id,
            holeNumber: selectedHoleNumber,
            sourceVersion: currentHoleGeometry.sourceVersion,
            position: pinPlacementGeoCandidate,
          },
        );
      }
      setRealPinOverride(pinPlacementGeoCandidate);
    } else {
      setPinPoint(coursePointFromMapPoint(pinPlacementMapPoint));
    }
    setPinPlacement("custom");
    closePinPlacement();
  }

  function adjustPinPlacementZoom(delta: number) {
    setMapView((view) => clampMapView({ ...view, scale: view.scale + delta }));
  }

  function placeBallAtAim() {
    if (!DEMO_BALL_PLACEMENT_AVAILABLE || shotLegCompleted || (!courseIsDemo && (!selectedCourse?.center || !currentHoleGeometry || !realReferenceOrigin))) return;
    const simulatedTracking = tracking ?? {
      number: (latestLockedShot?.number ?? 0) + 1,
      club: clubTrackingLabel(latestLockedShot ? selectedProfile : teeShotProfile),
      start: courseIsDemo
        ? latestLockedShot?.end ?? TEE
        : { lon: realReferenceOrigin![0], lat: realReferenceOrigin![1] },
    };
    if (!courseIsDemo && !manualMapCenterRef.current) manualMapCenterRef.current = activeMapCenter;
    setPinPlacementActive(false);
    setSelectedHazardId(null);
    setActiveSheet(null);
    if (courseIsDemo) {
      demoBallUndoRef.current = { mapView, committedAim, realAimOverride, selectedClubId, teeShotClubId, clubPickerPreviewId };
      lockDemoShotAtPoint(geoPointFromDemoCoursePoint(effectiveAimCourse), effectiveAimPoint, simulatedTracking);
      return;
    }
    if (!realAimPosition || !realAimMapPoint) return;
    demoBallUndoRef.current = { mapView, committedAim, realAimOverride, selectedClubId, teeShotClubId, clubPickerPreviewId };
    lockDemoShotAtPoint(
      { lat: realAimPosition[1], lon: realAimPosition[0] },
      { x: realAimMapPoint.x / 100, y: realAimMapPoint.y / 100 },
      simulatedTracking,
    );
  }

  function undoLastDemoBall() {
    const shot = lockedShots.at(-1);
    if (!shot || shot.evidence !== "demo_manual") return;

    const previous = demoBallUndoRef.current;
    setLockedShots((shots) => shots.slice(0, -1));
    setCurrentBall(shot.start);
    setTracking({ number: shot.number, club: shot.club, start: shot.start });
    setRealAimDraft(null);
    setDraftAim(null);
    if (previous) {
      setMapView(previous.mapView);
      setCommittedAim(previous.committedAim);
      setRealAimOverride(previous.realAimOverride);
      setSelectedClubId(previous.selectedClubId);
      setTeeShotClubId(previous.teeShotClubId);
      setClubPickerPreviewId(previous.clubPickerPreviewId);
    } else {
      if (shot.plannedAim) setCommittedAim(shot.plannedAim);
      setRealAimOverride(shot.realPlannedAim?.source === "manual" ? shot.realPlannedAim.point : null);
      if (shot.clubProfileId) {
        if (shot.number === 1) setTeeShotClubId(shot.clubProfileId);
        else setSelectedClubId(shot.clubProfileId);
        setClubPickerPreviewId(shot.clubProfileId);
      }
      resetMapView();
    }
    demoBallUndoRef.current = null;
  }

  function handleMapClick(event: ReactMouseEvent<HTMLElement>) {
    if (Date.now() < suppressMapClickUntilRef.current || !mapPointerIsBackground(event)) return;
    if (pinPlacementActive) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    setSelectedHazardId(null);
  }

  function aimPointFromClient(clientX: number, clientY: number, start: AimPointerStart) {
    const map = mapRef.current;
    if (!map) return mapPointFromCoursePoint(committedAim.point);
    const bounds = map.getBoundingClientRect();
    const visualX = clientX - start.grabOffsetX - bounds.left;
    const visualY = clientY - start.grabOffsetY - bounds.top;
    const mapX = (visualX - mapSize.width / 2 - mapView.panX) / mapView.scale + mapSize.width / 2;
    const mapY = (visualY - mapSize.height / 2 - mapView.panY) / mapView.scale + mapSize.height / 2;
    const point = {
      x: mapX / mapSize.width,
      y: mapY / mapSize.height,
    };

    return mapPointFromCoursePoint(clampCoursePoint(coursePointFromMapPoint(point)));
  }

  function mapPointerIsBackground(event: { target: EventTarget | null }) {
    const target = event.target instanceof Element ? event.target : null;
    // Pin placement intentionally accepts a tap on the aim reticle when it
    // overlaps the green. The reticle is still rendered above the geometry,
    // but it must not swallow the placement tap or leave the previous warning
    // visible. Aim gestures themselves are disabled while placement is active.
    if (pinPlacementActive && target?.closest(".aim-point")) return true;
    return !target?.closest("button,[data-map-ignore='true']");
  }

  function handleMapPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (!mapPointerIsBackground(event)) return;
    if (pinPlacementActive && event.isPrimary && (event.pointerType !== "mouse" || event.button === 0)) {
      mapPanGestureRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        view: mapView,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers may not expose capture; the stored gesture remains safe.
      }
    }
    if (event.pointerType !== "touch") return;
    mapPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (mapPointersRef.current.size !== 2) return;

    const points = [...mapPointersRef.current.values()];
    const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    if (distance < MAP_GESTURE_MIN_DISTANCE_PX) return;
    pinchGestureRef.current = {
      distance,
      midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
      view: mapView,
    };
    mapPanGestureRef.current = null;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events and a pointer released between down/move may not have
      // an active capture target. The gesture state remains safe without it.
    }
  }

  function handleMapPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const pan = mapPanGestureRef.current;
    if (pinPlacementActive && pan?.pointerId === event.pointerId && !pinchGestureRef.current) {
      const deltaX = event.clientX - pan.clientX;
      const deltaY = event.clientY - pan.clientY;
      if (Math.hypot(deltaX, deltaY) > 2) suppressMapClickUntilRef.current = Date.now() + 350;
      setMapView(clampMapView({ ...pan.view, panX: pan.view.panX + deltaX, panY: pan.view.panY + deltaY }));
      event.preventDefault();
    }
    if (!mapPointersRef.current.has(event.pointerId)) return;
    mapPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchGestureRef.current;
    if (!pinch || mapPointersRef.current.size < 2) return;
    suppressMapClickUntilRef.current = Date.now() + 350;

    const points = [...mapPointersRef.current.values()];
    const distance = Math.max(MAP_GESTURE_MIN_DISTANCE_PX, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
    const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
    const nextView = clampMapView({
      scale: pinch.view.scale * (distance / pinch.distance),
      panX: pinch.view.panX + midpoint.x - pinch.midpoint.x,
      panY: pinch.view.panY + midpoint.y - pinch.midpoint.y,
    });
    event.preventDefault();
    setMapView(nextView);
  }

  function handleMapPointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (mapPanGestureRef.current?.pointerId === event.pointerId) mapPanGestureRef.current = null;
    if (!mapPointersRef.current.has(event.pointerId)) return;
    if (pinchGestureRef.current) suppressMapClickUntilRef.current = Date.now() + 350;
    mapPointersRef.current.delete(event.pointerId);
    if (mapPointersRef.current.size < 2) pinchGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleMapPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    if (mapPanGestureRef.current?.pointerId === event.pointerId) mapPanGestureRef.current = null;
    if (!mapPointersRef.current.has(event.pointerId)) return;
    suppressMapClickUntilRef.current = Date.now() + 350;
    mapPointersRef.current.delete(event.pointerId);
    pinchGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function announceAim(point: MapPoint) {
    const metrics = getAimMetrics(coursePointFromMapPoint(point), pinPoint, demoBallCoursePoint);
    setAimAnnouncement(`Aim set. ${metrics.playsLikeYards} yards. ${formatAimLabel(metrics.signedOffsetYards)}.`);
  }

  function cancelAimGesture() {
    aimPointerStartRef.current = null;
    setDraftAim(null);
    setAimPressed(false);
    setAimDragging(false);
  }

  function handleAimPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!aimEditable) return;
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const targetBounds = event.currentTarget.getBoundingClientRect();

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort when a browser cancels the contact.
    }
    aimPointerStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      grabOffsetX: event.clientX - (targetBounds.left + targetBounds.width / 2),
      grabOffsetY: event.clientY - (targetBounds.top + targetBounds.height / 2),
      dragging: false,
    };
    setAimPressed(true);
  }

  function handleAimPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = aimPointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

    if (!start.dragging) {
      const travel = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
      if (travel < AIM_DRAG_SLOP_PX) return;
      start.dragging = true;
      setAimDragging(true);
    }

    setDraftAim(aimPointFromClient(event.clientX, event.clientY, start));
  }

  function handleAimPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = aimPointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

    const finalAim = start.dragging
      ? aimPointFromClient(event.clientX, event.clientY, start)
      : mapPointFromCoursePoint(committedAim.point);
    aimPointerStartRef.current = null;
    setDraftAim(null);
    setAimPressed(false);
    setAimDragging(false);
    if (start.dragging) {
      setCommittedAim(aimPlanFromMapPoint(finalAim, "manual"));
      announceAim(finalAim);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleAimPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = aimPointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    cancelAimGesture();
  }

  function handleAimLostPointerCapture(event: ReactPointerEvent<HTMLButtonElement>) {
    if (aimPointerStartRef.current?.pointerId === event.pointerId) cancelAimGesture();
  }

  function handleAimKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!aimEditable) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const stepYards = event.shiftKey ? 5 : 1;
    const nextAim = { ...committedAim.point };

    if (event.key === "ArrowLeft") nextAim.eastYards -= stepYards;
    if (event.key === "ArrowRight") nextAim.eastYards += stepYards;
    if (event.key === "ArrowUp") nextAim.forwardYards += stepYards;
    if (event.key === "ArrowDown") nextAim.forwardYards -= stepYards;

    const nextPlan = aimPlanFromCoursePoint(nextAim, "manual");
    setCommittedAim(nextPlan);
    announceAim(mapPointFromCoursePoint(nextPlan.point));
  }

  function openEquipmentSheet() {
    setEquipmentEditorId(null);
    setEquipmentDraft(null);
    setEquipmentError("");
    setEquipmentStatusFilter("active");
    setActiveSheet("equipment");
  }

  function openClubSelector() {
    setClubPickerPreviewId(clubSelectorCaddyId);
    setActiveSheet("club");
  }

  function openFieldLogSheet() {
    setFieldLogError("");
    setFieldLogGpsCaptureState("idle");
    resetFieldLogGpsPair();
    const latestFixAgeSeconds = lastGpsFixCapturedAt === null
      ? ""
      : String(fixAgeSecondsForTimestamp(lastGpsFixCapturedAt) ?? "");
    setFieldLogDraft((current) => ({
      ...emptyFieldLogDraft(mapProvider),
      device: current.device.trim() || "Marcus iPhone",
      provider: current.provider === "google" && !GOOGLE_MAPS_API_KEY ? mapProvider : current.provider ?? mapProvider,
      fixAgeSeconds: latestFixAgeSeconds,
    }));
    setActiveSheet("field-log");
  }

  function resetFieldLogGpsPair(clearDraft = false) {
    fieldLogGpsPairStartRef.current = null;
    setFieldLogGpsPair(null);
    setFieldLogGpsPairState("idle");
    if (clearDraft) {
      setFieldLogDraft((current) => ({
        ...current,
        recordedYards: "",
        accuracyMeters: "",
        fixAgeSeconds: "",
      }));
    }
  }

  function fieldLogFixAge(fix: LiveGpsFix) {
    const age = fixAgeSecondsForTimestamp(fix.capturedAt);
    return age !== null && age <= FIELD_LOG_MAX_FIX_AGE_SECONDS ? age : null;
  }

  async function captureFieldLogGpsPair() {
    if (fieldLogGpsPairState === "capturing-start" || fieldLogGpsPairState === "capturing-end") return;
    if (fieldLogGpsPairState === "ready" || fieldLogGpsPair) {
      resetFieldLogGpsPair(true);
      setFieldLogError("");
      return;
    }

    const start = fieldLogGpsPairStartRef.current;
    setFieldLogError("");
    setFieldLogGpsPairState(start ? "capturing-end" : "capturing-start");
    const fix = await readLiveFix();
    const age = fix ? fieldLogFixAge(fix) : null;
    if (!fix || fix.accuracy > MAX_FIX_ACCURACY_METERS || age === null) {
      setFieldLogGpsPairState(start ? "waiting-end" : "idle");
      setFieldLogError("Fresh GPS fix required. Accuracy must be 12 m or better and fix age no more than 20 seconds.");
      return;
    }

    if (!start) {
      fieldLogGpsPairStartRef.current = { fix, ageSeconds: age };
      setFieldLogGpsPairState("waiting-end");
      return;
    }

    const recordedYards = Math.round(distanceBetweenYards(start.fix.point, fix.point));
    if (recordedYards < 5) {
      setFieldLogGpsPairState("waiting-end");
      setFieldLogError("GPS movement is under 5 yards. Walk farther before capturing the end fix.");
      return;
    }

    const pair = { start: start.fix, startAgeSeconds: start.ageSeconds, end: fix, endAgeSeconds: age };
    setFieldLogGpsPair(pair);
    setFieldLogGpsPairState("ready");
    setFieldLogDraft((current) => ({
      ...current,
      recordedYards: String(recordedYards),
      accuracyMeters: String(Math.round(Math.max(start.fix.accuracy, fix.accuracy))),
      fixAgeSeconds: String(age),
    }));
  }

  async function captureFieldLogFreshFix() {
    if (fieldLogGpsCaptureState === "capturing") return;
    if (fieldLogGpsPairState !== "idle" || fieldLogGpsPair) resetFieldLogGpsPair(true);
    setFieldLogError("");
    setFieldLogGpsCaptureState("capturing");
    const fix = await readLiveFix();
    setFieldLogGpsCaptureState("idle");
    if (!fix || fix.accuracy > MAX_FIX_ACCURACY_METERS) {
      setFieldLogError("Fresh GPS fix required. Accuracy must be 12 m or better.");
      return;
    }
    const age = fixAgeSecondsForTimestamp(fix.capturedAt);
    if (age === null || age > FIELD_LOG_MAX_FIX_AGE_SECONDS) {
      setFieldLogError("Fresh GPS fix required. Capture again within 20 seconds.");
      return;
    }
    setFieldLogDraft((current) => ({
      ...current,
      accuracyMeters: String(Math.round(fix.accuracy)),
      fixAgeSeconds: String(age),
    }));
  }

  function saveFieldLogRun() {
    const device = fieldLogDraft.device.trim();
    if (!device) {
      setFieldLogError("Add a device label so the evaluator can identify this phone.");
      return;
    }

    const gpsValues = [fieldLogDraft.expectedYards, fieldLogDraft.recordedYards, fieldLogDraft.accuracyMeters, fieldLogDraft.fixAgeSeconds];
    const hasGpsInput = gpsValues.some((value) => value.trim().length > 0);
    let gps: FieldLogRun["gps"] = [];
    if (hasGpsInput) {
      if (gpsValues.some((value) => value.trim().length === 0)) {
        setFieldLogError("Enter expected yards, recorded yards, GPS accuracy, and fix age together, or leave all four blank.");
        return;
      }
      const expectedYards = parseFieldLogMeasurement(fieldLogDraft.expectedYards, 0.1, 500);
      const recordedYards = parseFieldLogMeasurement(fieldLogDraft.recordedYards, 0, 500);
      const accuracyMeters = parseFieldLogMeasurement(fieldLogDraft.accuracyMeters, 0, 100);
      const fixAgeSeconds = parseFieldLogMeasurement(fieldLogDraft.fixAgeSeconds, 0, FIELD_LOG_MAX_RECORDED_FIX_AGE_SECONDS);
      if (expectedYards === undefined || recordedYards === undefined || accuracyMeters === undefined || fixAgeSeconds === undefined) {
        setFieldLogError("GPS measurements are outside the allowed ranges (0–500 yd, 0–100 m accuracy, 0–300 s fix age).");
        return;
      }
      if (expectedYards === null || recordedYards === null || accuracyMeters === null || fixAgeSeconds === null) {
        setFieldLogError("Enter expected yards, recorded yards, GPS accuracy, and fix age together, or leave all four blank.");
        return;
      }
      gps = [{
        expectedYards,
        recordedYards,
        accuracyMeters,
        fixAgeSeconds,
        ...(fieldLogGpsPair ? {
          source: "phone_pair" as const,
          start: { lat: fieldLogGpsPair.start.point.lat, lon: fieldLogGpsPair.start.point.lon },
          end: { lat: fieldLogGpsPair.end.point.lat, lon: fieldLogGpsPair.end.point.lon },
          startFixAgeSeconds: fieldLogGpsPair.startAgeSeconds,
          endFixAgeSeconds: fieldLogGpsPair.endAgeSeconds,
        } : {}),
      }];
    }

    const alignmentValues = [fieldLogDraft.lateralYards, fieldLogDraft.longitudinalYards];
    const hasAlignmentInput = alignmentValues.some((value) => value.trim().length > 0);
    let alignment: FieldLogRun["alignment"];
    if (hasAlignmentInput) {
      if (fieldLogGeometryGrade === "C" || fieldLogGeometryGrade === "D") {
        setFieldLogError("Alignment evidence is disabled for grade C/D geometry. Keep those measurements blank.");
        return;
      }
      if (alignmentValues.some((value) => value.trim().length === 0)) {
        setFieldLogError("Enter lateral and longitudinal alignment together, or leave both blank.");
        return;
      }
      const lateralYards = parseFieldLogMeasurement(fieldLogDraft.lateralYards, 0, 200);
      const longitudinalYards = parseFieldLogMeasurement(fieldLogDraft.longitudinalYards, 0, 200);
      if (lateralYards === undefined || longitudinalYards === undefined || lateralYards === null || longitudinalYards === null) {
        setFieldLogError("Alignment measurements must be between 0 and 200 yards.");
        return;
      }
      alignment = { lateralYards, longitudinalYards };
    }

    const idBase = `field-run-${Date.now()}`;
    let id = `${idBase}-1`;
    let suffix = 1;
    while (fieldLog.runs.some((run) => run.id === id)) {
      suffix += 1;
      id = `${idBase}-${suffix}`;
    }
    const run: FieldLogRun = {
      id,
      device,
      courseId: selectedCourse?.id ?? DEMO_OPENROUND_COURSE.id,
      hole: courseDisplayHole,
      teeBox: roundSetup.teeBox,
      geometryGrade: fieldLogGeometryGrade,
      geometryVersion: fieldLogGeometryVersion,
      gps,
      ...(alignment ? { alignment } : {}),
      imagery: {
        provider: fieldLogDraft.provider === "google" && !GOOGLE_MAPS_API_KEY ? "usgs" : fieldLogDraft.provider,
        attributionVisible: fieldLogDraft.attributionVisible,
        overlayAligned: fieldLogDraft.alignmentAtOneX && fieldLogDraft.alignmentAtTwoX,
        alignmentZooms: {
          oneX: fieldLogDraft.alignmentAtOneX,
          twoX: fieldLogDraft.alignmentAtTwoX,
        },
      },
      ...(fieldLogDraft.note.trim() ? { note: fieldLogDraft.note.trim().slice(0, 500) } : {}),
      createdAt: new Date().toISOString(),
    };

    try {
      setFieldLog(appendFieldLogRun(fieldLog, run));
      setFieldLogError("");
      setFieldLogDraft((current) => ({
        ...emptyFieldLogDraft(current.provider),
        device: current.device,
        provider: current.provider,
      }));
      resetFieldLogGpsPair();
    } catch (error) {
      setFieldLogError(error instanceof Error ? error.message : "Field log could not be saved.");
    }
  }

  function removeFieldLogEntry(id: string) {
    setFieldLog((current) => removeFieldLogRun(current, id));
  }

  function clearFieldLogEntries() {
    if (typeof window !== "undefined" && !window.confirm("Remove every field-log run from this phone?")) return;
    setFieldLog(clearFieldLog());
    setFieldLogError("");
  }

  async function exportFieldLog() {
    const payload = JSON.stringify(fieldLog, null, 2);
    const file = new File([payload], "openround-field-log.json", { type: "application/json" });

    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: "OpenRound field log", text: "OpenRound on-course field evidence", files: [file] });
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }

    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "openround-field-log.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function startEquipmentEdit(club: EquipmentClub) {
    setEquipmentEditorId(club.id);
    setEquipmentDraft(equipmentFormFromClub(club));
    setEquipmentError("");
  }

  function startEquipmentAdd() {
    if (equipment.length >= EQUIPMENT_LIMIT) {
      setEquipmentError(`Your bag is full at ${EQUIPMENT_LIMIT} clubs. Delete one before adding another.`);
      return;
    }
    setEquipmentEditorId("new");
    setEquipmentDraft(emptyEquipmentForm());
    setEquipmentError("");
  }

  function cancelEquipmentEdit() {
    setEquipmentEditorId(null);
    setEquipmentDraft(null);
    setEquipmentError("");
  }

  function changeEquipmentStatus(club: EquipmentClub, status: EquipmentStatus) {
    setEquipment((current) => updateEquipment(current, club.id, { status }));
  }

  function saveEquipmentDraft() {
    if (!equipmentDraft || !equipmentEditorId) return;
    const parsed = equipmentInputFromForm(equipmentDraft);
    if (!parsed.input) {
      setEquipmentError(parsed.error ?? "Check the club details and try again.");
      return;
    }

    if (equipmentEditorId === "new") {
      setEquipment((current) => addEquipment(current, parsed.input!));
    } else {
      setEquipment((current) => updateEquipment(current, equipmentEditorId, parsed.input!));
    }
    cancelEquipmentEdit();
  }

  function deleteEquipmentClub(club: EquipmentClub) {
    setEquipment((current) => removeEquipment(current, club.id));
    if (equipmentEditorId === club.id) cancelEquipmentEdit();
  }

  function resetEquipmentBag() {
    setEquipment(createDefaultEquipment());
    setEquipmentStatusFilter("active");
    cancelEquipmentEdit();
  }

  function selectApproachClub(id: ApproachClubId) {
    const profile = profileForClubId(id);
    if (teeShotPending) {
      setTeeShotClubId(id);
      setTracking((openLeg) =>
        openLeg?.number === 1 ? { ...openLeg, club: clubTrackingLabel(profile) } : openLeg,
      );
      cancelAimGesture();
      setActiveSheet(null);
      setAimAnnouncement(
        `${profile.label} selected for the tee shot. ${profile.carryYards > 0 ? `${profile.carryYards} carry, ${profile.totalYards} total.` : "Carry and total are unavailable."}`,
      );
      return;
    }
    const nextCaddyPlan = getCaddyPlan(profile, getShotBias(profile.offsets), caddyAggressiveness);
    const adoptsCaddyPlan = committedAim.source === "caddy_path";

    setSelectedClubId(id);
    if (adoptsCaddyPlan) setCommittedAim(nextCaddyPlan);
    setTracking((openLeg) =>
      openLeg && openLeg.number > 1 ? { ...openLeg, club: clubTrackingLabel(profile) } : openLeg,
    );
    cancelAimGesture();
    setActiveSheet(null);

    const announcedPlan = adoptsCaddyPlan ? nextCaddyPlan : committedAim;
    const metrics = getAimMetrics(announcedPlan.point, pinPoint);
    setAimAnnouncement(
      `${profile.label} selected. ${metrics.playsLikeYards} yards. ${formatAimLabel(metrics.signedOffsetYards)}.`,
    );
  }

  function selectCaddyAggressiveness(nextAggressiveness: CaddyAggressiveness) {
    setCaddyAggressiveness(nextAggressiveness);
    const nextCaddyPlan = getCaddyPlan(selectedProfile, selectedBias, nextAggressiveness);
    if (courseIsDemo && committedAim.source === "caddy_path") setCommittedAim(nextCaddyPlan);
    if (!courseIsDemo && realReferenceOrigin) {
      const nextAim = realCaddyAimPosition(nextAggressiveness);
      if (nextAim) {
        const nextClubId = recommendedClubId(
          Math.round(geoDistanceYards(realReferenceOrigin, nextAim)),
          nextAggressiveness,
          Boolean(realGreenFeature && isGeoPositionInsideGeometryOrBoundary(realReferenceOrigin, realGreenFeature.geometry)),
        );
        const nextProfile = profileForClubId(nextClubId);
        if (teeShotPending) setTeeShotClubId(nextClubId);
        else setSelectedClubId(nextClubId);
        setClubPickerPreviewId(nextClubId);
        setTracking((openLeg) => openLeg ? { ...openLeg, club: clubTrackingLabel(nextProfile) } : openLeg);
      }
    }
    cancelAimGesture();
    const nextMetrics = getAimMetrics(nextCaddyPlan.point, pinPoint);
    setAimAnnouncement(
      `${CADDY_AGGRESSIVENESS[nextAggressiveness].label} caddy plan selected. ${nextMetrics.playsLikeYards} yards. ${formatAimLabel(nextMetrics.signedOffsetYards)}.`,
    );
  }

  function cycleCaddyAggressiveness() {
    selectCaddyAggressiveness(CADDY_STRATEGY_CYCLE[caddyAggressiveness]);
  }

  function readDeterministicFix(start: GeoPoint, distanceYards: number) {
    if (gpsHealth === "unavailable") return null;

    return {
      ...destinationPoint(start, distanceYards, 2),
      accuracy: 4,
      capturedAt: gpsHealth === "stale" ? Date.now() - 60_000 : Date.now(),
    };
  }

  function readLiveFix(): Promise<LiveGpsFix | null> {
    if (gpsHealth !== "fresh" || typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latitude = position.coords.latitude;
          const longitude = position.coords.longitude;
          const rawAccuracy = position.coords.accuracy;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(rawAccuracy) || rawAccuracy < 0) {
            setGpsAccuracyMeters(null);
            resolve(null);
            return;
          }
          const capturedAt = position.timestamp;
          const ageMs = Date.now() - capturedAt;
          if (!Number.isFinite(capturedAt) || capturedAt <= 0 || ageMs < -5_000 || ageMs > MAX_FIX_AGE_MS) {
            setGpsAccuracyMeters(null);
            resolve(null);
            return;
          }
          const accuracy = Math.max(0, Math.round(rawAccuracy));
          setGpsAccuracyMeters(accuracy);
          resolve({
            point: { lat: latitude, lon: longitude },
            accuracy: rawAccuracy,
            capturedAt,
          });
        },
        () => {
          setGpsAccuracyMeters(null);
          resolve(null);
        },
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 8_000 },
      );
    });
  }

  async function lockRealCourseAtLiveGps() {
    const requestId = ++startRequestRef.current;
    if (!tracking) {
      const startFix = await readLiveFix();
      if (requestId !== startRequestRef.current) return;
      if (!startFix || startFix.accuracy > MAX_FIX_ACCURACY_METERS) {
        return;
      }
      setCurrentBall(startFix.point);
      setLastGpsFixCapturedAt(startFix.capturedAt);
      const nextNumber = latestLockedShot ? latestLockedShot.number + 1 : 1;
      const nextClub = latestLockedShot ? clubTrackingLabel(selectedProfile) : clubTrackingLabel(teeShotProfile);
      setLiveTrackingFix(null);
      setTracking({ number: nextNumber, club: nextClub, start: startFix.point });
      persistActiveRoundSummary(selectedCourse, selectedHoleNumber, "tracking");
      return;
    }

    const watchedFix = liveTrackingFix?.shotNumber === tracking.number
      && Date.now() - liveTrackingFix.capturedAt <= MAX_FIX_AGE_MS
      ? liveTrackingFix
      : null;
    const gpsFix = watchedFix ?? await readLiveFix();
    if (requestId !== startRequestRef.current) return;
    if (!gpsFix || gpsFix.accuracy > MAX_FIX_ACCURACY_METERS) {
      return;
    }
    const totalGps = Math.round(distanceBetweenYards(tracking.start, gpsFix.point));
    if (totalGps < 5) {
      return;
    }
    const isTeeShot = tracking.number === 1;
    const trackingProfile = isTeeShot ? teeShotProfile : selectedProfile;
    const shot: LockedShot = {
      id: lockedShots.length + 1,
      number: tracking.number,
      club: tracking.club,
      totalGps,
      start: tracking.start,
      end: gpsFix.point,
      evidence: "total_gps",
      provenance: trackingProfile.provenance,
      reviewed: false,
      clubProfileId: isTeeShot ? teeShotClubId : selectedClubId,
      caddyAim: isTeeShot ? null : snapshotAimPlan(currentCaddyPlan),
      plannedAim: null,
      realPlannedAim: realAimPosition ? { point: [...realAimPosition] as GeoJsonPosition, source: realAimOverride && !ruleOf12AutomaticActive ? "manual" : "caddy" } : null,
    };
    setLockedShots((shots) => [...shots, shot]);
    appendGpsRoundEvent(shot);
    setCurrentBall(gpsFix.point);
    setLastGpsFixCapturedAt(gpsFix.capturedAt);
    const nextOrigin = [gpsFix.point.lon, gpsFix.point.lat] as GeoJsonPosition;
    const onGreen = Boolean(realGreenFeature && isGeoPositionInsideGeometryOrBoundary(nextOrigin, realGreenFeature.geometry));
    const nextAim = realCaddyAimPosition(caddyAggressiveness, nextOrigin);
    const nextClubId = onGreen ? "putter" : nextAim ? recommendedClubId(Math.round(geoDistanceYards(nextOrigin, nextAim)), caddyAggressiveness) : selectedClubId;
    setSelectedClubId(nextClubId);
    setLiveTrackingFix(null);
    setTracking({ number: tracking.number + 1, club: clubTrackingLabel(profileForClubId(nextClubId)), start: gpsFix.point });
    persistActiveRoundSummary(selectedCourse, selectedHoleNumber, "tracking");
  }

  function lockDemoShotAtPoint(endpoint: GeoPoint, endpointMapPoint: MapPoint, simulatedTracking: TrackingLeg) {
    const totalGps = Math.round(distanceBetweenYards(simulatedTracking.start, endpoint));
    if (!Number.isFinite(totalGps) || totalGps < 5) return;

    const endpointCoursePoint = courseIsDemo ? coursePointFromMapPoint(endpointMapPoint) : undefined;
    const onGreen = courseIsDemo
      ? Boolean(endpointCoursePoint && courseDistanceYards(endpointCoursePoint, pinPoint) <= 18)
      : Boolean(realGreenFeature && isGeoPositionInsideGeometryOrBoundary([endpoint.lon, endpoint.lat], realGreenFeature.geometry));
    const nextRealOrigin = [endpoint.lon, endpoint.lat] as GeoJsonPosition;
    const nextRealAim = courseIsDemo ? undefined : realCaddyAimPosition(caddyAggressiveness, nextRealOrigin);
    const remainingYards = courseIsDemo
      ? endpointCoursePoint ? courseDistanceYards(endpointCoursePoint, pinPoint) : 0
      : nextRealAim ? Math.round(geoDistanceYards(nextRealOrigin, nextRealAim)) : 0;
    const nextClubId = onGreen
      ? "putter"
      : recommendedClubId(remainingYards, caddyAggressiveness);
    const isTeeShot = simulatedTracking.number === 1;
    const trackingProfile = isTeeShot ? teeShotProfile : selectedProfile;
    const shot: LockedShot = {
      id: Math.max(0, ...lockedShots.map((candidate) => candidate.id)) + 1,
      number: simulatedTracking.number,
      club: simulatedTracking.club,
      totalGps,
      start: simulatedTracking.start,
      end: endpoint,
      evidence: "demo_manual",
      provenance: trackingProfile.provenance,
      reviewed: false,
      clubProfileId: isTeeShot ? teeShotClubId : selectedClubId,
      caddyAim: isTeeShot ? null : snapshotAimPlan(currentCaddyPlan),
      plannedAim: courseIsDemo ? snapshotAimPlan(effectiveAimPlan) : null,
      realPlannedAim: !courseIsDemo && realAimPosition
        ? { point: [...realAimPosition] as GeoJsonPosition, source: realAimOverride && !ruleOf12AutomaticActive ? "manual" : "caddy" }
        : null,
    };

    setLockedShots((shots) => [...shots, shot]);
    setCurrentBall(endpoint);
    setSelectedClubId(nextClubId);
    setClubPickerPreviewId(nextClubId);
    setTracking({ number: simulatedTracking.number + 1, club: clubTrackingLabel(profileForClubId(nextClubId)), start: endpoint });
    setRealAimOverride(null);
    setRealAimDraft(null);
    setDraftAim(null);
    if (courseIsDemo && endpointCoursePoint) {
      const nextDistance = onGreen ? 0 : profileForClubId(nextClubId).totalYards;
      const ratio = remainingYards > 0 ? Math.min(1, nextDistance / remainingYards) : 1;
      setCommittedAim(aimPlanFromCoursePoint({
        eastYards: endpointCoursePoint.eastYards + (pinPoint.eastYards - endpointCoursePoint.eastYards) * ratio,
        forwardYards: endpointCoursePoint.forwardYards + (pinPoint.forwardYards - endpointCoursePoint.forwardYards) * ratio,
      }, "caddy_path"));
    }
    const nextAutoZoomScale = approachAutoZoomScale(onCourseState.autoZoom, remainingYards);
    const nextMapView = centerMapViewOnPoint(endpointMapPoint);
    setMapView({
      ...nextMapView,
      panX: nextMapView.panX / autoZoomScale * nextAutoZoomScale,
      panY: nextMapView.panY / autoZoomScale * nextAutoZoomScale,
    });
    persistActiveRoundSummary(selectedCourse, courseIsDemo ? 7 : selectedHoleNumber, "tracking");
  }

  async function lockAtMyBall() {
    if (!courseIsDemo) {
      await lockRealCourseAtLiveGps();
      return;
    }
    if (!tracking) {
      if (shotLegCompleted) {
        return;
      }
      const nextTracking: TrackingLeg = latestLockedShot
        ? { number: 2, club: clubTrackingLabel(selectedProfile), start: latestLockedShot.end }
        : { number: 1, club: clubTrackingLabel(teeShotProfile), start: TEE };
      setCurrentBall(nextTracking.start);
      setTracking(nextTracking);
      persistActiveRoundSummary(null, 7, "tracking");
      return;
    }

    if (Date.now() < nextLegLockNotBeforeRef.current) {
      return;
    }

    const isTeeShot = tracking.number === 1;
    const trackingProfile = isTeeShot ? teeShotProfile : selectedProfile;
    if (trackingProfile.totalYards <= 0) {
      return;
    }
    const totalGps = trackingProfile.totalYards;
    const gpsFix = readDeterministicFix(tracking.start, totalGps);
    if (!gpsFix) {
      return;
    }
    setGpsAccuracyMeters(gpsFix.accuracy);

    const age = Date.now() - gpsFix.capturedAt;
    if (age > MAX_FIX_AGE_MS || gpsFix.accuracy > MAX_FIX_ACCURACY_METERS) {
      return;
    }
    setLastGpsFixCapturedAt(gpsFix.capturedAt);

    const shot: LockedShot = {
      id: lockedShots.length + 1,
      number: tracking.number,
      club: tracking.club,
      totalGps,
      start: tracking.start,
      end: gpsFix,
      evidence: "total_gps",
      provenance: trackingProfile.provenance,
      reviewed: false,
      clubProfileId: isTeeShot ? teeShotClubId : selectedClubId,
      caddyAim: isTeeShot ? null : snapshotAimPlan(currentCaddyPlan),
      plannedAim: isTeeShot ? null : snapshotAimPlan(effectiveAimPlan),
      realPlannedAim: null,
    };

    setLockedShots((shots) => [...shots, shot]);
    appendGpsRoundEvent(shot);
    setCurrentBall(gpsFix);
    if (isTeeShot) {
      nextLegLockNotBeforeRef.current = Date.now() + 750;
      setTracking({ number: 2, club: clubTrackingLabel(selectedProfile), start: gpsFix });
      persistActiveRoundSummary(null, 7, "tracking");
      return;
    }

    setTracking(null);
    persistActiveRoundSummary(null, 7, "complete");
  }

  function cancelTracking() {
    startRequestRef.current += 1;
    if (!tracking) return;
    if (!courseIsDemo) setLiveTrackingFix(null);
    setTracking(null);
    persistActiveRoundSummary(selectedCourse, courseIsDemo ? 7 : selectedHoleNumber, "paused");
  }

  function markPinFromGps() {
    if (!courseIsDemo) {
      return;
    }
    const fix = readDeterministicFix(currentBall, 0);
    if (!fix || Date.now() - fix.capturedAt > MAX_FIX_AGE_MS) {
      return;
    }

    setPinPlacement("gps");
    setActiveSheet(null);
  }

  function appendRoundEvent(event: RoundEvent) {
    setRoundLog((current) => ({ ...current, events: [...current.events, event] }));
  }

  function appendGpsRoundEvent(shot: LockedShot) {
    const sequence = nextRoundEventSequenceRef.current;
    nextRoundEventSequenceRef.current += 1;
    const equipmentClub = activeEquipment.find((club) => EQUIPMENT_SLOT_TO_CLUB_ID[club.slot - 1] === shot.clubProfileId);
    const event: RoundEvent = {
      id: `event-${sequence}`,
      kind: "gps_shot",
      holeNumber: currentHoleNumber,
      sequence,
      clubId: equipmentClub?.id ?? null,
      clubName: shot.club,
      distanceYards: shot.totalGps,
      strokes: 1,
      evidence: "total_gps",
      createdAt: new Date().toISOString(),
    };
    appendRoundEvent(event);
    // A GPS-locked shot is a recorded stroke; keep the drafted score above the floor.
    setScore((value) => Math.max(value, countRecordedStrokes(roundLog.events, currentHoleNumber) + 1));
    onCourse.dispatch({ type: "record-gps-event", event, equipment: activeEquipment });
    setTrackedShotReviewId(null);
  }

  function addManualEntry(kind: ManualEntryKind, club: EquipmentClub | undefined = undefined) {
    if (kind === "Manual shot" && !club) return;
    const sequence = nextRoundEventSequenceRef.current;
    nextRoundEventSequenceRef.current += 1;
    const eventId = `event-${sequence}`;
    const eventKind: RoundEvent["kind"] = kind === "Manual shot"
      ? "manual_shot"
      : kind === "Penalty stroke"
        ? "penalty_stroke"
        : "missed_tracked_shot";
    const entry: ManualEntry = {
      id: nextManualEntryIdRef.current,
      eventId,
      sequence,
      kind,
      clubId: club?.id ?? null,
      clubName: club?.name ?? null,
      createdAt: new Date().toISOString(),
    };
    nextManualEntryIdRef.current += 1;
    setManualEntries((entries) => [...entries, entry]);
    appendRoundEvent({
      id: eventId,
      kind: eventKind,
      holeNumber: selectedCourse ? selectedHoleNumber : 7,
      sequence,
      clubId: entry.clubId,
      clubName: entry.clubName,
      distanceYards: null,
      strokes: kind === "Missed tracked shot" ? 0 : 1,
      evidence: "manual",
      createdAt: entry.createdAt,
    });
    if (kind === "Penalty stroke") {
      setScore((value) => value + 1);
    } else if (kind === "Manual shot") {
      // The recorded stroke raises the score floor; keep the drafted score coherent.
      const nextFloor = countRecordedStrokes(roundLog.events, currentHoleNumber) + 1;
      setScore((value) => Math.max(value, nextFloor));
    }
    setActiveSheet(null);
  }

  function addManualShot(club: EquipmentClub) {
    addManualEntry("Manual shot", club);
  }

  function removeManualEntry(id: number) {
    const entry = manualEntries.find((candidate) => candidate.id === id);
    if (!entry) return;
    setManualEntries((entries) => entries.filter((candidate) => candidate.id !== id));
    setRoundLog((current) => ({ ...current, events: current.events.filter((event) => event.id !== entry.eventId) }));
    if (entry.kind === "Penalty stroke") setScore((value) => Math.max(1, value - 1));
  }

  function undoLastManualEntry() {
    const lastEntry = manualEntries.at(-1);
    if (lastEntry) removeManualEntry(lastEntry.id);
  }

  async function resetDemo() {
    if (saveCurrentHole() === false) return;
    if (nativeTrackingAvailable && !await prepareNativeTransition()) return;
    if (roundRecordIdRef.current && !persistRounds(savedRoundsRef.current.map((round) => round.id === roundRecordIdRef.current ? { ...round, endedAt: new Date().toISOString() } : round), true)) return;
    startRequestRef.current += 1;
    roundRecordIdRef.current = null;
    setRoundRecordId(null);
    const defaultProfile = getClubProfile(DEFAULT_APPROACH_CLUB_ID);
    const defaultCaddyPlan = getCaddyPlan(defaultProfile, getShotBias(defaultProfile.offsets), "standard");
    const defaultAimMetrics = getAimMetrics(defaultCaddyPlan.point);
    setLockedShots([]);
    setSelectedCourse(null);
    setCourseSelection(undefined);
    setLoadedHoleGeometry(null);
    setLoadedGeometryCourseId(null);
    setGeometryLoadState("idle");
    try {
      window.localStorage.removeItem("openround:course-selection:v1");
    } catch {
      // Storage is optional for a private/offline session.
    }
    setTracking({ number: 1, club: clubTrackingLabel(getClubProfile(DEFAULT_TEE_CLUB_ID)), start: TEE });
    setCurrentBall(TEE);
    setSelectedClubId(DEFAULT_APPROACH_CLUB_ID);
    setTeeShotClubId(DEFAULT_TEE_CLUB_ID);
    setCaddyAggressiveness("standard");
    nextLegLockNotBeforeRef.current = 0;
    setGpsHealth("fresh");
    setPinPlacement("center");
    setPinPoint(HOLE_7_GEOMETRY.pin);
    setPinPlacementActive(false);
    setScore(4);
    onCourse.reset({ roundId: `${DEMO_OPENROUND_COURSE.id}:7`, courseId: DEMO_OPENROUND_COURSE.id, holeNumber: 7 });
    setTrackedShotReviewId(null);
    setManualEntries([]);
    nextManualEntryIdRef.current = 1;
    setActiveSheet(null);
    setStartView("field");
    setActiveRound(createActiveRoundSummary(null, 7, roundSetup.teeBox, "ready"));
    setCommittedAim(defaultCaddyPlan);
    setDraftAim(null);
    resetMapView();
    mapPointersRef.current.clear();
    pinchGestureRef.current = null;
    suppressMapClickUntilRef.current = 0;
    aimPointerStartRef.current = null;
    setAimPressed(false);
    setAimDragging(false);
    setAimAnnouncement(
      `Aim reset. ${defaultAimMetrics.playsLikeYards} yards. ${formatAimLabel(defaultAimMetrics.signedOffsetYards)}.`,
    );
  }

  function resetAimToCaddyPath() {
    const caddyAimMetrics = getAimMetrics(currentCaddyPlan.point, pinPoint);
    setCommittedAim(currentCaddyPlan);
    setDraftAim(null);
    aimPointerStartRef.current = null;
    setAimPressed(false);
    setAimDragging(false);
    setAimAnnouncement(
      `Aim reset. ${caddyAimMetrics.playsLikeYards} yards. ${formatAimLabel(caddyAimMetrics.signedOffsetYards)}.`,
    );
    setActiveSheet(null);
  }

  return (
    <div className="openround-shell" data-testid={startView === "start" ? "openround-start" : "openround-field"}>
      {startView === "start" ? (
        <>
          {nativeTransitionError && <p className="sheet-footnote" role="alert">{nativeTransitionError}</p>}
          {startFlowScreen === "home" ? (
            <StartScreen
              key="start-home"
              activeRound={activeRound}
              savedRounds={savedRounds}
              roundSaveError={roundSaveError}
              variant={prototypeVariant}
              equipmentCount={equipment.length}
              roundStats={onCourseRoundStats}
              onResume={resumeActiveRound}
              onNewRound={startNewRoundFromStart}
              onDemoRound={enterDemoRound}
              onEndRound={() => setActiveSheet("end-round")}
              onEquipment={openEquipmentSheet}
              onSmartTracking={() => setActiveSheet("smart")}
            />
          ) : (
            <StartRoundScreen
              key="start-round"
              variant={prototypeVariant}
              course={selectedCourse}
              setup={roundSetup}
              holeNumber={selectedHoleNumber}
              onBack={() => setStartFlowScreen("home")}
              onChangeCourse={() => openCourseSheet(true)}
              onTeeChange={(teeBox) => setRoundSetup((current) => ({ ...current, teeBox }))}
              onHoleChange={setSelectedHoleNumber}
              onGolfersChange={(golfers) => setRoundSetup((current) => ({ ...current, golfers }))}
              onStart={() => { void startRoundFromStart(); }}
            />
          )}
          {import.meta.env.DEV ? <PrototypeSwitcher variant={prototypeVariant} onChange={changePrototypeVariant} /> : null}
        </>
      ) : (
      <main
        className={`field-screen${courseIsDemo ? "" : " field-screen-real"}`}
        data-real-course={courseIsDemo ? "false" : "true"}
        data-pin-placement={pinPlacementActive ? "active" : "idle"}
        data-putting={puttingActive ? "true" : "false"}
        aria-label="OpenRound on-course rangefinder"
      >
        {pinPlacementActive ? (
          <header className="pin-placement-header">
            <button type="button" onClick={cancelPinPlacement} aria-label="Close pin placement"><Cross2Icon /></button>
            <h2>PIN THE FLAG</h2>
            <button className="pin-options" type="button" onClick={() => setActiveSheet("pin")} aria-label="Pin options"><DotsHorizontalIcon /></button>
          </header>
        ) : null}
        <section className="recommendation-hero" aria-label="Club recommendation">
          <div className="hole-stepper" role="group" aria-label="Hole navigation">
            <button type="button" onClick={() => changeHeaderHole(currentHoleNumber - 1)} aria-label="Previous hole" disabled={courseIsDemo || currentHoleNumber === 1}>‹</button>
            <div><strong>HOLE {currentHoleNumber}</strong><small>PAR {headerHolePar ?? "—"}</small></div>
            <button type="button" onClick={() => changeHeaderHole(currentHoleNumber + 1)} aria-label="Next hole" disabled={courseIsDemo || currentHoleNumber === headerMaximumHole}>›</button>
          </div>
          <button
            className="club-panel"
            type="button"
            onClick={openClubSelector}
            aria-label={`Change club. Current club ${currentProfile.label}. ${teeShotPending ? "Tee shot is not locked yet." : "Next shot is ready to track."}`}
            aria-haspopup="dialog"
            aria-expanded={activeSheet === "club"}
          >
            <strong>{displayedHeroClub}</strong>
          </button>
          <button
            type="button"
            onClick={() => setActiveSheet("conditions")}
            disabled={puttingActive}
            aria-haspopup="dialog"
            aria-expanded={activeSheet === "conditions"}
            className="plays-like-panel"
            data-putting={puttingActive ? "true" : "false"}
            aria-label={puttingActive
              ? `${puttingDistanceYards} yards to pin.${courseIsDemo ? " Demo read two inches right." : " Break not measured."}`
              : courseIsDemo
                ? "Plays Like distance breakdown"
                : "Plays Like distance breakdown"}
          >
            {puttingActive ? (
              <>
                <div className="putting-distance-block">
                  <small>TO PIN</small>
                  <div><strong data-testid="aim-distance">{puttingDistanceYards}</strong><span>YD</span></div>
                </div>
                <div className="putting-read" aria-label={courseIsDemo ? "Demo read two inches right" : "Break not measured"}>
                  <small>{courseIsDemo ? "DEMO READ" : "BREAK"}</small>
                  <strong>{courseIsDemo ? "2 IN" : "—"}</strong>
                  <span>{courseIsDemo ? "RIGHT" : "NOT MEASURED"}</span>
                </div>
              </>
            ) : (
              <>
                <small>PLAYS LIKE</small>
                <div>
                  <strong data-testid="aim-distance">{courseIsDemo ? playsLikeYards : adjustedRealTargetYards ?? "—"}</strong>
                  <span>{courseIsDemo || adjustedRealTargetYards !== undefined ? "YD" : "DATA"}</span>
                </div>
              </>
            )}
          </button>
        </section>

        <section className="green-distance-strip" aria-label="Green distances">
          {courseIsDemo ? (
            <>
              <div>
                <span>FRONT</span>
                <strong>148</strong>
              </div>
              <div className="green-distance-primary">
                <span>CENTER</span>
                <strong>158</strong>
              </div>
              <div>
                <span>BACK</span>
                <strong>171</strong>
              </div>
            </>
          ) : (
            <>
              <div><span>FRONT</span><strong>{realFrontYards ?? "—"}</strong></div>
              <div className="green-distance-primary"><span>CENTER</span><strong>{realCenterYards ?? "—"}</strong></div>
              <div><span>BACK</span><strong>{realBackYards ?? "—"}</strong></div>
            </>
          )}
        </section>

        <section
          className="course-map"
          ref={mapRef}
          data-real-course={courseIsDemo ? "false" : "true"}
          data-planning-focus={!courseIsDemo && realPlanningFocus ? "true" : "false"}
          data-focus-scale={!courseIsDemo && realPlanningFocus ? REAL_PLANNING_FOCUS_SCALE.toFixed(2) : "1.00"}
          data-rendered-scale={mapView.scale.toFixed(2)}
          data-map-detail={mapDetailVisible ? "true" : "false"}
          data-map-layer={onCourseState.mapLayer}
          data-green-map={onCourseState.greenMapMode}
          data-distance-arcs={String(onCourseState.distanceArcs)}
          data-blind-shot={String(onCourseState.blindShot)}
          data-auto-zoom={String(onCourseState.autoZoom)}
          data-auto-zoom-active={String(autoZoomActive)}
          data-dispersion-mode={dispersionIsCircular ? "circle" : "envelope"}
          data-plan-locked={shotLegCompleted ? "true" : "false"}
          data-pin-placement={pinPlacementActive ? "active" : "idle"}
          data-putting={puttingActive ? "true" : "false"}
          data-rule-of-12={ruleOf12AutomaticActive ? "true" : "false"}
          aria-label={`${courseIsDemo ? "Aerial demo hole map with hazards, draggable aim point, and shot history" : `Aerial ${courseDisplayName} hole ${selectedHoleNumber} map with loaded geometry`}, and two-finger pinch zoom${pinPlacementActive ? ", tap green to place pin" : ""}`}
          onPointerDown={handleMapPointerDown}
          onPointerMove={handleMapPointerMove}
          onPointerUp={handleMapPointerUp}
          onPointerCancel={handleMapPointerCancel}
          onClick={handleMapClick}
        >
          <div
            className={`map-world ${courseIsDemo ? "" : "map-world-real"}`}
            style={mapWorldStyle}
            data-orientation={courseIsDemo ? "fixture" : "top-facing"}
            data-rotation-deg={courseIsDemo ? "0.00" : realMapRotationDeg.toFixed(2)}
            data-fit-scale="1.00"
          >
            {onCourseState.mapLayer === "illustration" && !ruleOf12AutomaticActive && !pinPlacementActive ? (
              <IllustrationMapLayer courseIsDemo={courseIsDemo} />
            ) : (
              <>
                <img className="map-fallback-image" src="/assets/openround-hole-illustration.svg" alt={courseIsDemo ? "Schematic illustration of demo hole 7" : ""} />
                <SatelliteLayer
                  mapSize={mapSize}
                  center={activeMapCenter}
                  detailCenter={imageryDetailCenter}
                  detailScale={imageryDetailScale}
                  viewportExport={!courseIsDemo}
                  onProviderChange={setMapProvider}
                />
              </>
            )}
            <div className="map-contrast" aria-hidden="true" />
            {courseIsDemo ? (
              <div className="map-overlay-space" aria-hidden="true">
                {planRouteStyles.map((style, index) => (
                  <span className="route-segment route-segment-plan" style={style} key={`plan-${index}`} />
                ))}
                {pinRouteStyles.map((style, index) => (
                  <span className="route-segment route-segment-pin" style={style} key={`pin-${index}`} />
                ))}
                {driverShot?.evidence === "total_gps" ? (
                  <span className="route-segment route-segment-complete" style={routeSegmentStyle(TEE_MAP_POINT, CURRENT_BALL_MAP_POINT, mapSize)} />
                ) : null}
                {lockedShots.filter((shot) => shot.evidence === "demo_manual").map((shot) => (
                  <span
                    key={`manual-shot-${shot.id}`}
                    className="route-segment route-segment-complete"
                    style={routeSegmentStyle(
                      mapPointFromCoursePoint(demoCoursePointFromGeoPoint(shot.start)),
                      mapPointFromCoursePoint(demoCoursePointFromGeoPoint(shot.end)),
                      mapSize,
                    )}
                  />
                ))}
                <span
                  className="dispersion-window"
                  style={{
                    ...mapPointStyle(dispersionCenter),
                    width: `${dispersionWidth}px`,
                    height: `${dispersionDepth}px`,
                    transform: `translate(-50%, -50%) rotate(${planAngle * (180 / Math.PI) + 90}deg)`,
                  }}
                />
                <span className="ball-marker ball-marker-tee" style={mapPointStyle(TEE_MAP_POINT)} />
                {driverShot ? <span className="ball-marker ball-marker-shot-start" style={mapPointStyle(mapBallPoint)} /> : null}
                {pinPlacementActive ? (
                  <span className="pin-placement-zone" style={mapPointStyle(pinMapPoint)} aria-hidden="true" />
                ) : null}
                <span className="target-marker" style={mapPointStyle(pinMapPoint)} />
              </div>
            ) : currentHoleGeometry ? (
              <>
                <RealCourseGeometryOverlay
                  geometry={currentHoleGeometry}
                  mapCenter={activeMapCenter}
                  mapSize={mapSize}
                  origin={realReferenceOrigin}
                  planningFocus={realPlanningFocus}
                  rotationDeg={realMapRotationDeg}
                  mapScale={mapView.scale * mapContentScale * autoZoomScale}
                  targetGreenId={realGreenFeature?.id}
                  teeFeatureIds={realTeeFeatureIds}
                  selectedHazardId={selectedHazardId}
                  onHazardSelect={setSelectedHazardId}
                />
                <RealPlanOverlay
                  origin={realPlanOrigin}
                  aim={realAimPosition}
                  target={realPinPosition}
                  mapCenter={activeMapCenter}
                  mapSize={mapSize}
                  rotationDeg={realMapRotationDeg}
                  aimYards={realAimYards}
                  aimToPinYards={realAimOnGreen && !ruleOf12AutomaticActive ? undefined : realAimToPinYards}
                  showDistances
                  distanceLabelMode="split-labels"
                  mapScale={mapView.scale * mapContentScale * autoZoomScale}
                />
                <RealShotHistoryOverlay
                  shots={lockedShots}
                  mapCenter={activeMapCenter}
                  mapSize={mapSize}
                  rotationDeg={realMapRotationDeg}
                  mapScale={mapView.scale * mapContentScale * autoZoomScale}
                />
                <RealPinOverlay
                  position={realPinPosition}
                  mapCenter={activeMapCenter}
                  mapSize={mapSize}
                  mapScale={mapView.scale * mapContentScale * autoZoomScale}
                  placementActive={pinPlacementActive}
                  source={realPinSource}
                />
              </>
            ) : null}

            {onCourseState.greenMapMode !== "off" && (courseIsDemo || Boolean(realGreenFeature)) ? (
              <GreenMapOverlay mode={onCourseState.greenMapMode} courseIsDemo={courseIsDemo} sampleCount={onCourseState.shotSamples.length} />
            ) : null}
            {onCourseState.distanceArcs ? (
              <DistanceArcsOverlay
                target={courseIsDemo ? pinMapPoint : realPinMapPoint}
                origin={distanceArcOrigin}
                mapSize={mapSize}
                toTargetYards={currentTargetYards}
                clearYards={courseIsDemo ? 153 : currentHoleGeometry?.hole.features.find((feature) => feature.id === selectedHazardId)?.clearYards}
                referenceYards={distanceArcReferenceYards}
                showDetail={mapDetailVisible}
              />
            ) : null}

            <button
              className="aim-point"
              style={renderedAimPointStyle}
              data-testid="aim-point"
              hidden={!aimPointVisible}
              data-pressed={courseIsDemo ? (aimPressed ? "true" : "false") : (realAimDragging ? "true" : "false")}
              data-dragging={courseIsDemo ? (aimDragging ? "true" : "false") : (realAimDragging ? "true" : "false")}
              data-locked={shotLegCompleted || realShotLegCompleted ? "true" : "false"}
              data-label-below={(renderedAimPoint ? renderedAimPoint.y * mapSize.height : 0) < AIM_LABEL_FLIP_PX ? "true" : "false"}
              type="button"
              disabled={!aimEditable || !aimPointVisible || ruleOf12AutomaticActive}
              role="slider"
              aria-label={courseIsDemo ? (aimEditable ? `${reticleAccessibleSource} aim point` : "Locked shot aim point") : (ruleOf12AutomaticActive ? "Automatic Rule of 12 landing point" : aimEditable ? "Course aim point" : "Locked shot aim point")}
              aria-valuemin={0}
              aria-valuemax={300}
              aria-valuenow={courseIsDemo ? playsLikeYards : realAimYards ?? 0}
              aria-valuetext={courseIsDemo
                ? `${playsLikeYards} yards to aim, ${aimLabel}, ${reticleAccessibleSource}`
                : realAimYards !== undefined
                  ? `${realAimYards} yards to ${realShotLegCompleted ? "locked shot aim" : "aim"}, ${realAimToPinYards !== undefined ? `${realAimToPinYards} yards from aim to pin` : "pin distance unavailable"}`
                  : "Aim unavailable until a verified course target is loaded"}
              onPointerDown={courseIsDemo ? handleAimPointerDown : handleRealAimPointerDown}
              onPointerMove={courseIsDemo ? handleAimPointerMove : handleRealAimPointerMove}
              onPointerUp={courseIsDemo ? handleAimPointerUp : handleRealAimPointerUp}
              onPointerCancel={courseIsDemo ? handleAimPointerCancel : handleRealAimPointerCancel}
              onLostPointerCapture={courseIsDemo ? handleAimLostPointerCapture : handleRealAimLostPointerCapture}
              onKeyDown={courseIsDemo ? handleAimKeyDown : undefined}
            >
              {courseIsDemo ? (
                <span className="aim-point-label">{`${playsLikeYards} ${reticleSourceCopy} · ${compactAimLabel}`}</span>
              ) : null}
              <span className="aim-point-face" style={aimFaceStyle}>
                <span className="aim-point-center-dot" aria-hidden="true" />
              </span>
            </button>

            {courseIsDemo ? (
              <>
                <div className="hazard-callout hazard-callout-left">
                  <strong>LEFT BUNKER</strong>
                  <span>145 TO · 153 CLEAR</span>
                </div>
                <div className="hazard-callout hazard-callout-right">
                  <strong>FRONT BUNKER</strong>
                  <span>142 TO · 150 CLEAR</span>
                </div>
              </>
            ) : null}

          </div>

          {onCourseState.blindShot ? (
            <div className="blind-shot-guide" data-testid="blind-shot-guide" role="status">
              <strong>BLIND SHOT · FLAG</strong>
              <span>{blindShotGuide.callout}</span>
              <small>{blindShotGuide.signedOffsetYards === 0 ? "CENTERLINE FLAG · USE THE SAVED AIM" : "FLAG OFFSET FROM SAVED AIM"}</small>
            </div>
          ) : null}

          {displayedMapShot && !puttingActive ? (
            <div
              className={courseIsDemo ? "completed-shot-card" : "real-shot-summary"}
              data-testid={courseIsDemo ? undefined : "real-driver-shot-card"}
              aria-label={`Shot ${displayedMapShot.number} ${displayedMapShot.club} ${displayedMapShot.totalGps} yards ${displayedMapShot.status.toLowerCase()}`}
            >
              <span>{`SHOT ${displayedMapShot.number} · ${displayedMapShot.club}`}</span>
              <strong>{displayedMapShot.totalGps} YD</strong>
              <small>{displayedMapShot.status}</small>
            </div>
          ) : null}

          {courseIsDemo ? (
            <span className="map-zoom-cue" aria-hidden="true">
              DEMO FIXTURE · {mapProviderCue} · PINCH TO ZOOM · {mapZoomLabel}
            </span>
          ) : null}
          {mapView.scale > (!courseIsDemo && realPlanningFocus ? REAL_PLANNING_FOCUS_SCALE + 0.08 : 1.01) ? (
            <button className="map-zoom-reset" type="button" data-map-ignore="true" onClick={resetMapView} aria-label="Reset map zoom">
              RESET MAP
            </button>
          ) : null}
          {!courseIsDemo ? (
            <button
              className="map-focus-toggle"
              type="button"
              data-map-ignore="true"
              onClick={toggleRealPlanningFocus}
              aria-pressed={realPlanningFocus}
              aria-label={realPlanningFocus ? "Show full hole" : "Plan next shot"}
            >
              {realPlanningFocus ? "FULL HOLE" : "PLAN SHOT"}
            </button>
          ) : null}
          {!courseIsDemo && realAimOverride && !ruleOf12AutomaticActive ? (
            <button
              className="map-aim-reset"
              type="button"
              data-map-ignore="true"
              onClick={resetRealAimToCaddyPath}
              aria-label="Reset course aim to caddy path"
            >
              RESET AIM
            </button>
          ) : null}

          {ruleOf12AutomaticActive ? (
            <section className="rule-of-12-helper" data-map-ignore="true" data-testid="rule-of-12-helper" aria-label="Rule of 12 short-game helper">
              <div className="rule-of-12-readout" role="status" aria-live="polite" aria-atomic="true">
                {ruleOf12Projection ? (
                  <strong data-testid="rule-of-12-club">{`${ruleOf12Projection.clubName.toUpperCase()} · LAND ${ruleOf12Projection.carryYards} YD · ROLL ${ruleOf12Projection.rolloutYards} YD · 1:${ruleOf12Projection.ratio}`}</strong>
                ) : (
                  <strong>RULE NOT SUITABLE</strong>
                )}
              </div>
              <div className="rule-of-12-slope" role="group" aria-label="Green slope">
                {(["uphill", "level", "downhill"] as const).map((slope) => (
                  <button key={slope} type="button" aria-pressed={ruleOf12Slope === slope} onClick={() => setRuleOf12Slope(slope)}>{slope}</button>
                ))}
              </div>
            </section>
          ) : null}

          <nav className="map-actions" data-map-ignore="true" aria-label="Course actions">
            <ActionButton label="Menu" onClick={() => setActiveSheet("menu")}>
              <HamburgerMenuIcon />
            </ActionButton>
            <ActionButton label="Pin" onClick={pinPlacementActive ? cancelPinPlacement : startPinPlacement}>
              <SewingPinFilledIcon />
            </ActionButton>
            <ActionButton label="Score" onClick={openScoreSheet}>
              <Pencil2Icon />
            </ActionButton>
            {!puttingActive ? (
              <>
                <ActionButton label="+ Shot" onClick={() => setActiveSheet("add")} badge={manualEntries.length}>
                  <PlusIcon />
                </ActionButton>
                {DEMO_BALL_PLACEMENT_AVAILABLE ? (
                  <button
                    className="map-action map-action-ball"
                    type="button"
                    disabled={shotLegCompleted || (!courseIsDemo && (!selectedCourse?.center || !currentHoleGeometry || !realAimPosition || !realReferenceOrigin))}
                    onClick={placeBallAtAim}
                    aria-label="Place ball at current aim"
                  >
                    <TargetIcon />
                    <span>BALL</span>
                  </button>
                ) : null}
                <button
                  className="map-action map-action-caddy"
                  data-testid="caddy-strategy-button"
                  data-strategy={caddyAggressiveness}
                  type="button"
                  onClick={cycleCaddyAggressiveness}
                  aria-label={`Caddy quick switch. Current setting ${caddyStrategy.label.toLowerCase()}. Next setting ${CADDY_AGGRESSIVENESS[CADDY_STRATEGY_CYCLE[caddyAggressiveness]].label.toLowerCase()}.`}
                >
                  <TargetIcon />
                  <span>{CADDY_STRATEGY_SHORT_LABEL[caddyAggressiveness]}</span>
                </button>
              </>
            ) : null}
          </nav>
        </section>

        {pinPlacementActive ? (
          <div className="pin-placement-overlay">
            <div className="pin-placement-instruction" role="status">
              <strong>MOVE GREEN UNDER FLAG</strong>
              <span>DRAG TO POSITION · PINCH TO ZOOM</span>
            </div>
            <div className="pin-placement-target" data-testid="pin-placement-target" data-valid={pinPlacementCandidateValid ? "true" : "false"} aria-hidden="true">
              <span className="pin-placement-flag"><SewingPinFilledIcon /></span>
            </div>
            <div className="pin-placement-zoom" data-map-ignore="true" aria-label="Map zoom controls">
              <button type="button" onClick={() => adjustPinPlacementZoom(-0.4)} aria-label="Zoom out"><MinusIcon /></button>
              <button type="button" onClick={() => adjustPinPlacementZoom(0.4)} aria-label="Zoom in"><PlusIcon /></button>
            </div>
          </div>
        ) : null}

        {pinPlacementActive ? (
          <section className="pin-placement-footer" data-valid={pinPlacementCandidateValid ? "true" : "false"}>
            <div className="pin-placement-summary">
              <h3>TODAY'S PIN</h3>
              <div><small>FRONT</small><strong>{courseIsDemo ? 148 : realFrontYards ?? "—"}</strong></div>
              <div className="pin-placement-center"><small>CENTER</small><strong>{courseIsDemo ? 158 : realCenterYards ?? "—"}</strong></div>
              <div><small>BACK</small><strong>{courseIsDemo ? 171 : realBackYards ?? "—"}</strong></div>
            </div>
            <button className="pin-placement-camera" type="button" onClick={() => void openCameraPinLock()}>
              CAMERA PIN LOCK
            </button>
            <button className="pin-placement-confirm" type="button" onClick={confirmPinPlacement} aria-label="Confirm pin">CONFIRM PIN</button>
            <button className="pin-placement-cancel" type="button" onClick={cancelPinPlacement} aria-label="Cancel pin placement">CANCEL</button>
          </section>
        ) : null}

        {cameraPinLockActive ? (
          <section className="camera-pin-lock" aria-label="Camera pin lock">
            <header><button type="button" onClick={closeCameraPinLock} aria-label="Close camera pin lock"><Cross2Icon /></button><strong>CAMERA PIN LOCK</strong></header>
            <div className="camera-pin-preview" onClick={markCameraPin} data-testid="camera-pin-preview">
              <video ref={cameraPinVideoRef} autoPlay playsInline muted aria-hidden="true" />
              <span className="camera-pin-flag" aria-hidden="true">⚑</span>
              {cameraPinMarks.map((top, index) => <span key={index} className="camera-pin-mark" style={{ top }} />)}
              <p>{cameraPinMarks.length === 0 ? "TAP FLAG TOP" : cameraPinMarks.length === 1 ? "TAP CUP / BASE" : "FLAG LOCKED"}</p>
              {cameraPinUnavailable ? <small>CAMERA PREVIEW UNAVAILABLE · MODELLED LOCK READY</small> : null}
            </div>
            <footer>
              <span>{cameraPinMarks.length < 2 ? "USE CAMERA ZOOM, THEN MARK FLAG HEIGHT" : "MODELLED ESTIMATE READY"}</span>
              <button type="button" disabled={cameraPinMarks.length !== 2} onClick={lockCameraPinDistance}>LOCK PIN</button>
            </footer>
          </section>
        ) : null}

        {cameraPinEstimate && !pinPlacementActive ? (
          <aside className="camera-pin-result" role="status"><strong>PIN {cameraPinEstimate.yards} YD</strong><span>MODELLED ESTIMATE · {cameraPinEstimate.confidence.toUpperCase()} CONFIDENCE</span></aside>
        ) : null}

        {puttingActive ? (
          <section className="putting-progress" aria-label="Hole shot history">
            <div className="putting-progress-tee" aria-label="Tee start">
              <strong>TEE</strong>
              <span className="putting-progress-node" aria-hidden="true" />
            </div>
            {lockedShots.map((shot) => (
              <div key={shot.id} aria-label={`Shot ${shot.number}: ${shot.club}, ${shot.totalGps} yards`}>
                <span className="putting-progress-node" aria-hidden="true">{shot.number}</span>
                <strong>{shot.club}</strong>
                <small><b>{shot.totalGps}</b><span>YD</span></small>
              </div>
            ))}
            <div data-active="true" aria-label={`Shot ${tracking?.number ?? lockedShots.length + 1}: Putter, ${puttingDistanceYards} yards`}>
              <span className="putting-progress-node" aria-hidden="true">{tracking?.number ?? lockedShots.length + 1}</span>
              <strong>PUTTER</strong>
              <small><b>{puttingDistanceYards}</b><span>YD</span></small>
            </div>
          </section>
        ) : null}

        <section className="tracking-strip" data-active={trackingActive ? "true" : "false"} data-tracking-number={tracking?.number}>
          <span className="tracking-pulse" aria-hidden="true" />
          <strong>
            {trackingActive
              ? `TRACKING ${tracking.club}`
              : shotLegCompleted
                ? "DEMO LEG COMPLETE"
                : latestLockedShot
                  ? `${latestLockedShot.club} LOCKED`
                  : `${clubTrackingLabel(teeShotProfile).toLowerCase().replace(/^./, (letter) => letter.toUpperCase())} paused`}
          </strong>
          <span>
            {trackingActive
              ? puttingActive
                ? "ON GREEN · PUTTING"
                : latestLockedShot?.evidence === "demo_manual"
                  ? "DEMO MODE · MANUAL BALL"
                  : tracking.number === 1
                ? `START TEE · ${gpsLabel(gpsHealth, gpsAccuracyMeters)}`
                : `START ${latestLockedShot?.club ?? clubTrackingLabel(teeShotProfile)} END · ${gpsLabel(gpsHealth, gpsAccuracyMeters)}`
              : shotLegCompleted
                ? "TWO-SHOT GPS DEMO"
                : latestLockedShot
                  ? `${latestLockedShot.totalGps} YD ${lockedShotEvidenceLabel(latestLockedShot)}`
                  : "No shot recorded"}
          </span>
        </section>

        {nativeTransitionError && <p className="sheet-footnote" role="alert">{nativeTransitionError}</p>}
        {roundSaveError ? <p className="sheet-footnote" role="alert">Round changes are in memory only. Free browser storage before changing holes or ending the round.</p> : null}
        <section className="primary-action-row">
          <button
            className="primary-lock"
            data-ready={gpsReady ? "true" : "false"}
            type="button"
            onClick={puttingActive && !courseIsDemo ? openScoreSheet : lockAtMyBall}
            disabled={shotLegCompleted}
            data-testid="at-my-ball"
            aria-label={puttingActive ? courseIsDemo ? "Lock Putter at my ball" : "Record putts and score" : shotLegCompleted ? "Two-shot demo complete" : trackingActive ? "At my ball" : "Resume tracking"}
          >
            <strong>
              {!puttingActive && !shotLegCompleted && !trackingActive ? <TriangleRightIcon aria-hidden="true" /> : null}
              {puttingActive
                ? courseIsDemo ? "LOCK PUTTER" : "RECORD PUTTS"
                : shotLegCompleted
                ? "DEMO COMPLETE"
                : trackingActive
                  ? gpsReady
                    ? "AT MY BALL"
                    : "REFRESH GPS"
                  : latestLockedShot
                    ? `Resume ${clubTrackingLabel(selectedProfile).toLowerCase()}`
                    : `Resume ${clubTrackingLabel(teeShotProfile).toLowerCase()}`}
            </strong>
            {puttingActive ? (
              <small>{courseIsDemo ? "SAVE GPS TOTAL" : "MANUAL COUNT · NO GPS DISTANCE"}</small>
            ) : trackingActive && gpsReady ? (
              <small>
                {tracking.number === 1
                  ? `LOCK ${tracking.club} · START ${tracking.club}`
                  : `LOCK ${clubTrackingLabel(selectedProfile)} · SAVE GPS TOTAL`}
              </small>
            ) : null}
          </button>
        </section>

        <button
          className="cancel-tracking"
          type="button"
          onClick={latestLockedShot?.evidence === "demo_manual" ? undoLastDemoBall : cancelTracking}
          disabled={latestLockedShot?.evidence !== "demo_manual" && !trackingActive}
          aria-label={latestLockedShot?.evidence === "demo_manual" ? "Undo demo ball" : undefined}
        >
          <Cross2Icon /> {latestLockedShot?.evidence === "demo_manual" ? "UNDO BALL" : trackingActive ? "CANCEL TRACKING" : shotLegCompleted ? "DEMO LEG COMPLETE" : "TRACKING PAUSED"}
        </button>
        <nav className="floating-bottom-nav" aria-label="Primary app navigation">
          <button type="button" onClick={openStartScreen} data-testid="field-nav-home" aria-label="Home">
            <HomeIcon aria-hidden="true" />
          </button>
          <button type="button" data-active="true" data-testid="field-nav-round" aria-current="page" aria-label="Round">
            <TargetIcon aria-hidden="true" />
          </button>
          <button type="button" onClick={openInsightsSheet} data-testid="field-nav-stats" aria-label="Stats">
            <BarChartIcon aria-hidden="true" />
          </button>
          <button type="button" onClick={openEquipmentSheet} data-testid="field-nav-bag" aria-label="Bag">
            <BackpackIcon aria-hidden="true" />
          </button>
        </nav>
        <span className="sr-only" aria-live="polite">
          {aimAnnouncement}
        </span>
      </main>
      )}

      <SmartTrackingSheet open={activeSheet === "smart"} onClose={() => setActiveSheet(null)}
        roundID={activeRound && !courseIsDemo ? roundRecordId : null} courseID={selectedCourse?.id} hole={selectedHoleNumber}
        roundLabels={Object.fromEntries(savedRounds.map(round => [round.id, `${round.courseName} · ${new Date(round.startedAt).toLocaleDateString()}`]))}
        geometry={currentHoleGeometry ?? undefined}
        clubs={clubSelectorItems.map(item => ({clubID: item.clubId, label: item.label, yards: item.trueDistanceYards}))} />
      <BottomSheet
        open={activeSheet === "end-round"}
        onOpenChange={(open) => setActiveSheet(open ? "end-round" : null)}
        title="End current round"
        description="Save this round on this phone for later review."
        snap={0.42}
      >
        <div className="end-round-sheet">
          <strong>{activeRound?.courseName ?? "CURRENT ROUND"}</strong>
          <span>Your scores, putts, group scores, and shot evidence remain in Rounds.</span>
          {roundSaveError ? <p role="alert">Round could not be saved. Free browser storage, then try again. Your round is still open.</p> : null}
          {nativeTransitionError && <p role="alert">{nativeTransitionError}</p>}
          <button className="sheet-primary-button end-round-confirm" type="button" onClick={endActiveRound}>END ROUND</button>
          <button className="sheet-secondary-button" type="button" onClick={() => setActiveSheet(null)}>KEEP PLAYING</button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "course"}
        onOpenChange={(open) => setActiveSheet(open ? "course" : null)}
        title="Choose course"
        description="Set up your local round, then start the first GPS-tracked shot."
        snap={0.94}
      >
        <div className="course-discovery">
          <div className="course-discovery-mode" role="group" aria-label="Course discovery mode">
            <button type="button" aria-pressed={catalogMode === "search"} onClick={() => setCatalogMode("search")}>SEARCH</button>
            <button type="button" aria-pressed={catalogMode === "nearby"} onClick={() => { setCatalogMode("nearby"); setLocationLoadState("idle"); setNearbyLocation(null); }}>NEAR ME</button>
          </div>
          {catalogMode === "search" ? (
            <label className="course-search-field">
              <span>COURSE, CITY, OR STATE</span>
              <KeyboardInput
                value={catalogQuery}
                onChange={(event) => {
                  setCatalogQuery(event.target.value);
                  if (pendingCourse) setPendingCourse(null);
                }}
                placeholder="Try Pinehurst or AZ"
                autoComplete="off"
              />
            </label>
          ) : (
            <div className="course-location-note">
              <strong>{locationLoadState === "loading" ? "REQUESTING PHONE GPS…" : locationLoadState === "ready" ? "GPS MATCH · WITHIN 50 MI" : "PHONE GPS REQUIRED"}</strong>
              <span>
                {locationLoadState === "error"
                  ? "Location permission or a fresh fix is unavailable. Search by course or city instead."
                  : "Uses a fresh high-accuracy phone fix. Nothing is sent until you confirm a course."}
              </span>
            </div>
          )}
          {catalogLoadState === "loading" ? <div className="course-empty-state">LOADING 15,667 PINNED COURSES…</div> : null}
          {catalogLoadState === "error" ? (
            <div className="course-empty-state course-empty-state-warning">
              <strong>COURSE CATALOG OFFLINE</strong>
              <span>Keep playing the demo or reconnect to reload the pinned release.</span>
              <button type="button" onClick={() => { setCatalogLoadState("idle"); setCatalogRetry((value) => value + 1); }}>RETRY</button>
            </div>
          ) : null}
          {courseCatalog ? (
            <small className="course-catalog-count">PINNED OPEN GOLF API {courseCatalog.version} · {courseCatalog.courseCount.toLocaleString()} COURSES · +{PERSONAL_COURSE_ENTRIES.length} PERSONAL · ODbL</small>
          ) : null}
          {pendingCourse ? (
            <div className="course-confirm-card">
              <div>
                <strong>{pendingCourse.name}</strong>
                <span>{[pendingCourse.city, pendingCourse.state].filter(Boolean).join(", ") || "US"}</span>
              </div>
              <div className="round-setup-card" data-testid="round-setup">
                <div className="round-setup-heading">
                  <span>ROUND SETUP</span>
                  <small>SAVED LOCALLY ON THIS PHONE</small>
                </div>
                <label className="round-setup-player">
                  <span>PLAYER</span>
                  <KeyboardInput
                    value={roundSetup.playerName}
                    onChange={(event) => setRoundSetup((current) => ({ ...current, playerName: event.target.value.slice(0, 40) }))}

                    maxLength={40}
                    autoComplete="name"
                  />
                </label>
                <div className="round-setup-field">
                  <div className="round-setup-field-heading">
                    <span>TEE BOX</span>
                    <small>CHOOSE YOUR STARTING YARDAGE</small>
                  </div>
                  <div className="tee-box-options" role="group" aria-label="Tee box">
                    {pendingTeeOptions.map((tee) => (
                      <button
                        type="button"
                        key={tee.id}
                        data-selected={roundSetup.teeBox === tee.id ? "true" : "false"}
                        aria-pressed={roundSetup.teeBox === tee.id}
                        onClick={() => setRoundSetup((current) => ({ ...current, teeBox: tee.id }))}
                      >
                        <strong>{tee.label}</strong>
                        <small>{prototypeVariant === "c" && pendingCourseTeeOptions.length === 0 ? "MANUAL" : tee.detail}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="round-setup-field round-setup-hole-field">
                  <div className="round-setup-field-heading">
                    <span>START HOLE</span>
                    <small>{pendingHoleCount} HOLES AVAILABLE</small>
                  </div>
                  <select
                    aria-label="START HOLE"
                    value={pendingHoleNumber}
                    onChange={(event) => setPendingHoleNumber(Number(event.target.value))}
                  >
                    {Array.from({ length: pendingHoleCount }, (_, index) => index + 1).map((hole) => <option value={hole} key={hole}>{`HOLE ${hole}`}</option>)}
                  </select>
                  <div className="hole-picker-grid" role="group" aria-label="Select starting hole">
                    {Array.from({ length: pendingHoleCount }, (_, index) => index + 1).map((hole) => (
                      <button
                        type="button"
                        key={hole}
                        data-selected={pendingHoleNumber === hole ? "true" : "false"}
                        aria-pressed={pendingHoleNumber === hole}
                        aria-label={`Start on hole ${hole}`}
                        onClick={() => setPendingHoleNumber(hole)}
                      >
                        <strong>{hole}</strong>
                        <small>{pendingHoleNumber === hole ? "START" : "HOLE"}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="round-setup-field">
                  <div className="round-setup-field-heading">
                    <span>ROUND OPTIONS</span>
                    <small>CHANGE ANYTIME IN MENU</small>
                  </div>
                  <div className="round-option-list">
                    <div className="round-option-row">
                      <span><strong>TOURNAMENT MODE</strong><small>Keep score for a competition round.</small></span>
                      <button type="button" aria-label="Tournament mode" aria-pressed={roundSetup.tournamentMode} data-on={roundSetup.tournamentMode ? "true" : "false"} onClick={() => setRoundSetup((current) => ({ ...current, tournamentMode: !current.tournamentMode }))}>{roundSetup.tournamentMode ? "ON" : "OFF"}</button>
                    </div>
                    <div className="round-option-row">
                      <span><strong>HANDICAP SCORING</strong><small>Not connected. Gross scores only.</small></span>
                      <button type="button" aria-label="Handicap scoring" disabled>—</button>
                    </div>
                    <div className="round-option-row">
                      <span><strong>TRACK FITNESS DATA</strong><small>Save walk distance with this round.</small></span>
                      <button type="button" aria-label="Track fitness data" aria-pressed={roundSetup.trackFitness} data-on={roundSetup.trackFitness ? "true" : "false"} onClick={() => setRoundSetup((current) => ({ ...current, trackFitness: !current.trackFitness }))}>{roundSetup.trackFitness ? "ON" : "OFF"}</button>
                    </div>
                  </div>
                  <div className="round-setup-selects">
                    <label><span>GAME TYPE</span><select value={roundSetup.gameType} onChange={(event) => setRoundSetup((current) => ({ ...current, gameType: event.target.value as RoundGameType }))}>{ROUND_GAME_TYPE_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
                    <label><span>SCORING</span><select value={roundSetup.scoringSystem} onChange={(event) => setRoundSetup((current) => ({ ...current, scoringSystem: event.target.value as RoundScoringSystem }))}>{ROUND_SCORING_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
                  </div>
                </div>
              </div>
              <button className="sheet-primary-button" type="button" onClick={() => startRound(pendingCourse, pendingHoleNumber)}>START ROUND</button>
              <button className="sheet-secondary-button" type="button" onClick={() => commitCourseSelection(pendingCourse, pendingHoleNumber)}>CONFIRM COURSE</button>
              <button className="sheet-secondary-button" type="button" onClick={() => setPendingCourse(null)}>CANCEL</button>
            </div>
          ) : null}
          {!pendingCourse && catalogResults.length > 0 ? (
            <div className="course-results" aria-label="Course search results">
              {catalogResults.map((course) => (
                <button type="button" className="course-result" key={course.id} onClick={() => { keyboard.hide(); setPendingHoleNumber(course.id === selectedCourse?.id ? Math.min(selectedHoleNumber, course.holes ?? 18) : 1); setPendingCourse(course); }}>
                  <span>
                    <strong>{course.name}</strong>
                    <small>{[course.city, course.state].filter(Boolean).join(", ") || course.country}</small>
                  </span>
                  <b>{course.holes ? `${course.holes}H` : "—"}</b>
                </button>
              ))}
            </div>
          ) : null}
          {!pendingCourse && catalogLoadState === "ready" && catalogResults.length === 0 ? <div className="course-empty-state">NO MATCHING COURSES</div> : null}
          {selectedCourse ? (
            <div className="course-current-card">
              <div>
                <span>ACTIVE ROUND COURSE</span>
                <strong>{selectedCourse.name}</strong>
                <small>{`HOLE ${selectedHoleNumber} · ${roundSetup.teeBox.toUpperCase()} TEE · ${geometryLoadState === "loading" ? "LOADING GEOMETRY" : currentHoleGeometry ? `GRADE ${currentHoleGeometry.quality.grade}` : "GEOMETRY NOT READY"}`}</small>
              </div>
              <button className="sheet-secondary-button" type="button" onClick={() => setPendingCourse(selectedCourse)}>EDIT ROUND SETUP</button>
              <button className="sheet-secondary-button" type="button" onClick={resetSelectedCourse}>RETURN TO DEMO</button>
            </div>
          ) : null}
          <p className="course-attribution">Catalog: OpenGolfAPI release v2.1.0. Personal course seeds: Squaw Valley Apache Links and Comanche Lakes. Hole layers: OpenStreetMap via Overpass, © OpenStreetMap contributors. Pin and hazard distances are withheld when geometry quality is insufficient.</p>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "club"}
        onOpenChange={(open) => setActiveSheet(open ? "club" : null)}
        title={`Club for ${clubSelectorTargetYards} yd`}
        snap={0.82}
      >
        {clubPreviewItem ? (
          <div className="club-selector-concept-3" data-testid="club-selector-concept-3">
            <header className="club-selector-header">
              <button type="button" onClick={() => setActiveSheet(null)} aria-label="Close club selector">
                <Cross2Icon aria-hidden="true" />
              </button>
              <strong>CLUB FOR <b>{clubSelectorTargetYards}</b> YD</strong>
            </header>
            <div className="club-distance-ladder">
              <div
                className="club-distance-ladder-scroll"
                ref={clubLadderRef}
                data-scroll-edge={clubLadderEdge}
                role="region"
                aria-label="Nearby clubs by True Distance"
                tabIndex={0}
                onScroll={(event) => {
                  const ladder = event.currentTarget;
                  const maxScrollTop = Math.max(0, ladder.scrollHeight - ladder.clientHeight);
                  const edgeTolerance = 1;
                  setClubLadderEdge(
                    ladder.scrollTop <= edgeTolerance
                      ? "top"
                      : maxScrollTop - ladder.scrollTop <= edgeTolerance
                        ? "bottom"
                        : "middle",
                  );
                }}
              >
                <span
                  className="club-distance-target"
                  data-testid="club-distance-target"
                  style={{ "--club-target-row-position": clubEvidence.targetRowPosition } as CSSProperties}
                  aria-hidden="true"
                >
                  <b>{clubEvidence.targetYards}</b> YD<i />
                </span>
               {clubSelectorItems.map((item, index) => {
                  return (
                    <button
                      className="club-ladder-option"
                      data-club-id={item.clubId}
                      data-caddy={item.caddyPick ? "true" : "false"}
                      data-preview={item.previewed ? "true" : "false"}
                      data-current={item.currentPick ? "true" : "false"}
                      data-edge-position={index === 0 ? "first" : index === clubSelectorItems.length - 1 ? "last" : undefined}
                      type="button"
                      key={item.clubId}
                      onClick={() => setClubPickerPreviewId(item.clubId)}
                      onDoubleClick={() => selectApproachClub(item.clubId)}
                      aria-pressed={item.previewed}
                      aria-label={item.accessibleLabel}
                    >
                      <span className="club-ladder-ruler-tick" data-yards={item.trueDistanceYards} aria-hidden="true">
                        <b>{item.trueDistanceYards}</b><i />
                      </span>
                      {item.caddyPick ? (
                        <span
                          className="club-ladder-caddy-pointer"
                          data-testid="club-distance-caddy-pointer"
                          data-yards={item.trueDistanceYards}
                          aria-hidden="true"
                        >
                          <TriangleRightIcon />
                        </span>
                      ) : null}
                      {item.caddyPick ? <span className="club-ladder-pick">CADDY PICK</span> : null}
                      <span className="club-ladder-name"><strong>{item.displayCode}</strong><small>{item.label.toUpperCase()}</small></span>
                      <span className="club-ladder-distance"><strong>{item.trueDistanceYards}</strong><small>YD</small><b data-direction={item.deltaYards >= 0 ? "long" : "short"}>{`${item.deltaYards >= 0 ? "+" : ""}${item.deltaYards} YD`}</b></span>
                      {item.currentPick && !item.caddyPick ? <span className="club-ladder-your-pick">YOUR PICK</span> : null}
                    </button>
                  );
                })}
              </div>
              <div className="club-distance-ruler" data-testid="club-distance-ruler" aria-hidden="true">
                <div className="club-distance-ruler-axis" />
                <DoubleArrowUpIcon className="club-distance-ruler-cap club-distance-ruler-cap-top" />
                <DoubleArrowDownIcon className="club-distance-ruler-cap club-distance-ruler-cap-bottom" />
              </div>
            </div>

            <section className="club-evidence-card" aria-label={`${clubPreviewItem.label} True Distance evidence`}>
              <div className="club-true-distance-block">
                <span>TRUE DISTANCE</span>
                <div><strong data-testid="club-true-distance">{clubPreviewItem.trueDistanceYards}</strong><small>YD</small></div>
                <p data-testid="club-evidence-summary">{clubPreviewItem.summary}</p>
              </div>

              <div className="club-evidence-metrics">
                <div><span>CARRY</span><strong>{clubPreviewItem.carryYards || "—"}</strong><small>YD</small></div>
                <div><span>TOTAL</span><strong>{clubPreviewItem.totalYards || "—"}</strong><small>YD</small></div>
              </div>
              <div className="club-evidence-dispersion">
                <span>DISPERSION (FROM TARGET)</span>
                {clubPreviewItem.dispersion.circular ? (
                  <strong>{`CIRCLE ±${DEFAULT_DISPERSION_RADIUS_YARDS} YD`}</strong>
                ) : (
                  <strong><b>{`${clubPreviewItem.dispersion.envelope.leftYards}L`}</b> / {`${clubPreviewItem.dispersion.envelope.rightYards}R`} <i /> <b>{`${clubPreviewItem.dispersion.envelope.shortYards}S`}</b> / {`${clubPreviewItem.dispersion.envelope.longYards}L`}</strong>
                )}
              </div>
              <div className="club-evidence-equipment">{clubPreviewItem.equipmentSummary}</div>

              <div className="club-sample-plot" aria-label="Last 10 shot distances">
                <span className="club-sample-title">LAST 10 SHOTS (YD)</span>
                {clubPreviewItem.plotSamples.length > 0 ? (
                  <div className="club-sample-list">
                    {clubPreviewItem.plotSamples.map((sample, index) => (
                      <span className="club-sample" data-included={sample.included ? "true" : "false"} key={`${sample.yards}-${index}`} style={{ "--sample-height": `${sample.heightPx}px` } as CSSProperties}>
                        <b>{sample.yards}</b><i aria-hidden="true" />
                      </span>
                    ))}
                  </div>
                ) : <p className="club-sample-empty">Record GPS shots to build True Distance.</p>}
              </div>

              <button className="club-use-button" type="button" onClick={() => selectApproachClub(clubPreviewItem.clubId)}>{`USE ${clubPreviewItem.label.toUpperCase()}`}</button>
              <button className="club-view-bag-button" type="button" onClick={openEquipmentSheet} data-testid="view-full-bag-from-club">VIEW FULL BAG</button>
            </section>
          </div>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "equipment"}
        onOpenChange={(open) => {
          if (!open) cancelEquipmentEdit();
          setActiveSheet(open ? "equipment" : null);
        }}
        title="Manage 14-club bag"
        description="Edit your equipment locally. Shot planning and GPS evidence stay unchanged."
        snap={0.9}
      >
        <div className="equipment-sheet" data-testid="equipment-sheet">
          <div className="equipment-sheet-summary">
            <div>
              <strong>{equipment.length}/{EQUIPMENT_LIMIT} CLUBS</strong>
              <small>STIX · NICHOLAS EDITION</small>
            </div>
            <span>{activeEquipment.length} ACTIVE · {retiredEquipment.length} RETIRED · {EQUIPMENT_LIMIT - equipment.length} OPEN</span>
          </div>
          <div className="equipment-status-tabs" role="tablist" aria-label="Equipment status">
            <button
              type="button"
              role="tab"
              aria-selected={equipmentStatusFilter === "active"}
              data-selected={equipmentStatusFilter === "active" ? "true" : "false"}
              onClick={() => setEquipmentStatusFilter("active")}
            >
              ACTIVE <small>{activeEquipment.length}</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={equipmentStatusFilter === "retired"}
              data-selected={equipmentStatusFilter === "retired" ? "true" : "false"}
              onClick={() => setEquipmentStatusFilter("retired")}
            >
              RETIRED <small>{retiredEquipment.length}</small>
            </button>
          </div>
          {equipmentError ? <div className="equipment-error" role="alert">{equipmentError}</div> : null}
          {equipmentDraft ? (
            <div className="equipment-editor" data-testid="equipment-editor">
              <div className="equipment-editor-heading">
                <strong>{equipmentEditorId === "new" ? "ADD CLUB" : "EDIT CLUB"}</strong>
                <button type="button" className="equipment-icon-button" onClick={cancelEquipmentEdit} aria-label="Cancel equipment edit"><Cross2Icon /></button>
              </div>
              <div className="equipment-form-grid">
                <label><span>CLUB NAME</span><KeyboardInput value={equipmentDraft.name} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, name: event.target.value })} maxLength={40} autoComplete="off" /></label>
                <label><span>BRAND</span><KeyboardInput value={equipmentDraft.brand} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, brand: event.target.value })} maxLength={40} autoComplete="off" /></label>
                <label><span>MODEL</span><KeyboardInput value={equipmentDraft.model} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, model: event.target.value })} maxLength={60} autoComplete="off" /></label>
                <label><span>TYPE</span><select value={equipmentDraft.type} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, type: event.target.value as EquipmentType })}>{EQUIPMENT_TYPES.map((type) => <option value={type} key={type}>{type.toUpperCase()}</option>)}</select></label>
                <label><span>LOFT °</span><KeyboardInput inputMode="decimal" type="number" min="0.1" max="80" step="0.5" value={equipmentDraft.loft} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, loft: event.target.value })} placeholder="—" /></label>
                <label><span>CARRY YD</span><KeyboardInput inputMode="numeric" type="number" min="1" max="400" step="1" value={equipmentDraft.carryYards} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, carryYards: event.target.value })} placeholder="—" /></label>
                <label><span>TOTAL YD</span><KeyboardInput inputMode="numeric" type="number" min="1" max="500" step="1" value={equipmentDraft.totalYards} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, totalYards: event.target.value })} placeholder="—" /></label>
              </div>
              <div className="equipment-editor-actions">
                <button className="sheet-primary-button" type="button" onClick={saveEquipmentDraft} data-testid="save-equipment">SAVE CLUB</button>
                <button className="sheet-secondary-button" type="button" onClick={cancelEquipmentEdit}>CANCEL</button>
              </div>
            </div>
          ) : null}
          <div className="equipment-section" aria-label={`${equipmentStatusFilter} equipment`}>
            <div className="equipment-section-heading">
              <strong>{equipmentStatusFilter === "active" ? "ACTIVE CLUBS" : "RETIRED CLUBS"}</strong>
              <span>{visibleEquipment.length} RECORD{visibleEquipment.length === 1 ? "" : "S"}</span>
            </div>
            <div className="equipment-list" aria-label="Equipment inventory">
              {visibleEquipment.map((club) => (
                <div className={`equipment-row equipment-row-${club.status}`} key={club.id} data-testid={`equipment-row-${club.id}`}>
                  <div className="equipment-row-index" aria-hidden="true">{club.slot}</div>
                  <div className="equipment-row-copy">
                    <strong>{club.name}</strong>
                    <span>{[club.brand, club.model].filter(Boolean).join(" · ") || "No brand or model"}</span>
                    <small>{club.status.toUpperCase()} · {club.type.toUpperCase()} · {club.loft === null ? "LOFT —" : `${club.loft}°`} · {club.carryYards === null ? "CARRY —" : `${club.carryYards} YD`} · {club.totalYards === null ? "TOTAL —" : `${club.totalYards} YD`}</small>
                  </div>
                  <div className="equipment-row-actions">
                    <button
                      className="equipment-status-button"
                      type="button"
                      data-testid={`equipment-status-${club.id}`}
                      onClick={() => changeEquipmentStatus(club, club.status === "active" ? "retired" : "active")}
                      aria-label={`${club.status === "active" ? "Retire" : "Restore"} ${club.name}`}
                    >
                      {club.status === "active" ? "RETIRE" : "RESTORE"}
                    </button>
                    <button type="button" onClick={() => startEquipmentEdit(club)} aria-label={`Edit ${club.name}`}><Pencil2Icon /></button>
                    <button type="button" onClick={() => deleteEquipmentClub(club)} aria-label={`Delete ${club.name}`}><Cross2Icon /></button>
                  </div>
                </div>
              ))}
              {visibleEquipment.length === 0 ? (
                <div className="equipment-empty-state">
                  <strong>{equipmentStatusFilter === "active" ? "NO ACTIVE CLUBS" : "NO RETIRED CLUBS"}</strong>
                  <span>{equipmentStatusFilter === "active" ? "Restore a retired club to add it back to Add Shot." : "Retired clubs stay here until you restore or remove them."}</span>
                  {equipmentStatusFilter === "active" && retiredEquipment.length > 0 ? <button type="button" onClick={() => setEquipmentStatusFilter("retired")}>VIEW RETIRED</button> : null}
                </div>
              ) : null}
            </div>
          </div>
          <button className="sheet-secondary-button" type="button" onClick={() => { setEquipmentStatusFilter("active"); startEquipmentAdd(); }} disabled={equipment.length >= EQUIPMENT_LIMIT} data-testid="add-equipment">
            <PlusIcon /> ADD CLUB
          </button>
          <button className="sheet-secondary-button equipment-reset-button" type="button" onClick={resetEquipmentBag} data-testid="reset-equipment">
            <ReloadIcon /> RESET DEFAULT BAG
          </button>
          <small className="sheet-footnote">Equipment details are stored only on this phone. The caddy’s deterministic profiles remain unchanged.</small>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "field-log"}
        onOpenChange={(open) => {
          if (!open) setFieldLogError("");
          setActiveSheet(open ? "field-log" : null);
        }}
        title="On-course field log"
        description="Capture evidence for this phone and course. Blank measurements stay blank; nothing is invented."
        snap={0.94}
      >
        <div className="field-log-sheet" data-testid="field-log-sheet">
          <div className="field-log-context" data-testid="field-log-context">
            <div>
              <span>ACTIVE COURSE · HOLE {courseDisplayHole}</span>
              <strong>{courseDisplayName}</strong>
            </div>
            <div className="field-log-context-meta">
              <span>TEE {roundSetup.teeBox.toUpperCase()} · GEOMETRY {fieldLogGeometryGrade} · {fieldLogGeometryVersion}</span>
              <span>GPS {gpsLabel(gpsHealth, gpsAccuracyMeters)} · MAP {mapProvider.toUpperCase()}</span>
            </div>
          </div>
          {fieldLogError ? <div className="field-log-error" role="alert">{fieldLogError}</div> : null}
          <div className="field-log-form">
             <label className="field-log-field field-log-field-wide">
               <span>DEVICE LABEL</span>
              <KeyboardInput
                value={fieldLogDraft.device}
                onChange={(event) => setFieldLogDraft((current) => ({ ...current, device: event.target.value.slice(0, 80) }))}

                maxLength={80}
                autoComplete="off"
               data-testid="field-log-device"
              />
            </label>
            <div className="field-log-capture-row">
              <button
                className="sheet-secondary-button field-log-capture-button"
                type="button"
                onClick={captureFieldLogFreshFix}
                disabled={fieldLogGpsCaptureState === "capturing"}
                data-testid="capture-field-log-fix"
                aria-label="Capture fresh GPS fix"
              >
                {fieldLogGpsCaptureState === "capturing" ? "READING GPS…" : "CAPTURE FRESH FIX"}
              </button>
              <small>Fills accuracy and fix age from this phone. Enter trusted distances separately.</small>
            </div>
            <div className="field-log-pair-row" data-testid="field-log-gps-pair">
              <button
                className={`sheet-secondary-button field-log-capture-button${fieldLogGpsPairState === "ready" ? " field-log-pair-ready" : ""}`}
                type="button"
                onClick={captureFieldLogGpsPair}
                disabled={fieldLogGpsCaptureState === "capturing" || fieldLogGpsPairState === "capturing-start" || fieldLogGpsPairState === "capturing-end"}
                data-testid="capture-field-log-pair"
                aria-label={fieldLogGpsPairState === "waiting-end" ? "Capture GPS end fix" : fieldLogGpsPairState === "ready" ? "Reset GPS pair" : "Capture GPS start fix"}
              >
                {fieldLogGpsPairState === "capturing-start" || fieldLogGpsPairState === "capturing-end"
                  ? "READING GPS…"
                  : fieldLogGpsPairState === "waiting-end"
                    ? "CAPTURE GPS END"
                    : fieldLogGpsPairState === "ready"
                      ? "RESET GPS PAIR"
                      : "CAPTURE GPS START"}
              </button>
              <small>
                {fieldLogGpsPairState === "waiting-end"
                  ? "Start saved. Walk 50–100 yards, then capture the end fix."
                  : fieldLogGpsPairState === "ready"
                    ? "Two fresh fixes measured the recorded distance; expected yards stay trusted/manual."
                    : "Measures a walked distance from two fresh phone fixes and keeps both endpoints in the export."}
              </small>
            </div>
            <div className="field-log-grid">
              <label className="field-log-field"><span>EXPECTED YD</span><input data-testid="field-log-expected" inputMode="decimal" type="number" min="0.1" max="500" step="1" value={fieldLogDraft.expectedYards} onChange={(event) => setFieldLogDraft((current) => ({ ...current, expectedYards: event.target.value }))} placeholder="—" /></label>
              <label className="field-log-field"><span>RECORDED YD</span><input data-testid="field-log-recorded" readOnly={fieldLogGpsPairState === "waiting-end" || fieldLogGpsPair !== null} inputMode="decimal" type="number" min="0" max="500" step="1" value={fieldLogDraft.recordedYards} onChange={(event) => setFieldLogDraft((current) => ({ ...current, recordedYards: event.target.value }))} placeholder="—" /></label>
              <label className="field-log-field"><span>GPS ACCURACY M</span><input data-testid="field-log-accuracy" readOnly={fieldLogGpsPairState === "waiting-end" || fieldLogGpsPair !== null} inputMode="decimal" type="number" min="0" max="100" step="1" value={fieldLogDraft.accuracyMeters} onChange={(event) => setFieldLogDraft((current) => ({ ...current, accuracyMeters: event.target.value }))} placeholder="—" /></label>
              <label className="field-log-field"><span>GPS FIX AGE S</span><input data-testid="field-log-fix-age" readOnly={fieldLogGpsPairState === "waiting-end" || fieldLogGpsPair !== null} inputMode="decimal" type="number" min="0" max={FIELD_LOG_MAX_RECORDED_FIX_AGE_SECONDS} step="1" value={fieldLogDraft.fixAgeSeconds} onChange={(event) => setFieldLogDraft((current) => ({ ...current, fixAgeSeconds: event.target.value }))} placeholder="—" /></label>
            </div>
            <label className="field-log-field field-log-field-wide"><span>IMAGERY PROVIDER</span><select data-testid="field-log-provider" value={fieldLogDraft.provider} onChange={(event) => setFieldLogDraft((current) => ({ ...current, provider: event.target.value as FieldLogImageryProvider }))}><option value="usgs">USGS / USDA NAIP</option><option value="google" disabled={!GOOGLE_MAPS_API_KEY}>Google satellite{GOOGLE_MAPS_API_KEY ? "" : " (key required)"}</option><option value="bundled">Bundled offline imagery</option></select></label>
            <div className={`field-log-alignment${fieldLogGeometryGrade === "C" || fieldLogGeometryGrade === "D" ? " field-log-alignment-disabled" : ""}`}>
              <div className="field-log-section-heading"><span>OVERLAY ALIGNMENT</span><small>{fieldLogGeometryGrade === "C" || fieldLogGeometryGrade === "D" ? "UNAVAILABLE FOR THIS GRADE" : "OPTIONAL · CHECK BOTH ZOOMS"}</small></div>
              <div className="field-log-grid">
                <label className="field-log-field"><span>LATERAL YD</span><input data-testid="field-log-lateral" disabled={fieldLogGeometryGrade === "C" || fieldLogGeometryGrade === "D"} inputMode="decimal" type="number" min="0" max="200" step="1" value={fieldLogDraft.lateralYards} onChange={(event) => setFieldLogDraft((current) => ({ ...current, lateralYards: event.target.value }))} placeholder="—" /></label>
                <label className="field-log-field"><span>LONGITUDINAL YD</span><input data-testid="field-log-longitudinal" disabled={fieldLogGeometryGrade === "C" || fieldLogGeometryGrade === "D"} inputMode="decimal" type="number" min="0" max="200" step="1" value={fieldLogDraft.longitudinalYards} onChange={(event) => setFieldLogDraft((current) => ({ ...current, longitudinalYards: event.target.value }))} placeholder="—" /></label>
              </div>
            </div>
            <div className="field-log-checks">
              <label className="field-log-check"><input type="checkbox" checked={fieldLogDraft.attributionVisible} onChange={(event) => setFieldLogDraft((current) => ({ ...current, attributionVisible: event.target.checked }))} /><span>Attribution visible on the map</span></label>
              <label className="field-log-check"><input data-testid="field-log-aligned-1x" type="checkbox" disabled={fieldLogGeometryGrade === "C" || fieldLogGeometryGrade === "D"} checked={fieldLogDraft.alignmentAtOneX} onChange={(event) => setFieldLogDraft((current) => ({ ...current, alignmentAtOneX: event.target.checked }))} /><span>Overlay aligned at 1×</span></label>
              <label className="field-log-check"><input data-testid="field-log-aligned-2x" type="checkbox" disabled={fieldLogGeometryGrade === "C" || fieldLogGeometryGrade === "D"} checked={fieldLogDraft.alignmentAtTwoX} onChange={(event) => setFieldLogDraft((current) => ({ ...current, alignmentAtTwoX: event.target.checked }))} /><span>Overlay aligned at 2×</span></label>
            </div>
            <label className="field-log-field field-log-field-wide"><span>NOTE (OPTIONAL)</span><textarea data-testid="field-log-note" value={fieldLogDraft.note} onChange={(event) => setFieldLogDraft((current) => ({ ...current, note: event.target.value.slice(0, 500) }))} maxLength={500} rows={2} placeholder="What did you observe on the course?" /></label>
            <div className="field-log-actions">
              <button className="sheet-primary-button" type="button" onClick={saveFieldLogRun} data-testid="save-field-log">SAVE RUN</button>
              <button className="sheet-secondary-button" type="button" onClick={exportFieldLog} data-testid="export-field-log">EXPORT JSON</button>
            </div>
          </div>
          <div className="field-log-history" data-testid="field-log-history">
            <div className="field-log-history-heading"><span>SAVED RUNS · {fieldLog.runs.length}/{FIELD_LOG_LIMIT}</span>{fieldLog.runs.length > 0 ? <button type="button" onClick={clearFieldLogEntries} data-testid="clear-field-log">CLEAR ALL</button> : null}</div>
            {fieldLog.runs.length > 0 ? fieldLog.runs.slice().reverse().map((run) => (
              <div className="field-log-run" key={run.id} data-testid={`field-log-run-${run.id}`}>
                <div>
                  <strong>{run.courseId === DEMO_OPENROUND_COURSE.id ? "DEMO FIXTURE" : run.courseId} · HOLE {run.hole}</strong>
                  <span>{run.teeBox ? `${run.teeBox.toUpperCase()} TEE · ` : ""}{run.geometryGrade} · {run.gps.length > 0 ? `${run.gps[0]!.recordedYards} YD GPS${run.gps[0]!.fixAgeSeconds === undefined ? "" : ` · ${run.gps[0]!.fixAgeSeconds} S FIX`}` : "GPS MEASUREMENT MISSING"} · {run.imagery.provider.toUpperCase()}</span>
                </div>
                <button type="button" onClick={() => removeFieldLogEntry(run.id)} aria-label={`Remove field log run ${run.id}`}>REMOVE</button>
              </div>
            )) : <small className="field-log-empty">No runs saved yet. Use this sheet after checking GPS and map alignment on the course.</small>}
          </div>
          <small className="sheet-footnote">Local-only beta evidence. Export the JSON after a course session for review; it does not upload or claim production map accuracy.</small>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "menu"}
        onOpenChange={(open) => setActiveSheet(open ? "menu" : null)}
        title="Menu"
        description="Your round, map and playing tools."
        snap={0.9}
      >
        <div className="sheet-stack menu-sheet" data-testid="menu-sheet">
          <div className="menu-readout">
            <div>
              <span>{`HOLE ${courseIsDemo ? 7 : selectedHoleNumber}`}</span>
              <strong>{score} STROKES</strong>
            </div>
            <small>{tracking ? `TRACKING ${tracking.club}` : shotLegCompleted ? "SHOT LEG COMPLETE" : "READY FOR NEXT SHOT"}</small>
          </div>
          <button className="sheet-secondary-button" type="button" onClick={() => openCourseSheet()}> <TargetIcon /> CHOOSE COURSE</button>
              <button className="menu-tool-button" type="button" onClick={() => setActiveSheet("smart")} data-testid="menu-smart-tracking">
                <strong>SMART TRACKING</strong><span>{nativeTrackingAvailable ? "POCKET CAPTURE & REVIEW" : "NATIVE IPHONE PREVIEW"}</span>
              </button>
          <section className="menu-tool-section" aria-label="Map tools">
            <span className="sheet-kicker">MAP & DISTANCES</span>
            <div className="menu-tool-grid">
              <button className="menu-tool-button" type="button" onClick={toggleMapLayer} data-testid="menu-map-layer">
                <strong>MAP LAYER</strong>
                <span>{onCourseState.mapLayer === "satellite" ? "SATELLITE" : "ILLUSTRATION"}</span>
              </button>
              <button className="menu-tool-button" type="button" onClick={cycleGreenMap} data-testid="menu-green-map">
                <strong>GREEN MAP</strong>
                <span>{onCourseState.greenMapMode === "off" ? "OFF" : onCourseState.greenMapMode === "approach" ? "APPROACH HEAT" : "PUTT BREAKS"}</span>
              </button>
              <button className="menu-tool-button" type="button" onClick={toggleDistanceArcs} data-testid="menu-distance-arcs" aria-pressed={onCourseState.distanceArcs}>
                <strong>DISTANCE ARCS</strong>
                <span>{onCourseState.distanceArcs ? "ON" : "OFF"}</span>
              </button>
              <button className="menu-tool-button" type="button" onClick={toggleBlindShot} data-testid="menu-blind-shot" aria-pressed={onCourseState.blindShot}>
                <strong>BLIND SHOT</strong>
                <span>{onCourseState.blindShot ? "FLAG GUIDE ON" : "FLAG GUIDE OFF"}</span>
              </button>
              <button className="menu-tool-button" type="button" onClick={toggleAutoZoom} data-testid="menu-auto-zoom" aria-pressed={onCourseState.autoZoom}>
                <strong>AUTO ZOOM</strong>
                <span>{onCourseState.autoZoom ? "ON" : "OFF"}</span>
              </button>
            </div>
          </section>
          <section className="menu-tool-section" aria-label="playing tools">
            <span className="sheet-kicker">PLAYING TOOLS</span>
            <div className="menu-tool-grid">
              <button className="menu-tool-button" type="button" onClick={() => setActiveSheet("coach")} data-testid="menu-coach">
                <strong>LIVE COACH</strong>
                <span>{onCourseState.lie.toUpperCase()} LIE</span>
              </button>
              <button className="menu-tool-button" type="button" onClick={openWeatherSheet} data-testid="menu-weather">
                <strong>LIVE WEATHER</strong>
                <span>{onCourseState.weather.temperatureF}°F · {onCourseState.weather.windMph} MPH</span>
              </button>
              <button className="menu-tool-button" type="button" onClick={() => setActiveSheet("conditions")} data-testid="menu-conditions">
                <strong>PLAYING CONDITIONS</strong>
                <span>{playingConditions.temperatureF}°F · {playingConditions.windMph} MPH {windDirectionLabel(playingConditions.windDirection)}</span>
              </button>
              <button className="menu-tool-button" type="button" onClick={() => setActiveSheet("planner")} data-testid="menu-tee-planner">
                <strong>TEE PLANNER</strong>
                <span>{teeShotPlan.avoidZones.length > 0 ? `${teeShotPlan.avoidZones.length} AVOID ZONE${teeShotPlan.avoidZones.length === 1 ? "" : "S"}` : "WIDEST FAIRWAY"}</span>
              </button>
            </div>
          </section>
          <section className="menu-tool-section" aria-label="shots & insights">
            <span className="sheet-kicker">SHOTS & INSIGHTS</span>
            <div className="menu-tool-grid">
              <button className="menu-tool-button" type="button" onClick={openTrackSheet} data-testid="menu-track-shots">
                <strong>TRACK SHOTS</strong>
                <span>{onCourseState.shotSamples.length} GPS SAMPLE{onCourseState.shotSamples.length === 1 ? "" : "S"}</span>
              </button>
              <button className="menu-tool-button" type="button" onClick={openMissSheet} data-testid="menu-miss-details">
                <strong>MISS DETAILS</strong>
                <span>{onCourseRoundStats.misses} MISS{onCourseRoundStats.misses === 1 ? "" : "ES"} LOGGED</span>
              </button>
              <button className="menu-tool-button" type="button" onClick={() => setActiveSheet("targets")} data-testid="menu-targets">
                <strong>ROUND TARGETS</strong>
                <span>{targetProgress.birdies}/{onCourseState.targets.birdies} BIRDIES · {targetProgress.gir}/{onCourseState.targets.gir} GIR</span>
              </button>
            </div>
          </section>
          <details className="menu-details">
            <summary>Course & app details</summary>
            <button className="menu-quick-button" type="button" onClick={openFieldLogSheet} data-testid="menu-field-log">
              <BarChartIcon />
              <span><strong>FIELD LOG</strong><small>{fieldLog.runs.length} RUN{fieldLog.runs.length === 1 ? "" : "S"} SAVED</small></span>
            </button>
          {courseIsDemo && <div className="local-status-card">
            <strong>DETERMINISTIC CADDY</strong>
            <span>{selectedProfile.offsets.length}-shot {selectedProfile.label} demo profile · static hole fixture</span>
          </div>}
          <div className="local-status-card">
            <strong>{courseIsDemo ? "COURSE LIBRARY · DEMO FIXTURE" : "COURSE LIBRARY · COURSE SELECTED"}</strong>
            <span>
              {courseIsDemo ? `${DEMO_OPENROUND_COURSE.name} · OpenGolfAPI adapter · ${DEMO_OPENROUND_COURSE.source.version}` : `${selectedCourse?.name} · OpenGolfAPI ${selectedCourse?.sourceVersion}`}
            </span>
            <small>
              {courseIsDemo
                ? `Hole 7 geometry ${DEMO_OPENROUND_COURSE.geometryStatus}; missing ${DEMO_HOLE_7_READINESS.missing.join(", ") || "verified layers"}.`
                : currentHoleGeometry
                  ? `Hole ${selectedHoleNumber} geometry grade ${currentHoleGeometry.quality.grade}; ${currentHoleGeometry.quality.pinUsable ? "pin verified" : "pin not verified"}.`
                  : geometryLoadState === "loading"
                    ? `Loading geometry for hole ${selectedHoleNumber}…`
                  : "No usable hole geometry loaded."}
            </small>
          </div>
          <div className="local-status-card map-provider-card">
            <strong>{mapProvider === "google" ? "GOOGLE SATELLITE" : "SATELLITE PREVIEW"}</strong>
            <span>
              {mapProvider === "google"
                ? "Live Google imagery is connected for this map view."
                : GOOGLE_MAPS_API_KEY
                  ? "Google imagery is unavailable for this session; live USGS / USDA NAIP imagery is shown instead."
                  : "Live USGS / USDA NAIP imagery is shown here; add the Google Maps key to switch providers."}
            </span>
          </div>
          {courseIsDemo && <>
          <div className="sheet-section">
            <span className="sheet-kicker">GPS DEMO STATE</span>
            <div className="segmented-control">
              {(["fresh", "stale", "unavailable"] as const).map((health) => (
                <button
                  type="button"
                  key={health}
                  aria-pressed={gpsHealth === health}
                  onClick={() => setGpsHealth(health)}
                >
                  {health}
                </button>
              ))}
            </div>
            <small>The prototype uses deterministic foreground fixes so lock behavior is repeatable.</small>
          </div>
          <button
            className="sheet-secondary-button"
            type="button"
            onClick={resetAimToCaddyPath}
            disabled={!courseIsDemo || shotLegCompleted || committedAim.source === "caddy_path"}
          >
            {shotLegCompleted ? <CheckCircledIcon /> : <TargetIcon />}
            {shotLegCompleted ? "PLAN LOCKED WITH SHOT" : "RESET AIM TO CADDY PATH"}
          </button>
          <button className="sheet-primary-button" type="button" onClick={resetDemo}>
            <ReloadIcon /> RESET HOLE 7 DEMO
          </button>
          </>}
          </details>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "weather"}
        onOpenChange={(open) => setActiveSheet(open ? "weather" : null)}
        title="Live weather"
        description="Local forecast for this course area. Live data is optional; cached and fixture states stay truthful offline."
        snap={0.58}
      >
        <div className="tool-sheet weather-sheet" data-testid="weather-sheet">
          <div className="tool-readout">
            <span data-testid="weather-source">{`LOCAL FORECAST · ${onCourseState.weather.source.toUpperCase()} SOURCE`}</span>
            <strong>{onCourseState.weather.temperatureF}°F</strong>
            <small>{`${onCourseState.weather.condition} · HIGH ${onCourseState.weather.highF}° · LOW ${onCourseState.weather.lowF}°`}</small>
          </div>
          <div className="tool-stat-grid">
            <div><span>WIND</span><strong>{onCourseState.weather.windMph} MPH</strong></div>
            <div><span>CAPTURED</span><strong>{new Date(onCourseState.weather.capturedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong></div>
          </div>
          <p className="tool-copy">{onCourseState.weather.forecast}</p>
          <button className="sheet-primary-button" type="button" onClick={() => void refreshWeather()} disabled={weatherLoadState === "loading"} data-testid="weather-refresh">
            <ReloadIcon /> {weatherLoadState === "loading" ? "REFRESHING LOCAL WEATHER…" : "REFRESH LOCAL WEATHER"}
          </button>
          <small className="sheet-footnote">Open-Meteo is queried only after this control is used. No API key, player account, or shot data is sent.</small>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "coach"}
        onOpenChange={(open) => setActiveSheet(open ? "coach" : null)}
        title="Live coach"
        description="A compact rule set for the current lie. Inputs and cues are local and deterministic."
        snap={0.72}
      >
        <div className="tool-sheet coach-sheet" data-testid="coach-sheet">
          <span className="sheet-kicker">CURRENT LIE · {onCourseState.lie.toUpperCase()}</span>
          <div className="lie-grid" role="group" aria-label="Lie type">
            {(["tee", "fairway", "rough", "bunker", "recovery", "green"] as const).map((lie) => (
              <button key={lie} type="button" data-testid={`coach-lie-${lie}`} aria-pressed={onCourseState.lie === lie} onClick={() => selectLie(lie)}>{lie}</button>
            ))}
          </div>
          <div className="tool-readout tool-readout-compact">
            <span>{coachAdvice.title}</span>
            <strong>{coachAdvice.cue}</strong>
            <small>{coachAdvice.detail}</small>
          </div>
          <div className="tool-meta-row"><span>PLAYING TARGET</span><strong>{currentTargetYards ?? "—"} YD</strong><small>{playingConditions.windMph} MPH {windDirectionLabel(playingConditions.windDirection)}</small></div>
          <small className="sheet-footnote">Coach copy is a deterministic lie rule; it does not call an LLM or infer an unverified lie from imagery.</small>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "planner"}
        onOpenChange={(open) => setActiveSheet(open ? "planner" : null)}
        title="Tee shot planner"
        description="Avoid the first verified trouble and start from the widest playable window."
        snap={0.62}
      >
        <div className="tool-sheet planner-sheet" data-testid="tee-planner-sheet">
          <div className="tool-readout">
            <span>TEE SHOT PLAN</span>
            <strong>{teeShotPlan.summary}</strong>
            <small>{teeShotPlan.note}</small>
          </div>
          <div className="tool-list">
            <span className="sheet-kicker">AVOID ZONES</span>
            {teeShotPlan.avoidZones.length > 0 ? teeShotPlan.avoidZones.map((zone) => <div key={zone} className="tool-list-row"><strong>{zone}</strong><small>KEEP OUT OF THE START LINE</small></div>) : <div className="tool-list-row"><strong>WIDEST FAIRWAY</strong><small>NO VERIFIED TEE HAZARDS LOADED</small></div>}
          </div>
          <small className="sheet-footnote">The demo uses bundled hazard fixtures. Real-course hazards appear only when the loaded geometry meets its completeness gate.</small>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "targets"}
        onOpenChange={(open) => setActiveSheet(open ? "targets" : null)}
        title="Round targets"
        description="Set simple goals for birdies, pars, greens in regulation, and fairways hit."
        snap={0.66}
      >
        <div className="tool-sheet targets-sheet" data-testid="targets-sheet">
          <span className="sheet-kicker">PROGRESS · {onCourseRoundStats.holesPlayed} HOLE{onCourseRoundStats.holesPlayed === 1 ? "" : "S"} PLAYED</span>
          {([
            ["birdies", "BIRDIES"],
            ["pars", "PARS"],
            ["gir", "GIR"],
            ["fairways", "FAIRWAYS"],
          ] as const).map(([key, label]) => (
            <div className="target-row" key={key}>
              <div><strong>{label}</strong><small>{targetProgress[key]} / {onCourseState.targets[key]} COMPLETE</small></div>
              <button type="button" data-testid={`targets-${key}-minus`} aria-label={`Decrease ${label} target`} onClick={() => adjustRoundTarget(key, -1)}>−</button>
              <strong className="target-value">{onCourseState.targets[key]}</strong>
              <button type="button" data-testid={`targets-${key}-plus`} aria-label={`Increase ${label} target`} onClick={() => adjustRoundTarget(key, 1)}>+</button>
            </div>
          ))}
          <div className="target-summary"><span>LOCAL GOALS</span><strong>{targetProgress.birdies} BIRDIES · {targetProgress.pars} PARS · {targetProgress.gir} GIR · {targetProgress.fairways} FAIRWAYS</strong></div>
          <small className="sheet-footnote">Targets persist with this round. Progress is calculated from recorded outcomes; unknown GIR and fairway values remain unknown.</small>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "insights"}
        onOpenChange={(open) => setActiveSheet(open ? "insights" : null)}
        title={`Hole ${currentHoleNumber} insights`}
        description="Review the hole outcome and let local stats automation feed the future Home and Round Overview surfaces."
        snap={0.78}
      >
        <div className="tool-sheet insights-sheet" data-testid="insights-sheet">
          <div className="tool-readout">
            <span>{`HOLE ${currentHoleNumber} · PAR ${holeInsights.par}`}</span>
            <strong>{holeInsights.score ?? "—"} STROKES</strong>
            <small>{holeInsights.scoreToPar === null ? "SCORE NOT RECORDED" : holeInsights.scoreToPar === 0 ? "EVEN TO PAR" : `${Math.abs(holeInsights.scoreToPar)} ${holeInsights.scoreToPar < 0 ? "UNDER" : "OVER"} PAR`}</small>
          </div>
          <div className="insight-editor-row">
            <div><span>PUTTS</span><strong>{puttsDraft ?? "—"}</strong></div>
            <button type="button" data-testid="putts-minus" aria-label="Subtract putt" onClick={() => setPuttsDraft((value) => Math.max(0, (value ?? 0) - 1))}>−</button>
            <button type="button" data-testid="putts-plus" aria-label="Add putt" disabled={puttsDraft !== null && puttsDraft >= score} onClick={() => setPuttsDraft((value) => Math.min(score, (value ?? 0) + 1))}>+</button>
          </div>
          <div className="insight-choice">
            <span>GIR</span>
            <div className="segmented-control" role="group" aria-label="Green in regulation">
              <button type="button" aria-pressed={outcomeGirDraft === true} onClick={() => setOutcomeGirDraft(true)}>YES</button>
              <button type="button" aria-pressed={outcomeGirDraft === false} onClick={() => setOutcomeGirDraft(false)}>NO</button>
              <button type="button" aria-pressed={outcomeGirDraft === null} onClick={() => setOutcomeGirDraft(null)}>—</button>
            </div>
          </div>
          <div className="insight-choice">
            <span>FAIRWAY HIT</span>
            <div className="segmented-control" role="group" aria-label="Fairway hit">
              <button type="button" aria-pressed={outcomeFairwayDraft === true} onClick={() => setOutcomeFairwayDraft(true)}>YES</button>
              <button type="button" aria-pressed={outcomeFairwayDraft === false} onClick={() => setOutcomeFairwayDraft(false)}>NO</button>
              <button type="button" aria-pressed={outcomeFairwayDraft === null} onClick={() => setOutcomeFairwayDraft(null)}>—</button>
            </div>
          </div>
          <div className="tool-stat-grid">
            <div><span>GPS SHOTS</span><strong>{holeInsights.measuredShots}</strong></div>
            <div><span>PENALTIES</span><strong>{holeInsights.penalties}</strong></div>
            <div><span>MISSES</span><strong>{holeInsights.misses}</strong></div>
          </div>
          <button className="sheet-primary-button" type="button" onClick={saveHoleOutcome} data-testid="save-hole-insights"><CheckCircledIcon /> SAVE HOLE STATS</button>
          <div className="stats-automation-card"><span>STATS AUTOMATION · ROUND</span><strong>{onCourseRoundStats.score} STROKES · {onCourseRoundStats.measuredShots} GPS SHOTS</strong><small>{onCourseRoundStats.birdies} birdies · {onCourseRoundStats.pars} pars · {onCourseRoundStats.girKnown} GIR known · {onCourseRoundStats.fairwaysKnown} fairways known</small></div>
          <small className="sheet-footnote">All values are derived from local round events and explicit hole outcomes. No LLM dependency or remote analytics service is used.</small>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "track"}
        onOpenChange={(open) => setActiveSheet(open ? "track" : null)}
        title="Track shots"
        description="GPS-locked distances become samples. Save a reviewed sample to use it in club recommendations."
        snap={0.76}
      >
        <div className="tool-sheet track-sheet" data-testid="track-shots-sheet">
          <div className="tool-readout">
            <span>CLUB RECOMMENDATION</span>
            <strong data-testid="club-recommendation">{clubRecommendation ? `${clubRecommendation.clubName.toUpperCase()} · ${clubRecommendation.distanceYards} YD` : "NO SAVED CLUB DISTANCE"}</strong>
            <small>{clubRecommendation ? `Based on ${clubRecommendation.source}. Target ${currentTargetYards ?? "—"} yd.` : "Add a saved carry or review a tracked sample."}</small>
          </div>
          {trackedShotReview ? (
            <div className="tracked-shot-card" data-testid="tracked-shot-card">
              <div><span>{trackedShotReview.kind === "automatic_drive" ? "AUTOMATIC DRIVE" : "GPS SHOT"}</span><strong>{trackedShotReview.clubName} · {trackedShotReview.yards} YD</strong><small>{`HOLE ${trackedShotReview.holeNumber} · ${trackedShotReview.savedToBag ? "SAVED TO BAG" : "REVIEW REQUIRED"}`}</small></div>
              {!trackedShotReview.savedToBag ? <button className="sheet-primary-button" type="button" onClick={saveTrackedSample} data-testid="save-shot-to-bag">SAVE TO BAG</button> : <CheckCircledIcon aria-label="Saved to bag" />}
            </div>
          ) : <div className="tool-empty">No GPS shot distance captured yet. Lock a fresh phone GPS shot to create one.</div>}
          <div className="sample-list">
            <span className="sheet-kicker">LOCAL SHOT SAMPLES · {onCourseState.shotSamples.length}</span>
            {onCourseState.shotSamples.slice().reverse().slice(0, 6).map((sample) => <div className="sample-row" key={sample.id}><strong>{sample.clubName}</strong><span>{sample.yards} YD</span><small>{sample.kind === "automatic_drive" ? "AUTO DRIVE" : "GPS"} · {sample.savedToBag ? "BAG" : "REVIEW"}</small></div>)}
          </div>
          <button className="sheet-secondary-button" type="button" onClick={openMissSheet}>TRACK MISS DETAILS</button>
          <small className="sheet-footnote">Manual Add Shot entries never create distance samples. Automatic drive tracking is created only from a valid GPS driver event.</small>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "miss"}
        onOpenChange={(open) => setActiveSheet(open ? "miss" : null)}
        title="Track miss details"
        description="Capture the miss target and direction so future round analytics can show patterns."
        snap={0.58}
      >
        <div className="tool-sheet miss-sheet" data-testid="miss-details-sheet">
          <div className="insight-choice">
            <span>TARGET</span>
            <div className="segmented-control" role="group" aria-label="Miss target">
              <button type="button" data-testid="miss-target-fairway" aria-pressed={missTargetDraft === "fairway"} onClick={() => setMissTargetDraft("fairway")}>FAIRWAY</button>
              <button type="button" data-testid="miss-target-green" aria-pressed={missTargetDraft === "green"} onClick={() => setMissTargetDraft("green")}>GREEN</button>
            </div>
          </div>
          <div className="insight-choice">
            <span>DIRECTION</span>
            <div className="lie-grid miss-direction-grid" role="group" aria-label="Miss direction">
              {(["left", "right", "short", "long", "wide"] as const).map((direction) => <button type="button" key={direction} data-testid={`miss-direction-${direction}`} aria-pressed={missDirectionDraft === direction} onClick={() => setMissDirectionDraft(direction)}>{direction}</button>)}
            </div>
          </div>
          <div className="tool-meta-row"><span>CURRENT LIE</span><strong>{onCourseState.lie.toUpperCase()}</strong><small>HOLE {currentHoleNumber}</small></div>
          <button className="sheet-primary-button" type="button" onClick={saveMissDetail} data-testid="save-miss-detail"><CheckCircledIcon /> SAVE MISS DETAIL</button>
          <small className="sheet-footnote">Miss details are additive and local. They do not alter GPS endpoints, score, or aim.</small>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "conditions"}
        onOpenChange={(open) => setActiveSheet(open ? "conditions" : null)}
        title="Plays Like distance"
        description="See the distance, adjustments and club recommendation."
        snap={0.9}
      >
        <div className="conditions-sheet" data-testid="conditions-sheet">
          <div className="conditions-readout">
            <span>PLAYS LIKE</span>
            <strong data-testid="plays-like-total">{currentTargetYards ?? "—"} YD</strong>
            <small>{courseIsDemo ? "Demo target" : "To the selected pin"} · rounded to the nearest yard</small>
          </div>
          <dl className="distance-breakdown" data-testid="distance-breakdown">
            <div><dt>{courseIsDemo ? "Demo target base" : "Actual distance"}<small>{courseIsDemo ? "Fixture includes its base planning offset" : "From the current ball to the selected pin"}</small></dt><dd data-testid="distance-base">{baseTargetYards ?? "—"} yd</dd></div>
            <div><dt>Wind<small>{playingConditions.windMph} mph {windDirectionLabel(playingConditions.windDirection).toLowerCase()} · × {playingConditions.windDirection === "headwind" ? "0.65" : playingConditions.windDirection === "tailwind" ? "−0.45" : "0.10"} yd/mph</small></dt><dd data-testid="distance-wind">{distanceAdjustments.wind > 0 ? "+" : ""}{distanceAdjustments.wind.toFixed(2)} yd</dd></div>
            <div><dt>Elevation change<small>Manual uphill/downhill yardage adjustment</small></dt><dd>{distanceAdjustments.elevation > 0 ? "+" : ""}{distanceAdjustments.elevation} yd</dd></div>
            <div><dt>Temperature<small>(72°F − {playingConditions.temperatureF}°F) × 0.08 yd/°F</small></dt><dd>{distanceAdjustments.temperature > 0 ? "+" : ""}{distanceAdjustments.temperature.toFixed(2)} yd</dd></div>
            <div><dt>Altitude<small>Air-density change from your usual playing altitude</small></dt><dd>Not applied</dd></div>
            <div><dt>Lie angle<small>Ball above/below feet · slope not measured</small></dt><dd>Not applied</dd></div>
          </dl>
          <p className="sheet-footnote">Actual distance + wind + elevation + temperature = Plays Like. These are simple estimates using your saved conditions, not measured ball flight. Altitude and lie angle are not included.</p>
          <button className="sheet-primary-button" type="button" onClick={openClubSelector} disabled={currentTargetYards === undefined} data-testid="distance-club-recommendation">
            {distanceRecommendedClub ? `VIEW ${distanceRecommendedClub.label.toUpperCase()} · ${distanceRecommendedClub.trueDistanceYards} YD` : "VIEW CLUBS"}
          </button>
          <small className="sheet-footnote">{teeShotPending ? "Your selected tee club stays selected until you change it. " : "The club picker compares this adjusted distance with your club distances. "}{distanceRecommendedClub?.source === "gps" ? "Distance uses your tracked GPS evidence." : distanceRecommendedClub?.source === "demo" ? "Distance uses demo evidence." : "Distance uses your saved bag estimate."}</small>
          <span className="sheet-kicker">ADJUST CONDITIONS</span>
          <label className="condition-control">
            <span>{`WIND SPEED · ${playingConditions.windMph} MPH`}</span>
            <input
              type="range"
              min="0"
              max="30"
              step="1"
              value={playingConditions.windMph}
              onChange={(event) => setPlayingConditions((current) => ({ ...current, windMph: Number(event.target.value) }))}
              aria-label="Wind speed"
            />
          </label>
          <div className="segmented-control conditions-direction" role="group" aria-label="Wind direction">
            {(["crosswind", "headwind", "tailwind"] as const).map((direction) => (
              <button
                type="button"
                key={direction}
                aria-pressed={playingConditions.windDirection === direction}
                onClick={() => setPlayingConditions((current) => ({ ...current, windDirection: direction }))}
              >
                {windDirectionLabel(direction)}
              </button>
            ))}
          </div>
          <label className="condition-control">
            <span>{`ELEVATION ADJUSTMENT · ${formatSignedYards(playingConditions.elevationYards)}`}</span>
            <input
              type="range"
              min="-20"
              max="20"
              step="1"
              value={playingConditions.elevationYards}
              onChange={(event) => setPlayingConditions((current) => ({ ...current, elevationYards: Number(event.target.value) }))}
              aria-label="Elevation adjustment"
            />
          </label>
          <label className="condition-control">
            <span>{`TEMPERATURE · ${playingConditions.temperatureF}°F`}</span>
            <input
              type="range"
              min="-40"
              max="140"
              step="1"
              value={playingConditions.temperatureF}
              onChange={(event) => setPlayingConditions((current) => ({ ...current, temperatureF: Number(event.target.value) }))}
              aria-label="Temperature"
            />
          </label>
          <button className="sheet-secondary-button" type="button" onClick={() => setPlayingConditions(DEFAULT_PLAYING_CONDITIONS)}>
            <ReloadIcon /> RESET CONDITIONS
          </button>
          <small className="sheet-footnote">These adjustments do not change map yardages or recorded shot distances.</small>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "pin"}
        onOpenChange={(open) => setActiveSheet(open ? "pin" : null)}
        title="Pin placement"
        description="Set an approximate green section or mark the pin from a fresh GPS fix."
        snap={0.52}
      >
        <div className="sheet-stack">
          <div className="segmented-control segmented-control-wide">
            {(["front", "center", "back"] as const).map((placement) => (
              <button
                type="button"
                key={placement}
                aria-pressed={pinPlacement === placement}
                onClick={() => setPinPlacement(placement)}
              >
                {placement}
              </button>
            ))}
          </div>
          {!courseIsDemo && realPinOverride ? (
            <button className="sheet-secondary-button" type="button" onClick={resetRealPinToProvider}>
              <ReloadIcon /> RESET PIN TO PROVIDER
            </button>
          ) : null}
          <button className="sheet-primary-button" type="button" onClick={markPinFromGps}>
            <SewingPinFilledIcon /> MARK PIN AT MY GPS
          </button>
          <small className="sheet-footnote">Current placement: {pinPlacement.toUpperCase()}</small>
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "score"}
        onOpenChange={(open) => setActiveSheet(open ? "score" : null)}
        title={`Hole ${currentHoleNumber} score`}
        description={`Par ${currentHolePar} · Total strokes include putts and penalties.`}
        snap={0.82}
      >
        <div className="score-editor">
          <button type="button" onClick={() => setScore((value) => Math.max(minimumScoreForHole, value - 1))} aria-label="Subtract stroke" disabled={score <= minimumScoreForHole}>
            −
          </button>
          <div>
            <strong data-testid="score-strokes">{score}</strong>
            <span>{score === currentHolePar ? "PAR" : score < currentHolePar ? "UNDER" : "OVER"}</span>
          </div>
          <button type="button" onClick={() => setScore((value) => Math.min(20, value + 1))} aria-label="Add stroke" disabled={score >= 20}>
            +
          </button>
          <div className="score-putt-row insight-editor-row">
            <div><span>PUTTS</span><strong data-testid="score-putts">{puttsDraft ?? "—"}</strong></div>
            <button type="button" aria-label="Subtract putt" onClick={() => setPuttsDraft((value) => Math.max(0, (value ?? 0) - 1))}>−</button>
            <button type="button" aria-label="Add putt" disabled={puttsDraft !== null && puttsDraft >= score} onClick={() => setPuttsDraft((value) => Math.min(score, (value ?? 0) + 1))}>+</button>
          </div>
          {(savedRounds.find((round) => round.id === roundRecordId)?.golfers ?? []).map((name) => {
            const strokes = Object.hasOwn(friendScores, name) ? friendScores[name] : undefined;
            return <div className="score-putt-row insight-editor-row" key={name} aria-label={`${name} score`}>
              <div><span>{name}</span><strong>{strokes ?? "—"}</strong></div>
              <button type="button" aria-label={`Subtract stroke for ${name}`} onClick={() => setFriendScores((values) => ({ ...values, [name]: Math.max(1, (strokes ?? currentHolePar) - 1) }))}>−</button>
              <button type="button" aria-label={`Add stroke for ${name}`} onClick={() => setFriendScores((values) => ({ ...values, [name]: Math.min(20, (strokes ?? currentHolePar - 1) + 1) }))}>+</button>
            </div>;
          })}
          <button className="sheet-primary-button" type="button" onClick={saveHoleOutcome} disabled={puttsDraft !== null && puttsDraft > score}>
            SAVE SCORE
          </button>
          {puttsDraft !== null && puttsDraft > score ? <small className="sheet-footnote" role="alert">Putts cannot exceed total strokes.</small> : null}
          {minimumScoreForHole > 1 ? (
            <small className="sheet-footnote">At least {minimumScoreForHole} stroke{minimumScoreForHole === 1 ? "" : "s"} recorded for this hole.</small>
          ) : null}
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "add"}
        onOpenChange={(open) => setActiveSheet(open ? "add" : null)}
        title="Add shot"
        description="Choose a club or log an event. Manual entries never masquerade as GPS distance."
        snap={0.92}
      >
        <div className="add-shot-sheet" data-testid="add-shot-sheet">
          <div className="add-shot-readout">
            <strong>{activeEquipment.length} ACTIVE CLUB{activeEquipment.length === 1 ? "" : "S"}</strong>
            <span>LOCAL EVENT · NO GPS DISTANCE</span>
          </div>
          {activeEquipment.length > 0 ? (
            <div className="add-shot-club-grid" aria-label="Add a manual shot with a club">
              {activeEquipment.map((club) => (
                <button
                  className="add-shot-club"
                  type="button"
                  key={club.id}
                  data-testid={`add-shot-club-${club.id}`}
                  aria-label={`Add ${club.name} manual shot`}
                  onClick={() => addManualShot(club)}
                >
                  <span className="add-shot-club-slot" aria-hidden="true">{club.slot}</span>
                  <span className="add-shot-club-copy">
                    <strong>{club.name.toUpperCase()}</strong>
                    <small>{club.carryYards === null ? "CARRY —" : `${club.carryYards} YD CARRY`}</small>
                  </span>
                  <PlusIcon aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <div className="add-shot-empty">
              <strong>NO ACTIVE CLUBS</strong>
              <span>Restore a club before logging a club shot.</span>
              <button className="sheet-secondary-button" type="button" onClick={openEquipmentSheet}>MANAGE EQUIPMENT</button>
            </div>
          )}
          <div className="manual-entry-actions">
            <button className="manual-entry-button" type="button" onClick={() => addManualEntry("Missed tracked shot")}>
              <PlusIcon />
              <span>
                <strong>MISSED TRACKED SHOT</strong>
                <small>Add the event for later review. No distance is invented.</small>
              </span>
            </button>
            <button className="manual-entry-button manual-entry-warning" type="button" data-testid="add-penalty-stroke" onClick={() => addManualEntry("Penalty stroke")}>
              <Pencil2Icon />
              <span>
                <strong>PENALTY STROKE</strong>
                <small>Add one stroke while keeping the current shot leg open.</small>
              </span>
            </button>
          </div>
          <div className="manual-entry-history" data-testid="manual-entry-history">
            <div className="manual-entry-history-heading">
              <span>RECENT MANUAL EVENTS</span>
              {manualEntries.length > 0 ? (
                <button className="manual-entry-undo" type="button" onClick={undoLastManualEntry}>
                  UNDO LAST
                </button>
              ) : null}
            </div>
            {manualEntries.length > 0 ? (
              <div className="manual-entry-list">
                {manualEntries.map((entry, index) => {
                  const entryLabel = entry.kind === "Manual shot"
                    ? `${entry.clubName?.toUpperCase() ?? "CLUB"} SHOT`
                    : entry.kind === "Penalty stroke" ? "PENALTY STROKE" : "MISSED TRACKED SHOT";
                  const removeLabel = entry.kind === "Manual shot"
                    ? `Remove ${(entry.clubName ?? "club").toLowerCase()} manual shot`
                    : `Remove ${entry.kind.toLowerCase()}`;
                  return (
                    <div className={`manual-entry-record${entry.kind === "Penalty stroke" ? " manual-entry-record-warning" : ""}`} key={entry.id}>
                      <span>
                        <strong>{entryLabel}</strong>
                        <small>{index === manualEntries.length - 1 ? "Most recent manual event" : "Manual event"}{entry.kind === "Manual shot" ? " · NO GPS DISTANCE" : ""}</small>
                      </span>
                      <button
                        className="manual-entry-remove"
                        type="button"
                        data-testid={`remove-manual-entry-${entry.id}`}
                        aria-label={removeLabel}
                        onClick={() => removeManualEntry(entry.id)}
                      >
                        REMOVE
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <small className="manual-entry-empty">No manual events yet.</small>
            )}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
