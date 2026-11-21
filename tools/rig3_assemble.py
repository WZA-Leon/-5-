"""用 3.png 的拆件拼一个站立骨架预览（先不走路）。

每个部件按整身比例单独缩放，再按关节锚点拼到一张 320x460 画布上。
"""
import os

import cv2
import numpy as np

SRC_DIR = os.path.join(r"E:\mad\tools\ref\rig\sheet3")
OUT = os.path.join(r"E:\mad\tools\ref\rig\rig3")
os.makedirs(OUT, exist_ok=True)

PARTS = {
    "head": "p01_x63_y462.png",
    "torso": "p02_x378_y474.png",
    "arm_l": "p03_x636_y483.png",
    "arm_r": "p04_x853_y483.png",
    "leg_l": "p05_x134_y741.png",
    "leg_r": "p06_x399_y744.png",
    "shoe_l": "p07_x614_y846.png",
    "shoe_r": "p08_x832_y846.png",
}

# 相对整身的缩放（部件本身偏大）
SCALE = {"head": 0.55, "torso": 0.95, "arm": 0.75, "leg": 0.58, "shoe": 0.57}

# 部件内部锚点（原始部件坐标）
ANCHOR = {
    "head_neck": (125, 190),
    "torso_collar": (68, 10),
    "torso_sleeve_l": (30, 82),
    "torso_sleeve_r": (108, 82),
    "torso_hip_l": (45, 175),
    "torso_hip_r": (95, 175),
    "arm_cuff": (30, 30),
    "leg_hip": (35, 12),
    "leg_ankle": (35, 165),
    "shoe_ankle": (55, 15),  # 鞋顶进到裤脚里面更多，裤脚盖住鞋口
}


def load(name):
    im = cv2.imread(os.path.join(SRC_DIR, PARTS[name]), cv2.IMREAD_UNCHANGED)
    if im is None:
        raise SystemExit("missing " + name)
    return im


def resize(im, s):
    return cv2.resize(im, (max(1, int(round(im.shape[1] * s))), max(1, int(round(im.shape[0] * s)))),
                      interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LANCZOS4)


def remove_stripe(im):
    """把红条纹用邻近裤子颜色补掉（只处理红色像素）。"""
    b, g, r = im[:, :, 0].astype(int), im[:, :, 1].astype(int), im[:, :, 2].astype(int)
    red = (r > 90) & (r > g + 40) & (r > b + 20) & (im[:, :, 3] > 0)
    if not red.any():
        return im
    mask = red.astype(np.uint8) * 255
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8))
    out = im.copy()
    out[mask > 0] = 0
    out[:, :, 3] = np.where(mask > 0, 0, im[:, :, 3])
    # 用 inpaint 填洞
    bgr = out[:, :, :3]
    filled = cv2.inpaint(bgr, (mask > 0).astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA)
    out[:, :, :3] = filled
    out[:, :, 3] = im[:, :, 3]
    return out


class Layer:
    def __init__(self, img, pivot, name=""):
        self.img = img
        self.pivot = pivot  # 部件内部坐标
        self.name = name


def place(canvas, layer, target_pivot, order=None):
    """把 layer 放到 canvas，使 pivot 对齐 target_pivot。"""
    x = int(round(target_pivot[0] - layer.pivot[0]))
    y = int(round(target_pivot[1] - layer.pivot[1]))
    h, w = layer.img.shape[:2]
    H, W = canvas.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    src = layer.img[y0 - y:y1 - y, x0 - x:x1 - x]
    dst = canvas[y0:y1, x0:x1]
    a = src[:, :, 3:4].astype(np.float32) / 255
    dst[:, :, :3] = (src[:, :, :3].astype(np.float32) * a +
                     dst[:, :, :3].astype(np.float32) * (1 - a)).astype(np.uint8)
    dst[:, :, 3] = np.maximum(dst[:, :, 3], src[:, :, 3])


