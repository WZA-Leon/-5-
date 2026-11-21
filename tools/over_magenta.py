import sys

import cv2
import numpy as np

src = sys.argv[1]
dst = sys.argv[2]
im = cv2.imread(src, cv2.IMREAD_UNCHANGED)
bg = np.zeros_like(im)
bg[:, :, :3] = (255, 0, 255)
bg[:, :, 3] = 255
a = im[:, :, 3:4].astype(np.float32) / 255
out = (im[:, :, :3].astype(np.float32) * a + bg[:, :, :3].astype(np.float32) * (1 - a)).astype(np.uint8)
cv2.imwrite(dst, out)
print("ok", im.shape)
