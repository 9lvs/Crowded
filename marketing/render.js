// Renders every [data-out] element in templates/kit.html to marketing/<data-out>.png.
// Usage: node marketing/render.js [filter]
// Needs Playwright (preinstalled in the cloud sandbox. Locally: npm i -g playwright, then
// npx playwright install chromium).
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const root = __dirname;
  const filter = process.argv[2] || "";
  const browser = await chromium.launch();
  for (const scale of [1, 3]) {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 2000 },
      deviceScaleFactor: scale,
    });
    await page.goto("file://" + path.join(root, "templates", "kit.html"));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    const items = await page.$$eval("[data-out]", (els) =>
      els.map((e, i) => ({ i, out: e.dataset.out, scale: Number(e.dataset.scale || 1) }))
    );
    const handles = await page.$$("[data-out]");
    for (const item of items) {
      if (item.scale !== scale || !item.out.includes(filter)) continue;
      const file = path.join(root, item.out + ".png");
      await handles[item.i].screenshot({ path: file });
      console.log("wrote", path.relative(process.cwd(), file));
    }
    await page.close();
  }
  await browser.close();
})();
