/* ==========================================================================
   calc.js — 配队的盟约判定内核（纯函数，不碰 DOM）
   --------------------------------------------------------------------------
   口径来源：盟约表 desc 与「激活/强化」两列，逐条核对后的结论：

   · count        主盟约 3 人激活 / 6 人强化；副盟约 2 人激活 / 3 人强化。
   · count_layer  先按人数激活（2 人，投资人 3 人），再按层数点亮节点；
                  层数由用户手填，不参与激活门槛。
   · elite        绝技：场上精锐状态干员数 ≥2 激活 / ≥5 强化，与盟约标签无关。
   · special      独行：恰好 1 名时生效，≥2 名时「失效」（conflict）；
                  调和：≥1 名激活，随后给**每个主盟约**的激活人数 +1；
                  协防干员：按表内人数列 2 人。

   装备：
   · 大多数干员最多 2 件装备；特殊干员按 EQUIP_SLOT_OVERRIDES 放宽（“暴躁铁皮”4 件，
     精锐 6 件）。配队只影响「变形同构体」这一类改变盟约归属的效果；其它装备只做展示
     （数值加成不进盟约计数），沙盒同样只结算转职与效果描述。
   · 变形同构体：携带者获得「另一件携带装备」所属的盟约；另一件装备的盟约
     未收录时用 slot.m（手动指定）兜底。已有该盟约则不重复计数。

   层数数值：data 里的 valueText 来自 PRTS 本期盟约页，形如 (23+0.9×层数)，
   由 substLayers() 按当前层数代入算成具体值。

   全部使用 ES5/ES2017 语法，避免老 WebView 白屏。
   ========================================================================== */
