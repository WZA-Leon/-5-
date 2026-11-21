"""重抠 SJY 精灵表：只去掉与画布边缘连通的白底，保留白衬衫/白鞋。

用法:
  python tools/build_sheet_sjy.py [源图路径] [输出目录]
输出: assets/hero.png + hero.webp（4 列 × 2 行，列 0 站立，1..3 走路）
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sprite_extract import background_mask  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CELL_W, CELL_H = 240, 460
BODY_H = 408
FEET_Y = 452


def split_sprites(img, min_area=6000):
    h, w = img.shape[:2]
    bg = background_mask(img)
    mask = (~bg).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    out = []
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if area < min_area or hh < 150 or ww < 40 or hh / max(ww, 1) < 1.2:
            continue
        m = (labels[y:y + hh, x:x + ww] == i).astype(np.uint8)
        crop = img[y:y + hh, x:x + ww]
        rgba = cv2.cvtColor(crop, cv2.COLOR_BGR2BGRA)
        rgba[:, :, 3] = m * 255
        rgba[m == 0] = 0
        out.append({"bbox": (int(x), int(y), int(x + ww - 1), int(y + hh - 1)), "rgba": rgba})
    out.sort(key=lambda s: (s["bbox"][1] // 200, s["bbox"][0]))
    return out


def measure(rgba):
    a = rgba[:, :, 3] > 128
    ys, xs = np.nonzero(a)
    top, bottom = int(ys.min()), int(ys.max())
    h = bottom - top + 1
    band = a[top:top + max(1, int(h * 0.32))]
    cols = np.nonzero(band.any(axis=0))[0]
    cx = float((cols[0] + cols[-1]) / 2) if cols.size else float(xs.mean())
    low = a[bottom - int(h * 0.08): bottom + 1]
    lcols = np.nonzero(low.any(axis=0))[0]
    spread = float(lcols[-1] - lcols[0]) if lcols.size else 0.0
    return dict(top=top, bottom=bottom, h=h, cx=cx, spread=spread)


def normalize(rgba, m):
    s = BODY_H / m["h"]
    w = max(1, int(round(rgba.shape[1] * s)))
    h = max(1, int(round(rgba.shape[0] * s)))
    resized = cv2.resize(rgba, (w, h),
                         interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LANCZOS4)
    canvas = np.zeros((CELL_H, CELL_W, 4), np.uint8)
    px = int(round(CELL_W / 2 - m["cx"] * s))
    py = int(round(FEET_Y - m["bottom"] * s))
    x0, y0 = max(0, px), max(0, py)
    x1, y1 = min(CELL_W, px + w), min(CELL_H, py + h)
    if x1 > x0 and y1 > y0:
        canvas[y0:y1, x0:x1] = resized[y0 - py:y1 - py, x0 - px:x1 - px]
    return canvas


def classify(frames):
    if len(frames) >= 5:
        stand = min([frames[0], frames[-1]], key=lambda f: f["spread"])
        swing, contact, passing = frames[1], frames[2], frames[3]
    else:
        ordered = sorted(frames, key=lambda f: f["spread"])
        stand = ordered[0]
        contact = max(ordered[1:], key=lambda f: f["spread"])
        rest = [f for f in ordered[1:] if f is not contact]
        swing = min(rest, key=lambda f: f["spread"])
        passing = max(rest, key=lambda f: f["spread"])
    return dict(stand=stand, contact=contact, passing=passing, swing=swing)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "tools", "ref", "src", "img1_1024.png")
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "assets")
    img = cv2.imread(src, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"missing {src}")
    sprites = split_sprites(img)
    if len(sprites) < 8:
        raise SystemExit(f"split only {len(sprites)} sprites")

    mid = np.median([s["bbox"][1] for s in sprites])
    groups = {"top": [], "bottom": []}
    for s in sprites:
        m = measure(s["rgba"])
        item = {"norm": normalize(s["rgba"], m), "bbox": s["bbox"], **m}
        groups["top" if s["bbox"][1] < mid else "bottom"].append(item)
    for k in groups:
        groups[k].sort(key=lambda f: f["bbox"][0])

    if len(groups["top"]) >= 5:
        right = classify(groups["top"])
        left = classify(groups["bottom"])
        order = lambda g: [g["contact"], g["passing"], g["swing"]]  # noqa: E731
        cols = 4
        sheet = np.zeros((CELL_H * 2, CELL_W * cols, 4), np.uint8)
        for col, f in enumerate([right["stand"]] + order(right)):
            sheet[0:CELL_H, col * CELL_W:(col + 1) * CELL_W] = f["norm"]
        for col, f in enumerate([left["stand"]] + order(left)):
            sheet[CELL_H:CELL_H * 2, col * CELL_W:(col + 1) * CELL_W] = f["norm"]
        print("right:", {k: v["bbox"] for k, v in right.items()})
        print("left :", {k: v["bbox"] for k, v in left.items()})
    else:
        raise SystemExit("unexpected frame layout")

    os.makedirs(out_dir, exist_ok=True)
    png = os.path.join(out_dir, "hero.png")
    webp = os.path.join(out_dir, "hero.webp")
    cv2.imwrite(png, sheet)
    cv2.imwrite(webp, sheet, [cv2.IMWRITE_WEBP_QUALITY, 92])
    print(f"sheet {sheet.shape[1]}x{sheet.shape[0]} -> {png} {os.path.getsize(png)} B / {webp} {os.path.getsize(webp)} B")

    # 检查每格裁切
    for r in range(2):
        for c in range(cols):
            cell = sheet[r * CELL_H:(r + 1) * CELL_H, c * CELL_W:(c + 1) * CELL_W]
            ys, xs = np.nonzero(cell[:, :, 3] > 0)
            print(f"row{r} col{c} bbox=({xs.min()},{ys.min()},{xs.max()},{ys.max()})",
                  "CLIP!" if xs.min() == 0 or xs.max() == CELL_W - 1 else "")


if __name__ == "__main__":
    main()
