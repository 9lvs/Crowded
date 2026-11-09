"""Post-deploy smoke test ("exit test"). Read-only checks against a running server.

Usage: uv run python scripts/smoke_test.py https://staging.example.com
Exits non-zero on the first failed check. Safe to run against production.
"""

from __future__ import annotations

import argparse
import sys

import httpx

REQUIRED_HEADERS = {
    "content-security-policy": "default-src 'self'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
}


def run(base: str, expect_hsts: bool) -> list[str]:
    failures: list[str] = []
    with httpx.Client(base_url=base, timeout=10, follow_redirects=False) as c:
        r = c.get("/healthz")
        if r.status_code != 200 or r.json().get("status") != "ok":
            failures.append(f"/healthz returned {r.status_code}")
        for name, needle in REQUIRED_HEADERS.items():
            if needle not in r.headers.get(name, ""):
                failures.append(f"missing or wrong header {name}")
        if expect_hsts and "max-age" not in r.headers.get("strict-transport-security", ""):
            failures.append("missing HSTS")
        if c.get("/v1/me").status_code != 401:
            failures.append("/v1/me is not protected")
        if c.get("/v1/bars").status_code != 401:
            failures.append("/v1/bars is not protected")
        home = c.get("/")
        if home.status_code != 200 or "Crowded" not in home.text:
            failures.append("web client not served at /")
        if c.get("/staff.html").status_code != 200:
            failures.append("staff counter not served")
        bad = c.post("/v1/auth/request-code", json={"phone": "nope"})
        if bad.status_code != 422 or "nope" in bad.text:
            failures.append("validation error leaks input or is not 422")
        if c.get("/../backend/app/config.py").status_code == 200:
            failures.append("path traversal")
    return failures


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("base_url")
    ap.add_argument("--expect-hsts", action="store_true")
    args = ap.parse_args()
    failures = run(args.base_url.rstrip("/"), args.expect_hsts)
    for f in failures:
        print(f"FAIL {f}")
    if not failures:
        print("smoke test passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
