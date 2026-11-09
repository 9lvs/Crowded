"""Bundle the web client into one self-contained HTML file running in mock mode.

Used to publish a shareable preview (for example a claude.ai Artifact) with no backend.
Usage: python3 web/tools/bundle_preview.py OUT.html [--page index|staff]
"""

from __future__ import annotations

import argparse
import base64
import re
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]


def inline_fonts(css: str) -> str:
    def repl(m: re.Match[str]) -> str:
        data = base64.b64encode((WEB / "fonts" / m.group(1)).read_bytes()).decode()
        return f'url("data:font/woff2;base64,{data}")'

    return re.sub(r'url\("([^"/]+\.woff2)"\)', repl, css)


def build(page: str) -> str:
    html = (WEB / f"{page}.html").read_text()
    head_scripts = re.findall(r'<head>.*?</head>', html, re.S)[0]
    css_links = re.findall(r'<link rel="stylesheet" href="([^"]+)"', html)
    scripts = re.findall(r'<script src="([^"]+)"></script>', html)
    title = re.search(r"<title>(.*?)</title>", html, re.S)
    body = re.search(r"<body[^>]*>(.*?)</body>", html, re.S)
    assert title and body and head_scripts
    css = "\n".join(
        inline_fonts((WEB / href).read_text()) if "fonts" in href else (WEB / href).read_text()
        for href in css_links
    )
    body_html = re.sub(r'\s*<script src="[^"]+"></script>', "", body.group(1)).strip()
    js = "\n".join((WEB / src).read_text().replace("</script", "<\\/script") for src in scripts)
    return (
        f"<title>{title.group(1)}</title>\n"
        '<meta name="color-scheme" content="light dark">\n'
        f"<style>\n{css}\n</style>\n"
        f"{body_html}\n"
        "<script>window.CROWDED_MOCK = true;</script>\n"
        f"<script>\n{js}\n</script>\n"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("out")
    ap.add_argument("--page", choices=["index", "staff"], default="index")
    args = ap.parse_args()
    Path(args.out).write_text(build(args.page))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
