/* Specials: the student Tonight line, bar detail, staff editing, and mock mode.
   Real backend tests use the seeded FAKE specials. Copper Fox has a cover every night, so it
   always has something tonight. Sign ins here: 3 through the API, none through the UI. */
import { APIRequestContext, expect, Page, test } from "@playwright/test";
import { apiSignIn, ApiSession, auth, collectErrors, fakePhone, adminSignIn, staffAt } from "./helpers";

const FOX = "FAKE Copper Fox";
const MOOSE = "FAKE Neon Moose";

/** Start a browser session from an API sign in, without going through the sign in screens. */
async function openAs(page: Page, session: ApiSession, path: string): Promise<void> {
  await page.goto("/staff.html");
  await page.evaluate((rt) => window.localStorage.setItem("crowded.rt", rt), session.refresh);
  await page.goto(path);
}

/** Hour 0 to 23 in the bar's timezone. All night specials end at 4 AM, so from 4 AM to noon the
    bar has no all night deals "tonight". Tests that need one skip in that window. */
function nyHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(new Date()),
  );
}

let studentSession: Promise<ApiSession> | null = null;
/** One student per run for the read only checks here. */
function student(request: APIRequestContext): Promise<ApiSession> {
  if (!studentSession) studentSession = apiSignIn(request, fakePhone().e164);
  return studentSession;
}

async function barId(request: APIRequestContext, admin: ApiSession, name: string): Promise<string> {
  const bars = await (await request.get("/v1/admin/bars", { headers: auth(admin) })).json();
  const bar = bars.find((b: { name: string }) => b.name === name);
  expect(bar, `seeded bar ${name}`).toBeTruthy();
  return bar.id;
}

/** Delete specials by title so a rerun starts clean. */
async function removeByTitle(request: APIRequestContext, admin: ApiSession, bar: string, title: string): Promise<void> {
  const list = await (await request.get(`/v1/admin/bars/${bar}/specials`, { headers: auth(admin) })).json();
  for (const sp of list.filter((x: { title: string }) => x.title === title)) {
    await request.delete(`/v1/admin/bars/${bar}/specials/${sp.id}`, { headers: auth(admin) });
  }
}

/** A special that is running right now whatever hour CI runs at: 12:00 to 11:59 the next day. */
function runningNow(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    days: [0, 1, 2, 3, 4, 5, 6],
    start_local: "12:00",
    end_local: "11:59",
    ...extra,
  };
}

test("Tonight rows show a deal line from items, with no verdict or Report button", async ({ page, request }) => {
  const admin = await adminSignIn(request);
  const fox = await barId(request, admin, FOX);
  const created = await request.post(`/v1/admin/bars/${fox}/specials`, {
    headers: auth(admin),
    data: runningNow({
      kind: "happy_hour",
      title: "FAKE E2E Hour",
      items: [
        { name: "FAKE E2E Wells", price_label: "$2", category: "mixers", note: "" },
        { name: "FAKE E2E Drafts", price_label: "$2", category: "beer", note: "" },
        { name: "FAKE E2E Shots", price_label: "$3", category: "shots", note: "" },
      ],
    }),
  });
  expect(created.status(), await created.text()).toBe(201);
  const special = await created.json();

  try {
    await openAs(page, await student(request), "/");
    await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();
    const foxRow = page.getByRole("listitem").filter({ hasText: FOX });
    const deal = foxRow.locator(".bar-row__deal");
    await expect(deal).toContainText("Happy hour now:");
    await expect(deal).toContainText("$2 FAKE E2E wells, $2 FAKE E2E drafts");
    await expect(deal).toContainText(/\+\d/);

    // Rows are clean: the pass call and Report live on the bar page.
    const rows = page.getByRole("list", { name: "Bars tonight" });
    await expect(rows.getByRole("button", { name: /^Report$/ })).toHaveCount(0);
    await expect(rows).not.toContainText("Skip the pass");
    await expect(rows).not.toContainText("worth it");

    // The whole row opens the bar.
    await foxRow.locator(".bar-row__basis").click();
    await expect(page.getByRole("heading", { level: 1, name: FOX })).toBeVisible();
    await expect(page.getByRole("button", { name: "Report crowd", exact: true })).toBeVisible();
  } finally {
    await request.delete(`/v1/admin/bars/${fox}/specials/${special.id}`, { headers: auth(admin) });
  }
});

