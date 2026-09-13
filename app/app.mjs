import {
  addBreadcrumb,
  addEvent,
  closeGap,
  createEvent,
  createRound,
  finishRound,
  openGap,
} from "./capture.mjs";
import { getRound, listRounds, putRound } from "./storage.mjs";
import { estimatePinDistanceYards, formatPinDistance } from "./pin-placement.mjs";

const demoMode = new URLSearchParams(window.location.search).get("demo") === "1";
const elements = Object.fromEntries(
  [
    "status",
    "storage-state",
    "demo-badge",
    "round-list-view",
    "round-list",
    "start-round",
    "active-view",
    "active-round-title",
    "elapsed",
    "gps-state",
    "last-fix",
    "accuracy",
    "breadcrumb-count",
    "event-count",
    "gps-detail",
    "demo-controls",
    "add-test-fix",
    "add-test-shot",
    "retry-gps",
    "end-round",
    "export-active",
    "pin-view",
    "pin-badge",
    "start-pin-camera",
    "stop-pin-camera",
    "pin-camera-frame",
    "pin-video",
    "pin-guide",
    "pin-marker-top",
    "pin-marker-bottom",
    "pin-hint",
    "pin-height-in",
    "pin-slope-deg",
    "pin-fov-deg",
    "pin-zoom-wrap",
    "pin-zoom",
    "pin-zoom-value",
    "pin-result",
    "pin-simulate",
    "pin-save",
    "pin-clear",
    "review-view",
    "review-title",
    "review-summary",
    "event-list",
    "gap-list",
    "breadcrumb-list",
    "back-to-rounds",
    "export-review",
  ].map((id) => [id, document.getElementById(id)]),
);

const state = {
  rounds: [],
  round: null,
  storageReady: false,
  watchId: null,
  gpsState: "waiting",
  lastError: null,
  timerId: null,
  demoShotCount: 0,
  pin: {
    stream: null,
    track: null,
    zoomCap: null,
    awaitingPoint: "top",
    topY: null,
    bottomY: null,
    lastResult: null,
    cameraOpen: false,
  },
};

let writeQueue = Promise.resolve();
let writeVersion = 0;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(timestamp) {
  return dateFormatter.format(new Date(timestamp));
}

function formatAge(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(timestamp)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function formatDuration(startedAt, endedAt = nowIso()) {
  const seconds = Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function setStatus(message, { error = false } = {}) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", error);
}

function setView(view) {
  elements["round-list-view"].hidden = view !== "rounds";
  elements["active-view"].hidden = view !== "active";
  elements["review-view"].hidden = view !== "review";
  elements["pin-view"].hidden = view !== "active";
}

function gpsLabel(value) {
  return {
    waiting: "Waiting",
    requesting: "Requesting…",
    watching: "Watching",
    "permission-denied": "Permission denied",
    "position-unavailable": "Unavailable",
    timeout: "Timed out",
    "background-paused": "Paused",
  }[value] ?? value;
}

function updateRoundList(round) {
  const index = state.rounds.findIndex((candidate) => candidate.round_id === round.round_id);
  if (index < 0) {
    state.rounds = [round, ...state.rounds];
  } else {
    state.rounds = state.rounds.map((candidate, candidateIndex) =>
      candidateIndex === index ? round : candidate,
    );
  }
}

async function persistRound() {
  if (!state.round) return;
  const snapshot = state.round;
  const version = ++writeVersion;
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    await putRound(snapshot);
    updateRoundList(snapshot);
  });
  try {
    await writeQueue;
    const latest = version === writeVersion;
    if (latest) {
      renderRoundList();
    }
    return latest;
  } catch (error) {
    elements["storage-state"].textContent = "Blocked";
    setStatus(`Local storage failed: ${error.message}`, { error: true });
    throw error;
  }
}

async function refreshRounds() {
  state.rounds = await listRounds();
  state.storageReady = true;
  elements["storage-state"].textContent = "Local storage ready";
  elements["start-round"].disabled = false;
  renderRoundList();
}

function renderRoundList() {
  elements["round-list"].replaceChildren();
  if (state.rounds.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No local rounds yet.";
    elements["round-list"].append(empty);
    return;
  }

  for (const round of state.rounds) {
    const article = document.createElement("article");
    article.className = "round-card";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = formatDate(round.started_at);
    const meta = document.createElement("span");
    meta.textContent = `${round.breadcrumbs.length} fixes · ${round.events.length} events · ${round.ended_at ? "Complete" : "In progress"}`;
    details.append(title, meta);
    const action = document.createElement("button");
    action.className = "secondary-button";
    action.type = "button";
    action.dataset.action = round.ended_at ? "review" : "resume";
    action.dataset.roundId = round.round_id;
    action.textContent = round.ended_at ? "Review" : "Resume";
    article.append(details, action);
    elements["round-list"].append(article);
  }
}

