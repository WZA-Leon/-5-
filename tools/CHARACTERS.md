# 角色拆分与走路动画流水线

一套零依赖的 Node 工具，把「一张角色拆件图」变成「17 列 × 2 行精灵表 + 16 帧走路循环」。
主角（hero）就是用这套流程做出来的，换角色只需要写一份 JSON 配置。

```
部件图（8 张 png）  →  rig 引擎（绕关节旋转、贴地、颠簸）  →  分层帧  →  精灵表
```

---

## 1. 目录

| 位置 | 作用 |
|---|---|
| `tools/characters/<id>.json` | 角色配置：部件、锚点、比例、行顺序。**换角色只改这里** |
| `tools/characters/_template.json` | 空白模板，`--init` 会复制它 |
| `tools/lib/rig.js` | 通用引擎：装件、旋转、贴地、颠簸、打包 |
| `tools/rig_pipeline.js` | 命令行入口 |
| `tools/ref/rig/<id>/` | 输出的分层帧（`walk_00_body.png` …） |
| `assets/<id>.png` | 输出的精灵表 |

## 2. 快速开始

```bash
node tools/rig_pipeline.js --list          # 有哪些角色
node tools/rig_pipeline.js hero            # 出帧 + 出表（最常用）
node tools/rig_pipeline.js hero --report   # 只打印比例自检
node tools/rig_pipeline.js hero --measure  # 只量鞋口/裤脚
node tools/rig_pipeline.js hero --frames   # 只出帧
node tools/rig_pipeline.js hero --sheet    # 只打包（复用已有帧）
node tools/rig_pipeline.js --init teacher  # 新建角色配置
npm run build                              # = rig_pipeline.js hero
```

出完表记得改 `js/game.js` 里的 `SPRITE_SHEETS` 版本号（`?v=NN`）并在浏览器 Ctrl+F5，
否则会看到缓存里的旧图。

## 3. 加一个新角色的完整流程

### 3.1 准备部件

把角色拆成 8 个透明 PNG，放进 `tools/ref/rig/<id>_parts/`：

```
head.png  torso.png  arm_l.png  arm_r.png  leg_l.png  leg_r.png  shoe_l.png  shoe_r.png
```

命名可以在配置的 `parts.files` 里随便映射。左右是**角色自身**的左右（不是画面左右）。

### 3.2 建配置

```bash
node tools/rig_pipeline.js --init teacher
```

生成的 `tools/characters/teacher.json` 需要你填三块：`parts` → `anchors` → `scale`。

### 3.3 填锚点（关键）

`anchors` 用的是**原始部件像素坐标**，引擎会自己乘缩放，不用预先缩放。

| 锚点 | 含义 |
|---|---|
| `head_neck` | 脖子（头绕这里转，实际上头不转，只用来对齐躯干领口） |
| `torso_collar` | 领口中点，决定整个身体的落点 |
| `torso_sleeve_l/r` | 左右肩袖口，手臂绕这里转 |
| `torso_hip_l/r` | 左右髋轴，腿绕这里转 |
| `arm_cuff` | 手部图层里「袖子接缝」的位置 |
| `leg_hip` | 裤腿顶端的髋点 |
| `leg_ankle` | 裤腿底端的脚踝点（和鞋口共用） |
| `shoe_opening` | **鞋口**（鞋上那个深色开口），不是鞋尖 |

> `shoe_opening` 最容易搞错。判据：鞋口是鞋顶部的暗色椭圆/开口，鞋尖是最远的亮色尖端。
> 拿不准就跑 `--measure`，它会打印鞋口重心实测值。

### 3.4 对齐鞋口与裤脚

```bash
node tools/rig_pipeline.js teacher --measure
```

输出示例（hero 实测）：

```
  左（里侧）
  裤脚中心(原始)         31.85
  鞋口中心(原始)         40.45
  裤脚相对髋轴           -1.64
  鞋口相对鞋轴           0.27
  建议 align_dx      -1.91（当前 -2）
```

