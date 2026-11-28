'use strict';
/* ==========================================================================
   通用角色骨架引擎（纯 JS，零依赖）

   输入：一份角色配置（tools/characters/<id>.json）
   输出：16 帧走路循环的分层素材 + 17 列 × 2 行精灵表

   分层约定（与游戏端 drawImage 对齐）：
     · 局部画布 stage.w × stage.h 上按锚点拼装
     · toFinal() 把整身等比缩放到 cell.body_h，脚底贴 cell.ground_y，水平居中
     · 腿/鞋绕同一个髋轴刚性旋转，因此脚踝相对位置永远不变
     · bob 只抬「上半身」（躯干+头+手），脚始终踩地

   要接新角色，只改 tools/characters/<id>.json，不用改这个文件。
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const {
  Image,
  readImage,
  writeImage,
  getRotationMatrix2D,
  warpAffine,
  pyRound,
  dilate,
  inpaintTelea,
} = require('./index');
const { ROOT } = require('./paths');

/* ------------------------------------------------------------- 配置加载 --- */

const CHARACTERS_DIR = path.join(ROOT, 'tools', 'characters');

const DEFAULTS = {
  stage: { w: 400, h: 600, origin: [200, 200], head_dy: 10 },
  arm: { amp: 12, up: 0, offset_l_x: 0, offset_r_x: 0 },
  leg: { amp: 26, hip_shift_l_x: 0 },
  shoe: { tight_crop: true, rotate_with_leg: true, align_dx: { l: 0, r: 0 }, forward_dx: 0, dy: { l: 0, r: 0 } },
  bob: 0,
  cell: { w: 320, h: 460, ground_y: 452, body_h: 408, crop: [70, 80, 330, 465] },
  sheet: { png: 'assets/hero.png', webp: 'assets/hero.webp', webp_quality: 92, frames: 16, cols: 17, rows: 2 },
  layerVariants: {},
  rows: [],
  idle: { useFrame: 0, override: {} },
};

/** 深合并：对象逐键递归，数组与标量直接覆盖 */
function merge(base, extra) {
  if (extra === undefined) return base;
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return extra;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) out[k] = merge(base[k], v);
  return out;
}

function listCharacters() {
  if (!fs.existsSync(CHARACTERS_DIR)) return [];
  return fs
    .readdirSync(CHARACTERS_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => f.slice(0, -5))
    .sort();
}

function loadConfig(id) {
  if (!id) throw new Error('缺少角色 id，例如 node tools/rig_pipeline.js hero');
  const file = path.join(CHARACTERS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`找不到角色配置 ${path.relative(ROOT, file)}（已有：${listCharacters().join(', ') || '无'}）`);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = merge(DEFAULTS, raw);
  cfg.id = raw.id || id;
  // 派生路径
  cfg.partsDir = path.join(ROOT, cfg.parts.dir);
  cfg.outDir = path.join(ROOT, 'tools', 'ref', 'rig', cfg.id);
  cfg.outPng = path.join(ROOT, cfg.sheet.png);
  cfg.outWebp = path.join(ROOT, cfg.sheet.webp);
  return cfg;
}

/* --------------------------------------------------------------- 图层 --- */

class Layer {
  constructor(img, pivot, name = '') {
    this.img = img;
    this.pivot = pivot; // 部件内部坐标（缩放后）
    this.name = name;
  }
}

function resize(im, s) {
  return im.resize(
    Math.max(1, pyRound(im.width * s)),
    Math.max(1, pyRound(im.height * s)),
    s < 1 ? 'area' : 'lanczos4'
  );
}

