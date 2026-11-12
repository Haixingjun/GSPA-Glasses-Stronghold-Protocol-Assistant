/* ==========================================================================
   search.js — 索引、分词、筛选、排序、高亮
   --------------------------------------------------------------------------
   · 数据量 312 条，全量线性扫描 < 2ms，不做倒排索引，代码更短更好维护。
   · 每个条目的 haystack 在启动时预建一次（小写、字段拼接）。
   · 高亮在渲染时做：先转义再加 <mark>，避免任何 HTML 注入。
   ========================================================================== */
(function (global) {
  'use strict';

  var SEP = '\u0001';
  var index = { op: [], item: [], strategy: [], covenant: [] };
  var data = null;

  function pickOp(p) {
    return {
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
    };
  }

  /* ---------------- 初始化索引 ---------------- */
  function init(payload) {
    data = payload;

    // 特殊干员档案只挂在干员上；策略索引需要反查，方便「优等生」「Pith」也能命中。
    var specialByStrategy = {};
    for (var s = 0; s < payload.operators.length; s++) {
      var sp = payload.operators[s];
      if (sp.special && sp.special.strategyKey) specialByStrategy[sp.special.strategyKey] = sp;
    }

    var allOps = payload.operators.concat((payload.picks || []).map(pickOp));
    index.op = allOps.map(function (o) {
      return {
        e: o,
        h: low([
          o.name, o.tierLabel, o.type, (o.tags || []).join(' '),
          o.normalText, o.eliteText, o.normalTrigger, o.eliteTrigger, o.price,
          specialText(o)
        ].join(SEP))
      };
    });

    index.item = payload.items.map(function (o) {
      return {
        e: o,
        h: low([
          o.name, o.type, o.tier, o.normalText, o.eliteText, o.price,
          o.hasElite ? o.elitePrice : '', o.fuseCount ? '合成' : ''
        ].join(SEP))
      };
    });

    index.strategy = payload.strategies.map(function (o) {
      var st = [];
      for (var i = 0; i < o.stages.length; i++) {
        st.push(o.stages[i].effect, o.stages[i].state, o.stages[i].rule);
      }
      var sp = o.specialOperator ? specialByStrategy[o.key] : null;
      var spText = '';
      if (sp) spText = sp.name + ' ' + (sp.special.aliases || []).join(' ');
      var fuText = '';
      if (o.fixedUnits) {
        for (var q = 0; q < o.fixedUnits.units.length; q++) fuText += ' ' + o.fixedUnits.units[q].name;
      }
      return {
        e: o,
        h: low([o.role, o.name, o.category, o.text, o.unlock, o.banned, spText, fuText]
          .concat(st).join(SEP))
      };
    });

    index.covenant = payload.covenants.map(function (o) {
      return {
        e: o,
        h: low([
          o.name, o.desc, (o.activation.empower || []).join(' '),
          (o.members || []).join(' '), (o.pickMembers || []).join(' '), kindLabel(o.activation.kind),
          rankLabel(o.rank), familyLabel(o.family),
          (o.functions || []).map(funcLabel).join(' ')
        ].join(SEP))
      };
    });

    return index;
  }

  function low(s) {
    return String(s == null ? '' : s).toLowerCase();
  }

  /** 特殊干员的别称 / 职业 / 技能名也进搜索索引（优等生、Pith、森蚺…） */
  function specialText(o) {
    if (!o.special) return '';
    var s = o.special;
    var p = s.prts || {};
    var out = [
      (s.aliases || []).join(' '),
      s.strategyRole, s.strategyName, s.strategyKey,
      s.chessId, s.debutSeason,
      p.class, p.branch, p.trait, p.charId, (p.tags || []).join(' ')
    ];
    var i;
    for (i = 0; i < (p.talents || []).length; i++) out.push(p.talents[i].name);
    for (i = 0; i < (p.skills || []).length; i++) out.push(p.skills[i].name);
    return out.join(' ');
  }

  function kindLabel(kind) {
    if (kind === 'count') return '人数';
    if (kind === 'count_layer') return '人数+层数';
    if (kind === 'elite') return '精锐数';
    return '特殊';
  }

  var RANK_LABEL = { core: '主盟约', additional: '副盟约' };
  var FAMILY_LABEL = { faction: '阵营', combat: '战斗', growth: '成长', special: '特殊' };
  var FUNC_LABEL = {
    output: '输出', survival: '生存', sustain: '续航', stack: '叠层',
    economy: '经济', summon: '召唤', rule: '规则'
  };
  var RANK_ORDER = { core: 0, additional: 1 };
  var FAMILY_ORDER = { faction: 0, combat: 1, growth: 2, special: 3 };

  function rankLabel(rank) { return RANK_LABEL[rank] || rank || ''; }
  function familyLabel(family) { return FAMILY_LABEL[family] || family || ''; }
  function funcLabel(fn) { return FUNC_LABEL[fn] || fn || ''; }

  /* ---------------- 分词 / 匹配 ---------------- */
  function tokens(q) {
    var out = [];
    if (!q) return out;
    var parts = String(q).toLowerCase().split(/[\s\u3000]+/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p && out.indexOf(p) < 0) out.push(p);
    }
    return out;
  }

  function matchHay(hay, toks) {
    for (var i = 0; i < toks.length; i++) {
      if (hay.indexOf(toks[i]) < 0) return false;
    }
    return true;
  }

  function anyOverlap(list, selected) {
    if (!selected || !selected.length) return true;
    for (var i = 0; i < selected.length; i++) {
      if (list.indexOf(selected[i]) >= 0) return true;
    }
    return false;
  }

  function allMatch(list, selected) {
    if (!selected || !selected.length) return true;
    for (var i = 0; i < selected.length; i++) {
      if (list.indexOf(selected[i]) < 0) return false;
    }
    return true;
  }

  /* ---------------- 筛选 ---------------- */
  /**
   * @param {string} view
   * @param {object} st  Store.state
   * @param {object} [opts] {skipTags:true} 用于计算盟约 chip 计数
   */
  function filter(view, st, opts) {
    opts = opts || {};
    var recs = index[view] || [];
    var toks = tokens(st.q);
    var out = [];

    for (var i = 0; i < recs.length; i++) {
      var rec = recs[i];
      var e = rec.e;

      if (toks.length && !matchHay(rec.h, toks)) continue;

      if (view === 'op') {
        if (st.tiers.length && st.tiers.indexOf(e.tier) < 0) continue;
        if (st.prices.length && st.prices.indexOf(e.price) < 0) continue;
        if (st.otypes.length && st.otypes.indexOf(e.type) < 0) continue;
        if (st.triggers.length) {
          var trg = e.normalTriggers.concat(e.eliteTriggers);
          if (!anyOverlap(trg, st.triggers)) continue;
        }
        // 特殊干员默认也是隐藏条目，但直接搜名字/别称时要能命中
        if (!st.hidden && e.hidden && !(e.special && toks.length)) continue;
        if (!opts.skipTags && st.tags.length) {
          if (st.tagMode === 'and' ? !allMatch(e.tags, st.tags) : !anyOverlap(e.tags, st.tags)) continue;
        }
      } else if (view === 'item') {
        if (st.tiers.length && st.tiers.indexOf(e.tier) < 0) continue;
        if (st.itypes.length && st.itypes.indexOf(e.type) < 0) continue;
        if (st.prices.length && e.price != null && st.prices.indexOf(e.price) < 0) continue;
      } else if (view === 'strategy') {
        if (st.icats.length && st.icats.indexOf(e.category) < 0) continue;
      } else if (view === 'covenant') {
        if (st.ranks && st.ranks.length && st.ranks.indexOf(e.rank) < 0) continue;
      }

      out.push(e);
    }

    return sortList(view, out, st.sort);
  }

  /* ---------------- 排序 ---------------- */
  function cmpName(a, b) {
    try {
      return String(a).localeCompare(String(b), 'zh-Hans-CN');
    } catch (err) {
      return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    }
  }

  function byTierName(a, b) {
    var ta = a.tier || 99, tb = b.tier || 99;
    if (ta !== tb) return ta - tb;
    return cmpName(a.name || a.role, b.name || b.role);
  }

  function sortList(view, list, sort) {
    var arr = list.slice();
    if (sort === 'name') {
      arr.sort(function (a, b) {
        return cmpName(a.name || a.role || '', b.name || b.role || '');
      });
    } else if (sort === 'price') {
      arr.sort(function (a, b) {
        var pa = a.price == null ? 99 : a.price;
        var pb = b.price == null ? 99 : b.price;
        if (pa !== pb) return pa - pb;
        return byTierName(a, b);
      });
    } else if (sort === 'tagcount') {
      arr.sort(function (a, b) {
        var ta = (a.tags || []).length;
        var tb = (b.tags || []).length;
        if (ta !== tb) return tb - ta;
        return byTierName(a, b);
      });
    } else if (sort === 'members') {
      arr.sort(function (a, b) {
        if (a.memberCount !== b.memberCount) return b.memberCount - a.memberCount;
        return cmpName(a.name, b.name);
      });
    } else if (sort === 'category') {
      arr.sort(function (a, b) {
        var c = cmpName(a.category, b.category);
        if (c) return c;
        return cmpName(a.role || a.name, b.role || b.name);
      });
    } else if (sort === 'hp') {
      arr.sort(function (a, b) {
        if (a.hp !== b.hp) return b.hp - a.hp;
        return cmpName(a.role || a.name, b.role || b.name);
      });
    } else if (view === 'op' || view === 'item') {
      arr.sort(byTierName);
    } else if (view === 'strategy') {
      // 默认按角色名，和「策略以角色为主体」的展示口径一致
      arr.sort(function (a, b) {
        return cmpName(a.role || '', b.role || '');
      });
    } else if (view === 'covenant') {
      arr.sort(function (a, b) {
        // 默认按「主盟约 → 副盟约」，同层再按大类、成员数。
        var ra = RANK_ORDER[a.rank], rb = RANK_ORDER[b.rank];
        if (ra == null) ra = 99;
        if (rb == null) rb = 99;
        if (ra !== rb) return ra - rb;
        var ga = FAMILY_ORDER[a.family], gb = FAMILY_ORDER[b.family];
        if (ga == null) ga = 99;
        if (gb == null) gb = 99;
        if (ga !== gb) return ga - gb;
        if (a.memberCount !== b.memberCount) return b.memberCount - a.memberCount;
        return cmpName(a.name, b.name);
      });
    }
    return arr;
  }

  /* ---------------- 分面计数 ---------------- */
  function countFacet(list, valuesOf) {
    var m = {};
    for (var i = 0; i < list.length; i++) {
      var vals = valuesOf(list[i]);
      for (var j = 0; j < vals.length; j++) {
        m[vals[j]] = (m[vals[j]] || 0) + 1;
      }
    }
    return m;
  }

  /* ---------------- 高亮 / 文本格式化 ---------------- */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  function highlight(text, toks) {
    var s = String(text == null ? '' : text);
    if (!toks || !toks.length || !s) return esc(s);

    var lower = s.toLowerCase();
    var ranges = [];
    for (var t = 0; t < toks.length; t++) {
      var tok = toks[t];
      if (!tok) continue;
      var from = 0, at;
      while ((at = lower.indexOf(tok, from)) >= 0) {
        ranges.push([at, at + tok.length]);
        from = at + tok.length;
      }
    }
    if (!ranges.length) return esc(s);

    ranges.sort(function (a, b) { return a[0] - b[0]; });

    var merged = [ranges[0]];
    for (var i = 1; i < ranges.length; i++) {
      var cur = merged[merged.length - 1];
      if (ranges[i][0] <= cur[1]) {
        if (ranges[i][1] > cur[1]) cur[1] = ranges[i][1];
      } else {
        merged.push(ranges[i]);
      }
    }

    var out = '', pos = 0;
    for (var k = 0; k < merged.length; k++) {
      out += esc(s.slice(pos, merged[k][0]));
      out += '<mark>' + esc(s.slice(merged[k][0], merged[k][1])) + '</mark>';
      pos = merged[k][1];
    }
    out += esc(s.slice(pos));
    return out;
  }

  var TAG_RE = /(【[^】]{1,24}】|<[^<>]{1,24}>)/g;

  /** 【盟约】 与 <触发时机> 着色，换行保留，关键词高亮 */
  function format(text, toks) {
    var s = String(text == null ? '' : text);
    if (!s) return '';
    var out = '';
    var last = 0, m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(s)) !== null) {
      out += highlight(s.slice(last, m.index), toks);
      var chunk = m[0];
      var cls = chunk.charAt(0) === '【' ? 'kw' : 'trg';
      out += '<span class="' + cls + '">' + esc(chunk) + '</span>';
      last = m.index + chunk.length;
    }
    out += highlight(s.slice(last), toks);
    return out.replace(/\n/g, '<br>');
  }

  /* ---------------- 对外 ---------------- */
  global.Search = {
    init: init,
    tokens: tokens,
    filter: filter,
    sortList: sortList,
    countFacet: countFacet,
    esc: esc,
    highlight: highlight,
    format: format,
    kindLabel: kindLabel,
    index: index
  };
})(window);
