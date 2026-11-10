"""Small pure statistics helpers for the estimation engine."""

from __future__ import annotations

from collections.abc import Sequence


def median(values: Sequence[float]) -> float:
    """Plain median. `values` must not be empty."""
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    if n % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def mad(values: Sequence[float]) -> float:
    """Median absolute deviation from the median."""
    center = median(values)
    return median([abs(v - center) for v in values])


def weighted_median(pairs: Sequence[tuple[float, float]]) -> float | None:
    """Weighted median of (value, weight) pairs.

    When the cumulative weight lands exactly on half, the two middle values are averaged.
    Non positive weights are ignored. If every weight is non positive, the plain median is
    used. Returns None for no pairs.
    """
    if not pairs:
        return None
    usable = sorted((v, w) for v, w in pairs if w > 0)
    if not usable:
        return median([v for v, _ in pairs])
    total = sum(w for _, w in usable)
    half = total / 2
    cum = 0.0
    for i, (value, weight) in enumerate(usable):
        cum += weight
        if abs(cum - half) <= 1e-9 * total and i + 1 < len(usable):
            return (value + usable[i + 1][0]) / 2
        if cum > half:
            return value
    return usable[-1][0]  # pragma: no cover (float safety net)
