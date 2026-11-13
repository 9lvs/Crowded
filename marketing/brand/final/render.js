// Renders the PNG exports and the brand sheet from the SVGs in this folder.
// Usage: node marketing/brand/final/render.js   (build.py runs this for you)
// Needs Playwright with Chromium (preinstalled in the cloud sandbox).
// build.py strips the alpha channel from icon-*.png and brand-sheet.png afterwards.
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const here = __dirname;
const png = path.join(here, "png");
fs.mkdirSync(png, { recursive: true });

// [svg file, out name, width px, transparent background]
const icons = [
  ["icon-dark.svg", "icon-dark-1024.png", 1024],
  ["icon-dark.svg", "icon-dark-512.png", 512],
  ["icon-dark.svg", "icon-dark-180.png", 180],
  ["icon-dark.svg", "icon-dark-64.png", 64],
  ["icon-dark-small.svg", "icon-dark-32.png", 32],
  ["icon-dark-small.svg", "icon-dark-16.png", 16],
];

async function shot(browser, svgFile, out, w, h, transparent) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const url = "file://" + path.join(here, svgFile);
  const wrap = path.join(here, ".wrap.html");
  fs.writeFileSync(
    wrap,
    `<style>html,body{margin:0;background:transparent}img{display:block;width:${w}px;height:${h}px}</style><img src="${url}">`
  );
  await page.goto("file://" + wrap);
  await page.waitForFunction(() => document.images[0].complete);
  await page.screenshot({ path: out, omitBackground: transparent });
  await page.close();
  console.log("wrote", path.relative(process.cwd(), out));
}

(async () => {
  const browser = await chromium.launch();
  for (const [svg, out, w] of icons) {
    await shot(browser, svg, path.join(png, out), w, w, false);
  }
  // Wordmark at 2x. Tight viewBox is 722.7 x 144.8, so 1446 x 290.
  for (const [svg, out] of [
    ["wordmark.svg", "wordmark-2x.png"],
    ["wordmark-white.svg", "wordmark-white-2x.png"],
  ]) {
    const vb = fs.readFileSync(path.join(here, svg), "utf8").match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    await shot(browser, svg, path.join(png, out), Math.round(vb[1] * 2), Math.round(vb[2] * 2), true);
  }
  // Brand sheet
  const page = await browser.newPage({ viewport: { width: 2400, height: 1600 }, deviceScaleFactor: 1 });
  await page.goto("file://" + path.join(here, "sheet.html"));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.screenshot({ path: path.join(here, "brand-sheet.png"), clip: { x: 0, y: 0, width: 2400, height: 1600 } });
  console.log("wrote", path.relative(process.cwd(), path.join(here, "brand-sheet.png")));
  fs.rmSync(path.join(here, ".wrap.html"), { force: true });
  await browser.close();
})();