test("bar page shows Deals tonight as a price list, then This week", async ({ page, request }) => {
  const admin = await adminSignIn(request);
  const owl = await barId(request, admin, "FAKE The Tipsy Owl");
  const created = await request.post(`/v1/admin/bars/${owl}/specials`, {
    headers: auth(admin),
    data: runningNow({
      kind: "food",
      title: "FAKE E2E Food",
      items: [
        { name: "FAKE E2E Tacos", price_label: "$4", category: "food", note: "Dine in only" },
        { name: "FAKE E2E Nachos", price_label: "2 for $5", category: "food", note: "" },
      ],
    }),
  });
  expect(created.status(), await created.text()).toBe(201);
  const special = await created.json();

  try {
    await openAs(page, await student(request), "/");
    await page.getByRole("button", { name: /^FAKE The Tipsy Owl\./ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "FAKE The Tipsy Owl" })).toBeVisible();

    const deals = page.getByRole("region", { name: "Deals tonight" });
    await expect(deals).toBeVisible();
    const tacos = deals.locator(".deal-row").filter({ hasText: "FAKE E2E Tacos" });
    await expect(tacos.locator(".deal-row__name")).toHaveText("FAKE E2E Tacos");
    await expect(tacos.locator(".deal-row__price")).toHaveText("$4");
    await expect(tacos.locator(".deal-row__note")).toHaveText("Dine in only");
    await expect(deals.locator(".deal-row").filter({ hasText: "FAKE E2E Nachos" }).locator(".deal-row__price")).toHaveText("2 for $5");
    const group = deals.locator(".deal-group").filter({ hasText: "FAKE E2E Tacos" });
    await expect(group).toContainText(/Food 12 to 11/);
    await expect(group).toContainText("Now");
    await expect(group).toContainText(/Posted by (the bar|Crowded)/);
    await expect(group).toContainText(/Updated (just now|.* ago)/);

    // Seeded deals of the Owl show too: the happy hour (when it is on tonight) or all night drafts.
    // The pass block sits under the deals.
    await expect(page.getByRole("region", { name: "Line skip pass" })).toBeVisible();

    const week = page.locator("details.week");
    await expect(week).not.toHaveAttribute("open", "");
    await week.locator("summary").click();
    await expect(week.getByRole("heading", { name: "Monday" })).toBeVisible();
    await expect(week.getByRole("heading", { name: "Sunday" })).toBeVisible();
    await expect(week).toContainText("FAKE E2E Tacos");
    await expect(week).toContainText("FAKE House shots");
  } finally {
    await request.delete(`/v1/admin/bars/${owl}/specials/${special.id}`, { headers: auth(admin) });
  }
});

