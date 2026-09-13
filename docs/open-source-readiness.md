# Open-source readiness review — 2026-09-13

OpenRound's public source lives at
[marcusgoll/openround-public](https://github.com/marcusgoll/openround-public).
It starts with a clean source snapshot; private development history remains in the
original private repository and is not an ancestor of this release.

## Licensing and provenance

Original code is MIT licensed. The course catalog retains its upstream ODbL/DbCL
license and attribution. Dependency and font notices ship with the web build.
See [third-party notices](../THIRD_PARTY_NOTICES.md) for exceptions and sources.

The public snapshot excludes the proprietary mobile preview template, device and
keyboard artwork, unverified aerial raster, and published strokes-gained tables.
It uses an original responsive shell, native browser inputs, Radix dialogs and an
original schematic course illustration. Historical planning files and hosting
identifiers are excluded as well.

Strokes gained requires a validated, explicitly configured user-supplied benchmark.
Without one, maps and round data remain usable and SG is labeled unavailable.
Tests use invented synthetic data, not reproduced published tables.

## Contributor and release safeguards

The repository includes setup instructions, contribution and conduct policies,
security reporting guidance, issue/PR templates, dependency updates and CI.
CI checks Python 3.11/3.12, browser/model behavior, production builds, dependency
vulnerabilities and secrets. Actions are pinned and use read-only repository access.
Source exports include licenses and omit untracked local configuration.

The public shell has regression coverage for real input focus, modal focus
restoration and confinement, long-dialog scrolling, and portrait/landscape layout.
Pin placement and map resizing retain geographic center and scale across layout
changes. Optional benchmark validation rejects malformed or non-finite values.

## Verification scope

- Python: 114 tests pass on both 3.11 and 3.12.
- Model, PWA, browser and build checks are enforced by the linked repository's CI.
- Python production dependency audit and npm audit report no known vulnerabilities
  in the release's locked dependency sets at review time.
- Native asset and package synchronization passes. The compatible uuid override
  was also checked by parsing and writing the native Xcode project and generating
  1,000 unique project identifiers.
- Gitleaks scans the public Git history and source in CI. No detector can establish
  that every kind of private information is absent; publication uses the reviewed
  clean snapshot rather than exposing the original history.

This is an experimental source release. No signed native build, physical iPhone
round, firmware build or hardware validation is claimed. External imagery and
user-supplied datasets retain their own access and licensing requirements.
