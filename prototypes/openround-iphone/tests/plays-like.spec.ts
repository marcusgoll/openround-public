import { expect, test } from "@playwright/test";

test("Plays Like explains the header and sends the same adjusted target to clubs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "START ROUND", exact: true }).click();
  await page.getByRole("button", { name: "BEGIN ROUND", exact: true }).click();
  const header = page.getByTestId("aim-distance");
  const initial = await header.textContent();
  await page.getByRole("button", { name: "Plays Like distance breakdown", exact: true }).click();
  await expect(page.getByTestId("plays-like-total")).toHaveText(`${initial} YD`);
  const base = Number((await page.getByTestId("distance-base").textContent())!.split(" ")[0]);
  await expect(page.getByTestId("plays-like-total")).toHaveText(`${Math.round(base + 0.8 + 2)} YD`);
  await expect(page.getByTestId("distance-breakdown").getByText("Not applied", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "HEADWIND", exact: true }).click();
  await page.getByRole("slider", { name: "Wind speed", exact: true }).press("End");
  const target = Math.round(base + 30 * 0.65 + 2);
  await expect(page.getByTestId("distance-wind")).toHaveText("+19.50 yd");
  await expect(page.getByTestId("plays-like-total")).toHaveText(`${target} YD`);
  await page.getByTestId("distance-club-recommendation").click();
  await expect(page.getByTestId("club-selector-concept-3")).toBeVisible();
  await expect(page.getByRole("heading", { name: `Club for ${target} yd`, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(header).toHaveText(String(target));
});
