from __future__ import annotations

import pytest

from app.estimation import Confidence, Crowd, Params, ReportIn
from tests.estimation.helpers import (
    active_timer,
    ahead,
    done_timer,
    door,
    line,
    report,
    run,
)

# ---------- no data ----------


def test_no_data_state() -> None:
    est = run()
    assert est.has_recent_data is False
    assert est.confidence is Confidence.none
    assert est.method == "none"
    for value in (
        est.wait_min,
        est.wait_low_min,
        est.wait_high_min,
        est.crowd_level,
        est.headcount,
        est.capacity_ratio,
        est.people_in_line,
        est.entry_rate_per_min,
    ):
        assert value is None
    assert est.capacity == 100
    assert est.capacity_mode is False
    assert est.flags == ()
    assert est.basis.text == "No recent data"
    assert est.basis.window_min == 30
    assert est.basis.reports == 0


def test_old_data_is_no_data() -> None:
    est = run(
        reports=[report(minutes_ago=31, crowd="busy", size="long")],
        lines=[line("long", 45)],
        timers=[done_timer(10, ended_minutes_ago=40)],
        doors=[door("in", 50, 31)],
    )
    assert est.has_recent_data is False
    assert est.basis.text == "No recent data"


def test_old_active_timer_alone_is_no_data() -> None:
    est = run(timers=[active_timer(started_minutes_ago=120)])
    assert est.has_recent_data is False


def test_future_timestamps_ignored() -> None:
    est = run(
        reports=[ReportIn(user_id="u1", ts=ahead(5), crowd_level="packed", line_size="very_long")],
        lines=[line("very_long", -5)],
        doors=[door("in", 90, -5)],
        timers=[
            done_timer(10, ended_minutes_ago=-3),
            active_timer(started_minutes_ago=-4),
        ],
    )
    assert est.has_recent_data is False
    assert est.headcount is None


def test_future_door_event_not_in_headcount() -> None:
    est = run(doors=[door("in", 20, 5), door("in", 70, -2)])
    assert est.headcount == 20
    assert est.basis.door_events == 1


# ---------- single source modes ----------


def test_staff_only() -> None:
    est = run(lines=[line("medium")], doors=[door("in", 36, 5)])
    assert est.has_recent_data
    assert est.method == "formula"
    assert est.people_in_line == 18
    assert est.entry_rate_per_min == pytest.approx(2.4)
    assert est.wait_min == pytest.approx(7.5)
    assert est.wait_low_min == pytest.approx(7.5 * 0.75)
    assert est.wait_high_min == pytest.approx(7.5 * 1.3)
    assert est.confidence is Confidence.high
    assert est.headcount == 36
    assert est.capacity_ratio == pytest.approx(0.36)
    assert est.crowd_level is Crowd.easy
    assert est.basis.text == "Based on staff counts in the last 30 min"
    assert est.basis.door_events == 1
    assert est.basis.staff_line_updates == 1


def test_timers_only() -> None:
    est = run(timers=[done_timer(10), done_timer(10, user="u2"), done_timer(10, user="u3")])
    assert est.method == "timers"
    assert est.wait_min == pytest.approx(10)
    assert est.people_in_line is None
    assert est.confidence is Confidence.medium
    assert est.wait_low_min == pytest.approx(7.5)
    assert est.wait_high_min == pytest.approx(13)
    assert est.basis.text == "Based on 3 timers in the last 30 min"
    assert est.crowd_level is None


def test_single_timer_is_low_confidence_wide_range() -> None:
    est = run(timers=[done_timer(20)])
    assert est.confidence is Confidence.low
    assert est.wait_min == pytest.approx(20)
    assert est.wait_low_min == pytest.approx(12)
    assert est.wait_high_min == pytest.approx(32)
    assert est.basis.text == "Based on 1 timer in the last 30 min"


def test_blend_of_formula_and_timers() -> None:
    est = run(
        lines=[line("medium")],
        doors=[door("in", 36, 5)],
        timers=[done_timer(15), done_timer(15, user="u2")],
    )
    # formula 7.5, timer 15, timer weight 2/4
    assert est.method == "blend"
    assert est.wait_min == pytest.approx(11.25)
    assert est.confidence is Confidence.high
    assert est.basis.text == "Based on 2 timers and staff counts in the last 30 min"


