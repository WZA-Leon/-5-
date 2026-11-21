/* ==========================================================================
   课间十分钟 · 走廊漫步
   --------------------------------------------------------------------------
   纯原生 Canvas 2D 小游戏（零依赖）：
     · 程序化绘制的教室：墙面 / 黑板 / 窗 / 门 / 布告栏 / 储物柜 / 课桌 / 地板
     · 三层视差滚动：窗外远景 → 教室主体 → 前景课桌
     · 像素小人使用精灵表逐帧播放，左右方向各一套素材
     · 键盘 / 触屏按钮 / 点击地面 三种操控，实时响应式缩放
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------- 数学工具 --- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ----------------------------------------------------------- 颜色工具 --- */
  const colorCache = new Map();

  function parseColor(color) {
    const key = typeof color === 'string' ? color : '#' + color;
    const hit = colorCache.get(key);
    if (hit) return hit;

    let rgb = [0, 0, 0];
    if (typeof color === 'string') {
      if (color[0] === '#') {
        const h = color.slice(1);
        const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
        rgb = [
          parseInt(full.slice(0, 2), 16),
          parseInt(full.slice(2, 4), 16),
          parseInt(full.slice(4, 6), 16),
        ];
      } else {
        const nums = color.match(/-?\d+(?:\.\d+)?/g);
        if (nums && nums.length >= 3) rgb = [+nums[0], +nums[1], +nums[2]];
      }
    }
    if (rgb.some((n) => !Number.isFinite(n))) rgb = [0, 0, 0];
    colorCache.set(key, rgb);
    return rgb;
  }

  /** 任意 CSS 颜色 → 半透明版本 */
  function rgba(color, alpha) {
    const [r, g, b] = parseColor(color);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /** 任意两个 CSS 颜色按比例混合 */
  function mix(a, b, t) {
    const A = parseColor(a);
    const B = parseColor(b);
    return (
      'rgb(' +
      Math.round(lerp(A[0], B[0], t)) + ',' +
      Math.round(lerp(A[1], B[1], t)) + ',' +
      Math.round(lerp(A[2], B[2], t)) + ')'
    );
  }

  /* ----------------------------------------------------------- 世界坐标系 ---
     画面高度恒等于 WU 个「世界单位」，屏幕尺寸变化只改变可见宽度，
     因此竖屏 / 横屏 / 超宽屏的构图比例保持一致。                        */
  const WU = 360;
  const WORLD_W = 2200;
  const CEIL_Y = 30;
  const FLOOR_Y = 252;
  const HERO_H = 104;
  const HERO_W = HERO_H * (320 / 460);
  const HERO_FEET = 314;
  const SPRITE_FEET_RATIO = 452 / 460; // 精灵里脚底所在的比例（离单元格顶部）

  /* 精灵表：17 列（0 站立，1..16 走路循环），行 0 朝右、行 1 朝左（镜像） */
  const SPRITE_SHEETS = ['assets/hero.webp?v=36', 'assets/hero.png?v=36'];
  const FRAME_COLS = 17;
  const FRAME_ROWS = 2;
  const IDLE_FRAME = 0;
  const WALK_CYCLE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const CONTACT_FRAMES = [5, 13]; // 两脚各自落地的帧
  const STRIDE = 0.0278; // 单帧时长（秒）：与移动速度成反比，脚不会打滑
  const MIN_STRIDE = 0.010;
  const MAX_STRIDE = 0.06;
  const SPEED = 150;
  const RUN_MULT = 1.7;

  /* ---------------------------------------------------------------- DOM --- */
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const elHint = document.getElementById('hint');
  const elToast = document.getElementById('toast');
  const elFill = document.getElementById('progress-fill');
  const elRoom = document.getElementById('room-label');
  const elTheme = document.getElementById('theme-label');
  const elLoading = document.getElementById('loading');
  const pad = document.getElementById('pad');
  const btnSound = document.getElementById('btn-sound');
  const btnFull = document.getElementById('btn-fullscreen');

  /* -------------------------------------------------------------- 调色板 ---
     沿教室长度做「午后 → 黄昏 → 日落」的连续过渡：越往右走，光线越暖。 */
  const COLOR_KEYS = [
    'wallTop', 'wallBot', 'wainscot', 'wainscotDark',
    'floorA', 'floorB', 'floorSeam',
    'skyTop', 'skyBot', 'treeNear', 'treeFar', 'cloud',
    'board', 'boardDark', 'chalk', 'frame', 'door', 'glass',
    'deskWood', 'deskTop', 'deskDark', 'metal',
    'ambient',
  ];
  const NUM_KEYS = ['lightA', 'lampA', 'ambientA'];

  const STOPS = [
    {
      t: 0,
      name: '午后阳光',
      wallTop: '#fdf2e0', wallBot: '#f0dcc2', wainscot: '#dbc6a6', wainscotDark: '#bfa886',
      floorA: '#d3a271', floorB: '#c6935f', floorSeam: '#8d5f3a',
      skyTop: '#8ecdec', skyBot: '#e6f5fd', treeNear: '#83b96f', treeFar: '#a9cf93', cloud: '#ffffff',
      board: '#3b5f55', boardDark: '#2c4a42', chalk: '#f2f7ef', frame: '#c59a63',
      door: '#b98449', glass: '#e8f7ff',
      deskWood: '#e3b87c', deskTop: '#f0cd95', deskDark: '#b98a55', metal: '#98a2b0',
      ambient: '#ffd39c',
      lightA: 0.2, lampA: 0.05, ambientA: 0.05,
    },
    {
      t: 0.55,
      name: '黄昏铃声',
      wallTop: '#fae4c6', wallBot: '#eecfab', wainscot: '#d8bd99', wainscotDark: '#b99f7d',
      floorA: '#c99b6b', floorB: '#b98a5c', floorSeam: '#7c5031',
      skyTop: '#f7b482', skyBot: '#ffe4c2', treeNear: '#7fae6d', treeFar: '#9dc48d', cloud: '#ffd9b8',
      board: '#3a5a50', boardDark: '#2b463f', chalk: '#f6f2e6', frame: '#bb8f5b',
      door: '#b07a43', glass: '#ffe9cf',
      deskWood: '#dcae74', deskTop: '#eec58c', deskDark: '#a97c4c', metal: '#8f96a1',
      ambient: '#ffae6e',
      lightA: 0.26, lampA: 0.3, ambientA: 0.09,
    },
    {
      t: 1,
      name: '日落时分',
      wallTop: '#efc9a4', wallBot: '#dcaa80', wainscot: '#c8a684', wainscotDark: '#a98763',
      floorA: '#bb8c61', floorB: '#a97b52', floorSeam: '#6d422a',
      skyTop: '#ef8355', skyBot: '#ffd0a2', treeNear: '#6f9463', treeFar: '#8aa87d', cloud: '#ffc9a1',
      board: '#35514a', boardDark: '#263d38', chalk: '#fbf4e4', frame: '#a87f52',
      door: '#a06e3d', glass: '#ffdcc0',
      deskWood: '#ce9f6b', deskTop: '#e2b47c', deskDark: '#9c7044', metal: '#858b96',
      ambient: '#c2663f',
      lightA: 0.32, lampA: 0.62, ambientA: 0.14,
    },
  ];

  let palCache = { key: -1, pal: null };

  function paletteAt(progress) {
    const t = clamp(progress, 0, 1);
    if (palCache.pal && Math.abs(t - palCache.key) < 0.0015) return palCache.pal;

    let i = 0;
    while (i < STOPS.length - 2 && t > STOPS[i + 1].t) i++;
    const a = STOPS[i];
    const b = STOPS[i + 1];
    const k = clamp((t - a.t) / (b.t - a.t), 0, 1);

    const pal = {};
    for (const key of COLOR_KEYS) pal[key] = mix(a[key], b[key], k);
    for (const key of NUM_KEYS) pal[key] = lerp(a[key], b[key], k);
    pal.name = k < 0.5 ? a.name : b.name;

    palCache = { key: t, pal };
    return pal;
  }

  /* ------------------------------------------------------- 教室陈设布局 --- */
  const BAY = 260;
  const BAY_TYPES = ['window', 'window', 'board', 'window', 'bulletin', 'door', 'window', 'cabinet'];
  const ZONE_LABEL = {
    window: '窗边',
    board: '黑板前',
    bulletin: '布告栏',
    door: '后门边',
    cabinet: '储物柜',
  };

  const features = [];
  (function layout() {
    const startBay = -3;
    const endBay = Math.ceil(WORLD_W / BAY) + 3;
    for (let i = startBay; i < endBay; i++) {
      const idx = ((i % BAY_TYPES.length) + BAY_TYPES.length) % BAY_TYPES.length;
      features.push({ type: BAY_TYPES[idx], x: i * BAY + BAY / 2, bay: i });
    }
  })();

  /* ---------------------------------------------------------- 课桌数据 --- */
  const backDesks = [];
  const foreDesks = [];
  (function makeDesks() {
    const rnd = mulberry32(20240521);
    for (let x = -240; x < WORLD_W + 460; x += 148) {
      backDesks.push({
        x,
        y: FLOOR_Y + 26 + (rnd() * 7 - 3.5),
        s: 0.9 + rnd() * 0.12,
        chair: rnd() > 0.22,
        clutter: rnd(),
      });
    }
    const rnd2 = mulberry32(777001);
    for (let x = -240; x < WORLD_W + 520; x += 208) {
      foreDesks.push({
        x,
        y: FLOOR_Y + 146 + rnd2() * 10,
        s: 1.48 + rnd2() * 0.1,
        chair: false,
        clutter: rnd2(),
      });
    }
  })();

  /* ------------------------------------------------------------- 精灵表 ---
     优先加载体积更小的 hero.webp，失败时自动回退到 hero.png。 */
  let sprite = null;
  let spriteReady = false;
  let sheetIndex = 0;
  function dismissLoading() {
    elLoading.classList.add('is-done');
    setTimeout(() => elLoading.remove(), 700);
  }

  function loadSheet(index) {
    if (index >= SPRITE_SHEETS.length) {
      dismissLoading();
      showToast('未找到 assets/hero.webp，场景仍可游览');
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.addEventListener('load', () => {
      sprite = img;
      sheetIndex = index;
      spriteReady = true;
      dismissLoading();
      showToast('开始漫步吧');
      setTimeout(hideHint, 6800);
    });
    img.addEventListener('error', () => loadSheet(index + 1));
    img.src = SPRITE_SHEETS[index];
  }
  loadSheet(0);

  /* --------------------------------------------------------------- 状态 --- */
  const state = {
    heroX: 220,
    vx: 0,
    dir: 1,
    frame: IDLE_FRAME,
    frameTimer: 0, // 累积的「步数」，满 1 前进一帧
    moving: false,
    camX: 0,
    targetX: null,
    keys: { left: false, right: false, run: false },
    touchDir: 0,
    progress: 0,
    time: 0,
    dust: [],
  };

  const view = { w: 800, h: 450, s: 1.25, visW: 640, dpr: 1 };

  function maxCam() {
    return Math.max(0, WORLD_W - view.visW);
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));

    view.w = w;
    view.h = h;
    view.dpr = dpr;
    view.s = h / WU;
    view.visW = w / view.s;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    state.camX = clamp(state.camX, 0, maxCam());
  }

  /* ------------------------------------------------------------- 音效 --- */
  const Sound = {
    ac: null,
    noise: null,
    enabled: true,
    ensure() {
      if (this.ac) {
        if (this.ac.state === 'suspended') this.ac.resume();
        return this.ac;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ac = new AC();
      const len = Math.floor(this.ac.sampleRate * 0.25);
      const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
      this.noise = buf;
      return this.ac;
    },
    step(strength) {
      if (!this.enabled) return;
      const ac = this.ensure();
      if (!ac || ac.state !== 'running') return;
      const now = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = this.noise;
      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 760 + Math.random() * 240;
      filter.Q.value = 1.2;
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045 * strength, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
      src.connect(filter).connect(gain).connect(ac.destination);
      src.start(now);
      src.stop(now + 0.12);
    },
  };

  /* -------------------------------------------------------- 通用绘制 --- */
  function fillRound(x, y, w, h, r, color) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  /* ------------------------------------------------------------ 天花板 --- */
  function drawCeiling(pal) {
    const ceilTop = mix(pal.wallTop, '#6d6055', 0.34);
    const ceilBot = mix(pal.wallTop, '#ffffff', 0.18);
    const g = ctx.createLinearGradient(0, -10, 0, CEIL_Y);
    g.addColorStop(0, ceilTop);
    g.addColorStop(1, ceilBot);
    ctx.fillStyle = g;
    ctx.fillRect(-500, -40, WORLD_W + 1500, CEIL_Y + 40);

    // 天花与墙面的交界线
    ctx.fillStyle = mix(pal.wallTop, '#5a4d43', 0.22);
    ctx.fillRect(-500, CEIL_Y - 3, WORLD_W + 1500, 3);

    const sh = ctx.createLinearGradient(0, CEIL_Y, 0, CEIL_Y + 22);
    sh.addColorStop(0, 'rgba(84,62,44,0.26)');
    sh.addColorStop(1, 'rgba(84,62,44,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(-500, CEIL_Y, WORLD_W + 1500, 24);

    // 吊灯对齐开间，间隔两个开间一盏
    for (let i = -2; i * BAY * 2 < WORLD_W + BAY * 2; i++) {
      const x = i * BAY * 2;
      const y = CEIL_Y - 18;
      fillRound(x - 66, y - 2, 132, 20, 4, mix(ceilTop, '#000000', 0.18));
      fillRound(x - 57, y + 4, 114, 10, 3, '#fffdf0');
      if (pal.lampA > 0.02) {
        const glow = ctx.createRadialGradient(x, y + 12, 4, x, y + 12, 180);
        glow.addColorStop(0, rgba('#ffe9b8', 0.62 * pal.lampA));
        glow.addColorStop(1, rgba('#ffe9b8', 0));
        ctx.fillStyle = glow;
        ctx.fillRect(x - 190, y - 12, 380, 200);
      }
    }
  }

  /* --------------------------------------------------------------- 墙 --- */
  function drawWall(pal) {
    const g = ctx.createLinearGradient(0, CEIL_Y, 0, FLOOR_Y);
    g.addColorStop(0, pal.wallTop);
    g.addColorStop(0.58, mix(pal.wallTop, pal.wallBot, 0.5));
    g.addColorStop(1, pal.wallBot);
    ctx.fillStyle = g;
    ctx.fillRect(-500, CEIL_Y, WORLD_W + 1500, FLOOR_Y - CEIL_Y);

    // 极淡的竖向刷痕
    ctx.save();
    ctx.globalAlpha = 0.04;
    for (let x = -500, i = 0; x < WORLD_W + 1000; x += 104, i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#7a5c42';
      ctx.fillRect(x, CEIL_Y, 52, FLOOR_Y - CEIL_Y);
    }
    ctx.restore();

    // 壁柱：立在开间分界处，给平墙一点结构感
    for (let i = -3; i * BAY < WORLD_W + BAY * 2; i++) {
      const px = i * BAY;
      ctx.fillStyle = rgba('#4a3222', 0.05);
      ctx.fillRect(px - 1.5, CEIL_Y, 3, FLOOR_Y - CEIL_Y);
    }

    // 墙裙 + 踢脚线
    const baseTop = FLOOR_Y - 26;
    ctx.fillStyle = pal.wainscot;
    ctx.fillRect(-500, baseTop, WORLD_W + 1500, 26);
    ctx.fillStyle = rgba('#ffffff', 0.3);
    ctx.fillRect(-500, baseTop, WORLD_W + 1500, 2.5);
    ctx.fillStyle = rgba('#4a3222', 0.1);
    ctx.fillRect(-500, baseTop + 2.5, WORLD_W + 1500, 1.6);
    ctx.fillStyle = pal.wainscotDark;
    ctx.fillRect(-500, FLOOR_Y - 6, WORLD_W + 1500, 6);
    ctx.fillStyle = 'rgba(74,50,34,0.24)';
    ctx.fillRect(-500, FLOOR_Y - 1.6, WORLD_W + 1500, 1.6);
  }

  /* --------------------------------------------------------------- 窗 --- */
  function drawWindow(f, pal) {
    const w = 152;
    const h = 138;
    const x = f.x - w / 2;
    const y = FLOOR_Y - 30 - h;

    // 外框
    fillRound(x - 9, y - 9, w + 18, h + 18, 6, mix(pal.frame, '#ffffff', 0.42));
    ctx.fillStyle = rgba('#5b3f26', 0.16);
    ctx.fillRect(x - 9, y + h + 5, w + 18, 4);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    const sky = ctx.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, pal.skyTop);
    sky.addColorStop(1, pal.skyBot);
    ctx.fillStyle = sky;
    ctx.fillRect(x, y, w, h);

    // 窗外景物：滚动速度 0.3，制造纵深
    const span = 380;
    const shift = (state.camX * 0.7) % span;
    const gx = x - shift - span;

    ctx.fillStyle = rgba(pal.cloud, 0.62);
    for (let i = 0; i < 5; i++) {
      const cx = gx + 70 + i * span * 0.5 + Math.sin(state.time * 0.15 + i) * 6;
      const cy = y + 26 + (i % 2) * 16;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 26, 8, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 19, cy - 5, 15, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 远处的教学楼屋顶
    ctx.fillStyle = rgba(pal.cloud, 0.3);
    ctx.fillRect(x - 20, y + h - 58, w + 40, 58);

    ctx.fillStyle = pal.treeFar;
    for (let i = 0; i < 9; i++) {
      const tx = gx + i * 108 + 24;
      ctx.beginPath();
      ctx.ellipse(tx, y + h - 40, 22, 17, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = pal.treeNear;
    for (let i = 0; i < 9; i++) {
      const tx = gx + i * 138 - 16;
      ctx.beginPath();
      ctx.ellipse(tx, y + h - 24, 27, 21, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const gl = ctx.createLinearGradient(x, y, x + w, y + h);
    gl.addColorStop(0, rgba('#ffffff', 0.38));
    gl.addColorStop(0.45, rgba('#ffffff', 0.04));
    gl.addColorStop(1, rgba('#ffffff', 0.2));
    ctx.fillStyle = gl;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    // 窗框与窗格
    ctx.strokeStyle = mix(pal.frame, '#ffffff', 0.62);
    ctx.lineWidth = 5;
    ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 2, y + h);
    ctx.moveTo(x, y + h * 0.5);
    ctx.lineTo(x + w, y + h * 0.5);
    ctx.stroke();

    // 窗帘（窄幅、半透明，贴着窗框）
    const curtain = rgba(mix(pal.frame, '#ffffff', 0.55), 0.8);
    fillRound(x - 11, y - 14, 16, h + 26, 7, curtain);
    fillRound(x + w - 5, y - 14, 16, h + 26, 7, curtain);
    ctx.strokeStyle = rgba('#7d6647', 0.12);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x - 6 + i * 6, y - 10);
      ctx.lineTo(x - 6 + i * 6, y + h + 8);
      ctx.moveTo(x + w - 1 + i * 6, y - 10);
      ctx.lineTo(x + w - 1 + i * 6, y + h + 8);
      ctx.stroke();
    }

    // 窗台
    fillRound(x - 18, y + h + 6, w + 36, 9, 3, mix(pal.frame, '#ffffff', 0.5));
    ctx.fillStyle = rgba('#5b3f26', 0.16);
    ctx.fillRect(x - 18, y + h + 15, w + 36, 3);

    // 部分窗台放点小东西
    if (f.bay % 3 === 2) {
      fillRound(x + w - 46, y + h - 4, 16, 11, 2, '#c9743f');
      ctx.fillStyle = '#5f8f5a';
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + (i - 1.5) * 0.5;
        ctx.beginPath();
        ctx.ellipse(x + w - 38 + Math.cos(a) * 8, y + h - 12 + Math.sin(a) * 8, 6, 4, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* ------------------------------------------------------------- 黑板 --- */
  const BOARD_TEXTS = [
    ['值日生：小雨', '明天带伞'],
    ['第三节 · 语文', '背诵第 5 自然段'],
    ['课间十分钟', '记得喝水哦'],
    ['数学作业 P42', '第 1 - 6 题'],
  ];

  function drawBoard(f, pal) {
    const w = 238;
    const h = 134;
    const x = f.x - w / 2;
    const y = FLOOR_Y - 40 - h;
    const idx = ((f.bay % BOARD_TEXTS.length) + BOARD_TEXTS.length) % BOARD_TEXTS.length;

    fillRound(x - 11, y - 11, w + 22, h + 22, 7, mix(pal.frame, '#000000', 0.06));
    fillRound(x - 5, y - 5, w + 10, h + 10, 4, pal.boardDark);

    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, pal.board);
    g.addColorStop(1, mix(pal.board, '#000000', 0.18));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    ctx.save();
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = pal.chalk;
    ctx.beginPath();
    ctx.ellipse(x + w * 0.28, y + h * 0.72, 56, 20, -0.2, 0, Math.PI * 2);
    ctx.ellipse(x + w * 0.76, y + h * 0.34, 40, 15, 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.fillStyle = rgba(pal.chalk, 0.92);
    const lines = BOARD_TEXTS[idx];
    ctx.font = '700 15px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillText(lines[0], x + 16, y + 16);
    ctx.font = '500 12px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillText(lines[1], x + 16, y + 40);

    // 粉笔线条（像随手写的板书）
    ctx.strokeStyle = rgba(pal.chalk, 0.32);
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 16, y + 64 + i * 10);
      ctx.lineTo(x + 16 + (110 - i * 22), y + 64 + i * 10);
      ctx.stroke();
    }

    // 右侧小图：三角形 + 直角标记
    ctx.strokeStyle = rgba(pal.chalk, 0.6);
    ctx.lineWidth = 1.6;
    const bx = x + w - 74;
    const by = y + 58;
    ctx.beginPath();
    ctx.moveTo(bx, by + 40);
    ctx.lineTo(bx + 30, by + 40);
    ctx.lineTo(bx + 30, by);
    ctx.closePath();
    ctx.moveTo(bx + 12, by + 40);
    ctx.lineTo(bx + 12, by + 28);
    ctx.lineTo(bx + 30, by + 28);
    ctx.stroke();

    ctx.fillStyle = rgba(pal.chalk, 0.5);
    ctx.font = '500 10px "PingFang SC", system-ui, sans-serif';
    ctx.fillText('重点！', x + 16, y + 102);
    ctx.restore();

    fillRound(x - 6, y + h + 5, w + 12, 7, 3, mix(pal.frame, '#000000', 0.2));
    ctx.fillStyle = '#fdfaf2';
    ctx.fillRect(x + 26, y + h + 6.5, 16, 3);
    ctx.fillStyle = '#ffd9a0';
    ctx.fillRect(x + 48, y + h + 6.5, 13, 3);
    fillRound(x + w - 54, y + h + 3, 32, 9, 2, '#4b4f5c');
    fillRound(x + w - 54, y + h + 3, 32, 4, 2, '#717887');
  }

  /* ----------------------------------------------------------- 布告栏 --- */
  function drawBulletin(f, pal) {
    const w = 152;
    const h = 100;
    const x = f.x - w / 2;
    const y = FLOOR_Y - 62 - h;

    fillRound(x - 8, y - 8, w + 16, h + 16, 5, mix(pal.frame, '#000000', 0.12));
    ctx.fillStyle = '#c9a26c';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(138,102,54,0.16)';
    for (let i = 0; i < h; i += 4) ctx.fillRect(x, y + i, w, 1.4);

    const rnd = mulberry32(f.bay * 91 + 17);
    for (let i = 0; i < 6; i++) {
      const pw = 26 + rnd() * 16;
      const ph = 30 + rnd() * 16;
      const px = x + 10 + rnd() * (w - pw - 20);
      const py = y + 10 + rnd() * (h - ph - 20);
      ctx.save();
      ctx.translate(px + pw / 2, py + ph / 2);
      ctx.rotate((rnd() - 0.5) * 0.22);
      ctx.fillStyle = rnd() > 0.72 ? '#ffe9a8' : '#fdfcf7';
      ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      ctx.fillStyle = 'rgba(120,110,95,0.38)';
      for (let l = 0; l < 3; l++) ctx.fillRect(-pw / 2 + 4, -ph / 2 + 7 + l * 6, pw - 8, 1.6);
      ctx.fillStyle = '#e8474a';
      ctx.beginPath();
      ctx.arc(0, -ph / 2 + 2.5, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* --------------------------------------------------------------- 门 --- */
  function drawDoor(f, pal) {
    const w = 100;
    const h = 194;
    const x = f.x - w / 2;
    const y = FLOOR_Y - h;

    fillRound(x - 10, y - 10, w + 20, h + 10, 4, mix(pal.frame, '#000000', 0.08));
    ctx.fillStyle = pal.door;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(58,36,21,0.14)';
    ctx.fillRect(x + w - 12, y, 12, h);

    ctx.fillStyle = rgba(pal.glass, 0.9);
    ctx.fillRect(x + 16, y + 16, w - 32, 50);
    ctx.strokeStyle = 'rgba(91,63,38,0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 16, y + 16, w - 32, 50);

    ctx.strokeStyle = 'rgba(91,63,38,0.2)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 16, y + 82, w - 32, 42);
    ctx.strokeRect(x + 16, y + 136, w - 32, 40);

    fillRound(x + 10, y + 104, 12, 24, 5, pal.metal);
    fillRound(x + 13, y + 110, 6, 12, 3, rgba('#ffffff', 0.45));

    fillRound(x + w - 32, y + 72, 26, 16, 3, '#fdfbf3');
    ctx.fillStyle = 'rgba(60,50,40,0.72)';
    ctx.font = '700 9px "PingFang SC", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('三班', x + w - 19, y + 80);
    ctx.textAlign = 'left';

    // 门边墙上的灭火器
    const ex = x - 34;
    fillRound(ex - 9, FLOOR_Y - 88, 18, 44, 3, '#c9463f');
    fillRound(ex - 9, FLOOR_Y - 88, 18, 8, 3, '#a8342f');
    fillRound(ex - 5, FLOOR_Y - 96, 10, 8, 2, '#3d4450');
    ctx.fillStyle = rgba('#ffffff', 0.24);
    ctx.fillRect(ex - 6, FLOOR_Y - 74, 4, 24);
  }

  /* ----------------------------------------------------------- 储物柜 --- */
  function drawCabinet(f, pal) {
    const w = 138;
    const h = 90;
    const x = f.x - w / 2;
    const y = FLOOR_Y - h;

    fillRound(x, y, w, h, 4, pal.deskWood);
    ctx.fillStyle = 'rgba(74,50,34,0.18)';
    ctx.fillRect(x, y, w, 3);
    ctx.strokeStyle = 'rgba(91,63,38,0.24)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + 4);
    ctx.lineTo(x + w / 2, y + h - 6);
    ctx.moveTo(x + 4, y + h * 0.55);
    ctx.lineTo(x + w - 4, y + h * 0.55);
    ctx.stroke();

    ctx.fillStyle = pal.metal;
    ctx.fillRect(x + w / 2 - 12, y + h * 0.28, 8, 3);
    ctx.fillRect(x + w / 2 + 4, y + h * 0.28, 8, 3);

    const px = x + w - 34;
    fillRound(px - 12, y - 16, 24, 16, 3, '#c9743f');
    ctx.fillStyle = '#5f8f5a';
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.45;
      ctx.beginPath();
      ctx.ellipse(px + Math.cos(a) * 12, y - 22 + Math.sin(a) * 12, 9, 6, a, 0, Math.PI * 2);
      ctx.fill();
    }
    fillRound(x + 8, y - 12, 34, 5, 1, '#d8534f');
    fillRound(x + 6, y - 18, 38, 5, 1, '#4f7fd8');
    fillRound(x + 10, y - 24, 30, 5, 1, '#e0b64a');
  }

  /* ------------------------------------------------------------- 挂钟 --- */
  function drawClock(pal, x, y) {
    ctx.fillStyle = '#fdfbf3';
    ctx.beginPath();
    ctx.arc(x, y, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = mix(pal.frame, '#000000', 0.32);
    ctx.lineWidth = 3.4;
    ctx.stroke();

    ctx.fillStyle = 'rgba(60,50,40,0.72)';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillRect(x + Math.cos(a) * 14.5 - 0.8, y + Math.sin(a) * 14.5 - 0.8, 1.7, 1.7);
    }

    const now = new Date();
    const hA = (((now.getHours() % 12) + now.getMinutes() / 60) / 12) * Math.PI * 2 - Math.PI / 2;
    const mA = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
    const sA = (now.getSeconds() / 60) * Math.PI * 2 - Math.PI / 2;

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(45,38,32,0.9)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(hA) * 9, y + Math.sin(hA) * 9);
    ctx.stroke();
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(mA) * 13, y + Math.sin(mA) * 13);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(232,71,74,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(sA) * 14, y + Math.sin(sA) * 14);
    ctx.stroke();
    ctx.fillStyle = '#3c322c';
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ------------------------------------------------------------- 地面 --- */
  function drawFloor(pal) {
    const g = ctx.createLinearGradient(0, FLOOR_Y, 0, WU + 20);
    g.addColorStop(0, mix(pal.floorB, '#000000', 0.18));
    g.addColorStop(0.34, pal.floorA);
    g.addColorStop(1, pal.floorB);
    ctx.fillStyle = g;
    ctx.fillRect(-500, FLOOR_Y, WORLD_W + 1500, WU - FLOOR_Y + 60);

    ctx.save();
    ctx.beginPath();
    ctx.rect(-500, FLOOR_Y, WORLD_W + 1500, WU - FLOOR_Y + 60);
    ctx.clip();

    // 横向木纹（越靠前越疏）
    for (let i = 1; i <= 6; i++) {
      const t = i / 7;
      const y = FLOOR_Y + ease(t) * (WU - FLOOR_Y + 24);
      ctx.strokeStyle = rgba(pal.floorSeam, 0.1 + t * 0.16);
      ctx.lineWidth = 1.1 + t * 0.5;
      ctx.beginPath();
      ctx.moveTo(-500, y);
      ctx.lineTo(WORLD_W + 1000, y);
      ctx.stroke();
    }

    // 纵向拼缝（近乎垂直，随视角轻微发散）
    for (let x = -500; x < WORLD_W + 1000; x += 104) {
      const off = ((x * 0.06) % 24) * 0.45;
      ctx.strokeStyle = rgba(pal.floorSeam, 0.13);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x, FLOOR_Y);
      ctx.lineTo(x + off, WU + 24);
      ctx.stroke();
    }

    const sh = ctx.createLinearGradient(0, FLOOR_Y, 0, FLOOR_Y + 46);
    sh.addColorStop(0, 'rgba(70,45,28,0.34)');
    sh.addColorStop(1, 'rgba(70,45,28,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(-500, FLOOR_Y, WORLD_W + 1500, 46);
    ctx.restore();
  }

  /* ------------------------------------------------------------- 光斑 --- */
  function drawLightShafts(pal) {
    for (const f of features) {
      if (f.type !== 'window') continue;
      const w = 168;
      const x = f.x - w / 2;
      const g = ctx.createLinearGradient(0, FLOOR_Y - 20, 0, FLOOR_Y + 132);
      g.addColorStop(0, rgba('#fff2cc', pal.lightA));
      g.addColorStop(0.55, rgba('#ffe08d', pal.lightA * 0.55));
      g.addColorStop(1, rgba('#ffd166', 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x + 4, FLOOR_Y - 20);
      ctx.lineTo(x + w - 4, FLOOR_Y - 20);
      ctx.lineTo(x + w + 36, FLOOR_Y + 132);
      ctx.lineTo(x + 48, FLOOR_Y + 132);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* ------------------------------------------------------------- 课桌 --- */
  function drawDesk(d, pal, shade) {
    const s = d.s;
    const x = d.x;
    const y = d.y;
    const top = shade ? mix(pal.deskTop, '#241a12', shade * 0.75) : pal.deskTop;
    const wood = shade ? mix(pal.deskWood, '#241a12', shade) : pal.deskWood;
    const dark = shade ? mix(pal.deskDark, '#241a12', shade) : pal.deskDark;
    const metalC = shade ? mix('#6f7a88', '#181c22', shade) : '#7b8593';

    const w = 62 * s;
    const hTop = 5.5 * s;
    const hDesk = 54 * s;
    const legW = 4.5 * s;
    const yTop = y - hDesk;

    // 落地阴影
    ctx.fillStyle = 'rgba(56,34,20,0.2)';
    ctx.beginPath();
    ctx.ellipse(x, y + 2, w * 0.64, 6 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // 椅背（位于桌后）
    if (d.chair) {
      fillRound(x - 16 * s, yTop - 27 * s, 32 * s, 31 * s, 4 * s, mix(metalC, '#ffffff', 0.18));
      fillRound(x - 12.5 * s, yTop - 23 * s, 25 * s, 23 * s, 3 * s, mix(metalC, '#000000', 0.12));
      ctx.fillStyle = mix(metalC, '#000000', 0.25);
      ctx.fillRect(x - 14 * s, yTop + 1 * s, 3.2 * s, 5 * s);
      ctx.fillRect(x + 10.5 * s, yTop + 1 * s, 3.2 * s, 5 * s);
    }

    // 桌腿 + 横撑
    ctx.fillStyle = metalC;
    ctx.fillRect(x - w / 2 + 6 * s, yTop + hTop, legW, hDesk - hTop - 2 * s);
    ctx.fillRect(x + w / 2 - 10.5 * s, yTop + hTop, legW, hDesk - hTop - 2 * s);
    ctx.fillStyle = mix(metalC, '#000000', 0.12);
    ctx.fillRect(x - w / 2 + 4 * s, y - 13 * s, w - 8 * s, 3 * s);

    // 桌斗（前沿面板）
    fillRound(x - w / 2 + 3 * s, yTop + hTop, w - 6 * s, 21 * s, 2 * s, dark);
    ctx.fillStyle = rgba('#000000', 0.14);
    ctx.fillRect(x - w / 2 + 3 * s, yTop + hTop + 17 * s, w - 6 * s, 4 * s);
    ctx.fillStyle = rgba('#ffffff', 0.12);
    ctx.fillRect(x - w / 2 + 3 * s, yTop + hTop, w - 6 * s, 1.4 * s);

    // 桌面
    fillRound(x - w / 2, yTop, w, hTop + 3 * s, 2.5 * s, top);
    ctx.fillStyle = rgba('#ffffff', 0.4);
    ctx.fillRect(x - w / 2 + 2 * s, yTop + 1 * s, w - 4 * s, 1.6 * s);
    ctx.fillStyle = rgba('#5a3b22', 0.22);
    ctx.fillRect(x - w / 2, yTop + hTop + 1.2 * s, w, 1.8 * s);

    // 桌面小物件
    if (d.clutter > 0.25) {
      const bx = x - 13 * s;
      fillRound(bx, yTop - 4 * s, 22 * s, 4.4 * s, 1 * s, '#e05a55');
      fillRound(bx + 2 * s, yTop - 8 * s, 18 * s, 4.4 * s, 1 * s, '#4c7fd0');
    }
    if (d.clutter > 0.62) {
      fillRound(x + 9 * s, yTop - 6.5 * s, 7 * s, 6.5 * s, 1.5 * s, '#e8c65a');
    }
    if (d.clutter < 0.1) {
      fillRound(x + 3 * s, yTop - 5.5 * s, 17 * s, 5.5 * s, 1 * s, '#fdfaf0');
    }
  }

  /* ------------------------------------------------------------- 讲台 --- */
  function drawPodium(f, pal) {
    const x = f.x;
    const y = FLOOR_Y - 44;
    const w = 96;
    ctx.fillStyle = 'rgba(60,38,22,0.16)';
    ctx.beginPath();
    ctx.ellipse(x, y + 47, w * 0.6, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    fillRound(x - w / 2, y, w, 46, 3, mix(pal.deskWood, '#000000', 0.1));
    fillRound(x - w / 2 - 4, y - 6, w + 8, 8, 2, pal.deskTop);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(x - w / 2, y + 26, w, 2);
    fillRound(x - 10, y - 14, 22, 9, 2, '#8fa2b8');
    ctx.fillStyle = '#fdfbf3';
    ctx.fillRect(x - 6, y - 11, 5, 3);
  }

  /* ------------------------------------------------------ 教室整体绘制 --- */
  function drawRoom(pal) {
    drawWall(pal);

    for (const f of features) {
      switch (f.type) {
        case 'window': drawWindow(f, pal); break;
        case 'board': drawBoard(f, pal); break;
        case 'bulletin': drawBulletin(f, pal); break;
        case 'door': drawDoor(f, pal); break;
        case 'cabinet': drawCabinet(f, pal); break;
        default: break;
      }
    }

    for (const f of features) {
      if (f.type === 'board') {
        drawClock(pal, f.x + 104, FLOOR_Y - 196);
        drawPodium(f, pal);
      }
    }

    drawFloor(pal);
    drawLightShafts(pal);

    for (const d of backDesks) drawDesk(d, pal, 0);
  }

  function drawForeground(pal) {
    for (const d of foreDesks) drawDesk(d, pal, 0.46);

    const g = ctx.createLinearGradient(0, WU - 52, 0, WU + 70);
    g.addColorStop(0, 'rgba(46,28,16,0)');
    g.addColorStop(1, 'rgba(46,28,16,0.46)');
    ctx.fillStyle = g;
    ctx.fillRect(-500, WU - 52, WORLD_W + 1500, 140);
  }

  /* ------------------------------------------------------------- 小人 --- */
  function drawHero() {
    // 立姿影子固定；走路时随步频轻微缩放，让脚步更「落地」
    const step = state.moving ? Math.cos(state.frameTimer * Math.PI * 2) : 0;
    const wob = 1 + step * 0.06;
    ctx.fillStyle = 'rgba(48,30,18,0.26)';
    ctx.beginPath();
    ctx.ellipse(state.heroX, HERO_FEET + 1.5, 19 * wob, 4.6 * wob, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!spriteReady) {
      fillRound(
        state.heroX - HERO_W * 0.3,
        HERO_FEET - HERO_H * 0.92,
        HERO_W * 0.6,
        HERO_H * 0.92,
        6,
        'rgba(58,74,107,0.85)'
      );
      return;
    }

    // 高光晕的缩小采样能避免像素边缘出现「闪光/闪烁」的噪点
    const smooth = ctx.imageSmoothingEnabled;
    const quality = ctx.imageSmoothingQuality;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const sw = sprite.naturalWidth / FRAME_COLS;
    const sh = sprite.naturalHeight / FRAME_ROWS;
    const sx = state.frame * sw;
    const sy = (state.dir > 0 ? 0 : 1) * sh;
    // 精灵里脚底在单元格 452/460 处，按这个比例贴到地面线上
    const top = HERO_FEET - HERO_H * SPRITE_FEET_RATIO;
    ctx.drawImage(sprite, sx, sy, sw, sh, state.heroX - HERO_W / 2, top, HERO_W, HERO_H);

    ctx.imageSmoothingEnabled = smooth;
    ctx.imageSmoothingQuality = quality;
  }

  /* ------------------------------------------------------------ 尘土 --- */
  function spawnDust(x, y) {
    if (state.dust.length > 40) return;
    state.dust.push({
      x: x + (Math.random() - 0.5) * 14,
      y: y - 1,
      vx: (Math.random() - 0.5) * 16,
      vy: -6 - Math.random() * 10,
      life: 0.5,
      max: 0.5,
      r: 1.4 + Math.random() * 1.8,
    });
  }

  function updateDust(dt) {
    for (let i = state.dust.length - 1; i >= 0; i--) {
      const p = state.dust[i];
      p.life -= dt;
      if (p.life <= 0) {
        state.dust.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 24 * dt;
      p.vx *= 0.93;
    }
  }

  function drawDust() {
    for (const p of state.dust) {
      const a = (p.life / p.max) * 0.38;
      ctx.fillStyle = 'rgba(233,220,196,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1.4 - p.life / p.max), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ------------------------------------------------------------ 浮尘 --- */
  const motes = [];
  (function seedMotes() {
    const rnd = mulberry32(4242);
    for (let i = 0; i < 30; i++) {
      motes.push({ x: rnd(), y: rnd(), r: 0.6 + rnd() * 1.4, sp: 0.004 + rnd() * 0.012, ph: rnd() * 6.28 });
    }
  })();

  function drawMotes(dt) {
    for (const m of motes) {
      m.y -= m.sp * dt;
      if (m.y < -0.03) {
        m.y = 1.03;
        m.x = Math.random();
      }
      const px = (m.x + Math.sin(state.time * 0.45 + m.ph) * 0.008) * view.w;
      const py = m.y * view.h;
      ctx.fillStyle = 'rgba(255,248,228,0.45)';
      ctx.beginPath();
      ctx.arc(px, py, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ------------------------------------------------------------ 氛围 --- */
  function drawAmbient(pal) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

    ctx.fillStyle = rgba(pal.ambient, pal.ambientA);
    ctx.fillRect(0, 0, view.w, view.h);

    const r = Math.max(view.w, view.h) * 0.8;
    const vg = ctx.createRadialGradient(
      view.w / 2, view.h * 0.46, r * 0.42,
      view.w / 2, view.h * 0.46, r
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(26,15,8,0.32)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  /* ------------------------------------------------------------- 输入 --- */
  const KEYMAP = {
    ArrowLeft: 'right', KeyA: 'right',
    ArrowRight: 'left', KeyD: 'left',
    ShiftLeft: 'run', ShiftRight: 'run',
  };

  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    state.keys[k] = true;
    state.targetX = null;
    hideHint();
    Sound.ensure();
  }, { passive: false });

  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    state.keys[k] = false;
  }, { passive: false });

  window.addEventListener('blur', () => {
    state.keys.left = state.keys.right = state.keys.run = false;
    state.touchDir = 0;
  });

  pad.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.pad__btn');
    if (!btn) return;
    e.preventDefault();
    if (btn.setPointerCapture) btn.setPointerCapture(e.pointerId);
    btn.classList.add('is-active');
    state.touchDir = Number(btn.dataset.dir);
    state.targetX = null;
    hideHint();
    Sound.ensure();
  });

  function releasePad(e) {
    const btn = e.target.closest ? e.target.closest('.pad__btn') : null;
    if (btn) btn.classList.remove('is-active');
    state.touchDir = 0;
  }
  pad.addEventListener('pointerup', releasePad);
  pad.addEventListener('pointercancel', releasePad);
  pad.addEventListener('pointerleave', releasePad);

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const worldX = (e.clientX - rect.left) / view.s + state.camX;
    state.targetX = clamp(worldX, 60, WORLD_W - 60);
    hideHint();
    Sound.ensure();
  });

  /* --------------------------------------------------------------- HUD --- */
  let toastTimer = 0;
  function showToast(text, ms) {
    elToast.textContent = text;
    elToast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elToast.classList.remove('is-show'), ms || 2000);
  }

  let hintHidden = false;
  function hideHint() {
    if (hintHidden) return;
    hintHidden = true;
    elHint.classList.add('is-hidden');
  }

  let lastFill = -1;
  let lastRoom = '';
  let lastTheme = '';

  function updateHud() {
    const pct = Math.round(clamp(state.heroX / (WORLD_W - 120), 0, 1) * 1000) / 10;
    if (Math.abs(pct - lastFill) > 0.4) {
      elFill.style.width = pct + '%';
      lastFill = pct;
    }

    let best = features[0];
    let bestD = Infinity;
    for (const f of features) {
      const d = Math.abs(f.x - state.heroX);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    const room = ZONE_LABEL[best.type] || '教室';
    if (room !== lastRoom) {
      elRoom.textContent = room;
      lastRoom = room;
    }

    const theme = paletteAt(state.progress).name;
    if (theme !== lastTheme) {
      elTheme.textContent = theme;
      lastTheme = theme;
    }
  }

  /* ------------------------------------------------------------ 逻辑 --- */
  function update(dt) {
    state.time += dt;

    const k = state.keys;
    let dir = 0;
    if (k.left) dir -= 1;
    if (k.right) dir += 1;
    if (state.touchDir) dir += state.touchDir;
    dir = clamp(dir, -1, 1);

    if (dir !== 0) {
      state.dir = dir;
      state.targetX = null;
      state.vx = dir * SPEED * (k.run ? RUN_MULT : 1);
    } else if (state.targetX !== null) {
      const d = state.targetX - state.heroX;
      if (Math.abs(d) < 5) {
        state.targetX = null;
        state.vx = 0;
      } else {
        state.dir = Math.sign(d);
        state.vx = state.dir * SPEED * Math.max(0.4, Math.min(1, Math.abs(d) / 70));
      }
    } else {
      state.vx *= Math.pow(0.0015, dt);
      if (Math.abs(state.vx) < 2) state.vx = 0;
    }

    const prevX = state.heroX;
    state.heroX = clamp(state.heroX + state.vx * dt, 56, WORLD_W - 56);
    if (state.heroX !== prevX + state.vx * dt) state.vx = 0;

    /* 步态：走一步就前进一帧，因此步频随移动速度自然变化；
       先加速/减速时按固定节奏慢慢切换，避免「原地抽搐」式抖动。 */
    const speed = Math.abs(state.vx);
    const walking = speed > 14;
    if (walking) {
      const wasMoving = state.moving;
      state.moving = true;
      if (!wasMoving && state.frame === IDLE_FRAME) {
        // 从站立起步：从「接触」帧开始，像真的抬腿迈出第一步
        state.frame = WALK_CYCLE[0];
        state.frameTimer = 0;
      }

      const speedRatio = clamp(speed / SPEED, 0.35, RUN_MULT);
      const stepTime = clamp(STRIDE / speedRatio, MIN_STRIDE, MAX_STRIDE);
      state.frameTimer += dt / stepTime;

      while (state.frameTimer >= 1) {
        state.frameTimer -= 1;
        const idx = WALK_CYCLE.indexOf(state.frame);
        state.frame = WALK_CYCLE[(idx + 1) % WALK_CYCLE.length];
        // 只在触地帧留下脚印与脚步声（循环里有两脚各落地一次）
        if (CONTACT_FRAMES.includes(state.frame)) {
          spawnDust(state.heroX - state.dir * 7, HERO_FEET);
          Sound.step(clamp(speedRatio, 0.45, 1));
        }
      }
    } else {
      state.moving = false;
      state.frame = IDLE_FRAME;
      state.frameTimer = 0;
    }

    const desiredCam = clamp(state.heroX - view.visW * 0.5, 0, maxCam());
    state.camX += (desiredCam - state.camX) * (1 - Math.pow(0.0022, dt));
    state.camX = clamp(state.camX, 0, maxCam());

    state.progress = clamp(state.heroX / (WORLD_W - 100), 0, 1);

    updateDust(dt);
    updateHud();
  }

  function render() {
    const pal = paletteAt(state.progress);
    const s = view.s * view.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = pal.wallBot;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(s, 0, 0, s, 0, 0);

    ctx.save();
    ctx.translate(-state.camX, 0);
    drawCeiling(pal);
    drawRoom(pal);

    drawDust();
    drawHero();

    // 前景视差更快：额外再向左偏移一点
    ctx.save();
    ctx.translate(-state.camX * 0.16, 0);
    drawForeground(pal);
    ctx.restore();
    ctx.restore();

    drawAmbient(pal);
    drawMotes(1);
  }

  /* ------------------------------------------------------------ 启动 --- */
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function boot() {
    resize();

    const params = new URLSearchParams(location.search);
    const startX = Number(params.get('x'));
    if (Number.isFinite(startX) && startX > 0) {
      state.heroX = clamp(startX, 56, WORLD_W - 56);
    }
    // ?walk=1 让角色自动向右走，方便截图/录制预览
    if (params.get('walk') === '1') state.keys.right = true;
    state.camX = clamp(state.heroX - view.visW * 0.5, 0, maxCam());
    state.progress = clamp(state.heroX / (WORLD_W - 100), 0, 1);

    requestAnimationFrame(frame);

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(resize).observe(stage);
    } else {
      window.addEventListener('resize', resize);
    }
    window.addEventListener('orientationchange', () => setTimeout(resize, 240));

    if (window.matchMedia('(hover: none)').matches) {
      elHint.innerHTML = '按住下方按钮走动，或点一下地面让她走过去';
      setTimeout(hideHint, 6800);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        state.keys.left = state.keys.right = state.keys.run = false;
        state.touchDir = 0;
      } else {
        last = performance.now();
      }
    });
  }

  /* ------------------------------------------------------------ 控件 --- */
  btnSound.addEventListener('click', () => {
    Sound.enabled = !Sound.enabled;
    btnSound.setAttribute('aria-pressed', String(Sound.enabled));
    if (Sound.enabled) Sound.ensure();
    showToast(Sound.enabled ? '声音已开启' : '声音已关闭', 1400);
  });

  btnFull.addEventListener('click', () => {
    const target = document.documentElement;
    if (!document.fullscreenElement) {
      const req = target.requestFullscreen || target.webkitRequestFullscreen;
      if (req) req.call(target).catch(() => showToast('当前环境不支持全屏', 1600));
      else showToast('当前环境不支持全屏', 1600);
    } else {
      document.exitFullscreen?.();
    }
  });

  document.addEventListener('fullscreenchange', resize);

  boot();
})();