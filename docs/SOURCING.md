# Sourcing: getting accurate crowd and line data

The owner's concern is right. Most students will not report out of goodwill. So Crowded must not
depend on goodwill. The plan has three layers, ordered by how much we can rely on them.

## Layer 1: data that does not depend on students (the backbone)
1. **Door staff counts.** Paid or contracted, at the door all night anyway. Taps In and Out, sets
   the outside line size. Gives exact headcount and entry rate. Headcount alone answers "how packed
   is it".
2. **Physics.** Wait = people in line / entry rate. With a door count running, we need only a
   rough line size to get a decent wait.
3. **Pilot ambassadors.** For the pilot, pay 1 or 2 students per bar per night (cash, cover, or
   merch) to report every 20 minutes from 10pm to 1am. Cheap, guarantees fresh data while the
   habit forms, and they are "trusted reporters" whose reliability starts high but is still
   learned.
4. **Later: a door sensor.** A $50 to $150 infrared beam counter at the door removes tapping. Ask
   your bar security friends what doors already use.

Goal for the pilot: at least 80 percent of 15 minute intervals from 10pm to 1am have recent
data, even if students report almost nothing. The simulator measures this.

## Layer 2: make student input nearly effortless and self interested
The most valuable student signal is the **line timer**, not the report. A timer is ground truth:
how long a real person actually waited. Make it the easiest thing in the app.
- **One tap to start, one tap to stop.** On iOS, a Live Activity on the lock screen shows the
  running timer with an "I'm inside" button, so nobody has to unlock and find the app. This fixes
  the "forgot to stop" problem. (iOS Phase 3 work.)
- **Selfish reasons to start a timer:** the timer shows "about 12 min left" from the live estimate,
  a place in line feel, and tells your friends when you are in ("Share: I'm in at FAKE Owl").
- **Two tap report at the moment of highest motivation:** when someone opens a bar that shows
  "No recent data" while near it, ask "Help the next person: is there a line?"
- **Give to get, softly:** everyone sees live numbers. Recent contributors unlock extras such as
  the hour by hour chart and "best time to go" trends. Never gate the core number, because that
  kills growth.

## Layer 3: rewards that are worth something
- **Points already exist** (10 per near-bar timer, 2 per near-bar report).
- **Redeem with partner bars:** skip the line once a month, free cover before 10pm, merch. Avoid
  free or discounted alcohol as a reward. Many states restrict that ("tied house" and inducement
  rules). Ask the lawyers.
- **Status:** streaks, "first report of the night", a campus leaderboard with nicknames (opt in),
  team competitions between clubs or Greek houses. These work very well on campuses.
- **Raffles:** a weekly prize drawn from people who contributed that weekend. A cheap way to lift
  participation. Check sweepstakes rules with the lawyers.

## Who wins when staff and students disagree?
Example: staff says the line is about 35 people, a student says about 20.

**Neither wins automatically.** Staff are at the door, but they can be wrong, lazy (set it once
at 10pm and forget), or biased (a long line looks good and sells skip passes). Students can be
far away, joking, or wrong too. So we weigh each source by a **reliability score learned from
ground truth**, and a completed line timer is the referee.

How it works in v1 (implemented, see `backend/app/estimation/engine.py`):
1. **One weighted median across all line readings** in the last 30 minutes.
   - Staff reading weight = 3.0 x staff member's reliability x recency.
   - Student report weight = student's reliability x recency (x 0.3 if not near the bar).
   - With default reliability 0.6, one staff reading counts like five average student reports.
2. **Timers referee everyone.** When a student finishes a near-bar timer, we know roughly how many
   people were really in line: actual wait x entry rate at the start. Every staff reading and
   student report made in the 10 minutes before that timer started is compared with it, and each
   person's reliability moves toward how close they were.
   - Staff who inflate or forget the line lose weight automatically within a night or two.
   - Students who report accurately gain weight. Liars and jokers fade out.
3. **Disagreement is shown, not hidden.** When staff and students differ by at least 10 people and
   at least 40 percent, the estimate gets a `sources_disagree` flag. Confidence drops a step, the
   range widens, and the basis line says "Staff and reports differ". Admins see it in metrics.
   Trust beats false precision.
4. **Wait time leans on timers.** Completed timers blend directly into the wait (more timers, more
   weight), so the line size argument matters less as soon as a few real waits come in.

Worked example (staff 35, student 20, then a timer):
- 1 staff reading (weight 1.8) vs 1 student (weight 0.6): line = 35. Flag "Staff and reports differ".
- 1 staff vs 4 students who all say about 20 (weight 2.4): line = about 20. Flag stays.
- A student then waits 9 minutes with the door letting in 2 per minute: about 18 people really.
  The staff member's reliability drops, the four students' rises. Next time the staff reading
  counts for less, until they get accurate again.

## What we tell bars
The staff counter shows what students are reporting ("What students see"). Staff who see their
numbers diverge can fix them. Repeated large gaps show up in admin metrics, which gives the
partner conversation facts instead of opinions.

## Staff line samples, door code and clicker sync
Students do not always stop their timers. Three tools cover that.

**Staff line samples.** Paid door staff pick a person at the back of the line and time them to the
door. A bar can have 2 active samples at once. A sample under 0.5 min or over 240 min is dropped.
A sample older than 3 hours counts as abandoned. A finished sample feeds the estimate as a
verified timer, writes an estimate error row, and referees line claims the same way a student
timer does. Every start and end is in the audit log.

**Door code.** Staff screens show a 4 digit code that changes every 2 minutes. It is an HMAC of
the bar id and the time bucket, so nothing is stored. A student types it when they get inside.
The current and the previous code both work. A right code marks the timer verified and pays 20
points instead of 10. A wrong code never fails the request. The timer just ends unverified. Each
user gets 5 wrong codes per hour. After that codes are ignored and nothing else changes.

**Clicker sync.** A busy door can tap a clicker and enter the total. The server stores the
difference from tonight's headcount as one event marked `sync`. Sync events move the headcount
but never the entry or exit rates, so a big jump cannot fake a fast line.

## Measuring it
- Freshness: share of peak 15 minute intervals with recent data (target 80 percent or more).
- Accuracy: mean absolute error of the estimate against completed timers (target under 5 min).
  Admin endpoint `/v1/admin/metrics/accuracy`.
- Participation: reports and timers per 100 active users per night.
- Staff reliability per staff member, and the share of the night their counter was active.
