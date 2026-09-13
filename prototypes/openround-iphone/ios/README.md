# OpenRound native iPhone handoff

Status: source implementation, not a signed or device-validated release. The user chose native iPhone, phone in pocket first, Apple Watch later. This public release does not claim a signed-device build or measured locked-screen reliability.

## What is implemented

- Capacitor 8.5.1 shell bundles the existing OpenRound UI locally.
- Native Core Location recording, started explicitly in Menu → Smart Tracking, writes each accepted location before JavaScript inference. The background location mode and visible iOS location indicator are enabled.
- Native JSONL journal retains timestamps, accuracy, hole, capture segments and independent corrections. Restart replay is deterministic; interrupted partial writes fail closed and preserve the original file. Storage failure stops capture. A corrupt old recording does not prevent starting a new round recording.
- Conservative GPS stop-to-stop candidates, suggested clubs and mapped starting lies. Unknown and dismissed states remain explicit. These are location predictions, not swing or ball-contact detection.
- Editable club, starting lie and decimal-degree endpoints. Corrections survive reopening. Scores, partner scores, putts and learned distances remain in their existing manual/confirmed flows.
- Menu entry and Rounds → Review Smart Tracking provide in-round and post-round access. Hole/course/end-round transitions update or stop native recording before changing round state.

## Build on a Mac

Prerequisites: Xcode 26 or newer with iOS support, Node.js 24, npm, Git, a connected iPhone with Developer Mode, and an Apple signing team selected by the owner. No signing credentials or team ID are stored here.

```sh
git clone https://github.com/marcusgoll/openround-public.git
cd openround-public/prototypes/openround-iphone
npm ci
npm run native:sync
# Unsigned simulator compile; this is not device validation:
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO build
npm run native:open
```

In Xcode select the App target, Signing & Capabilities, the owner's Team, and the connected iPhone. Bundle ID is `com.marcusgoll.openround`; verify its availability before signing. Run the app. TestFlight/App Store submission is not included in this handoff.

`native:sync` rebuilds and copies bundled web assets; repeat after web changes. Generated `ios/App/App/public` and Capacitor config are ignored by Git. Keep background Location updates enabled. The journal uses the app container and file protection available after the first unlock. Its file-metadata usage is declared with Apple's C617.1 reason in PrivacyInfo.xcprivacy. Review the complete app privacy report before distribution, including map/weather services and Capacitor's own manifest.

## Verification

The public web shell and native source are tested separately. Browser tests do
not establish native background reliability.

Run the journal checks on the Mac too:

```sh
swiftc ios/App/App/TrackingJournal.swift tests/native/JournalChecks.swift -o /tmp/openround-journal-checks
/tmp/openround-journal-checks
npm run test:model
npx playwright install chromium
npx playwright test tests/smart-tracking.spec.ts tests/play-flow-review.spec.ts tests/menu.spec.ts tests/plays-like.spec.ts --workers=1
```

## Physical iPhone release gate

1. Verify permission denied, Allow Once, While Using, precise location off/on, and later revocation. The UI must show permission/errors rather than pretend useful capture.
2. Start a real saved round, then start Smart Tracking while visible. Lock the phone and walk a measured course segment with deliberate 15-second stops. Reopen; confirm timestamps continue during lock and the observations appear only once.
3. Play a full round with phone in pocket. Log actual shot times, clubs and positions independently. Compare every suggestion against real shots, practice swings, searches, cart stops and penalty/provisional balls. Measure missed shots, false candidates, positional errors and battery drain. Thresholds are initial values, not calibrated accuracy claims.
4. Change holes; no candidate may bridge the boundary. End the round or switch course; capture must stop. Repeat with denied permissions and storage failure. Fix any transition or duplicate-callback failure before release.
5. Interrupt with an incoming call, other apps, low power, airplane mode, force quit and a device restart. Force quit/restart require explicit Resume; gaps must never become shots. Existing observations and edits must remain available offline.
6. Edit/dismiss predictions, close/reopen the app, then review from Rounds. Check original evidence retained, no duplicated candidates and no changes to scores/club learning.
7. Verify actual iPhone safe areas, native keyboard, permission prompts, map tiles, camera access, portrait layout and background indicator. Windows screenshot checks cannot validate these.

Do not call the app dependable hands-free tracking until a signed device build and labeled field rounds pass these checks. There is no guarantee of recording after force quit.

## Remaining product work

- Phone motion/swing evidence and labeled-round calibration; later Apple Watch capture.
- Easier map-based endpoint editing (this slice supports decimal coordinates).
- Automatic hole progression, short-shot reconciliation and manual putt/penalty matching.
- Promotion into one confirmed shot timeline with start/end lie, distance-to-hole, penalties and holed-out state; deduplicate against manual GPS shots.
- Versioned expected-strokes benchmark, category strokes gained, coverage/sample counts and evidence-based improvement tips. No benchmark values or SG results were invented in this slice.

The native journal remains on the device, separate from browser storage. Existing browser rounds are not automatically migrated into the native app. Preserve/export existing history before any later migration. Do not uninstall an app holding the only copy of round data.

## Recovery and rollback

Keep a known-good release and exported data before testing native changes. Do not delete or truncate a corrupt journal: preserve the app container through Xcode Devices, inspect a copy, and repair only with a verified recovery procedure. The native recorder caps each journal at 32 MB; move to SQLite only when measured replay latency or retention demands it.

References: [Capacitor iOS](https://capacitorjs.com/docs/ios), [custom native plugins](https://capacitorjs.com/docs/ios/custom-code), [Apple background location](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background), [Apple required API reasons](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons).
