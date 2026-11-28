'use strict';
/* ==========================================================================
   检查 roles/ 下每个角色的参考图：切帧、归一化、量化步态，并输出对比图。

   用法: node tools/inspect_roles.js
   输出: tools/ref/roles/<ROLE>/<img>_<row>.png 以及对比大图。
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { Image, writeImage } = require('./lib');
const { splitSprites, measure, normalize } = require('./extract_frames');

const { ROOT } = require('./lib/paths');
const OUT = path.join(ROOT, 'tools', 'ref', 'roles');
const CELL_W = 240;
const CELL_H = 460;

function analyze(file) {
  const sprites = splitSprites(file);
  if (!sprites.length) return [];
  const ys = sprites.map((s) => s.bbox[1]).sort((a, b) => a - b);
  const mid = ys[ys.length >> 1];
  const rows = { top: [], bottom: [] };
  for (const s of sprites) {
    const m = measure(s.rgba);
    const norm = normalize(s.rgba, m);
    rows[s.bbox[1] < mid ? 'top' : 'bottom'].push({
      bbox: s.bbox,
      norm,
      m,
      spread: m.foot_l && m.foot_r ? m.foot_r.x - m.foot_l.x : null,
    });
  }
  for (const k of Object.keys(rows)) rows[k].sort((a, b) => a.bbox[0] - b.bbox[0]);
  return rows;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const roleRoot = path.join(ROOT, 'roles');
  for (const role of fs.readdirSync(roleRoot).sort()) {
    const roleDir = path.join(roleRoot, role);
    if (!fs.statSync(roleDir).isDirectory()) continue;
    for (const name of fs.readdirSync(roleDir).sort()) {
      if (!name.toLowerCase().endsWith('.png')) continue;
      const file = path.join(roleDir, name);
      const rows = analyze(file);
      const tag = path.basename(name, path.extname(name)).replace(/ /g, '_').replace(/\(/g, '').replace(/\)/g, '');
      for (const [band, frames] of Object.entries(rows)) {
        const prints = [];
        frames.forEach((f, i) => {
          writeImage(path.join(OUT, `${role}_${tag}_${band}_${i}.png`), f.norm);
          const lm = f.m;
          const fl = lm.foot_l;
          const fr = lm.foot_r;
          const sp = f.spread === null ? 'None' : Math.round(f.spread);
          const ltxt = fl ? `(${Math.round(fl.x - lm.torso_cx)}, ${fl.y - lm.bottom})` : 'None';
          const rtxt = fr ? `(${Math.round(fr.x - lm.torso_cx)}, ${fr.y - lm.bottom})` : 'None';
          prints.push(`#${i} spread=${sp} L=${ltxt} R=${rtxt}`);
        });
        if (frames.length) {
          console.log(`${role}/${name} [${band}] n=${frames.length}`);
          for (const p of prints) console.log('   ', p);
        }
      }

      // 视觉对比图：上排、下排各一行，按原始帧归一化后并排
      for (const [band, frames] of Object.entries(rows)) {
        if (!frames.length) continue;
        const width = frames.reduce((s, f) => s + f.norm.width, 0);
        const strip = new Image(width, CELL_H);
        let x = 0;
        for (const f of frames) {
          strip.copyInto(f.norm, x, 0);
          x += f.norm.width;
        }
        writeImage(path.join(OUT, `${role}_${tag}_${band}_strip.png`), strip);
      }
    }
  }
}

if (require.main === module) main();