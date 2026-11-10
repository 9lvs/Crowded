# Marketing kit

Black and white launch kit for Instagram and other social, plus a one pager for bars.

| Path | What | Size |
|---|---|---|
| `instagram/profile-1080.png` | Profile picture (reads at a 110 px circle) | 1080 x 1080 |
| `instagram/post-1` to `post-6b` | Launch grid, alternating black and white | 1080 x 1350 |
| `instagram/carousel-1` to `3` | Line timer explainer | 1080 x 1350 |
| `instagram/story-1` to `4` | Stories with safe zones (no text in the top 250 or bottom 340 px) | 1080 x 1920 |
| `instagram/highlight-*` | Highlight covers: How it works, Privacy, Bars, Beta | 1080 x 1920 |
| `for-bars-one-pager.png` | Print ready one pager for bar managers | 2550 x 3300 (US letter at 300 dpi) |
| `COPY.md` | Bios, handles, captions, story text, 2 week plan, DMs | |

## Edit and re-render
1. Change words in `templates/kit.html`. Each frame is one `<section>` or `<div>` with a
   `data-out` name. Replace `[Town]`, `[date]` and the contact lines first.
2. Change the look in `templates/kit.css` (colors, type sizes, spacing tokens at the top).
3. Render everything:
```bash
node marketing/render.js
```
   Or one file by name, for example:
```bash
node marketing/render.js post-6
```
Needs Playwright with Chromium. Locally: `npm i -g playwright`, then `npx playwright install chromium`.

## Rules
- Bar names in the illustrations are FAKE. Use a real bar only with that bar's written OK.
- No invented numbers, users or reviews.
- Fonts are DM Sans and Bricolage Grotesque under the SIL Open Font License (`templates/fonts/OFL.txt`).
