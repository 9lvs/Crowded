#!/usr/bin/env python3
"""Builds the final brand SVGs, then the PNGs and the brand sheet.

Run from anywhere:  python3 marketing/brand/final/build.py
Needs Python 3 with Pillow, and Node with Playwright. Use --svg-only to skip the PNGs.
Ink is #0B0B0C, paper is #FFFFFF. Black and white only (D-033).

Meter C geometry
- 3 segments, C opening faces right, centered on 0 degrees, half angle 45.
- Segment ends are cut on radial lines from the ring center.
- The two gaps share one angle, sized so the gap at mid radius equals the gap unit.
- Overshoot: the ring is 3 percent taller than the 640 unit flat letter height.
- Optical centering: bounding box centered, then nudged right by 3 percent of R,
  because a C reads left heavy when it is centered by box alone.
"""
import math
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
INK = "#0B0B0C"
PAPER = "#FFFFFF"

# Master: R outer, r inner, gap at mid radius (all in 1024 units).
MASTER = dict(R=330.0, r=188.0, gap=36.0)
# Small (16 to 32 px): bigger, thicker ring, much wider gaps.
SMALL = dict(R=370.0, r=180.0, gap=92.0)
OPEN_HALF = 45.0  # half angle of the C opening
NUDGE = 0.03  # optical nudge to the right, share of R


def pt(cx, cy, rho, deg):
    a = math.radians(deg)
    return cx + rho * math.cos(a), cy + rho * math.sin(a)


def f(v):
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


def segments(p):
    """Return list of (a1, a2) angles in degrees, clockwise on screen (y down)."""
    mid = (p["R"] + p["r"]) / 2
    g = math.degrees(p["gap"] / mid)
    s = (270 - 2 * g) / 3
    out = []
    a = OPEN_HALF
    for _ in range(3):
        out.append((a, a + s))
        a += s + g
    return out


def mark_paths(p, cx, cy):
    ds = []
    R, r = p["R"], p["r"]
    for a1, a2 in segments(p):
        o1, o2 = pt(cx, cy, R, a1), pt(cx, cy, R, a2)
        i1, i2 = pt(cx, cy, r, a1), pt(cx, cy, r, a2)
        ds.append(
            f"M{f(o1[0])} {f(o1[1])}A{f(R)} {f(R)} 0 0 1 {f(o2[0])} {f(o2[1])}"
            f"L{f(i2[0])} {f(i2[1])}A{f(r)} {f(r)} 0 0 0 {f(i1[0])} {f(i1[1])}Z"
        )
    return ds


def optical_cx(p):
    """Ring center x so the mark looks centered in a 1024 box."""
    R = p["R"]
    xmax = R * math.cos(math.radians(OPEN_HALF))
    box_center_off = (xmax - R) / 2  # bbox center relative to ring center
    return 512 - box_center_off + NUDGE * R


def mark_group(p, fill, cx=None, cy=512.0):
    cx = optical_cx(p) if cx is None else cx
    paths = "".join(f'<path d="{d}"/>' for d in mark_paths(p, cx, cy))
    return f'<g fill="{fill}">{paths}</g>'


def svg(vb, body, title):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" '
        f'aria-label="{title}"><title>{title}</title>{body}</svg>\n'
    )


# ---------- wordmark (Packed, outlined) ----------
def read_wordmark():
    src = (HERE.parent / "concepts/packed/wordmark.svg").read_text()
    return re.search(r' d="([^"]+)"', src).group(1)


def path_bbox(d):
    toks = re.findall(r"[MQHVLZ]|-?\d*\.?\d+", d)
    xs, ys = [], []
    i = 0
    cx = cy = 0.0
    cmd = None

    def nums(n):
        nonlocal i
        v = [float(t) for t in toks[i : i + n]]
        i += n
        return v

    while i < len(toks):
        t = toks[i]
        if t in "MQHVLZ":
            cmd = t
            i += 1
            if t == "Z":
                continue
        if cmd in ("M", "L"):
            cx, cy = nums(2)
            xs.append(cx)
            ys.append(cy)
            if cmd == "M":
                cmd = "L"
        elif cmd == "H":
            cx = nums(1)[0]
            xs.append(cx)
        elif cmd == "V":
            cy = nums(1)[0]
            ys.append(cy)
        elif cmd == "Q":
            x1, y1, x2, y2 = nums(4)
            for k in range(1, 21):
                u = k / 20
                xs.append((1 - u) ** 2 * cx + 2 * u * (1 - u) * x1 + u * u * x2)
                ys.append((1 - u) ** 2 * cy + 2 * u * (1 - u) * y1 + u * u * y2)
            cx, cy = x2, y2
    return min(xs), min(ys), max(xs), max(ys)


WM_D = read_wordmark()
WX0, WY0, WX1, WY1 = path_bbox(WM_D)
WW, WH = WX1 - WX0, WY1 - WY0


def wordmark_svg(fill, title):
    vb = f"0 0 {f(WW)} {f(WH)}"
    body = f'<path fill="{fill}" transform="translate({f(-WX0)} {f(-WY0)})" d="{WM_D}"/>'
    return svg(vb, body, title)