test("staff add a special, students see it, then staff delete it", async ({ page, request }) => {
  const admin = await adminSignIn(request);
  const bars = await (await request.get("/v1/admin/bars", { headers: auth(admin) })).json();
  const moose = bars.find((b: { name: string }) => b.name === MOOSE);
  expect(moose).toBeTruthy();
  // Specials are manager only. Door staff get 403 manager_only.
  const staff = await staffAt(request, admin, moose.id, "manager");

  await openAs(page, staff, "/staff.html");
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  const section = page.getByRole("region", { name: "Specials" });
  await expect(section).toBeVisible();

  // Validation in plain words before anything is sent.
  const form = section.getByRole("form", { name: "Add special" });
  await form.getByLabel("Title").fill("FAKE E2E Special");
  await form.getByRole("button", { name: "Add special" }).click();
  await expect(form).toContainText("Pick at least one day.");

  // Every day, so it is on tonight whatever day the suite runs.
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
    await form.getByRole("button", { name: day }).click();
  }
  await form.getByLabel("Kind").selectOption("drink");
  await form.getByLabel("Details").fill("Made up for a test");
  await form.getByLabel("Starts").fill("00:00");
  await form.getByLabel("Ends").fill("23:59");
  await form.getByLabel("Price in dollars").fill("4.50");
  await form.getByRole("button", { name: "Add special" }).click();
  await expect(page.getByText("Special added")).toBeVisible();
  await expect(section.getByRole("listitem").filter({ hasText: "FAKE E2E Special" })).toContainText("$4.50");

  // The same account opens the student app and sees it.
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(`^${MOOSE}\\.`) }).click();
  const tonight = page.getByRole("region", { name: "Deals tonight" });
  await expect(tonight).toContainText("FAKE E2E Special");
  await expect(tonight).toContainText("$4.50");
  await expect(tonight).toContainText("Now");

  // Back to the staff page: delete asks first.
  await page.goto("/staff.html");
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  const item = page.getByRole("region", { name: "Specials" }).getByRole("listitem").filter({ hasText: "FAKE E2E Special" });
  await item.getByRole("button", { name: "Delete FAKE E2E Special" }).click();
  await expect(item).toContainText("Delete this special?");
  await item.getByRole("button", { name: "Keep it" }).click();
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Delete FAKE E2E Special" }).click();
  await item.getByRole("button", { name: /^Yes, delete/ }).click();
  await expect(page.getByText("Special deleted")).toBeVisible();
  await expect(page.getByText("FAKE E2E Special")).toHaveCount(0);

  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(`^${MOOSE}\\.`) }).click();
  await expect(page.getByRole("region", { name: "Deals tonight" })).not.toContainText("FAKE E2E Special");
});

test("staff add an all night special with items in the editor, students see it", async ({ page, request }) => {
  const admin = await adminSignIn(request);
  const bar = await barId(request, admin, MOOSE);
  await removeByTitle(request, admin, bar, "FAKE E2E Night Menu");
  const staff = await staffAt(request, admin, bar, "manager");

  await openAs(page, staff, "/staff.html");
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  const section = page.getByRole("region", { name: "Specials" });
  const form = section.getByRole("form", { name: "Add special" });

  // The All night toggle hides the time inputs.
  await expect(form.getByLabel("Starts")).toBeVisible();
  await form.getByLabel("All night").check();
  await expect(form.getByLabel("Starts")).toBeHidden();

  await form.getByLabel("Title").fill("FAKE E2E Night Menu");
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
    await form.getByRole("button", { name: day }).click();
  }

  // Plain words for a half filled item.
  await form.getByRole("button", { name: "Add item" }).click();
  const item1 = form.getByRole("group", { name: "Item 1" });
  await item1.getByLabel("Name").fill("FAKE E2E Lager");
  await form.getByRole("button", { name: "Add special" }).click();
  await expect(form).toContainText("Item 1 needs a name and a price.");
  await item1.getByLabel("Price", { exact: true }).fill("$3");
  await item1.getByLabel("Category").selectOption("beer");
  await form.getByRole("button", { name: "Add item" }).click();
  const item2 = form.getByRole("group", { name: "Item 2" });
  await item2.getByLabel("Name").fill("FAKE E2E Wings");
  await item2.getByLabel("Price", { exact: true }).fill("$7");
  await item2.getByLabel("Category").selectOption("food");
  await item2.getByLabel("Note (optional)").fill("Dine in only");
  await form.getByRole("button", { name: "Add special" }).click();
  await expect(page.getByText("Special added")).toBeVisible();

  const row = section.getByRole("listitem").filter({ hasText: "FAKE E2E Night Menu" });
  await expect(row).toContainText("All night");
  await expect(row).toContainText("2 items");

  // All night deals end at 4 AM, so from 4 AM to noon (bar time) none are "tonight" yet. Check the
  // student page outside that window. The weekly schedule always has it.
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(`^${MOOSE}\\.`) }).click();
  const inGap = nyHour() >= 4 && nyHour() < 12;
  if (!inGap) {
    const deals = page.getByRole("region", { name: "Deals tonight" });
    const group = deals.locator(".deal-group").filter({ hasText: "FAKE E2E Lager" });
    await expect(group.locator(".deal-group__title")).toHaveText("All night");
    await expect(group.locator(".deal-row").filter({ hasText: "FAKE E2E Lager" }).locator(".deal-row__price")).toHaveText("$3");
    await expect(group.locator(".deal-row").filter({ hasText: "FAKE E2E Wings" })).toContainText("Dine in only");
  }
  await page.locator("details.week summary").click();
  const week = page.locator("details.week");
  await expect(week.locator(".deal-row").filter({ hasText: "FAKE E2E Lager" }).first().locator(".deal-row__price")).toHaveText("$3");

  await removeByTitle(request, admin, bar, "FAKE E2E Night Menu");
});

