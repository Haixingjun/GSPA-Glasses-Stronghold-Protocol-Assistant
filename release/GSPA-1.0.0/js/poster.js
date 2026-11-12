/* ==========================================================================
   poster.js — 配队「一图流」：数据快照 → 布局 → Canvas 出图
   --------------------------------------------------------------------------
   设计要点
   · 版式是「手机竖版长图」：固定 1080 逻辑宽、高度自适应，正文 ≥30px，
     缩到 390px 屏宽仍有 ~11px，不用放大也能读；不是把网页截下来。
   · 数据只吃 Team.posterModel()（与配队页同一套判定），这里不重算盟约；
     二维码内容是 Code.encode() 的配队码拼出的深链，扫码直达这套配队。
   · 配色全部读当前主题的 CSS 变量（--cov-active / --cov-empowered / --cov-idle …），
     所以美术风格改了不用动这里。二维码例外：永远黑白，保证能扫。
   · 布局先算成「绘制指令列表」（layout），再一次性画到 canvas（paint）：
     高度可以边排边加，不用两遍渲染或画超大画布再裁。
   · 单文件版 / 关闭图片 / file:// 三种情况都不加载图片，直接用色块 + 首字。
   · 不碰 DOM 直到 open()；模块加载时不创建 canvas，避免 Node 冒烟测试崩。
   ========================================================================== */
