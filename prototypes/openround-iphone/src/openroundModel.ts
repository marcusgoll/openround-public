export type ApproachClubId = "driver" | "3w" | "4h" | "4i" | "5i" | "6i" | "7i" | "8i" | "9i" | "pw" | "gw" | "sw" | "lw" | "putter" | "5w";

export type EquipmentType = "driver" | "wood" | "hybrid" | "iron" | "wedge" | "putter";
export type EquipmentStatus = "active" | "retired";

export type EquipmentClub = {
  id: string;
  slot: number;
  name: string;
  brand: string;
  model: string;
  type: EquipmentType;
  loft: number | null;
  carryYards: number | null;
  totalYards: number | null;
  status: EquipmentStatus;
};

export type EquipmentClubInput = Omit<EquipmentClub, "id" | "slot" | "status" | "totalYards"> & { totalYards?: number | null; status?: EquipmentStatus };

export const EQUIPMENT_STORAGE_KEY = "openround:equipment:v2";
export const LEGACY_EQUIPMENT_STORAGE_KEY = "openround:equipment:v1";
export const EQUIPMENT_LIMIT = 14;
export const EQUIPMENT_TYPES: readonly EquipmentType[] = ["driver", "wood", "hybrid", "iron", "wedge", "putter"];
export const EQUIPMENT_STATUSES: readonly EquipmentStatus[] = ["active", "retired"];

const NICKLAUS_BRAND = "Stix";
const NICKLAUS_MODEL = "Nicholas Edition";

// The deterministic bag seed follows the Stix x Jack Nicklaus 14-club set:
// Driver, 3W, 4H, 4i-PW, 52/56/60 wedges, and mallet putter. Carry/total are
// local starting values, not manufacturer performance claims; they remain
// editable as the player records GPS evidence.
const DEFAULT_EQUIPMENT_VALUES: readonly EquipmentClubInput[] = [
  { name: "Driver", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "driver", loft: 9, carryYards: 246, totalYards: 258 },
  { name: "3 Wood", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "wood", loft: 16, carryYards: 228, totalYards: 240 },
  { name: "4 Hybrid", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "hybrid", loft: 21, carryYards: 199, totalYards: 210 },
  { name: "4 Iron", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "iron", loft: 22, carryYards: 194, totalYards: 204 },
  { name: "5 Iron", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "iron", loft: 25, carryYards: 178, totalYards: 188 },
  { name: "6 Iron", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "iron", loft: 28, carryYards: 166, totalYards: 175 },
  { name: "7 Iron", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "iron", loft: 31, carryYards: 154, totalYards: 162 },
  { name: "8 Iron", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "iron", loft: 35, carryYards: 142, totalYards: 150 },
  { name: "9 Iron", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "iron", loft: 40, carryYards: 130, totalYards: 138 },
  { name: "Pitching Wedge", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "wedge", loft: 46, carryYards: 118, totalYards: 124 },
  { name: "Gap Wedge", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "wedge", loft: 52, carryYards: 105, totalYards: 111 },
  { name: "Sand Wedge", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "wedge", loft: 56, carryYards: 92, totalYards: 98 },
  { name: "Lob Wedge", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "wedge", loft: 60, carryYards: 78, totalYards: 84 },
  { name: "Putter", brand: NICKLAUS_BRAND, model: NICKLAUS_MODEL, type: "putter", loft: 3, carryYards: null, totalYards: null },
];

export const EQUIPMENT_SLOT_TO_CLUB_ID: readonly ApproachClubId[] = [
  "driver", "3w", "4h", "4i", "5i", "6i", "7i", "8i", "9i", "pw", "gw", "sw", "lw", "putter",
];

export const DEFAULT_TEE_CLUB_ID: ApproachClubId = "driver";

function derivedTotalYards(carryYards: number | null): number | null {
  return carryYards === null ? null : Math.round(carryYards * 1.05);
}

