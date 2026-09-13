export type FieldLogGeometryGrade = "A" | "B" | "C" | "D";
export type FieldLogImageryProvider = "google" | "usgs" | "bundled";
export type FieldLogGpsSource = "manual" | "phone_pair";
export type FieldLogTeeBox = "blue" | "white" | "gold" | "black" | "red";

export type FieldLogGeoPoint = {
  lat: number;
  lon: number;
};

/** Explicit zoom checkpoints for the map/geometry alignment release gate. */
export type FieldLogAlignmentZooms = {
  oneX: boolean;
  twoX: boolean;
};

export type FieldLogGpsSample = {
  expectedYards: number;
  recordedYards: number;
  accuracyMeters: number;
  /** Age of the phone fix at capture time. Optional for v1 logs written before freshness tracking. */
  fixAgeSeconds?: number;
  /** Provenance for new samples. Omitted means a legacy/manual v1 sample. */
  source?: FieldLogGpsSource;
  /** Raw phone endpoints for a deterministic two-fix distance measurement. */
  start?: FieldLogGeoPoint;
  end?: FieldLogGeoPoint;
  startFixAgeSeconds?: number;
  endFixAgeSeconds?: number;
};

export type FieldLogAlignment = {
  lateralYards: number;
  longitudinalYards: number;
};

export type FieldLogImagery = {
  provider: FieldLogImageryProvider;
  attributionVisible: boolean;
  overlayAligned: boolean;
  /** Optional for legacy v1 exports; new captures record both zoom checkpoints. */
  alignmentZooms?: FieldLogAlignmentZooms;
};

export type FieldLogRun = {
  id: string;
  device: string;
  courseId: string;
  hole: number;
  /** Tee provenance for new captures. Optional so legacy v1 exports remain readable. */
  teeBox?: FieldLogTeeBox;
  geometryGrade: FieldLogGeometryGrade;
  geometryVersion: string;
  gps: FieldLogGpsSample[];
  alignment?: FieldLogAlignment;
  imagery: FieldLogImagery;
  note?: string;
  createdAt: string;
};

export type FieldLogPayload = {
  version: 1;
  runs: FieldLogRun[];
};

export type FieldLogDraft = {
  device: string;
  provider: FieldLogImageryProvider;
  expectedYards: string;
  recordedYards: string;
  accuracyMeters: string;
  fixAgeSeconds: string;
  lateralYards: string;
  longitudinalYards: string;
  attributionVisible: boolean;
  alignmentAtOneX: boolean;
  alignmentAtTwoX: boolean;
  note: string;
};

export const FIELD_LOG_STORAGE_KEY = "openround:field-log:v1";
export const FIELD_LOG_LIMIT = 500;
export const FIELD_LOG_GPS_SAMPLE_LIMIT = 200;
export const FIELD_LOG_MAX_FIX_AGE_SECONDS = 20;
export const FIELD_LOG_MAX_RECORDED_FIX_AGE_SECONDS = 300;

