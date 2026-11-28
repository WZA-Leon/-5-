'use strict';
/* ==========================================================================
   生成角色预览图：站立对比 + 走路循环条。

   node tools/preview_character.js <角色id> [对比角色id]
   输出 tools/ref/rig/<id>/preview.png
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { Image, readImage, writeImage, hstack, putText } = require('./lib');
const { loadConfig } = require('./lib/rig');
const { ROOT, toUrlPath } = require('./lib/paths');

const CW = 320;
const CH = 460;

function onDark(im, color = [38, 40, 46]) {
  const bg = new Image(im.width, im.height);
  for (let o = 0; o < bg.data.length; o += 4) {
    bg.data[o] = color[0];
    bg.data[o + 1] = color[1];
    bg.data[o + 2] = color[2];
    bg.data[o + 3] = 255;
  }
  return bg.over(im);
}

function idleCell(sheet, col, row) {
  return sheet.crop(col * CW, row * CH, CW, CH);
}

function scale(im, k) {
  return im.resize(im.width * k, im.height * k, 'nearest');
}

function separator(h, w = 6, color = [255, 255, 255]) {
  const im = new Image(w, h);
  for (let o = 0; o < im.data.length; o += 4) {
    im.data[o] = color[0];
    im.data[o + 1] = color[1];
    im.data[o + 2] = color[2];
    im.data[o + 3] = 255;
  }
  return im;
}

function main() {
  const id = process.argv[2];
  const otherId = process.argv[3] || null;
  if (!id) {
    console.error('用法：node tools/preview_character.js <角色id> [对比角色id]');
    process.exit(1);
  }
  const cfg = loadConfig(id);
  const sheet = readImage(cfg.outPng);

  // 站立：朝右（下行）+ 朝左（上行）
  const right = onDark(idleCell(sheet, 0, 1));
  const left = onDark(idleCell(sheet, 0, 0));
  const parts = [right, separator(CH), left];

  if (otherId) {
    const other = loadConfig(otherId);
    if (fs.existsSync(other.outPng)) {
      const s2 = readImage(other.outPng);
      parts.push(separator(CH), onDark(idleCell(s2, 0, 1)), separator(CH), onDark(idleCell(s2, 0, 0)));
    }
  }

  const K = 2;
  let standing = hstack(parts);
  putText(standing, id.toUpperCase() + ' R', 8, 26, 0.7, [120, 220, 160], 2);
  putText(standing, id.toUpperCase() + ' L', CW + 14, 26, 0.7, [120, 220, 160], 2);
  if (otherId) {
    putText(standing, otherId.toUpperCase() + ' R', (CW + 6) * 2 + 8, 26, 0.7, [220, 200, 120], 2);
    putText(standing, otherId.toUpperCase() + ' L', (CW + 6) * 3 + 14, 26, 0.7, [220, 200, 120], 2);
  }
  standing = scale(standing, K);

  // 走路循环（下行 = 朝右）
  const walkCols = [];
  for (let c = 1; c <= 16; c++) walkCols.push(onDark(idleCell(sheet, c, 1)));
  let walk = hstack(walkCols);
  walk = walk.resize(Math.round(walk.width * 0.6), Math.round(walk.height * 0.6), 'area');

  const W = Math.max(standing.width, walk.width);
  const H = standing.height + 10 + walk.height + 10;
  const out = new Image(W, H);
  for (let o = 0; o < out.data.length; o += 4) {
    out.data[o] = 22;
    out.data[o + 1] = 24;
    out.data[o + 2] = 28;
    out.data[o + 3] = 255;
  }
  out.copyInto(standing, Math.floor((W - standing.width) / 2), 0);
  out.copyInto(walk, Math.floor((W - walk.width) / 2), standing.height + 10);

  const file = path.join(cfg.outDir, 'preview.png');
  fs.mkdirSync(cfg.outDir, { recursive: true });
  writeImage(file, out);
  console.log(`预览：${toUrlPath(file)}  ${out.width}x${out.height}`);
  return file;
}

if (require.main === module) main();

module.exports = { main };
