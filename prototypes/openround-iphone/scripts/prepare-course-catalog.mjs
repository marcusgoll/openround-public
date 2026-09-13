import { createHash } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isCourseCatalogArtifact, isCourseCatalogIndex, isCourseCatalogManifest } from "../src/openroundCourseCatalog.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "public", "course-data");
const releaseArg = process.argv.indexOf("--release");
const release = releaseArg >= 0 ? process.argv[releaseArg + 1] : "v2.1.0";
if (!release || !/^v\d+\.\d+\.\d+$/.test(release)) throw new Error("Usage: npm run prepare:course-catalog -- --release vX.Y.Z");
const artifactName = `opengolfapi-us-${release}.geojson`;
const artifactPath = resolve(dataDir, artifactName);
const checksumsPath = resolve(dataDir, `SHA256SUMS-${release}`);
const indexPath = resolve(dataDir, `opengolfapi-us-${release}.index.json`);
const manifestPath = resolve(dataDir, `opengolfapi-us-${release}.manifest.json`);
const currentIndexPath = resolve(dataDir, "opengolfapi-us-current.index.json");
const currentManifestPath = resolve(dataDir, "opengolfapi-us-current.manifest.json");

const artifact = await readFile(artifactPath);
const checksum = createHash("sha256").update(artifact).digest("hex");
const checksums = await readFile(checksumsPath, "utf8");
const expected = checksums
  .split(/\r?\n/)
  .map((line) => line.trim().split(/\s+/))
  .find((parts) => parts[1] === "opengolfapi-us.geojson")?.[0]
  ?.toLowerCase();
if (!expected || checksum !== expected) {
  throw new Error(`Pinned OpenGolfAPI artifact checksum mismatch: expected ${expected ?? "missing"}, got ${checksum}`);
}

const source = JSON.parse(artifact.toString("utf8"));
if (!isCourseCatalogArtifact(source)) {
  throw new Error("Pinned OpenGolfAPI artifact is not a non-empty US GeoJSON FeatureCollection with valid course records");
}
const features = source.features;
const entriesById = new Map();
for (const feature of features) {
  const properties = feature?.properties ?? {};
  const id = String(feature?.id ?? properties.id ?? properties.course_id ?? "").trim();
  const name = String(properties.name ?? properties.course_name ?? "").trim();
  if (!id || !name || entriesById.has(id)) continue;
  const coordinates = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
  const longitude = Number(properties.longitude ?? properties.lon ?? properties.lng ?? coordinates[0]);
  const latitude = Number(properties.latitude ?? properties.lat ?? coordinates[1]);
  entriesById.set(id, {
    id,
    name,
    country: String(properties.country ?? "US"),
    ...(properties.state ? { state: String(properties.state) } : {}),
    ...(properties.city ? { city: String(properties.city) } : {}),
    ...(Number.isFinite(latitude) && Number.isFinite(longitude) ? { center: { lat: latitude, lon: longitude } } : {}),
    ...(Number.isInteger(Number(properties.holes)) && Number(properties.holes) > 0 ? { holes: Number(properties.holes) } : {}),
    ...(Number.isFinite(Number(properties.par)) ? { par: Number(properties.par) } : {}),
    ...(Number.isFinite(Number(properties.total_yardage)) ? { totalYardage: Number(properties.total_yardage) } : {}),
    ...(properties.updated_at ? { updatedAt: String(properties.updated_at) } : {}),
    sourceVersion: release,
  });
}

const entries = [...entriesById.values()].sort((left, right) => {
  const stateCompare = (left.state ?? "").localeCompare(right.state ?? "");
  return stateCompare || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
});
const existingManifest = await readFile(manifestPath, "utf8").then((value) => JSON.parse(value)).catch(() => ({}));
const generatedAt = typeof existingManifest.generatedAt === "string" ? existingManifest.generatedAt : "2026-08-28T00:00:00.000Z";

const indexPayload = { provider: "opengolfapi", version: release, generatedAt, courseCount: entries.length, entries };
const manifestPayload = {
  provider: "opengolfapi",
  release,
  generatedAt,
  artifact: artifactName,
  format: "GeoJSON FeatureCollection",
  sha256: checksum,
  courseCount: entries.length,
  geometryCoverage: "catalog centers and scorecards only; hole geometry must be loaded from a validated geometry bundle",
  sourceUrl: `https://github.com/opengolfapi/data/releases/tag/${release}`,
  license: "ODbL-1.0",
  attribution: "© OpenStreetMap contributors (ODbL 1.0) via OpenGolfAPI",
  refresh: { cadence: "release-driven", dedupeKey: "id", validation: "sha256 + schema + finite coordinates" },
};
if (!isCourseCatalogIndex(indexPayload) || !isCourseCatalogManifest(manifestPayload)) {
  throw new Error("Generated catalog index or manifest fails validation; current aliases were not promoted");
}

async function writeAtomic(path, contents) {
  const tempPath = `${path}.tmp-${process.pid}`;
  await writeFile(tempPath, contents, "utf8");

  try {
    let renameError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await rename(tempPath, path);
        return;
      } catch (error) {
        renameError = error;
        const code = error && typeof error === "object" ? error.code : undefined;
        if (!["EPERM", "EACCES", "EBUSY"].includes(code) || attempt === 3) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Windows development servers can keep a static JSON alias open without
    // delete-sharing it. Preserve the build's generated contents with a
    // narrowly scoped direct-write fallback after the atomic rename retries;
    // production builds still take the atomic path.
    const renameCode = renameError && typeof renameError === "object" ? renameError.code : undefined;
    if (["EPERM", "EACCES", "EBUSY"].includes(renameCode)) {
      await writeFile(path, contents, "utf8");
      return;
    }
    throw renameError;
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

const indexText = `${JSON.stringify(indexPayload)}\n`;
const manifestText = `${JSON.stringify(manifestPayload, null, 2)}\n`;
await writeAtomic(indexPath, indexText);
await writeAtomic(manifestPath, manifestText);
await writeAtomic(currentIndexPath, indexText);
await writeAtomic(currentManifestPath, manifestText);
console.log(`Prepared ${entries.length} unique OpenGolfAPI US courses from ${artifactName} (${checksum}).`);
