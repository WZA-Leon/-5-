"""分析用户提供的"肢解参考图"：按列/行切出各个身体部件。"""
import os
import sys

import cv2
import numpy as np

SRC = r"E:\mad\playground-1795268747-1.png"
OUT = r"E:\mad\tools\ref\rig\parts_sheet"
os.makedirs(OUT, exist_ok=True)

img = cv2.imread(SRC, cv2.IMREAD_UNCHANGED)
if img is None:
    raise SystemExit("missing " + SRC)
a = img[:, :, 3]
mask = (a > 0).astype(np.uint8)
n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
items = []
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area < 400:
        continue
    items.append({"i": i, "bbox": (int(x), int(y), int(x + w - 1), int(y + h - 1)),
                  "area": int(area), "cx": float(cents[i][0]), "cy": float(cents[i][1])})

# 只保留内容区域较大的部件，按列分组
cols = {c: [] for c in range(4)}
for it in items:
    c = min(3, int(it["cx"] // 256))
    cols[c].append(it)
for c in cols:
    cols[c].sort(key=lambda t: t["bbox"][1])
    print(f"== col {c}: {len(cols[c])} parts")
    for it in cols[c]:
        x0, y0, x1, y1 = it["bbox"]
        print(f"   bbox=({x0},{y0},{x1},{y1}) w={x1-x0+1} h={y1-y0+1} area={it['area']}")
    # 导出每个部件的透明 PNG
    for k, it in enumerate(cols[c]):
        part = np.zeros_like(img)
        m = (labels == it["i"])
        part[m] = img[m]
        x0, y0, x1, y1 = it["bbox"]
        crop = part[y0:y1 + 1, x0:x1 + 1]
        cv2.imwrite(os.path.join(OUT, f"c{c}_p{k}.png"), crop)
print("items", len(items))
