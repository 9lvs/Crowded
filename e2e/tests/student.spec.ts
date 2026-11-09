/* Student journey against the real backend (seeded FAKE bars, CROWDED_ENV=dev). */
import { expect, Page, test } from "@playwright/test";
import { fakePhone, SEED_BARS, uiSignIn } from "./helpers";

test.describe("age gate", () => {
  test("continue stays disabled without the 21+ attestation", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Phone number").fill(fakePhone().national);
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await page.getByRole("checkbox", { name: /21 or older/ }).check();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  test("the API refuses signup without attestation", async ({ request }) => {
    const phone = fakePhone().e164;
    const rc = await request.post("/v1/auth/request-code", { data: { phone } });
    const code = (await rc.json()).dev_code;
    const vr = await request.post("/v1/auth/verify-code", { data: { phone, code } });
    expect(vr.status()).toBe(403);
    expect((await vr.json()).detail).toBe("age_gate");
  });
});

test.describe.serial("student journey", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("signs up and sees tonight's bars with what each number is based on", async () => {
    await uiSignIn(page, "/", fakePhone().national);
    await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();
    const list = page.getByRole("list", { name: "Bars tonight" });
    for (const name of SEED_BARS) {
      await expect(list.getByText(name, { exact: true })).toBeVisible();
    }
    const rows = list.getByRole("listitem");
    await expect(rows).toHaveCount(SEED_BARS.length);
    for (let i = 0; i < SEED_BARS.length; i++) {
      await expect(rows.nth(i)).toContainText(/Based on|Nobody has reported/);
    }
    // Students only: the staff entry lives on its own page.
    await expect(page.getByText("You're signed in as door staff")).toHaveCount(0);
  });

  test("opens a bar and sends a crowd report", async () => {
    await page.getByRole("button", { name: new RegExp(`^${SEED_BARS[0]}\\.`) }).click();
    await expect(page.getByRole("heading", { level: 1, name: SEED_BARS[0] })).toBeVisible();
    await expect(page.getByRole("region", { name: "Right now" })).toContainText("Crowd");
    await page.getByRole("button", { name: "Report crowd", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("radio", { name: "Busy" }).click();
    await sheet.getByRole("radio", { name: /Medium/ }).click();
    await sheet.getByRole("button", { name: "Send report" }).click();
    await expect(sheet.getByText("Report sent")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5_000 });
  });

  test("starts and ends a line session", async () => {
    await page.getByRole("button", { name: "I'm in line" }).click();
    await expect(page.getByText("You're in line at")).toBeVisible();
    await expect(page.getByRole("heading", { name: SEED_BARS[0] })).toBeVisible();
    await page.getByRole("button", { name: "I'm inside" }).click();
    // Under 30 seconds is not counted as a real wait, and the app says so.
    await expect(page.getByRole("heading", { name: "Too quick to count" })).toBeVisible();
    await page.getByRole("link", { name: "Done" }).click();
    await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open line timer" })).toHaveCount(0);
  });

  test("changes the pass suggestion limit in Settings", async () => {
    await page.getByRole("link", { name: "Settings" }).click();
    const slider = page.getByRole("slider", { name: "Wait limit in minutes" });
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("Saved. Limit is 30 min")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("slider", { name: "Wait limit in minutes" })).toHaveValue("30");
  });

  test("signs out", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("Phone number")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Phone number")).toBeVisible();
  });
});

test("deleting the account really deletes it", async ({ page, request }) => {
  const phone = fakePhone();
  await uiSignIn(page, "/", phone.national);
  await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete forever" }).click();
  await expect(page.getByLabel("Phone number")).toBeVisible();
  // Signing in again with the same phone is a brand new signup: the age gate applies again.
  const rc = await request.post("/v1/auth/request-code", { data: { phone: phone.e164 } });
  const code = (await rc.json()).dev_code;
  const vr = await request.post("/v1/auth/verify-code", { data: { phone: phone.e164, code } });
  expect(vr.status()).toBe(403);
});
