'use strict';
/* ==========================================================================
   用 3.png 拆件做 16 帧走路循环预览。

   骨架在 400x600 局部画布上组装；双腿绕髋、双臂绕袖口旋转，鞋保持水平并
   跟着脚踝走。
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { Image, writeImage, getRotationMatrix2D, warpAffine, pyRound } = require('./lib');
const { ANCHOR, Layer, load, place, removeStripe, resize } = require('./rig3_assemble');

const { ROOT } = require('./lib/paths');
const OUT = path.join(ROOT, 'tools', 'ref', 'rig', 'rig3');
const W = 400;
const H = 600;

// C 版比例：把腿拉长、躯干收窄，往现在 hero 的比例靠
const SCALE = { head: 0.64, torso: 0.66, arm: 0.52, shoe: 0.6 };
const LEG_SX = 0.52;
const LEG_SY = 0.84;

// 鞋位置微调（局部像素；正数 = 右/下，负数 = 左/上）
const SHOE_L_DX = 0;
const SHOE_L_DY = 0;
const SHOE_R_DX = 0;
const SHOE_R_DY = 0;

function resizeXY(im, sx, sy) {
  return im.resize(
    Math.max(1, pyRound(im.width * sx)),
    Math.max(1, pyRound(im.height * sy)),
    sx < 1 ? 'area' : 'lanczos4'
  );
}

let layerCache = null;

function makeLayers() {
  if (layerCache) return layerCache;
  // 3.png 里的头和躯干本来就是朝右的（和旧 hero 同向），不要再镜像
  const torso = new Layer(
    resize(load('torso'), SCALE.torso),
    [ANCHOR.torso_collar[0] * SCALE.torso, ANCHOR.torso_collar[1] * SCALE.torso]
  );
  const head = new Layer(
    resize(load('head'), SCALE.head),
    [ANCHOR.head_neck[0] * SCALE.head, ANCHOR.head_neck[1] * SCALE.head]
  );
  const armL = new Layer(
    resize(load('arm_l'), SCALE.arm),
    [ANCHOR.arm_cuff[0] * SCALE.arm, ANCHOR.arm_cuff[1] * SCALE.arm]
  );
  const armR = new Layer(
    resize(load('arm_r'), SCALE.arm),
    [ANCHOR.arm_cuff[0] * SCALE.arm, ANCHOR.arm_cuff[1] * SCALE.arm]
  );
  const legL = new Layer(
    resizeXY(removeStripe(load('leg_l')), LEG_SX, LEG_SY), // 内侧（左）腿去掉条纹
    [ANCHOR.leg_hip[0] * LEG_SX, ANCHOR.leg_hip[1] * LEG_SY]
  );
  const legRImg = load('leg_r').flipH();
  const wR = legRImg.width;
  const legR = new Layer(
    resizeXY(legRImg, LEG_SX, LEG_SY), // 外侧（右）腿保留条纹
    [(wR - ANCHOR.leg_hip[0]) * LEG_SX, ANCHOR.leg_hip[1] * LEG_SY]
  );
  // p07 原图朝左，需要翻；p08 原图本来就朝右，不要再翻
  const shoeLImg = load('shoe_l').flipH();
  const swL = shoeLImg.width;
  const shoeL = new Layer(
    resize(shoeLImg, SCALE.shoe),
    [(swL - ANCHOR.shoe_ankle[0]) * SCALE.shoe, ANCHOR.shoe_ankle[1] * SCALE.shoe]
  );
  const shoeRImg = load('shoe_r').flipH();
  const swR = shoeRImg.width;
  const shoeR = new Layer(
    resize(shoeRImg, SCALE.shoe),
    [(swR - ANCHOR.shoe_ankle[0]) * SCALE.shoe, ANCHOR.shoe_ankle[1] * SCALE.shoe]
  );
  layerCache = { torso, head, arm_l: armL, arm_r: armR, leg_l: legL, leg_r: legR, shoe_l: shoeL, shoe_r: shoeR };
  return layerCache;
}

function anchors(L) {
  const t = L.torso;
  const origin = [200, 200]; // 领口位置
  const tTl = [origin[0] - t.pivot[0], origin[1] - t.pivot[1]];
  const tp = (p) => [tTl[0] + p[0] * SCALE.torso, tTl[1] + p[1] * SCALE.torso];

  const hipL = tp(ANCHOR.torso_hip_l);
  const hipR = tp(ANCHOR.torso_hip_r);
  const sleeveL = tp(ANCHOR.torso_sleeve_l);
  const sleeveR = tp(ANCHOR.torso_sleeve_r);
  const ankleDy = (ANCHOR.leg_ankle[1] - ANCHOR.leg_hip[1]) * LEG_SY;
  return {
    origin,
    torso_tl: tTl,
    head: [origin[0], origin[1] + 10],
    arm_l: [sleeveL[0] - 4, sleeveL[1]],
    arm_r: [sleeveR[0] + 3, sleeveR[1]],
    hip_l: hipL,
    hip_r: hipR,
    ankle_dy: ankleDy,
  };
}

function blank() {
  return new Image(W, H);
}

function draw(canvas, layer, target, angle = 0) {
  let tmp = blank();
  place(tmp, layer, target);
  if (Math.abs(angle) > 1e-6) {
    const M = getRotationMatrix2D(target[0], target[1], angle, 1);
    tmp = warpAffine(tmp, M, W, H);
  }
  canvas.pasteOver(tmp, 0, 0);
}

function rotatePoint(p, c, deg) {
  const r = (deg * Math.PI) / 180;
  const x = p[0] - c[0];
  const y = p[1] - c[1];
  return [c[0] + x * Math.cos(r) - y * Math.sin(r), c[1] + x * Math.sin(r) + y * Math.cos(r)];
}

function over(bg, fg) {
  return bg.over(fg);
}

function legAngles(phase, ampLeg) {
  const legAngle = ampLeg * Math.sin(phase);
  return [-legAngle, legAngle];
}

function renderLegs(phase, ampLeg = 26) {
  const L = makeLayers();
  const A = anchors(L);
  const [lAngle, rAngle] = legAngles(phase, ampLeg);
  const ankleL = rotatePoint([A.hip_l[0], A.hip_l[1] + A.ankle_dy], A.hip_l, lAngle);
  const ankleR = rotatePoint([A.hip_r[0], A.hip_r[1] + A.ankle_dy], A.hip_r, rAngle);
  const canvas = blank();
  // 鞋和裤腿画在同一层、同一个脚踝位置；裤腿后画，裤脚盖住鞋口
  draw(canvas, L.shoe_l, [ankleL[0] + SHOE_L_DX, ankleL[1] + SHOE_L_DY], 0);
  draw(canvas, L.leg_l, A.hip_l, lAngle);
  draw(canvas, L.shoe_r, [ankleR[0] + SHOE_R_DX, ankleR[1] + SHOE_R_DY], 0);
  draw(canvas, L.leg_r, A.hip_r, rAngle);
  return canvas;
}

function renderShoe(side, phase, ampLeg = 26) {
  const L = makeLayers();
  const A = anchors(L);
  const [lAngle, rAngle] = legAngles(phase, ampLeg);
  const canvas = blank();
  if (side === 'l') {
    const ankle = rotatePoint([A.hip_l[0], A.hip_l[1] + A.ankle_dy], A.hip_l, lAngle);
    draw(canvas, L.shoe_l, ankle, 0);
  } else {
    const ankle = rotatePoint([A.hip_r[0], A.hip_r[1] + A.ankle_dy], A.hip_r, rAngle);
    draw(canvas, L.shoe_r, ankle, 0);
  }
  return canvas;
}

function renderTorso() {
  const L = makeLayers();
  const A = anchors(L);
  const canvas = blank();
  draw(canvas, L.torso, A.origin, 0);
  draw(canvas, L.head, A.head, 0);
  return canvas;
}

function renderBody(phase, ampLeg = 26) {
  return over(renderLegs(phase, ampLeg), renderTorso());
}

function renderArms(phase, ampArm = 12, which = 'both') {
  const L = makeLayers();
  const A = anchors(L);
  const canvas = blank();
  const armUp = 6; // 两只手整体上移
  if (which === 'both' || which === 'far') {
    draw(canvas, L.arm_l, [A.arm_l[0], A.arm_l[1] - armUp], ampArm * Math.sin(phase));
  }
  if (which === 'both' || which === 'near') {
    draw(canvas, L.arm_r, [A.arm_r[0], A.arm_r[1] - armUp], -ampArm * Math.sin(phase));
  }
  return canvas;
}

function render(phase, ampLeg = 26, ampArm = 12) {
  const legs = renderLegs(phase, ampLeg);
  const torso = renderTorso();
  const far = renderArms(phase, ampArm, 'far');
  const near = renderArms(phase, ampArm, 'near');
  return over(over(over(legs, far), torso), near);
}

function idleMetrics() {
  const c = render(0, 0, 0);
  return { c, metrics: c.bbox(0) };
}

function toFinal(local, metrics, groundY = 452, bodyH = 408) {
  const h = metrics.y1 - metrics.y0 + 1;
  const s = bodyH / h;
  // 用固定窗口裁切：走路时腿/鞋会摆出站立 bbox，必须留足两侧空间，
  // 否则鞋尖会被裁掉（游戏里看起来像鞋和腿断开）。
  const wx0 = 70, wx1 = 330;
  const wy0 = 80, wy1 = 465;
  const nw = pyRound((wx1 - wx0 + 1) * s);
  const nh = pyRound((wy1 - wy0 + 1) * s);
  const crop = local.crop(wx0, wy0, wx1 - wx0 + 1, wy1 - wy0 + 1);
  const scaled = crop.resize(nw, nh, 'area');
  const out = new Image(320, 460);
  const x = 160 - Math.floor(nw / 2);
  const y = groundY - nh;
  out.copyInto(scaled, x, y);
  return out;
}

function translate(img, dy) {
  return warpAffine(img, [1, 0, 0, 0, 1, dy], img.width, img.height);
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const idle = idleMetrics();
  writeImage(path.join(OUT, 'idle_local.png'), idle.c);
  writeImage(path.join(OUT, 'idle_final.png'), toFinal(idle.c, idle.metrics));

  const N = 16;
  const frames = [];
  for (let i = 0; i < N; i++) {
    const p = (2 * Math.PI * i) / N;
    const body = toFinal(renderBody(p), idle.metrics); // 腿+鞋+躯干+头
    const far = toFinal(renderArms(p, 12, 'far'), idle.metrics);
    const near = toFinal(renderArms(p, 12, 'near'), idle.metrics);
    // 脚底贴地：用身体最低点，整帧上下移动
    const b = body.bbox(0);
    const bottom = b.y1;
    const dy = 452 - bottom;
    if (dy) {
      frames.push(null); // 占位，下面覆盖
      const tb = translate(body, dy);
      const tf = translate(far, dy);
      const tn = translate(near, dy);
      writeImage(path.join(OUT, `walk_${String(i).padStart(2, '0')}_body.png`), tb);
      writeImage(path.join(OUT, `walk_${String(i).padStart(2, '0')}_armfar.png`), tf);
      writeImage(path.join(OUT, `walk_${String(i).padStart(2, '0')}_armnear.png`), tn);
      frames[frames.length - 1] = over(over(tf, tb), tn);
    } else {
      writeImage(path.join(OUT, `walk_${String(i).padStart(2, '0')}_body.png`), body);
      writeImage(path.join(OUT, `walk_${String(i).padStart(2, '0')}_armfar.png`), far);
      writeImage(path.join(OUT, `walk_${String(i).padStart(2, '0')}_armnear.png`), near);
      frames.push(over(over(far, body), near));
    }
  }

  // 拼图预览
  const thumbs = frames.map((f) => f.resize(160, 230, 'area'));
  const width = thumbs.reduce((s, t) => s + t.width, 0);
  const strip = new Image(width, 230);
  let x = 0;
  for (const t of thumbs) {
    strip.copyInto(t, x, 0);
    x += t.width;
  }
  const bg = new Image(strip.width, strip.height);
  bg.fill([245, 245, 245, 255]);
  writeImage(path.join(OUT, 'walk_strip.png'), bg.over(strip));
  console.log('saved strip', strip.width + 'x' + strip.height);

  // 每帧单独保存，方便检查
  frames.forEach((f, i) => writeImage(path.join(OUT, `walk_${String(i).padStart(2, '0')}.png`), f));
}

if (require.main === module) main();

module.exports = { makeLayers, anchors, render, renderArms, renderBody, toFinal };