def test_blend_weight_grows_with_timer_count() -> None:
    timers = [done_timer(20, user=f"u{i}") for i in range(6)]
    est = run(lines=[line("medium")], doors=[door("in", 36, 5)], timers=timers)
    # n = 6, timer weight 6/8
    assert est.wait_min == pytest.approx(0.75 * 20 + 0.25 * 7.5)


def test_reports_only_line_size() -> None:
    est = run(reports=[report("u1", size="long"), report("u2", size="long", crowd="busy")])
    assert est.method == "reports"
    assert est.people_in_line == 38
    assert est.entry_rate_per_min == pytest.approx(2.0)
    assert est.wait_min == pytest.approx(19.0)
    assert est.confidence is Confidence.low
    assert est.wait_low_min == pytest.approx(19 * 0.6)
    assert est.wait_high_min == pytest.approx(19 * 1.6)
    assert est.crowd_level is Crowd.busy
    assert est.basis.text == "Based on 2 reports in the last 30 min"


def test_reports_only_crowd_level_gives_no_wait() -> None:
    est = run(reports=[report(crowd="busy")])
    assert est.has_recent_data is True
    assert est.method == "none"
    assert est.wait_min is None
    assert est.wait_low_min is None
    assert est.wait_high_min is None
    assert est.people_in_line is None
    assert est.crowd_level is Crowd.busy
    assert est.confidence is Confidence.low


def test_timers_beat_report_only_guess() -> None:
    est = run(reports=[report(size="very_long")], timers=[done_timer(12)])
    assert est.method == "timers"
    assert est.wait_min == pytest.approx(12)
    assert est.people_in_line == 65


def test_staff_line_without_door_data_uses_default_rate() -> None:
    est = run(lines=[line("short")])
    assert est.method == "formula"
    assert est.entry_rate_per_min == pytest.approx(2.0)
    assert est.wait_min == pytest.approx(3.0)
    assert est.confidence is Confidence.medium


def test_door_only_has_crowd_but_no_wait() -> None:
    est = run(doors=[door("in", 50, 5)])
    assert est.method == "none"
    assert est.wait_min is None
    assert est.crowd_level is Crowd.easy
    assert est.entry_rate_per_min == pytest.approx(50 / 15)
    assert est.confidence is Confidence.medium


def test_old_door_events_still_count_as_staff_data() -> None:
    est = run(doors=[door("in", 70, 20)])
    assert est.has_recent_data
    assert est.headcount == 70
    assert est.crowd_level is Crowd.busy
    assert est.basis.door_events == 0
    assert est.basis.text == "Based on staff counts in the last 30 min"
    assert est.confidence is Confidence.low


# ---------- rates ----------


def test_capacity_mode_uses_exit_rate() -> None:
    est = run(
        lines=[line("short")],
        doors=[door("in", 130, 20), door("in", 10, 5), door("out", 30, 5)],
    )
    assert est.headcount == 110
    assert est.capacity_mode is True
    assert est.crowd_level is Crowd.packed
    assert est.entry_rate_per_min == pytest.approx(2.0)  # 30 outs / 15
    assert est.wait_min == pytest.approx(3.0)


def test_below_capacity_mode_uses_entry_rate() -> None:
    est = run(
        lines=[line("short")],
        doors=[door("in", 130, 20), door("out", 50, 20), door("in", 15, 5), door("out", 60, 5)],
    )
    assert est.headcount == 35
    assert est.capacity_mode is False
    assert est.entry_rate_per_min == pytest.approx(1.0)


def test_rate_floor() -> None:
    est = run(lines=[line("medium")], doors=[door("in", 3, 5)])
    assert est.entry_rate_per_min == pytest.approx(0.5)
    assert est.wait_min == pytest.approx(36.0)


def test_dead_door_uses_rate_floor() -> None:
    est = run(lines=[line("short")], doors=[door("in", 40, 25)])
    assert est.entry_rate_per_min == pytest.approx(0.5)
    assert est.wait_min == pytest.approx(12.0)


def test_calibration_scales_formula() -> None:
    est = run(lines=[line("medium")], doors=[door("in", 36, 5)], calibration=1.5)
    assert est.wait_min == pytest.approx(11.25)


def test_wait_clamped_to_max() -> None:
    p = Params(max_wait_min=60.0)
    est = run(lines=[line("very_long")], doors=[door("in", 3, 5)], params=p)
    assert est.wait_min == 60.0
    assert est.wait_high_min == 60.0
    assert est.wait_low_min is not None
    assert est.wait_low_min <= 60.0


