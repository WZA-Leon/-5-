'use strict';
/* ==========================================================================
   图像修补：TELEA（Fast Marching）风格的洞填充，对齐 cv2.inpaint(..., TELEA)。
   · 距离场：从已知像素向内做 BFS，得到到边界的距离
   · 按距离由外向内填充，用已知邻居做距离加权平均
   只修改 RGB，alpha 保持不变（调用方负责保留 alpha）。
   ========================================================================== */

function inpaintTelea(img, mask, radius = 3) {
  const { width: w, height: h } = img;
  const out = img.clone();
  const hole = new Uint8Array(w * h);
  let holes = 0;
  for (let i = 0; i < hole.length; i++) {
    hole[i] = mask[i] ? 1 : 0;
    if (hole[i]) holes++;
  }
  if (!holes) return out;

  // 距离场：已知像素 = 0，洞内 = 到最近已知像素的 4 邻域步数
  const dist = new Float32Array(w * h).fill(Infinity);
  const queue = new Int32Array(w * h);
  let qh = 0;
  let qt = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (hole[i]) continue;
      let boundary = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && hole[ny * w + nx]) {
          boundary = true;
          break;
        }
      }
      if (boundary) {
        dist[i] = 1;
        queue[qt++] = i;
      }
    }
  }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!hole[j] || dist[j] !== Infinity) continue;
      dist[j] = dist[i] + 1;
      queue[qt++] = j;
    }
  }

  // 洞内按距离升序填充
  const order = [];
  for (let i = 0; i < hole.length; i++) if (hole[i]) order.push(i);
  order.sort((a, b) => dist[a] - dist[b]);

  const known = new Uint8Array(w * h);
  for (let i = 0; i < known.length; i++) known[i] = hole[i] ? 0 : 1;

  for (const i of order) {
    const x = i % w;
    const y = (i / w) | 0;
    const d0 = dist[i];
    let sr = 0, sg = 0, sb = 0, sw = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!known[j]) continue;
        const d2 = dx * dx + dy * dy;
        const dj = dist[j];
        const wgt = 1 / (1 + d2) / (1 + dj * dj) / (1 + Math.abs(d0 - dj));
        const o = j * 4;
        sr += out.data[o] * wgt;
        sg += out.data[o + 1] * wgt;
        sb += out.data[o + 2] * wgt;
        sw += wgt;
      }
    }
    if (sw > 0) {
      const o = i * 4;
      out.data[o] = Math.round(sr / sw);
      out.data[o + 1] = Math.round(sg / sw);
      out.data[o + 2] = Math.round(sb / sw);
    }
    known[i] = 1;
  }
  return out;
}

module.exports = { inpaintTelea };