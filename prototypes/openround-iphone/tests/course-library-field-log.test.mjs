import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCourseFieldLog, PERSONAL_BETA_THRESHOLDS } from "../scripts/evaluate-course-field-log.mjs";

const passingLog = {
  runs: [
    { device: "iPhone current", courseId: "course-a", hole: 1, geometryGrade: "A", gps: [{ expectedYards: 50, recordedYards: 49.5, accuracyMeters: 4 }], alignment: { lateralYards: 4, longitudinalYards: 6 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true } },
    { device: "iPhone current", courseId: "course-b", hole: 1, geometryGrade: "B", gps: [{ expectedYards: 100, recordedYards: 101, accuracyMeters: 8 }], alignment: { lateralYards: 8, longitudinalYards: 9 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true } },
    { device: "iPhone older", courseId: "course-c", hole: 1, geometryGrade: "A", gps: [{ expectedYards: 150, recordedYards: 149, accuracyMeters: 10 }], alignment: { lateralYards: 7, longitudinalYards: 5 }, imagery: { provider: "bundled", attributionVisible: true, overlayAligned: true } },
  ],
};

const personalRun = (run, index) => ({
  id: `personal-beta-run-${index + 1}`,
  geometryVersion: "test-geometry-v1",
  createdAt: "2026-08-30T12:00:00.000Z",
  ...run,
});

const personalPayload = (runs, version = 1) => ({
  version,
  runs: runs.map(personalRun),
});

test("field log evaluator passes the documented release thresholds", () => {
  const report = evaluateCourseFieldLog(passingLog);
  assert.equal(report.ready, true);
  assert.deepEqual(report.coverage, { devices: 2, courses: 3, gpsCourses: 3, alignmentCourses: 3, pass: true });
  assert.equal(report.gps.pass, true);
  assert.equal(report.alignment.pass, true);
  assert.deepEqual(report.imagery, { runs: 3, providers: ["bundled", "usgs"], pass: true });
});

test("field log evaluator reports fix freshness and rejects a stale sample", () => {
  const freshLog = {
    runs: passingLog.runs.map((run, index) => ({
      ...run,
      gps: run.gps.map((sample) => ({ ...sample, fixAgeSeconds: index + 1 })),
    })),
  };
  const freshReport = evaluateCourseFieldLog(freshLog);
  assert.equal(freshReport.ready, true);
  assert.equal(freshReport.gps.maxFixAgeSeconds, 3);
  assert.equal(freshReport.gps.p95FixAgeSeconds, 2.9);
  assert.equal(freshReport.gps.freshnessPass, true);

  const staleReport = evaluateCourseFieldLog({
    runs: freshLog.runs.map((run, index) => index === 1
      ? { ...run, gps: run.gps.map((sample) => ({ ...sample, fixAgeSeconds: 21 })) }
      : run),
  });
  assert.equal(staleReport.gps.freshnessPass, false);
  assert.equal(staleReport.gps.pass, false);
  assert.ok(staleReport.issues.some((issue) => issue.includes("fix age 21 seconds exceeds 20 seconds")));
});