def test_empty_line_is_zero_wait() -> None:
    est = run(lines=[line("none")], doors=[door("in", 3, 5)])
    assert est.people_in_line == 0
    assert est.wait_min == 0.0
    assert est.wait_low_min == 0.0
    assert est.wait_high_min == 0.0


def test_empty_line_overrides_timers() -> None:
    est = run(lines=[line("none")], doors=[door("in", 30, 5)], timers=[done_timer(15)])
    assert est.method == "blend"
    assert est.wait_min == 0.0


# ---------- people in line ----------


def test_latest_staff_line_wins() -> None:
    est = run(lines=[line("very_long", 10), line("short", 1), line("long", 20)])
    assert est.people_in_line == 6


def test_staff_line_beats_reports() -> None:
    est = run(lines=[line("short")], reports=[report(size="very_long")])
    assert est.people_in_line == 6


def test_active_timers_set_floor() -> None:
    timers = [active_timer(10, user=f"u{i}") for i in range(8)]
    est = run(lines=[line("short")], timers=timers)
    assert est.people_in_line == 8
    assert est.wait_min == pytest.approx(4.0)
    assert est.basis.timers == 8


def test_active_timers_below_floor_do_nothing() -> None:
    est = run(lines=[line("medium")], timers=[active_timer(10), active_timer(10, user="u2")])
    assert est.people_in_line == 18


def test_active_timers_alone() -> None:
    est = run(
        timers=[active_timer(5, user="a"), active_timer(8, user="b"), active_timer(9, user="c")]
    )
    assert est.people_in_line == 3
    assert est.method == "reports"
    assert est.wait_min == pytest.approx(1.5)
    assert est.confidence is Confidence.low
    assert est.basis.text == "Based on 3 timers in the last 30 min"


def test_active_timers_up_to_three_hours_count_for_floor() -> None:
    old = [active_timer(120, user=f"u{i}") for i in range(7)]
    est = run(lines=[line("short")], timers=old)
    assert est.people_in_line == 7
    assert est.basis.timers == 0
    assert est.basis.text == "Based on staff counts in the last 30 min"


def test_active_timers_over_three_hours_ignored() -> None:
    old = [active_timer(240, user=f"u{i}") for i in range(7)]
    est = run(lines=[line("short")], timers=old)
    assert est.people_in_line == 6


def test_unknown_line_size_ignored() -> None:
    est = run(reports=[report(size="bogus", crowd="easy")])
    assert est.people_in_line is None
    assert est.method == "none"


def test_unknown_staff_line_size_falls_back_to_reports() -> None:
    est = run(lines=[line("bogus")], reports=[report(size="short")])
    assert est.people_in_line == 6


def test_unknown_crowd_level_ignored() -> None:
    est = run(reports=[report(crowd="bogus")])
    assert est.crowd_level is None
    assert est.has_recent_data


# ---------- timers ----------


def test_outlier_trimmed() -> None:
    durations = [8, 9, 10, 10, 11, 12, 10, 9, 11, 120]
    timers = [done_timer(d, user=f"u{i}") for i, d in enumerate(durations)]
    est = run(timers=timers)
    assert est.wait_min == pytest.approx(10)


def test_no_trim_under_four_timers() -> None:
    est = run(timers=[done_timer(10), done_timer(10, user="b"), done_timer(120, user="c")])
    assert est.wait_min == pytest.approx(10)  # median already ignores one outlier
    est2 = run(timers=[done_timer(10), done_timer(120, user="b")])
    assert est2.wait_min == pytest.approx(65)


def test_trim_reduces_blend_count() -> None:
    durations = [10, 10, 10, 10, 10, 10, 10, 11, 9, 120]
    timers = [done_timer(d, user=f"u{i}") for i, d in enumerate(durations)]
    est = run(timers=timers)
    # MAD is zero, so only exact medians survive: 10 x 7
    assert est.wait_min == pytest.approx(10)


def test_negative_duration_timer_ignored() -> None:
    bad = done_timer(-5)
    est = run(timers=[bad])
    assert est.has_recent_data
    assert est.method == "none"
    assert est.wait_min is None


def test_timer_window_uses_end_time() -> None:
    long_ago_start = done_timer(60, ended_minutes_ago=5)  # started 65 min ago, ended recently
    stale = done_timer(10, ended_minutes_ago=35)
    est = run(timers=[long_ago_start, stale])
    assert est.basis.timers == 1
    assert est.wait_min == pytest.approx(60)


