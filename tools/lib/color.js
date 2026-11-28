'use strict';
/* ==========================================================================
   颜色空间转换，取值范围与 OpenCV 对齐：
     · HSV：H 0..179，S/V 0..255
     · YCrCb：Y / Cr / Cb 均 0..255（用于 cv2.inRange 的肤色阈值）
     · gray：0.299R + 0.587G + 0.114B
   ========================================================================== */

function rgb2gray(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b + 0.5) | 0;
}

function rgb2hsv(r, g, b) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  // OpenCV 的 H 是 0..180（角度 / 2）
  return [Math.round(h / 2) % 180, Math.round(s * 255), Math.round(max * 255)];
}

function rgb2ycbcr(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cr = (r - y) * 0.713 + 128;
  const cb = (b - y) * 0.564 + 128;
  const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  return [clamp8(y), clamp8(cr), clamp8(cb)];
}

module.exports = { rgb2gray, rgb2hsv, rgb2ycbcr };