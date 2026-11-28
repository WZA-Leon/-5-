'use strict';
/* ==========================================================================
   二值形态学（矩形结构元，可分离实现）：
     dilate / erode / open / close，对齐 cv2.morphologyEx + np.ones((k,k))
   掩码取值 0/1（或 0/255，输出统一为 0/1 或原值二值化）。
   ========================================================================== */

function toBinary(mask) {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 1 : 0;
  return out;
}

function dilate(mask, width, height, k = 3) {
  const src = toBinary(mask);
  // OpenCV: dst(x) = max over o of src(x + o)，o ∈ [lo, hi]。
  // 逐源像素写目标时要取镜像偏移：dst 落在 [x - hi, x - lo]。
  const lo = -(k >> 1);
  const hi = k - 1 - (k >> 1);
  const tlo = -hi;
  const thi = -lo;
  const tmp = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!src[y * width + x]) continue;
      const x0 = Math.max(0, x + tlo);
      const x1 = Math.min(width - 1, x + thi);
      for (let xx = x0; xx <= x1; xx++) tmp[y * width + xx] = 1;
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!tmp[y * width + x]) continue;
      const y0 = Math.max(0, y + tlo);
      const y1 = Math.min(height - 1, y + thi);
      for (let yy = y0; yy <= y1; yy++) out[yy * width + x] = 1;
    }
  }
  return out;
}

function erode(mask, width, height, k = 3) {
  const src = toBinary(mask);
  // 直接求邻域最小值。OpenCV 腐蚀的边界值为 +∞，即越界邻居不参与判定；
  // 不能用「补集膨胀」代替——偶数核是不对称的，取反后需要镜像核。
  const lo = -(k >> 1);
  const hi = k - 1 - (k >> 1);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = 1;
      for (let oy = lo; oy <= hi && keep; oy++) {
        const ny = y + oy;
        if (ny < 0 || ny >= height) continue;
        for (let ox = lo; ox <= hi; ox++) {
          const nx = x + ox;
          if (nx < 0 || nx >= width) continue;
          if (!src[ny * width + nx]) {
            keep = 0;
            break;
          }
        }
      }
      out[y * width + x] = keep;
    }
  }
  return out;
}

function open(mask, width, height, k = 3) {
  return dilate(erode(mask, width, height, k), width, height, k);
}

function close(mask, width, height, k = 3) {
  return erode(dilate(mask, width, height, k), width, height, k);
}

module.exports = { dilate, erode, open, close };