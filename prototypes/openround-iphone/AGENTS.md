# OpenRound public application

The public app uses an original browser-native shell in src/mobile/index.tsx.
Use Radix Dialog for accessible sheets and real browser inputs/keyboards. Do not
reintroduce proprietary device templates, screenshots, or undocumented imagery.
Preserve score persistence, confirmed shot evidence, GPS recovery, and the separation
between predictions and confirmed results. Course data keeps its ODbL attribution.

Run npm run test:model, npm run test:pwa, npm run build, and browser tests for changed
flows. Native changes also require ios/README.md checks. Never treat browser mocks
as signed-device or on-course evidence. Run an app preview when changing its UI.
