import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function openField(page: Page, path = "/") {
  await page.goto(path);
  const startScreen = page.getByTestId("start-screen");
  if (await startScreen.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "DEMO ROUND" }).click();
  }
  await expect(page.getByTestId("openround-field")).toBeVisible();
}

async function openCourseSheetFromMenu(page: Page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "CHOOSE COURSE", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Choose course" })).toBeVisible();
}

async function expectSelectedCourseFromMenu(page: Page, expectedText: string) {
  await openCourseSheetFromMenu(page);
  await expect(page.locator(".course-current-card")).toContainText(expectedText, { timeout: 5_000 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

async function googleMapsKeyConfigured() {
  if (process.env.VITE_GOOGLE_MAPS_API_KEY) return true;
  const localEnv = await readFile(".env.local", "utf8").catch(() => "");
  return /^VITE_GOOGLE_MAPS_API_KEY=.+$/m.test(localEnv);
}

test("floating field navigation opens existing destinations without covering tracking", async ({ page }) => {
  await openField(page);

  const dock = page.getByRole("navigation", { name: "Primary app navigation" });
  await expect(dock).toBeVisible();
  await expect(dock.getByRole("button")).toHaveCount(4);
  await expect(dock.locator("span")).toHaveCount(0);
  await expect(page.getByTestId("field-nav-home")).toBeVisible();
  await expect(page.getByTestId("field-nav-round")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("field-nav-stats")).toBeVisible();
  await expect(page.getByTestId("field-nav-bag")).toBeVisible();
  await expect(page.getByTestId("at-my-ball")).toBeVisible();
  const homeBox = await page.getByTestId("field-nav-home").boundingBox();
  expect(homeBox?.height).toBeGreaterThanOrEqual(44);

  await page.getByTestId("field-nav-stats").click();
  await expect(page.getByRole("dialog", { name: /Hole 7 insights/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("field-nav-bag").click();
  await expect(page.getByRole("dialog", { name: "Manage 14-club bag" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("field-nav-home").click();
  await expect(page.getByTestId("start-screen")).toBeVisible();
});

test("recommendation header stays compact and leaves room for the map", async ({ page }) => {
  await openField(page);

  const hero = page.locator(".recommendation-hero");
  const greenDistances = page.locator(".green-distance-strip");
  const clubPanel = page.locator("button.club-panel");

  const heroBox = await hero.boundingBox();
  const greenDistancesBox = await greenDistances.boundingBox();
  const clubPanelBox = await clubPanel.boundingBox();

  expect(heroBox?.height).toBeLessThanOrEqual(68);
  expect(greenDistancesBox?.height).toBeLessThanOrEqual(32);
  expect(clubPanelBox?.height).toBeGreaterThanOrEqual(44);

  await clubPanel.click();
  await expect(page.getByRole("dialog", { name: /Club for \d+ yd/i })).toBeVisible();
});

test("on-course header shows hole context and switches adjacent holes", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  const header = page.getByRole("group", { name: "Hole navigation" });
  await expect(header).toContainText("HOLE 1");
  await expect(header).toContainText("PAR 4");
  await expect(page.getByRole("button", { name: "Previous hole" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next hole" })).toBeEnabled();
  const clubButton = page.getByRole("button", { name: /Current club Driver/i });
  await expect(clubButton).toHaveText("DR");

  await page.route("**/personal-squaw-valley-lakes-pending-v1/hole-2.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  const holeTwoGeometry = page.waitForResponse("**/personal-squaw-valley-lakes-pending-v1/hole-2.json");
  await page.getByRole("button", { name: "Next hole" }).click();
  await expect(header).toContainText("PAR —");
  await holeTwoGeometry;
  await expect(header).toContainText("HOLE 2");
  await expect(header).toContainText("PAR 5");
  await expect(page.getByRole("button", { name: "Previous hole" })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("openround:course-selection:v1") ?? "null"))).toEqual(expect.objectContaining({
    courseId: "personal-squaw-valley-lakes-pending-v1",
    holeNumber: 2,
  }));

  await page.getByRole("button", { name: "Previous hole" }).click();
  await expect(header).toContainText("HOLE 1");

  await page.evaluate(() => {
    const selection = JSON.parse(window.localStorage.getItem("openround:course-selection:v1") ?? "null");
    selection.holeNumber = 18;
    window.localStorage.setItem("openround:course-selection:v1", JSON.stringify(selection));
    const activeRound = JSON.parse(window.localStorage.getItem("openround:active-round:v1") ?? "null");
    activeRound.holeNumber = 18;
    window.localStorage.setItem("openround:active-round:v1", JSON.stringify(activeRound));
  });
  await page.reload();
  await expect(page.getByRole("group", { name: "Hole navigation" })).toContainText("HOLE 18");
  await expect(page.getByRole("button", { name: "Previous hole" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Next hole" })).toBeDisabled();

  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "DEMO ROUND" }).click();
  await expect(page.getByRole("group", { name: "Hole navigation" })).toContainText("HOLE 7");
  await expect(page.getByRole("button", { name: "Previous hole" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next hole" })).toBeDisabled();
  await page.getByRole("button", { name: /Current club Driver/i }).click();
  await expect(page.getByRole("dialog", { name: /Club for \d+ yd/i })).toBeVisible();
});

test("field screen removes the course header and keeps course selection in Menu", async ({ page }) => {
  await openField(page);

  await expect(page.locator(".round-strip")).toHaveCount(0);
  await expect(page.locator(".round-course-button")).toHaveCount(0);
  const mapBox = await page.locator(".course-map").boundingBox();
  expect(mapBox?.height).toBeGreaterThanOrEqual(436);

  await openCourseSheetFromMenu(page);
  await expect(page.getByRole("dialog", { name: "Choose course" })).toBeVisible();
});

test("start screen resumes a local round or opens a new round", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await expect(page.getByTestId("start-screen")).toBeVisible();
  await expect(page.getByTestId("start-empty-state")).toContainText("NO ROUND IN PROGRESS");
  await expect(page.getByRole("button", { name: "Choose course and hole" })).toHaveCount(0);

  await page.getByRole("button", { name: "DEMO ROUND" }).click();
  await expect(page.getByTestId("openround-field")).toBeVisible();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByTestId("active-round-card")).toContainText("DEMO COURSE");
  await page.getByRole("button", { name: "RESUME ROUND" }).click();
  await expect(page.getByTestId("openround-field")).toBeVisible();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "END ROUND" }).click();
  await page.getByRole("dialog", { name: "End current round" }).getByRole("button", { name: "END ROUND" }).click();
  await page.getByTestId("start-screen").getByRole("button", { name: "START ROUND" }).click();
  await expect(page.getByTestId("start-round-screen")).toBeVisible();
});

test("prototype variants use a dedicated start round screen", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  for (const variant of ["a", "b", "c"]) {
    await page.goto(`/?variant=${variant}`);
    await expect(page.getByTestId("start-screen")).toHaveAttribute("data-variant", variant);
    await expect(page.getByTestId("active-round-card")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "OpenRound destinations" }).getByRole("button")).toHaveCount(4);

    await page.getByTestId("start-screen").getByRole("button", { name: "START ROUND" }).click();
    await expect(page.getByTestId("start-round-screen")).toHaveAttribute("data-variant", variant);
    await expect(page.getByRole("dialog", { name: "Choose course" })).toHaveCount(0);

    await page.getByRole("button", { name: "Back to start" }).click();
    await expect(page.getByTestId("start-screen")).toHaveAttribute("data-variant", variant);
  }

  await page.goto("/?variant=a");
  await expect(page.getByTestId("start-screen")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("start-screen")).toHaveAttribute("data-variant", "b");
  await expect(page).toHaveURL(/variant=b/);
  await page.getByRole("button", { name: "Next prototype variant" }).click();
  await expect(page.getByTestId("start-screen")).toHaveAttribute("data-variant", "c");
});

test("variant C uses course-specific tee boxes", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/?variant=c");
  await page.getByTestId("start-screen").getByRole("button", { name: "START ROUND" }).click();

  const teePicker = page.getByTestId("start-round-screen").getByRole("group", { name: "Tee box" });
  await expect(teePicker).toHaveAttribute("data-tee-source", "course");
  await expect(teePicker.getByRole("button")).toHaveCount(5);
  await expect(teePicker.getByRole("button", { name: "GOLD 7,000 YD" })).toBeVisible();
  await expect(teePicker.getByRole("button", { name: "BLACK 5,597 YD" })).toBeVisible();
  await teePicker.getByRole("button", { name: "BLACK 5,597 YD" }).click();
  await expect(teePicker.getByRole("button", { name: "BLACK 5,597 YD" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "START HOLE" })).toHaveCount(0);

  const roundOptions = page.getByRole("group", { name: "Round options" });
  const handicapScoring = roundOptions.getByRole("button", { name: /HANDICAP INDEX SCORING/ });
  const addGolfers = roundOptions.getByRole("button", { name: /ADD GOLFERS FOR SCORING/ });
  await expect(handicapScoring).toBeDisabled();
  await expect(handicapScoring).toContainText("GROSS SCORES ONLY · NOT CONNECTED");
  await expect(addGolfers).toHaveAttribute("aria-expanded", "false");
  await addGolfers.click();
  await expect(page.getByRole("dialog", { name: "Add golfers" })).toBeVisible();
  await page.getByRole("textbox", { name: "Golfer name" }).fill("Avery");
  await page.getByRole("button", { name: "ADD GOLFER", exact: true }).click();
  const golfersSheet = page.getByRole("dialog", { name: "Add golfers" });
  await expect(golfersSheet.getByText("Avery", { exact: true })).toBeVisible();
  await golfersSheet.getByRole("button", { name: "Remove Avery" }).click();
  await expect(golfersSheet.getByText("Avery", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "CHANGE COURSE" }).click();
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Egyptian Country Club");
  const egyptian = page.getByRole("button", { name: /Egyptian Country Club Mounds, IL/ });
  await egyptian.click();
  if (await page.getByRole("button", { name: "CONFIRM COURSE" }).count() === 0) await egyptian.click();
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  await expect(teePicker).toHaveAttribute("data-tee-source", "manual");
  await expect(teePicker.getByRole("button")).toHaveCount(3);
  await expect(teePicker.getByRole("button", { name: "BLUE MANUAL" })).toHaveAttribute("aria-pressed", "true");
});

test("main menu exposes round controls and app destinations", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/?variant=a");

  await expect(page.getByRole("button", { name: "START ROUND" })).toBeVisible();
  await expect(page.getByRole("button", { name: "RESUME ROUND" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "END ROUND" })).toHaveCount(0);

  await page.getByRole("button", { name: "ROUNDS" }).click();
  await expect(page.getByTestId("main-menu-detail")).toContainText("ROUND HISTORY");
  await page.getByRole("button", { name: "Back to main menu" }).click();

  await page.getByRole("button", { name: "STATISTICS" }).click();
  await expect(page.getByTestId("main-menu-detail")).toContainText("LOCAL ROUND STATISTICS");
  await expect(page.getByTestId("main-menu-stat-strokes")).toHaveText("0");
  await expect(page.getByRole("dialog", { name: /Hole 1 insights/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to main menu" }).click();

  await page.getByRole("button", { name: "EQUIPMENT" }).click();
  await expect(page.getByRole("dialog", { name: "Manage 14-club bag" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "HANDICAP INDEX" }).click();
  await expect(page.getByTestId("main-menu-detail")).toContainText("LOCAL HANDICAP");
  await page.getByRole("button", { name: "Back to main menu" }).click();

  await page.getByRole("button", { name: "DEMO ROUND" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("button", { name: "RESUME ROUND" })).toBeVisible();
  await page.getByRole("button", { name: "END ROUND" }).click();
  await expect(page.getByRole("dialog", { name: "End current round" })).toBeVisible();
  await page.getByRole("button", { name: "END ROUND", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "START ROUND" })).toBeVisible();
  await expect(page.getByRole("button", { name: "END ROUND" })).toHaveCount(0);
});

test("restores a manually placed demo shot without GPS evidence", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    const courseId = "openround-demo-course-v1";
    const updatedAt = "2026-09-01T12:00:00.000Z";
    window.localStorage.setItem("openround:start-view:v1", "field");
    window.localStorage.setItem("openround:active-round:v1", JSON.stringify({
      version: 1,
      courseId,
      courseName: "DEMO COURSE",
      layoutLabel: "DEMO FIXTURE",
      holeNumber: 7,
      teeBox: "white",
      status: "tracking",
      updatedAt,
    }));
    window.localStorage.setItem("openround:round-session:v1", JSON.stringify({
      version: 1,
      roundId: `${courseId}:7`,
      courseId,
      holeNumber: 7,
      score: 4,
      lockedShots: [{
        id: 1,
        number: 1,
        club: "DRIVER",
        totalGps: 201,
        start: { lat: 36.578125, lon: -121.95741 },
        end: { lat: 36.579772, lon: -121.95741 },
        evidence: "demo_manual",
        provenance: "prototype_fixture",
        reviewed: false,
        clubProfileId: "driver",
        caddyAim: null,
        plannedAim: null,
        realPlannedAim: null,
      }],
      manualEntries: [],
    }));
  });

  await page.goto("/");

  await expect(page.getByTestId("openround-field")).toBeVisible();
  await expect(page.locator(".completed-shot-card")).toContainText("SHOT 2 · 7 IRON");
  await expect(page.locator(".completed-shot-card")).toContainText("DEMO MANUAL · TRACKING");
  await expect(page.locator(".completed-shot-card")).not.toContainText("TOTAL GPS");
  await expect(page.locator(".tracking-strip")).toContainText("TRACKING 7 IRON");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("openround:club-statistics:v1"))).toBeNull();
  const storedRoundLog = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openround:round-log:v1") ?? "null"));
  expect(storedRoundLog?.events ?? []).toHaveLength(0);
});

test("fresh app defaults to Squaw Valley Golf Course Lakes hole 1", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await expect(page.getByTestId("active-round-card")).toHaveCount(0);
  await page.getByTestId("start-screen").getByRole("button", { name: "START ROUND" }).click();

  const currentCourse = page.locator(".course-current-card");
  await expect(currentCourse).toContainText("Squaw Valley Golf Course · Lakes");
  await expect(currentCourse).toContainText("HOLE 1");
});

test("fresh round presents Driver as the tee-shot club and exposes the full bag", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "DEMO ROUND" }).click();
  await expect(page.getByTestId("openround-field")).toBeVisible();

  const clubPanel = page.locator("button.club-panel");
  await expect(clubPanel).toHaveText("DR");
  await expect(clubPanel).toHaveAttribute("aria-label", /current club Driver.*tee shot is not locked/i);

  await clubPanel.click();
  const sheet = page.getByRole("dialog", { name: /Club for \d+ yd/i });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("club-selector-concept-3")).toBeVisible();
  await page.waitForTimeout(600);
  const ladder = sheet.locator(".club-distance-ladder-scroll");
  const ruler = sheet.getByTestId("club-distance-ruler");
  await expect(ruler).toBeVisible();
  await expect(ladder).toHaveCSS("overflow-y", "auto");
  await expect(ladder).toHaveCSS("touch-action", "pan-y");
  await expect(ladder.locator(".club-ladder-option")).toHaveCount(13);

  const initialScroll = await ladder.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
  expect(initialScroll.scrollHeight).toBeGreaterThan(initialScroll.clientHeight);

  const ladderBox = await ladder.boundingBox();
  const caddyRow = ladder.locator(".club-ladder-option[data-caddy='true']");
  const caddyTick = caddyRow.locator(".club-ladder-ruler-tick");
  const targetMarker = sheet.getByTestId("club-distance-target");
  await expect(targetMarker).toHaveCSS("z-index", "7");
  await expect(targetMarker).toHaveCSS("pointer-events", "none");
  const sixIronRow = ladder.locator('[data-club-id="6i"]');
  const sevenIronRow = ladder.locator('[data-club-id="7i"]');
  const caddyBox = await caddyRow.boundingBox();
  expect(ladderBox).not.toBeNull();
  expect(caddyBox).not.toBeNull();
  await expect(caddyTick).toHaveAttribute("data-yards", /\d+/);
  expect(caddyBox!.y - ladderBox!.y).toBeGreaterThanOrEqual(72);
  expect(caddyBox!.y - ladderBox!.y).toBeLessThanOrEqual(96);

  await sheet.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
  const sheetBoxBeforeScroll = (await sheet.boundingBox())!;
  const evidenceBoxBeforeScroll = (await sheet.locator(".club-evidence-card").boundingBox())!;
  const rulerBoxBeforeScroll = (await ruler.boundingBox())!;
  const caddyRowBoxBeforeScroll = (await caddyRow.boundingBox())!;
  const caddyTickBoxBeforeScroll = (await caddyTick.boundingBox())!;
  const targetBoxBeforeScroll = (await targetMarker.boundingBox())!;
  const sixIronBoxBeforeScroll = (await sixIronRow.boundingBox())!;
  const sevenIronBoxBeforeScroll = (await sevenIronRow.boundingBox())!;
  const evidenceOffsetY = evidenceBoxBeforeScroll.y - sheetBoxBeforeScroll.y;
  const rulerOffsetY = rulerBoxBeforeScroll.y - sheetBoxBeforeScroll.y;
  const tickToRowOffsetY = caddyTickBoxBeforeScroll.y - caddyRowBoxBeforeScroll.y;
  const targetCenterBeforeScroll = targetBoxBeforeScroll.y + targetBoxBeforeScroll.height / 2;
  const sixIronCenterBeforeScroll = sixIronBoxBeforeScroll.y + sixIronBoxBeforeScroll.height / 2;
  const sevenIronCenterBeforeScroll = sevenIronBoxBeforeScroll.y + sevenIronBoxBeforeScroll.height / 2;
  expect(targetCenterBeforeScroll).toBeGreaterThan(sixIronCenterBeforeScroll);
  expect(targetCenterBeforeScroll).toBeLessThan(sevenIronCenterBeforeScroll);
  expect(Math.abs(targetCenterBeforeScroll - (sixIronCenterBeforeScroll + (5 / 12) * (sevenIronCenterBeforeScroll - sixIronCenterBeforeScroll)))).toBeLessThan(1);
  await ladder.evaluate((element) => element.scrollTo({ top: element.scrollHeight, behavior: "instant" }));
  await expect.poll(() => ladder.evaluate((element) => element.scrollTop)).toBeGreaterThan(initialScroll.scrollTop);
  await expect(ladder).toHaveAttribute("data-scroll-edge", "bottom");
  const sheetBoxAfterScroll = (await sheet.boundingBox())!;
  const evidenceBoxAfterScroll = (await sheet.locator(".club-evidence-card").boundingBox())!;
  const rulerBoxAfterScroll = (await ruler.boundingBox())!;
  const caddyRowBoxAfterScroll = (await caddyRow.boundingBox())!;
  const caddyTickBoxAfterScroll = (await caddyTick.boundingBox())!;
  const targetBoxAfterScroll = (await targetMarker.boundingBox())!;
  expect(Math.abs((evidenceBoxAfterScroll.y - sheetBoxAfterScroll.y) - evidenceOffsetY)).toBeLessThan(1);
  expect(Math.abs((rulerBoxAfterScroll.y - sheetBoxAfterScroll.y) - rulerOffsetY)).toBeLessThan(1);
  expect(Math.abs((caddyTickBoxAfterScroll.y - caddyRowBoxAfterScroll.y) - tickToRowOffsetY)).toBeLessThan(1);
  const rowScrollDelta = caddyRowBoxAfterScroll.y - caddyRowBoxBeforeScroll.y;
  const targetScrollDelta = targetBoxAfterScroll.y - targetBoxBeforeScroll.y;
  expect(Math.abs(targetScrollDelta - rowScrollDelta)).toBeLessThan(1);
  await expect(sheet.locator(".club-evidence-card")).toHaveAttribute("aria-label", "Driver True Distance evidence");
  await expect(sheet.getByTestId("club-true-distance")).toHaveText("246");

  const lobWedge = ladder.locator('[data-club-id="lw"]');
  const lobWedgeBox = (await lobWedge.boundingBox())!;
  const endGeometry = await ladder.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      paddingTop: Number.parseFloat(style.paddingTop),
      paddingBottom: Number.parseFloat(style.paddingBottom),
      viewportBottom: element.getBoundingClientRect().bottom,
      fadeZIndex: Number.parseFloat(getComputedStyle(element.parentElement!, "::after").zIndex),
    };
  });
  expect(endGeometry.paddingTop).toBe(96);
  expect(endGeometry.paddingBottom).toBe(96);
  expect(Math.abs(endGeometry.viewportBottom - (lobWedgeBox.y + lobWedgeBox.height) - 96)).toBeLessThan(1);
  await expect(lobWedge).toHaveCSS("opacity", "1");
  const restingZIndex = Number.parseFloat(await lobWedge.evaluate((element) => getComputedStyle(element).zIndex));
  expect(restingZIndex).toBeGreaterThan(endGeometry.fadeZIndex);
  await lobWedge.click();
  await expect(lobWedge).toHaveAttribute("data-preview", "true");
  await expect(lobWedge).toHaveCSS("opacity", "1");
  await expect(page.getByTestId("mobile-cursor")).toHaveCount(0);
  const selectedZIndex = Number.parseFloat(await lobWedge.evaluate((element) => getComputedStyle(element).zIndex));
  expect(selectedZIndex).toBeGreaterThan(endGeometry.fadeZIndex);

  await sheet.getByRole("button", { name: /Preview 3 Wood/i }).click();
  await expect(sheet.getByRole("button", { name: "USE 3 WOOD" })).toBeVisible();
  await sheet.getByRole("button", { name: "USE 3 WOOD" }).click();
  await expect(clubPanel).toHaveText("3W");
  await expect(page.locator(".club-metrics")).toHaveCount(0);

  await page.getByTestId("at-my-ball").click();
  await expect(page.locator(".field-notice")).toHaveCount(0);
  await expect(page.getByText("TRACKING 7 IRON")).toBeVisible();
  await expect(clubPanel).toHaveText("7I");
  await expect(page.locator(".club-metrics")).toHaveCount(0);
});

