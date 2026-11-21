"""用 3.png 拆件做 16 帧走路循环预览。

骨架在 400x600 局部画布上组装；双腿绕髋、双臂绕袖口旋转，鞋保持水平并跟着脚踝走。
"""
import math
import os

import cv2
import numpy as np

from rig3_assemble import (ANCHOR, PARTS, SRC_DIR, Layer, load, place, remove_stripe,
                           resize)

OUT = os.path.join(r"E:\mad\tools\ref\rig\rig3")
os.makedirs(OUT, exist_ok=True)
W, H = 400, 600

# C 版比例：把腿拉长、躯干收窄，往现在 hero 的比例靠
SCALE = {"head": 0.64, "torso": 0.66, "arm": 0.52, "shoe": 0.60}
LEG_SX, LEG_SY = 0.52, 0.84

# 鞋位置微调（局部像素；正数 = 右/下，负数 = 左/上）
SHOE_L_DX = 0.0
SHOE_L_DY = 0.0
SHOE_R_DX = 0.0
SHOE_R_DY = 0.0


def resize_xy(im, sx, sy):
    return cv2.resize(im, (max(1, int(round(im.shape[1] * sx))), max(1, int(round(im.shape[0] * sy)))),
                      interpolation=cv2.INTER_AREA if sx < 1 else cv2.INTER_LANCZOS4)


def make_layers():
    # 3.png 里的头和躯干本来就是朝右的（和旧 hero 同向），不要再镜像
    torso = Layer(resize(load("torso"), SCALE["torso"]),
                  (ANCHOR["torso_collar"][0] * SCALE["torso"], ANCHOR["torso_collar"][1] * SCALE["torso"]))
    head = Layer(resize(load("head"), SCALE["head"]),
                 (ANCHOR["head_neck"][0] * SCALE["head"], ANCHOR["head_neck"][1] * SCALE["head"]))
    arm_l = Layer(resize(load("arm_l"), SCALE["arm"]),
                  (ANCHOR["arm_cuff"][0] * SCALE["arm"], ANCHOR["arm_cuff"][1] * SCALE["arm"]))
    arm_r = Layer(resize(load("arm_r"), SCALE["arm"]),
                  (ANCHOR["arm_cuff"][0] * SCALE["arm"], ANCHOR["arm_cuff"][1] * SCALE["arm"]))
    leg_l = Layer(resize_xy(remove_stripe(load("leg_l")), LEG_SX, LEG_SY),  # 内侧（左）腿去掉条纹
                  (ANCHOR["leg_hip"][0] * LEG_SX, ANCHOR["leg_hip"][1] * LEG_SY))
    leg_r_img = cv2.flip(load("leg_r"), 1)
    w_r = leg_r_img.shape[1]
    leg_r = Layer(resize_xy(leg_r_img, LEG_SX, LEG_SY),                    # 外侧（右）腿保留条纹
                  ((w_r - ANCHOR["leg_hip"][0]) * LEG_SX, ANCHOR["leg_hip"][1] * LEG_SY))
    # p07 原图朝左，需要翻；p08 原图本来就朝右，不要再翻
    shoe_l_img = cv2.flip(load("shoe_l"), 1)
    sw_l = shoe_l_img.shape[1]
    shoe_l = Layer(resize(shoe_l_img, SCALE["shoe"]),
                   ((sw_l - ANCHOR["shoe_ankle"][0]) * SCALE["shoe"], ANCHOR["shoe_ankle"][1] * SCALE["shoe"]))
    shoe_r_img = cv2.flip(load("shoe_r"), 1)
    sw_r = shoe_r_img.shape[1]
    shoe_r = Layer(resize(shoe_r_img, SCALE["shoe"]),
                   ((sw_r - ANCHOR["shoe_ankle"][0]) * SCALE["shoe"], ANCHOR["shoe_ankle"][1] * SCALE["shoe"]))
    return dict(torso=torso, head=head, arm_l=arm_l, arm_r=arm_r, leg_l=leg_l, leg_r=leg_r,
                shoe_l=shoe_l, shoe_r=shoe_r)


