/*
 * OpenRound Phase 1 v0 — bench swing-capture instrument.
 *
 * Streams the XIAO nRF52840 Sense onboard LSM6DS3TR-C (+/-16 g, 1666 Hz)
 * over USB CDC-ACM as CSV. Line format is the contract with the Python
 * analysis tool — see README.md before changing anything it emits.
 *
 * Data path: LSM6DSL driver DRDY trigger (own thread, prio 5) fetches each
 * sample, timestamps it, runs the threshold check, and enqueues it; the
 * main thread (prio 7) formats and prints. Sampling therefore never blocks
 * on USB — if the host stalls, samples are dropped at the queue and
 * counted, and the drop count is reported on a "D," line.
 */

#include <math.h>
#include <stdint.h>

#include <zephyr/device.h>
#include <zephyr/devicetree.h>
#include <zephyr/drivers/sensor.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/atomic.h>
#include <zephyr/sys/printk.h>

/* Placeholder for the production stage-1 wake threshold (2-3 g band per
 * docs/hardware-review.md, "two-stage wake"). Software-only check in v0. */
#define WAKE_THRESHOLD_G 2.5f
/* Hysteresis: an event ends only when |a| falls back below this, so one
 * swing waving around 2.5 g emits one EVT line, not dozens. */
#define EVENT_END_G      2.0f

#define STANDARD_GRAVITY_MS2 9.80665f

enum msg_kind {
	MSG_SAMPLE,
	MSG_EVENT,
};

struct capture_msg {
	enum msg_kind kind;
	uint64_t t_us;
	float ax_g;
	float ay_g;
	float az_g;
	float peak_g; /* MSG_EVENT only */
};

/* 256 * 32 B = 8 KB: ~150 ms of samples at 1666 Hz to ride out USB stalls. */
K_MSGQ_DEFINE(capture_q, sizeof(struct capture_msg), 256, 4);

static atomic_t dropped_samples;
static atomic_t fetch_errors;

/* k_cycle_get_32() runs at 32768 Hz on nRF52 (RTC-based system timer) and
 * wraps every ~36 h. Extend to 64 bits here; called only from the sensor
 * trigger thread, so the static state needs no locking, and at >1 kHz call
 * rate a wrap can never be missed. Resolution is ~30.5 us — coarser than
 * the 600 us sample period but fine for v0 bench work (see README). */
static uint64_t cycle_count_64(void)
{
	static uint32_t last;
	static uint64_t high;
	uint32_t now = k_cycle_get_32();

	if (now < last) {
		high += UINT64_C(1) << 32;
	}
	last = now;
	return high | now;
}

static void drdy_handler(const struct device *dev,
			 const struct sensor_trigger *trig)
{
	static bool in_event;
	static float peak_g;
	static uint64_t peak_t_us;

	struct sensor_value acc[3];
	struct capture_msg msg;

	ARG_UNUSED(trig);

	if (sensor_sample_fetch_chan(dev, SENSOR_CHAN_ACCEL_XYZ) < 0) {
		atomic_inc(&fetch_errors);
		return;
	}
	/* Timestamp is taken after the I2C read completes: a roughly constant
	 * ~0.2-0.3 ms late offset, irrelevant for relative timing. */
	uint64_t t_us = k_cyc_to_us_floor64(cycle_count_64());

	if (sensor_channel_get(dev, SENSOR_CHAN_ACCEL_XYZ, acc) < 0) {
		atomic_inc(&fetch_errors);
		return;
	}

	float ax_g = (float)sensor_value_to_double(&acc[0]) / STANDARD_GRAVITY_MS2;
	float ay_g = (float)sensor_value_to_double(&acc[1]) / STANDARD_GRAVITY_MS2;
	float az_g = (float)sensor_value_to_double(&acc[2]) / STANDARD_GRAVITY_MS2;
	float mag_g = sqrtf(ax_g * ax_g + ay_g * ay_g + az_g * az_g);

	if (mag_g > WAKE_THRESHOLD_G) {
		if (!in_event || mag_g > peak_g) {
			peak_g = mag_g;
			peak_t_us = t_us;
		}
		in_event = true;
	} else if (in_event && mag_g < EVENT_END_G) {
		in_event = false;
		msg.kind = MSG_EVENT;
		msg.t_us = peak_t_us;
		msg.peak_g = peak_g;
		msg.ax_g = 0.0f;
		msg.ay_g = 0.0f;
		msg.az_g = 0.0f;
		if (k_msgq_put(&capture_q, &msg, K_NO_WAIT) < 0) {
			atomic_inc(&dropped_samples);
		}
	}

	msg.kind = MSG_SAMPLE;
	msg.t_us = t_us;
	msg.ax_g = ax_g;
	msg.ay_g = ay_g;
	msg.az_g = az_g;
	msg.peak_g = 0.0f;
	if (k_msgq_put(&capture_q, &msg, K_NO_WAIT) < 0) {
		atomic_inc(&dropped_samples);
	}
}

