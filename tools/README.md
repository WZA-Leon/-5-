# tools — 零依赖 Node 工具链

这个目录原来是一套 Python + OpenCV 脚本，现在全部是 **纯 JavaScript（CommonJS）**：

- 不需要 `pip install`、不需要 Python、不需要 `npm install`。
- 图像解码/编码、连通域、形态学、仿射、inpaint、光流等都在 `tools/lib/` 内实现。
- 只要求 **Node.js >= 18**。
- 唯一可能用到的外部程序是 **可选的 ffmpeg**：仅用于把 PNG 再压成 WebP；没有 ffmpeg 时自动只写 PNG，游戏端会回退到 PNG，不影响构建成功。

## 1. 路径规则（跨平台 / Tauri / PWA）

所有路径都从 `tools/lib/paths.js` 推导：

```js
const { ROOT } = require('./lib/paths'); // 仓库根目录，不是 cwd
```

- `ROOT` 由 `tools/lib/paths.js` 的上两级目录决定，因此可以从任意工作目录运行：

  ```bash
  node /absolute/path/to/project/tools/build_rig_sheet.js
  cd /tmp && node /absolute/path/to/project/tools/build_rig_sheet.js
  ```

- 命令行参数中的绝对路径原样使用；相对路径按**当前工作目录**解析（`resolveInput`）。
- 代码内部只用 `path.join` / `path.resolve`，不手写 `/` 或 `\`。
- 不再有盘符或用户目录硬编码。`node tools/check_project.js` 会扫描并失败。
- 浏览器运行时不加载 `tools/`；Tauri/PWA 只使用 `index.html` 同级的相对 URL（`css/`、`js/`、`assets/`）。

> 六端建议：先执行 `npm run build` 生成 `assets/hero.png` / `hero.webp`，再把
> `index.html` + `css/` + `js/` + `assets/` 作为 Tauri 的 `frontendDist` / PWA 的 web root。
> `tools/` 是构建期 Node 代码，不要打进 WebView 运行时。

## 2. 常用命令

```bash
# 生产精灵表：16 帧走路 + 1 帧站立 = 17 列 × 2 行，320×460/格
node tools/build_rig_sheet.js

# 本地预览（默认 127.0.0.1:8123；手机同网段调试显式指定 HOST）
node tools/serve.js
PORT=8080 HOST=0.0.0.0 node tools/serve.js          # macOS / Linux / Git Bash
$env:PORT='8080'; $env:HOST='0.0.0.0'; node tools/serve.js   # PowerShell

# 生成干净的 Web 运行目录（Tauri 的 frontendDist / PWA 的 web root）
node tools/stage_web.js          # 默认 dist/
node tools/stage_web.js out/    # 自定义目录（必须在项目内）

# 项目自检：Python 残留、绝对路径、JS 语法、资源、精灵表尺寸
node tools/check_project.js

# npm 脚本等价入口（没有 node_modules 也能运行）
npm run build
npm run stage
npm start
npm run check
```

## 3. 美术参考 / 构建流水线

### 生产链路（当前游戏使用）

```bash
node tools/extract_sheet3.js      # 3.png -> tools/ref/rig/sheet3/pXX_*.png
node tools/rig3_assemble.js       # 拼站立预览 -> tools/ref/rig/rig3/idle_*
node tools/rig3_walk.js           # 生成 16 帧 layers -> tools/ref/rig/rig3/walk_*
node tools/build_rig_sheet.js     # 打包 -> assets/hero.png + hero.webp
```

`game.js` 按 `FRAME_COLS = 17`、`FRAME_ROWS = 2` 读取，列 0 站立、列 1..16 走路循环；行 0/1 为左右方向。

### 参考 / 旧版链路（输出到 `tools/ref/`，不会覆盖 `assets/hero.*`）

```bash
node tools/build_sheet_sjy.js          # 4 列 × 2 行 -> tools/ref/rig/sjy/
node tools/build_sheet_from_images.js  # 4 列 × 2 行 -> tools/ref/rig/from_images/
node tools/rig_prep.js                 # idle_320 / contact_320 参考帧
node tools/rig_parts.js                # 骨架切件调试图 + rig_meta.json
node tools/extract_sheet2.js           # 2.png 拆件 -> tools/ref/rig/sheet2/
node tools/test_cycle.js               # 不同来源走姿对比条
node tools/inspect_roles.js            # roles/ 全量切帧、归一化、对比条
```

### 单图工具

```bash
node tools/analyze_parts_sheet.js
node tools/check_transparent.js
node tools/compare_sheets.js
node tools/extract_frames.js ["roles/SJY/img (8).png"]
node tools/grid_full.js <src> <dst> [scale]
node tools/over_magenta.js <src> <dst>
node tools/rig_rows.js [image]
node tools/sprite_extract.js [image] [outDir]
node tools/zoom_grid.js <src> <x0> <y0> <x1> <y1> [scale] [out]
```

- `extract_frames.js` 默认读 `roles/SJY/img (8).png`，写 `tools/sheet_info.json`。
- `sprite_extract.js` 默认读 `tools/ref/src/img1_1024.png`，写 `tools/ref/rig/split_*_magenta.png`。
- `build_sheet_sjy.js` / `build_sheet_from_images.js` 是旧 4 列布局，默认只写参考目录；生产表统一走 `build_rig_sheet.js`，避免误覆盖 `assets/hero.*`。

## 4. 图像库

`tools/lib/` 下每个模块都是零依赖纯 JS：

| 模块 | 内容 |
| --- | --- |
| `png.js` | PNG 解码（0/2/3/4/6、1/2/4/8/16 位）+ RGBA8 编码 |
| `image.js` | `Image`、裁剪、翻转、alpha over、area/lanczos4 重采样 |
| `color.js` | RGB/HSV/YCrCb 转换（OpenCV 取值域） |
| `ccl.js` | 4/8 连通域 + stats + 质心 |
| `morph.js` | dilate/erode/open/close |
| `draw.js` | 线、圆、5×7 点阵文字 |
| `affine.js` | 旋转矩阵、warpAffine |
| `inpaint.js` | TELEA 风格修补 |
| `flow.js` | Farneback 近似光流、remap |
| `io.js` | 读写 PNG；可选 ffmpeg 写 WebP |
| `paths.js` | 根目录、CLI 路径、URL 路径、目录穿越判断 |
| `check_project.js` | Python 残留 / 绝对路径 / 语法 / 资源 / 精灵表尺寸自检 |
| `stage_web.js` | 生成干净的 `dist/`，供 Tauri / PWA 使用 |

## 5. 验证基线

`node tools/check_project.js` 当前会检查：

- 16 帧 × 3 层（`body` / `armfar` / `armnear`）齐全；
- `assets/hero.png` 为 5440×920；
- `game.js` 的 `FRAME_COLS=17`、`FRAME_ROWS=2`，引用相对 `assets/hero.webp|png`；
- 没有 `.py` / `.pyc` / `__pycache__`；
- 没有硬编码的盘符、用户目录或 file URL；
- 每个 JS 文件 `node --check` 通过；
- `package.json` 的依赖字段为空。

需要实际跑图时，按上面“生产链路”执行即可；所有脚本在临时目录/任意 cwd 下也使用同一套 `ROOT` 解析。
