"""Inside reports, drink wait and count-in-only bars. Pure, no database."""

from __future__ import annotations

from app.estimation import Crowd, Params
from tests.estimation.helpers import door, inside, line, report, run


def test_inside_status_alone_is_recent_data_and_counts_as_staff() -> None:
    e = run(insides=[inside(crowd="busy", drink="5_to_10")])
    assert e.has_recent_data
    assert e.crowd_level == Crowd.busy
    assert e.basis.inside_updates == 1
    assert "staff counts" in e.basis.text
    assert e.drink_wait == "5_to_10"
    assert (e.drink_wait_basis.staff_updates, e.drink_wait_basis.reports) == (1, 0)


def test_stale_inside_status_is_no_data() -> None:
    e = run(insides=[inside(crowd="packed", drink="over_20", minutes_ago=45)])
    assert not e.has_recent_data
    assert e.drink_wait is None
    assert e.crowd_level is None
    assert e.basis.text == "No recent data"


def test_future_inside_status_is_ignored() -> None:
    e = run(insides=[inside(crowd="packed", minutes_ago=-5)])
    assert not e.has_recent_data


def test_door_headcount_still_sets_crowd_when_exits_counted() -> None:
    e = run(doors=[door("in", 20, 5)], insides=[inside(crowd="packed")])
    assert e.headcount == 20
    assert e.crowd_level == Crowd.easy
    assert e.flags == ()  # the door count wins, the mismatch flag compares it with students


def test_count_in_only_has_no_headcount_but_keeps_rate() -> None:
    doors = [door("in", 10, 5), door("in", 10, 3), door("out", 5, 2)]
    e = run(
        doors=doors,
        lines=[line("medium")],
        insides=[inside(crowd="packed")],
        counts_exits=False,
    )
    assert e.headcount is None
    assert e.capacity_ratio is None
    assert not e.capacity_mode
    assert e.entry_rate_per_min is not None
    assert abs(e.entry_rate_per_min - 20 / 15) < 1e-9
    assert e.crowd_level == Crowd.packed


def test_count_in_only_never_enters_capacity_mode() -> None:
    # 200 ins against a capacity of 100 would be capacity mode with exits counted.
    doors = [door("in", 20, 14 - i) for i in range(10)]
    on = run(doors=doors, lines=[line("medium")])
    off = run(doors=doors, lines=[line("medium")], counts_exits=False)
    assert on.capacity_mode
    assert not off.capacity_mode
    assert off.entry_rate_per_min == 200 / 15


def test_count_in_only_crowd_from_reports_when_no_inside_status() -> None:
    e = run(doors=[door("in", 5, 3)], reports=[report(crowd="busy")], counts_exits=False)
    assert e.headcount is None
    assert e.crowd_level == Crowd.busy


def test_count_in_only_without_any_crowd_vote_has_no_crowd_level() -> None:
    e = run(doors=[door("in", 5, 3)], counts_exits=False)
    assert e.crowd_level is None
    assert e.headcount is None


def test_inside_votes_weighted_against_reports() -> None:
    # One staff vote weighs about three reports. Two reports cannot outvote it.
    e = run(
        insides=[inside(crowd="easy", reporter="s1")],
        reports=[report("a", crowd="busy"), report("b", crowd="busy")],
        reliability={"s1": 1.0, "a": 0.6, "b": 0.6},
    )
    assert e.crowd_level == Crowd.easy
    many = run(
        insides=[inside(crowd="easy", reporter="s1")],
        reports=[report(f"u{i}", crowd="busy") for i in range(6)],
        reliability={"s1": 1.0},
    )
    assert many.crowd_level == Crowd.busy


def test_inside_vs_report_mismatch_flag() -> None:
    e = run(insides=[inside(crowd="easy")], reports=[report(crowd="packed")], counts_exits=False)
    assert "staff_report_mismatch" in e.flags
    close = run(insides=[inside(crowd="easy")], reports=[report(crowd="busy")], counts_exits=False)
    assert "staff_report_mismatch" not in close.flags


def test_inside_ignores_unknown_crowd_value() -> None:
    e = run(insides=[inside(crowd="weird"), inside(crowd="busy")])
    assert e.crowd_level == Crowd.busy


def test_drink_wait_weighted_median_of_staff_and_students() -> None:
    e = run(
        insides=[inside(drink="10_to_20", reporter="s1")],
        reports=[report("a", drink="under_5"), report("b", drink="under_5")],
        reliability={"s1": 1.0, "a": 0.6, "b": 0.6},
    )
    # Staff weight 3 beats two students at 0.6 each, so the median is the staff reading.
    assert e.drink_wait == "10_to_20"
    assert (e.drink_wait_basis.staff_updates, e.drink_wait_basis.reports) == (1, 2)


def test_drink_wait_students_only() -> None:
    e = run(reports=[report("a", drink="over_20"), report("b", drink="over_20")])
    assert e.drink_wait == "over_20"
    assert e.has_recent_data
    assert (e.drink_wait_basis.staff_updates, e.drink_wait_basis.reports) == (0, 2)
    assert e.wait_min is None  # no line data, only a drink wait


def test_drink_wait_maps_back_to_nearest_bucket_and_ties_go_long() -> None:
    p = Params(half_life_min=1e9)  # no recency effect so weights are exact
    # Equal weight 3 min and 8 min readings average to 5.5, a tie, so the longer bucket wins.
    e = run(
        reports=[report("a", drink="under_5"), report("b", drink="5_to_10")],
        reliability={"a": 1.0, "b": 1.0},
        params=p,
    )
    assert e.drink_wait == "5_to_10"
    # 3 and 25 average to 14, nearest is 15 (10 to 20).
    e2 = run(
        reports=[report("a", drink="under_5"), report("b", drink="over_20")],
        reliability={"a": 1.0, "b": 1.0},
        params=p,
    )
    assert e2.drink_wait == "10_to_20"


def test_drink_wait_ignores_unknown_and_stale_values() -> None:
    e = run(
        reports=[
            report("a", crowd="busy", drink="warp"),
            report("b", drink="5_to_10", minutes_ago=40),
        ],
        insides=[inside(crowd="busy", drink="warp")],
    )
    assert e.drink_wait is None
    assert e.drink_wait_basis.reports == 0


def test_recency_favors_the_fresh_drink_reading() -> None:
    e = run(
        insides=[
            inside(drink="over_20", minutes_ago=25),
            inside(drink="under_5", minutes_ago=1),
        ]
    )
    assert e.drink_wait == "under_5"
