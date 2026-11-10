"""Write docs/openapi.json, the API contract for web and iOS. --check fails if it is stale."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.main import create_app

OUT = Path(__file__).resolve().parents[2] / "docs" / "openapi.json"


def render() -> str:
    return json.dumps(create_app().openapi(), indent=2, sort_keys=True) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="exit 1 if docs/openapi.json is stale")
    args = ap.parse_args()
    text = render()
    if args.check:
        if not OUT.exists() or OUT.read_text() != text:
            print("docs/openapi.json is stale. Run: uv run python scripts/export_openapi.py")
            return 1
        print("docs/openapi.json is current")
        return 0
    OUT.write_text(text)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
