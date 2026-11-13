#!/usr/bin/env python3
"""Writes the iOS app icon set from png/icon-dark-1024.png.

Run: python3 marketing/brand/final/ios_icons.py
- AppIcon.png: full bleed 1024, no alpha.
- AppIcon-dark.png: same art. The master is already white on ink, which is what the dark
  appearance wants. Opaque, no alpha.
- AppIcon-tinted.png: 8 bit grayscale, no alpha. iOS applies the tint.
"""
import json
import shutil
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE / "png/icon-dark-1024.png"
OUT = HERE.parents[2] / "ios/Crowded/Resources/Assets.xcassets/AppIcon.appiconset"


def entry(name, appearance=None):
    d = {"filename": name, "idiom": "universal", "platform": "ios", "size": "1024x1024"}
    if appearance:
        d["appearances"] = [{"appearance": "luminosity", "value": appearance}]
    return d


def main():
    im = Image.open(SRC)
    assert im.size == (1024, 1024) and im.mode == "RGB", (im.size, im.mode)
    shutil.copyfile(SRC, OUT / "AppIcon.png")
    shutil.copyfile(SRC, OUT / "AppIcon-dark.png")
    im.convert("L").save(OUT / "AppIcon-tinted.png", optimize=True)
    contents = {
        "images": [
            entry("AppIcon.png"),
            entry("AppIcon-dark.png", "dark"),
            entry("AppIcon-tinted.png", "tinted"),
        ],
        "info": {"author": "xcode", "version": 1},
    }
    (OUT / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n")
    for n in ("AppIcon.png", "AppIcon-dark.png", "AppIcon-tinted.png"):
        i = Image.open(OUT / n)
        assert i.size == (1024, 1024) and "A" not in i.getbands(), n
        print(n, i.size, i.mode)


if __name__ == "__main__":
    main()