function resizeXY(im, sx, sy) {
  return im.resize(
    Math.max(1, pyRound(im.width * sx)),
    Math.max(1, pyRound(im.height * sy)),
    sx < 1 || sy < 1 ? 'area' : 'lanczos4'
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
  for (let o = 3; o < out.data.length; o += 4) out.data[o] = im.data[o];
  return out;
}

/** 裁成紧致小方块（去掉四周多余透明），锚点跟着平移 */
function tightLayer(im, pivot) {
  const b = im.bbox(0);
  if (!b) return new Layer(im, pivot);
  const crop = im.crop(b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  return new Layer(crop, [pivot[0] - b.x0, pivot[1] - b.y0]);
}

/** 把 layer 放到 canvas，使 pivot 对齐 target */
function place(canvas, layer, target) {
  canvas.pasteOver(layer.img, pyRound(target[0] - layer.pivot[0]), pyRound(target[1] - layer.pivot[1]));
}

function loadPart(cfg, name) {
  const file = path.join(cfg.partsDir, cfg.parts.files[name]);
  if (!fs.existsSync(file)) throw new Error(`缺少部件 ${name}（${path.relative(ROOT, file)}）`);
  return readImage(file);
}

/**
 * 按配置组装所有部件图层。
 * 锚点语义：配置里的 anchors 是「原始部件坐标」，这里统一乘缩放。
 */
function buildLayers(cfg) {
  const a = cfg.anchors;
  const s = cfg.scale;
  const flip = cfg.parts.flip || {};
  const strip = new Set(cfg.parts.removeStripe || []);
  const layers = {};

  const simple = (name) => {
    let img = loadPart(cfg, name);
    if (strip.has(name)) img = removeStripe(img);
    if (flip[name]) img = img.flipH();
    return img;
  };

  /** 部件被水平翻转后，锚点的 x 也要跟着翻：x' = 宽 - x */
  const pivotOf = (name, rawX, sx, rawY, sy) => {
    const w = loadPart(cfg, name).width;
    const x = flip[name] ? w - rawX : rawX;
    return [x * sx, rawY * sy];
  };

  /**
   * 取锚点：优先用分侧的 `<名字>_<l|r>`，没有就退回共用的 `<名字>`。
   * 左右部件互为镜像时（比如 4.png 的鞋），两侧锚点本来就不同，必须能分开写。
   */
  const anchor = (base, side) => {
    const v = a[`${base}_${side}`] || a[base];
    if (!v) throw new Error(`缺少锚点 ${base}${side ? `_${side}` : ''}`);
    return v;
  };

  // 头 / 躯干
  layers.head = new Layer(
    resize(simple('head'), s.head),
    pivotOf('head', a.head_neck[0], s.head, a.head_neck[1], s.head),
    'head'
  );
  layers.torso = new Layer(
    resize(simple('torso'), s.torso),
    pivotOf('torso', a.torso_collar[0], s.torso, a.torso_collar[1], s.torso),
    'torso'
  );

  // 手臂（绕袖口转）
  for (const side of ['l', 'r']) {
    const key = `arm_${side}`;
    const cuff = anchor('arm_cuff', side);
    layers[key] = new Layer(
      resize(simple(key), s.arm),
      pivotOf(key, cuff[0], s.arm, cuff[1], s.arm),
      key
    );
  }

  // 腿（绕髋转；x/y 可以不同比例，用来拉长腿）
  for (const side of ['l', 'r']) {
    const key = `leg_${side}`;
    const hip = anchor('leg_hip', side);
    layers[key] = new Layer(
      resizeXY(simple(key), s.leg_x, s.leg_y),
      pivotOf(key, hip[0], s.leg_x, hip[1], s.leg_y),
      key
    );
  }

  // 鞋（绕「鞋口」对齐裤脚；朝向由 parts.flip 决定，不再二次翻转）
  for (const side of ['l', 'r']) {
    const key = `shoe_${side}`;
    const opening = anchor('shoe_opening', side);
    const scaled = resize(simple(key), s.shoe);
    const pivot = pivotOf(key, opening[0], s.shoe, opening[1], s.shoe);
    layers[key] = cfg.shoe.tight_crop ? tightLayer(scaled, pivot) : new Layer(scaled, pivot, key);
    layers[key].name = key;
  }

  return layers;
}

/** 计算拼装用的锚点（局部画布坐标） */
function computeAnchors(cfg, L) {
  const origin = cfg.stage.origin.slice();
  const t = L.torso;
  const tTl = [origin[0] - t.pivot[0], origin[1] - t.pivot[1]];
  const tp = (p) => [tTl[0] + p[0] * cfg.scale.torso, tTl[1] + p[1] * cfg.scale.torso];

  const hipL = tp(cfg.anchors.torso_hip_l);
  const hipR = tp(cfg.anchors.torso_hip_r);
  hipL[0] += cfg.leg.hip_shift_l_x; // 里侧腿轴可单独外移，外侧腿轴不动
  const sleeveL = tp(cfg.anchors.torso_sleeve_l);
  const sleeveR = tp(cfg.anchors.torso_sleeve_r);
  const legHip = cfg.anchors.leg_hip_l || cfg.anchors.leg_hip;
  const legAnkle = cfg.anchors.leg_ankle_l || cfg.anchors.leg_ankle;
  const ankleDy = (legAnkle[1] - legHip[1]) * cfg.scale.leg_y;

  return {
    origin,
    torso_tl: tTl,
    head: [origin[0], origin[1] + cfg.stage.head_dy],
    arm_l: [sleeveL[0] + cfg.arm.offset_l_x, sleeveL[1]],
    arm_r: [sleeveR[0] + cfg.arm.offset_r_x, sleeveR[1]],
    hip_l: hipL,
    hip_r: hipR,
    ankle_dy: ankleDy,
  };
}

/* --------------------------------------------------------------- 渲染 --- */

function createRig(cfg) {
  const L = buildLayers(cfg);
  const A = computeAnchors(cfg, L);
  const W = cfg.stage.w;
  const H = cfg.stage.h;

  const blank = () => new Image(W, H);
  const over = (bg, fg) => bg.over(fg);

  function draw(canvas, layer, target, angle = 0, center = null) {
    let tmp = blank();
    place(tmp, layer, target);
    if (Math.abs(angle) > 1e-6) {
      const c = center || target;
      tmp = warpAffine(tmp, getRotationMatrix2D(c[0], c[1], angle, 1), W, H);
    }
    canvas.pasteOver(tmp, 0, 0);
  }

  function mirrorLayer(layer) {
    const img = layer.img.flipH();
    return new Layer(img, [img.width - layer.pivot[0], layer.pivot[1]], layer.name);
  }

  function legAngles(phase, amp = cfg.leg.amp) {
    const v = amp * Math.sin(phase);
    return [-v, v];
  }

  function renderLegsOnly(phase, amp) {
    const [lAngle, rAngle] = legAngles(phase, amp);
    const c = blank();
    draw(c, L.leg_l, A.hip_l, lAngle);
    draw(c, L.leg_r, A.hip_r, rAngle);
    return c;
  }

  /**
   * 鞋：先放在静止脚踝位置，再绕「腿的旋转中心」（髋）按同一个角度旋转。
   * 这样鞋和腿是同一根刚体，脚踝相对位置永远不变，走路不会错位。
   */
  function renderShoes(phase, amp, opts = {}) {
    const swapOrder = !!opts.swapOrder;
    const mirrorFront = !!opts.mirrorFront;
    const [lAngle, rAngle] = legAngles(phase, amp);
    const restL = [A.hip_l[0], A.hip_l[1] + A.ankle_dy];
    const restR = [A.hip_r[0], A.hip_r[1] + A.ankle_dy];
    const c = blank();
    const frontIsLeft = swapOrder;
    const shoeL = mirrorFront && frontIsLeft ? mirrorLayer(L.shoe_l) : L.shoe_l;
    const shoeR = mirrorFront && !frontIsLeft ? mirrorLayer(L.shoe_r) : L.shoe_r;
    const sh = cfg.shoe;
    const dxL = sh.align_dx.l + sh.forward_dx;
    const dxR = sh.align_dx.r + sh.forward_dx;
    const left = () =>
      draw(c, shoeL, [restL[0] + dxL, restL[1] + sh.dy.l], sh.rotate_with_leg ? lAngle : 0,
        sh.rotate_with_leg ? A.hip_l : null);
    const right = () =>
      draw(c, shoeR, [restR[0] + dxR, restR[1] + sh.dy.r], sh.rotate_with_leg ? rAngle : 0,
        sh.rotate_with_leg ? A.hip_r : null);
    if (swapOrder) {
      right();
      left();
    } else {
      left();
      right();
    }
    return c;
  }

  function renderLegs(phase, amp) {
    // 裤腿在下、鞋在上；鞋口与裤腿共用同一个旋转中心
    return over(renderLegsOnly(phase, amp), renderShoes(phase, amp));
  }

  function renderTorso() {
    const c = blank();
    draw(c, L.torso, A.origin, 0);
    draw(c, L.head, A.head, 0);
    return c;
  }

  function renderArms(phase, which = 'both', amp = cfg.arm.amp) {
    const c = blank();
    const up = cfg.arm.up;
    if (which === 'both' || which === 'far') {
      draw(c, L.arm_l, [A.arm_l[0], A.arm_l[1] - up], amp * Math.sin(phase));
    }
    if (which === 'both' || which === 'near') {
      draw(c, L.arm_r, [A.arm_r[0], A.arm_r[1] - up], -amp * Math.sin(phase));
    }
    return c;
  }

  function renderBody(phase, amp) {
    return over(renderLegs(phase, amp), renderTorso());
  }

  function render(phase, ampLeg = cfg.leg.amp, ampArm = cfg.arm.amp) {
    return over(over(over(renderLegs(phase, ampLeg), renderArms(phase, 'far', ampArm)), renderTorso()),
      renderArms(phase, 'near', ampArm));
  }

  /* --------------------------------------------------------- 最终画格 --- */

  function idleMetrics() {
    const c = render(0, 0, 0);
    return { c, metrics: c.bbox(0) };
  }

  function toFinal(local, metrics) {
    const [wx0, wy0, wx1, wy1] = cfg.cell.crop;
    const h = metrics.y1 - metrics.y0 + 1;
    const s = cfg.cell.body_h / h;
    const cw = wx1 - wx0 + 1;
    const ch = wy1 - wy0 + 1;
    const nw = pyRound(cw * s);
    const nh = pyRound(ch * s);
    const scaled = local.crop(wx0, wy0, cw, ch).resize(nw, nh, 'area');
    const out = new Image(cfg.cell.w, cfg.cell.h);
    out.copyInto(scaled, Math.floor(cfg.cell.w / 2) - Math.floor(nw / 2), cfg.cell.ground_y - nh);
    return out;
  }

  function translate(img, dy) {
    return warpAffine(img, [1, 0, 0, 0, 1, dy], img.width, img.height);
  }

  /** 渲染一帧的全部图层（已经过 toFinal + 贴地 + 颠簸） */
  function renderFrame(phase, metrics) {
    const amp = cfg.leg.amp;
    const body = toFinal(renderBody(phase, amp), metrics);
    const legs = toFinal(renderLegs(phase, amp), metrics);
    const legsonly = toFinal(renderLegsOnly(phase, amp), metrics);
    const shoes = toFinal(renderShoes(phase, amp), metrics);
    const torso = toFinal(renderTorso(), metrics);
    const armfar = toFinal(renderArms(phase, 'far'), metrics);
    const armnear = toFinal(renderArms(phase, 'near'), metrics);

    const variants = {};
    for (const [name, spec] of Object.entries(cfg.layerVariants || {})) {
      const kind = spec.kind || name;
      if (kind === 'shoes') {
        variants[name] = toFinal(
          renderShoes(phase, amp, { swapOrder: !!spec.swapOrder, mirrorFront: !!spec.mirrorFront }),
          metrics
        );
      }
    }

    // 脚底贴地
    const bottom = body.bbox(0).y1;
    const dy = cfg.cell.ground_y - bottom;
    const mv = (img) => (dy ? translate(img, dy) : img);
    // 颠簸：只抬上半身，脚保持贴地
    const bob = Math.round(cfg.bob * Math.abs(Math.sin(phase)));
    const mvUp = (img) => {
      const base = mv(img);
      return bob ? translate(base, bob) : base;
    };

    const out = {
      body: mv(body),
      legs: mv(legs),
      legsonly: mv(legsonly),
      shoes: mv(shoes),
      torso: mvUp(torso),
      armfar: mvUp(armfar),
      armnear: mvUp(armnear),
    };
    for (const [name, img] of Object.entries(variants)) out[name] = mv(img);
    return out;
  }

  return {
    cfg,
    layers: L,
    anchors: A,
    render,
    renderBody,
    renderLegs,
    renderLegsOnly,
    renderShoes,
    renderTorso,
    renderArms,
    idleMetrics,
    toFinal,
    renderFrame,
    translate,
  };
}

/* ----------------------------------------------------------- 打包精灵表 --- */

/**
 * 按 rows 声明把一列图层叠起来。
 *
 * 每一项可以是：
 *   { "src": "legsonly", "flip": true }   叶子：取该图层（可选水平翻转）
 *   { "group": [ ... ] }                  分组：组内左折叠后再作为一个整体叠上去
 *
 * 分组会影响 8 位 alpha 混合的舍入结果，因此「哪几层先合成一块」是可以精确控制的。
 * 默认写法（不分组）等价于从左到右逐层 over。
 */
function composeItems(items, layersForFrame, rowName) {
  let cell = null;
  for (const item of items) {
    let layer;
    if (item.group) {
      layer = composeItems(item.group, layersForFrame, rowName);
    } else {
      const img = layersForFrame[item.src];
      if (!img) throw new Error(`行「${rowName}」引用了不存在的图层 ${item.src}`);
      layer = item.flip ? img.flipH() : img;
    }
    cell = cell ? cell.over(layer) : layer;
  }
  if (!cell) throw new Error(`行「${rowName}」里有空分组`);
  return cell;
}

function composeCell(rowSpec, layersForFrame) {
  return composeItems(rowSpec.layers, layersForFrame, rowSpec.name);
}

function buildSheet(cfg, frames) {
  const { cols, rows } = cfg.sheet;
  const { w: CW, h: CH } = cfg.cell;
  if (frames.length !== cols) throw new Error(`帧数 ${frames.length} 与 sheet.cols ${cols} 不一致`);
  if (cfg.rows.length !== rows) throw new Error(`rows 声明 ${cfg.rows.length} 行，与 sheet.rows ${rows} 不一致`);

  const sheet = new Image(CW * cols, CH * rows);
  frames.forEach((frameLayers, c) => {
    cfg.rows.forEach((rowSpec, r) => {
      sheet.copyInto(composeCell(rowSpec, frameLayers), c * CW, r * CH);
    });
  });
  return sheet;
}

/** 生成 17 列（第 0 列静止 + 16 帧走路）的帧数组 */
function buildAllFrames(cfg) {
  const rig = createRig(cfg);
  const idle = rig.idleMetrics();
  const N = cfg.sheet.frames;
  const walk = [];
  for (let i = 0; i < N; i++) {
    walk.push(rig.renderFrame((2 * Math.PI * i) / N, idle.metrics));
  }
  // 静止帧：用某一帧的图层，按 idle.override 换掉指定层
  const idleFrame = { ...walk[cfg.idle.useFrame] };
  for (const [key, variant] of Object.entries(cfg.idle.override || {})) {
    if (!walk[cfg.idle.useFrame][variant]) throw new Error(`idle.override 引用了不存在的图层 ${variant}`);
    idleFrame[key] = walk[cfg.idle.useFrame][variant];
  }
  return { rig, idle, walk, frames: [idleFrame, ...walk] };
}

/* ------------------------------------------------------------- 写盘 --- */

function writeFrames(cfg, walk) {
  fs.mkdirSync(cfg.outDir, { recursive: true });
  // 清掉上一版留下的 walk_*.png，避免旧图层（比如已废弃的 shoesswap）混进来
  for (const f of fs.readdirSync(cfg.outDir)) {
    if (/^walk_\d+.*\.png$/.test(f)) fs.rmSync(path.join(cfg.outDir, f));
  }
  const tag = (i) => String(i).padStart(2, '0');
  walk.forEach((layersForFrame, i) => {
    for (const [name, img] of Object.entries(layersForFrame)) {
      writeImage(path.join(cfg.outDir, `walk_${tag(i)}_${name}.png`), img);
    }
    const flat = ['armfar', 'body', 'armnear']
      .map((k) => layersForFrame[k])
      .reduce((acc, img) => (acc ? acc.over(img) : img), null);
    writeImage(path.join(cfg.outDir, `walk_${tag(i)}.png`), flat);
  });
  // 预览条
  const thumbs = walk.map((f) => f.body.resize(160, 230, 'area'));
  const width = thumbs.reduce((s, t) => s + t.width, 0);
  const strip = new Image(width, 230);
  let x = 0;
  for (const t of thumbs) {
    strip.copyInto(t, x, 0);
    x += t.width;
  }
  const bg = new Image(strip.width, strip.height);
  bg.fill([245, 245, 245, 255]);
  writeImage(path.join(cfg.outDir, 'walk_strip.png'), bg.over(strip));
  return cfg.outDir;
}

function writeSheet(cfg, sheet) {
  writeImage(cfg.outPng, sheet, { level: 6 });
  writeImage(cfg.outWebp, sheet, { quality: cfg.sheet.webp_quality });
  return { png: cfg.outPng, webp: cfg.outWebp };
}

/* --------------------------------------------------- 鞋口/裤脚自动测量 --- */

/**
 * 量出「裤脚中心」和「鞋口中心」的相对位置，给出鞋应该横移多少才能对齐。
 *
 * 判定依据（不靠猜）：
 *   · 裤脚中心 = 裤腿部件最底部若干行不透明像素的横向重心
 *   · 鞋口中心 = 鞋部件最顶部若干行「深色」像素的横向重心（鞋口是暗的，鞋面是亮的）
 *
 * 返回每一侧的推荐 align_dx（局部画布像素），写进配置的 shoe.align_dx 即可。
 */
function measureAlignment(cfg) {
  const m = cfg.measure || {};
  const maxBand = m.band || 14;
  const cuffBand = m.cuffBand || 10;
  const dark = m.dark || 70;
  const jump = m.jump || 1.6;

  const info = (name) => {
    const img = loadPart(cfg, name);
    return { img, w: img.width, h: img.height, flipped: !!(cfg.parts.flip || {})[name] };
  };

  const cuffCenter = (im, rows) => {
    const d = im.img.data;
    const W = im.img.width;
    let sx = 0;
    let n = 0;
    for (let y = im.h - rows; y < im.h; y++) {
      if (y < 0) continue;
      for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 8) {
          sx += x;
          n++;
        }
      }
    }
    return n ? sx / n : NaN;
  };

  /**
   * 鞋口 = 鞋顶部那段「又窄又暗」的开口。
   *
   * 不能简单取顶部 N 行的暗色重心：鞋身本身也有暗部，行数取多了重心就被鞋面拽偏
   * （4.png 的鞋就是这样，直接量会偏出 20 多像素）。
   * 这里先找出开口结束的行 —— 从最顶上开始，第一行宽度突然变宽（> 顶部宽度 × jump）就停，
   * 再在这几行里取暗色重心。
   */
  const openingCenter = (im) => {
    const d = im.img.data;
    const W = im.img.width;
    const H = im.h;
    const span = (y) => {
      let a = -1;
      let b = -1;
      for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 8) {
          if (a < 0) a = x;
          b = x;
        }
      }
      return b < 0 ? 0 : b - a + 1;
    };
    const topW = span(0);
    let end = Math.min(maxBand, H);
    for (let y = 1; y < end; y++) {
      if (span(y) > topW * jump) {
        end = y;
        break;
      }
    }
    let sx = 0;
    let n = 0;
    for (let y = 0; y < end; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (d[o + 3] <= 8) continue;
        const lum = (d[o] + d[o + 1] + d[o + 2]) / 3;
        if (lum < dark) {
          sx += x;
          n++;
        }
      }
    }
    return { cx: n ? sx / n : NaN, rows: end, topWidth: topW };
  };

  const out = {};
  for (const side of ['l', 'r']) {
    const leg = info(`leg_${side}`);
    const shoe = info(`shoe_${side}`);
    const rawCuff = cuffCenter(leg, cuffBand);
    const open = openingCenter(shoe);
    const rawOpen = open.cx;
    // 翻转过的部件，x 要镜像回来
    const cuffX = leg.flipped ? leg.w - rawCuff : rawCuff;
    const openX = shoe.flipped ? shoe.w - rawOpen : rawOpen;
    const hipAnchor = cfg.anchors[`leg_hip_${side}`] || cfg.anchors.leg_hip;
    const openAnchor = cfg.anchors[`shoe_opening_${side}`] || cfg.anchors.shoe_opening;
    const hipX = hipAnchor[0];
    const pivotX = openAnchor[0];
    const cuffLocal = (cuffX - (leg.flipped ? leg.w - hipX : hipX)) * cfg.scale.leg_x;
    const openLocal = (openX - (shoe.flipped ? shoe.w - pivotX : pivotX)) * cfg.scale.shoe;
    out[side] = {
      cuffRaw: rawCuff,
      openRaw: rawOpen,
      openRows: open.rows,
      cuffLocal,
      openLocal,
      alignDx: cuffLocal - openLocal,
      current: cfg.shoe.align_dx[side],
    };
  }
  return out;
}

module.exports = {
  CHARACTERS_DIR,
  listCharacters,
  loadConfig,
  createRig,
  buildLayers,
  computeAnchors,
  buildAllFrames,
  buildSheet,
  composeCell,
  composeItems,
  measureAlignment,
  writeFrames,
  writeSheet,
  Layer,
};
