# App Store readiness

Status legend: [x] done in repo, [ ] to do, (owner) needs you, (lawyer) needs legal review.

## 0. The path to the first review
1. **Internal TestFlight**: no Apple review. Up to 100 testers on your team. Needs an Apple
   Developer account and a signed build.
2. **External TestFlight**: up to 10,000 testers by link. Needs a lighter "Beta App Review".
   This is the realistic "first demo review" and the best way to pilot with students.
3. **App Store review**: full review against the App Review Guidelines.

## 1. Blocking decisions (owner)
- [ ] **Mac or no Mac.** The iOS app must be a native build. A web page in a wrapper gets
  rejected under guideline 4.2 (minimum functionality).
  - Mac with Xcode: build the SwiftUI app as planned (Phase 3).
  - No Mac: Expo (React Native) with EAS Build compiles and submits to TestFlight in the cloud.
    This needs a free Expo account. We would reuse the web client's screens and tokens.
- [ ] **Apple Developer Program**, $99 a year. Enroll as an organization (an LLC, which needs a
  D-U-N-S number) or as an individual. As an individual, your legal name shows as the seller.
  Ask your lawyer friends about an LLC for liability.
- [ ] **App name.** "Crowded" may already be taken on the App Store. Reserve it in App Store
  Connect early and have a fallback ready, for example "Crowded: Bar Lines". Ask your lawyer
  friends for a trademark check.
- [ ] **Bundle ID**, proposed `app.crowded.ios` (set in `CROWDED_APPLE_CLIENT_ID`). This needs a
  domain you control, for example crowded.app or getcrowded.com.

## 2. Required URLs and legal
- [x] Privacy Policy page (draft): `site/privacy.html`. (lawyer)
- [x] Terms of Use page (draft): `site/terms.html`. Apple's standard EULA also works. (lawyer)
- [x] Support URL page: `site/support.html`.
- [x] Marketing URL: `site/index.html`.
- [ ] Host the site on a real domain with HTTPS (owner, see docs/DEPLOY.md).
- [ ] Real contact emails in place of the `@crowded.example` placeholders (owner).

## 3. Guideline items we already meet in the backend and web client
- [x] **5.1.1(v) Account deletion in the app.** Settings, Delete account, which really deletes
  (`DELETE /v1/me`, tested).
- [x] **Age gate.** 21+ attestation at signup. Only the timestamp is stored.
- [x] **5.1.1 Data minimization.** No location trail, no coordinates stored, no date of birth,
  phone numbers stored as keyed hashes.
- [x] **4.8 Login.** Our own phone login plus Sign in with Apple. No third party social login, so
  Sign in with Apple is optional but already supported.
- [x] **2.1 App completeness: a demo account for the reviewer.** Set `CROWDED_REVIEW_PHONE` and
  `CROWDED_REVIEW_CODE` (6 digits) on the server. That phone gets the fixed code and no SMS.
  Rate limits and lockout still apply.
- [x] **1.2 User generated content.** Reports are structured (no free text), so the full UGC
  requirements do not apply yet. A bar chat would trigger them (see IDEAS.md).
- [ ] **2.1 Real content at review time.** Reviewers must see real, working data. Pilot with 2 to
  3 real bars before the App Store review. External TestFlight can use the demo bars, as long as
  the review notes explain them.

## 4. iOS project items (Phase 3)
- [ ] `NSLocationWhenInUseUsageDescription`: "Crowded checks once whether you're near the bar
  when you report or start a line timer. Your location is never stored or tracked."
- [ ] No background location mode. No `NSLocationAlwaysAndWhenInUseUsageDescription`.
- [ ] `ITSAppUsesNonExemptEncryption = NO`. We only use standard HTTPS, which removes the export
  compliance prompt.
- [ ] Privacy manifest (`PrivacyInfo.xcprivacy`): no tracking, no tracking domains, collected
  data types as listed in section 5, and required reason API declarations (for example
  UserDefaults: CA92.1).
- [ ] App icon 1024 x 1024, no transparency. Black and white wordmark.
- [ ] Screenshots: 6.9 inch iPhone (1320 x 2868) is required. 6.5 inch is optional. Use demo
  data and say so.
- [ ] Tokens in the Keychain only. App Transport Security stays on.

## 5. App Privacy questionnaire (draft answers, lawyer)
Tracking: **No.** No data is used to track users across other companies' apps or sites.

| Data type | Collected | Linked to user | Purpose |
|---|---|---|---|
| Contact info: phone number | Yes (stored as a keyed hash) | Yes | App functionality (login) |
| Identifiers: user ID | Yes | Yes | App functionality |
| Location: coarse location | Yes. We keep only near/not near and a distance bucket. Precise coordinates are processed and discarded | Yes | App functionality (report quality) |
| User content: other (crowd reports, line timers) | Yes | Yes, deleted after 30 days | App functionality |
| Usage data, diagnostics, contacts, health, financial, browsing | No | | |

Declaring coarse location is the conservative choice. Precise coordinates count as "not
collected" under Apple's definition (processed in real time, not retained), but the stored
distance bucket is derived from them.

## 6. Age rating questionnaire
- Alcohol, tobacco or drug use or references: **Frequent** (the app is about bars).
- Everything else: None.
- Expect the 18+ rating. Combined with our own 21+ gate this is the safe answer. Do not
  under-report, because reviewers reject apps with a mismatched rating.

## 7. Store listing copy (draft)
- **Name:** Crowded
- **Subtitle (30 chars):** Bar lines and crowds, live
- **Promotional text:** Know the line before you go. Live waits and crowd levels at bars
  downtown, reported by people in line right now.
- **Description:**
  Crowded shows how long the line is and how packed it is inside at bars downtown, right now.
  Every number shows what it is based on, like "Based on 6 reports in the last 30 min". If nobody
  has reported recently, Crowded says so instead of guessing.

  In line? Tap "I'm in line", then "I'm inside" when you get in. Your time makes the estimate
  better for everyone. Or send a quick crowd report in two taps.

  Thinking about a line skip pass? Set your limit and Crowded tells you when the wait is worth it.

  Private by design. Crowded never stores your location trail, only whether you were near the
  bar. 21+ only.
- **Keywords (100 chars):** bar,line,wait,nightlife,crowd,college,downtown,club,queue,cover,pass
- **Category:** Lifestyle (secondary: Navigation or Food & Drink)

## 8. Review notes (draft, paste into App Store Connect)
> Crowded shows live line wait times and crowd levels at partner bars. It is for adults 21+.
> Sign in: use phone +1 555 XXX XXXX with code XXXXXX (demo account, no SMS needed). Check
> "I'm 21 or older" on the first screen.
> Location is requested only when you tap Report or I'm in line. It is used once to check you
> are near the bar and is never stored.
> Staff mode: bar door staff count people in and out on the web page at /staff.html. They need
> an invite from us. A demo staff invite code is: XXXXX-XXXXX.
> Account deletion: Settings, Delete account.
> We do not sell passes. Pass prices are entered manually by our team for reference only.
