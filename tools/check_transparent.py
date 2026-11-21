import os

import cv2
import numpy as np

out_dir = r"E:\mad\tools\ref\rig"
for p in [
    r"E:\mad\roles\SJY\img(1).png",
    r"E:\mad\roles\SJY\img(6).png",
    r"E:\mad\roles\SJY\img (6).png",
]:
    im = cv2.imread(p, cv2.IMREAD_UNCHANGED)
    if im is None:
        print(p, "MISSING")
        continue
    print(p, im.shape, "alpha0", round(float((im[:, :, 3] == 0).mean()), 3) if im.shape[2] == 4 else "no alpha")
    if im.shape[2] == 4:
        bg = np.zeros_like(im)
        bg[:, :, :3] = (255, 0, 255)
        bg[:, :, 3] = 255
        a = im[:, :, 3:4].astype(np.float32) / 255
        out = (im[:, :, :3].astype(np.float32) * a + bg[:, :, :3].astype(np.float32) * (1 - a)).astype(np.uint8)
        name = os.path.basename(p).replace(" ", "_").replace("(", "").replace(")", "")
        cv2.imwrite(os.path.join(out_dir, name + "_magenta.png"), out)
        ys, xs = np.nonzero(im[:, :, 3] > 0)
        print("   bbox", (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())))
