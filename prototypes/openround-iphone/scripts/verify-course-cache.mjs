import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  geometryCacheKey,
  isGeometryCacheManifest,
  isLoadedHoleGeometry,
  sha256Hex,
} from "../src/openroundGeometryCache.ts";
import { createGeometryProjection } from "../src/openroundGeometry.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const courseDataRoot = resolve(root, "public", "course-data");
const manifestPath = resolve(courseDataRoot, "opengolfapi-us-current.geometry.manifest.json");
const manifestPayload = JSON.parse(await readFile(manifestPath, "utf8"));
if (!isGeometryCacheManifest(manifestPayload)) throw new Error("Invalid bundled geometry manifest");

const errors = [];
const grades = {};
function positionsFromGeometry(geometry) {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "LineString") return geometry.coordinates;
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  return geometry.coordinates.flat(2);
}

for (const record of manifestPayload.records) {
  grades[record.quality.grade] = (grades[record.quality.grade] ?? 0) + 1;
  if (record.key !== geometryCacheKey(record.courseId, record.holeNumber)) {
    errors.push(`${record.key}: key does not match course/hole`);
    continue;
  }
  const artifactPath = resolve(courseDataRoot, record.artifact);
  const artifactRelativePath = relative(courseDataRoot, artifactPath);
  if (
    isAbsolute(artifactRelativePath) ||
    artifactRelativePath === ".." ||
    artifactRelativePath.startsWith("../") ||
    artifactRelativePath.startsWith("..\\") ||
    record.artifact.includes("..")
  ) {
    errors.push(`${record.key}: artifact escapes course-data root`);
    continue;
  }
  let artifactText;
  try {
    artifactText = await readFile(artifactPath, "utf8");
  } catch (error) {
    errors.push(`${record.key}: artifact unavailable (${error instanceof Error ? error.message : String(error)})`);
    continue;
  }
  if (await sha256Hex(artifactText) !== record.sha256) {
    errors.push(`${record.key}: SHA-256 mismatch`);
    continue;
  }
  let artifactPayload;
  try {
    artifactPayload = JSON.parse(artifactText);
  } catch (error) {
    errors.push(`${record.key}: artifact is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    continue;
  }
  if (!isLoadedHoleGeometry(artifactPayload)) {
    errors.push(`${record.key}: artifact fails geometry validation`);
    continue;
  }
  const hasHazards = artifactPayload.hole.features.some((feature) => ["bunker", "water", "waste", "out_of_bounds"].includes(feature.kind));
  if (artifactPayload.quality.hazardsUsable && !hasHazards) {
    errors.push(`${record.key}: hazardsUsable requires at least one mapped hazard feature`);
  }
  if (
    artifactPayload.hole.number !== record.holeNumber ||
    artifactPayload.quality.grade !== record.quality.grade ||
    artifactPayload.quality.status !== record.quality.status ||
    artifactPayload.quality.hazardsUsable !== record.quality.hazardsUsable ||
    artifactPayload.quality.pinUsable !== record.quality.pinUsable
  ) {
    errors.push(`${record.key}: manifest quality does not match artifact`);
  }
  const projection = createGeometryProjection(artifactPayload.hole.features);
  if (!projection) {
    if (artifactPayload.quality.grade !== "D" || artifactPayload.hole.features.length > 0) {
      errors.push(`${record.key}: geometry projection unavailable`);
    }
    continue;
  }
  for (const feature of artifactPayload.hole.features) {
    for (const position of positionsFromGeometry(feature.geometry)) {
      const projected = projection.project(position);
      const roundTrip = projection.unproject(projected);
      const errorDegrees = Math.max(Math.abs(roundTrip[0] - position[0]), Math.abs(roundTrip[1] - position[1]));
      if (!Number.isFinite(errorDegrees) || errorDegrees > 1e-9 || projected.x < 0.08 || projected.x > 0.92 || projected.y < 0.08 || projected.y > 0.92) {
        errors.push(`${record.key}: geometry projection round-trip failed`);
        break;
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  const gradeSummary = Object.entries(grades).sort(([left], [right]) => left.localeCompare(right)).map(([grade, count]) => `${grade}=${count}`).join(", ");
  console.log(`Geometry cache verified: ${manifestPayload.records.length} records, ${gradeSummary}, SHA-256, payload, and projection validation passed.`);
}
