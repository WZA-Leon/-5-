'use strict';
/* ==========================================================================
   仿射变换：对齐 cv2.getRotationMatrix2D + cv2.warpAffine（默认边界常量 0）。
   坐标约定与 OpenCV 相同：整数坐标落在像素中心，双线性采样。
   ========================================================================== */

function getRotationMatrix2D(cx, cy, angleDeg, scale = 1) {
  const a = (angleDeg * Math.PI) / 180;
  const alpha = Math.cos(a) * scale;
  const beta = Math.sin(a) * scale;
  return [
    alpha,
    beta,
    (1 - alpha) * cx - beta * cy,
    -beta,
    alpha,
    beta * cx + (1 - alpha) * cy,
  ];
}

function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0];
  return [e / det, -b / det, (b * f - c * e) / det, -d / det, a / det, (c * d - a * f) / det];
}

/**
 * @param {Image} img
 * @param {number[]} m 2x3 仿射矩阵（源 → 目标）
 * @param {number} outW
 * @param {number} outH
 * @param {number[]} border [r,g,b,a]
 */
function warpAffine(img, m, outW, outH, border = [0, 0, 0, 0]) {
  const { Image, pyRound } = require('./image');
  const out = new Image(outW, outH);
  const inv = invert(m);
  const [a, b, c, d, e, f] = inv;
  const { width: sw, height: sh, data: sd } = img;
  const od = out.data;

  for (let y = 0; y < outH; y++) {
    const yc = y + 0.5;
    for (let x = 0; x < outW; x++) {
      const xc = x + 0.5;
      const fx = a * xc + b * yc + c - 0.5;
      const fy = d * xc + e * yc + f - 0.5;
      const o = (y * outW + x) * 4;
      if (fx < -0.5 || fy < -0.5 || fx > sw - 0.5 || fy > sh - 0.5) {
        od[o] = border[0];
        od[o + 1] = border[1];
        od[o + 2] = border[2];
        od[o + 3] = border[3];
        continue;
      }
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const x1 = Math.min(sw - 1, Math.max(0, x0 + 1));
      const y1 = Math.min(sh - 1, Math.max(0, y0 + 1));
      const xa = Math.min(sw - 1, Math.max(0, x0));
      const ya = Math.min(sh - 1, Math.max(0, y0));

      const i00 = (ya * sw + xa) * 4;
      const i01 = (ya * sw + x1) * 4;
      const i10 = (y1 * sw + xa) * 4;
      const i11 = (y1 * sw + x1) * 4;
      for (let k = 0; k < 4; k++) {
        const top = sd[i00 + k] + (sd[i01 + k] - sd[i00 + k]) * tx;
        const bot = sd[i10 + k] + (sd[i11 + k] - sd[i10 + k]) * tx;
        const v = pyRound(top + (bot - top) * ty);
        od[o + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return out;
}

module.exports = { getRotationMatrix2D, warpAffine };