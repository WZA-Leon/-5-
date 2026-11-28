'use strict';
/* ==========================================================================
   纯 JS PNG 编解码（只用 node:zlib），零第三方依赖。
   · 解码：支持非隔行 PNG，色彩类型 0/2/3/4/6，位深 1/2/4/8/16（16 位取高字节）
   · 编码：RGBA8，逐行自适应滤波 + deflate
   ========================================================================== */

const zlib = require('node:zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* ------------------------------------------------------------------ CRC --- */
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* -------------------------------------------------------------- 滤波器 --- */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/* ---------------------------------------------------------------- 解码 --- */
function decodePNG(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('不是 PNG 文件');

  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let colorType = 6;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];

  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!width || !height) throw new Error('PNG 缺少 IHDR');
  if (interlace !== 0) throw new Error('暂不支持隔行 PNG');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('不支持的 PNG 色彩类型 ' + colorType);

  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3); // 滤波用的字节步长
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length < (rowBytes + 1) * height) throw new Error('PNG 数据长度不足');

  // 逐行反滤波，得到紧凑的像素字节
  const out = Buffer.alloc(rowBytes * height);
  let prevRow = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y++) {
    const base = y * (rowBytes + 1);
    const filter = raw[base];
    const src = raw.subarray(base + 1, base + 1 + rowBytes);
    const dst = out.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? dst[i - bpp] : 0;
      const b = prevRow[i];
      const c = i >= bpp ? prevRow[i - bpp] : 0;
      let v = src[i];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: v += paeth(a, b, c); break;
        default: throw new Error('未知 PNG 滤波类型 ' + filter);
      }
      dst[i] = v & 0xff;
    }
    prevRow = dst;
  }

  const rgba = new Uint8Array(width * height * 4);
  const trnsGray = trns && colorType === 0 ? trns.readUInt16BE(0) : -1;
  const trnsRGB = trns && colorType === 2
    ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)]
    : null;

  // 按位深读取第 index 个采样（返回 0..2^depth-1）
  const bytePerSample = depth / 8;
  const readSample = (rowStart, index) => {
    if (depth === 8) return out[rowStart + index];
    if (depth === 16) return out.readUInt16BE(rowStart + index * 2);
    const bitPos = index * depth;
    const byte = out[rowStart + (bitPos >> 3)];
    const shift = 8 - depth - (bitPos & 7);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const to8 = (v) => {
    if (depth === 8) return v;
    if (depth === 16) return v >> 8;
    return Math.round((v * 255) / ((1 << depth) - 1));
  };

  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 0) {
        const g = to8(readSample(rowStart, x));
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = trnsGray >= 0 && readSample(rowStart, x) === trnsGray ? 0 : 255;
      } else if (colorType === 2) {
        const r = readSample(rowStart, x * 3);
        const g = readSample(rowStart, x * 3 + 1);
        const b = readSample(rowStart, x * 3 + 2);
        rgba[o] = to8(r);
        rgba[o + 1] = to8(g);
        rgba[o + 2] = to8(b);
        rgba[o + 3] = trnsRGB && r === trnsRGB[0] && g === trnsRGB[1] && b === trnsRGB[2] ? 0 : 255;
      } else if (colorType === 3) {
        const idx = readSample(rowStart, x);
        const p = idx * 3;
        rgba[o] = palette[p];
        rgba[o + 1] = palette[p + 1];
        rgba[o + 2] = palette[p + 2];
        rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colorType === 4) {
        const g = to8(readSample(rowStart, x * 2));
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = to8(readSample(rowStart, x * 2 + 1));
      } else {
        rgba[o] = to8(readSample(rowStart, x * 4));
        rgba[o + 1] = to8(readSample(rowStart, x * 4 + 1));
        rgba[o + 2] = to8(readSample(rowStart, x * 4 + 2));
        rgba[o + 3] = to8(readSample(rowStart, x * 4 + 3));
      }
    }
  }

  return { width, height, data: rgba };
}

/* ---------------------------------------------------------------- 编码 --- */
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(width, height, rgba, level = 6) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const cur = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];

  for (let y = 0; y < height; y++) {
    const srcOff = y * stride;
    const row = Buffer.from(rgba.buffer, rgba.byteOffset + srcOff, stride);

    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const dst = cand[f];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? row[i - 4] : 0;
        const b = prev[i];
        const c = i >= 4 ? prev[i - 4] : 0;
        let v;
        switch (f) {
          case 0: v = row[i]; break;
          case 1: v = row[i] - a; break;
          case 2: v = row[i] - b; break;
          case 3: v = row[i] - ((a + b) >> 1); break;
          default: v = row[i] - paeth(a, b, c); break;
        }
        dst[i] = v & 0xff;
        score += v > 127 ? 256 - v : v < -128 ? 256 + v : Math.abs(v);
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }

    const line = y * (stride + 1);
    raw[line] = best;
    cand[best].copy(raw, line + 1);
    row.copy(prev);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* 只读 IHDR，用于报告尺寸/通道（check_transparent 需要） */
function pngInfo(buf) {
  if (buf.toString('latin1', 12, 16) !== 'IHDR') throw new Error('不是 PNG 文件');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] || 0;
  return { width, height, bitDepth, colorType, channels };
}

module.exports = { decodePNG, encodePNG, crc32, pngInfo };