const FIELD_LOG_PROVIDERS: readonly FieldLogImageryProvider[] = ["google", "usgs", "bundled"];
const FIELD_LOG_GRADES: readonly FieldLogGeometryGrade[] = ["A", "B", "C", "D"];
const FIELD_LOG_GPS_SOURCES: readonly FieldLogGpsSource[] = ["manual", "phone_pair"];
const FIELD_LOG_TEE_BOXES: readonly FieldLogTeeBox[] = ["blue", "white", "gold", "black", "red"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function isOptionalText(value: unknown, maximum: number): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= maximum);
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isGeoPoint(value: unknown): value is FieldLogGeoPoint {
  if (!isRecord(value)) return false;
  return isFiniteInRange(value.lat, -90, 90) && isFiniteInRange(value.lon, -180, 180);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isGpsSample(value: unknown): value is FieldLogGpsSample {
  if (!isRecord(value)) return false;
  const source = value.source;
  const fixAgeSeconds = value.fixAgeSeconds;
  const start = value.start;
  const end = value.end;
  const startFixAgeSeconds = value.startFixAgeSeconds;
  const endFixAgeSeconds = value.endFixAgeSeconds;
  const hasPairFields = start !== undefined || end !== undefined || startFixAgeSeconds !== undefined || endFixAgeSeconds !== undefined;
  const sourceValid = source === undefined || (typeof source === "string" && FIELD_LOG_GPS_SOURCES.includes(source as FieldLogGpsSource));
  const pairValid = source === "phone_pair"
    ? isGeoPoint(start)
      && isGeoPoint(end)
      && isFiniteInRange(startFixAgeSeconds, 0, FIELD_LOG_MAX_RECORDED_FIX_AGE_SECONDS)
      && isFiniteInRange(endFixAgeSeconds, 0, FIELD_LOG_MAX_RECORDED_FIX_AGE_SECONDS)
    : !hasPairFields;
  return sourceValid && (
    isFiniteInRange(value.expectedYards, 0.1, 500)
    && isFiniteInRange(value.recordedYards, 0, 500)
    && isFiniteInRange(value.accuracyMeters, 0, 100)
    && (fixAgeSeconds === undefined || isFiniteInRange(fixAgeSeconds, 0, FIELD_LOG_MAX_RECORDED_FIX_AGE_SECONDS))
    && pairValid
  );
}

function isAlignment(value: unknown): value is FieldLogAlignment {
  if (!isRecord(value)) return false;
  return isFiniteInRange(value.lateralYards, 0, 200) && isFiniteInRange(value.longitudinalYards, 0, 200);
}

function isAlignmentZooms(value: unknown): value is FieldLogAlignmentZooms {
  if (!isRecord(value)) return false;
  return typeof value.oneX === "boolean" && typeof value.twoX === "boolean";
}

function isImagery(value: unknown): value is FieldLogImagery {
  if (!isRecord(value)) return false;
  const alignmentZooms = value.alignmentZooms;
  return (
    typeof value.provider === "string"
    && FIELD_LOG_PROVIDERS.includes(value.provider as FieldLogImageryProvider)
    && typeof value.attributionVisible === "boolean"
    && typeof value.overlayAligned === "boolean"
    && (alignmentZooms === undefined || isAlignmentZooms(alignmentZooms))
  );
}

function isFieldLogRun(value: unknown): value is FieldLogRun {
  if (!isRecord(value)) return false;
  const grade = value.geometryGrade;
  const gps = value.gps;
  const alignment = value.alignment;
  const teeBox = value.teeBox;
  if (
    !isBoundedText(value.id, 120)
    || !isBoundedText(value.device, 80)
    || !isBoundedText(value.courseId, 160)
    || !isFiniteInRange(value.hole, 1, 18)
    || !Number.isInteger(value.hole)
    || (teeBox !== undefined && (typeof teeBox !== "string" || !FIELD_LOG_TEE_BOXES.includes(teeBox as FieldLogTeeBox)))
    || typeof grade !== "string"
    || !FIELD_LOG_GRADES.includes(grade as FieldLogGeometryGrade)
    || !isBoundedText(value.geometryVersion, 80)
    || !Array.isArray(gps)
    || gps.length > FIELD_LOG_GPS_SAMPLE_LIMIT
    || !gps.every(isGpsSample)
    || !isImagery(value.imagery)
    || !isOptionalText(value.note, 500)
    || !isIsoTimestamp(value.createdAt)
  ) {
    return false;
  }

  if (alignment !== undefined && (grade === "C" || grade === "D" || !isAlignment(alignment))) return false;
  return true;
}

function cloneRun(run: FieldLogRun): FieldLogRun {
  const clone: FieldLogRun = {
    ...run,
    gps: run.gps.map((sample) => ({
      ...sample,
      ...(sample.start ? { start: { ...sample.start } } : {}),
      ...(sample.end ? { end: { ...sample.end } } : {}),
    })),
    imagery: {
      ...run.imagery,
      ...(run.imagery.alignmentZooms ? { alignmentZooms: { ...run.imagery.alignmentZooms } } : {}),
    },
  };
  if (run.alignment) clone.alignment = { ...run.alignment };
  return clone;
}

export function clearFieldLog(): FieldLogPayload {
  return { version: 1, runs: [] };
}

export function parseStoredFieldLog(value: unknown): FieldLogPayload | undefined {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }

  if (!isRecord(candidate) || candidate.version !== 1 || !Array.isArray(candidate.runs) || candidate.runs.length > FIELD_LOG_LIMIT) {
    return undefined;
  }
  if (!candidate.runs.every(isFieldLogRun)) return undefined;

  const runs = candidate.runs as FieldLogRun[];
  if (new Set(runs.map((run) => run.id)).size !== runs.length) return undefined;
  return { version: 1, runs: runs.map(cloneRun) };
}

export function loadStoredFieldLog(storage: Pick<Storage, "getItem"> | undefined): FieldLogPayload {
  if (!storage) return clearFieldLog();
  try {
    return parseStoredFieldLog(storage.getItem(FIELD_LOG_STORAGE_KEY) ?? "") ?? clearFieldLog();
  } catch {
    return clearFieldLog();
  }
}

export function storeFieldLog(storage: Pick<Storage, "setItem"> | undefined, payload: FieldLogPayload): void {
  const parsed = parseStoredFieldLog(payload);
  if (!parsed) throw new RangeError("Cannot store an invalid field log.");
  storage?.setItem(FIELD_LOG_STORAGE_KEY, JSON.stringify(parsed));
}

export function appendFieldLogRun(payload: FieldLogPayload, run: FieldLogRun): FieldLogPayload {
  const current = parseStoredFieldLog(payload);
  if (!current || !isFieldLogRun(run)) throw new RangeError("Cannot append an invalid field-log run.");
  if (current.runs.length >= FIELD_LOG_LIMIT) throw new RangeError("Field log limit reached.");
  if (current.runs.some((candidate) => candidate.id === run.id)) throw new RangeError("Field-log run ID already exists.");
  return { version: 1, runs: [...current.runs.map(cloneRun), cloneRun(run)] };
}

export function removeFieldLogRun(payload: FieldLogPayload, id: string): FieldLogPayload {
  const current = parseStoredFieldLog(payload) ?? clearFieldLog();
  return { version: 1, runs: current.runs.filter((run) => run.id !== id).map(cloneRun) };
}
