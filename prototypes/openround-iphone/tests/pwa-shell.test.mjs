import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("index advertises the OpenRound install surface", async () => {
  const html = await read("index.html");
  assert.match(html, /<title>OpenRound · GPS Golf Caddy<\/title>/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /name="theme-color" content="#006bdc"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /rel="apple-touch-icon" href="\/assets\/openround-app-icon\.svg"/);
});

test("manifest is portrait standalone and points at the app icon", async () => {
  const manifest = JSON.parse(await read("public/manifest.webmanifest"));
  assert.equal(manifest.name, "OpenRound · GPS Golf Caddy");
  assert.equal(manifest.short_name, "OpenRound");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "portrait");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.deepEqual(manifest.icons, [
    {
      src: "/assets/openround-app-icon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any maskable",
    },
  ]);
});

test("service worker caches only same-origin app resources", async () => {
  const worker = await read("public/sw.js");
  assert.match(worker, /const CACHE_NAME = "openround-shell-v2"/);
  assert.match(worker, /const APP_SHELL = \["\/", "\/index\.html", "\/manifest\.webmanifest", "\/assets\/openround-app-icon\.svg"\]/);
  assert.match(worker, /if \(url\.origin !== self\.location\.origin\) return;/);
  assert.match(worker, /cache\.put\(request, copy\)/);
  assert.doesNotMatch(worker, /googleapis\.com|tile\.openstreetmap\.org|usgs\.gov|usda\.gov/);
});

test("registration is production-only and failure-safe", async () => {
  const source = await read("src/main.tsx");
  assert.match(source, /if \(import\.meta\.env\.PROD && "serviceWorker" in navigator\)/);
  assert.match(source, /navigator\.serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(source, /catch\(\(\) =>/);
});

test("app icon is a valid square SVG with app-owned colors", async () => {
  const icon = await read("public/assets/openround-app-icon.svg");
  assert.match(icon, /<svg[^>]+viewBox="0 0 512 512"/);
  assert.match(icon, /#006bdc/);
  assert.match(icon, /#1f7a3a/);
  assert.match(icon, /<title id="title">OpenRound<\/title>/);
});
