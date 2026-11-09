// Renders the 1024 x 1024 app icon from icon.html. Usage: node ios/scripts/icon/render.js
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.goto("file://" + path.join(__dirname, "icon.html"));
  await page.waitForTimeout(300);
  const out = path.join(__dirname, "..", "..", "Crowded", "Resources", "Assets.xcassets", "AppIcon.appiconset", "AppIcon.png");
  await page.screenshot({ path: out });
  await browser.close();
  console.log("wrote " + out);
})();