test("concept 3 previews True Distance evidence before applying a club", async ({ page }) => {
  await openField(page);
  await page.getByTestId("at-my-ball").click();

  const clubPanel = page.locator("button.club-panel");
  await expect(clubPanel).toHaveText("7I");
  await clubPanel.click();

  const sheet = page.getByRole("dialog", { name: "Club for 161 yd" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".club-evidence-card > header")).toHaveCount(0);
  await expect(sheet.locator(".club-selector-header > strong")).toHaveCSS("font-size", "22px");
  await expect(sheet.getByTestId("club-distance-ruler")).toBeVisible();
  await expect(sheet.getByTestId("club-distance-target")).toHaveText("161 YD");
  await expect(sheet.getByTestId("club-distance-caddy-pointer")).toHaveAttribute("data-yards", "166");
  await expect(sheet.locator(".club-ladder-ruler-tick")).toHaveCount(13);
  for (const wedgeCode of ["PW", "GW", "SW", "LW"]) {
    await expect(sheet.locator(".club-ladder-name > strong", { hasText: new RegExp("^" + wedgeCode + "$") })).toHaveCount(1);
  }
  for (const wedgeCode of ["pw", "gw", "sw", "lw"]) {
    await expect(sheet.locator(".club-ladder-name > strong", { hasText: new RegExp("^" + wedgeCode + "$") })).toHaveCount(0);
  }
  await expect(sheet.locator(".club-ladder-option[data-caddy='true']")).toContainText("6i");
  await expect(sheet.locator(".club-evidence-card")).toHaveAttribute("aria-label", "6 Iron True Distance evidence");
  await expect(sheet.getByTestId("club-true-distance")).toHaveText("166");
  await expect(sheet.getByTestId("club-evidence-summary")).toContainText("9 USED");
  await expect(sheet.getByTestId("club-evidence-summary")).toContainText("1 OUTLIER");
  await expect(sheet.locator(".club-sample[data-included='false']")).toContainText("181");

  await sheet.getByRole("button", { name: /Preview 5 Iron/i }).click();
  await expect(sheet.locator(".club-evidence-card")).toHaveAttribute("aria-label", "5 Iron True Distance evidence");
  await expect(sheet.locator(".club-evidence-metrics")).toContainText("178");
  await expect(sheet.locator(".club-evidence-metrics")).toContainText("188");
  await expect(clubPanel).toContainText("7");
  await expect(sheet.getByRole("button", { name: "USE 5 IRON" })).toBeVisible();
  await sheet.getByRole("button", { name: "USE 5 IRON" }).click();

  await expect(sheet).toBeHidden();
  await expect(clubPanel).toContainText("5");
  await expect(page.locator(".club-metrics")).toHaveCount(0);

  await clubPanel.click();
  await page.getByTestId("view-full-bag-from-club").click();
  await expect(page.getByRole("dialog", { name: "Manage 14-club bag" })).toBeVisible();
});

test("concept 3 double-click applies a club while one click remains preview-only", async ({ page }) => {
  await openField(page);
  await page.getByTestId("at-my-ball").click();

  const clubPanel = page.locator("button.club-panel");
  await clubPanel.click();
  const sheet = page.getByRole("dialog", { name: "Club for 161 yd" });

  await sheet.getByRole("button", { name: /Preview 5 Iron/i }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".club-evidence-card")).toHaveAttribute("aria-label", "5 Iron True Distance evidence");
  await expect(clubPanel).toContainText("7");

  await sheet.getByRole("button", { name: /Preview 6 Iron/i }).dblclick();
  await expect(sheet).toBeHidden();
  await expect(clubPanel).toHaveText("6I");
  await expect(page.getByText("TRACKING 6 IRON")).toBeVisible();
  await expect(page.locator(".club-metrics")).toHaveCount(0);
});

test("malformed active-round state fails closed to the empty start screen", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("openround:active-round:v1", JSON.stringify({ version: 99, courseName: "not valid" }));
    window.localStorage.removeItem("openround:start-view:v1");
  });
  await page.goto("/");
  await expect(page.getByTestId("start-screen")).toBeVisible();
  await expect(page.getByTestId("start-empty-state")).toContainText("NO ROUND IN PROGRESS");
  await expect(page.getByTestId("active-round-card")).toHaveCount(0);
});

test("course discovery confirms a real course and loads its pinned geometry snapshot", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);

  const search = page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" });
  await expect(search).toBeVisible();
  await search.fill("Pinehurst Resort Country Club No 2");

  const result = page.getByRole("button", { name: "Pinehurst Resort Country Club No 2 Pinehurst, NC 14H" });
  await expect(result).toBeVisible();
  await result.click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  await expectSelectedCourseFromMenu(page, "Pinehurst Resort Country Club No 2");
  await expect(page.locator(".real-course-advice")).toHaveCount(0);
  await expect(page.locator(".real-geometry-bunker").first()).toBeVisible();
  await expect(page.locator(".real-hazard-distance")).toHaveCount(0);
  await page.locator(".real-geometry-bunker").first().dispatchEvent("click");
  await expect(page.locator(".real-hazard-distance")).toHaveCount(1);
  await expect(page.locator(".real-hazard-distance")).toContainText(/BUNKER · \d+ TO/);
  await expect(page.locator(".real-hazard-leader")).toHaveCount(1);
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "PIN THE FLAG" })).toBeVisible();
  await expect(page.locator(".course-map")).toHaveAttribute("data-rendered-scale", "6.40");
  await page.getByRole("button", { name: "Cancel pin placement" }).click();

  await page.reload();
  await expectSelectedCourseFromMenu(page, "Pinehurst Resort Country Club No 2");
  await expect(page.locator(".real-course-advice")).toHaveCount(0);
});

test("course discovery prioritizes city and state matches", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);

  const search = page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" });
  await search.fill("glen rose, tx");

  const results = page.locator(".course-result");
  await expect(results.first()).toContainText("Squaw Valley Golf Course · Lakes");
  await expect(results.nth(1)).toContainText("Squaw Valley Golf Course · Links");
});

test("stale persisted course selections require reconfirmation after a catalog update", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("openround:course-selection:v1", JSON.stringify({
      version: 1,
      courseId: "0e1e596d-8e86-4ff8-90e9-6a439a0ba271",
      holeNumber: 1,
      sourceVersion: "v1.0.0",
      confirmedAt: "2026-08-28T00:00:00.000Z",
    }));
  });
  await page.goto("/");
  await page.getByTestId("start-screen").getByRole("button", { name: "START ROUND" }).click();
  await page.getByRole("button", { name: "CHANGE COURSE" }).click();
  await expect(page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" })).toBeVisible();
  await expect(page.locator(".field-notice")).toHaveCount(0);
});

test("near-me discovery ranks the catalog by the phone GPS fix", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 37.142398, longitude: -89.1890226, accuracy: 4 });
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("button", { name: "NEAR ME" }).click();

  const nearest = page.getByRole("button", { name: /Egyptian Country Club Mounds, IL/ }).first();
  await expect(nearest).toBeVisible({ timeout: 5_000 });
  await expect(nearest).toContainText("Egyptian Country Club");
});

test("near-me discovery fails closed when phone location is unavailable", async ({ page, context }) => {
  await context.clearPermissions();
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("button", { name: "NEAR ME" }).click();

  await expect(page.getByText("PHONE GPS REQUIRED")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/Location permission or a fresh fix is unavailable/)).toBeVisible();
  await expect(page.getByText("NO MATCHING COURSES")).toBeVisible();
});

test("round setup persists locally and starts the driver leg from a fresh GPS fix", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 32.25769, longitude: -97.72271, accuracy: 4 });
  await openField(page);
  await openCourseSheetFromMenu(page);

  const search = page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" });
  await search.fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();

  await expect(page.getByTestId("round-setup")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "START HOLE" })).toHaveValue("1");
  await page.getByRole("button", { name: "WHITE STANDARD" }).click();
  await page.getByRole("button", { name: "Start on hole 3" }).click();
  await page.getByRole("button", { name: "Tournament mode" }).click();
  await page.getByRole("button", { name: "START ROUND" }).click();

  await expectSelectedCourseFromMenu(page, "HOLE 3 · WHITE TEE");
  await expect(page.getByTestId("openround-field").getByText("TRACKING DRIVER")).toBeVisible();
  await expect(page.locator(".field-notice")).toHaveCount(0);

  await page.reload();
  await expectSelectedCourseFromMenu(page, "HOLE 3 · WHITE TEE");
});

test("no-key imagery reports the active USGS fallback truthfully", async ({ page }) => {
  test.skip(await googleMapsKeyConfigured(), "Google satellite is configured");
  await openField(page);
  const provider = page.locator(".satellite-layer");
  await expect(provider).toHaveAttribute("data-provider", "usgs");
  await expect(page.getByText(/USGS READY/)).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByText("Course & app details", { exact: true }).click();
  await expect(page.getByText("SATELLITE PREVIEW")).toBeVisible();
  await expect(page.getByText(/Live USGS \/ USDA NAIP imagery is shown here/)).toBeVisible();
});

