(function () {
  'use strict';

  var KEY = 'gspa_sandbox_map';
  var MIN_W = 3, MAX_W = 21, MIN_H = 3, MAX_H = 13;

  // 与沙盘一致的地形口径
  var TERRAIN = {
    ground:      { label: '地面', key: 'tile_road', deploy: 'all', walk: true, note: '地面部署位；远程单位也可部署于近战位。' },
    high:        { label: '高台·仅远程', key: 'tile_wall', deploy: 'ranged', walk: false, note: '高台部署位，仅远程单位可部署。' },
    highAny:     { label: '高台', key: 'tile_acplatform', deploy: 'all', walk: false, note: '高台部署位，任意单位可部署。' },
    highSpecial: { label: '特殊高台', key: 'tile_fence_bound', deploy: 'all', walk: false, note: '边界特殊高台，任意单位可部署。' },
    box:         { label: '箱子', key: 'trap_1105_accrate', deploy: 'none', walk: false, note: '场地上的箱子，占据该格，不可部署、不可通行。' },
    floor:       { label: '不可部署', key: 'tile_floor', deploy: 'none', walk: true, note: '可通行，但不能部署干员。' },
    fence:       { label: '围墙', key: 'tile_fence_bound(旧)', deploy: 'none', walk: false, note: '旧版地形键，仅用于兼容旧存档。' },
    void:        { label: '不可通行', key: 'tile_forbidden / tile_acempty', deploy: 'none', walk: false, note: '场外或障碍区域，不可通行、不可部署。' },
    spawn:       { label: '侵入点', key: 'tile_start', deploy: 'none', walk: true, note: '敌方侵入点。' },
    goal:        { label: '终点', key: 'tile_end', deploy: 'none', walk: true, note: '我方终点。' },
    telin:       { label: '传送入口', key: 'tile_telin', deploy: 'none', walk: true, note: '传送入口。' },
    telout:      { label: '传送出口', key: 'tile_telout', deploy: 'none', walk: true, note: '传送出口。' },
    mire:        { label: '沼泽', key: 'tile_mire', deploy: 'all', walk: true, note: '旧数据地形，保留兼容。' },
    infection:   { label: '活性源石', key: 'tile_infection', deploy: 'all', walk: true, note: '旧数据地形，保留兼容。' },
    speedup:     { label: '加速地面', key: 'tile_speedup', deploy: 'all', walk: true, note: '旧数据地形，保留兼容。' },
    duel:        { label: '决斗草地', key: 'tile_duel_grassland', deploy: 'all', walk: true, note: '旧数据地形，保留兼容。' }
  };

  var W = 9, H = 5, TILES = null, BOX = null, brush = 'ground', PRESET = '';
  var painting = false, lastR = -1, lastC = -1;

  var grid = document.getElementById('editorGrid');
  var status = document.getElementById('editorStatus');
  var wInput = document.getElementById('mapWInput');
  var hInput = document.getElementById('mapHInput');
  var thumb = document.getElementById('edThumb');
  var nameEl = document.getElementById('edMapName');
  var modal = document.getElementById('presetModal');
  var modalCard = document.getElementById('presetModalCard');

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function presetById(id) {
    var P = window.GSPA_MAPS;
    if (!P || !Array.isArray(P.maps) || !id) return null;
    for (var i = 0; i < P.maps.length; i++) if (P.maps[i].id === id) return P.maps[i];
    return null;
  }

  function blank(w, h) {
    return Array.from({ length: h }, function () { return Array(w).fill('ground'); });
  }

  function blankBox(w, h) {
    return Array.from({ length: h }, function () { return Array(w).fill(false); });
  }

  function boxGrid(list, w, h) {
    var grid = blankBox(w, h);
    (list || []).forEach(function (p) {
      if (!Array.isArray(p) || p.length < 2) return;
      var r = Number(p[0]), c = Number(p[1]);
      if (r >= 0 && r < h && c >= 0 && c < w) grid[r][c] = true;
    });
    return grid;
  }

  function boxList() {
    var out = [];
    for (var r = 0; r < H; r++) for (var c = 0; c < W; c++) if (BOX[r][c]) out.push([r, c]);
    return out;
  }

  function load() {
    TILES = blank(W, H);
    BOX = blankBox(W, H);
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var obj = JSON.parse(raw);
      var w = Number(obj && obj.w), h = Number(obj && obj.h);
      if (!(w >= MIN_W && w <= MAX_W && h >= MIN_H && h <= MAX_H) || !Array.isArray(obj.tiles)) return;
      if (obj.tiles.length !== h || obj.tiles.some(function (row) { return !Array.isArray(row) || row.length !== w; })) return;
      for (var r = 0; r < h; r++) for (var c = 0; c < w; c++) if (!TERRAIN[obj.tiles[r][c]]) return;
      W = w; H = h;
      TILES = obj.tiles.map(function (row) { return row.slice(); });
      BOX = boxGrid(obj.boxes, w, h);
      PRESET = presetById(obj.preset) ? obj.preset : '';
    } catch (e) { /* 默认空白 */ }
  }

  function store() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ w: W, h: H, preset: PRESET || '', tiles: TILES, boxes: boxList() }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function updateHead() {
    var p = presetById(PRESET);
    if (nameEl) nameEl.textContent = p ? p.title : '空白训练场';
    if (status) status.textContent = W + ' × ' + H + (p ? ' · ' + p.label + ' 场地 ' + p.field : ' · 自绘');
    if (thumb) {
      if (p) { thumb.src = p.image; thumb.alt = p.title; thumb.style.display = ''; }
      else { thumb.style.display = 'none'; }
    }
    if (wInput) wInput.value = W;
    if (hInput) hInput.value = H;
  }

  function cellHtml(r, c) {
    var t = TILES[r][c] || 'ground';
    var info = TERRAIN[t] || TERRAIN.ground;
    var cls = 'cell ' + t + (BOX[r][c] ? ' has-box' : '');
    var mark = BOX[r][c] ? '<i class="box-mark" aria-hidden="true"></i>' : '';
    return '<div class="' + cls + '" data-r="' + r + '" data-c="' + c + '" title="r' + (r + 1) + 'c' + (c + 1) + ' · ' + info.label + (BOX[r][c] ? ' · 箱子' : '') + '">' + mark + '</div>';
  }

  function render() {
    if (!grid) return;
    if (grid.style && typeof grid.style.setProperty === 'function') {
      grid.style.setProperty('--ed-w', W);
      var canvas = document.querySelector('.ed-canvas');
      var avail = canvas && canvas.clientWidth ? canvas.clientWidth - 40 : 900;
      var cell = clamp(Math.floor((avail - (W - 1) * 3) / W), 26, 72);
      grid.style.setProperty('--cell', cell + 'px');
    }
    var html = '';
    for (var r = 0; r < H; r++) for (var c = 0; c < W; c++) html += cellHtml(r, c);
    grid.innerHTML = html;
    updateHead();
  }

  function paintCell(r, c) {
    if (r < 0 || c < 0 || r >= H || c >= W) return;
    if (brush === 'box') {
      BOX[r][c] = !BOX[r][c];
      PRESET = '';
      var boxEl = grid.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
      if (boxEl) {
        boxEl.classList.toggle('has-box', BOX[r][c]);
        var oldMark = boxEl.querySelector('.box-mark');
        if (BOX[r][c] && !oldMark) boxEl.insertAdjacentHTML('afterbegin', '<i class="box-mark" aria-hidden="true"></i>');
        if (!BOX[r][c] && oldMark) oldMark.remove();
      }
      updateHead();
      return;
    }
    if (TILES[r][c] === brush) return;
    TILES[r][c] = brush;
    PRESET = '';
    var cell = grid.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
    if (!cell) return;
    cell.className = 'cell ' + brush + (BOX[r][c] ? ' has-box' : '');
    cell.title = 'r' + (r + 1) + 'c' + (c + 1) + ' · ' + TERRAIN[brush].label + (BOX[r][c] ? ' · 箱子' : '');
    updateHead();
  }

  function paintLine(r0, c0, r1, c1) {
    var steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0));
    for (var i = 0; i <= steps; i++) {
      var t = steps ? i / steps : 0;
      paintCell(Math.round(r0 + (r1 - r0) * t), Math.round(c0 + (c1 - c0) * t));
    }
  }

  function applySize() {
    var w = clamp(Number(wInput.value) || W, MIN_W, MAX_W);
    var h = clamp(Number(hInput.value) || H, MIN_H, MAX_H);
    var next = Array.from({ length: h }, function (_, r) {
      return Array.from({ length: w }, function (_, c) {
        return TILES[r] && TILES[r][c] ? TILES[r][c] : 'ground';
      });
    });
    var nextBox = Array.from({ length: h }, function (_, r) {
      return Array.from({ length: w }, function (_, c) { return !!(BOX[r] && BOX[r][c]); });
    });
    W = w; H = h; TILES = next; BOX = nextBox; PRESET = '';
    render();
  }

  function loadPreset(preset) {
    if (!preset || !Array.isArray(preset.tiles)) return;
    W = preset.w; H = preset.h;
    TILES = preset.tiles.map(function (row) { return row.slice(); });
    BOX = boxGrid(preset.boxes, W, H);
    PRESET = preset.id;
    render();
  }

  function mapJson() {
    return JSON.stringify({ w: W, h: H, tiles: TILES, boxes: boxList() });
  }

  function importMap(text) {
    var obj = JSON.parse(text);
    var w = Number(obj && obj.w), h = Number(obj && obj.h);
    if (!(w >= MIN_W && w <= MAX_W && h >= MIN_H && h <= MAX_H)) throw new Error('尺寸需在 ' + MIN_W + '–' + MAX_W + ' × ' + MIN_H + '–' + MAX_H + ' 之间');
    if (!Array.isArray(obj.tiles) || obj.tiles.length !== h || obj.tiles.some(function (row) { return !Array.isArray(row) || row.length !== w; })) throw new Error('行尺寸不符');
    for (var r = 0; r < h; r++) for (var c = 0; c < w; c++) if (!TERRAIN[obj.tiles[r][c]]) throw new Error('地形值不合法：' + obj.tiles[r][c]);
    W = w; H = h; TILES = obj.tiles.map(function (row) { return row.slice(); });
    BOX = boxGrid(obj.boxes, w, h);
    PRESET = '';
    render();
  }

  function openPicker() {
    if (!modal || !modalCard || !window.GSPA_MAP_PICKER) { alert('地图数据未加载'); return; }
    window.GSPA_MAP_PICKER.mount(modalCard, {
      current: PRESET,
      onClose: closePicker,
      onPick: function (p) { loadPreset(p); closePicker(); }
    });
    modal.hidden = false;
  }

  function closePicker() { if (modal) modal.hidden = true; }

  function saveMap() {
    if (!store()) {
      alert('保存失败：浏览器不允许写入本地存储');
      return;
    }
    window.location.href = 'sandbox.html';
  }

  // ---- 事件绑定 ----
  var brushBar = document.getElementById('brushBar');
  if (brushBar) {
    brushBar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-brush]');
      if (!btn) return;
      brush = btn.getAttribute('data-brush');
      var all = brushBar.querySelectorAll('[data-brush]');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i] === btn);
    });
  }

  if (grid) {
    grid.addEventListener('pointerdown', function (e) {
      var cell = e.target.closest('.cell');
      if (!cell) return;
      e.preventDefault();
      painting = true;
      lastR = Number(cell.getAttribute('data-r'));
      lastC = Number(cell.getAttribute('data-c'));
      if (grid.setPointerCapture) grid.setPointerCapture(e.pointerId);
      paintCell(lastR, lastC);
    });
    grid.addEventListener('pointermove', function (e) {
      if (!painting) return;
      e.preventDefault();
      var el = document.elementFromPoint ? document.elementFromPoint(e.clientX, e.clientY) : null;
      var cell = el && el.closest ? el.closest('.cell') : null;
      if (!cell) return;
      var r = Number(cell.getAttribute('data-r')), c = Number(cell.getAttribute('data-c'));
      if (lastR >= 0) paintLine(lastR, lastC, r, c); else paintCell(r, c);
      lastR = r; lastC = c;
    });
    function endPaint() { painting = false; lastR = -1; lastC = -1; }
    grid.addEventListener('pointerup', endPaint);
    grid.addEventListener('pointercancel', endPaint);
    grid.addEventListener('pointerleave', endPaint);

    var edTip = document.getElementById('edTip');
    function showTip(cell, x, y) {
      var t = TERRAIN[cell.classList[1]] || TERRAIN.ground;
      if (!edTip) return;
      edTip.innerHTML = '<h4>' + t.label + '</h4>' +
        '<div class="rule"><b>部署</b>：' + (t.deploy === 'none' ? '不可部署' : t.deploy === 'ranged' ? '仅远程可部署' : '可部署') + '</div>' +
        '<div class="rule"><b>通行</b>：' + (t.walk ? '可通行' : '不可通行') + '</div>' +
        '<div class="rule">' + t.note + '</div>';
      edTip.hidden = false;
      var w = edTip.offsetWidth || 260, h = edTip.offsetHeight || 90;
      edTip.style.left = Math.max(8, Math.min(x + 14, innerWidth - w - 8)) + 'px';
      edTip.style.top = Math.max(8, Math.min(y + 14, innerHeight - h - 8)) + 'px';
    }
    grid.addEventListener('mouseover', function (e) {
      var cell = e.target.closest('.cell');
      if (cell) showTip(cell, e.clientX, e.clientY);
    });
    grid.addEventListener('mousemove', function (e) {
      var cell = e.target.closest('.cell');
      if (cell) showTip(cell, e.clientX, e.clientY);
    });
    grid.addEventListener('mouseout', function (e) {
      if (edTip && (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.cell'))) edTip.hidden = true;
    });
  }

  var openBtn = document.getElementById('openPicker');
  if (openBtn) openBtn.addEventListener('click', openPicker);
  function showDetail() {
    var p = presetById(PRESET);
    if (p && window.GSPA_MAP_PICKER) window.GSPA_MAP_PICKER.showDetail(p);
  }
  if (thumb) { thumb.style.cursor = 'zoom-in'; thumb.addEventListener('click', showDetail); }
  if (nameEl) { nameEl.style.cursor = 'pointer'; nameEl.addEventListener('click', showDetail); }
  if (modal) {
    modal.addEventListener('click', function (e) { if (e.target === modal) closePicker(); });
  }
  document.addEventListener('keydown', function (e) {
    if (e && e.key === 'Escape' && modal && !modal.hidden) closePicker();
  });

  var applySizeBtn = document.getElementById('applySize');
  if (applySizeBtn) applySizeBtn.addEventListener('click', applySize);
  var clearBtn = document.getElementById('clearMap');
  if (clearBtn) clearBtn.addEventListener('click', function () {
    TILES = blank(W, H); BOX = blankBox(W, H); PRESET = ''; render();
  });
  var exportBtn = document.getElementById('exportMap');
  if (exportBtn) exportBtn.addEventListener('click', function () {
    var text = mapJson();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { alert('地图 JSON 已复制'); }, function () { prompt('复制地图 JSON', text); });
    } else prompt('复制地图 JSON', text);
  });
  var importBtn = document.getElementById('importMap');
  if (importBtn) importBtn.addEventListener('click', function () {
    var text = prompt('粘贴地图 JSON');
    if (!text) return;
    try { importMap(text); } catch (e) { alert('导入失败：' + e.message); }
  });
  var saveBtn = document.getElementById('saveMap');
  if (saveBtn) saveBtn.addEventListener('click', saveMap);

  window.addEventListener('resize', function () { render(); });

  load();
  // ?map=01-2 直接载入某张规程场地
  (function () {
    try {
      if (typeof URLSearchParams === 'undefined' || typeof location === 'undefined' || !location.search) return;
      var p = presetById(new URLSearchParams(location.search).get('map'));
      if (p) loadPreset(p);
    } catch (e) { /* 忽略非法参数 */ }
  })();
  render();
})();
