'use strict';
/* ==========================================================================
   基础绘图：直线 / 折线 / 圆 / 文字，语义对齐 cv2.line / polylines / circle /
   putText（只写 RGB，不动 alpha，与 OpenCV 对 4 通道图的行为一致）。
   文字使用内置 5×7 点阵字体（cv2 用的是 Hershey 矢量字体，这里用等价可读的
   点阵近似，仅用于调试标注）。
   ========================================================================== */

/* 5×7 点阵字体：每个字符 7 行，每行取低 5 位（0b01110 = 0x0E 等） */
const FONT = {
  ' ': '00000000000000',
  '!': '04040404040004',
  '"': '0a0a0000000000',
  '#': '0a0a1f0a1f0a0a',
  '$': '040f140e051e04',
  '%': '18190204081303',
  '&': '0c12140815120d',
  "'": '04040000000000',
  '(': '02040808080402',
  ')': '08040202020408',
  '*': '0004150e150400',
  '+': '0004041f040400',
  ',': '00000000000408',
  '-': '0000001f000000',
  '.': '00000000000c0c',
  '/': '01020204080810',
  '0': '0e11131519110e',
  '1': '040c040404040e',
  '2': '0e11010204081f',
  '3': '1f02040201110e',
  '4': '02060a121f0202',
  '5': '1f101e0101110e',
  '6': '0608101e11110e',
  '7': '1f010204080808',
  '8': '0e11110e11110e',
  '9': '0e11110f01020c',
  ':': '000c0c000c0c00',
  ';': '000c0c00040800',
  '<': '02040810080402',
  '=': '00001f001f0000',
  '>': '08040201020408',
  '?': '0e110102040004',
  '@': '0e11171517100e',
  A: '0e11111f111111',
  B: '1e11111e11111e',
  C: '0e11101010110e',
  D: '1c12111111121c',
  E: '1f10101e10101f',
  F: '1f10101e101010',
  G: '0e11101711110f',
  H: '1111111f111111',
  I: '0e04040404040e',
  J: '0702020202120c',
  K: '11121418141211',
  L: '1010101010101f',
  M: '111b1515111111',
  N: '11191513111111',
  O: '0e11111111110e',
  P: '1e11111e101010',
  Q: '0e11111115120d',
  R: '1e11111e141211',
  S: '0f10100e01011e',
  T: '1f040404040404',
  U: '1111111111110e',
  V: '11111111110a04',
  W: '1111111515150a',
  X: '11110a040a1111',
  Y: '11110a04040404',
  Z: '1f01020408101f',
  '[': '0e08080808080e',
  '\\': '10080804020201',
  ']': '0e02020202020e',
  '^': '040a1100000000',
  _: '0000000000001f',
  '`': '08040000000000',
  a: '00000e010f110f',
  b: '10101e1111111e',
  c: '00000e1110110e',
  d: '01010f1111110f',
  e: '00000e111f100e',
  f: '0609081c080808',
  g: '000f11110f010e',
  h: '10101619111111',
  i: '04000c0404040e',
  j: '0200060202120c',
  k: '10101214181412',
  l: '0c04040404040e',
  m: '00001a15151111',
  n: '00001619111111',
  o: '00000e1111110e',
  p: '00001e111e1010',
  q: '00000f110f0101',
  r: '00001619101010',
  s: '00000f100e011e',
  t: '08081c08080906',
  u: '0000111111130d',
  v: '00001111110a04',
  w: '0000111115150a',
  x: '0000110a040a11',
  y: '000011110f010e',
  z: '00001f0204081f',
  '{': '06080810080806',
  '|': '04040404040404',
  '}': '0c02020102020c',
  '~': '00000815020000',
};

function parseGlyph(ch) {
  const hex = FONT[ch] || FONT['?'];
  const rows = new Uint8Array(7);
  for (let i = 0; i < 7; i++) rows[i] = parseInt(hex.substr(i * 2, 2), 16);
  return rows;
}