test("satellite imagery covers every viewport corner on rotated holes", async ({ page }) => {
  await page.route("https://tile.googleapis.com/v1/createSession?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ session: "openround-test-session" }),
  }));
  await page.route("https://tile.googleapis.com/v1/2dtiles/**", (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="green"/></svg>',
  }));
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("4");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();
  await expect(page.locator(".satellite-layer")).toHaveCSS("overflow", "visible");
  await expect(page.locator(".course-map")).toHaveCSS("overflow", "hidden");

  for (const action of [null, "Show full hole", "Next hole"]) {
    if (action) await page.getByRole("button", { name: action, exact: true }).click();
    await expect.poll(() => page.locator(".course-map").evaluate((map) => {
      const world = map.querySelector<HTMLElement>(".map-world")!;
      const layer = map.querySelector<HTMLElement>(".satellite-layer")!;
      const inverse = new DOMMatrix(getComputedStyle(world).transform).inverse();
      const images = [...layer.querySelectorAll<HTMLImageElement>(
        layer.dataset.provider === "usgs" ? ".satellite-viewport-export" : ".satellite-tile",
      )];
      return [[1, 1], [map.clientWidth - 1, 1], [1, map.clientHeight - 1], [map.clientWidth - 1, map.clientHeight - 1]].every(([x, y]) => {
        const point = inverse.transformPoint({ x: x - world.clientWidth / 2, y: y - world.clientHeight / 2 });
        point.x += world.clientWidth / 2;
        point.y += world.clientHeight / 2;
        return images.some((image) => point.x >= parseFloat(image.style.left)
          && point.x <= parseFloat(image.style.left) + parseFloat(image.style.width)
          && point.y >= parseFloat(image.style.top)
          && point.y <= parseFloat(image.style.top) + parseFloat(image.style.height));
      });
    })).toBe(true);
  }
});

test("Google satellite uses native Cup Focus detail tiles", async ({ page }) => {
  test.skip(!(await googleMapsKeyConfigured()), "Requires a configured Google key");
  const tileRequests: string[] = [];
  const transparentPixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAFAgI/6f8nWQAAAABJRU5ErkJggg==",
    "base64",
  );

  await page.route("https://tile.googleapis.com/v1/createSession?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ session: "openround-test-session" }),
  }));
  await page.route("https://tile.googleapis.com/v1/2dtiles/**", (route) => {
    tileRequests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/png", body: transparentPixel });
  });

  await openField(page);
  await expect(page.locator(".satellite-layer")).toHaveAttribute("data-provider", "google");
  await expect(page.locator(".satellite-layer")).toHaveAttribute("data-tile-zoom", "16");
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();
  await page.getByRole("button", { name: "Place ball" }).click();
  await page.getByRole("button", { name: "Place ball" }).click();

  const detailZoom = Number(await page.locator(".satellite-layer").getAttribute("data-tile-zoom"));
  expect(detailZoom).toBeGreaterThanOrEqual(20);
  await expect.poll(() => tileRequests.some((url) => url.includes(`/2dtiles/${detailZoom}/`))).toBe(true);
});

test("rangefinder keeps both route distances visible at glance scale", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);

  const search = page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" });
  await search.fill("Squaw Valley Golf Course Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  const map = page.locator(".course-map");
  await expect(map).toHaveAttribute("data-map-detail", "false");
  const aimDistance = page.getByTestId("real-plan-aim-distance");
  const pinDistance = page.getByTestId("real-plan-pin-distance");
  await expect(aimDistance).toHaveText(/^\d+$/);
  await expect(pinDistance).toHaveText(/^\d+$/);
  await expect(aimDistance).toHaveAttribute("transform", /matrix\(/);
  await expect(pinDistance).toHaveAttribute("transform", /matrix\(/);
  await expect(aimDistance.locator("rect")).toHaveCount(0);
  await expect(pinDistance.locator("rect")).toHaveCount(0);
  await expect(aimDistance.locator("text")).toHaveCSS("fill", "rgb(255, 255, 255)");
  await expect(aimDistance.locator("text")).toHaveCSS("stroke", "rgb(4, 8, 11)");
});

test("secondary distance hides when the aim point is on the green", async ({ page }) => {
  await openField(page, "/?rangefinder-prototype=split-labels");
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  await page.getByRole("button", { name: "Place ball" }).click();
  const aim = page.getByTestId("aim-point");
  const aerial = page.locator(".satellite-viewport-export");
  const aerialBeforeDrag = await aerial.getAttribute("src");
  if (!aerialBeforeDrag) throw new Error("Course aim drag did not expose aerial imagery");
  const aimBox = await aim.boundingBox();
  if (!aimBox) throw new Error("Mapped aim did not expose a hit target");
  const aimCenter = { x: aimBox.x + aimBox.width / 2, y: aimBox.y + aimBox.height / 2 };

  await aim.dispatchEvent("pointerdown", {
    pointerId: 1,
    button: 0,
    clientX: aimCenter.x,
    clientY: aimCenter.y,
  });
  await aim.dispatchEvent("pointermove", { pointerId: 1, button: 0, clientX: aimCenter.x + 4, clientY: aimCenter.y });
  await aim.dispatchEvent("pointerup", { pointerId: 1, button: 0, clientX: aimCenter.x + 4, clientY: aimCenter.y });

  await expect(aerial).toHaveAttribute("src", aerialBeforeDrag);
  await expect(aim).toHaveAttribute("aria-valuetext", /[1-9]\d* yards from aim to pin/);
  await expect(page.locator(".real-plan-pin-route")).toBeVisible();
  await expect(page.getByTestId("real-plan-pin-distance")).toHaveCount(0);
  await expect(page.getByTestId("real-plan-aim-distance")).toHaveText(/^\d+$/);
});

test("field screen gives removed caddy sections back to the map", async ({ page }) => {
  await openField(page);

  await expect(page.locator(".caddy-advice")).toHaveCount(0);
  await expect(page.locator(".condition-strip")).toHaveCount(0);
  await expect(page.locator(".club-metrics")).toHaveCount(0);
  const mapBox = await page.locator(".course-map").boundingBox();
  const trackingBox = await page.locator(".tracking-strip").boundingBox();
  expect(mapBox?.height).toBeGreaterThanOrEqual(470);
  if (!mapBox || !trackingBox) throw new Error("Field map and tracking strip did not expose layout bounds");
  expect(Math.abs(trackingBox.y - (mapBox.y + mapBox.height))).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByTestId("menu-conditions").click();
  await expect(page.getByTestId("conditions-sheet")).toBeVisible();
});

test("playing conditions update the deterministic target range", async ({ page }) => {
  await openField(page);
  await expect(page.getByTestId("aim-distance")).toHaveText("161");

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByTestId("menu-conditions").click();
  const conditions = page.getByTestId("conditions-sheet");
  await expect(conditions).toContainText("8 mph crosswind");
  await expect(conditions).toContainText("ELEVATION ADJUSTMENT · +2 YD");
  await page.getByRole("button", { name: "HEADWIND", exact: true }).click();
  await expect(conditions).toContainText("8 mph headwind");
  await expect(page.getByTestId("aim-distance")).toHaveText("165");

  await page.getByRole("slider", { name: "Elevation adjustment" }).press("ArrowRight");
  await expect(conditions).toContainText("ELEVATION ADJUSTMENT · +3 YD");
  await expect(page.getByTestId("aim-distance")).toHaveText("166");
});

test("map caddy quick switch cycles deterministic strategy without a sheet", async ({ page }) => {
  await openField(page);
  await expect(page.locator(".club-change-cue")).toHaveCount(0);
  const strategyButton = page.getByTestId("caddy-strategy-button");
  await expect(strategyButton).toContainText("STD");
  await expect(strategyButton).toHaveAttribute("aria-label", /Current setting standard.*Next setting aggressive/i);
  await expect(strategyButton).toHaveAttribute("data-strategy", "standard");
  await expect(page.locator(".map-actions").getByTestId("caddy-strategy-button")).toHaveCount(1);
  await expect(page.locator(".map-actions .map-action").last()).toHaveAttribute("data-testid", "caddy-strategy-button");
  await expect(page.locator(".map-actions .map-action")).toHaveCount(6);
  const mapActionShapes = await page.locator(".map-actions .map-action").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        radius: Number.parseFloat(getComputedStyle(element).borderRadius),
        shorterSide: Math.min(rect.width, rect.height),
      };
    }),
  );
  for (const shape of mapActionShapes) {
    expect(shape.radius).toBeGreaterThanOrEqual(shape.shorterSide / 2);
  }
  await expect(page.locator(".round-strip")).toHaveCount(0);
  await expect(page.getByTestId("aim-distance")).toHaveText("161");

  await strategyButton.click();
  await expect(strategyButton).toContainText("AGG");
  await expect(strategyButton).toHaveAttribute("data-strategy", "aggressive");
  await expect(page.getByTestId("aim-distance")).toHaveText("167");
  await expect(page.getByTestId("caddy-strategy-sheet")).toHaveCount(0);

  await strategyButton.click();
  await expect(strategyButton).toContainText("SAFE");
  await expect(strategyButton).toHaveAttribute("data-strategy", "safe");
  await expect(page.getByTestId("aim-distance")).toHaveText("155");

  await strategyButton.click();
  await expect(strategyButton).toContainText("STD");
  await expect(strategyButton).toHaveAttribute("data-strategy", "standard");
  await expect(page.getByTestId("aim-distance")).toHaveText("161");
  const demoAimFace = page.locator(".aim-point-face");
  await expect(demoAimFace).toBeVisible();
  const demoAimShape = await demoAimFace.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
      dot: Boolean(element.querySelector(".aim-point-center-dot")),
    };
  });
  expect(demoAimShape.width).toBeGreaterThan(40);
  expect(demoAimShape.height).toBeGreaterThan(60);
  expect(demoAimShape.dot).toBe(true);
  const demoDispersionShape = await page.locator(".dispersion-window").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
    };
  });
  expect(demoAimShape.width).toBeCloseTo(demoDispersionShape.width, 3);
  expect(demoAimShape.height).toBeCloseTo(demoDispersionShape.height, 3);

  await page.setViewportSize({ width: 800, height: 667 });
  const shortMapBox = await page.locator(".course-map").boundingBox();
  const shortActions = await page.locator(".map-actions .map-action").all();
  const firstActionBox = await shortActions[0]?.boundingBox();
  const lastActionBox = await shortActions.at(-1)?.boundingBox();
  if (!shortMapBox || !firstActionBox || !lastActionBox) throw new Error("Short map actions did not expose layout bounds");
  expect(firstActionBox.y).toBeGreaterThanOrEqual(shortMapBox.y);
  expect(lastActionBox.y + lastActionBox.height).toBeLessThanOrEqual(shortMapBox.y + shortMapBox.height);
});

test("manual shot and penalty entries can be removed or undone", async ({ page }) => {
  await openField(page);
  const addShot = page.getByRole("button", { name: "+ Shot" });

  await addShot.click();
  const addSheet = page.getByTestId("bottom-sheet");
  await addSheet.locator(".manual-entry-button").filter({ hasText: "MISSED TRACKED SHOT" }).click();
  await addShot.click();
  await page.getByTestId("bottom-sheet").locator(".manual-entry-button").filter({ hasText: "PENALTY STROKE" }).click();

  await addShot.click();
  const history = page.getByTestId("manual-entry-history");
  await expect(history).toContainText("MISSED TRACKED SHOT");
  await expect(history).toContainText("PENALTY STROKE");

  await history.getByRole("button", { name: "Remove missed tracked shot" }).click();
  await expect(history).not.toContainText("MISSED TRACKED SHOT");
  await expect(history).toContainText("PENALTY STROKE");

  await history.getByRole("button", { name: "UNDO LAST" }).click();
  await expect(history).toContainText("No manual events yet.");

  await page.keyboard.press("Escape");
  await expect(history).toBeHidden({ timeout: 3_000 });
  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.locator(".score-editor > div > strong")).toHaveText("4", { timeout: 3_000 });
});

test("14-club Add Shot flow persists manual events and reverses penalties", async ({ page }) => {
  await openField(page);
  const addShot = page.getByRole("button", { name: "+ Shot" });

  await addShot.click();
  const addSheet = page.getByTestId("add-shot-sheet");
  await expect(addSheet).toBeVisible();
  await expect(addSheet.locator("[data-testid^='add-shot-club-']")).toHaveCount(14);
  await expect(addSheet.getByTestId("add-shot-club-club-1")).toContainText("DRIVER");
  await expect(addSheet.getByTestId("add-shot-club-club-14")).toContainText("PUTTER");

  await addSheet.getByTestId("add-shot-club-club-14").click();
  await addShot.click();
  await page.getByTestId("add-shot-sheet").getByTestId("add-penalty-stroke").click();

  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.locator(".score-editor > div > strong")).toHaveText("5");
  await page.keyboard.press("Escape");

  await page.reload();
  await addShot.click();
  const reloadedSheet = page.getByTestId("add-shot-sheet");
  const history = reloadedSheet.getByTestId("manual-entry-history");
  await expect(history).toContainText("PUTTER");
  await expect(history).toContainText("PENALTY STROKE");

  const storedLog = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openround:round-log:v1") ?? "null"));
  expect(storedLog.score).toBe(5);
  expect(storedLog.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "manual_shot", clubId: "club-14", clubName: "Putter", distanceYards: null, evidence: "manual" }),
    expect.objectContaining({ kind: "penalty_stroke", distanceYards: null, evidence: "manual" }),
  ]));

  await history.getByRole("button", { name: "Remove putter manual shot" }).click();
  await expect(history).not.toContainText("PUTTER");
  await history.getByRole("button", { name: "UNDO LAST" }).click();
  await expect(history).toContainText("No manual events yet.");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.locator(".score-editor > div > strong")).toHaveText("4");
});

test("Menu exposes fast controls and retired clubs leave Add Shot", async ({ page }) => {
  await openField(page);

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const menu = page.getByTestId("menu-sheet");
  await expect(menu).toBeVisible();
  await expect(page.getByTestId("bottom-sheet")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "+ Shot", exact: true }).click();
  await expect(page.getByTestId("add-shot-sheet")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Bag", exact: true }).click();
  const equipment = page.getByTestId("equipment-sheet");
  await expect(equipment).toBeVisible();
  await equipment.getByRole("button", { name: "Retire Driver" }).click();
  await expect(equipment.getByRole("tab", { name: /ACTIVE/ })).toContainText("13");
  await equipment.getByRole("tab", { name: /RETIRED/ }).click();
  await expect(equipment.getByTestId("equipment-status-club-1")).toHaveText("RESTORE");
  await equipment.getByRole("tab", { name: /ACTIVE/ }).click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "+ Shot" }).click();
  await expect(page.getByTestId("add-shot-club-club-1")).toHaveCount(0);
  await expect(page.getByTestId("add-shot-club-club-14")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Bag", exact: true }).click();
  const retired = page.getByRole("tab", { name: /RETIRED/ });
  await retired.click();
  await expect(equipment.getByTestId("equipment-row-club-1")).toContainText("RETIRED");
  await equipment.getByRole("button", { name: "Restore Driver" }).click();
  await expect(equipment.getByRole("tab", { name: /ACTIVE/ })).toContainText("14");
});

test("equipment sheet manages a local fourteen-club bag without changing caddy selection", async ({ page }) => {
  await openField(page);
  await page.getByRole("button", { name: /current club Driver.*tee shot is not locked/i }).click();
  await page.getByTestId("view-full-bag-from-club").click();

  const sheet = page.getByTestId("equipment-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("14/14 CLUBS")).toBeVisible();
  await expect(sheet.locator(".equipment-sheet-summary small")).toHaveText("STIX · NICHOLAS EDITION");

  await sheet.getByRole("button", { name: "Edit 7 Iron" }).click();
  await sheet.getByLabel("BRAND").fill("Titleist");
  await sheet.getByLabel("CARRY YD").fill("160");
  await sheet.getByLabel("TOTAL YD").fill("172");
  await sheet.getByTestId("save-equipment").click();
  await expect(sheet.getByTestId("equipment-row-club-7")).toContainText("Titleist");
  await expect(sheet.getByTestId("equipment-row-club-7")).toContainText("160 YD");
  await expect(sheet.getByTestId("equipment-row-club-7")).toContainText("172 YD");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /current club Driver.*tee shot is not locked/i })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /current club Driver.*tee shot is not locked/i }).click();
  await page.getByTestId("view-full-bag-from-club").click();
  const reloadedSheet = page.getByTestId("equipment-sheet");
  await expect(reloadedSheet.getByTestId("equipment-row-club-7")).toContainText("Titleist");

  await reloadedSheet.getByRole("button", { name: "Delete Putter" }).click();
  await expect(reloadedSheet.getByText("13/14 CLUBS")).toBeVisible();
  await reloadedSheet.getByTestId("add-equipment").click();
  await reloadedSheet.getByTestId("save-equipment").click();
  await expect(reloadedSheet.getByText("14/14 CLUBS")).toBeVisible();
});