def test_recency_weighting_newer_dominates() -> None:
    est = run(
        timers=[done_timer(30, ended_minutes_ago=25), done_timer(10, ended_minutes_ago=1, user="b")]
    )
    assert est.wait_min == pytest.approx(10)
    many_old = [done_timer(30, ended_minutes_ago=25, user=f"o{i}") for i in range(2)]
    est2 = run(timers=[*many_old, done_timer(10, ended_minutes_ago=1, user="n")])
    assert est2.wait_min == pytest.approx(10)


def test_equal_recency_ties_average() -> None:
    est = run(timers=[done_timer(10), done_timer(20, user="b")])
    assert est.wait_min == pytest.approx(15)


def test_reliability_weighting() -> None:
    timers = [done_timer(20, user="good"), done_timer(5, user="bad")]
    est = run(timers=timers, reliability={"good": 1.0, "bad": 0.1})
    assert est.wait_min == pytest.approx(20)
    est2 = run(timers=timers)
    assert est2.wait_min == pytest.approx(12.5)


def test_zero_reliability_everyone_falls_back_to_plain_median() -> None:
    timers = [done_timer(10, user="a"), done_timer(30, user="b")]
    est = run(timers=timers, reliability={"a": 0.0, "b": 0.0})
    assert est.wait_min == pytest.approx(20)


# ---------- crowd level ----------


def test_crowd_from_door_counts() -> None:
    assert run(doors=[door("in", 59, 5)]).crowd_level is Crowd.easy
    assert run(doors=[door("in", 60, 5)]).crowd_level is Crowd.busy
    assert run(doors=[door("in", 90, 5)]).crowd_level is Crowd.packed


def test_headcount_never_negative() -> None:
    est = run(doors=[door("in", 5, 10), door("out", 20, 5)])
    assert est.headcount == 0
    assert est.capacity_ratio == 0.0
    assert est.crowd_level is Crowd.easy


def test_door_events_before_window_count_for_headcount() -> None:
    est = run(doors=[door("in", 80, 200), door("in", 5, 5)])
    assert est.headcount == 85


def test_report_vote_weighted_by_recency() -> None:
    reports = [report("a", 28, crowd="packed"), report("b", 1, crowd="easy")]
    assert run(reports=reports).crowd_level is Crowd.easy


def test_report_vote_tie_goes_to_busier() -> None:
    reports = [report("a", 3, crowd="easy"), report("b", 3, crowd="busy")]
    assert run(reports=reports).crowd_level is Crowd.busy
    reports2 = [report("a", 3, crowd="packed"), report("b", 3, crowd="busy")]
    assert run(reports=reports2).crowd_level is Crowd.packed


def test_far_reports_downweighted() -> None:
    far = [report("a", 3, crowd="packed", near=False), report("b", 3, crowd="packed", near=False)]
    near = [report("c", 3, crowd="easy", near=True)]
    # far: 2 * 0.6 * 0.3 = 0.36 vs near 0.6
    assert run(reports=[*far, *near]).crowd_level is Crowd.easy
    all_near = [report("a", 3, crowd="packed"), report("b", 3, crowd="packed"), *near]
    assert run(reports=all_near).crowd_level is Crowd.packed


def test_far_line_size_downweighted() -> None:
    reports = [
        report("a", 3, size="very_long", near=False),
        report("b", 3, size="very_long", near=False),
        report("c", 3, size="short", near=True),
    ]
    assert run(reports=reports).people_in_line == 6


def test_reliability_in_crowd_vote() -> None:
    reports = [report("a", 3, crowd="packed"), report("b", 3, crowd="easy")]
    est = run(reports=reports, reliability={"a": 0.1, "b": 0.9})
    assert est.crowd_level is Crowd.easy


def test_door_crowd_beats_reports() -> None:
    est = run(doors=[door("in", 10, 5)], reports=[report(crowd="busy")])
    assert est.crowd_level is Crowd.easy
    assert est.flags == ()


def test_zero_capacity_falls_back_to_reports() -> None:
    est = run(capacity=0, doors=[door("in", 10, 5)], reports=[report(crowd="busy")])
    assert est.crowd_level is Crowd.busy
    assert est.capacity_ratio is None
    assert est.headcount == 10
    assert est.capacity_mode is False


# ---------- mismatch and confidence ----------


def test_mismatch_lowers_confidence_one_step() -> None:
    base = dict(lines=[line("medium")], doors=[door("in", 10, 5)])
    ok = run(**base, reports=[report(crowd="easy")])  # type: ignore[arg-type]
    assert ok.confidence is Confidence.high
    assert ok.flags == ()
    bad = run(**base, reports=[report(crowd="packed"), report("b", crowd="packed")])  # type: ignore[arg-type]
    assert bad.flags == ("staff_report_mismatch",)
    assert bad.confidence is Confidence.medium
    assert bad.crowd_level is Crowd.easy


