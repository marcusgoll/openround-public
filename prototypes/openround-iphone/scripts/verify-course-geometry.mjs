import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGeometryProjection, fetchOverpassHoleGeometry } from "../src/openroundGeometry.ts";
import { PERSONAL_COURSE_ENTRIES } from "../src/openroundPersonalCourses.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = resolve(root, "public", "course-data", "opengolfapi-us-current.index.json");
const index = JSON.parse(await readFile(indexPath, "utf8"));
const defaultEndpoint = "https://overpass-api.de/api/interpreter";
const configuredEndpoints = (process.env.OPENROUND_OVERPASS_ENDPOINTS ?? process.env.OPENROUND_OVERPASS_ENDPOINT ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const endpoints = [...new Set([...configuredEndpoints, defaultEndpoint])];
for (const endpoint of endpoints) {
  try {
    const parsedEndpoint = new URL(endpoint);
    if (parsedEndpoint.protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    throw new Error("OPENROUND_OVERPASS_ENDPOINT(S) must contain only HTTPS Overpass-compatible URLs");
  }
}
const sampleNames = ["Egyptian Country Club", "Pinehurst Resort Country Club No 2", "Pebble Beach Golf Linkstm"];
const samples = [
  ...PERSONAL_COURSE_ENTRIES.map((entry) => ({
    ...entry,
    layout: entry.id.includes("links") ? "ref_features" : "hole_centerlines",
  })),
  ...sampleNames.map((name) => ({ ...index.entries.find((entry) => entry.name === name), layout: "auto" })),
].filter((entry) => entry?.id);
if (samples.length !== PERSONAL_COURSE_ENTRIES.length + sampleNames.length) throw new Error("One or more real-course verification samples are missing from the pinned index");

function positionsFromGeometry(geometry) {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "LineString") return geometry.coordinates;
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  return geometry.coordinates.flat(2);
}

function verifyProjection(loaded) {
  const projection = createGeometryProjection(loaded.hole.features);
  if (!projection) return { ok: false, maxError: Number.POSITIVE_INFINITY };
  let maxError = 0;
  for (const feature of loaded.hole.features) {
    for (const position of positionsFromGeometry(feature.geometry)) {
      const projected = projection.project(position);
      const roundTrip = projection.unproject(projected);
      maxError = Math.max(maxError, Math.abs(roundTrip[0] - position[0]), Math.abs(roundTrip[1] - position[1]));
      if (projected.x < 0.08 || projected.x > 0.92 || projected.y < 0.08 || projected.y > 0.92) {
        return { ok: false, maxError };
      }
    }
  }
  return { ok: true, maxError };
}

const errors = [];
async function fetchGeometryWithFallback(course, holeNumber) {
  const failures = [];
  for (const endpoint of endpoints) {
    try {
      const loaded = await fetchOverpassHoleGeometry(course.center, holeNumber, fetch, 2200, endpoint, course.layout);
      const projection = verifyProjection(loaded);
      if (!projection.ok) throw new Error("normalized projection check failed");
      return { loaded, projection };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${endpoint}: ${message}`);
      console.warn(`${course.name}: endpoint ${endpoint} failed; trying the next configured endpoint.`);
    }
  }
  throw new Error(`all Overpass endpoints failed (${failures.join(" | ")})`);
}

for (const course of samples) {
  if (!course.center) {
    errors.push(`${course.name}: no catalog center`);
    continue;
  }
  const holeNumber = 1;
  try {
    const { loaded, projection } = await fetchGeometryWithFallback(course, holeNumber);
    const kinds = [...new Set(loaded.hole.features.map((feature) => feature.kind))].sort().join(",") || "none";
    console.log(`${course.name} (${course.state ?? "US"}) hole ${holeNumber} [${course.layout}]: grade ${loaded.quality.grade}, status ${loaded.quality.status}, pin ${loaded.quality.pinUsable ? "yes" : "no"}, hazards ${loaded.quality.hazardsUsable ? "distance-ready" : "withheld"}, layers ${kinds}, projection ok (max error ${projection.maxError.toExponential(1)}°)`);
  } catch (error) {
    const message = `${course.name}: ERROR ${(error instanceof Error ? error.message : String(error))}`;
    errors.push(message);
    console.error(message);
  }
}

if (errors.length > 0) process.exitCode = 1;
