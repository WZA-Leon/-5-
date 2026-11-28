'use strict';
/* ==========================================================================
   逐格对比两张精灵表（alpha 与 RGB 分开统计），用于重构后回归验证。

   node tools/verify_sheet.js <旧表> <新表>
   ========================================================================== */

const path = require('node:path');
const { readImage } = require('./lib');

const CW = 320;
const CH = 460;

function main() {
  const [oldFile, newFile] = process.argv.slice(2);
  if (!oldFile || !newFile) {
    console.error('用法：node tools/verify_sheet.js <旧表> <新表>');
    process.exit(1);
  }
  const a = readImage(path.resolve(oldFile));
  const b = readImage(path.resolve(newFile));
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`尺寸不同：${a.width}x${a.height} vs ${b.width}x${b.height}`);
    process.exit(1);
  }
  const cols = Math.round(a.width / CW);
  const rows = Math.round(a.height / CH);
  let totalA = 0;
  let totalC = 0;
  const per = [];
  for (let c = 0; c < cols; c++) {
    let na = 0;
    let nc = 0;
    for (let r = 0; r < rows; r++) {
      for (let y = 0; y < CH; y++) {
        for (let x = 0; x < CW; x++) {
          const i = ((r * CH + y) * a.width + c * CW + x) * 4;
          if (a.data[i + 3] !== b.data[i + 3]) na++;
          if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) nc++;
        }
      }
    }
    per.push(`col${c} alpha=${na} rgb=${nc}`);
    totalA += na;
    totalC += nc;
  }
  console.log(per.join('\n'));
  console.log(`总计：alpha 差异 ${totalA}px，RGB 差异 ${totalC}px（单格 ${CW * CH}px）`);
  return { totalA, totalC };
}

if (require.main === module) main();

module.exports = { main };
