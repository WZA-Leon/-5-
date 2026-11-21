"""检查 roles/ 下每个角色的参考图：切帧、归一化、量化步态，并输出对比图。

用法: python tools/inspect_roles.py
输出: tools/ref/roles/<ROLE>/<img>_<row>.png 以及对比大图。
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_frames import split_sprites, normalize, measure  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tools", "ref", "roles")
os.makedirs(OUT, exist_ok=True)

CELL_W, CELL_H = 240, 460


def analyze(path):
    sprites = split_sprites(path)
    if not sprites:
        return []
    mid = np.median([s["bbox"][1] for s in sprites])
    rows = {"top": [], "bottom": []}
    for s in sprites:
        m = measure(s["rgba"])
        norm = normalize(s["rgba"], m)
        rows["top" if s["bbox"][1] < mid else "bottom"].append({
            "bbox": s["bbox"], "norm": norm, "m": m,
            "spread": m["foot_l"] and m["foot_r"] and (m["foot_r"]["x"] - m["foot_l"]["x"]),
        })
    for k in rows:
        rows[k].sort(key=lambda f: f["bbox"][0])
    return rows


def main():
    for role in sorted(os.listdir(os.path.join(ROOT, "roles"))):
        role_dir = os.path.join(ROOT, "roles", role)
        if not os.path.isdir(role_dir):
            continue
        for name in sorted(os.listdir(role_dir)):
            if not name.lower().endswith(".png"):
                continue
            path = os.path.join(role_dir, name)
            rows = analyze(path)
            tag = os.path.splitext(name)[0].replace(" ", "_").replace("(", "").replace(")", "")
            for band, frames in rows.items():
                prints = []
                for i, f in enumerate(frames):
                    cv2.imwrite(os.path.join(OUT, f"{role}_{tag}_{band}_{i}.png"), f["norm"])
                    lm = f["m"]
                    fl, fr = lm["foot_l"], lm["foot_r"]
                    sp = f"{f['spread']:.0f}" if f["spread"] is not None else "None"
                    prints.append(
                        f"#{i} spread={sp} "
                        f"L={None if not fl else (round(fl['x'] - lm['torso_cx']), fl['y'] - lm['bottom'])} "
                        f"R={None if not fr else (round(fr['x'] - lm['torso_cx']), fr['y'] - lm['bottom'])}"
                    )
                print(f"{role}/{name} [{band}] n={len(frames)}")
                for p in prints:
                    print("   ", p)

            # 视觉对比图：上排、下排各一行，按原始帧归一化后并排
            for band, frames in rows.items():
                if not frames:
                    continue
                strip = np.hstack([f["norm"] for f in frames])
                cv2.imwrite(os.path.join(OUT, f"{role}_{tag}_{band}_strip.png"), strip)


if __name__ == "__main__":
    main()
