# OpenRound Phase 1 firmware v0 — swing-capture instrument

> **COMPILE-VERIFIED, HARDWARE UNTESTED.** Written 2026-08-20. The first
> clean build completed 2026-08-24 against Zephyr **v4.4.2** and Zephyr SDK
> **1.0.1** for `xiao_ble/nrf52840/sense`, producing ELF, HEX, and UF2
> artifacts. The firmware has not been flashed or connected to hardware;
> USB capture, sensor identity, and lossless sample-rate behavior remain
> bench checks. Anything that could not be verified against source is marked
> `VERIFY` below or in the code.

Turns a bare Seeed XIAO nRF52840 Sense into a bench swing-capture
instrument: onboard LSM6DS3TR-C at ±16 g / 1666 Hz, streamed over USB
CDC-ACM as CSV, with a software 2.5 g threshold event line as a placeholder
for the production two-stage wake (see `docs/hardware-review.md`, "two-stage
wake" — production stage-1 threshold is the 2–3 g band).

This is v0: bare board only, no ADXL375 yet, no BLE, no flash logging.

## CSV contract (do not change without changing the Python analysis tool)

Streamed line-by-line over the XIAO's USB port. Parsers must ignore lines
with unknown prefixes.

| Line | When | Format |
|---|---|---|
| `T,<threshold_g>` | once at boot | `T,2.500` |
| `S,<t_us>,<ax_g>,<ay_g>,<az_g>` | every sample | `S,1234567,0.012,-0.980,0.041` |
| `EVT,<t_us>,<peak_g>` | after \|a\| crossed 2.5 g and fell back below 2.0 g | `EVT,1234890,7.812` |

- `t_us`: microseconds since boot from `k_cycle_get_32()` (extended to
  64-bit in software, so it does not wrap). On nRF52 the cycle clock is the
  32768 Hz RTC, so resolution is **~30.5 µs** — coarse against the 600 µs
  sample period but fine for bench work. TODO: move to a 1 MHz TIMER
  peripheral if the analysis tool ever needs finer timing.
- `<*_g>`: acceleration in g, float, 3 decimals.
- `EVT` reports the **time and magnitude of the peak sample** within the
  above-threshold excursion, and is emitted when the excursion ends (falls
  below 2.0 g — hysteresis so one wave = one event). This deviates from a
  bare "print on crossing" so bench waving produces countable events.

Additional lines v0 emits (all ignorable by prefix):

| Line | Meaning |
|---|---|
| `I,...` | once at boot, before `T`: firmware id + configured ODR/FS |
| `D,<t_us>,<total_dropped>` | samples dropped at the internal queue because USB could not drain fast enough (cumulative count) |
| `ERR,...` | IMU not ready / trigger setup failed / fetch errors / 1 s with no samples |

## What the firmware actually does

- The board devicetree already models everything: the IMU is
  `lsm6ds3tr_c@6a` (compatible `st,lsm6dsl` — the LSM6DS3TR-C shares the
  LSM6DSL register map and WHO_AM_I `0x6A`) on the internal I²C bus
  (`&i2c0`, TWIM @ 400 kHz), and its power pin 6D_PWR (**P1.08**) is a
  `regulator-fixed` node with `regulator-boot-on`, so with
  `CONFIG_REGULATOR=y` (board defconfig) the rail comes up at boot with no
  application code.
- **The Zephyr driver does NOT cap the ODR below 1.6 kHz**:
  `CONFIG_LSM6DSL_ACCEL_ODR=8` is 1666 Hz (the Kconfig table goes to
  6664 Hz). 1666 Hz is chosen deliberately — it matches the production
  1600 Hz capture rate, and the 400 kHz I²C fetch (~0.25 ms/sample) cannot
  sustain the higher settings anyway.
- Samples are fetched in the driver's data-ready trigger thread (priority
  5), timestamped, threshold-checked, and queued; the main thread (priority
  7) formats and prints. A stalled USB host therefore drops samples at the
  queue (counted, reported via `D,`) instead of stalling capture.
- Full scale ±16 g (`CONFIG_LSM6DSL_ACCEL_FS=16`). **It will clip on real
  impacts by design** — that is the whole reason the ADXL375 is on order.
- Analog bandwidth: the driver leaves the accel anti-alias filter at its
  default 400 Hz, which covers the 50–400 Hz ring band the classifier
  needs. Content above 400 Hz is attenuated even at 1666 Hz ODR.
- The gyro is left powered down (`CONFIG_LSM6DSL_GYRO_ODR` default 0 →
  driver writes ODR 0 = power-down).