export function createDefaultEquipment(): EquipmentClub[] {
  return DEFAULT_EQUIPMENT_VALUES.map((club, index) => ({
    ...club,
    totalYards: club.totalYards ?? derivedTotalYards(club.carryYards),
    id: `club-${index + 1}`,
    slot: index + 1,
    status: "active" as const,
  }));
}

function isEquipmentType(value: unknown): value is EquipmentType {
  return typeof value === "string" && EQUIPMENT_TYPES.includes(value as EquipmentType);
}

function isEquipmentStatus(value: unknown): value is EquipmentStatus {
  return typeof value === "string" && EQUIPMENT_STATUSES.includes(value as EquipmentStatus);
}

function isOptionalMeasurement(value: unknown, maximum: number): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum);
}

function isEquipmentClub(value: unknown): value is EquipmentClub {
  if (!value || typeof value !== "object") return false;
  const club = value as Partial<EquipmentClub>;
  return (
    typeof club.id === "string" && club.id.trim().length > 0 && club.id.length <= 80
    && typeof club.slot === "number" && Number.isInteger(club.slot) && club.slot >= 1 && club.slot <= EQUIPMENT_LIMIT
    && typeof club.name === "string" && club.name.trim().length > 0 && club.name.length <= 40
    && typeof club.brand === "string" && club.brand.length <= 40
    && typeof club.model === "string" && club.model.length <= 60
    && isEquipmentType(club.type)
    && isOptionalMeasurement(club.loft, 80)
    && isOptionalMeasurement(club.carryYards, 400)
    && isOptionalMeasurement(club.totalYards === undefined ? (club.carryYards ?? null) : club.totalYards, 500)
    && (club.totalYards === null || club.totalYards === undefined || club.carryYards === null || club.carryYards === undefined || club.totalYards >= club.carryYards)
    && isEquipmentStatus(club.status === undefined ? "active" : club.status)
  );
}

export function parseStoredEquipment(value: unknown): EquipmentClub[] | undefined {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }

  if (!candidate || typeof candidate !== "object") return undefined;
  const stored = candidate as { version?: unknown; equipment?: unknown };
  if ((stored.version !== 1 && stored.version !== 2) || !Array.isArray(stored.equipment) || stored.equipment.length > EQUIPMENT_LIMIT) return undefined;
  if (!stored.equipment.every(isEquipmentClub)) return undefined;

  const equipment = [...stored.equipment].sort((left, right) => left.slot - right.slot);
  const ids = new Set(equipment.map((club) => club.id));
  const slots = new Set(equipment.map((club) => club.slot));
  if (ids.size !== equipment.length || slots.size !== equipment.length) return undefined;
  return equipment.map((club) => ({
    ...club,
    totalYards: club.totalYards === undefined ? derivedTotalYards(club.carryYards ?? null) : club.totalYards,
    status: club.status ?? "active",
  }));
}

function normalizedClubName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/wood$/, "w").replace(/iron$/, "i");
}

function upgradeLegacyEquipment(equipment: readonly EquipmentClub[]): EquipmentClub[] {
  const aliases = new Map<string, number>([
    ["driver", 1], ["3w", 2], ["4h", 3], ["4hybrid", 3], ["4i", 4], ["5i", 5], ["6i", 6], ["7i", 7], ["8i", 8], ["9i", 9],
    ["pitchingwedge", 10], ["pw", 10], ["gapwedge", 11], ["gw", 11], ["sandwedge", 12], ["sw", 12], ["lobwedge", 13], ["lw", 13], ["putter", 14],
  ]);
  const migratedBySlot = new Map<number, EquipmentClub>();

  for (const club of equipment) {
    const slot = aliases.get(normalizedClubName(club.name));
    // The previous seed used a 5 wood in slot 3. It is intentionally not
    // carried into the Nicklaus 14-club lineup, which uses a 4 iron instead.
    if (!slot || migratedBySlot.has(slot)) continue;
    migratedBySlot.set(slot, club);
  }

  return createDefaultEquipment().map((club) => {
    const previous = migratedBySlot.get(club.slot);
    return previous
      ? {
          ...club,
          carryYards: previous.carryYards,
          totalYards: previous.totalYards,
          status: previous.status,
        }
      : club;
  });
}

