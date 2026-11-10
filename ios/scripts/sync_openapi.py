"""Copy docs/openapi.json into the iOS target, normalized for swift-openapi-generator.

FastAPI emits OpenAPI 3.1 with `anyOf: [T, {"type": "null"}]` for optional values. To keep the
generated Swift simple and predictable we rewrite those to `T` and drop the property from
`required`, so it becomes a Swift Optional. `format: uuid` and `format: date-time` are dropped
so ids and timestamps arrive as Strings (the app parses dates itself, with or without fractional
seconds). `additionalProperties: false` and string `enum` lists are dropped so new response fields or
values never break shipped apps. Numeric bounds are dropped (the server validates them).
Nothing else changes. CI runs this with --check.

Usage: python3 ios/scripts/sync_openapi.py [--check]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs" / "openapi.json"
DST = ROOT / "ios" / "Crowded" / "API" / "openapi.json"
DROP_FORMATS = {"uuid", "date-time"}


def _nullable_branch(schema: dict[str, Any]) -> dict[str, Any] | None:
    options = schema.get("anyOf")
    if not isinstance(options, list) or len(options) != 2:
        return None
    rest = [o for o in options if o != {"type": "null"}]
    if len(rest) != 1:
        return None
    merged = dict(rest[0])
    for key in ("title", "description"):
        if key in schema and key not in merged and "$ref" not in merged:
            merged[key] = schema[key]
    return merged


def normalize(node: Any) -> Any:
    if isinstance(node, list):
        return [normalize(n) for n in node]
    if not isinstance(node, dict):
        return node
    node = dict(node)
    branch = _nullable_branch(node)
    if branch is not None:
        node = branch
    if node.get("format") in DROP_FORMATS:
        node.pop("format")
    # The server rejects unknown fields it RECEIVES. The app must tolerate new fields it is
    # SENT, or adding a response field would break every shipped app version.
    if node.get("additionalProperties") is False:
        node.pop("additionalProperties")
    # Same for string enums: an unknown value from a newer server must not fail decoding. The
    # app maps strings to its own enums with an unknown fallback (Core/API/Models.swift).
    if node.get("type") == "string" and "enum" in node:
        node.pop("enum")
    # Pydantic writes integer bounds as floats (maximum: 20.0), which some OpenAPI parsers
    # reject for integer schemas. The server validates bounds, so the client copy drops them.
    for bound in ("minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"):
        if isinstance(node.get(bound), (int, float)) and not isinstance(node.get(bound), bool):
            node.pop(bound)
    props = node.get("properties")
    if isinstance(props, dict):
        required = list(node.get("required", []))
        new_props = {}
        for name, prop in props.items():
            if isinstance(prop, dict) and _nullable_branch(prop) is not None:
                if name in required:
                    required.remove(name)
                prop = {k: v for k, v in prop.items() if k != "default"}
            new_props[name] = normalize(prop)
        node["properties"] = new_props
        if "required" in node:
            node["required"] = required
    for key, value in list(node.items()):
        if key != "properties":
            node[key] = normalize(value)
    return node


def render() -> str:
    spec = json.loads(SRC.read_text())
    return json.dumps(normalize(spec), indent=2, sort_keys=True) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    text = render()
    if args.check:
        if not DST.exists() or DST.read_text() != text:
            print("ios/Crowded/API/openapi.json is stale. Run ios/scripts/sync_openapi.sh")
            return 1
        print("iOS OpenAPI copy is current")
        return 0
    DST.write_text(text)
    print(f"wrote {DST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
