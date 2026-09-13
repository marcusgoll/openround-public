import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const releaseIndex = args.indexOf("--release");
const release = releaseIndex >= 0 ? args[releaseIndex + 1] : process.env.OPENROUND_COURSE_LIBRARY_RELEASE;
if (!release || !/^v\d+\.\d+\.\d+$/.test(release)) {
  throw new Error("Usage: npm run refresh:course-library:job -- --release vX.Y.Z");
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

await run("refresh-course-library.mjs", ["--release", release]);
await run("prepare-course-catalog.mjs", ["--release", release]);
await run("verify-course-catalog.mjs", []);
console.log(`Course library refresh job completed for ${release}; versioned artifact, checksum, manifest, and current aliases are in sync.`);
