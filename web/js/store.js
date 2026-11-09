/* ==========================================================================
   store.js — 状态 + URL hash 双向同步
   --------------------------------------------------------------------------
   设计要点
   · 所有状态可序列化，URL 即状态：复制地址栏即可还原视图 / 搜索 / 筛选 / 详情。
   · 只依赖 location.hash，不依赖 history API 的服务端回退，所以：
       - file:// 双击可开
       - 部署在任意子目录（/garrison/、B站 Toy 静态包）都能用
       - 不需要 nginx try_files 重写
   · history.replaceState 在 file:// (origin null) 会抛 SecurityError，
     这里统一 try/catch 回退到 location.hash，保证双击打开也能分享。
   ========================================================================== */
(function (global) {
  'use strict';

  var VIEWS = ['op', 'item', 'strategy', 'covenant', 'about'];

  // URL 里的短名（#/cov/炎 与 #/covenant/炎 都认，输出用 cov）
  var PATH_OF = { op: 'op', item: 'item', strategy: 'strategy', covenant: 'cov', about: 'about' };
  var VIEW_OF_PATH = {
    op: 'op', item: 'item', strategy: 'strategy',
    cov: 'covenant', covenant: 'covenant', about: 'about'
  };

  var DEFAULTS = {
    view: 'op',
    q: '',
    tiers: [],
    tags: [],
    tagMode: 'and',      // 'and' | 'or'
    triggers: [],
    prices: [],
    itypes: [],
    icats: [],
    otypes: [],
    ranks: [],
    families: [],
    funcs: [],
    kinds: [],
    sort: 'default',
    hidden: false,
    sel: null
  };

  var state = clone(DEFAULTS);
  var listeners = [];
  var data = null;
  var maps = { op: null, item: null, strategy: null, covenant: null };
  var writing = false;

  /* ---------------- 工具 ---------------- */
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function eq(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function toInt(s) {
    var n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  }

  function uniq(arr) {
    var out = [], seen = {};
    for (var i = 0; i < arr.length; i++) {
      var k = String(arr[i]);
      if (!seen[k]) { seen[k] = 1; out.push(arr[i]); }
    }
    return out;
  }

  function splitList(value) {
    if (!value) return [];
    var parts = String(value).split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = safeDecode(parts[i]);
      if (p) out.push(p);
    }
    return uniq(out);
  }

  var ROMAN_TIER = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };

  function parseTiers(value) {
    var out = [];
    var list = splitList(value);
    for (var i = 0; i < list.length; i++) {
      var n = toInt(list[i]);
      if (n === null) n = ROMAN_TIER[String(list[i]).toUpperCase()] || null;
      if (n !== null && n >= 1 && n <= 6 && out.indexOf(n) < 0) out.push(n);
    }
    return out;
  }

  function encodeList(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push(encodeURIComponent(String(arr[i])));
    return out.join(',');
  }

  /* ---------------- 初始化 ---------------- */
  function init(payload) {
    data = payload;
    maps.op = indexBy(payload.operators, function (o) { return o.name; });
    maps.item = indexBy(payload.items, function (o) { return o.name; });
    maps.strategy = indexBy(payload.strategies, function (o) { return o.key; });
    maps.covenant = indexBy(payload.covenants, function (o) { return o.name; });
    var byId = indexBy(payload.covenants, function (o) { return o.id; });
    for (var id in byId) {
      if (byId.hasOwnProperty(id) && !maps.covenant[id]) maps.covenant[id] = byId[id];
    }
    return data;
  }

  function indexBy(list, keyFn) {
    var m = {};
    for (var i = 0; i < list.length; i++) m[keyFn(list[i])] = list[i];
    return m;
  }

  function getData() { return data; }

  function entity(view, key) {
    if (!key) return null;
    var m = maps[view];
    return (m && m[key]) || null;
  }

  function listOf(view) {
    if (!data) return [];
    if (view === 'op') return data.operators;
    if (view === 'item') return data.items;
    if (view === 'strategy') return data.strategies;
    if (view === 'covenant') return data.covenants;
    return [];
  }

  function covenantByName(name) {
    return (maps.covenant && maps.covenant[name]) || null;
  }

  /* ---------------- URL 解析 ---------------- */
  function parseHash(hash) {
    var next = clone(DEFAULTS);
    var raw = String(hash || '').replace(/^#/, '');
    if (!raw) return next;

    var qi = raw.indexOf('?');
    var path = qi < 0 ? raw : raw.slice(0, qi);
    var query = qi < 0 ? '' : raw.slice(qi + 1);

    var segs = path.split('/');
    var parts = [];
    for (var i = 0; i < segs.length; i++) {
      if (segs[i]) parts.push(safeDecode(segs[i]));
    }
    var view = parts[0] || 'op';
    view = VIEW_OF_PATH[view] || 'op';
    next.view = view;
    if (parts[1]) next.sel = parts[1];

    if (!query) return next;
    var pairs = query.split('&');
    for (var p = 0; p < pairs.length; p++) {
      if (!pairs[p]) continue;
      var idx = pairs[p].indexOf('=');
      var key = idx < 0 ? pairs[p] : pairs[p].slice(0, idx);
      var val = idx < 0 ? '' : pairs[p].slice(idx + 1);
      switch (key) {
        case 'q': next.q = safeDecode(val.replace(/\+/g, ' ')); break;
        case 'tier': next.tiers = parseTiers(val); break;
        case 'tag': next.tags = splitList(val); break;
        case 'tm': next.tagMode = val === 'or' ? 'or' : 'and'; break;
        case 'trg': next.triggers = splitList(val); break;
        case 'price': next.prices = onlyNums(splitList(val)); break;
        case 'itype': next.itypes = splitList(val); break;
        case 'icat': next.icats = splitList(val); break;
        case 'otype': next.otypes = splitList(val); break;
        case 'rank': next.ranks = splitList(val); break;
        case 'fam': next.families = splitList(val); break;
        case 'fn': next.funcs = splitList(val); break;
        case 'kind': next.kinds = splitList(val); break;
        case 'sort': next.sort = val || 'default'; break;
        case 'hidden': next.hidden = oflag(val); break;
        default: break;
      }
    }
    return next;
  }

  function onlyNums(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var n = toInt(list[i]);
      if (n !== null && out.indexOf(n) < 0) out.push(n);
    }
    return out;
  }

  function oflag(v) {
    return v === '1' || v === 'true' || v === 'yes';
  }

  /* ---------------- URL 生成 ---------------- */
  function buildUrl(s) {
    var path = '/' + (PATH_OF[s.view] || s.view);
    if (s.sel) path += '/' + encodeURIComponent(s.sel);

    var qs = [];
    if (s.q) qs.push('q=' + encodeURIComponent(s.q));
    if (s.tiers && s.tiers.length) qs.push('tier=' + encodeList(s.tiers));
    if (s.tags && s.tags.length) qs.push('tag=' + encodeList(s.tags));
    if (s.tags && s.tags.length && s.tagMode === 'or') qs.push('tm=or');
    if (s.triggers && s.triggers.length) qs.push('trg=' + encodeList(s.triggers));
    if (s.prices && s.prices.length) qs.push('price=' + encodeList(s.prices));
    if (s.itypes && s.itypes.length) qs.push('itype=' + encodeList(s.itypes));
    if (s.icats && s.icats.length) qs.push('icat=' + encodeList(s.icats));
    if (s.otypes && s.otypes.length) qs.push('otype=' + encodeList(s.otypes));
    if (s.ranks && s.ranks.length) qs.push('rank=' + encodeList(s.ranks));
    if (s.families && s.families.length) qs.push('fam=' + encodeList(s.families));
    if (s.funcs && s.funcs.length) qs.push('fn=' + encodeList(s.funcs));
    if (s.kinds && s.kinds.length) qs.push('kind=' + encodeList(s.kinds));
    if (s.sort !== 'default') qs.push('sort=' + encodeURIComponent(s.sort));
    if (s.hidden) qs.push('hidden=1');

    return '#' + path + (qs.length ? '?' + qs.join('&') : '');
  }

  function currentHash() {
    return global.location.hash || '';
  }

  function writeUrl(hash, push) {
    if (hash === currentHash()) return;
    writing = true;
    try {
      if (push && global.history && global.history.pushState) {
        global.history.pushState(null, '', hash);
      } else if (global.history && global.history.replaceState) {
        global.history.replaceState(null, '', hash);
      } else {
        global.location.hash = hash.slice(1);
      }
    } catch (e) {
      // file:// 等 origin 为 null 的环境
      try { global.location.hash = hash.slice(1); } catch (e2) { /* 忽略 */ }
    }
    // 让 hashchange 处理时知道这是自己写的，避免重复渲染
    global.setTimeout(function () { writing = false; }, 0);
  }

  /* ---------------- 订阅与提交 ---------------- */
  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) {
        if (global.console && console.error) console.error(e);
      }
    }
  }

  function commit(next, opts) {
    opts = opts || {};
    var changed = !eq(state, next);
    state = next;
    writeUrl(buildUrl(next), !!opts.push);
    if (changed) notify();
    return changed;
  }

  function set(patch, opts) {
    var next = clone(state);
    for (var k in patch) {
      if (patch.hasOwnProperty(k)) next[k] = patch[k];
    }
    return commit(next, opts);
  }

  /** 切换一级视图：保留关键词，清掉只属于上一个视图的筛选 */
  function switchView(view, opts) {
    if (VIEWS.indexOf(view) < 0) return false;

    // 再点一次当前 tab：不清筛选，只关掉详情
    if (view === state.view) {
      if (!state.sel) return false;
      return set({ sel: null }, opts);
    }

    var next = clone(DEFAULTS);
    next.view = view;
    next.q = state.q;
    return commit(next, opts);
  }

  function resetFilters() {
    var next = clone(DEFAULTS);
    next.view = state.view;
    next.q = '';
    return commit(next, { push: false });
  }

  /** 从地址栏同步（浏览器前进/后退、手动改 hash） */
  function syncFromUrl() {
    var next = parseHash(currentHash());
    if (eq(next, state)) return false;
    state = next;
    notify();
    return true;
  }

  function loadFromUrl() {
    state = parseHash(currentHash());
    return state;
  }

  /** 当前选中项是否仍然有效（切换视图或改名后自动丢弃） */
  function validateSelection() {
    if (!state.sel) return false;
    if (!entity(state.view, state.sel)) {
      var next = clone(state);
      next.sel = null;
      state = next;
      writeUrl(buildUrl(state), false);
      notify();
      return true;
    }
    return false;
  }

  function activeFilterCount(s) {
    s = s || state;
    var n = 0;
    if (s.q) n++;
    if (s.tiers.length) n++;
    if (s.tags.length) n++;
    if (s.triggers.length) n++;
    if (s.prices.length) n++;
    if (s.itypes.length) n++;
    if (s.icats.length) n++;
    if (s.otypes.length) n++;
    if (s.ranks.length) n++;
    if (s.families.length) n++;
    if (s.funcs.length) n++;
    if (s.kinds.length) n++;
    if (s.hidden) n++;
    return n;
  }

  global.Store = {
    VIEWS: VIEWS,
    DEFAULTS: DEFAULTS,
    init: init,
    getData: getData,
    entity: entity,
    listOf: listOf,
    covenantByName: covenantByName,
    parseHash: parseHash,
    buildUrl: buildUrl,
    subscribe: subscribe,
    set: set,
    switchView: switchView,
    resetFilters: resetFilters,
    loadFromUrl: loadFromUrl,
    syncFromUrl: syncFromUrl,
    validateSelection: validateSelection,
    activeFilterCount: activeFilterCount,
    equals: eq,
    isWriting: function () { return writing; },
    get state() { return state; }
  };
})(window);
