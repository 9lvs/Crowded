# Crowded brand

**Leading direction (D-034, 2026-11-13): Meter C icon plus the Packed wordmark.** Door Gap is the
back pocket alternate. This is not final yet. It still needs a sign off from the marketing and
social friend. Black and white only (D-033).

## Finals

Artwork lives in `final/`. Start with `final/brand-sheet.png`.

| File | What |
|---|---|
| `final/meter-c-master.svg` | Meter C with optical corrections. Mark only, viewBox 1024 |
| `final/meter-c-small.svg` | Variant for 16 to 32 px. Wider gaps, thicker ring |
| `final/icon-dark.svg`, `icon-light.svg` | Full bleed square icons. White on ink is the main one |
| `final/icon-dark-small.svg`, `icon-light-small.svg` | Same with the small mark |
| `final/wordmark.svg`, `wordmark-white.svg` | Packed, outlined, no font needed |
| `final/lockup-horizontal*.svg`, `lockup-stacked*.svg` | Icon plus wordmark. `-white` is for dark grounds |
| `final/favicon.svg` | Small mark on a rounded square. Flips in dark mode. Copied to `web/` and `site/` |
| `final/png/` | icon-dark at 1024, 512, 180, 64, 32, 16 and the wordmark at 2x |
| `final/brand-sheet.png` | One page guide for marketing |

Also used from here: `ios/Crowded/Resources/Assets.xcassets/AppIcon.appiconset/` (1024 icon with
dark and tinted variants, no alpha), `web/` and `site/` (`favicon.svg`, `apple-touch-icon.png`) and
`marketing/templates/kit.html` (Instagram kit).

Optical corrections in the master: the ring is 3 percent taller than the flat letter height
(overshoot), both gaps share one angle, segment ends sit on radial lines, and the C is centered by
box then nudged right by 3 percent of its radius. Clear space is one segment width, the thickness
of the ring. The small variant is for anything under 40 px.

## Re-render
```bash
python3 marketing/brand/final/build.py
```
This rewrites the SVGs, the PNGs and `brand-sheet.png`. It needs Pillow and Node with Playwright.
The sheet template is `final/sheet.html`. To redo only the PNGs and sheet, run
`node marketing/brand/final/render.js`. To redo the iOS icon set after a change, run
`python3 marketing/brand/final/ios_icons.py`. Then run `node marketing/render.js` for Instagram.

## Explorations
The folders in `concepts/` are the original explorations. Each holds `mark.svg`, `icon-dark.svg`,
`icon-light.svg` and `wordmark.svg`. Icons use `viewBox="0 0 1024 1024"` with a rounded square.
Ink is `#0B0B0C`, paper is `#FFFFFF`.

Design canvas: "Crowded Logo Explorations", https://claude.ai/artifact/8qfhyfGkgGDT3xxP6kUsT4
(private until the owner shares it).

Design canvas: "Crowded Logo Explorations", https://claude.ai/artifact/8qfhyfGkgGDT3xxP6kUsT4
(private until the owner shares it).

## Concepts

Each folder in `concepts/` holds `mark.svg`, `icon-dark.svg`, `icon-light.svg` and `wordmark.svg`.
Icons use `viewBox="0 0 1024 1024"` with a rounded square. Ink is `#0B0B0C`, paper is `#FFFFFF`.

| # | Folder | Name | Idea |
|---|---|---|---|
| 1 | `meter-c` | Meter C | The app's 3 segment crowd meter bent into a C. |
| 2 | `meter` | Three Segment | The meter itself, all 3 segments on. Packed. |
| 3 | `queue` | The Queue | Three dots grow as they reach a door. The line. |
| 4 | `doorframe` | Door Gap | A doorframe with the door swung in. A gap of light. |
| 5 | `packed` | Packed | Wordmark only. Letters tracked so tight they touch. The icon is "Co". |
| 6 | `dot-c` | Crowd C | A C of dots that grow along the stroke. The crowd gets denser. |
| 7 | `ticket` | Stub | A ticket stub with a perforation of 3 slots. |
| 8 | `block-c` | Block C | A solid venue block with one way in. A monogram. |

## Picked

Leading pair: Meter C and Packed. Door Gap (`doorframe`) is the alternate. The notes below are the
original recommendation.

1. **Meter C.** It turns the meter people already read in the app into the letter C. It holds up
   at 16 px in one color and is ownable as an app icon.
2. **Packed.** The name made literal. Pair it with Meter C: Meter C for the icon and avatar,
   Packed for the wordmark.

## Type

Wordmarks in these files are DM Sans Bold, converted to outlines with fontTools from
`web/fonts/DMSans-latin.woff2`. No font is needed to view them. The canvas also tests
Bricolage Grotesque and Outfit. If a different face wins, outline it again before final.

## Before final
- [x] Redraw Meter C with optical corrections.
- [x] 16 px variant (`meter-c-small.svg`). A separate 29 px hinted cut was not needed.
- [x] Export PNGs for the App Store icon and the Instagram avatar from the final master.
- [ ] Marketing and social friend signs off on Meter C plus Packed.
- [ ] If a different typeface wins for the wordmark, outline it again and re-run `build.py`.