## Toolchain install (macOS, vanilla Zephyr — recommended)

This app uses nothing NCS-specific, so plain upstream Zephyr is the lighter
install. Pin **v4.4.2** — everything here was verified against that tag.

```sh
brew install cmake ninja gperf python3 ccache qemu dtc libmagic wget

python3 -m venv ~/zephyrproject/.venv
source ~/zephyrproject/.venv/bin/activate
pip install west

west init ~/zephyrproject --mr v4.4.2
cd ~/zephyrproject
west update
west zephyr-export
west packages pip --install   # VERIFY: on older west use: pip install -r zephyr/scripts/requirements.txt
cd zephyr
west sdk install
```

Alternative: nRF Connect SDK (currently v3.4.0) via Nordic's toolchain
manager — `nrfutil` with the toolchain-manager/sdk-manager command, or the
VS Code nRF Connect extension. Works, but pulls gigabytes more and pins a
different Zephyr revision. `// VERIFY: exact nrfutil subcommand name has
churned (toolchain-manager vs sdk-manager); check Nordic's current docs.`

## Build

Board target (Zephyr hardware model v2 qualifier, verified against
`boards/seeed/xiao_ble/board.yml`): **`xiao_ble/nrf52840/sense`**.

```sh
source ~/zephyrproject/.venv/bin/activate
cd ~/zephyrproject
west build -p auto -b xiao_ble/nrf52840/sense \
    ~/projects/openround/firmware/phase1 \
    --build-dir ~/projects/openround/firmware/phase1/build
```

(`west build` must run inside the west workspace, or with `ZEPHYR_BASE`
exported — hence the `cd ~/zephyrproject`.)

## Flash (UF2, no debugger needed)

The XIAO ships with the Adafruit nRF52 UF2 bootloader, and the board config
builds a UF2 by default (`CONFIG_BUILD_OUTPUT_UF2=y`).

1. Plug the XIAO in via USB-C.
2. **Double-tap the RST button** (tiny button beside the USB connector).
   A drive named `XIAO-SENSE` appears.
3. `cp ~/projects/openround/firmware/phase1/build/zephyr/zephyr.uf2 /Volumes/XIAO-SENSE/`
4. The drive ejects itself and the board reboots into the app.

## Capture a stream

The firmware **waits for DTR** — nothing is printed until a program opens
the serial port. Find the port first:

```sh
ls /dev/tty.usbmodem*
```

Option A, `screen` (macOS built-in; the baud rate is ignored on CDC-ACM):

```sh
screen -L -Logfile swing.csv /dev/tty.usbmodemXXXX 115200
# older screen builds lack -Logfile; plain -L logs to ./screenlog.0
# exit: Ctrl-A then Ctrl-\
```

Option B, pyserial (live view + file):

```sh
python3 -m pip install pyserial
python3 -m serial.tools.miniterm --raw /dev/tty.usbmodemXXXX 115200 | tee swing.csv
```

Sanity check: hold the board still — `S,` lines with |a| ≈ 1.000 g total.
Shake or tap it hard — `EVT,` lines appear. Gaps in `t_us` or any `D,`
line mean the host didn't keep up.

If you close the port mid-run the firmware keeps sampling; reopen the port
and the stream resumes (with a `D,` line for whatever overflowed — the boot
`I`/`T` header is only printed once, on the first-ever port open).

## Known gaps / next steps

- **ADXL375 (±200 g, I²C 0x53)**: overlay stub with wiring notes is in
  `app.overlay`. Zephyr v4.4.2 has **no** in-tree `adi,adxl375` driver
  (checked 2026-08-20) — see the stub for the three options when the
  Adafruit PID 5374 breakout arrives. External bus is `&i2c1` = XIAO pads
  D4 (P0.04, SDA) / D5 (P0.05, SCL).
- Effective sample rate is not proven to be a lossless 1666 Hz until
  measured — the DRDY-per-sample I²C fetch is ~40% bus utilization and the
  trigger thread must keep pace. The timestamps are ground truth: measure
  the real rate from `t_us` deltas on first bench run, and if samples are
  skipped, that is the finding (options: drop to ODR index 7 = 833 Hz, or
  batch via the chip FIFO, which the Zephyr lsm6dsl driver does not
  support).
- Timestamp resolution ~30.5 µs (RTC cycle clock), see CSV contract notes.
- No triggered-window capture, no QSPI flash logging, no BLE — all
  deliberately out of v0.
