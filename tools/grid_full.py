import sys

import cv2

src = sys.argv[1]
dst = sys.argv[2]
scale = int(sys.argv[3]) if len(sys.argv) > 3 else 2

img = cv2.imread(src, cv2.IMREAD_UNCHANGED)
h, w = img.shape[:2]
big = cv2.resize(img, (w * scale, h * scale), interpolation=cv2.INTER_NEAREST)
for x in range(0, w, 10):
    px = x * scale
    c = (0, 0, 255) if x % 50 == 0 else (170, 170, 170)
    cv2.line(big, (px, 0), (px, h * scale), c, 1)
    if x % 50 == 0:
        cv2.putText(big, str(x), (px + 2, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
for y in range(0, h, 10):
    py = y * scale
    c = (0, 0, 255) if y % 50 == 0 else (170, 170, 170)
    cv2.line(big, (0, py), (w * scale, py), c, 1)
    if y % 50 == 0:
        cv2.putText(big, str(y), (2, py + 12), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
cv2.imwrite(dst, big)
print("saved", dst, big.shape)
