"""Staff vs student fusion (docs/SOURCING.md)."""

from __future__ import annotations

from app.estimation import EstimateInput, LineStatusIn, estimate
from tests.estimation.helpers import CAPACITY, NOW, ago, report


def _run(lines, reports, reliability=None) -> object:
    return estimate(
        EstimateInput(
            now=NOW,
            capacity=CAPACITY,
            line_statuses=lines,
            reports=reports,
            reliability=reliability or {},
        )
    )


def staff(size: str, who: str = "staff1", minutes_ago: float = 2) -> LineStatusIn:
    return LineStatusIn(ts=ago(minutes_ago), line_size=size, reporter_id=who)


def test_one_student_does_not_override_staff() -> None:
    est = _run([staff("long")], [report(user="s1", size="medium")])
    assert est.people_in_line == 38  # staff "long"
    assert "sources_disagree" in est.flags  # 38 vs 18 is a real gap, so we say so
    assert est.basis.text.endswith("Staff and reports differ")


def test_many_reliable_students_outvote_staff() -> None:
    students = [report(user=f"s{i}", size="medium") for i in range(8)]
    rel = {f"s{i}": 0.9 for i in range(8)}
    est = _run([staff("long")], students, rel)
    assert est.people_in_line == 18


def test_unreliable_staff_loses_weight() -> None:
    students = [report(user=f"s{i}", size="medium") for i in range(3)]
    trusted = _run([staff("long")], students, {"staff1": 1.0})
    distrusted = _run([staff("long")], students, {"staff1": 0.1})
    assert trusted.people_in_line == 38
    assert distrusted.people_in_line == 18


def test_close_readings_do_not_flag() -> None:
    est = _run([staff("medium")], [report(user="s1", size="medium")])
    assert "sources_disagree" not in est.flags


def test_disagreement_lowers_confidence() -> None:
    agree = _run([staff("long")], [report(user="s1", size="long")])
    differ = _run([staff("long")], [report(user="s1", size="short")])
    order = ["none", "low", "medium", "high"]
    assert order.index(differ.confidence.value) < order.index(agree.confidence.value)


def test_staff_without_reporter_id_uses_default_reliability() -> None:
    est = _run([LineStatusIn(ts=ago(1), line_size="short")], [])
    assert est.people_in_line == 6