test("map layers switch to the bundled offline illustration and persist locally", async ({ page }) => {
  await openField(page);
  const map = page.locator(".course-map");
  await expect(map).toHaveAttribute("data-map-layer", "satellite");

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const menu = page.getByTestId("menu-sheet");
  await menu.getByTestId("menu-map-layer").click();
  await expect(map).toHaveAttribute("data-map-layer", "illustration");
  await expect(page.locator(".illustration-map-layer")).toBeVisible();
  await expect(page.locator(".satellite-layer")).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".course-map")).toHaveAttribute("data-map-layer", "illustration");
  await expect(page.locator(".illustration-map-layer")).toBeVisible();
});

test("green maps expose deterministic approach and putt-break overlays", async ({ page }) => {
  await openField(page);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const menu = page.getByTestId("menu-sheet");

  await menu.getByTestId("menu-green-map").click();
  await expect(page.locator(".course-map")).toHaveAttribute("data-green-map", "approach");
  await expect(page.locator(".green-map-overlay[data-mode='approach']")).toBeVisible();

  await menu.getByTestId("menu-green-map").click();
  await expect(page.locator(".course-map")).toHaveAttribute("data-green-map", "putt_breaks");
  await expect(page.locator(".green-map-overlay[data-mode='putt_breaks']")).toBeVisible();
});

test("distance arcs, blind shot guidance, and auto zoom stay discoverable from Menu", async ({ page }) => {
  await openField(page);
  const map = page.locator(".course-map");
  await expect(map).toHaveAttribute("data-distance-arcs", "true");
  await expect(map).toHaveAttribute("data-map-detail", "false");
  await expect(page.locator(".distance-arcs-overlay")).toHaveCount(0);

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const menu = page.getByTestId("menu-sheet");
  await menu.getByTestId("menu-distance-arcs").click();
  await expect(map).toHaveAttribute("data-distance-arcs", "false");
  await expect(page.locator(".distance-arcs-overlay")).toHaveCount(0);
  await menu.getByTestId("menu-distance-arcs").click();

  const mapBox = await map.boundingBox();
  if (!mapBox) throw new Error("Demo course map did not expose a gesture surface");
  const centerX = mapBox.x + mapBox.width / 2;
  const centerY = mapBox.y + mapBox.height / 2;
  await map.dispatchEvent("pointerdown", { pointerId: 10, pointerType: "touch", clientX: centerX - 40, clientY: centerY });
  await map.dispatchEvent("pointerdown", { pointerId: 11, pointerType: "touch", clientX: centerX + 40, clientY: centerY });
  await map.dispatchEvent("pointermove", { pointerId: 11, pointerType: "touch", clientX: centerX + 130, clientY: centerY });
  await expect(map).toHaveAttribute("data-map-detail", "true");
  await expect(page.locator(".distance-arcs-overlay")).toBeVisible();
  await map.dispatchEvent("pointerup", { pointerId: 11, pointerType: "touch", clientX: centerX + 130, clientY: centerY });
  await map.dispatchEvent("pointerup", { pointerId: 10, pointerType: "touch", clientX: centerX - 40, clientY: centerY });

  await menu.getByTestId("menu-blind-shot").click();
  await expect(page.locator(".blind-shot-guide")).toBeVisible();
  await expect(page.locator(".blind-shot-guide")).toContainText(/FLAG|158/);
  await expect(page.locator(".course-map")).toHaveAttribute("data-blind-shot", "true");

  await menu.getByTestId("menu-auto-zoom").click();
  await expect(page.locator(".course-map")).toHaveAttribute("data-auto-zoom", "false");
});

test("conditions, live weather fallback, coach, and tee planner stay deterministic", async ({ page }) => {
  await page.route("https://api.open-meteo.com/**", (route) => route.abort());
  await openField(page);

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByTestId("menu-conditions").click();
  const conditions = page.getByTestId("conditions-sheet");
  await expect(conditions).toContainText("72°F");
  await page.getByRole("slider", { name: "Temperature" }).press("ArrowLeft");
  await expect(conditions).toContainText("71°F");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const menu = page.getByTestId("menu-sheet");
  await menu.getByTestId("menu-weather").click();
  const weather = page.getByTestId("weather-sheet");
  await expect(weather).toBeVisible();
  await expect(weather.getByTestId("weather-source")).toContainText(/FIXTURE|CACHED|LIVE/);
  await expect(weather).toContainText("72°F");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByTestId("menu-coach").click();
  const coach = page.getByTestId("coach-sheet");
  await expect(coach).toContainText("FAIRWAY LIE");
  for (const lie of ["tee", "rough", "bunker", "recovery", "green"] as const) {
    await coach.getByTestId(`coach-lie-${lie}`).click();
    await expect(coach).toContainText(`${lie.toUpperCase()} LIE`);
  }
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByTestId("menu-tee-planner").click();
  await expect(page.getByTestId("tee-planner-sheet")).toContainText("LEFT BUNKER");
});

test("tracked GPS drives can be reviewed into bag recommendations", async ({ page }) => {
  await openField(page);
  await page.getByTestId("at-my-ball").click();
  await expect(page.locator(".field-notice")).toHaveCount(0);

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByTestId("menu-track-shots").click();
  const track = page.getByTestId("track-shots-sheet");
  await expect(track).toBeVisible();
  await expect(track.getByTestId("tracked-shot-card")).toContainText("AUTOMATIC DRIVE");
  await expect(track.getByTestId("tracked-shot-card")).toContainText("258 YD");
  await track.getByTestId("save-shot-to-bag").click();
  await expect(track.getByTestId("tracked-shot-card")).toContainText("SAVED TO BAG");

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openround:on-course:v1") ?? "null"));
  expect(stored.shotSamples).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "automatic_drive", yards: 258, savedToBag: true }),
  ]));
  expect(await page.evaluate(() => window.localStorage.getItem("openround:club-statistics:v1"))).toBeNull();
});

test("targets, miss details, and stats automation persist by hole", async ({ page }) => {
  await openField(page);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const menu = page.getByTestId("menu-sheet");
  await menu.getByTestId("menu-targets").click();
  const targets = page.getByTestId("targets-sheet");
  await targets.getByTestId("targets-birdies-plus").click();
  await expect(targets).toContainText("3");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByTestId("menu-miss-details").click();
  const miss = page.getByTestId("miss-details-sheet");
  await miss.getByTestId("miss-target-green").click();
  await miss.getByTestId("miss-direction-right").click();
  await miss.getByTestId("save-miss-detail").click();

  await page.getByRole("button", { name: "Stats", exact: true }).click();
  const insights = page.getByTestId("insights-sheet");
  await expect(insights).toContainText("SCORE NOT RECORDED");
  await expect(insights.locator(".insight-editor-row strong")).toHaveText("—");
  await expect(insights).toContainText("MISSES");
  await insights.getByTestId("putts-plus").click();
  await insights.getByRole("button", { name: "YES", exact: true }).first().click();
  await insights.getByTestId("save-hole-insights").click();

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openround:on-course:v1") ?? "null"));
  expect(stored.targets.birdies).toBe(3);
  expect(stored.missDetails).toEqual(expect.arrayContaining([
    expect.objectContaining({ holeNumber: 7, target: "green", direction: "right" }),
  ]));
  expect(stored.holes).toEqual(expect.arrayContaining([
    expect.objectContaining({ holeNumber: 7, score: 4, putts: 1, gir: true }),
  ]));
});

test("on-course field log saves, removes, and exports local evidence", async ({ page }) => {
  await openField(page);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByText("Course & app details", { exact: true }).click();
  await page.getByTestId("menu-field-log").click();

  const sheet = page.getByTestId("field-log-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("field-log-context")).toContainText("OpenRound Demo Course");
  await expect(sheet.getByTestId("field-log-context")).toContainText("TEE BLUE");
  await expect(sheet.getByTestId("field-log-context")).toContainText("GEOMETRY D · demo-fixture");
  await expect(sheet.getByTestId("field-log-aligned-1x")).toBeDisabled();
  await expect(sheet.getByTestId("field-log-aligned-2x")).toBeDisabled();

  await sheet.getByTestId("field-log-device").fill("Marcus iPhone");
  await sheet.getByTestId("field-log-expected").fill("158");
  await sheet.getByTestId("field-log-recorded").fill("157");
  await sheet.getByTestId("field-log-accuracy").fill("4");
  await sheet.getByTestId("field-log-fix-age").fill("2");
  await sheet.getByTestId("field-log-note").fill("Tee-to-ball fix looked stable.");
  await sheet.getByTestId("save-field-log").click();

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openround:field-log:v1") ?? "null"));
  expect(stored.version).toBe(1);
  expect(stored.runs).toHaveLength(1);
  expect(stored.runs[0]).toEqual(expect.objectContaining({
    device: "Marcus iPhone",
    courseId: "openround-demo-course-v1",
    hole: 7,
    teeBox: "blue",
    geometryGrade: "D",
    geometryVersion: "demo-fixture",
    gps: [{ expectedYards: 158, recordedYards: 157, accuracyMeters: 4, fixAgeSeconds: 2 }],
    imagery: { provider: "usgs", attributionVisible: true, overlayAligned: false, alignmentZooms: { oneX: false, twoX: false } },
  }));
  const runId = stored.runs[0].id as string;
  const run = sheet.getByTestId(`field-log-run-${runId}`);
  await expect(run).toContainText("157 YD GPS");
  await expect(sheet.getByTestId("field-log-history")).toContainText("SAVED RUNS · 1/500");

  const downloadPromise = page.waitForEvent("download");
  await sheet.getByTestId("export-field-log").click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Field log export did not create a download");
  const exported = JSON.parse(await readFile(downloadPath, "utf8"));
  expect(exported).toEqual(stored);

  await run.getByRole("button", { name: `Remove field log run ${runId}` }).click();
  await expect(sheet.getByTestId("field-log-history")).toContainText("No runs saved yet");
  await expect(page.evaluate(() => window.localStorage.getItem("openround:field-log:v1"))).resolves.toBe(JSON.stringify({ version: 1, runs: [] }));
});

test("field log captures fresh GPS accuracy and fix age from the phone", async ({ page }) => {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 32.25769, longitude: -97.72271, accuracy: 4 });
  await openField(page);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByText("Course & app details", { exact: true }).click();
  await page.getByTestId("menu-field-log").click();

  const sheet = page.getByTestId("field-log-sheet");
  await sheet.getByTestId("capture-field-log-fix").click();
  await expect(sheet.getByTestId("field-log-accuracy")).toHaveValue("4");
  await expect(sheet.getByTestId("field-log-fix-age")).toHaveValue(/^[0-9]+$/);
  await expect(page.locator(".field-notice")).toHaveCount(0);
});

test("field log captures and exports a two-point phone GPS distance", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 32.25769, longitude: -97.72271, accuracy: 4 });
  await openField(page);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByText("Course & app details", { exact: true }).click();
  await page.getByTestId("menu-field-log").click();

  const sheet = page.getByTestId("field-log-sheet");
  const pairButton = sheet.getByTestId("capture-field-log-pair");
  await pairButton.click();
  await expect(pairButton).toContainText("CAPTURE GPS END");

  await context.setGeolocation({ latitude: 32.258514, longitude: -97.72271, accuracy: 4 });
  await page.waitForTimeout(5_200);
  await pairButton.click();
  await expect(pairButton).toContainText("RESET GPS PAIR");
  const recordedYards = Number(await sheet.getByTestId("field-log-recorded").inputValue());
  expect(recordedYards).toBeGreaterThan(95);
  expect(recordedYards).toBeLessThan(105);

  await sheet.getByTestId("field-log-expected").fill(String(recordedYards));
  await sheet.getByTestId("save-field-log").click();
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openround:field-log:v1") ?? "null"));
  expect(stored.runs[0].gps[0]).toEqual(expect.objectContaining({
    source: "phone_pair",
    recordedYards,
    start: { lat: 32.25769, lon: -97.72271 },
    end: { lat: 32.258514, lon: -97.72271 },
  }));
  expect(stored.runs[0].gps[0].startFixAgeSeconds).toBeGreaterThanOrEqual(0);
  expect(stored.runs[0].gps[0].endFixAgeSeconds).toBeGreaterThanOrEqual(0);
});

test("personal Squaw Valley Links seed loads its separated OSM hole bundle", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);

  const search = page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" });
  await search.fill("Apache Links");

  const result = page.getByRole("button", { name: "Squaw Valley Golf Course · Links Glen Rose, TX 18H" });
  await expect(result).toBeVisible();
  await result.click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  await expectSelectedCourseFromMenu(page, "Squaw Valley Golf Course · Links");
  await expect(page.locator(".real-course-advice")).toHaveCount(0);
  await expect(page.locator(".real-geometry-bunker").first()).toBeVisible();
  await expect(page.locator(".real-hazard-distance")).toHaveCount(0);
  const mapWorld = page.locator(".map-world-real");
  await expect(mapWorld).toHaveAttribute("data-orientation", "top-facing");
  await expect(page.locator(".satellite-layer")).toHaveAttribute("data-viewport-export", /pending|ready|failed/);
  const endpointCenters = await page.evaluate(() => {
    const green = document.querySelector(".real-geometry-green")?.getBoundingClientRect();
    const tees = Array.from(document.querySelectorAll(".real-geometry-tee")).map((element) => element.getBoundingClientRect());
    return {
      greenY: green ? green.top + green.height / 2 : Number.NaN,
      teeY: tees.length > 0 ? Math.min(...tees.map((rect) => rect.top + rect.height / 2)) : Number.NaN,
    };
  });
  expect(endpointCenters.greenY).toBeLessThan(endpointCenters.teeY);
  const aim = page.getByTestId("aim-point");
  await expect(aim).toBeVisible();
  const aimBox = await aim.boundingBox();
  if (!aimBox) throw new Error("Aim point did not expose a hit target");
  await aim.dispatchEvent("pointerdown", { pointerId: 1, button: 0, clientX: aimBox.x + aimBox.width / 2, clientY: aimBox.y + aimBox.height / 2 });
  await expect(aim).toHaveAttribute("data-dragging", "true");
  await aim.dispatchEvent("pointermove", { pointerId: 1, button: 0, clientX: aimBox.x + aimBox.width / 2 + 24, clientY: aimBox.y + aimBox.height / 2 + 8 });
  await aim.dispatchEvent("pointerup", { pointerId: 1, button: 0, clientX: aimBox.x + aimBox.width / 2 + 24, clientY: aimBox.y + aimBox.height / 2 + 8 });
  await expect(page.locator("span[aria-live='polite']").first()).toContainText("Custom aim set");
  await page.getByRole("button", { name: "Reset course aim to caddy path" }).click();
  await expect(aim).toHaveAttribute("aria-valuetext", /yards to aim/);

  await page.reload();
  await expectSelectedCourseFromMenu(page, "Squaw Valley Golf Course · Links");
  await expect(page.locator(".real-course-advice")).toHaveCount(0);
});

