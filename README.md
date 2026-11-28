# 课间十分钟 · 走廊漫步

一个基于现实校园走廊制作的纯 JavaScript Canvas 小游戏。

- 运行时：原生 Canvas 2D + DOM，无框架、无构建、无第三方运行时依赖。
- 美术：`assets/hero.png`（17 列 × 2 行，320×460/格）、`assets/hero.webp`（可选，加载失败自动回退 PNG）。
- 工具链：`tools/` 下全部为 Node.js 纯 JS 脚本，已移除 Python / OpenCV / NumPy。
- 路径：全部从项目根目录推导，支持 Windows / macOS / Linux 的任意工作目录；为 Tauri / PWA 的六端打包预留。

## 运行

```bash
# Node.js >= 18；不需要 npm install
node tools/serve.js
# 打开 http://127.0.0.1:8123/
```

也可以用 `npm start`（`package.json` 没有任何依赖）。

## 构建精灵表

```bash
node tools/build_rig_sheet.js
# 或 npm run build
```

该命令读取 `tools/ref/rig/rig3/walk_*` 的 16 帧，生成 `assets/hero.png` 和 `assets/hero.webp`。
没有 ffmpeg 时只生成 PNG，游戏会自动回退；PNG 编解码本身是纯 JS。

完整流水线、单图工具和路径规则见 [`tools/README.md`](tools/README.md)。

## 自检

```bash
node tools/check_project.js
# 或 npm run check
```

会检查：Python 残留、硬编码绝对路径、JS 语法、16 帧素材、`assets/hero.png` 尺寸、`game.js` 的 17×2 帧配置、`package.json` 零依赖。

## 目录

```text
index.html          Web / Tauri / PWA 入口（相对路径）
css/style.css       页面与响应式 UI
js/game.js          游戏运行时（浏览器 API，无 Node 依赖）
assets/             生产精灵表
roles/              原始角色参考图
tools/              零依赖 Node 构建 / 切图 / 验证工具
tools/ref/          参考素材与中间产物
```

## Tauri / PWA 说明

- `npm run stage` 会生成干净的 `dist/`（只含 `index.html`、`css/`、`js/`、`assets/`），可直接作为 Tauri 的 `frontendDist` 或 PWA 的 web root；`tools/` 和原始参考图不会被打进去。
- 浏览器入口只引用 `css/`、`js/`、`assets/` 的相对 URL，不使用 file URL 或绝对盘符。
- 打包前先执行 `npm run build`；移动端调试可用 `HOST=0.0.0.0 PORT=8080 node tools/serve.js`（PowerShell：`$env:HOST='0.0.0.0'; $env:PORT='8080'; node tools/serve.js`）。
