/* Admin console (web/admin.html). Real backend tests plus a mock mode smoke run.
   Sign ins in this file: 1 admin (UI), 2 fake accounts. The seeded admin phone allows 3 code
   requests per 10 minutes and the shared adminSignIn helper uses one, so this file asks for one more. */
import { expect, Page, test } from "@playwright/test";
import { adminSignIn, ADMIN_PHONE, apiSignIn, auth, collectErrors, fakePhone, openAs, uiSignIn } from "./helpers";

const CODE = /^[A-Z0-9]{5}-[A-Z0-9]{5}$/;

test("admin sets up a FAKE bar: price, invites, and students see it", async ({ page, request }) => {
  const errors = collectErrors(page);
  const tag = Date.now().toString(36);
  const barName = `FAKE Admin Test ${tag}`;
  const slug = `fake-admin-test-${tag}`;

  try {
    await uiSignIn(page, "/admin.html", ADMIN_PHONE.replace("+1", ""));
    await expect(page.getByRole("heading", { name: "Bars", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the staff page" })).toHaveAttribute("href", /staff\.html/);

    // Add the bar. Client validation first.
    await page.getByRole("button", { name: "Add bar" }).click();
    await page.getByLabel("Name", { exact: true }).fill(barName);
    await expect(page.getByLabel("Slug", { exact: true })).toHaveValue(slug);
    await page.getByLabel("Slug", { exact: true }).fill("Not A Slug");
    await page.getByLabel("Latitude").fill("0");
    await page.getByLabel("Longitude").fill("0");
    await page.getByLabel("Capacity", { exact: true }).fill("0");
    await page.getByRole("button", { name: "Add bar" }).click();
    await expect(page.getByText("Use 2 to 64 lowercase letters, numbers and hyphens.")).toBeVisible();
    await expect(page.getByText("Enter a whole number from 1 to 10000.")).toBeVisible();
    await page.getByLabel("Slug", { exact: true }).fill(slug);
    await page.getByLabel("Address").fill("1 FAKE Test Lane");
    await page.getByLabel("Capacity", { exact: true }).fill("120");
    await page.getByRole("button", { name: "Add bar" }).click();
    await expect(page.getByRole("heading", { name: barName, level: 1 })).toBeVisible();

    // Pass price in dollars.
    await page.getByLabel("Price in dollars").fill("15");
    await page.getByRole("button", { name: "Save price" }).click();
    await expect(page.getByText("Saved. Students now see $15.")).toBeVisible();

    // Invites: codes are shown with the share copy.
    await page.getByRole("button", { name: "Create manager invite" }).click();
    const mgrPanel = page.getByRole("region", { name: "Manager invite" });
    const mgrCode = ((await mgrPanel.locator(".adm-code").textContent()) || "").trim();
    expect(mgrCode).toMatch(CODE);
    await expect(mgrPanel).toContainText("It works once and expires in 3 days.");
    await expect(mgrPanel.getByRole("button", { name: "Copy code" })).toBeVisible();
    await page.getByRole("button", { name: "Create door staff invite" }).click();
    const doorPanel = page.getByRole("region", { name: "Door staff invite" });
    const doorCode = ((await doorPanel.locator(".adm-code").textContent()) || "").trim();
    expect(doorCode).toMatch(CODE);
    expect(doorCode).not.toBe(mgrCode);

    // Revoke the door invite right away.
    await doorPanel.getByRole("button", { name: "Revoke invite" }).click();
    await expect(doorPanel).toContainText("Invite revoked");

    // One fake account: the revoked code fails and the manager code works.
    const staff = await apiSignIn(request, fakePhone().e164);
    const bad = await request.post("/v1/staff/invites/redeem", { headers: auth(staff), data: { code: doorCode } });
    expect(bad.status()).toBe(400);
    const ok = await request.post("/v1/staff/invites/redeem", { headers: auth(staff), data: { code: mgrCode } });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ok.json()).staff_level).toBe("manager");

    // The bars list and the staff list show it, and Remove asks first.
    await page.getByRole("button", { name: "Back to bars" }).click();
    await expect(page.getByText(slug, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Manage ${barName}` }).click();
    const staffList = page.getByRole("list", { name: "Staff" });
    await expect(staffList.getByRole("listitem")).toHaveCount(1);
    await expect(staffList).toContainText("Manager");
    await staffList.getByRole("button", { name: /^Remove / }).click();
    await expect(page.getByText("Remove this person?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(staffList.getByRole("listitem")).toHaveCount(1);

    // Students see the bar in Tonight.
    await openAs(page, staff, "/");
    await expect(page.locator(".bar-row__name", { hasText: barName })).toBeVisible();

    expect(errors).toEqual([]);
  } finally {
    // Other specs expect exactly the 3 seeded bars on Tonight, so hide this one again.
    const admin = await adminSignIn(request);
    const list = await request.get("/v1/admin/bars", { headers: auth(admin) });
    const made = (await list.json()).find((b: { slug: string }) => b.slug === slug);
    if (made) {
      const off = await request.patch(`/v1/admin/bars/${made.id}`, {
        headers: auth(admin),
        data: { is_active: false },
      });
      expect(off.status()).toBe(200);
    }
  }
});

test("a non admin sees Admins only and can sign out", async ({ page }) => {
  const errors = collectErrors(page);
  await uiSignIn(page, "/admin.html", fakePhone().national);
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add bar" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Phone number")).toBeVisible();
  expect(errors).toEqual([]);
});

async function mockSignIn(page: Page, phone: string): Promise<void> {
  await page.goto("/admin.html?mock=1");
  await page.evaluate(() => {
    window.sessionStorage.clear();
    window.localStorage.removeItem("crowded.mock.rt");
  });
  await page.goto("/admin.html?mock=1");
  await page.getByRole("checkbox", { name: /21 or older/ }).check();
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use it" }).click();
}

test("mock smoke: admin console end to end with zero console errors", async ({ page }) => {
  const errors = collectErrors(page);

  // Non admin first.
  await mockSignIn(page, "5550006661");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();

  await mockSignIn(page, "5550000001");
  await expect(page.getByRole("heading", { name: "Bars", level: 1 })).toBeVisible();
  await expect(page.getByText("FAKE The Tipsy Owl", { exact: true })).toBeVisible();

  // Add a bar, set the price, make both invites, revoke one.
  await page.getByRole("button", { name: "Add bar" }).click();
  await page.getByLabel("Name", { exact: true }).fill("FAKE Mock Bar");
  await page.getByLabel("Latitude").fill("0");
  await page.getByLabel("Longitude").fill("0");
  await page.getByLabel("Capacity", { exact: true }).fill("90");
  await page.getByLabel("Count exits too").uncheck();
  await page.getByRole("button", { name: "Add bar" }).click();
  await expect(page.getByRole("heading", { name: "FAKE Mock Bar", level: 1 })).toBeVisible();
  await expect(page.getByText("Entries only")).toBeVisible();
  await page.getByLabel("Price in dollars").fill("12.50");
  await page.getByRole("button", { name: "Save price" }).click();
  await expect(page.getByText("Saved. Students now see $12.50.")).toBeVisible();
  await page.getByRole("button", { name: "No pass sold" }).click();
  await expect(page.getByText("Saved. No pass sold.")).toBeVisible();
  await page.getByRole("button", { name: "Create manager invite" }).click();
  await expect(page.getByRole("region", { name: "Manager invite" }).locator(".adm-code")).toContainText("MANAGER-");
  await page.getByRole("button", { name: "Create door staff invite" }).click();
  const door = page.getByRole("region", { name: "Door staff invite" });
  await door.getByRole("button", { name: "Revoke invite" }).click();
  await expect(door).toContainText("Invite revoked");

  // Staff on the first bar, remove one with the in page confirm.
  await page.getByRole("button", { name: "Back to bars" }).click();
  await page.getByRole("button", { name: "Manage FAKE The Tipsy Owl" }).click();
  const staffList = page.getByRole("list", { name: "Staff" });
  await expect(staffList.getByRole("listitem")).toHaveCount(2);
  await staffList.getByRole("button", { name: /^Remove Door staff/ }).click();
  await page.getByRole("button", { name: "Yes, remove" }).click();
  await expect(staffList.getByRole("listitem")).toHaveCount(1);

  // Edit.
  await page.getByRole("button", { name: "Edit bar" }).click();
  await page.getByLabel("Capacity", { exact: true }).fill("230");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Capacity 230")).toBeVisible();

  // Accuracy and audit.
  await page.getByRole("button", { name: "Accuracy" }).click();
  const table = page.getByRole("table", { name: "Estimate accuracy by bar" });
  await expect(table).toContainText("FAKE The Tipsy Owl");
  await expect(table).toContainText("3.4 min");
  await expect(page.getByText(/Bias above 0 means we guessed too long/)).toBeVisible();
  await page.getByRole("button", { name: "Audit log" }).click();
  const log = page.getByRole("list", { name: "Audit log" });
  await expect(log).toContainText("Created an invite");
  await expect(log).toContainText("Added a bar");

  // The new bar is on the student Tonight list in the same mock session.
  await page.goto("/index.html?mock=1");
  await expect(page.getByText("FAKE Mock Bar")).toBeVisible();

  expect(errors).toEqual([]);
});
