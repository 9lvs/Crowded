/* Door mode: tap zones, clicker keys, undo, offline queue, count sync, line checks, door code.
   Real backend tests share one staff account and one student, all through the API. That is 3
   sign ins, none through the UI. Line checks and timers under 30 seconds are not counted by the
   server, so the real test starts them early and waits once. */
import { APIRequestContext, expect, test } from "@playwright/test";
import { ADMIN_PHONE, apiSignIn, ApiSession, auth, collectErrors, fakePhone, openAs, SEED_BARS } from "./helpers";

let staff: ApiSession;
let student: ApiSession;
let barId: string;
let timerStartedAt = 0;

async function headcount(request: APIRequestContext): Promise<number> {
  const r = await request.get(`/v1/staff/bars/${barId}`, { headers: auth(staff) });
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()).headcount as number;
}

test.beforeAll(async ({ request }) => {
  const admin = await apiSignIn(request, ADMIN_PHONE);
  const bars = await request.get("/v1/admin/bars", { headers: auth(admin) });
  const owl = (await bars.json()).find((b: { name: string }) => b.name === SEED_BARS[0]);
  expect(owl).toBeTruthy();
  barId = owl.id;
  const inv = await request.post(`/v1/admin/bars/${barId}/invites`, { headers: auth(admin) });
  expect(inv.status(), await inv.text()).toBe(201);
  staff = await apiSignIn(request, fakePhone().e164);
  const redeem = await request.post("/v1/staff/invites/redeem", {
    headers: auth(staff),
    data: { code: (await inv.json()).code },
  });
  expect(redeem.status(), await redeem.text()).toBe(200);
  student = await apiSignIn(request, fakePhone().e164);
});

test("door mode: tap zones, clicker keys, undo, offline queue, count sync, line check and door code", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);

  // A student timer starts now so it is long enough to count by the next test.
  const started = await request.post("/v1/line-sessions", { headers: auth(student), data: { bar_id: barId } });
  expect(started.status(), await started.text()).toBe(201);
  timerStartedAt = Date.now();

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

  await test.step("the door code panel shows the 4 digit code from the API", async () => {
    await page.getByRole("button", { name: "Code", exact: true }).click();
    const panel = page.getByRole("region", { name: "Door code" });
    await expect(panel).toContainText(/New code in/);
    const shown = (await panel.locator(".code__digits").innerText()).trim();
    expect(shown).toMatch(/^\d{4}$/);
    const api = await request.get(`/v1/staff/bars/${barId}/door-code`, { headers: auth(staff) });
    expect(api.status()).toBe(200);
    const current = (await api.json()).code as string;
    // The code can roll over between the two reads. Retry once if so.
    if (shown !== current) {
      const again = await request.get(`/v1/staff/bars/${barId}/door-code`, { headers: auth(staff) });
      expect([current, (await again.json()).code]).toContain(shown);
    }
    await expect(panel).toContainText("Students in line enter this code when they get to the door.");
  });

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

test("a student who types the door code gets Verified at the door", async ({ page, request }) => {
  test.setTimeout(90_000);
  // The timer from the first test must be at least 30 seconds old to count.
  const wait = 33_000 - (Date.now() - timerStartedAt);
  if (wait > 0) await page.waitForTimeout(wait);

  const codeRes = await request.get(`/v1/staff/bars/${barId}/door-code`, { headers: auth(staff) });
  expect(codeRes.status(), await codeRes.text()).toBe(200);
  const code = (await codeRes.json()).code as string;

  await page.goto("/staff.html");
  await page.evaluate((rt) => window.localStorage.setItem("crowded.rt", rt), student.refresh);
  await page.goto("/#/timer");
  await expect(page.getByText("You're in line at")).toBeVisible();
  await page.getByRole("button", { name: "I'm inside" }).click();
  const input = page.getByLabel("Door code, shown by staff at the door");
  await expect(input).toBeVisible();
  await expect(page.getByRole("button", { name: "Done" })).toBeDisabled();
  await input.fill(code);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Verified at the door")).toBeVisible();
  await expect(page.getByText("+20 points")).toBeVisible();
});

test("door mode in mock mode: taps, keys, undo, line check, door code, reminders, no console errors", async ({ page }) => {
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

  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByRole("region", { name: "Door code" }).locator(".code__digits")).toHaveText(/^\d{4}$/);

  // Reminders show up after 15 and 20 minutes and can be dismissed.
  await page.getByRole("button", { name: "Door", exact: true }).click();
  await page.clock.runFor("16:00");
  await expect(page.getByText("Update the line size")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss: Update the line size" }).click();
  await expect(page.getByText("Update the line size")).toHaveCount(0);
  await page.clock.runFor("05:00");
  await expect(page.locator(".reminder__text").filter({ hasText: "Time the line" })).toBeVisible();
  expect(errors).toEqual([]);
});
