"""把不同来源的走路姿势归一化后排在一起，检查能否拼成交替迈步的循环。"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_sheet_sjy import split_sprites, measure, normalize  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "tools", "ref", "rig", "cycle")
os.makedirs(REF, exist_ok=True)


def frames_of(path):
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    sp = split_sprites(img)
    mid = np.median([s["bbox"][1] for s in sp])
    top = [s for s in sp if s["bbox"][1] < mid]
    bot = [s for s in sp if s["bbox"][1] >= mid]
    top.sort(key=lambda s: s["bbox"][0])
    bot.sort(key=lambda s: s["bbox"][0])
    out = {}
    for band, items in (("top", top), ("bottom", bot)):
        arr = []
        for s in items:
            m = measure(s["rgba"])
            arr.append({"norm": normalize(s["rgba"], m), "bbox": s["bbox"], "m": m})
        out[band] = arr
    return out


def label(img, text):
    img = img.copy()
    cv2.putText(img, text, (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
    return img


def main():
    src1 = os.path.join(ROOT, "tools", "ref", "src", "img1_1024.png")
    src6 = os.path.join(ROOT, "roles", "SJY", "img (6).png")
    f1 = frames_of(src1)
    f6 = frames_of(src6)
    print("img1 top", len(f1["top"]), "img6 top", len(f6["top"]))
    print("img1 bottom", len(f1["bottom"]), "img6 bottom", len(f6["bottom"]))

    for band in ("top", "bottom"):
        a = f6[band]
        b = f1[band]
        combo = []
        for i, fr in enumerate(a):
            combo.append((fr["norm"], f"6#{i}"))
        for i, fr in enumerate(b):
            combo.append((fr["norm"], f"1#{i}"))
        strip = np.hstack([label(n, t) for n, t in combo])
        cv2.imwrite(os.path.join(REF, f"all_{band}.png"), strip)

        # 候选循环：6#1,6#2,6#3,1#3
        if len(a) >= 4 and len(b) >= 4:
            cand = [a[1], a[2], a[3], b[3]]
            strip2 = np.hstack([label(c["norm"], f"c{i}") for i, c in enumerate(cand)])
            cv2.imwrite(os.path.join(REF, f"cand_{band}.png"), strip2)
        print("wrote", band)


if __name__ == "__main__":
    main()
