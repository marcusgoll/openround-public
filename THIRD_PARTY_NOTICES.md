# Third-party notices and redistribution review

The root MIT license covers original OpenRound code and documentation. It does
not relicense third-party datasets, fonts, images, templates, trademarks, or
published benchmark tables. Preserve upstream licenses when distributing them.

## Course database and geometry — ODbL 1.0

`prototypes/openround-iphone/public/course-data/` contains the pinned OpenGolfAPI
US catalog and OpenStreetMap-derived geometry, indexes, and manifests.

Contains data from OpenGolfAPI (opengolfapi.org).
© OpenStreetMap contributors, via OpenGolfAPI where applicable.

- [OpenGolfAPI source and license](https://github.com/opengolfapi/data)
- [OpenStreetMap copyright](https://www.openstreetmap.org/copyright)
- [ODbL 1.0 legal text](https://opendatacommons.org/licenses/odbl/1-0/)

The pinned upstream notice also licenses rights in individual database contents
under [DbCL 1.0](https://opendatacommons.org/licenses/dbcl/1.0/).
These databases and their derivatives remain under ODbL 1.0, with attribution and
share-alike obligations. Keep the versioned source artifacts, checksums, manifests,
and provenance alongside derived indexes. Personal round history is separate
from the course database. See the source URLs and versions in each manifest.

## Installed dependencies and fonts

Python and npm packages remain under their upstream licenses. Lockfiles record
versions; inspect installed package license files before distributing binaries.
The iPhone app uses Roboto and Roboto Condensed through `@fontsource` packages;
preserve their supplied font license notices. React, Capacitor, Radix,
and other dependencies must retain their applicable upstream notices in releases.
The Python-generated shot map loads IBM Plex fonts from Google Fonts.
The installed production npm license texts are bundled in
[THIRD_PARTY_LICENSES.txt](prototypes/openround-iphone/public/THIRD_PARTY_LICENSES.txt),
which is also copied into the web build.

## Map imagery and external providers

USGS/USDA and optional Google imagery are separate services, not MIT project
assets. Preserve displayed provider attribution and follow provider terms.
OpenRound's code license conveys no Google imagery redistribution rights.

## Original public shell and illustration

The responsive shell in `prototypes/openround-iphone/src/mobile/index.tsx`, its CSS, and
`public/assets/openround-hole-illustration.svg` were authored for this public
release and use the root MIT license. The schematic SVG is illustrative; it is
not measured course geometry or satellite imagery.

The private prototype's device template, phone/keyboard/status artwork, and
unverified raster are excluded from this repository and its history. No license
to those private materials is claimed or needed to build this public app.

## Optional benchmark data

No published PGA/Broadie benchmark tables are distributed. The Python SG engine
accepts a user-supplied benchmark through `OPENROUND_SG_BASELINE`; users must have
the right to use their own input. The small fixture under `tests/fixtures/` is
independently invented, MIT-licensed test data, not a calibrated benchmark.
Without a benchmark, SG is explicitly unavailable; scoring and maps still work.

## Updating dependencies

Run `npm ci` followed by `npm run licenses` in the iPhone app directory. The build
also regenerates `public/THIRD_PARTY_LICENSES.txt`, and fails when an installed
production package has no license text or reviewed override. Commit notice and
lockfile changes together. `licenses/react-remove-scroll-bar.txt` preserves the
upstream MIT text omitted from that package's npm archive.
