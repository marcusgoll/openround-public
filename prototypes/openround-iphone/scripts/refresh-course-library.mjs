import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isCourseCatalogArtifact } from "../src/openroundCourseCatalog.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "public", "course-data");
const args = process.argv.slice(2);
const releaseIndex = args.indexOf("--release");
const tag = releaseIndex >= 0 ? args[releaseIndex + 1] : undefined;
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error("Usage: npm run refresh:course-library -- --release vX.Y.Z");
}

const headers = { "User-Agent": "OpenRound-course-library-refresh/0.1" };
const release = await fetch(`https://api.github.com/repos/opengolfapi/data/releases/tags/${tag}`, { headers }).then(async (response) => {
  if (!response.ok) throw new Error(`OpenGolfAPI release lookup failed (${response.status})`);
  return response.json();
});
const assets = Array.isArray(release.assets) ? release.assets : [];
const geojsonAsset = assets.find((asset) => asset.name === "opengolfapi-us.geojson.gz");
const checksumsAsset = assets.find((asset) => asset.name === "SHA256SUMS");
if (!geojsonAsset?.browser_download_url || !checksumsAsset?.browser_download_url) throw new Error(`Release ${tag} is missing GeoJSON or checksum assets`);

const [rawDownload, checksumText] = await Promise.all([
  fetch(geojsonAsset.browser_download_url, { headers }).then(async (response) => {
    if (!response.ok) throw new Error(`GeoJSON download failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }),
  fetch(checksumsAsset.browser_download_url, { headers }).then(async (response) => {
    if (!response.ok) throw new Error(`Checksum download failed (${response.status})`);
    return response.text();
  }),
]);
const expected = checksumText.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).find((parts) => parts[1] === "opengolfapi-us.geojson")?.[0]?.toLowerCase();
const decoded = rawDownload[0] === 0x1f && rawDownload[1] === 0x8b ? gunzipSync(rawDownload) : rawDownload;
const checksum = createHash("sha256").update(decoded).digest("hex");
if (!expected || checksum !== expected) throw new Error(`Downloaded release checksum mismatch: expected ${expected ?? "missing"}, got ${checksum}`);
const decodedArtifact = JSON.parse(decoded.toString("utf8"));
if (!isCourseCatalogArtifact(decodedArtifact)) {
  throw new Error("Downloaded OpenGolfAPI artifact is not a non-empty US GeoJSON FeatureCollection with valid course records");
}

await mkdir(dataDir, { recursive: true });
const artifactPath = resolve(dataDir, `opengolfapi-us-${tag}.geojson`);
const checksumPath = resolve(dataDir, `SHA256SUMS-${tag}`);

async function writeAtomic(path, contents, encoding) {
  const tempPath = `${path}.tmp-${process.pid}`;
  await writeFile(tempPath, contents, encoding);

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

    // A local Windows dev server can keep a versioned JSON artifact open
    // without delete-sharing it. Preserve the validated bytes with a narrow
    // direct-write fallback after the atomic rename retries.
    const renameCode = renameError && typeof renameError === "object" ? renameError.code : undefined;
    if (["EPERM", "EACCES", "EBUSY"].includes(renameCode)) {
      await writeFile(path, contents, encoding);
      return;
    }
    throw renameError;
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

await writeAtomic(artifactPath, decoded);
await writeAtomic(checksumPath, checksumText, "utf8");
console.log(`Pinned OpenGolfAPI ${tag}: ${artifactPath} (${checksum}). Run npm run prepare:course-catalog next to rebuild the discovery index.`);
