# cad/ — Phase 1 measurement-rig mount

`phase1-rig-mount.scad` is the mount for the Phase 1 physics-validation rig
(docs/plan.md, Phase 1): a tapered self-tapping thread that screws into a golf
grip's butt hole, topped by a flat platform carrying the XIAO nRF52840 Sense,
the ADXL375 breakout, and a small Li-Po.

**This is not the final tag enclosure.** The final 25 mm tag (Phase 3) is a
different part with different constraints (mass, sealing, ASA, battery door).
This rig only has to hold the sensors rigidly to the club for range sessions.

**UNTESTED:** the `openscad` CLI was not installed on the machine that authored
this model, so the file has never been rendered. Expect the possibility of a
trivial syntax fix on first render. The thread geometry itself is unproven until
the test-fit workflow below has been run on real grips.

## Rigid coupling — read this before "improving" the mount

The whole point of Phase 1 is measuring the butt-end shock spectrum
(50–400 Hz ringing, 5–15 ms impact transients — docs/hardware-review.md).
That measurement is only valid if the sensors are rigidly coupled to the club:

- **Never put rubber, foam, TPU, or tape between the sensor boards and the
  platform.** Any compliant layer is a mechanical low-pass filter plus its own
  resonator — it corrupts exactly the frequency band we are trying to measure.
- The ADXL375 mounts flat on the platform with M2 screws, no standoffs,
  centered over the solid neck (shortest load path to the club).
- Thin walls and cantilevered arms ring at their own frequencies; that is why
  the platform is a 5 mm slab on a solid 18 mm neck, not a shelled bracket.
  Print it solid-ish (see print settings) and resist lightening it.
- Screw the mount in firmly until the neck face seats against the butt cap.
  A loose thread rattles, and rattle looks like signal.

Honest caveat: the rig (~8 g printed + ~15–20 g electronics/battery) is heavier
than the 9–10 g production tag, which shifts ringing amplitudes somewhat. The
frequencies are dominated by shaft/club modes, so the spectrum shape is still
the dataset we need.

## Caliper survey (do this before printing anything)

On **all 13 grips**, record per club:

1. **Hole diameter at the mouth** of the butt hole — measure two perpendicular
   axes; grip holes are often not round. This drives `hole_diameter`.
2. **Hole depth** — how far a probe goes before the hole opens into the shaft
   bore or hits an obstruction (counterweights, plugs). The thread is ~8.75 mm
   long at defaults; shallower than that still works (the taper means the first
   turns do the holding) but note it.
3. **Butt cap OD** — feeds the final tag's USGA constraint (cap OD must not
   exceed grip butt OD) and bounds `neck_diameter` / the seat face.
4. **Cap face shape** — flat, domed, or recessed around the hole. A domed or
   recessed face changes where the neck seats.

Expect the survey to split the bag into 2–3 size groups; that is the plan
(2–3 STL variants, per the hardware review). `hole_diameter = 13.5` in the
model is a **placeholder**, not a measurement.

## Test-fit workflow

Iterate the thread on a 5-minute print before committing to the full mount:

```sh
openscad -o testfit.stl -D 'part="testfit"' cad/phase1-rig-mount.scad
```

The test piece is the thread on a hex puck with the `hole_diameter` value
engraved on the flat face, so a pile of iterations stays sortable.

1. Print, screw into a grip (start with a club you like least).
2. Judge: starts by hand within about half a turn; snugs up over 2–3 turns;
   hex face seats against the cap; no wobble when you waggle the club hard;
   backs out without tearing rubber; survives 5 insert/remove cycles.
3. Adjust and reprint:
   - Too loose / wobbles: decrease `hole_diameter` by 0.25 mm (more
     interference) or increase `thread_depth`.
   - Won't start / needs pliers: increase `hole_diameter` by 0.25 mm or
     increase `thread_taper`.
   - Strips the rubber: coarser `thread_pitch` with the same `thread_depth`.
4. When the fit passes on the grips in that size group, render the full mount:

```sh
openscad -o rig-mount.stl cad/phase1-rig-mount.scad
```

Note the constraint asserted in the model: with 45° flanks,
`2*thread_depth + crest_flat` must stay below `thread_pitch`.

## Component layout

Stacked over the neck, deliberately — the primary sensor gets the stiffest spot:

1. **ADXL375** screwed flat to the platform center, M2 self-tapping into the
   1.7 mm pilot holes (M2×6 is right for the 5 mm platform). The hole spacing
   defaults (20.3 × 14.0 mm) are **assumed** from Adafruit's usual layout —
   caliper your actual board and set `adxl_hole_dx/dy` before printing.
2. **XIAO** zip-tied on top of the ADXL375 through the two side slots. The
   XIAO has **no mounting holes** — zip ties are its mounting method, not a
   shortcut. STEMMA-QT cable connects the two; keep the slack tied down so it
   can't slap the boards during a swing.
3. **Li-Po** on top of the XIAO under the same ties, or beside the stack with
   its own tie (the slots are long enough for two ties side by side). Strain-
   relieve the bare BAT+/− leads. Li-Po care per docs/plan.md: prototyping
   only, never left in a hot car.

Zip ties go tight enough that nothing shifts under thumb pressure. Loctite is
unnecessary; check screw tightness at the start of each range session instead.

## Print settings

For the **rig** (this part):

- Material: **PETG** — fine for a room-temperature prototype rig. (**ASA is
  for the final tag**, which must survive a car trunk; don't burn ASA
  iterations on the rig.)
- 0.2 mm layers, **5–6 perimeters**, 5 top/bottom layers, ≥40 % infill —
  perimeters dominate stiffness, and stiffness is the requirement.
- Orientation: as modeled — platform flat on the bed, thread up. The 45°
  thread flanks and all cones print without supports. The bed face is the
  component face; a smooth bed sheet gives a flat mounting surface.
- No brim needed; the platform is its own brim.

Slicer sanity check before the first print: section the STL through the thread
axis and confirm the thread profile survived (twist extrusions at coarse
`slices` settings can alias; the model uses 72 slices/turn, which should be
plenty).
