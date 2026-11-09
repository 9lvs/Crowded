"""STUB. Owned by backend-implementer (estimation brief). Signatures are the contract."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from app.estimation.types import (
    CalibrationPoint,
    Crowd,
    Estimate,
    EstimateInput,
    Params,
    Verdict,
)


def crowd_from_ratio(ratio: float, params: Params | None = None) -> Crowd:
    raise NotImplementedError


def estimate(inp: EstimateInput) -> Estimate:
    raise NotImplementedError


def verdict(est: Estimate, threshold_min: int, pass_price_cents: int | None) -> Verdict:
    raise NotImplementedError


def calibration_factor(
    points: Sequence[CalibrationPoint], now: datetime, params: Params | None = None
) -> float:
    raise NotImplementedError


def update_reliability(current: float, predicted: float, observed: float) -> float:
    """Nudge a user's reliability toward how close their input was to the consensus."""
    raise NotImplementedError
