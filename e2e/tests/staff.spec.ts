/* Door staff journey and user versus staff separation, against the real backend. */
import { APIRequestContext, expect, test } from "@playwright/test";
import { ADMIN_PHONE, apiSignIn, ApiSession, auth, fakePhone, SEED_BARS, uiSignIn } from "./helpers";

let admin: ApiSession;
let barId: string;

async function freshInvite(request: APIRequestContext): Promise<string> {
  const r = await request.post(`/v1/admin/bars/${barId}/invites`, { headers: auth(admin) });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).code;
}

test.beforeAll(async ({ request }) => {
  admin = await apiSignIn(request, ADMIN_PHONE);
  expect(admin.user.role, "seed.py makes the FAKE admin").toBe("admin");
  const bars = await request.get("/v1/admin/bars", { headers: auth(admin) });
  const owl = (await bars.json()).find((b: { name: string }) => b.name === SEED_BARS[0]);
  expect(owl).toBeTruthy();
  barId = owl.id;
});

test("staff sign in, join a bar by invite, count the door and set the line", async ({ page, request }) => {
  const invite = await freshInvite(request);
  await uiSignIn(page, "/staff.html", fakePhone().national);
  await expect(page.getByRole("heading", { name: "Join your bar" })).toBeVisible();
  await page.getByLabel("Invite code").fill(invite);
  await page.getByRole("button", { name: "Join bar" }).click();

  await expect(page.getByText(SEED_BARS[0])).toBeVisible();
  const count = page.getByRole("region", { name: "Headcount" });
  await expect(count).toContainText("Inside now");
  // Wait for the first server state, then read the headcount.
  await expect(page.getByText(/in · \d+ out tonight/)).toBeVisible();
  const before = Number(await count.locator("p").nth(1).innerText());

  const inBtn = page.getByRole("button", { name: "One person in" });
  for (let i = 0; i < 3; i++) await inBtn.click();
  await expect(count.locator("p").nth(1)).toHaveText(String(before + 3));

  await page.getByRole("button", { name: "Line", exact: true }).click();
  await expect(page.getByText("What students see")).toBeVisible();
  await page.getByRole("radio", { name: /Medium/ }).click();
  await expect(page.getByText("Line set to medium")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Medium/ })).toHaveAttribute("aria-checked", "true");

  // The same account opening the student app gets a shortcut to the counter.
  await page.goto("/");
  await expect(page.getByText("You're signed in as door staff")).toBeVisible();
  await page.getByRole("link", { name: /door staff/ }).click();
  await expect(page.getByRole("button", { name: "One person in" })).toBeVisible();
});

test("a student on the staff page only sees the invite step", async ({ page }) => {
  await uiSignIn(page, "/staff.html", fakePhone().national);
  await expect(page.getByRole("heading", { name: "Join your bar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "One person in" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open the app" })).toBeVisible();
});

test("the staff API is closed to students and to other bars", async ({ request }) => {
  const student = await apiSignIn(request, fakePhone().e164);
  expect(student.user.role).toBe("user");
  expect(student.user.staff_bar_id).toBeNull();
  const asStudent = await request.get(`/v1/staff/bars/${barId}`, { headers: auth(student) });
  expect(asStudent.status()).toBe(404);
  const door = await request.post(`/v1/staff/bars/${barId}/door`, {
    headers: auth(student),
    data: { direction: "in", count: 1 },
  });
  expect(door.status()).toBe(404);
  const anon = await request.get(`/v1/staff/bars/${barId}`);
  expect(anon.status()).toBe(401);
  const adminOnly = await request.get("/v1/admin/bars", { headers: auth(student) });
  expect(adminOnly.status()).toBe(403);
});

test("the student app links to the staff sign in and back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Staff sign in" }).click();
  await expect(page.getByRole("heading", { name: "Door counter" })).toBeVisible();
  await page.getByRole("link", { name: "Open the app" }).click();
  await expect(page.getByRole("heading", { name: "Know the line before you go." })).toBeVisible();
});