export function loadStoredEquipment(storage: Pick<Storage, "getItem"> | undefined): EquipmentClub[] {
  if (!storage) return createDefaultEquipment();
  try {
    const current = parseStoredEquipment(storage.getItem(EQUIPMENT_STORAGE_KEY) ?? "");
    if (current) return current;

    const legacy = parseStoredEquipment(storage.getItem(LEGACY_EQUIPMENT_STORAGE_KEY) ?? "");
    return legacy ? upgradeLegacyEquipment(legacy) : createDefaultEquipment();
  } catch {
    return createDefaultEquipment();
  }
}

export function storeEquipment(storage: Pick<Storage, "setItem"> | undefined, equipment: readonly EquipmentClub[]): void {
  storage?.setItem(EQUIPMENT_STORAGE_KEY, JSON.stringify({ version: 2, equipment }));
}

function equipmentIdForSlot(slot: number, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "club";
  return `club-${slot}-${slug}`;
}

export function addEquipment(equipment: readonly EquipmentClub[], input: EquipmentClubInput): EquipmentClub[] {
  if (equipment.length >= EQUIPMENT_LIMIT) return equipment.map((club) => ({ ...club }));
  const occupied = new Set(equipment.map((club) => club.slot));
  const slot = Array.from({ length: EQUIPMENT_LIMIT }, (_, index) => index + 1).find((candidate) => !occupied.has(candidate));
  if (!slot) return equipment.map((club) => ({ ...club }));
  const added = {
    ...input,
    totalYards: input.totalYards ?? derivedTotalYards(input.carryYards),
    status: input.status ?? "active",
    id: equipmentIdForSlot(slot, input.name),
    slot,
  };
  return [...equipment, added].sort((left, right) => left.slot - right.slot).map((club) => ({ ...club }));
}

export function updateEquipment(equipment: readonly EquipmentClub[], id: string, patch: Partial<EquipmentClubInput>): EquipmentClub[] {
  return equipment.map((club) => {
    if (club.id !== id) return { ...club };
    const next = { ...club, ...patch };
    return "carryYards" in patch && !("totalYards" in patch)
      ? { ...next, totalYards: derivedTotalYards(next.carryYards) }
      : next;
  });
}

export function removeEquipment(equipment: readonly EquipmentClub[], id: string): EquipmentClub[] {
  return equipment.filter((club) => club.id !== id).map((club) => ({ ...club }));
}

export type RoundEventKind = "gps_shot" | "manual_shot" | "missed_tracked_shot" | "penalty_stroke";

export type RoundEvent = {
  id: string;
  kind: RoundEventKind;
  holeNumber: number;
  sequence: number;
  clubId: string | null;
  clubName: string | null;
  distanceYards: number | null;
  strokes: number;
  evidence: "total_gps" | "manual";
  createdAt: string;
};

export type RoundLog = {
  version: 1;
  roundId: string;
  courseId: string;
  holeNumber: number;
  score: number;
  events: RoundEvent[];
};

export const ROUND_LOG_STORAGE_KEY = "openround:round-log:v1";

/**
 * Strokes actually recorded for one hole by round events. GPS shots, manual
 * shots, and penalty strokes carry strokes: 1; missed-tracked-shot events are
 * observations, not strokes, so they count zero. Useful as a save-time floor:
 * a hole score below this count contradicts recorded evidence.
 */
export function countRecordedStrokes(events: readonly RoundEvent[], holeNumber: number): number {
  return events
    .filter((event) => event.holeNumber === holeNumber)
    .reduce((sum, event) => sum + Math.max(0, event.strokes), 0);
}

