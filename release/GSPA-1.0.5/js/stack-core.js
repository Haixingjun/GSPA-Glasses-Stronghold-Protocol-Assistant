/* ==========================================================================
   stack-core.js — 叠层系统的 UI 无关内核
   --------------------------------------------------------------------------
   目标：把“层数账本 / 事件总线 / 规则文本 / 售出价”从 sandbox.js 里抽出来，
   让沙盒和配队界面都能复用；不依赖 DOM、不依赖 sandbox 的 state 形状。

   对外 API（window.StackCore）：
     createLedger({layers,temp,events,maxLayers,maxEvents,onChange})
     createEventBus()
     createMetrics(initial)
     ruleText(rule)
     sellPriceOf(name, {elite,bonus,cap})
     VERSION

   约定：
   - ledger.add() 只负责账本与事件，不做日志/渲染/校验；
   - 盟约是否存在、是否激活由调用方判断；
   - 事件对象字段与 sandbox 现有 stackEvents 兼容，并增加 kind/detail/tier/markerUid。
   ========================================================================== */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) || n < 0 ? 0 : n;
  }

  function copy(obj) {
    var out = {};
    Object.keys(obj || {}).forEach(function (k) { out[k] = obj[k]; });
    return out;
  }

  /**
   * 层数账本。layers/temp/events 尽量复用调用方已有对象，保证旧 UI 直接读 state.layers 仍生效。
   * @param {{layers?:Object,temp?:Object,events?:Array,maxLayers?:number,maxEvents?:number,onChange?:Function}} opts
   */
  function createLedger(opts) {
    opts = opts || {};
    var layers = opts.layers || {};
    var temp = opts.temp || {};
    var events = opts.events || [];
    var maxLayers = Number(opts.maxLayers) > 0 ? Math.floor(Number(opts.maxLayers)) : 999;
    var maxEvents = Number(opts.maxEvents) > 0 ? Math.floor(Number(opts.maxEvents)) : 600;
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

    function targetOf(isTemp) { return isTemp ? temp : layers; }

    function get(bond, isTemp) {
      return targetOf(!!isTemp)[bond] || 0;
    }

    /**
     * @returns {number} 实际生效层数（0 = 已封顶/非法）
     */
    function add(bond, n, source, options) {
      options = options || {};
      var k = Math.floor(num(n));
      if (!bond || k <= 0) return 0;
      var target = targetOf(!!options.temp);
      var before = target[bond] || 0;
      var applied = Math.min(k, maxLayers - before);
      if (applied <= 0) return 0;

      target[bond] = before + applied;
      var ev = {
        bond: bond,
        amount: applied,
        source: source || '',
        temp: !!options.temp,
        op: options.opName || '',
        target: options.targetName || '',
        cap: options.cap || null,
        capKey: options.capKey || '',
        kind: options.kind || 'rule',
        detail: options.detail || '',
        tier: options.tier == null ? null : options.tier,
        markerUid: options.markerUid == null ? null : options.markerUid,
        // 同一目标可能被多名阿戈尔同时吞噬：markerUids 记录全部吞噬者
        markerUids: Array.isArray(options.markerUids) ? options.markerUids.slice() : null
      };
      events.push(ev);
      if (events.length > maxEvents) events.shift();
      if (onChange) onChange(bond, applied, ev);
      return applied;
    }

    function set(bond, n, isTemp) {
      var target = targetOf(!!isTemp);
      target[bond] = Math.max(0, Math.min(maxLayers, Math.floor(num(n))));
      return target[bond];
    }

    function snapshot() {
      return { layers: copy(layers), temp: copy(temp) };
    }

    /** 就地恢复，保持 layers/temp 对象引用不变（旧 UI 直接持有 state.layers）。 */
    function restore(snap) {
      if (!snap) return;
      Object.keys(layers).forEach(function (k) { delete layers[k]; });
      Object.keys(temp).forEach(function (k) { delete temp[k]; });
      Object.keys(snap.layers || {}).forEach(function (k) { layers[k] = snap.layers[k]; });
      Object.keys(snap.temp || {}).forEach(function (k) { temp[k] = snap.temp[k]; });
    }

    function clearEvents() { events.length = 0; }

    return {
      layers: layers,
      temp: temp,
      events: events,
      maxLayers: maxLayers,
      add: add,
      get: get,
      set: set,
      snapshot: snapshot,
      restore: restore,
      clearEvents: clearEvents
    };
  }

  /** 轻量事件总线：按 priority 降序，再按注册顺序；handler 抛错不阻断其他 handler。 */
  function createEventBus() {
    var map = Object.create(null);
    var seq = 0;

    function on(name, fn, options) {
      if (typeof fn !== 'function') return null;
      options = options || {};
      var h = { name: name, fn: fn, priority: Number(options.priority) || 0, seq: ++seq, once: !!options.once, removed: false };
      (map[name] || (map[name] = [])).push(h);
      map[name].sort(function (a, b) { return b.priority - a.priority || a.seq - b.seq; });
      return h;
    }

    function off(name, fnOrHandle) {
      var list = map[name];
      if (!list) return;
      for (var i = list.length - 1; i >= 0; i--) {
        if (!fnOrHandle || list[i] === fnOrHandle || list[i].fn === fnOrHandle) {
          list[i].removed = true;
          list.splice(i, 1);
        }
      }
      if (!list.length) delete map[name];
    }

    function emit(name, payload) {
      var list = map[name];
      if (!list || !list.length) return payload;
      var snapshot = list.slice();
      for (var i = 0; i < snapshot.length; i++) {
        var h = snapshot[i];
        if (!h || h.removed) continue;
        try {
          h.fn(payload);
        } catch (e) {
          if (typeof console !== 'undefined' && console.error) console.error('[StackCore] handler failed:', name, e);
        }
        if (h.once) off(name, h);
      }
      return payload;
    }

    function has(name) { return !!(map[name] && map[name].length); }
    function clear() { map = Object.create(null); }

    return { on: on, off: off, emit: emit, has: has, clear: clear };
  }

  /** 计数源：状态/元素/装备/资金等，只计数，不建实体。 */
  function createMetrics(initial) {
    var values = copy(initial || {});
    function add(name, n) {
      if (!name) return 0;
      values[name] = Math.max(0, (values[name] || 0) + Math.floor(Number(n) || 0));
      return values[name];
    }
    function get(name) { return values[name] || 0; }
    function set(name, n) { values[name] = Math.max(0, Math.floor(Number(n) || 0)); return values[name]; }
    function reset(name) {
      if (name == null) { values = {}; return; }
      values[name] = 0;
    }
    function snapshot() { return copy(values); }
    return { add: add, get: get, set: set, reset: reset, snapshot: snapshot };
  }

  /** 规则文本：优先 rule.text；否则按 event/bonds/amount 拼一个最小可读句。 */
  function ruleText(rule) {
    if (!rule) return '';
    if (rule.text) return String(rule.text);
    var labels = {
      onGain: '获得时', onRefresh: '刷新时', onPrepStart: '进入休整期时',
      onPrepEnd: '休整期结束时', onBattleStart: '战斗开始时', onBattleEnd: '战斗结束时',
      onDeploy: '部署时', onSkill: '开启技能时', onKill: '击倒敌人时',
      onKnockdown: '我方被击倒时', onSubstitute: '替身切换时', onSell: '售出时',
      onCombat: '战斗中', onPassive: '被动', onMetric: '计数触发'
    };
    var bonds = Array.isArray(rule.bonds) ? rule.bonds.map(function (b) { return typeof b === 'string' ? b : (b && b.name) || ''; }).filter(Boolean)
      : rule.bonds === 'active' ? ['已激活盟约']
      : rule.bonds === 'activeCore' ? ['已激活核心盟约']
      : rule.bonds === 'highestActive' ? ['最高层已激活盟约']
      : [];
    var amt = rule.amount != null ? ' +' + rule.amount : '';
    return '<' + (labels[rule.event] || rule.event || '') + '>' +
      (bonds.length ? '【' + bonds.join('】【') + '】' : '') + amt;
  }

  /**
   * 售出价：默认 1；温蒂 3/6；bonus 由海沫等修正；cap 可选。
   * 当前赛季口径来自参考数据/本地文本；若后续换季，改这张表或传入 override。
   */
  var SELL_BASE = 1;
  var SELL_OVERRIDES = {
    '温蒂': { normal: 3, elite: 6 }
  };

  function sellPriceOf(name, opts) {
    opts = opts || {};
    var base = SELL_BASE;
    var ov = SELL_OVERRIDES[name];
    if (ov) {
      if (opts.elite && ov.elite != null) base = ov.elite;
      else if (ov.normal != null) base = ov.normal;
    }
    var bonus = Number(opts.bonus) || 0;
    var v = base + bonus;
    if (opts.cap != null && Number(opts.cap) > 0) v = Math.min(v, Number(opts.cap));
    return Math.max(0, v);
  }

  global.StackCore = {
    VERSION: VERSION,
    createLedger: createLedger,
    createEventBus: createEventBus,
    createMetrics: createMetrics,
    ruleText: ruleText,
    sellPriceOf: sellPriceOf
  };
})(window);
