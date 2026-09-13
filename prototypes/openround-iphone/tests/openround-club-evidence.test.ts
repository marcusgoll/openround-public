import assert from "node:assert/strict";
import test from "node:test";
import {
  projectClubEvidence,
  type ClubEvidenceProjectionInput,
} from "../src/openroundClubEvidence.ts";
import {
  createDefaultEquipment,
  type ApproachClubId,
  type ShotOffset,
} from "../src/openroundModel.ts";
import type { ShotDistanceSample } from "../src/openroundOnCourseModel.ts";

function sample(clubId: string, yards: number, index: number): ShotDistanceSample {
  return {
    id: "sample-" + clubId + "-" + index,
    eventId: "event-" + clubId + "-" + index,
    holeNumber: 7,
    clubId,
    clubName: "6 Iron",
    yards,
    kind: "gps",
    savedToBag: false,
    createdAt: "2026-08-31T12:" + String(index).padStart(2, "0") + ":00.000Z",
  };
}

function input(overrides: Partial<ClubEvidenceProjectionInput> = {}): ClubEvidenceProjectionInput {
  return {
    equipment: createDefaultEquipment(),
    shotSamples: [],
    targetYards: 161,
    currentClubId: "7i",
    requestedPreviewClubId: "7i",
    mode: "demo",
    observedOffsetsByClubId: {},
    ...overrides,
  };
}

test("club evidence prefers GPS and applies the latest-ten MAD outlier rule", () => {
  const yards = [150, 163, 167, 166, 164, 168, 165, 167, 166, 169, 181];
  const projection = projectClubEvidence(input({
    shotSamples: yards.map((value, index) => sample("club-6", value, index)),
  }));
  const sixIron = projection.rows.find((row) => row.clubId === "6i");

  assert.equal(sixIron?.source, "gps");
  assert.equal(sixIron?.trueDistanceYards, 166);
  assert.equal(sixIron?.evidence.samples.length, 10);
  assert.equal(sixIron?.evidence.includedCount, 9);
  assert.equal(sixIron?.evidence.outlierCount, 1);
  assert.equal(sixIron?.summary, "LAST 10 GPS SHOTS · 9 USED · 1 OUTLIER");
  assert.deepEqual(sixIron?.evidence.samples.map((entry) => [entry.yards, entry.included]), [
    [163, true], [167, true], [166, true], [164, true], [168, true],
    [165, true], [167, true], [166, true], [169, true], [181, false],
  ]);
  assert.equal(Math.min(...(sixIron?.plotSamples.map((entry) => entry.heightPx) ?? [])), 24);
  assert.equal(Math.max(...(sixIron?.plotSamples.map((entry) => entry.heightPx) ?? [])), 62);

  const equal = projectClubEvidence(input({
    shotSamples: [154, 154, 154].map((value, index) => sample("club-7", value, index)),
  })).rows.find((row) => row.clubId === "7i");
  assert.equal(equal?.trueDistanceYards, 154);
  assert.equal(equal?.evidence.includedCount, 3);
  assert.equal(equal?.evidence.outlierCount, 0);
});

test("club evidence uses demo fixtures, then fails closed to bag baselines on live courses", () => {
  const demo = projectClubEvidence(input());
  const demoSixIron = demo.rows.find((row) => row.clubId === "6i");
  assert.equal(demoSixIron?.source, "demo");
  assert.equal(demoSixIron?.summary, "LAST 10 DEMO SHOTS · 9 USED · 1 OUTLIER");
  assert.equal(demoSixIron?.dispersion.circular, false);

  const equipment = createDefaultEquipment().map((club) =>
    club.slot === 5 ? { ...club, status: "retired" as const } : club
  );
  const live = projectClubEvidence(input({ equipment, mode: "live" }));
  const liveSixIron = live.rows.find((row) => row.clubId === "6i");
  assert.equal(liveSixIron?.source, "bag");
  assert.equal(liveSixIron?.trueDistanceYards, 166);
  assert.equal(liveSixIron?.summary, "NO GPS SHOTS YET · BAG BASELINE");
  assert.equal(liveSixIron?.evidence.samples.length, 0);
  assert.equal(liveSixIron?.dispersion.circular, true);
  assert.equal(live.rows.some((row) => row.clubId === "5i"), false);
  assert.equal(live.rows.some((row) => row.clubId === "putter"), false);
});

test("club evidence owns ordering, caddy choice, forced tee club, and preview fallback", () => {
  const projection = projectClubEvidence(input({ requestedPreviewClubId: "putter" }));
  assert.equal(projection.rows[0]?.clubId, "driver");
  assert.equal(projection.rows.at(-1)?.clubId, "lw");
  assert.equal(projection.caddyClubId, "6i");
  assert.equal(projection.previewClubId, "6i");
  assert.equal(projection.preview?.caddyPick, true);
  assert.equal(projection.rows.find((row) => row.clubId === "7i")?.currentPick, true);
  assert.ok(Math.abs(projection.targetRowPosition - (5 + 5 / 12)) < 0.0001);

  const forced = projectClubEvidence(input({ forcedCaddyClubId: "driver" }));
  assert.equal(forced.caddyClubId, "driver");
  assert.equal(forced.previewClubId, "7i");
});

test("club evidence uses supplied live aim-relative offsets and formats row evidence", () => {
  const offsets: ShotOffset[] = Array.from({ length: 10 }, (_, index) => ({
    lateralYards: index % 2 === 0 ? -7 : 9,
    distanceYards: index % 2 === 0 ? -6 : 8,
  }));
  const observedOffsetsByClubId: Partial<Record<ApproachClubId, readonly ShotOffset[]>> = { "6i": offsets };
  const projection = projectClubEvidence(input({
    mode: "live",
    requestedPreviewClubId: "6i",
    observedOffsetsByClubId,
  }));
  const sixIron = projection.preview;

  assert.equal(sixIron?.displayCode, "6i");
  assert.equal(sixIron?.equipmentSummary, "Stix · Nicholas Edition · 28°");
  assert.equal(sixIron?.dispersion.circular, false);
  assert.deepEqual(sixIron?.dispersion.envelope, {
    leftYards: 7,
    rightYards: 9,
    shortYards: 6,
    longYards: 8,
  });
  assert.match(sixIron?.accessibleLabel ?? "", /True Distance 166 yards/);
  assert.match(sixIron?.accessibleLabel ?? "", /5 yards long/);
  assert.match(sixIron?.accessibleLabel ?? "", /bag baseline/);
});

test("club evidence fails closed with no active clubs", () => {
  const equipment = createDefaultEquipment().map((club) => ({ ...club, status: "retired" as const }));
  assert.deepEqual(projectClubEvidence(input({ equipment })), {
    targetYards: 161,
    rows: [],
    caddyClubId: undefined,
    previewClubId: undefined,
    preview: undefined,
    targetRowPosition: 0,
  });
});
