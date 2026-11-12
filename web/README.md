# Crowded web client

No build step. Plain HTML, CSS and classic JavaScript. The backend serves this folder at `/`.

## Two apps, two entry points
| Who | URL | What they get |
|---|---|---|
| Students | `/` (`index.html`) | Tonight list, bar detail, crowd reports, line timer, settings |
| Admins | `/admin.html` | Admin console: bars, pass price, staff invites, accuracy, audit log. Mock sign in is admin when the phone ends in 0001 |
| Door staff | `/staff.html` | Staff sign in, invite code, door counter, line checks, inside conditions. Managers also get specials and settings |

- Both use the same phone code sign in and the 21+ attestation.
- The student welcome screen has a "Work at a bar? Staff sign in" link. The staff page links
  back with "Not staff? Open the app".
- A staff account opening the student app sees a black banner on Tonight that opens the
  door counter. Student features keep working.
- A student account opening the staff page only gets the invite code step. The API also
  refuses staff routes for anyone who is not staff at that bar.

## Door mode (staff)
Door staff do fast door work only: count people in, report the line, report inside conditions.
Staff level comes from the admin invite (`door` by default, or `manager`). `me.staff_level` says which.
- Door staff tabs: Door, Line, Inside. Managers add Manage. Admins with no bar pick one first
  (`GET /v1/admin/bars`) and get the manager view.
- Door tab: one huge IN zone, +2 +3 +4 group buttons and Undo (30 seconds). OUT is a smaller button
  and shows only when `counts_exits` is true. Otherwise a quiet note says "This bar counts entries
  only." and the count reads "Entries tonight". Headcount, capacity and "Clicker total" also need
  `counts_exits`. Each tap vibrates (15 ms).
- Clicker keys: ArrowRight, PageDown, Space, Enter and "." count In. ArrowLeft, PageUp and ","
  count Out (they do nothing in count in only mode). Key repeats are ignored. Keys only work on the
  Door tab with no sheet open.
- Offline queue: a tap that fails on the network stays in an in memory queue (backup in
  localStorage `crowded.door.queue.<bar>`), shows "Saving when back online" and retries with backoff.
- The screen wake lock is requested on the Door tab and again when the page becomes visible.
- Line tab: outside line size, "Time the line" (up to 2 running, shown as chips at the top of every
  tab), last line check, and what students see.
- Inside tab: "How busy inside?" (Easy, Busy, Packed) and "How long for a drink?" (Under 5 min,
  5 to 10, 10 to 20, Over 20). Each tap posts `/inside`. Shows "Updated N min ago" and what students see.
- Manage tab (managers and admins): the Specials editor, the "Count exits too" switch
  (`PATCH .../settings`) and a "Tonight so far" block. Door staff get 403 `manager_only` from the API.
- Reminders while the page is open, every 15 minutes, dismissible, with vibration: "Update inside:
  how busy and drink wait", "Update the line size" (15 min) and "Time the line" (20 min since the
  last completed check).
- The student door code is off (`door_code_disabled`). The page has no code tab and no code step.

## Run it
With the backend: open http://localhost:8000/ (students) or http://localhost:8000/staff.html.

Without the backend:
```bash
python3 -m http.server 8765 --directory web
```
Then open http://localhost:8765/index.html?mock=1. In mock mode any 6 digit code works and
the code step offers a "Use it" button. On the staff page any invite code of 8 or more
characters works. A code starting MANAGER makes a manager, ENTRY joins the count in only bar and
ADMIN makes an admin. Anything else is door staff.

### Mock mode is local only
`?mock=1` only works on `localhost`, `127.0.0.1` or a `file:` page. On any other host the
parameter is ignored, so a link cannot flip a real user into a fake app. A bundle can force it
with `window.CROWDED_MOCK = true` (the preview bundler in `tools/` does this). Mock mode keeps
its own storage keys (`crowded.mock.rt` in localStorage, `crowded.mock` in sessionStorage) and
never reads, writes or removes the real refresh token `crowded.rt`.

## The look (v2)
Black and white on purpose. One calm column, hairline dividers instead of cards, flat black
buttons with a small radius, and the numbers as the hero.

- Crowd first: every bar leads with crowd level (word plus 3 segment meter), the line wait and the
  drink wait, then what the numbers are based on, then the pass call as quiet secondary text.
