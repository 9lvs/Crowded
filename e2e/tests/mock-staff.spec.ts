/* Mock mode smoke run for staff levels, count in only bars, inside conditions and the student
   drink wait. No backend needed. The page signs in as three FAKE staff accounts in turn and the
   whole run must log zero console errors. Mock invite codes: MANAGER... makes a manager and
   ENTRY... joins the count in only bar. Anything else is door staff. */
import { expect, Page, test } from "@playwright/test";
import { collectErrors } from "./helpers";

const LANTERN = "00000000-0000-4000-8000-000000000002";

async function mockStaffSignIn(page: Page, phone: string, invite: string): Promise<void> {
  await page.goto("/staff.html?mock=1");
  await page.evaluate(() => {
    window.sessionStorage.clear();
    window.localStorage.removeItem("crowded.mock.rt");
  });
  await page.goto("/staff.html?mock=1");
  await page.getByRole("checkbox", { name: /21 or older/ }).check();
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use it" }).click();
  await page.getByLabel("Invite code").fill(invite);
  await page.getByRole("button", { name: "Join bar" }).click();
}

test("mock smoke: door staff, count in only bar, manager, student drinks, no console errors", async ({ page }) => {
  const errors = collectErrors(page);

  // Door staff: three tabs, inside conditions, no door code and no Specials.
  await mockStaffSignIn(page, "5550006661", "FAKE-DOOR-STAFF");
  const tabs = page.getByRole("navigation", { name: "Staff sections" });
  await expect(tabs.getByRole("button")).toHaveText(["Door", "Line", "Inside"]);
  await expect(page.getByRole("button", { name: "One person out" })).toBeVisible();
  await tabs.getByRole("button", { name: "Inside" }).click();
  await page.getByRole("radio", { name: "Packed" }).click();
  await page.getByRole("radio", { name: "Over 20" }).click();
  const seen = page.getByRole("region", { name: "What students see inside" });
  await expect(seen).toContainText("Packed");
  await expect(seen).toContainText("Over 20 min");
  await expect(page.getByText("Updated just now")).toBeVisible();
  const refused = await page.evaluate(async (bar) => {
    const api = (window as unknown as { Crowded: { api: Record<string, (...a: unknown[]) => Promise<unknown>> } }).Crowded.api;
    const out: string[] = [];
    for (const call of [() => api.staffSpecials(bar), () => api.updateSettings(bar, { counts_exits: true })]) {
      try {
        await call();
        out.push("allowed");
      } catch (e) {
        out.push((e as { detail: string }).detail);
      }
    }
    return out;
  }, "00000000-0000-4000-8000-000000000001");
  expect(refused).toEqual(["manager_only", "manager_only"]);

  // The student side of the same mock session shows the drink wait.
  await page.goto("/index.html?mock=1");
  await page.getByRole("button", { name: /^FAKE The Tipsy Owl\./ }).click();
  await expect(page.getByRole("region", { name: "Right now" })).toContainText("Over 20 min");
  await expect(page.getByRole("region", { name: "Right now" }).locator(".kpi").filter({ hasText: "Drinks" })).toBeVisible();
  // A student report with a drink wait.
  await page.getByRole("button", { name: "Report crowd", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: "Under 5 min" }).click();
  await sheet.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Report sent")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5_000 });

  // Count in only bar.
  await mockStaffSignIn(page, "5550006662", "ENTRY-ONLY-STAFF");
  await expect(page.getByRole("region", { name: "Entries tonight" })).toContainText("Entries tonight");
  await expect(page.getByText("This bar counts entries only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "One person out" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "One person in" })).toBeVisible();
  const refusedCode = await page.evaluate(async (bar) => {
    const api = (window as unknown as { Crowded: { api: Record<string, (...a: unknown[]) => Promise<unknown>> } }).Crowded.api;
    try {
      await api.staffSpecials(bar);
      return "allowed";
    } catch (e) {
      return (e as { detail: string }).detail;
    }
  }, LANTERN);
  expect(refusedCode).toBe("manager_only");

  // Manager: Manage tab with the toggle, stats and specials.
  await mockStaffSignIn(page, "5550006663", "MANAGER-STAFF");
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Count exits too" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("region", { name: "Tonight so far" })).toContainText("Entries tonight");
  await expect(page.getByRole("region", { name: "Specials" })).toBeVisible();

  expect(errors).toEqual([]);
});
