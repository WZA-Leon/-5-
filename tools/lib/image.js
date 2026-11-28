'use strict';
/* ==========================================================================
   纯 JS 图像容器与几何/重采样操作，语义对齐 OpenCV + NumPy 里的用法：
     · RGBA 8 位，Uint8Array，行优先
     · resize：INTER_AREA / INTER_LANCZOS4 / INTER_LINEAR / INTER_NEAREST
     · flip / crop / 直接拷贝 / alpha 叠加（over）/ addWeighted
   ========================================================================== */

function clamp8(v) {
  return v < 0 ? 0 : v > 255 ? 255 : pyRound(v);
}

/** 四舍六入五取偶（cvRound 同规则），避免跨语言移植时的半整数偏差 */
function pyRound(v) {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/* ------------------------------------------------------------ 采样权重 --- */
function areaWeights(srcLen, dstLen) {
  const scale = srcLen / dstLen;
  const out = new Array(dstLen);
  for (let i = 0; i < dstLen; i++) {
    const start = i * scale;
    const end = (i + 1) * scale;
    const i0 = Math.floor(start);
    const i1 = Math.min(srcLen, Math.ceil(end));
    const w = [];
    let sum = 0;
    for (let j = i0; j < i1; j++) {
      const lo = Math.max(start, j);
      const hi = Math.min(end, j + 1);
      const ww = hi - lo;
      if (ww > 1e-9) {
        w.push(j, ww);
        sum += ww;
      }
    }
    if (sum <= 0) {
      const j = Math.min(srcLen - 1, Math.floor((start + end) / 2));
      out[i] = { idx: [j], w: [1] };
    } else {
      const idx = [];
      const ww = [];
      for (let k = 0; k < w.length; k += 2) {
        idx.push(w[k]);
        ww.push(w[k + 1] / sum);
      }
      out[i] = { idx, w: ww };
    }
  }
  return out;
}

function lanczos(x) {
  if (x === 0) return 1;
  if (x < -4 || x > 4) return 0;
  const pix = Math.PI * x;
  return (4 * Math.sin(pix) * Math.sin(pix / 4)) / (pix * pix);
}

function lanczosWeights(srcLen, dstLen) {
  const scale = srcLen / dstLen; // >1 缩小，<1 放大
  const k = Math.max(1, scale);
  const support = 4 * k;
  const out = new Array(dstLen);
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) * scale - 0.5;
    const lo = Math.ceil(center - support);
    const hi = Math.floor(center + support);
    const idx = [];
    const w = [];
    let sum = 0;
    for (let j = lo; j <= hi; j++) {
      const d = (j - center) / k;
      const ww = lanczos(d);
      if (Math.abs(ww) < 1e-9) continue;
      idx.push(j < 0 ? 0 : j >= srcLen ? srcLen - 1 : j);
      w.push(ww);
      sum += ww;
    }
    if (Math.abs(sum) < 1e-9) {
      const j = Math.min(srcLen - 1, Math.max(0, Math.round(center)));
      out[i] = { idx: [j], w: [1] };
    } else {
      out[i] = { idx, w: w.map((v) => v / sum) };
    }
  }
  return out;
}

/* --------------------------------------------------------------- Image --- */
class Image {
  constructor(width, height, data) {
    this.width = width;
    this.height = height;
    this.data = data || new Uint8Array(width * height * 4);
  }

  static create(width, height, fill) {
    const img = new Image(width, height);
    if (fill) img.fill(fill);
    return img;
  }

  static fromPNG(buf) {
    const { decodePNG } = require('./png');
    const p = decodePNG(buf);
    return new Image(p.width, p.height, p.data);
  }

  clone() {
    return new Image(this.width, this.height, new Uint8Array(this.data));
  }