test("real planning map renders imagery and labels at display resolution", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  const map = page.locator(".course-map");
  const imagery = page.locator(".satellite-layer");
  const world = page.locator(".map-world-real");
  const planningScale = Number(await map.getAttribute("data-rendered-scale"));
  const imageryScale = Number(await imagery.getAttribute("data-detail-scale"));

  expect(imageryScale).toBeGreaterThanOrEqual(planningScale);
  await expect(world).toHaveCSS("will-change", "auto");
});

test("personal Squaw Valley Lakes seed loads its separated OSM hole bundle", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);

  const search = page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" });
  await search.fill("Comanche Lakes");

  const result = page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" });
  await expect(result).toBeVisible();
  await result.click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  await expectSelectedCourseFromMenu(page, "Squaw Valley Golf Course · Lakes");
  await expect(page.locator(".real-course-advice")).toHaveCount(0);
  await expect(page.locator(".real-course-map-status")).toHaveCount(0);
  const map = page.locator(".course-map");
  await expect(map).toHaveAttribute("data-map-detail", "false");
  await expect(page.locator(".real-pin-ring")).toHaveCount(0);
  const pinDot = page.locator(".real-pin-dot");
  await expect(pinDot).toBeVisible();
  await expect(page.locator(".real-pin-layer")).toHaveAttribute("data-pin-source", "center");
  await expect.poll(async () => {
    const box = await pinDot.boundingBox();
    return box ? Math.max(box.width, box.height) : Infinity;
  }).toBeLessThanOrEqual(6);
  const realAimDistanceLabel = page.getByTestId("real-plan-aim-distance");
  const realPinDistanceLabel = page.getByTestId("real-plan-pin-distance");
  await expect(realAimDistanceLabel).toHaveText(/^\d+$/);
  await expect(realPinDistanceLabel).toHaveText(/^\d+$/);
  await expect(realAimDistanceLabel).toHaveAttribute("transform", /matrix\(/);
  await expect(realPinDistanceLabel).toHaveAttribute("transform", /matrix\(/);
  const pinRouteEnd = await page.locator(".real-plan-pin-route").evaluate((line) => ({
    x: Number(line.getAttribute("x2")),
    y: Number(line.getAttribute("y2")),
  }));
  const pinDotCenter = await pinDot.evaluate((dot) => ({
    x: Number(dot.getAttribute("cx")),
    y: Number(dot.getAttribute("cy")),
  }));
  expect(pinRouteEnd).toEqual(pinDotCenter);
  for (const marker of await page.locator("circle.real-geometry-tee, circle.real-plan-origin").all()) {
    const box = await marker.boundingBox();
    if (!box) throw new Error("Real blue map marker did not expose a bounding box");
    expect(Math.max(box.width, box.height)).toBeLessThanOrEqual(11);
  }
  const mapBox = await map.boundingBox();
  if (!mapBox) throw new Error("Lakes course map did not expose a gesture surface");
  const centerX = mapBox.x + mapBox.width / 2;
  const centerY = mapBox.y + mapBox.height / 2;
  await map.dispatchEvent("pointerdown", { pointerId: 10, pointerType: "touch", clientX: centerX - 40, clientY: centerY });
  await map.dispatchEvent("pointerdown", { pointerId: 11, pointerType: "touch", clientX: centerX + 40, clientY: centerY });
  await map.dispatchEvent("pointermove", { pointerId: 11, pointerType: "touch", clientX: centerX + 130, clientY: centerY });
  await expect(map).toHaveAttribute("data-map-detail", "true");
  await expect(realAimDistanceLabel).toBeVisible();
  await expect(realAimDistanceLabel).toHaveText(/\d+/);
  await expect(realPinDistanceLabel).toBeVisible();
  await expect(realPinDistanceLabel).toHaveText(/\d+/);
  await map.dispatchEvent("pointerup", { pointerId: 11, pointerType: "touch", clientX: centerX + 130, clientY: centerY });
  await map.dispatchEvent("pointerup", { pointerId: 10, pointerType: "touch", clientX: centerX - 40, clientY: centerY });
  const planDistanceStyle = await realAimDistanceLabel.locator("text").evaluate((element) => {
    const style = getComputedStyle(element);
    const matrix = (element as SVGTextElement).getScreenCTM()!;
    return {
      fontSize: Number.parseFloat(style.fontSize) * Math.hypot(matrix.a, matrix.b),
      strokeWidth: Number.parseFloat(style.strokeWidth),
    };
  });
  expect(planDistanceStyle.fontSize).toBeCloseTo(20, 0);
  expect(planDistanceStyle.strokeWidth).toBeLessThanOrEqual(0.5);
  await expect(page.getByTestId("aim-point")).toHaveAttribute("aria-valuetext", /yards to aim/);
  await expect(page.getByText("PLAYS LIKE", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("TO PIN · WIND + ELEVATION APPLIED", { exact: true })).toHaveCount(0);
  await expect(page.locator(".real-geometry-bunker").first()).toBeVisible();
  await expect(page.locator(".real-hazard-distance")).toHaveCount(0);
  await expect(page.locator("polygon.real-geometry-tee")).toHaveCount(0);
  await expect(page.locator("circle.real-geometry-tee")).toHaveCount(4);
  const planOriginRadius = Number(await page.locator("circle.real-plan-origin").getAttribute("r"));
  expect(planOriginRadius).toBeGreaterThanOrEqual(0.12);
  expect(planOriginRadius).toBeLessThanOrEqual(0.32);
  const lakesAimFace = page.locator(".aim-point-face");
  await expect(lakesAimFace).toBeVisible();
  const lakesAimShape = await lakesAimFace.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
      dot: Boolean(element.querySelector(".aim-point-center-dot")),
    };
  });
  expect(lakesAimShape.width).toBeGreaterThan(24);
  expect(lakesAimShape.width).toBeLessThan(45);
  expect(lakesAimShape.height).toBeGreaterThan(24);
  expect(lakesAimShape.height).toBeLessThan(50);
  expect(Math.abs(lakesAimShape.width - lakesAimShape.height)).toBeLessThan(2);
  expect(lakesAimShape.dot).toBe(true);
  const lakesAim = page.getByTestId("aim-point");
  const lakesSatellite = page.locator(".satellite-layer");
  await expect(lakesSatellite).toHaveAttribute("data-live", "true");
  await expect(lakesSatellite).toHaveCSS("opacity", "1");
  await page.evaluate(() => {
    const satellite = document.querySelector<HTMLElement>(".satellite-layer");
    if (!satellite) throw new Error("Satellite layer did not render");
    const states = [satellite.dataset.live ?? "missing"];
    new MutationObserver(() => states.push(satellite.dataset.live ?? "missing"))
      .observe(satellite, { attributes: true, attributeFilter: ["data-live"] });
    (window as typeof window & { __openroundSatelliteStates?: string[] }).__openroundSatelliteStates = states;
  });
  const lakesAimBox = await lakesAim.boundingBox();
  if (!lakesAimBox) throw new Error("Lakes aim point did not expose a hit target");
  await lakesAim.dispatchEvent("pointerdown", {
    pointerId: 1,
    button: 0,
    clientX: lakesAimBox.x + lakesAimBox.width / 2,
    clientY: lakesAimBox.y + lakesAimBox.height / 2,
  });
  await lakesAim.dispatchEvent("pointermove", {
    pointerId: 1,
    button: 0,
    clientX: lakesAimBox.x + lakesAimBox.width / 2 + 16,
    clientY: lakesAimBox.y + lakesAimBox.height / 2 + 8,
  });
  await expect(lakesSatellite).toHaveCSS("opacity", "1");
  await page.waitForTimeout(100);
  const satelliteStates = await page.evaluate(() =>
    (window as typeof window & { __openroundSatelliteStates?: string[] }).__openroundSatelliteStates ?? [],
  );
  expect(satelliteStates).not.toContain("false");
  await lakesAim.dispatchEvent("pointerup", {
    pointerId: 1,
    button: 0,
    clientX: lakesAimBox.x + lakesAimBox.width / 2 + 16,
    clientY: lakesAimBox.y + lakesAimBox.height / 2 + 8,
  });
  const resetAim = page.getByRole("button", { name: "Reset course aim to caddy path" });
  await expect(resetAim).toBeVisible();
  const courseLayout = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, bottom: box.bottom };
    };
    return {
      map: rect(".course-map"),
      metrics: rect(".club-metrics"),
      tracking: rect(".tracking-strip"),
      condition: rect(".condition-strip"),
      advice: rect(".caddy-advice"),
    };
  });
  if (!courseLayout.map || !courseLayout.tracking) {
    throw new Error("Real-course map layout did not expose its expected bounds");
  }
  expect(courseLayout.advice).toBeNull();
  expect(courseLayout.condition).toBeNull();
  expect(courseLayout.metrics).toBeNull();
  expect(courseLayout.tracking.y).toBeGreaterThanOrEqual(courseLayout.map.bottom - 0.5);
  await page.reload();
  await expectSelectedCourseFromMenu(page, "Squaw Valley Golf Course · Lakes");
  await expect(page.locator(".real-course-advice")).toHaveCount(0);
});

test("selected Squaw Valley hole persists across reload", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("2");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  await expectSelectedCourseFromMenu(page, "HOLE 2");
  await expect(page.locator(".real-course-advice")).toHaveCount(0);

  await page.reload();
  await expectSelectedCourseFromMenu(page, "Squaw Valley Golf Course · Lakes");
  await expectSelectedCourseFromMenu(page, "HOLE 2");
  await expect(page.locator(".real-course-advice")).toHaveCount(0);
});

test("real-course club evidence reloads persistent GPS history", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  await page.evaluate(() => {
    const createdAt = "2026-08-31T12:00:00.000Z";
    window.localStorage.setItem("openround:club-statistics:v1", JSON.stringify({
      version: 1,
      records: [{
        recordId: ["0e1e596d-8e86-4ff8-90e9-6a439a0ba271", "real-round", 1, "gps-6i", createdAt].join("\u0000"),
        id: "sample-gps-6i",
        eventId: "gps-6i",
        holeNumber: 1,
        clubId: "club-6",
        clubName: "6 Iron",
        yards: 171,
        kind: "gps",
        savedToBag: true,
        createdAt,
      }],
    }));
  });
  await page.reload();

  await page.locator("button.club-panel").click();
  const sheet = page.getByRole("dialog", { name: /Club for \d+ yd/i });
  await sheet.getByRole("button", { name: /Preview 6 Iron/i }).click();
  await expect(sheet.getByTestId("club-true-distance")).toHaveText("171");
  await expect(sheet.getByTestId("club-evidence-summary")).toContainText("LAST 1 GPS SHOTS");
});

test("real-course pin placement moves the green under a fixed yellow pin and confirms the mapped pin", async ({ page }) => {
  test.setTimeout(45_000);
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();
  await expect(page.locator(".real-course-advice")).toHaveCount(0);

  const map = page.locator(".course-map");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByTestId("menu-map-layer").click();
  await expect(map).toHaveAttribute("data-map-layer", "illustration");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "PIN THE FLAG" })).toBeVisible();
  await expect(page.getByText("MOVE GREEN UNDER FLAG")).toBeVisible();
  await expect(map).toHaveAttribute("data-rendered-scale", "6.40");
  await expect(map).toHaveAttribute("data-map-layer", "satellite");
  await expect(page.locator(".satellite-layer")).toBeVisible();
  await expect(page.locator(".illustration-map-layer")).toHaveCount(0);
  await expect(page.locator(".real-geometry-green").first()).toHaveCSS("stroke-width", "0.3px");
  await expect(page.locator(".real-geometry-green").first()).toHaveCSS("opacity", "1");
  await expect(page.locator(".real-geometry-fairway").first()).toHaveCSS("opacity", "0");
  const target = page.getByTestId("pin-placement-target");
  await expect(target.locator(".pin-placement-crosshair")).toHaveCount(0);
  await expect(target.locator(".pin-placement-flag")).toBeVisible();
  const targetBefore = await target.boundingBox();
  const worldBefore = await page.locator(".map-world-real").getAttribute("style");
  const mapBox = await map.boundingBox();
  if (!mapBox) throw new Error("Real course map did not expose a bounding box");
  await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(mapBox.x + mapBox.width / 2 + 18, mapBox.y + mapBox.height / 2 + 12);
  await page.mouse.up();
  const targetAfter = await target.boundingBox();
  const worldAfter = await page.locator(".map-world-real").getAttribute("style");
  expect(targetBefore).not.toBeNull();
  expect(targetAfter).not.toBeNull();
  expect(Math.abs(targetAfter!.x - targetBefore!.x)).toBeLessThan(1);
  expect(Math.abs(targetAfter!.y - targetBefore!.y)).toBeLessThan(1);
  expect(worldAfter).not.toBe(worldBefore);

  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(map).toHaveAttribute("data-rendered-scale", "6.00");
  await page.getByRole("button", { name: "Cancel pin placement" }).click();
  await expect(page.getByRole("heading", { name: "PIN THE FLAG" })).toHaveCount(0);
  await expect(page.locator(".real-pin-layer")).not.toHaveAttribute("data-pin-source", "custom");

  const effectiveScaleBeforeConfirm = await page.locator(".map-world-real").evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return Math.hypot(matrix.a, matrix.b);
  });
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await page.getByRole("button", { name: "Confirm pin" }).click();
  expect(await page.locator(".map-world-real").evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return Math.hypot(matrix.a, matrix.b);
  })).toBeCloseTo(effectiveScaleBeforeConfirm, 5);
  await expect(page.locator(".field-notice")).toHaveCount(0);
  await expect(page.locator(".real-pin-layer")).toHaveAttribute("data-pin-source", "custom");
  await expect(page.locator(".real-course-advice")).toHaveCount(0);

  await page.reload();
  await expectSelectedCourseFromMenu(page, "Squaw Valley Golf Course · Lakes");
  await expect(page.locator(".real-pin-layer")).toHaveAttribute("data-pin-source", "custom");

  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await page.getByRole("button", { name: "Pin options", exact: true }).click();
  await expect(page.getByRole("button", { name: "RESET PIN TO PROVIDER" })).toBeVisible();
  await page.getByRole("button", { name: "RESET PIN TO PROVIDER" }).click();
  await expect(page.locator(".real-pin-layer")).toHaveAttribute("data-pin-source", "center");
});

