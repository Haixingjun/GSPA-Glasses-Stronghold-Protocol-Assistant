/* ==========================================================================
   team.js — 配队视图：席位、装备、盟约激活面板、选人 / 选装备、悬停详情、拖拽排序
   --------------------------------------------------------------------------
   设计要点
   · 判定全部交给 calc.js（纯函数，有单测）；这里只负责渲染与交互。
   · 队伍状态在 store.js 的 state.team：{ size, slots, layers }；
     席位 { k, e, it:[装备], m:转职盟约 }。
   · 选人 / 选装备共用底部/居中面板 #sheet，用 mode 区分；面板状态不进 URL。
   · 盟约详情走 #tip：桌面悬停、键盘聚焦、手机点按都能看，层数按当前输入代入数值。
   · 拖拽排序用 pointer 事件（鼠标 + 触屏同一套），只从手柄发起，避免和滚动打架。
   · 盟约图标只有一张线稿，点亮/未激活用 CSS 表达（PRTS 无点亮态素材）。
   ========================================================================== */
(function (global) {
  'use strict';

  var Store = global.Store;
  var Search = global.Search;
  var Calc = global.Calc;
  var UI = global.UI;

  var STATE_LABEL = {
    empowered: '已强化',
    active: '已激活',
    near: '待激活',
    inactive: '未激活',
    conflict: '独行失效'
  };

  var data = null;
  var covByName = {};
  var opByName = {};
  var pickByName = {};
  var itemByName = {};
  var gearList = [];

  var picker = {
    open: false, mode: 'op', slot: -1, gear: -1,
    q: '', tiers: [], tags: [], batch: true, pending: null, eliteMode: {}, filtersOpen: true
  };
  // 词条栏展开状态：首次进入窄屏默认收起，桌面默认展开；用户手动切换后保持
  var traitsOpen = null;
  // 词条栏筛选：只看会增加盟约层数的「叠层手段」
  var traitsLayerOnly = false;
  // 词条按触发时机排列：从休整期结束（备战完成）走到下一次休整期开始
  var TRAIT_TRIGGER_ORDER = [
    '休整期结束时', '战斗开始时', '战斗中', '战斗结束时',
    '进入休整期时', '获得时', '刷新时', '售出时', '休整期开始时'
  ];
  var NO_TRIGGER = '';
  // 判断一条词条是否在「增加 / 转化 / 增幅盟约层数」；只按层数获得，不把「每叠加 N 层加攻击」算进来
  var LAYER_TRAIT_RE = /层数\s*(?:额外)?\s*[+＋]|获得等同于[^。；\n]*层数|叠加等同于[^。；\n]*层数|转化\s*\d+\s*层[^。；\n]*固定层数|临时层数提升至/;
  var els = {};
  var qTimer = null;

  /* ---------------- 初始化 ---------------- */
  function ensure() {
    if (data) return;
    data = Store.getData();
    var i;
    for (i = 0; i < data.covenants.length; i++) covByName[data.covenants[i].name] = data.covenants[i];
    for (i = 0; i < data.operators.length; i++) opByName[data.operators[i].name] = data.operators[i];
    for (i = 0; i < (data.picks || []).length; i++) pickByName[data.picks[i].name] = data.picks[i];
    for (i = 0; i < data.items.length; i++) {
      itemByName[data.items[i].name] = data.items[i];
      if (data.items[i].type === '装备') gearList.push(data.items[i]);
    }
  }

  function init() {
    ensure();
    els.cards = document.getElementById('cards');
    els.sheet = document.getElementById('sheet');
    els.tip = document.getElementById('tip');
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    document.addEventListener('mouseover', onHover);
    document.addEventListener('mouseout', onHoverOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('scroll', hideTip, true);
  }

  /* ---------------- 视图 ---------------- */
  function viewHtml() {
    ensure();
    var team = Store.getTeam();
    var res = Calc.evaluate(team, data);
    return '<section class="team">' +
      headHtml(team, res) +
      traitsHtml(team) +
      '<div class="tm-main">' +
      slotsHtml(team, res) +
      covHtml(res) +
      '</div>' +
      '</section>';
  }

  function headHtml(team, res) {
    var s = res.summary;
    var h = '<div class="tm-head">' +
      '<div class="tm-stats">' +
      statHtml(s.filled + '/' + s.size, '场上席位') +
      statHtml(s.picks + '/' + s.pickLimit, '自选') +
      statHtml(s.elite, '精锐') +
      statHtml(s.equip, '装备') +
      statHtml('◈' + s.price, '总售价') +
      statHtml(s.active + '/' + s.total, '已激活') +
      statHtml(s.near, '待激活') +
      '</div>' +
      '<div class="tm-actions">' +
      (s.filled < s.size ? '<button type="button" class="btn tm-batch" data-batch-add>批量添加</button>' : '') +
      '<button type="button" class="btn" data-team-import>导入</button>' +
      '<button type="button" class="btn" data-team-share>分享</button>' +
      '<button type="button" class="btn tm-clear" data-team-clear>清空</button>' +
      '</div>' +
      '</div>';

    var warns = [];
    if (res.dupes.length) warns.push('重复干员只计一次：' + esc(res.dupes.join('、')));
    if (res.pickOverflow) warns.push('自选干员最多 2 名，当前 ' + s.picks + ' 名，请移除多余的自选席');
    if (res.morphIssues.length) {
      var parts = [];
      for (var i = 0; i < res.morphIssues.length; i++) parts.push('第 ' + (res.morphIssues[i].slot + 1) + ' 席 ' + res.morphIssues[i].name);
      warns.push('变形同构体还缺「另一件装备所属盟约」：' + esc(parts.join('、')) + '（在席位里手动指定转职盟约）');
    }
    for (var w = 0; w < warns.length; w++) h += '<p class="tm-warn">' + warns[w] + '</p>';

    if (!s.filled) {
      h += '<p class="tm-hint">点下面的空位选人，盟约会随着队伍实时判定；' +
        '每位干员最多带 2 件装备，<b>变形同构体</b>会按另一件装备的盟约给携带者转职。</p>';
    }
    return h;
  }

  function statHtml(v, label) {
    return '<div class="tm-stat"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>';
  }

  function slotsHtml(team, res) {
    var bySlot = {};
    for (var p = 0; p < res.pieces.length; p++) bySlot[res.pieces[p].slot] = res.pieces[p];

    var h = '<div class="tm-slots" role="list">';
    for (var i = 0; i < team.size; i++) h += slotHtml(team, i, bySlot[i]);
    if (team.size < Store.TEAM_MAX) h += addSlotHtml();
    h += '</div>';

    if (team.size === Store.TEAM_MAX && !team.slots[team.size - 1]) {
      h += '<div class="tm-slots-foot"><button type="button" class="linklike" data-shrink-slot>' +
        '收回第 9 席</button></div>';
    }
    return h;
  }

  /** 席位实际显示的干员：普通干员取 opByName；自选干员只剩 picks（没有占位行）。
      自选干员售价固定 4，阶数留空，用「自选」标签表示。 */
  function slotOperator(s) {
    var base = s && s.k ? opByName[s.k] : null;
    var pick = s && s.p ? pickByName[s.p] : null;
    if (!pick) return { op: base, pick: null };
    return {
      op: {
        name: pick.name, tags: pick.tags || [],
        tier: base ? base.tier : 0, tierLabel: base ? base.tierLabel : '',
        price: base ? base.price : 4,
        avatar: pick.avatar, avatarFull: pick.avatarFull,
        type: '自选干员', pick: true
      },
      pick: pick
    };
  }

  function slotHtml(team, i, piece) {
    var s = team.slots[i];
    var so = slotOperator(s);
    var op = so.op;

    if (!op) {
      return '<button type="button" class="slot slot-empty" role="listitem" data-slot-open="' + i + '"' +
        ' aria-label="第 ' + (i + 1) + ' 席，添加干员">' +
        '<span class="slot-plus" aria-hidden="true">＋</span>' +
        '<span class="slot-hint">第 ' + (i + 1) + ' 席</span>' +
        '</button>';
    }

    var tags = '';
    var list = op.tags || [];
    for (var t = 0; t < list.length && t < 2; t++) {
      tags += '<span class="slot-tag" style="--h:' + UI.hue(list[t]) + '">' + esc(list[t]) + '</span>';
    }
    if (so.pick) tags += '<span class="slot-tag slot-tag-pick">自选</span>';

    return '<div class="slot slot-filled' + (so.pick ? ' is-pick' : '') + '" role="listitem" data-slot-index="' + i + '">' +
      '<button type="button" class="slot-body" data-slot-open="' + i + '" data-tip-op="' + esc(op.name) + '" aria-label="第 ' + (i + 1) + ' 席 ' +
      esc(op.name) + '，点击更换" title="' + esc(op.name) + '">' +
      UI.avatarHtml(op, op.name, 34) +
      '<span class="slot-text">' +
      '<span class="slot-name-row">' +
      '<span class="slot-name">' + esc(op.name) + '</span>' +
      (op.tier ? '<span class="tier" data-tier="' + op.tier + '">' + esc(op.tierLabel) + '</span>' : '') +
      '</span>' +
      '<span class="slot-tags">' + tags + '</span>' +
      '</span>' +
      '</button>' +
      gearHtml(s, i) +
      morphHtml(piece, i) +
      '<div class="slot-acts">' +
      '<button type="button" class="slot-btn slot-grip" data-grip="' + i + '"' +
      ' aria-label="拖动调整第 ' + (i + 1) + ' 席顺序" title="按住拖动调整顺序">⠿</button>' +
      '<span class="slot-price" title="干员售价">◈' + (op.price == null ? '—' : op.price) + '</span>' +
      '<button type="button" class="slot-btn' + (s.e ? ' is-on' : '') + '" data-elite="' + i + '"' +
      ' aria-pressed="' + (s.e ? 'true' : 'false') + '" title="切换普通 / 精锐">精锐</button>' +
      '<button type="button" class="slot-btn slot-x" data-slot-clear="' + i + '"' +
      ' aria-label="移除 ' + esc(op.name) + '" title="移除">×</button>' +
      '</div>' +
      '</div>';
  }

  function gearHtml(slot, i) {
    var items = slot.it || [];
    var h = '<div class="slot-gear">';
    for (var k = 0; k < items.length; k++) {
      var entry = normItem(items[k]);
      if (!entry) continue;
      var it = itemByName[entry.k];
      var icon = it ? UI.iconHtml(it, it.name, 20, 'item', false, true) : '';
      h += '<button type="button" class="gear-chip' + (entry.e ? ' is-elite' : '') + '"' +
        ' data-gear-open="' + i + '" data-gear-index="' + k + '"' +
        ' data-tip-item="' + esc(entry.k) + '"' +
        ' aria-label="更换装备 ' + esc(entry.k) + (entry.e ? '（进阶）' : '') + '">' +
        (icon || '<span class="gear-fb">装</span>') +
        (entry.e ? '<i class="gear-elite" aria-hidden="true">进</i>' : '') +
        '</button>';
    }
    if (items.length < Store.ITEMS_MAX) {
      h += '<button type="button" class="gear-add" data-gear-add="' + i + '"' +
        ' aria-label="添加装备" title="添加装备">＋</button>';
    }
    h += '</div>';
    return h;
  }

  /** 变形同构体：另一件装备的盟约已知就给结论，未知就给手动选择 */
  function morphHtml(piece, i) {
    if (!piece || !piece.morph) return '';
    if (piece.morph.covenant) {
      return '<div class="slot-morph"><span>转职</span><b style="--h:' + UI.hue(piece.morph.covenant) + '">' +
        esc(piece.morph.covenant) + '</b></div>';
    }
    var opts = '<option value="">选择盟约…</option>';
    for (var k = 0; k < data.covenants.length; k++) {
      var n = data.covenants[k].name;
      opts += '<option value="' + esc(n) + '">' + esc(n) + '</option>';
    }
    return '<label class="slot-morph is-ask"><span>转职</span>' +
      '<select data-morph="' + i + '" aria-label="第 ' + (i + 1) + ' 席转职盟约">' + opts + '</select></label>';
  }

  function addSlotHtml() {
    var item = itemByName['人事部文档'];
    var icon = item ? UI.iconHtml(item, item.name, 34, 'item') : '';
    return '<button type="button" class="slot slot-add" data-add-slot' +
      ' aria-label="使用人事部文档，增加第 9 席" title="人事部文档：最大可部署人数变为 9">' +
      '<span class="slot-add-icon">' + (icon || '<span class="slot-add-fb">＋</span>') +
      '<i class="slot-add-plus" aria-hidden="true">＋</i></span>' +
      '<span class="slot-add-text"><b>再开一席</b><small>人事部文档</small></span>' +
      '</button>';
  }

  function covHtml(res) {
    var rows = res.rows;
    var h = '<div class="tm-cov-head">' +
      '<h2>盟约</h2>' +
      '<span class="tm-cov-sum">已激活 <b>' + res.summary.active + '</b> / ' + res.summary.total +
      '<span class="dot-sep">·</span>强化 <b>' + res.summary.empowered + '</b>' +
      '<span class="dot-sep">·</span>待激活 <b>' + res.summary.near + '</b></span>' +
      '</div>';

    h += '<div class="tm-covs">';
    for (var i = 0; i < rows.length; i++) h += covTile(rows[i]);
    h += '</div>';
    return h;
  }

  function covTile(r) {
    var c = covByName[r.name];
    var pct = r.threshold ? Math.min(100, Math.round((r.count / r.threshold) * 100)) : 0;
    var label = STATE_LABEL[r.state] || r.state;
    var detail = '';

    if (r.state === 'near') {
      label = '缺 ' + r.missing + (r.kind === 'elite' ? ' 名精锐' : ' 人');
    } else if (r.state === 'active' && r.missingEmpower) {
      label = '强化缺 ' + r.missingEmpower + (r.kind === 'elite' ? ' 名' : ' 人');
    } else if (r.state === 'active' && r.kind === 'count_layer') {
      label = r.nodes.length ? '层数 ' + r.node + ' / ' + r.nodes[r.nodes.length - 1] : '已激活';
    } else if (r.state === 'conflict') {
      label = '独行失效';
    }

    // 层数输入：任何「数值随层数变化」的盟约都可以填。
    // count_layer 那 6 个还额外有节点；其它（炎 / 萨尔贡 / 维多利亚…）只算数值。
    if (c && Calc.hasLayerFormula(c.valueText) && (r.count > 0 || r.kind === 'count_layer')) {
      var nodes = '';
      if (r.nodes.length) {
        var parts = [];
        for (var k = 0; k < r.nodes.length; k++) {
          parts.push(r.layer >= r.nodes[k]
            ? '<b class="is-on">' + r.nodes[k] + '</b>'
            : '<span>' + r.nodes[k] + '</span>');
        }
        nodes = '<span class="cov-nodes">' + parts.join('<i>·</i>') + '</span>';
      }
      detail = '<label class="cov-layer">层数' +
        '<input type="number" min="0" step="1" inputmode="numeric" data-layer="' + esc(r.name) + '"' +
        ' value="' + (r.layer > 0 ? r.layer : '') + '" placeholder="0"' +
        ' aria-label="' + esc(r.name) + '层数">' +
        nodes +
        '<i class="cov-cal" title="点开盟约详情可看按层数算出的具体数值">ⓘ</i>' +
        '</label>';
    }

    return '<div class="cov is-' + r.state + (r.bonus ? ' has-bonus' : '') + '"' +
      ' data-tip-cov="' + esc(r.name) + '" tabindex="0" role="button"' +
      ' aria-label="' + esc(r.name) + '，' + esc(label) + '，查看详细效果">' +
      '<div class="cov-top">' +
      UI.iconHtml(c, r.name, 38, 'covenant') +
      '<div class="cov-main">' +
      '<div class="cov-name">' + esc(r.name) +
      (r.rank === 'core' ? '' : ' <em>副</em>') +
      '</div>' +
      '<div class="cov-num"><b>' + r.count + '</b> / ' + r.threshold + '</div>' +
      '</div>' +
      '</div>' +
      '<div class="cov-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' +
      '<div class="cov-foot"><span class="cov-state">' + esc(label) + '</span>' +
      (r.bonus ? '<span class="cov-bonus">调和 +1</span>' : '') +
      (r.grants ? '<span class="cov-bonus">核心 +1</span>' : '') +
      '</div>' +
      detail +
      '</div>';
  }

  /* ---------------- 词条栏：全队词条按触发时机汇总 ---------------- */
  function isTraitsOpen() {
    if (traitsOpen === null) traitsOpen = (global.innerWidth || 0) >= 1024;
    return traitsOpen;
  }

  function stripTriggerTags(text) {
    var s = String(text == null ? '' : text);
    var cleaned = s.replace(/^\s*(?:<[^<>]{1,24}>\s*)+/, '');
    return cleaned || s;
  }

  function isLayerTrait(text) {
    return LAYER_TRAIT_RE.test(String(text == null ? '' : text));
  }

  /** 按当前形态（普通 / 精锐）收集词条，并按触发时机分组；重复干员只算一次 */
  function traitGroups(team) {
    var groups = {};
    var seen = {};
    var total = 0;
    var other = 0;
    var picks = 0;
    var multi = 0;

    for (var i = 0; i < team.slots.length; i++) {
      var s = team.slots[i];
      if (!s) continue;
      var so = slotOperator(s);
      var op = so.op;
      if (!op) continue;
      if (so.pick) { picks++; continue; }   // 自选干员没有词条说明
      if (seen[op.name]) continue;
      seen[op.name] = 1;

      var elite = !!s.e;
      var text = elite ? (op.eliteText || op.normalText) : op.normalText;
      if (!text) continue;
      var layer = isLayerTrait(text);
      if (!layer) other++;
      if (traitsLayerOnly && !layer) continue;

      var triggers = (elite && op.eliteTriggers && op.eliteTriggers.length)
        ? op.eliteTriggers : (op.normalTriggers || []);
      var uniq = [];
      for (var t = 0; t < triggers.length; t++) {
        if (uniq.indexOf(triggers[t]) < 0) uniq.push(triggers[t]);
      }
      if (!uniq.length) uniq.push(NO_TRIGGER);
      if (uniq.length > 1) multi++;

      total++;
      for (var k = 0; k < uniq.length; k++) {
        var g = uniq[k];
        if (!groups[g]) groups[g] = [];
        groups[g].push({ name: op.name, op: op, elite: elite, text: text, slot: i });
      }
    }

    return { groups: groups, total: total, other: other, allTotal: total + other, picks: picks, multi: multi };
  }

  function traitsHtml(team) {
    var bag = traitGroups(team);
    var open = isTraitsOpen();
    var body = '';

    if (!bag.total) {
      var msg = [];
      if (traitsLayerOnly && bag.other) {
        msg.push('当前队伍没有叠层词条（已隐藏 ' + bag.other + ' 条非叠层）');
      }
      if (bag.picks) msg.push('自选干员暂无词条数据');
      body = '<p class="tm-tr-empty">' +
        (msg.length ? msg.join('；') + '。' : '加入干员后，这里会按触发时机汇总全队词条。') +
        '</p>';
    } else {
      var keys = [];
      for (var g in bag.groups) if (bag.groups.hasOwnProperty(g)) keys.push(g);
      keys.sort(function (a, b) {
        if (a === NO_TRIGGER) return 1;
        if (b === NO_TRIGGER) return -1;
        var ia = TRAIT_TRIGGER_ORDER.indexOf(a);
        var ib = TRAIT_TRIGGER_ORDER.indexOf(b);
        if (ia < 0) ia = TRAIT_TRIGGER_ORDER.length;
        if (ib < 0) ib = TRAIT_TRIGGER_ORDER.length;
        return ia - ib || a.localeCompare(b, 'zh-Hans-CN');
      });

      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var list = bag.groups[key];
        var label = key === NO_TRIGGER ? '无触发时机' : key;
        body += '<section class="tm-tr-group' + (key === NO_TRIGGER ? ' is-none' : '') + '">' +
          '<h3 class="tm-tr-grouphead" style="--h:' + UI.hue(label) + '">' +
          '<i class="dot" aria-hidden="true"></i>' + esc(label) +
          '<span class="tm-tr-n" title="' + list.length + ' 条">' + list.length + '</span></h3>' +
          '<ul class="tm-tr-list">';
        for (var j = 0; j < list.length; j++) {
          var it = list[j];
          body += '<li class="tm-tr-item" title="第 ' + (it.slot + 1) + ' 席 · ' + (it.elite ? '精锐' : '普通') + '">' +
            UI.avatarHtml(it.op, it.name, 24) +
            '<div class="tm-tr-main">' +
            '<div class="tm-tr-name">' + esc(it.name) +
            (it.elite ? '<span class="tm-tr-elite">精锐</span>' : '') +
            '</div>' +
            '<p class="tm-tr-text">' + Search.format(stripTriggerTags(it.text)) + '</p>' +
            '</div></li>';
        }
        body += '</ul></section>';
      }
      if (bag.multi) {
        body += '<p class="tm-tr-note">同一词条含多个触发时机会重复出现在多个分组。</p>';
      }
      if (bag.picks) {
        body += '<p class="tm-tr-note">另有 ' + bag.picks + ' 名自选干员暂无词条数据。</p>';
      }
    }

    var sub = traitsLayerOnly
      ? (bag.other
        ? '只看叠层 · 已隐藏 ' + bag.other + ' 条非叠层词条'
        : '只看叠层 · 当前词条均为叠层手段')
      : '按触发时机排序：休整期结束时 → … → 休整期开始时';

    return '<aside class="tm-traits' + (open ? '' : ' is-collapsed') + '" aria-label="配队词条汇总">' +
      '<div class="tm-traits-panel">' +
      '<div class="tm-traits-head">' +
      '<div class="tm-traits-title"><b>词条</b>' +
      '<span class="tm-traits-count" title="共 ' + bag.total + ' 条词条">' + bag.total + '</span></div>' +
      '<button type="button" class="tm-traits-layer" data-traits-layer' +
      ' aria-pressed="' + (traitsLayerOnly ? 'true' : 'false') + '"' +
      ' title="隐藏不增加盟约层数的词条">只看叠层</button>' +
      '<button type="button" class="tm-traits-toggle" data-traits-toggle' +
      ' aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="tm-traits-body"' +
      ' title="收起词条栏">收起</button>' +
      '</div>' +
      '<p class="tm-traits-sub">' + sub + '</p>' +
      '<div class="tm-traits-body" id="tm-traits-body">' + body + '</div>' +
      '</div>' +
      '<button type="button" class="tm-traits-rail" data-traits-toggle' +
      ' aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="tm-traits-body"' +
      ' title="展开词条栏">' +
      '<span class="tm-traits-rail-text">词条</span>' +
      '<span class="tm-traits-rail-count">' + bag.total + '</span>' +
      '<span class="tm-traits-rail-arrow" aria-hidden="true">‹</span>' +
      '<span class="tm-traits-rail-more">展开</span>' +
      '</button>' +
      '</aside>';
  }

  function refreshTraitsPanel() {
    var old = els.cards && els.cards.querySelector('.tm-traits');
    if (old) old.outerHTML = traitsHtml(Store.getTeam());
  }

  function toggleTraitsLayer() {
    traitsLayerOnly = !traitsLayerOnly;
    refreshTraitsPanel();
  }

  function toggleTraits() {
    traitsOpen = !isTraitsOpen();
    var panel = els.cards && els.cards.querySelector('.tm-traits');
    if (panel) panel.classList.toggle('is-collapsed', !traitsOpen);
    var btns = els.cards ? els.cards.querySelectorAll('[data-traits-toggle]') : [];
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-expanded', traitsOpen ? 'true' : 'false');
    }
  }

  /* ---------------- 盟约 / 装备详情（#tip） ---------------- */
  function tipHtmlFor(kind, key) {
    if (kind === 'op') {
      var pk = pickByName[key];
      var op = opByName[key];
      if (!pk && !op) return '';
      var tags = (pk || op).tags || [];
      var meta = pk
        ? ([pk.class, pk.branch].filter(Boolean).join(' / ') + ' · 自选干员')
        : (op.tierLabel + ' 阶 · ' + op.type);
      var normal = pk ? '无特质（自选干员）' : op.normalText;
      var elite = pk ? '无特质（自选干员）' : op.eliteText;
      var price = pk ? 4 : op.price;
      var fac = pk ? (pk.factions || []).join(' / ') : '';
      return '<div class="tip-head"><b>' + esc(key) + '</b>' +
        '<span class="pill ' + (pk ? 'pill-pick' : '') + '">' + esc(meta) + '</span></div>' +
        '<div class="tip-sec"><h4>盟约</h4><p>' + esc(tags.join('、') || '无') + '</p></div>' +
        '<div class="tip-sec"><h4>普通</h4><p>' + Search.format(normal) + '</p></div>' +
        (elite !== normal ? '<div class="tip-sec"><h4>精锐</h4><p>' + Search.format(elite) + '</p></div>' : '') +
        (fac ? '<div class="tip-sec"><h4>阵营</h4><p>' + esc(fac) + '</p></div>' : '') +
        '<div class="tip-foot">售价 ◈' + price + '</div>';
    }
    if (kind === 'item') {
      var it = itemByName[key];
      if (!it) return '';
      var cov = it.covenant ? '所属盟约：' + it.covenant : '所属盟约：未收录';
      if (it.name === Calc.MORPH_ITEM) cov = '在配队里按「另一件装备的所属盟约」给携带者转职';
      return '<div class="tip-head"><b>' + esc(it.name) + '</b>' +
        '<span class="pill">' + esc(it.type) + ' · ' + it.tier + ' 阶</span></div>' +
        '<div class="tip-sec"><h4>基础</h4><p>' + Search.format(it.normalText) + '</p></div>' +
        (it.hasElite ? '<div class="tip-sec"><h4>进阶</h4><p>' + Search.format(it.eliteText) + '</p></div>' : '') +
        '<div class="tip-foot">' + esc(cov) + '　售价 ◈' + it.price + '</div>';
    }

    var c = covByName[key];
    if (!c) return '';
    var res = Calc.evaluate(Store.getTeam(), data);
    var row = null;
    for (var i = 0; i < res.rows.length; i++) if (res.rows[i].name === key) { row = res.rows[i]; break; }
    if (!row) return '';

    var a = c.activation;
    var cond = '';
    if (row.kind === 'elite') {
      cond = '精锐 ' + row.threshold + ' 名激活' + (a.empowerThreshold ? '，' + a.empowerThreshold + ' 名强化' : '');
    } else if (row.kind === 'special') {
      cond = key === '独行' ? '恰好 1 名【独行】生效，2 名及以上失效'
        : (key === '调和' ? '1 名激活，使每个核心盟约的激活人数 +1'
          : '在场 ' + row.threshold + ' 名激活');
    } else if (row.kind === 'count_layer') {
      cond = row.threshold + ' 人激活；层数节点 ' + row.nodes.join(' · ') +
        (row.layer ? '（当前 ' + row.layer + ' 层）' : '（层数未填）');
    } else {
      cond = row.threshold + ' 人激活' + (a.empowerThreshold ? '，' + a.empowerThreshold + ' 人强化' : '');
    }

    var status = STATE_LABEL[row.state] || row.state;
    if (row.state === 'near') status = '缺 ' + row.missing + ' 人';
    else if (row.state === 'active' && row.missingEmpower) status = '已激活，缺 ' + row.missingEmpower + ' 人强化';
    else if (row.state === 'active' && row.kind === 'count_layer' && row.node) status = '已激活，已达 ' + row.node + ' 层节点';

    var num = c.valueText ? renderValue(c.valueText, row.layer) : '';

    return '<div class="tip-head"><b>' + esc(c.name) + '</b>' +
      '<span class="pill ' + (c.rank === 'core' ? 'pill-core' : 'pill-add') + '">' +
      (c.rank === 'core' ? '主盟约' : '副盟约') + '</span></div>' +
      '<div class="tip-sec"><h4>条件</h4><p>' + esc(cond) + '</p>' +
      '<p class="tip-now">当前 <b>' + row.count + ' / ' + row.threshold + '</b>　' + esc(status) +
      (row.bonus ? '　<span class="cov-bonus">调和 +1</span>' : '') + '</p></div>' +
      (num ? '<div class="tip-sec"><h4>数值' + (row.layer ? '（' + row.layer + ' 层）' : '') + '</h4><p>' +
        num + '</p></div>' : '') +
      '<div class="tip-sec"><h4>原文</h4><p>' + Search.format(c.desc) + '</p></div>';
  }

  function tipKeyFor(el) {
    if (el.getAttribute('data-tip-cov')) return 'cov:' + el.getAttribute('data-tip-cov');
    if (el.getAttribute('data-tip-item')) return 'item:' + el.getAttribute('data-tip-item');
    if (el.getAttribute('data-tip-op')) return 'op:' + el.getAttribute('data-tip-op');
    return '';
  }

  /** 点按固定详情：点同一条再点一次收起，点另一条则切换过去 */
  function togglePinTip(el) {
    var same = tip.pinned && els.tip && els.tip.getAttribute('data-for') === tipKeyFor(el);
    tip.pinned = !same;
    if (tip.pinned) showTip(el); else hideTip();
  }

  function showTip(el) {
    if (!els.tip) return;
    var html = '';
    if (el.getAttribute('data-tip-cov')) html = tipHtmlFor('cov', el.getAttribute('data-tip-cov'));
    else if (el.getAttribute('data-tip-item')) html = tipHtmlFor('item', el.getAttribute('data-tip-item'));
    else if (el.getAttribute('data-tip-op')) html = tipHtmlFor('op', el.getAttribute('data-tip-op'));
    if (!html) return;

    els.tip.innerHTML = html;
    els.tip.hidden = false;
    els.tip.setAttribute('data-pinned', tip.pinned ? '1' : '0');
    els.tip.setAttribute('data-for', tipKeyFor(el));
    // 面板里的装备行按整行定位，气泡落在行外，不挡住右侧的进阶 / 加号
    var anchor = (el.closest && el.closest('.pick')) || el;
    var r = anchor.getBoundingClientRect();
    var tw = els.tip.offsetWidth || 320;
    var th = els.tip.offsetHeight || 200;
    var pad = 10, gap = 12;
    var left, top;

    // 优先放右侧，放不下再左侧；两边都不行才退回上下居中。
    // 侧放是为了不盖住盟约块底部的层数输入框。
    left = r.right + gap;
    if (left + tw > global.innerWidth - pad) left = r.left - tw - gap;
    if (left < pad) {
      left = Math.max(pad, Math.min(r.left + r.width / 2 - tw / 2, global.innerWidth - tw - pad));
      top = r.top - th - gap;
      if (top < pad) top = Math.min(r.bottom + gap, global.innerHeight - th - pad);
    } else {
      top = r.top;
      if (top + th > global.innerHeight - pad) top = Math.max(pad, global.innerHeight - th - pad);
    }

    els.tip.style.left = Math.round(left) + 'px';
    els.tip.style.top = Math.round(top) + 'px';
  }

  function hideTip() {
    if (!els.tip) return;
    els.tip.hidden = true;
    els.tip.innerHTML = '';
    tip.pinned = false;
  }

  function onHover(e) {
    // 面板打开时只给面板内的装备行显示详情，避免和底层配队卡抢事件
    if (picker.open && (!e.target || !e.target.closest || !e.target.closest('.sheet [data-tip-item]'))) return;
    // 鼠标进到层数输入框时收起气泡，别挡住输入
    if (e.target && e.target.closest && e.target.closest('.cov-layer')) { hideTip(); return; }
    var el = e.target && e.target.closest ? e.target.closest('[data-tip-cov],[data-tip-item],[data-tip-op]') : null;
    if (!el || tip.pinned) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;  // 在块内部移动不重复定位
    showTip(el);
  }

  function onHoverOut(e) {
    if (tip.pinned) return;
    var el = e.target && e.target.closest ? e.target.closest('[data-tip-cov],[data-tip-item],[data-tip-op]') : null;
    if (!el) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;  // 移入子元素不算移出
    hideTip();
  }

  function onFocusIn(e) {
    if (e.target && e.target.closest && e.target.closest('.cov-layer')) { hideTip(); return; }
    if (picker.open && (!e.target || !e.target.closest || !e.target.closest('.sheet [data-tip-item]'))) return;
    var el = e.target && e.target.closest ? e.target.closest('[data-tip-cov],[data-tip-item],[data-tip-op]') : null;
    if (el) showTip(el);
  }

  /* ---------------- 选人 / 选装备面板 ---------------- */
  function openSheet(slot, mode, gear) {
    ensure();
    var team = Store.getTeam();
    var cur = slot >= 0 ? team.slots[slot] : null;
    var onlyPick = (!mode || mode === 'op') && cur && cur.p;
    picker.open = true;
    picker.mode = mode || 'op';
    picker.slot = slot;
    picker.gear = (typeof gear === 'number') ? gear : -1;
    picker.q = '';
    picker.tiers = onlyPick ? [0] : [];
    picker.tags = [];
    // 进阶开关只对本次面板生效；更换已有装备时按它当前的形态点亮
    picker.eliteMode = {};
    if (picker.mode === 'item' && picker.gear >= 0 && cur && cur.it) {
      var editing = normItem(cur.it[picker.gear]);
      if (editing) picker.eliteMode[editing.k] = !!editing.e;
    }
    // 矮屏（手机横屏）先收起筛选，保证列表还有足够高度；普通竖屏默认展开
    picker.filtersOpen = picker.mode === 'item' || global.innerHeight >= 560;
    hideTip();
    renderSheet();
    els.sheet.hidden = false;
    document.body.classList.add('sheet-open');
    syncScrim();
    setTimeout(function () {
      var q = document.getElementById('pq');
      if (q) q.focus();
    }, 30);
  }

  function closeSheet() {
    if (!picker.open) return;
    picker.open = false;
    picker.slot = -1;
    picker.gear = -1;
    picker.pending = null;
    if (els.sheet) {
      els.sheet.hidden = true;
      els.sheet.innerHTML = '';
    }
    document.body.classList.remove('sheet-open');
    syncScrim();
  }

  function isSheetOpen() { return picker.open; }

  function renderSheet() {
    if (!els.sheet) return;
    els.sheet.innerHTML = picker.open ? pickerHtml() : '';
  }

  function pickerHtml() {
    if (picker.mode === 'share') return shareSheetHtml();
    if (picker.mode === 'import') return importSheetHtml();

    var isItem = picker.mode === 'item';
    var isPick = picker.mode === 'pick';
    var head = sheetHeadTexts();
    var nActive = picker.tiers.length + picker.tags.length;

    var h = '<div class="sheet-in">' +
      '<div class="sheet-head">' +
      '<div class="sheet-title"><b>' + esc(head.title) + '</b>' +
      '<small>' + esc(head.sub) + '</small></div>' +
      (isItem ? '' :
        '<button type="button" class="sheet-fltbtn" data-sheet-filter-toggle aria-controls="sheet-filters"' +
        ' aria-expanded="' + (picker.filtersOpen ? 'true' : 'false') + '" title="展开 / 收起筛选">筛选' +
        (nActive ? '<span class="badge">' + nActive + '</span>' : '') + '</button>') +
      (isPick ? '' :
        '<button type="button" class="sheet-batch" data-batch-toggle aria-pressed="' +
        (picker.batch ? 'true' : 'false') + '" title="连续添加：填完一个自动跳到下一个">连续添加</button>') +
      '<button type="button" class="d-close" data-sheet-close aria-label="关闭">' +
      '<svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>' +
      '</div>';

    h += '<div class="sheet-search">' +
      '<svg class="ico" aria-hidden="true"><use href="#i-search"/></svg>' +
      '<input id="pq" type="search" autocomplete="off" autocapitalize="off" spellcheck="false"' +
      ' placeholder="' + (isItem ? '搜索装备名 / 效果…' : (isPick ? '搜索自选干员 / 阵营 / 盟约…' : '搜索干员名 / 盟约 / 效果…')) + '"' +
      ' aria-label="搜索" value="' + esc(picker.q) + '">' +
      '</div>';

    h += '<div class="sheet-filters' + (!isItem && !picker.filtersOpen ? ' is-collapsed' : '') + '"' +
      (isItem ? '' : ' id="sheet-filters"') + '>' +
      (isPick ? '' : '<div class="sheet-row">' + tierChipsHtml() + '</div>') +
      (isItem ? '' : '<div class="sheet-row sheet-row-tags">' + tagChipsHtml() + '</div>') +
      '</div>';

    h += '<div class="sheet-list">' + listHtml(Store.getTeam()) + '</div>' +
      '</div>';
    return h;
  }

  /** 面板标题与副标题：连续添加换席后要就地更新，不整块重绘 */
  function sheetHeadTexts() {
    var team = Store.getTeam();
    var slot = picker.slot;
    var isItem = picker.mode === 'item';
    var isPick = picker.mode === 'pick';
    var cur = slot >= 0 ? team.slots[slot] : null;
    var curName = cur && cur.p ? cur.p : (cur && cur.k && opByName[cur.k] ? opByName[cur.k].name : '');
    var title, sub = '';

    if (isPick) {
      title = '第 ' + (slot + 1) + ' 席 · 自选干员';
      sub = '6★ · 需自身持有 · 不计入盟约固定 10 人';
    } else if (isItem) {
      title = '第 ' + (slot + 1) + ' 席' + (curName ? ' · ' + curName : '') +
        (picker.gear >= 0 ? ' · 更换装备' : ' · 添加装备');
      sub = '每位干员最多 2 件' + (picker.batch ? ' · 连续添加' : '');
    } else {
      title = (cur && cur.k ? '更换第 ' : '第 ') + (slot + 1) + ' 席';
      sub = picker.batch ? '连续添加 · 点一名填一席' : '场上 ' + countFilled(team) + ' / ' + team.size;
    }
    return { title: title, sub: sub };
  }

  function updateSheetMeta() {
    if (!picker.open || !els.sheet) return;
    var head = sheetHeadTexts();
    var b = els.sheet.querySelector('.sheet-title b');
    var small = els.sheet.querySelector('.sheet-title small');
    if (b) b.textContent = head.title;
    if (small) small.textContent = head.sub;
    var batch = els.sheet.querySelector('[data-batch-toggle]');
    if (batch) batch.setAttribute('aria-pressed', picker.batch ? 'true' : 'false');
    var btn = els.sheet.querySelector('[data-sheet-filter-toggle]');
    if (btn) {
      var badge = btn.querySelector('.badge');
      var n = picker.tiers.length + picker.tags.length;
      if (!n && badge) badge.remove();
      else if (n && !badge) btn.insertAdjacentHTML('beforeend', '<span class="badge">' + n + '</span>');
      else if (badge) badge.textContent = n;
    }
  }

  /* ---------------- 分享 / 导入 ---------------- */
  /** 分享文本：代码 + 可直接打开配队的链接 + 一句说明 */
  function shareText() {
    var team = Store.getTeam();
    var code = global.Code.encode(team, data);
    var origin = global.location && global.location.origin;
    var base;
    if (origin && /^https?:/.test(origin)) base = origin + global.location.pathname;
    else base = String(global.location.href || '').split('#')[0];
    return '【GSPA 配队】' + code + '\n' + base + '#/team?c=' + code +
      '\n我分享了一个卫戍协议配队，快来看看吧';
  }

  function closeBtnHtml() {
    return '<button type="button" class="d-close" data-sheet-close aria-label="关闭">' +
      '<svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>';
  }

  function shareSheetHtml() {
    var text = shareText();
    return '<div class="sheet-in">' +
      '<div class="sheet-head">' +
      '<div class="sheet-title"><b>分享配队</b><small>代码 + 链接 + 一句说明</small></div>' +
      closeBtnHtml() +
      '</div>' +
      '<div class="share-box">' +
      '<textarea id="share-text" class="sheet-ta" rows="7" readonly spellcheck="false">' + esc(text) + '</textarea>' +
      '<p class="share-hint"><b>点链接会直接打开这套配队</b>；也可以把整段粘到「导入」。' +
      '代码用字典压缩，8 人满编约 22 个字符。</p>' +
      '</div>' +
      '<div class="sheet-foot">' +
      '<button type="button" class="btn btn-primary" data-copy-share>复制分享文本</button>' +
      '</div>' +
      '</div>';
  }

  function importSheetHtml() {
    return '<div class="sheet-in">' +
      '<div class="sheet-head">' +
      '<div class="sheet-title"><b>导入配队</b><small>粘贴分享文本或链接，自动识别</small></div>' +
      closeBtnHtml() +
      '</div>' +
      '<div class="share-box">' +
      '<textarea id="import-text" class="sheet-ta" rows="7" spellcheck="false"' +
      ' placeholder="把分享文本整段粘进来，或粘贴带 #/team 的链接…"></textarea>' +
      '<div class="import-state" id="import-state">等待粘贴…</div>' +
      '</div>' +
      '<div class="sheet-foot">' +
      '<button type="button" class="btn" data-sheet-close>取消</button>' +
      '<button type="button" class="btn btn-primary" data-apply-import disabled>应用配队</button>' +
      '</div>' +
      '</div>';
  }

  /** 从一段文本里找分享码；找不到再找 #/team 链接 */
  function parseShareText(text) {
    var raw = String(text == null ? '' : text);
    if (!raw.trim()) return null;

    var dec = global.Code.decode(raw, data);
    if (dec) return dec;

    var m = raw.match(/#\/team[^\s]*/);
    if (m) {
      var parsed = Store.parseHash(m[0]);
      return { team: parsed.team, warnings: [], placed: countFilled(parsed.team) };
    }
    return null;
  }

  function updateImport(text) {
    var box = document.getElementById('import-state');
    var btn = document.querySelector('[data-apply-import]');
    var res = parseShareText(text);
    picker.pending = null;

    if (!res) {
      var empty = !String(text || '').trim();
      if (box) {
        box.className = 'import-state' + (empty ? '' : ' is-bad');
        box.innerHTML = empty ? '等待粘贴…' : '没有识别到配队代码或链接';
      }
      if (btn) btn.disabled = true;
      return;
    }

    picker.pending = res.team;
    var names = [];
    for (var i = 0; i < res.team.slots.length; i++) {
      if (res.team.slots[i]) names.push(res.team.slots[i].k);
    }
    var lay = 0;
    for (var k in res.team.layers) {
      if (res.team.layers.hasOwnProperty(k)) lay++;
    }
    var warn = res.warnings && res.warnings.length
      ? '<em class="is-warn">' + esc(res.warnings.join('；')) + '</em>' : '';

    if (box) {
      box.className = 'import-state is-ok';
      box.innerHTML = '识别到 <b>' + names.length + '</b> 名干员：' + esc(names.join('、')) +
        (lay ? '；层数 ' + lay + ' 项' : '') + warn;
    }
    if (btn) btn.disabled = false;
  }

  function applyImport() {
    if (!picker.pending) return;
    var team = picker.pending;
    picker.pending = null;
    Store.setTeam(team);
    closeSheet();
    toast('已导入配队：' + countFilled(team) + ' 名干员');
  }

  function copyShare() {
    var ta = document.getElementById('share-text');
    copyText(ta ? ta.value : shareText());
  }

  function copyText(text) {
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(function () {
        toast('分享文本已复制');
      }, function () { legacyCopy(text); });
    } else {
      legacyCopy(text);
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
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    toast(ok ? '分享文本已复制' : '复制失败，请手动选中文本复制');
  }

  function tierChipsHtml() {
    var h = '';
    for (var t = 1; t <= 6; t++) {
      var on = picker.tiers.indexOf(t) >= 0;
      h += '<button type="button" class="chip tier-chip" data-ptier="' + t + '" data-tier="' + t + '"' +
        ' aria-pressed="' + (on ? 'true' : 'false') + '">' + roman(t) + '</button>';
    }
    var onPick = picker.tiers.indexOf(0) >= 0;
    h += '<button type="button" class="chip tier-chip" data-ptier="0" data-tier="0"' +
      ' aria-pressed="' + (onPick ? 'true' : 'false') + '">自选</button>';
    return h;
  }

  function tagChipsHtml() {
    var h = '';
    for (var i = 0; i < data.covenants.length; i++) {
      var name = data.covenants[i].name;
      var on = picker.tags.indexOf(name) >= 0;
      h += '<button type="button" class="chip chip-tag" data-ptag="' + esc(name) + '"' +
        ' style="--h:' + UI.hue(name) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<i class="dot"></i>' + esc(name) + '</button>';
    }
    return h;
  }

  function listHtml(team) {
    if (picker.mode === 'pick') return pickListHtml(team);
    return picker.mode === 'item' ? itemListHtml(team) : opListHtml(team);
  }

  function itemListHtml(team) {
    var slot = team.slots[picker.slot];
    var worn = ((slot && slot.it) || []).map(function (x) {
      var it = normItem(x);
      return it ? it.k : '';
    });
    var q = picker.q.toLowerCase();
    var toks = Search.tokens(picker.q);
    var out = '';
    var shown = 0;
    var slotNo = picker.slot + 1;

    if (picker.gear >= 0) {
      out += '<button type="button" class="pick pick-unequip" data-unequip="' + picker.gear + '">' +
        '<span class="pick-main"><span class="pick-name">卸下这件装备</span></span>' +
        '<span class="pick-act">×</span></button>';
    }

    for (var i = 0; i < gearList.length; i++) {
      var it = gearList[i];
      if (picker.tiers.length && picker.tiers.indexOf(it.tier) < 0) continue;
      if (q) {
        var hay = (it.name + ' ' + it.normalText + ' ' + it.eliteText + ' ' + (it.covenant || '')).toLowerCase();
        if (hay.indexOf(q) < 0) continue;
      }
      shown++;

      var wornAt = worn.indexOf(it.name);
      var dup = wornAt >= 0 && wornAt !== picker.gear;
      var current = wornAt >= 0 && wornAt === picker.gear;
      var elite = !!picker.eliteMode[it.name];
      var eff = elite && it.hasElite ? it.eliteText : it.normalText;

      // 一行三块：左侧看详情（悬停 / 点按固定），中间进阶开关，右侧加号添加。
      // 加号必须是真按钮，不能只靠整行点击。
      out += '<div class="pick pick-gear' + (dup ? ' is-used' : '') + '">' +
        '<button type="button" class="pick-hit" data-gear-info="' + esc(it.name) + '"' +
        ' data-tip-item="' + esc(it.name) + '"' +
        ' aria-label="查看装备 ' + esc(it.name) + ' 的详细效果">' +
        UI.iconHtml(it, it.name, 34, 'item', false, true) +
        '<span class="pick-main">' +
        '<span class="pick-name">' + Search.highlight(it.name, toks) + '</span>' +
        '<span class="pick-eff">' + esc(String(eff).split('\n')[0]).slice(0, 42) + '</span>' +
        '</span>' +
        '</button>' +
        (it.hasElite
          ? '<button type="button" class="gear-mode" data-gear-elite="' + esc(it.name) + '"' +
            ' aria-pressed="' + (elite ? 'true' : 'false') + '"' +
            ' title="' + (elite ? '取消进阶，按普通形态装备' : '以进阶形态装备') + '">' +
            (elite ? '取消进阶' : '进阶') + '</button>'
          : '') +
        (current
          ? '<button type="button" class="pick-add" disabled aria-disabled="true"' +
            ' title="第 ' + slotNo + ' 席当前装备的就是这件">当前</button>'
          : dup
            ? '<button type="button" class="pick-add is-used" disabled aria-disabled="true"' +
              ' title="第 ' + slotNo + ' 席已经装着这件装备">已装</button>'
            : '<button type="button" class="pick-add" data-gear="' + esc(it.name) + '"' +
              ' title="添加到第 ' + slotNo + ' 席' + (it.hasElite && elite ? '（进阶形态）' : '') + '"' +
              ' aria-label="添加装备 ' + esc(it.name) + (it.hasElite && elite ? '（进阶）' : '') + '">＋</button>') +
        '</div>';
    }
    if (!shown) out += '<p class="pick-empty">没有匹配的装备</p>';
    return out;
  }

  function opListHtml(team) {
    var used = {};
    var i;
    for (i = 0; i < team.slots.length; i++) {
      if (team.slots[i] && team.slots[i].k) used[team.slots[i].k] = 1;
    }

    var pseudo = {
      view: 'op', q: picker.q, tiers: picker.tiers, tags: picker.tags, tagMode: 'or',
      triggers: [], prices: [], itypes: [], icats: [], otypes: [], ranks: [],
      sort: 'default', hidden: true, sel: null
    };
    var list = Search.filter('op', pseudo);
    var toks = Search.tokens(picker.q);
    var out = '';
    var shown = 0;

    // 自选干员也走「阶数=自选」的普通候选列表，不再单独按钮
    var pickCount = 0;
    for (i = 0; i < team.slots.length; i++) if (team.slots[i] && team.slots[i].p) pickCount++;
    var curPick = picker.slot >= 0 && team.slots[picker.slot] && team.slots[picker.slot].p;
    var canPick = pickCount < 2 || curPick;

    for (i = 0; i < list.length; i++) {
      var op = list[i];
      if (op.pick) {
        var pickUsed = false;
        for (var pk = 0; pk < team.slots.length; pk++) {
          if (team.slots[pk] && team.slots[pk].p === op.name) pickUsed = true;
        }
        var usable = !pickUsed && canPick;
        shown++;
        out += '<button type="button" class="pick pick-pick-item' + (pickUsed ? ' is-used' : '') + '"' +
          (usable ? ' data-choose-pick="' + esc(op.name) + '"' : ' disabled aria-disabled="true"') + '>' +
          UI.avatarHtml(op, op.name, 34, false, true) +
          '<span class="pick-main">' +
          '<span class="pick-name">' + Search.highlight(op.name, toks) + '</span>' +
          '<span class="pick-tags">' + pickTags(op.tags) + '</span>' +
          '<span class="pick-eff">' + esc([op.class, op.branch].filter(Boolean).join(' / ')) +
          (op.factions && op.factions.length ? ' · ' + esc(op.factions.join(' / ')) : '') +
          ' · 不计入盟约固定 10 人</span>' +
          '</span>' +
          '<span class="pick-tier"><span class="tier tier-pick" data-tier="0">自选</span></span>' +
          '<span class="pick-act">' + (pickUsed ? '已在场' : (!canPick ? '已满' : '＋')) + '</span>' +
          '</button>';
        continue;
      }
      shown++;
      var isUsed = !!used[op.name];
      out += '<button type="button" class="pick' + (isUsed ? ' is-used' : '') + '"' +
        (isUsed ? ' disabled aria-disabled="true"' : ' data-pick="' + esc(op.name) + '"') + '>' +
        UI.avatarHtml(op, op.name, 34, false, true) +
        '<span class="pick-main">' +
        '<span class="pick-name">' + Search.highlight(op.name, toks) + '</span>' +
        '<span class="pick-tags">' + pickTags(op.tags) + '</span>' +
        '</span>' +
        '<span class="pick-tier"><span class="tier" data-tier="' + op.tier + '">' + esc(op.tierLabel) + '</span></span>' +
        '<span class="pick-act">' + (isUsed ? '已在场' : '＋') + '</span>' +
        '</button>';
    }

    if (!shown) out = '<p class="pick-empty">没有匹配的干员，试试换个关键词或减少筛选。</p>';
    return out;
  }

  function pickListHtml(team) {
    var used = {};
    var i;
    for (i = 0; i < team.slots.length; i++) {
      if (team.slots[i] && team.slots[i].p) used[team.slots[i].p] = 1;
    }
    var q = (picker.q || '').toLowerCase();
    var toks = Search.tokens(picker.q);
    var out = '';
    var shown = 0;
    var list = data.picks || [];
    var pickCount = 0;
    for (i = 0; i < team.slots.length; i++) if (team.slots[i] && team.slots[i].p) pickCount++;
    var curPick = picker.slot >= 0 && team.slots[picker.slot] && team.slots[picker.slot].p;
    if (pickCount >= 2 && !curPick) {
      return '<p class="pick-empty">自选干员最多 2 名，请先移除一名再添加。</p>';
    }

    for (i = 0; i < list.length; i++) {
      var p = list[i];
      if (picker.tags.length) {
        var hit = false;
        for (var t = 0; t < picker.tags.length; t++) {
          if ((p.tags || []).indexOf(picker.tags[t]) >= 0) { hit = true; break; }
        }
        if (!hit) continue;
      }
      if (q) {
        var hay = [p.name, p.class, p.branch, p.nation,
          (p.factions || []).join(' '), (p.hiddenFactions || []).join(' '),
          (p.tags || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) continue;
      }
      shown++;
      var isUsed = !!used[p.name];
      var cls = [p.class, p.branch].filter(Boolean).join(' / ');
      var fac = (p.factions || []).join(' / ');
      out += '<button type="button" class="pick pick-pick' + (isUsed ? ' is-used' : '') + '"' +
        (isUsed ? ' disabled aria-disabled="true"' : ' data-choose-pick="' + esc(p.name) + '"') + '>' +
        UI.avatarHtml(p, p.name, 34, false, true) +
        '<span class="pick-main">' +
        '<span class="pick-name">' + Search.highlight(p.name, toks) + '</span>' +
        '<span class="pick-tags">' + pickTags(p.tags) + '</span>' +
        '<span class="pick-eff">' + esc(cls + (fac ? ' · ' + fac : '')) + '</span>' +
        '</span>' +
        '<span class="pick-tier"><span class="pill pill-pick">6★</span></span>' +
        '<span class="pick-act">' + (isUsed ? '已选' : '＋') + '</span>' +
        '</button>';
    }
    if (!shown) out = '<p class="pick-empty">没有匹配的自选干员，试试换个关键词或减少筛选。</p>';
    return out;
  }

  function pickTags(tags) {
    var h = '';
    for (var i = 0; i < (tags || []).length; i++) {
      h += '<span class="pick-tag" style="--h:' + UI.hue(tags[i]) + '">' + esc(tags[i]) + '</span>';
    }
    return h || '<span class="pick-tag is-muted">无盟约</span>';
  }

  function refreshList(keepScroll) {
    if (!picker.open || !els.sheet) return;
    var box = els.sheet.querySelector('.sheet-list');
    if (!box) return;
    hideTip();  // 列表重绘后旧气泡的锚点已经不存在了
    var top = keepScroll ? box.scrollTop : 0;
    box.innerHTML = listHtml(Store.getTeam());
    box.scrollTop = top;
  }

  /** 连续添加时只更新标题和列表，保留列表滚动位置，不再整块重绘 */
  function refreshAfterChoice() {
    updateSheetMeta();
    refreshList(true);
  }

  /* ---------------- 操作 ---------------- */
  function pick(name) {
    var team = Store.getTeam();
    var i = picker.slot;
    if (i < 0 || i >= team.size) return;

    if (team.slots[i] && team.slots[i].k === name) {
      if (!picker.batch) closeSheet();
      return;
    }

    team.slots[i] = { k: name, e: false, it: [] };
    Store.setTeam(team);
    toast('第 ' + (i + 1) + ' 席：' + name);

    if (!picker.batch) { closeSheet(); return; }

    // 连续添加：自动跳到下一个空位；满了就收工
    var next = Calc.nextEmptySlot(team.slots, i);
    if (next < 0) {
      closeSheet();
      toast('队伍已满（' + countFilled(team) + ' / ' + team.size + '）');
      return;
    }
    picker.slot = next;
    refreshAfterChoice();
  }

  /** 自选干员：纯 p 席，不依赖占位行；全队最多 2 名 */
  function choosePick(name) {
    var team = Store.getTeam();
    var i = picker.slot;
    if (i < 0 || i >= team.size) return;
    var cur = team.slots[i] || {};
    var pickCount = 0;
    for (var k = 0; k < team.slots.length; k++) {
      if (team.slots[k] && team.slots[k].p) pickCount++;
    }
    if (!cur.p && pickCount >= Calc.RULES.pickLimit) {
      toast('自选干员最多 2 名，请先移除一名');
      return;
    }
    team.slots[i] = { p: name, e: !!cur.e, it: cur.it || [] };
    Store.setTeam(team);
    toast('第 ' + (i + 1) + ' 席：' + name + '（自选干员）');
    closeSheet();
  }

  /** 干员图鉴的「加入 / 移出配队」：普通干员占 k，自选干员占 p */
  function toggleFromList(name) {
    ensure();
    var team = Store.getTeam();
    var i;
    for (i = 0; i < team.slots.length; i++) {
      var s = team.slots[i];
      if (s && (s.k === name || s.p === name)) {
        team.slots[i] = null;
        Store.setTeam(team);
        toast('已移出配队：' + name);
        return;
      }
    }
    var isPick = !!pickByName[name];
    if (isPick) {
      var pc = 0;
      for (i = 0; i < team.slots.length; i++) if (team.slots[i] && team.slots[i].p) pc++;
      if (pc >= Calc.RULES.pickLimit) { toast('自选干员最多 2 名，请先移除一名'); return; }
    }
    var idx = Calc.nextEmptySlot(team.slots, -1);
    if (idx < 0) { toast('队伍已满，请先移除一名干员'); return; }
    team.slots[idx] = isPick ? { p: name, e: false } : { k: name, e: false };
    Store.setTeam(team);
    toast((isPick ? '已加入自选干员：' : '已加入配队：') + name);
  }

  /** 配队页的「批量添加」：从第一个空位开始，连续填 */
  function openBatch() {
    var team = Store.getTeam();
    if (countFilled(team) >= team.size) { toast('队伍已满'); return; }
    picker.batch = true;
    var idx = Calc.nextEmptySlot(team.slots, -1);
    if (idx < 0) return;
    openSheet(idx, 'op', -1);
  }

  function equip(name, elite) {
    var team = Store.getTeam();
    var s = team.slots[picker.slot];
    if (!s) return;

    var entry = { k: name, e: !!elite };
    s.it = s.it || [];
    if (picker.gear >= 0) s.it[picker.gear] = entry;
    else if (s.it.length < Store.ITEMS_MAX) s.it.push(entry);
    else s.it[Store.ITEMS_MAX - 1] = entry;

    var seen = {};
    var dedup = [];
    for (var i = 0; i < s.it.length; i++) {
      var it = normItem(s.it[i]);
      if (!it || seen[it.k]) continue;
      seen[it.k] = 1;
      dedup.push(it);
    }
    s.it = dedup.slice(0, Store.ITEMS_MAX);

    var hasMorph = false;
    for (i = 0; i < s.it.length; i++) if (s.it[i].k === Calc.MORPH_ITEM) hasMorph = true;
    if (!hasMorph) delete s.m;

    Store.setTeam(team);

    if (!picker.batch) { closeSheet(); return; }

    // 连续添加：先补满当前干员的第 2 件，再跳到下一位还有空位的干员
    var next = nextGearTarget(team, picker.slot);
    if (!next) { closeSheet(); toast('没有空余的装备位了'); return; }
    picker.slot = next.slot;
    picker.gear = next.gear;
    refreshAfterChoice();
  }

  /** 进阶开关：已装在本席就直接进阶 / 取消进阶，否则作为下一次添加的形态 */
  function toggleGearElite(name) {
    var on = !picker.eliteMode[name];
    picker.eliteMode[name] = on;

    var team = Store.getTeam();
    var s = picker.slot >= 0 ? team.slots[picker.slot] : null;
    var applied = false;
    if (s && s.it) {
      for (var i = 0; i < s.it.length; i++) {
        var entry = normItem(s.it[i]);
        if (!entry || entry.k !== name) continue;
        s.it[i] = { k: name, e: on };
        applied = true;
      }
    }

    if (applied) {
      Store.setTeam(team);
      toast(name + (on ? '：已进阶' : '：已取消进阶'));
    } else {
      toast(name + (on ? '：本次添加为进阶形态' : '：本次添加为普通形态'));
    }
    refreshList(true);
  }

  /** 谁还能再装：优先当前干员，其次按席位顺序找下一位有空位的 */
  function nextGearTarget(team, from) {
    var n = team.slots.length;
    var first = team.slots[from];
    if (first && first.k && (first.it || []).length < Store.ITEMS_MAX) {
      return { slot: from, gear: -1 };
    }
    for (var k = 1; k <= n; k++) {
      var idx = (from + k) % n;
      if (idx < 0) idx += n;
      var s = team.slots[idx];
      if (s && s.k && (s.it || []).length < Store.ITEMS_MAX) return { slot: idx, gear: -1 };
    }
    return null;
  }

  function unequip(index) {
    var team = Store.getTeam();
    var s = team.slots[picker.slot];
    if (!s || !s.it) return;
    s.it.splice(index, 1);
    if (!s.it.length) delete s.it;
    if (!s.it || s.it.indexOf(Calc.MORPH_ITEM) < 0) delete s.m;
    Store.setTeam(team);
    closeSheet();
  }

  function setMorph(slotIndex, cov) {
    var team = Store.getTeam();
    var s = team.slots[slotIndex];
    if (!s) return;
    if (cov) s.m = cov; else delete s.m;
    Store.setTeam(team);
  }

  function toggleElite(i) {
    var team = Store.getTeam();
    if (!team.slots[i]) return;
    team.slots[i].e = !team.slots[i].e;
    Store.setTeam(team);
  }

  function clearSlot(i) {
    var team = Store.getTeam();
    if (!team.slots[i]) return;
    team.slots[i] = null;
    Store.setTeam(team);
  }

  function addSlot() {
    var team = Store.getTeam();
    if (team.size >= Store.TEAM_MAX) return;
    team.size += 1;
    team.slots.push(null);
    Store.setTeam(team);
    toast('已使用人事部文档：最大可部署人数变为 9');
  }

  function shrinkSlot() {
    var team = Store.getTeam();
    if (team.size <= Store.TEAM_SIZE) return;
    if (team.slots[team.size - 1]) return;
    team.size -= 1;
    team.slots.pop();
    Store.setTeam(team);
  }

  function clearTeam() {
    var team = Store.getTeam();
    if (!countFilled(team)) return;
    if (global.confirm && !global.confirm('清空整支队伍？')) return;
    Store.setTeam(Calc.emptyTeam(team.size));
  }

  function setLayer(name, value) {
    var team = Store.getTeam();
    var n = parseInt(value, 10);
    if (isNaN(n) || n <= 0) delete team.layers[name];
    else team.layers[name] = n;
    Store.setTeam(team);
  }

  function togglePickTier(n) {
    var i = picker.tiers.indexOf(n);
    if (i >= 0) picker.tiers.splice(i, 1);
    else picker.tiers.push(n);
    var chip = els.sheet && els.sheet.querySelector('[data-ptier="' + n + '"]');
    if (chip) chip.setAttribute('aria-pressed', picker.tiers.indexOf(n) >= 0 ? 'true' : 'false');
    updateSheetMeta();
    refreshList(true);
  }

  function togglePickTag(name) {
    var i = picker.tags.indexOf(name);
    if (i >= 0) picker.tags.splice(i, 1);
    else picker.tags.push(name);
    var chips = els.sheet ? els.sheet.querySelectorAll('[data-ptag]') : [];
    for (var k = 0; k < chips.length; k++) {
      var on = picker.tags.indexOf(chips[k].getAttribute('data-ptag')) >= 0;
      chips[k].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    updateSheetMeta();
    refreshList(true);
  }

  function toggleSheetFilters() {
    if (picker.mode === 'item') return;
    picker.filtersOpen = !picker.filtersOpen;
    var box = els.sheet && els.sheet.querySelector('.sheet-filters');
    var btn = els.sheet && els.sheet.querySelector('[data-sheet-filter-toggle]');
    if (box) box.classList.toggle('is-collapsed', !picker.filtersOpen);
    if (btn) btn.setAttribute('aria-expanded', picker.filtersOpen ? 'true' : 'false');
  }

  /* ---------------- 拖拽排序 ---------------- */
  var drag = null;
  var tip = { pinned: false };

  function onPointerDown(e) {
    var grip = e.target && e.target.closest ? e.target.closest('[data-grip]') : null;
    if (!grip) return;
    e.preventDefault();
    e.stopPropagation();
    var from = parseInt(grip.getAttribute('data-grip'), 10);
    drag = { from: from, to: from, x0: e.clientX, y0: e.clientY, started: false, ghost: null, el: null };

    var slotEl = grip.closest('.slot');
    drag.el = slotEl;
    try { grip.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  }

  function onPointerMove(e) {
    if (!drag) return;
    var dx = e.clientX - drag.x0;
    var dy = e.clientY - drag.y0;

    if (!drag.started) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      drag.started = true;
      document.body.classList.add('is-dragging');
      if (drag.el) {
        var r = drag.el.getBoundingClientRect();
        var ghost = drag.el.cloneNode(true);
        ghost.className = 'slot slot-filled drag-ghost';
        ghost.style.width = r.width + 'px';
        ghost.style.height = r.height + 'px';
        document.body.appendChild(ghost);
        drag.ghost = ghost;
        drag.w = r.width;
        drag.h = r.height;
      }
      if (drag.el) drag.el.classList.add('is-drag-source');
    }

    if (drag.ghost) {
      drag.ghost.style.left = (e.clientX - drag.w / 2) + 'px';
      drag.ghost.style.top = (e.clientY - drag.h / 2) + 'px';
    }

    var to = slotIndexAt(e.clientX, e.clientY);
    if (to !== null) drag.to = to;
    markDropTarget(to);
  }

  function onPointerUp(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    document.body.classList.remove('is-dragging');
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d.el) d.el.classList.remove('is-drag-source');
    markDropTarget(null);

    if (!d.started || d.to === d.from || d.to === null) return;

    var team = Store.getTeam();
    var slots = team.slots;
    var moving = slots[d.from];
    if (!moving) return;
    var target = slots[d.to];
    slots[d.to] = moving;
    slots[d.from] = target;   // 与目标席位交换，不能直接把目标覆盖掉
    Store.setTeam(team);
  }

  function slotIndexAt(x, y) {
    var box = els.cards ? els.cards.querySelector('.tm-slots') : null;
    if (!box) return null;
    var nodes = box.querySelectorAll('[data-slot-index]');
    for (var i = 0; i < nodes.length; i++) {
      var r = nodes[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return parseInt(nodes[i].getAttribute('data-slot-index'), 10);
      }
    }
    return null;
  }

  function markDropTarget(idx) {
    var box = els.cards ? els.cards.querySelector('.tm-slots') : null;
    if (!box) return;
    var nodes = box.querySelectorAll('[data-slot-index]');
    for (var i = 0; i < nodes.length; i++) {
      var on = idx !== null && parseInt(nodes[i].getAttribute('data-slot-index'), 10) === idx;
      nodes[i].classList.toggle('is-drop-target', !!on);
    }
  }

  /* ---------------- 事件 ---------------- */
  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var el;

    // 点空白处收起固定的详情（点同一类条目时交给下面的开关处理）
    if (tip.pinned && !t.closest('.tip') && !t.closest('[data-tip-cov]') && !t.closest('[data-gear-info]')) {
      tip.pinned = false;
      hideTip();
    }

    if ((el = t.closest('[data-add-slot]'))) { e.preventDefault(); addSlot(); return; }
    if ((el = t.closest('[data-shrink-slot]'))) { e.preventDefault(); shrinkSlot(); return; }
    if ((el = t.closest('[data-team-share]'))) { e.preventDefault(); openSheet(-1, 'share', -1); return; }
    if ((el = t.closest('[data-team-import]'))) { e.preventDefault(); openSheet(-1, 'import', -1); return; }
    if ((el = t.closest('[data-copy-share]'))) { e.preventDefault(); copyShare(); return; }
    if ((el = t.closest('[data-apply-import]'))) { e.preventDefault(); applyImport(); return; }
    if ((el = t.closest('[data-team-clear]'))) { e.preventDefault(); clearTeam(); return; }
    if ((el = t.closest('[data-traits-layer]'))) { e.preventDefault(); toggleTraitsLayer(); return; }
    if ((el = t.closest('[data-traits-toggle]'))) { e.preventDefault(); toggleTraits(); return; }
    if ((el = t.closest('[data-batch-add]'))) { e.preventDefault(); openBatch(); return; }
    if ((el = t.closest('[data-sheet-filter-toggle]'))) {
      e.preventDefault();
      toggleSheetFilters();
      return;
    }
    if ((el = t.closest('[data-batch-toggle]'))) {
      e.preventDefault();
      picker.batch = !picker.batch;
      updateSheetMeta();
      return;
    }
    if ((el = t.closest('[data-sheet-close]'))) { e.preventDefault(); closeSheet(); return; }
    if ((el = t.closest('[data-ptier]'))) {
      e.preventDefault();
      togglePickTier(parseInt(el.getAttribute('data-ptier'), 10));
      return;
    }
    if ((el = t.closest('[data-ptag]'))) { e.preventDefault(); togglePickTag(el.getAttribute('data-ptag')); return; }
    if ((el = t.closest('[data-pick]'))) { e.preventDefault(); pick(el.getAttribute('data-pick')); return; }
    if ((el = t.closest('[data-choose-pick]'))) {
      e.preventDefault();
      choosePick(el.getAttribute('data-choose-pick'));
      return;
    }
    if ((el = t.closest('[data-gear-elite]'))) {
      e.preventDefault();
      toggleGearElite(el.getAttribute('data-gear-elite'));
      return;
    }
    if ((el = t.closest('[data-gear-info]'))) {
      e.preventDefault();
      togglePinTip(el);
      return;
    }
    if ((el = t.closest('[data-gear]'))) {
      e.preventDefault();
      var gname2 = el.getAttribute('data-gear');
      equip(gname2, !!picker.eliteMode[gname2]);
      return;
    }
    if ((el = t.closest('[data-unequip]'))) {
      e.preventDefault();
      unequip(parseInt(el.getAttribute('data-unequip'), 10));
      return;
    }
    if ((el = t.closest('[data-gear-add]'))) {
      e.preventDefault();
      openSheet(parseInt(el.getAttribute('data-gear-add'), 10), 'item', -1);
      return;
    }
    if ((el = t.closest('[data-gear-open]'))) {
      e.preventDefault();
      openSheet(parseInt(el.getAttribute('data-gear-open'), 10), 'item',
        parseInt(el.getAttribute('data-gear-index'), 10));
      return;
    }
    if ((el = t.closest('[data-elite]'))) {
      e.preventDefault();
      toggleElite(parseInt(el.getAttribute('data-elite'), 10));
      return;
    }
    if ((el = t.closest('[data-slot-clear]'))) {
      e.preventDefault();
      clearSlot(parseInt(el.getAttribute('data-slot-clear'), 10));
      return;
    }
    if ((el = t.closest('[data-slot-open]'))) {
      e.preventDefault();
      openSheet(parseInt(el.getAttribute('data-slot-open'), 10), 'op', -1);
      return;
    }
    // 盟约块：手机端点按 = 钉住详情；点层数输入框不算
    if (t.closest('.cov-layer')) return;
    if ((el = t.closest('[data-tip-cov]'))) {
      togglePinTip(el);
      return;
    }
  }

  function onInput(e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'import-text') { updateImport(t.value); return; }
    if (t.id !== 'pq') return;
    picker.q = t.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(refreshList, 70);
  }

  function onChange(e) {
    var t = e.target;
    if (!t || !t.hasAttribute) return;
    if (t.hasAttribute('data-layer')) {
      setLayer(t.getAttribute('data-layer'), t.value);
    } else if (t.hasAttribute('data-morph')) {
      setMorph(parseInt(t.getAttribute('data-morph'), 10), t.value);
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      if (picker.open) {
        e.preventDefault();
        e.stopPropagation();
        closeSheet();
        return;
      }
      if (tip.pinned) {
        tip.pinned = false;
        hideTip();
      }
    }
  }

  /* ---------------- 小工具 ---------------- */
  function normItem(v) {
    if (!v) return null;
    if (typeof v === 'string') return { k: v, e: false };
    if (v.k) return { k: v.k, e: !!v.e };
    return null;
  }

  function esc(s) { return Search.esc(s); }

  /** 数值排版：结果在前（蓝色）、算式在后（灰色）。例：+113%（23%+0.9%×100） */
  function renderValue(text, layer) {
    var segs = Calc.layerSegments(text, layer);
    var out = '';
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.t === 'num') {
        out += '<b class="num">' + esc(s.v) + '</b>' +
          '<span class="formula">（' + esc(s.f) + '）</span>';
      } else {
        out += Search.format(s.v);
      }
    }
    return out;
  }

  function uniq(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) if (out.indexOf(arr[i]) < 0) out.push(arr[i]);
    return out;
  }

  function toast(msg) {
    if (global.App && global.App.toast) global.App.toast(msg);
  }

  function syncScrim() {
    if (global.App && global.App.syncScrim) global.App.syncScrim();
  }

  function countFilled(team) {
    var n = 0;
    for (var i = 0; i < team.slots.length; i++) if (team.slots[i]) n++;
    return n;
  }

  function roman(n) {
    return ['', 'I', 'II', 'III', 'IV', 'V', 'VI'][n] || String(n);
  }

  global.Team = {
    init: init,
    render: viewHtml,
    openSheet: openSheet,
    closeSheet: closeSheet,
    isSheetOpen: isSheetOpen,
    hideTip: hideTip,
    toggleFromList: toggleFromList,
    // 供测试 / 调试
    shareText: shareText,
    parseShareText: parseShareText,
    _isLayerTrait: isLayerTrait
  };
})(window);
