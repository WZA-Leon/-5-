"""把 rig3 的 16 帧走路 + 1 帧站立打包成 17 列 × 2 行的精灵表。

按最新要求：只交换“右向/左向”两行的手臂，身体/腿/头保持原样。
"""
import os

import cv2
import numpy as np

ROOT = r"E:\mad"
FRAMES = os.path.join(ROOT, "tools", "ref", "rig", "rig3")
OUT_PNG = os.path.join(ROOT, "assets", "hero.png")
OUT_WEBP = os.path.join(ROOT, "assets", "hero.webp")

CELL_W, CELL_H = 320, 460
N = 16


def over(bg, fg):
    a = fg[:, :, 3:4].astype(np.float32) / 255.0
    out = bg.copy()
    out[:, :, :3] = (fg[:, :, :3].astype(np.float32) * a +
                     bg[:, :, :3].astype(np.float32) * (1 - a)).astype(np.uint8)
    out[:, :, 3] = np.maximum(bg[:, :, 3], fg[:, :, 3])
    return out


frames = []
for i in range(N):
    legs = cv2.imread(os.path.join(FRAMES, f"walk_{i:02d}_legs.png"), cv2.IMREAD_UNCHANGED)
    shoel = cv2.imread(os.path.join(FRAMES, f"walk_{i:02d}_shoel.png"), cv2.IMREAD_UNCHANGED)
    shoer = cv2.imread(os.path.join(FRAMES, f"walk_{i:02d}_shoer.png"), cv2.IMREAD_UNCHANGED)
    body = cv2.imread(os.path.join(FRAMES, f"walk_{i:02d}_body.png"), cv2.IMREAD_UNCHANGED)
    far = cv2.imread(os.path.join(FRAMES, f"walk_{i:02d}_armfar.png"), cv2.IMREAD_UNCHANGED)
    near = cv2.imread(os.path.join(FRAMES, f"walk_{i:02d}_armnear.png"), cv2.IMREAD_UNCHANGED)
    if legs is None or shoel is None or shoer is None or body is None or far is None or near is None:
        raise SystemExit(f"missing parts for frame {i}")
    frames.append((legs, shoel, shoer, body, far, near))

# 列 0 站立（用第 0 帧），列 1..16 走路
cols = [frames[0]] + frames
sheet = np.zeros((CELL_H * 2, CELL_W * len(cols), 4), np.uint8)
for c, (legs, shoel, shoer, body, far, near) in enumerate(cols):
    # 静止帧不再单独翻脚，和走路一样：鞋在两只脚旁边、朝行走方向
    # 裤脚压住鞋面（鞋在裤腿下面），鞋口和裤脚正好连上
    sheet[0:CELL_H, c * CELL_W:(c + 1) * CELL_W] = over(
        over(over(over(over(shoel, shoer), legs), far), cv2.flip(body, 1)), near)
    sheet[CELL_H:CELL_H * 2, c * CELL_W:(c + 1) * CELL_W] = over(
        over(over(over(over(cv2.flip(shoer, 1), cv2.flip(shoel, 1)), cv2.flip(legs, 1)),
                    cv2.flip(near, 1)), body), cv2.flip(far, 1))

cv2.imwrite(OUT_PNG, sheet)
cv2.imwrite(OUT_WEBP, sheet, [cv2.IMWRITE_WEBP_QUALITY, 92])
print("sheet", sheet.shape, "png", os.path.getsize(OUT_PNG), "webp", os.path.getsize(OUT_WEBP))
