'use strict';
/* ==========================================================================
   文件读写：PNG 走内置编解码；WebP 交给可选的系统 ffmpeg（没有就跳过，
   游戏端本来就会回退到 PNG）。
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Image } = require('./image');
const { decodePNG, encodePNG } = require('./png');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readImage(file) {
  return Image.fromPNG(fs.readFileSync(file));
}

function writePNG(file, img, level = 6) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, encodePNG(img.width, img.height, img.data, level));
}

let ffmpegChecked = false;
let ffmpegOk = false;

function hasFfmpeg() {
  if (ffmpegChecked) return ffmpegOk;
  ffmpegChecked = true;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' });
  ffmpegOk = !r.error && r.status === 0;
  return ffmpegOk;
}

/** 用 ffmpeg/libwebp 编码；失败返回 false（调用方打印提示即可） */
function writeWebP(file, img, quality = 92) {
  if (!hasFfmpeg()) return false;
  ensureDir(path.dirname(file));
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pixel_format', 'rgba',
    '-video_size', `${img.width}x${img.height}`,
    '-i', 'pipe:0', '-frames:v', '1',
    '-c:v', 'libwebp', '-quality', String(quality),
    file,
  ];
  const r = spawnSync('ffmpeg', args, {
    input: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length),
    maxBuffer: 64 * 1024 * 1024,
  });
  return !r.error && r.status === 0 && fs.existsSync(file);
}

function writeImage(file, img, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.webp') {
    const ok = writeWebP(file, img, opts.quality || 92);
    if (!ok) {
      // 关键：不能留下旧的 webp。游戏优先加载 webp，若这里跳过却保留旧文件，
      // 页面就会一直显示上一次构建的图，看起来像「改了没生效」。
      if (fs.existsSync(file)) {
        fs.rmSync(file);
        console.log(`[删除] 没有可用的 ffmpeg/libwebp，已移除过期的 ${path.basename(file)}，游戏将使用新生成的 PNG`);
      } else {
        console.log(`[跳过] 没有可用的 ffmpeg/libwebp，未生成 ${path.basename(file)}（PNG 不受影响）`);
      }
    }
    return ok;
  }
  writePNG(file, img, opts.level || 6);
  return true;
}

module.exports = { ensureDir, readImage, writePNG, writeImage, writeWebP, hasFfmpeg };