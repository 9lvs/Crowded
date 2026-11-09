# Estimation model (v1)

Code: `backend/app/estimation/` (pure functions, contract in `types.py`).

## Signals
| Signal | Source | Used for |
|---|---|---|
| Door events (in, out) | Staff counter | Headcount, entry rate, exit rate |
| Outside line size | Staff picker | People in line |
| Line timers | Users ("I'm in line" to "I'm inside") | Observed waits, calibration |
| Crowd reports | Users | Crowd level and line size when staff data is missing |

## Formula
1. **Headcount** = tonight's ins minus outs (never below 0). Ratio = headcount / capacity.
2. **Crowd level** from ratio: under 0.60 easy, under 0.90 busy, otherwise packed. Without door
   data, use the reliability and recency weighted vote of recent reports.
3. **People in line**: one weighted median over staff line readings (weight 3.0 x staff
   reliability x recency) and student line reports (reliability x recency, x 0.3 if far).
   See docs/SOURCING.md. Bucket to people: none 0, short 6, medium 18,
   long 38, very long 65. Active timers set a floor (at least that many people are in line).
4. **Entry rate** (people per minute) = ins over the last 15 minutes / 15.
   **Capacity mode**: when the ratio is 0.95 or more, the bar only lets people in as others leave,
   so entry rate = exit rate over the same window. Rates have a floor of 0.5 per minute.
5. **Formula wait** = people in line / entry rate, then times the calibration factor.
6. **Timer wait**: completed timers in the window. Trim outliers (outside median plus or minus
   3 MAD when there are 4 or more). Recency weighted median (half life 12 min) times reliability.
7. **Blend**: if both exist, weight timers by `n / (n + 2)` and the formula by the rest. If only
   one exists, use it. If only reports give a line size, use people / default rate 2 per minute
   (method "reports", low confidence).
8. **Range**: low and high are the estimate times 0.75 and 1.3 (low confidence: 0.6 and 1.6).

## Weights
- Recency: `w = 0.5 ** (age_min / half_life)`.
- Reliability: per user in [0, 1], default 0.6. Reports not near the bar are multiplied by 0.3.
- `update_reliability(current, predicted, observed)`: relative error `e = |obs - pred| /
  max(pred, 5)`. Target = 1 when e is 0, falling linearly to 0 at e = 1. Move 20 percent of the
  way toward the target. Clamp to [0.05, 1].

## Confidence and "no recent data"
- No reports, timers, staff line updates or door events in the window means `has_recent_data =
  False`, `confidence = none`, and every number is None. The UI shows "No recent data".
- Score points: staff line update in window +2, door events in rate window +2, each completed
  timer +1 (max 3), each near-bar report +0.5 (max 2). 0 to 1.5 low, 2 to 3.5 medium, 4+ high.

## Calibration
`calibration_factor(points, now)`: completed timers from the last 7 days, each paired with the
formula estimate stored when the timer started. Recency weighted median of actual / predicted,
ignoring predicted under 2 min (half life one day). No points gives 1.0. Clamped to [0.5, 2.0]. Every completed timer
also writes an `estimate_errors` row (predicted, actual, absolute error) so admins can track MAE.

## Flags
`sources_disagree`: staff and student line estimates differ by 10+ people and 40 percent.
Confidence drops a step and the basis text ends with "Staff and reports differ".

Completed near-bar timers score earlier line claims: people really in line = actual wait x
entry rate at start (stored on the session). Reliability of each staff member and student who
made a claim in the 10 minutes before moves toward their accuracy.

`staff_report_mismatch`: door based crowd level and the report vote differ by 2 steps
(easy vs packed). Shown to admins and used to lower confidence by one step.
`line_not_moving`: staff are counting the door, nobody entered in the last 15 min, yet a line is
reported. Either the door stopped (last call) or the line status is stale. Confidence drops to
low so the UI does not present a made up wait as solid. Found by the night simulator.

## Verdict
- No data: `no_data`, text "No recent data. No call yet."
- Wait over threshold and a pass is offered: `buy_pass`, minutes saved = wait.
- Wait over threshold and no pass: `no_pass_available`.
- Otherwise `wait_it_out`.
