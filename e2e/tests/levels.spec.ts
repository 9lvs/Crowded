/* Staff levels: door staff do door work only, managers also manage, admins pick a bar.
   Also inside conditions (how busy, drink wait) and count in only bars. Sign ins here: 3 staff
   accounts through the API. The admin session is shared and every browser session comes from a
   refresh token, so nothing signs in through the UI. */
import { expect, test } from "@playwright/test";
import { adminSignIn, ApiSession, auth, barIdByName, collectErrors, openAs, SEED_BARS, staffAt } from "./helpers";

const OWL = SEED_BARS[0];
const FOX = SEED_BARS[1];
const MOOSE = SEED_BARS[2]; // seeded as count in only

let admin: ApiSession;

test.beforeAll(async ({ request }) => {
  admin = await adminSignIn(request);
});

test("door staff see Door, Line and Inside only, and Inside shows on the student bar page", async ({ page, request }) => {
  const errors = collectErrors(page);
  const owl = await barIdByName(request, admin, OWL);
  const door = await staffAt(request, admin, owl, "door");

  // The API closes manager routes and the retired door code to door staff.
  const specials = await request.get(`/v1/staff/bars/${owl}/specials`, { headers: auth(door) });
  expect(specials.status()).toBe(403);
  expect((await specials.json()).detail).toBe("manager_only");
  const settings = await request.patch(`/v1/staff/bars/${owl}/settings`, {
    headers: auth(door),
    data: { counts_exits: true },
  });
  expect(settings.status()).toBe(403);
  expect((await settings.json()).detail).toBe("manager_only");
  const code = await request.get(`/v1/staff/bars/${owl}/door-code`, { headers: auth(door) });
  expect(code.status()).toBe(404);
  expect((await code.json()).detail).toBe("door_code_disabled");

  await openAs(page, door, "/staff.html");
  const tabs = page.getByRole("navigation", { name: "Staff sections" });
  await expect(tabs.getByRole("button")).toHaveText(["Door", "Line", "Inside"]);
  await expect(page.getByRole("button", { name: "Specials" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Code", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Manage", exact: true })).toHaveCount(0);
  await expect(page.getByText("Door code")).toHaveCount(0);

  // Door tab: IN is the big zone, OUT is a smaller button, and the count shows capacity.
  await expect(page.getByRole("button", { name: "One person in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "One person out" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clicker total" })).toBeVisible();
  const inBox = await page.getByRole("button", { name: "One person in" }).boundingBox();
  const outBox = await page.getByRole("button", { name: "One person out" }).boundingBox();
  expect(inBox!.height).toBeGreaterThan(outBox!.height * 3);
  await expect(page.getByRole("region", { name: "Headcount" })).toContainText("Inside now");

  // Inside tab: two one tap groups. Each tap posts to /inside.
  await tabs.getByRole("button", { name: "Inside" }).click();
  await expect(page.getByText("Nothing reported inside yet tonight.").or(page.getByText(/^Updated /))).toBeVisible();
  const busy = page.waitForResponse((r) => r.url().endsWith(`/v1/staff/bars/${owl}/inside`) && r.request().method() === "POST");
  await page.getByRole("radiogroup", { name: "How busy inside" }).getByRole("radio", { name: "Busy" }).click();
  expect((await busy).status()).toBe(200);
  const drink = page.waitForResponse((r) => r.url().endsWith(`/v1/staff/bars/${owl}/inside`) && r.request().method() === "POST");
  await page.getByRole("radiogroup", { name: "How long for a drink" }).getByRole("radio", { name: "10 to 20" }).click();
  const state = await (await drink).json();
  expect(state.inside.drink_wait).toBe("10_to_20");
  await expect(page.getByText("Updated just now")).toBeVisible();
  const seen = page.getByRole("region", { name: "What students see inside" });
  await expect(seen).toContainText("Drinks");
  await expect(seen).not.toContainText("No recent data");
  const drinksText = (await state.live.drink_wait_label) as string;
  expect(drinksText).toMatch(/min$/);
  await expect(seen).toContainText(drinksText);

  // The same number reaches the student bar page as "Drinks".
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(`^${OWL}\\.`) }).click();
  const right = page.getByRole("region", { name: "Right now" });
  await expect(right).toContainText("Drinks");
  await expect(right).toContainText(/(Under 5|5 to 10|10 to 20|Over 20) min/);
  const row = page.getByRole("region", { name: "Right now" }).locator(".kpi").filter({ hasText: "Drinks" });
  await expect(row).not.toContainText("No recent data");
  expect(errors).toEqual([]);
});

