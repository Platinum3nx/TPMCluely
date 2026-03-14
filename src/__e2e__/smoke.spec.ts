import { expect, test } from "@playwright/test";

test("desktop shell smoke test", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/TPMCluely Desktop/i)).toBeVisible();
  await page.getByRole("button", { name: /Session/i }).click();
  await expect(page.getByRole("button", { name: /Start Meeting/i })).toBeVisible();
  await page.getByRole("button", { name: /Start Meeting/i }).click();
  await page.getByPlaceholder(/Ask anything/i).fill("What should I say?");
  await page.getByPlaceholder(/Ask anything/i).press("Enter");
  await page.getByRole("button", { name: /More/i }).click();
  await expect(page.getByText(/Drafting answer/i)).toBeVisible();
  await expect(page.getByText(/No transcript signal captured yet/i)).toBeVisible();
});
