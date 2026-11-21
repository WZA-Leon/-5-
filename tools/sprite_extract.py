"""从参考图切出小人：只移除与画布边缘连通的白底，保留衣服/鞋子的白色。"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def background_mask(img_bgr, sat_max=30, val_min=190, trim=2):
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    near_white = ((hsv[:, :, 1] < sat_max) & (hsv[:, :, 2] > val_min)).astype(np.uint8)
    num, labels = cv2.connectedComponents(near_white, 4)
    border = set(np.unique(labels[0, :])) | set(np.unique(labels[-1, :]))
    border |= set(np.unique(labels[:, 0])) | set(np.unique(labels[:, -1]))
    border.discard(0)
    bg = np.isin(labels, list(border)).astype(np.uint8)
    if trim:
        # 去掉人物边缘残留的浅灰描边：只清理贴着背景、低饱和高亮度的像素
        for _ in range(trim):
            near_bg = cv2.dilate(bg, np.ones((3, 3), np.uint8)) > 0
            light = (hsv[:, :, 1] < 45) & (hsv[:, :, 2] > 140)
            bg |= (near_bg & light).astype(np.uint8)
    return bg.astype(bool)


def split_sprites(path, min_area=6000):
    img = cv2.imread(path)
    if img is None:
        return []
    h, w = img.shape[:2]
    bg = background_mask(img)
    mask = (~bg).astype(np.uint8)
    # 去掉背景边缘的孤立噪点，但不要太多形态学，避免白衬衫破洞
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    out = []
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if area < min_area or hh < 150 or ww < 40 or hh / max(ww, 1) < 1.2:
            continue
        m = (labels[y:y + hh, x:x + ww] == i).astype(np.uint8)
        crop = img[y:y + hh, x:x + ww]
        rgba = cv2.cvtColor(crop, cv2.COLOR_BGR2BGRA)
        rgba[:, :, 3] = m * 255
        rgba[m == 0] = 0
        out.append({"bbox": (int(x), int(y), int(x + ww - 1), int(y + hh - 1)), "rgba": rgba})
    out.sort(key=lambda s: (s["bbox"][1] // 200, s["bbox"][0]))
    return out


def demo():
    src = r"E:\mad\roles\SJY\img (1).png"
    sprites = split_sprites(src)
    print("sprites", len(sprites))
    for i, s in enumerate(sprites):
        im = s["rgba"]
        bg = np.zeros_like(im)
        bg[:, :, :3] = (255, 0, 255)
        bg[:, :, 3] = 255
        a = im[:, :, 3:4].astype(np.float32) / 255
        out = (im[:, :, :3].astype(np.float32) * a + bg[:, :, :3].astype(np.float32) * (1 - a)).astype(np.uint8)
        cv2.imwrite(rf"E:\mad\tools\ref\rig\split_{i}_magenta.png", out)


if __name__ == "__main__":
    demo()
