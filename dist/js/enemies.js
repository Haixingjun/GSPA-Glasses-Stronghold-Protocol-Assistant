/* ==========================================================================
   enemies.js — 敌人图鉴 / 地图页
   数据：window.GSPA_ENEMIES（tools/build_enemy_data.py 生成）
   无框架、无网络请求；179 个敌人全量线性过滤。
   ========================================================================== */
(function (global) {
  'use strict';

  var DATA = global.GSPA_ENEMIES;
  if (!DATA) {
    document.getElementById('cards').innerHTML = '<div class="empty"><b>数据未加载</b><p>请先运行 python tools/build_enemy_data.py 生成 web/data/enemies.js。</p></div>';
    return;
  }

  var ENEMIES = DATA.enemies;
  var CONFIGS = DATA.configs;
  var TAGS = DATA.tags;
  var MAPS = DATA.maps.maps;
  var TYPE_NAMES = DATA.typeNames;
  var ROLE_LABEL = { special: '特殊敌人', normal: '普通随从', elite: '精英随从' };
  var ROLE_ORDER = ['special', 'normal', 'elite'];
  var THEME_KEY = 'gs-theme';
  var MAP_MODES = ['入门协议', '极速模拟', '标准模拟', '险境模拟', '绝境模拟', '终极模拟'];
  var MAP_LEVELS = [
    { key: '1-4', label: '规程等级 1–4', from: 1, to: 4 },
    { key: '5-8', label: '规程等级 5–8', from: 5, to: 8 },
    { key: '5-20', label: '规程等级 5–20', from: 5, to: 20 }
  ];

  var byId = {};
  var tagByKey = {};
  var mapById = {};
  ENEMIES.forEach(function (e) {
    e._refs = [];
    e._hay = [e.name, e.id, e.desc, e.prtsName, e.tags.map(function (t) { return TYPE_NAMES[t] || t; }).join(' '), e.roles.map(function (r) { return ROLE_LABEL[r]; }).join(' ')].join(' ').toLowerCase();
    byId[e.id] = e;
  });
  TAGS.forEach(function (t) { tagByKey[t.key] = t; });
  MAPS.forEach(function (m) {
    mapById[m.id] = m;
    m._modes = [];
    m._ranges = [];
    m.difficulties.forEach(function (d) {
      var range = String(d).match(/^规程等级\s*(\d+)\s*[–—-]\s*(\d+)$/);
      if (range) m._ranges.push([Number(range[1]), Number(range[2])]);
      else m._modes.push(d);
    });
  });
  CONFIGS.forEach(function (c) {
    addRef(c.special, c, 'special');
    c.normal.forEach(function (id) { addRef(id, c, 'normal'); });
    c.elite.forEach(function (id) { addRef(id, c, 'elite'); });
  });
  function addRef(id, config, role) {
    var e = byId[id];
    if (e) e._refs.push({ c: config, role: role });
  }

  var state = { view: 'enemy', q: '', tags: [], mode: 'or', roles: [], dual: false, cross: false, sort: 'index', mapDiffs: [] };
  var els = {};
  var currentEnemy = null;
  var currentMap = null;
  var currentField = 0;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(v) {
    if (v === null || v === undefined || v === '') return '—';
    var n = Number(v);
    return isNaN(n) ? esc(v) : n.toLocaleString('zh-CN');
  }
  function tagName(key) { return TYPE_NAMES[key] || key; }
  function roleName(key) { return ROLE_LABEL[key] || key; }
  function baseLevel(e) { return e.levels[0] || { level: 0, hp: null, atk: null, def: null, res: null }; }
  function tagHtml(key, clickable) {
    var tag = clickable ? 'button type="button"' : 'span';
    var attr = clickable ? ' data-tag="' + esc(key) + '"' : '';
    return '<' + tag + ' class="tag tag-' + esc(key) + '"' + attr + '>' + esc(tagName(key)) + '</' + tag.split(' ')[0] + '>';
  }
  function roleHtml(key) {
    return '<span class="role role-' + esc(key) + '">' + esc(roleName(key)) + '</span>';
  }
  function statHtml(label, value) {
    return '<div class="card-stat"><span>' + label + '</span><b>' + fmt(value) + '</b></div>';
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    els = {
      q: $('q'), qclear: $('qclear'), tagChips: $('tagChips'), roleChips: $('roleChips'),
      tagMode: $('tagMode'), dualOnly: $('dualOnly'), crossOnly: $('crossOnly'), reset: $('resetFilters'),
      count: $('count'), activeFilters: $('activeFilters'), sort: $('sort'), cards: $('cards'),
      empty: $('empty'), emptyText: $('emptyText'), emptyReset: $('emptyReset'),
      viewEnemy: $('viewEnemy'), viewMap: $('viewMap'), tabEnemy: $('tabEnemy'), tabMap: $('tabMap'),
      mapCount: $('mapCount'), mapCards: $('mapCards'), mapEmpty: $('mapEmpty'), mapClear: $('mapClear'),
      mapModeChips: $('mapModeChips'), mapLevelChips: $('mapLevelChips'), mapDiffClear: $('mapDiffClear'),
      heroStats: $('heroStats'),
      enemyDialog: $('enemyDialog'), mapDialog: $('mapDialog')
    };

    initTheme();
    buildHero();
    buildTagChips();
    buildRoleChips();
    buildMapDiffChips();
    bindEvents();
    applyHash();
    render();
    renderMaps();
    document.body.setAttribute('data-ready', '1');
  }

  function initTheme() {
    var theme = 'dark';
    try {
      var saved = global.localStorage && global.localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') theme = saved;
    } catch (e) { /* 隐私模式 */ }
    applyTheme(theme);
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#eef3f8' : '#0b0f14');
  }
  function toggleTheme() {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { if (global.localStorage) global.localStorage.setItem(THEME_KEY, next); } catch (e) { /* 忽略 */ }
  }

  function buildHero() {
    var counts = DATA.meta.counts;
    var items = [
      [counts.enemies, '个敌人'],
      [counts.tags, '类词条'],
      [counts.configs, '条特殊敌人配置'],
      [counts.maps, '张战场地图']
    ];
    els.heroStats.innerHTML = items.map(function (it) {
      return '<div class="hero-stat"><b>' + it[0] + '</b><span>' + it[1] + '</span></div>';
    }).join('');
  }

  function buildTagChips() {
    els.tagChips.innerHTML = TAGS.map(function (t) {
      return '<button type="button" class="chip" data-tag="' + esc(t.key) + '" aria-pressed="false">' +
        '<span class="tag-dot tag-' + esc(t.key) + '" style="width:7px;height:7px;border-radius:50%;background:currentColor"></span>' +
        esc(t.name) + '<span class="n">' + t.count + '</span></button>';
    }).join('');
    els.tagChips.querySelectorAll('[data-tag]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-tag');
        state.tags = toggleIn(state.tags, key);
        syncFilterButtons();
        render();
      });
    });
  }

  function buildRoleChips() {
    var counts = { special: 0, normal: 0, elite: 0 };
    ENEMIES.forEach(function (e) { e.roles.forEach(function (r) { if (counts[r] != null) counts[r] += 1; }); });
    els.roleChips.innerHTML = ROLE_ORDER.map(function (key) {
      return '<button type="button" class="chip" data-role="' + key + '" aria-pressed="false">' +
        roleName(key) + '<span class="n">' + counts[key] + '</span></button>';
    }).join('');
    els.roleChips.querySelectorAll('[data-role]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.roles = toggleIn(state.roles, btn.getAttribute('data-role'));
        syncFilterButtons();
        render();
      });
    });
  }

  function toggleIn(arr, value) {
    var out = arr.filter(function (v) { return v !== value; });
    if (out.length === arr.length) out.push(value);
    return out;
  }

  function syncFilterButtons() {
    els.tagChips.querySelectorAll('[data-tag]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', state.tags.indexOf(btn.getAttribute('data-tag')) >= 0 ? 'true' : 'false');
    });
    els.roleChips.querySelectorAll('[data-role]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', state.roles.indexOf(btn.getAttribute('data-role')) >= 0 ? 'true' : 'false');
    });
    els.tagMode.textContent = state.mode === 'and' ? 'AND' : 'OR';
    els.tagMode.setAttribute('data-mode', state.mode);
    els.tagMode.title = state.mode === 'and' ? '当前：同时满足所有词条（点击切换为 OR）' : '当前：满足任一条件（点击切换为 AND）';
    els.dualOnly.checked = state.dual;
    els.crossOnly.checked = state.cross;
  }

  /* ---------------- 筛选 / 排序 ---------------- */
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = ENEMIES.filter(function (e) {
      if (q && e._hay.indexOf(q) < 0) return false;
      if (state.tags.length) {
        var hits = state.tags.filter(function (t) { return e.tags.indexOf(t) >= 0; });
        if (state.mode === 'and' ? hits.length !== state.tags.length : hits.length === 0) return false;
      }
      if (state.roles.length && !state.roles.some(function (r) { return e.roles.indexOf(r) >= 0; })) return false;
      if (state.dual && e.levels.length < 2) return false;
      if (state.cross && e.tags.length < 2) return false;
      return true;
    });
    return sortList(out);
  }

  function sortList(list) {
    var out = list.slice();
    var key = state.sort;
    if (key === 'name') {
      out.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh-Hans-CN'); });
    } else if (key === 'hp' || key === 'atk' || key === 'def' || key === 'res') {
      out.sort(function (a, b) {
        var av = baseLevel(a)[key], bv = baseLevel(b)[key];
        return (bv == null ? -1 : bv) - (av == null ? -1 : av);
      });
    } else if (key === 'related') {
      out.sort(function (a, b) { return b._refs.length - a._refs.length; });
    }
    return out;
  }

  function render() {
    var list = filtered();
    els.count.innerHTML = '显示 <b>' + list.length + '</b> / ' + ENEMIES.length + ' 个敌人';
    renderActiveFilters();
    if (!list.length) {
      els.cards.innerHTML = '';
      els.empty.hidden = false;
      els.emptyText.textContent = emptyMessage();
      return;
    }
    els.empty.hidden = true;
    var html = list.map(cardHtml).join('');
    els.cards.innerHTML = html;
  }

  function cardHtml(e) {
    var base = baseLevel(e);
    var dual = e.levels.length > 1 ? '<span class="lv">双等级</span>' : '';
    return '<button type="button" class="card" data-id="' + esc(e.id) + '" aria-label="查看 ' + esc(e.name) + ' 详情">' +
      '<span class="card-top">' +
        '<img class="card-avatar" src="' + esc(e.img) + '" alt="" loading="lazy" decoding="async">' +
        '<span class="card-main">' +
          '<span class="card-name">' + esc(e.name) + dual + '</span>' +
          '<code class="card-id">' + esc(e.id) + '</code>' +
          '<span class="badges">' + e.tags.map(function (t) { return tagHtml(t, false); }).join('') +
            e.roles.map(roleHtml).join('') + '</span>' +
        '</span>' +
      '</span>' +
      '<span class="card-desc">' + esc(e.desc) + '</span>' +
      '<span class="card-stats">' + statHtml('生命', base.hp) + statHtml('攻击', base.atk) + statHtml('防御', base.def) + statHtml('法抗', base.res) + '</span>' +
    '</button>';
  }

  function emptyMessage() {
    if (state.tags.length > 1 && state.mode === 'and') {
      return '当前为 AND：需要同时具备所选词条。跨词条的敌人只有 7 个，切成 OR 可看任一条件。';
    }
    if (state.q.trim()) return '没有找到「' + state.q.trim() + '」。试试更短的关键词，或清空词条。';
    return '试试减少筛选条件，或重置。';
  }

  function renderActiveFilters() {
    var html = '';
    state.tags.forEach(function (t) {
      html += '<span class="active-filter">词条·' + esc(tagName(t)) + '<button type="button" data-remove-tag="' + esc(t) + '" aria-label="移除词条">×</button></span>';
    });
    state.roles.forEach(function (r) {
      html += '<span class="active-filter">身份·' + esc(roleName(r)) + '<button type="button" data-remove-role="' + esc(r) + '" aria-label="移除身份">×</button></span>';
    });
    if (state.dual) html += '<span class="active-filter">双等级<button type="button" data-remove-dual aria-label="移除双等级">×</button></span>';
    if (state.cross) html += '<span class="active-filter">跨词条<button type="button" data-remove-cross aria-label="移除跨词条">×</button></span>';
    els.activeFilters.innerHTML = html;
  }

  /* ---------------- 详情 ---------------- */
  function openEnemy(id) {
    var e = byId[id];
    if (!e) return;
    currentEnemy = e;
    $('enemyImg').src = e.imgLarge;
    $('enemyImg').alt = e.name;
    $('enemyTitle').textContent = e.name;
    $('enemyId').textContent = e.id;
    $('enemyTags').innerHTML = e.tags.map(function (t) { return tagHtml(t, true); }).join('');
    $('enemyRoles').innerHTML = e.roles.map(roleHtml).join('');
    $('enemyDesc').textContent = e.desc || '（没有描述）';

    $('enemyLevels').innerHTML = e.levels.map(function (lv) {
      return '<tr><td>' + (lv.level === 0 ? '0（基础）' : esc(lv.level)) + '</td><td>' + fmt(lv.hp) + '</td><td>' + fmt(lv.atk) + '</td><td>' + fmt(lv.def) + '</td><td>' + fmt(lv.res) + '</td></tr>';
    }).join('');

    var counts = { special: 0, normal: 0, elite: 0 };
    e._refs.forEach(function (r) { counts[r.role] += 1; });
    $('enemyMeta').innerHTML =
      '<dt>等级条目</dt><dd>' + e.levels.length + ' 条' + (e.levels.length > 1 ? '（0 / 1）' : '（0）') + '</dd>' +
      '<dt>关联配置</dt><dd>' + e._refs.length + ' 条</dd>' +
      '<dt>词条</dt><dd>' + (e.tags.length ? e.tags.map(function (t) { return esc(tagName(t)); }).join('、') : '—') + '</dd>';

    $('enemyRoleText').innerHTML = ROLE_ORDER.filter(function (r) { return counts[r]; }).map(function (r) {
      return '<span style="margin-right:10px">' + esc(roleName(r)) + ' <b style="color:var(--text)">× ' + counts[r] + '</b></span>';
    }).join('') || '—';

    $('enemyConfigs').innerHTML = e._refs.slice().sort(function (a, b) { return a.c.i - b.c.i; }).map(function (ref) {
      var c = ref.c;
      var sp = byId[c.special];
      var spName = sp ? sp.name : c.special;
      var minions = '普通 ' + c.normal.map(minionName).join('、') + ' · 精英 ' + c.elite.map(minionName).join('、');
      var row2 = ref.role === 'special' ? ('随从：' + esc(minions)) : ('跟随：' + esc(spName));
      return '<li class="config-item">' +
        '<div class="row1">' + roleHtml(ref.role) +
          (ref.role === 'special' ? esc(spName) : '<button type="button" class="link" data-open="' + esc(c.special) + '">' + esc(spName) + '</button>') +
          '<span class="mini-tag">' + esc(c.tag) + '</span><span class="mini-tag">' + esc(c.half) + '</span><span class="mini-tag">权重 ' + c.weight + '</span>' +
          (c.training ? '<span class="mini-tag" style="color:var(--amber)">训练表</span>' : '') +
        '</div><div class="row2">' + row2 + '</div></li>';
    }).join('') || '<li class="config-item">没有关联的特殊敌人配置。</li>';

    var prts = 'https://prts.wiki/w/' + encodeURIComponent(e.prtsName || e.name);
    $('enemyPrts').href = prts;
    $('enemyPrts').textContent = '在 PRTS 查看「' + (e.prtsName || e.name) + '」完整页面 ↗';

    showDialog(els.enemyDialog);
    setHash('#/enemy/' + encodeURIComponent(e.id));
  }

  function minionName(id) {
    var e = byId[id];
    return e ? e.name : id;
  }

  function showDialog(dialog) {
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', 'open');
    }
    var scroll = dialog.querySelector('.modal-scroll');
    if (scroll) scroll.scrollTop = 0;
  }

  function closeDialogs() {
    [els.enemyDialog, els.mapDialog].forEach(function (dialog) {
      if (!dialog) return;
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      else dialog.removeAttribute('open');
    });
    currentEnemy = null;
    currentMap = null;
    setHash('');
  }

  /* ---------------- 地图 ---------------- */
  function mapMatchesDiff(m, tag) {
    if (tag.indexOf('M:') === 0) return m._modes.indexOf(tag.slice(2)) >= 0;
    if (tag.indexOf('L:') === 0) {
      var parts = tag.slice(2).split('-');
      var from = Number(parts[0]);
      var to = Number(parts[1]);
      return m._ranges.some(function (r) { return r[0] <= from && to <= r[1]; });
    }
    return false;
  }

  function buildMapDiffChips() {
    renderDiffChips(els.mapModeChips, MAP_MODES.map(function (name) {
      return { tag: 'M:' + name, label: name };
    }));
    renderDiffChips(els.mapLevelChips, MAP_LEVELS.map(function (level) {
      return { tag: 'L:' + level.key, label: level.label };
    }));
    syncMapDiffChips();
  }

  function renderDiffChips(container, items) {
    container.innerHTML = items.map(function (item) {
      var count = MAPS.filter(function (m) { return mapMatchesDiff(m, item.tag); }).length;
      return '<button type="button" class="chip" data-diff="' + esc(item.tag) + '" aria-pressed="false">' +
        esc(item.label) + '<span class="n">' + count + '</span></button>';
    }).join('');
    var buttons = container.querySelectorAll('[data-diff]');
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        state.mapDiffs = toggleIn(state.mapDiffs, btn.getAttribute('data-diff'));
        syncMapDiffChips();
        renderMaps();
      });
    });
  }

  function syncMapDiffChips() {
    [els.mapModeChips, els.mapLevelChips].forEach(function (container) {
      var buttons = container.querySelectorAll('[data-diff]');
      Array.prototype.forEach.call(buttons, function (btn) {
        btn.setAttribute('aria-pressed', state.mapDiffs.indexOf(btn.getAttribute('data-diff')) >= 0 ? 'true' : 'false');
      });
    });
    if (els.mapDiffClear) {
      els.mapDiffClear.disabled = state.mapDiffs.length === 0;
      els.mapDiffClear.style.opacity = state.mapDiffs.length ? '1' : '.45';
    }
  }

  function renderMaps() {
    var q = state.q.trim().toLowerCase();
    var list = MAPS.filter(function (m) {
      if (state.mapDiffs.length && !state.mapDiffs.some(function (tag) { return mapMatchesDiff(m, tag); })) return false;
      if (!q) return true;
      var hay = [m.label, m.note, m.difficulties.join(' '), m.terrain.map(function (t) { return t.name + ' ' + t.desc; }).join(' '), m.devices.map(function (d) { return d.name + ' ' + d.desc; }).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    els.mapCount.innerHTML = '显示 <b>' + list.length + '</b> / ' + MAPS.length + ' 张地图' +
      (state.mapDiffs.length ? ' · 已选 ' + state.mapDiffs.length + ' 个难度' : '');
    els.mapEmpty.hidden = list.length > 0;
    els.mapCards.innerHTML = list.map(mapCardHtml).join('');
  }

  function mapCardHtml(m) {
    var chips = m.terrain.map(function (t) { return '<span class="map-chip terrain">' + esc(t.name) + '</span>'; }).join('') +
      m.devices.map(function (d) { return '<span class="map-chip device">' + esc(d.name) + '</span>'; }).join('');
    if (!chips) chips = '<span class="map-chip">无特殊地形 / 装置</span>';
    return '<button type="button" class="map-card" data-map="' + esc(m.id) + '">' +
      '<div class="map-thumb"><img src="' + esc(m.fields[0]) + '" alt="" loading="lazy" decoding="async">' +
        '<span class="map-label">' + esc(m.label) + '</span>' + (m.fixed ? '<span class="map-fixed">固定图</span>' : '') + '</div>' +
      '<div class="map-body"><h3 class="map-title">战场 ' + esc(m.label) + '</h3>' +
        '<div class="map-diff">' + esc(m.difficulties.slice(0, 3).join(' · ')) + (m.difficulties.length > 3 ? ' …' : '') + '</div>' +
        '<div class="map-chips">' + chips + '</div></div></button>';
  }

  function openMap(id) {
    var m = mapById[id];
    if (!m) return;
    currentMap = m;
    currentField = 0;
    $('mapTitle').textContent = '战场 ' + m.label;
    $('mapSub').textContent = m.fixed ? '固定地图' : '随机地图';
    $('fieldTabs').innerHTML = [1, 2, 3].map(function (n, i) {
      return '<button type="button" data-field="' + i + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '">场地 ' + n + '</button>';
    }).join('');
    renderMapBody();
    showDialog(els.mapDialog);
    setHash('#/map/' + encodeURIComponent(m.id));
  }

  function renderMapBody() {
    var m = currentMap;
    if (!m) return;
    $('fieldTabs').querySelectorAll('[data-field]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', Number(btn.getAttribute('data-field')) === currentField ? 'true' : 'false');
    });
    $('mapImage').src = m.fields[currentField];
    $('mapImage').alt = '战场 ' + m.label + ' 场地 ' + (currentField + 1);

    var html = '';
    html += '<div class="info-block"><h3>适用难度</h3><div class="diff-list">' +
      m.difficulties.map(function (d) { return '<span class="diff">' + esc(d) + '</span>'; }).join('') + '</div></div>';
    if (m.terrain.length) {
      html += '<div class="info-block"><h3>特殊地形</h3>' + m.terrain.map(function (t) {
        return '<div class="info-card"><b>' + esc(t.name) + '</b>：' + esc(t.desc) + '</div>';
      }).join('') + '</div>';
    }
    if (m.devices.length) {
      html += '<div class="info-block"><h3>地图装置</h3>' + m.devices.map(function (d) {
        return '<div class="info-card"><b>' + esc(d.name) + '</b>：' + esc(d.desc) + '</div>';
      }).join('') + '</div>';
    }
    if (m.note) html += '<div class="info-card"><b>备注</b>：' + esc(m.note) + '</div>';

    var jump = m.terrain.filter(function (t) { return t.tag; })[0];
    if (jump) {
      html += '<button type="button" class="link-btn" data-jump-tag="' + esc(jump.tag) + '">查看【' + esc(tagName(jump.tag)) + '】敌人</button>' +
        '<p class="count" style="margin-top:6px">同名机制联动，不代表该地图只会出这类敌人。</p>';
    }
    html += '<p class="map-warn"><b>注意：</b>地图与敌方势力随机搭配；当前数据没有「地图 → 敌人」的固定关系，不能据此断言某地图必出某敌人。</p>';
    $('mapDetail').innerHTML = html;
  }

  /* ---------------- 视图 / 搜索 ---------------- */
  function setView(view) {
    state.view = view;
    var isEnemy = view === 'enemy';
    els.viewEnemy.hidden = !isEnemy;
    els.viewMap.hidden = isEnemy;
    els.tabEnemy.setAttribute('aria-selected', isEnemy ? 'true' : 'false');
    els.tabMap.setAttribute('aria-selected', isEnemy ? 'false' : 'true');
    if (!isEnemy) renderMaps();
    else render();
  }

  function setHash(hash) {
    try {
      var url = hash || (location.pathname + location.search);
      if (history.replaceState) history.replaceState(null, '', url);
    } catch (e) { /* file:// 下可能受限 */ }
  }

  function applyHash() {
    var hash = location.hash || '';
    var m = hash.match(/^#\/enemy\/(.+)$/);
    if (m) {
      var id = decodeURIComponent(m[1]);
      if (byId[id]) {
        setView('enemy');
        render();
        openEnemy(id);
        return;
      }
    }
    m = hash.match(/^#\/map\/(.+)$/);
    if (m) {
      var mid = decodeURIComponent(m[1]);
      if (mapById[mid]) {
        setView('map');
        openMap(mid);
        return;
      }
    }
    if (location.search.indexOf('view=map') >= 0) {
      setView('map');
      return;
    }
    setView('enemy');
  }

  function bindEvents() {
    els.q.addEventListener('input', function () {
      state.q = els.q.value;
      els.qclear.hidden = !state.q;
      if (state.view === 'map') renderMaps();
      else render();
    });
    els.qclear.addEventListener('click', function () {
      els.q.value = '';
      state.q = '';
      els.qclear.hidden = true;
      if (state.view === 'map') renderMaps();
      else render();
      els.q.focus();
    });
    els.q.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        els.qclear.click();
        els.q.blur();
      }
    });

    els.tagMode.addEventListener('click', function () {
      state.mode = state.mode === 'and' ? 'or' : 'and';
      syncFilterButtons();
      render();
    });
    els.dualOnly.addEventListener('change', function () {
      state.dual = els.dualOnly.checked;
      render();
    });
    els.crossOnly.addEventListener('change', function () {
      state.cross = els.crossOnly.checked;
      render();
    });
    els.sort.addEventListener('change', function () {
      state.sort = els.sort.value;
      render();
    });
    els.reset.addEventListener('click', resetFilters);
    els.emptyReset.addEventListener('click', resetFilters);
    els.mapClear.addEventListener('click', function () {
      els.q.value = '';
      state.q = '';
      state.mapDiffs = [];
      els.qclear.hidden = true;
      syncMapDiffChips();
      renderMaps();
    });
    els.mapDiffClear.addEventListener('click', function () {
      state.mapDiffs = [];
      syncMapDiffChips();
      renderMaps();
    });

    els.cards.addEventListener('click', function (e) {
      var card = e.target.closest ? e.target.closest('.card') : null;
      if (card) openEnemy(card.getAttribute('data-id'));
    });
    els.mapCards.addEventListener('click', function (e) {
      var card = e.target.closest ? e.target.closest('.map-card') : null;
      if (card) openMap(card.getAttribute('data-map'));
    });
    els.activeFilters.addEventListener('click', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-remove-tag')) {
        state.tags = state.tags.filter(function (x) { return x !== t.getAttribute('data-remove-tag'); });
      } else if (t.hasAttribute('data-remove-role')) {
        state.roles = state.roles.filter(function (x) { return x !== t.getAttribute('data-remove-role'); });
      } else if (t.hasAttribute('data-remove-dual')) {
        state.dual = false;
      } else if (t.hasAttribute('data-remove-cross')) {
        state.cross = false;
      } else {
        return;
      }
      syncFilterButtons();
      render();
    });

    els.tabEnemy.addEventListener('click', function () { setView('enemy'); });
    els.tabMap.addEventListener('click', function () { setView('map'); });
    $('theme').addEventListener('click', toggleTheme);

    els.enemyDialog.addEventListener('click', function (e) {
      if (e.target === els.enemyDialog) closeDialogs();
      var close = e.target.closest ? e.target.closest('[data-close]') : null;
      if (close) closeDialogs();
      var tag = e.target.closest ? e.target.closest('[data-tag]') : null;
      if (tag && els.enemyDialog.contains(tag)) {
        var key = tag.getAttribute('data-tag');
        state.tags = [key];
        state.mode = 'or';
        closeDialogs();
        setView('enemy');
        syncFilterButtons();
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      var open = e.target.closest ? e.target.closest('[data-open]') : null;
      if (open) {
        openEnemy(open.getAttribute('data-open'));
      }
    });
    els.mapDialog.addEventListener('click', function (e) {
      if (e.target === els.mapDialog) { closeDialogs(); return; }
      var close = e.target.closest ? e.target.closest('[data-close]') : null;
      if (close) { closeDialogs(); return; }
      var field = e.target.closest ? e.target.closest('[data-field]') : null;
      if (field) {
        currentField = Number(field.getAttribute('data-field'));
        renderMapBody();
        return;
      }
      var jump = e.target.closest ? e.target.closest('[data-jump-tag]') : null;
      if (jump) {
        state.tags = [jump.getAttribute('data-jump-tag')];
        state.mode = 'or';
        closeDialogs();
        setView('enemy');
        syncFilterButtons();
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    [els.enemyDialog, els.mapDialog].forEach(function (dialog) {
      dialog.addEventListener('close', function () {
        if (!els.enemyDialog.open && !els.mapDialog.open) setHash('');
      });
    });

    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      var editing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.key === '/' && !editing) {
        e.preventDefault();
        els.q.focus();
        els.q.select();
      } else if (e.key === 'Escape') {
        if (els.enemyDialog.open || els.mapDialog.open) return; // dialog 自己处理
        if (document.body.classList.contains('filters-open')) return;
        if (els.q.value) els.qclear.click();
      }
    });
  }

  function resetFilters() {
    state.tags = [];
    state.roles = [];
    state.dual = false;
    state.cross = false;
    state.mode = 'or';
    state.q = '';
    els.q.value = '';
    els.qclear.hidden = true;
    syncFilterButtons();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