(function (global) {
  'use strict';

  var Store = global.Store;
  var Team = global.Team;

  var SITE_FALLBACK = 'https://haixingjun.github.io/GSPA-Glasses-Stronghold-Protocol-Assistant/';
  var MAX_PIXELS = 6.5e6;    // 输出约 1620 宽：手机够清晰，PNG 又不会大到 2 MB+
  var MAX_SIDE = 7000;       // 单边上限（老 iOS 画布长边更小）

  /* ---------------- 版式常量（手机竖版） ---------------- */
  var C = {
    w: 1080,
    pad: 60,
    gap: 20,
    radius: 20,
    avatar: 112,
    tileH: 184,
    capH: 122,
    qr: 300
  };

  /* 字号：缩到 390px 屏宽时约 ×0.36；正文 32px ≈ 11.5px，标题 54px ≈ 19px。
     最小字号不低于 28——再小在手机上就要放大了。 */
  var F = {
    h1: 54, meta: 30, section: 44, note: 30,
    name: 44, sub: 32, tag: 32,
    covName: 38, covNum: 42, covState: 30,
    capBond: 38, capTotal: 46, capParts: 32, capSrc: 30,
    codeLabel: 30, code: 40, url: 28, legal: 28
  };

  var state = { token: 0, blob: '', canvas: null, filename: '' };

  /* ---------------- 基础工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cssVar(name, fallback) {
    try {
      var v = global.getComputedStyle
        ? global.getComputedStyle(document.documentElement).getPropertyValue(name)
        : '';
      v = String(v || '').replace(/\s+/g, ' ').trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function theme() {
    var light = String(document.documentElement.getAttribute('data-theme') || '') === 'light';
    return {
      light: light,
      bg: cssVar('--bg', '#0b0f14'),
      bg1: cssVar('--bg1', '#111721'),
      bg2: cssVar('--bg2', '#171f2a'),
      bg3: cssVar('--bg3', '#1e2835'),
      line: cssVar('--line', '#232e3b'),
      line2: cssVar('--line2', '#33414f'),
      fg: cssVar('--fg', '#e7eef6'),
      fg2: cssVar('--fg2', '#a2b0bf'),
      fg3: cssVar('--fg3', '#6e7c8b'),
      accent: cssVar('--accent', '#5bd1e6'),
      active: cssVar('--cov-active', '#55c98b'),
      activeBg: cssVar('--cov-active-bg', 'rgba(85,201,139,.1)'),
      activeLine: cssVar('--cov-active-line', 'rgba(85,201,139,.45)'),
      empowered: cssVar('--cov-empowered', '#e6b35a'),
      empoweredBg: cssVar('--cov-empowered-bg', 'rgba(230,179,90,.1)'),
      empoweredLine: cssVar('--cov-empowered-line', 'rgba(230,179,90,.5)'),
      idle: cssVar('--cov-idle', '#7c8794'),
      idleBg: cssVar('--cov-idle-bg', 'rgba(124,135,148,.06)'),
      idleLine: cssVar('--cov-idle-line', 'rgba(124,135,148,.38)'),
      font: cssVar('--font', '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'),
      mono: cssVar('--mono', 'ui-monospace, Consolas, monospace')
    };
  }

  function fontOf(size, weight, mono) {
    return (weight || 600) + ' ' + size + 'px ' + (mono ? cssVar('--mono', 'Consolas, monospace') : cssVar('--font', 'sans-serif'));
  }

  function hslOf(name, sat, light) {
    var h = 200;
    try { h = global.UI && UI.hue ? UI.hue(name) : 200; } catch (e) { h = 200; }
    return 'hsl(' + h + ' ' + (sat || 62) + '% ' + (light || 58) + '%)';
  }

  /** 缺图回退用的首字：与页面 avatarHtml 一致的取法 */
  function initialOf(name) {
    var s = String(name == null ? '' : name).replace(/^[“"'\s]+/, '');
    return s ? s.charAt(0) : '?';
  }

  /**
   * 缺图回退：头像用「同色相淡底 + 彩色首字」，图标用「深色底座 + 浅色首字」，
   * 与 app.css 的 .avatar / .icon 回退观感一致（不另造一套视觉）。
   */
  function fallbackAvatar(b, x, y, size, r, name, pal) {
    var h = hueOf(name);
    b.rect(x, y, size, size, r, 'hsla(' + h + ', 60%, 58%, 0.16)', 'hsla(' + h + ', 60%, 58%, 0.3)', 1);
    b.text(x + size / 2, y + size / 2 - size * 0.22, initialOf(name), Math.round(size * 0.42), 700,
      pal.light ? 'hsl(' + h + ', 55%, 38%)' : 'hsl(' + h + ', 70%, 74%)', { align: 'center' });
  }

  /** 图标底座：PRTS 图标是透明底白色线稿，浅色主题下必须有深色底，否则白线看不见（同页面 .icon） */
  function iconBase(b, x, y, size, r, light) {
    b.rect(x, y, size, size, r, '#1d242d',
      light ? 'rgba(15,23,32,.22)' : 'rgba(255,255,255,.12)', 1);
  }

  function fallbackIcon(b, x, y, size, r, name, pal) {
    b.rect(x, y, size, size, r, '#1b222b', pal.light ? 'rgba(15,23,32,.22)' : 'rgba(255,255,255,.16)', 1);
    b.text(x + size / 2, y + size / 2 - size * 0.24, initialOf(name), Math.round(size * 0.44), 600,
      '#c9d4e0', { align: 'center' });
  }

  function hueOf(name) {
    try { return global.UI && UI.hue ? UI.hue(name) : 200; } catch (e) { return 200; }
  }

  function measureCtx() {
    var c = document.createElement('canvas');
    c.width = 8;
    c.height = 8;
    return c.getContext('2d');
  }

  function widthOf(ctx, text, font) {
    ctx.font = font;
    return ctx.measureText(String(text)).width;
  }

  /** 单行装不下就缩字号，再装不下就截断加省略号 */
  function fitText(ctx, text, size, minSize, maxW, weight, mono) {
    var s = String(text == null ? '' : text);
    var f = fontOf(size, weight, mono);
    if (widthOf(ctx, s, f) <= maxW) return { text: s, size: size, font: f };
    for (var k = size - 2; k >= minSize; k -= 2) {
      f = fontOf(k, weight, mono);
      if (widthOf(ctx, s, f) <= maxW) return { text: s, size: k, font: f };
    }
    f = fontOf(minSize, weight, mono);
    var out = s;
    while (out.length > 1 && widthOf(ctx, out + '…', f) > maxW) out = out.slice(0, -1);
    return { text: out + '…', size: minSize, font: f };
  }

  /** 按字符折行（URL 没有空格，必须逐字断） */
  function wrapText(ctx, text, font, maxW, maxLines) {
    var s = String(text == null ? '' : text);
    var lines = [];
    var cur = '';
    for (var i = 0; i < s.length; i++) {
      var next = cur + s.charAt(i);
      if (widthOf(ctx, next, font) > maxW && cur) {
        lines.push(cur);
        cur = s.charAt(i);
        if (maxLines && lines.length >= maxLines) { cur = ''; break; }
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
    if (maxLines && lines.length >= maxLines) {
      var last = lines[maxLines - 1];
      while (last.length > 1 && widthOf(ctx, last + '…', font) > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '…';
      lines = lines.slice(0, maxLines);
    }
    return lines;
  }

  /** 追加圆角矩形到当前路径（不 beginPath）：画描边环 / 挖洞时用 */
  function roundRectAdd(ctx, x, y, w, h, r) {
    var rr = Math.max(0, Math.min(r || 0, Math.min(w, h) / 2));
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    var rr = Math.max(0, Math.min(r || 0, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  /* ---------------- 链接 ---------------- */
  function isLocalHost(host) {
    return /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(String(host || ''));
  }

  /** 二维码里放哪个站点：线上域名优先，本地调试回退到固定线上地址 */
  function linkBase() {
    if (global.GSPA_SITE) return String(global.GSPA_SITE);
    var loc = global.location || {};
    var proto = String(loc.protocol || '');
    var origin = String(loc.origin || '');
    if (/^https?:$/.test(proto) && origin && !isLocalHost(loc.hostname)) {
      var path = String(loc.pathname || '/');
      if (path.charAt(path.length - 1) !== '/') path = path.replace(/[^/]*$/, '');
      return origin + (path || '/');
    }
    return SITE_FALLBACK;
  }

  function shareUrl(code) {
    var base = linkBase();
    if (base.charAt(base.length - 1) !== '/') base += '/';
    return base + '#/team?c=' + code;
  }

  /* ---------------- 图片 ---------------- */
  /**
   * 这张图为什么不带头像/图标：
   *   standalone = 单文件版（构建时就不内嵌素材）  toggle = 顶栏图片开关关着
   *   file       = file:// 打开，浏览器禁止把本地图片导出到画布（运行时才发现）
   */
  function imagesDisabled() {
    try {
      if (global.GSPA_NO_AVATARS || global.GSPA_NO_ICONS) return 'standalone';
      var body = document.body;
      if (body && body.classList && body.classList.contains('no-avatars')) return 'toggle';
    } catch (e) { /* 忽略 */ }
    return '';
  }

  function wantAvatars() {
    try {
      if (global.GSPA_NO_AVATARS) return false;
      if (document.body.classList.contains('no-avatars')) return false;
    } catch (e) { /* 忽略 */ }
    return true;
  }

  function wantIcons() {
    try {
      if (global.GSPA_NO_ICONS) return false;
      if (document.body.classList.contains('no-avatars')) return false;
    } catch (e) { /* 忽略 */ }
    return true;
  }

  function collectImages(model) {
    var urls = [];
    var seen = {};
    function add(u) {
      if (!u || seen[u]) return;
      seen[u] = 1;
      urls.push(u);
    }
    var i;
    if (wantAvatars()) {
      for (i = 0; i < model.pieces.length; i++) add(model.pieces[i].avatar);
    }
    if (wantIcons()) {
      // 盟约图标带里「已激活」与「可激活」都要画图标，两边都得预加载
      for (i = 0; i < model.covenants.length; i++) add(model.covenants[i].icon);
      for (i = 0; i < (model.pending || []).length; i++) add(model.pending[i].icon);
      for (i = 0; i < model.caps.length; i++) add(model.caps[i].icon);
    }
    return urls;
  }

  function loadImages(urls, done) {
    var images = {};
    if (!urls.length) { done(images); return; }
    var left = urls.length;
    var settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      done(images);
    }
    var timer = global.setTimeout(finish, 6000);
    function step() {
      left--;
      if (left <= 0) {
        global.clearTimeout(timer);
        finish();
      }
    }
    for (var i = 0; i < urls.length; i++) {
      (function (u) {
        var img = new global.Image();
        img.onload = function () { images[u] = img; step(); };
        img.onerror = function () { step(); };
        img.src = u;
      })(urls[i]);
    }
  }

  /* ---------------- 布局：生成绘制指令 ---------------- */
  function Builder(ctx, pal) {
    this.ctx = ctx;
    this.pal = pal;
    this.ops = [];
    this.y = C.pad;
  }
  Builder.prototype.rect = function (x, y, w, h, r, fill, stroke, lw, dash) {
    this.ops.push({
      t: 'rect', x: x, y: y, w: w, h: h, r: r || 0,
      fill: fill, stroke: stroke, lw: lw || 1, dash: dash || null
    });
  };
  Builder.prototype.line = function (x1, y1, x2, y2, color, w) {
    this.ops.push({ t: 'line', x1: x1, y1: y1, x2: x2, y2: y2, color: color, w: w || 1 });
  };
  Builder.prototype.text = function (x, y, str, size, weight, color, opts) {
    var o = opts || {};
    var f = fontOf(size, weight, o.mono);
    this.ops.push({
      t: 'text', x: x, y: y, text: String(str), font: f, size: size,
      fill: color, align: o.align || 'left'
    });
    return size * 1.25;
  };
  Builder.prototype.img = function (key, x, y, w, h, r, name, alpha) {
    this.ops.push({
      t: 'img', key: key, x: x, y: y, w: w, h: h, r: r,
      hue: hueOf(name), letter: initialOf(name), light: !!this.pal.light,
      alpha: alpha == null ? 1 : alpha
    });
  };
  Builder.prototype.bar = function (x, y, w, h, pct, bg, fg) {
    this.ops.push({ t: 'bar', x: x, y: y, w: w, h: h, pct: Math.max(0, Math.min(1, pct || 0)), bg: bg, fg: fg });
  };
  Builder.prototype.qr = function (qr, x, y, card) {
    this.ops.push({
      t: 'qr', qr: qr, x: x, y: y, size: card,
      card: this.pal.light ? '#ffffff' : '#f6f8fa',
      dark: this.pal.light ? '#10161d' : '#0c1117',
      border: this.pal.light ? 'rgba(15,23,32,.16)' : 'rgba(255,255,255,.16)'
    });
  };
  Builder.prototype.gap = function (h) { this.y += h; };

  function sectionHead(b, title, note) {
    var pal = b.pal;
    b.rect(C.pad, b.y + 6, 6, 34, 3, pal.accent);
    b.text(C.pad + 20, b.y, title, F.section, 700, pal.fg);
    if (note) b.text(C.w - C.pad, b.y + 10, note, F.note, 500, pal.fg3, { align: 'right' });
    b.y += 60;
  }

  function layoutHeader(b, model, bits) {
    var pal = b.pal;
    b.text(C.pad, b.y, 'GSPA 配队', F.h1, 700, pal.fg);
    // 赛季名（如「卫戍协议：规程」）；不放生成时间——一图流会被反复转发，时间只会过期
    var season = String(model.season || '').replace(/·/g, '：');
    if (season) {
      b.text(C.w - C.pad, b.y + 12, season, F.meta, 500, pal.fg3, { align: 'right' });
    }
    b.y += F.h1 * 1.3;
    b.line(C.pad, b.y, C.w - C.pad, b.y, pal.line, 2);
    b.y += 28;
  }

  /** 右对齐的小图例：彩色圆点 + 文字（强化 / 激活 / 可激活） */
  function legend(b, rightX, y, items) {
    var pal = b.pal;
    var gap = 20;
    var dot = 12;
    var widths = [];
    var total = 0;
    var i;
    for (i = 0; i < items.length; i++) {
      var w = dot + 8 + widthOf(b.ctx, items[i].text, fontOf(F.note, 500));
      widths.push(w);
      total += w + (i ? gap : 0);
    }
    var x = rightX - total;
    for (i = 0; i < items.length; i++) {
      b.rect(x, y + 12, dot, dot, dot / 2, items[i].color);
      b.text(x + dot + 8, y, items[i].text, F.note, 500, pal.fg3);
      x += widths[i] + gap;
    }
  }

  function layoutOperators(b, model) {
    var pal = b.pal;
    sectionHead(b, '干员', model.pieces.length ? model.pieces.length + ' 名' : '');
    if (!model.pieces.length) {
      b.text(C.pad, b.y, '先在配队页加入干员，再回来生成一图流。', F.sub, 500, pal.fg3);
      b.y += 70;
      return;
    }

    var cols = 2;
    var gap = C.gap;
    var tileW = (C.w - C.pad * 2 - gap) / 2;
    var rows = Math.ceil(model.pieces.length / cols);
    for (var i = 0; i < model.pieces.length; i++) {
      var p = model.pieces[i];
      var cx = C.pad + (i % cols) * (tileW + gap);
      var cy = b.y + Math.floor(i / cols) * (C.tileH + gap);
      b.rect(cx, cy, tileW, C.tileH, C.radius, pal.bg1, pal.line);

      var av = C.avatar;
      if (wantAvatars() && p.avatar) {
        b.img(p.avatar, cx + 20, cy + (C.tileH - av) / 2, av, av, 16, p.name);
      } else {
        fallbackAvatar(b, cx + 20, cy + (C.tileH - av) / 2, av, 16, p.name, pal);
      }

      var tx = cx + 20 + av + 22;
      var tw = tileW - (tx - cx) - 20;
      var name = fitText(b.ctx, p.name, F.name, 30, tw - (p.elite ? 76 : 0), 700);
      b.text(tx, cy + 22, name.text, name.size, 700, pal.fg);

      if (p.elite) {
        var bw = 58;
        b.rect(cx + tileW - bw - 18, cy + 24, bw, 34, 8, pal.empoweredBg, pal.empoweredLine);
        b.text(cx + tileW - bw / 2 - 18, cy + 29, '精锐', 24, 600, pal.empowered, { align: 'center' });
      }

      var metaParts = [];
      if (p.pick) metaParts.push('自选');
      else if (p.tierLabel) metaParts.push(p.tierLabel);
      if (p.equipCount) metaParts.push('装备 ' + p.equipCount);
      metaParts.push('◈' + p.price);
      b.text(tx, cy + 82, metaParts.join(' · '), F.sub, 500, pal.fg2);

      var tags = p.tags.slice(0, 2);
      var tx2 = tx;
      for (var k = 0; k < tags.length; k++) {
        var dot = hslOf(tags[k]);
        b.rect(tx2, cy + 138, 13, 13, 6, dot);
        var w = widthOf(b.ctx, tags[k], fontOf(F.tag, 500));
        b.text(tx2 + 21, cy + 130, tags[k], F.tag, 500, pal.fg2);
        tx2 += 21 + w + 18;
        if (tx2 > tx + tw) break;
      }
      if (p.morph) b.text(tx2, cy + 130, '· 转职 ' + p.morph, F.tag, 500, pal.idle);
    }
    b.y += rows * (C.tileH + gap) + 14;
  }

  /**
   * 盟约图标带：用图标直接表达「强化 / 激活 / 可激活」，不再单独排一排数字。
   * PRTS 只有一套线稿图标，状态靠描边颜色 + 图标亮度区分（和配队页一致）：
   *   强化 = 琥珀实线框 · 激活 = 绿色实线框 · 可激活 = 灰色虚线框（图标压暗）
   */
  function layoutCovenantBand(b, model) {
    var pal = b.pal;
    var rows = [];
    var i;

    // 已强化 → 已激活 → 可激活；同档按达成率
    for (i = 0; i < model.covenants.length; i++) rows.push(model.covenants[i]);
    rows.sort(function (a, c) {
      var order = { empowered: 0, active: 1 };
      var d = (order[a.state] == null ? 9 : order[a.state]) - (order[c.state] == null ? 9 : order[c.state]);
      if (d) return d;
      var ra = a.threshold ? a.count / a.threshold : 0;
      var rc = c.threshold ? c.count / c.threshold : 0;
      return rc - ra;
    });
    for (i = 0; i < (model.pending || []).length; i++) rows.push(model.pending[i]);

    var legendItems = [
      { color: pal.empowered, text: '强化 ' + model.summary.empowered },
      { color: pal.active, text: '激活 ' + (model.summary.active - model.summary.empowered) },
      { color: pal.idle, text: '可激活 ' + model.summary.near }
    ];

    var headY = b.y;
    b.rect(C.pad, headY + 6, 6, 34, 3, pal.accent);
    b.text(C.pad + 20, headY, '盟约', F.section, 700, pal.fg);
    if (rows.length) legend(b, C.w - C.pad, headY + 8, legendItems);
    b.y += 60;

    if (!rows.length) {
      b.text(C.pad, b.y, '这套配队还没有点亮任何盟约。', F.sub, 500, pal.fg3);
      b.y += 56;
      return;
    }

    var cols = 6;
    var gap = 10;
    var cellW = (C.w - C.pad * 2 - gap * (cols - 1)) / cols;
    var icon = 62;
    var cellH = 172;
    var lineCount = Math.ceil(rows.length / cols);

    for (i = 0; i < rows.length; i++) {
      var c = rows[i];
      var cx = C.pad + (i % cols) * (cellW + gap);
      var cy = b.y + Math.floor(i / cols) * cellH;
      var on = c.state === 'empowered';
      var near = c.state === 'near';
      var color = on ? pal.empowered : (near ? pal.idle : pal.active);
      var lineColor = on ? pal.empoweredLine : (near ? pal.idleLine : pal.activeLine);
      var bgColor = on ? pal.empoweredBg : (near ? pal.idleBg : pal.activeBg);

      var ix = cx + (cellW - icon) / 2;
      var iy = cy + 6;
      // 状态框
      b.rect(ix - 5, iy - 5, icon + 10, icon + 10, 15, bgColor, lineColor, near ? 1.5 : 2, near ? [6, 5] : null);
      if (wantIcons() && c.icon) {
        iconBase(b, ix, iy, icon, 10, pal.light);
        b.img(c.icon, ix, iy, icon, icon, 10, c.name, near ? 0.55 : 1);
      } else {
        fallbackIcon(b, ix, iy, icon, 10, c.name, pal);
      }

      var nameFit = fitText(b.ctx, c.name, 32, 22, cellW - 6, 700);
      b.text(cx + cellW / 2, cy + 82, nameFit.text, nameFit.size, 700, near ? pal.fg2 : pal.fg, { align: 'center' });

      // 只标「人数/门槛」；玩家自己填的层数不上图（层数只影响数值，不代表激活状态）
      b.text(cx + cellW / 2, cy + 130, c.count + '/' + c.threshold, 26, on ? 700 : 500, color, { align: 'center' });
    }

    b.y += lineCount * cellH + 16;
    if (model.dupes && model.dupes.length) {
      b.text(C.pad, b.y, '重复干员只计一次：' + model.dupes.join('、'), F.note, 500, pal.idle);
      b.y += 44;
    }
  }

  function layoutCaps(b, model) {
    var pal = b.pal;
    sectionHead(b, '单回合叠层上限', '按词条估算');
    if (!model.caps.length) {
      b.text(C.pad, b.y, '当前队伍没有可统计的叠层词条。', F.sub, 500, pal.fg3);
      b.y += 60;
      return;
    }

    var limit = 8;
    var shown = model.caps.slice(0, limit);
    for (var i = 0; i < shown.length; i++) {
      var r = shown[i];
      var y = b.y + i * C.capH;
      b.rect(C.pad, y, C.w - C.pad * 2, C.capH - 10, 14, pal.bg1, pal.line);

      var icon = 34;
      if (wantIcons() && r.icon) {
        iconBase(b, C.pad + 16, y + 14, icon, 8, pal.light);
        b.img(r.icon, C.pad + 16, y + 14, icon, icon, 8, r.bond);
      } else {
        fallbackIcon(b, C.pad + 16, y + 14, icon, 8, r.bond, pal);
      }

      var x = C.pad + 16 + icon + 12;
      b.text(x, y + 10, r.bond, F.capBond, 700, pal.fg);

      var parts = [];
      for (var j = 0; j < r.parts.length; j++) parts.push(r.parts[j].amount);
      var totalText = '+' + r.total;
      var tw = widthOf(b.ctx, r.bond, fontOf(F.capBond, 700));
      var tx = x + tw + 16;
      b.text(tx, y + 6, totalText, F.capTotal, 700, pal.accent);
      var tw2 = widthOf(b.ctx, totalText, fontOf(F.capTotal, 700));
      b.text(tx + tw2 + 8, y + 20, '（' + parts.join('+') + '）', F.capParts, 500, pal.fg2);

      var src = [];
      for (j = 0; j < r.parts.length; j++) {
        src.push(r.parts[j].name + (r.parts[j].generic ? '（通用）' : '') + ' +' + r.parts[j].amount);
      }
      var srcFit = fitText(b.ctx, src.join(' · '), F.capSrc, 24, C.w - C.pad * 2 - 32, 500);
      b.text(C.pad + 16, y + 68, srcFit.text, srcFit.size, 500, pal.fg3);
    }
    b.y += shown.length * C.capH + 8;
    if (model.caps.length > limit) {
      b.text(C.pad, b.y, '另有 ' + (model.caps.length - limit) + ' 个盟约的叠层未列出（按总数排序取前 ' + limit + '）',
        F.note, 500, pal.fg3);
      b.y += 44;
    }
  }

  function layoutFooter(b, model, bits) {
    var pal = b.pal;
    b.y += 8;

    var panelW = C.w - C.pad * 2;
    var qrBox = 272;
    var padIn = 24;
    var qrX = C.pad + padIn;
    var qrY = b.y + padIn;
    var textX = qrX + qrBox + 30;
    var textW = C.pad + panelW - padIn - textX;

    // 先按文字估高，再画面板（面板高度取二维码与文字块的最大值）
    var y = qrY;
    // 配队码永远排一行：太长就缩字号（换行断在码中间最难抄）
    var codeFit = fitText(b.ctx, bits.code, F.code, 28, textW, 700, true);
    var urlLines = wrapText(b.ctx, bits.url, fontOf(F.url, 500, true), textW, 3);
    var textH = 40 + codeFit.size * 1.3 + 14 +
      urlLines.length * F.url * 1.34 + 14 + F.legal * 1.3 + 10 + F.legal * 1.3;
    var panelH = Math.max(qrBox, textH) + padIn * 2;

    b.rect(C.pad, b.y, panelW, panelH, 20, pal.bg1, pal.line);
    if (bits.qr) {
      b.qr(bits.qr, qrX, qrY, qrBox);
    } else {
      b.rect(qrX, qrY, qrBox, qrBox, 16, pal.bg2, pal.idleLine);
      b.text(qrX + qrBox / 2, qrY + qrBox / 2 - 14, '二维码不可用', F.note, 500, pal.fg3, { align: 'center' });
    }

    b.text(textX, y, '配队码', F.codeLabel, 600, pal.fg3);
    y += 40;
    b.text(textX, y, codeFit.text, codeFit.size, 700, pal.fg, { mono: true });
    y += codeFit.size * 1.3;

    y += 14;
    for (var i = 0; i < urlLines.length; i++) {
      b.text(textX, y, urlLines[i], F.url, 500, pal.accent, { mono: true });
      y += F.url * 1.34;
    }

    y += 14;
    b.text(textX, y, '非官方工具，数据请以游戏内为准', F.legal, 500, pal.fg3);
    y += F.legal * 1.3 + 10;
    b.text(textX, y, '素材版权：鹰角网络 / PRTS Wiki', F.legal, 500, pal.fg3);

    b.y += panelH + 24;
  }

  /** 布局：只吃 ctx 量文字宽度，不真的画 */
  function layout(ctx, model, bits, pal) {
    var b = new Builder(ctx, pal);
    layoutHeader(b, model, bits);
    layoutCovenantBand(b, model);
    layoutOperators(b, model);
    layoutCaps(b, model);
    layoutFooter(b, model, bits);
    return { w: C.w, h: Math.ceil(b.y) + C.pad, ops: b.ops };
  }

  /* ---------------- 绘制 ---------------- */
  function paint(canvas, plan, pal, images, scale) {
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 背景：平铺纯色。渐变会让每一行像素都不同，PNG 压不下去（2.3MB → 0.9MB）
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.scale(scale, scale);
    ctx.textBaseline = 'top';

    for (var i = 0; i < plan.ops.length; i++) {
      var op = plan.ops[i];
      if (op.t === 'rect') {
        roundRectPath(ctx, op.x, op.y, op.w, op.h, op.r);
        if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(); }
        if (op.stroke) {
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.lw;
          if (op.dash) ctx.setLineDash(op.dash);
          ctx.stroke();
          if (op.dash) ctx.setLineDash([]);
        }
      } else if (op.t === 'line') {
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.w;
        ctx.stroke();
      } else if (op.t === 'text') {
        ctx.font = op.font;
        ctx.fillStyle = op.fill;
        ctx.textAlign = op.align;
        ctx.fillText(op.text, op.x, op.y);
        ctx.textAlign = 'left';
      } else if (op.t === 'bar') {
        roundRectPath(ctx, op.x, op.y, op.w, op.h, op.h / 2);
        ctx.fillStyle = op.bg;
        ctx.fill();
        var pw = Math.max(op.h, op.w * op.pct);
        roundRectPath(ctx, op.x, op.y, pw, op.h, op.h / 2);
        ctx.fillStyle = op.fg;
        ctx.fill();
      } else if (op.t === 'img') {
        var img = images[op.key];
        if (img && img.complete && img.naturalWidth) {
          ctx.save();
          roundRectPath(ctx, op.x, op.y, op.w, op.h, op.r);
          ctx.clip();
          if (op.alpha != null && op.alpha !== 1) ctx.globalAlpha = op.alpha;
          ctx.drawImage(img, op.x, op.y, op.w, op.h);
          ctx.restore();
        } else {
          // 缺图 / 关闭图片 / file://：与页面 .avatar 回退同款（淡色底 + 彩色首字）
          roundRectPath(ctx, op.x, op.y, op.w, op.h, op.r);
          ctx.fillStyle = 'hsla(' + op.hue + ', 60%, 58%, 0.16)';
          ctx.fill();
          ctx.strokeStyle = 'hsla(' + op.hue + ', 60%, 58%, 0.3)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.font = fontOf(Math.round(op.h * 0.42), 700);
          ctx.fillStyle = op.light ? 'hsl(' + op.hue + ', 55%, 38%)' : 'hsl(' + op.hue + ', 70%, 74%)';
          ctx.textAlign = 'center';
          ctx.fillText(op.letter, op.x + op.w / 2, op.y + op.h / 2 - Math.round(op.h * 0.22));
          ctx.textAlign = 'left';
        }
      } else if (op.t === 'qr') {
        paintQr(ctx, op, scale);
      }
    }
  }

  /**
   * 二维码用设备像素画：模块边长取整，避免缩放出现半像素灰边。
   * 视觉：圆角浅色卡片 + 圆点数据模块 + 圆角定位眼（三只「眼睛」保持实心，扫码器靠它们定位）；
   * 对比度仍是深码浅底（不用反色），静区仍是 4 模块，只把「刺眼的白方块 + 满屏方点」软化。
   */
  function paintQr(ctx, op, scale) {
    var qr = op.qr;
    var size = qr.size;
    var total = size + 8;                         // 4 模块静区 ×2
    var m = Math.max(2, Math.floor(op.size * scale / total));
    var card = m * total;
    var x0 = Math.round(op.x * scale + (op.size * scale - card) / 2);
    var y0 = Math.round(op.y * scale + (op.size * scale - card) / 2);
    var radius = Math.min(card * 0.055, 22);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 卡片：柔和白（不是纯白），圆角；浅色主题下靠描边分层
    roundRectPath(ctx, x0, y0, card, card, radius);
    ctx.fillStyle = op.card || '#f6f8fa';
    ctx.fill();
    if (op.border) {
      ctx.strokeStyle = op.border;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    var qx = x0 + 4 * m;
    var qy = y0 + 4 * m;
    var dark = op.dark || '#0c1117';
    var eyes = [[0, 0], [size - 7, 0], [0, size - 7]];
    var i, x, y;

    function eyeIndex(mx, my) {
      for (var k = 0; k < 3; k++) {
        if (mx >= eyes[k][0] && mx < eyes[k][0] + 7 &&
            my >= eyes[k][1] && my < eyes[k][1] + 7) return k;
      }
      return -1;
    }

    // 数据模块圆点、功能模块实心：定时 / 校正 / 格式信息保持方正，解码器更好对位
    ctx.fillStyle = dark;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        if (!qr.modules[y * size + x]) continue;
        if (eyeIndex(x, y) >= 0) continue;
        var px = qx + x * m;
        var py = qy + y * m;
        if (qr.func && qr.func[y * size + x]) {
          ctx.fillRect(px, py, m, m);
        } else {
          // 微圆角实心块：比直角柔和，又不会碎成满屏小圆点
          roundRectPath(ctx, px, py, m, m, Math.max(1, m * 0.16));
          ctx.fill();
        }
      }
    }

    // 三只定位眼：1 模块宽的圆角环 + 3×3 圆角芯
    for (i = 0; i < 3; i++) {
      var ox = qx + eyes[i][0] * m;
      var oy = qy + eyes[i][1] * m;
      ctx.beginPath();
      roundRectAdd(ctx, ox, oy, 7 * m, 7 * m, m * 1.3);
      roundRectAdd(ctx, ox + m, oy + m, 5 * m, 5 * m, m * 0.9);
      ctx.fill('evenodd');
      roundRectPath(ctx, ox + 2 * m, oy + 2 * m, 3 * m, 3 * m, m * 0.85);
      ctx.fill();
    }

    ctx.restore();
  }

  /* ---------------- 组装 ---------------- */
  function fileStamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function build() {
    var data = Store.getData();
    var team = Store.getTeam();
    var model = Team.posterModel(team);
    var pal = theme();
    var code = global.Code.encode(team, data);
    var url = shareUrl(code);
    var qr = global.Qr.encode(url);

    // 闭环自检：码读回来必须还是这套队，否则宁可不画二维码
    var back = global.Code.decode(code, data);
    var okCode = !!(back && back.team && sameTeam(back.team, team));
    if (!okCode) qr = null;

    var bits = { code: code, url: url, qr: qr };
    state.filename = 'GSPA-配队-' + fileStamp() + '.png';

    var ctx = measureCtx();
    var plan = layout(ctx, model, bits, pal);

    var scale = 2;
    while (scale > 1 && (plan.w * scale > 2200 || plan.h * scale > MAX_SIDE ||
      plan.w * plan.h * scale * scale > MAX_PIXELS)) {
      scale -= 0.25;
    }
    if (plan.h * scale > MAX_SIDE) scale = Math.max(0.6, MAX_SIDE / plan.h);

    var canvas = document.createElement('canvas');
    canvas.width = Math.round(plan.w * scale);
    canvas.height = Math.round(plan.h * scale);

    return {
      canvas: canvas, plan: plan, pal: pal, scale: scale, model: model,
      images: collectImages(model), needsQr: !!qr, code: code, url: url
    };
  }

  function sameTeam(a, b) {
    if (!a || !b) return false;
    var n = Math.max(a.size || 0, b.size || 0);
    for (var i = 0; i < n; i++) {
      var x = (a.slots || [])[i] || null;
      var y = (b.slots || [])[i] || null;
      if (!x !== !y) return false;
      if (!x) continue;
      if (x.k !== y.k || x.p !== y.p || !!x.e !== !!y.e || x.m !== y.m) return false;
      var xi = x.it || [];
      var yi = y.it || [];
      if (xi.length !== yi.length) return false;
      for (var j = 0; j < xi.length; j++) {
        var xk = xi[j] && xi[j].k;
        var yk = yi[j] && yi[j].k;
        if (xk !== yk || !!(xi[j] && xi[j].e) !== !!(yi[j] && yi[j].e)) return false;
      }
    }
    var la = a.layers || {};
    var lb = b.layers || {};
    var keys = {};
    var k;
    for (k in la) if (la.hasOwnProperty(k)) keys[k] = 1;
    for (k in lb) if (lb.hasOwnProperty(k)) keys[k] = 1;
    for (k in keys) {
      if (!keys.hasOwnProperty(k)) continue;
      if ((la[k] || 0) !== (lb[k] || 0)) return false;
    }
    return true;
  }

  /** 导出 PNG；画布被本地图片污染（file://）时回调 null，由调用方降级 */
  function makeBlobUrl(canvas, cb) {
    var done = false;
    function once(url) {
      if (done) return;
      done = true;
      cb(url);
    }
    try {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (!blob) { once(null); return; }
          try { once(URL.createObjectURL(blob)); } catch (e) { once(null); }
        }, 'image/png');
      } else {
        once(canvas.toDataURL('image/png'));
      }
    } catch (e) {
      once(null);
    }
  }

  function showNote(kind) {
    var el = document.getElementById('poster-note');
    if (!el) return;
    var msg = '';
    if (kind === 'file') {
      msg = '这张图不含头像与图标：用 file:// 直接打开时，浏览器禁止把本地图片导出到画布。' +
        '用本地 http 预览（例如在 web/ 下执行 python -m http.server）或线上地址打开，就能带图。';
    } else if (kind === 'standalone') {
      msg = '这张图不含头像与图标：单文件版为了体积没有内嵌这两类素材，用在线版或目录版打开即可带图。';
    } else if (kind === 'toggle') {
      msg = '这张图不含头像与图标：顶栏的图片开关当前是关闭状态。';
    }
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.textContent = msg;
    el.hidden = false;
  }

  /* ---------------- 出图面板 ---------------- */
  function sheetHtml() {
    return '<div class="sheet-in poster-sheet">' +
      '<div class="sheet-head">' +
      '<div class="sheet-title"><b>配队一图流</b><small>手机竖版 · 长按可保存</small></div>' +
      '<button type="button" class="d-close" data-sheet-close aria-label="关闭">' +
      '<svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>' +
      '</div>' +
      '<div class="poster-preview" id="poster-preview"><p class="poster-loading">正在生成…</p></div>' +
      '<p class="poster-note" id="poster-note" hidden></p>' +
      '<div class="poster-bar">' +
      '<button type="button" class="btn btn-primary" data-poster-download>下载 PNG</button>' +
      '<button type="button" class="btn" data-poster-copy-code>复制配队码</button>' +
      '<button type="button" class="btn" data-poster-copy-text>复制分享文本</button>' +
      '</div>' +
      '<p class="poster-tip">手机上长按图片保存；二维码扫开直达这套配队。</p>' +
      '</div>';
  }

  function mount() {
    var box = document.getElementById('poster-preview');
    if (!box) return;
    showNote('');
    var token = ++state.token;
    var parts;
    try {
      parts = build();
    } catch (e) {
      box.innerHTML = '<p class="poster-fail">生成失败：' + esc(e && e.message ? e.message : e) + '</p>';
      return;
    }

    // 单文件版 / 用户关图：一进来就说清楚，不必等出图
    var known = imagesDisabled();
    if (known) showNote(known);

    function finish(url) {
      if (token !== state.token) return;
      if (state.blob && state.blob.indexOf('blob:') === 0) {
        try { URL.revokeObjectURL(state.blob); } catch (e) { /* 忽略 */ }
      }
      state.blob = url;
      state.canvas = parts.canvas;
      box.innerHTML = '<img class="poster-img" alt="配队一图流" src="' + esc(url) + '">';
      var tip = document.querySelector('.poster-tip');
      if (tip) {
        tip.innerHTML = '手机上长按图片保存（' + parts.canvas.width + '×' + parts.canvas.height + '）';
      }
    }

    loadImages(parts.images, function (images) {
      if (token !== state.token) return;
      paint(parts.canvas, parts.plan, parts.pal, images, parts.scale);
      makeBlobUrl(parts.canvas, function (url) {
        if (token !== state.token) return;
        if (url) { finish(url); return; }

        // 画布被本地图片污染（file://）：换一张干净画布重画「无图版」再导出
        var clean = document.createElement('canvas');
        clean.width = parts.canvas.width;
        clean.height = parts.canvas.height;
        paint(clean, parts.plan, parts.pal, {}, parts.scale);
        makeBlobUrl(clean, function (url2) {
          if (token !== state.token) return;
          if (!url2) {
            box.innerHTML = '<p class="poster-fail">当前环境不允许导出图片，请换用线上版或本地 http 预览。</p>';
            return;
          }
          finish(url2);
          showNote('file');
        });
      });
    });
  }

  function open() {
    if (!global.Team || !Team.openSheet) return;
    Team.openSheet(-1, 'poster', -1);
  }

  function download() {
    if (!state.blob) return;
    var a = document.createElement('a');
    a.href = state.blob;
    a.download = state.filename || 'GSPA-配队.png';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function copyText(text, okMsg) {
    var done = function () { toast(okMsg); };
    if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, okMsg); });
    } else {
      legacyCopy(text, okMsg);
    }
  }

  function legacyCopy(text, okMsg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    toast(ok ? okMsg : '复制失败，请手动选中复制');
  }

  function toast(msg) {
    if (global.App && global.App.toast) global.App.toast(msg);
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-poster-download]')) {
        e.preventDefault();
        if (state.blob) download();
        else toast('图片还没生成好');
        return;
      }
      if (t.closest('[data-poster-copy-code]')) {
        e.preventDefault();
        var data = Store.getData();
        copyText(global.Code.encode(Store.getTeam(), data), '配队码已复制');
        return;
      }
      if (t.closest('[data-poster-copy-text]')) {
        e.preventDefault();
        copyText(Team.shareText(), '分享文本已复制');
      }
    }, false);
  }

  if (document && document.addEventListener) bind();

  global.Poster = {
    open: open,
    mount: mount,
    sheetHtml: sheetHtml,
    // 供测试 / 调试
    _build: build,
    _layout: layout,
    _collectImages: collectImages,
    _shareUrl: shareUrl,
    _linkBase: linkBase
  };
})(window);
