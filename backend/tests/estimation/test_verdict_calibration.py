from __future__ import annotations

from datetime import timedelta

import pytest

from app.estimation import (
    CalibrationPoint,
    Crowd,
    Params,
    Recommendation,
    calibration_factor,
    crowd_from_ratio,
    update_reliability,
    verdict,
)
from app.estimation.stats import mad, median, weighted_median
from tests.estimation.helpers import NOW, door, line, report, run


def est_with_wait(wait: float):  # type: ignore[no-untyped-def]
    # people / rate: pick a line and rate that give exactly `wait` minutes.
    e = run(lines=[line("medium")], doors=[door("in", 36, 5)])
    from dataclasses import replace

    return replace(e, wait_min=wait)


# ---------- verdict ----------


def test_verdict_no_data() -> None:
    v = verdict(run(), 20, 1500)
    assert v.recommendation is Recommendation.no_data
    assert v.text == "No recent data. No call yet."
    assert v.minutes_saved is None
    assert v.threshold_min == 20
    assert v.pass_price_cents == 1500


def test_verdict_recent_data_without_wait() -> None:
    v = verdict(run(reports=[report(crowd="busy")]), 20, 1500)
    assert v.recommendation is Recommendation.no_data
    assert v.text == "Not enough line data. No call yet."
    assert v.minutes_saved is None


def test_verdict_buy_pass() -> None:
    v = verdict(est_with_wait(35.4), 20, 1500)
    assert v.recommendation is Recommendation.buy_pass
    assert v.text == "Get the pass. Line is about 35 min, over your 20 min limit. Pass is $15."
    assert v.minutes_saved == pytest.approx(35.4)


def test_verdict_no_pass_available() -> None:
    v = verdict(est_with_wait(35.4), 20, None)
    assert v.recommendation is Recommendation.no_pass_available
    assert v.text == "Long line. About 35 min, over your 20 min limit. No pass sold here."
    assert v.minutes_saved is None
    assert v.pass_price_cents is None


def test_verdict_wait_it_out() -> None:
    v = verdict(est_with_wait(12.0), 20, 1500)
    assert v.recommendation is Recommendation.wait_it_out
    assert v.text == "Wait it out. About 12 min, under your 20 min limit."
    assert v.minutes_saved is None


def test_verdict_boundaries_use_rounded_wait() -> None:
    assert verdict(est_with_wait(20.0), 20, 1500).recommendation is Recommendation.wait_it_out
    assert verdict(est_with_wait(20.4), 20, 1500).recommendation is Recommendation.wait_it_out
    assert verdict(est_with_wait(20.6), 20, 1500).recommendation is Recommendation.buy_pass
    assert "About 1 min" in verdict(est_with_wait(0.5), 20, None).text
    assert "About 0 min" in verdict(est_with_wait(0.0), 20, None).text


def test_verdict_custom_threshold() -> None:
    v = verdict(est_with_wait(12.0), 10, 800)
    assert v.recommendation is Recommendation.buy_pass
    assert "over your 10 min limit" in v.text


@pytest.mark.parametrize(
    ("cents", "text"),
    [(1500, "$15"), (1250, "$12.50"), (1205, "$12.05"), (500, "$5"), (99, "$0.99"), (0, "$0")],
)
def test_price_formatting(cents: int, text: str) -> None:
    v = verdict(est_with_wait(40), 20, cents)
    assert v.text.endswith(f"Pass is {text}.")


# ---------- crowd_from_ratio ----------


def test_crowd_from_ratio_boundaries() -> None:
    assert crowd_from_ratio(0.0) is Crowd.easy
    assert crowd_from_ratio(0.5999) is Crowd.easy
    assert crowd_from_ratio(0.60) is Crowd.busy
    assert crowd_from_ratio(0.8999) is Crowd.busy
    assert crowd_from_ratio(0.90) is Crowd.packed
    assert crowd_from_ratio(1.5) is Crowd.packed


