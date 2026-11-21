"""从 2.png（绿幕拆件图）抠出各部件，输出透明 PNG + 部件清单。"""
import os

import cv2
import numpy as np

SRC = r"E:\mad\2.png"
OUT = r"E:\mad\tools\ref\rig\sheet2"
os.makedirs(OUT, exist_ok=True)

img = cv2.imread(SRC, cv2.IMREAD_UNCHANGED)
if img is None:
    raise SystemExit("missing " + SRC)
b, g, r = img[:, :, 0].astype(np.int16), img[:, :, 1].astype(np.int16), img[:, :, 2].astype(np.int16)
green = ((g > 150) & (g > r + 40) & (g > b + 40))
# 去掉边缘绿色描边/半透明过渡：先膨胀绿幕 1px
green_d = cv2.dilate(green.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
alpha = np.where(green_d, 0, 255).astype(np.uint8)
rgba = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
rgba[:, :, 3] = alpha

n, labels, stats, cents = cv2.connectedComponentsWithStats((alpha > 0).astype(np.uint8), 8)
items = []
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area < 800:
        continue
    items.append({"i": i, "bbox": (int(x), int(y), int(x + w - 1), int(y + h - 1)),
                  "area": int(area), "cx": float(cents[i][0]), "cy": float(cents[i][1])})
items.sort(key=lambda t: (t["bbox"][1] // 300, t["bbox"][0]))
print("parts:", len(items))
for k, it in enumerate(items):
    x0, y0, x1, y1 = it["bbox"]
    part = np.zeros_like(rgba)
    m = labels == it["i"]
    part[m] = rgba[m]
    crop = part[y0:y1 + 1, x0:x1 + 1]
    name = f"p{k:02d}_x{x0}_y{y0}"
    cv2.imwrite(os.path.join(OUT, name + ".png"), crop)
    print(f"{name:22s} bbox=({x0},{y0},{x1},{y1}) w={x1-x0+1:3d} h={y1-y0+1:3d} area={it['area']}")

cv2.imwrite(os.path.join(OUT, "keyed_full.png"), rgba)
print("wrote", OUT)