def test_one_step_difference_is_not_a_mismatch() -> None:
    est = run(doors=[door("in", 10, 5)], reports=[report(crowd="busy")])
    assert est.flags == ()


def test_mismatch_medium_to_low_and_low_stays_low() -> None:
    est = run(doors=[door("in", 10, 5)], reports=[report(crowd="packed", near=False)])
    assert est.flags == ("staff_report_mismatch",)
    assert est.confidence is Confidence.low  # score 2 is medium, lowered to low
    est2 = run(doors=[door("in", 10, 20)], reports=[report(crowd="packed", near=False)])
    assert est2.flags == ("staff_report_mismatch",)
    assert est2.confidence is Confidence.low


def test_mismatch_widens_range() -> None:
    est = run(
        lines=[line("medium")],
        doors=[door("in", 10, 5)],
        reports=[report(crowd="packed")] * 1,
    )
    assert est.confidence is Confidence.medium
    assert est.wait_low_min == pytest.approx(est.wait_min * 0.75)  # type: ignore[operator]
    est2 = run(doors=[door("in", 10, 5)], reports=[report(crowd="packed", size="short")])
    assert est2.confidence is Confidence.low
    assert est2.wait_low_min == pytest.approx(est2.wait_min * 0.6)  # type: ignore[operator]


def test_confidence_score_levels() -> None:
    # 0 to 1.5 low
    assert run(reports=[report(crowd="busy", near=False)]).confidence is Confidence.low
    # near-bar reports max out at 2 points (medium)
    many = [report(f"u{i}", crowd="busy") for i in range(8)]
    assert run(reports=many).confidence is Confidence.medium
    # 2 to 3.5 medium
    assert run(lines=[line("short")]).confidence is Confidence.medium
    # timers cap at 3 points
    timers = [done_timer(10, user=f"u{i}") for i in range(6)]
    assert run(timers=timers).confidence is Confidence.medium
    # 4 or more high
    assert run(
        timers=timers, reports=[report(crowd="busy"), report("b", crowd="busy")]
    ).confidence is (Confidence.high)


# ---------- windows and basis ----------


def test_window_filtering_of_reports_and_lines() -> None:
    est = run(
        reports=[report("a", 29, crowd="busy"), report("b", 31, crowd="packed", size="very_long")],
        lines=[line("very_long", 31), line("short", 29)],
    )
    assert est.basis.reports == 1
    assert est.basis.staff_line_updates == 1
    assert est.people_in_line == 6
    assert est.crowd_level is Crowd.busy


def test_custom_window_in_text() -> None:
    p = Params(window_min=45)
    est = run(reports=[report(minutes_ago=40, crowd="busy")], params=p)
    assert est.basis.window_min == 45
    assert est.basis.text == "Based on 1 report in the last 45 min"


def test_basis_text_full_example() -> None:
    reports = [report(f"u{i}", crowd="busy") for i in range(6)]
    timers = [done_timer(10, user="a"), done_timer(12, user="b")]
    est = run(reports=reports, timers=timers, lines=[line("short")])
    assert est.basis.text == "Based on 6 reports, 2 timers and staff counts in the last 30 min"


def test_basis_text_pluralization_and_joining() -> None:
    est = run(reports=[report(crowd="busy")], timers=[done_timer(10)])
    assert est.basis.text == "Based on 1 report and 1 timer in the last 30 min"
    est2 = run(reports=[report(crowd="busy")], doors=[door("in", 5, 3)])
    assert est2.basis.text == "Based on 1 report and staff counts in the last 30 min"


def test_line_not_moving_flag_lowers_confidence() -> None:
    from datetime import timedelta

    from app.estimation import Confidence, DoorEventIn, EstimateInput, LineStatusIn, estimate
    from tests.estimation.helpers import NOW

    old = NOW - timedelta(minutes=40)
    inp = EstimateInput(
        now=NOW,
        capacity=100,
        door_events=[DoorEventIn(ts=old, direction="in", count=10)],
        line_statuses=[LineStatusIn(ts=NOW - timedelta(minutes=5), line_size="long")],
    )
    est = estimate(inp)
    assert "line_not_moving" in est.flags
    assert est.confidence == Confidence.low
