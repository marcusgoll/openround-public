import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchOverpassGeometryPayload, normalizeOverpassHoleGeometry } from "../src/openroundGeometry.ts";
import { geometryCacheArtifact, geometryCacheKey, isGeometryCacheManifest, isLoadedHoleGeometry, sha256Hex } from "../src/openroundGeometryCache.ts";
import { PERSONAL_COURSE_ENTRIES, PERSONAL_COURSE_IDS } from "../src/openroundPersonalCourses.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = resolve(root, "public", "course-data", "opengolfapi-us-current.index.json");
const args = process.argv.slice(2);

function flag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function repeatedFlag(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

const release = flag("--release");
const courseIds = repeatedFlag("--course-id");
const holeNumbers = repeatedFlag("--hole").map((value) => Number(value));
const allHoles = args.includes("--all-holes");
const radiusMeters = flag("--radius-meters") === undefined ? 2200 : Number(flag("--radius-meters"));
const endpoints = [...new Set([
  ...repeatedFlag("--endpoint"),
  "https://overpass-api.de/api/interpreter",
].filter(Boolean))];
const baseRelease = flag("--base-release");
if (!release || !/^v\d+\.\d+\.\d+$/.test(release)) throw new Error("Usage: node scripts/refresh-course-geometry.mjs --release vX.Y.Z --course-id <id> --hole <number> [--all-holes]");
if (courseIds.length === 0 || (!allHoles && holeNumbers.length === 0) || holeNumbers.some((hole) => !Number.isInteger(hole) || hole < 1 || hole > 99)) {
  throw new Error("At least one --course-id and either --all-holes or one valid --hole are required");
}
if (!Number.isFinite(radiusMeters) || radiusMeters < 100 || radiusMeters > 10_000) throw new Error("--radius-meters must be between 100 and 10000");
if (baseRelease && !/^v\d+\.\d+\.\d+$/.test(baseRelease)) throw new Error("--base-release must be a semantic version");
for (const endpoint of endpoints) {
  try {
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    throw new Error("--endpoint must be an HTTPS Overpass-compatible URL");
  }
}

const versionedManifestPath = resolve(root, "public", "course-data", `opengolfapi-us-${release}.geometry.manifest.json`);
const currentManifestPath = resolve(root, "public", "course-data", "opengolfapi-us-current.geometry.manifest.json");

const index = JSON.parse(await readFile(indexPath, "utf8"));
const selected = courseIds.map((id) => index.entries.find((entry) => entry.id === id) ?? PERSONAL_COURSE_ENTRIES.find((entry) => entry.id === id));
if (selected.some((entry) => !entry)) throw new Error("Every --course-id must exist in the pinned catalog or personal course seeds");

let existing = { provider: "openstreetmap-overpass", version: release, generatedAt: new Date().toISOString(), attribution: "© OpenStreetMap contributors (ODbL 1.0)", records: [] };
let carriedForward = false;
try {
  const sourceManifestPath = baseRelease
    ? resolve(root, "public", "course-data", `opengolfapi-us-${baseRelease}.geometry.manifest.json`)
    : versionedManifestPath;
  const parsed = JSON.parse(await readFile(sourceManifestPath, "utf8"));
  if (!isGeometryCacheManifest(parsed)) throw new Error("Invalid existing geometry manifest");
  if (parsed.version !== release && !baseRelease) throw new Error(`Existing geometry manifest is ${parsed.version}; use a new release or archive it first`);
  existing = { ...parsed, version: release };
  carriedForward = parsed.version !== release;
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  if (baseRelease) throw new Error(`Base geometry manifest ${baseRelease} was not found`);
}

const records = new Map(existing.records.map((record) => [record.key, record]));
const requestedKeys = new Set();
const pendingArtifacts = [];
let fetched = 0;
async function fetchGeometryWithFallback(center) {
  const failures = [];
  for (const endpoint of endpoints) {
    try {
      return await fetchOverpassGeometryPayload(center, fetch, radiusMeters, endpoint);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${endpoint}: ${message}`);
      console.warn(`Geometry refresh endpoint failed (${endpoint}); trying the next configured endpoint.`);
    }
  }
  throw new Error(`All Overpass endpoints failed: ${failures.join(" | ")}`);
}

for (const course of selected) {
  if (!course.center) throw new Error(`${course.name} has no catalog center`);
  const requestedHoles = allHoles
    ? Array.from({ length: Math.min(99, Math.max(1, Number(course.holes) || 18)) }, (_, index) => index + 1)
    : holeNumbers;
  const payload = await fetchGeometryWithFallback(course.center);
  for (const holeNumber of requestedHoles) {
    const key = geometryCacheKey(course.id, holeNumber);
    if (requestedKeys.has(key)) continue;
    requestedKeys.add(key);
    const current = records.get(key);
    const personalLayout = course.id === "personal-squaw-valley-links-osm-v1"
      ? "ref_features"
      : course.id === "personal-squaw-valley-lakes-pending-v1"
        ? "hole_centerlines"
        : "auto";
    const sourceVersion = course.id === "personal-squaw-valley-links-osm-v1"
      ? "personal-osm-links-v2"
      : course.id === "personal-squaw-valley-lakes-pending-v1"
        ? "personal-osm-lakes-v1"
        : "osm-live";
    const loaded = normalizeOverpassHoleGeometry(payload, holeNumber, sourceVersion, personalLayout);
    const artifactText = `${JSON.stringify(loaded, null, 2)}\n`;
    const checksum = await sha256Hex(artifactText);
    const artifact = geometryCacheArtifact(course.id, holeNumber, release);
    if (current && current.sha256 !== checksum && !carriedForward) throw new Error(`${key} changed under release ${release}; use a new release to pin the update`);
    if (current) {
      if (current.sha256 === checksum) {
        console.log(`${course.name} hole ${holeNumber}: unchanged (${current.sha256.slice(0, 12)})`);
        continue;
      }
      console.log(`${course.name} hole ${holeNumber}: replacing ${current.sha256.slice(0, 12)} with ${checksum.slice(0, 12)} under ${release}`);
    }
    const record = {
      key,
      courseId: course.id,
      holeNumber,
      artifact,
      sha256: checksum,
      sourceVersion: loaded.sourceVersion,
      quality: loaded.quality,
      attribution: loaded.quality.attribution,
    };
    pendingArtifacts.push({ artifact, artifactText, record });
    records.set(key, record);
    fetched += 1;
    console.log(`${course.name} hole ${holeNumber}: pinned ${loaded.quality.grade}/${loaded.quality.status}, hazards ${loaded.quality.hazardsUsable ? "ready" : "withheld"}, pin ${loaded.quality.pinUsable ? "verified" : "unverified"}`);
  }
}

// Preflight every generated payload and the complete next manifest before any
// artifact or current alias is promoted. A failed Overpass response must not
// leave a partially refreshed cache on disk.
for (const { artifact, artifactText, record } of pendingArtifacts) {
  const loaded = JSON.parse(artifactText);
  if (!isLoadedHoleGeometry(loaded)) {
    throw new Error(`Refusing to promote invalid geometry payload ${record.key}`);
  }
  if (loaded.sourceVersion !== record.sourceVersion || JSON.stringify(loaded.quality) !== JSON.stringify(record.quality)) {
    throw new Error(`Geometry record metadata mismatch for ${record.key}`);
  }
  if (await sha256Hex(artifactText) !== record.sha256 || record.artifact !== artifact) {
    throw new Error(`Geometry artifact checksum/path mismatch for ${record.key}`);
  }
}

const nextManifest = {
  ...existing,
  provider: "openstreetmap-overpass",
  version: release,
  generatedAt: existing.records.length > 0 ? existing.generatedAt : new Date().toISOString(),
  records: [...records.values()].sort((left, right) => left.key.localeCompare(right.key)),
};
if (!isGeometryCacheManifest(nextManifest)) {
  throw new Error(`Refusing to promote invalid geometry manifest ${release}`);
}

for (const { artifact, artifactText } of pendingArtifacts) {
  const artifactPath = resolve(root, "public", "course-data", artifact);
  await mkdir(dirname(artifactPath), { recursive: true });
  const tempPath = `${artifactPath}.tmp-${process.pid}`;
  await writeFile(tempPath, artifactText, "utf8");
  await rename(tempPath, artifactPath);
}

const manifestText = `${JSON.stringify(nextManifest, null, 2)}\n`;
const tempManifestPath = `${versionedManifestPath}.tmp-${process.pid}`;
await writeFile(tempManifestPath, manifestText, "utf8");
await rename(tempManifestPath, versionedManifestPath);
const tempCurrentManifestPath = `${currentManifestPath}.tmp-${process.pid}`;
await writeFile(tempCurrentManifestPath, manifestText, "utf8");
await rename(tempCurrentManifestPath, currentManifestPath);

const sums = nextManifest.records.map((record) => `${record.sha256}  ${record.artifact}`).join("\n") + (nextManifest.records.length ? "\n" : "");
const sumsPath = resolve(root, "public", "course-data", `SHA256SUMS-geometry-${release}.txt`);
await writeFile(sumsPath, sums, "utf8");
console.log(`Geometry cache ${release}: ${nextManifest.records.length} records (${fetched} new), manifest ${await sha256Hex(manifestText)}`);
