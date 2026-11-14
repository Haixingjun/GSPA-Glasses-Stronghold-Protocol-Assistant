/* ==========================================================================
   store.js — 状态 + URL hash 双向同步
   --------------------------------------------------------------------------
   设计要点
   · 所有状态可序列化，URL 即状态：复制地址栏即可还原视图 / 搜索 / 筛选 / 详情。
   · 只依赖 location.hash，不依赖 history API 的服务端回退，所以：
       - file:// 双击可开
       - 部署在任意子目录（/gspa/、B站 Toy 静态包）都能用
       - 不需要 nginx try_files 重写
   · history.replaceState 在 file:// (origin null) 会抛 SecurityError，
     这里统一 try/catch 回退到 location.hash，保证双击打开也能分享。
   ========================================================================== */
(function (global) {
  'use strict';

  var VIEWS = ['op', 'item', 'strategy', 'covenant', 'team', 'about'];

  // URL 里的短名（#/cov/炎 与 #/covenant/炎 都认，输出用 cov）
  var PATH_OF = { op: 'op', item: 'item', strategy: 'strategy', covenant: 'cov', team: 'team', about: 'about' };
  var VIEW_OF_PATH = {
    op: 'op', item: 'item', strategy: 'strategy',
    cov: 'covenant', covenant: 'covenant', team: 'team', about: 'about'
  };

  var TEAM_SIZE = 8;
  var TEAM_MAX = 9;
  var ITEMS_MAX = 2;

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
    sort: 'default',
    hidden: false,
    sel: null,
    team: { size: TEAM_SIZE, slots: [], layers: {} }
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
      if (n !== null && n >= 0 && n <= 6 && out.indexOf(n) < 0) out.push(n);
    }
    return out;
  }

  function encodeList(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push(encodeURIComponent(String(arr[i])));
    return out.join(',');
  }

  /* 自选干员的查询投影：和普通干员放进同一个 op 列表，
     用 tier=0 / tierLabel=自选 作为与阶数并列的标签。 */
  function pickOps(picks) {
    var out = [];
    for (var i = 0; i < (picks || []).length; i++) {
      var p = picks[i];
      out.push({
        key: p.name, name: p.name, tier: 0, tierLabel: '自选',
        tags: p.tags || [], type: '自选干员', hidden: false, price: 4,
        normalText: '无特质（自选干员）', eliteText: '无特质（自选干员）',
        normalTrigger: '—', eliteTrigger: '—',
        normalTriggers: [], eliteTriggers: [],
        avatar: p.avatar, avatarFull: p.avatarFull,
        pick: true, rarity: 6, star: '6★',
        class: p.class, branch: p.branch, nation: p.nation,
        factions: p.factions || [], hiddenFactions: p.hiddenFactions || [],
        tagsSource: p.tagsSource, charId: p.charId, prts: p.prts, note: p.note
      });
    }
    return out;
  }

  function allOps(payload) {
    return (payload.operators || []).concat(pickOps(payload.picks || []));
  }

  /* ---------------- 初始化 ---------------- */
  function init(payload) {
    data = payload;
    data._allOps = allOps(payload);
    maps.op = indexBy(data._allOps, function (o) { return o.name; });
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
    if (view === 'op') return data._allOps || data.operators;
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
    var rawT = null, rawBs = null, rawL = null, rawE = null, rawIt = null, rawM = null, rawC = null, rawP = null;
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
        case 'sort': next.sort = val || 'default'; break;
        case 'hidden': next.hidden = oflag(val); break;
        case 't': rawT = val; break;
        case 'bs': rawBs = val; break;
        case 'L': rawL = val; break;
        case 'e': rawE = val; break;
        case 'it': rawIt = val; break;
        case 'm': rawM = val; break;
        case 'p': rawP = val; break;
        case 'c': rawC = val; break;
        default: break;
      }
    }

    // 配队：先定席位数，再按位解析（空位用空串占位，保持位置）
    var size = clampSize(toInt(rawBs));
    var slots = parseSlots(rawT, size);
    applyElites(rawE, slots);
    applyItems(rawIt, slots);
    applyMorph(rawM, slots);
    applyPicks(rawP, slots);
    next.team = {
      size: Math.max(size, slots.length),
      slots: slots,
      layers: parseLayers(rawL)
    };

    // ?c=GSPA2.xxx：分享链接直接带整队，优先级最高
    if (rawC && global.Code && data) {
      var dec = global.Code.decode(safeDecode(rawC), data);
      if (dec && dec.team) next.team = dec.team;
    }
    next.team = normalizeTeam(next.team);
    return next;
  }

  function clampSize(n) {
    if (n === null || n === undefined) return TEAM_SIZE;
    if (n < 1) return 1;
    if (n > TEAM_MAX) return TEAM_MAX;
    return n;
  }

  function parseSlots(value, size) {
    var out = [];
    if (value) {
      var parts = String(value).split(',');
      for (var i = 0; i < parts.length && i < TEAM_MAX; i++) {
        var raw = parts[i];
        if (!raw) { out.push(null); continue; }
        var elite = false;
        if (raw.charAt(raw.length - 1) === '*') { elite = true; raw = raw.slice(0, -1); }
        var name = safeDecode(raw);
        out.push(name ? { k: name, e: elite } : null);
      }
    }
    var n = Math.min(TEAM_MAX, Math.max(size || TEAM_SIZE, out.length));
    while (out.length < n) out.push(null);
    return out.slice(0, n);
  }

  function parseLayers(value) {
    var out = {};
    if (!value) return out;
    var parts = String(value).split(',');
    for (var i = 0; i < parts.length; i++) {
      var raw = parts[i];
      if (!raw) continue;
      var idx = raw.lastIndexOf(':');
      if (idx <= 0) continue;
      var name = safeDecode(raw.slice(0, idx));
      var n = toInt(raw.slice(idx + 1));
      if (name && n !== null && n > 0) out[name] = n;
    }
    return out;
  }

  function encodeSlots(slots) {
    var out = [];
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      out.push(s && s.k ? encodeURIComponent(String(s.k)) : '');
    }
    // 末尾空位可以省掉；解析时按 bs 补齐
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join(',');
  }

  function applyElites(value, slots) {
    if (!value) return;
    var parts = String(value).split(',');
    for (var i = 0; i < parts.length; i++) {
      var idx = toInt(parts[i]);
      if (idx !== null && idx >= 0 && idx < slots.length && slots[idx]) slots[idx].e = true;
    }
  }

  /** 席位当前可携带的装备件数：特殊干员由 Calc 统一判定（“暴躁铁皮”4 / 精锐 6） */
  function itemCapOfSlot(s) {
    if (!s || !s.k) return ITEMS_MAX;
    if (global.Calc && typeof global.Calc.itemCapacity === 'function') {
      return global.Calc.itemCapacity(s.k, !!s.e);
    }
    return ITEMS_MAX;
  }

  function applyItems(value, slots) {
    if (!value) return;
    var parts = String(value).split(',');
    for (var i = 0; i < parts.length; i++) {
      var raw = parts[i];
      if (!raw) continue;
      var at = raw.indexOf(':');
      if (at <= 0) continue;
      var idx = toInt(raw.slice(0, at));
      if (idx === null || idx < 0 || idx >= slots.length || !slots[idx]) continue;
      var names = raw.slice(at + 1).split('+');
      var out = [];
      // 按该干员的实际槽位收集；“暴躁铁皮”普通 4 / 精锐 6，
      // 这样它的第 3 件及以后不会在 URL 往返时被丢掉。
      var cap = itemCapOfSlot(slots[idx]);
      for (var j = 0; j < names.length && out.length < cap; j++) {
        var seg = names[j];
        var elite = false;
        if (seg.charAt(seg.length - 1) === '*') { elite = true; seg = seg.slice(0, -1); }
        var n = safeDecode(seg);
        if (!n) continue;
        var dup = false;
        for (var k = 0; k < out.length; k++) if (out[k].k === n) dup = true;
        if (!dup) out.push({ k: n, e: elite });
      }
      if (out.length) slots[idx].it = out;
    }
  }

  function applyMorph(value, slots) {
    if (!value) return;
    var parts = String(value).split(',');
    for (var i = 0; i < parts.length; i++) {
      var raw = parts[i];
      if (!raw) continue;
      var at = raw.indexOf(':');
      if (at <= 0) continue;
      var idx = toInt(raw.slice(0, at));
      var cov = safeDecode(raw.slice(at + 1));
      if (idx !== null && idx >= 0 && idx < slots.length && slots[idx] && cov) slots[idx].m = cov;
    }
  }

  /* 自选干员：p= 与 t= 平行，按席位、空段占位；p-only 席位不依赖占位行 */
  function applyPicks(value, slots) {
    if (!value) return;
    var parts = String(value).split(',');
    for (var i = 0; i < parts.length && i < slots.length; i++) {
      var raw = parts[i];
      if (!raw) continue;
      var name = safeDecode(raw);
      if (!name) continue;
      if (!slots[i]) slots[i] = { e: false };
      slots[i].p = name;
    }
  }

  function encodePicks(slots) {
    var out = [];
    var any = false;
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      if (s && s.p) { out.push(encodeURIComponent(String(s.p))); any = true; }
      else out.push('');
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return any ? out.join(',') : '';
  }

  function encodeElites(slots) {
    var out = [];
    for (var i = 0; i < slots.length; i++) {
      if (slots[i] && slots[i].e) out.push(i);
    }
    return out.join(',');
  }

  function encodeItems(slots) {
    var out = [];
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      if (!s || !s.it || !s.it.length) continue;
      var names = [];
      var cap = itemCapOfSlot(s);
      for (var j = 0; j < s.it.length && j < cap; j++) {
        var it = normItem(s.it[j]);
        if (!it) continue;
        names.push(encodeURIComponent(it.k) + (it.e ? '*' : ''));
      }
      if (names.length) out.push(i + ':' + names.join('+'));
    }
    return out.join(',');
  }

  function encodeMorph(slots) {
    var out = [];
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      if (s && s.m) out.push(i + ':' + encodeURIComponent(s.m));
    }
    return out.join(',');
  }  function encodeLayers(layers) {
    var out = [];
    for (var k in layers) {
      if (!layers.hasOwnProperty(k)) continue;
      var n = toInt(layers[k]);
      if (n !== null && n > 0) out.push(encodeURIComponent(k) + ':' + n);
    }
    return out.join(',');
  }

  function hasSlots(slots) {
    for (var i = 0; i < slots.length; i++) {
      if (slots[i] && (slots[i].k || slots[i].p)) return true;
    }
    return false;
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
    if (s.sort !== 'default') qs.push('sort=' + encodeURIComponent(s.sort));
    if (s.hidden) qs.push('hidden=1');

    // 配队状态在所有视图里都带上，切视图 / 刷新 / 分享都不会丢队
    if (s.team) {
      if (hasSlots(s.team.slots)) qs.push('t=' + encodeSlots(s.team.slots));
      if (s.team.size === TEAM_MAX) qs.push('bs=' + TEAM_MAX);
      var el = encodeElites(s.team.slots);
      if (el) qs.push('e=' + el);
      var its = encodeItems(s.team.slots);
      if (its) qs.push('it=' + its);
      var mo = encodeMorph(s.team.slots);
      if (mo) qs.push('m=' + mo);
      var pk = encodePicks(s.team.slots);
      if (pk) qs.push('p=' + pk);
      var ly = encodeLayers(s.team.layers || {});
      if (ly) qs.push('L=' + ly);
    }

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
    next.team = clone(state.team);
    return commit(next, opts);
  }

  function resetFilters() {
    var next = clone(DEFAULTS);
    next.view = state.view;
    next.q = '';
    next.team = clone(state.team);
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
    if (s.hidden) n++;
    return n;
  }

  /* ---------------- 队伍 ---------------- */
  /**
   * 深拷贝一个席位。
   * 注意：getTeam() 必须返回深拷贝 —— 曾经直接返回 state 里的对象引用，
   * 于是「切精锐 / 改层数」先改了 state 再提交，commit 判定「没变化」就不通知，
   * 界面不重渲染，看起来就像精锐无效。
   */
  function normItem(v) {
    if (!v) return null;
    if (typeof v === 'string') return { k: v, e: false };
    if (v.k) return { k: String(v.k), e: !!v.e };
    return null;
  }

  function cloneSlot(s) {
    if (!s || (!s.k && !s.p)) return null;
    var out = { e: !!s.e };
    if (s.k) out.k = String(s.k);
    if (s.p) out.p = String(s.p);
    if (s.it && s.it.length) {
      out.it = [];
      var cap = itemCapOfSlot(s);
      for (var i = 0; i < s.it.length && out.it.length < cap; i++) {
        var it = normItem(s.it[i]);
        if (!it) continue;
        var dup = false;
        for (var j = 0; j < out.it.length; j++) if (out.it[j].k === it.k) dup = true;
        if (!dup) out.it.push(it);
      }
    }
    if (s.m) out.m = String(s.m);
    return out;
  }

  function cloneLayers(src) {
    var out = {};
    src = src || {};
    for (var k in src) {
      if (!src.hasOwnProperty(k)) continue;
      var n = toInt(src[k]);
      if (n !== null && n > 0) out[k] = n;
    }
    return out;
  }

  function getTeam() {
    var t = state.team || DEFAULTS.team;
    var size = clampSize(t.size);
    var slots = [];
    for (var i = 0; i < size; i++) slots.push(cloneSlot(t.slots[i]));
    return { size: size, slots: slots, layers: cloneLayers(t.layers) };
  }

  function normalizeTeam(team) {
    var size = clampSize(team && team.size);
    var slots = [];
    var pickSeen = 0;
    for (var i = 0; i < size; i++) {
      var s = cloneSlot(team && team.slots ? team.slots[i] : null);
      // 自选干员全队最多 2 名：URL / 导入 / 旧数据都在这里截断
      if (s && s.p) {
        if (pickSeen >= 2) { slots.push(null); continue; }
        pickSeen++;
      }
      slots.push(s);
    }
    return { size: size, slots: slots, layers: cloneLayers(team && team.layers) };
  }

  function setTeam(team, opts) {
    return set({ team: normalizeTeam(team) }, opts);
  }

  global.Store = {
    VIEWS: VIEWS,
    DEFAULTS: DEFAULTS,
    TEAM_SIZE: TEAM_SIZE,
    TEAM_MAX: TEAM_MAX,
    ITEMS_MAX: ITEMS_MAX,
    init: init,
    getData: getData,
    entity: entity,
    listOf: listOf,
    covenantByName: covenantByName,
    getTeam: getTeam,
    setTeam: setTeam,
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
