import type { OnCourseIdentity, ShotDistanceSample } from "./openroundOnCourseModel.ts";
import type { OnCourseStorage } from "./openroundOnCoursePersistence.ts";

export const CLUB_STATISTICS_STORAGE_KEY = "openround:club-statistics:v1";
export const CLUB_STATISTICS_VERSION = 1 as const;
export const CLUB_STATISTICS_MAX_SAMPLES_PER_CLUB = 20;

export type ClubStatisticRecord = ShotDistanceSample & {
  recordId: string;
};

export type ClubStatisticsState = {
  version: typeof CLUB_STATISTICS_VERSION;
  records: ClubStatisticRecord[];
};

export type ClubStatisticsIngestInput = {
  mode: "demo" | "live";
  identity: OnCourseIdentity;
  samples: readonly ShotDistanceSample[];
};

export function createEmptyClubStatistics(): ClubStatisticsState {
  return { version: CLUB_STATISTICS_VERSION, records: [] };
}

function recordId(identity: OnCourseIdentity, sample: ShotDistanceSample): string {
  return [identity.courseId, identity.roundId, identity.holeNumber, sample.eventId, sample.createdAt].join("\u0000");
}

function validSample(sample: ShotDistanceSample): boolean {
  return typeof sample.id === "string"
    && typeof sample.eventId === "string"
    && Number.isInteger(sample.holeNumber)
    && sample.holeNumber > 0
    && typeof sample.clubId === "string"
    && sample.clubId.length > 0
    && typeof sample.clubName === "string"
    && sample.clubName.length > 0
    && Number.isFinite(sample.yards)
    && sample.yards > 0
    && (sample.kind === "gps" || sample.kind === "automatic_drive")
    && typeof sample.savedToBag === "boolean"
    && Number.isFinite(Date.parse(sample.createdAt));
}

function sameRecord(left: ClubStatisticRecord, right: ClubStatisticRecord): boolean {
  return left.recordId === right.recordId
    && left.id === right.id
    && left.eventId === right.eventId
    && left.holeNumber === right.holeNumber
    && left.clubId === right.clubId
    && left.clubName === right.clubName
    && left.yards === right.yards
    && left.kind === right.kind
    && left.savedToBag === right.savedToBag
    && left.createdAt === right.createdAt;
}

function normalizeRecords(records: readonly ClubStatisticRecord[]): ClubStatisticRecord[] {
  const byClub = new Map<string, ClubStatisticRecord[]>();
  for (const record of records) {
    const values = byClub.get(record.clubId) ?? [];
    values.push(record);
    byClub.set(record.clubId, values);
  }
  return [...byClub.values()]
    .flatMap((values) => values
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.recordId.localeCompare(right.recordId))
      .slice(-CLUB_STATISTICS_MAX_SAMPLES_PER_CLUB))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.recordId.localeCompare(right.recordId));
}

export function ingestClubStatistics(
  state: ClubStatisticsState,
  input: ClubStatisticsIngestInput,
): ClubStatisticsState {
  if (input.mode !== "live") return state;
  const nextById = new Map(state.records.map((record) => [record.recordId, record]));
  let changed = false;

  for (const sample of input.samples) {
    if (!validSample(sample)) continue;
    const next: ClubStatisticRecord = {
      ...sample,
      recordId: recordId(input.identity, sample),
    };
    const current = nextById.get(next.recordId);
    if (!current || !sameRecord(current, next)) {
      nextById.set(next.recordId, next);
      changed = true;
    }
  }

  if (!changed) return state;
  const records = normalizeRecords([...nextById.values()]);
  return { version: CLUB_STATISTICS_VERSION, records };
}

function isClubStatisticRecord(value: unknown): value is ClubStatisticRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ClubStatisticRecord>;
  return typeof record.recordId === "string" && validSample(record as ShotDistanceSample);
}

function parseClubStatistics(raw: string): ClubStatisticsState | undefined {
  const value = JSON.parse(raw) as Partial<ClubStatisticsState>;
  if (value.version !== CLUB_STATISTICS_VERSION || !Array.isArray(value.records) || !value.records.every(isClubStatisticRecord)) return undefined;
  const deduped = new Map(value.records.map((record) => [record.recordId, record]));
  return { version: CLUB_STATISTICS_VERSION, records: normalizeRecords([...deduped.values()]) };
}

export function loadClubStatistics(storage: OnCourseStorage | undefined): ClubStatisticsState {
  if (!storage) return createEmptyClubStatistics();
  try {
    const raw = storage.getItem(CLUB_STATISTICS_STORAGE_KEY);
    return raw ? parseClubStatistics(raw) ?? createEmptyClubStatistics() : createEmptyClubStatistics();
  } catch {
    return createEmptyClubStatistics();
  }
}

export function saveClubStatistics(storage: OnCourseStorage | undefined, state: ClubStatisticsState): void {
  if (!storage) return;
  try {
    storage.setItem(CLUB_STATISTICS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Statistics persistence cannot block the live round experience.
  }
}

export function projectClubStatisticSamples(state: ClubStatisticsState): ShotDistanceSample[] {
  return state.records.map(({ recordId: _recordId, ...sample }) => sample);
}