function renderActive() {
  if (!state.round) return;
  const round = state.round;
  const latest = round.breadcrumbs.at(-1);
  elements["active-round-title"].textContent = formatDate(round.started_at);
  elements.elapsed.textContent = formatDuration(round.started_at, round.ended_at ?? undefined);
  elements["gps-state"].textContent = gpsLabel(state.gpsState);
  elements["last-fix"].textContent = latest ? formatAge(latest.timestamp) : "—";
  elements.accuracy.textContent = latest ? `${Math.round(latest.accuracy_m)} m` : "—";
  elements["breadcrumb-count"].textContent = String(round.breadcrumbs.length);
  elements["event-count"].textContent = String(round.events.length);
  elements["demo-controls"].hidden = !demoMode;
  elements["retry-gps"].hidden = ![
    "permission-denied",
    "position-unavailable",
    "timeout",
  ].includes(state.gpsState);
  elements["end-round"].disabled = Boolean(round.ended_at);

  const detail = elements["gps-detail"];
  detail.className = "callout";
  if (state.gpsState === "permission-denied") {
    detail.classList.add("error");
    detail.textContent = "Location permission was denied. Enable Location for this site in iPhone Settings, then retry GPS.";
  } else if (state.gpsState === "position-unavailable" || state.gpsState === "timeout") {
    detail.classList.add("warn");
    detail.textContent = `${gpsLabel(state.gpsState)}. The round is saved, but events during this gap will remain unlocated.`;
  } else if (state.gpsState === "background-paused") {
    detail.classList.add("warn");
    detail.textContent = "The page is hidden. Tracking is paused; return to OpenRound to resume and close the gap with a fresh fix.";
  } else if (latest) {
    detail.textContent = `Last fix ${formatAge(latest.timestamp)} with ${Math.round(latest.accuracy_m)} m reported accuracy. Keep this screen visible during play.`;
  } else {
    detail.textContent = "Waiting for a GPS fix. No location is assigned until the phone provides one.";
  }
  pinRenderSaveState();
  elements["pin-clear"].disabled = false;
}

function renderReview() {
  if (!state.round) return;
  const round = state.round;
  elements["review-title"].textContent = formatDate(round.started_at);
  elements["review-summary"].replaceChildren();
  const summary = [
    ["Status", round.ended_at ? "Complete" : "In progress"],
    ["Duration", formatDuration(round.started_at, round.ended_at ?? undefined)],
    ["GPS fixes", String(round.breadcrumbs.length)],
    ["Events", String(round.events.length)],
  ];
  for (const [label, value] of summary) {
    const item = document.createElement("div");
    item.className = "summary-item";
    const name = document.createElement("span");
    name.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value;
    item.append(name, content);
    elements["review-summary"].append(item);
  }

  renderEvidenceList(elements["event-list"], round.events, (event) => {
    if (event.source === "pin-placement") {
      const details = event.pin_placement;
      const distance = details?.horizontalDistanceYards;
      const confidence = details?.confidence;
      const suffix = distance === undefined ? "no estimate" : `${formatPinDistance(distance)} est (conf ${confidence}%)`;
      const flag = `${details?.pinHeightIn ?? "—"} in flag · ${details?.slopeDeg ?? 0}° slope · zoom ${details?.zoom ?? 1}x`;
      return [`Pin placement · ${event.timestamp}`, `${suffix}; ${flag}`];
    }
    const location = event.location;
    const coordinate = location.lat === undefined
      ? `Location ${location.status}; no coordinate recorded.`
      : `Location attributed (${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}) · breadcrumb ${location.breadcrumb_age_ms} ms away.`;
    return [`${event.source} event · ${event.timestamp}`, coordinate];
  }, "No events recorded.");
  renderEvidenceList(elements["gap-list"], round.gaps, (gap) => {
    const end = gap.ended_at ? formatDate(gap.ended_at) : "still open";
    return [gap.reason, `${formatDate(gap.started_at)} → ${end}`];
  }, "No gaps recorded.");
  renderEvidenceList(elements["breadcrumb-list"], round.breadcrumbs, (breadcrumb) => [
    `${breadcrumb.lat.toFixed(5)}, ${breadcrumb.lon.toFixed(5)}`,
    `${formatDate(breadcrumb.timestamp)} · ${Math.round(breadcrumb.accuracy_m)} m · ${breadcrumb.source}`,
  ], "No breadcrumbs recorded.");
}

