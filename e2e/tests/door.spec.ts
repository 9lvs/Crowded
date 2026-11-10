/* Door mode: tap zones, clicker keys, undo, offline queue, count sync, line checks, reminders.
   The real backend test shares one door staff account, made through the admin API. Line checks
   under 30 seconds are not counted by the server, so the real test starts one early and waits. */
import { APIRequestContext, expect, test } from "@playwright/test";
import { ApiSession, auth, adminSignIn, barIdByName, collectErrors, openAs, SEED_BARS, staffAt } from "./helpers";

let staff: ApiSession;
let barId: string;

async function headcount(request: APIRequestContext): Promise<number> {
  const r = await request.get(`/v1/staff/bars/${barId}`, { headers: auth(staff) });
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()).headcount as number;
}

test.beforeAll(async ({ request }) => {
  const admin = await adminSignIn(request);
  barId = await barIdByName(request, admin, SEED_BARS[0]);
  staff = await staffAt(request, admin, barId, "door");
});

test("door mode: tap zones, clicker keys, undo, offline queue, count sync and line check", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);

  await openAs(page, staff, "/staff.html");
  const count = page.getByRole("region", { name: "Headcount" });
  const num = count.locator("p").nth(1);
  await expect(page.getByText(/in · \d+ out tonight/)).toBeVisible();
  await expect(page.getByText(/Clicker ready/)).toBeVisible();
  const before = Number(await num.innerText());

  await test.step("tap zone, ArrowRight and PageDown count In", async () => {
    await page.getByRole("button", { name: "One person in" }).click();
    await expect(num).toHaveText(String(before + 1));
    await page.keyboard.press("ArrowRight");
    await expect(num).toHaveText(String(before + 2));
    await page.keyboard.press("PageDown");
    await expect(num).toHaveText(String(before + 3));
    await expect.poll(() => headcount(request)).toBe(before + 3);
  });

  await test.step("undo and a clicker Out", async () => {
    await page.getByRole("button", { name: "Undo last tap" }).click();
    await expect(num).toHaveText(String(before + 2));
    await expect.poll(() => headcount(request)).toBe(before + 2);
    await page.keyboard.press("ArrowLeft");
    await expect(num).toHaveText(String(before + 1));
    await page.getByRole("button", { name: "Three people in" }).click();
    await expect(num).toHaveText(String(before + 4));
    await expect.poll(() => headcount(request)).toBe(before + 4);
  });

  await test.step("taps made offline are kept and saved when the network returns", async () => {
    await page.route("**/v1/staff/bars/*/door", (route) => route.abort("failed"));
    await page.getByRole("button", { name: "One person in" }).click();
    await expect(num).toHaveText(String(before + 5));
    await expect(page.getByText(/Saving when back online/)).toBeVisible();
    await page.unroute("**/v1/staff/bars/*/door");
    await expect(page.getByText(/Saving when back online/)).toHaveCount(0, { timeout: 15_000 });
    await expect(num).toHaveText(String(before + 5));
    await expect.poll(() => headcount(request)).toBe(before + 5);
  });

  await test.step("clicker total sets the headcount", async () => {
    await page.getByRole("button", { name: "Clicker total" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "1", exact: true }).click();
    await sheet.getByRole("button", { name: "2", exact: true }).click();
    await sheet.getByRole("button", { name: "0", exact: true }).click();
    await expect(sheet.getByRole("status")).toHaveText("120");
    await sheet.getByRole("button", { name: "Set inside now" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5_000 });
    await expect(num).toHaveText("120");
    await expect.poll(() => headcount(request)).toBe(120);
  });

  await test.step("start a line check", async () => {
    await page.getByRole("button", { name: "Line", exact: true }).click();
    await page.getByRole("button", { name: "Time the line" }).click();
    await expect(page.getByRole("group", { name: "Line check 1 running" })).toBeVisible();
  });
  const sampleStarted = Date.now();

  await test.step("finish the line check and see the last measured wait", async () => {
    const wait = 32_000 - (Date.now() - sampleStarted);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.getByRole("group", { name: "Line check 1 running" }).getByRole("button", { name: "They're in" }).click();
    await page.getByRole("button", { name: "Line", exact: true }).click();
    await expect(page.getByText(/Last line check: \d+ min, /)).toBeVisible();
  });

  // The aborted request in the offline step logs one network error. Nothing else may log.
  expect(errors.filter((e) => !/ERR_FAILED/.test(e))).toEqual([]);
});

test("door mode in mock mode: taps, keys, undo, line check, reminders, no console errors", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.install();
  await page.goto("/staff.html?mock=1");
  await page.getByRole("checkbox", { name: /21 or older/ }).check();
  await page.getByLabel("Phone number").fill("5550005555");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use it" }).click();
  await page.getByLabel("Invite code").fill("FAKE-INVITE");
  await page.getByRole("button", { name: "Join bar" }).click();

  const num = page.getByRole("region", { name: "Headcount" }).locator("p").nth(1);
  await expect(page.getByRole("button", { name: "One person in" })).toBeVisible();
  await page.clock.runFor(1_000);
  await expect(page.getByText(/in · \d+ out tonight/)).toBeVisible();
  const before = Number(await num.innerText());
  await page.getByRole("button", { name: "One person in" }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("PageDown");
  await expect(num).toHaveText(String(before + 3));
  await page.getByRole("button", { name: "Undo last tap" }).click();
  await expect(num).toHaveText(String(before + 2));
  await page.keyboard.press(",");
  await expect(num).toHaveText(String(before + 1));

  await page.getByRole("button", { name: "Clicker total" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "9", exact: true }).click();
  await sheet.getByRole("button", { name: "Set inside now" }).click();
  await expect(num).toHaveText("9");

  await page.getByRole("button", { name: "Line", exact: true }).click();
  await page.getByRole("button", { name: "Time the line" }).click();
  await page.getByRole("button", { name: "Time the line" }).click();
  await expect(page.getByRole("button", { name: "2 line checks running" })).toBeDisabled();
  await page.clock.runFor(5_000);
  await page.getByRole("group", { name: "Line check 1 running" }).getByRole("button", { name: "They're in" }).click();
  await page.getByRole("group", { name: "Line check 1 running" }).getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(/Last line check: \d+ min, /)).toBeVisible();

  // Reminders show up after 15 and 20 minutes and can be dismissed.
  await page.getByRole("button", { name: "Door", exact: true }).click();
  await page.clock.runFor("16:00");
  await expect(page.getByText("Update inside: how busy and drink wait")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss: Update inside: how busy and drink wait" }).click();
  await expect(page.getByText("Update inside: how busy and drink wait")).toHaveCount(0);
  await expect(page.getByText("Update the line size")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss: Update the line size" }).click();
  await expect(page.getByText("Update the line size")).toHaveCount(0);
  await page.clock.runFor("05:00");
  await expect(page.locator(".reminder__text").filter({ hasText: "Time the line" })).toBeVisible();
  expect(errors).toEqual([]);
});
