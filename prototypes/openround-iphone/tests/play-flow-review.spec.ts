import { expect, test, type Page } from "@playwright/test";

async function startRound(page: Page) {
  await page.goto("/?variant=c");
  await page.getByRole("button", { name: "START ROUND", exact: true }).click();
  await page.getByRole("button", { name: "BEGIN ROUND" }).click();
  await expect(page.getByTestId("openround-field")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_success, error) => error?.({ code: 1, message: "test denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  });
});

test("map opens while the initial GPS request is pending", async ({ page }) => {
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = () => {}; });
  await startRound(page);
  await expect(page.getByRole("group", { name: "Hole navigation" })).toContainText("HOLE 1");
});

test("hole scores and putts survive navigation, reload, and ending a round", async ({ page }) => {
  await startRound(page);
  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Hole 1 score" })).toBeVisible();
  await page.getByRole("button", { name: "Add stroke", exact: true }).click();
  await page.getByRole("button", { name: "Add putt", exact: true }).click();
  await page.getByRole("button", { name: "SAVE SCORE", exact: true }).click();
  await page.getByRole("button", { name: "Next hole" }).click();
  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Hole 2 score" })).toBeVisible();
  await expect(page.locator(".score-editor")).toContainText("UNDER");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Previous hole" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.locator(".score-editor")).toContainText("5");
  await expect(page.getByTestId("score-putts")).toHaveText("1");
  await page.keyboard.press("Escape");
  await page.getByTestId("field-nav-home").click();
  await page.getByRole("button", { name: "END ROUND", exact: true }).click();
  await page.getByRole("dialog", { name: "End current round" }).getByRole("button", { name: "END ROUND", exact: true }).click();
  await page.getByRole("button", { name: /ROUNDS LOCAL ROUND HISTORY/ }).click();
  await expect(page.getByTestId("completed-round")).toContainText("Squaw Valley");
  await page.getByTestId("completed-round").getByRole("button", { name: "REVIEW ROUND" }).click();
  await expect(page.getByRole("table", { name: "Round scorecard" })).toContainText("5");
  await page.reload();
  await page.getByRole("button", { name: /ROUNDS LOCAL ROUND HISTORY/ }).click();
  await expect(page.getByTestId("completed-round")).toHaveCount(1);
});

test("group scores persist and a second round on the same course starts independently", async ({ page }) => {
  await page.goto("/?variant=c");
  await page.getByRole("button", { name: "START ROUND", exact: true }).click();
  await page.getByRole("button", { name: /ADD GOLFERS FOR SCORING/ }).click();
  await page.getByRole("textbox", { name: "Golfer name" }).fill("Alex");
  await page.getByRole("button", { name: "ADD GOLFER", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "BEGIN ROUND" }).click();
  await page.getByRole("button", { name: "Score", exact: true }).click();
  await page.getByRole("button", { name: "Add stroke for Alex", exact: true }).click();
  await page.getByRole("button", { name: "SAVE SCORE", exact: true }).click();
  await page.getByRole("button", { name: "Next hole" }).click();
  await page.getByRole("button", { name: "Previous hole" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.getByLabel("Alex score", { exact: true })).toContainText("4");
  await page.keyboard.press("Escape");
  await page.getByTestId("field-nav-home").click();
  await page.getByRole("button", { name: "END ROUND", exact: true }).click();
  await page.getByRole("dialog", { name: "End current round" }).getByRole("button", { name: "END ROUND", exact: true }).click();
  await page.getByRole("button", { name: "START ROUND", exact: true }).click();
  await page.getByRole("button", { name: "BEGIN ROUND" }).click();
  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.getByLabel("Alex score", { exact: true })).toContainText("—");
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem("openround:rounds:v1")!));
  expect(records).toHaveLength(2);
  expect(records[0].id).not.toBe(records[1].id);
  expect(records[0].holes[0].friendScores.Alex).toBe(4);
  expect(records[1].holes[0].onCourse.holes).toHaveLength(0);
});

test("failed history save keeps the round editable and a retry retains later scores", async ({ page }) => {
  await startRound(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "openround:rounds:v1") throw new DOMException("Full", "QuotaExceededError");
      original.call(this, key, value);
    };
    (window as any).restoreStorage = () => { Storage.prototype.setItem = original; };
  });
  await page.getByTestId("field-nav-home").click();
  await page.getByRole("button", { name: "END ROUND", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "End current round" });
  await dialog.getByRole("button", { name: "END ROUND", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("could not be saved");
  await dialog.getByRole("button", { name: "KEEP PLAYING" }).click();
  await page.getByRole("button", { name: "RESUME ROUND", exact: true }).click();
  await page.getByRole("button", { name: "Score", exact: true }).click();
  await page.getByRole("button", { name: "Add stroke", exact: true }).click();
  await page.getByRole("button", { name: "SAVE SCORE", exact: true }).click();
  await page.evaluate(() => (window as any).restoreStorage());
  await page.getByTestId("field-nav-home").click();
  await page.getByRole("button", { name: "END ROUND", exact: true }).click();
  await dialog.getByRole("button", { name: "END ROUND", exact: true }).click();
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem("openround:rounds:v1")!));
  expect(records[0].endedAt).not.toBeNull();
  expect(records[0].holes[0].onCourse.holes[0].score).toBe(5);
});

test("existing active sessions migrate into history without losing shots", async ({ page }) => {
  await startRound(page);
  await page.getByRole("button", { name: "+ Shot", exact: true }).click();
  await page.getByRole("button", { name: "Add Putter manual shot", exact: true }).click();
  await page.evaluate(() => localStorage.removeItem("openround:rounds:v1"));
  await page.reload();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("openround:rounds:v1") ?? "[]").length)).toBe(1);
  await page.getByTestId("field-nav-home").click();
  await page.getByRole("button", { name: "END ROUND", exact: true }).click();
  await page.getByRole("dialog", { name: "End current round" }).getByRole("button", { name: "END ROUND", exact: true }).click();
  const record = await page.evaluate(() => JSON.parse(localStorage.getItem("openround:rounds:v1")!)[0]);
  expect(record.endedAt).not.toBeNull();
  expect(record.holes[0].log.events[0].clubName).toBe("Putter");
  expect(record.holes[0].onCourse.holes).toHaveLength(0);
});

test("late start GPS cannot replace the next hole", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (success) => { (window as any).pendingGps = success; };
  });
  await startRound(page);
  await page.getByRole("button", { name: "Next hole" }).click();
  await page.evaluate(() => (window as any).pendingGps({ coords: { latitude: 32.2, longitude: -97.7, accuracy: 4 }, timestamp: Date.now() }));
  await expect(page.getByRole("group", { name: "Hole navigation" })).toContainText("HOLE 2");
  await expect(page.locator(".tracking-strip")).not.toHaveAttribute("data-tracking-number", "1");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("openround:active-round:v1")!).holeNumber)).toBe(2);
});