test("specials UI renders in mock mode with no console errors", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/index.html?mock=1");
  await page.getByRole("checkbox", { name: /21 or older/ }).check();
  await page.getByLabel("Phone number").fill("5550004444");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use it" }).click();
  await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();
  // Copper Lantern has a cover every night.
  const lantern = page.getByRole("listitem").filter({ hasText: "FAKE Copper Lantern" });
  await expect(lantern.locator(".bar-row__deal")).toContainText(/Cover \$3/);
  await page.getByRole("button", { name: /^FAKE Copper Lantern\./ }).click();
  await expect(page.getByRole("region", { name: "Deals tonight" })).toContainText("Posted by Crowded");
  await page.locator("details.week summary").click();
  await expect(page.getByRole("heading", { name: "Tuesday" })).toBeVisible();
  // Tipsy Owl has an item menu: all night drafts and a happy hour. Rows have no verdict or Report.
  await page.goto("/index.html?mock=1#/tonight");
  const owl = page.getByRole("listitem").filter({ hasText: "FAKE The Tipsy Owl" });
  await expect(owl.locator(".bar-row__deal")).toContainText(/Happy hour (now|at 9):|All night:/);
  await expect(owl.getByRole("button", { name: /^Report$/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^FAKE The Tipsy Owl\./ }).click();
  const owlDeals = page.getByRole("region", { name: "Deals tonight" });
  await expect(owlDeals).toContainText("FAKE Lager drafts");
  await expect(owlDeals.locator(".deal-row__price").first()).toHaveText("$3");
  await expect(owlDeals).toContainText("Happy hour 9 to 11");
  // Night Heron has none.
  await page.goto("/index.html?mock=1#/tonight");
  await page.getByRole("button", { name: /^FAKE Night Heron\./ }).click();
  await expect(page.getByRole("region", { name: "Deals tonight" })).toContainText("No deals posted.");

  // Staff side in mock mode.
  await page.goto("/staff.html?mock=1");
  await page.getByLabel("Invite code").fill("MANAGER-INVITE");
  await page.getByRole("button", { name: "Join bar" }).click();
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  const section = page.getByRole("region", { name: "Specials" });
  await expect(section.getByRole("listitem").filter({ hasText: "FAKE Wing Night" })).toBeVisible();
  const form = section.getByRole("form", { name: "Add special" });
  await form.getByLabel("Title").fill("FAKE Mock Special");
  await form.getByRole("button", { name: "Friday" }).click();
  await form.getByRole("button", { name: "Add special" }).click();
  const added = section.getByRole("listitem").filter({ hasText: "FAKE Mock Special" });
  await expect(added).toContainText("Fri");
  await added.getByRole("switch", { name: "Active: FAKE Mock Special" }).click();
  await expect(added).toContainText("Hidden from students");
  await added.getByRole("button", { name: "Delete FAKE Mock Special" }).click();
  await added.getByRole("button", { name: /^Yes, delete/ }).click();
  await expect(page.getByText("FAKE Mock Special")).toHaveCount(0);
  expect(errors).toEqual([]);
});