test("development ball placement completes the shot at current aim and starts from the new ball", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 32.25769, longitude: -97.72271, accuracy: 8 });
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();
  await expect(page.locator(".tracking-strip")).toContainText("Driver paused");

  const map = page.locator(".course-map");
  const mapWorld = page.locator(".map-world-real");
  const aimPoint = page.getByTestId("aim-point");
  const aimBox = await aimPoint.boundingBox();
  const originBox = await page.locator(".real-plan-origin").boundingBox();
  const pinBox = await page.locator(".real-pin-dot").boundingBox();
  if (!aimBox || !originBox || !pinBox) throw new Error("Approach map controls did not expose geometry");
  const originCenter = { x: originBox.x + originBox.width / 2, y: originBox.y + originBox.height / 2 };
  const pinCenter = { x: pinBox.x + pinBox.width / 2, y: pinBox.y + pinBox.height / 2 };
  const approachTarget = {
    x: pinCenter.x + (originCenter.x - pinCenter.x) * 0.08,
    y: pinCenter.y + (originCenter.y - pinCenter.y) * 0.08,
  };
  await aimPoint.dispatchEvent("pointerdown", {
    pointerId: 1,
    button: 0,
    clientX: aimBox.x + aimBox.width / 2,
    clientY: aimBox.y + aimBox.height / 2,
  });
  await aimPoint.dispatchEvent("pointermove", { pointerId: 1, button: 0, clientX: approachTarget.x, clientY: approachTarget.y });
  await aimPoint.dispatchEvent("pointerup", { pointerId: 1, button: 0, clientX: approachTarget.x, clientY: approachTarget.y });
  await expect(page.getByRole("button", { name: "Reset course aim to caddy path" })).toBeVisible();

  const originalScale = await map.getAttribute("data-rendered-scale");
  const originalTarget = await page.getByTestId("aim-distance").textContent();
  const renderedScaleBefore = await mapWorld.evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return Math.hypot(matrix.a, matrix.b);
  });
  const aimYards = await page.getByTestId("aim-point").getAttribute("aria-valuenow");
  if (!aimYards) throw new Error("Course aim did not expose its distance");
  const placeBall = page.getByRole("button", { name: "Place ball" });
  await expect(placeBall).toBeEnabled();

  await placeBall.click();
  await expect(map).not.toHaveAttribute("data-ball-placement", "active");
  await expect(page.getByRole("button", { name: "Cancel place ball" })).toHaveCount(0);

  await expect(page.locator(".real-shot-line")).toHaveCount(1);
  await expect(page.locator(".tracking-strip")).toHaveAttribute("data-tracking-number", "2");
  await expect(map).toHaveAttribute("data-rendered-scale", originalScale!);
  await expect(page.getByTestId("aim-distance")).not.toHaveText(originalTarget!);
  const approachYards = await page.getByTestId("aim-point").getAttribute("aria-valuenow");
  await expect(page.getByTestId("real-driver-shot-card")).toContainText("SHOT 2 ·");
  await expect(page.getByTestId("real-driver-shot-card")).toContainText(`${approachYards} YD`);
  await expect(page.getByTestId("real-driver-shot-card")).toContainText("DEMO MANUAL · TRACKING");
  const renderedScaleAfter = await mapWorld.evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return Math.hypot(matrix.a, matrix.b);
  });
  await expect(map).toHaveAttribute("data-auto-zoom-active", "true");
  expect(renderedScaleAfter / renderedScaleBefore).toBeCloseTo(3.03, 1);
  await expect(aimPoint).toBeVisible();
  const expectEndpointCentered = async () => {
    await expect.poll(async () => {
      const endpoint = await page.locator(".real-shot-end").boundingBox();
      const bounds = await map.boundingBox();
      if (!endpoint || !bounds) return Infinity;
      return Math.max(
        Math.abs(endpoint.x + endpoint.width / 2 - (bounds.x + bounds.width / 2)),
        Math.abs(endpoint.y + endpoint.height / 2 - (bounds.y + bounds.height / 2)),
      );
    }).toBeLessThan(3);
  };
  await expectEndpointCentered();
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(page.getByTestId("pin-placement-target")).toHaveAttribute("data-valid", "true");
  await page.getByRole("button", { name: "Cancel pin placement" }).click();
  await expectEndpointCentered();
  await page.getByRole("button", { name: "Undo demo ball" }).click();
  await expect(page.locator(".real-shot-line")).toHaveCount(0);
  await expect(page.getByTestId("real-driver-shot-card")).toContainText("SHOT 1 · DRIVER");
  await expect(page.locator(".tracking-strip")).toHaveAttribute("data-tracking-number", "1");
  await expect(map).toHaveAttribute("data-rendered-scale", originalScale!);
  await expect(page.getByTestId("aim-distance")).toHaveText(originalTarget!);
  await expect(placeBall).toBeEnabled();
  await placeBall.click();
  await expect(page.locator(".real-shot-line")).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: "Undo demo ball" }).click();
  await expect(page.locator(".real-shot-line")).toHaveCount(0);
  await expect(page.locator(".tracking-strip")).toHaveAttribute("data-tracking-number", "1");
  await expect(page.getByRole("button", { name: "Place ball" })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("openround:club-statistics:v1"))).toBeNull();
  const roundLog = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openround:round-log:v1") ?? "null"));
  expect(roundLog?.events ?? []).toHaveLength(0);
});

test("caddy aims at the pin when the recommended approach club reaches the green", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  await page.getByRole("button", { name: "Place ball" }).click();

  await expect(page.locator(".tracking-strip")).toHaveAttribute("data-tracking-number", "2");
  await expect(page.getByTestId("real-plan-pin-distance")).toHaveCount(0);
});

test("on-green view focuses the cup and shows the complete shot rail", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  await page.getByRole("button", { name: "Place ball" }).click();
  await page.getByRole("button", { name: "Place ball" }).click();

  const field = page.locator(".field-screen");
  await expect(field).toHaveAttribute("data-putting", "true");
  const progress = page.locator(".putting-progress");
  await expect(progress).toContainText("TEE");
  await expect(progress.locator('[aria-label^="Shot 1:"]')).toHaveCount(1);
  await expect(progress.locator('[aria-label^="Shot 2:"]')).toHaveCount(1);
  await expect(progress.locator('[data-active="true"]')).toContainText("PUTTER");
  await expect(progress.locator(".putting-progress-node")).toHaveCount(4);
  await expect(page.getByTestId("at-my-ball")).toContainText("RECORD PUTTS");
  await expect(page.locator(".putting-read")).toContainText("NOT MEASURED");
  await expect(page.getByRole("navigation", { name: "Course actions" }).getByRole("button")).toHaveCount(3);
  await expect(page.getByTestId("aim-point")).toBeHidden();
  await expect(page.locator(".real-shot-summary")).toHaveCount(0);
  await expect(page.locator(".green-distance-strip")).toBeHidden();
  await expect.poll(() => page.locator(".satellite-viewport-export").evaluate((image: HTMLImageElement) => {
    const requestedWidth = Number(new URL(image.src).searchParams.get("size")?.split(",")[0] ?? 0);
    return requestedWidth / image.getBoundingClientRect().width;
  })).toBeGreaterThan(1);
});

test.describe("Cup Focus Pin resizing", () => {
  test.use({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 430, height: 932 },
  });

  test("restores its geographic center and zoom after Pin resizes", async ({ page }) => {
    await openField(page);
    await openCourseSheetFromMenu(page);
    await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
    await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
    await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
    await page.getByRole("button", { name: "CONFIRM COURSE" }).click();
    await page.getByRole("button", { name: "Place ball" }).click();
    await page.getByRole("button", { name: "Place ball" }).click();

    const map = page.locator(".course-map");
    const renderedViewport = () => page.locator(".map-world-real").evaluate((element) => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      const rotation = Number(element.getAttribute("data-rotation-deg")) * Math.PI / 180;
      const effectiveScale = Math.hypot(matrix.a, matrix.b);
      const screenX = -matrix.e;
      const screenY = -matrix.f;
      return {
        x: (Math.cos(rotation) * screenX + Math.sin(rotation) * screenY) / effectiveScale,
        y: (-Math.sin(rotation) * screenX + Math.cos(rotation) * screenY) / effectiveScale,
        effectiveScale,
      };
    });
    const expectViewportRestored = async (before: Awaited<ReturnType<typeof renderedViewport>>) => {
      await expect.poll(async () => (await renderedViewport()).x).toBeCloseTo(before.x, 5);
      await expect.poll(async () => (await renderedViewport()).y).toBeCloseTo(before.y, 5);
      await expect.poll(async () => (await renderedViewport()).effectiveScale).toBeCloseTo(before.effectiveScale, 5);
    };

    const beforeConfirm = await renderedViewport();
    await page.getByRole("button", { name: "Pin", exact: true }).click();
    const pinMapBox = await map.boundingBox();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await map.boundingBox())?.height).not.toBe(pinMapBox?.height);
    await expect(map).toHaveAttribute("data-pin-placement", "active");
    await page.getByRole("button", { name: "Confirm pin" }).click();
    await expectViewportRestored(beforeConfirm);

    const beforeCancel = await renderedViewport();
    await page.getByRole("button", { name: "Pin", exact: true }).click();
    const secondPinMapBox = await map.boundingBox();
    await page.setViewportSize({ width: 430, height: 932 });
    await expect.poll(async () => (await map.boundingBox())?.height).not.toBe(secondPinMapBox?.height);
    await expect(map).toHaveAttribute("data-pin-placement", "active");
    await page.getByRole("button", { name: "Cancel pin placement" }).click();
    await expectViewportRestored(beforeCancel);
  });
});

test("short-game Rule of 12 guides the landing point and recommends a club", async ({ page }) => {
  test.setTimeout(60_000);
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByTestId("menu-map-layer").click();
  await page.keyboard.press("Escape");

  await page.evaluate(() => {
    const courseId = "personal-squaw-valley-lakes-pending-v1";
    window.localStorage.setItem("openround:round-session:v1", JSON.stringify({
      version: 1,
      roundId: `${courseId}:1`,
      courseId,
      holeNumber: 1,
      score: 4,
      lockedShots: [{
        id: 1,
        number: 1,
        club: "DRIVER",
        totalGps: 340,
        start: { lon: -97.721512, lat: 32.2606722 },
        end: { lon: -97.7247875, lat: 32.26269 },
        evidence: "demo_manual",
        provenance: "prototype_fixture",
        reviewed: false,
        clubProfileId: "driver",
        caddyAim: null,
        plannedAim: null,
        realPlannedAim: null,
      }],
      manualEntries: [],
    }));
  });
  await page.reload();

  const helper = page.getByTestId("rule-of-12-helper");
  const club = page.getByRole("button", { name: /Change club/ });
  const trackingStrip = page.locator(".tracking-strip");
  const map = page.locator(".course-map");
  const aimPoint = page.getByTestId("aim-point");
  const renderedMapScale = () => page.locator(".map-world-real").evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return Math.hypot(matrix.a, matrix.b);
  });
  await expect(helper).toBeVisible();
  await expect(aimPoint).toBeDisabled();
  const ruleBallBeforeConfirm = await page.locator(".real-shot-end").boundingBox();
  if (!ruleBallBeforeConfirm) throw new Error("Rule of 12 ball marker did not expose bounds before pin placement");
  const ruleScaleBeforeConfirm = await renderedMapScale();
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  const pinPlacementMapBox = await map.boundingBox();
  if (!pinPlacementMapBox) throw new Error("Pin placement did not expose the course map");
  await page.mouse.move(pinPlacementMapBox.x + pinPlacementMapBox.width / 2, pinPlacementMapBox.y + pinPlacementMapBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(pinPlacementMapBox.x + pinPlacementMapBox.width / 2, pinPlacementMapBox.y + pinPlacementMapBox.height / 2 - 48);
  await page.mouse.up();
  await expect(page.getByTestId("pin-placement-target")).toHaveAttribute("data-valid", "true");
  await page.getByRole("button", { name: "Confirm pin" }).click();
  await expect(helper).toHaveCount(0);
  const ruleBallAfterConfirm = await page.locator(".real-shot-end").boundingBox();
  if (!ruleBallAfterConfirm) throw new Error("Rule of 12 ball marker did not expose bounds after pin confirmation");
  // SVG circle bounds vary by a few pixels as the Rule presentation changes;
  // compare the stable geographic marker center, not its scaled edge.
  expect(Math.abs(ruleBallAfterConfirm.x + ruleBallAfterConfirm.width / 2 - (ruleBallBeforeConfirm.x + ruleBallBeforeConfirm.width / 2))).toBeLessThan(4);
  expect(Math.abs(ruleBallAfterConfirm.y + ruleBallAfterConfirm.height / 2 - (ruleBallBeforeConfirm.y + ruleBallBeforeConfirm.height / 2))).toBeLessThan(4);
  expect(await renderedMapScale()).toBeCloseTo(ruleScaleBeforeConfirm, 5);
  await expect(aimPoint).not.toBeDisabled();
  await expect(club).toHaveAttribute("aria-label", /Current club Sand Wedge/);
  await expect(trackingStrip).toContainText("TRACKING SAND WEDGE");
  const manualAimBox = await aimPoint.boundingBox();
  if (!manualAimBox) throw new Error("Ineligible pin did not expose the manual aim point");
  const manualAimCenter = {
    x: manualAimBox.x + manualAimBox.width / 2,
    y: manualAimBox.y + manualAimBox.height / 2,
  };
  await page.mouse.move(manualAimCenter.x, manualAimCenter.y);
  await page.mouse.down();
  await page.mouse.move(manualAimCenter.x, manualAimCenter.y + 48);
  await page.mouse.up();
  const manualAimYards = await aimPoint.getAttribute("aria-valuenow");
  await expect(page.getByRole("button", { name: "Reset course aim to caddy path" })).toBeVisible();
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await page.getByRole("button", { name: "Pin options", exact: true }).click();
  await page.getByRole("button", { name: "RESET PIN TO PROVIDER" }).click();
  await page.keyboard.press("Escape");
  await expect(helper).toBeVisible();
  await expect(aimPoint).toBeDisabled();
  expect(await aimPoint.getAttribute("aria-valuenow")).not.toBe(manualAimYards);
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  const restoredPinPlacementMapBox = await map.boundingBox();
  if (!restoredPinPlacementMapBox) throw new Error("Restored pin placement did not expose the course map");
  await page.mouse.move(restoredPinPlacementMapBox.x + restoredPinPlacementMapBox.width / 2, restoredPinPlacementMapBox.y + restoredPinPlacementMapBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(restoredPinPlacementMapBox.x + restoredPinPlacementMapBox.width / 2, restoredPinPlacementMapBox.y + restoredPinPlacementMapBox.height / 2 - 48);
  await page.mouse.up();
  await expect(page.getByTestId("pin-placement-target")).toHaveAttribute("data-valid", "true");
  await page.getByRole("button", { name: "Confirm pin" }).click();
  await expect(helper).toHaveCount(0);
  await expect(aimPoint).not.toBeDisabled();
  await expect(aimPoint).toHaveAttribute("aria-valuenow", manualAimYards ?? "");
  await expect(page.getByRole("button", { name: "Reset course aim to caddy path" })).toBeVisible();
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await page.getByRole("button", { name: "Pin options", exact: true }).click();
  await page.getByRole("button", { name: "RESET PIN TO PROVIDER" }).click();
  await page.keyboard.press("Escape");
  await expect(helper).toBeVisible();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByTestId("menu-map-layer").click();
  await page.keyboard.press("Escape");
  const satellite = page.locator(".satellite-layer");
  await expect(map).toHaveAttribute("data-map-layer", "illustration");
  await expect(map).toHaveAttribute("data-rule-of-12", "true");
  await expect(satellite).toHaveAttribute("data-live", "true");
  await expect(satellite).toHaveCSS("opacity", "1");
  await expect(satellite).toBeVisible();
  await expect(page.locator(".real-geometry-layer")).toBeHidden();
  const summaryBox = await page.locator(".real-shot-summary").boundingBox();
  const helperBox = await helper.boundingBox();
  if (!summaryBox || !helperBox) throw new Error("Short-game overlays did not expose bounds");
  expect(summaryBox.y + summaryBox.height).toBeLessThanOrEqual(helperBox.y);
  const ruleBallBeforeCancel = await page.locator(".real-shot-end").boundingBox();
  if (!ruleBallBeforeCancel) throw new Error("Rule of 12 ball marker did not expose bounds before cancellation");
  const ruleScaleBeforeCancel = await renderedMapScale();
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(map).toHaveAttribute("data-pin-placement", "active");
  await expect(page.locator(".real-geometry-layer")).toBeVisible();
  await expect(page.locator(".real-geometry-green").first()).toBeVisible();
  await page.getByRole("button", { name: "Cancel pin placement" }).click();
  await expect(map).toHaveAttribute("data-pin-placement", "idle");
  const ruleBallAfterCancel = await page.locator(".real-shot-end").boundingBox();
  if (!ruleBallAfterCancel) throw new Error("Rule of 12 ball marker did not expose bounds after cancellation");
  expect(Math.abs(ruleBallAfterCancel.x + ruleBallAfterCancel.width / 2 - (ruleBallBeforeCancel.x + ruleBallBeforeCancel.width / 2))).toBeLessThan(4);
  expect(Math.abs(ruleBallAfterCancel.y + ruleBallAfterCancel.height / 2 - (ruleBallBeforeCancel.y + ruleBallBeforeCancel.height / 2))).toBeLessThan(4);
  expect(await renderedMapScale()).toBeCloseTo(ruleScaleBeforeCancel, 5);
  await expect(helper).toBeVisible();
  const ruleReadout = helper.getByRole("status");
  await expect(ruleReadout).toHaveText(/PITCHING WEDGE · LAND \d+ YD · ROLL \d+ YD · 1:2/);
  await expect(helper.getByTestId("rule-of-12-club")).toHaveText(/PITCHING WEDGE · LAND \d+ YD · ROLL \d+ YD · 1:2/);
  await expect(club).toHaveAttribute("aria-label", /Current club Pitching Wedge/);
  await expect(trackingStrip).toContainText("TRACKING PITCHING WEDGE");
  const ruleDistances = (await helper.textContent())?.match(/LAND (\d+) YD · ROLL (\d+) YD/);
  if (!ruleDistances) throw new Error("Rule of 12 guidance did not expose landing and rollout values");
  await expect(page.getByTestId("real-plan-aim-distance")).toHaveText(ruleDistances[1]!);
  await expect(page.getByTestId("real-plan-pin-distance")).toHaveText(ruleDistances[2]!);

  const renderedScale = await page.locator(".map-world-real").evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return Math.hypot(matrix.a, matrix.b);
  });
  expect(renderedScale).toBeGreaterThan(3.52);
  const scaledRouteWidth = async (selector: string) => page.locator(selector).evaluate((line, scale) => {
    return Number.parseFloat(getComputedStyle(line).strokeWidth) * scale;
  }, renderedScale);
  expect(await scaledRouteWidth(".real-plan-route")).toBeLessThanOrEqual(2.8);
  // CSS serializes the inverse transform, so inspect the visual width to three decimals.
  expect(await scaledRouteWidth(".real-shot-line")).toBeCloseTo(2.6, 3);
  const distanceBox = await page.getByTestId("real-plan-aim-distance").boundingBox();
  if (!distanceBox) throw new Error("Short-game aim distance did not expose bounds");
  expect(distanceBox.height).toBeLessThan(28);
  const mapBox = await map.boundingBox();
  const aimBox = await aimPoint.boundingBox();
  const aimFaceBox = await aimPoint.locator(".aim-point-face").boundingBox();
  if (!mapBox || !aimBox || !aimFaceBox) throw new Error("Short-game framing did not expose map and aim bounds");
  const mapRotation = Number(await page.locator(".map-world-real").getAttribute("data-rotation-deg"));
  const radians = Math.abs(mapRotation) * Math.PI / 180;
  const rotatedSquareFactor = Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians));
  expect(aimBox.width / rotatedSquareFactor).toBeCloseTo(64, 0);
  expect(aimBox.height / rotatedSquareFactor).toBeCloseTo(64, 0);
  expect(Math.max(aimFaceBox.width, aimFaceBox.height)).toBeLessThan(64);
  const visibleFaceScale = Number(await aimPoint.locator(".aim-point-face").evaluate((element) => getComputedStyle(element).scale));
  expect(visibleFaceScale).toBeGreaterThan(0);
  expect(visibleFaceScale).toBeLessThan(0.7);
  for (const locator of [page.locator(".real-plan-origin"), page.locator(".real-pin-dot"), aimPoint]) {
    const box = await locator.boundingBox();
    if (!box) throw new Error("Short-game framing point did not expose bounds");
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(center.x).toBeGreaterThanOrEqual(mapBox.x);
    expect(center.x).toBeLessThanOrEqual(mapBox.x + mapBox.width);
    expect(center.y).toBeGreaterThanOrEqual(mapBox.y);
    expect(center.y).toBeLessThanOrEqual(mapBox.y + mapBox.height);
  }

  await expect(aimPoint).toBeDisabled();
  await expect(aimPoint).toHaveAccessibleName("Automatic Rule of 12 landing point");
  await expect(page.getByRole("button", { name: "Reset course aim to caddy path" })).toHaveCount(0);
  await expect(helper).not.toContainText("MOVE LANDING POINT ONTO GREEN");
  await expect(helper.getByTestId("rule-of-12-club")).toContainText("PITCHING WEDGE · LAND");
  await helper.getByRole("button", { name: "UPHILL" }).click();
  await expect(ruleReadout).toHaveText(/9 IRON · LAND \d+ YD · ROLL \d+ YD · 1:3/);
  await expect(club).toHaveAttribute("aria-label", /Current club 9 Iron/);
  await expect(trackingStrip).toContainText("TRACKING 9 IRON");
  await helper.getByRole("button", { name: "DOWNHILL" }).click();
  await expect(helper.getByRole("button", { name: "DOWNHILL" })).toHaveAttribute("aria-pressed", "true");
  await expect(ruleReadout).toHaveText("RULE NOT SUITABLE");
  await expect(helper.getByTestId("rule-of-12-club")).toHaveCount(0);
  await expect(club).toHaveAttribute("aria-label", /Current club Sand Wedge/);
  await expect(trackingStrip).toContainText("TRACKING SAND WEDGE");

  await page.getByRole("button", { name: "Place ball" }).click();
  await expect(page.locator(".field-screen")).toHaveAttribute("data-putting", "true");
  await expect(helper).toHaveCount(0);
});