(function (global) {
  'use strict';

  var RULES = {
    size: 8,           // 默认场上席位
    maxSize: 9,        // 人事部文档后可到 9
    itemsMax: 2,       // 每名干员最多携带装备数
    nearGap: 3,        // 缺 1–3 人算「待激活」
    harmonyBonus: 1,   // 调和给核心盟约的人数加成
    pickLimit: 2       // 自选干员最多 2 名
  };

  var MORPH_ITEM = '变形同构体';

  /**
   * 特殊干员的装备槽位。
   * “暴躁铁皮”（PRTS 天赋【酋长之威】）在卫戍协议中可穿戴 4 件装备，
   * 精锐状态额外 +2 件（共 6 件）。名字同时收录带引号与不带引号的写法，
   * 避免不同数据源/旧存档的引号差异导致槽位回退成 2。
   */
  var EQUIP_SLOT_OVERRIDES = {
    '“暴躁铁皮”': { normal: 4, elite: 6 },
    '暴躁铁皮': { normal: 4, elite: 6 }
  };

  /** 某名干员当前可携带的装备件数；未知干员按通用上限 2 件。 */
  function itemCapacity(name, elite) {
    var rule = EQUIP_SLOT_OVERRIDES[name];
    if (!rule) return RULES.itemsMax;
    return elite ? rule.elite : rule.normal;
  }

  /**
   * 仍然只有 special 文本、但已有明确“每回合/每场至多 N 层”的叠层上限。
   * 沙盒的“补满叠层”与配队词条栏共用这张表，避免两边各解析一遍文本。
   *
   * bonds:
   *   ['谢拉格']      固定盟约
   *   'activeSelf'    目标自身已激活的盟约
   *   'activeAll'     全队已激活的盟约（配队无法确定相邻目标时的上限口径）
   * target: 'self' | 'selfAndBehind1'
   * scope:  'round' | 'battle'
   */
  var SPECIAL_CAPS = {
    '初雪': [
      { elite: false, bonds: ['谢拉格'], cap: 16, scope: 'round', target: 'self', event: 'onCombat' },
      { elite: true, bonds: ['谢拉格'], cap: 32, scope: 'round', target: 'self', event: 'onCombat' }
    ],
    '圣聆初雪': [
      { elite: false, bonds: ['谢拉格'], cap: 24, scope: 'round', target: 'self', event: 'onCombat' },
      { elite: true, bonds: ['谢拉格'], cap: 48, scope: 'round', target: 'self', event: 'onCombat' }
    ],
    '妮芙': [
      { elite: false, bonds: ['迅捷'], cap: 20, scope: 'round', target: 'self', event: 'onCombat' },
      { elite: true, bonds: ['迅捷'], cap: 40, scope: 'round', target: 'self', event: 'onCombat' }
    ],
    '烛煌': [
      { elite: false, bonds: ['炎', '维多利亚'], cap: 12, scope: 'round', target: 'self', event: 'onCombat' },
      { elite: true, bonds: ['炎', '维多利亚'], cap: 24, scope: 'round', target: 'self', event: 'onCombat' }
    ],
    '余': [
      { elite: false, bonds: 'activeSelf', cap: 8, scope: 'round', target: 'self', event: 'onCombat' },
      { elite: true, bonds: 'activeSelf', cap: 16, scope: 'round', target: 'self', event: 'onCombat' }
    ],
    '佩佩': [
      { elite: false, bonds: 'activeAll', cap: 9, scope: 'round', target: 'selfAndBehind1', event: 'onCombat' },
      { elite: true, bonds: 'activeAll', cap: 18, scope: 'round', target: 'selfAndBehind1', event: 'onCombat' }
    ],
    '溯光星源': [
      { elite: false, bonds: ['奥术'], cap: 18, scope: 'round', target: 'self', event: 'onPrepEnd' },
      { elite: true, bonds: ['奥术'], cap: 36, scope: 'round', target: 'self', event: 'onPrepEnd' }
    ],
    '耀骑士临光': [
      { elite: false, bonds: 'activeSelf', cap: 12, scope: 'round', target: 'self', event: 'onKnockdown' },
      { elite: true, bonds: 'activeSelf', cap: 24, scope: 'round', target: 'self', event: 'onKnockdown' }
    ],
    '浊心斯卡蒂': [
      { elite: false, bonds: ['阿戈尔'], cap: 20, scope: 'battle', target: 'self', event: 'onDeploy' },
      { elite: true, bonds: ['阿戈尔'], cap: 40, scope: 'battle', target: 'self', event: 'onDeploy' }
    ]
  };

  var RANK_ORDER = { core: 0, additional: 1 };
  var STATE_ORDER = { empowered: 0, active: 1, conflict: 2, near: 3, inactive: 4 };

  /** (23+0.9×层数)% / (-30-0.05×层数) / (5000+25×层数)点 */
  var LAYER_SEG = /\((-?\d+(?:\.\d+)?)([+-])(\d+(?:\.\d+)?)×层数\)(%?)/g;

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) || n < 0 ? 0 : n;
  }

  function indexBy(list, key) {
    var m = {};
    for (var i = 0; i < (list || []).length; i++) m[list[i][key]] = list[i];
    return m;
  }

  function round3(v) {
    return String(Math.round(v * 1000) / 1000);
  }

  /**
   * 把数值文本切成「普通文字 / 带算式的数值」片段，供界面排版。
   * 例：(23+0.9×层数)% 在 100 层 → { t:'num', v:'+113%', f:'23%+0.9%×100' }
   * 百分数才带 + 号；秒 / 点这类单位只给数值。
   * 层数为 0 时不做替换（返回整段文字），避免满屏 (23+0.9×0)。
   */
  function layerSegments(text, layer, force) {
    var s = String(text == null ? '' : text);
    var L = num(layer);
    var out = [];
    if (!s) return out;
    if (!L && !force) { out.push({ t: 'text', v: s }); return out; }

    var last = 0, m;
    LAYER_SEG.lastIndex = 0;
    while ((m = LAYER_SEG.exec(s)) !== null) {
      // 公式前已经写了 +/- 时，把这个符号并入结果，避免出现「++53%」。
      var prefixedSign = '';
      var before = s.slice(last, m.index);
      if (m.index > last) {
        var prev = s.charAt(m.index - 1);
        if (prev === '+' || prev === '-') {
          prefixedSign = prev;
          before = s.slice(last, m.index - 1);
        }
        if (before) out.push({ t: 'text', v: before });
      }

      var base = parseFloat(m[1]);
      var sign = m[2];
      var per = parseFloat(m[3]) * (sign === '-' ? -1 : 1);
      var pct = m[4] || '';
      var value = base + per * L;
      var valueSign = value > 0 ? (prefixedSign || (pct ? '+' : '')) : '';
      var head = valueSign + round3(value) + pct;

      out.push({
        t: 'num',
        v: head,
        f: round3(base) + pct + sign + round3(Math.abs(per)) + pct + '×' + L
      });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
    return out;
  }

  /**
   * 纯文本版：数值在前、算式在后。例：+113%（23%+0.9%×100）
   * 层数为 0 时原样返回；force=true 时也代入 0 层，用于「当前数值」这类必须给出结果的位置。
   */
  function substLayers(text, layer, force) {
    var segs = layerSegments(text, layer, force);
    var out = '';
    for (var i = 0; i < segs.length; i++) {
      out += segs[i].t === 'num' ? (segs[i].v + '（' + segs[i].f + '）') : segs[i].v;
    }
    return out;
  }

  /** 文本里是否含层数公式（用来决定要不要提示「填层数」） */
  function hasLayerFormula(text) {
    LAYER_SEG.lastIndex = 0;
    var hit = LAYER_SEG.test(String(text == null ? '' : text));
    LAYER_SEG.lastIndex = 0;
    return hit;
  }

  /**
   * @param {{size:number, slots:Array, layers:Object}} team
   * @param {{operators:Array, items:Array, covenants:Array}} data
   */
  function evaluate(team, data) {
    var ops = data._opIndex || (data._opIndex = indexBy(data.operators, 'name'));
    var items = data._itemIndex || (data._itemIndex = indexBy(data.items, 'name'));
    var picks = data._pickIndex || (data._pickIndex = indexBy(data.picks || [], 'name'));
    var size = (team && team.size) || RULES.size;
    var slots = (team && team.slots) || [];
    var layers = (team && team.layers) || {};

    var pieces = [];
    var seen = {};
    var dupes = [];
    var morphIssues = [];
    var i, j;

    for (i = 0; i < size; i++) {
      var s = slots[i];
      if (!s || (!s.k && !s.p)) continue;
      var op = s.k ? ops[s.k] : null;
      var pick = s.p ? picks[s.p] : null;
      if (!op && !pick) continue;

      // 自选干员单独占席（不再有「自选配置」占位行）：
      // 名字/头像/盟约来自 picks，售价固定 4。
      var effective = pick ? {
        name: pick.name, tags: pick.tags || [],
        tier: op ? op.tier : 0, tierLabel: op ? op.tierLabel : '',
        price: op ? op.price : (pick.price || 4),
        avatar: pick.avatar, avatarFull: pick.avatarFull,
        type: '自选干员', pick: true
      } : op;
      var name = effective.name;
      if (seen[name]) { dupes.push(name); continue; }
      seen[name] = 1;

      var piece = { op: effective, pick: pick, elite: !!s.e, slot: i, items: [], extra: [] };
      var names = s.it || [];
      var itemCap = itemCapacity(effective.name, !!s.e);
      for (j = 0; j < names.length && j < itemCap; j++) {
        var raw = names[j];
        var nm = raw && typeof raw === 'string' ? raw : (raw && raw.k);
        var eliteItem = raw && typeof raw === 'object' ? !!raw.e : false;
        var it = items[nm];
        if (it && it.type === '装备') piece.items.push({ item: it, elite: eliteItem });
      }
      resolveMorph(piece, s);
      if (piece.morph && !piece.morph.covenant) morphIssues.push({ slot: i, name: name });
      pieces.push(piece);
    }

    var tagCount = {};
    var eliteCount = 0;
    var price = 0;
    var equipCount = 0;

    for (i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      var tags = p.op.tags || [];
      for (j = 0; j < tags.length; j++) {
        tagCount[tags[j]] = (tagCount[tags[j]] || 0) + 1;
      }
      // 变形同构体：获得另一件装备的盟约（已有该盟约则不重复计）
      for (j = 0; j < p.extra.length; j++) {
        var cov = p.extra[j];
        if (tags.indexOf(cov) >= 0) continue;
        tagCount[cov] = (tagCount[cov] || 0) + 1;
      }
      if (p.elite) eliteCount++;
      price += p.op.price || 0;
      for (j = 0; j < p.items.length; j++) {
        price += itemPrice(p.items[j].item, p.items[j].elite);
        equipCount++;
      }
    }

    var harmonyOn = (tagCount['调和'] || 0) >= 1;
    var pickCount = 0;
    for (i = 0; i < pieces.length; i++) if (pieces[i].pick) pickCount++;

    var rows = [];
    for (i = 0; i < data.covenants.length; i++) {
      rows.push(judge(data.covenants[i], tagCount, eliteCount, harmonyOn, layers));
    }
    rows.sort(cmpRows);

    var summary = {
      size: size, filled: pieces.length, elite: eliteCount, price: price,
      equip: equipCount, picks: pickCount, pickLimit: RULES.pickLimit,
      active: 0, empowered: 0, near: 0, conflict: 0, total: rows.length
    };
    for (i = 0; i < rows.length; i++) {
      var st = rows[i].state;
      if (st === 'empowered') { summary.active++; summary.empowered++; }
      else if (st === 'active') summary.active++;
      else if (st === 'near') summary.near++;
      else if (st === 'conflict') summary.conflict++;
    }

    return {
      rows: rows, summary: summary, dupes: dupes, pieces: pieces,
      morphIssues: morphIssues, pickOverflow: pickCount > RULES.pickLimit
    };
  }

  /** 进阶装备按进阶售价算（没有进阶价就退回普通价） */
  function itemPrice(it, elite) {
    if (!it) return 0;
    if (elite && it.hasElite && it.elitePrice != null) return it.elitePrice;
    return it.price || 0;
  }

  /** 变形同构体：另一件装备的盟约，取不到就用 slot.m 兜底 */
  function resolveMorph(piece, slot) {
    var hasMorph = false;
    var partner = null;
    for (var i = 0; i < piece.items.length; i++) {
      if (piece.items[i].item.name === MORPH_ITEM) hasMorph = true;
      else if (!partner) partner = piece.items[i];
    }
    if (!hasMorph) return;

    var cov = (partner && partner.item.covenant) || slot.m || '';
    if (cov) piece.extra.push(cov);
    piece.morph = {
      item: partner ? partner.item.name : '',
      covenant: cov,
      manual: !!(partner && !partner.item.covenant && slot.m)
    };
  }

  function judge(c, tagCount, eliteCount, harmonyOn, layers) {
    var a = c.activation || {};
    var kind = a.kind || 'count';
    var threshold = a.threshold || 0;
    var empower = a.empowerThreshold;
    var nodes = a.nodes || [];
    var n = tagCount[c.name] || 0;

    var row = {
      name: c.name, key: c.id || c.key, rank: c.rank, kind: kind,
      threshold: threshold, empowerThreshold: empower, nodes: nodes,
      count: 0, bonus: 0, grants: 0, state: 'inactive', missing: 0, missingEmpower: null,
      layer: num(layers[c.name]), node: 0, garrison: !!c.garrison
    };

    /* ---- 绝技：按精锐数 ---- */
    if (kind === 'elite') {
      row.count = eliteCount;
      row.missing = Math.max(0, threshold - eliteCount);
      row.missingEmpower = empower == null ? null : Math.max(0, empower - eliteCount);
      if (empower != null && eliteCount >= empower) row.state = 'empowered';
      else if (eliteCount >= threshold) row.state = 'active';
      // 空队伍时不把「缺 2 名精锐」算作待激活，避免开局满屏提示
      else if (eliteCount > 0 && row.missing <= RULES.nearGap) row.state = 'near';
      return row;
    }

    /* ---- 特殊三条：不能套 count >= threshold ---- */
    if (kind === 'special') {
      if (c.name === '独行') {
        row.count = n;
        row.missing = Math.max(0, 1 - n);
        if (n >= 2) row.state = 'conflict';
        else if (n === 1) row.state = 'active';
        return row;
      }
      if (c.name === '调和') {
        row.count = n;
        // 调和自身不吃自己的 +1；它「给出」加成，给主盟约的地方在下面 count 分支
        row.grants = n >= 1 ? RULES.harmonyBonus : 0;
        row.missing = Math.max(0, 1 - n);
        row.state = n >= 1 ? 'active' : 'inactive';
        return row;
      }
      // 协防干员
      row.count = n;
      row.missing = Math.max(0, threshold - n);
      if (n >= threshold) row.state = 'active';
      else if (n > 0 && row.missing <= RULES.nearGap) row.state = 'near';
      return row;
    }

    /* ---- 人数 / 人数 + 层数 ---- */
    row.bonus = (c.rank === 'core' && harmonyOn) ? RULES.harmonyBonus : 0;
    row.count = n + row.bonus;
    row.missing = Math.max(0, threshold - row.count);
    row.missingEmpower = empower == null ? null : Math.max(0, empower - row.count);

    if (kind === 'count_layer') {
      for (var k = 0; k < nodes.length; k++) {
        if (row.layer >= nodes[k]) row.node = nodes[k];
      }
      if (row.count < threshold) row.state = 'inactive';
      else if (nodes.length && row.layer >= nodes[nodes.length - 1]) row.state = 'empowered';
      else row.state = 'active';
    } else if (empower != null && row.count >= empower) {
      row.state = 'empowered';
    } else if (row.count >= threshold) {
      row.state = 'active';
    }

    if (row.state === 'inactive' && row.count > 0 && row.missing <= RULES.nearGap) {
      row.state = 'near';
    }
    return row;
  }

  function cmpRows(a, b) {
    var sa = STATE_ORDER[a.state], sb = STATE_ORDER[b.state];
    if (sa !== sb) return sa - sb;
    var ra = RANK_ORDER[a.rank] == null ? 9 : RANK_ORDER[a.rank];
    var rb = RANK_ORDER[b.rank] == null ? 9 : RANK_ORDER[b.rank];
    if (ra !== rb) return ra - rb;
    if (a.missing !== b.missing) return a.missing - b.missing;
    return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
  }

  /** 空队伍（保持 size 个空位） */
  function emptyTeam(size) {
    var n = Math.min(RULES.maxSize, Math.max(1, size || RULES.size));
    var slots = [];
    for (var i = 0; i < n; i++) slots.push(null);
    return { size: n, slots: slots, layers: {} };
  }

  /** 从 from 之后环形找下一个空席，没有返回 -1（连续添加用） */
  function nextEmptySlot(slots, from) {
    var n = (slots || []).length;
    if (!n) return -1;
    for (var k = 1; k <= n; k++) {
      var idx = (from + k) % n;
      if (idx < 0) idx += n;
      if (!slots[idx]) return idx;
    }
    return -1;
  }

  global.Calc = {
    RULES: RULES,
    MORPH_ITEM: MORPH_ITEM,
    EQUIP_SLOT_OVERRIDES: EQUIP_SLOT_OVERRIDES,
    itemCapacity: itemCapacity,
    SPECIAL_CAPS: SPECIAL_CAPS,
    evaluate: evaluate,
    emptyTeam: emptyTeam,
    nextEmptySlot: nextEmptySlot,
    layerSegments: layerSegments,
    substLayers: substLayers,
    hasLayerFormula: hasLayerFormula
  };
})(window);
