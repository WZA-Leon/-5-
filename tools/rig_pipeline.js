'use strict';
/* ==========================================================================
   通用角色流水线 CLI

   node tools/rig_pipeline.js <角色id>            生成分层帧 + 精灵表（默认）
   node tools/rig_pipeline.js <角色id> --frames   只生成分层帧
   node tools/rig_pipeline.js <角色id> --sheet    只打包精灵表（复用已有帧）
   node tools/rig_pipeline.js <角色id> --report   打印锚点/尺寸自检
   node tools/rig_pipeline.js <角色id> --measure  量鞋口与裤脚，给出对齐建议
   node tools/rig_pipeline.js --list              列出所有角色配置
   node tools/rig_pipeline.js --init <新id>       从模板新建一份角色配置

   角色配置：tools/characters/<id>.json（详见 tools/CHARACTERS.md）
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const {
  listCharacters,
  loadConfig,
  createRig,
  buildAllFrames,
  buildSheet,
  writeFrames,
  writeSheet,
  measureAlignment,
  CHARACTERS_DIR,
} = require('./lib/rig');
const { readImage, writeImage } = require('./lib');
const { ROOT, toUrlPath } = require('./lib/paths');

const TEMPLATE = '_template.json';

function parseArgs(argv) {
  const opts = { id: null, frames: false, sheet: false, list: false, report: false, measure: false, init: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') opts.list = true;
    else if (arg === '--frames') opts.frames = true;
    else if (arg === '--sheet') opts.sheet = true;
    else if (arg === '--report') opts.report = true;
    else if (arg === '--measure') opts.measure = true;
    else if (arg === '--init') opts.init = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`未知参数 ${arg}`);
    else opts.id = arg;
  }
  if (!opts.frames && !opts.sheet) {
    opts.frames = true;
    opts.sheet = true;
  }
  return opts;
}

function initCharacter(id) {
  if (!id) throw new Error('--init 需要角色 id，例如 --init teacher');
  const file = path.join(CHARACTERS_DIR, `${id}.json`);
  if (fs.existsSync(file)) throw new Error(`已存在 ${toUrlPath(file)}`);
  const tpl = path.join(CHARACTERS_DIR, TEMPLATE);
  if (!fs.existsSync(tpl)) throw new Error(`缺少模板 ${toUrlPath(tpl)}`);
  const cfg = JSON.parse(fs.readFileSync(tpl, 'utf8'));
  cfg.id = id;
  cfg.name = id;
  cfg.parts.dir = `tools/ref/rig/${id}_parts`;
  cfg.sheet.png = `assets/${id}.png`;
  cfg.sheet.webp = `assets/${id}.webp`;
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`已创建 ${toUrlPath(file)}`);
  console.log('接下来：');
  console.log(`  1. 把 8 个部件图放进 ${cfg.parts.dir}/（文件名见配置 parts.files）`);
  console.log(`  2. 按实际尺寸调 parts.files / anchors / scale`);
  console.log(`  3. node tools/rig_pipeline.js ${id} --measure   看鞋口与裤脚差多少`);
  console.log(`  4. node tools/rig_pipeline.js ${id} --report    看整体比例`);
  console.log(`  5. node tools/rig_pipeline.js ${id}             出帧 + 出表`);
}

function report(cfg) {
  const rig = createRig(cfg);
  const idle = rig.idleMetrics();
  const A = rig.anchors;
  const h = idle.metrics.y1 - idle.metrics.y0 + 1;
  const s = cfg.cell.body_h / h;
  const line = (k, v) => console.log(`  ${k.padEnd(14)} ${v}`);
  console.log(`\n[${cfg.id}] ${cfg.name || ''}`);
  line('部件目录', toUrlPath(cfg.partsDir));
  line('输出帧', toUrlPath(cfg.outDir));
  line('精灵表', `${toUrlPath(cfg.outPng)}  ${cfg.sheet.cols} 列 × ${cfg.sheet.rows} 行`);
  line('局部画布', `${cfg.stage.w}×${cfg.stage.h}`);
  line('站立高度', `${h}px（缩放 ${s.toFixed(4)} → ${cfg.cell.body_h}px）`);
  line('髋轴 左', `(${A.hip_l.map((v) => v.toFixed(1)).join(', ')})`);
  line('髋轴 右', `(${A.hip_r.map((v) => v.toFixed(1)).join(', ')})`);
  line('髋轴间距', `${(A.hip_r[0] - A.hip_l[0]).toFixed(1)} 局部 / ${((A.hip_r[0] - A.hip_l[0]) * s).toFixed(1)} 像素`);
  line('脚踝偏移', `${A.ankle_dy.toFixed(1)}（腿和鞋共用）`);
  line('颠簸', `${cfg.bob}px`);
  line('手臂上移', `${cfg.arm.up}px，摆幅 ${cfg.arm.amp}°`);
  line('鞋前后偏移', `左 ${cfg.shoe.align_dx.l + cfg.shoe.forward_dx}，右 ${cfg.shoe.align_dx.r + cfg.shoe.forward_dx}`);
  console.log('');
}

function measure(cfg) {
  const m = measureAlignment(cfg);
  const line = (k, v) => console.log(`  ${k.padEnd(16)} ${v}`);
  console.log(`\n[${cfg.id}] 鞋口 / 裤脚对齐测量`);
  for (const side of ['l', 'r']) {
    const d = m[side];
    console.log(`  ${side === 'l' ? '左（里侧）' : '右（外侧）'}`);
    line('裤脚中心(原始)', d.cuffRaw.toFixed(2));
    line('鞋口中心(原始)', d.openRaw.toFixed(2));
    line('裤脚相对髋轴', d.cuffLocal.toFixed(2));
    line('鞋口相对鞋轴', d.openLocal.toFixed(2));
    line('建议 align_dx', `${d.alignDx.toFixed(2)}（当前 ${d.current}）`);
  }
  console.log('\n  把上面的建议值四舍五入写进配置 shoe.align_dx 即可对齐；');
  console.log('  想整体往朝向方向挪，用 shoe.forward_dx。\n');
}

function verify(cfg) {
  const sheetPath = cfg.outPng;
  if (!fs.existsSync(sheetPath)) return;
  const img = readImage(sheetPath);
  const { w: CW, h: CH } = cfg.cell;
  const expectW = CW * cfg.sheet.cols;
  const expectH = CH * cfg.sheet.rows;
  const ok = img.width === expectW && img.height === expectH;
  console.log(`${ok ? 'OK' : 'FAIL'} ${toUrlPath(sheetPath)} ${img.width}×${img.height}（期望 ${expectW}×${expectH}）`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.list) {
    const ids = listCharacters();
    if (!ids.length) console.log('（tools/characters 下还没有角色配置）');
    else ids.forEach((id) => console.log(id));
    return;
  }

  if (opts.init) {
    initCharacter(opts.init);
    return;
  }

  const cfg = loadConfig(opts.id);

  if (opts.measure) {
    measure(cfg);
    return;
  }

  if (opts.report) {
    report(cfg);
    return;
  }

  let frames = null;
  if (opts.frames) {
    const built = buildAllFrames(cfg);
    writeFrames(cfg, built.walk);
    // 静止帧单独存一份，方便检查
    const idleLayers = built.frames[0];
    for (const [name, img] of Object.entries(idleLayers)) {
      writeImage(path.join(cfg.outDir, `idle_${name}.png`), img);
    }
    frames = built.frames;
    console.log(`[帧] ${toUrlPath(cfg.outDir)}  1 静止 + ${cfg.sheet.frames} 走路`);
  }

  if (opts.sheet) {
    if (!frames) {
      // 复用已有帧目录
      const readFrame = (i) => {
        const tag = (i) => String(i).padStart(2, '0');
        const names = ['body', 'legs', 'legsonly', 'shoes', 'torso', 'armfar', 'armnear', ...Object.keys(cfg.layerVariants || {})];
        const out = {};
        for (const n of names) {
          const f = path.join(cfg.outDir, `walk_${tag(i)}_${n}.png`);
          if (fs.existsSync(f)) out[n] = readImage(f);
        }
        return out;
      };
      const idleFrame = { ...readFrame(cfg.idle.useFrame) };
      for (const [key, variant] of Object.entries(cfg.idle.override || {})) {
        const f = path.join(cfg.outDir, `walk_${String(cfg.idle.useFrame).padStart(2, '0')}_${variant}.png`);
        if (fs.existsSync(f)) idleFrame[key] = readImage(f);
      }
      frames = [idleFrame];
      for (let i = 0; i < cfg.sheet.frames; i++) frames.push(readFrame(i));
    }
    const sheet = buildSheet(cfg, frames);
    writeSheet(cfg, sheet);
    console.log(`[表] ${toUrlPath(cfg.outPng)}  ${sheet.width}×${sheet.height}`);
    verify(cfg);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('失败：' + err.message);
    process.exit(1);
  }
}

module.exports = { parseArgs, report, verify, measure, initCharacter };