# ---------- lockups ----------
def mark_box(p):
    """Mark bbox relative to ring center: (xmin, ymin, xmax, ymax)."""
    R = p["R"]
    return -R, -R, R * math.cos(math.radians(OPEN_HALF)), R


def word_path(fill, x, y, s):
    return (
        f'<path fill="{fill}" transform="translate({f(x)} {f(y)}) scale({s:.4f}) '
        f'translate({f(-WX0)} {f(-WY0)})" d="{WM_D}"/>'
    )


def lockup_horizontal(fill):
    p = MASTER
    x = p["R"] - p["r"]  # one segment width (ring thickness)
    mx0, my0, mx1, my1 = mark_box(p)
    mh = my1 - my0
    s = (0.46 * mh) / WH
    gap = 1.0 * x
    total_w = (mx1 - mx0) + gap + WW * s
    mark = mark_group(p, fill, cx=-mx0, cy=mh / 2)
    word = word_path(fill, (mx1 - mx0) + gap, (mh - WH * s) / 2, s)
    return svg(f"0 0 {f(total_w)} {f(mh)}", mark + word, "Crowded lockup, horizontal")


def lockup_stacked(fill):
    p = MASTER
    x = p["R"] - p["r"]
    mx0, my0, mx1, my1 = mark_box(p)
    mw, mh = mx1 - mx0, my1 - my0
    total_w = 1.9 * mh
    s = total_w / WW
    gap = 1.5 * x
    cx = (total_w - mw) / 2 - mx0 + NUDGE * p["R"]
    mark = mark_group(p, fill, cx=cx, cy=mh / 2)
    wy = mh + gap
    word = word_path(fill, 0, wy, s)
    return svg(f"0 0 {f(total_w)} {f(wy + WH * s)}", mark + word, "Crowded lockup, stacked")


def write(path, text):
    (HERE / path).write_text(text)
    print("wrote", path)


def small_paths():
    return "".join(f'<path d="{d}"/>' for d in mark_paths(SMALL, optical_cx(SMALL), 512))


def favicon():
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
        "<title>Crowded</title>"
        "<style>rect{fill:#0B0B0C}g path{fill:#FFFFFF}"
        "@media (prefers-color-scheme: dark){rect{fill:#FFFFFF}g path{fill:#0B0B0C}}</style>"
        f'<rect width="1024" height="1024" rx="228"/><g>{small_paths()}</g></svg>\n'
    )


def main():
    for name, p in (("master", MASTER), ("small", SMALL)):
        write(
            f"meter-c-{name}.svg",
            svg("0 0 1024 1024", mark_group(p, INK), f"Crowded mark, Meter C {name}"),
        )
    # Full bleed squares. iOS and the stores apply their own mask.
    for tag, p in (("", MASTER), ("-small", SMALL)):
        for variant, bg, fg in (("dark", INK, PAPER), ("light", PAPER, INK)):
            body = f'<rect width="1024" height="1024" fill="{bg}"/>' + mark_group(p, fg)
            write(f"icon-{variant}{tag}.svg", svg("0 0 1024 1024", body, f"Crowded icon, {variant}"))
    write("wordmark.svg", wordmark_svg(INK, "Crowded wordmark"))
    write("wordmark-white.svg", wordmark_svg(PAPER, "Crowded wordmark, white"))
    write("lockup-horizontal.svg", lockup_horizontal(INK))
    write("lockup-horizontal-white.svg", lockup_horizontal(PAPER))
    write("lockup-stacked.svg", lockup_stacked(INK))
    write("lockup-stacked-white.svg", lockup_stacked(PAPER))
    write("favicon.svg", favicon())
    # Path data for the small mark, pasted into kit.html as a symbol.
    write("meter-c-small-paths.txt", small_paths() + "\n")

    inject_sheet()
    if "--svg-only" in sys.argv:
        return
    subprocess.run(["node", str(HERE / "render.js")], check=True)
    flatten()


def inject_sheet():
    """Rewrite the mark symbol in sheet.html from the master geometry."""
    paths = "".join(f'<path d="{d}"/>' for d in mark_paths(MASTER, optical_cx(MASTER), 512))
    html = (HERE / "sheet.html").read_text()
    html = re.sub(
        r'(<!-- mark:start -->\s*)<symbol id="mc"[^>]*>.*?</symbol>(\s*<!-- mark:end -->)',
        lambda m: f'{m.group(1)}<symbol id="mc" viewBox="0 0 1024 1024">{paths}</symbol>{m.group(2)}',
        html,
        flags=re.S,
    )
    (HERE / "sheet.html").write_text(html)
    print("updated sheet.html mark symbol")


def flatten():
    """Strip alpha from every opaque PNG (icons and the sheet)."""
    from PIL import Image

    names = list((HERE / "png").glob("icon-*.png")) + [HERE / "brand-sheet.png"]
    for path in names:
        im = Image.open(path)
        if im.mode != "RGB":
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.getchannel("A") if "A" in im.getbands() else None)
            im = bg
        im.save(path, optimize=True)
        print("flattened", path.relative_to(ROOT))


if __name__ == "__main__":
    main()