const ROUND_EVENT_KINDS: readonly RoundEventKind[] = ["gps_shot", "manual_shot", "missed_tracked_shot", "penalty_stroke"];

function isRoundEventKind(value: unknown): value is RoundEventKind {
  return typeof value === "string" && ROUND_EVENT_KINDS.includes(value as RoundEventKind);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRoundEvent(value: unknown): value is RoundEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Partial<RoundEvent>;
  if (
    typeof event.id !== "string" || event.id.trim().length === 0 || event.id.length > 120
    || !isRoundEventKind(event.kind)
    || typeof event.holeNumber !== "number" || !Number.isInteger(event.holeNumber) || event.holeNumber < 1 || event.holeNumber > 18
    || typeof event.sequence !== "number" || !Number.isInteger(event.sequence) || event.sequence < 1
    || (event.clubId !== null && (typeof event.clubId !== "string" || event.clubId.length > 80))
    || (event.clubName !== null && (typeof event.clubName !== "string" || event.clubName.length > 80))
    || (event.distanceYards !== null && (typeof event.distanceYards !== "number" || !Number.isFinite(event.distanceYards) || event.distanceYards < 0 || event.distanceYards > 500))
    || typeof event.strokes !== "number" || !Number.isInteger(event.strokes) || event.strokes < 0 || event.strokes > 20
    || !isIsoTimestamp(event.createdAt)
  ) {
    return false;
  }

  if (event.kind === "gps_shot") {
    return event.evidence === "total_gps" && event.distanceYards !== null && event.strokes === 1;
  }

  if (event.kind === "manual_shot") {
    return event.evidence === "manual"
      && event.distanceYards === null
      && event.strokes === 1
      && event.clubId !== null
      && event.clubName !== null;
  }

  if (event.kind === "missed_tracked_shot") {
    return event.evidence === "manual"
      && event.distanceYards === null
      && event.strokes === 0
      && event.clubId === null
      && event.clubName === null;
  }

  return event.evidence === "manual"
    && event.distanceYards === null
    && event.strokes === 1
    && event.clubId === null
    && event.clubName === null;
}

export function parseStoredRoundLog(value: unknown): RoundLog | undefined {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const stored = candidate as Partial<RoundLog>;
  if (
    stored.version !== 1
    || typeof stored.roundId !== "string" || stored.roundId.trim().length === 0 || stored.roundId.length > 160
    || typeof stored.courseId !== "string" || stored.courseId.trim().length === 0 || stored.courseId.length > 160
    || typeof stored.holeNumber !== "number" || !Number.isInteger(stored.holeNumber) || stored.holeNumber < 1 || stored.holeNumber > 18
    || typeof stored.score !== "number" || !Number.isInteger(stored.score) || stored.score < 0 || stored.score > 200
    || !Array.isArray(stored.events) || stored.events.length > 2_000
    || !stored.events.every(isRoundEvent)
  ) {
    return undefined;
  }

  const events = stored.events.map((event) => ({ ...event }));
  if (new Set(events.map((event) => event.id)).size !== events.length) return undefined;
  if (new Set(events.map((event) => event.sequence)).size !== events.length) return undefined;

  return {
    version: 1,
    roundId: stored.roundId,
    courseId: stored.courseId,
    holeNumber: stored.holeNumber,
    score: stored.score,
    events,
  };
}

function emptyRoundLog(): RoundLog {
  return { version: 1, roundId: "", courseId: "", holeNumber: 1, score: 0, events: [] };
}

export function loadStoredRoundLog(storage: Pick<Storage, "getItem"> | undefined): RoundLog {
  if (!storage) return emptyRoundLog();
  try {
    return parseStoredRoundLog(storage.getItem(ROUND_LOG_STORAGE_KEY) ?? "") ?? emptyRoundLog();
  } catch {
    return emptyRoundLog();
  }
}