把建议值四舍五入写进 `shoe.align_dx`，鞋口就和裤脚对齐了。
想让鞋整体往角色朝向方向再挪一点，用 `shoe.forward_dx`（正数 = 朝前）。

测量参数可调：`measure.band`（取鞋顶部多少行）、`measure.cuffBand`（取裤腿底部多少行）、
`measure.dark`（判定「深色」的亮度阈值）。

### 3.5 调比例

```bash
node tools/rig_pipeline.js teacher --report
```

```
  站立高度           380px（缩放 1.0737 → 408px）
  髋轴间距           39.0 局部 / 41.9 像素
  脚踝偏移           128.5（腿和鞋共用）
```

- `scale.*` 是各部件缩放。腿用 `leg_x` / `leg_y` 可以单独拉长（`leg_y` > `leg_x` 显腿长）。
- 整身最后会等比缩放到 `cell.body_h`（默认 408px）并贴到 `cell.ground_y`（452），
  所以 `scale` 只影响**部件之间的相对比例**，不影响最终身高。
- 髋轴间距太小会显得两腿重叠，太大像劈叉；hero 是 39 局部像素。

### 3.6 出表

```bash
node tools/rig_pipeline.js teacher
```

输出 `tools/ref/rig/teacher/*.png` 和 `assets/teacher.png`。

## 4. 配置字段说明

```jsonc
{
  "parts": {
    "dir": "tools/ref/rig/teacher_parts",
    "files": { "head": "head.png", ... },
    "flip": { "leg_r": true },        // 哪些部件要先水平翻转
    "removeStripe": []                // 哪些部件要去掉红条纹（用邻近色修补）
  },

  "anchors": { ... },                 // 原始部件像素坐标

  "scale": { "head": .64, "torso": .66, "arm": .52, "shoe": .6,
             "leg_x": .52, "leg_y": .84 },

  "stage": { "w": 400, "h": 600, "origin": [200, 200], "head_dy": 10 },

  "arm": { "amp": 12,        // 摆臂幅度（度）
           "up": 11,         // 双手整体上移（像素）
           "offset_l_x": -4, // 左右手横向微调
           "offset_r_x": 3 },

  "leg": { "amp": 26,          // 迈腿幅度（度）
           "hip_shift_l_x": -6 // 里侧腿的髋轴额外外移，外侧不动
  },

  "shoe": {
    "tight_crop": true,        // 鞋只留紧致小方块，避免大块透明区域
    "rotate_with_leg": true,   // 鞋和腿绕同一个髋轴转（脚踝永远不脱节）
    "align_dx": { "l": -2, "r": 1 },  // 鞋口对准裤脚的补偿
    "forward_dx": 9,           // 整体往朝向方向挪
    "dy": { "l": 0, "r": 0 }   // 上下微调
  },

  "bob": 7,                    // 走路上下颠簸幅度（只抬上半身，脚贴地）

  "cell": { "w": 320, "h": 460, "ground_y": 452, "body_h": 408,
            "crop": [70, 80, 330, 465] },   // 局部画布上的固定裁切窗口

  "sheet": { "png": "assets/teacher.png", "webp": "assets/teacher.webp",
             "frames": 16, "cols": 17, "rows": 2 },

  "rows": [ /* 见下 */ ],

  "idle": { "useFrame": 0, "override": { "shoes": "shoesidle" } }
}
```

### 4.1 `crop` 为什么是固定窗口

走路时腿和鞋会摆出站立时的轮廓，如果按站立 bbox 裁，鞋尖会被切掉（游戏里看着像腿和鞋断开）。
所以用固定窗口 `[70, 80, 330, 465]`，比站立轮廓宽一截。换角色时按 `--report` 的站立高度
微调这个窗口，保证左右各留够摆腿空间。

### 4.2 `rows`：每一行怎么叠

