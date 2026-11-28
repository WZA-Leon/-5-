'use strict';
/* ==========================================================================
   用 3.png 的拆件拼一个站立骨架预览（先不走路）。

   每个部件按整身比例单独缩放，再按关节锚点拼到一张 320x460 画布上。
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { Image, readImage, writeImage, inpaintTelea, dilate, pyRound } = require('./lib');

const { ROOT } = require('./lib/paths');
const SRC_DIR = path.join(ROOT, 'tools', 'ref', 'rig', 'sheet3');
const OUT = path.join(ROOT, 'tools', 'ref', 'rig', 'rig3');

const PARTS = {
  head: 'p01_x63_y462.png',
  torso: 'p02_x378_y474.png',
  arm_l: 'p03_x636_y483.png',
  arm_r: 'p04_x853_y483.png',
  leg_l: 'p05_x134_y741.png',
  leg_r: 'p06_x399_y744.png',
  shoe_l: 'p07_x614_y846.png',
  shoe_r: 'p08_x832_y846.png',
};

// 相对整身的缩放（部件本身偏大）
const SCALE = { head: 0.55, torso: 0.95, arm: 0.75, leg: 0.58, shoe: 0.57 };

// 部件内部锚点（原始部件坐标）
const ANCHOR = {
  head_neck: [125, 190],
  torso_collar: [68, 10],
  torso_sleeve_l: [30, 82],
  torso_sleeve_r: [108, 82],
  torso_hip_l: [45, 175],
  torso_hip_r: [95, 175],
  arm_cuff: [30, 30],
  leg_hip: [35, 12],
  leg_ankle: [35, 165],
  shoe_ankle: [65, 15], // v16 的状态
};

function load(name) {
  const file = path.join(SRC_DIR, PARTS[name]);
  if (!fs.existsSync(file)) throw new Error('missing ' + name + ' (' + file + ')');
  return readImage(file);
}

function resize(im, s) {
  return im.resize(
    Math.max(1, pyRound(im.width * s)),
    Math.max(1, pyRound(im.height * s)),
    s < 1 ? 'area' : 'lanczos4'
  );
}

/** 把红条纹用邻近裤子颜色补掉（只处理红色像素）。 */
function removeStripe(im) {
  const { width: w, height: h, data } = im;
  const red = new Uint8Array(w * h);
  let any = false;
  for (let i = 0, o = 0; i < red.length; i++, o += 4) {
    if (data[o + 3] === 0) continue;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (r > 90 && r > g + 40 && r > b + 20) {
      red[i] = 1;
      any = true;
    }
  }
  if (!any) return im;
  const mask = dilate(red, w, h, 3);
  const out = inpaintTelea(im, mask, 3);
  // 只改 RGB，alpha 恢复成原图
  for (let o = 3; o < out.data.length; o += 4) out.data[o] = im.data[o];
  return out;
}

class Layer {
  constructor(img, pivot, name = '') {
    this.img = img;
    this.pivot = pivot; // 部件内部坐标
    this.name = name;
  }
}

/** 把 layer 放到 canvas，使 pivot 对齐 target_pivot。 */
function place(canvas, layer, targetPivot) {
  const x = pyRound(targetPivot[0] - layer.pivot[0]);
  const y = pyRound(targetPivot[1] - layer.pivot[1]);
  canvas.pasteOver(layer.img, x, y);
}

function buildAssembled() {
  // 先拼在 400x600 的局部画布
  const canvas = new Image(400, 600);
  const st = SCALE;

  const torso = new Layer(
    resize(load('torso'), st.torso),
    [ANCHOR.torso_collar[0] * st.torso, ANCHOR.torso_collar[1] * st.torso],
    'torso'
  );
  // 以躯干领口为原点放置：躯干领口放在 (200, 200)
  const origin = [200, 200];
  const tTl = [origin[0] - torso.pivot[0], origin[1] - torso.pivot[1]];
  const tpoint = (p) => [tTl[0] + p[0] * st.torso, tTl[1] + p[1] * st.torso];

  const hipL = tpoint(ANCHOR.torso_hip_l);
  const hipR = tpoint(ANCHOR.torso_hip_r);
  const sleeveL = tpoint(ANCHOR.torso_sleeve_l);
  const sleeveR = tpoint(ANCHOR.torso_sleeve_r);

  const head = new Layer(
    resize(load('head'), st.head),
    [ANCHOR.head_neck[0] * st.head, ANCHOR.head_neck[1] * st.head],
    'head'
  );
  const armL = new Layer(
    resize(load('arm_l'), st.arm),
    [ANCHOR.arm_cuff[0] * st.arm, ANCHOR.arm_cuff[1] * st.arm],
    'arm_l'
  );
  const armR = new Layer(
    resize(load('arm_r'), st.arm),
    [ANCHOR.arm_cuff[0] * st.arm, ANCHOR.arm_cuff[1] * st.arm],
    'arm_r'
  );
  const legL = new Layer(
    resize(removeStripe(load('leg_l')), st.leg),
    [ANCHOR.leg_hip[0] * st.leg, ANCHOR.leg_hip[1] * st.leg],
    'leg_l'
  );
  const legRImg = load('leg_r').flipH();
  const wR = legRImg.width;
  const legR = new Layer(
    resize(removeStripe(legRImg), st.leg),
    [(wR - ANCHOR.leg_hip[0]) * st.leg, ANCHOR.leg_hip[1] * st.leg],
    'leg_r'
  );
  const shoeImg = load('shoe_l').flipH();
  const sw = shoeImg.width;
  const shoe = new Layer(
    resize(shoeImg, st.shoe),
    [(sw - ANCHOR.shoe_ankle[0]) * st.shoe, ANCHOR.shoe_ankle[1] * st.shoe],
    'shoe'
  );

  const ankleL = [hipL[0], hipL[1] + (ANCHOR.leg_ankle[1] - ANCHOR.leg_hip[1]) * st.leg];
  const ankleR = [hipR[0], hipR[1] + (ANCHOR.leg_ankle[1] - ANCHOR.leg_hip[1]) * st.leg];

  // 顺序：远臂 → 远腿 → 远鞋 → 近腿 → 近鞋 → 头 → 躯干 → 近臂
  place(canvas, armL, sleeveL);
  place(canvas, legL, hipL);
  place(canvas, shoe, ankleL);
  place(canvas, legR, hipR);
  place(canvas, shoe, ankleR);
  place(canvas, head, origin);
  place(canvas, torso, origin);
  place(canvas, armR, sleeveR);

  const b = canvas.bbox(0);
  return canvas.crop(b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const body = buildAssembled();
  writeImage(path.join(OUT, 'assembled_raw.png'), body);
  console.log('assembled', body.width + 'x' + body.height);

  // 缩放到游戏里的身高 408，脚底 452，中心 160
  const s = 408 / body.height;
  const newW = pyRound(body.width * s);
  const newH = 408;
  const scaled = body.resize(newW, newH, 'area');
  const canvas = new Image(320, 460);
  const x = 160 - (newW >> 1);
  const y = 452 - newH;
  canvas.copyInto(scaled, x, y);
  writeImage(path.join(OUT, 'idle_320.png'), canvas);

  // 白底预览
  const bg = new Image(320, 460);
  bg.fill([245, 245, 245, 255]);
  writeImage(path.join(OUT, 'idle_preview.png'), bg.over(canvas));
  console.log('saved', path.join(OUT, 'idle_preview.png'));
}

if (require.main === module) main();

module.exports = { PARTS, SCALE, ANCHOR, SRC_DIR, Layer, load, resize, removeStripe, place };