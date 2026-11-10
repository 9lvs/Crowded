# Crowded web client

No build step. Plain HTML, CSS and classic JavaScript. The backend serves this folder at `/`.

## Two apps, two entry points
| Who | URL | What they get |
|---|---|---|
| Students | `/` (`index.html`) | Tonight list, bar detail, crowd reports, line timer, settings |
| Door staff | `/staff.html` | Staff sign in, invite code, door mode, line checks, door code, outside line picker, specials |

- Both use the same phone code sign in and the 21+ attestation.
- The student welcome screen has a "Work at a bar? Staff sign in" link. The staff page links
  back with "Not staff? Open the app".
- A staff account opening the student app sees a black banner on Tonight that opens the
  door counter. Student features keep working.
- A student account opening the staff page only gets the invite code step. The API also
  refuses staff routes for anyone who is not staff at that bar.

## Door mode (staff)
Bottom tabs: Door, Line, Code, Specials. Door mode is the default and stays uncluttered.
- Two big tap zones: OUT on the left third, IN on the right two thirds. Each tap vibrates (15 ms)
  and flashes. Group buttons +2, +3, +4 and Undo (30 seconds) sit under the zones.
- Clicker keys: ArrowRight, PageDown, Space, Enter and "." count In. ArrowLeft, PageUp and ","
  count Out. Key repeats are ignored. Keys only work on the Door tab with no sheet open.
- Offline queue: a tap that fails on the network stays in an in memory queue (backup in
  localStorage `crowded.door.queue.<bar>`), shows "Saving when back online" and retries with backoff.
  The count is optimistic and reconciled with the server state.
- The screen wake lock is requested on the Door tab and again when the page becomes visible.
- "Clicker total" opens a number pad and calls `POST /v1/staff/bars/{id}/count-sync`.
- Line tab: outside line size, "Time the line" (up to 2 running, shown as chips at the top of every
  tab), last line check, and what students see.
- Code tab: the 4 digit door code, large, with a countdown. It refreshes from `GET .../door-code`.
- Reminders while the page is open: "Update the line size" after 15 minutes and "Time the line"
  after 20 minutes. Dismissible, with vibration, no browser notifications.
- Students can type the code when they tap "I'm inside". It is optional and never blocks ending
  the timer. Mock mode has a FAKE code that changes every 2 minutes.

## Run it
With the backend: open http://localhost:8000/ (students) or http://localhost:8000/staff.html.

Without the backend:
```bash
python3 -m http.server 8765 --directory web
```
Then open http://localhost:8765/index.html?mock=1. In mock mode any 6 digit code works and
the code step offers a "Use it" button. On the staff page any invite code of 8 or more
characters works.

### Mock mode is local only
`?mock=1` only works on `localhost`, `127.0.0.1` or a `file:` page. On any other host the
parameter is ignored, so a link cannot flip a real user into a fake app. A bundle can force it
with `window.CROWDED_MOCK = true` (the preview bundler in `tools/` does this). Mock mode keeps
its own storage keys (`crowded.mock.rt` in localStorage, `crowded.mock` in sessionStorage) and
never reads, writes or removes the real refresh token `crowded.rt`.

## The look (v2)
Black and white on purpose. One calm column, hairline dividers instead of cards, flat black
buttons with a small radius, and the numbers as the hero.

- Crowd first: every bar leads with crowd level (word plus 3 segment meter) and the line wait,
  then what the numbers are based on, then the pass call as quiet secondary text.
- "Report" is on every Tonight row and "Report crowd" is the primary button on a bar.
- Fonts: DM Sans for all text, Bricolage Grotesque only for big numbers (tabular figures).
- Wordmark is plain type ("Crowded", or "Crowded for staff").
- Crowd level never relies on color. Destructive actions are bold, not red.

## Change the look
Every visual value lives in `css/tokens.css`. You should rarely need to touch `css/app.css`.

| I want to change | Edit in `css/tokens.css` |
|---|---|
| Bring color back | Set `--accent` and `--accent-ink` (they equal the text color today). Then, where you want color, point a rule at `var(--accent)`: good first candidates are `.verdict-line--strong`, `.ring__prog` (timer ring) and `.door__btn--in`. For colored crowd levels, give `.meter[data-level="easy"]` etc. their own `--meter-on`. Set values in the light block and both dark blocks. |
| Fonts | `--font-display` (headings), `--font-body` (text), `--font-num` (big numbers). To add a self hosted font, drop the woff2 in `fonts/` and add an `@font-face` in `fonts/fonts.css`. |
| Corner roundness | `--radius-scale`. 0 is square, 1 is default (6 to 12px). |
| Density | `--density`. 0.9 is tighter, 1 is default, 1.15 is airier. |
| Light theme | the bare `:root` block (white, black text, neutral greys). |
| Dark theme | the `@media (prefers-color-scheme: dark)` block and the `:root[data-theme="dark"]` block. Keep them identical. |
| Chart | `--chart-typ` (typical bars) and `--chart-now` (tonight). |
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
| `js/ui.js` | DOM helper, icons, wordmark, formatters, components (crowd meter, verdict line, sheet, toast, segmented control, timer ring), one shot location read. |
| `js/mock.js` | Fake API. Every bar is named "FAKE ...". |
| `js/api.js` | Real or mock API calls, token refresh, 401 and 429 handling, mock gating. |
| `js/auth.js` | Sign in flow shared by both pages (21+ attestation, phone, code). |
| `js/app.js` | Student app router and screens, report sheet, staff banner. Polls every 15 s while visible. |
| `js/staff.js` | Staff app: invite step, door mode (tap zones, clicker keys, offline queue, wake lock), line checks, door code, reminders, and the Specials editor. |
| `fonts/` | Bricolage Grotesque and DM Sans, latin subset, SIL OFL 1.1 (`OFL.txt`). |
| `tools/bundle_preview.py` | Inlines everything into one HTML file in mock mode for a shareable preview. |

End to end tests for this client live in `../e2e` (see its README).

## Rules this client follows
- Works under a strict Content Security Policy: no inline scripts or styles, no CDNs.
  Never add `style="..."` in markup. Use classes, or `el.style.setProperty` from JS.
- All server text goes in with `textContent`, never `innerHTML`. The only `innerHTML` use
  is the constant icon set in `ui.js`.
- Location is read once with `getCurrentPosition` when you tap "I'm in line" or send a
  report. Never `watchPosition`. If denied, nothing is sent.
- Access token in memory only. Refresh token in `localStorage` (`crowded.rt`). The iOS app
  will use the Keychain.
- Touch targets are at least 44px. Inline text links inside sentences are the only exception.
