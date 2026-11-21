"""把接触帧按切割线分块：躯干（含头/上臂）、左右前臂、左右腿、左右鞋。

坐标基于 tools/ref/rig/contact_320.png（干净抠图后的 320x460 画布）。
"""
import json
import os
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "tools", "ref", "rig")
OUT = os.path.join(REF, "parts")
os.makedirs(OUT, exist_ok=True)

SRC = os.path.join(REF, "contact_320.png")

CUTS = {
    "elbow_far": [(66, 272), (95, 282), (125, 296), (145, 308)],
    "elbow_near": [(232, 240), (250, 264), (268, 288), (282, 306)],
    "hip_far": [(95, 322), (131, 336), (151, 350)],
    "hip_near": [(212, 322), (166, 336), (151, 350)],
    "ankle_far": [(48, 428), (85, 418), (122, 410)],
    "ankle_near": [(182, 410), (225, 418), (266, 428)],
}

PARTS = {
    "torso": {"seed": (150, 270), "pivot": (150, 330)},
    "arm_far": {"seed": (85, 322), "pivot": (108, 290)},
    "arm_near": {"seed": (275, 298), "pivot": (250, 272)},
    "leg_far": {"seed": (100, 380), "pivot": (131, 336)},
    "leg_near": {"seed": (200, 390), "pivot": (166, 336)},
    "foot_far": {"seed": (78, 440), "pivot": (85, 424)},
    "foot_near": {"seed": (225, 440), "pivot": (225, 424)},
}

COLORS = {
    "torso": (60, 220, 120),
    "arm_far": (255, 120, 60),
    "arm_near": (255, 60, 200),
    "leg_far": (60, 200, 255),
    "leg_near": (200, 60, 255),
    "foot_far": (255, 220, 60),
    "foot_near": (120, 255, 60),
}


def main():
    img = cv2.imread(SRC, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise SystemExit(f"missing {SRC}")
    h, w = img.shape[:2]
    alpha = img[:, :, 3]

    walls = np.zeros((h, w), np.uint8)
    for pts in CUTS.values():
        cv2.polylines(walls, [np.array(pts, np.int32)], False, 255, 3)

    free = ((alpha > 0) & (walls == 0)).astype(np.uint8)
    n, labels = cv2.connectedComponents(free, 8)

    seeds = {}
    for name, info in PARTS.items():
        sx, sy = info["seed"]
        lab = int(labels[sy, sx])
        if lab == 0:
            print(f"WARN {name} seed {info['seed']} in wall/background")
            continue
        seeds[name] = lab

    inv = {}
    for name, lab in seeds.items():
        inv.setdefault(lab, []).append(name)
    for lab, names in inv.items():
        if len(names) > 1:
            print(f"WARN same component: {names}")

    debug = img.copy()
    overlay = np.zeros_like(img)
    meta = {}
    for name, lab in seeds.items():
        mask = (labels == lab).astype(np.uint8) * 255
        part = np.zeros_like(img)
        part[mask > 0] = img[mask > 0]
        cv2.imwrite(os.path.join(OUT, f"{name}.png"), part)
        c = COLORS[name]
        overlay[mask > 0, 0] = c[0]
        overlay[mask > 0, 1] = c[1]
        overlay[mask > 0, 2] = c[2]
        overlay[mask > 0, 3] = 130
        meta[name] = {"pivot": PARTS[name]["pivot"], "area": int((mask > 0).sum())}
        print(f"{name:9s} area={int((mask>0).sum()):5d} pivot={PARTS[name]['pivot']}")

    merged = cv2.addWeighted(debug, 1.0, overlay, 0.55, 0)
    for name, pts in CUTS.items():
        cv2.polylines(merged, [np.array(pts, np.int32)], False, (0, 0, 255), 2)
    for name, info in PARTS.items():
        px, py = info["pivot"]
        cv2.circle(merged, (px, py), 4, (255, 255, 255), 1)
        cv2.putText(merged, name, (px + 5, py - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
    cv2.imwrite(os.path.join(REF, "parts_debug.png"), merged)

    with open(os.path.join(REF, "rig_meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)
    print("parts:", len(seeds), "->", os.path.join(REF, "parts_debug.png"))


if __name__ == "__main__":
    main()
