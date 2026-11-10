/* Specials: the student Tonight line, bar detail, staff editing, and mock mode.
   Real backend tests use the seeded FAKE specials. Copper Fox has a cover every night, so it
   always has something tonight. Sign ins here: 3 through the API, none through the UI. */
import { expect, Page, test } from "@playwright/test";
import { ADMIN_PHONE, apiSignIn, ApiSession, auth, collectErrors, fakePhone } from "./helpers";

const FOX = "FAKE Copper Fox";
const MOOSE = "FAKE Neon Moose";

/** Start a browser session from an API sign in, without going through the sign in screens. */
async function openAs(page: Page, session: ApiSession, path: string): Promise<void> {
  await page.goto("/staff.html");
  await page.evaluate((rt) => window.localStorage.setItem("crowded.rt", rt), session.refresh);
  await page.goto(path);
}

test("Tonight shows a specials line, and bar detail shows Tonight and This week", async ({ page, request }) => {
  const student = await apiSignIn(request, fakePhone().e164);
  await openAs(page, student, "/");
  await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();
  const lines = page.locator(".bar-row__special");
  await expect(lines.first()).toBeVisible();
  const fox = page.getByRole("listitem").filter({ hasText: FOX });
  await expect(fox.locator(".bar-row__special")).toContainText(/Cover \$3|now until/);

  await page.getByRole("button", { name: new RegExp(`^${FOX}\\.`) }).click();
  await expect(page.getByRole("heading", { level: 1, name: FOX })).toBeVisible();
  const tonight = page.getByRole("region", { name: "Tonight" });
  await expect(tonight).toContainText("Cover");
  await expect(tonight).toContainText("FAKE Cover");
  await expect(tonight).toContainText(/Posted by (the bar|Crowded)/);
  await expect(tonight).toContainText(/Updated .* ago|Updated just now/);

  const week = page.locator("details.week");
  await expect(week).not.toHaveAttribute("open", "");
  await week.locator("summary").click();
  await expect(week.getByRole("heading", { name: "Monday" })).toBeVisible();
  await expect(week.getByRole("heading", { name: "Sunday" })).toBeVisible();
  await expect(week).toContainText("FAKE Fox Hour");
});

test("staff add a special, students see it, then staff delete it", async ({ page, request }) => {
  const admin = await apiSignIn(request, ADMIN_PHONE);
  const bars = await (await request.get("/v1/admin/bars", { headers: auth(admin) })).json();
  const moose = bars.find((b: { name: string }) => b.name === MOOSE);
  expect(moose).toBeTruthy();
  const inv = await request.post(`/v1/admin/bars/${moose.id}/invites`, { headers: auth(admin) });
  expect(inv.status(), await inv.text()).toBe(201);
  const staff = await apiSignIn(request, fakePhone().e164);
  const redeem = await request.post("/v1/staff/invites/redeem", {
    headers: auth(staff),
    data: { code: (await inv.json()).code },
  });
  expect(redeem.status(), await redeem.text()).toBe(200);

  await openAs(page, staff, "/staff.html");
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
  const tonight = page.getByRole("region", { name: "Tonight" });
  await expect(tonight).toContainText("FAKE E2E Special");
  await expect(tonight).toContainText("$4.50");
  await expect(tonight).toContainText("Now");

  // Back to the staff page: delete asks first.
  await page.goto("/staff.html");
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
  await expect(page.getByRole("region", { name: "Tonight" })).not.toContainText("FAKE E2E Special");
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
  await expect(lantern.locator(".bar-row__special")).toContainText(/Cover \$3|now until/);
  await page.getByRole("button", { name: /^FAKE Copper Lantern\./ }).click();
  await expect(page.getByRole("region", { name: "Tonight" })).toContainText("Posted by Crowded");
  await page.locator("details.week summary").click();
  await expect(page.getByRole("heading", { name: "Tuesday" })).toBeVisible();
  // Night Heron has none.
  await page.goto("/index.html?mock=1#/tonight");
  await page.getByRole("button", { name: /^FAKE Night Heron\./ }).click();
  await expect(page.getByRole("region", { name: "Tonight" })).toContainText("No specials posted.");

  // Staff side in mock mode.
  await page.goto("/staff.html?mock=1");
  await page.getByLabel("Invite code").fill("FAKE-INVITE");
  await page.getByRole("button", { name: "Join bar" }).click();
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
