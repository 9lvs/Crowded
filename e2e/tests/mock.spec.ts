/* Mock mode smoke tests. No backend data needed: ?mock=1 runs the in-memory API.
   Mock mode is only allowed on localhost or file pages, which is where these run. */
import { expect, test } from "@playwright/test";
import { collectErrors } from "./helpers";

test("student app core flow in mock mode", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/index.html?mock=1");
  await expect(page.getByText("Demo mode.").first()).toBeVisible();
  await page.getByRole("checkbox", { name: /21 or older/ }).check();
  await page.getByLabel("Phone number").fill("5550001111");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use it" }).click();
  await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Bars tonight" }).getByRole("listitem")).toHaveCount(3);

  await page.getByRole("button", { name: /^FAKE The Tipsy Owl\./ }).click();
  await expect(page.getByRole("region", { name: "Right now" })).toBeVisible();
  await page.getByRole("button", { name: "Report crowd", exact: true }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "Packed" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Report sent")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5_000 });

  await page.getByRole("button", { name: "I'm in line" }).click();
  await expect(page.getByText("You're in line at")).toBeVisible();
  await page.getByRole("button", { name: "Left the line" }).click();
  await expect(page.getByRole("heading", { name: "Line left" })).toBeVisible();

  await page.goto("/index.html?mock=1#/settings");
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
});

test("staff counter in mock mode", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/staff.html?mock=1");
  await expect(page.getByRole("heading", { name: "Door counter" })).toBeVisible();
  await page.getByRole("checkbox", { name: /21 or older/ }).check();
  await page.getByLabel("Phone number").fill("5550002222");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use it" }).click();
  await page.getByLabel("Invite code").fill("FAKE-INVITE");
  await page.getByRole("button", { name: "Join bar" }).click();
  await expect(page.getByRole("button", { name: "One person in" })).toBeVisible();
  await page.getByRole("button", { name: "One person in" }).click();
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await page.getByRole("radio", { name: /Short/ }).click();
  await expect(page.getByText("What students see")).toBeVisible();
  expect(errors).toEqual([]);
});

test("mock mode keeps its own storage and never touches the real refresh token", async ({ page }) => {
  await page.goto("/index.html");
  await page.evaluate(() => window.localStorage.setItem("crowded.rt", "REAL-TOKEN-SENTINEL"));
  await page.goto("/index.html?mock=1");
  await page.getByRole("checkbox", { name: /21 or older/ }).check();
  await page.getByLabel("Phone number").fill("5550003333");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use it" }).click();
  await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();
  const keys = await page.evaluate(() => ({
    real: window.localStorage.getItem("crowded.rt"),
    mock: window.localStorage.getItem("crowded.mock.rt"),
  }));
  expect(keys.real).toBe("REAL-TOKEN-SENTINEL");
  expect(keys.mock).toBeTruthy();
});