function renderEvidenceList(container, records, lines, emptyText) {
  container.replaceChildren();
  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }
  for (const record of records) {
    const evidence = document.createElement("div");
    evidence.className = "evidence";
    const [titleText, detailText] = lines(record);
    const title = document.createElement("strong");
    title.textContent = titleText;
    const detail = document.createElement("small");
    detail.textContent = detailText;
    evidence.append(title, detail);
    container.append(evidence);
  }
}

function pinClearMeasurement() {
  state.pin.topY = null;
  state.pin.bottomY = null;
  state.pin.lastResult = null;
  state.pin.awaitingPoint = "top";
  elements["pin-marker-top"].hidden = true;
  elements["pin-marker-bottom"].hidden = true;
  elements["pin-result"].textContent = "No measurement yet.";
  elements["pin-hint"].textContent = "Tip: tap the pin top, then pin bottom.";
  elements["pin-save"].disabled = true;
}

function pinShowHint(message) {
  elements["pin-hint"].textContent = message;
}

function pinRenderSaveState() {
  elements["pin-save"].disabled = !state.round || Boolean(state.round?.ended_at) || !state.pin.lastResult;
}

function pinPlaceMarker(position, y) {
  const marker = position === "top" ? elements["pin-marker-top"] : elements["pin-marker-bottom"];
  const value = Math.max(0, Math.min(elements["pin-camera-frame"].clientHeight, y));
  marker.style.top = `${value}px`;
  marker.style.left = "50%";
  marker.hidden = false;
  if (position === "top") {
    state.pin.topY = value;
  } else {
    state.pin.bottomY = value;
  }
  pinRenderSaveState();
}

function pinUpdateResult() {
  if (state.pin.topY === null || state.pin.bottomY === null) return;
  const heightPx = Math.abs(state.pin.bottomY - state.pin.topY);
  if (heightPx < 1) {
    elements["pin-result"].textContent = "Measurement is too small. Pick a fuller section of the flag.";
    state.pin.lastResult = null;
    pinRenderSaveState();
    return;
  }

  const video = elements["pin-video"];
  const frame = elements["pin-camera-frame"];
  const scale = video.videoWidth && video.videoHeight
    ? Math.max(frame.clientWidth / video.videoWidth, frame.clientHeight / video.videoHeight)
    : 1;
  const frameHeightPx = video.videoHeight || video.clientHeight || 1;
  const pinHeightIn = Number(elements["pin-height-in"].value);
  const slopeDeg = Number(elements["pin-slope-deg"].value);
  const fovDeg = Number(elements["pin-fov-deg"].value);
  const zoom = Number(elements["pin-zoom"].value);

  try {
    const result = estimatePinDistanceYards({
      measuredFlagHeightPx: heightPx / scale,
      frameHeightPx,
      pinHeightIn,
      cameraFovDeg: fovDeg,
      zoom,
      slopeDeg,
    });
    const corrected = result.horizontalDistanceYards;
    const slant = result.slantDistanceYards;
    const confidence = Math.round(result.confidence * 100);
    const rangeLine = result.withinTwoHundredYards ? `${formatPinDistance(corrected)} (within 200 yd)` : `${formatPinDistance(corrected)} · outside 200 yd window`;
    const slopeLine = slopeDeg ? ` | Slope correction: ${slopeDeg.toFixed(1)}°` : " | Slope: flat";
    elements["pin-result"].textContent = `${rangeLine} · Pin confidence ${confidence}% · slant ${formatPinDistance(slant)}${slopeLine}`;
    state.pin.lastResult = {
      horizontalDistanceYards: corrected,
      correctedDistanceYards: corrected,
      slantDistanceYards: slant,
      confidence,
      measuredFlagHeightPx: heightPx / scale,
      pinHeightIn,
      slopeDeg,
      fovDeg,
      zoom,
      withinTwoHundredYards: result.withinTwoHundredYards,
    };
  } catch (error) {
    elements["pin-result"].textContent = error.message;
    state.pin.lastResult = null;
  }
  pinRenderSaveState();
}

