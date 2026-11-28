'use strict';
/* ==========================================================================
   把接触帧按切割线分块：躯干（含头/上臂）、左右前臂、左右腿、左右鞋。

   坐标基于 tools/ref/rig/contact_320.png（干净抠图后的 320x460 画布）。
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const {
  Image, readImage, writeImage, connectedComponents, polyline, circle, putText, addWeighted,
  polylineMask,
} = require('./lib');

const { ROOT } = require('./lib/paths');
const REF = path.join(ROOT, 'tools', 'ref', 'rig');
const OUT = path.join(REF, 'parts');
const SRC = path.join(REF, 'contact_320.png');

const CUTS = {
  elbow_far: [[66, 272], [95, 282], [125, 296], [145, 308]],
  elbow_near: [[232, 240], [250, 264], [268, 288], [282, 306]],
  hip_far: [[95, 322], [131, 336], [151, 350]],
  hip_near: [[212, 322], [166, 336], [151, 350]],
  ankle_far: [[48, 428], [85, 418], [122, 410]],
  ankle_near: [[182, 410], [225, 418], [266, 428]],
};

const PARTS = {
  torso: { seed: [150, 270], pivot: [150, 330] },
  arm_far: { seed: [85, 322], pivot: [108, 290] },
  arm_near: { seed: [275, 298], pivot: [250, 272] },
  leg_far: { seed: [100, 380], pivot: [131, 336] },
  leg_near: { seed: [200, 390], pivot: [166, 336] },
  foot_far: { seed: [78, 440], pivot: [85, 424] },
  foot_near: { seed: [225, 440], pivot: [225, 424] },
};

// 原脚本用 OpenCV 的 BGR 元组，这里换算成 RGB
const COLORS = {
  torso: [120, 220, 60],
  arm_far: [60, 120, 255],
  arm_near: [200, 60, 255],
  leg_far: [255, 200, 60],
  leg_near: [255, 60, 200],
  foot_far: [60, 220, 255],
  foot_near: [60, 255, 120],
};

function main() {
  if (!fs.existsSync(SRC)) throw new Error('missing ' + SRC);
  fs.mkdirSync(OUT, { recursive: true });
  const img = readImage(SRC);
  const w = img.width;
  const h = img.height;

  const walls = new Uint8Array(w * h);
  for (const pts of Object.values(CUTS)) {
    const m = polylineMask(w, h, pts, false, 3);
    for (let i = 0; i < m.length; i++) if (m[i]) walls[i] = 1;
  }

  const free = new Uint8Array(w * h);
  for (let i = 0, o = 3; i < free.length; i++, o += 4) {
    free[i] = img.data[o] > 0 && !walls[i] ? 1 : 0;
  }

  const { labels } = connectedComponents(free, w, h, 8);
  const seeds = {};
  for (const [name, info] of Object.entries(PARTS)) {
    const [sx, sy] = info.seed;
    const lab = labels[sy * w + sx];
    if (!lab) {
      console.log(`WARN ${name} seed ${JSON.stringify(info.seed)} in wall/background`);
      continue;
    }
    seeds[name] = lab;
  }

  const inv = {};
  for (const [name, lab] of Object.entries(seeds)) (inv[lab] = inv[lab] || []).push(name);
  for (const names of Object.values(inv)) if (names.length > 1) console.log(`WARN same component: ${names}`);

  const debug = img.clone();
  const overlay = new Image(w, h);
  const meta = {};
  for (const [name, lab] of Object.entries(seeds)) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = labels[i] === lab ? 1 : 0;
    const part = new Image(w, h);
    for (let i = 0, o = 0; i < mask.length; i++, o += 4) {
      if (!mask[i]) continue;
      part.data[o] = img.data[o];
      part.data[o + 1] = img.data[o + 1];
      part.data[o + 2] = img.data[o + 2];
      part.data[o + 3] = img.data[o + 3];
    }
    writeImage(path.join(OUT, `${name}.png`), part);
    const c = COLORS[name];
    for (let i = 0, o = 0; i < mask.length; i++, o += 4) {
      if (!mask[i]) continue;
      overlay.data[o] = c[0];
      overlay.data[o + 1] = c[1];
      overlay.data[o + 2] = c[2];
      overlay.data[o + 3] = 130;
    }
    meta[name] = { pivot: PARTS[name].pivot, area: mask.reduce((a, b) => a + b, 0) };
    console.log(`${name.padEnd(9)} area=${String(meta[name].area).padStart(5)} pivot=${PARTS[name].pivot}`);
  }

  const merged = addWeighted(debug, 1.0, overlay, 0.55, 0);
  for (const pts of Object.values(CUTS)) polyline(merged, pts, false, [255, 0, 0], 2);
  for (const [name, info] of Object.entries(PARTS)) {
    const [px, py] = info.pivot;
    circle(merged, px, py, 4, [255, 255, 255], 1);
    putText(merged, name, px + 5, py - 5, 0.4, [255, 255, 255], 1);
  }
  writeImage(path.join(REF, 'parts_debug.png'), merged);
  fs.writeFileSync(path.join(REF, 'rig_meta.json'), JSON.stringify(meta, null, 1));
  console.log('parts:', Object.keys(seeds).length, '->', path.join(REF, 'parts_debug.png'));
}

if (require.main === module) main();

module.exports = { CUTS, PARTS, COLORS };