'use strict';
/* ==========================================================================
   稠密光流与重采样。
   calcOpticalFlowFarneback 是「金字塔块匹配」近似实现（原脚本里 flow_morph
   仅作为未被调用的插值工具保留），用于把两张规范帧做中间帧变形。
   ========================================================================== */

const { Image, pyRound } = require('./image');

function grayOf(img) {
  const { width: w, height: h, data } = img;
  const g = new Float32Array(w * h);
  for (let i = 0, o = 0; i < g.length; i++, o += 4) {
    g[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  return g;
}

function blur5(src, w, h) {
  const kernel = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        s += src[y * w + xx] * kernel[k + 2];
      }
      tmp[y * w + x] = s / 16;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        s += tmp[yy * w + x] * kernel[k + 2];
      }
      out[y * w + x] = s / 16;
    }
  }
  return out;
}

function downsample(src, w, h) {
  const nw = Math.max(1, Math.ceil(w / 2));
  const nh = Math.max(1, Math.ceil(h / 2));
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const x0 = Math.min(w - 1, x * 2);
      const x1 = Math.min(w - 1, x * 2 + 1);
      const y0 = Math.min(h - 1, y * 2);
      const y1 = Math.min(h - 1, y * 2 + 1);
      out[y * nw + x] = (src[y0 * w + x0] + src[y0 * w + x1] + src[y1 * w + x0] + src[y1 * w + x1]) / 4;
    }
  }
  return { data: out, w: nw, h: nh };
}

function sample(g, w, h, x, y) {
  const x0 = Math.min(w - 1, Math.max(0, Math.floor(x)));
  const y0 = Math.min(h - 1, Math.max(0, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = g[y0 * w + x0] * (1 - tx) + g[y0 * w + x1] * tx;
  const bot = g[y1 * w + x0] * (1 - tx) + g[y1 * w + x1] * tx;
  return top * (1 - ty) + bot * ty;
}

function upsampleFlow(flow, w, h, nw, nh) {
  const out = new Float32Array(nw * nh * 2);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, x * (w / nw));
      const sy = Math.min(h - 1, y * (h / nh));
      const s = ((sy | 0) * w + (sx | 0)) * 2;
      const o = (y * nw + x) * 2;
      out[o] = flow[s] * (nw / w);
      out[o + 1] = flow[s + 1] * (nh / h);
    }
  }
  return out;
}

/** 返回 { u, v, width, height }：B 相对 A 的位移（B(p+d) ≈ A(p)） */
function calcOpticalFlowFarneback(grayA, grayB, width, height, opts = {}) {
  const levels = Math.max(1, opts.levels || 4);
  const win = opts.window || 5;
  const search = opts.search || 3;
  const iterations = Math.max(1, opts.iterations || 2);

  const pyrA = [{ data: grayA, w: width, h: height }];
  const pyrB = [{ data: grayB, w: width, h: height }];
  for (let l = 1; l < levels; l++) {
    const pa = pyrA[l - 1];
    const pb = pyrB[l - 1];
    pyrA.push(downsample(blur5(pa.data, pa.w, pa.h), pa.w, pa.h));
    pyrB.push(downsample(blur5(pb.data, pb.w, pb.h), pb.w, pb.h));
  }

  let flow = null;
  let fw = 0;
  let fh = 0;

  for (let l = levels - 1; l >= 0; l--) {
    const A = pyrA[l];
    const B = pyrB[l];
    const w = A.w;
    const h = A.h;
    let cur;
    if (!flow) {
      cur = new Float32Array(w * h * 2);
    } else {
      cur = upsampleFlow(flow, fw, fh, w, h);
    }
    fw = w;
    fh = h;

    for (let it = 0; it < iterations; it++) {
      const next = new Float32Array(w * h * 2);
      const r = win >> 1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 2;
          const du0 = Math.round(cur[o]);
          const dv0 = Math.round(cur[o + 1]);
          let best = Infinity;
          let bu = du0;
          let bv = dv0;
          for (let dv = dv0 - search; dv <= dv0 + search; dv++) {
            for (let du = du0 - search; du <= du0 + search; du++) {
              let sad = 0;
              for (let dy = -r; dy <= r; dy++) {
                const ay = y + dy;
                if (ay < 0 || ay >= h) continue;
                const by = ay + dv;
                if (by < 0 || by >= h) {
                  sad += 255;
                  continue;
                }
                for (let dx = -r; dx <= r; dx++) {
                  const ax = x + dx;
                  if (ax < 0 || ax >= w) continue;
                  const bx = ax + du;
                  if (bx < 0 || bx >= w) {
                    sad += 255;
                    continue;
                  }
                  sad += Math.abs(A.data[ay * w + ax] - B.data[by * w + bx]);
                }
              }
              if (sad < best) {
                best = sad;
                bu = du;
                bv = dv;
              }
            }
          }
          next[o] = bu;
          next[o + 1] = bv;
        }
      }
      cur = next;
    }
    flow = cur;
  }

  const u = new Float32Array(width * height);
  const v = new Float32Array(width * height);
  for (let i = 0; i < u.length; i++) {
    u[i] = flow[i * 2];
    v[i] = flow[i * 2 + 1];
  }
  return { u, v, width, height };
}

/** 双线性 remap，边界外取 border 颜色 */
function remap(img, mapX, mapY, border = [0, 0, 0, 0]) {
  const out = new Image(img.width, img.height);
  const { width: w, height: h, data: sd } = img;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = mapX[y * w + x];
      const fy = mapY[y * w + x];
      const o = (y * w + x) * 4;
      if (fx < -1 || fy < -1 || fx > w || fy > h) {
        out.data[o] = border[0];
        out.data[o + 1] = border[1];
        out.data[o + 2] = border[2];
        out.data[o + 3] = border[3];
        continue;
      }
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const xa = Math.min(w - 1, Math.max(0, x0));
      const ya = Math.min(h - 1, Math.max(0, y0));
      const xb = Math.min(w - 1, Math.max(0, x0 + 1));
      const yb = Math.min(h - 1, Math.max(0, y0 + 1));
      const i00 = (ya * w + xa) * 4;
      const i01 = (ya * w + xb) * 4;
      const i10 = (yb * w + xa) * 4;
      const i11 = (yb * w + xb) * 4;
      for (let k = 0; k < 4; k++) {
        const top = sd[i00 + k] + (sd[i01 + k] - sd[i00 + k]) * tx;
        const bot = sd[i10 + k] + (sd[i11 + k] - sd[i10 + k]) * tx;
        out.data[o + k] = pyRound(top + (bot - top) * ty);
      }
    }
  }
  return out;
}

module.exports = { grayOf, calcOpticalFlowFarneback, remap, sample };