function pinHandleFrameTap(event) {
  if (!state.pin.cameraOpen) return;
  const rect = elements["pin-camera-frame"].getBoundingClientRect();
  const y = event.clientY - rect.top;
  if (!Number.isFinite(y) || y < 0 || y > rect.height || rect.height <= 0) return;

  if (state.pin.awaitingPoint === "top") {
    pinPlaceMarker("top", y);
    state.pin.awaitingPoint = "bottom";
    pinShowHint("Great. Tap the pin bottom to measure length.");
    return;
  }
  pinPlaceMarker("bottom", y);
  state.pin.awaitingPoint = "top";
  pinShowHint("Measurement captured. Tap 'Estimate distance', then save to active round if desired.");
  pinUpdateResult();
}

function pinRunSimulation() {
  const pinHeightIn = 42;
  const fovDeg = 65;
  const frameHeightPx = 2160;
  const expectedYards = 75;
  const focalPx = frameHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  const measuredFlagHeightPx = (focalPx * pinHeightIn * 0.0254 * 1.0936132983377078) / expectedYards;
  const result = estimatePinDistanceYards({ measuredFlagHeightPx, frameHeightPx, pinHeightIn, cameraFovDeg: fovDeg, zoom: 1, slopeDeg: 0 });
  elements["pin-result"].textContent = `Simulation: expected ${expectedYards} yd; estimator returned ${formatPinDistance(result.horizontalDistanceYards)}.`;
}

function pinSetZoom(value) {
  const nextZoom = Number(value);
  const capabilities = state.pin.zoomCap;
  if (!state.pin.track || !Number.isFinite(nextZoom) || !capabilities?.zoom) return;
  const clamped = Math.min(capabilities.zoom.max, Math.max(capabilities.zoom.min, nextZoom));
  void state.pin.track.applyConstraints({ advanced: [{ zoom: clamped }] }).catch(() => {
    void state.pin.track.applyConstraints({ zoom: clamped }).catch(() => {});
  });
  elements["pin-zoom"].value = String(clamped);
  elements["pin-zoom-value"].textContent = `${clamped.toFixed(1)}x`;
  if (state.pin.lastResult) {
    pinUpdateResult();
  }
}

async function pinStartCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("No camera API available on this browser.", { error: true });
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const track = stream.getVideoTracks().at(0);
    if (!track) {
      throw new Error("Camera track is unavailable.");
    }

    state.pin.stream = stream;
    state.pin.track = track;
    state.pin.cameraOpen = true;
    state.pin.zoomCap = track.getCapabilities?.() ?? {};

    elements["pin-video"].srcObject = stream;
    elements["pin-video"].hidden = false;
    elements["pin-video"].removeAttribute("hidden");
    void elements["pin-video"].play().catch(() => {});
    elements["pin-guide"].hidden = false;
    elements["pin-badge"].hidden = false;
    elements["start-pin-camera"].hidden = true;
    elements["stop-pin-camera"].hidden = false;

    if (state.pin.zoomCap?.zoom && Number.isFinite(state.pin.zoomCap.zoom.min) && Number.isFinite(state.pin.zoomCap.zoom.max)) {
      elements["pin-zoom-wrap"].hidden = false;
      elements["pin-zoom"].min = String(state.pin.zoomCap.zoom.min);
      elements["pin-zoom"].max = String(state.pin.zoomCap.zoom.max);
      elements["pin-zoom"].step = String(state.pin.zoomCap.zoom.step ?? 0.1);
      const currentZoom = Number(state.pin.zoomCap.zoom?.max) > 1
        ? Number(state.pin.zoomCap.zoom.min ?? 1)
        : 1;
      pinSetZoom(currentZoom);
    } else {
      elements["pin-zoom-wrap"].hidden = true;
    }

    setStatus("Pin placement camera running.");
    elements["pin-result"].textContent = "Tap pin top then bottom to measure.";
    pinShowHint("Tap the pin top, then pin bottom.");
    pinClearMeasurement();
  } catch (error) {
    setStatus(`Unable to open camera: ${error.message}`, { error: true });
  }
}

function pinStopCamera() {
  if (state.pin.stream) {
    state.pin.stream.getTracks().forEach((track) => track.stop());
  }
  state.pin.track = null;
  state.pin.stream = null;
  state.pin.cameraOpen = false;
  elements["pin-video"].srcObject = null;
  elements["pin-video"].hidden = true;
  elements["pin-guide"].hidden = true;
  elements["pin-badge"].hidden = true;
  elements["start-pin-camera"].hidden = false;
  elements["stop-pin-camera"].hidden = true;
  elements["pin-zoom-wrap"].hidden = true;
  setStatus("Pin placement camera stopped.");
}

