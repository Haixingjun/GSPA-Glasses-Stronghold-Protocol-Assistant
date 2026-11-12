(function () {
  'use strict';

  var DATA = window.GSPA_MAPS;
  if (!DATA || !Array.isArray(DATA.maps)) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function find(id) {
    for (var i = 0; i < DATA.maps.length; i++) if (DATA.maps[i].id === id) return DATA.maps[i];
    return null;
  }

  function byMap() {
    var groups = [], index = {};
    DATA.maps.forEach(function (m) {
      if (m.hidden) return; // 场地 2 只保留 ?map= 隐藏入口
      if (!index[m.map]) { index[m.map] = { map: m.map, label: m.label, items: [] }; groups.push(index[m.map]); }
      index[m.map].items.push(m);
    });
    return groups;
  }

  function visibleCount() {
    return DATA.maps.filter(function (m) { return !m.hidden; }).length;
  }

  // 原图 + 战场机制（地形 / 装置）：给沙盘和地图编辑共用
  function metaHtml(p) {
    var out = '';
    (p.terrain || []).forEach(function (t) {
      out += '<div class="mp-line"><b>' + esc(t.name) + '</b><span>' + esc(t.desc || '') + '</span></div>';
    });
    if ((p.terrain || []).length) out = '<h4>特殊地形</h4>' + out;
    var dev = (p.devices || []).map(function (d) {
      return '<div class="mp-line"><b>' + esc(d.name) + '</b><span>' + esc(d.desc || '') + '</span></div>';
    }).join('');
    if (dev) out += '<h4>地图装置</h4>' + dev;
    if (!out) out = '<p class="mp-empty">该战场没有额外的特殊地形 / 地图装置。</p>';
    if (p.note) out += '<p class="mp-note">' + esc(p.note) + '</p>';
    return out;
  }

  function showDetail(preset) {
    if (!preset) return;
    var old = document.getElementById('gspaMapDetail');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var wrap = document.createElement('div');
    wrap.id = 'gspaMapDetail';
    wrap.className = 'mp-detail';
    wrap.innerHTML =
      '<div class="mp-detail-card" role="dialog" aria-label="' + esc(preset.title) + '">' +
        '<header class="mp-detail-head"><div>' +
          '<b>' + esc(preset.title) + '</b>' +
          '<span class="mp-detail-sub">' + preset.w + '×' + preset.h + ' · ' +
            ((preset.spawns || []).length ? '侵入点 ' + preset.spawns.length : '侵入点 —') +
            ' · 终点 ' + (preset.goals || []).length +
            ((preset.boxes || []).length ? ' · 箱子 ' + preset.boxes.length : '') + '</span>' +
        '</div><button type="button" class="mini" data-detail-close>关闭</button></header>' +
        '<div class="mp-detail-body">' +
          '<figure><img src="' + esc(preset.image) + '" alt="' + esc(preset.title) + ' 官方地图"></figure>' +
          '<aside>' + metaHtml(preset) +
            '<p class="mp-note">地块由官方热更包 act3autochess 解包生成；原图为 PRTS 战场一览。</p>' +
          '</aside>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap || e.target.closest('[data-detail-close]')) close();
    });
    var onKey = function (e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  }

  function cardHtml(m, current) {
    var active = current === m.id ? ' active' : '';
    return '<button type="button" class="mp-card' + active + '" data-map="' + esc(m.id) + '" title="' + esc(m.title) + ' · ' + m.w + '×' + m.h + '">' +
      '<img src="' + esc(m.image) + '" alt="' + esc(m.title) + '" loading="lazy" draggable="false">' +
      '<span class="mp-tag">#' + esc(m.id) + '</span>' +
      '<span class="mp-meta"><b>场地 ' + m.field + '</b><i>' + m.w + '×' + m.h + '</i></span>' +
      '</button>';
  }

  function galleryHtml(current) {
    return byMap().map(function (g) {
      return '<section class="mp-group">' +
        '<div class="mp-group-head"><span class="mp-no">' + esc(g.label) + '</span>' +
        '<span class="mp-sub">' + g.items.length + ' 个场地</span></div>' +
        '<div class="mp-row">' + g.items.map(function (m) { return cardHtml(m, current); }).join('') + '</div>' +
        '</section>';
    }).join('');
  }

  function mount(container, opts) {
    if (!container) return;
    opts = opts || {};
    var shell = document.createElement('div');
    shell.className = 'map-picker';
    shell.innerHTML =
      '<div class="mp-top"><div class="mp-title">选择战场<span class="mp-note">' +
      esc(String(visibleCount())) + ' 张场地 · 解包数据 · ' + esc(DATA.version) +
      '</span></div>' +
      '<div class="mp-actions"><button type="button" class="mini" data-mp-close>关闭</button></div></div>' +
      '<div class="mp-scroll">' + galleryHtml(opts.current || '') + '</div>' +
      '<div class="mp-foot"><span class="muted">已裁掉装备区 / 待部署区 / 敌人展示区；#07 / #08 未开放。</span>' +
      '<span class="mp-selected" data-mp-selected></span></div>';
    container.innerHTML = '';
    container.appendChild(shell);

    var selected = container.querySelector('[data-mp-selected]');
    var cur = opts.current ? find(opts.current) : null;
    if (selected && cur) selected.textContent = '当前：' + cur.title;

    container.onclick = function (e) {
      var close = e.target.closest('[data-mp-close]');
      if (close) { if (opts.onClose) opts.onClose(); return; }
      var card = e.target.closest('.mp-card');
      if (!card) return;
      var preset = find(card.getAttribute('data-map'));
      if (!preset) return;
      var all = container.querySelectorAll('.mp-card');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i] === card);
      if (selected) selected.textContent = '当前：' + preset.title;
      if (opts.onPick) opts.onPick(preset);
    };
  }

  window.GSPA_MAP_PICKER = {
    data: DATA,
    find: find,
    byMap: byMap,
    mount: mount,
    showDetail: showDetail
  };
})();