test("field log evaluator verifies two-point phone GPS distance and endpoint freshness", () => {
  const pairSample = {
    expectedYards: 100,
    recordedYards: 100,
    accuracyMeters: 6,
    fixAgeSeconds: 1,
    source: "phone_pair",
    start: { lat: 32, lon: -97 },
    end: { lat: 32.000824, lon: -97 },
    startFixAgeSeconds: 2,
    endFixAgeSeconds: 1,
  };
  const pairReport = evaluateCourseFieldLog({
    runs: passingLog.runs.map((run, index) => index === 0 ? { ...run, gps: [pairSample] } : run),
  });
  assert.equal(pairReport.ready, true);
  assert.equal(pairReport.gps.phonePairSamples, 1);
  assert.equal(pairReport.gps.phonePairPass, true);

  const stalePairReport = evaluateCourseFieldLog({
    runs: passingLog.runs.map((run, index) => index === 0
      ? { ...run, gps: [{ ...pairSample, startFixAgeSeconds: 21 }] }
      : run),
  });
  assert.equal(stalePairReport.gps.phonePairPass, true);
  assert.equal(stalePairReport.gps.freshnessPass, false);
  assert.equal(stalePairReport.gps.pass, false);
  assert.ok(stalePairReport.issues.some((issue) => issue.includes("start fix age 21 seconds exceeds 20 seconds")));

  const mismatchedPairReport = evaluateCourseFieldLog({
    runs: passingLog.runs.map((run, index) => index === 0
      ? { ...run, gps: [{ ...pairSample, recordedYards: 120 }] }
      : run),
  });
  assert.equal(mismatchedPairReport.gps.phonePairPass, false);
  assert.equal(mismatchedPairReport.gps.pass, false);
  assert.ok(mismatchedPairReport.issues.some((issue) => issue.includes("phone_pair recordedYards does not match")));
});

test("personal beta passes coverage with one iPhone across Links, Lakes, and a control", () => {
  const pairSample = {
    expectedYards: 100,
    recordedYards: 100,
    accuracyMeters: 6,
    fixAgeSeconds: 1,
    source: "phone_pair",
    start: { lat: 32, lon: -97 },
    end: { lat: 32.000824, lon: -97 },
    startFixAgeSeconds: 2,
    endFixAgeSeconds: 1,
  };
  const report = evaluateCourseFieldLog(personalPayload([
      { device: "Marcus iPhone", courseId: "personal-squaw-valley-links-osm-v1", hole: 1, teeBox: "blue", geometryGrade: "B", gps: [pairSample], alignment: { lateralYards: 4, longitudinalYards: 6 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true, alignmentZooms: { oneX: true, twoX: true } } },
      { device: "Marcus iPhone", courseId: "personal-squaw-valley-lakes-pending-v1", hole: 1, teeBox: "blue", geometryGrade: "A", gps: [pairSample], alignment: { lateralYards: 7, longitudinalYards: 8 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true, alignmentZooms: { oneX: true, twoX: true } } },
      { device: "Marcus iPhone", courseId: "course-control", hole: 1, teeBox: "blue", geometryGrade: "B", gps: [pairSample], alignment: { lateralYards: 7, longitudinalYards: 5 }, imagery: { provider: "bundled", attributionVisible: true, overlayAligned: true, alignmentZooms: { oneX: true, twoX: true } } },
  ]), PERSONAL_BETA_THRESHOLDS);
  assert.equal(report.ready, true);
  assert.deepEqual(report.coverage, { devices: 1, courses: 3, gpsCourses: 3, alignmentCourses: 3, pass: true });
  assert.equal(report.gps.phonePairCourses, 3);
  assert.equal(report.gps.phonePairCoveragePass, true);
  assert.deepEqual(report.tee, { runs: 3, boxes: ["blue"], pass: true });
});