  fill(color) {
    const [r, g, b, a] = color;
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = a;
    }
  }

  get(x, y) {
    const o = (y * this.width + x) * 4;
    return [this.data[o], this.data[o + 1], this.data[o + 2], this.data[o + 3]];
  }

  set(x, y, rgba) {
    const o = (y * this.width + x) * 4;
    this.data[o] = rgba[0];
    this.data[o + 1] = rgba[1];
    this.data[o + 2] = rgba[2];
    this.data[o + 3] = rgba[3];
  }

  /** 内容 bbox（alpha > threshold），返回 {x0,y0,x1,y1}，空图返回 null */
  bbox(threshold = 0) {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    const { width: w, height: h, data: d } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > threshold) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  crop(x0, y0, w, h) {
    const out = new Image(w, h);
    for (let y = 0; y < h; y++) {
      const sy = y0 + y;
      if (sy < 0 || sy >= this.height) continue;
      for (let x = 0; x < w; x++) {
        const sx = x0 + x;
        if (sx < 0 || sx >= this.width) continue;
        const s = (sy * this.width + sx) * 4;
        const o = (y * w + x) * 4;
        out.data[o] = this.data[s];
        out.data[o + 1] = this.data[s + 1];
        out.data[o + 2] = this.data[s + 2];
        out.data[o + 3] = this.data[s + 3];
      }
    }
    return out;
  }

  /** 直接拷贝（不混合 alpha），对齐 NumPy 里的切片赋值 */
  copyInto(src, dx, dy) {
    for (let y = 0; y < src.height; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= this.height) continue;
      for (let x = 0; x < src.width; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= this.width) continue;
        const s = (y * src.width + x) * 4;
        const o = (ty * this.width + tx) * 4;
        this.data[o] = src.data[s];
        this.data[o + 1] = src.data[s + 1];
        this.data[o + 2] = src.data[s + 2];
        this.data[o + 3] = src.data[s + 3];
      }
    }
  }

  /** alpha 叠加（Word/NumPy 里 over()）：rgb 截断取整，alpha 取最大值 */
  pasteOver(src, dx, dy) {
    for (let y = 0; y < src.height; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= this.height) continue;
      for (let x = 0; x < src.width; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= this.width) continue;
        const s = (y * src.width + x) * 4;
        const o = (ty * this.width + tx) * 4;
        const a = src.data[s + 3] / 255;
        this.data[o] = (src.data[s] * a + this.data[o] * (1 - a)) | 0;
        this.data[o + 1] = (src.data[s + 1] * a + this.data[o + 1] * (1 - a)) | 0;
        this.data[o + 2] = (src.data[s + 2] * a + this.data[o + 2] * (1 - a)) | 0;
        this.data[o + 3] = Math.max(this.data[o + 3], src.data[s + 3]);
      }
    }
  }

  over(fg) {
    const out = this.clone();
    out.pasteOver(fg, 0, 0);
    return out;
  }

  flipH() {
    const { width: w, height: h } = this;
    const out = new Image(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + (w - 1 - x)) * 4;
        const o = (y * w + x) * 4;
        out.data[o] = this.data[s];
        out.data[o + 1] = this.data[s + 1];
        out.data[o + 2] = this.data[s + 2];
        out.data[o + 3] = this.data[s + 3];
      }
    }
    return out;
  }

  flipV() {
    const { width: w, height: h } = this;
    const out = new Image(w, h);
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * w * 4;
      const dstRow = y * w * 4;
      out.data.set(this.data.subarray(srcRow, srcRow + w * 4), dstRow);
    }
    return out;
  }

  resize(width, height, mode = 'area') {
    if (width === this.width && height === this.height) return this.clone();
    if (mode === 'nearest') return this._resizeNearest(width, height);
    if (mode === 'linear') return this._resizeLinear(width, height);
    if (mode === 'lanczos4') return this._resample(1, width, height, lanczosWeights);
    return this._resample(0, width, height, areaWeights);
  }

  _resizeNearest(width, height) {
    const out = new Image(width, height);
    const sx = this.width / width;
    const sy = this.height / height;
    for (let y = 0; y < height; y++) {
      const srcY = Math.min(this.height - 1, Math.floor(y * sy));
      for (let x = 0; x < width; x++) {
        const srcX = Math.min(this.width - 1, Math.floor(x * sx));
        const s = (srcY * this.width + srcX) * 4;
        const o = (y * width + x) * 4;
        out.data[o] = this.data[s];
        out.data[o + 1] = this.data[s + 1];
        out.data[o + 2] = this.data[s + 2];
        out.data[o + 3] = this.data[s + 3];
      }
    }
    return out;
  }

  _resizeLinear(width, height) {
    const out = new Image(width, height);
    const sx = this.width / width;
    const sy = this.height / height;
    const x0Arr = new Int32Array(width);
    const x1Arr = new Int32Array(width);
    const xfArr = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      let fx = (x + 0.5) * sx - 0.5;
      if (fx < 0) fx = 0;
      const i0 = Math.min(this.width - 1, Math.floor(fx));
      const i1 = Math.min(this.width - 1, i0 + 1);
      x0Arr[x] = i0;
      x1Arr[x] = i1;
      xfArr[x] = fx - Math.floor(fx);
    }
    for (let y = 0; y < height; y++) {
      let fy = (y + 0.5) * sy - 0.5;
      if (fy < 0) fy = 0;
      const j0 = Math.min(this.height - 1, Math.floor(fy));
      const j1 = Math.min(this.height - 1, j0 + 1);
      const yf = fy - Math.floor(fy);
      for (let x = 0; x < width; x++) {
        const x0 = x0Arr[x];
        const x1 = x1Arr[x];
        const xf = xfArr[x];
        const o = (y * width + x) * 4;
        for (let c = 0; c < 4; c++) {
          const p00 = this.data[(j0 * this.width + x0) * 4 + c];
          const p01 = this.data[(j0 * this.width + x1) * 4 + c];
          const p10 = this.data[(j1 * this.width + x0) * 4 + c];
          const p11 = this.data[(j1 * this.width + x1) * 4 + c];
          const top = p00 + (p01 - p00) * xf;
          const bot = p10 + (p11 - p10) * xf;
          out.data[o + c] = pyRound(top + (bot - top) * yf);
        }
      }
    }
    return out;
  }

  /** 可分离重采样：水平一遍、垂直一遍（浮点中间结果） */
  _resample(kind, width, height, maker) {
    const { width: sw, height: sh } = this;
    const wx = maker(sw, width);
    const wy = maker(sh, height);

    const tmp = new Float32Array(width * sh * 4);
    for (let y = 0; y < sh; y++) {
      const srow = y * sw * 4;
      const drow = y * width * 4;
      for (let x = 0; x < width; x++) {
        const o = drow + x * 4;
        const { idx, w } = wx[x];
        let r = 0, g = 0, b = 0, a = 0;
        for (let k = 0; k < idx.length; k++) {
          const s = srow + idx[k] * 4;
          const ww = w[k];
          r += this.data[s] * ww;
          g += this.data[s + 1] * ww;
          b += this.data[s + 2] * ww;
          a += this.data[s + 3] * ww;
        }
        tmp[o] = r;
        tmp[o + 1] = g;
        tmp[o + 2] = b;
        tmp[o + 3] = a;
      }
    }

    const out = new Image(width, height);
    for (let y = 0; y < height; y++) {
      const drow = y * width * 4;
      const { idx, w } = wy[y];
      for (let x = 0; x < width; x++) {
        const o = drow + x * 4;
        let r = 0, g = 0, b = 0, a = 0;
        for (let k = 0; k < idx.length; k++) {
          const s = idx[k] * width * 4 + x * 4;
          const ww = w[k];
          r += tmp[s] * ww;
          g += tmp[s + 1] * ww;
          b += tmp[s + 2] * ww;
          a += tmp[s + 3] * ww;
        }
        out.data[o] = clamp8(r);
        out.data[o + 1] = clamp8(g);
        out.data[o + 2] = clamp8(b);
        out.data[o + 3] = clamp8(a);
      }
    }
    return out;
  }
}

/* --------------------------------------------------------- 组合工具 --- */
function hstack(images) {
  const height = images[0].height;
  const width = images.reduce((s, im) => s + im.width, 0);
  const out = new Image(width, height);
  let x = 0;
  for (const im of images) {
    out.copyInto(im, x, 0);
    x += im.width;
  }
  return out;
}

function vstack(images) {
  const width = images[0].width;
  const height = images.reduce((s, im) => s + im.height, 0);
  const out = new Image(width, height);
  let y = 0;
  for (const im of images) {
    out.copyInto(im, 0, y);
    y += im.height;
  }
  return out;
}

/** cv2.addWeighted：饱和到 0..255 并四舍五入（返回新图） */
function addWeighted(a, alpha, b, beta, gamma = 0) {
  const out = new Image(a.width, a.height);
  for (let i = 0; i < a.data.length; i++) {
    out.data[i] = Math.max(0, Math.min(255, pyRound(a.data[i] * alpha + b.data[i] * beta + gamma)));
  }
  return out;
}

module.exports = { Image, hstack, vstack, addWeighted, areaWeights, lanczosWeights, pyRound };