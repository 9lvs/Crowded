import { APIRequestContext, expect, Page } from "@playwright/test";

/** Seeded by backend/scripts/seed.py. FAKE admin, dev only. */
export const ADMIN_PHONE = "+15550000001";
export const SEED_BARS = ["FAKE The Tipsy Owl", "FAKE Copper Fox", "FAKE Neon Moose"];

let counter = 0;

/** A unique FAKE +1555 number per call. 10 national digits: 555 plus 7. */
export function fakePhone(): { e164: string; national: string } {
  counter += 1;
  const seven = String((Date.now() * 7 + counter * 7919) % 10_000_000).padStart(7, "0");
  const national = `555${seven}`;
  return { e164: `+1${national}`, national };
}

export interface ApiSession {
  access: string;
  refresh: string;
  user: { id: string; role: string; staff_bar_id: string | null };
}

/** Sign in through the API (dev returns dev_code). Attests 21+ unless told not to. */
export async function apiSignIn(
  request: APIRequestContext,
  phone: string,
  attest = true,
): Promise<ApiSession> {
  const rc = await request.post("/v1/auth/request-code", { data: { phone } });
  expect(rc.status(), await rc.text()).toBe(200);
  const code = (await rc.json()).dev_code as string;
  expect(code, "backend must run with CROWDED_ENV=dev for e2e").toMatch(/^\d{6}$/);
  const vr = await request.post("/v1/auth/verify-code", {
    data: { phone, code, age_attested: attest, platform: "web" },
  });
  expect(vr.status(), await vr.text()).toBe(200);
  const body = await vr.json();
  return { access: body.access_token, refresh: body.refresh_token, user: body.user };
}

let adminSession: Promise<ApiSession> | null = null;

/** The seeded admin, signed in once per worker. The backend allows only 3 code requests per
    phone per 10 minutes, so tests must share this session instead of signing in again. */
export function adminSignIn(request: APIRequestContext): Promise<ApiSession> {
  if (!adminSession) adminSession = apiSignIn(request, ADMIN_PHONE);
  return adminSession;
}

export function auth(s: ApiSession): Record<string, string> {
  return { Authorization: `Bearer ${s.access}` };
}

/** Phone code sign in through the UI. Works on index.html and staff.html. */
export async function uiSignIn(page: Page, path: string, national: string): Promise<void> {
  await page.goto(path);
  await page.getByLabel("Phone number").waitFor();
  await page.getByRole("checkbox", { name: /21 or older/ }).check();
  await page.getByLabel("Phone number").fill(national);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("6 digit code").waitFor();
  // Dev builds show the code with a one tap "Use it" button.
  await page.getByRole("button", { name: "Use it" }).click();
}

/** Fail the test on any console error or uncaught exception. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/** Start a browser session from an API sign in, without going through the sign in screens. */
export async function openAs(page: Page, session: ApiSession, path: string): Promise<void> {
  await page.goto("/staff.html");
  await page.evaluate((rt) => window.localStorage.setItem("crowded.rt", rt), session.refresh);
  await page.goto(path);
}