test("personal beta requires a versioned payload and bound run metadata", () => {
  const baseRun = {
    device: "Marcus iPhone",
    courseId: "course-control",
    hole: 1,
    teeBox: "blue",
    geometryGrade: "B",
    gps: [],
    alignment: { lateralYards: 4, longitudinalYards: 6 },
    imagery: { provider: "bundled", attributionVisible: true, overlayAligned: true, alignmentZooms: { oneX: true, twoX: true } },
  };
  const valid = evaluateCourseFieldLog(personalPayload([baseRun]), PERSONAL_BETA_THRESHOLDS);
  assert.equal(valid.metadata.pass, true);

  const missingVersion = evaluateCourseFieldLog({ runs: personalPayload([baseRun]).runs }, PERSONAL_BETA_THRESHOLDS);
  assert.equal(missingVersion.metadata.pass, false);
  assert.ok(missingVersion.issues.some((issue) => issue.includes("payload version must be 1")));

  const missingId = personalPayload([baseRun]);
  delete missingId.runs[0].id;
  const missingIdReport = evaluateCourseFieldLog(missingId, PERSONAL_BETA_THRESHOLDS);
  assert.equal(missingIdReport.metadata.pass, false);
  assert.ok(missingIdReport.issues.some((issue) => issue.includes("id is required")));

  const duplicateIds = personalPayload([baseRun, baseRun]);
  duplicateIds.runs[1].id = duplicateIds.runs[0].id;
  const duplicateReport = evaluateCourseFieldLog(duplicateIds, PERSONAL_BETA_THRESHOLDS);
  assert.equal(duplicateReport.metadata.pass, false);
  assert.ok(duplicateReport.issues.some((issue) => issue.includes("id must be unique")));

  const missingGeometryVersion = personalPayload([baseRun]);
  delete missingGeometryVersion.runs[0].geometryVersion;
  const missingGeometryReport = evaluateCourseFieldLog(missingGeometryVersion, PERSONAL_BETA_THRESHOLDS);
  assert.equal(missingGeometryReport.metadata.pass, false);
  assert.ok(missingGeometryReport.issues.some((issue) => issue.includes("geometryVersion is required")));

  const invalidCreatedAt = personalPayload([baseRun]);
  invalidCreatedAt.runs[0].createdAt = "not-a-timestamp";
  const invalidCreatedReport = evaluateCourseFieldLog(invalidCreatedAt, PERSONAL_BETA_THRESHOLDS);
  assert.equal(invalidCreatedReport.metadata.pass, false);
  assert.ok(invalidCreatedReport.issues.some((issue) => issue.includes("createdAt must be a valid timestamp")));
});

test("personal beta requires tee provenance for every run", () => {
  const pairSample = {
    expectedYards: 100,
    recordedYards: 100,
    accuracyMeters: 6,
    fixAgeSeconds: 1,
    source: "phone_pair",
    start: { lat: 32, lon: -97 },
    end: { lat: 32.000824, lon: -97 },
    startFixAgeSeconds: 2,
    endFixAgeSeconds: 1,
  };
  const run = (courseId, geometryGrade = "B") => ({
    device: "Marcus iPhone",
    courseId,
    hole: 1,
    teeBox: "blue",
    geometryGrade,
    gps: [pairSample],
    alignment: { lateralYards: 4, longitudinalYards: 6 },
    imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true, alignmentZooms: { oneX: true, twoX: true } },
  });
  const runs = [
    run("personal-squaw-valley-links-osm-v1"),
    { ...run("personal-squaw-valley-lakes-pending-v1", "A"), teeBox: undefined },
    run("course-control"),
  ];
  const report = evaluateCourseFieldLog(personalPayload(runs), PERSONAL_BETA_THRESHOLDS);
  assert.equal(report.ready, false);
  assert.equal(report.tee.pass, false);
  assert.ok(report.issues.some((issue) => issue.includes("teeBox is required")));
});

test("personal beta requires explicit 1x and 2x imagery alignment checks", () => {
  const pairSample = {
    expectedYards: 100,
    recordedYards: 100,
    accuracyMeters: 6,
    fixAgeSeconds: 1,
    source: "phone_pair",
    start: { lat: 32, lon: -97 },
    end: { lat: 32.000824, lon: -97 },
    startFixAgeSeconds: 2,
    endFixAgeSeconds: 1,
  };
  const report = evaluateCourseFieldLog(personalPayload([
      { device: "Marcus iPhone", courseId: "personal-squaw-valley-links-osm-v1", hole: 1, teeBox: "blue", geometryGrade: "B", gps: [pairSample], alignment: { lateralYards: 4, longitudinalYards: 6 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true } },
      { device: "Marcus iPhone", courseId: "personal-squaw-valley-lakes-pending-v1", hole: 1, teeBox: "blue", geometryGrade: "A", gps: [pairSample], alignment: { lateralYards: 7, longitudinalYards: 8 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true, alignmentZooms: { oneX: true, twoX: false } } },
      { device: "Marcus iPhone", courseId: "course-control", hole: 1, teeBox: "blue", geometryGrade: "B", gps: [pairSample], alignment: { lateralYards: 7, longitudinalYards: 5 }, imagery: { provider: "bundled", attributionVisible: true, overlayAligned: true, alignmentZooms: { oneX: true, twoX: true } } },
  ]), PERSONAL_BETA_THRESHOLDS);
  assert.equal(report.ready, false);
  assert.equal(report.imagery.pass, false);
  assert.ok(report.issues.some((issue) => issue.includes("both 1x and 2x")));
});