test("caddy quick switch changes the recommended club and aim point", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  const club = page.getByRole("button", { name: /Change club/ });
  const strategy = page.getByTestId("caddy-strategy-button");
  const aim = page.getByTestId("aim-point");

  await expect(strategy).toHaveAttribute("data-strategy", "standard");
  await expect(aim).not.toHaveAttribute("aria-valuenow", "0");
  const standardTeeAim = await aim.getAttribute("aria-valuenow");
  await strategy.click();
  await expect(strategy).toHaveAttribute("data-strategy", "aggressive");
  await expect(aim).not.toHaveAttribute("aria-valuenow", standardTeeAim!);
  await strategy.click();
  await expect(strategy).toHaveAttribute("data-strategy", "safe");
  const safeTeeAim = await aim.getAttribute("aria-valuenow");
  expect(safeTeeAim).not.toBe(standardTeeAim);
  await strategy.click();
  await expect(strategy).toHaveAttribute("data-strategy", "standard");
  await expect(aim).toHaveAttribute("aria-valuenow", standardTeeAim!);

  await page.getByRole("button", { name: "Place ball" }).click();
  await expect(club).toHaveAttribute("aria-label", /Current club Pitching Wedge/);
  const centerAim = await aim.getAttribute("aria-valuenow");

  await strategy.click();
  await expect(strategy).toHaveAttribute("data-strategy", "aggressive");
  await expect(club).toHaveAttribute("aria-label", /Current club Pitching Wedge/);
  await expect(page.getByTestId("real-plan-pin-distance")).toHaveCount(0);

  await strategy.click();
  await expect(strategy).toHaveAttribute("data-strategy", "safe");
  await expect(club).toHaveAttribute("aria-label", /Current club 9 Iron/);
  await expect(aim).toHaveAttribute("aria-valuenow", centerAim!);

  await strategy.click();
  await expect(strategy).toHaveAttribute("data-strategy", "standard");
  await expect(club).toHaveAttribute("aria-label", /Current club Pitching Wedge/);
  await expect(aim).toHaveAttribute("aria-valuenow", centerAim!);

  const aimBox = await aim.boundingBox();
  if (!aimBox) throw new Error("Course aim did not expose its drag target");
  const start = { x: aimBox.x + aimBox.width / 2, y: aimBox.y + aimBox.height / 2 };
  const manualTarget = { x: start.x + 36, y: start.y };
  await aim.dispatchEvent("pointerdown", { pointerId: 1, button: 0, clientX: start.x, clientY: start.y });
  await aim.dispatchEvent("pointermove", { pointerId: 1, button: 0, clientX: manualTarget.x, clientY: manualTarget.y });
  await aim.dispatchEvent("pointerup", { pointerId: 1, button: 0, clientX: manualTarget.x, clientY: manualTarget.y });
  await expect(page.getByRole("button", { name: "Reset course aim to caddy path" })).toBeVisible();
  const manualAim = await aim.getAttribute("aria-valuenow");
  await strategy.click();
  await expect(strategy).toHaveAttribute("data-strategy", "aggressive");
  await expect(aim).toHaveAttribute("aria-valuenow", manualAim!);
});

test("bundled demo fixture places the ball at aim", async ({ page }) => {
  await openField(page);

  await page.getByRole("button", { name: "Place ball" }).click();

  await expect(page.locator(".completed-shot-card")).toContainText("SHOT 2 ·");
  await expect(page.locator(".completed-shot-card")).toContainText("DEMO MANUAL · TRACKING");
  await expect(page.locator(".tracking-strip")).toHaveAttribute("data-tracking-number", "2");
  await expect(page.locator(".route-segment-complete")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("openround:club-statistics:v1"))).toBeNull();
});

test("real course map keeps the tee-to-green bearing top-facing", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);

  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  await expect(page.locator(".real-course-advice")).toHaveCount(0);
  const mapWorld = page.locator(".map-world-real");
  await expect(mapWorld).toHaveAttribute("data-orientation", "top-facing");
  const map = page.locator(".course-map");
  await expect(map).toHaveAttribute("data-planning-focus", "true");
  await expect(map).toHaveAttribute("data-focus-scale", "1.60");
  await expect(page.getByRole("button", { name: "Show full hole" })).toBeVisible();
  const focusedHazardCount = await page.locator(".real-hazard-distance").count();
  expect(focusedHazardCount).toBe(0);
  await page.locator(".real-geometry-bunker").first().dispatchEvent("click");
  await expect(page.locator(".real-hazard-distance")).toHaveCount(1);
  await expect(page.locator(".real-hazard-distance")).toContainText(/BUNKER · \d+ TO/);
  await expect(page.locator(".real-hazard-leader")).toHaveCount(1);
  const leaderGeometry = await page.locator(".real-hazard-leader").evaluate((element) => ({
    x1: Number(element.getAttribute("x1")),
    y1: Number(element.getAttribute("y1")),
    x2: Number(element.getAttribute("x2")),
    y2: Number(element.getAttribute("y2")),
  }));
  expect(Math.hypot(leaderGeometry.x2 - leaderGeometry.x1, leaderGeometry.y2 - leaderGeometry.y1)).toBeGreaterThan(1);
  const leaderAlignment = await page.evaluate(() => {
    const hazard = document.querySelector(".real-geometry-bunker");
    const leader = document.querySelector(".real-hazard-leader");
    if (!(hazard instanceof SVGGraphicsElement) || !(leader instanceof SVGLineElement)) return null;
    const hazardBox = hazard.getBoundingClientRect();
    const leaderMatrix = leader.getScreenCTM();
    if (!leaderMatrix) return null;
    const leaderStart = new DOMPoint(Number(leader.getAttribute("x1")), Number(leader.getAttribute("y1"))).matrixTransform(leaderMatrix);
    return leaderStart.x >= hazardBox.left - 2 && leaderStart.x <= hazardBox.right + 2
      && leaderStart.y >= hazardBox.top - 2 && leaderStart.y <= hazardBox.bottom + 2;
  });
  expect(leaderAlignment).not.toBeNull();
  expect(leaderAlignment).toBe(true);
  const secondHazard = page.locator(".real-geometry-bunker").nth(1);
  await expect(secondHazard).toBeVisible();
  const secondHazardId = await secondHazard.getAttribute("data-hazard-id");
  expect(secondHazardId).toBeTruthy();
  await secondHazard.dispatchEvent("click");
  await expect(page.locator(".real-hazard-distance")).toHaveCount(1);
  await expect(page.locator(".real-hazard-distance")).toHaveAttribute("data-hazard-id", secondHazardId!);
  const secondHazardAlignment = await page.evaluate(() => {
    const hazard = document.querySelectorAll(".real-geometry-bunker")[1];
    const leader = document.querySelector(".real-hazard-leader");
    if (!(hazard instanceof SVGGraphicsElement) || !(leader instanceof SVGLineElement)) return null;
    const hazardBox = hazard.getBoundingClientRect();
    const leaderMatrix = leader.getScreenCTM();
    if (!leaderMatrix) return null;
    const leaderStart = new DOMPoint(Number(leader.getAttribute("x1")), Number(leader.getAttribute("y1"))).matrixTransform(leaderMatrix);
    const withinHazard = leaderStart.x >= hazardBox.left - 2 && leaderStart.x <= hazardBox.right + 2
      && leaderStart.y >= hazardBox.top - 2 && leaderStart.y <= hazardBox.bottom + 2;
    return { withinHazard, x: leaderStart.x, y: leaderStart.y, hazardBox: { left: hazardBox.left, right: hazardBox.right, top: hazardBox.top, bottom: hazardBox.bottom } };
  });
  expect(secondHazardAlignment).not.toBeNull();
  expect(secondHazardAlignment!.withinHazard).toBe(true);
  await page.mouse.click((await map.boundingBox())!.x + 12, (await map.boundingBox())!.y + 12);
  await expect(page.locator(".real-hazard-distance")).toHaveCount(0);
  await page.getByRole("button", { name: "Show full hole" }).click();
  await expect(map).toHaveAttribute("data-planning-focus", "false");
  await expect(map).toHaveAttribute("data-focus-scale", "1.00");
  await page.getByRole("button", { name: "Plan next shot" }).click();
  await expect(map).toHaveAttribute("data-planning-focus", "true");
  const rotation = Number(await mapWorld.getAttribute("data-rotation-deg"));
  expect(Number.isFinite(rotation)).toBe(true);
  expect(Math.abs(rotation)).toBeGreaterThan(1);
  const endpointCenters = await page.evaluate(() => {
    const green = document.querySelector(".real-geometry-green")?.getBoundingClientRect();
    const tees = Array.from(document.querySelectorAll(".real-geometry-tee")).map((element) => element.getBoundingClientRect());
    return {
      greenY: green ? green.top + green.height / 2 : Number.NaN,
      teeY: tees.length > 0 ? Math.min(...tees.map((rect) => rect.top + rect.height / 2)) : Number.NaN,
    };
  });
  expect(endpointCenters.greenY).toBeLessThan(endpointCenters.teeY);

  const mapBox = await map.boundingBox();
  if (!mapBox) throw new Error("Course map did not expose a gesture surface");
  const centerX = mapBox.x + mapBox.width / 2;
  const centerY = mapBox.y + mapBox.height / 2;
  await map.dispatchEvent("pointerdown", { pointerId: 10, pointerType: "touch", clientX: centerX - 40, clientY: centerY });
  await map.dispatchEvent("pointerdown", { pointerId: 11, pointerType: "touch", clientX: centerX + 40, clientY: centerY });
  await map.dispatchEvent("pointermove", { pointerId: 11, pointerType: "touch", clientX: centerX + 70, clientY: centerY });
  await expect(page.getByRole("button", { name: "Reset map zoom" })).toBeVisible();
  await map.dispatchEvent("pointerup", { pointerId: 11, pointerType: "touch", clientX: centerX + 70, clientY: centerY });
  await map.dispatchEvent("pointerup", { pointerId: 10, pointerType: "touch", clientX: centerX - 40, clientY: centerY });
  await page.getByRole("button", { name: "Reset map zoom" }).click();
  await expect(map).toHaveAttribute("data-rendered-scale", "1.60");

  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "PIN THE FLAG" })).toBeVisible();
  await expect(page.locator(".course-map")).toHaveAttribute("data-rendered-scale", "6.40");
  await page.getByRole("button", { name: "Cancel pin placement" }).click();
  await expect(map).toHaveAttribute("data-rendered-scale", "1.60");
});

test("real-course tracking fails closed when the GPS fix becomes stale", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 32.25769, longitude: -97.72271, accuracy: 8 });
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Apache Links");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Links Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();
  await page.getByRole("button", { name: "Resume tracking" }).click();
  await expect(page.getByText("TRACKING DRIVER")).toBeVisible();

  // Age the browser's actual GPS evidence instead of using a demo-only switch.
  await page.clock.setFixedTime(new Date(Date.now() + 60_000));
  await page.getByTestId("at-my-ball").click();

  await expect(page.locator(".field-notice")).toHaveCount(0);
  await expect(page.getByText("TRACKING DRIVER")).toBeVisible();
  await expect(page.getByText(/No shot recorded|Driver paused/)).toHaveCount(0);
});

