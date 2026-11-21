"""打印归一化帧在关键高度上的像素段分类，用于确定骨架切分边界。"""
import sys

import cv2
import numpy as np

IMG = sys.argv[1] if len(sys.argv) > 1 else r"E:\mad\tools\ref\rig\contact_320.png"


def classify(bgr, a):
    if a < 128:
        return "."
    b, g, r = int(bgr[0]), int(bgr[1]), int(bgr[2])
    if r > 110 and r > g * 1.5 and r > b * 1.3:
        return "R"  # 红色条纹
    if r < 75 and g < 75 and b < 95:
        if r < 45 and g < 45:
            return "H"  # 头发/最深
        return "P"  # 藏青/裤子
    if r > 200 and g > 200 and b > 195:
        return "W"  # 白衬衫/鞋
    if r > 150 and g > 100 and b > 70:
        return "S"  # 皮肤
    if r > 90 and g > 90 and b > 90:
        return "L"  # 浅灰鞋
    return "?"


def main():
    img = cv2.imread(IMG, cv2.IMREAD_UNCHANGED)
    for y in (190, 200, 210, 220, 230, 240, 250, 260, 280, 300, 310, 320, 330, 340, 350, 360, 380, 400, 420, 440, 448):
        row = img[y]
        a = row[:, 3] >= 128
        if not a.any():
            continue
        runs = []
        start = None
        prev = None
        for x in range(img.shape[1]):
            c = classify(row[x], row[x, 3])
            if c == ".":
                if start is not None:
                    runs.append((start, x - 1, prev))
                    start = None
                continue
            if start is None:
                start = x
                prev = c
            elif c != prev:
                runs.append((start, x - 1, prev))
                start = x
                prev = c
        if start is not None:
            runs.append((start, img.shape[1] - 1, prev))
        print(f"y={y:3d}: " + "  ".join(f"{a}-{b}:{c}" for a, b, c in runs))


if __name__ == "__main__":
    main()
