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
// 让鞋口中心对准裤脚中心（实测偏移量算出来的）
const SHOE_ALIGN_L_DX = -2;
const SHOE_ALIGN_R_DX = 1;
// 再整体往人物朝向（局部 +x）方向挪 10 像素（局部 9px ≈ 最终 10px）
const SHOE_FORWARD_DX = 9;
const SHOE_L_DX = SHOE_ALIGN_L_DX + SHOE_FORWARD_DX;
const SHOE_L_DY = 0;
const SHOE_R_DX = SHOE_ALIGN_R_DX + SHOE_FORWARD_DX;
const SHOE_R_DY = 0;

// 走路时身体的上下颠簸幅度（最终 320x460 画布上的像素）
const BOB = 3;

// 里侧（左）腿的髋部旋转轴再往外挪一点，外侧（右）腿的轴不动
const HIP_L_SHIFT_X = -6; // 局部像素，负数 = 更靠左（远离外侧腿）

function resizeXY(im, sx, sy) {
  return im.resize(
    Math.max(1, pyRound(im.width * sx)),
    Math.max(1, pyRound(im.height * sy)),
    sx < 1 ? 'area' : 'lanczos4'
  );
}

// 鞋只保留自身的紧致小矩形，不带周围多余透明区域；同时修正锚点坐标。
function tightLayer(im, pivot) {
  const b = im.bbox(0);
  if (b.x1 < b.x0 || b.y1 < b.y0) return new Layer(im, pivot);
  const crop = im.crop(b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  return new Layer(crop, [pivot[0] - b.x0, pivot[1] - b.y0]);
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
  // 两只鞋都再水平翻一次：朝向整体反过来
  const shoeLImg = load('shoe_l');
  const swL = shoeLImg.width;
  const shoeLScaled = resize(shoeLImg, SCALE.shoe);
  const shoeL = tightLayer(
    shoeLScaled,
    [ANCHOR.shoe_ankle[0] * SCALE.shoe, ANCHOR.shoe_ankle[1] * SCALE.shoe]
  );
  const shoeRImg = load('shoe_r');
  const swR = shoeRImg.width;
  const shoeRScaled = resize(shoeRImg, SCALE.shoe);
  const shoeR = tightLayer(
    shoeRScaled,
    [ANCHOR.shoe_ankle[0] * SCALE.shoe, ANCHOR.shoe_ankle[1] * SCALE.shoe]
  );
  layerCache = { torso, head, arm_l: armL, arm_r: armR, leg_l: legL, leg_r: legR, shoe_l: shoeL, shoe_r: shoeR };
  return layerCache;
}

function anchors(L) {
  const t = L.torso;
  const origin = [200, 200]; // 领口位置
  const tTl = [origin[0] - t.pivot[0], origin[1] - t.pivot[1]];
  const tp = (p) => [tTl[0] + p[0] * SCALE.torso, tTl[1] + p[1] * SCALE.torso];

  const hipL = [tp(ANCHOR.torso_hip_l)[0] + HIP_L_SHIFT_X, tp(ANCHOR.torso_hip_l)[1]];
  const hipR = tp(ANCHOR.torso_hip_r); // 外侧腿轴保持不动
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

function draw(canvas, layer, target, angle = 0, center = null) {
  let tmp = blank();
  place(tmp, layer, target);
  if (Math.abs(angle) > 1e-6) {
    // center 缺省时绕目标点旋转；传入 center 则绕该点旋转（与腿共用旋转中心）
    const c = center || target;
    const M = getRotationMatrix2D(c[0], c[1], angle, 1);
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

function renderLegsOnly(phase, ampLeg = 26) {
  const L = makeLayers();
  const A = anchors(L);
  const [lAngle, rAngle] = legAngles(phase, ampLeg);
  const canvas = blank();
  draw(canvas, L.leg_l, A.hip_l, lAngle);
  draw(canvas, L.leg_r, A.hip_r, rAngle);
  return canvas;
}

/** 复制一个左右镜像的图层（pivot 也跟着翻）。 */
function mirrorLayer(layer) {
  const img = layer.img.flipH();
  return new Layer(img, [img.width - layer.pivot[0], layer.pivot[1]]);
}

function renderShoes(phase, ampLeg = 26, swapOrder = false, mirrorFront = false) {
  const L = makeLayers();
  const A = anchors(L);
  const [lAngle, rAngle] = legAngles(phase, ampLeg);
  // 鞋挂在脚踝上，随腿一起绕「腿的旋转中心」（髋部）转动，和腿是同一根刚体。
  const restAnkleL = [A.hip_l[0], A.hip_l[1] + A.ankle_dy];
  const restAnkleR = [A.hip_r[0], A.hip_r[1] + A.ankle_dy];
  const canvas = blank();
  // swapOrder=false：先左后右，右鞋在前；swapOrder=true：先右后左，左鞋在前
  const frontIsLeft = swapOrder;
  const shoeL = mirrorFront && frontIsLeft ? mirrorLayer(L.shoe_l) : L.shoe_l;
  const shoeR = mirrorFront && !frontIsLeft ? mirrorLayer(L.shoe_r) : L.shoe_r;
  const left = () =>
    draw(canvas, shoeL, [restAnkleL[0] + SHOE_L_DX, restAnkleL[1] + SHOE_L_DY], lAngle, A.hip_l);
  const right = () =>
    draw(canvas, shoeR, [restAnkleR[0] + SHOE_R_DX, restAnkleR[1] + SHOE_R_DY], rAngle, A.hip_r);
  if (swapOrder) { right(); left(); } else { left(); right(); }
  return canvas;
}

function renderLegs(phase, ampLeg = 26) {
  // 裤腿在下、鞋在上；鞋口与裤腿共用脚踝锚点。
  return over(renderLegsOnly(phase, ampLeg), renderShoes(phase, ampLeg));
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
  const armUp = 11; // 两只手整体上移（再往上一点）
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
    const legs = toFinal(renderLegs(p), idle.metrics); // 腿+鞋（单独一层，供左右换腿用）
    const legsonly = toFinal(renderLegsOnly(p), idle.metrics); // 只有裤腿（不含鞋）
    const shoes = toFinal(renderShoes(p), idle.metrics); // 只有两只鞋
    const shoesSwap = toFinal(renderShoes(p, 26, true), idle.metrics); // 两只鞋前后层对调
    // 静止帧用：两只鞋朝向一致（不镜像），只保留前后层顺序
    const idleShoes = toFinal(renderShoes(p, 26, true, false), idle.metrics);
    const torso = toFinal(renderTorso(), idle.metrics); // 躯干+头（单独一层）
    const far = toFinal(renderArms(p, 12, 'far'), idle.metrics);
    const near = toFinal(renderArms(p, 12, 'near'), idle.metrics);
    const tag = String(i).padStart(2, '0');
    // 脚底贴地：用身体最低点，整帧上下移动（腿和鞋始终踩在地上）
    const b = body.bbox(0);
    const bottom = b.y1;
    const dy = 452 - bottom;
    const mv = (img) => (dy ? translate(img, dy) : img);
    // 上下颠簸：只让上半身（躯干+头+手）起伏，脚保持贴地；
    // 双腿分开（接触地面）时重心最低，并拢时最高，静止帧为 0。
    const bob = Math.round(BOB * Math.abs(Math.sin(p)));
    const mvUp = (img) => {
      const base = mv(img);
      return bob ? translate(base, bob) : base;
    };
    const tb = mv(body);
    const tl = mv(legs);
    const tlo = mv(legsonly);
    const tsh = mv(shoes);
    const tss = mv(shoesSwap);
    const tis = mv(idleShoes);
    const tt = mvUp(torso);
    const tf = mvUp(far);
    const tn = mvUp(near);
    writeImage(path.join(OUT, `walk_${tag}_body.png`), tb);
    writeImage(path.join(OUT, `walk_${tag}_legs.png`), tl);
    writeImage(path.join(OUT, `walk_${tag}_legsonly.png`), tlo);
    writeImage(path.join(OUT, `walk_${tag}_shoes.png`), tsh);
    writeImage(path.join(OUT, `walk_${tag}_shoesswap.png`), tss);
    if (i === 0) writeImage(path.join(OUT, 'walk_00_shoesidle.png'), tis);
    writeImage(path.join(OUT, `walk_${tag}_torso.png`), tt);
    writeImage(path.join(OUT, `walk_${tag}_armfar.png`), tf);
    writeImage(path.join(OUT, `walk_${tag}_armnear.png`), tn);
    frames.push(over(over(tf, tb), tn));
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

module.exports = { makeLayers, anchors, render, renderArms, renderBody, renderLegs, renderLegsOnly, renderShoes, renderTorso, toFinal };