def anchors(layers):
    t = layers["torso"]
    origin = (200, 200)  # 领口位置
    t_tl = (origin[0] - t.pivot[0], origin[1] - t.pivot[1])

    def tp(p):
        return (t_tl[0] + p[0] * SCALE["torso"], t_tl[1] + p[1] * SCALE["torso"])

    hip_l = tp(ANCHOR["torso_hip_l"])
    hip_r = tp(ANCHOR["torso_hip_r"])
    sleeve_l = tp(ANCHOR["torso_sleeve_l"])
    sleeve_r = tp(ANCHOR["torso_sleeve_r"])
    ankle_dy = (ANCHOR["leg_ankle"][1] - ANCHOR["leg_hip"][1]) * LEG_SY
    return dict(
        origin=origin, torso_tl=t_tl,
        head=(origin[0], origin[1] + 10),
        arm_l=(sleeve_l[0] - 4, sleeve_l[1]),
        arm_r=(sleeve_r[0] + 3, sleeve_r[1]),
        hip_l=hip_l, hip_r=hip_r, ankle_dy=ankle_dy,
    )


def blank():
    return np.zeros((H, W, 4), np.uint8)


def draw(canvas, layer, target, angle=0.0):
    tmp = blank()
    place(tmp, layer, target)
    if abs(angle) > 1e-6:
        M = cv2.getRotationMatrix2D((float(target[0]), float(target[1])), angle, 1.0)
        tmp = cv2.warpAffine(tmp, M, (W, H), flags=cv2.INTER_LINEAR,
                             borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    a = tmp[:, :, 3:4].astype(np.float32) / 255.0
    canvas[:, :, :3] = (tmp[:, :, :3].astype(np.float32) * a +
                        canvas[:, :, :3].astype(np.float32) * (1 - a)).astype(np.uint8)
    canvas[:, :, 3] = np.maximum(canvas[:, :, 3], tmp[:, :, 3])


def rotate_point(p, c, deg):
    r = math.radians(deg)
    x, y = p[0] - c[0], p[1] - c[1]
    return (c[0] + x * math.cos(r) - y * math.sin(r),
            c[1] + x * math.sin(r) + y * math.cos(r))


def over(bg, fg):
    a = fg[:, :, 3:4].astype(np.float32) / 255.0
    out = bg.copy()
    out[:, :, :3] = (fg[:, :, :3].astype(np.float32) * a +
                     bg[:, :, :3].astype(np.float32) * (1 - a)).astype(np.uint8)
    out[:, :, 3] = np.maximum(bg[:, :, 3], fg[:, :, 3])
    return out


def _leg_angles(phase, amp_leg):
    leg_angle = amp_leg * math.sin(phase)
    return -leg_angle, leg_angle


def render_legs(phase, amp_leg=26.0):
    L = make_layers()
    A = anchors(L)
    l_angle, r_angle = _leg_angles(phase, amp_leg)
    ankle_l = rotate_point((A["hip_l"][0], A["hip_l"][1] + A["ankle_dy"]), A["hip_l"], l_angle)
    ankle_r = rotate_point((A["hip_r"][0], A["hip_r"][1] + A["ankle_dy"]), A["hip_r"], r_angle)
    canvas = blank()
    # 鞋和裤腿画在同一层、同一个脚踝位置；裤腿后画，裤脚盖住鞋口
    draw(canvas, L["shoe_l"], (ankle_l[0] + SHOE_L_DX, ankle_l[1] + SHOE_L_DY), 0.0)
    draw(canvas, L["leg_l"], A["hip_l"], l_angle)
    draw(canvas, L["shoe_r"], (ankle_r[0] + SHOE_R_DX, ankle_r[1] + SHOE_R_DY), 0.0)
    draw(canvas, L["leg_r"], A["hip_r"], r_angle)
    return canvas


def render_shoe(side, phase, amp_leg=26.0):
    L = make_layers()
    A = anchors(L)
    l_angle, r_angle = _leg_angles(phase, amp_leg)
    canvas = blank()
    if side == "l":
        ankle = rotate_point((A["hip_l"][0], A["hip_l"][1] + A["ankle_dy"]), A["hip_l"], l_angle)
        draw(canvas, L["shoe_l"], ankle, 0.0)
    else:
        ankle = rotate_point((A["hip_r"][0], A["hip_r"][1] + A["ankle_dy"]), A["hip_r"], r_angle)
        draw(canvas, L["shoe_r"], ankle, 0.0)
    return canvas


def render_torso():
    L = make_layers()
    A = anchors(L)
    canvas = blank()
    draw(canvas, L["torso"], A["origin"], 0.0)
    draw(canvas, L["head"], A["head"], 0.0)
    return canvas


def render_body(phase, amp_leg=26.0):
    return over(render_legs(phase, amp_leg), render_torso())


def render_arms(phase, amp_arm=12.0, which="both"):
    L = make_layers()
    A = anchors(L)
    canvas = blank()
    arm_up = 6.0  # 两只手整体上移
    if which in ("both", "far"):
        draw(canvas, L["arm_l"], (A["arm_l"][0], A["arm_l"][1] - arm_up),
             amp_arm * math.sin(phase))
    if which in ("both", "near"):
        draw(canvas, L["arm_r"], (A["arm_r"][0], A["arm_r"][1] - arm_up),
             -amp_arm * math.sin(phase))
    return canvas


def render(phase, amp_leg=26.0, amp_arm=12.0):
    legs = render_legs(phase, amp_leg)
    torso = render_torso()
    far = render_arms(phase, amp_arm, "far")
    near = render_arms(phase, amp_arm, "near")
    return over(over(over(legs, far), torso), near)


def idle_metrics():
    c = render(0.0, amp_leg=0.0, amp_arm=0.0)
    ys, xs = np.nonzero(c[:, :, 3] > 0)
    return c, (xs.min(), ys.min(), xs.max(), ys.max())


def to_final(local, metrics, ground_y=452, body_h=408):
    x0, y0, x1, y1 = metrics
    h = y1 - y0 + 1
    s = body_h / h
    # 用固定窗口裁切：走路时腿/鞋会摆出站立 bbox，必须留足两侧空间，
    # 否则鞋尖会被裁掉（游戏里看起来像鞋和腿断开）。
    wx0, wx1 = 70, 330
    wy0, wy1 = 80, 465
    nw = int(round((wx1 - wx0 + 1) * s))
    nh = int(round((wy1 - wy0 + 1) * s))
    crop = local[wy0:wy1 + 1, wx0:wx1 + 1]
    scaled = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)
    out = np.zeros((460, 320, 4), np.uint8)
    x = 160 - nw // 2
    y = ground_y - nh
    out[y:y + nh, x:x + nw] = scaled
    return out


