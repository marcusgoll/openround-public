// OpenRound Phase 1 measurement-rig mount
// =======================================
// Temporary instrument mount for the physics-validation rig (docs/plan.md,
// Phase 1). NOT the final 25 mm tag enclosure. Screws into a golf grip's
// butt hole with a tapered multi-turn self-tapping thread (twist-lock was
// rejected in docs/hardware-review.md — a bare rubber grip hole has no
// undercut), and carries a flat platform for:
//   - Adafruit ADXL375 breakout (~25.4 x 19 mm) — screwed flat over the neck
//   - Seeed XIAO nRF52840 Sense (21 x 17.8 mm)  — zip-tied (it has NO
//     mounting holes; the M2 holes here are for the ADXL375 only)
//   - small Li-Po                                — zip-tied on the stack
//
// RIGIDITY IS THE POINT: this rig measures the butt-end shock spectrum.
// The platform sits directly on a solid neck over the threaded plug; there
// are no thin webs or cantilevered arms to ring. Never add rubber or foam
// between sensor and platform — isolation corrupts the data (see cad/README.md).
//
// Model is in PRINT orientation: platform flat on the bed (component face
// down against the bed for a flat mounting surface), thread pointing up.
// Thread flanks are 45 degrees, so no supports are needed.
//
// Renders with plain OpenSCAD, no libraries:
//   openscad -o rig-mount.stl cad/phase1-rig-mount.scad
//   openscad -o testfit.stl -D 'part="testfit"' cad/phase1-rig-mount.scad
// UNTESTED: authored on a machine without the openscad CLI — see cad/README.md.

/* [Part selection] */
// "full" = platform + neck + thread. "testfit" = thread on a hex puck,
// ~5-minute print, for iterating thread fit before committing to the full mount.
part = "full"; // ["full", "testfit"]

/* [Thread — tune these from the test-fit piece] */
// Grip butt-hole diameter at the mouth, mm. PLACEHOLDER 13.5 — replace with
// the caliper survey of all 13 grips (docs/plan.md Phase 1). This becomes the
// thread ROOT (core) diameter at the seated end; crests stand thread_depth
// proud of it and bite into the rubber.
hole_diameter = 13.5;
// Axial distance between thread turns, mm. Review spec: >= 2 mm, coarse.
// Geometric constraint (45-degree flanks): 2*thread_depth + crest_flat must
// be < thread_pitch or adjacent turns merge — asserted below.
thread_pitch = 3.5;
// Radial height of the thread above the core, mm — how far it bites into rubber.
thread_depth = 1.3;
// Number of turns. Review spec: 2–3.
thread_turns = 2.5;
// Diameter reduction from seated end to tip, mm. At the default of
// 2*thread_depth the tip major diameter equals hole_diameter exactly, so the
// tip drops into the hole freely and engagement ramps linearly — the
// self-tapping behavior. Reduce for more bite at the tip.
thread_taper = 2.6;
// Flat on the thread crest, mm. A knife-edge crest prints poorly and tears rubber.
crest_flat = 0.5;

/* [Platform] */
// Along X, mm.
platform_length = 40;
// Along Y, mm.
platform_width = 25;
// Chunky on purpose: a thin platform is a drum head at ringing frequencies.
platform_thickness = 5;
// Corner rounding radius, mm.
platform_corner_r = 3;

/* [Neck] */
// Platform-to-thread standoff, mm. Two constraints pull opposite ways:
// short = stiff (wanted), but a zip tie must return between the platform
// underside and the grip's butt cap (~5 mm for tie + head clearance).
neck_height = 6;
// Must exceed the thread major diameter (hole_diameter + 2*thread_depth) so
// the neck's end face seats flat against the butt cap as a positive stop.
neck_diameter = 18;

/* [ADXL375 mounting holes] */
// Hole-center spacing, mm. ASSUMED from Adafruit's usual 0.1-inch corner
// inset on a 25.4 x 19 mm board — CALIPER YOUR ACTUAL BOARD before trusting.
adxl_hole_dx = 20.3;
adxl_hole_dy = 14.0;
// Pilot diameter for M2 screws self-tapping into PETG, mm.
m2_pilot_d = 1.7;

/* [Zip-tie slots] */
// Slot center distance from platform center along X, mm. Must clear the
// ADXL375 board edge (25.4/2 = 12.7) and the neck gusset skirt.
slot_offset = 15;
// Slot length along Y, mm. Long enough for two ties side by side.
slot_length = 14;
// Slot width along X, mm. Passes standard 3.6 mm-wide ties.
slot_width = 4.0;

// ---------------------------------------------------------------------------
// Derived values and sanity checks
// ---------------------------------------------------------------------------

major_d      = hole_diameter + 2 * thread_depth; // thread OD at the seated end
thread_len   = thread_turns * thread_pitch;
tip_chamfer  = 1.2;                              // lead-in cut at the tip, mm
gusset_h     = min(3, neck_height);              // neck-to-platform skirt
gusset_d     = neck_diameter + 6;

assert(2 * thread_depth + crest_flat < thread_pitch,
       "45-degree flanks: 2*thread_depth + crest_flat must be < thread_pitch");
assert(neck_diameter > major_d,
       "neck_diameter must exceed the thread major diameter to form the seat face");