test("personal beta rejects manual-only distance entries as phone evidence", () => {
  const report = evaluateCourseFieldLog(personalPayload([
      { device: "Marcus iPhone", courseId: "personal-squaw-valley-links-osm-v1", hole: 1, teeBox: "blue", geometryGrade: "B", gps: [{ expectedYards: 100, recordedYards: 99, accuracyMeters: 5 }], alignment: { lateralYards: 4, longitudinalYards: 6 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true } },
      { device: "Marcus iPhone", courseId: "personal-squaw-valley-lakes-pending-v1", hole: 1, teeBox: "blue", geometryGrade: "A", gps: [{ expectedYards: 120, recordedYards: 121, accuracyMeters: 6 }], alignment: { lateralYards: 7, longitudinalYards: 8 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true } },
      { device: "Marcus iPhone", courseId: "course-control", hole: 1, teeBox: "blue", geometryGrade: "B", gps: [{ expectedYards: 150, recordedYards: 149, accuracyMeters: 8 }], alignment: { lateralYards: 7, longitudinalYards: 5 }, imagery: { provider: "bundled", attributionVisible: true, overlayAligned: true } },
  ]), PERSONAL_BETA_THRESHOLDS);
  assert.equal(report.ready, false);
  assert.equal(report.gps.phonePairCoveragePass, false);
  assert.ok(report.issues.some((issue) => issue.includes("phone GPS pair evidence")));
});

test("personal beta fails closed when either Squaw Valley layout is missing", () => {
  const report = evaluateCourseFieldLog(personalPayload([
      { device: "Marcus iPhone", courseId: "personal-squaw-valley-links-osm-v1", hole: 1, teeBox: "blue", geometryGrade: "B", gps: [{ expectedYards: 100, recordedYards: 99, accuracyMeters: 5 }], alignment: { lateralYards: 4, longitudinalYards: 6 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true } },
      { device: "Marcus iPhone", courseId: "course-control-a", hole: 1, teeBox: "blue", geometryGrade: "B", gps: [{ expectedYards: 120, recordedYards: 121, accuracyMeters: 6 }], alignment: { lateralYards: 7, longitudinalYards: 8 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true } },
      { device: "Marcus iPhone", courseId: "course-control-b", hole: 1, teeBox: "blue", geometryGrade: "B", gps: [{ expectedYards: 150, recordedYards: 149, accuracyMeters: 8 }], alignment: { lateralYards: 7, longitudinalYards: 5 }, imagery: { provider: "bundled", attributionVisible: true, overlayAligned: true } },
  ]), PERSONAL_BETA_THRESHOLDS);
  assert.equal(report.ready, false);
  assert.ok(report.issues.some((issue) => issue.includes("personal-squaw-valley-lakes-pending-v1")));
});