test("a manager toggles Count exits too, and the Door tab follows", async ({ page, request }) => {
  const fox = await barIdByName(request, admin, FOX);
  const manager = await staffAt(request, admin, fox, "manager");
  try {
    await openAs(page, manager, "/staff.html");
    const tabs = page.getByRole("navigation", { name: "Staff sections" });
    await expect(tabs.getByRole("button")).toHaveText(["Door", "Line", "Inside", "Manage"]);
    await expect(page.getByRole("button", { name: "One person out" })).toBeVisible();

    await tabs.getByRole("button", { name: "Manage" }).click();
    const settings = page.getByRole("region", { name: "Settings" });
    const toggle = settings.getByRole("switch", { name: "Count exits too" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const stats = page.getByRole("region", { name: "Tonight so far" });
    await expect(stats).toContainText("Entries tonight");
    await expect(stats).toContainText("Exits tonight");
    await expect(stats).toContainText("Latest inside report");
    await expect(stats).toContainText("Line checks");

    await toggle.click();
    await expect(page.getByText("Entries only", { exact: true })).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(stats).not.toContainText("Exits tonight");
    const st = await request.get(`/v1/staff/bars/${fox}`, { headers: auth(manager) });
    expect((await st.json()).counts_exits).toBe(false);

    await tabs.getByRole("button", { name: "Door" }).click();
    await expect(page.getByRole("region", { name: "Entries tonight" })).toBeVisible();
    await expect(page.getByRole("button", { name: "One person out" })).toHaveCount(0);
    await expect(page.getByText("This bar counts entries only.")).toBeVisible();

    await tabs.getByRole("button", { name: "Manage" }).click();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await tabs.getByRole("button", { name: "Door" }).click();
    await expect(page.getByRole("button", { name: "One person out" })).toBeVisible();
  } finally {
    const back = await request.patch(`/v1/admin/bars/${fox}`, { headers: auth(admin), data: { counts_exits: true } });
    expect(back.status(), await back.text()).toBe(200);
  }
});

test("a count in only bar shows Entries tonight and no OUT button", async ({ page, request }) => {
  const moose = await barIdByName(request, admin, MOOSE);
  const door = await staffAt(request, admin, moose, "door");
  const before = (await (await request.get(`/v1/staff/bars/${moose}`, { headers: auth(door) })).json()).entries_tonight as number;

  await openAs(page, door, "/staff.html");
  const count = page.getByRole("region", { name: "Entries tonight" });
  await expect(count).toContainText("Entries tonight");
  await expect(page.getByText("This bar counts entries only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "One person out" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clicker total" })).toHaveCount(0);
  await expect(page.getByText(/in · \d+ out tonight/)).toBeHidden();
  await expect(page.getByText(/of \d+ capacity/)).toBeHidden();

  const num = count.locator("p").nth(1);
  const start = Number(await num.innerText());
  await page.getByRole("button", { name: "One person in" }).click();
  await page.getByRole("button", { name: "Three people in" }).click();
  await expect(num).toHaveText(String(start + 4));
  // The out keys do nothing in count in only mode.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("PageUp");
  await expect(num).toHaveText(String(start + 4));
  await page.keyboard.press("ArrowRight");
  await expect(num).toHaveText(String(start + 5));
  await expect.poll(async () => (await (await request.get(`/v1/staff/bars/${moose}`, { headers: auth(door) })).json()).entries_tonight).toBe(before + 5);
});

test("an admin picks a bar and gets the manager view", async ({ page, request }) => {
  const errors = collectErrors(page);
  await openAs(page, admin, "/staff.html");
  await expect(page.getByRole("heading", { name: "Pick a bar" })).toBeVisible();
  await page.getByRole("button", { name: FOX }).click();
  await expect(page.getByText("Admin", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "One person in" })).toBeVisible();
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await expect(page.getByRole("region", { name: "Specials" })).toBeVisible();
  expect(errors).toEqual([]);
});
