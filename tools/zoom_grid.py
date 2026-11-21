"""在局部区域上叠加坐标网格，便于手工标定骨架切分坐标。"""
import sys

import cv2
import numpy as np

src = sys.argv[1]
x0, y0, x1, y1 = (int(v) for v in sys.argv[2:6])
scale = int(sys.argv[6]) if len(sys.argv) > 6 else 4
out = sys.argv[7] if len(sys.argv) > 7 else r"E:\mad\tools\ref\rig\zoom_grid.png"

img = cv2.imread(src, cv2.IMREAD_UNCHANGED)
crop = img[y0:y1, x0:x1]
big = cv2.resize(crop, (crop.shape[1] * scale, crop.shape[0] * scale), interpolation=cv2.INTER_NEAREST)
h, w = big.shape[:2]
for x in range(x0 - x0 % 10, x1 + 1, 10):
    px = (x - x0) * scale
    if px < 0 or px >= w:
        continue
    c = (0, 0, 255) if x % 50 == 0 else (170, 170, 170)
    cv2.line(big, (px, 0), (px, h), c, 1)
    if x % 50 == 0:
        cv2.putText(big, str(x), (px + 2, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1)
for y in range(y0 - y0 % 10, y1 + 1, 10):
    py = (y - y0) * scale
    if py < 0 or py >= h:
        continue
    c = (0, 0, 255) if y % 50 == 0 else (170, 170, 170)
    cv2.line(big, (0, py), (w, py), c, 1)
    if y % 50 == 0:
        cv2.putText(big, str(y), (2, py + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1)
cv2.imwrite(out, big)
print("saved", out, big.shape)