test("personal beta fails closed when the field log mixes iPhones", () => {
  const report = evaluateCourseFieldLog(personalPayload([
      { device: "Marcus iPhone", courseId: "personal-squaw-valley-links-osm-v1", hole: 1, teeBox: "blue", geometryGrade: "B", gps: [{ expectedYards: 100, recordedYards: 99, accuracyMeters: 5 }], alignment: { lateralYards: 4, longitudinalYards: 6 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true } },
      { device: "Second iPhone", courseId: "personal-squaw-valley-lakes-pending-v1", hole: 1, teeBox: "blue", geometryGrade: "A", gps: [{ expectedYards: 120, recordedYards: 121, accuracyMeters: 6 }], alignment: { lateralYards: 7, longitudinalYards: 8 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true } },
      { device: "Marcus iPhone", courseId: "course-control", hole: 1, teeBox: "blue", geometryGrade: "B", gps: [{ expectedYards: 150, recordedYards: 149, accuracyMeters: 8 }], alignment: { lateralYards: 7, longitudinalYards: 5 }, imagery: { provider: "bundled", attributionVisible: true, overlayAligned: true } },
  ]), PERSONAL_BETA_THRESHOLDS);
  assert.equal(report.ready, false);
  assert.ok(report.issues.some((issue) => issue.includes("coverage allows at most 1 device")));
});

test("field log evaluator fails closed for incomplete coverage and unsafe accuracy", () => {
  const report = evaluateCourseFieldLog({
    runs: [{ device: "one phone", courseId: "one course", hole: 1, geometryGrade: "C", gps: [{ expectedYards: 100, recordedYards: 80, accuracyMeters: 20 }] }],
  });
  assert.equal(report.ready, false);
  assert.equal(report.gps.pass, false);
  assert.equal(report.alignment.pass, false);
  assert.equal(report.imagery.pass, false);
  assert.ok(report.issues.some((issue) => issue.includes("coverage requires")));
  assert.ok(report.issues.some((issue) => issue.includes("GPS accuracy")));
  assert.ok(report.issues.some((issue) => issue.includes("imagery provider")));
});

test("field log evaluator requires GPS for every course and alignment on multiple courses", () => {
  const report = evaluateCourseFieldLog({
    runs: [
      { device: "one phone", courseId: "course-a", hole: 1, geometryGrade: "A", gps: [{ expectedYards: 100, recordedYards: 99, accuracyMeters: 5 }], alignment: { lateralYards: 4, longitudinalYards: 6 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true } },
      { device: "one phone", courseId: "course-b", hole: 1, geometryGrade: "B", gps: [], imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true } },
      { device: "one phone", courseId: "course-c", hole: 1, geometryGrade: "A", gps: [], imagery: { provider: "bundled", attributionVisible: true, overlayAligned: true } },
    ],
  });
  assert.equal(report.ready, false);
  assert.equal(report.coverage.gpsCourses, 1);
  assert.equal(report.coverage.alignmentCourses, 1);
  assert.ok(report.issues.some((issue) => issue.includes("GPS evidence requires at least 3 courses")));
  assert.ok(report.issues.some((issue) => issue.includes("alignment evidence requires at least 2 grade A/B courses")));
});

test("field log evaluator rejects a per-course GPS outlier hidden by the aggregate median", () => {
  const report = evaluateCourseFieldLog({
    runs: [
      { device: "one phone", courseId: "course-a", hole: 1, geometryGrade: "A", gps: [{ expectedYards: 100, recordedYards: 120, accuracyMeters: 5 }], alignment: { lateralYards: 4, longitudinalYards: 6 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true } },
      { device: "one phone", courseId: "course-b", hole: 1, geometryGrade: "B", gps: [{ expectedYards: 100, recordedYards: 100, accuracyMeters: 5 }], alignment: { lateralYards: 5, longitudinalYards: 6 }, imagery: { provider: "usgs", attributionVisible: true, overlayAligned: true } },
      { device: "one phone", courseId: "course-c", hole: 1, geometryGrade: "A", gps: [{ expectedYards: 100, recordedYards: 100, accuracyMeters: 5 }], alignment: { lateralYards: 6, longitudinalYards: 5 }, imagery: { provider: "bundled", attributionVisible: true, overlayAligned: true } },
    ],
  });
  assert.equal(report.gps.medianErrorPercent, 0);
  assert.equal(report.gps.pass, false);
  assert.equal(report.gps.byCourse[0]?.courseId, "course-a");
  assert.ok(report.issues.some((issue) => issue.includes("GPS median error for course-a exceeds 3%")));
});