每一行是一个图层列表，从下往上叠。一项可以是叶子图层，也可以是 `group` 分组：

```jsonc
"layers": [
  { "group": [
      { "src": "armfar" },
      { "group": [
          { "src": "legsonly" },
          { "src": "shoes", "flip": true },
          { "src": "torso", "flip": true }
      ] }
  ] },
  { "src": "armnear" }
]
```

- `flip: true` = 该图层水平翻转（用来做镜像朝向）。
- `group` 表示「组内先合成一块，再整体叠上去」。分组会改变 8 位 alpha 混合的舍入结果，
  所以它是精确复现像素的必要手段，不是随便加的。不分组就是从左到右逐层 over。

hero 的两行：上行朝左（身体镜像），下行朝右（原样）。

### 4.3 `layerVariants` 与 `idle`

`layerVariants` 定义额外的图层变体，目前支持 `kind: "shoes"`：

```jsonc
"layerVariants": {
  "shoesidle": { "kind": "shoes", "swapOrder": true, "mirrorFront": false }
}
```

- `swapOrder`：两只鞋的前后层顺序对调（决定哪只鞋挡在前面）。
- `mirrorFront`：是否把前面那只鞋再镜像一次。

`idle` 指定静止帧（第 0 列）用哪一帧的图层，以及替换哪一层：

```jsonc
"idle": { "useFrame": 0, "override": { "shoes": "shoesidle" } }
```

## 5. 引擎做了什么（不变量）

这几条是这个动画「顺」的原因，换角色时不要绕过：

1. **腿和鞋绕同一个髋轴转。** 鞋先放在静止脚踝位置，再以腿的同一角度、绕同一个髋点旋转，
   两者是同一根刚体，脚踝相对位置永远不变 —— 走路不会出现鞋和腿错位。
2. **脚底始终贴地。** 每帧用身体最低点算出 `dy = ground_y - bottom`，整帧下移，
   腿和鞋不会被颠簸抬起来。
3. **颠簸只抬上半身。** `bob = round(BOB * |sin(phase)|)` 只作用于躯干、头、手。
   双腿分开（着地）时重心最低，并拢时最高。
4. **鞋只裁紧致小方块。** 大块透明区域会让旋转插值把边缘拉花。
5. **裁切窗口比站立轮廓宽。** 摆腿时鞋尖不会被切掉。
6. **静止帧单独一套鞋。** 第 0 列用 `shoesidle`（前后顺序不同、不镜像），
   保证站立时两只鞋朝向一致且前后关系自然。

## 6. 校验

```bash
node tools/check_project.js                 # 项目自检（含角色配置、部件完整性、表尺寸）
node tools/verify_sheet.js 旧表.png 新表.png  # 逐格对比 alpha / RGB 差异
```

`check_project.js` 会检查：零依赖、无硬编码盘符、无 Python 残留、JS 语法、
每个角色配置能加载且 8 个部件都在、每行声明了必需图层、精灵表尺寸正确。

## 7. 踩过的坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 走路像在倒退 | 精灵表上下两行的朝向语义反了 | 上行朝左、下行朝右，`drawHero` 用 `dir > 0 ? 1 : 0` 选行 |
| 站立和走路的鞋朝向相反 | 两行用了不同的镜像规则 | 统一成同一套 `rows` 声明 |
| 鞋口对不上裤脚 | 把鞋尖当成了鞋口 | 用 `--measure` 实测鞋口重心，别凭眼睛 |
| 鞋和腿在摆动时脱节 | 鞋绕脚踝转而不是绕髋转 | `rotate_with_leg: true`，共用髋轴 |
| 改了图浏览器没变化 | webp 比 png 旧 / 浏览器缓存 | 删旧 webp，`check_project.js` 有 mtime 守卫；并改 `?v=` |
| 重构后像素变了 | 图层叠放的分组结构变了 | 用 `verify_sheet.js` 对齐到 0 差异再收工 |