def test_crowd_from_ratio_custom_params() -> None:
    p = Params(easy_below=0.3, packed_at=0.5)
    assert crowd_from_ratio(0.4, p) is Crowd.busy
    assert crowd_from_ratio(0.5, p) is Crowd.packed
    assert crowd_from_ratio(0.2, p) is Crowd.easy


# ---------- calibration ----------


def point(minutes_ago: float, predicted: float, actual: float) -> CalibrationPoint:
    return CalibrationPoint(
        ts=NOW - timedelta(minutes=minutes_ago), predicted_min=predicted, actual_min=actual
    )


def test_calibration_empty_is_one() -> None:
    assert calibration_factor([], NOW) == 1.0


def test_calibration_median_ratio() -> None:
    pts = [point(5, 10, 15), point(5, 10, 15), point(5, 10, 10)]
    assert calibration_factor(pts, NOW) == pytest.approx(1.5)


def test_calibration_clamped() -> None:
    assert calibration_factor([point(1, 10, 100)], NOW) == 2.0
    assert calibration_factor([point(1, 10, 1)], NOW) == 0.5
    p = Params(calibration_min=0.8, calibration_max=1.2)
    assert calibration_factor([point(1, 10, 100)], NOW, p) == 1.2
    assert calibration_factor([point(1, 10, 1)], NOW, p) == 0.8


def test_calibration_ignores_small_predictions() -> None:
    pts = [point(1, 1.5, 15), point(1, 1.99, 50)]
    assert calibration_factor(pts, NOW) == 1.0
    pts2 = [*pts, point(1, 2.0, 3.0)]
    assert calibration_factor(pts2, NOW) == pytest.approx(1.5)


def test_calibration_recency() -> None:
    pts = [point(60, 10, 5), point(1, 10, 15)]
    assert calibration_factor(pts, NOW) == pytest.approx(1.5)


def test_calibration_ignores_old_and_future_points() -> None:
    eight_days = 8 * 24 * 60
    pts = [point(eight_days, 10, 20), point(-5, 10, 20)]
    assert calibration_factor(pts, NOW) == 1.0


def test_calibration_keeps_points_inside_window() -> None:
    assert calibration_factor([point(6 * 24 * 60, 10, 15)], NOW) == pytest.approx(1.5)


# ---------- update_reliability ----------


def test_reliability_perfect_moves_up() -> None:
    assert update_reliability(0.5, 10, 10) == pytest.approx(0.6)


def test_reliability_terrible_moves_down() -> None:
    assert update_reliability(0.5, 10, 100) == pytest.approx(0.4)


def test_reliability_half_error() -> None:
    # e = 0.5, target 0.5, current 0.5 stays
    assert update_reliability(0.5, 10, 15) == pytest.approx(0.5)


def test_reliability_clamps() -> None:
    assert update_reliability(0.05, 10, 1000) == 0.05
    assert update_reliability(1.0, 10, 10) == 1.0
    assert update_reliability(0.0, 10, 1000) == 0.05
    assert update_reliability(1.0, 10, 1000) == pytest.approx(0.8)


def test_reliability_small_prediction_uses_floor_of_five() -> None:
    # e = 2 / 5 = 0.4, target 0.6
    assert update_reliability(0.5, 1, 3) == pytest.approx(0.52)


# ---------- stats ----------


def test_median_and_mad() -> None:
    assert median([3, 1, 2]) == 2
    assert median([4, 1, 2, 3]) == 2.5
    assert mad([1, 1, 2, 2, 4, 6, 9]) == 1


def test_weighted_median_cases() -> None:
    assert weighted_median([]) is None
    assert weighted_median([(5.0, 1.0)]) == 5.0
    assert weighted_median([(1.0, 1.0), (3.0, 1.0)]) == 2.0
    assert weighted_median([(1.0, 1.0), (3.0, 3.0)]) == 3.0
    assert weighted_median([(1.0, 0.0), (3.0, 0.0), (5.0, 0.0)]) == 3.0
    assert weighted_median([(1.0, 0.0), (9.0, 2.0)]) == 9.0
