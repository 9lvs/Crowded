"""Distance to bar. Coordinates are used in memory and never stored or logged."""

from __future__ import annotations

import math

from app.models import DistanceBucket

NEAR_BAR_METERS = 300.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def bucket_for(distance_m: float | None) -> tuple[bool, DistanceBucket]:
    if distance_m is None:
        return False, DistanceBucket.unknown
    if distance_m < 75:
        return True, DistanceBucket.at_door
    if distance_m <= NEAR_BAR_METERS:
        return True, DistanceBucket.nearby
    return False, DistanceBucket.far
