// SPDX-License-Identifier: MIT
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const sections = ['Third-party production dependency licenses\nGenerated from the pinned npm lockfile. Third-party terms remain in effect.\n'];
for (const [relative, metadata] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  if (!relative || metadata.dev || metadata.optional) continue;
  const directory = path.join(root, relative);
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  if (pkg.version !== metadata.version) throw new Error(`Run npm ci: version mismatch for ${relative}`);
  sections.push(`\n--- ${pkg.name} ${pkg.version} (${metadata.license ?? 'see license text'}) ---\n`);
  const names = (await readdir(directory, {withFileTypes: true})).filter(item => item.isFile() && /^(license|licence|copying|notice|ofl)/i.test(item.name)).map(item => item.name).sort();
  if (!names.length) {
    const override = path.join(root, 'licenses', `${pkg.name.replaceAll('/', '__')}.txt`);
    sections.push(await readFile(override, 'utf8')); // Missing license evidence fails the build.
  } else {
    for (const name of names) sections.push(`${name}\n${await readFile(path.join(directory, name), 'utf8')}`);
  }
}
await writeFile(path.join(root, 'public', 'THIRD_PARTY_LICENSES.txt'), sections.join('\n').replaceAll('\r\n', '\n').split('\n').map(line => line.trimEnd()).join('\n').trimEnd()+'\n');
console.log('Production dependency license notices generated.');