def build_assembled():
    # 先拼在 400x600 的局部画布
    canvas = np.zeros((600, 400, 4), np.uint8)
    torso = Layer(resize(load("torso"), SCALE["torso"]),
                  (ANCHOR["torso_collar"][0] * SCALE["torso"], ANCHOR["torso_collar"][1] * SCALE["torso"]),
                  "torso")
    # 以躯干领口为原点放置：躯干领口放在 (200, 200)
    origin = (200, 200)
    t_tl = (origin[0] - torso.pivot[0], origin[1] - torso.pivot[1])

    def tpoint(p):
        return (t_tl[0] + p[0] * SCALE["torso"], t_tl[1] + p[1] * SCALE["torso"])

    hip_l = tpoint(ANCHOR["torso_hip_l"])
    hip_r = tpoint(ANCHOR["torso_hip_r"])
    sleeve_l = tpoint(ANCHOR["torso_sleeve_l"])
    sleeve_r = tpoint(ANCHOR["torso_sleeve_r"])

    head = Layer(resize(load("head"), SCALE["head"]),
                 (ANCHOR["head_neck"][0] * SCALE["head"], ANCHOR["head_neck"][1] * SCALE["head"]), "head")
    arm_l = Layer(resize(load("arm_l"), SCALE["arm"]),
                  (ANCHOR["arm_cuff"][0] * SCALE["arm"], ANCHOR["arm_cuff"][1] * SCALE["arm"]), "arm_l")
    arm_r = Layer(resize(load("arm_r"), SCALE["arm"]),
                  (ANCHOR["arm_cuff"][0] * SCALE["arm"], ANCHOR["arm_cuff"][1] * SCALE["arm"]), "arm_r")
    leg_l = Layer(resize(remove_stripe(load("leg_l")), SCALE["leg"]),
                  (ANCHOR["leg_hip"][0] * SCALE["leg"], ANCHOR["leg_hip"][1] * SCALE["leg"]), "leg_l")
    leg_r_img = cv2.flip(load("leg_r"), 1)
    w_r = leg_r_img.shape[1]
    leg_r = Layer(resize(remove_stripe(leg_r_img), SCALE["leg"]),
                  ((w_r - ANCHOR["leg_hip"][0]) * SCALE["leg"], ANCHOR["leg_hip"][1] * SCALE["leg"]), "leg_r")
    shoe_img = cv2.flip(load("shoe_l"), 1)
    sw = shoe_img.shape[1]
    shoe = Layer(resize(shoe_img, SCALE["shoe"]),
                 ((sw - ANCHOR["shoe_ankle"][0]) * SCALE["shoe"], ANCHOR["shoe_ankle"][1] * SCALE["shoe"]), "shoe")

    ankle_l = (hip_l[0], hip_l[1] + (ANCHOR["leg_ankle"][1] - ANCHOR["leg_hip"][1]) * SCALE["leg"])
    ankle_r = (hip_r[0], hip_r[1] + (ANCHOR["leg_ankle"][1] - ANCHOR["leg_hip"][1]) * SCALE["leg"])

    # 顺序：远臂 → 远腿 → 远鞋 → 近腿 → 近鞋 → 头 → 躯干 → 近臂
    place(canvas, arm_l, sleeve_l)
    place(canvas, leg_l, hip_l)
    place(canvas, shoe, ankle_l)
    place(canvas, leg_r, hip_r)
    place(canvas, shoe, ankle_r)
    place(canvas, head, origin)
    place(canvas, torso, origin)
    place(canvas, arm_r, sleeve_r)

    # 裁出内容 bbox
    a = canvas[:, :, 3]
    ys, xs = np.nonzero(a > 0)
    crop = canvas[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return crop


def main():
    body = build_assembled()
    cv2.imwrite(os.path.join(OUT, "assembled_raw.png"), body)
    print("assembled", body.shape)
    # 缩放到游戏里的身高 408，脚底 452，中心 160
    h, w = body.shape[:2]
    s = 408 / h
    new_w, new_h = int(round(w * s)), 408
    scaled = cv2.resize(body, (new_w, new_h), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((460, 320, 4), np.uint8)
    x = 160 - new_w // 2
    y = 452 - new_h
    canvas[y:y + new_h, x:x + new_w] = scaled
    cv2.imwrite(os.path.join(OUT, "idle_320.png"), canvas)
    # 白底预览
    bg = np.full((460, 320, 3), 245, np.uint8)
    a = canvas[:, :, 3:4].astype(np.float32) / 255
    prev = (canvas[:, :, :3].astype(np.float32) * a + bg.astype(np.float32) * (1 - a)).astype(np.uint8)
    cv2.imwrite(os.path.join(OUT, "idle_preview.png"), prev)
    print("saved", os.path.join(OUT, "idle_preview.png"))


if __name__ == "__main__":
    main()
