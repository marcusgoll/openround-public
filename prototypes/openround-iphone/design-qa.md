# Menu cleanup QA — September 8, 2026

Scope: existing in-round Menu. Preserve the selected option 3 field screen and protected phone runtime.

## Visual review

Reviewed saved before/after phone captures together. The old capture includes the sheet opening transition; the final capture is settled, so sheet height is not a direct animation comparison. Both use the same 393 × 852 phone screen and hole 4 state.

- Quick actions: four balanced cells, readable 16px names and 12px supporting text. Score and Add Shot remain direct actions.
- Navigation: Start Screen and Choose Course precede the tool list.
- Tools: full-width rows separate labels from current values; related controls have Map, Playing, and Shots headings. Minimum row height is 52px.
- Details: native expandable section holds course/provider evidence and field diagnostics. Real play does not render simulation controls. One pin entry replaces duplicate links.
- Lower content: vertical scrolling reaches playing tools, insights and expandable details; labels and states remain legible without truncation in the captured phone viewport.

Evidence: outputs/OpenRound-menu-before.png, outputs/OpenRound-menu-after.png, outputs/OpenRound-menu-details.png in the task workspace.

No P0/P1/P2 visual issue found in the inspected Menu states. This is a focused visual/interaction review, not a complete accessibility audit.

## Checks

Production build and protected-runtime check passed. Menu regression verifies score/putt navigation, toggle state, expandable diagnostics, one pin entry, and absence of real-round demo reset. Course/field regression: 61 passed and one Google-key-dependent test skipped initially. Updated two tests for the new details/demo boundaries and gave the long pin scenario 45 seconds; all three plus the focused Menu check passed on recheck (4 passed). Across the suite and rechecks, 65 distinct browser checks passed, one skipped. Sites checks: 4 passed. PWA checks: 5 passed. No unresolved regression.

## Simplicity review

Ponytail review: native details, existing handlers and existing sheet; no dependencies, new navigation framework or state abstraction. Lean already. Ship. Ponytail full remains active.

Vault writeback: clean-no-op; durable Menu feedback recorded in the app AGENTS.md.

## Floating-action deduplication

Removed Menu entries for Add Shot, Score, Pin, Equipment, Hole Insights and Start Screen; their floating rail/dock controls remain. Pin options moved into the existing pin-placement header. Deleted the unused quick-action grid, primary-card and score-badge CSS. Compared the previous live Menu and current local phone captures together: map and playing tools now fit higher in the sheet with no overlap. No P0/P1/P2 visual issue found. Ponytail review: lean already; full mode retained. Build/runtime check passed; affected navigation and pin workflows are checked before release.
Deduplication validation: 8 navigation/pin checks and 4 focused Menu/scoring checks passed (11 distinct checks); Sites checks passed. No page errors in the final capture.
## Plays Like breakdown

Tapping the header opens the existing conditions sheet, now led by actual distance, the shared wind/elevation/temperature contributions, the rounded total, and a direct link to the matching club picker. The formula remains unchanged and now exposes its components from the model instead of duplicating coefficients in UI calculation. The editor stays below the explanation.

Altitude and lie angle are explicitly not measured/applied. Elevation is a manual yardage correction. Tee-club selection is preserved and labeled, and distance provenance distinguishes tracked GPS, bag estimates, and demo evidence. Putting retains its raw distance display without opening a misleading condition calculation.

Visual check at 393 × 852: all six factor rows and club action fit in the initial sheet view; controls scroll below. Typography, spacing and phone runtime match existing sheets. No P0/P1/P2 visual issue found. Evidence: outputs/OpenRound-plays-like.png. UI test checks base-plus-adjustments, missing factors, condition edits, and identical target in the club picker and header. Model suite: 70 passed. Ponytail review: lean already; existing sheet and handlers reused, no dependency or parallel calculation. Full mode retained.
