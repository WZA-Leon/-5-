"""从 AI 生成的参考图里提取可用的走路帧。

问题：这些图不是规则网格，帧距不等、比例不一、朝向也混排，直接按比例切会错位。
做法：
  1. 连通域分割出每个小人（自动跳过标题条、分隔线）
  2. 用「头发团块质心 vs 面部肤色质心」判断朝向（马尾在脑后，脸在前）
  3. 统一身高、脚底基线、躯干中心，得到可比较的规范图
  4. 量出每帧的步态量：前后脚掌偏移、抬脚高度、小腿遮挡厚度
  5. 用光流做姿态插值，把 3 个真实姿势补成 8 帧循环（同图内插值，画风 100% 一致）
"""

import glob
import json
import os

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")

BODY_H = 408        # 归一化后的身高（像素）
CELL_W, CELL_H = 240, 460
PAD_BOTTOM = 8


# --------------------------------------------------------------------------- #
# 分割
# --------------------------------------------------------------------------- #
def split_sprites(path):
    img = cv2.imread(path)
    if img is None:
        return []
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    near_white = (hsv[:, :, 1] < 26) & (hsv[:, :, 2] > 196)
    mask = cv2.morphologyEx((~near_white).astype(np.uint8), cv2.MORPH_CLOSE,
                            np.ones((5, 5), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)

    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 6000 or h < 150 or w < 40 or h / max(w, 1) < 1.2:
            continue  # 标题条 / 分隔线 / 噪点
        m = cv2.morphologyEx((labels[y:y + h, x:x + w] == i).astype(np.uint8),
                             cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        crop = img[y:y + h, x:x + w]
        rgba = cv2.cvtColor(crop, cv2.COLOR_BGR2BGRA)
        rgba[:, :, 3] = m * 255
        # 去掉透明区的杂色，避免插值时渗色
        rgba[m == 0] = 0
        out.append({"bbox": (int(x), int(y), int(x + w - 1), int(y + h - 1)), "rgba": rgba})
    out.sort(key=lambda s: (s["bbox"][1] // 200, s["bbox"][0]))
    return out


# --------------------------------------------------------------------------- #
# 朝向：脸（肤色）在头发团块的哪一侧
# --------------------------------------------------------------------------- #
def facing(rgba):
    a = rgba[:, :, 3] > 128
    ys, xs = np.nonzero(a)
    top, bottom = ys.min(), ys.max()
    h = bottom - top + 1
    head = np.zeros_like(a)
    head[top:top + int(h * 0.34)] = a[top:top + int(h * 0.34)]

    ycrcb = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_BGR2YCrCb)
    skin = cv2.inRange(ycrcb, (0, 140, 90), (255, 178, 135)) > 0
    skin &= head
    hair = (cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_BGR2GRAY) < 70) & head

    if skin.sum() < 40 or hair.sum() < 40:
        return 1
    skin_cx = float(np.nonzero(skin)[1].mean())
    hair_cx = float(np.nonzero(hair)[1].mean())
    return 1 if skin_cx > hair_cx else -1  # +1 = 朝右


# --------------------------------------------------------------------------- #
# 归一化
# --------------------------------------------------------------------------- #
def measure(rgba):
    a = rgba[:, :, 3] > 128
    ys, xs = np.nonzero(a)
    top, bottom = int(ys.min()), int(ys.max())
    h = bottom - top + 1

    # 躯干中心：腰部高度带里最长的一段（排除马尾、手臂）
    band = a[top + int(h * 0.46):top + int(h * 0.54)]
    cols = np.nonzero(band.any(axis=0))[0]
    if cols.size:
        segs = np.split(cols, np.where(np.diff(cols) > 6)[0] + 1)
        seg = max(segs, key=len)
        torso_cx = float((seg[0] + seg[-1]) / 2)
    else:
        torso_cx = float(xs.mean())

    # 左右脚掌：最低 8% 内的像素，按躯干中心分左右
    sole = np.zeros_like(a)
    low0 = bottom - int(h * 0.08)
    sole[low0:bottom + 1] = a[low0:bottom + 1]
    sy, sx = np.nonzero(sole)
    left = sx < torso_cx
    right = ~left
    def stats(mask_sel, coords_x, coords_y):
        if mask_sel.sum() < 20:
            return None
        return {
            "x": float(coords_x[mask_sel].mean()),
            "y": float(coords_y[mask_sel].min()),   # 越靠上=越抬起
            "w": int(coords_x[mask_sel].max() - coords_x[mask_sel].min()),
        }
    foot_l = stats(left, sx, sy)
    foot_r = stats(right, sx, sy)

    # 小腿厚度（在膝盖以下高度带里，某一侧最长连续像素段）
    def thick(x0, x1):
        best = 0
        for r in range(top + int(h * 0.80), top + int(h * 0.96)):
            line = np.nonzero(a[r, x0:x1])[0]
            if line.size == 0:
                continue
            segs = np.split(line, np.where(np.diff(line) > 1)[0] + 1)
            best = max(best, max(len(s) for s in segs))
        return best

    return {
        "height": h,
        "torso_cx": torso_cx,
        "foot_l": foot_l,
        "foot_r": foot_r,
        "shin_l": thick(0, int(torso_cx)),
        "shin_r": thick(int(torso_cx), a.shape[1]),
        "top": top,
        "bottom": bottom,
    }


def normalize(rgba, lm):
    s = BODY_H / lm["height"]
    r = cv2.resize(rgba, None, fx=s, fy=s,
                   interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LANCZOS4)
    canvas = np.zeros((CELL_H, CELL_W, 4), np.uint8)
    px = int(round(CELL_W / 2 - lm["torso_cx"] * s))
    py = int(round(CELL_H - PAD_BOTTOM - lm["height"] * s))
    x0, y0 = max(0, px), max(0, py)
    x1 = min(CELL_W, px + r.shape[1])
    y1 = min(CELL_H, py + r.shape[0])
    if x1 > x0 and y1 > y0:
        canvas[y0:y1, x0:x1] = r[y0 - py:y1 - py, x0 - px:x1 - px]
    return canvas


# --------------------------------------------------------------------------- #
# 光流插值：两张规范帧之间生成 t 处的中割帧
# --------------------------------------------------------------------------- #
def flow_morph(fa, fb, t=0.5):
    """用 Farneback 光流把 A 朝 B 变形，与 B 朝 A 的变形按 t 混合。"""
    ga = cv2.cvtColor(fa, cv2.COLOR_BGRA2GRAY)
    gb = cv2.cvtColor(fb, cv2.COLOR_BGRA2GRAY)
    flow_f = cv2.calcOpticalFlowFarneback(ga, gb, None, 0.5, 4, 21, 5, 7, 1.5, 0)
    flow_b = cv2.calcOpticalFlowFarneback(gb, ga, None, 0.5, 4, 21, 5, 7, 1.5, 0)

    h, w = ga.shape
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))

    def warp(img, flow, sign):
        mx = gx + sign * flow[:, :, 0] * t
        my = gy + sign * flow[:, :, 1] * t
        return cv2.remap(img, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

    wa = warp(fa, flow_f, +1)
    wb = warp(fb, flow_b, -1)

    # 只在「有内容」的区域混合，避免把空白处糊进轮廓
    aw = wa[:, :, 3:4].astype(np.float32) / 255.0
    bw = wb[:, :, 3:4].astype(np.float32) / 255.0
    out = (wa.astype(np.float32) * aw * (1 - t) + wb.astype(np.float32) * bw * t)
    alpha = wa[:, :, 3].astype(np.float32) * (1 - t) + wb[:, :, 3].astype(np.float32) * t
    denom = np.maximum(aw * (1 - t) + bw * t, 1e-4)
    out[:, :, :3] /= denom
    out[:, :, 3] = alpha

    # 规整回「脚底不动」：变形后的脚掌可能略微漂移，用重心对齐回原图
    res = np.clip(out, 0, 255).astype(np.uint8)
    return snap_baseline(res, fa, fb, t)


def snap_baseline(img, fa, fb, t):
    """把插值帧的脚底和躯干中心拉回到两张源帧的平均位置。"""
    def anchor(f):
        a = f[:, :, 3] > 128
        ys, xs = np.nonzero(a)
        if xs.size == 0:
            return (0, 0)
        return (float(xs.mean()), float(ys.max()))

    ax, ay = anchor(fa)
    bx, by = anchor(fb)
    tx = ax * (1 - t) + bx * t
    ty = ay * (1 - t) + by * t
    cx, cy = anchor(img)
    dx, dy = int(round(tx - cx)), int(round(ty - cy))
    if dx == 0 and dy == 0:
        return img
    m = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(img, m, (img.shape[1], img.shape[0]),
                          flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                          borderValue=(0, 0, 0, 0))


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def build_sheet(source="img (8).png"):
    path = os.path.join(ROOT, source)
    sprites = split_sprites(path)
    rows = []
    for s in sprites:
        lm = measure(s["rgba"])
        rows.append({"rgba": s["rgba"], "lm": lm, "face": facing(s["rgba"]), "bbox": s["bbox"]})

    # 分方向、分左右半区（同一张图里上排 / 下排）
    mid_y = np.median([r["bbox"][1] for r in rows])
    for r in rows:
        r["band"] = "top" if r["bbox"][1] < mid_y else "bottom"

    info = []
    for r in rows:
        lm = r["lm"]
        info.append({
            "bbox": r["bbox"],
            "band": r["band"],
            "face": r["face"],
            "torso_cx": round(lm["torso_cx"], 1),
            "foot_l_x": None if not lm["foot_l"] else round(lm["foot_l"]["x"] - lm["torso_cx"], 1),
            "foot_r_x": None if not lm["foot_r"] else round(lm["foot_r"]["x"] - lm["torso_cx"], 1),
            "foot_l_y": None if not lm["foot_l"] else round(lm["foot_l"]["y"] - lm["bottom"], 1),
            "foot_r_y": None if not lm["foot_r"] else round(lm["foot_r"]["y"] - lm["bottom"], 1),
            "shin_l": lm["shin_l"],
            "shin_r": lm["shin_r"],
        })

    return rows, info


def main():
    rows, info = build_sheet()
    for i, r in enumerate(info):
        print(f'{i:2d} {r["band"]:6s} face={"R" if r["face"] > 0 else "L"} '
              f'footL={r["foot_l_x"]}@{r["foot_l_y"]} footR={r["foot_r_x"]}@{r["foot_r_y"]} '
              f'shinL={r["shin_l"]} shinR={r["shin_r"]}')
    with open(os.path.join(TOOLS, "sheet_info.json"), "w", encoding="utf-8") as fh:
        json.dump(info, fh, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()