- Tonight rows are clean and tappable: name, crowd (with "· drinks 10 to 20 min" when known), wait, basis and one quiet deal line. "Report crowd", "I'm in line" and the pass call live on the bar page.
- Fonts: DM Sans for all text, Bricolage Grotesque only for big numbers (tabular figures).
- Wordmark is plain type ("Crowded", or "Crowded for staff").
- Crowd level never relies on color. Destructive actions are bold, not red.

## Motion
Native feel, one motion language. The timing lives in `css/tokens.css` and is shared with the
iOS app, so keep the values exact: press 120ms, screen 240ms, sheet 300ms, fade 160ms, enter
easing `cubic-bezier(0.2, 0, 0, 1)`, exit easing `cubic-bezier(0.4, 0, 1, 1)`.

- Press: every button, row, chip, tab and summary gets `.tap` from `ui.h()`. Pressed, it scales
  to 0.97 and dims a little, then springs back. The door IN zone uses 0.98 plus its flash.
  Primary buttons vibrate 8 ms where the phone supports it. The door keeps its own 15 ms.
- Screens: each student screen lives in a `.layer`. A push (Tonight to a bar, a bar to the
  timer) slides the new screen in from the right while the old one moves left 25% and dims.
  Back is the reverse. Tonight and Settings are tab roots and crossfade. Staff tabs fade.
- Back: pushed screens keep a 44px back button. A touch that starts within 24px of the left edge
  and moves right drags the screen. Past 35% of the width, or a fast flick, goes back. Less springs
  back. Never on Tonight, Settings or the staff Door tab. Vertical scrolls are never taken.
- iOS Safari in a browser tab has its own edge swipe, so ours turns off there
  (`<html data-edge-swipe="native">`). It runs as a home screen app or on other touch devices
  (`custom`). Any history back still plays the back slide, except right after Safari's own swipe.
- Sheets slide up over a fading scrim. Drag a sheet down to dismiss it.
- Numbers that change on a poll fade in over 160ms. Lists have no staggered entrance.
- Reduce Motion: no slides and no scale. Everything that moved becomes the 160ms fade.
- Only transform and opacity animate. `will-change` is set only while a layer moves.
- Code: `js/motion.js`. Tests: `e2e/tests/motion.spec.ts`.

## Change the look
Every visual value lives in `css/tokens.css`. You should rarely need to touch `css/app.css`.

| I want to change | Edit in `css/tokens.css` |
|---|---|
| Bring color back | Set `--accent` and `--accent-ink` (they equal the text color today). Then, where you want color, point a rule at `var(--accent)`: good first candidates are `.ring__prog` (timer ring) and `.door__btn--in`. For colored crowd levels, give `.meter[data-level="easy"]` etc. their own `--meter-on`. Set values in the light block and both dark blocks. |
| Fonts | `--font-display` (headings), `--font-body` (text), `--font-num` (big numbers). To add a self hosted font, drop the woff2 in `fonts/` and add an `@font-face` in `fonts/fonts.css`. |
| Corner roundness | `--radius-scale`. 0 is square, 1 is default (6 to 12px). |
| Density | `--density`. 0.9 is tighter, 1 is default, 1.15 is airier. |
| Light theme | the bare `:root` block (white, black text, neutral greys). |
| Dark theme | the `@media (prefers-color-scheme: dark)` block and the `:root[data-theme="dark"]` block. Keep them identical. |
| Chart | `--chart-typ` (typical bars) and `--chart-now` (tonight). |
| Motion | `--motion-press`, `--motion-screen`, `--motion-sheet`, `--motion-fade`, `--ease-enter`, `--ease-exit`, `--press-scale`. Shared with iOS, change both together. |
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
| `js/motion.js` | Press feedback, screen push and back, edge swipe back, sheet drag to dismiss, number fades. |
| `js/ui.js` | DOM helper, icons, wordmark, formatters, components (crowd meter, verdict line, sheet, toast, segmented control, timer ring), one shot location read. |
| `js/mock.js` | Fake API. Every bar is named "FAKE ...". |
| `js/api.js` | Real or mock API calls, token refresh, 401 and 429 handling, mock gating. |
| `js/auth.js` | Sign in flow shared by both pages (21+ attestation, phone, code). |
| `js/app.js` | Student app router and screens, report sheet, staff banner. Polls every 15 s while visible. |
| `js/admin.js` | Admin console (admins only). |
| `js/staff.js` | Staff app: invite step, door mode (tap zones, clicker keys, offline queue, wake lock), line checks, inside conditions, Manage tab, reminders, and the Specials editor. |
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