int main(void)
{
	const struct device *imu = DEVICE_DT_GET(DT_NODELABEL(lsm6ds3tr_c));
	const struct device *console = DEVICE_DT_GET(DT_CHOSEN(zephyr_console));
	static struct sensor_trigger drdy_trig = {
		.type = SENSOR_TRIG_DATA_READY,
		.chan = SENSOR_CHAN_ACCEL_XYZ,
	};
	long reported_drops = 0;
	long reported_fetch_errors = 0;

	if (!device_is_ready(console)) {
		return 0; /* no USB means no output channel; nothing to report to */
	}

	/* Block until a terminal opens the port (asserts DTR), so the header
	 * lines land in the capture file instead of a dead ring buffer. */
	uint32_t dtr = 0;
	while (dtr == 0) {
		uart_line_ctrl_get(console, UART_LINE_CTRL_DTR, &dtr);
		k_sleep(K_MSEC(100));
	}

	printk("I,openround-phase1-v0,imu=lsm6ds3tr-c,odr_hz=1666,fs_g=16\n");
	printk("T,%.3f\n", (double)WAKE_THRESHOLD_G);

	if (!device_is_ready(imu)) {
		/* Driver init failed (its own log lines predate USB and are
		 * lost); say so on the contract channel and stop. */
		printk("ERR,imu-not-ready\n");
		return 0;
	}

	/* ODR (1666 Hz) and FS (+/-16 g) were applied at driver init from
	 * CONFIG_LSM6DSL_ACCEL_ODR / _FS; this only enables the DRDY path. */
	if (sensor_trigger_set(imu, &drdy_trig, drdy_handler) < 0) {
		printk("ERR,trigger-set-failed\n");
		return 0;
	}

	struct capture_msg msg;
	while (true) {
		if (k_msgq_get(&capture_q, &msg, K_SECONDS(1)) != 0) {
			/* Samples should arrive every 600 us; a silent second
			 * means the IMU path is broken. */
			printk("ERR,no-samples,fetch_errors=%ld\n",
			       atomic_get(&fetch_errors));
			continue;
		}

		switch (msg.kind) {
		case MSG_SAMPLE:
			printk("S,%llu,%.3f,%.3f,%.3f\n",
			       (unsigned long long)msg.t_us, (double)msg.ax_g,
			       (double)msg.ay_g, (double)msg.az_g);
			break;
		case MSG_EVENT:
			printk("EVT,%llu,%.3f\n",
			       (unsigned long long)msg.t_us, (double)msg.peak_g);
			break;
		}

		long drops = atomic_get(&dropped_samples);
		if (drops != reported_drops) {
			reported_drops = drops;
			printk("D,%llu,%ld\n", (unsigned long long)msg.t_us,
			       drops);
		}
		long ferr = atomic_get(&fetch_errors);
		if (ferr != reported_fetch_errors) {
			reported_fetch_errors = ferr;
			printk("ERR,imu-fetch,%ld\n", ferr);
		}
	}
	return 0;
}
