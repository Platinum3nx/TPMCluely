import { expect, test } from "@playwright/test";

test("placeholder desktop shell smoke test", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/TPMCluely Foundation/i)).toBeVisible();
});
