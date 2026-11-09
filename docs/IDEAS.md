# Ideas backlog

Parked ideas with the open questions to settle before building. Not committed to a phase yet.

## Bar chat (per bar Q&A board)
Students post questions or concerns at a bar ("Is there a cover tonight?", "Dress code?").
- **Value:** more reasons to open the app between reports. Answers often come from people in
  line, which feeds sourcing.
- **Costs and risks:**
  - App Store guideline 1.2 applies to user generated text. We would need a content filter,
    report and block on every post, timely moderation, and published contact info.
  - Harassment, doxxing and posting about bar staff by name.
  - Legal exposure for defamation about a business. Section 230 helps in the US, but bars are
    our partners.
  - Underage or drunk posting, spam, and scraping.
- **Safer first version:** structured quick answers instead of free text ("Cover: yes, no or
  unsure", "Dress code: yes or no", "Line moving: fast or slow"). Tie posts to near-bar reports.
  Posts expire after the night. Bar staff get one pinned official note.
- **Questions for your friends:** lawyers on moderation duty and liability. Social media folks
  on the tone and community rules.

## Bar map with heat and trends
A map of downtown with each bar shaded by crowd level, plus "usually busy at 11pm" trends.
- **Data:** live snapshots (already stored every 2 min) and the hour by hour history (already
  computed for the detail chart).
- **Design:** monochrome map tiles, crowd shown by fill density plus a label, never color alone.
  A time scrubber for "tonight vs a typical Friday".
- **Cost:** a map tile provider (MapKit is free on iOS. Web needs Mapbox or MapLibre with hosted
  tiles, which can cost money). Ask before signing up.
- **Privacy:** map only bars. Never draw users.

## Location usage for users
- **Now:** location is read once per report or timer, reduced to near/not near, then discarded.
- **Next options (each needs a privacy review):**
  - "Bars near me" sorting, done on the device only: the server receives no location.
  - A nudge such as "You seem to be at FAKE Owl. Report the line?" This needs a geofence, which
    on iOS means region monitoring. Keep it opt in, never store regions server side, and avoid
    background location in v1 because App Review scrutinizes it.
  - Auto-end a line timer when you are inside. Same geofence concerns.
- **Rule:** no location trail, ever. Any new use goes through THREAT_MODEL.md first.

## More suggestions from the lead
- **Sourcing incentives:** points already exist in the ledger. Ideas: weekly leaderboard per
  campus (opt in, nicknames only), "first report of the night" bonus, and bar specials for top
  reporters (needs partner deals and a legal check on incentives tied to alcohol).
- **Report freshness nudge:** when a bar has no recent data, nudge nearby users who have the app
  open (no push to start).
- **Push notifications:** "The line at your favorite bar just dropped under 10 min." Needs APNs,
  a favorites feature and opt in.
- **Bar partner dashboard:** a read only night summary for owners (peak headcount, average
  wait). A good reason for bars to keep the door counter running.
- **Clicker hardware:** many doors already use a hand clicker. A cheap Bluetooth clicker paired
  to the staff page would remove phone tapping at the door. Ask your bar security friends.
- **Campus ambassadors:** students who report early each night to seed data. A social media
  angle.
- **Accuracy page:** publish our own MAE per bar ("our estimates were within 4 min last
  weekend"). This builds trust, and the data already exists in estimate_errors.
