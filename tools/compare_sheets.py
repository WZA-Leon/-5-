import cv2
import numpy as np

old = cv2.imread(r"E:\mad\tools\ref\hero_old.png", cv2.IMREAD_UNCHANGED)
new = cv2.imread(r"E:\mad\assets\hero.png", cv2.IMREAD_UNCHANGED)


def over(im, color=(40, 40, 40)):
    bg = np.zeros_like(im)
    bg[:, :, :3] = color
    bg[:, :, 3] = 255
    a = im[:, :, 3:4].astype(np.float32) / 255
    return (im[:, :, :3].astype(np.float32) * a + bg[:, :, :3].astype(np.float32) * (1 - a)).astype(np.uint8)


# idle cell 0 top row
o = over(old[0:460, 0:240])
n = over(new[0:460, 0:240])
pair = np.hstack([o, np.full((460, 10, 3), 255, np.uint8), n])
cv2.putText(pair, "OLD", (8, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
cv2.putText(pair, "NEW", (258, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
pair = cv2.resize(pair, (pair.shape[1] * 2, pair.shape[0] * 2), interpolation=cv2.INTER_NEAREST)
cv2.imwrite(r"E:\mad\tools\ref\rig\idle_old_vs_new.png", pair)

# 整张表叠加深色底
full = np.hstack([over(old), np.full((920, 10, 3), 255, np.uint8), over(new)])
cv2.imwrite(r"E:\mad\tools\ref\rig\sheet_old_vs_new.png", full)
print("ok", pair.shape, full.shape)
