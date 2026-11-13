/* Motion in mock mode: press feedback, screen push and back, edge swipe back, sheet swipe
   down, Reduce Motion. Any server on localhost works, no backend data needed.
   Touch gestures go through the Chrome DevTools protocol so they are real touch events. */
import { BrowserContext, expect, Page, test } from "@playwright/test";
import { collectErrors } from "./helpers";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

interface Frame {
  top: boolean;
  fade: boolean;
  transform: string;
  opacity: string;
  title: string;
}

/** Records every animation frame in which a screen layer is moving. */
async function recordFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: unknown[] };
    w.__frames = [];
    const sample = () => {
      document.querySelectorAll(".layer.is-moving").forEach((l) => {
        const cs = getComputedStyle(l);
        const h1 = l.querySelector("h1");
        w.__frames.push({
          top: l.classList.contains("is-top"),
          fade: l.classList.contains("is-fade"),
          transform: cs.transform,
          opacity: cs.opacity,
          title: h1 ? h1.textContent : "",
        });
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function frames(page: Page): Promise<Frame[]> {
  return page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames.splice(0));
}

async function signInMock(page: Page): Promise<void> {
  await page.goto("/index.html?mock=1");
  await page.getByRole("checkbox", { name: /21 or older/ }).check();
  await page.getByLabel("Phone number").fill("5550004444");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use it" }).click();
  await expect(page.getByRole("heading", { name: "Tonight", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Bars tonight" }).getByRole("listitem")).toHaveCount(3);
}

async function settled(page: Page): Promise<void> {
  await expect(page.locator(".layer.is-moving")).toHaveCount(0);
  await expect(page.locator(".layer")).toHaveCount(1);
}

async function openOwl(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^FAKE The Tipsy Owl\./ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "FAKE The Tipsy Owl" })).toBeVisible();
  await settled(page);
}

/** A one finger drag with real touch events. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12, stepMs = 16) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, x?: number, y?: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: x === undefined ? [] : [{ x, y: y as number }] });
  await send("touchStart", from.x, from.y);
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(stepMs);
    await send("touchMove", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.waitForTimeout(stepMs);
  await send("touchEnd");
  await cdp.detach();
}

function width(page: Page): number {
  return page.viewportSize()?.width ?? 390;
}

test.describe("edge swipe on a non iOS touch device", () => {
  test.use({ userAgent: ANDROID_UA });

  test("swipe from the left edge on a bar goes back to Tonight", async ({ page }) => {
    const errors = collectErrors(page);
    await recordFrames(page);
    await signInMock(page);
    await expect(page.locator("html")).toHaveAttribute("data-edge-swipe", "custom");
    await openOwl(page);
    await frames(page);

    // The back button is still there, with a 44px target.
    const backBtn = page.getByRole("button", { name: "Back to Tonight" });
    const box = await backBtn.boundingBox();
    expect(box && box.width >= 44 && box.height >= 44).toBeTruthy();

    await drag(page, { x: 5, y: 400 }, { x: width(page) * 0.7, y: 405 });
    await expect(page.getByRole("heading", { name: "Tonight", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/#\/tonight$/);
    await settled(page);
    // Tonight was rendered underneath while the bar page followed the finger.
    const seen = await frames(page);
    expect(seen.some((f) => !f.top && f.title === "Tonight")).toBeTruthy();
    expect(seen.some((f) => f.top && f.title === "FAKE The Tipsy Owl" && f.transform !== "none")).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test("a short drag springs back and stays on the bar", async ({ page }) => {
    const errors = collectErrors(page);
    await signInMock(page);
    await openOwl(page);
    await drag(page, { x: 5, y: 400 }, { x: 70, y: 402 }, 10, 40);
    await settled(page);
    await expect(page).toHaveURL(/#\/bar\//);
    await expect(page.getByRole("heading", { level: 1, name: "FAKE The Tipsy Owl" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tonight", exact: true })).toHaveCount(0);
    expect(await page.locator(".layer").evaluate((l) => getComputedStyle(l).transform)).toBe("none");
    expect(errors).toEqual([]);
  });

  test("a vertical drag from the edge scrolls and never swipes back", async ({ page }) => {
    await signInMock(page);
    await openOwl(page);
    await drag(page, { x: 6, y: 600 }, { x: 14, y: 250 });
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/#\/bar\//);
    await settled(page);
  });

  test("no edge swipe on Tonight, a tab root", async ({ page }) => {
    await signInMock(page);
    await drag(page, { x: 5, y: 400 }, { x: width(page) * 0.8, y: 400 });
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/#\/tonight$/);
    await settled(page);
  });

  test("swipe the report sheet down to dismiss it", async ({ page }) => {
    const errors = collectErrors(page);
    await signInMock(page);
    await openOwl(page);
    await page.getByRole("button", { name: "Report crowd", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(400);
    const box = await sheet.boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;
    await drag(page, { x: box.x + box.width / 2, y: box.y + 30 }, { x: box.x + box.width / 2, y: box.y + 30 + box.height * 0.6 });
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 3_000 });
    expect(errors).toEqual([]);
  });
});

test.describe("edge swipe on iOS", () => {
  test("as a home screen app the custom swipe runs", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => true });
    });
    await signInMock(page);
    await expect(page.locator("html")).toHaveAttribute("data-edge-swipe", "custom");
    await openOwl(page);
    await drag(page, { x: 5, y: 400 }, { x: width(page) * 0.7, y: 400 });
    await expect(page.getByRole("heading", { name: "Tonight", exact: true })).toBeVisible();
    await settled(page);
  });

  test("in a Safari tab the browser owns the swipe, and history back still animates", async ({ page }) => {
    const errors = collectErrors(page);
    await recordFrames(page);
    await signInMock(page);
    // The iPhone 14 profile is Mobile Safari: our gesture stays off so it never fights Safari.
    await expect(page.locator("html")).toHaveAttribute("data-edge-swipe", "native");
    await openOwl(page);
    await drag(page, { x: 5, y: 400 }, { x: width(page) * 0.7, y: 400 });
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/#\/bar\//);
    // Right after an edge touch a history back is taken as Safari's own swipe, which already
    // animated. Wait past that window so this back counts as the toolbar Back button.
    await page.waitForTimeout(1000);
    await frames(page);

    // The Safari back button (or any history back) runs the back transition.
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Tonight", exact: true })).toBeVisible();
    await settled(page);
    const seen = await frames(page);
    expect(seen.some((f) => f.top && f.title === "FAKE The Tipsy Owl" && f.transform !== "none")).toBeTruthy();
    expect(errors).toEqual([]);
  });
});

test.describe("transitions", () => {
  test("push slides, tabs crossfade, and buttons press to 0.97", async ({ page }) => {
    const errors = collectErrors(page);
    await recordFrames(page);
    await signInMock(page);
    await frames(page);

    await openOwl(page);
    let seen = await frames(page);
    // The bar page came in on top from the right while Tonight moved left underneath.
    expect(seen.some((f) => f.top && f.title === "FAKE The Tipsy Owl" && f.transform !== "none")).toBeTruthy();
    expect(seen.some((f) => !f.top && f.title === "Tonight" && f.transform !== "none")).toBeTruthy();

    await page.getByRole("button", { name: "Back to Tonight" }).click();
    await expect(page.getByRole("heading", { name: "Tonight", exact: true })).toBeVisible();
    await settled(page);
    await frames(page);

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await settled(page);
    seen = await frames(page);
    // Tab switch: a crossfade, nothing slides.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((f) => f.transform === "none")).toBeTruthy();
    expect(seen.some((f) => f.fade && Number(f.opacity) < 1)).toBeTruthy();

    const btn = page.getByRole("button", { name: "Sign out" });
    await btn.dispatchEvent("pointerdown", { button: 0, pointerType: "touch", isPrimary: true });
    await page.waitForTimeout(200);
    const pressed = await btn.evaluate((el) => ({ t: getComputedStyle(el).transform, o: getComputedStyle(el).opacity }));
    expect(pressed.t).toMatch(/^matrix\(0\.97, 0, 0, 0\.97/);
    expect(Number(pressed.o)).toBeLessThan(1);
    await btn.dispatchEvent("pointercancel");
    expect(errors).toEqual([]);
  });

  test("Reduce Motion: fades only, no slides and no scale", async ({ page }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await recordFrames(page);
    await signInMock(page);
    await frames(page);

    await openOwl(page);
    await page.getByRole("button", { name: "Back to Tonight" }).click();
    await expect(page.getByRole("heading", { name: "Tonight", exact: true })).toBeVisible();
    await settled(page);
    const seen = await frames(page);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((f) => f.transform === "none")).toBeTruthy();

    const row = page.getByRole("button", { name: /^FAKE The Tipsy Owl\./ });
    await row.dispatchEvent("pointerdown", { button: 0, pointerType: "touch", isPrimary: true });
    await page.waitForTimeout(200);
    expect(await row.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
    await row.dispatchEvent("pointercancel");

    await openOwl(page);
    await page.getByRole("button", { name: "Report crowd", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.getByRole("dialog").evaluate((el) => getComputedStyle(el).transform)).toBe("none");
    expect(errors).toEqual([]);
  });
});

test("staff tabs crossfade and the door has no edge swipe", async ({ browser }) => {
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 390, height: 664 },
    userAgent: ANDROID_UA,
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto("/staff.html?mock=1");
  await page.getByRole("checkbox", { name: /21 or older/ }).check();
  await page.getByLabel("Phone number").fill("5550005555");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use it" }).click();
  await page.getByLabel("Invite code").fill("FAKE-INVITE");
  await page.getByRole("button", { name: "Join bar" }).click();
  const inZone = page.getByRole("button", { name: "One person in" });
  await expect(inZone).toBeVisible();
  // The IN zone presses to 0.98.
  await inZone.dispatchEvent("pointerdown", { button: 0, pointerType: "touch", isPrimary: true });
  await page.waitForTimeout(200);
  expect(await inZone.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^matrix\(0\.98, 0, 0, 0\.98/);
  await inZone.dispatchEvent("pointercancel");
  await drag(page, { x: 5, y: 300 }, { x: 300, y: 300 });
  await expect(inZone).toBeVisible();
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Outside line" })).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();
});