export function storeRoundLog(storage: Pick<Storage, "setItem"> | undefined, log: RoundLog): void {
  storage?.setItem(ROUND_LOG_STORAGE_KEY, JSON.stringify(log));
}

export type ShotOffset = {
  lateralYards: number;
  distanceYards: number;
};

export type FixtureProvenance = "prototype_fixture";

export type CaddyBaseline = {
  distanceYards: number;
  lateralYards: number;
};

export type ClubProfile = {
  id: ApproachClubId;
  label: string;
  carryYards: number;
  totalYards: number;
  caddyBaseline: CaddyBaseline;
  offsets: readonly ShotOffset[];
  provenance: FixtureProvenance;
};

export type DispersionEnvelope = {
  leftYards: number;
  rightYards: number;
  shortYards: number;
  longYards: number;
};

export const MIN_DISPERSION_SAMPLES = 10;
export const DEFAULT_DISPERSION_RADIUS_YARDS = 10;

export type DispersionPresentation = {
  envelope: DispersionEnvelope;
  circular: boolean;
};

export type ShotBias = {
  lateralYards: number;
  distanceYards: number;
};

type ProfileAnchor = Omit<ClubProfile, "offsets" | "provenance"> & {
  anchors: readonly ShotOffset[];
};

const DETERMINISTIC_VARIATIONS: readonly ShotOffset[] = [
  { lateralYards: -1, distanceYards: 0 },
  { lateralYards: 0, distanceYards: -1 },
  { lateralYards: 0, distanceYards: 1 },
  { lateralYards: 1, distanceYards: 0 },
];

function expandAnchors(anchors: readonly ShotOffset[]): readonly ShotOffset[] {
  return anchors.flatMap((anchor) =>
    DETERMINISTIC_VARIATIONS.map((variation) => ({
      lateralYards: anchor.lateralYards + variation.lateralYards,
      distanceYards: anchor.distanceYards + variation.distanceYards,
    })),
  );
}

function createProfile({ anchors, ...profile }: ProfileAnchor): ClubProfile {
  return {
    ...profile,
    offsets: expandAnchors(anchors),
    provenance: "prototype_fixture",
  };
}

const GENERATED_ANCHOR_PATTERN: readonly [number, number][] = [
  [-1, -1], [-0.8, -0.8], [-0.55, -0.55], [-0.25, -0.25], [0, 0], [0, 0.08], [0.25, 0.32], [0.55, 0.58], [0.8, 0.8], [1, 1],
];

function generatedAnchors(lateralSpread: number, distanceSpread: number): readonly ShotOffset[] {
  return GENERATED_ANCHOR_PATTERN.map(([lateral, distance]) => ({
    lateralYards: Math.round(lateral * lateralSpread),
    distanceYards: Math.round(distance * distanceSpread),
  }));
}

function createGeneratedProfile(
  id: ApproachClubId,
  label: string,
  carryYards: number,
  totalYards: number,
  caddyBaseline: CaddyBaseline,
  lateralSpread: number,
  distanceSpread: number,
): ClubProfile {
  return createProfile({
    id,
    label,
    carryYards,
    totalYards,
    caddyBaseline,
    anchors: generatedAnchors(lateralSpread, distanceSpread),
  });
}

