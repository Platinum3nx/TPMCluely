import { expect, test } from "@playwright/test";

test("desktop shell smoke test", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/TPMCluely Desktop/i)).toBeVisible();
  await page.keyboard.press("Control+Shift+K");
  await expect(page.getByRole("button", { name: /Start Meeting/i })).toBeVisible();
  await page.getByRole("button", { name: /Start Meeting/i }).click();
  await expect(page.getByRole("button", { name: /Share Screen/i })).toBeVisible();
});
