/* Accessibility smoke checks in mock mode: names, labels, alt text, touch targets. */
import { expect, Page, test } from "@playwright/test";

async function audit(page: Page, where: string): Promise<void> {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const cs = getComputedStyle(el as HTMLElement);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    document.querySelectorAll("button, a[href], [role=button], [role=radio]").forEach((el) => {
      if (!visible(el)) return;
      const name = (el.getAttribute("aria-label") || el.textContent || "").trim();
      if (!name) out.push(`unnamed control: ${el.outerHTML.slice(0, 80)}`);
      // Inline text links inside sentences are exempt from the target size rule (WCAG 2.5.8).
      const inline = el.classList.contains("link-btn");
      const r = (el as HTMLElement).getBoundingClientRect();
      if (!inline && r.height < 44) out.push(`small target (${Math.round(r.height)}px): ${name}`);
    });
    document.querySelectorAll("img").forEach((img) => {
      if (!img.hasAttribute("alt")) out.push(`img without alt: ${img.src}`);
    });
    document.querySelectorAll("input").forEach((input) => {
      const id = input.id;
      const labelled =
        input.getAttribute("aria-label") ||
        input.getAttribute("aria-labelledby") ||
        (id && document.querySelector(`label[for="${id}"]`)) ||
        input.closest("label");
      if (!labelled) out.push(`input without label: ${input.outerHTML.slice(0, 80)}`);
    });
    return out;
  });
  expect(problems, where).toEqual([]);
}

test("student screens pass the accessibility smoke check", async ({ page }) => {
  await page.goto("/index.html?mock=1");
  await page.getByLabel("Phone number").waitFor();
  await audit(page, "welcome");
  await page.getByRole("checkbox", { name: /21 or older/ }).check();
  await page.getByLabel("Phone number").fill("5550004444");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("6 digit code").waitFor();
  await audit(page, "code");
  await page.getByRole("button", { name: "Use it" }).click();
  await page.getByRole("heading", { name: "Tonight" }).waitFor();
  await audit(page, "tonight");
  await page.getByRole("button", { name: /^FAKE The Tipsy Owl\./ }).click();
  await page.getByRole("region", { name: "Right now" }).waitFor();
  await audit(page, "bar detail");
  await page.goto("/index.html?mock=1#/settings");
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  await audit(page, "settings");
});

test("crowd level is never shown by color alone", async ({ page }) => {
  await page.goto("/index.html?mock=1");
  await page.getByRole("checkbox", { name: /21 or older/ }).check();
  await page.getByLabel("Phone number").fill("5550005555");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use it" }).click();
  const meters = page.getByRole("img", { name: /^Crowd: / });
  await expect(meters.first()).toBeVisible();
  const count = await meters.count();
  for (let i = 0; i < count; i++) {
    await expect(meters.nth(i)).toContainText(/Easy|Busy|Packed/);
  }
});
