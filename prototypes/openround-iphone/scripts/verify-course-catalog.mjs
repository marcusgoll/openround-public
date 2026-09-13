import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isCourseCatalogArtifact, isCourseCatalogIndex, isCourseCatalogManifest } from "../src/openroundCourseCatalog.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const courseDataRoot = resolve(root, "public", "course-data");
const indexPath = resolve(courseDataRoot, "opengolfapi-us-current.index.json");
const manifestPath = resolve(courseDataRoot, "opengolfapi-us-current.manifest.json");
const indexPayload = JSON.parse(await readFile(indexPath, "utf8"));
const manifestPayload = JSON.parse(await readFile(manifestPath, "utf8"));
const errors = [];

if (!isCourseCatalogIndex(indexPayload)) errors.push("catalog index fails schema or duplicate-ID validation");
if (!isCourseCatalogManifest(manifestPayload)) errors.push("catalog manifest fails schema validation");

if (isCourseCatalogIndex(indexPayload) && isCourseCatalogManifest(manifestPayload)) {
  if (indexPayload.version !== manifestPayload.release) errors.push("index and manifest releases differ");
  if (indexPayload.generatedAt !== manifestPayload.generatedAt) errors.push("index and manifest timestamps differ");
  if (indexPayload.courseCount !== manifestPayload.courseCount) errors.push("index and manifest course counts differ");

  const artifactRelativePath = relative(courseDataRoot, resolve(courseDataRoot, manifestPayload.artifact));
  if (
    isAbsolute(artifactRelativePath) ||
    artifactRelativePath === ".." ||
    artifactRelativePath.startsWith("../") ||
    artifactRelativePath.startsWith("..\\") ||
    manifestPayload.artifact.includes("..")
  ) {
    errors.push("catalog artifact escapes course-data root");
  } else {
    const artifactPath = resolve(courseDataRoot, manifestPayload.artifact);
    let artifact;
    try {
      artifact = await readFile(artifactPath);
    } catch (error) {
      errors.push(`catalog artifact unavailable (${error instanceof Error ? error.message : String(error)})`);
    }
    if (artifact) {
      const checksum = createHash("sha256").update(artifact).digest("hex");
      if (checksum !== manifestPayload.sha256.toLowerCase()) errors.push("catalog artifact SHA-256 does not match manifest");
      try {
        const source = JSON.parse(artifact.toString("utf8"));
        if (!isCourseCatalogArtifact(source)) {
          errors.push("catalog artifact is not a non-empty US GeoJSON FeatureCollection with valid course records");
        }
      } catch (error) {
        errors.push(`catalog artifact is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Course catalog verified: ${indexPayload.courseCount} unique OpenGolfAPI US courses, release ${manifestPayload.release}, SHA-256 and manifest/index consistency passed.`);
}
