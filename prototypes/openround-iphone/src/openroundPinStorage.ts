import type { GeoJsonPosition } from "./openroundCourseData.ts";

/**
 * A manually placed flag is local user input, not provider geometry. Keep it
 * in a separate versioned record so it can never be mistaken for a refreshed
 * course pin or silently carried across a geometry revision.
 */
export const PIN_OVERRIDE_STORAGE_KEY = "openround:pin-overrides:v1";

export type PinOverrideRecord = {
  version: 1;
  courseId: string;
  holeNumber: number;
  sourceVersion: string;
  position: GeoJsonPosition;
  updatedAt: string;
};

type PinOverrideInput = Omit<PinOverrideRecord, "version" | "updatedAt"> & { updatedAt?: string };
type PinOverrideCollection = { version: 1; overrides: PinOverrideRecord[] };

const MAX_PIN_OVERRIDES = 500;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function validHoleNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 18;
}

function validPosition(value: unknown): value is GeoJsonPosition {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && Number.isFinite(value[0])
    && value[0] >= -180
    && value[0] <= 180
    && typeof value[1] === "number"
    && Number.isFinite(value[1])
    && value[1] >= -90
    && value[1] <= 90;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parsePinOverride(value: unknown): PinOverrideRecord | undefined {
  const record = asRecord(value);
  if (!record
    || record.version !== 1
    || !validText(record.courseId, 160)
    || !validHoleNumber(record.holeNumber)
    || !validText(record.sourceVersion, 160)
    || !validPosition(record.position)
    || !validTimestamp(record.updatedAt)) {
    return undefined;
  }

  return {
    version: 1,
    courseId: record.courseId.trim(),
    holeNumber: record.holeNumber,
    sourceVersion: record.sourceVersion.trim(),
    position: [record.position[0], record.position[1]],
    updatedAt: record.updatedAt,
  };
}

function pinOverrideKey(record: Pick<PinOverrideRecord, "courseId" | "holeNumber" | "sourceVersion">): string {
  return `${record.courseId}\u0000${record.holeNumber}\u0000${record.sourceVersion}`;
}

export function parseStoredPinOverrides(value: unknown): PinOverrideRecord[] | undefined {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }

  const record = asRecord(candidate);
  if (!record || record.version !== 1 || !Array.isArray(record.overrides) || record.overrides.length > MAX_PIN_OVERRIDES) {
    return undefined;
  }
  const overrides = record.overrides.map(parsePinOverride);
  if (overrides.some((override): override is undefined => !override)) return undefined;
  const validOverrides = overrides as PinOverrideRecord[];
  if (new Set(validOverrides.map(pinOverrideKey)).size !== validOverrides.length) return undefined;
  return validOverrides.map((override) => ({ ...override, position: [...override.position] as GeoJsonPosition }));
}

function loadAllPinOverrides(storage: Pick<Storage, "getItem"> | undefined): PinOverrideRecord[] {
  if (!storage) return [];
  try {
    return parseStoredPinOverrides(storage.getItem(PIN_OVERRIDE_STORAGE_KEY) ?? "") ?? [];
  } catch {
    return [];
  }
}

export function loadStoredPinOverride(
  storage: Pick<Storage, "getItem"> | undefined,
  courseId: string,
  holeNumber: number,
  sourceVersion: string,
): GeoJsonPosition | undefined {
  const match = loadAllPinOverrides(storage).find((override) =>
    override.courseId === courseId && override.holeNumber === holeNumber && override.sourceVersion === sourceVersion,
  );
  return match ? [...match.position] as GeoJsonPosition : undefined;
}

export function storePinOverride(storage: Pick<Storage, "setItem" | "getItem"> | Pick<Storage, "setItem"> | undefined, input: PinOverrideInput): PinOverrideRecord | undefined {
  const candidate: PinOverrideRecord = {
    version: 1,
    courseId: input.courseId.trim(),
    holeNumber: input.holeNumber,
    sourceVersion: input.sourceVersion.trim(),
    position: [...input.position] as GeoJsonPosition,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
  if (!parsePinOverride(candidate)) return undefined;

  const storageWithRead = storage as Pick<Storage, "setItem" | "getItem"> | undefined;
  const existing = loadAllPinOverrides(storageWithRead);
  const next = [
    ...existing.filter((override) => pinOverrideKey(override) !== pinOverrideKey(candidate)),
    candidate,
  ].slice(-MAX_PIN_OVERRIDES);
  try {
    storage?.setItem(PIN_OVERRIDE_STORAGE_KEY, JSON.stringify({ version: 1, overrides: next } satisfies PinOverrideCollection));
  } catch {
    // The pin remains active in memory when local storage is unavailable.
  }
  return { ...candidate, position: [...candidate.position] as GeoJsonPosition };
}

export function removeStoredPinOverride(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  courseId: string,
  holeNumber: number,
  sourceVersion: string,
): void {
  if (!storage) return;
  const existing = loadAllPinOverrides(storage);
  const next = existing.filter((override) =>
    !(override.courseId === courseId && override.holeNumber === holeNumber && override.sourceVersion === sourceVersion),
  );
  if (next.length === existing.length) return;
  try {
    storage.setItem(PIN_OVERRIDE_STORAGE_KEY, JSON.stringify({ version: 1, overrides: next } satisfies PinOverrideCollection));
  } catch {
    // Ignore optional storage failures; clearing remains effective in memory.
  }
}
