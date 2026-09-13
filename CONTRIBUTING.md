# Contributing to OpenRound

OpenRound is an experimental golf tracking project. Bug reports, documentation,
synthetic test cases, accessibility fixes, and focused pull requests are welcome.

## Development

Start with the [README](README.md). Use Python 3.11+ with uv and Node.js 24
for the iPhone prototype. Install locked dependencies before changing code:

```sh
uv sync --locked
uv run pytest
node --test app/*.test.mjs
cd prototypes/openround-iphone
npm ci
npm run test:model
npm run test:pwa
npm run build
npx playwright install chromium
npm run test:runtime -- --workers=1
```

Read the prototype's `AGENTS.md` before editing that application. The public shell uses browser-native controls and Radix dialogs. Native changes additionally need the
checks in [ios/README.md](prototypes/openround-iphone/ios/README.md).

## Pull requests

1. Fork the repository and create a focused branch from `main`.
2. Describe the problem, expected behavior, and how to reproduce it.
3. Add a regression test for behavioral fixes when practical. Run the relevant
   checks above and report exactly what passed and what you could not test.
4. Update setup or user documentation when behavior or requirements change.
5. Open a pull request. A maintainer reviews changes before merging.

Keep score, confirmed shot evidence, and predictions distinct. Browser tests do
not establish background GPS reliability on an iPhone. Avoid unrelated changes to the public shell,
course-data, lockfile, or generated-artifact changes.

Use synthetic rounds and coordinates in tests. Do not include credentials,
account exports, real playing-partner names, private GPS trails, device containers,
or signing files in commits, screenshots, issues, or build artifacts. Review
`git diff --cached` before committing. See [SECURITY.md](SECURITY.md).

Discuss large changes in an issue first. Include provenance and redistribution
terms when adding data, fonts, images, or copied code. Contributions to original
project code use the [MIT license](LICENSE); existing third-party terms remain
in effect. Only contribute material you have the right to share.

## Exporting a source package

For an optional standalone source handoff, first commit the revision to export, then
run from the repository root with PowerShell:

```powershell
pwsh -File scripts/prepare-sites-source.ps1 -StagePath /path/to/new/staging-folder -SourceRef HEAD
```

The destination must not exist. Only the selected committed prototype is exported;
uncommitted edits and ignored local files are excluded. The selected revision
must include the root LICENSE and THIRD_PARTY_NOTICES.md; both accompany the export. This command does not
publish or deploy. Review the export and third-party rights before sharing it.

## Community

Be respectful, assume good intent, and address the work rather than the person.
See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). There is no guaranteed response time
or commercial support commitment.