function setPixel(img, x, y, rgb) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  img.data[o] = rgb[0];
  img.data[o + 1] = rgb[1];
  img.data[o + 2] = rgb[2];
}

function dot(img, x, y, rgb, t) {
  const r = (t - 1) >> 1;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) setPixel(img, x + dx, y + dy, rgb);
  }
}

function line(img, x0, y0, x1, y1, rgb, thickness = 1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    dot(img, x0, y0, rgb, thickness);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function polyline(img, points, closed, rgb, thickness = 1) {
  for (let i = 1; i < points.length; i++) {
    line(img, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], rgb, thickness);
  }
  if (closed && points.length > 2) {
    line(img, points[points.length - 1][0], points[points.length - 1][1], points[0][0], points[0][1], rgb, thickness);
  }
}

function circle(img, cx, cy, radius, rgb, thickness = 1) {
  const steps = Math.max(24, Math.round(radius * 8));
  let px = cx + radius;
  let py = cy;
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    line(img, px, py, x, y, rgb, thickness);
    px = x;
    py = y;
  }
}

/** 基线在 (x, y)，scale≈cv2 fontScale（0.4 约等于 3px 字高）；返回文本宽度 */
function putText(img, text, x, y, scale, rgb, thickness = 1) {
  const p = Math.max(1, Math.round(scale * 3));
  const adv = 6 * p;
  const top = Math.round(y) - 7 * p;
  let cx = Math.round(x);
  for (const ch of String(text)) {
    const rows = parseGlyph(ch);
    for (let ry = 0; ry < 7; ry++) {
      const bits = rows[ry];
      for (let bx = 0; bx < 5; bx++) {
        if (!(bits & (1 << (4 - bx)))) continue;
        for (let sy = 0; sy < p; sy++) {
          for (let sx = 0; sx < p; sx++) {
            dot(img, cx + bx * p + sx, top + ry * p + sy, rgb, thickness);
          }
        }
      }
    }
    cx += adv;
  }
  return (String(text).length * 6 - 1) * p;
}

function textWidth(text, scale) {
  const p = Math.max(1, Math.round(scale * 3));
  return (String(text).length * 6 - 1) * p;
}

/* ---- 掩码栅格化（用于 rig_parts 的切割线）：直接写 0/1 掩码 ----
   按「到线段的距离」判定，半径按 OpenCV 8 连通粗线的实际覆盖标定：
   thickness=3 → 2.5px 半径，实测与 cv2.polylines(...,3) 的分块面积一致。 */
function lineMask(mask, w, h, x0, y0, x1, y1, thickness = 1) {
  const r = thickness <= 1 ? 0.5 : thickness / 2 + 1;
  const r2 = r * r;
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  const pad = Math.ceil(r);
  const bx0 = Math.max(0, Math.floor(Math.min(x0, x1)) - pad);
  const bx1 = Math.min(w - 1, Math.ceil(Math.max(x0, x1)) + pad);
  const by0 = Math.max(0, Math.floor(Math.min(y0, y1)) - pad);
  const by1 = Math.min(h - 1, Math.ceil(Math.max(y0, y1)) + pad);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      let t = len2 ? ((x - x0) * vx + (y - y0) * vy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (x0 + t * vx);
      const dy = y - (y0 + t * vy);
      if (dx * dx + dy * dy <= r2) mask[y * w + x] = 1;
    }
  }
}

function polylineMask(w, h, points, closed, thickness = 1) {
  const mask = new Uint8Array(w * h);
  for (let i = 1; i < points.length; i++) {
    lineMask(mask, w, h, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], thickness);
  }
  if (closed && points.length > 2) {
    const a = points[points.length - 1];
    lineMask(mask, w, h, a[0], a[1], points[0][0], points[0][1], thickness);
  }
  return mask;
}

module.exports = { line, polyline, circle, putText, textWidth, polylineMask, lineMask };