def main():
    idle, metrics = idle_metrics()
    cv2.imwrite(os.path.join(OUT, "idle_local.png"), idle)
    idle_final = to_final(idle, metrics)
    cv2.imwrite(os.path.join(OUT, "idle_final.png"), idle_final)

    N = 16
    frames = []
    for i in range(N):
        p = 2 * math.pi * i / N
        body = to_final(render_body(p), metrics)   # 腿+鞋+躯干+头
        far = to_final(render_arms(p, which="far"), metrics)
        near = to_final(render_arms(p, which="near"), metrics)
        # 脚底贴地：用身体最低点，整帧上下移动
        bottom = int(np.nonzero(body[:, :, 3] > 0)[0].max())
        dy = 452 - bottom
        if dy:
            M = np.float32([[1, 0, 0], [0, 1, dy]])
            for part in (body, far, near):
                part[:] = cv2.warpAffine(part, M, (320, 460), flags=cv2.INTER_LINEAR,
                                         borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        cv2.imwrite(os.path.join(OUT, f"walk_{i:02d}_body.png"), body)
        cv2.imwrite(os.path.join(OUT, f"walk_{i:02d}_armfar.png"), far)
        cv2.imwrite(os.path.join(OUT, f"walk_{i:02d}_armnear.png"), near)
        # v16 预览：远侧手 → 身体 → 近侧手
        frames.append(over(over(far, body), near))

    # 拼图预览
    strip = np.hstack([cv2.resize(f, (160, 230), interpolation=cv2.INTER_AREA) for f in frames])
    bg = np.full_like(strip[:, :, :3], 245)
    a = strip[:, :, 3:4].astype(np.float32) / 255
    prev = (strip[:, :, :3].astype(np.float32) * a + bg.astype(np.float32) * (1 - a)).astype(np.uint8)
    cv2.imwrite(os.path.join(OUT, "walk_strip.png"), prev)
    print("saved strip", prev.shape)

    # 每帧单独保存，方便检查
    for i, f in enumerate(frames):
        cv2.imwrite(os.path.join(OUT, f"walk_{i:02d}.png"), f)


if __name__ == "__main__":
    main()
