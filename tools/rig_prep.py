"""准备 SJY 骨架素材：从 1024 原图取站立/接触帧，用"只删边缘白底"的抠图，归一化到 320x460。"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_frames import measure  # noqa: E402
from sprite_extract import split_sprites  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tools", "ref", "rig")
os.makedirs(OUT, exist_ok=True)

CELL_W, CELL_H = 320, 460
BODY_H = 408
FEET_Y = 452


def normalize(rgba, m):
    s = BODY_H / m["height"]
    r = cv2.resize(rgba, None, fx=s, fy=s,
                   interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LANCZOS4)
    canvas = np.zeros((CELL_H, CELL_W, 4), np.uint8)
    px = int(round(CELL_W / 2 - m["torso_cx"] * s))
    py = int(round(FEET_Y - m["bottom"] * s))
    x0, y0 = max(0, px), max(0, py)
    x1, y1 = min(CELL_W, px + r.shape[1]), min(CELL_H, py + r.shape[0])
    if x1 > x0 and y1 > y0:
        canvas[y0:y1, x0:x1] = r[y0 - py:y1 - py, x0 - px:x1 - px]
    return canvas


def main():
    src = os.path.join(ROOT, "tools", "ref", "src", "img1_1024.png")
    sprites = split_sprites(src)
    mid = np.median([s["bbox"][1] for s in sprites])
    top = [s for s in sprites if s["bbox"][1] < mid]
    top.sort(key=lambda s: s["bbox"][0])
    print("top frames", len(top))
    for idx, tag in [(0, "idle"), (2, "contact")]:
        s = top[idx]
        m = measure(s["rgba"])
        cell = normalize(s["rgba"], m)
        cv2.imwrite(os.path.join(OUT, f"{tag}_320.png"), cell)
        ys, xs = np.nonzero(cell[:, :, 3] > 0)
        print(tag, "bbox", (xs.min(), ys.min(), xs.max(), ys.max()),
              "size", (xs.max() - xs.min() + 1, ys.max() - ys.min() + 1))


if __name__ == "__main__":
    main()