// Authored prototype fixtures. They are not production performance claims.
export const CLUB_PROFILES: readonly ClubProfile[] = [
  createGeneratedProfile("driver", "Driver", 246, 258, { distanceYards: 252, lateralYards: -1 }, 12, 18),
  createGeneratedProfile("3w", "3 Wood", 228, 240, { distanceYards: 234, lateralYards: -1 }, 10, 14),
  createGeneratedProfile("4h", "4 Hybrid", 199, 210, { distanceYards: 204, lateralYards: -2 }, 9, 11),
  createGeneratedProfile("4i", "4 Iron", 194, 204, { distanceYards: 199, lateralYards: -3 }, 10, 12),
  createProfile({
    id: "pw",
    label: "Pitching Wedge",
    carryYards: 118,
    totalYards: 124,
    caddyBaseline: { distanceYards: 121, lateralYards: -2 },
    anchors: [
      { lateralYards: -8, distanceYards: -8 },
      { lateralYards: -6, distanceYards: -6 },
      { lateralYards: -4, distanceYards: -4 },
      { lateralYards: -2, distanceYards: -2 },
      { lateralYards: 0, distanceYards: 0 },
      { lateralYards: 0, distanceYards: 1 },
      { lateralYards: 2, distanceYards: 3 },
      { lateralYards: 4, distanceYards: 5 },
      { lateralYards: 6, distanceYards: 7 },
      { lateralYards: 8, distanceYards: 9 },
    ],
  }),
  createProfile({
    id: "9i",
    label: "9 Iron",
    carryYards: 130,
    totalYards: 138,
    caddyBaseline: { distanceYards: 134, lateralYards: -3 },
    anchors: [
      { lateralYards: -9, distanceYards: -9 },
      { lateralYards: -7, distanceYards: -7 },
      { lateralYards: -5, distanceYards: -5 },
      { lateralYards: -2, distanceYards: -3 },
      { lateralYards: 0, distanceYards: 0 },
      { lateralYards: 0, distanceYards: 1 },
      { lateralYards: 2, distanceYards: 3 },
      { lateralYards: 5, distanceYards: 5 },
      { lateralYards: 7, distanceYards: 7 },
      { lateralYards: 9, distanceYards: 9 },
    ],
  }),
  createProfile({
    id: "8i",
    label: "8 Iron",
    carryYards: 142,
    totalYards: 150,
    caddyBaseline: { distanceYards: 146, lateralYards: -4 },
    anchors: [
      { lateralYards: -10, distanceYards: -10 },
      { lateralYards: -8, distanceYards: -8 },
      { lateralYards: -5, distanceYards: -6 },
      { lateralYards: -2, distanceYards: -3 },
      { lateralYards: 0, distanceYards: 0 },
      { lateralYards: 0, distanceYards: 1 },
      { lateralYards: 2, distanceYards: 3 },
      { lateralYards: 5, distanceYards: 6 },
      { lateralYards: 8, distanceYards: 8 },
      { lateralYards: 10, distanceYards: 10 },
    ],
  }),
  createProfile({
    id: "7i",
    label: "7 Iron",
    carryYards: 154,
    totalYards: 162,
    caddyBaseline: { distanceYards: 158, lateralYards: -6 },
    anchors: [
      { lateralYards: -7, distanceYards: -8 },
      { lateralYards: -7, distanceYards: -8 },
      { lateralYards: -7, distanceYards: -8 },
      { lateralYards: -7, distanceYards: -8 },
      { lateralYards: 0, distanceYards: 0 },
      { lateralYards: 0, distanceYards: 0 },
      { lateralYards: 7, distanceYards: 9 },
      { lateralYards: 7, distanceYards: 9 },
      { lateralYards: 7, distanceYards: 9 },
      { lateralYards: 7, distanceYards: 9 },
    ],
  }),
  createProfile({
    id: "6i",
    label: "6 Iron",
    carryYards: 166,
    totalYards: 175,
    caddyBaseline: { distanceYards: 170, lateralYards: -5 },
    anchors: [
      { lateralYards: -11, distanceYards: -11 },
      { lateralYards: -9, distanceYards: -9 },
      { lateralYards: -6, distanceYards: -7 },
      { lateralYards: -3, distanceYards: -4 },
      { lateralYards: 0, distanceYards: 0 },
      { lateralYards: 0, distanceYards: 1 },
      { lateralYards: 3, distanceYards: 4 },
      { lateralYards: 6, distanceYards: 7 },
      { lateralYards: 9, distanceYards: 9 },
      { lateralYards: 11, distanceYards: 11 },
    ],
  }),
  createProfile({
    id: "5i",
    label: "5 Iron",
    carryYards: 178,
    totalYards: 188,
    caddyBaseline: { distanceYards: 183, lateralYards: -6 },
    anchors: [
      { lateralYards: -12, distanceYards: -12 },
      { lateralYards: -10, distanceYards: -10 },
      { lateralYards: -7, distanceYards: -8 },
      { lateralYards: -3, distanceYards: -4 },
      { lateralYards: 0, distanceYards: 0 },
      { lateralYards: 0, distanceYards: 1 },
      { lateralYards: 3, distanceYards: 4 },
      { lateralYards: 7, distanceYards: 8 },
      { lateralYards: 10, distanceYards: 10 },
      { lateralYards: 12, distanceYards: 12 },
    ],
  }),
  createGeneratedProfile("gw", "Gap Wedge", 105, 111, { distanceYards: 108, lateralYards: -1 }, 8, 7),
  createGeneratedProfile("sw", "Sand Wedge", 92, 98, { distanceYards: 95, lateralYards: -1 }, 7, 6),
  createGeneratedProfile("lw", "Lob Wedge", 78, 84, { distanceYards: 81, lateralYards: -1 }, 7, 6),
  createGeneratedProfile("putter", "Putter", 0, 0, { distanceYards: 0, lateralYards: 0 }, 2, 2),
];

