import {
  EQUIPMENT_SLOT_TO_CLUB_ID,
  getClubProfile,
  getDispersionPresentation,
  type ApproachClubId,
  type ClubProfile,
  type DispersionPresentation,
  type EquipmentClub,
  type ShotOffset,
} from "./openroundModel.ts";
import { median, type ShotDistanceSample } from "./openroundOnCourseModel.ts";

export type ClubEvidenceSource = "gps" | "demo" | "bag";

export type ClubDistanceEvidence = {
  trueDistanceYards: number | undefined;
  includedCount: number;
  outlierCount: number;
  samples: Array<{ yards: number; included: boolean }>;
};

export type ClubEvidencePlotSample = {
  yards: number;
  included: boolean;
  heightPx: number;
};

export type ClubEvidenceRow = {
  clubId: ApproachClubId;
  displayCode: string;
  label: string;
  carryYards: number;
  totalYards: number;
  trueDistanceYards: number;
  deltaYards: number;
  source: ClubEvidenceSource;
  evidence: ClubDistanceEvidence;
  summary: string;
  equipmentSummary: string;
  dispersion: DispersionPresentation;
  plotSamples: ClubEvidencePlotSample[];
  accessibleLabel: string;
  caddyPick: boolean;
  currentPick: boolean;
  previewed: boolean;
};

export type ClubEvidenceProjectionInput = {
  equipment: readonly EquipmentClub[];
  shotSamples: readonly ShotDistanceSample[];
  targetYards: number;
  currentClubId: ApproachClubId;
  requestedPreviewClubId: ApproachClubId;
  forcedCaddyClubId?: ApproachClubId;
  mode: "demo" | "live";
  observedOffsetsByClubId: Partial<Record<ApproachClubId, readonly ShotOffset[]>>;
};

export type ClubEvidenceProjection = {
  targetYards: number;
  rows: ClubEvidenceRow[];
  caddyClubId: ApproachClubId | undefined;
  previewClubId: ApproachClubId | undefined;
  preview: ClubEvidenceRow | undefined;
  targetRowPosition: number;
};

const DEMO_DISTANCE_SAMPLE_DELTAS = [-3, 1, 0, -2, 2, -1, 1, 0, 3, 15] as const;

function deriveDistanceEvidence(values: readonly number[]): ClubDistanceEvidence {
  const recent = values.filter((value) => Number.isFinite(value) && value > 0).slice(-10);
  if (recent.length === 0) {
    return { trueDistanceYards: undefined, includedCount: 0, outlierCount: 0, samples: [] };
  }

  const center = median(recent)!;
  const mad = median(recent.map((value) => Math.abs(value - center))) ?? 0;
  const threshold = Math.max(3, mad * 3);
  const samples = recent.map((yards) => ({ yards, included: Math.abs(yards - center) <= threshold }));
  const included = samples.filter((sample) => sample.included);
  const trueDistanceYards = included.length > 0
    ? Math.round(included.reduce((total, sample) => total + sample.yards, 0) / included.length)
    : undefined;

  return {
    trueDistanceYards,
    includedCount: included.length,
    outlierCount: samples.length - included.length,
    samples,
  };
}

function profileForEquipment(clubId: ApproachClubId, equipmentClub: EquipmentClub): ClubProfile {
  const profile = getClubProfile(clubId);
  return {
    ...profile,
    carryYards: equipmentClub.carryYards ?? profile.carryYards,
    totalYards: equipmentClub.totalYards ?? profile.totalYards,
  };
}

function demoDistanceSamples(carryYards: number): number[] {
  return carryYards > 0 ? DEMO_DISTANCE_SAMPLE_DELTAS.map((delta) => carryYards + delta) : [];
}

function displayCode(clubId: ApproachClubId): string {
  if (clubId === "driver") return "Dr";
  if (clubId === "putter") return "P";
  if (clubId === "pw" || clubId === "gw" || clubId === "sw" || clubId === "lw") return clubId.toUpperCase();
  return clubId;
}

function evidenceSummary(source: ClubEvidenceSource, evidence: ClubDistanceEvidence): string {
  if (source === "bag") return "NO GPS SHOTS YET · BAG BASELINE";
  const sourceLabel = source === "demo" ? "DEMO" : "GPS";
  const outlierLabel = evidence.outlierCount === 1 ? "OUTLIER" : "OUTLIERS";
  return "LAST " + evidence.samples.length + " " + sourceLabel + " SHOTS · "
    + evidence.includedCount + " USED · " + evidence.outlierCount + " " + outlierLabel;
}

function plotSamples(evidence: ClubDistanceEvidence): ClubEvidencePlotSample[] {
  if (evidence.samples.length === 0) return [];
  const values = evidence.samples.map((sample) => sample.yards);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  return evidence.samples.map((sample) => ({
    ...sample,
    heightPx: 24 + ((sample.yards - min) / range) * 38,
  }));
}

function equipmentSummary(equipmentClub: EquipmentClub): string {
  const loft = equipmentClub.loft === null ? "LOFT —" : equipmentClub.loft + "°";
  return equipmentClub.brand + " · " + equipmentClub.model + " · " + loft;
}

