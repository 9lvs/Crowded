# Crowded web client

No build step. Plain HTML, CSS and classic JavaScript. The backend serves this folder at `/`.

- `index.html` is the student app (Tonight, Bar detail, In line timer, Settings).
- `staff.html` is the door counter for bar staff.
- Add `?mock=1` to either URL to run against fake in-memory data (no backend needed).

## Run it
With the backend: open http://localhost:8000/ (student) or http://localhost:8000/staff.html.

Without the backend:
```bash
python3 -m http.server 8765 --directory web
```
Then open http://localhost:8765/index.html?mock=1. In mock mode any 6 digit code works and
the code step offers a "Use it" button. On the staff page any invite code of 8 or more
characters works.

## Change the look
Every visual value lives in `css/tokens.css`. You should rarely need to touch `css/app.css`.

| I want to change | Edit in `css/tokens.css` |
|---|---|
| Accent color (verdict chip, timer ring) | `--accent`, `--accent-ink` (text on accent), `--accent-soft` (tinted card). Set them in the light block and both dark blocks. |
| Fonts | `--font-display` (headings and big numbers) and `--font-body`. To add a new self hosted font, drop the woff2 in `fonts/` and add an `@font-face` in `fonts/fonts.css`. |
| Corner roundness | `--radius-scale`. 0 is square, 1 is default, 1.5 is rounder. |
| Density | `--density`. 0.85 is tighter, 1 is default, 1.15 is airier. |
| Light theme colors | the `:root` block (Uber style black and white). |
| Dark theme colors | the `@media (prefers-color-scheme: dark)` block and the `:root[data-theme="dark"]` block. Keep them identical. |
| Crowd colors | `--good` (easy), `--warn` (busy), `--alert` (packed). The label text always shows too. |
| Motion speed | `--dur-fast`, `--dur-base`, `--dur-slow`. Reduce Motion sets them to 0. |
| Type sizes | `--text-xs` through `--text-hero`. |

Tip: open the page in a desktop browser, use the device toolbar for an iPhone size, and
edit the variables live in DevTools (select `<html>`, Styles panel). Copy what you like back
into `tokens.css`.

## Files
| File | What it does |
|---|---|
| `css/tokens.css` | Design tokens for both themes. |
| `css/app.css` | Component and screen styles. |
| `js/theme.js` | Applies the saved theme before first paint. |
| `js/ui.js` | DOM helper, icons, formatters, components (crowd meter, verdict chip, sheet, toast, segmented control, timer ring), one shot location read. |
| `js/mock.js` | Fake API. Every bar is named "FAKE ...". |
| `js/api.js` | Real or mock API calls, token refresh, 401 and 429 handling. |
| `js/auth.js` | Sign in flow shared by both pages (21+ attestation, phone, code). |
| `js/app.js` | Student app router and screens. Polls every 15 s while visible. |
| `js/staff.js` | Door counter with optimistic updates. |
| `fonts/` | Bricolage Grotesque and DM Sans, latin subset, SIL OFL 1.1 (`OFL.txt`). |

## Rules this client follows
- Works under a strict Content Security Policy: no inline scripts or styles, no CDNs.
  Never add `style="..."` in markup. Use classes, or `el.style.setProperty` from JS.
- All server text goes in with `textContent`, never `innerHTML`. The only `innerHTML` use
  is the constant icon set in `ui.js`.
- Location is read once with `getCurrentPosition` when you tap "I'm in line" or send a
  report. Never `watchPosition`. If denied, nothing is sent.
- Access token in memory only. Refresh token in `localStorage` (`crowded.rt`). The iOS app
  will use the Keychain.
- Crowd level is never color alone: label text plus a 3 segment meter.
