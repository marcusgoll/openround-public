# Public release design and verification plan

The public repository is a clean source snapshot. Existing private development
history stays in the original repository. No force push or history deletion is
needed. Original OpenRound code uses MIT; course data retains upstream ODbL/DbCL.

The user requested autonomous completion after review identified unverified
artwork/templates and benchmark tables. The selected approach replaces those
materials instead of making an unsupported licensing claim or waiting for grants.

- Replace the proprietary preview shell with original browser-native inputs,
  responsive layout, and MIT-licensed Radix dialogs. Preserve app behavior and
  verify score recovery, GPS, accessibility, portrait and landscape layouts.
- Replace the unverified raster with an original schematic SVG. Do not present
  the schematic as real course imagery.
- Remove published benchmark tables. Accept explicitly configured, validated
  user-supplied data and label unavailable SG honestly. Use synthetic test data.
- Exclude historical planning/research/template files and hosting identifiers from
  the public snapshot. Preserve data formats and hardware/native setup docs.
- Validate Python, browser/model tests, built artifacts, dependency audits, licenses,
  and secret scanning. Independently review changed code before publication.
- Publish only this snapshot as openround-public, enable private vulnerability
  reporting and branch protection, and verify anonymous access and hosted CI.
