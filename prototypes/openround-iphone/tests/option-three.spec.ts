import { expect, test } from "@playwright/test";

test("paused tracking keeps its action clear of navigation on short screens", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto("/");
  await page.getByRole("button", { name: "START ROUND", exact: true }).click();
  await page.getByRole("button", { name: "BEGIN ROUND", exact: true }).click();
  const action = page.getByTestId("at-my-ball");
  await expect(action).toContainText("Resume driver");
  await expect(page.locator(".cancel-tracking")).toBeHidden();
  const actionBox = await action.boundingBox();
  const navigationBox = await page.getByRole("navigation", { name: "Primary app navigation" }).boundingBox();
  expect(actionBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(navigationBox!.y);
  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add putt", exact: true })).toBeVisible();
});
