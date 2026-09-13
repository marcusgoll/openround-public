import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const releaseIndex = args.indexOf("--release");
const release = releaseIndex >= 0 ? args[releaseIndex + 1] : process.env.OPENROUND_COURSE_GEOMETRY_RELEASE;
const hasCourse = args.includes("--course-id");
const hasHoleSelection = args.includes("--hole") || args.includes("--all-holes");

if (!release || !/^v\d+\.\d+\.\d+$/.test(release) || !hasCourse || !hasHoleSelection) {
  throw new Error("Usage: npm run refresh:course-geometry:job -- --release vX.Y.Z --course-id <id> --hole <number> [--course-id <id> ...] [--all-holes]");
}

const run = (script, scriptArgs) => new Promise((resolveProcess, rejectProcess) => {
  const child = spawn(process.execPath, [resolve(root, "scripts", script), ...scriptArgs], {
    cwd: root,
    stdio: "inherit",
  });
  child.once("error", rejectProcess);
  child.once("exit", (code, signal) => {
    if (code === 0) {
      resolveProcess();
      return;
    }
    rejectProcess(new Error(`${script} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
  });
});

await run("verify-course-catalog.mjs", []);
await run("refresh-course-geometry.mjs", args);
await run("verify-course-cache.mjs", []);
console.log(`Course geometry refresh job completed for ${release}; versioned artifacts, checksums, quality metadata, and current aliases are in sync.`);
