import { expect, test, type Page } from "@playwright/test";

async function selectClub(page: Page, clubId: string) {
  await page.locator("button.club-panel").click();
  await page.locator(`.club-ladder-option[data-club-id="${clubId}"]`).dblclick();
  await expect(page.getByRole("dialog", { name: /Club for/i })).toBeHidden();
}

test("live shots continue past the second stroke and retain the selected club", async ({ page, context }) => {
  test.slow();
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 32.25769, longitude: -97.72271, accuracy: 4 });
  await page.goto("/");
  await page.getByRole("button", { name: "DEMO ROUND", exact: true }).click();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "CHOOSE COURSE", exact: true }).click();
  await page.getByRole("textbox", { name: "COURSE, CITY, OR STATE" }).fill("Apache Links");
  await page.getByRole("button", { name: "Squaw Valley Golf Course · Links Glen Rose, TX 18H" }).click();
  await page.getByRole("combobox", { name: "START HOLE" }).selectOption("1");
  await page.getByRole("button", { name: "CONFIRM COURSE" }).click();
  await page.getByTestId("at-my-ball").click();
  await expect(page.locator(".tracking-strip")).toHaveAttribute("data-tracking-number", "1");

  const clubs = ["7i", "8i", "9i"];
  const labels = ["7 IRON", "8 IRON", "9 IRON"];
  for (let index = 0; index < clubs.length; index += 1) {
    await selectClub(page, clubs[index]!);
    await expect(page.locator(".tracking-strip")).toContainText(`TRACKING ${labels[index]}`);
    await context.setGeolocation({ latitude: 32.25769 + (index + 1) * 0.0008, longitude: -97.72271, accuracy: 4 });
    await expect(page.getByTestId("real-driver-shot-card")).not.toContainText("0 YD");
    await page.getByTestId("at-my-ball").click();
    await expect(page.locator(".tracking-strip")).toHaveAttribute("data-tracking-number", String(index + 2));
  }

  const events = await page.evaluate(() => JSON.parse(localStorage.getItem("openround:round-log:v1") ?? "null").events);
  expect(events).toHaveLength(3);
  expect(events.map((event: { clubId: string; clubName: string }) => [event.clubId, event.clubName])).toEqual([
    ["club-7", "7 IRON"], ["club-8", "8 IRON"], ["club-9", "9 IRON"],
  ]);
  expect(events.every((event: { evidence: string; distanceYards: number }) => event.evidence === "total_gps" && event.distanceYards > 5)).toBe(true);
  await expect(page.getByTestId("aim-point")).toBeEnabled();
  // Statistics are ingested after the shot log render; finish persistence
  // before reloading, then verify ending the round adds no duplicate samples.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("openround:club-statistics:v1")!).records.length)).toBe(3);
  await page.reload();
  await expect(page.locator(".tracking-strip")).toHaveAttribute("data-tracking-number", "4");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("openround:club-statistics:v1")!).records.length)).toBe(3);
  const beforeEnd = await page.evaluate(() => JSON.parse(localStorage.getItem("openround:club-statistics:v1")!).records.length);
  await page.getByTestId("field-nav-home").click();
  await page.getByRole("button", { name: "END ROUND", exact: true }).click();
  await page.getByRole("dialog", { name: "End current round" }).getByRole("button", { name: "END ROUND", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("openround:club-statistics:v1")!).records.length)).toBe(beforeEnd);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("openround:rounds:v1")!)[0].holes[0].log.events.length)).toBe(3);
});
