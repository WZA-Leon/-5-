"""用 img (1).png 里的真实帧拼走路动画（不做任何程序化生成）。

img (1) 每排 5 帧，实测：
  #0 / #4  站立（两脚张开 34~40px，脚都在地上）
  #2       跨步最大（两脚张开 118px）—— 接触帧
  #3       双腿交叉、两脚都在地上 —— 经过帧
  #1       一条腿抬起、只有一只脚着地 —— 摆动帧（抬脚最高的那帧）

循环取「接触 → 经过 → 摆动 → 经过」，正好是一个完整的迈步过程：
  前脚落地 → 后腿交叉跟上 → 抬腿向前摆 → 再落回接触帧
姿势全部来自原图，只有对齐（缩放到同身高、头肩对中线、脚底对基线）是计算出来的。

输出：5 列 × 2 行，列 0 站立，列 1..4 走路循环；行 0 朝右，行 1 朝左
"""

import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract_frames import split_sprites

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CELL_W, CELL_H = 240, 460
BODY_H = 408
FEET_Y = 452
SOURCE = "img (1).png"


def measure(rgba):
    a = rgba[:, :, 3] > 128
    ys, xs = np.nonzero(a)
    top, bottom = int(ys.min()), int(ys.max())
    h = bottom - top + 1

    # 头肩中心：最上面 32% 的水平范围中点
    band = a[top:top + max(1, int(h * 0.32))]
    cols = np.nonzero(band.any(axis=0))[0]
    cx = float((cols[0] + cols[-1]) / 2) if cols.size else float(xs.mean())

    # 两脚张开宽度：最低 8% 的像素 x 范围
    low = a[bottom - int(h * 0.08): bottom + 1]
    lcols = np.nonzero(low.any(axis=0))[0]
    spread = float(lcols[-1] - lcols[0]) if lcols.size else 0.0

    # 抬脚程度：最低 3% 里的像素数越少，说明有一只脚离地
    ground = a[bottom - max(1, int(h * 0.03)): bottom + 1]
    ground_px = int(ground.sum())

    return dict(top=top, bottom=bottom, h=h, cx=cx, spread=spread, ground_px=ground_px)


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
    """把一排的帧分成 站立 / 接触 / 经过 / 摆动。

    img (1) 每排的版式固定为「站立 + 三帧走路 + 站立」，
    且上下两排是同一套姿势的镜像，所以按下标分配角色，
    保证左右两个方向的动画完全一致：
      下标 1 = 摆动（一条腿抬起，着地像素最少）
      下标 2 = 接触（两脚张开最大）
      下标 3 = 经过（双腿交叉）
    """
    if len(frames) >= 5:
        stand = min([frames[0], frames[-1]], key=lambda f: f["spread"])
        swing, contact, passing = frames[1], frames[2], frames[3]
    else:
        ordered = sorted(frames, key=lambda f: f["spread"])
        stand = ordered[0]
        contact = max(ordered[1:], key=lambda f: f["spread"])
        rest = sorted([f for f in ordered[1:] if f is not contact], key=lambda f: f["ground_px"])
        swing, passing = rest[0], rest[-1]
    return dict(stand=stand, contact=contact, passing=passing, swing=swing)


def main():
    sprites = split_sprites(os.path.join(ROOT, SOURCE))
    if len(sprites) < 8:
        raise SystemExit(f"{SOURCE} 只切出 {len(sprites)} 帧")

    mid = np.median([s["bbox"][1] for s in sprites])
    groups = {"top": [], "bottom": []}
    for s in sprites:
        m = measure(s["rgba"])
        item = {"norm": normalize(s["rgba"], m), "bbox": s["bbox"], **m}
        groups["top" if s["bbox"][1] < mid else "bottom"].append(item)
    for k in groups:
        groups[k].sort(key=lambda f: f["bbox"][0])

    right = classify(groups["top"])      # 上排朝右（马尾在左，脸朝右）
    left = classify(groups["bottom"])    # 下排朝左（马尾在右，脸朝左）

    def order(g):
        # 接触 → 经过 → 摆动，然后回到接触：一个完整迈步
        return [g["contact"], g["passing"], g["swing"]]

    cols = 1 + 3
    sheet = np.zeros((CELL_H * 2, CELL_W * cols, 4), np.uint8)
    for col, f in enumerate([right["stand"]] + order(right)):
        sheet[0:CELL_H, col * CELL_W:(col + 1) * CELL_W] = f["norm"]
    for col, f in enumerate([left["stand"]] + order(left)):
        sheet[CELL_H:CELL_H * 2, col * CELL_W:(col + 1) * CELL_W] = f["norm"]

    os.makedirs(os.path.join(ROOT, "assets"), exist_ok=True)
    png = os.path.join(ROOT, "assets", "hero.png")
    webp = os.path.join(ROOT, "assets", "hero.webp")
    cv2.imwrite(png, sheet)
    cv2.imwrite(webp, sheet, [cv2.IMWRITE_WEBP_QUALITY, 92])

    def show(tag, g):
        print(f"{tag}: 站立={g['stand']['bbox']} "
              f"接触={g['contact']['bbox']}(张开{g['contact']['spread']:.0f}) "
              f"经过={g['passing']['bbox']}(张开{g['passing']['spread']:.0f}, 着地{g['passing']['ground_px']}) "
              f"摆动={g['swing']['bbox']}(张开{g['swing']['spread']:.0f}, 着地{g['swing']['ground_px']})")

    show("朝右(下排)", right)
    show("朝左(上排)", left)
    print(f"精灵表 {sheet.shape[1]}x{sheet.shape[0]}  {cols} 列 × 2 行（列 0 站立，1..{cols - 1} 走路）")
    print(f"{png} {os.path.getsize(png)} B / {webp} {os.path.getsize(webp)} B")


if __name__ == "__main__":
    main()