assert(thread_taper < hole_diameter,
       "thread_taper larger than the hole diameter makes no sense");

// ---------------------------------------------------------------------------
// Thread cross-section
// ---------------------------------------------------------------------------
// The plug is a linear_extrude with twist of (core circle + one tooth), then
// intersected with a cone for the taper. The tooth is drawn in the XY plane:
// the twist maps angular offset to axial offset (360 deg = one pitch), so a
// tooth whose radial protrusion falls off linearly with angle extrudes into
// a thread with straight 45-degree flanks in the axial plane.
function thread_tooth_pts(core_r, depth, pitch, crest, steps) =
    let (
        w_root  = 2 * depth + crest,        // axial width of tooth at the root
        a_root  = 360 * w_root / pitch,     // angular span of the tooth
        inner_r = core_r - 1                // closure arc buried inside the core
    )
    concat(
        // outer edge: root -> flank -> crest flat -> flank -> root
        [ for (i = [0 : steps])
            let (
                th = -a_root / 2 + a_root * i / steps,
                ax = abs(th) * pitch / 360,               // axial offset from centerline
                d  = (ax <= crest / 2) ? depth            // on the crest flat
                                       : (w_root / 2 - ax) // on the 45-degree flank
            )
            [ (core_r + max(d, 0)) * cos(th), (core_r + max(d, 0)) * sin(th) ]
        ],
        // inner closure arc, traced back the other way
        [ for (i = [0 : steps])
            let (th = a_root / 2 - a_root * i / steps)
            [ inner_r * cos(th), inner_r * sin(th) ]
        ]
    );

// Threaded plug, base (seated/root end) at z=0, tip at z=thread_len.
module threaded_plug() {
    intersection() {
        // negative twist = right-hand thread (clockwise to install);
        // handedness barely matters in rubber, but stay conventional
        linear_extrude(height = thread_len,
                       twist = -360 * thread_turns,
                       slices = ceil(72 * thread_turns),
                       convexity = 10)
            union() {
                circle(d = hole_diameter, $fn = 96);
                polygon(thread_tooth_pts(hole_diameter / 2, thread_depth,
                                         thread_pitch, crest_flat, 120));
            }
        // taper: full major diameter at the seat, reduced by thread_taper at the tip
        cylinder(h = thread_len,
                 d1 = major_d + 0.2,
                 d2 = major_d - thread_taper,
                 $fn = 96);
        // tip lead-in chamfer (upward-shrinking cone: always printable)
        union() {
            cylinder(h = thread_len - tip_chamfer, d = major_d + 2, $fn = 96);
            translate([0, 0, thread_len - tip_chamfer])
                cylinder(h = tip_chamfer,
                         d1 = major_d + 2,
                         d2 = hole_diameter - thread_taper,
                         $fn = 96);
        }
    }
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

module rounded_plate_2d(l, w, r) {
    offset(r = r) square([l - 2 * r, w - 2 * r], center = true);
}

// Full mount, print orientation: platform on bed (z=0 is the component face),
// neck and thread above.
module full_mount() {
    difference() {
        union() {
            linear_extrude(platform_thickness)
                rounded_plate_2d(platform_length, platform_width, platform_corner_r);
            // gusset skirt: spreads the neck load into the platform
            translate([0, 0, platform_thickness])
                cylinder(h = gusset_h, d1 = gusset_d, d2 = neck_diameter, $fn = 96);
            // solid neck — the entire shock path is this column; no ribs, no shells
            translate([0, 0, platform_thickness])
                cylinder(h = neck_height, d = neck_diameter, $fn = 96);
        }
        // M2 pilot holes, ADXL375 pattern, centered over the neck so the
        // primary sensor sits on the shortest possible load path
        for (sx = [-1, 1], sy = [-1, 1])
            translate([sx * adxl_hole_dx / 2, sy * adxl_hole_dy / 2, -1])
                cylinder(h = platform_thickness + 3, d = m2_pilot_d, $fn = 24);
        // zip-tie slots, one each side of the board stack
        for (sx = [-1, 1])
            translate([sx * slot_offset, 0, platform_thickness / 2])
                cube([slot_width, slot_length, platform_thickness + 2], center = true);
    }
    translate([0, 0, platform_thickness + neck_height])
        threaded_plug();
}

// Test-fit piece: thread on a hex puck. The hex is the finger wrench and also
// rehearses the seat face. The engraved number on the bed face is the
// hole_diameter it was generated for, so multiple iterations stay tellable apart.
module testfit_plug() {
    hex_af = 21;   // across flats, mm
    hex_h  = 4;    // puck thickness, mm
    difference() {
        cylinder(h = hex_h, d = hex_af / cos(30), $fn = 6);
        // engraved into the bed face; mirrored so it reads correctly from below
        translate([0, 0, -0.01])
            mirror([1, 0, 0])
                linear_extrude(0.41)
                    text(str(hole_diameter), size = 5,
                         halign = "center", valign = "center");
    }
    translate([0, 0, hex_h])
        threaded_plug();
}

// ---------------------------------------------------------------------------

if (part == "full")
    full_mount();
else if (part == "testfit")
    testfit_plug();
else
    assert(false, "part must be \"full\" or \"testfit\"");