test("manual aim drag keeps the real-course target under the pointer", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();
  await expect(page.getByRole("dialog", { name: "Choose course" })).toHaveCount(0);

  const aim = page.getByTestId("aim-point");
  const aimBox = await aim.boundingBox();
  if (!aimBox) throw new Error("Manual real-course aim did not expose bounds");
  const start = { x: aimBox.x + aimBox.width / 2, y: aimBox.y + aimBox.height / 2 };
  const target = { x: start.x, y: start.y + 64 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y);
  const draggedAimBox = await aim.boundingBox();
  if (!draggedAimBox) throw new Error("Dragging aim did not preserve bounds");
  expect(Math.abs(draggedAimBox.x + draggedAimBox.width / 2 - target.x)).toBeLessThan(3);
  expect(Math.abs(draggedAimBox.y + draggedAimBox.height / 2 - target.y)).toBeLessThan(3);
  await page.mouse.up();
});

test("loading a new hole never uses stale geometry for Rule of 12 eligibility", async ({ page }) => {
  test.setTimeout(20_000);
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();
  await page.evaluate(() => {
    const courseId = "personal-squaw-valley-lakes-pending-v1";
    window.localStorage.setItem("openround:round-session:v1", JSON.stringify({
      version: 1,
      roundId: `${courseId}:1`,
      courseId,
      holeNumber: 1,
      score: 4,
      lockedShots: [{
        id: 1,
        number: 1,
        club: "DRIVER",
        totalGps: 340,
        start: { lon: -97.721512, lat: 32.2606722 },
        end: { lon: -97.7247875, lat: 32.26269 },
        evidence: "demo_manual",
        provenance: "prototype_fixture",
        reviewed: false,
        clubProfileId: "driver",
        caddyAim: null,
        plannedAim: null,
        realPlannedAim: null,
      }],
      manualEntries: [],
    }));
  });
  await page.reload();
  await expect(page.getByTestId("rule-of-12-helper")).toBeVisible();

  let releaseHoleTwoArtifact: (() => void) | undefined;
  const holeTwoArtifactRequested = new Promise<void>((resolve) => {
    page.route("**/personal-squaw-valley-lakes-pending-v1/hole-2.json", async (route) => {
      resolve();
      await new Promise<void>((release) => { releaseHoleTwoArtifact = release; });
      await route.continue();
    });
  });
  await openCourseSheetFromMenu(page);
  await page.getByRole("button", { name: "EDIT ROUND SETUP" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("2");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();
  await holeTwoArtifactRequested;

  await expect(page.getByTestId("rule-of-12-helper")).toHaveCount(0);
  await expect(page.locator(".course-map")).toHaveAttribute("data-rule-of-12", "false");
  await expect(page.locator(".real-geometry-layer")).toHaveCount(0);
  releaseHoleTwoArtifact?.();
  await expect(page.locator(".real-geometry-layer")).toHaveCount(1);
  await page.unroute("**/personal-squaw-valley-lakes-pending-v1/hole-2.json");
});

test("active shot distance falls back to a fresh GPS request when the watcher stalls", async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    const tee = { latitude: 32.25769, longitude: -97.72271, accuracy: 4 };
    const ball = { ...tee, latitude: tee.latitude + 0.00082 };
    const fartherBall = { ...tee, latitude: tee.latitude + 0.00164 };
    const position = (coords: typeof tee, timestamp = Date.now()) => ({ coords, timestamp }) as GeolocationPosition;
    const state = {
      requests: 0,
      watches: 0,
      cleared: 0,
      watch: null as PositionCallback | null,
      pending: null as { success: PositionCallback; position: GeolocationPosition } | null,
      resume: false,
      completePending() {
        const pending = state.pending;
        state.pending = null;
        pending?.success(pending.position);
      },
      deliverNewerWatcher() {
        state.watch?.(position(fartherBall));
      },
    };
    Object.defineProperty(window, "__liveShotGps", { value: state });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          state.requests += 1;
          if (state.requests === 1) success(position(tee));
          else if (state.requests === 2) success(position({ ...ball, accuracy: 20 }));
          else if (state.requests === 3) success(position(ball));
          else if (state.resume) {
            state.resume = false;
            success(position(tee));
          } else state.pending = { success, position: position(ball) };
        },
        watchPosition(success: PositionCallback) {
          state.watches += 1;
          state.watch = success;
          window.setTimeout(() => success(position(tee)), 0);
          return state.watches;
        },
        clearWatch() {
          state.cleared += 1;
        },
      },
    });
  });
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Apache Links");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Links Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  await page.getByRole("button", { name: "Resume tracking" }).click();
  const card = page.getByTestId("real-driver-shot-card");
  await expect(card).toContainText("0 YD");
  await expect(card.locator("strong")).toHaveText("100 YD", { timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __liveShotGps: { requests: number } }).__liveShotGps.requests)).toBe(3);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __liveShotGps: { requests: number } }).__liveShotGps.requests)).toBe(4);
  await page.evaluate(() => (window as typeof window & { __liveShotGps: { deliverNewerWatcher(): void } }).__liveShotGps.deliverNewerWatcher());
  await expect(card.locator("strong")).toHaveText("199 YD");
  await page.waitForTimeout(3_500);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __liveShotGps: { requests: number } }).__liveShotGps.requests)).toBe(4);
  await page.evaluate(() => (window as typeof window & { __liveShotGps: { completePending(): void } }).__liveShotGps.completePending());
  await expect(card.locator("strong")).toHaveText("199 YD");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __liveShotGps: { requests: number } }).__liveShotGps.requests)).toBe(5);

  await page.getByRole("button", { name: /Cancel tracking/i }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __liveShotGps: { cleared: number } }).__liveShotGps.cleared)).toBe(1);
  const requestsAfterCancel = await page.evaluate(() => (window as typeof window & { __liveShotGps: { requests: number } }).__liveShotGps.requests);
  await page.evaluate(() => (window as typeof window & { __liveShotGps: { completePending(): void } }).__liveShotGps.completePending());
  await expect(card).toHaveCount(0);
  await page.waitForTimeout(3_500);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __liveShotGps: { requests: number } }).__liveShotGps.requests)).toBe(requestsAfterCancel);
  await page.evaluate(() => { (window as typeof window & { __liveShotGps: { resume: boolean } }).__liveShotGps.resume = true; });
  await page.getByRole("button", { name: "Resume tracking" }).click();
  await expect(card.locator("strong")).toHaveText("0 YD");
});

test("incomplete Squaw Valley Lakes holes fail closed for hazard distances", async ({ page }) => {
  await openField(page);
  await openCourseSheetFromMenu(page);

  const search = page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" });
  await search.fill("Comanche Lakes");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Lakes Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("13");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  await expect(page.locator(".real-course-advice")).toHaveCount(0);
  await expect(page.locator(".real-hazard-distance")).toHaveCount(0);
  await expect(page.getByText(/hazard distances unavailable/i)).toHaveCount(0);
});

test("real-course GPS locking starts the next club leg and keeps shot history on the map", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 32.25769, longitude: -97.72271, accuracy: 8 });
  await openField(page);
  await openCourseSheetFromMenu(page);
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Apache Links");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Links Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();

  await page.getByRole("button", { name: "Resume tracking" }).click();
  await expect(page.getByText("TRACKING DRIVER")).toBeVisible();
  await expect(page.locator(".tracking-strip")).toContainText("GPS");
  await expect(page.getByTestId("real-driver-shot-card")).toContainText("SHOT 1 · DRIVER");

  await context.setGeolocation({ latitude: 32.25845, longitude: -97.72271, accuracy: 4 });
  await expect(page.getByTestId("real-driver-shot-card")).not.toContainText("0 YD");
  await page.getByTestId("at-my-ball").click();
  await expect(page.locator(".field-notice")).toHaveCount(0);
  await expect(page.locator(".tracking-strip")).toHaveAttribute("data-tracking-number", "2");
  await page.locator("button.club-panel").click();
  await page.locator('.club-ladder-option[data-club-id="7i"]').dblclick();
  await expect(page.getByText(/TRACKING 7 IRON/)).toBeVisible();
  await expect(page.locator(".real-shot-line")).toHaveCount(1);
  await expect(page.getByTestId("real-driver-shot-card")).toContainText(/SHOT 2 · 7 IRON/);
  await expect(page.getByTestId("real-driver-shot-card")).toContainText(/LIVE GPS · TRACKING/);

  await context.setGeolocation({ latitude: 32.25935, longitude: -97.72271, accuracy: 4 });
  await expect(page.getByTestId("real-driver-shot-card")).not.toContainText("0 YD");
  await page.getByTestId("at-my-ball").click();
  await expect(page.locator(".field-notice")).toHaveCount(0);
  await expect(page.locator(".tracking-strip")).toHaveAttribute("data-tracking-number", "3");
  await expect(page.getByTestId("real-driver-shot-card")).toContainText("SHOT 3");
  await expect(page.locator(".real-shot-line")).toHaveCount(2);
  await expect.poll(async () => page.evaluate(() => {
    const raw = window.localStorage.getItem("openround:club-statistics:v1");
    return raw ? JSON.parse(raw).records.length : 0;
  })).toBe(2);
  const clubStatistics = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openround:club-statistics:v1") ?? "null"));
  expect(clubStatistics.records).toEqual(expect.arrayContaining([
    expect.objectContaining({ clubId: "club-1", clubName: "DRIVER", kind: "automatic_drive" }),
    expect.objectContaining({ clubId: "club-7", clubName: "7 IRON", kind: "gps" }),
  ]));
  const nextAim = page.getByTestId("aim-point");
  await expect(nextAim).toBeEnabled();
  await expect(nextAim).toHaveAttribute("data-locked", "false");
  await expect(nextAim).toHaveAttribute("aria-valuetext", /yards to aim/);
  const nextClubTracking = await page.locator(".tracking-strip > strong").innerText();
  await page.getByRole("button", { name: /Cancel tracking/i }).click();
  await page.getByRole("button", { name: "Resume tracking" }).click();
  await expect(page.locator(".tracking-strip")).toHaveAttribute("data-tracking-number", "3");
  await expect(page.locator(".tracking-strip > strong")).toHaveText(nextClubTracking);
  await expect(nextAim).toBeEnabled();
});

test("score stepper respects the recorded-stroke floor when drafting hole stats", async ({ page }) => {
  await openField(page);

  await page.getByRole("button", { name: "+ Shot" }).click();
  await page.getByTestId("add-shot-sheet").getByTestId("add-shot-club-club-14").click();
  await page.getByRole("button", { name: "+ Shot" }).click();
  await page.getByTestId("add-shot-sheet").getByTestId("add-penalty-stroke").click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.locator(".score-editor > div > strong")).toHaveText("5");
  await page.getByRole("button", { name: "Subtract stroke" }).click();
  await page.getByRole("button", { name: "Subtract stroke" }).click();
  await page.getByRole("button", { name: "Subtract stroke" }).click();
  await expect(page.locator(".score-editor > div > strong")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Subtract stroke" })).toBeDisabled();
  await expect(page.locator(".score-editor")).toContainText("At least 2 strokes recorded for this hole.");
  await page.keyboard.press("Escape");

  // The hook drafts the score into hole outcomes as it changes; none may
  // contradict the recorded-stroke floor.
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openround:on-course:v1") ?? "null"));
  expect(stored.holes.filter((hole: { holeNumber: number }) => hole.holeNumber === 7).every((hole: { score: number }) => hole.score >= 2)).toBe(true);

  await page.getByRole("button", { name: "Stats", exact: true }).click();
  const insights = page.getByTestId("insights-sheet");
  await expect(insights).toContainText("2 STROKES");
  await insights.getByTestId("putts-plus").click();
  await insights.getByTestId("save-hole-insights").click();

  const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openround:on-course:v1") ?? "null"));
  expect(saved.holes).toEqual(expect.arrayContaining([
    expect.objectContaining({ holeNumber: 7, score: 2 }),
  ]));
});

test("adding a second manual stroke keeps the drafted score at the evidence floor", async ({ page }) => {
  await openField(page);

  // Lower the drafted score to the no-evidence floor of 1.
  await page.getByRole("button", { name: "Score", exact: true }).click();
  await page.getByRole("button", { name: "Subtract stroke" }).click();
  await page.getByRole("button", { name: "Subtract stroke" }).click();
  await page.getByRole("button", { name: "Subtract stroke" }).click();
  await expect(page.locator(".score-editor > div > strong")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Subtract stroke" })).toBeDisabled();
  await page.keyboard.press("Escape");

  // First recorded stroke: floor rises to 1, drafted score stays coherent.
  await page.getByRole("button", { name: "+ Shot" }).click();
  await page.getByTestId("add-shot-sheet").getByTestId("add-shot-club-club-14").click();
  await page.keyboard.press("Escape");

  // Second recorded stroke: the penalty adds one to the score, matching the floor.
  await page.getByRole("button", { name: "+ Shot" }).click();
  await page.getByTestId("add-shot-sheet").getByTestId("add-penalty-stroke").click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.locator(".score-editor > div > strong")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Subtract stroke" })).toBeDisabled();
  await expect(page.locator(".score-editor")).toContainText("At least 2 strokes recorded for this hole.");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Stats", exact: true }).click();
  const insights = page.getByTestId("insights-sheet");
  await insights.getByTestId("putts-plus").click();
  await insights.getByTestId("save-hole-insights").click();

  const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openround:on-course:v1") ?? "null"));
  expect(saved.holes).toEqual(expect.arrayContaining([
    expect.objectContaining({ holeNumber: 7, score: 2 }),
  ]));
});

test("a restored score below recorded strokes is reconciled to the evidence floor after reload", async ({ page }) => {
  await openField(page);

  // Simulate a contradictory state written by an older version: two recorded
  // strokes for the demo hole but persisted scores of 1.
  await page.evaluate(() => {
    const log = JSON.parse(window.localStorage.getItem("openround:round-log:v1") ?? "null");
    const baseEvent = {
      clubId: "club-14",
      clubName: "Putter",
      distanceYards: null,
      evidence: "manual",
      holeNumber: 7,
      strokes: 1,
    };
    log.events = [
      ...log.events,
      { ...baseEvent, id: "e-legacy-1", kind: "manual_shot", sequence: 901, createdAt: new Date().toISOString() },
      { ...baseEvent, id: "e-legacy-2", kind: "penalty_stroke", clubId: null, clubName: null, sequence: 902, createdAt: new Date().toISOString() },
    ];
    log.score = 1;
    window.localStorage.setItem("openround:round-log:v1", JSON.stringify(log));

    const session = JSON.parse(window.localStorage.getItem("openround:round-session:v1") ?? "null");
    if (session) session.score = 1;
    window.localStorage.setItem("openround:round-session:v1", JSON.stringify(session));

    const onCourse = JSON.parse(window.localStorage.getItem("openround:on-course:v1") ?? "null");
    if (onCourse) {
      onCourse.holes = onCourse.holes.filter((hole: { holeNumber: number }) => hole.holeNumber !== 7);
    }
    window.localStorage.setItem("openround:on-course:v1", JSON.stringify(onCourse));
  });

  await page.reload();
  await expect(page.getByTestId("openround-field")).toBeVisible({ timeout: 5_000 });

  const restoredLog = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openround:round-log:v1") ?? "null"));
  expect(restoredLog.score).toBe(2);

  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.locator(".score-editor > div > strong")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Subtract stroke" })).toBeDisabled();
  await expect(page.locator(".score-editor")).toContainText("At least 2 strokes recorded for this hole.");
});
