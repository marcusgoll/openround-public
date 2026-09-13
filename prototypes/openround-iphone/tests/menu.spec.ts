import { expect, test } from "@playwright/test";

test("Menu keeps round actions accessible and demo controls out of real play", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "START ROUND", exact: true }).click();
  await page.getByRole("button", { name: "BEGIN ROUND", exact: true }).click();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByTestId("menu-sheet").getByRole("button", { name: /Add shot|Score|Pin options|Equipment|Start screen|Hole insights/i })).toHaveCount(0);
  await expect(page.getByTestId("menu-field-log")).toBeHidden();
  const arcs = page.getByTestId("menu-distance-arcs");
  const previous = await arcs.getAttribute("aria-pressed");
  await arcs.click();
  await expect(arcs).toHaveAttribute("aria-pressed", previous === "true" ? "false" : "true");
  await page.getByText("Course & app details", { exact: true }).click();
  await expect(page.getByTestId("menu-field-log")).toBeVisible();
  await expect(page.getByRole("button", { name: "RESET HOLE 7 DEMO" })).toHaveCount(0);
  await expect(page.getByText("GPS DEMO STATE", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add putt", exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "DEMO ROUND", exact: true }).click();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByText("Course & app details", { exact: true }).click();
  await expect(page.getByRole("button", { name: "RESET HOLE 7 DEMO" })).toBeVisible();
  await expect(page.getByText("GPS DEMO STATE", { exact: true })).toBeVisible();
});