async function pinSaveMeasurement() {
  if (!state.round || !state.pin.lastResult) return;
  try {
    const event = createEvent({
      eventId: makeId("pin"),
      receivedAt: nowIso(),
      ageMs: 0,
      source: "pin-placement",
      breadcrumbs: state.round.breadcrumbs,
    });
    event.pin_placement = {
      ...state.pin.lastResult,
      measured_at: nowIso(),
    };
    state.round = addEvent(state.round, event);
    if (await persistRound()) {
      setStatus("Pin placement saved to active round.");
      renderActive();
    }
  } catch (error) {
    setStatus(`Unable to save pin placement: ${error.message}`, { error: true });
  }
}

function pinMeasureFromLastPoints() {
  pinUpdateResult();
}

function startTimer() {
  window.clearInterval(state.timerId);
  state.timerId = window.setInterval(() => {
    if (state.round) {
      elements.elapsed.textContent = formatDuration(state.round.started_at, state.round.ended_at ?? undefined);
    }
  }, 1000);
}

function stopTimer() {
  window.clearInterval(state.timerId);
  state.timerId = null;
}

function stopWatch() {
  if (state.watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.watchId);
  }
  state.watchId = null;
}

function locationErrorKind(error) {
  if (error.code === 1) return "permission-denied";
  if (error.code === 3) return "timeout";
  return "position-unavailable";
}

async function recordLocationError(error) {
  if (!state.round || state.round.ended_at) return;
  state.gpsState = locationErrorKind(error);
  state.lastError = error.message;
  if (state.gpsState === "permission-denied") {
    stopWatch();
  }
  state.round = openGap(state.round, {
    startedAt: nowIso(),
    reason: `gps-${state.gpsState}`,
  });
  await persistRound();
  setStatus(`GPS ${gpsLabel(state.gpsState).toLowerCase()}.`, { error: state.gpsState === "permission-denied" });
  renderActive();
}

async function recordPosition(position) {
  if (!state.round || state.round.ended_at || document.visibilityState !== "visible") return;
  const coords = position.coords;
  try {
    const timestamp = new Date(
      Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
    ).toISOString();
    const breadcrumb = {
      timestamp,
      lat: coords.latitude,
      lon: coords.longitude,
      accuracy_m: coords.accuracy,
      source: "browser",
    };
    state.round = addBreadcrumb(state.round, breadcrumb);
    state.round = closeGap(state.round, timestamp);
    state.gpsState = "watching";
    state.lastError = null;
    if (await persistRound()) {
      setStatus("GPS fix saved locally.");
      renderActive();
    }
  } catch (error) {
    setStatus(`GPS fix rejected: ${error.message}`, { error: true });
    renderActive();
  }
}

