/* ==========================================================================
   ui.js — DOM 构造：筛选面板、卡片、详情、关于页、页脚
   --------------------------------------------------------------------------
   全部字符串拼接 + 统一转义（Search.esc / Search.format），不信任数据里的任何
   HTML 片段；数据里本来就有 <进入休整期时> 这类尖括号文本。
   ========================================================================== */
(function (global) {
  'use strict';

  var Store = global.Store;
  var Search = global.Search;

  var refs = {};
  var data = null;
  var currentList = [];
  var hueCache = {};
  var opByName = {};
  var NO_AVATARS = !!global.GARRISON_NO_AVATARS;

  var KIND_LABEL = {
    count: '人数',
    count_layer: '人数 + 层数',
    elite: '精锐数',
    special: '特殊'
  };

  function esc(s) { return Search.esc(s); }

  function init() {
    data = Store.getData();
    refs = {
      filters: document.getElementById('filters'),
      cards: document.getElementById('cards'),
      toolbar: document.getElementById('toolbar'),
      drawer: document.getElementById('drawer'),
      empty: document.getElementById('empty'),
      footer: document.getElementById('footer'),
      tabs: document.getElementById('tabs')
    };
    fillTabCounts();
    renderFooter();

    opByName = {};
    for (var i = 0; i < data.operators.length; i++) {
      opByName[data.operators[i].name] = data.operators[i];
    }
    return refs;
  }

  function fillTabCounts() {
    var c = data.counts;
    var map = { op: c.operators, item: c.items, strategy: c.strategies, covenant: c.covenants };
    var nodes = refs.tabs ? refs.tabs.querySelectorAll('[data-n]') : [];
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-n');
      nodes[i].textContent = map[k] || '';
    }
  }

  /* ---------------- 盟约固定色相 ---------------- */
  function hue(name) {
    var key = String(name || '');
    if (hueCache[key] != null) return hueCache[key];
    var h = 2166136261;
    for (var i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    var v = Math.abs(h) % 360;
    // 往两侧压一点，避开纯黄/纯青这类在深色底上发飘的色相
    if (v > 40 && v < 75) v = 40;
    hueCache[key] = v;
    return v;
  }

  /* ---------------- 头像 ---------------- */
  function initial(name) {
    var s = String(name == null ? '' : name).replace(/^[“"'\s]+/, '');
    return s ? s.charAt(0) : '?';
  }

  /**
   * 头像块：有图显示图，无图（或图坏了）露出色块首字。
   * @param {object|null} entry 有 avatar / avatarFull 的对象
   * @param {string} name 用于取首字与色相
   * @param {number} size 像素
   * @param {boolean} full 是否优先用大图
   */
  function avatarHtml(entry, name, size, full) {
    if (NO_AVATARS) return '';
    var src = entry ? (full ? (entry.avatarFull || entry.avatar) : entry.avatar) : null;
    var img = src
      ? '<img class="avatar-img" src="' + esc(src) + '" alt="" width="' + size + '" height="' + size +
        '" loading="lazy" decoding="async">'
      : '';
    return '<span class="avatar" style="--h:' + hue(name) + ';--size:' + size + 'px" aria-hidden="true">' +
      '<span class="avatar-letter">' + esc(initial(name)) + '</span>' + img + '</span>';
  }

  /* ======================================================================
     总渲染
     ====================================================================== */
  function render() {
    var st = Store.state;
    var toks = Search.tokens(st.q);

    renderTabs(st);
    document.body.classList.toggle('view-about', st.view === 'about');

    if (st.view === 'about') {
      currentList = [];
      refs.filters.innerHTML = '';
      refs.filters.hidden = true;
      refs.toolbar.hidden = true;
      refs.toolbar.innerHTML = '';
      refs.empty.hidden = true;
      refs.cards.hidden = false;
      refs.cards.className = 'cards is-about';
      refs.cards.innerHTML = aboutHtml(st);
      renderDrawer(st, toks);
      updateTitle(st);
      return currentList;
    }

    refs.filters.hidden = false;
    refs.toolbar.hidden = false;
    refs.cards.className = 'cards';

    currentList = Search.filter(st.view, st);
    renderFilters(st);
    renderToolbar(st);
    renderCards(st, toks);
    renderDrawer(st, toks);
    updateTitle(st);
    return currentList;
  }

  function updateTitle(st) {
    var t = {
      op: '干员图鉴',
      item: '道具图鉴',
      strategy: '策略图鉴',
      covenant: '盟约图鉴',
      about: '关于'
    }[st.view] || '卫戍协议小助手';
    document.title = t + ' · 卫戍协议小助手';
  }

  function renderTabs(st) {
    var tabs = refs.tabs ? refs.tabs.querySelectorAll('[data-view]') : [];
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-view') === st.view;
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].tabIndex = on ? 0 : -1;
    }
  }

  /* ======================================================================
     筛选面板
     ====================================================================== */
  function facetBase(st, facet) {
    var copy = {};
    for (var k in st) if (st.hasOwnProperty(k)) copy[k] = st[k];
    copy.tiers = st.tiers.slice();
    copy.tags = st.tags.slice();
    copy.triggers = st.triggers.slice();
    copy.prices = st.prices.slice();
    copy.itypes = st.itypes.slice();
    copy.icats = st.icats.slice();
    copy.otypes = st.otypes.slice();
    copy.kinds = st.kinds.slice();

    if (facet === 'tags') {
      return Search.filter(st.view, copy, { skipTags: true });
    }
    copy[facet] = [];
    return Search.filter(st.view, copy);
  }

  function groupHtml(opts) {
    var st = Store.state;
    var sel = st[opts.id];
    var isArr = Array.isArray(sel);
    var active = opts.toggle ? !!sel : (isArr ? sel.length > 0 : !!sel);
    var counts = opts.counts || {};

    var chips = '';
    for (var i = 0; i < opts.items.length; i++) {
      var it = opts.items[i];
      var val = it.v;
      var pressed = opts.toggle ? !!sel : (isArr ? sel.indexOf(val) >= 0 : sel === val);
      var c = counts[String(val)];
      var count = (it.count === false) ? null : (c == null ? 0 : c);
      var extra = '';
      if (it.tier) extra += ' tier-chip" data-tier="' + it.tier;
      chips += '<button type="button" class="chip' + extra + '"' +
        ' data-fid="' + opts.id + '" data-fval="' + esc(String(val)) + '"' +
        ' aria-pressed="' + (pressed ? 'true' : 'false') + '"' +
        (it.hue != null ? ' title="' + esc(it.label) + '"' : '') + '>' +
        (it.hue != null ? '<i class="dot" style="--h:' + it.hue + '"></i>' : '') +
        esc(it.label) +
        (count != null ? '<span class="chip-count">' + count + '</span>' : '') +
        '</button>';
    }

    var modeHtml = '';
    if (opts.mode) {
      modeHtml = '<div class="seg" role="group" aria-label="盟约匹配方式">' +
        '<button type="button" data-tm="and" aria-pressed="' + (st.tagMode === 'and' ? 'true' : 'false') + '">全部</button>' +
        '<button type="button" data-tm="or" aria-pressed="' + (st.tagMode === 'or' ? 'true' : 'false') + '">任一</button>' +
        '</div>';
    }

    return '<div class="fgroup"' + (opts.wide ? ' data-wide' : '') + '>' +
      '<div class="fgroup-head"><span class="fgroup-title">' + esc(opts.title) + '</span>' +
      (active ? '<button type="button" class="fgroup-clear" data-fclear="' + opts.id + '">清除</button>' : '') +
      '</div>' +
      '<div class="chips">' + chips + '</div>' +
      modeHtml +
      '</div>';
  }

  function renderFilters(st) {
    var groups = buildGroups(st);
    var html = '<div class="filters-head"><span class="filters-title">筛选</span>' +
      '<span class="filters-head-actions">' +
      '<button type="button" class="fgroup-clear" data-reset="1">全部清空</button>' +
      '<button type="button" class="fgroup-clear filters-x" data-close-filters="1" aria-label="关闭筛选">' +
      '<svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>' +
      '</span></div>';

    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (!g) continue;
      var base = (g.countsFrom === 'none') ? [] : facetBase(st, g.id);
      g.counts = g.countOf ? Search.countFacet(base, g.countOf) : {};
      html += groupHtml(g);
    }

    if (st.view === 'op') {
      html += '<div class="filters-foot">' +
        '<button type="button" class="btn btn-primary" data-close-filters="1">查看结果（' + currentList.length + '）</button>' +
        '</div>';
    } else {
      html += '<div class="filters-foot">' +
        '<button type="button" class="btn" data-close-filters="1">收起</button>' +
        '</div>';
    }

    refs.filters.innerHTML = html;
  }

  function buildGroups(st) {
    var groups = [];

    if (st.view === 'op') {
      groups.push({
        id: 'tiers', title: '阶数', wide: false,
        items: data.tiers.map(function (t, i) {
          return { v: i + 1, label: t, tier: String(i + 1) };
        }),
        countOf: function (o) { return [o.tier]; }
      });
      groups.push({
        id: 'tags', title: '盟约', wide: true, mode: true,
        items: data.covenants.map(function (c) {
          return { v: c.name, label: c.name, hue: hue(c.name) };
        }),
        countOf: function (o) { return o.tags; }
      });
      groups.push({
        id: 'triggers', title: '触发时机', wide: true,
        items: triggerOptions(),
        countOf: function (o) { return o.normalTriggers.concat(o.eliteTriggers); }
      });
      groups.push({
        id: 'prices', title: '售价', wide: false,
        items: [1, 2, 3, 4].map(function (n) { return { v: n, label: '◈' + n }; }),
        countOf: function (o) { return [o.price]; }
      });
      groups.push({
        id: 'otypes', title: '条目类型', wide: true,
        items: ['特许条目', '普通条目', '自选配置'].map(function (t) { return { v: t, label: t }; }),
        countOf: function (o) { return [o.type]; }
      });
      groups.push({
        id: 'hidden', title: '其他', wide: false, toggle: true,
        items: [{ v: '1', label: '显示隐藏条目', count: false }],
        countsFrom: 'none'
      });
      return groups;
    }

    if (st.view === 'item') {
      groups.push({
        id: 'itypes', title: '类型', wide: true,
        items: ['装备', '消耗道具', '合成成品'].map(function (t) { return { v: t, label: t }; }),
        countOf: function (o) { return [o.type]; }
      });
      groups.push({
        id: 'tiers', title: '阶数', wide: false,
        items: [1, 2, 3, 4, 5, 6].map(function (n) {
          return { v: n, label: n + ' 阶', tier: String(n) };
        }),
        countOf: function (o) { return [o.tier]; }
      });
      groups.push({
        id: 'prices', title: '普通售价', wide: false,
        items: [1, 2, 3, 4, 5, 6].map(function (n) { return { v: n, label: '◈' + n }; }),
        countOf: function (o) { return [o.price]; }
      });
      return groups;
    }

    if (st.view === 'strategy') {
      groups.push({
        id: 'icats', title: '类别', wide: true,
        items: ['通用策略', '盟约策略'].map(function (t) { return { v: t, label: t }; }),
        countOf: function (o) { return [o.category]; }
      });
      return groups;
    }

    if (st.view === 'covenant') {
      groups.push({
        id: 'kinds', title: '激活方式', wide: true,
        items: [
          { v: 'count', label: '人数' },
          { v: 'count_layer', label: '人数 + 层数' },
          { v: 'elite', label: '精锐数' },
          { v: 'special', label: '特殊' }
        ],
        countOf: function (o) { return [o.activation.kind]; }
      });
      return groups;
    }

    return groups;
  }

  function triggerOptions() {
    var seen = {};
    var out = [];
    var ops = data.operators;
    for (var i = 0; i < ops.length; i++) {
      var t = ops[i].normalTriggers.concat(ops[i].eliteTriggers);
      for (var j = 0; j < t.length; j++) {
        if (!seen[t[j]]) { seen[t[j]] = 1; out.push(t[j]); }
      }
    }
    var order = ['获得时', '进入休整期时', '休整期开始时', '休整期结束时', '战斗中',
      '战斗开始时', '战斗结束时', '售出时', '刷新时'];
    out.sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0) ia = 99;
      if (ib < 0) ib = 99;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b, 'zh-Hans-CN');
    });
    return out.map(function (t) { return { v: t, label: t }; });
  }

  /* ======================================================================
     工具条
     ====================================================================== */
  function renderToolbar(st) {
    var total = currentList.length;
    var viewTotal = Store.listOf(st.view).length;
    var nActive = Store.activeFilterCount(st);

    var sortOpts = sortOptions(st.view);
    var sortHtml = '<label class="sort">排序<select id="sort" aria-label="排序方式">';
    for (var i = 0; i < sortOpts.length; i++) {
      sortHtml += '<option value="' + esc(sortOpts[i].v) + '"' +
        (st.sort === sortOpts[i].v ? ' selected' : '') + '>' + esc(sortOpts[i].label) + '</option>';
    }
    sortHtml += '</select></label>';

    var filterBtn = '<button type="button" class="btn btn-filter" data-filters-toggle="1">' +
      '<svg class="ico" aria-hidden="true"><use href="#i-filter"/></svg>筛选' +
      (nActive ? '<span class="badge">' + nActive + '</span>' : '') + '</button>';

    var countHtml = '<div class="result-count">共 <b>' + total + '</b> 条' +
      (total !== viewTotal ? '<span style="color:var(--fg3)"> / ' + viewTotal + '</span>' : '') +
      '</div>';

    var chips = activeFilterChips(st);

    refs.toolbar.innerHTML =
      filterBtn + countHtml +
      '<div class="toolbar-spacer"></div>' +
      sortHtml +
      (nActive ? '<button type="button" class="btn" data-reset="1"><svg class="ico" aria-hidden="true"><use href="#i-reset"/></svg>重置</button>' : '') +
      (chips ? '<div class="active-filters">' + chips + '</div>' : '');
  }

  function sortOptions(view) {
    if (view === 'op') {
      return [
        { v: 'default', label: '阶数 → 名称' },
        { v: 'name', label: '名称' },
        { v: 'price', label: '售价' },
        { v: 'tagcount', label: '盟约数' }
      ];
    }
    if (view === 'item') {
      return [
        { v: 'default', label: '阶数 → 名称' },
        { v: 'name', label: '名称' },
        { v: 'price', label: '售价' }
      ];
    }
    if (view === 'strategy') {
      return [
        { v: 'default', label: '角色名' },
        { v: 'category', label: '类别 → 角色' },
        { v: 'name', label: '策略名' },
        { v: 'hp', label: '生命值' }
      ];
    }
    return [
      { v: 'default', label: '成员数' },
      { v: 'name', label: '名称' }
    ];
  }

  function activeFilterChips(st) {
    var out = [];
    var i;

    if (st.q) out.push(afChip('q', '搜索：' + st.q));
    if (st.tiers.length) {
      var tl = [];
      for (i = 0; i < st.tiers.length; i++) {
        tl.push(st.view === 'item' ? String(st.tiers[i]) : data.tiers[st.tiers[i] - 1]);
      }
      out.push(afChip('tiers', '阶数 ' + tl.join('/')));
    }
    if (st.tags.length) {
      var names = [];
      for (i = 0; i < st.tags.length; i++) names.push(st.tags[i]);
      out.push(afChip('tags', '盟约 ' + (st.tagMode === 'or' ? '任一：' : '全部：') + names.join(' + ')));
    }
    if (st.triggers.length) out.push(afChip('triggers', '时机 ' + st.triggers.join('/')));
    if (st.prices.length) out.push(afChip('prices', '售价 ' + st.prices.join('/')));
    if (st.itypes.length) out.push(afChip('itypes', st.itypes.join('/')));
    if (st.icats.length) out.push(afChip('icats', st.icats.join('/')));
    if (st.otypes.length) out.push(afChip('otypes', st.otypes.join('/')));
    if (st.kinds.length) {
      var kl = [];
      for (i = 0; i < st.kinds.length; i++) kl.push(KIND_LABEL[st.kinds[i]] || st.kinds[i]);
      out.push(afChip('kinds', kl.join('/')));
    }
    if (st.hidden) out.push(afChip('hidden', '含隐藏'));

    return out.join('');
  }

  function afChip(id, label) {
    return '<span class="af">' + esc(label) +
      '<button type="button" data-fclear="' + id + '" aria-label="移除筛选：' + esc(label) + '">' +
      '<svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button></span>';
  }

  /* ======================================================================
     卡片
     ====================================================================== */
  function renderCards(st, toks) {
    var list = currentList;
    if (!list.length) {
      refs.cards.innerHTML = '';
      refs.cards.hidden = true;
      refs.empty.hidden = false;
      return;
    }
    refs.cards.hidden = false;
    refs.empty.hidden = true;

    var parts = [];
    for (var i = 0; i < list.length; i++) {
      parts.push(cardHtml(st.view, list[i], toks, st));
    }
    refs.cards.innerHTML = parts.join('');
  }

  function cardHtml(view, e, toks, st) {
    if (view === 'op') return opCard(e, toks, st);
    if (view === 'item') return itemCard(e, toks, st);
    if (view === 'strategy') return strategyCard(e, toks, st);
    return covenantCard(e, toks, st);
  }

  function cardOpen(view, key, label, extraClass) {
    return '<div class="card' + (extraClass ? ' ' + extraClass : '') + '" role="button" tabindex="0"' +
      ' data-sel="' + esc(key) + '" aria-label="' + esc(label) + '">';
  }

  function tagsHtml(tags) {
    if (!tags || !tags.length) {
      return '<span class="tag tag-muted">无盟约</span>';
    }
    var out = '';
    for (var i = 0; i < tags.length; i++) {
      out += '<button type="button" class="tag" data-tag="' + esc(tags[i]) + '"' +
        ' style="--h:' + hue(tags[i]) + '" title="按【' + esc(tags[i]) + '】筛选">' +
        '<i class="dot"></i>' + esc(tags[i]) + '</button>';
    }
    return out;
  }

  function trgHtml(list) {
    if (!list || !list.length) return '';
    var out = '';
    for (var i = 0; i < list.length; i++) {
      out += '<span class="trg">' + esc(list[i]) + '</span>';
    }
    return out;
  }

  function opCard(o, toks, st) {
    var active = st.sel === o.name ? 'is-active' : '';
    var label = '干员 ' + o.name + '，' + o.tierLabel + ' 阶，售价 ' + o.price +
      '，盟约 ' + (o.tags.length ? o.tags.join('、') : '无');

    return cardOpen('op', o.name, label, active) +
      '<div class="card-top">' +
      avatarHtml(o, o.name, 40) +
      '<div class="card-title">' + Search.highlight(o.name, toks) + '</div>' +
      '<div class="card-badges">' +
      '<span class="tier" data-tier="' + o.tier + '">' + esc(o.tierLabel) + '</span>' +
      '<span class="price">' + o.price + '</span>' +
      '</div></div>' +
      '<div class="card-tags">' + tagsHtml(o.tags) + '</div>' +
      '<div class="eff">' +
      '<div class="eff-col"><div class="eff-h"><b>普通</b>' + trgHtml(o.normalTriggers) + '</div>' +
      '<p>' + Search.format(o.normalText, toks) + '</p></div>' +
      '<div class="eff-col"><div class="eff-h"><b class="elite">精锐</b>' + trgHtml(o.eliteTriggers) + '</div>' +
      '<p>' + Search.format(o.eliteText, toks) + '</p></div>' +
      '</div>' +
      '<div class="card-foot">' +
      '<span class="pill">' + esc(o.type) + '</span>' +
      (o.hidden ? '<span class="pill pill-warn">隐藏条目</span>' : '') +
      '<span class="sp"></span><span>详情 ›</span>' +
      '</div>' +
      '</div>';
  }

  function itemCard(o, toks, st) {
    var active = st.sel === o.name ? 'is-active' : '';
    var label = '道具 ' + o.name + '，' + o.type + '，' + o.tier + ' 阶，售价 ' + o.price;
    var foot = '<span class="pill">' + esc(o.type) + '</span>';
    if (o.fuseCount) foot += '<span class="pill">合成需 ' + o.fuseCount + ' 件</span>';

    return cardOpen('item', o.name, label, active) +
      '<div class="card-top">' +
      '<div class="card-title">' + Search.highlight(o.name, toks) + '</div>' +
      '<div class="card-badges">' +
      '<span class="tier" data-tier="' + o.tier + '">' + o.tier + '</span>' +
      '<span class="price">' + o.price + '</span>' +
      '</div></div>' +
      '<div class="eff">' +
      '<div class="eff-col"><div class="eff-h"><b>普通</b></div>' +
      '<p>' + Search.format(o.normalText, toks) + '</p></div>' +
      '<div class="eff-col"><div class="eff-h"><b class="elite">精锐</b>' +
      (o.hasElite ? '' : '<span class="pill">无进阶</span>') + '</div>' +
      '<p>' + Search.format(o.eliteText, toks) + '</p></div>' +
      '</div>' +
      '<div class="card-foot">' + foot +
      '<span class="sp"></span><span>精锐售价 ' +
      (o.hasElite ? '◈' + o.elitePrice : '—') + '</span>' +
      '</div>' +
      '</div>';
  }

  function strategyCard(s, toks, st) {
    var active = st.sel === s.key ? 'is-active' : '';
    var label = '角色 ' + s.role + ' 的策略「' + s.name + '」，' + s.category + '，生命值 ' + s.hp;

    // 策略以「角色」为主体：大头像是角色，策略名作为副标题；效果统一放详情。
    return cardOpen('strategy', s.key, label, active) +
      '<div class="card-top">' +
      avatarHtml(null, s.role, 44) +
      '<div class="card-main">' +
      '<div class="card-title">' + Search.highlight(s.role, toks) + '</div>' +
      '<div class="card-sub">策略「' + Search.highlight(s.name, toks) + '」</div>' +
      '</div>' +
      '<div class="card-badges"><span class="pill">HP ' + s.hp + '</span></div>' +
      '</div>' +
      '<div class="card-foot">' +
      '<span class="pill">' + esc(s.category) + '</span>' +
      '<span class="pill">' + s.stages.length + ' 个阶段</span>' +
      '<span class="sp"></span><span>详情 ›</span>' +
      '</div>' +
      '</div>';
  }

  function covenantCard(c, toks, st) {
    var active = st.sel === c.name ? 'is-active' : '';
    var label = '盟约 ' + c.name + '，' + (KIND_LABEL[c.activation.kind] || '') +
      '，成员 ' + c.memberCount + ' 名';

    var rule = activationShort(c);

    var members = '';
    for (var i = 0; i < Math.min(c.members.length, 6); i++) {
      members += '<span>' + esc(c.members[i]) + '</span>';
    }
    if (c.members.length > 6) members += '<span>+' + (c.members.length - 6) + '</span>';

    return cardOpen('covenant', c.name, label, active) +
      '<div class="card-top">' +
      '<div class="card-title"><span class="tag" style="--h:' + hue(c.name) + ';font-size:13px">' +
      '<i class="dot"></i>' + Search.highlight(c.name, toks) + '</span></div>' +
      '<div class="card-badges"><span class="pill">' + esc(KIND_LABEL[c.activation.kind] || c.activation.kind) + '</span></div>' +
      '</div>' +
      '<p class="desc">' + Search.format(c.desc, toks) + '</p>' +
      '<div class="card-foot">' +
      '<span class="pill">' + esc(rule) + '</span>' +
      '<span class="pill">成员 ' + c.memberCount + '</span>' +
      (c.garrison ? '<span class="pill pill-elite">含整备区</span>' : '') +
      '</div>' +
      (members ? '<div class="members-mini">' + members + '</div>' : '') +
      '</div>';
  }

  function activationShort(c) {
    var a = c.activation;
    if (a.kind === 'count') return '在场 ' + a.threshold + ' 人激活';
    if (a.kind === 'count_layer') return a.threshold + ' 人激活 / ' + (a.nodes.join('·') || '-') + ' 层';
    if (a.kind === 'elite') return '精锐 ' + a.threshold + ' 名';
    if (c.name === '独行') return '仅 1 人时生效';
    if (c.name === '调和') return '核心盟约 +1 人';
    return '特殊规则';
  }

  /* ======================================================================
     详情
     ====================================================================== */
  function renderDrawer(st, toks) {
    var drawer = refs.drawer;
    if (!st.sel || st.view === 'about') {
      drawer.hidden = true;
      drawer.innerHTML = '';
      document.body.classList.remove('has-detail');
      document.body.classList.remove('detail-open');
      return;
    }
    var e = Store.entity(st.view, st.sel);
    if (!e) {
      drawer.hidden = true;
      drawer.innerHTML = '';
      document.body.classList.remove('has-detail');
      document.body.classList.remove('detail-open');
      return;
    }

    var html = '';
    if (st.view === 'op') html = opDetail(e, toks);
    else if (st.view === 'item') html = itemDetail(e, toks);
    else if (st.view === 'strategy') html = strategyDetail(e, toks);
    else html = covenantDetail(e, toks);

    drawer.innerHTML = html;
    drawer.hidden = false;
    document.body.classList.add('has-detail');
    if (global.matchMedia && global.matchMedia('(max-width: 1023px)').matches) {
      document.body.classList.add('detail-open');
    }
  }

  function closeBtn() {
    return '<button type="button" class="d-close" data-close="1" aria-label="关闭详情">' +
      '<svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>';
  }

  function actionBar() {
    return '<div class="d-actions">' +
      '<button type="button" class="btn" data-copy="1"><svg class="ico" aria-hidden="true"><use href="#i-share"/></svg>复制链接</button>' +
      '<button type="button" class="btn" data-close="1">关闭</button>' +
      '</div>';
  }

  function opDetail(o, toks) {
    var html = '<div class="d-head">' + avatarHtml(o, o.name, 56, true) +
      '<div class="d-head-main"><h2 class="d-title">' + Search.highlight(o.name, toks) + '</h2>' +
      '<div class="d-sub" style="margin-bottom:0">' + esc(o.tierLabel) + ' 阶 · ' + esc(o.type) +
      ' · 售价 ◈' + o.price + '</div></div>' + closeBtn() + '</div>';

    html += '<div class="d-meta">' +
      (o.hidden ? '<span class="pill pill-warn">隐藏条目</span>' : '') +
      '<span class="pill">普通 / 精锐 双形态</span>' +
      '</div>';

    html += '<div class="d-tags">' + tagsHtml(o.tags) + '</div>';

    html += '<div class="d-sec"><h3>普通</h3><div class="d-box">' +
      '<h4>' + (trgHtml(o.normalTriggers) || '<span style="color:var(--fg3)">无触发时机</span>') + '</h4>' +
      '<p>' + Search.format(o.normalText, toks) + '</p></div></div>';

    html += '<div class="d-sec"><h3>精锐</h3><div class="d-box">' +
      '<h4>' + (trgHtml(o.eliteTriggers) || '<span style="color:var(--fg3)">无触发时机</span>') + '</h4>' +
      '<p>' + Search.format(o.eliteText, toks) + '</p></div></div>';

    if (o.tags.length) {
      html += '<div class="d-sec"><h3>所属盟约</h3>';
      for (var i = 0; i < o.tags.length; i++) {
        var c = Store.covenantByName(o.tags[i]);
        if (!c) continue;
        html += '<button type="button" class="d-box d-link" data-cov="' + esc(c.name) + '">' +
          '<h4><span class="tag" style="--h:' + hue(c.name) + '"><i class="dot"></i>' + esc(c.name) + '</span>' +
          '<span style="color:var(--fg3);font-weight:400">' + esc(activationShort(c)) + '</span></h4>' +
          '<p>' + esc(firstLine(c.desc)) + '</p>' +
          '</button>';
      }
      html += '</div>';
    } else {
      html += '<div class="d-sec"><h3>所属盟约</h3><div class="d-box"><p>该条目没有盟约标签（自选配置槽位）。</p></div></div>';
    }

    html += actionBar();
    return html;
  }

  function itemDetail(o, toks) {
    var html = '<div class="d-head"><h2 class="d-title">' + Search.highlight(o.name, toks) + '</h2>' + closeBtn() + '</div>';
    html += '<div class="d-sub">' + esc(o.type) + ' · ' + o.tier + ' 阶 · 普通售价 ◈' + o.price +
      ' · 精锐售价 ' + (o.hasElite ? '◈' + o.elitePrice : '—（无进阶形态）') + '</div>';

    html += '<div class="d-meta">' +
      '<span class="pill">' + esc(o.type) + '</span>' +
      (o.fuseCount ? '<span class="pill">合成需 ' + o.fuseCount + ' 件</span>' : '') +
      '</div>';

    html += '<div class="d-sec"><h3>普通效果</h3><div class="d-box">' +
      '<p>' + Search.format(o.normalText, toks) + '</p></div></div>';
    html += '<div class="d-sec"><h3>精锐效果</h3><div class="d-box">' +
      '<p>' + Search.format(o.eliteText, toks) + '</p></div></div>';

    var asResult = null, asPart = [];
    for (var i = 0; i < data.fusions.length; i++) {
      var f = data.fusions[i];
      if (f.result === o.name) asResult = f;
      if (f.m1 === o.name || f.m2 === o.name) asPart.push(f);
    }

    if (asResult) {
      html += '<div class="d-sec"><h3>合成方式</h3><div class="d-box">' +
        '<p><b>' + esc(asResult.m1) + '</b>（' + esc(asResult.m1Tier) + ' 阶） + <b>' +
        esc(asResult.m2) + '</b>（' + esc(asResult.m2Tier) + ' 阶） → <b>' + esc(asResult.result) + '</b></p>' +
        '<p style="margin-top:6px;color:var(--fg3)">' + esc(asResult.effect) + '</p></div></div>';
    }
    if (asPart.length) {
      html += '<div class="d-sec"><h3>可合成</h3>';
      for (var k = 0; k < asPart.length; k++) {
        html += '<button type="button" class="d-box d-link" data-item="' + esc(asPart[k].result) + '">' +
          '<h4>' + esc(asPart[k].result) + '</h4>' +
          '<p>' + esc(asPart[k].m1) + ' + ' + esc(asPart[k].m2) + '</p></button>';
      }
      html += '</div>';
    }

    if (data.buffs && data.buffs.length) {
      var related = [];
      for (var b = 0; b < data.buffs.length; b++) {
        if (data.buffs[b].effect.indexOf(o.name) >= 0) related.push(data.buffs[b]);
      }
      if (related.length) {
        html += '<div class="d-sec"><h3>相关补给</h3>';
        for (var r = 0; r < related.length; r++) {
          html += '<div class="d-box"><h4>' + esc(related[r].name) + '</h4><p>' +
            Search.format(related[r].effect, toks) + '</p></div>';
        }
        html += '</div>';
      }
    }

    html += actionBar();
    return html;
  }

  function strategyDetail(s, toks) {
    // 详情同样以角色为主体，策略名放在副标题
    var html = '<div class="d-head">' + avatarHtml(null, s.role, 56) +
      '<div class="d-head-main"><h2 class="d-title">' + Search.highlight(s.role, toks) + '</h2>' +
      '<div class="d-sub" style="margin-bottom:0">策略「' + Search.highlight(s.name, toks) + '」 · ' +
      esc(s.category) + ' · 生命值 ' + s.hp + '</div></div>' + closeBtn() + '</div>';

    html += '<div class="d-meta">' +
      '<span class="pill">生命值 ' + s.hp + '</span>' +
      '<span class="pill">' + s.stages.length + ' 个指令阶段</span>' +
      '<span class="pill">' + esc(s.category) + '</span>' +
      '</div>';

    html += '<div class="d-sec"><h3>策略描述</h3><div class="d-box">' +
      '<p>' + Search.format(s.text, toks) + '</p></div></div>';

    html += '<div class="d-sec"><h3>解锁条件</h3><div class="d-box"><p>' +
      (s.unlock === '未配置额外解锁条件' ? '<span style="color:var(--fg3)">无额外解锁条件</span>' : Search.format(s.unlock, toks)) +
      '</p></div></div>';

    if (s.banned && s.banned !== '无禁用模式记录') {
      html += '<div class="d-sec"><h3>禁用模式</h3><div class="d-box"><p>' + Search.format(s.banned, toks) + '</p></div></div>';
    }

    if (s.stages.length) {
      html += '<div class="d-sec"><h3>指令阶段</h3><div class="stages">';
      for (var i = 0; i < s.stages.length; i++) {
        var g = s.stages[i];
        html += '<div class="stage"><div class="stage-h">' +
          '<span class="stage-no">' + (g.seq || i + 1) + '</span>' +
          '<span class="pill">' + esc(g.state) + '</span>' +
          (g.cost !== '' ? '<span>费用 ' + esc(g.cost) + '</span>' : '') +
          (g.rule ? '<span>' + esc(g.rule) + '</span>' : '') +
          '</div><p>' + Search.format(g.effect, toks) + '</p></div>';
      }
      html += '</div></div>';
    }

    if (opByName[s.role]) {
      html += '<div class="d-sec"><h3>相关干员</h3>' +
        '<button type="button" class="btn" data-op="' + esc(s.role) + '">' +
        '查看干员「' + esc(s.role) + '」</button></div>';
    }

    html += actionBar();
    return html;
  }

  function covenantDetail(c, toks) {
    var a = c.activation;
    var html = '<div class="d-head"><h2 class="d-title">' +
      '<span class="tag" style="--h:' + hue(c.name) + ';font-size:16px;padding:2px 10px">' +
      '<i class="dot"></i>' + Search.highlight(c.name, toks) + '</span></h2>' + closeBtn() + '</div>';

    html += '<div class="d-sub">' + esc(KIND_LABEL[a.kind] || a.kind) + ' · 成员 ' + c.memberCount + ' 名' +
      (c.garrison ? ' · 整备区可计入' : '') + '</div>';

    html += '<div class="d-sec"><h3>激活规则</h3><div class="d-box"><dl class="rule">' +
      '<dt>激活方式</dt><dd>' + esc(KIND_LABEL[a.kind] || a.kind) + '</dd>';
    if (a.kind === 'count' || a.kind === 'count_layer') {
      html += '<dt>激活人数</dt><dd>' + a.threshold + ' 名</dd>';
    }
    if (a.kind === 'elite') {
      html += '<dt>激活条件</dt><dd>' + a.threshold + ' 名精锐状态干员</dd>';
    }
    if (a.kind === 'special') {
      html += '<dt>判定</dt><dd>' + esc(activationShort(c)) + '</dd>';
    }
    if (a.nodes && a.nodes.length) {
      html += '<dt>强化节点</dt><dd><span class="nodes">';
      for (var i = 0; i < a.nodes.length; i++) {
        html += '<span class="node">' + a.nodes[i] + '<small>' +
          (a.kind === 'elite' ? ' 名精锐' : ' 层') + '</small></span>';
      }
      html += '</span></dd>';
    }
    html += '<dt>整备区</dt><dd>' + (c.garrison ? '可计入（含整备区内的干员）' : '不可计入') + '</dd>';
    html += '</dl></div></div>';

    if (a.empower && a.empower.length) {
      html += '<div class="d-sec"><h3>强化条件（原文标签）</h3><div class="d-box"><p>' +
        a.empower.map(function (x) { return esc(x); }).join('<br>') + '</p></div></div>';
    }

    html += '<div class="d-sec"><h3>盟约描述</h3><div class="d-box"><p>' +
      Search.format(c.desc, toks) + '</p></div></div>';

    html += '<div class="d-sec"><h3>成员（' + c.memberCount + '）</h3>';
    if (c.members.length) {
      html += '<div class="d-members">';
      for (var m = 0; m < c.members.length; m++) {
        html += '<button type="button" data-op="' + esc(c.members[m]) + '">' + esc(c.members[m]) + '</button>';
      }
      html += '</div>';
      html += '<div style="margin-top:8px"><button type="button" class="btn" data-tag="' + esc(c.name) + '">' +
        '在干员图鉴中查看这 ' + c.memberCount + ' 名成员</button></div>';
    } else {
      html += '<div class="d-box"><p>' +
        (c.activation.kind === 'elite'
          ? '该盟约没有固定成员：所有干员的精锐状态均可参与激活，按精锐数量判定。'
          : '表中未列出成员。') + '</p></div>';
    }
    html += '</div>';

    html += actionBar();
    return html;
  }

  function firstLine(s) {
    var t = String(s || '').split('\n')[0];
    return t.length > 60 ? t.slice(0, 60) + '…' : t;
  }

  /* ======================================================================
     关于页
     ====================================================================== */
  function aboutHtml(st) {
    var c = data.counts;
    return '<article class="about">' +
      '<h2>卫戍协议小助手</h2>' +
      '<p>把《明日方舟》卫戍协议的数据表做成一个<b>打开即用、用完即走</b>的查询工具。' +
      '没有后端、没有登录、没有任何外部请求：整站就是一份静态文件，数据已经内嵌在页面里。</p>' +

      '<div class="stats">' +
      '<div class="stat"><b>' + c.operators + '</b><span>干员条目</span></div>' +
      '<div class="stat"><b>' + c.items + '</b><span>道具</span></div>' +
      '<div class="stat"><b>' + c.strategies + '</b><span>策略</span></div>' +
      '<div class="stat"><b>' + c.covenants + '</b><span>盟约</span></div>' +
      '<div class="stat"><b>' + c.fusions + '</b><span>合成配方</span></div>' +
      '<div class="stat"><b>' + c.stages + '</b><span>指令阶段</span></div>' +
      '<div class="stat"><b>' + c.buffs + '</b><span>补给增益</span></div>' +
      '</div>' +

      '<h3>怎么用</h3>' +
      '<ul>' +
      '<li><b>搜索</b>：空格分隔多个关键词，全部命中才显示；关键词会在卡片里高亮。</li>' +
      '<li><b>筛选</b>：阶数、盟约、触发时机、售价可多选；盟约支持「全部（AND）／任一（OR）」切换。</li>' +
      '<li><b>深链</b>：地址栏就是状态。点右上角分享按钮复制链接，发给别人打开即还原视图、筛选和详情。</li>' +
      '<li><b>键盘</b>：<code>/</code> 聚焦搜索框，<code>Esc</code> 关闭详情，<code>←</code> <code>→</code> 在结果间切换。</li>' +
      '<li><b>标题</b>：卡片上的色块是盟约标签，颜色由盟约名哈希固定，全站一致；点击标签直接筛该盟约。</li>' +
      '<li><b>头像</b>：顶栏的人像按钮可一键隐藏头像，隐藏后只用色块 + 首字；偏好会记住。</li>' +
      '</ul>' +

      '<h3>数据来源</h3>' +
      '<p>数据取自官方 Android 热更新解包（本期 V3_1），并经过构建期校验：表头守卫、行数断言、' +
      '枚举校验、引用完整性检查。页脚显示的数据版本即源表修改时间，可据此确认看到的是不是最新一版。</p>' +
      '<p>干员头像抓取自 <a href="https://prts.wiki" target="_blank" rel="noopener noreferrer">PRTS wiki</a>' +
      '（文件命名规则为「文件:头像_&lt;干员名&gt;.png」，180×180），游戏美术版权归鹰角网络所有，' +
      '此处仅作非商业的玩家查询用途；如果权利人提出异议，关闭头像显示或删除对应文件即可。</p>' +
      '<p>已知限制：自选配置条目没有盟约与触发时机；「绝技」没有固定成员，按精锐数量判定；' +
      '「盟约·辅助干员」与「“暴躁铁皮”」默认隐藏，可在筛选里打开。</p>' +

      '<h3>免责声明</h3>' +
      '<p>本站为非官方工具，与鹰角网络无关。干员名、数值与技能文本的著作权归原权利人所有，' +
      '此处仅作玩家社区的数据查询用途；如权利人提出异议，会立即下线相关内容。</p>' +

      '<h3>版本</h3>' +
      '<p>数据版本 <code>' + esc(data.version) + '</code>　构建时间 <code>' + esc(data.generatedAt) + '</code></p>' +
      '<p><button type="button" class="btn" data-copy="1">复制当前页面链接</button></p>' +
      '</article>';
  }

  /* ======================================================================
     页脚
     ====================================================================== */
  function renderFooter() {
    var c = data.counts;
    refs.footer.innerHTML = '<div class="footer-inner">' +
      '<span class="footer-meta">数据版本 ' + esc(data.version) + '</span>' +
      '<span class="dot-sep">·</span>' +
      '<span class="footer-meta">生成 ' + esc(data.generatedAt) + '</span>' +
      '<span class="dot-sep">·</span>' +
      '<span>干员 ' + c.operators + ' / 道具 ' + c.items + ' / 策略 ' + c.strategies + ' / 盟约 ' + c.covenants + '</span>' +
      '</div>' +
      '<div class="footer-inner" style="margin-top:4px">' +
      '<span>非官方工具，数据整理自玩家表格，与鹰角网络无关。</span>' +
      '<span class="dot-sep">·</span>' +
      '<a href="#/about">使用说明</a>' +
      '<span class="dot-sep">·</span>' +
      '<button type="button" class="linklike" data-copy="1">复制链接</button>' +
      '</div>';
  }

  /* ======================================================================
     对外
     ====================================================================== */
  global.UI = {
    init: init,
    render: render,
    hue: hue,
    getList: function () { return currentList; },
    refs: function () { return refs; }
  };
})(window);
