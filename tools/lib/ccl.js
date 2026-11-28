'use strict';
/* ==========================================================================
   连通域标记（对齐 cv2.connectedComponents / connectedComponentsWithStats）。
   输入为二值掩码（Uint8Array，非 0 视为前景），输出：
     count   —— 前景连通域数量（不含背景）
     labels  —— Int32Array(w*h)，0 = 背景，1..count = 连通域
     stats   —— [{x, y, w, h, area}]，按标签顺序
     centroids —— [{x, y}]，按标签顺序
   ========================================================================== */

class UnionFind {
  constructor(n) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(a) {
    let p = this.parent;
    while (p[a] !== a) {
      p[a] = p[p[a]];
      a = p[a];
    }
    return a;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

function connectedComponents(mask, width, height, connectivity = 8) {
  const labels = new Int32Array(width * height);
  const uf = new UnionFind(width * height + 1);
  let next = 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const neigh = [];
      if (x > 0 && mask[i - 1]) neigh.push(labels[i - 1]);
      if (y > 0) {
        if (mask[i - width]) neigh.push(labels[i - width]);
        if (connectivity === 8) {
          if (x > 0 && mask[i - width - 1]) neigh.push(labels[i - width - 1]);
          if (x < width - 1 && mask[i - width + 1]) neigh.push(labels[i - width + 1]);
        }
      }
      const valid = neigh.filter((l) => l > 0);
      if (valid.length === 0) {
        labels[i] = next++;
      } else {
        let min = valid[0];
        for (const l of valid) if (l < min) min = l;
        labels[i] = min;
        for (const l of valid) if (l !== min) uf.union(min, l);
      }
    }
  }

  // 压缩标签
  const remap = new Int32Array(next);
  let count = 0;
  for (let l = 1; l < next; l++) {
    const root = uf.find(l);
    if (root === l) {
      remap[l] = ++count;
    }
  }
  for (let l = 1; l < next; l++) remap[l] = remap[uf.find(l)];

  const stats = new Array(count);
  const minX = new Int32Array(count).fill(width);
  const minY = new Int32Array(count).fill(height);
  const maxX = new Int32Array(count).fill(-1);
  const maxY = new Int32Array(count).fill(-1);
  const areas = new Int32Array(count);
  const sumX = new Float64Array(count);
  const sumY = new Float64Array(count);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const l = remap[labels[i]];
      labels[i] = l;
      const k = l - 1;
      if (x < minX[k]) minX[k] = x;
      if (x > maxX[k]) maxX[k] = x;
      if (y < minY[k]) minY[k] = y;
      if (y > maxY[k]) maxY[k] = y;
      areas[k]++;
      sumX[k] += x;
      sumY[k] += y;
    }
  }

  for (let k = 0; k < count; k++) {
    stats[k] = {
      x: minX[k],
      y: minY[k],
      w: maxX[k] - minX[k] + 1,
      h: maxY[k] - minY[k] + 1,
      area: areas[k],
    };
  }

  const centroids = stats.map((s, k) => ({
    x: s.area ? sumX[k] / s.area : 0,
    y: s.area ? sumY[k] / s.area : 0,
  }));

  return { count, labels, stats, centroids };
}

/** 从 RGBA 图 + 判定函数生成二值掩码 */
function maskFromImage(img, predicate) {
  const { width, height, data } = img;
  const mask = new Uint8Array(width * height);
  for (let i = 0, o = 0; i < mask.length; i++, o += 4) {
    mask[i] = predicate(data[o], data[o + 1], data[o + 2], data[o + 3]) ? 1 : 0;
  }
  return mask;
}

module.exports = { connectedComponents, maskFromImage };