function accessibleLabel(
  label: string,
  trueDistanceYards: number,
  deltaYards: number,
  source: ClubEvidenceSource,
  caddyPick: boolean,
): string {
  const delta = deltaYards >= 0 ? deltaYards + " yards long" : Math.abs(deltaYards) + " yards short";
  const evidence = source === "gps" ? "GPS evidence" : source === "demo" ? "demo evidence" : "bag baseline";
  return "Preview " + label + ". True Distance " + trueDistanceYards + " yards. "
    + delta + ". " + evidence + (caddyPick ? ". Caddy pick." : ".");
}

function rulerRowPosition(yards: number, orderedDistances: readonly number[]): number {
  if (orderedDistances.length <= 1 || yards >= orderedDistances[0]!) return 0;

  for (let index = 0; index < orderedDistances.length - 1; index += 1) {
    const upperYards = orderedDistances[index]!;
    const lowerYards = orderedDistances[index + 1]!;
    if (yards >= lowerYards) {
      return index + (upperYards - yards) / (upperYards - lowerYards);
    }
  }

  return orderedDistances.length - 1;
}

function projectTargetRowPosition(targetYards: number, clubDistances: readonly number[]): number {
  const orderedDistances = [...new Set(clubDistances)].sort((left, right) => right - left);
  return rulerRowPosition(targetYards, orderedDistances);
}

export function projectClubEvidence(input: ClubEvidenceProjectionInput): ClubEvidenceProjection {
  const targetYards = Number.isFinite(input.targetYards) ? Math.max(0, Math.round(input.targetYards)) : 0;
  const baseRows = input.equipment
    .filter((equipmentClub) => equipmentClub.status === "active")
    .map((equipmentClub) => {
      const clubId = EQUIPMENT_SLOT_TO_CLUB_ID[equipmentClub.slot - 1];
      if (!clubId || clubId === "putter") return null;
      const profile = profileForEquipment(clubId, equipmentClub);
      const gpsValues = input.shotSamples
        .filter((sample) => sample.clubId === equipmentClub.id)
        .map((sample) => sample.yards);
      const source: ClubEvidenceSource = gpsValues.length > 0 ? "gps" : input.mode === "demo" ? "demo" : "bag";
      const evidence = source === "gps"
        ? deriveDistanceEvidence(gpsValues)
        : source === "demo"
          ? deriveDistanceEvidence(demoDistanceSamples(profile.carryYards))
          : {
              trueDistanceYards: profile.carryYards > 0 ? profile.carryYards : undefined,
              includedCount: 0,
              outlierCount: 0,
              samples: [],
            };
      const trueDistanceYards = evidence.trueDistanceYards ?? profile.carryYards;
      const offsets = input.mode === "demo" ? profile.offsets : input.observedOffsetsByClubId[clubId] ?? [];
      return {
        clubId,
        profile,
        equipmentClub,
        trueDistanceYards,
        deltaYards: trueDistanceYards - targetYards,
        source,
        evidence,
        summary: evidenceSummary(source, evidence),
        dispersion: getDispersionPresentation(offsets),
        plotSamples: plotSamples(evidence),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) => right.trueDistanceYards - left.trueDistanceYards);

  const forcedCaddy = input.forcedCaddyClubId
    ? baseRows.find((row) => row.clubId === input.forcedCaddyClubId)
    : undefined;
  const nearestCaddy = baseRows.reduce<typeof baseRows[number] | undefined>((best, row) => {
    if (!best) return row;
    return Math.abs(row.deltaYards) < Math.abs(best.deltaYards) ? row : best;
  }, undefined);
  const caddyClubId = forcedCaddy?.clubId ?? nearestCaddy?.clubId;
  const previewClubId = baseRows.find((row) => row.clubId === input.requestedPreviewClubId)?.clubId
    ?? caddyClubId
    ?? baseRows[0]?.clubId;

  const rows: ClubEvidenceRow[] = baseRows.map((row) => {
    const caddyPick = row.clubId === caddyClubId;
    return {
      clubId: row.clubId,
      displayCode: displayCode(row.clubId),
      label: row.profile.label,
      carryYards: row.profile.carryYards,
      totalYards: row.profile.totalYards,
      trueDistanceYards: row.trueDistanceYards,
      deltaYards: row.deltaYards,
      source: row.source,
      evidence: row.evidence,
      summary: row.summary,
      equipmentSummary: equipmentSummary(row.equipmentClub),
      dispersion: row.dispersion,
      plotSamples: row.plotSamples,
      accessibleLabel: accessibleLabel(row.profile.label, row.trueDistanceYards, row.deltaYards, row.source, caddyPick),
      caddyPick,
      currentPick: row.clubId === input.currentClubId,
      previewed: row.clubId === previewClubId,
    };
  });
  return {
    targetYards,
    rows,
    caddyClubId,
    previewClubId,
    preview: rows.find((row) => row.clubId === previewClubId),
    targetRowPosition: projectTargetRowPosition(targetYards, rows.map((row) => row.trueDistanceYards)),
  };
}
