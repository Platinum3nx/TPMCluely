import { expect, test } from "@playwright/test";

test("placeholder desktop shell smoke test", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/TPMCluely Foundation/i)).toBeVisible();
  await page.keyboard.press("Control+Shift+K");
  await expect(page.getByRole("button", { name: /Start Session/i })).toBeVisible();
  await page.getByRole("button", { name: /Start Session/i }).click();
  await expect(page.getByRole("button", { name: /Share Screen/i })).toBeVisible();
});