export const DEFAULT_APPROACH_CLUB_ID: ApproachClubId = "7i";

function percentileBounds(values: readonly number[]): { low: number; high: number } {
  if (values.length === 0) throw new RangeError("Shot offsets are required.");

  const sorted = [...values].sort((left, right) => left - right);
  const lastIndex = sorted.length - 1;

  return {
    low: sorted[Math.floor(lastIndex * 0.1)],
    high: sorted[Math.ceil(lastIndex * 0.9)],
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("Shot offsets are required.");

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function getClubProfile(id: ApproachClubId): ClubProfile {
  // 5 Wood existed in the first prototype seed. Keep it readable for old
  // stored shot records while the active 14-club bag uses 4 Iron instead.
  const profile = CLUB_PROFILES.find((candidate) => candidate.id === (id === "5w" ? "4i" : id));
  if (!profile) throw new RangeError(`Unknown approach club: ${id}`);
  return profile;
}

export function getDispersionEnvelope(offsets: readonly ShotOffset[]): DispersionEnvelope {
  const lateral = percentileBounds(offsets.map((offset) => offset.lateralYards));
  const distance = percentileBounds(offsets.map((offset) => offset.distanceYards));

  return {
    leftYards: Math.max(0, -lateral.low),
    rightYards: Math.max(0, lateral.high),
    shortYards: Math.max(0, -distance.low),
    longYards: Math.max(0, distance.high),
  };
}

export function getDispersionPresentation(
  offsets: readonly ShotOffset[],
  minimumSamples = MIN_DISPERSION_SAMPLES,
): DispersionPresentation {
  if (offsets.length < minimumSamples) {
    return {
      envelope: {
        leftYards: DEFAULT_DISPERSION_RADIUS_YARDS,
        rightYards: DEFAULT_DISPERSION_RADIUS_YARDS,
        shortYards: DEFAULT_DISPERSION_RADIUS_YARDS,
        longYards: DEFAULT_DISPERSION_RADIUS_YARDS,
      },
      circular: true,
    };
  }

  return { envelope: getDispersionEnvelope(offsets), circular: false };
}

export function getShotBias(offsets: readonly ShotOffset[]): ShotBias {
  return {
    lateralYards: median(offsets.map((offset) => offset.lateralYards)),
    distanceYards: median(offsets.map((offset) => offset.distanceYards)),
  };
}
