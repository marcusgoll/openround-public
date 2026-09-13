import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_RECORDED_FIX_AGE_SECONDS = 300;

export const FIELD_TEST_THRESHOLDS = {
  gpsMedianErrorPercent: 3,
  maxAcceptedAccuracyMeters: 12,
  maxFixAgeSeconds: 20,
  maxAlignmentMismatchYards: 10,
  minDevices: 1,
  minCourses: 3,
  minGpsCourses: 3,
  minAlignmentCourses: 2,
};

export const PERSONAL_BETA_COURSE_IDS = [
  "personal-squaw-valley-links-osm-v1",
  "personal-squaw-valley-lakes-pending-v1",
];

export const PERSONAL_BETA_THRESHOLDS = {
  ...FIELD_TEST_THRESHOLDS,
  requiredCourseIds: PERSONAL_BETA_COURSE_IDS,
  maxDevices: 1,
  requirePhonePairPerCourse: true,
  requireExplicitZoomChecks: true,
  requireTeeBox: true,
  requirePayloadVersion: true,
  requireRunMetadata: true,
};

const EARTH_RADIUS_METERS = 6_371_008.8;
const YARDS_PER_METER = 1.093_613_3;
const FIELD_LOG_TEE_BOXES = new Set(["blue", "white", "gold", "black", "red"]);

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validGeoPoint(value) {
  const point = asRecord(value);
  const lat = finite(point?.lat);
  const lon = finite(point?.lon);
  return lat !== undefined && lon !== undefined && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function validAlignmentZooms(value) {
  const zooms = asRecord(value);
  return zooms?.oneX === true && zooms?.twoX === true;
}

function distanceYards(start, end) {
  const startPoint = asRecord(start);
  const endPoint = asRecord(end);
  const startLat = finite(startPoint?.lat);
  const startLon = finite(startPoint?.lon);
  const endLat = finite(endPoint?.lat);
  const endLon = finite(endPoint?.lon);
  if (startLat === undefined || startLon === undefined || endLat === undefined || endLon === undefined) return undefined;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const dLat = toRadians(endLat - startLat);
  const dLon = toRadians(endLon - startLon);
  const latitude = toRadians((startLat + endLat) / 2);
  return Math.hypot(dLat, dLon * Math.cos(latitude)) * EARTH_RADIUS_METERS * YARDS_PER_METER;
}

function quantile(values, probability) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function evaluateCourseFieldLog(value, thresholds = FIELD_TEST_THRESHOLDS) {
  const root = asRecord(value);
  const runs = Array.isArray(root?.runs) ? root.runs : [];
  const issues = [];
  const devices = new Set();
  const courses = new Set();
  const gpsCourses = new Set();
  const alignmentCourses = new Set();
  const gpsErrors = [];
  const gpsAccuracies = [];
  const gpsFixAges = [];
  const gpsByCourse = new Map();
  const phonePairCourses = new Set();
  const alignmentMismatches = [];
  const imageryProviders = new Set();
  const runIds = new Set();
  const requireExplicitZoomChecks = thresholds.requireExplicitZoomChecks === true;
  const requireTeeBox = thresholds.requireTeeBox === true;
  const requirePayloadVersion = thresholds.requirePayloadVersion === true;
  const requireRunMetadata = thresholds.requireRunMetadata === true;
  const requiredCourseIds = Array.isArray(thresholds.requiredCourseIds)
    ? thresholds.requiredCourseIds.filter((courseId) => typeof courseId === "string" && courseId.trim()).map((courseId) => courseId.trim())
    : [];
  let imageryChecks = 0;
  let imageryPass = true;
  let gpsFreshnessPass = true;
  let gpsPairPass = true;
  let gpsPairSamples = 0;
  let teeBoxSamples = 0;
  let teeBoxPass = true;
  let metadataPass = true;
  const maxFixAgeSeconds = finite(thresholds.maxFixAgeSeconds);

  if (requirePayloadVersion && root?.version !== 1) {
    issues.push("payload version must be 1 for personal-beta evidence");
    metadataPass = false;
  }

  runs.forEach((runValue, runIndex) => {
    const run = asRecord(runValue);
    if (requireRunMetadata) {
      const runId = typeof run?.id === "string" ? run.id.trim() : "";
      if (!runId) {
        issues.push(`run ${runIndex + 1}: id is required for personal-beta evidence`);
        metadataPass = false;
      } else if (runIds.has(runId)) {
        issues.push(`run ${runIndex + 1}: id must be unique for personal-beta evidence`);
        metadataPass = false;
      } else {
        runIds.add(runId);
      }
      const geometryVersion = typeof run?.geometryVersion === "string" ? run.geometryVersion.trim() : "";
      if (!geometryVersion) {
        issues.push(`run ${runIndex + 1}: geometryVersion is required for personal-beta evidence`);
        metadataPass = false;
      }
      if (typeof run?.createdAt !== "string" || !run.createdAt.trim() || !Number.isFinite(Date.parse(run.createdAt))) {
        issues.push(`run ${runIndex + 1}: createdAt must be a valid timestamp for personal-beta evidence`);
        metadataPass = false;
      }
    }
    const device = typeof run?.device === "string" ? run.device.trim() : "";
    const courseId = typeof run?.courseId === "string" ? run.courseId.trim() : "";
    const hole = finite(run?.hole);
    const rawTeeBox = run?.teeBox;
    const teeBox = typeof rawTeeBox === "string" ? rawTeeBox.trim().toLowerCase() : "";
    if (!device) issues.push(`run ${runIndex + 1}: missing device`);
    else devices.add(device);
    if (!courseId) issues.push(`run ${runIndex + 1}: missing courseId`);
    else courses.add(courseId);
    if (!Number.isInteger(hole) || hole < 1) issues.push(`run ${runIndex + 1}: invalid hole`);
    if (rawTeeBox === undefined) {
      if (requireTeeBox) {
        issues.push(`run ${runIndex + 1}: teeBox is required for personal-beta evidence`);
        teeBoxPass = false;
      }
    } else if (!FIELD_LOG_TEE_BOXES.has(teeBox)) {
      issues.push(`run ${runIndex + 1}: teeBox must be blue, white, gold, black, or red`);
      teeBoxPass = false;
    } else {
      teeBoxSamples += 1;
    }

    const gpsSamples = Array.isArray(run?.gps) ? run.gps : [];
    gpsSamples.forEach((sampleValue, sampleIndex) => {
      const sample = asRecord(sampleValue);
      const expectedYards = finite(sample?.expectedYards);
      const recordedYards = finite(sample?.recordedYards);
      const accuracyMeters = finite(sample?.accuracyMeters);
      if (expectedYards === undefined || expectedYards <= 0 || recordedYards === undefined || recordedYards < 0 || accuracyMeters === undefined || accuracyMeters < 0) {
        issues.push(`run ${runIndex + 1} GPS sample ${sampleIndex + 1}: expectedYards, recordedYards, and accuracyMeters must be finite and non-negative (expectedYards > 0)`);
        return;
      }
      const source = sample?.source;
      const start = sample?.start;
      const end = sample?.end;
      const startFixAgeSeconds = finite(sample?.startFixAgeSeconds);
      const endFixAgeSeconds = finite(sample?.endFixAgeSeconds);
      const hasPairFields = start !== undefined || end !== undefined || sample?.startFixAgeSeconds !== undefined || sample?.endFixAgeSeconds !== undefined;
      if (source !== undefined && source !== "manual" && source !== "phone_pair") {
        issues.push(`run ${runIndex + 1} GPS sample ${sampleIndex + 1}: source must be manual or phone_pair`);
        gpsPairPass = false;
      }
      const checkFixAge = (age, label) => {
        if (age === undefined || age < 0 || age > MAX_RECORDED_FIX_AGE_SECONDS) {
          issues.push(`run ${runIndex + 1} GPS sample ${sampleIndex + 1}: ${label} must be finite and between 0 and ${MAX_RECORDED_FIX_AGE_SECONDS} seconds`);
          gpsFreshnessPass = false;
          return;
        }
        gpsFixAges.push(age);
        if (maxFixAgeSeconds !== undefined && age > maxFixAgeSeconds) {
          issues.push(`run ${runIndex + 1} GPS sample ${sampleIndex + 1}: ${label} ${age} seconds exceeds ${maxFixAgeSeconds} seconds`);
          gpsFreshnessPass = false;
        }
      };
      if (source === "phone_pair") {
        gpsPairSamples += 1;
        const validPairAges = startFixAgeSeconds !== undefined
          && endFixAgeSeconds !== undefined
          && startFixAgeSeconds >= 0
          && startFixAgeSeconds <= MAX_RECORDED_FIX_AGE_SECONDS
          && endFixAgeSeconds >= 0
          && endFixAgeSeconds <= MAX_RECORDED_FIX_AGE_SECONDS;
        let validPhonePair = false;
        if (!validGeoPoint(start) || !validGeoPoint(end) || !validPairAges) {
          issues.push(`run ${runIndex + 1} GPS sample ${sampleIndex + 1}: phone_pair requires valid start/end coordinates and both endpoint fix ages`);
          gpsPairPass = false;
        } else {
          const derivedYards = distanceYards(start, end);
          validPhonePair = derivedYards !== undefined && Math.abs(derivedYards - recordedYards) <= 2;
          if (!validPhonePair) {
            issues.push(`run ${runIndex + 1} GPS sample ${sampleIndex + 1}: phone_pair recordedYards does not match its endpoint distance`);
            gpsPairPass = false;
          }
          checkFixAge(startFixAgeSeconds, "start fix age");
          checkFixAge(endFixAgeSeconds, "end fix age");
        }
        if (sample?.fixAgeSeconds !== undefined) checkFixAge(finite(sample.fixAgeSeconds), "fix age");
        if (validPhonePair && courseId) phonePairCourses.add(courseId);
      } else {
        if (hasPairFields) {
          issues.push(`run ${runIndex + 1} GPS sample ${sampleIndex + 1}: endpoint fields require source phone_pair`);
          gpsPairPass = false;
        }
        const hasFixAge = sample?.fixAgeSeconds !== undefined;
        const fixAgeSeconds = hasFixAge ? finite(sample.fixAgeSeconds) : undefined;
        if (hasFixAge) checkFixAge(fixAgeSeconds, "fix age");
      }
      if (courseId) gpsCourses.add(courseId);
      const errorPercent = Math.abs(recordedYards - expectedYards) / expectedYards * 100;
      gpsErrors.push(errorPercent);
      gpsAccuracies.push(accuracyMeters);
      if (courseId) {
        const courseSamples = gpsByCourse.get(courseId) ?? [];
        courseSamples.push({ errorPercent, accuracyMeters });
        gpsByCourse.set(courseId, courseSamples);
      }
    });

    const alignment = asRecord(run?.alignment);
    const grade = typeof run?.geometryGrade === "string" ? run.geometryGrade.toUpperCase() : "";
    if (alignment && (grade === "A" || grade === "B")) {
      const lateralYards = finite(alignment.lateralYards);
      const longitudinalYards = finite(alignment.longitudinalYards);
      if (lateralYards === undefined || longitudinalYards === undefined || lateralYards < 0 || longitudinalYards < 0) {
        issues.push(`run ${runIndex + 1}: A/B alignment requires non-negative lateralYards and longitudinalYards`);
      } else {
        if (courseId) alignmentCourses.add(courseId);
        alignmentMismatches.push({ lateralYards, longitudinalYards });
      }
    } else if (alignment && grade !== "A" && grade !== "B") {
      issues.push(`run ${runIndex + 1}: alignment is only accepted for grade A/B geometry`);
    }

    const imagery = asRecord(run?.imagery);
    const provider = typeof imagery?.provider === "string" ? imagery.provider.trim().toLowerCase() : "";
    const attributionVisible = imagery?.attributionVisible === true;
    const overlayAligned = imagery?.overlayAligned === true;
    const alignmentZoomsPresent = imagery?.alignmentZooms !== undefined;
    const alignmentZoomsValid = validAlignmentZooms(imagery?.alignmentZooms);
    if (!imagery || !["google", "usgs", "bundled"].includes(provider)) {
      issues.push(`run ${runIndex + 1}: imagery provider must be google, usgs, or bundled`);
      imageryPass = false;
    } else {
      imageryChecks += 1;
      imageryProviders.add(provider);
      if (!attributionVisible) {
        issues.push(`run ${runIndex + 1}: imagery attribution must be visible`);
        imageryPass = false;
      }
      if (!overlayAligned || (requireExplicitZoomChecks && !alignmentZoomsValid)) {
        issues.push(`run ${runIndex + 1}: imagery overlay alignment must pass explicitly at both 1x and 2x`);
        imageryPass = false;
      }
      if (alignmentZoomsPresent && !alignmentZoomsValid) {
        issues.push(`run ${runIndex + 1}: alignmentZooms must set oneX and twoX to true`);
        imageryPass = false;
      }
    }
  });

  const medianErrorPercent = quantile(gpsErrors, 0.5);
  const p95ErrorPercent = quantile(gpsErrors, 0.95);
  const maxAccuracyMeters = gpsAccuracies.length > 0 ? Math.max(...gpsAccuracies) : undefined;
  const maxRecordedFixAgeSeconds = gpsFixAges.length > 0 ? Math.max(...gpsFixAges) : undefined;
  const p95FixAgeSeconds = quantile(gpsFixAges, 0.95);
  const maxLateralYards = alignmentMismatches.length > 0 ? Math.max(...alignmentMismatches.map((item) => item.lateralYards)) : undefined;
  const maxLongitudinalYards = alignmentMismatches.length > 0 ? Math.max(...alignmentMismatches.map((item) => item.longitudinalYards)) : undefined;
  const missingRequiredCourseIds = requiredCourseIds.filter((courseId) => !courses.has(courseId));
  const minGpsCourses = Number.isInteger(thresholds.minGpsCourses) ? thresholds.minGpsCourses : thresholds.minCourses;
  const minAlignmentCourses = Number.isInteger(thresholds.minAlignmentCourses) ? thresholds.minAlignmentCourses : 1;
  const maxDevices = Number.isInteger(thresholds.maxDevices) ? thresholds.maxDevices : undefined;
  const deviceCountPass = devices.size >= thresholds.minDevices && (maxDevices === undefined || devices.size <= maxDevices);
  const requiredGpsCourses = Math.max(minGpsCourses, courses.size);
  const gpsCoveragePass = gpsCourses.size >= requiredGpsCourses;
  const requirePhonePairPerCourse = thresholds.requirePhonePairPerCourse === true;
  const phonePairCoveragePass = !requirePhonePairPerCourse || [...courses].every((courseId) => phonePairCourses.has(courseId));
  const alignmentCoveragePass = alignmentCourses.size >= minAlignmentCourses;
  const coveragePass = deviceCountPass && courses.size >= thresholds.minCourses && missingRequiredCourseIds.length === 0 && gpsCoveragePass && phonePairCoveragePass && alignmentCoveragePass && teeBoxPass && metadataPass;
  const gpsCourseMetrics = [...gpsByCourse.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([courseId, samples]) => ({
      courseId,
      samples: samples.length,
      medianErrorPercent: quantile(samples.map((sample) => sample.errorPercent), 0.5),
      maxAccuracyMeters: Math.max(...samples.map((sample) => sample.accuracyMeters)),
    }));
  const gpsCourseMetricsPass = gpsCourseMetrics.length >= minGpsCourses && gpsCourseMetrics.every((metric) =>
    metric.medianErrorPercent <= thresholds.gpsMedianErrorPercent && metric.maxAccuracyMeters <= thresholds.maxAcceptedAccuracyMeters,
  );
  const gpsPass = gpsErrors.length > 0 && medianErrorPercent <= thresholds.gpsMedianErrorPercent && maxAccuracyMeters <= thresholds.maxAcceptedAccuracyMeters && gpsCourseMetricsPass && gpsFreshnessPass && gpsPairPass;
  const alignmentPass = alignmentMismatches.length > 0 && maxLateralYards <= thresholds.maxAlignmentMismatchYards && maxLongitudinalYards <= thresholds.maxAlignmentMismatchYards;
  if (devices.size < thresholds.minDevices) issues.push(`coverage requires at least ${thresholds.minDevices} devices`);
  if (maxDevices !== undefined && devices.size > maxDevices) issues.push(`coverage allows at most ${maxDevices} device${maxDevices === 1 ? "" : "s"}`);
  if (courses.size < thresholds.minCourses) issues.push(`coverage requires at least ${thresholds.minCourses} courses`);
  if (missingRequiredCourseIds.length > 0) issues.push(`coverage requires course IDs: ${missingRequiredCourseIds.join(", ")}`);
  if (!gpsCoveragePass) issues.push(`GPS evidence requires at least ${requiredGpsCourses} courses`);
  if (!phonePairCoveragePass) issues.push("phone GPS pair evidence requires at least one valid phone_pair sample for every course");
  if (!alignmentCoveragePass) issues.push(`alignment evidence requires at least ${minAlignmentCourses} grade A/B courses`);
  gpsCourseMetrics.filter((metric) => metric.medianErrorPercent > thresholds.gpsMedianErrorPercent).forEach((metric) => {
    issues.push(`GPS median error for ${metric.courseId} exceeds ${thresholds.gpsMedianErrorPercent}%`);
  });
  gpsCourseMetrics.filter((metric) => metric.maxAccuracyMeters > thresholds.maxAcceptedAccuracyMeters).forEach((metric) => {
    issues.push(`GPS accuracy for ${metric.courseId} exceeds ${thresholds.maxAcceptedAccuracyMeters} m`);
  });
  if (gpsErrors.length === 0) issues.push("at least one valid GPS sample is required");
  if (alignmentMismatches.length === 0) issues.push("at least one grade A/B alignment sample is required");
  if (gpsErrors.length > 0 && medianErrorPercent > thresholds.gpsMedianErrorPercent) issues.push(`GPS median error exceeds ${thresholds.gpsMedianErrorPercent}%`);
  if (maxAccuracyMeters !== undefined && maxAccuracyMeters > thresholds.maxAcceptedAccuracyMeters) issues.push(`GPS accuracy exceeds ${thresholds.maxAcceptedAccuracyMeters} m`);
  if (maxLateralYards !== undefined && maxLateralYards > thresholds.maxAlignmentMismatchYards) issues.push(`lateral alignment exceeds ${thresholds.maxAlignmentMismatchYards} yd`);
  if (maxLongitudinalYards !== undefined && maxLongitudinalYards > thresholds.maxAlignmentMismatchYards) issues.push(`longitudinal alignment exceeds ${thresholds.maxAlignmentMismatchYards} yd`);

  const imageryReady = imageryPass && imageryChecks === runs.length && runs.length > 0;
  return {
    ready: issues.length === 0 && coveragePass && gpsPass && alignmentPass && imageryReady,
    coverage: { devices: devices.size, courses: courses.size, gpsCourses: gpsCourses.size, alignmentCourses: alignmentCourses.size, pass: coveragePass },
    gps: {
      samples: gpsErrors.length,
      courses: gpsCourses.size,
      medianErrorPercent,
      p95ErrorPercent,
      maxAccuracyMeters,
      maxFixAgeSeconds: maxRecordedFixAgeSeconds,
      p95FixAgeSeconds,
      freshnessPass: gpsFreshnessPass,
      freshnessThresholdSeconds: maxFixAgeSeconds,
      phonePairSamples: gpsPairSamples,
      phonePairCourses: phonePairCourses.size,
      phonePairCoveragePass,
      phonePairPass: gpsPairPass,
      byCourse: gpsCourseMetrics,
      pass: gpsPass,
    },
    alignment: { samples: alignmentMismatches.length, courses: alignmentCourses.size, maxLateralYards, maxLongitudinalYards, pass: alignmentPass },
    imagery: { runs: imageryChecks, providers: [...imageryProviders].sort(), pass: imageryReady },
    metadata: { payloadVersion: root?.version ?? undefined, runs: runIds.size, pass: metadataPass },
    tee: { runs: teeBoxSamples, boxes: [...new Set([...runs].map((runValue) => {
      const run = asRecord(runValue);
      return typeof run?.teeBox === "string" ? run.teeBox.trim().toLowerCase() : "";
    }).filter((teeBox) => FIELD_LOG_TEE_BOXES.has(teeBox)))].sort(), pass: teeBoxPass },
    issues: [...new Set(issues)],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const inputPath = args.find((arg) => !arg.startsWith("--"));
  if (!inputPath) throw new Error("Usage: node scripts/evaluate-course-field-log.mjs path/to/field-log.json [--personal-beta]");
  const thresholds = args.includes("--personal-beta") ? PERSONAL_BETA_THRESHOLDS : FIELD_TEST_THRESHOLDS;
  const report = evaluateCourseFieldLog(JSON.parse(await readFile(inputPath, "utf8")), thresholds);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready) process.exitCode = 1;
}