function startWatch() {
  stopWatch();
  if (!state.round || state.round.ended_at) return;
  if (!navigator.geolocation) {
    void recordLocationError({ code: 2, message: "Geolocation is unavailable in this browser." });
    return;
  }
  state.gpsState = "requesting";
  state.lastError = null;
  renderActive();
  try {
    state.watchId = navigator.geolocation.watchPosition(
      (position) => void recordPosition(position),
      (error) => void recordLocationError(error),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
  } catch (error) {
    void recordLocationError({ code: 2, message: error.message });
  }
}

async function startRound() {
  if (!state.storageReady) return;
  const existing = state.rounds.find((round) => !round.ended_at);
  if (existing) {
    await openRound(existing.round_id);
    return;
  }

  const startedAt = nowIso();
  state.round = createRound({ roundId: makeId("round"), startedAt });
  state.demoShotCount = 0;
  state.gpsState = "requesting";
  pinClearMeasurement();
  await persistRound();
  setView("active");
  startTimer();
  renderActive();
  startWatch();
}

async function openRound(roundId) {
  const round = await getRound(roundId);
  if (!round) {
    setStatus("That local round is no longer available.", { error: true });
    await refreshRounds();
    return;
  }
  state.round = round;
  state.demoShotCount = round.events.length;
  state.gpsState = round.ended_at ? "waiting" : "requesting";
  state.lastError = null;
  pinClearMeasurement();
  if (round.ended_at) {
    pinStopCamera();
    setView("review");
    renderReview();
    return;
  }
  setView("active");
  startTimer();
  renderActive();
  startWatch();
}

async function endRound() {
  if (!state.round || state.round.ended_at) return;
  stopWatch();
  stopTimer();
  pinStopCamera();
  state.round = finishRound(state.round, nowIso());
  state.gpsState = "waiting";
  await persistRound();
  setView("review");
  renderReview();
  setStatus("Round saved locally.");
}

async function addTestFix() {
  if (!state.round || state.round.ended_at) return;
  const index = state.round.breadcrumbs.length;
  const breadcrumb = {
    timestamp: nowIso(),
    lat: 32.335 + index * 0.0001,
    lon: -97.706 + index * 0.0001,
    accuracy_m: 8,
    source: "demo",
  };
  state.round = addBreadcrumb(state.round, breadcrumb);
  state.round = closeGap(state.round, breadcrumb.timestamp);
  state.gpsState = "watching";
  if (await persistRound()) {
    setStatus("Demo GPS fix saved locally.");
    renderActive();
  }
}

async function addTestShot() {
  if (!state.round || state.round.ended_at) return;
  const ageMs = state.demoShotCount === 0 ? 0 : 30_000;
  const event = createEvent({
    eventId: makeId("event"),
    receivedAt: nowIso(),
    ageMs,
    source: "demo",
    breadcrumbs: state.round.breadcrumbs,
  });
  state.round = addEvent(state.round, event);
  state.demoShotCount += 1;
  if (await persistRound()) {
    setStatus(`Demo event saved: ${event.location.status}.`);
    renderActive();
  }
}

async function handleVisibilityChange() {
  if (!state.round || state.round.ended_at) return;
  if (document.visibilityState === "hidden") {
    stopWatch();
    state.gpsState = "background-paused";
    state.round = openGap(state.round, { startedAt: nowIso(), reason: "page-hidden" });
    await persistRound();
    renderActive();
    return;
  }
  startWatch();
}

function downloadRound(round) {
  const payload = JSON.stringify(round, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `openround-${round.round_id}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus("Capture JSON exported. Nothing was uploaded.");
}

function handleRoundListClick(event) {
  const target = event.target.closest("button[data-action]");
  if (!target) return;
  void openRound(target.dataset.roundId);
}

async function init() {
  elements["demo-badge"].hidden = !demoMode;
  elements["start-round"].disabled = true;
  elements["stop-pin-camera"].hidden = true;
  elements["pin-badge"].hidden = true;
  elements["pin-zoom-wrap"].hidden = true;
  elements["pin-video"].hidden = true;
  elements["pin-measure"].disabled = true;
  elements["pin-save"].disabled = true;
  pinClearMeasurement();
  elements["round-list"].addEventListener("click", handleRoundListClick);
  elements["start-round"].addEventListener("click", () => void startRound());
  elements["retry-gps"].addEventListener("click", startWatch);
  elements["end-round"].addEventListener("click", () => void endRound());
  elements["add-test-fix"].addEventListener("click", () => void addTestFix());
  elements["add-test-shot"].addEventListener("click", () => void addTestShot());
  elements["export-active"].addEventListener("click", () => {
    if (state.round) downloadRound(state.round);
  });
  elements["export-review"].addEventListener("click", () => {
    if (state.round) downloadRound(state.round);
  });
  elements["start-pin-camera"].addEventListener("click", () => void pinStartCamera());
  elements["stop-pin-camera"].addEventListener("click", () => pinStopCamera());
  elements["pin-camera-frame"].addEventListener("click", pinHandleFrameTap);
  elements["pin-simulate"].addEventListener("click", pinRunSimulation);
  elements["pin-save"].addEventListener("click", () => void pinSaveMeasurement());
  elements["pin-clear"].addEventListener("click", () => pinClearMeasurement());
  elements["pin-zoom"].addEventListener("input", (event) => pinSetZoom(event.target.value));
  elements["pin-height-in"].addEventListener("change", pinMeasureFromLastPoints);
  elements["pin-slope-deg"].addEventListener("change", pinMeasureFromLastPoints);
  elements["pin-fov-deg"].addEventListener("change", pinMeasureFromLastPoints);
  elements["back-to-rounds"].addEventListener("click", async () => {
    pinStopCamera();
    stopTimer();
    setView("rounds");
    await refreshRounds();
  });
  document.addEventListener("visibilitychange", () => void handleVisibilityChange());

  try {
    await refreshRounds();
    setStatus(demoMode ? "Demo mode ready. Start a round to begin." : "Ready for a local round.");
  } catch (error) {
    elements["storage-state"].textContent = "Unavailable";
    setStatus(`OpenRound cannot start: ${error.message}`, { error: true });
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.mjs").catch((error) => {
      console.warn("OpenRound offline shell unavailable", error);
    });
  }
}

void init();
