/* ==========================================================================
   app.js — 启动、路由、事件绑定
   --------------------------------------------------------------------------
   依赖顺序：data/data.js → store.js → search.js → ui.js → app.js
   注意：全部使用 ES2017 及以下语法，避免 B站 / QQ / 微信内置 WebView 老内核
   不认识可选链、空值合并等新语法导致整站白屏。
   ========================================================================== */
(function (global) {
  'use strict';

  var Store = global.Store;
  var Search = global.Search;
  var UI = global.UI;

  var els = {};
  var debounceTimer = null;
  var THEME_KEY = 'gs-theme';
  var AVATAR_KEY = 'gs-avatars';

  /* ---------------- 启动 ---------------- */
  function boot() {
    els = {
      q: document.getElementById('q'),
      qclear: document.getElementById('qclear'),
      tabs: document.getElementById('tabs'),
      toolbar: document.getElementById('toolbar'),
      filters: document.getElementById('filters'),
      cards: document.getElementById('cards'),
      drawer: document.getElementById('drawer'),
      scrim: document.getElementById('scrim'),
      theme: document.getElementById('theme'),
      share: document.getElementById('share'),
      avatars: document.getElementById('avatars')
    };

    initTheme();

    var data = global.GARRISON_DATA;
    if (!data || !data.operators) {
      showFatal();
      return;
    }

    initAvatarPref();

    Store.init(data);
    Search.init(data);
    UI.init();

    Store.loadFromUrl();
    Store.validateSelection();

    Store.subscribe(function () {
      UI.render();
      refreshLayout();
    });

    UI.render();
    syncInputFromState();
    bindEvents();
    refreshLayout();
    if (Store.state.sel) {
      global.setTimeout(function () { scrollActiveIntoView('center'); }, 60);
    }
    document.body.setAttribute('data-ready', '1');
  }

  function scrollActiveIntoView(block) {
    var el = document.querySelector('.card.is-active');
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: block || 'nearest', behavior: 'auto' });
    }
  }

  function showFatal() {
    var box = document.getElementById('cards');
    var msg = document.createElement('div');
    msg.className = 'empty';
    msg.innerHTML = '<p class="empty-t">数据没有加载成功</p>' +
      '<p class="empty-d">页面缺少 <code>data/data.js</code>。' +
      '如果你在本地打开，请先运行 <code>python tools/build_web_data.py</code> 生成数据；' +
      '如果是部署版，请确认 data 目录随站点一起上传。</p>';
    box.appendChild(msg);
  }

  /* ---------------- 主题 ---------------- */
  function initTheme() {
    var t = 'dark';
    try {
      var saved = global.localStorage && global.localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') t = saved;
    } catch (e) { /* 隐私模式 / 第三方 iframe 里 localStorage 可能抛异常 */ }
    applyTheme(t);
  }

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#f2f5f9' : '#0b0f14');
  }

  function toggleTheme() {
    var now = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(now);
    try {
      if (global.localStorage) global.localStorage.setItem(THEME_KEY, now);
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 头像开关（纯展示偏好，不进 URL） ---------------- */
  function initAvatarPref() {
    var btn = els.avatars;
    if (global.GARRISON_NO_AVATARS || global.GARRISON_NO_ICONS) {
      document.body.classList.add('no-avatars');
      if (btn) btn.hidden = true;
      return;
    }
    var data = global.GARRISON_DATA || {};
    var groups = [data.operators || [], data.items || [], data.strategies || [], data.covenants || []];
    var hasAny = false;
    for (var g = 0; g < groups.length && !hasAny; g++) {
      for (var i = 0; i < groups[g].length; i++) {
        if (groups[g][i].avatar || groups[g][i].icon) { hasAny = true; break; }
      }
    }
    if (btn) btn.hidden = !hasAny;
    if (!hasAny) return;
    var on = true;
    try {
      var saved = global.localStorage && global.localStorage.getItem(AVATAR_KEY);
      if (saved === '0') on = false;
    } catch (e) { /* 隐私模式 */ }
    applyAvatars(on);
  }

  function applyAvatars(on) {
    document.body.classList.toggle('no-avatars', !on);
    var btn = els.avatars;
    if (btn) {
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = on ? '隐藏头像与图标' : '显示头像与图标';
    }
  }

  function toggleAvatars() {
    var show = document.body.classList.contains('no-avatars');
    applyAvatars(show);
    try {
      if (global.localStorage) global.localStorage.setItem(AVATAR_KEY, show ? '1' : '0');
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 事件 ---------------- */
  function bindEvents() {
    // 搜索
    els.q.addEventListener('input', function () {
      var v = els.q.value;
      els.qclear.hidden = !v;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        Store.set({ q: v, sel: null });
      }, 80);
    });
    els.q.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        clearSearch();
        els.q.blur();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(debounceTimer);
        Store.set({ q: els.q.value, sel: null });
        els.q.blur();
      }
    });

    els.qclear.addEventListener('click', function () {
      clearSearch();
      els.q.focus();
    });

    // 顶栏
    els.theme.addEventListener('click', toggleTheme);
    els.share.addEventListener('click', copyLink);
    if (els.avatars) els.avatars.addEventListener('click', toggleAvatars);
    document.addEventListener('error', onImgError, true);

    // 统一委托
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);

    window.addEventListener('hashchange', onUrlChange);
    window.addEventListener('popstate', onUrlChange);

    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(refreshLayout, 120);
    });

    var mq = global.matchMedia ? global.matchMedia('(max-width: 1023px)') : null;
    if (mq) {
      var onChange = function () { refreshLayout(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  function onImgError(e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' &&
        (t.classList.contains('avatar-img') || t.classList.contains('icon-img'))) {
      t.classList.add('is-broken');
      t.removeAttribute('src');
      var box = t.parentNode;
      if (box && (box.classList.contains('avatar') || box.classList.contains('icon'))) {
        box.classList.remove('has-img');
      }
    }
  }

  function onUrlChange() {
    if (Store.isWriting()) return;
    Store.syncFromUrl();
    syncInputFromState();
    closeOverlays(false);
  }

  function onKeydown(e) {
    var editable = isEditable(e.target);

    if (e.key === '/' && !editable) {
      e.preventDefault();
      els.q.focus();
      els.q.select();
      return;
    }

    if (e.key === 'Escape') {
      if (document.body.classList.contains('filters-open')) {
        e.preventDefault();
        toggleFilters(false);
        return;
      }
      if (Store.state.sel) {
        e.preventDefault();
        Store.set({ sel: null });
        return;
      }
      if (document.activeElement === els.q && els.q.value) {
        e.preventDefault();
        clearSearch();
        return;
      }
      return;
    }

    if (editable) return;

    // 卡片上的 Enter / 空格（焦点在卡片内的小按钮时交给按钮自己处理）
    var card = e.target && e.target.closest ? e.target.closest('.card') : null;
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {
      e.preventDefault();
      selectKey(card.getAttribute('data-sel'));
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (Store.state.view === 'about') return;
      e.preventDefault();
      stepSelection(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (Store.state.view === 'about') return;
      e.preventDefault();
      stepSelection(-1);
    }
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;

    // 1) 盟约标签（卡片内 / 详情内）
    var tag = t.closest('[data-tag]');
    if (tag) {
      e.preventDefault();
      var name = tag.getAttribute('data-tag');
      toggleFilters(false);
      Store.set({
        view: 'op', q: '', tiers: [], tags: [name], tagMode: 'and',
        triggers: [], prices: [], itypes: [], icats: [], otypes: [], ranks: [], families: [], kinds: [],
        hidden: false, sel: null
      }, { push: true });
      els.cards.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }

    // 2) 卡片
    var card = t.closest('[data-sel]');
    if (card && els.cards.contains(card)) {
      selectKey(card.getAttribute('data-sel'));
      return;
    }

    // 3) 详情内的交叉引用
    var cov = t.closest('[data-cov]');
    if (cov) {
      Store.set({ view: 'covenant', sel: cov.getAttribute('data-cov'), q: '', tiers: [], tags: [], triggers: [], prices: [], itypes: [], icats: [], otypes: [], ranks: [], families: [], kinds: [] }, { push: true });
      return;
    }
    var item = t.closest('[data-item]');
    if (item) {
      Store.set({ view: 'item', sel: item.getAttribute('data-item'), q: '' }, { push: true });
      return;
    }
    var op = t.closest('[data-op]');
    if (op) {
      var opName = op.getAttribute('data-op');
      Store.set({ view: 'op', sel: opName }, { push: true });
      return;
    }

    // 4) 面板控制
    var fid = t.closest('[data-fid]');
    if (fid) {
      toggleFacet(fid.getAttribute('data-fid'), fid.getAttribute('data-fval'));
      return;
    }
    var fclear = t.closest('[data-fclear]');
    if (fclear) {
      clearFacet(fclear.getAttribute('data-fclear'));
      return;
    }
    var tm = t.closest('[data-tm]');
    if (tm) {
      Store.set({ tagMode: tm.getAttribute('data-tm') });
      return;
    }
    if (t.closest('[data-reset]')) {
      clearTimeout(debounceTimer);
      Store.resetFilters();
      syncInputFromState();
      toggleFilters(false);
      return;
    }
    if (t.closest('[data-filters-toggle]')) {
      toggleFilters();
      return;
    }
    if (t.closest('[data-close-filters]')) {
      toggleFilters(false);
      return;
    }
    if (t.closest('[data-close]')) {
      Store.set({ sel: null });
      return;
    }
    if (t.closest('[data-copy]')) {
      copyLink();
      return;
    }
    var tab = t.closest('[data-view]');
    if (tab) {
      clearTimeout(debounceTimer);
      closeOverlays(false);
      Store.switchView(tab.getAttribute('data-view'), { push: true });
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }

    // 5) 遮罩
    if (t === els.scrim) {
      if (document.body.classList.contains('filters-open')) toggleFilters(false);
      else if (Store.state.sel) Store.set({ sel: null });
    }
  }

  // 排序下拉（change 事件）
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'sort') {
      Store.set({ sort: e.target.value });
    }
  });

  /* ---------------- 交互实现 ---------------- */
  function clearSearch() {
    clearTimeout(debounceTimer);
    els.q.value = '';
    els.qclear.hidden = true;
    Store.set({ q: '', sel: null });
  }

  function syncInputFromState() {
    if (document.activeElement === els.q) return;
    var q = Store.state.q || '';
    if (els.q.value !== q) els.q.value = q;
    els.qclear.hidden = !q;
  }

  function toggleFacet(fid, raw) {
    var st = Store.state;
    var patch = {};
    if (fid === 'hidden') {
      patch.hidden = !st.hidden;
    } else if (fid === 'tiers' || fid === 'prices') {
      var n = parseInt(raw, 10);
      if (isNaN(n)) return;
      patch[fid] = toggleIn(st[fid], n);
    } else {
      patch[fid] = toggleIn(st[fid], raw);
    }
    Store.set(patch);
    if (window.innerWidth < 640) {
      // 抽屉里的计数会跟着更新，保持在抽屉内
    }
  }

  function toggleIn(arr, v) {
    var out = [];
    for (var i = 0; i < arr.length; i++) if (arr[i] !== v) out.push(arr[i]);
    if (out.length === arr.length) out.push(v);
    return out;
  }

  function clearFacet(fid) {
    var patch = {};
    if (fid === 'q') patch.q = '';
    else if (fid === 'hidden') patch.hidden = false;
    else patch[fid] = [];
    Store.set(patch);
    if (fid === 'q') syncInputFromState();
  }

  function selectKey(key) {
    if (!key) return;
    Store.set({ sel: key }, { push: true });
    if (window.innerWidth < 1024) {
      // 移动端：让详情露出
      global.setTimeout(function () {
        if (els.drawer && !els.drawer.hidden) els.drawer.scrollTop = 0;
      }, 0);
    }
  }

  function stepSelection(delta) {
    var list = UI.getList();
    if (!list || !list.length) return;
    var keyOf = function (e) {
      return Store.state.view === 'strategy' ? e.key : e.name;
    };
    var cur = Store.state.sel;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (keyOf(list[i]) === cur) { idx = i; break; }
    }
    var next = idx < 0 ? (delta > 0 ? 0 : list.length - 1) : idx + delta;
    if (next < 0) next = 0;
    if (next >= list.length) next = list.length - 1;
    Store.set({ sel: keyOf(list[next]) });

    var active = document.querySelector('.card.is-active');
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function toggleFilters(force) {
    var on = (typeof force === 'boolean') ? force : !document.body.classList.contains('filters-open');
    document.body.classList.toggle('filters-open', on);
    if (on) {
      document.body.classList.remove('detail-open');
      els.filters.scrollTop = 0;
    }
    syncScrim();
  }

  function closeOverlays(closeDetail) {
    document.body.classList.remove('filters-open');
    if (closeDetail) {
      document.body.classList.remove('detail-open');
      if (Store.state.sel) Store.set({ sel: null });
    } else if (!Store.state.sel) {
      document.body.classList.remove('detail-open');
    }
    syncScrim();
  }

  function syncScrim() {
    var on = document.body.classList.contains('filters-open') ||
      document.body.classList.contains('detail-open');
    els.scrim.hidden = !on;
  }

  function refreshLayout() {
    var w = window.innerWidth;
    if (w >= 640) document.body.classList.remove('filters-open');

    var hasSel = !!Store.state.sel && Store.state.view !== 'about';
    var hasEntity = hasSel && !!Store.entity(Store.state.view, Store.state.sel);
    document.body.classList.toggle('has-detail', hasEntity);
    if (w >= 1024) {
      document.body.classList.remove('detail-open');
    } else {
      document.body.classList.toggle('detail-open', hasEntity);
    }
    syncScrim();
  }

  /* ---------------- 复制链接 ---------------- */
  function copyLink() {
    var url = global.location.href;
    var ok = function () { toast('链接已复制'); };
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(url).then(ok, function () { legacyCopy(url); });
    } else {
      legacyCopy(url);
    }
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    toast(ok ? '链接已复制' : '复制失败，请手动复制地址栏');
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    // 强制重排后再加 class，保证动画每次都触发
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1700);
  }

  function isEditable(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
  }

  /* ---------------- 入口 ---------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
