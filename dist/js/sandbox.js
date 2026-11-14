(function () {
  'use strict';

  const DATA = window.GSPA_DATA;
  const RANGES = window.GSPA_RANGES;
  const CORE = window.StackCore;
  if (!DATA || !RANGES || !window.Calc) {
    document.body.innerHTML = '<p style="padding:24px;color:#ffb3a7">数据加载失败：请确认 data/data.js、data/ranges.js、js/calc.js 存在。</p>';
    return;
  }
  if (!CORE) {
    document.body.innerHTML = '<p style="padding:24px;color:#ffb3a7">沙盒内核加载失败：请确认 js/stack-core.js 存在。</p>';
    return;
  }

  const OP = {};
  DATA.operators.forEach(o => { OP[o.name] = o; });

  // 装备索引：沙盒只结算“转职（变形同构体）”与效果描述，不把数值加成写进叠层。
  const GEAR_ITEMS = (DATA.items || []).filter(function (it) { return it && it.type === '装备'; });
  const GEAR_BY_NAME = {};
  GEAR_ITEMS.forEach(function (it) { GEAR_BY_NAME[it.name] = it; });

  let MAP_W = 9;
  let MAP_H = 5;
  const MAX_BOARD = 8;
  const MAX_HAND = 10;
  const INITIAL_HAND = [];

  // 默认空白地图：全部地面；顶部「更换战场」可按官方图片载入规程预设
  let MAP = Array.from({ length: MAP_H }, function () { return Array(MAP_W).fill('ground'); });
  // 箱子是独立图层：只记录坐标，渲染时叠加在地块上，不替换地形
  let MAP_BOX = Array.from({ length: MAP_H }, function () { return Array(MAP_W).fill(false); });
  // 地形口径与官方对齐：可部署地面 / 高台 / 特殊高台 / 不可部署 / 不可通行 / 侵入点 / 终点 / 传送点
  const TERRAIN = {
    ground:      { label: '地面', key: 'tile_road', deploy: 'all', walk: true, note: '地面部署位；远程单位也可部署于近战位。' },
    high:        { label: '高台', key: 'tile_wall', deploy: 'ranged', walk: false, note: '高台部署位，仅远程单位可部署。' },
    highAny:     { label: '高台', key: 'tile_acplatform', deploy: 'all', walk: false, note: '高台部署位，任意单位可部署。' },
    highSpecial: { label: '特殊高台', key: 'tile_fence_bound', deploy: 'all', walk: false, note: '边界特殊高台，任意单位可部署。' },
    box:         { label: '箱子', key: 'trap_1105_accrate', deploy: 'none', walk: false, note: '场地上的箱子，占据该格，不可部署、不可通行。' },
    floor:       { label: '不可部署', key: 'tile_floor', deploy: 'none', walk: true, note: '可通行，但不能部署干员。' },
    fence:       { label: '围墙', key: 'tile_fence_bound(旧)', deploy: 'none', walk: false, note: '旧版地形键，仅用于兼容旧存档。' },
    void:        { label: '不可通行', key: 'tile_forbidden / tile_acempty', deploy: 'none', walk: false, note: '场外或障碍区域，不可通行、不可部署。' },
    spawn:       { label: '侵入点', key: 'tile_start', deploy: 'none', walk: true, note: '敌方侵入点，可通行但不可部署。' },
    goal:        { label: '终点', key: 'tile_end', deploy: 'none', walk: true, note: '我方终点，可通行但不可部署。' },
    telin:       { label: '传送入口', key: 'tile_telin', deploy: 'none', walk: true, note: '传送入口，可通行但不可部署。' },
    telout:      { label: '传送出口', key: 'tile_telout', deploy: 'none', walk: true, note: '传送出口，可通行但不可部署。' },
    mire:        { label: '沼泽', key: 'tile_mire', deploy: 'all', walk: true, note: '旧数据地形，保留兼容。' },
    infection:   { label: '活性源石', key: 'tile_infection', deploy: 'all', walk: true, note: '旧数据地形，保留兼容。' },
    speedup:     { label: '加速地面', key: 'tile_speedup', deploy: 'all', walk: true, note: '旧数据地形，保留兼容。' },
    duel:        { label: '决斗草地', key: 'tile_duel_grassland', deploy: 'all', walk: true, note: '旧数据地形，保留兼容。' }
  };

  const MAP_STORAGE_KEY = 'gspa_sandbox_map';
  const MAP_MIN_W = 3, MAP_MAX_W = 21, MAP_MIN_H = 3, MAP_MAX_H = 13;
  let CURRENT_PRESET = '';

  function presetById(id) {
    const P = window.GSPA_MAPS;
    if (!P || !Array.isArray(P.maps) || !id) return null;
    for (let i = 0; i < P.maps.length; i++) if (P.maps[i].id === id) return P.maps[i];
    return null;
  }

  function boxAt(r, c) {
    return !!(MAP_BOX[r] && MAP_BOX[r][c]);
  }

  function buildBoxGrid(list) {
    const grid = Array.from({ length: MAP_H }, function () { return Array(MAP_W).fill(false); });
    (list || []).forEach(function (p) {
      if (Array.isArray(p) && p.length >= 2) {
        const r = Number(p[0]), c = Number(p[1]);
        if (r >= 0 && r < MAP_H && c >= 0 && c < MAP_W) grid[r][c] = true;
      }
    });
    return grid;
  }

  function boxList() {
    const out = [];
    for (let r = 0; r < MAP_H; r++) for (let c = 0; c < MAP_W; c++) if (boxAt(r, c)) out.push([r, c]);
    return out;
  }

  function loadStoredMap() {
    try {
      const raw = localStorage.getItem(MAP_STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      const w = Number(obj && obj.w), h = Number(obj && obj.h);
      if (!(w >= MAP_MIN_W && w <= MAP_MAX_W && h >= MAP_MIN_H && h <= MAP_MAX_H) || !Array.isArray(obj.tiles)) return;
      if (obj.tiles.length !== h || obj.tiles.some(function (row) { return !Array.isArray(row) || row.length !== w; })) return;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        if (!TERRAIN[obj.tiles[r][c]]) return;
      }
      MAP_W = w;
      MAP_H = h;
      MAP = obj.tiles.map(function (row) { return row.slice(); });
      MAP_BOX = buildBoxGrid(obj.boxes);
      CURRENT_PRESET = presetById(obj.preset) ? obj.preset : '';
    } catch (e) { /* 回退默认 9×5 */ }
  }

  function persistMap() {
    try {
      localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify({
        w: MAP_W, h: MAP_H, preset: CURRENT_PRESET || '',
        tiles: MAP.map(function (row) { return row.slice(); }),
        boxes: boxList()
      }));
    } catch (e) { /* 隐私模式等写入失败时忽略 */ }
  }

  function updateMapHead() {
    if (mapSizeLabel) mapSizeLabel.textContent = MAP_W + ' × ' + MAP_H + ' · 部署 8';
    const preset = presetById(CURRENT_PRESET);
    if (mapNameEl) mapNameEl.textContent = preset ? preset.title : '空白训练场';
    if (mapThumbEl) {
      if (preset) {
        mapThumbEl.src = preset.image;
        mapThumbEl.alt = preset.title;
        mapThumbEl.style.display = '';
      } else {
        mapThumbEl.style.display = 'none';
      }
    }
  }

  // 棋盘自适应：小图放大格子，宽图缩小，保证一格里的图标可读
  function fitBoard() {
    if (!boardEl || !boardEl.style || typeof boardEl.style.setProperty !== 'function') return;
    const avail = boardScrollEl && boardScrollEl.clientWidth ? boardScrollEl.clientWidth - 30 : 860;
    let cell = Math.floor((avail - (MAP_W - 1) * 3) / MAP_W);
    cell = Math.max(28, Math.min(72, cell));
    boardEl.style.setProperty('--cell', cell + 'px');
    boardEl.style.setProperty('--map-w', MAP_W);
  }

  function applyPreset(preset, opts) {
    if (!preset || !Array.isArray(preset.tiles) || !preset.tiles.length) return false;
    opts = opts || {};
    if (!opts.force && state && state.board.length && !window.confirm('切换至「' + preset.title + '」将清空已部署的干员，是否继续？')) return false;
    MAP_W = preset.w;
    MAP_H = preset.h;
    MAP = preset.tiles.map(function (row) { return row.slice(); });
    MAP_BOX = buildBoxGrid(preset.boxes);
    CURRENT_PRESET = preset.id;
    if (state) {
      state.board = [];
      state.pending = null;
      state.selectedOp = null;
      state.mode = 'idle';
      closeGearEditor();
    }
    persistMap();
    renderAll();
    toast('已载入 ' + preset.title + ' · ' + preset.w + '×' + preset.h);
    return true;
  }

  function openMapPicker() {
    if (!mapModal || !mapModalCard || !window.GSPA_MAP_PICKER) {
      toast('地图数据未加载，无法选择战场');
      return;
    }
    window.GSPA_MAP_PICKER.mount(mapModalCard, {
      current: CURRENT_PRESET,
      onClose: closeMapPicker,
      onPick: function (preset) {
        if (applyPreset(preset)) closeMapPicker();
      }
    });
    mapModal.hidden = false;
    if (mapModalCard.scrollHeight) mapModalCard.scrollTop = 0;
  }

  function closeMapPicker() {
    if (mapModal) mapModal.hidden = true;
  }

  const POS_OVERRIDES = {
    '灰喉': 'ranged', '复奏': 'ranged', '夏栎': 'ranged', '星源': 'ranged',
    '慕斯': 'melee', '烈夏': 'ranged', '折桠': 'melee', '地灵': 'ranged',
    '陨星': 'ranged', '斯卡蒂': 'melee', 'Miss.Christine': 'ranged', '白铁': 'melee',
    '怒潮凛冬': 'melee', '黑键': 'ranged', 'W': 'ranged', '幽灵鲨': 'melee',
    '歌蕾蒂娅': 'melee', '流明': 'ranged', '棘刺': 'melee', '蓝毒': 'ranged',
    '艾雅法拉': 'ranged', '魔王': 'ranged'
  };
  const OP_META = {};
  const ALL_OP_NAMES = [];

  const OP_RANGES = window.GSPA_OP_RANGES || {};
  DATA.operators.forEach(function (o) {
    const r = OP_RANGES[o.name] || { normal: '1-1', elite: '1-1' };
    OP_META[o.name] = {
      name: o.name, tier: o.tier, tierLabel: o.tierLabel || String(o.tier || ''),
      tags: o.tags || [], price: o.price != null ? o.price : 0,
      type: o.type || '', hidden: !!o.hidden,
      normalText: o.normalText || '', eliteText: o.eliteText || '',
      normalTrigger: o.normalTrigger || '', eliteTrigger: o.eliteTrigger || '',
      normalTriggers: o.normalTriggers || (o.normalTrigger ? [o.normalTrigger] : []),
      eliteTriggers: o.eliteTriggers || (o.eliteTrigger ? [o.eliteTrigger] : []),
      avatar: o.avatar || '', source: '干员表',
      rangeNormal: r.normal || '1-1', rangeElite: r.elite || '1-1',
      pos: (window.GSPA_OP_POSITIONS && window.GSPA_OP_POSITIONS[o.name]) || POS_OVERRIDES[o.name] || ''
    };
    ALL_OP_NAMES.push(o.name);
  });

  (DATA.picks || []).forEach(function (p) {
    if (OP_META[p.name]) return;
    const r = OP_RANGES[p.name] || { normal: '1-1', elite: '1-1' };
    OP_META[p.name] = {
      name: p.name, tier: 6, tierLabel: 'VI', tags: p.tags || [], price: p.price != null ? p.price : 4,
      type: '自选干员', hidden: false,
      normalText: '', eliteText: '', normalTrigger: '', eliteTrigger: '',
      normalTriggers: [], eliteTriggers: [],
      avatar: p.avatar || '', source: '自选干员',
      class: p.class || '', branch: p.branch || '', nation: p.nation || '',
      rangeNormal: r.normal || '1-1', rangeElite: r.elite || '1-1',
      pos: (window.GSPA_OP_POSITIONS && window.GSPA_OP_POSITIONS[p.name]) || 'ranged'
    };
    ALL_OP_NAMES.push(p.name);
  });

  const DIRS = ['right', 'down', 'left', 'up'];
  const DIR_LABEL = { right: '右', down: '下', left: '左', up: '上' };
  const DIR_ROT = { right: 0, down: 90, left: 180, up: 270 };

  const EVENT_LABEL = {
    onGain: '获得时',
    onRefresh: '刷新',
    onPrepStart: '进入休整期',
    onPrepEnd: '休整期结束',
    onBattleStart: '作战开始',
    onBattleEnd: '作战结束',
    onDeploy: '部署',
    onSkill: '开启技能',
    onKill: '击倒敌人',
    onKnockdown: '我方被击倒',
    onSubstitute: '替身切换',
    onSell: '售出',
    onCombat: '战斗中',
    onPassive: '被动'
  };

  // 全量规则由 data/operator_rules.js 提供；这里只补生成器无法直接推导的特殊叠层规则。
  // 注意：replaceSpecial 会把该干员原有「special」条目替换掉（那些条目本来也无法结算），
  // 换成真正可结算的字段，避免同一条效果既显示“未模拟”又实际生效。
  const EXTRA_RULES = {
    '渡桥': {
      replaceSpecial: true,
      rules: [
        { event: 'onPrepEnd', bonds: 'active', amount: 2, requireActive: true, target: 'selfAndFront1', elite: false, text: '<休整期结束时>使自身及身前一格干员已激活的盟约层数+2' },
        { event: 'onPrepEnd', bonds: 'active', amount: 4, requireActive: true, target: 'selfAndFront1', elite: true, text: '<休整期结束时>使自身及身前一格干员已激活的盟约层数+4' }
      ]
    },
    '空弦': {
      replaceSpecial: true,
      rules: [
        { event: 'onPrepStart', bonds: 'active', amount: 3, requireActive: true, target: 'selfAndFront1', elite: false, text: '<进入休整期时>使自身及身前一格干员已激活的盟约层数+3' },
        { event: 'onPrepStart', bonds: 'active', amount: 6, requireActive: true, target: 'selfAndFront1', elite: true, text: '<进入休整期时>使自身及身前一格干员已激活的盟约层数+6' }
      ]
    },
    '青枳': {
      replaceSpecial: true,
      rules: [
        { event: 'onPrepStart', bonds: 'active', amount: 3, requireActive: true, target: 'selfAndBehind1', elite: false, text: '<进入休整期时>使自身及身后一格干员已激活的盟约层数+3' },
        { event: 'onPrepStart', bonds: 'active', amount: 6, requireActive: true, target: 'selfAndBehind1', elite: true, text: '<进入休整期时>使自身及身后一格干员已激活的盟约层数+6' }
      ]
    },
    '帕拉斯': {
      replaceSpecial: true,
      rules: [
        { event: 'onPrepEnd', bonds: 'active', amount: 9, requireActive: true, target: 'selfAndFront1', elite: false, text: '<休整期结束时>使自身以及身前一格干员已激活的盟约层数+9' },
        { event: 'onPrepEnd', bonds: 'active', amount: 18, requireActive: true, target: 'selfAndFront1', elite: true, text: '<休整期结束时>使自身以及身前一格干员已激活的盟约层数+18' }
      ]
    },
    '旅骨': {
      replaceSpecial: true,
      rules: [
        { event: 'onPrepEnd', bonds: 'active', amount: 1, priceTarget: true, requireActive: true, target: 'selfAndFront1', elite: false, text: '<休整期结束时>使自身及身前一格干员已激活的盟约叠加等同于其售出价格的层数' },
        { event: 'onPrepEnd', bonds: 'active', amount: 1, priceTarget: true, priceMul: 2, requireActive: true, target: 'selfAndFront1', elite: true, text: '<休整期结束时>使自身及身前一格干员已激活的盟约叠加等同于其售出价格2倍的层数' }
      ]
    },
    '罗比菈塔': {
      replaceSpecial: true,
      rules: [
        { event: 'onPrepEnd', bonds: ['坚守', '助力'], amount: 2, perRow: true, requireActive: true, elite: false, text: '<休整期结束时>同一行每有1名干员，使已激活的【坚守】【助力】层数+2' },
        { event: 'onPrepEnd', bonds: ['坚守', '助力'], amount: 4, perRow: true, requireActive: true, elite: true, text: '<休整期结束时>同一行每有1名干员，使已激活的【坚守】【助力】层数+4' }
      ]
    },
    '维娜·维多利亚': {
      replaceSpecial: true,
      rules: [
        { event: 'onPrepEnd', bonds: ['维多利亚', '奇迹'], amount: 2, perDistinctTier: '维多利亚', requireActive: true, elite: false, text: '<休整期结束时>场上每有一名不同阶的【维多利亚】干员，使已激活的【维多利亚】【奇迹】层数+2' },
        { event: 'onPrepEnd', bonds: ['维多利亚', '奇迹'], amount: 4, perDistinctTier: '维多利亚', requireActive: true, elite: true, text: '<休整期结束时>场上每有一名不同阶的【维多利亚】干员，使已激活的【维多利亚】【奇迹】层数+4' }
      ]
    },
    '淬羽赫默': {
      replaceSpecial: true,
      rules: [
        { event: 'onPrepEnd', bonds: 'active', amount: 1, requireActive: true, target: 'bench', elite: false, text: '<休整期结束时>使整备区每名干员已激活的盟约层数+1' },
        { event: 'onPrepEnd', bonds: 'active', amount: 2, requireActive: true, target: 'bench', elite: true, text: '<休整期结束时>使整备区每名干员已激活的盟约层数+2' }
      ]
    },
    '乌啾': {
      replaceSpecial: true,
      rules: [
        { event: 'onPrepStart', convert: { bond: '乌萨斯', amount: 1, perTag: '乌萨斯' }, elite: false, text: '<进入休整期时>场上每有一名【乌萨斯】干员，转化1层【乌萨斯】临时层数为固定层数' },
        { event: 'onPrepStart', convert: { bond: '乌萨斯', amount: 2, perTag: '乌萨斯' }, elite: true, text: '<进入休整期时>场上每有一名【乌萨斯】干员，转化2层【乌萨斯】临时层数为固定层数' }
      ]
    },
    'Mon3tr': {
      replaceSpecial: true,
      rules: [
        { event: 'onCombat', passive: true, capAura: { type: 'pct', value: 0.3, target: 'adjacent', order: 10 }, elite: false, text: '<战斗中>周围八格干员每场战斗的叠层上限+30%' },
        { event: 'onCombat', passive: true, capAura: { type: 'pct', value: 0.6, target: 'adjacent', order: 10 }, elite: true, text: '<战斗中>周围八格干员每场战斗的叠层上限+60%' }
      ]
    },
    '凛御银灰': {
      replaceSpecial: true,
      rules: [
        { event: 'onCombat', passive: true, capAura: { type: 'pct', value: 0.75, target: 'front', requireTags: ['谢拉格', '灵巧'], order: 30 }, elite: false, text: '<战斗中>身前一格【谢拉格】【灵巧】干员每场战斗的叠层上限+75%' },
        { event: 'onCombat', passive: true, capAura: { type: 'pct', value: 1.5, target: 'front', requireTags: ['谢拉格', '灵巧'], order: 30 }, elite: true, text: '<战斗中>身前一格【谢拉格】【灵巧】干员每场战斗的叠层上限+150%' }
      ]
    },
    '浊心斯卡蒂': {
      replaceSpecial: true,
      rules: [
        { event: 'onCombat', passive: true, elite: false, text: '<战斗中>攻击范围内每有一名我方干员部署使已激活的【阿戈尔】层数+2（每场战斗至多叠加20层）' },
        { event: 'onCombat', passive: true, elite: true, text: '<战斗中>攻击范围内每有一名我方干员部署使已激活的【阿戈尔】层数+4（每场战斗至多叠加40层）' }
      ]
    },
    '阿米娅（医疗形态）': {
      replaceSpecial: true,
      rules: [
        { event: 'onCombat', passive: true, layerGainAura: { target: 'front', amount: 1 }, elite: false, text: '<战斗中>身前一格干员提升盟约层数时，每次提升的层数额外+1（不受叠层上限影响）' },
        { event: 'onCombat', passive: true, layerGainAura: { target: 'front', amount: 2 }, elite: true, text: '<战斗中>身前一格干员提升盟约层数时，每次提升的层数额外+2（不受叠层上限影响）' }
      ]
    }
  };

  const RULES = {};
  DATA.operators.forEach(function (o) {
    RULES[o.name] = (window.GSPA_RULES && window.GSPA_RULES[o.name] ? window.GSPA_RULES[o.name] : []).slice();
  });
  (DATA.picks || []).forEach(function (p) {
    if (!RULES[p.name]) RULES[p.name] = [];
  });
  Object.keys(EXTRA_RULES).forEach(function (name) {
    const extra = EXTRA_RULES[name];
    let base = RULES[name] || [];
    if (extra.replaceSpecial) base = base.filter(function (r) { return !r.special; });
    RULES[name] = base.concat(extra.rules || []);
  });
  // 生成器无法从文本直接推出的少量补丁
  (RULES['极光'] || []).forEach(function (r) {
    if (r.event === 'onGain' && !r.special) r.perTotal = 12;
  });
  (RULES['荒芜拉普兰德'] || []).forEach(function (r) {
    if (r.event === 'onKill' && r.elite) {
      r.teamWide = true;
      r.teamWideKill = { killerTag: '叙拉古' };
    }
  });
  (RULES['薇薇安娜'] || []).forEach(function (r) {
    if (r.battleCapAura) {
      r.passive = true;
      r.capAura = { type: 'flat', value: r.battleCapAura, target: 'sharedTag', order: 20 };
      r.text = '<战斗中>场上其他与自身拥有相同盟约的干员在本回合战斗期的叠层上限+' + r.battleCapAura;
    }
  });
  // 文本生成器的事件修正：这些干员的触发词与自动推断不一致。
  // 只修 event，不改数值；其中多数仍是 special，等 onKnockdown/onKill 真正接入后才会结算。
  const EVENT_FIXES = {
    '远牙': { from: 'onDeploy', to: 'onKill' },
    '耀骑士临光': { from: 'onKill', to: 'onKnockdown' },
    '归溟幽灵鲨': { from: 'onKill', to: 'onKnockdown' },
    '风丸': { from: 'onKill', to: 'onKnockdown' },
    '历阵锐枪芬': { from: 'onDeploy', to: 'onKnockdown' }
  };
  Object.keys(EVENT_FIXES).forEach(function (name) {
    const fix = EVENT_FIXES[name];
    (RULES[name] || []).forEach(function (r) {
      if (r.event === fix.from) r.event = fix.to;
    });
  });

  const boardEl = document.getElementById('board');
  const mapSizeLabel = document.getElementById('mapSizeLabel');
  const mapNameEl = document.getElementById('mapName');
  const mapThumbEl = document.getElementById('mapThumb');
  const mapPickBtn = document.getElementById('mapPickBtn');
  const mapModal = document.getElementById('mapModal');
  const mapModalCard = document.getElementById('mapModalCard');
  const boardScrollEl = document.querySelector('.board-scroll');
  const handEl = document.getElementById('handList');
  const warehouseEl = document.getElementById('warehouseList');
  const warehouseCountEl = document.getElementById('warehouseCount');
  const handPanelEl = document.getElementById('handPanel');
  const handCountEl = document.getElementById('handCount');
  const refreshCountEl = document.getElementById('refreshCount');
  const refreshBtn = document.getElementById('refreshBtn');
  const freePlus = document.getElementById('freePlus');
  const freeMinus = document.getElementById('freeMinus');
  const freeCountEl = document.getElementById('freeCount');
  const clearHandBtn = document.getElementById('clearHandBtn');
  const whSearch = document.getElementById('whSearch');
  const whFilters = document.getElementById('whFilters');
  const whTierChips = document.getElementById('whTierChips');
  const whCovChips = document.getElementById('whCovChips');
  const whTriggerChips = document.getElementById('whTriggerChips');
  const whFilterToggle = document.getElementById('whFilterToggle');
  const whFilterBadge = document.getElementById('whFilterBadge');
  const whTagMode = document.getElementById('whTagMode');
  const importCodeBtn = document.getElementById('importCodeBtn');
  const teamFilterBtn = document.getElementById('teamFilterBtn');
  const whClearAllBtn = document.getElementById('whClearAllBtn');
  const inspectorEl = document.getElementById('inspector');
  const gearModal = document.getElementById('gearModal');
  const gearTitleEl = document.getElementById('gearTitle');
  const gearSubEl = document.getElementById('gearSub');
  const gearEquippedEl = document.getElementById('gearEquipped');
  const gearListEl = document.getElementById('gearList');
  const gearSearchEl = document.getElementById('gearSearch');
  const bondStripEl = document.getElementById('bondStrip');
  const bondPopEl = document.getElementById('bondPop');
  const bondSummaryEl = document.getElementById('bondSummary');
  const clearLayersBtn = document.getElementById('clearLayersBtn');
  const logsPanel = document.getElementById('logsPanel');
  const logToggle = document.getElementById('logToggle');
  const reportPanel = document.getElementById('reportPanel');
  const reportTitle = document.getElementById('reportTitle');
  const reportBody = document.getElementById('reportBody');
  const reportRound = document.getElementById('reportRound');
  const reportToggle = document.getElementById('reportToggle');
  const reportClose = document.getElementById('reportClose');
  const sandboxShareBtn = document.getElementById('sandboxShareBtn');
  const sandboxSharePanel = document.getElementById('sandboxSharePanel');
  const sandboxShareClose = document.getElementById('sandboxShareClose');
  const sandboxCodeText = document.getElementById('sandboxCodeText');
  const sandboxCopyBtn = document.getElementById('sandboxCopyBtn');
  const sandboxImportBtn = document.getElementById('sandboxImportBtn');
  const sandboxDownloadBtn = document.getElementById('sandboxDownloadBtn');
  const sandboxShareStatus = document.getElementById('sandboxShareStatus');
  const copyLogBtn = document.getElementById('copyLogBtn');
  const exportDiagBtn = document.getElementById('exportDiagBtn');
  const logListEl = document.getElementById('logList');
  const hintEl = document.getElementById('hint');
  const eventBarEl = document.getElementById('eventBar');
  const combatBar = document.getElementById('combatBar');
  const roundBadgeEl = document.getElementById('roundBadge');
  const phaseBadgeEl = document.getElementById('phaseBadge');
  const phaseProgress = document.getElementById('phaseProgress');
  const toastEl = document.getElementById('toast');
  const tipEl = document.getElementById('tip');
  const resetBtn = document.getElementById('resetBtn');
  const clearLogBtn = document.getElementById('clearLog');

  let state = null;
  let ledger = null;
  // 装备编辑面板状态：只作用于场上已放置的干员。
  const gearEditor = { open: false, uid: 0, q: '', eliteMode: {} };
  const BUS = CORE.createEventBus();
  let toastTimer = 0;
  let drag = null;
  let lastDragEnd = 0;
  let tipTarget = null;

  const EVENT_TIP = {
    prepStart: '开始本回合休整期，重置本回合叠加上限；触发「进入休整期时」词条。',
    prepEnd: '结束休整期，触发「休整期结束时」与「作战开始时」词条。',
    battleStart: '作战开始时触发，由「休整期结束」自动进入。',
    battleEnd: '结束作战期，触发「作战结束时」词条并进入下一回合休整期。',
    battleCap: '测试功能：将场上所有「战斗中·每回合 / 每场战斗至多叠加」的叠层与已获得特质补至上限；不触发击倒、开启技能等其他条件。',
    skill: '对选中干员触发「开启技能时」词条，需要处于作战期。',
    knockdown: '对选中干员触发「我方被击倒时」词条；仅触发已实装规则，特殊条目仍会提示未模拟。',
    gain: '对「待部署区」当前选中的干员触发「获得时」词条；每次获得仅触发一次。',
    refresh: '本回合刷新次数 +1，并触发「刷新时」词条（复奏等，待部署区同样生效）。',
    killEnemy: '选中干员后点击：由该干员击倒，并强制触发其击倒范围词条一次；未选中干员时：进入选择地块模式，按地块范围内干员结算。'
  };

  function initState() {
    return {
      round: 1,
      roundStarted: false,
      phase: 'prep',
      prepStarted: false,
      hand: INITIAL_HAND.map(function (name, i) { return { id: 'h' + (i + 1), name: name, elite: false, gained: false }; }),
      warehouse: ALL_OP_NAMES.slice(),
      board: [],
      enemies: [],
      layers: {},
      temp: {},
      refreshes: 0,
      freeRefreshes: 0,
      freeGainCounts: {},
      roundGains: 0,
      stackEvents: [],
      grantedTraits: [],
      sellPriceBonus: {},
      battleStartDone: false,
      egirStarted: false,
      metrics: CORE.createMetrics(),
      lastReport: null,
      counters: {},
      battleCounters: {},
      totalCounters: {},
      gained: new Set(),
      logs: [],
      selectedHand: null,
      selectedWarehouse: null,
      selectedOp: null,
      pending: null,
      teamFilter: [],
      whFilter: { q: '', tiers: [], tags: [], triggers: [], tagMode: 'or', onlyTeam: false },
      whFiltersOpen: true,
      mode: 'idle',
      uid: 100
    };
  }

  function covTags(tags) {
    return (tags || []).map(function (t) {
      const c = DATA.covenants.find(function (x) { return x.name === t; });
      const icon = c && c.icon ? '<img src="' + esc(c.icon) + '" alt="">' : '';
      return '<span class="cov-tag" title="' + esc(t) + '">' + icon + '<span class="ct-name">' + esc(t) + '</span></span>';
    }).join('');
  }

  /** 单独一枚盟约小图标（用在只有名字的紧凑行里） */
  function covIcon(name) {
    const c = DATA.covenants.find(function (x) { return x.name === name; });
    return c && c.icon ? '<img class="cov-ico" src="' + esc(c.icon) + '" alt="">' : '';
  }

  function eliteIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 2.1 20.7 7v10L12 21.9 3.3 17V7Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="m7.4 11.5 4.6-3.4 4.6 3.4M7.4 15.4l4.6-3.4 4.6 3.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<text x="12" y="20.4" text-anchor="middle" font-size="4.8" font-weight="700" fill="currentColor">Ⅱ</text>' +
    '</svg>';
  }

  function exitIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M13 4h7v16h-7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
      '<circle cx="8.2" cy="5.3" r="1.7" fill="currentColor"/>' +
      '<path d="M8.2 7.3 5.8 12h2.9l-1 4.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M8.2 7.3 11.6 9l3-1.1M11.6 9l1.8 3.4 2.6 1.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M17.2 12h-2.9m2.9 0-1.8-1.7m1.8 1.7-1.8 1.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  }

  function combatLocked(action) {
    if (state.phase !== 'combat') return false;
    toast('作战期内无法' + action + '，请在作战结束后操作');
    return true;
  }

  function log(text, kind) {
    state.logs.unshift({ round: state.round, time: new Date().toISOString(), text: text, kind: kind || 'info' });
    if (state.logs.length > 200) state.logs.pop();
  }

  function inBounds(r, c) {
    return r >= 0 && r < MAP_H && c >= 0 && c < MAP_W;
  }

  function keyOf(r, c) { return r + ',' + c; }

  function terrainAt(r, c) {
    return (MAP[r] && MAP[r][c]) || 'ground';
  }

  function metaOf(name) { return OP_META[name] || null; }
  function handOf(name) { return OP_META[name] || null; }
  function rangeIdOf(name, elite) {
    const m = OP_META[name];
    return (m && (elite ? m.rangeElite : m.rangeNormal)) || '1-1';
  }
  function posLabel(m) {
    if (!m) return '—';
    if (m.pos === 'ranged') return '远程';
    if (m.pos === 'melee') return '近战';
    return '—';
  }
  function makeHandItem(name, elite) {
    return { id: 'h' + (state.uid++), name: name, elite: !!elite, gained: false };
  }

  /* ---------------- 装备（只结算转职 + 效果描述） ---------------- */
  function itemCapOf(op) {
    if (!op) return window.Calc.RULES.itemsMax;
    return window.Calc.itemCapacity(op.name, !!op.elite);
  }

  function normGearEntry(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') return { k: raw, e: false };
    if (raw.k) return { k: String(raw.k), e: !!raw.e };
    return null;
  }

  /** 校验 + 去重 + 按干员槽位截断；用于导入沙盒码 / 旧快照。 */
  function normalizeGearList(list, name, elite) {
    const cap = name ? window.Calc.itemCapacity(name, !!elite) : window.Calc.RULES.itemsMax;
    const out = [];
    const seen = {};
    (list || []).forEach(function (raw) {
      const entry = normGearEntry(raw);
      if (!entry || seen[entry.k] || !GEAR_BY_NAME[entry.k]) return;
      seen[entry.k] = 1;
      out.push(entry);
    });
    return out.slice(0, cap);
  }

  function hasMorphGear(op) {
    return !!(op && op.it && op.it.some(function (it) { return it.k === window.Calc.MORPH_ITEM; }));
  }

  /** 变形同构体：另一件装备所属盟约；未收录时用 op.m 手动指定兜底。 */
  function morphInfoOf(op) {
    const items = (op && op.it) || [];
    let partner = null;
    let hasMorph = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].k === window.Calc.MORPH_ITEM) hasMorph = true;
      else if (!partner) partner = items[i];
    }
    if (!hasMorph) return { hasMorph: false, partner: '', covenant: '', manual: false };
    const def = partner ? GEAR_BY_NAME[partner.k] : null;
    let covenant = def && def.covenant ? def.covenant : '';
    let manual = false;
    if (!covenant && op.m) { covenant = op.m; manual = true; }
    return {
      hasMorph: true,
      partner: partner ? partner.k : '',
      partnerCovenant: def && def.covenant ? def.covenant : '',
      covenant: covenant,
      manual: manual
    };
  }

  function gearEffectOf(it, elite) {
    if (!it) return '';
    return elite && it.hasElite ? (it.eliteText || it.normalText || '') : (it.normalText || '');
  }

  function gearIconHtml(it, size) {
    const px = size || 24;
    if (it && it.icon) {
      return '<img class="gear-ico" src="' + esc(it.icon) + '" alt="" width="' + px + '" height="' + px +
        '" loading="lazy" onerror="this.style.visibility=\'hidden\'">';
    }
    return '<span class="gear-ico-fb" style="width:' + px + 'px;height:' + px + 'px">装</span>';
  }

  function avatarOf(name) {
    const m = metaOf(name);
    return m && m.avatar ? m.avatar : '';
  }

  function opAt(r, c) {
    return state.board.find(function (o) { return o.r === r && o.c === c; }) || null;
  }

  function enemyAt(r, c) {
    return state.enemies.find(function (e) { return e.r === r && e.c === c; }) || null;
  }

  function selectedOpObj() {
    return state.board.find(function (o) { return o.uid === state.selectedOp; }) || null;
  }

  function selectedHandItem() {
    return state.hand.find(function (it) { return it.id === state.selectedHand; }) || null;
  }

  function selectedHandMeta() {
    const item = selectedHandItem();
    return item ? handOf(item.name) : null;
  }

  function getEval() {
    const slots = state.board.map(function (o) {
      // 自选干员不在 DATA.operators 里，Calc 需要走 slots[i].p。
      // 装备也带进 Calc：变形同构体据此给携带者追加盟约（转职）。
      const base = OP[o.name] ? { k: o.name } : { p: o.name };
      base.e = !!o.elite;
      if (o.it && o.it.length) base.it = o.it;
      if (o.m) base.m = o.m;
      return base;
    });
    return window.Calc.evaluate({ size: MAX_BOARD, slots: slots, layers: state.layers }, DATA);
  }

  function isBondActive(name) {
    const row = getEval().rows.find(function (r) { return r.name === name; });
    return !!row && (row.state === 'active' || row.state === 'empowered');
  }

  function activeCoreNames() {
    return getEval().rows.filter(function (r) {
      return r.rank === 'core' && (r.state === 'active' || r.state === 'empowered');
    }).map(function (r) { return r.name; });
  }

  function selfActiveBonds(op) {
    return opTags(op).filter(function (b) { return isBondActive(b); });
  }

  /** 干员当前实际拥有的盟约标签：基础标签 + 变形同构体转职。 */
  function opTags(op) {
    const m = op ? metaOf(op.name) : null;
    const tags = m && m.tags ? m.tags.slice() : [];
    const mi = morphInfoOf(op);
    if (mi.hasMorph && mi.covenant && tags.indexOf(mi.covenant) < 0) tags.push(mi.covenant);
    return tags;
  }

  function areAdjacent(a, b) {
    return a.uid !== b.uid && !(a.r === b.r && a.c === b.c) && Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1;
  }

  // 通用的叠加上限光环：不按干员名写死，规则里带 capAura 即可生效。
  // capAura = { type:'pct'|'flat', value:0.3, target:'adjacent'|'front'|'sharedTag', requireTags:[...] }
  function auraApplies(v, op, spec) {
    if (!v || !op || v.uid === op.uid) return false;
    if (spec.requireTags && !opTags(op).some(function (t) { return spec.requireTags.indexOf(t) >= 0; })) return false;
    if (spec.target === 'adjacent') return areAdjacent(v, op);
    if (spec.target === 'front') {
      const front = frontOp(v, 1);
      return !!front && front.uid === op.uid;
    }
    if (spec.target === 'sharedTag') {
      const vt = opTags(v);
      const ot = opTags(op);
      return vt.some(function (t) { return ot.indexOf(t) >= 0; });
    }
    return false;
  }

  function capAuraBonuses(op) {
    const out = [];
    if (state.phase !== 'combat') return out;
    state.board.forEach(function (v) {
      (RULES[v.name] || []).forEach(function (rule) {
        if (!rule.capAura || !ruleMatchesElite(v, rule)) return;
        if (!auraApplies(v, op, rule.capAura)) return;
        out.push({
          source: v.name,
          type: rule.capAura.type === 'pct' ? 'pct' : 'flat',
          value: Number(rule.capAura.value) || 0,
          order: Number(rule.capAura.order) || 999
        });
      });
    });
    out.sort(function (a, b) { return a.order - b.order || String(a.source).localeCompare(String(b.source), 'zh-Hans-CN'); });
    return out;
  }

  /** 叠加上限构成：base + 各来源的 pct/flat 加成；不限定具体干员名 */
  function stackCapParts(op, base) {
    const b = Math.max(0, Math.floor(Number(base) || 0));
    if (state.phase !== 'combat') return { base: b, bonuses: [], total: b };

    let pctSum = 0;
    let flatSum = 0;
    const bonuses = [];
    capAuraBonuses(op).forEach(function (a) {
      if (a.type === 'pct') {
        pctSum += a.value;
        const amount = Math.floor(b * a.value);
        if (amount > 0) bonuses.push({ source: a.source, type: 'pct', amount: amount });
      } else {
        flatSum += a.value;
        if (a.value > 0) bonuses.push({ source: a.source, type: 'flat', amount: a.value });
      }
    });

    const total = Math.max(0, Math.floor(b * (1 + pctSum) + flatSum));
    let sum = b;
    bonuses.forEach(function (x) { sum += x.amount; });
    const diff = total - sum;
    if (diff && bonuses.length) bonuses[bonuses.length - 1].amount += diff;
    return { base: b, bonuses: bonuses, total: total };
  }

  function effectiveBattleCap(op, base) {
    return stackCapParts(op, base).total;
  }

  function capAuraTargets(v, rule) {
    return state.board.filter(function (o) { return auraApplies(v, o, rule.capAura); }).map(function (o) { return o.name; });
  }

  function capAuraLabel(rule) {
    const a = rule.capAura;
    return a.type === 'pct' ? Math.round(a.value * 100) + '%' : '+' + a.value + ' 层';
  }

  function logBattleCapAuras() {
    if (state.phase !== 'combat') return;
    state.board.forEach(function (v) {
      (RULES[v.name] || []).forEach(function (rule) {
        if (!rule.capAura || !ruleMatchesElite(v, rule)) return;
        const names = capAuraTargets(v, rule);
        if (names.length) log(v.name + '：' + capAuraLabel(rule) + ' 战斗叠加上限 → ' + names.join('、'), 'event');
      });
    });
  }

  function capAuraRows() {
    const rows = [];
    state.board.forEach(function (v) {
      (RULES[v.name] || []).forEach(function (rule) {
        if (!rule.capAura || !ruleMatchesElite(v, rule)) return;
        const targets = capAuraTargets(v, rule);
        if (targets.length) {
          rows.push({
            source: v.name + (v.elite ? '（精锐）' : ''),
            amount: rule.capAura.type === 'pct' ? '+' + Math.round(rule.capAura.value * 100) + '%' : '+' + rule.capAura.value,
            targets: targets
          });
        }
      });
    });
    return rows;
  }

  function capAuraHintFor(op) {
    if (!op) return '';
    const lines = [];
    (RULES[op.name] || []).forEach(function (rule) {
      if (!rule.capAura || !ruleMatchesElite(op, rule)) return;
      const names = capAuraTargets(op, rule);
      if (!names.length) return;
      lines.push('<b>' + esc(op.name) + '：</b>' + esc(capAuraLabel(rule)) + ' 战斗叠加上限 → ' + names.map(esc).join('、'));
    });
    return lines.join('<br>');
  }

  function sourceCapText(s) {
    if (!s || !s.hasCap) return '';
    const bonusList = s.bonuses || [];
    const parts = [s.base].concat(bonusList.map(function (b) { return b.amount; })).filter(function (n) { return n > 0; });
    const hasAura = bonusList.length > 0;
    const under = s.amount < s.capTotal;
    if (!hasAura && !under) return '';
    let text = '';
    if (under) text += ' / 上限 ' + s.capTotal;
    text += '（' + parts.join('+') + '）';
    return text;
  }

  function renderReport() {
    if (!reportPanel || !reportBody) return;
    if (sandboxSharePanel) sandboxSharePanel.hidden = true;
    if (!state.lastReport) { reportPanel.hidden = true; return; }
    const rep = state.lastReport;
    if (reportTitle) reportTitle.textContent = rep.label + '叠层总结';
    if (reportRound) reportRound.textContent = '第 ' + rep.round + ' 回合';
    if (!rep.rows.length && !(rep.caps && rep.caps.length)) {
      reportBody.innerHTML = '<div class="report-empty">本阶段没有产生叠层</div>';
    } else {
      let html = rep.rows.map(function (row) {
        const c = DATA.covenants.find(function (x) { return x.name === row.bond; });
        const icon = c && c.icon ? '<img src="' + esc(c.icon) + '" alt="">' : '';
        const sources = row.sources.map(function (s) {
          const title = ['自身 ' + s.base].concat((s.bonuses || []).map(function (b) {
            return b.source + ' ' + b.amount;
          })).join(' / ');
          return '<span class="report-source" title="' + esc(title) + '">' + esc(s.name) + ' <b>+' + s.amount + '</b>' + sourceCapText(s) + '</span>';
        }).join('');
        return '<div class="report-row">' +
          '<div class="report-bond"><span class="rb-name">' + icon + esc(row.bond) + '</span><b>+' + row.total + '</b></div>' +
          '<div class="report-sources"><span class="muted">来源</span>' + sources + '</div>' +
        '</div>';
      }).join('');
      if (rep.caps && rep.caps.length) {
        html += '<div class="report-cap-block">' +
          '<div class="report-cap-title">上限提升 <span>仅提高上限，不计入层数</span></div>' +
          rep.caps.map(function (cap) {
            return '<div class="report-cap-row"><b>' + esc(cap.source) + ' ' + esc(cap.amount) + '</b>' +
              '<span>' + cap.targets.map(function (n) { return esc(n); }).join('、') + '</span></div>';
          }).join('') +
        '</div>';
      }
      reportBody.innerHTML = html;
    }
    reportPanel.hidden = false;
  }

  function generateReport(label) {
    const agg = {};
    state.stackEvents.forEach(function (e) {
      if (!agg[e.bond]) agg[e.bond] = { bond: e.bond, total: 0, sources: {} };
      const row = agg[e.bond];
      row.total += e.amount;

      const src = e.op || String(e.source || '未知').split(' · ')[0];
      if (!row.sources[src]) {
        row.sources[src] = {
          name: src, amount: 0, hasCap: false, capSeen: {},
          base: 0, capTotal: 0, bonuses: {}
        };
      }
      const s = row.sources[src];
      s.amount += e.amount;
      if (e.cap && e.capKey && !s.capSeen[e.capKey]) {
        s.capSeen[e.capKey] = true;
        s.hasCap = true;
        s.base += e.cap.base || 0;
        s.capTotal += e.cap.total || 0;
        (e.cap.bonuses || []).forEach(function (b) {
          s.bonuses[b.source] = (s.bonuses[b.source] || 0) + b.amount;
        });
      }
    });
    const rows = Object.keys(agg).map(function (b) {
      const row = agg[b];
      return {
        bond: b,
        total: row.total,
        sources: Object.keys(row.sources).map(function (n) {
          const s = row.sources[n];
          return {
            name: s.name, amount: s.amount, hasCap: s.hasCap,
            base: s.base, capTotal: s.capTotal,
            bonuses: Object.keys(s.bonuses).map(function (k) { return { source: k, amount: s.bonuses[k] }; })
          };
        }).sort(function (a, c) { return c.amount - a.amount; })
      };
    }).sort(function (a, b) { return b.total - a.total; });
    state.lastReport = { label: label, round: state.round, rows: rows, caps: label === '作战期' ? capAuraRows() : [] };
    state.stackEvents = [];
    renderReport();
  }

  function showLastReport() {
    if (!state.lastReport) { toast('暂无可查看的叠层报表'); return; }
    renderReport();
  }

  // ---- 沙盒码 / 反馈导出 ----
  function cloneCounters(obj) {
    const out = {};
    Object.keys(obj || {}).forEach(function (k) { out[k] = obj[k]; });
    return out;
  }

  function buildSandboxSnapshot() {
    return {
      map: { w: MAP_W, h: MAP_H, tiles: MAP.map(function (row) { return row.slice(); }) },
      round: state.round,
      phase: state.phase,
      prepStarted: !!state.prepStarted,
      uid: state.uid,
      hand: state.hand.map(function (item) {
        return { id: item.id, name: item.name, elite: !!item.elite, gained: !!item.gained };
      }),
      board: state.board.map(function (op) {
        return {
          uid: op.uid, name: op.name, elite: !!op.elite, r: op.r, c: op.c, dir: op.dir,
          it: (op.it || []).map(normGearEntry).filter(function (it) { return !!it; }),
          m: op.m || ''
        };
      }),
      layers: cloneCounters(state.layers),
      temp: cloneCounters(state.temp),
      sellPriceBonus: cloneCounters(state.sellPriceBonus),
      battleStartDone: !!state.battleStartDone,
      egirStarted: !!state.egirStarted,
      refreshes: state.refreshes,
      freeRefreshes: state.freeRefreshes,
      roundGains: state.roundGains,
      grantedTraits: state.grantedTraits.map(function (t) {
        return {
          targetUid: t.targetUid, targetName: t.targetName, source: t.source,
          amount: t.amount, perRound: t.perRound, elite: !!t.elite
        };
      }),
      freeGainCounts: cloneCounters(state.freeGainCounts),
      counters: cloneCounters(state.counters),
      battleCounters: cloneCounters(state.battleCounters),
      totalCounters: cloneCounters(state.totalCounters)
    };
  }

  function makeSandboxCode() {
    if (!window.SandboxCode) return '';
    try {
      return SandboxCode.encode(buildSandboxSnapshot(), DATA);
    } catch (e) {
      log('生成沙盒码失败：' + (e && e.message ? e.message : e), 'warn');
      return '';
    }
  }

  function applySandboxSnapshot(snap, warnings) {
    if (!snap || !snap.map || !Array.isArray(snap.map.tiles)) return false;
    const w = Number(snap.map.w), h = Number(snap.map.h);
    if (!(w >= 3 && w <= 21 && h >= 3 && h <= 13)) return false;
    if (snap.map.tiles.length !== h || snap.map.tiles.some(function (row) { return !Array.isArray(row) || row.length !== w; })) return false;

    closeGearEditor();
    const st = initState();
    st.round = Math.max(1, Math.floor(Number(snap.round) || 1));
    st.phase = snap.phase === 'combat' ? 'combat' : 'prep';
    st.prepStarted = !!snap.prepStarted;
    st.roundStarted = st.prepStarted;
    if ((snap.hand || []).length > MAX_HAND) (warnings || []).push('待部署区超过 ' + MAX_HAND + ' 张，已截断');
    if ((snap.board || []).length > MAX_BOARD) (warnings || []).push('场上超过 ' + MAX_BOARD + ' 名干员，已截断');
    st.hand = (snap.hand || []).slice(0, MAX_HAND).filter(function (item) {
      return item && OP_META[item.name];
    }).map(function (item) {
      return { id: String(item.id || ''), name: item.name, elite: !!item.elite, gained: !!item.gained };
    });
    const rawBoard = (snap.board || []).slice(0, MAX_BOARD);
    st.board = rawBoard.filter(function (op) {
      return op && OP_META[op.name] && Number(op.r) >= 0 && Number(op.r) < h && Number(op.c) >= 0 && Number(op.c) < w;
    }).map(function (op) {
      const elite = !!op.elite;
      const gear = normalizeGearList(op.it, op.name, elite);
      const out = {
        uid: Number(op.uid) || 0, name: op.name, elite: elite,
        r: Number(op.r) || 0, c: Number(op.c) || 0, dir: DIR_LABEL[op.dir] ? op.dir : 'right'
      };
      if (gear.length) out.it = gear;
      if (op.m && hasMorphGear(out)) out.m = String(op.m);
      return out;
    });
    if (st.board.length !== rawBoard.length) (warnings || []).push('有干员坐标越界或数据无效，已跳过');
    st.layers = cloneCounters(snap.layers);
    st.temp = cloneCounters(snap.temp);
    st.sellPriceBonus = cloneCounters(snap.sellPriceBonus);
    // 旧码没有这两个字段：导入作战期时按“战斗开始已结算”处理，避免再次吞噬/重复 onBattleStart。
    st.battleStartDone = snap.battleStartDone == null ? st.phase === 'combat' : !!snap.battleStartDone;
    st.egirStarted = snap.egirStarted == null ? st.phase === 'combat' : !!snap.egirStarted;
    st.refreshes = Math.max(0, Number(snap.refreshes) || 0);
    st.freeRefreshes = Math.max(0, Number(snap.freeRefreshes) || 0);
    st.roundGains = Math.max(0, Number(snap.roundGains) || 0);
    st.grantedTraits = (snap.grantedTraits || []).filter(function (t) {
      return st.board.some(function (op) { return op.uid === t.targetUid; });
    }).map(function (t) {
      return {
        targetUid: t.targetUid, targetName: t.targetName || '', source: t.source,
        amount: Number(t.amount) || 0, perRound: Number(t.perRound) || 0, elite: !!t.elite
      };
    });
    st.freeGainCounts = cloneCounters(snap.freeGainCounts);
    st.counters = cloneCounters(snap.counters);
    st.battleCounters = cloneCounters(snap.battleCounters);
    st.totalCounters = cloneCounters(snap.totalCounters);

    const handIds = {};
    for (let i = 0; i < st.hand.length; i++) {
      const item = st.hand[i];
      if (!item.id || handIds[item.id]) { (warnings || []).push('待部署区存在重复/空 ID，已拒绝导入'); return false; }
      handIds[item.id] = true;
    }
    const uids = {};
    let maxUid = 100;
    for (let i = 0; i < st.board.length; i++) {
      const op = st.board[i];
      if (!op.uid || uids[op.uid]) { (warnings || []).push('场上存在重复/空 ID，已拒绝导入'); return false; }
      uids[op.uid] = true;
      maxUid = Math.max(maxUid, op.uid);
    }
    st.hand.forEach(function (item) {
      const n = parseInt(String(item.id).replace(/^h/, ''), 10);
      if (!isNaN(n)) maxUid = Math.max(maxUid, n);
    });
    st.uid = Math.max(maxUid + 1, Number(snap.uid) || 0);

    MAP_W = w;
    MAP_H = h;
    MAP = snap.map.tiles.map(function (row) { return row.slice(); });
    MAP_BOX = buildBoxGrid(snap.map.boxes || []);
    st.logs = [];
    state = st;
    hideBondPop();
    hideTip();
    if (reportPanel) reportPanel.hidden = true;
    syncWhControls();
    log('已导入沙盒码：第 ' + state.round + ' 回合 · ' + (state.phase === 'combat' ? '作战期' : '休整期'), 'event');
    (warnings || []).forEach(function (x) { log('沙盒码提示：' + x, 'warn'); });
    renderAll();
    return true;
  }

  function importSandboxCode(text) {
    if (!window.SandboxCode) { toast('沙盒码模块未加载'); return false; }
    const res = SandboxCode.decode(text, DATA);
    if (!res || !res.snapshot) {
      toast('沙盒码解析失败');
      log('导入沙盒码失败：格式/校验不通过', 'warn');
      return false;
    }
    if (drag) cleanupDrag();
    if (facing) cleanupFacing();
    if (state.pending) cancelPending();
    const ok = applySandboxSnapshot(res.snapshot, res.warnings || []);
    if (ok) {
      toast('沙盒码已导入');
      closeSandboxShare();
      setShareStatus('导入成功', 'ok');
    } else {
      toast('沙盒码状态无效，未导入');
      log('导入沙盒码失败：状态校验不通过', 'warn');
      setShareStatus('导入失败：状态校验不通过', 'err');
    }
    return ok;
  }

  function setShareStatus(text, kind) {
    if (!sandboxShareStatus) return;
    sandboxShareStatus.textContent = text || '';
    sandboxShareStatus.className = 'share-status' + (kind ? ' ' + kind : '');
  }

  function openSandboxShare() {
    const code = makeSandboxCode();
    if (!code) { toast('当前无法生成沙盒码'); return; }
    if (reportPanel) reportPanel.hidden = true;
    if (sandboxCodeText) sandboxCodeText.value = code;
    if (sandboxSharePanel) sandboxSharePanel.hidden = false;
    setShareStatus('已生成，可直接复制或下载；也可粘贴他人的沙盒码后点击「导入」。', '');
    if (sandboxCodeText) {
      sandboxCodeText.focus();
      sandboxCodeText.select();
    }
  }

  function closeSandboxShare() {
    if (sandboxSharePanel) sandboxSharePanel.hidden = true;
  }

  function copySandboxCode() {
    let text = sandboxCodeText ? String(sandboxCodeText.value || '').trim() : '';
    if (!text) text = makeSandboxCode();
    if (!text) { toast('当前无法生成沙盒码'); return; }
    if (sandboxCodeText) sandboxCodeText.value = text;
    if (sandboxSharePanel) sandboxSharePanel.hidden = false;
    copyText(text, '沙盒码已复制');
    setShareStatus('已尝试复制；如果剪贴板被浏览器拦截，请手动选中文本框复制。', '');
  }

  function downloadSandboxCode() {
    let text = sandboxCodeText ? String(sandboxCodeText.value || '').trim() : '';
    if (!text) text = makeSandboxCode();
    if (!text) { toast('当前无法生成沙盒码'); return; }
    downloadText('gspa-sandbox-code-' + fileStamp() + '.txt', text, 'text/plain;charset=utf-8');
    setShareStatus('沙盒码文件已下载。', 'ok');
  }

  function fileStamp() {
    const d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function copyText(text, okMsg) {
    function fallback() {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) toast(okMsg);
        else toast('复制失败，可改用「导出诊断」');
        return !!ok;
      } catch (e) {
        toast('复制失败，可改用「导出诊断」');
        return false;
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }).catch(fallback);
    } else {
      fallback();
    }
  }

  function downloadText(filename, text, mime) {
    try {
      const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 0);
      toast('已导出 ' + filename);
    } catch (e) {
      toast('导出失败：' + (e && e.message ? e.message : e));
    }
  }

  function buildFeedbackObject() {
    const code = makeSandboxCode();
    const snap = buildSandboxSnapshot();
    return {
      type: 'gspa-sandbox-feedback',
      generatedAt: new Date().toISOString(),
      page: (window.location && window.location.href) || '',
      userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || '',
      viewport: { width: window.innerWidth || 0, height: window.innerHeight || 0 },
      dataVersion: DATA.version || '',
      dataGeneratedAt: DATA.generatedAt || '',
      sandboxCode: code,
      state: snap,
      lastReport: state.lastReport,
      stackEvents: state.stackEvents.slice(),
      logs: state.logs.slice().reverse()
    };
  }

  function buildFeedbackText() {
    const fb = buildFeedbackObject();
    const st = fb.state;
    const phase = st.phase === 'combat' ? '作战期' : '休整期';
    const board = st.board.map(function (op) {
      return op.name + (op.elite ? '（精锐）' : '') + ' r' + (op.r + 1) + 'c' + (op.c + 1) + ' 朝' + (DIR_LABEL[op.dir] || op.dir);
    }).join('；') || '—';
    const hand = st.hand.map(function (it) {
      return it.name + (it.elite ? '（精锐）' : '') + (it.gained ? '（已获得）' : '');
    }).join('；') || '—';
    const layerNames = Object.keys(st.layers || {});
    const layers = layerNames.length
      ? layerNames.map(function (k) { return k + ' ' + st.layers[k]; }).join(' / ')
      : '—';
    const tempNames = Object.keys(st.temp || {});
    const temp = tempNames.length
      ? tempNames.map(function (k) { return k + ' 临时 ' + st.temp[k]; }).join(' / ')
      : '—';
    const traits = (st.grantedTraits || []).map(function (t) {
      return (t.source || '?') + '→' + (t.targetName || '?') + ' +' + t.amount + '/回合' + t.perRound;
    }).join('；') || '—';
    const lines = [
      'GSPA 沙盒反馈',
      '时间：' + fb.generatedAt,
      '页面：' + fb.page,
      '浏览器：' + fb.userAgent,
      '数据版本：' + fb.dataVersion + ' / ' + fb.dataGeneratedAt,
      '回合：第 ' + st.round + ' 回合 · ' + phase + (st.prepStarted ? '（休整期已开始）' : '（休整期未开始）'),
      '地图：' + st.map.w + ' × ' + st.map.h,
      '场上（' + st.board.length + '）：' + board,
      '待部署区（' + st.hand.length + '）：' + hand,
      '固定层：' + layers,
      '临时层：' + temp,
      '特质：' + traits,
      '刷新：本回合 ' + st.refreshes + ' 次 · 免费 ' + st.freeRefreshes + ' 次 · 本回合获得 ' + st.roundGains + ' 名',
      '沙盒码：' + fb.sandboxCode,
      '',
      '--- 事件日志（旧→新）---'
    ];
    if (!fb.logs.length) lines.push('（无）');
    fb.logs.forEach(function (l) {
      const t = l.time ? new Date(l.time).toLocaleTimeString('zh-CN', { hour12: false }) : '';
      lines.push('[R' + l.round + (t ? ' ' + t : '') + '][' + l.kind + '] ' + l.text);
    });
    return lines.join('\n');
  }

  function copyFeedbackLog() {
    copyText(buildFeedbackText(), '日志和沙盒状态已复制');
  }

  function exportDiagnostics() {
    const text = JSON.stringify(buildFeedbackObject(), null, 2);
    downloadText('gspa-sandbox-feedback-' + fileStamp() + '.json', text, 'application/json;charset=utf-8');
  }

  // ---- 位置 / 范围 / 部署规则 ----
  function rangeCellSet(op) {
    const data = RANGES[rangeIdOf(op.name, op.elite)];
    const out = new Set();
    if (!data || !data.self || !data.cells) return out;
    const sr = data.self[0];
    const sc = data.self[1];
    for (let i = 0; i < data.cells.length; i++) {
      const dr = data.cells[i][0] - sr;
      const dc = data.cells[i][1] - sc;
      let rr = 0, cc = 0;
      if (op.dir === 'right') { rr = dr; cc = dc; }
      else if (op.dir === 'down') { rr = dc; cc = -dr; }
      else if (op.dir === 'left') { rr = -dr; cc = -dc; }
      else { rr = -dc; cc = dr; }
      const r = op.r + rr;
      const c = op.c + cc;
      if (inBounds(r, c)) out.add(keyOf(r, c));
    }
    return out;
  }

  function inRange(op, r, c) {
    return rangeCellSet(op).has(keyOf(r, c));
  }

  function canEnemyAt(r, c) {
    const info = TERRAIN[terrainAt(r, c)] || TERRAIN.ground;
    return !!info.walk && !boxAt(r, c) && !opAt(r, c) && !enemyAt(r, c);
  }

  function canPlace(name, r, c) {
    if (!inBounds(r, c)) return false;
    if (boxAt(r, c)) return false;
    if (state.board.length >= MAX_BOARD) return false;
    const hm = handOf(name);
    if (!hm) return false;
    const info = TERRAIN[terrainAt(r, c)] || TERRAIN.ground;
    if (info.deploy === 'none') return false;
    if (info.deploy === 'ranged' && hm.pos !== 'ranged') return false;
    if (opAt(r, c) || enemyAt(r, c)) return false;
    return true;
  }

  function canMoveTo(uid, r, c) {
    const op = state.board.find(function (o) { return o.uid === uid; });
    if (!op || !inBounds(r, c)) return false;
    if (boxAt(r, c)) return false;
    const info = TERRAIN[terrainAt(r, c)] || TERRAIN.ground;
    if (info.deploy === 'none') return false;
    const hm = handOf(op.name);
    if (info.deploy === 'ranged' && hm && hm.pos === 'melee') return false;
    if (enemyAt(r, c)) return false;
    const other = opAt(r, c);
    if (other && other.uid !== uid) {
      const backInfo = TERRAIN[terrainAt(op.r, op.c)] || TERRAIN.ground;
      const otherHand = handOf(other.name);
      if (backInfo.deploy === 'none') return false;
      if (backInfo.deploy === 'ranged' && otherHand && otherHand.pos === 'melee') return false;
    }
    return true;
  }

  function startMoveDrag(uid, e) {
    if (combatLocked('移动干员')) return;
    const op = state.board.find(function (o) { return o.uid === uid; });
    if (!op) return;
    if (e.button != null && e.button !== 0) return;
    if (state.pending) cancelPending();
    hideTip();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.innerHTML = '<img src="' + esc(avatarOf(op.name)) + '" alt="' + esc(op.name) + '" draggable="false" onerror="this.style.visibility=\'hidden\'">';
    document.body.appendChild(ghost);
    drag = {
      mode: 'move', name: op.name, uid: op.uid, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      cell: null, active: false, ghost: ghost, overHand: false
    };
    positionGhost(e.clientX, e.clientY);
    document.body.classList.add('dragging-op');
    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragUp);
    window.addEventListener('pointercancel', onDragCancel);
  }

  // ---- 朝向 / 相邻目标 ----
  const DIR_DELTA = { right: [0, 1], down: [1, 0], left: [0, -1], up: [-1, 0] };

  function frontCell(op, n) {
    const d = DIR_DELTA[op.dir] || DIR_DELTA.right;
    return { r: op.r + d[0] * (n || 1), c: op.c + d[1] * (n || 1) };
  }

  function backCell(op, n) {
    const d = DIR_DELTA[op.dir] || DIR_DELTA.right;
    return { r: op.r - d[0] * (n || 1), c: op.c - d[1] * (n || 1) };
  }

  function frontOp(op, n) {
    if (!op || op.r < 0) return null;
    const cell = frontCell(op, n);
    return opAt(cell.r, cell.c);
  }

  function backOp(op, n) {
    if (!op || op.r < 0) return null;
    const cell = backCell(op, n);
    return opAt(cell.r, cell.c);
  }

  function opsInFront(op, n) {
    const out = [];
    if (!op || op.r < 0) return out;
    for (let i = 1; i <= n; i++) {
      const cell = frontCell(op, i);
      const o = opAt(cell.r, cell.c);
      if (o) out.push(o);
    }
    return out;
  }

  function orthogonalOps(op) {
    if (!op || op.r < 0) return [];
    const out = [];
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (d) {
      const o = opAt(op.r + d[0], op.c + d[1]);
      if (o) out.push(o);
    });
    return out;
  }

  function adjacentOps(op) {
    if (!op || op.r < 0) return [];
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const o = opAt(op.r + dr, op.c + dc);
        if (o) out.push(o);
      }
    }
    return out;
  }

  function benchOps() {
    return state.hand.map(function (item) {
      return { name: item.name, elite: !!item.elite, uid: 'hand-' + item.id, dir: 'right', r: -1, c: -1, bench: true };
    });
  }

  function countTag(tag) {
    return state.board.filter(function (o) { return opTags(o).indexOf(tag) >= 0; }).length;
  }

  function distinctTierCount(tag) {
    const seen = {};
    let n = 0;
    state.board.forEach(function (o) {
      if (opTags(o).indexOf(tag) < 0) return;
      const m = metaOf(o.name);
      const key = String(m ? m.tier : '?');
      if (!seen[key]) { seen[key] = 1; n++; }
    });
    return n;
  }

  // “售价”类叠层（旅骨/棘刺）读的是售出价，不是采购价。
  // 基础价默认 1；温蒂 3/6 由 StackCore 维护；海沫等修正走 state.sellPriceBonus。
  function sellPriceOfOp(op) {
    if (!op) return 0;
    return CORE.sellPriceOf(op.name, {
      elite: !!op.elite,
      bonus: Number(state.sellPriceBonus && state.sellPriceBonus[op.name]) || 0
    });
  }

  function boardPriceSum() {
    return state.board.reduce(function (s, o) { return s + sellPriceOfOp(o); }, 0);
  }

  function opPriceOf(op) {
    return sellPriceOfOp(op);
  }

  // “层数额外加成”光环：规则带 layerGainAura 即可生效，不按干员名写死
  function layerGainAuraApplies(v, target, spec) {
    if (!v || !target || v.uid === target.uid) return false;
    if (spec.target === 'front') {
      const front = frontOp(v, 1);
      return !!front && front.uid === target.uid;
    }
    if (spec.target === 'adjacent') return areAdjacent(v, target);
    if (spec.target === 'self') return v.uid === target.uid;
    if (spec.target === 'all') return true;
    return false;
  }

  function layerGainBonus(target) {
    if (!target || target.r < 0) return 0;
    let bonus = 0;
    state.board.forEach(function (v) {
      (RULES[v.name] || []).forEach(function (rule) {
        if (!rule.layerGainAura || !ruleMatchesElite(v, rule)) return;
        if (!layerGainAuraApplies(v, target, rule.layerGainAura)) return;
        bonus += Number(rule.layerGainAura.amount) || 0;
      });
    });
    return bonus;
  }

  // ---- 叠层 ----
  // 账本逻辑已抽到 stack-core.js；这里只保留 sandbox 的校验/日志。
  function getLedger() {
    if (!ledger || ledger.layers !== state.layers || ledger.temp !== state.temp || ledger.events !== state.stackEvents) {
      ledger = CORE.createLedger({
        layers: state.layers,
        temp: state.temp,
        events: state.stackEvents,
        maxLayers: 999,
        maxEvents: 600
      });
    }
    return ledger;
  }

  function addLayer(bond, amount, source, opts) {
    const n = Math.floor(Number(amount) || 0);
    if (n <= 0) return 0;
    const exists = DATA.covenants.some(function (c) { return c.name === bond; });
    if (!exists) return 0;
    const target = opts && opts.temp ? state.temp : state.layers;
    const before = target[bond] || 0;
    if (before >= 999) {
      log('【' + bond + '】已达 999 层，未继续叠加', 'warn');
      return 0;
    }
    const applied = getLedger().add(bond, n, source, opts || {});
    if (applied <= 0) {
      log('【' + bond + '】已达 999 层，未继续叠加', 'warn');
      return 0;
    }
    log(source + '：' + bond + ' ' + (opts && opts.temp ? '临时层' : '层数') + ' +' + applied + (applied < n ? '（封顶）' : ''), 'gain');
    return applied;
  }

  function resolveRuleBonds(target, rule) {
    let bonds = [];
    if (rule.bonds === 'active') {
      bonds = selfActiveBonds(target);
    } else if (rule.bonds === 'activeCore') {
      bonds = activeCoreNames();
    } else if (rule.bonds === 'highestActive') {
      const rows = getEval().rows.filter(function (r) { return r.state === 'active' || r.state === 'empowered'; });
      rows.sort(function (a, b) {
        const la = (state.layers[a.name] || 0) + (state.temp[a.name] || 0);
        const lb = (state.layers[b.name] || 0) + (state.temp[b.name] || 0);
        return lb - la;
      });
      bonds = rows.length ? [rows[0].name] : [];
    } else if (Array.isArray(rule.bonds)) {
      bonds = rule.bonds.slice();
    }
    if (rule.requireActive) {
      const inactive = bonds.filter(function (b) { return !isBondActive(b); });
      bonds = bonds.filter(function (b) { return isBondActive(b); });
      if (inactive.length && bonds.length) {
        log(target.name + '：' + inactive.join('、') + ' 未激活，已跳过', 'warn');
      }
    }
    return bonds;
  }

  function resolveTargets(op, rule) {
    const out = [];
    function add(t) {
      if (!t) return;
      if (!out.some(function (x) { return x.uid === t.uid; })) out.push(t);
    }
    if (rule.target === 'bench') {
      benchOps().forEach(add);
      return out;
    }
    if (rule.target === 'front1') {
      add(frontOp(op, 1));
      return out;
    }
    if (rule.target === 'behind1') {
      add(backOp(op, 1));
      return out;
    }
    add(op);
    if (rule.target === 'selfAndFront1') add(frontOp(op, 1));
    if (rule.target === 'selfAndBehind1') add(backOp(op, 1));
    if (rule.target === 'around4') orthogonalOps(op).forEach(add);
    if (rule.target === 'around8') adjacentOps(op).forEach(add);
    return out;
  }

  function computeRuleBase(op, rule, target) {
    const amount = Number(rule.amount);
    const unit = isFinite(amount) ? amount : 0;
    let base;
    if (rule.perBoard) base = state.board.length * unit;
    else if (rule.perBench) base = state.hand.length * unit;
    else if (rule.perGain) base = state.roundGains * unit;
    else if (rule.perRefresh) base = state.refreshes * unit;
    else if (rule.perRow) base = state.board.filter(function (o) { return o.r === op.r; }).length * unit;
    else if (rule.perDistinctTier) base = distinctTierCount(rule.perDistinctTier) * unit;
    else if (rule.priceSum) base = boardPriceSum() * (Number(rule.priceSumMul) || 1);
    else if (rule.priceTarget) base = opPriceOf(target) * (Number(rule.priceMul) || 1);
    else if (rule.priceSelf) base = opPriceOf(op) * (Number(rule.priceMul) || 1);
    else base = unit;
    return Math.max(0, Math.floor(base) || 0);
  }

  function grantFreeRefresh(op, rule) {
    const want = Math.floor(Number(rule.freeRefresh) || 0);
    if (want <= 0) return 0;
    const key = 'free:' + op.name;
    const used = state.freeGainCounts[key] || 0;
    const max = rule.maxFree != null ? Number(rule.maxFree) : Infinity;
    const add = Math.max(0, Math.min(want, max - used));
    if (add <= 0) {
      log(op.name + '：免费刷新已达到上限（' + max + ' 次）', 'warn');
      return 0;
    }
    state.freeGainCounts[key] = used + add;
    state.freeRefreshes += add;
    log(op.name + '：免费刷新 +' + add + '（当前 ' + state.freeRefreshes + ' 次）', 'gain');
    return add;
  }

  function ruleCounterKey(op, bond, rule, suffix) {
    return op.uid + ':' + bond + ':' + rule.event + ':' + (rule.key || '') + ':' + suffix;
  }

  function applyRule(op, rule, ctx) {
    if (!rule || rule.special || rule.passive) return 0;
    if (rule.battleCapAura || rule.grantFrontTrait || rule.triggerFrontGain) return 0;

    let total = 0;

    if (rule.convert) {
      const bond = rule.convert.bond;
      let amount = Math.floor(Number(rule.convert.amount) || 0);
      if (rule.convert.perTag) amount *= countTag(rule.convert.perTag);
      const t = state.temp[bond] || 0;
      // 不能先扣临时层再让 addLayer 因 999 封顶返回 0，否则临时层会被静默吃掉。
      const room = Math.max(0, 999 - (state.layers[bond] || 0));
      const n = Math.min(amount, t, room);
      if (n <= 0) {
        log(op.name + (room <= 0 ? '：【' + bond + '】已达 999 层，保留临时层' : '：没有可转化的【' + bond + '】临时层'), 'warn');
        return 0;
      }
      state.temp[bond] = t - n;
      total += addLayer(bond, n, op.name + ' · 临时转固定', { opName: op.name, targetName: op.name });
      return total;
    }

    if (rule.freeRefresh) {
      grantFreeRefresh(op, rule);
      if (!rule.bonds) return 0;
    }

    if (rule.firstRefresh && state.refreshes !== 1) {
      log(op.name + '：本回合首次刷新已过，跳过', 'warn');
      return 0;
    }

    const targets = resolveTargets(op, rule);
    if (!targets.length) {
      log(op.name + '：' + EVENT_LABEL[rule.event] + ' 没有可生效的目标', 'warn');
      return 0;
    }

    for (let ti = 0; ti < targets.length; ti++) {
      const target = targets[ti];
      const bonds = resolveRuleBonds(target, rule);
      if (!bonds.length) {
        if (ti === 0) log(op.name + '：' + EVENT_LABEL[rule.event] + ' 没有可生效的已激活盟约', 'warn');
        continue;
      }
      if (ctx && ctx.enemy && !ctx.noCell) {
        if (!inRange(target, ctx.enemy.r, ctx.enemy.c)) continue;
      }
      let base = computeRuleBase(op, rule, target);
      if (base <= 0) continue;

      const roundInfo = rule.perRound
        ? (COMBAT_ROUND_EVENTS[rule.event] ? stackCapParts(target, rule.perRound) : { base: rule.perRound, m3: 0, front: 0, viviana: 0, total: rule.perRound })
        : null;
      const battleInfo = rule.perBattle ? stackCapParts(target, rule.perBattle) : null;
      const capInfo = battleInfo || roundInfo;

      for (let bi = 0; bi < bonds.length; bi++) {
        const bond = bonds[bi];
        let n = base;
        if (roundInfo) {
          const key = ruleCounterKey(target, bond, rule, 'r');
          const used = state.counters[key] || 0;
          n = Math.min(n, roundInfo.total - used);
          if (n <= 0) continue;
          state.counters[key] = used + n;
        }
        if (battleInfo) {
          const key = ruleCounterKey(target, bond, rule, 'b');
          const used = state.battleCounters[key] || 0;
          n = Math.min(n, battleInfo.total - used);
          if (n <= 0) continue;
          state.battleCounters[key] = used + n;
        }
        if (rule.perTotal) {
          const key = ruleCounterKey(target, bond, rule, 't');
          const used = state.totalCounters[key] || 0;
          n = Math.min(n, rule.perTotal - used);
          if (n <= 0) continue;
          state.totalCounters[key] = used + n;
        }
        const bonus = layerGainBonus(target);
        if (bonus > 0) n += bonus;
        const label = (rule.ownerName || op.name) + ' · ' + (EVENT_LABEL[rule.event] || rule.event) + (target.uid !== op.uid ? ' → ' + target.name : '');
        total += addLayer(bond, n, label, {
          temp: !!rule.temp,
          opName: rule.ownerName || op.name,
          targetName: target.name,
          cap: capInfo,
          capKey: target.uid + ':' + bond + ':' + rule.event + ':' + (rule.key || '')
        });
      }
    }
    return total;
  }

  // ---- 事件结算 ----
  function ruleMatchesElite(op, rule) {
    return rule.elite == null || (!!rule.elite === !!op.elite);
  }

  function handleGrantFrontTrait() {
    let count = 0;
    state.board.forEach(function (op) {
      (RULES[op.name] || []).forEach(function (rule) {
        if (rule.event !== 'onBattleStart' || !rule.grantFrontTrait) return;
        if (!ruleMatchesElite(op, rule)) return;
        const front = frontOp(op, 1);
        if (!front) return;
        const spec = rule.grantFrontTrait;
        state.grantedTraits = state.grantedTraits.filter(function (t) {
          return !(t.targetUid === front.uid && t.source === op.name);
        });
        state.grantedTraits.push({
          targetUid: front.uid, targetName: front.name, source: op.name,
          amount: Number(spec.amount) || 0, perRound: Number(spec.perRound) || 0,
          elite: !!op.elite
        });
        log(op.name + '：身前的 ' + front.name + ' 获得特质「开启技能时使自身已激活盟约+' + spec.amount + '（每回合至多 ' + spec.perRound + ' 层）」', 'event');
        count++;
      });
    });
    // 只是“获得特质”，不是立刻叠层；不要把它计入事件日志的 +N 层
    if (count) log('已授予 ' + count + ' 个特质；目标开启技能时才会触发叠层', 'event');
    return 0;
  }

  function handleTriggerFrontGain() {
    let gains = 0;
    let unsupported = 0;
    state.board.forEach(function (op) {
      (RULES[op.name] || []).forEach(function (rule) {
        if (rule.event !== 'onPrepStart' || !rule.triggerFrontGain) return;
        if (!ruleMatchesElite(op, rule)) return;
        opsInFront(op, Number(rule.triggerFrontGain) || 1).filter(function (t) {
          return t.uid !== op.uid;
        }).forEach(function (target) {
          (RULES[target.name] || []).forEach(function (gainRule) {
            if (gainRule.event !== 'onGain' || !ruleMatchesElite(target, gainRule)) return;
            if (gainRule.special) { unsupported++; return; }
            gains += applyRule(target, gainRule, { op: target, fromTrait: true });
          });
          log(op.name + '：触发 ' + target.name + ' 的「获得时」效果', 'event');
        });
      });
    });
    if (unsupported) log('铃兰：有 ' + unsupported + ' 条「获得时」特殊效果暂未模拟', 'warn');
    return gains;
  }

  function handleDeployAuras(ctx) {
    const deployed = ctx && ctx.op;
    if (!deployed || state.phase !== 'combat') return 0;
    let gains = 0;
    state.board.forEach(function (v) {
      if (v.name !== '浊心斯卡蒂' || v.uid === deployed.uid) return;
      if (!isBondActive('阿戈尔')) return;
      if (!inRange(v, deployed.r, deployed.c)) return;
      const amount = v.elite ? 4 : 2;
      const capInfo = stackCapParts(v, v.elite ? 40 : 20);
      const key = v.uid + ':阿戈尔:onDeploy:b';
      const used = state.battleCounters[key] || 0;
      const n = Math.min(amount, capInfo.total - used);
      if (n <= 0) return;
      state.battleCounters[key] = used + n;
      gains += addLayer('阿戈尔', n, v.name + ' · 浊心斯卡蒂光环', {
        opName: v.name, targetName: deployed.name, cap: capInfo, capKey: key
      });
    });
    if (gains) log('浊心斯卡蒂：友军部署触发【阿戈尔】+' + gains, 'event');
    return gains;
  }

  function handleTeamWideKill(ctx) {
    if (!ctx || !ctx.op || state.phase !== 'combat') return 0;
    const killer = ctx.op;
    let gains = 0;
    const sources = [];

    state.board.forEach(function (owner) {
      if (owner.uid === killer.uid) return; // 自己击倒时由正常 onKill 规则结算，避免重复
      (RULES[owner.name] || []).forEach(function (rule) {
        if (rule.event !== 'onKill' || !rule.teamWide || !ruleMatchesElite(owner, rule)) return;
        const spec = rule.teamWideKill || {};
        if (spec.killerTag && opTags(killer).indexOf(spec.killerTag) < 0) return;
        if (spec.killerTags && !opTags(killer).some(function (t) { return spec.killerTags.indexOf(t) >= 0; })) return;
        if (spec.requireElite && !owner.elite) return;
        const got = applyRule(owner, rule, { op: killer, forceInRange: true, noCell: true });
        if (got) {
          gains += got;
          if (sources.indexOf(owner.name) < 0) sources.push(owner.name);
        }
      });
    });

    if (gains) log(sources.join('、') + '：' + killer.name + ' 击倒敌人，全队叠层 +' + gains, 'event');
    return gains;
  }

  function applyGrantedTraits(op) {
    if (!op) return 0;
    let gains = 0;
    state.grantedTraits.forEach(function (t) {
      if (t.targetUid !== op.uid) return;
      const rule = {
        event: 'onSkill', bonds: 'active', amount: t.amount, perRound: t.perRound,
        requireActive: true, key: 'trait:' + t.source, ownerName: t.source
      };
      gains += applyRule(op, rule, { op: op });
    });
    if (gains) log(op.name + '：特质「开启技能时」触发 +' + gains + ' 层', 'event');
    return gains;
  }

  function triggerEvent(event, ctx) {
    ctx = ctx || {};
    let gains = 0;
    let unsupported = 0;

    function runFor(op, benchOnly) {
      const rules = RULES[op.name] || [];
      rules.forEach(function (rule) {
        if (rule.event !== event) return;
        if (benchOnly && !rule.bench) return;
        if (!ruleMatchesElite(op, rule)) return;
        if (rule.special) { unsupported++; return; }
        if (rule.passive || rule.battleCapAura || rule.grantFrontTrait || rule.triggerFrontGain) return;
        gains += applyRule(op, rule, ctx);
      });
    }

    if (event === 'onGain') {
      if (!ctx.op) { toast('请先选择待部署区中的一名干员'); return; }
      runFor(ctx.op, false);
    } else {
      const boardOps = ctx.op ? [ctx.op] : state.board;
      boardOps.forEach(function (op) { runFor(op, false); });
      if (!ctx.op) {
        benchOps().forEach(function (op) { runFor(op, true); });
      }
      if (event === 'onPrepStart') gains += handleTriggerFrontGain();
      if (event === 'onBattleStart') handleGrantFrontTrait();
      if (event === 'onDeploy') gains += handleDeployAuras(ctx);
      if (event === 'onKill') gains += handleTeamWideKill(ctx);
      if (event === 'onSkill') {
        const ops = ctx.op ? [ctx.op] : state.board;
        ops.forEach(function (op) { gains += applyGrantedTraits(op); });
      }
    }

    if (!ctx.silent) {
      if (unsupported) {
        log('事件：' + (EVENT_LABEL[event] || event) + ' · ' + unsupported + ' 条特殊效果暂未模拟（见干员详情）', 'warn');
      }
      log('事件：' + (EVENT_LABEL[event] || event) + (gains ? ' · 共 +' + gains + ' 层' : ' · 无叠层变化'), gains ? 'event' : 'warn');
    }
    if (!ctx.noRender) renderAll();
    return gains;
  }

  // ---- 盟约级叠层效果（不依赖具体干员名） ----
  // 阿戈尔：按「左 → 上」优先发起递归吞噬；被吞噬的阿戈尔继续吞噬自己身前一格；每个目标每场只加一次。
  function egirTier(op) {
    const m = metaOf(op.name);
    return m && Number(m.tier) > 0 ? Number(m.tier) : 6;
  }

  function egirTierLabel(op) {
    const m = metaOf(op.name);
    return (m && (m.tierLabel || m.tier)) || 'VI';
  }

  function egirOrder(a, b) {
    // 本地 r=0 是最上行；参考项目 r=0 是底部，所以这里用 r 升序而不是降序。
    return a.c - b.c || a.r - b.r || a.uid - b.uid;
  }

  function egirMembers() {
    const seen = {};
    return state.board
      .filter(function (o) { return opTags(o).indexOf('阿戈尔') >= 0; })
      .filter(function (o) {
        if (seen[o.name]) return false;
        seen[o.name] = true;
        return true;
      })
      .filter(function () { return isBondActive('阿戈尔'); })
      .slice()
      .sort(egirOrder);
  }

  // 战斗开始的吞噬标记。语义（2026-11-13 修正）：
  // · 每名阿戈尔都从自己出发、沿「身前一格」连链：被吞噬的阿戈尔继续吞噬自己身前一格；
  // · 同一目标可以同时被多名阿戈尔吞噬（例如两人身前是同一格），每个吞噬者都要留下标记，
  //   各自获得目标的基础攻击力/阻挡数（沙盒暂不模拟属性，只记录标记）；
  // · 层数不在这里去重，由 applyEgirDevour 按「不同目标」只加一次；
  // · 「更靠左、再靠上」的优先级只在 A→B、B→A 相互吞噬时生效：先手吃掉对方，后者不再反吃。
  function planEgirDevour() {
    const members = egirMembers();
    const marks = [];
    const markedBy = {};   // 发起者 uid → 它标记到的目标 uid（用于相互吞噬判定）
    members.forEach(function (start) {
      const mine = [];
      const seen = {};
      seen[start.uid] = true;
      let current = start;
      while (true) {
        const target = frontOp(current, 1);
        if (!target) break;
        // 成环 / 本链已经走过
        if (seen[target.uid]) break;
        // 相互吞噬：目标已经标记过我 → 目标优先，我不再标记它
        if ((markedBy[target.uid] || []).indexOf(start.uid) >= 0) break;
        seen[target.uid] = true;
        mine.push(target);
        // 非阿戈尔：链终止；阿戈尔：继续由它吞噬自己身前一格
        if (opTags(target).indexOf('阿戈尔') < 0) break;
        current = target;
      }
      markedBy[start.uid] = mine.map(function (t) { return t.uid; });
      mine.forEach(function (t) { marks.push({ from: start, to: t, tier: egirTier(t) }); });
    });
    return { members: members, marks: marks };
  }

  function applyEgirDevour() {
    if (state.egirStarted) return 0;
    state.egirStarted = true;
    if (!state.board.some(function (o) { return opTags(o).indexOf('阿戈尔') >= 0; })) return 0;
    if (!isBondActive('阿戈尔')) {
      log('阿戈尔：未激活，跳过战斗开始吞噬', 'warn');
      return 0;
    }
    const plan = planEgirDevour();
    // 同一目标可能被多名阿戈尔同时吞噬：按目标归并，层数每个目标只加一次，
    // 来源列出全部吞噬者（每个吞噬者各自获得目标的基础攻击力/阻挡数；沙盒不模拟属性）。
    const rows = [];
    const rowOf = {};
    plan.marks.forEach(function (mk) {
      let row = rowOf[mk.to.uid];
      if (!row) {
        row = rowOf[mk.to.uid] = { to: mk.to, tier: mk.tier, froms: [] };
        rows.push(row);
      }
      row.froms.push(mk.from);
    });
    const devoured = rows.map(function (row) { return row.to; });
    let gains = 0;
    rows.forEach(function (row) {
      const fromNames = row.froms.map(function (f) { return f.name; }).join('、');
      gains += addLayer('阿戈尔', row.tier, '阿戈尔吞噬 · ' + fromNames + ' → ' + row.to.name + '（' + egirTierLabel(row.to) + ' 阶）', {
        // 吞噬层是盟约机制产生的，不归到发起吞噬的干员头上。
        opName: '阿戈尔吞噬',
        targetName: row.to.name,
        kind: 'bond:devour',
        detail: '吞噬',
        tier: row.tier,
        markerUid: row.froms[0].uid,
        markerUids: row.froms.map(function (f) { return f.uid; })
      });
    });
    if (!devoured.length) {
      log('阿戈尔：战斗开始没有可吞噬的目标', 'warn');
      return 0;
    }

    const downOrder = devoured.slice().sort(function (a, b) {
      // 击倒/复活批次先处理更靠左、再靠下的单位（本地 r 越大越靠下）。
      return a.c - b.c || b.r - a.r || a.uid - b.uid;
    });
    const names = downOrder.map(function (t) { return t.name; });
    log('阿戈尔：战斗开始吞噬 ' + devoured.length + ' 名（' + names.join('、') + '）' +
      (plan.marks.length > devoured.length ? '，' + plan.marks.length + ' 次吞噬标记' : '') +
      '，+' + gains + ' 层', 'event');

    // 被吞噬者按「击倒」结算：触发其自身「我方被击倒时」词条。
    // 沙盒没有 HP/DEF 模型，不把单位移出棋盘，只记录击倒/复活结果。
    let knockdownGains = 0;
    downOrder.forEach(function (t) {
      knockdownGains += triggerEvent('onKnockdown', {
        op: t, source: 'egirDevour', silent: true, noRender: true
      }) || 0;
    });
    log('阿戈尔：被吞噬者按击倒结算（按左→下）：' + names.join('、') + (knockdownGains ? '，额外 +' + knockdownGains + ' 层' : ''), 'event');

    // 6 名不同阿戈尔：前 3 名首次被击倒的阿戈尔立刻复活。
    const egirRow = getEval().rows.find(function (r) { return r.name === '阿戈尔'; });
    if (egirRow && egirRow.state === 'empowered') {
      const revived = downOrder.filter(function (t) {
        return opTags(t).indexOf('阿戈尔') >= 0;
      }).slice(0, 3);
      if (revived.length) {
        log('阿戈尔：前 ' + revived.length + ' 名被击倒的阿戈尔立刻复活（按左→下）：' +
          revived.map(function (t) { return t.name; }).join('、') + '（沙盒不模拟退场）', 'event');
      }
    }
    return gains + knockdownGains;
  }

  // 助力：休整期结束时所有已激活盟约 +2（3 名不同/精锐 +4）。
  function applyDeputLayers() {
    if (!isBondActive('助力')) return 0;
    const row = getEval().rows.find(function (r) { return r.name === '助力'; });
    if (!row) return 0;
    const amount = row.state === 'empowered' ? 4 : 2;
    let gains = 0;
    getEval().rows.filter(function (r) {
      return r.state === 'active' || r.state === 'empowered';
    }).forEach(function (r) {
      gains += addLayer(r.name, amount, '助力 · 休整期结束', {
        opName: '助力',
        detail: '休整期'
      });
    });
    if (gains) log('助力：所有已激活盟约 +' + amount + ' 层（共 +' + gains + '）', 'event');
    return gains;
  }

  function beginBattle() {
    if (state.phase !== 'combat') return 0;
    if (state.battleStartDone) return 0;
    state.battleStartDone = true;
    state.battleCounters = {};
    // 盟约级钩子走事件总线；干员规则仍走现有的 triggerEvent，保持兼容。
    BUS.emit('battleStart', {});
    triggerEvent('onBattleStart');
    logBattleCapAuras();
    return 0;
  }

  BUS.on('battleStart', applyEgirDevour, { priority: 100 });

  // 沙盘测试便捷操作：把「战斗中」的每回合/每场战斗上限，以及已获得的特质补到上限。
  // 只处理真正在战斗中触发的事件（开技能/部署/击倒/战斗中），不会碰休整期的 perRound。
  const COMBAT_ROUND_EVENTS = { onSkill: true, onDeploy: true, onKill: true, onCombat: true };

  /** 特殊叠层：目前只有文本、但已有明确上限的规则（Calc.SPECIAL_CAPS）。 */
  function specialCapEntries(op) {
    const list = (window.Calc && window.Calc.SPECIAL_CAPS && window.Calc.SPECIAL_CAPS[op.name]) || [];
    return list.filter(function (e) { return !!e.elite === !!op.elite; });
  }

  function specialCapTargets(op, entry) {
    const out = [op];
    if (entry.target === 'selfAndBehind1') {
      const behind = backOp(op, 1);
      if (behind) out.push(behind);
    }
    return out;
  }

  function specialCapBonds(target, entry) {
    if (Array.isArray(entry.bonds)) {
      return entry.bonds.filter(function (b) { return isBondActive(b); });
    }
    if (entry.bonds === 'activeSelf') return selfActiveBonds(target);
    if (entry.bonds === 'activeAll') {
      return getEval().rows.filter(function (r) {
        return r.state === 'active' || r.state === 'empowered';
      }).map(function (r) { return r.name; });
    }
    return [];
  }

  function applySpecialBattleCaps() {
    let gains = 0;
    state.board.forEach(function (op) {
      const entries = specialCapEntries(op);
      entries.forEach(function (entry, idx) {
        const cap = Math.max(0, Math.floor(Number(entry.cap) || 0));
        if (!cap) return;
        specialCapTargets(op, entry).forEach(function (target) {
          specialCapBonds(target, entry).forEach(function (bond) {
            const key = op.uid + ':special:' + entry.event + ':' + entry.scope + ':' + idx + ':' + target.uid + ':' + bond;
            const store = entry.scope === 'battle' ? state.battleCounters : state.counters;
            const used = store[key] || 0;
            const n = cap - used;
            if (n <= 0) return;
            const applied = addLayer(bond, n, op.name + ' · 特殊上限补满', {
              opName: op.name,
              targetName: target.name,
              kind: 'bond:special-cap',
              detail: '特殊上限',
              cap: { base: cap, bonuses: [], total: cap },
              capKey: key
            });
            if (applied > 0) {
              store[key] = used + applied;
              gains += applied;
            }
          });
        });
      });
    });
    if (gains) log('特殊上限补满：+' + gains + ' 层（含尚未实现事件的 special 上限）', 'event');
    return gains;
  }

  function applyBattleCaps() {
    if (state.phase !== 'combat') { toast('仅可在作战期补满叠层上限'); return; }
    let gains = 0;
    state.board.forEach(function (op) {
      (RULES[op.name] || []).forEach(function (rule) {
        if (rule.special || rule.passive || !ruleMatchesElite(op, rule)) return;
        const fillRound = !!rule.perRound && !!COMBAT_ROUND_EVENTS[rule.event];
        const fillBattle = !!rule.perBattle;
        if (!fillRound && !fillBattle) return;
        const targets = resolveTargets(op, rule);
        targets.forEach(function (target) {
          const bonds = resolveRuleBonds(target, rule);
          const roundInfo = fillRound ? stackCapParts(target, rule.perRound) : null;
          const battleInfo = fillBattle ? stackCapParts(target, rule.perBattle) : null;
          const capInfo = battleInfo || roundInfo;
          bonds.forEach(function (bond) {
            let n = Infinity;
            let keyR = '';
            let usedR = 0;
            let keyB = '';
            let usedB = 0;
            if (roundInfo) {
              keyR = ruleCounterKey(target, bond, rule, 'r');
              usedR = state.counters[keyR] || 0;
              n = Math.min(n, roundInfo.total - usedR);
            }
            if (battleInfo) {
              keyB = ruleCounterKey(target, bond, rule, 'b');
              usedB = state.battleCounters[keyB] || 0;
              n = Math.min(n, battleInfo.total - usedB);
            }
            if (!isFinite(n) || n <= 0) return;
            if (roundInfo) state.counters[keyR] = usedR + n;
            if (battleInfo) state.battleCounters[keyB] = usedB + n;
            gains += addLayer(bond, n, op.name + ' · 补满叠层', {
              temp: !!rule.temp, opName: op.name, targetName: target.name,
              cap: capInfo,
              capKey: target.uid + ':' + bond + ':' + rule.event + ':' + (rule.key || '')
            });
          });
        });
      });
    });

    // 特殊叠层：这些规则仍只有 special 文本，但已有明确上限；一键补满按上限计算。
    gains += applySpecialBattleCaps();

    // 华法琳等来源授予的特质：按“目标开技能”的 perRound 上限补满
    state.grantedTraits.forEach(function (t) {
      const target = state.board.find(function (o) { return o.uid === t.targetUid; });
      if (!target) return;
      const amount = Number(t.perRound) || Number(t.amount) || 0;
      if (amount <= 0) return;
      gains += applyRule(target, {
        event: 'onSkill', bonds: 'active', amount: 9999, perRound: t.perRound,
        requireActive: true, key: 'trait:' + t.source, ownerName: t.source
      }, { op: target });
    });

    log('补满叠层（测试）：+ ' + gains + ' 层；含战斗中每回合/每场战斗上限、特殊上限与已获得特质', gains ? 'event' : 'warn');
    renderAll();
  }

  function canPlaceOrToast(name, r, c) {
    if (state.board.length >= MAX_BOARD) { toast('场上干员已达上限（' + MAX_BOARD + ' 名）'); return false; }
    if (canPlace(name, r, c)) return true;
    const info = TERRAIN[terrainAt(r, c)] || TERRAIN.ground;
    toast(info.deploy === 'ranged' ? '高台仅可部署远程干员' : '该地块不可部署');
    return false;
  }

  // 真正上场：待部署区与仓库两条来源都汇到这里。
  function commitPlacement(name, elite, r, c, dir) {
    const op = { uid: state.uid++, name: name, r: r, c: c, dir: dir || 'right', elite: !!elite };
    state.board.push(op);
    state.selectedHand = null;
    state.selectedWarehouse = null;
    state.selectedOp = op.uid;
    state.mode = 'idle';
    log('部署 ' + name + (op.elite ? '（精锐）' : '') + ' 到 r' + (r + 1) + 'c' + (c + 1) + ' · 朝' + DIR_LABEL[op.dir], 'event');
    if (state.phase === 'combat') {
      triggerEvent('onDeploy', { op: op });
    } else {
      log('休整期部署：只记录位置，不触发「战斗中·部署时」', 'warn');
      renderAll();
    }
  }

  function placeHand(name, r, c, dir, handId) {
    let idx = handId ? state.hand.findIndex(function (it) { return it.id === handId; }) : -1;
    if (idx < 0) idx = state.hand.findIndex(function (it) { return it.name === name; });
    if (idx < 0) return;
    if (!canPlaceOrToast(name, r, c)) return;
    const item = state.hand[idx];
    state.hand.splice(idx, 1);
    commitPlacement(name, !!item.elite, r, c, dir);
  }

  // 仓库 → 棋盘：不经过待部署区，直接按普通（非精锐）状态上场。
  function placeFromWarehouse(name, r, c, dir) {
    if (!canPlaceOrToast(name, r, c)) return;
    commitPlacement(name, false, r, c, dir);
  }

  // ---- 拖动放置：第一步拖到格子，第二步从格子拖方向 ----
  let facing = null;

  function positionGhost(x, y) {
    if (!drag || !drag.ghost) return;
    drag.ghost.style.left = x + 'px';
    drag.ghost.style.top = y + 'px';
  }

  function overHandPanel(x, y) {
    if (!handPanelEl) return false;
    const r = handPanelEl.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function startDrag(name, e, origin, handId) {
    origin = origin || 'hand';
    if (origin === 'hand' && !state.hand.some(function (it) { return it.id === handId; })) return;
    if (origin === 'warehouse' && !state.warehouse.includes(name)) return;
    if (origin === 'hand' && state.board.length >= MAX_BOARD) { toast('场上干员已达上限（' + MAX_BOARD + ' 名）'); return; }
    if (e.button != null && e.button !== 0) return;
    if (state.pending) cancelPending();
    hideTip();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.innerHTML = '<img src="' + esc(avatarOf(name)) + '" alt="' + esc(name) + '" draggable="false" onerror="this.style.visibility=\'hidden\'">';
    document.body.appendChild(ghost);
    drag = {
      mode: origin, name: name, handId: handId || null, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      cell: null, active: false, ghost: ghost, overHand: false
    };
    positionGhost(e.clientX, e.clientY);
    document.body.classList.add('dragging-op');
    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragUp);
    window.addEventListener('pointercancel', onDragCancel);
  }

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (!drag.active && dist > 5) drag.active = true;
    positionGhost(e.clientX, e.clientY);
    if (!drag.active) return;
    e.preventDefault();

    if (drag.mode === 'warehouse') {
      const over = overHandPanel(e.clientX, e.clientY);
      if (over !== drag.overHand) {
        drag.overHand = over;
        if (handPanelEl) handPanelEl.classList.toggle('hand-drop', over);
      }
      // 在待部署区上方时不预览棋盘；否则按普通拖拽继续找可放置格
      if (over) {
        if (drag.cell) { drag.cell = null; updateDropPreview(); }
        return;
      }
    }

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest ? el.closest('.cell') : null;
    if (cell) {
      const r = Number(cell.getAttribute('data-r'));
      const c = Number(cell.getAttribute('data-c'));
      const ok = drag.mode === 'move' ? canMoveTo(drag.uid, r, c) : canPlace(drag.name, r, c);
      if (ok) {
        if (!drag.cell || drag.cell.r !== r || drag.cell.c !== c) {
          drag.cell = { r: r, c: c };
          updateDropPreview();
        }
      } else if (drag.cell) {
        drag.cell = null;
        updateDropPreview();
      }
    } else if (drag.cell) {
      drag.cell = null;
      updateDropPreview();
    }
  }

  function dropPreviewHtml() {
    return '<div class="drop-preview simple">' +
      '<img src="' + esc(avatarOf(drag.name)) + '" alt="' + esc(drag.name) + '" draggable="false" onerror="this.style.visibility=\'hidden\'">' +
      '<div class="drop-hint">释放以放置于此</div>' +
    '</div>';
  }

  function updateDropPreview() {
    const cells = boardEl.querySelectorAll('.cell.drop-target');
    for (let i = 0; i < cells.length; i++) cells[i].classList.remove('drop-target');
    const previews = boardEl.querySelectorAll('.drop-preview');
    for (let i = 0; i < previews.length; i++) previews[i].remove();
    if (!drag || !drag.cell) {
      if (drag && drag.ghost) drag.ghost.classList.remove('over');
      return;
    }
    const target = boardEl.querySelector('.cell[data-r="' + drag.cell.r + '"][data-c="' + drag.cell.c + '"]');
    if (!target) return;
    target.classList.add('drop-target');
    target.insertAdjacentHTML('beforeend', dropPreviewHtml());
    if (drag.ghost) drag.ghost.classList.add('over');
  }

  function cleanupDrag() {
    if (!drag) return;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    window.removeEventListener('pointercancel', onDragCancel);
    if (drag.ghost) drag.ghost.remove();
    document.body.classList.remove('dragging-op');
    if (handPanelEl) handPanelEl.classList.remove('hand-drop');
    const cells = boardEl.querySelectorAll('.cell.drop-target');
    for (let i = 0; i < cells.length; i++) cells[i].classList.remove('drop-target');
    const previews = boardEl.querySelectorAll('.drop-preview');
    for (let i = 0; i < previews.length; i++) previews[i].remove();
    drag = null;
  }

  function onDragUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = { mode: drag.mode, name: drag.name, uid: drag.uid, handId: drag.handId, active: drag.active, cell: drag.cell, overHand: drag.overHand };
    cleanupDrag();
    if (!d.active) return;
    lastDragEnd = Date.now();
    if (d.mode === 'warehouse') {
      if (d.overHand) { addToHand(d.name); return; }
      if (d.cell) { beginPending(d.name, d.cell.r, d.cell.c, null, { fromWarehouse: true }); return; }
      toast('可拖入战场任意可部署地块，或拖入下方「待部署区」');
      return;
    }
    if (d.mode === 'move') {
      if (d.cell) beginMovePending(d.uid, d.cell.r, d.cell.c);
      else toast('请拖入可部署地块；已有干员的地块将交换位置');
      return;
    }
    if (d.cell) beginPending(d.name, d.cell.r, d.cell.c, d.handId);
    else toast('请将干员拖入可部署地块');
  }

  function onDragCancel() {
    cleanupDrag();
    lastDragEnd = Date.now();
  }

  function beginPending(name, r, c, handId, opts) {
    hideTip();
    const fromWarehouse = !!(opts && opts.fromWarehouse);
    const item = handId ? state.hand.find(function (it) { return it.id === handId; }) : null;
    if (!fromWarehouse && !item) return;
    if (!canPlace(name, r, c)) { toast('该地块不可部署'); return; }
    state.pending = {
      kind: 'place', handId: fromWarehouse ? null : item.id, name: name, r: r, c: c, dir: null,
      elite: fromWarehouse ? false : !!item.elite, fromWarehouse: fromWarehouse
    };
    state.selectedHand = null;
    state.selectedWarehouse = null;
    state.selectedOp = null;
    state.mode = 'idle';
    renderAll();
    toast('已放置：拖动方向或点击箭头确定朝向');
  }

  function beginMovePending(uid, r, c) {
    if (combatLocked('移动干员')) return;
    const op = state.board.find(function (o) { return o.uid === uid; });
    if (!op) return;
    if (!canMoveTo(uid, r, c)) { toast('无法移动至该地块'); return; }
    const snapshot = state.board.map(function (o) { return { uid: o.uid, name: o.name, r: o.r, c: o.c, dir: o.dir, elite: !!o.elite }; });
    const target = opAt(r, c);
    state.board = state.board.filter(function (o) { return o.uid !== uid; });
    if (target && target.uid !== uid) {
      state.board = state.board.filter(function (o) { return o.uid !== target.uid; });
      state.board.push({ uid: target.uid, name: target.name, r: op.r, c: op.c, dir: target.dir, elite: !!target.elite });
    }
    state.pending = { kind: 'move', uid: op.uid, name: op.name, elite: !!op.elite, r: r, c: c, dir: null, snapshot: snapshot };
    state.selectedOp = null;
    state.selectedHand = null;
    state.selectedWarehouse = null;
    renderAll();
    toast(target && target.uid !== uid ? '位置已交换：请为移动的干员确定新朝向' : '移动中：拖动方向确定朝向');
  }

  function pendingCellEl() {
    if (!state.pending) return null;
    return boardEl.querySelector('.cell[data-r="' + state.pending.r + '"][data-c="' + state.pending.c + '"]');
  }

  function updatePendingWheel() {
    if (!state.pending) return;
    const box = boardEl.querySelector('.pending-preview');
    if (!box) return;
    const dir = state.pending.dir;
    const arrows = box.querySelectorAll('.pending-dir');
    for (let i = 0; i < arrows.length; i++) {
      arrows[i].classList.toggle('active', arrows[i].getAttribute('data-dir') === dir);
    }
    const hint = box.querySelector('.pending-hint');
    if (hint) hint.textContent = dir ? '释放以部署 · 朝' + DIR_LABEL[dir] : '拖动方向 / 点击箭头（默认右）';
  }

  function updatePendingRange() {
    const marked = boardEl.querySelectorAll('.range-preview, .range-preview-self');
    for (let i = 0; i < marked.length; i++) {
      marked[i].classList.remove('range-preview', 'range-preview-self');
    }
    if (!state.pending) return;
    const p = state.pending;
    const cells = rangeCellSet({ name: p.name, elite: p.elite, r: p.r, c: p.c, dir: p.dir || 'right' });
    cells.forEach(function (key) {
      const parts = key.split(',');
      const cell = boardEl.querySelector('.cell[data-r="' + parts[0] + '"][data-c="' + parts[1] + '"]');
      if (!cell) return;
      cell.classList.add('range-preview');
      if (Number(parts[0]) === p.r && Number(parts[1]) === p.c) cell.classList.add('range-preview-self');
    });
  }

  function startFacing(e) {
    hideTip();
    if (!state.pending) return;
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    facing = { pointerId: e.pointerId };
    window.addEventListener('pointermove', onFacingMove, { passive: false });
    window.addEventListener('pointerup', onFacingUp);
    window.addEventListener('pointercancel', onFacingCancel);
  }

  function onFacingMove(e) {
    if (!facing || e.pointerId !== facing.pointerId || !state.pending) return;
    const cell = pendingCellEl();
    if (!cell) return;
    e.preventDefault();
    const rect = cell.getBoundingClientRect();
    const vx = e.clientX - (rect.left + rect.width / 2);
    const vy = e.clientY - (rect.top + rect.height / 2);
    let nd = null;
    if (Math.hypot(vx, vy) > 14) {
      nd = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : (vy > 0 ? 'down' : 'up');
    }
    if (nd !== state.pending.dir) {
      state.pending.dir = nd;
      updatePendingWheel();
      updatePendingRange();
    }
  }

  function onFacingUp(e) {
    if (!facing || e.pointerId !== facing.pointerId) return;
    const dir = state.pending && state.pending.dir;
    cleanupFacing();
    lastDragEnd = Date.now();
    if (dir) confirmPending(dir);
    else toast('拖动至上 / 右 / 下 / 左箭头后释放，以确定朝向');
  }

  function onFacingCancel() {
    cleanupFacing();
    lastDragEnd = Date.now();
  }

  function cleanupFacing() {
    window.removeEventListener('pointermove', onFacingMove);
    window.removeEventListener('pointerup', onFacingUp);
    window.removeEventListener('pointercancel', onFacingCancel);
    facing = null;
  }

  function confirmPending(dir) {
    hideTip();
    const p = state.pending;
    if (!p) return;
    state.pending = null;
    cleanupFacing();
    if (p.kind === 'move') {
      if (combatLocked('移动干员')) return;
      const op = { uid: p.uid, name: p.name, r: p.r, c: p.c, dir: dir || 'right', elite: !!p.elite };
      state.board.push(op);
      state.selectedOp = op.uid;
      state.selectedHand = null;
      state.selectedWarehouse = null;
      log('重新部署 ' + p.name + ' 到 r' + (p.r + 1) + 'c' + (p.c + 1) + ' · 朝' + DIR_LABEL[op.dir], 'event');
      renderAll();
      return;
    }
    if (p.fromWarehouse) { placeFromWarehouse(p.name, p.r, p.c, dir || 'right'); return; }
    placeHand(p.name, p.r, p.c, dir || 'right', p.handId);
  }

  function cancelPending() {
    hideTip();
    if (!state.pending) return;
    const p = state.pending;
    if (p.kind === 'move' && p.snapshot) {
      state.board = p.snapshot.map(function (o) { return { uid: o.uid, name: o.name, r: o.r, c: o.c, dir: o.dir, elite: !!o.elite }; });
    }
    state.pending = null;
    cleanupFacing();
    renderAll();
    toast(p.kind === 'move' ? '已取消移动，位置已还原' : '已取消放置');
  }

  function retreat(uid) {
    if (combatLocked('撤退')) return;
    if (gearEditor.open && gearEditor.uid === uid) closeGearEditor();
    const idx = state.board.findIndex(function (o) { return o.uid === uid; });
    if (idx < 0) return;
    const op = state.board[idx];
    state.board.splice(idx, 1);
    state.grantedTraits = state.grantedTraits.filter(function (t) {
      return t.targetUid !== op.uid && t.source !== op.name;
    });
    if (state.hand.length < MAX_HAND) {
      const item = makeHandItem(op.name, op.elite);
      state.hand.push(item);
      state.selectedHand = item.id;
      log('撤退 ' + op.name + (op.elite ? '（精锐）' : '') + '，回到待部署区', 'event');
    } else {
      log('撤退 ' + op.name + '，待部署区已满，未返回待部署区', 'warn');
      toast('待部署区已满，干员未返回');
    }
    state.selectedOp = null;
    state.selectedWarehouse = null;
    renderAll();
  }

  function selectOp(uid) {
    state.selectedHand = null;
    state.selectedWarehouse = null;
    state.mode = 'idle';
    state.selectedOp = uid;
    renderAll();
  }

  function selectHand(id) {
    const item = state.hand.find(function (it) { return it.id === id; });
    if (!item) return;
    if (state.pending) cancelPending();
    state.selectedOp = null;
    state.selectedWarehouse = null;
    state.mode = 'idle';
    state.selectedHand = state.selectedHand === id ? null : id;
    renderAll();
  }

  function selectWarehouse(name) {
    if (!state.warehouse.includes(name)) return;
    if (state.pending) cancelPending();
    state.selectedOp = null;
    state.selectedHand = null;
    state.mode = 'idle';
    state.selectedWarehouse = state.selectedWarehouse === name ? null : name;
    renderAll();
  }

  const WH_TIER_LABEL = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  const WH_TRIGGER_ORDER = ['获得时', '进入休整期时', '休整期开始时', '休整期结束时', '战斗中',
    '战斗开始时', '战斗结束时', '售出时', '刷新时'];

  function whTriggerOptions() {
    const seen = {};
    const out = [];
    ALL_OP_NAMES.forEach(function (name) {
      const m = OP_META[name];
      if (!m) return;
      (m.normalTriggers || []).concat(m.eliteTriggers || []).forEach(function (t) {
        if (!t || t === '—' || seen[t]) return;
        seen[t] = 1;
        out.push(t);
      });
    });
    out.sort(function (a, b) {
      let ia = WH_TRIGGER_ORDER.indexOf(a), ib = WH_TRIGGER_ORDER.indexOf(b);
      if (ia < 0) ia = WH_TRIGGER_ORDER.length;
      if (ib < 0) ib = WH_TRIGGER_ORDER.length;
      return ia - ib || String(a).localeCompare(String(b), 'zh-Hans-CN');
    });
    return out;
  }

  function whFilterActiveCount() {
    const f = state.whFilter;
    return f.tiers.length + f.tags.length + f.triggers.length + (f.onlyTeam ? 1 : 0);
  }

  function whFilterAnyCondition() {
    return whFilterActiveCount() + ((state.whFilter.q || '').trim() ? 1 : 0);
  }

  function updateWhFilterUI() {
    const open = state.whFiltersOpen !== false;
    if (whFilters) whFilters.hidden = !open;
    if (whFilterToggle) whFilterToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (whFilterBadge) {
      const n = whFilterActiveCount();
      whFilterBadge.textContent = n;
      whFilterBadge.hidden = !n;
    }
    if (whClearAllBtn) {
      whClearAllBtn.disabled = whFilterAnyCondition() === 0;
    }
    if (whTagMode) {
      const btns = whTagMode.querySelectorAll('[data-wh-mode]');
      for (let i = 0; i < btns.length; i++) {
        btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-wh-mode') === state.whFilter.tagMode ? 'true' : 'false');
      }
    }
  }

  function renderWhFilterChips() {
    const f = state.whFilter;
    if (whTierChips) {
      let h = '';
      for (let t = 1; t <= 6; t++) {
        const on = f.tiers.indexOf(t) >= 0;
        h += '<button type="button" class="chip tier-chip" data-wh-tier="' + t + '" data-tier="' + t + '"' +
          ' aria-pressed="' + (on ? 'true' : 'false') + '" title="' + WH_TIER_LABEL[t - 1] + ' 阶">' +
          WH_TIER_LABEL[t - 1] + '</button>';
      }
      whTierChips.innerHTML = h;
    }
    if (whCovChips) {
      let h = '';
      DATA.covenants.forEach(function (c, i) {
        if (c.rank !== 'core' && i > 0 && DATA.covenants[i - 1].rank === 'core') {
          h += '<span class="chip-break" aria-hidden="true"></span>';
        }
        const on = f.tags.indexOf(c.name) >= 0;
        h += '<button type="button" class="chip chip-tag" data-wh-tag="' + esc(c.name) + '"' +
          ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
          (c.icon ? '<img src="' + esc(c.icon) + '" alt="">' : '') +
          '<span>' + esc(c.name) + '</span></button>';
      });
      whCovChips.innerHTML = h;
    }
    if (whTriggerChips) {
      let h = '';
      whTriggerOptions().forEach(function (t) {
        const on = f.triggers.indexOf(t) >= 0;
        h += '<button type="button" class="chip" data-wh-trigger="' + esc(t) + '"' +
          ' aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(t) + '</button>';
      });
      whTriggerChips.innerHTML = h;
    }
    updateWhFilterUI();
  }

  function syncWhControls() {
    if (whSearch) whSearch.value = state.whFilter.q || '';
    renderWhFilterChips();
    if (teamFilterBtn) teamFilterBtn.classList.toggle('active', !!state.whFilter.onlyTeam);
  }

  function initWhControls() {
    state.whFiltersOpen = typeof window !== 'undefined' && Number(window.innerHeight) >= 900;
    syncWhControls();
  }

  function toggleWhFilterPanel() {
    state.whFiltersOpen = state.whFiltersOpen === false;
    updateWhFilterUI();
  }

  function updateWhChipPressed() {
    const f = state.whFilter;
    function set(container, attr, values, cast) {
      if (!container) return;
      const btns = container.querySelectorAll('[' + attr + ']');
      for (let i = 0; i < btns.length; i++) {
        const raw = btns[i].getAttribute(attr);
        const v = cast ? cast(raw) : raw;
        btns[i].setAttribute('aria-pressed', values.indexOf(v) >= 0 ? 'true' : 'false');
      }
    }
    set(whTierChips, 'data-wh-tier', f.tiers, Number);
    set(whCovChips, 'data-wh-tag', f.tags);
    set(whTriggerChips, 'data-wh-trigger', f.triggers);
  }

  function toggleArrayValue(arr, value) {
    const i = arr.indexOf(value);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(value);
  }

  function toggleWhTier(t) {
    toggleArrayValue(state.whFilter.tiers, Number(t));
    updateWhChipPressed();
    updateWhFilterUI();
    renderWarehouse();
  }

  function toggleWhTag(name) {
    toggleArrayValue(state.whFilter.tags, name);
    updateWhChipPressed();
    updateWhFilterUI();
    renderWarehouse();
  }

  function toggleWhTrigger(name) {
    toggleArrayValue(state.whFilter.triggers, name);
    updateWhChipPressed();
    updateWhFilterUI();
    renderWarehouse();
  }

  function setWhTagMode(mode) {
    state.whFilter.tagMode = mode === 'and' ? 'and' : 'or';
    updateWhFilterUI();
    renderWarehouse();
  }

  function clearWhGroup(group) {
    const f = state.whFilter;
    if (group === 'tiers') f.tiers = [];
    else if (group === 'tags') f.tags = [];
    else if (group === 'triggers') f.triggers = [];
    else return;
    updateWhChipPressed();
    updateWhFilterUI();
    renderWarehouse();
  }

  function importTeamCode() {
    const text = prompt('请粘贴 GSPA3 / GSPA2 配队码（或包含配队码的链接）');
    if (!text) return;
    if (!window.Code || !Code.decode) { toast('配队码解码器未加载'); return; }
    const res = Code.decode(text, DATA);
    if (!res || !res.team || !res.team.slots) { toast('无法解析这个配队码'); return; }
    const names = [];
    const items = [];
    res.team.slots.forEach(function (s) {
      if (!s) return;
      const name = s.k || s.p;
      if (!name || !OP_META[name]) return;
      if (names.indexOf(name) >= 0) return;
      names.push(name);
      items.push(makeHandItem(name, !!s.e));
    });
    if (!items.length) { toast('配队码中未包含可识别的干员'); return; }
    state.hand = items.slice(0, MAX_HAND);
    state.teamFilter = names.slice(0, MAX_HAND);
    state.whFilter.onlyTeam = true;
    state.roundGains = 0;
    state.selectedHand = null;
    state.selectedWarehouse = null;
    state.selectedOp = null;
    log('导入配队码：' + state.teamFilter.length + ' 名干员进入待部署区', 'event');
    renderAll();
    syncWhControls();
    toast('已导入 ' + state.teamFilter.length + ' 名干员' + (res.warnings && res.warnings.length ? '（有提示）' : ''));
  }

  function toggleTeamFilter() {
    if (!state.teamFilter.length) { toast('请先导入配队码'); return; }
    state.whFilter.onlyTeam = !state.whFilter.onlyTeam;
    if (teamFilterBtn) teamFilterBtn.classList.toggle('active', !!state.whFilter.onlyTeam);
    updateWhFilterUI();
    renderWarehouse();
  }

  function clearWhFilters() {
    if (!whFilterAnyCondition()) return;
    state.whFilter = { q: '', tiers: [], tags: [], triggers: [], tagMode: 'or', onlyTeam: false };
    syncWhControls();
    renderWarehouse();
    toast('已清除全部筛选条件');
  }

  function addToHand(name, elite) {
    if (!OP_META[name]) return;
    if (state.hand.length >= MAX_HAND) { toast('待部署区已满（' + MAX_HAND + ' 张）'); return; }
    const item = makeHandItem(name, elite);
    item.gainCounted = true;
    state.roundGains++;
    state.hand.push(item);
    state.selectedWarehouse = null;
    state.selectedHand = item.id;
    state.selectedOp = null;
    log(name + (item.elite ? '（精锐）' : '') + ' 加入待部署区（本回合获得 ' + state.roundGains + ' 名）', 'event');
    renderAll();
    toast(name + ' 已进入待部署区');
  }

  function moveHandToWarehouse(id) {
    const idx = state.hand.findIndex(function (it) { return it.id === id; });
    if (idx < 0) return;
    const item = state.hand[idx];
    if (state.pending && state.pending.handId === id) { toast('请先完成或取消当前放置'); return; }
    state.hand.splice(idx, 1);
    state.selectedHand = null;
    state.selectedWarehouse = item.name;
    state.selectedOp = null;
    log(item.name + ' 从待部署区移除', 'event');
    renderAll();
  }

  function deleteHandItem(id) {
    const idx = state.hand.findIndex(function (it) { return it.id === id; });
    if (idx < 0) return;
    const item = state.hand[idx];
    if (state.pending && state.pending.handId === id) cancelPending();
    state.hand.splice(idx, 1);
    if (state.selectedHand === id) state.selectedHand = null;
    log('删除待部署区干员 ' + item.name, 'event');
    renderAll();
  }

  function clearHand() {
    if (!state.hand.length) { toast('待部署区已为空'); return; }
    if (state.pending) cancelPending();
    state.hand = [];
    state.selectedHand = null;
    log('已清空待部署区', 'event');
    renderAll();
    toast('待部署区已清空');
  }

  function toggleHandElite(id) {
    const item = state.hand.find(function (it) { return it.id === id; });
    if (!item) return;
    item.elite = !item.elite;
    renderAll();
    toast(item.name + (item.elite ? ' 已设为精锐' : ' 已撤销精锐'));
  }

  function toggleOpElite(uid) {
    if (combatLocked('晋升/撤销精锐')) return;
    const op = state.board.find(function (o) { return o.uid === uid; });
    if (!op) return;
    op.elite = !op.elite;
    const removed = trimGearToCap(op);
    if (removed) log('撤销精锐后 ' + op.name + ' 的装备槽缩减，已移除 ' + removed + ' 件超出的装备', 'warn');
    renderAll();
    toast(op.name + (op.elite ? ' 已设为精锐' : ' 已撤销精锐') + (removed ? '，超出的装备已移除' : ''));
  }

  function killEnemyAtCell(r, c) {
    if (state.phase !== 'combat') { toast('仅可在作战期击倒敌人'); return; }
    state.mode = 'idle';
    log('击倒 r' + (r + 1) + 'c' + (c + 1) + ' 的敌人（按格内范围结算）', 'event');
    triggerEvent('onKill', { enemy: { r: r, c: c } });
  }

  function killEnemyByOp(op) {
    if (state.phase !== 'combat') { toast('仅可在作战期击倒敌人'); return; }
    state.mode = 'idle';
    log('击倒敌人：由 ' + op.name + ' 击倒（不计格，范围词条仍触发一次）', 'event');
    triggerEvent('onKill', { op: op, forceInRange: true, noCell: true });
  }

  // 进入当前回合的休整期：手动「进入休整期」与「进入沙盘 / 重置」共用同一套状态。
  // 进入沙盘 / 重置时场上还没有干员，可传 trigger:false 跳过 onPrepStart（无结算对象）。
  function beginPrep(opts) {
    opts = opts || {};
    state.prepStarted = true;
    state.roundStarted = true;
    state.counters = {};
    state.battleStartDone = false;
    state.egirStarted = false;
    if (!opts.silent) log('第 ' + state.round + ' 回合 · 进入休整期', 'event');
    if (opts.trigger !== false) triggerEvent('onPrepStart');
  }

  function handleEvent(name) {
    if (state.pending) { toast('请先完成或取消当前放置'); return; }
    if (name === 'prepStart') {
      if (state.phase !== 'prep') { toast('当前不在休整期'); return; }
      if (state.prepStarted) { toast('本回合休整期已开始'); return; }
      beginPrep();
      return;
    }
    if (name === 'prepEnd') {
      if (state.phase !== 'prep' || !state.prepStarted) { toast('请先进入休整期'); return; }
      state.phase = 'combat';
      state.prepStarted = false;
      state.battleCounters = {};
      log('休整期结束 → 作战期', 'event');
      triggerEvent('onPrepEnd');
      applyDeputLayers();
      // 先归档休整期报表，再执行战斗开始；否则吞噬/战斗开始的层会被算进休整期。
      generateReport('休整期');
      beginBattle();
      renderAll();
      return;
    }
    if (name === 'battleStart') {
      if (state.phase !== 'combat') return;
      if (state.battleStartDone) { toast('本场战斗的开始阶段已结算'); return; }
      beginBattle();
      renderAll();
      return;
    }
    if (name === 'battleEnd') {
      if (state.phase !== 'combat') { toast('仅可在作战期结束作战'); return; }
      triggerEvent('onBattleEnd');
      generateReport('作战期');
      state.phase = 'prep';
      state.round++;
      state.roundStarted = true;
      state.prepStarted = false;
      state.counters = {};
      state.battleCounters = {};
      state.battleStartDone = false;
      state.egirStarted = false;
      state.grantedTraits = [];
      state.refreshes = 0;
      state.roundGains = 0;
      state.selectedHand = null;
      state.selectedOp = null;
      state.selectedWarehouse = null;
      state.mode = 'idle';
      log('作战结束 → 第 ' + state.round + ' 回合休整期', 'event');
      renderAll();
      return;
    }
    if (name === 'skill') {
      if (state.phase !== 'combat') { toast('请先结束休整期并进入作战期'); return; }
      const op = selectedOpObj();
      if (!op) { toast('请先选择一名已上场干员'); return; }
      triggerEvent('onSkill', { op: op });
      return;
    }
    if (name === 'knockdown') {
      if (state.phase !== 'combat') { toast('仅可在作战期结算我方被击倒'); return; }
      const op = selectedOpObj();
      if (!op) { toast('请先选择一名已上场干员'); return; }
      triggerEvent('onKnockdown', { op: op });
      return;
    }
    if (name === 'gain') {
      if (state.phase !== 'prep') { toast('仅可在休整期触发获得时'); return; }
      const item = state.hand.find(function (it) { return it.id === state.selectedHand; });
      if (!item) { toast('请先选择一名待部署区干员，再点击「获得时」'); return; }
      if (item.gained) { toast(item.name + ' 的「获得时」已触发过'); return; }
      item.gained = true;
      if (!item.gainCounted) {
        item.gainCounted = true;
        state.roundGains++;
      }
      triggerEvent('onGain', { op: { name: item.name, elite: item.elite, uid: 'gain-' + item.id, dir: 'right', r: -1, c: -1 }, handId: item.id });
      return;
    }
    if (name === 'refresh') {
      if (state.phase !== 'prep') { toast('只能在休整期刷新'); return; }
      const useFree = state.freeRefreshes > 0;
      if (useFree) state.freeRefreshes--;
      state.refreshes++;
      log('本回合第 ' + state.refreshes + ' 次刷新' + (useFree ? '（消耗 1 次免费刷新）' : ''), 'event');
      triggerEvent('onRefresh');
      return;
    }
    if (name === 'battleCap') {
      applyBattleCaps();
      return;
    }
    if (name === 'killEnemy') {
      if (state.phase !== 'combat') { toast('仅可在作战期击倒敌人'); return; }
      const op = selectedOpObj();
      if (op) { killEnemyByOp(op); return; }
      state.mode = state.mode === 'killEnemy' ? 'idle' : 'killEnemy';
      state.selectedHand = null;
      state.selectedWarehouse = null;
      state.selectedOp = null;
      renderAll();
      if (state.mode === 'killEnemy') toast('点击地块击倒该格敌人；点击已上场干员则由该干员击倒');
      return;
    }
  }

  function renderStatus() {
    updateMapHead();
    if (roundBadgeEl) roundBadgeEl.textContent = '第 ' + state.round + ' 回合';
    if (phaseBadgeEl) {
      phaseBadgeEl.textContent = state.phase === 'combat' ? '作战期' : '休整期';
      phaseBadgeEl.classList.toggle('combat', state.phase === 'combat');
    }
    if (phaseProgress) {
      const inCombat = state.phase === 'combat';
      phaseProgress.setAttribute('data-phase', inCombat ? 'combat' : 'prep');
      phaseProgress.setAttribute('aria-label', '回合阶段：' + (inCombat ? '作战期' : '休整期'));
      const steps = phaseProgress.querySelectorAll('.pp-step');
      for (let i = 0; i < steps.length; i++) {
        const ph = steps[i].getAttribute('data-phase');
        const active = ph === state.phase;
        steps[i].classList.toggle('active', active);
        steps[i].classList.toggle('done', ph === 'prep' && inCombat);
        steps[i].setAttribute('aria-current', active ? 'step' : 'false');
      }
    }
    if (handCountEl) handCountEl.textContent = state.hand.length + ' / ' + MAX_HAND;
    if (refreshCountEl) refreshCountEl.textContent = state.refreshes ? '本回合刷新 ' + state.refreshes : '';
    if (freeCountEl) freeCountEl.textContent = state.freeRefreshes;
  }

  function renderHand() {
    if (!handEl) return;
    if (!state.hand.length) {
      handEl.innerHTML = '<div class="log-empty">待部署区为空</div>';
      return;
    }
    handEl.innerHTML = state.hand.map(function (item) {
      const name = item.name;
      const m = metaOf(name);
      const hm = handOf(name);
      if (!m || !hm) return '';
      const sel = state.selectedHand === item.id ? ' selected' : '';
      const pending = state.pending && state.pending.handId === item.id ? ' pending' : '';
      const elite = item.elite ? ' elite' : '';
      const gained = item.gained ? ' gained' : '';
      const range = rangeIdOf(name, item.elite);
      return '<div class="hand-card' + sel + pending + elite + gained + '" data-hand="' + esc(name) + '" data-hand-id="' + item.id + '" data-tip="op" data-name="' + esc(name) + '" title="点击选择 ' + esc(name) + '">' +
        '<button class="hand-del" data-del-hand="' + item.id + '" title="从待部署区移除该干员">×</button>' +
        '<button class="hand-elite" data-elite-hand="' + item.id + '" title="切换精锐">' + (item.elite ? '撤精' : '精锐') + '</button>' +
        '<img class="hand-avatar" src="' + esc(avatarOf(name)) + '" alt="' + esc(name) + '" loading="lazy" draggable="false" onerror="this.style.visibility=\'hidden\'">' +
        '<div class="hand-info">' +
          '<div class="hand-name">' + esc(name) + '<span class="tier">' + esc(m.tierLabel || '') + '</span>' + (gained ? '<span class="tag gold">已获得</span>' : '') + '</div>' +
          '<div class="cov-tags">' + covTags(m.tags) + '</div>' +
          '<div class="hand-meta"><span class="range">' + esc(range) + '</span><span class="pos">' + posLabel(hm) + '</span></div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderWarehouse() {
    if (!warehouseEl) return;
    const f = state.whFilter;
    const q = (f.q || '').trim().toLowerCase();
    const names = state.warehouse.filter(function (name) {
      const m = OP_META[name];
      if (!m) return false;
      if (q) {
        const hay = (name + ' ' + (m.tags || []).join(' ') + ' ' + (m.class || '') + ' ' + (m.branch || '') + ' ' + (m.type || '') + ' ' + (m.normalText || '') + ' ' + (m.eliteText || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      if (f.tiers.length && f.tiers.indexOf(Number(m.tier)) < 0) return false;
      if (f.tags.length) {
        const hit = f.tags.filter(function (t) { return (m.tags || []).indexOf(t) >= 0; }).length;
        if (f.tagMode === 'and' ? hit !== f.tags.length : !hit) return false;
      }
      if (f.triggers.length) {
        const trg = (m.normalTriggers || []).concat(m.eliteTriggers || []);
        if (!f.triggers.some(function (t) { return trg.indexOf(t) >= 0; })) return false;
      }
      if (f.onlyTeam && state.teamFilter.indexOf(name) < 0) return false;
      return true;
    });
    if (warehouseCountEl) warehouseCountEl.textContent = names.length + ' / ' + state.warehouse.length;
    if (!names.length) {
      warehouseEl.innerHTML = '<div class="log-empty">没有匹配的干员</div>';
      return;
    }
    warehouseEl.innerHTML = names.map(function (name) {
      const m = OP_META[name];
      const range = rangeIdOf(name, false);
      return '<div class="hand-card warehouse-card" data-warehouse="' + esc(name) + '" data-tip="op" data-name="' + esc(name) + '" title="拖入战场直接部署，或拖入下方待部署区；点击右下角按钮加入待部署区">' +
        '<img class="hand-avatar" src="' + esc(avatarOf(name)) + '" alt="' + esc(name) + '" loading="lazy" draggable="false" onerror="this.style.visibility=\'hidden\'">' +
        '<div class="hand-info">' +
          '<div class="hand-name">' + esc(name) + '<span class="tier">' + esc(m.tierLabel || '') + '</span></div>' +
          '<div class="cov-tags">' + covTags(m.tags) + '</div>' +
          '<div class="hand-meta"><span class="range">' + esc(range) + '</span><span class="pos">' + posLabel(m) + '</span></div>' +
        '</div>' +
        '<button class="add-hand" data-add-hand="' + esc(name) + '" title="加入待部署区">加入待部署区</button>' +
      '</div>';
    }).join('');
  }

  function opHtml(op, selected) {
    const trait = state.grantedTraits.some(function (t) { return t.targetUid === op.uid; });
    const gearCount = (op.it || []).length;
    const gearCap = itemCapOf(op);
    return '<div class="op' + (selected ? ' selected' : '') + (op.elite ? ' elite' : '') + '" data-uid="' + op.uid + '" data-tip="op" data-name="' + esc(op.name) + '">' +
      '<img src="' + esc(avatarOf(op.name)) + '" alt="' + esc(op.name) + '" loading="lazy" draggable="false" onerror="this.style.visibility=\'hidden\'">' +
      '<div class="op-name">' + esc(op.name) + (trait ? '<span class="tag">特质</span>' : '') + '</div>' +
      '<div class="facing" data-uid="' + op.uid + '" style="--rot:' + DIR_ROT[op.dir] + 'deg" title="朝向（拖动干员可重新选择）"><span>➤</span></div>' +
      (gearCount ? '<button type="button" class="op-gear-count" data-gear-op="' + op.uid + '"' +
        ' title="已装备 ' + gearCount + ' / ' + gearCap + ' 件，点击编辑">装' + gearCount + '</button>' : '') +
      (selected ? '<button class="op-gear-edit" data-gear-op="' + op.uid + '" title="编辑装备（添加 / 卸下）">装</button>' : '') +
      (selected ? '<button class="op-retreat" data-retreat="' + op.uid + '" title="撤退（紧急出口）">' + exitIcon() + '</button>' : '') +
      (selected ? '<button class="op-elite" data-elite-op="' + op.uid + '" title="' + (op.elite ? '撤销精锐' : '设为精锐') + '">' + eliteIcon() + '</button>' : '') +
    '</div>';
  }

  function pendingHtml() {
    const p = state.pending;
    if (!p) return '';
    const arrows = [['up', '▲'], ['right', '▶'], ['down', '▼'], ['left', '◀']].map(function (x) {
      return '<span class="pending-dir ' + x[0] + (p.dir === x[0] ? ' active' : '') + '" data-dir="' + x[0] + '">' + x[1] + '</span>';
    }).join('');
    return '<div class="pending-preview" data-pending="1" data-tip="op" data-name="' + esc(p.name) + '">' +
      '<img src="' + esc(avatarOf(p.name)) + '" alt="' + esc(p.name) + '" draggable="false" onerror="this.style.visibility=\'hidden\'">' +
      '<div class="pending-wheel"><span class="pending-ring"></span>' + arrows + '<span class="pending-cancel" data-cancel="1">✕</span></div>' +
      '<div class="pending-hint">' + (p.dir ? '释放以部署 · 朝' + DIR_LABEL[p.dir] : '拖动方向 / 点击箭头（默认右）') + '</div>' +
    '</div>';
  }

  function renderBoard() {
    if (!boardEl) return;
    fitBoard();
    const selOp = selectedOpObj();
    const selectedRange = selOp ? rangeCellSet(selOp) : new Set();
    const selHand = selectedHandMeta();
    const pending = state.pending;
    const previewRange = pending ? rangeCellSet({ name: pending.name, elite: pending.elite, r: pending.r, c: pending.c, dir: pending.dir || 'right' }) : new Set();
    let html = '';

    for (let r = 0; r < MAP_H; r++) {
      for (let c = 0; c < MAP_W; c++) {
        const t = terrainAt(r, c);
        const k = keyOf(r, c);
        const op = opAt(r, c);
        const isPending = pending && pending.r === r && pending.c === c;
        let cls = 'cell ' + t;
        if (boxAt(r, c)) cls += ' has-box';
        if (selectedRange.has(k)) cls += ' range';
        if (selOp && selOp.r === r && selOp.c === c) cls += ' range-self';
        if (selHand && canPlace(selHand.name, r, c)) cls += ' can-place';
        if (state.mode === 'killEnemy') cls += ' kill-target';
        if (isPending) cls += ' pending-cell';
        if (previewRange.has(k)) cls += ' range-preview';
        if (pending && pending.r === r && pending.c === c) cls += ' range-preview-self';

        let inner = '';
        if (boxAt(r, c)) inner += '<i class="box-mark" aria-hidden="true"></i>';
        if (isPending) {
          inner += pendingHtml();
        } else if (op) {
          inner += opHtml(op, selOp && selOp.uid === op.uid);
        }

        html += '<div class="' + cls + '" data-r="' + r + '" data-c="' + c + '" data-tip="cell" title="r' + (r + 1) + 'c' + (c + 1) + '">' + inner + '</div>';
      }
    }
    boardEl.innerHTML = html;
  }

  function ruleTextOf(rule) {
    if (rule.text) return rule.text.replace(/\n/g, ' ');
    const ev = EVENT_LABEL[rule.event] || rule.event;
    const bonds = Array.isArray(rule.bonds) ? rule.bonds.join('、') : (rule.bonds === 'active' ? '自身已激活盟约' : rule.bonds === 'activeCore' ? '已激活核心盟约' : rule.bonds === 'highestActive' ? '最高层已激活盟约' : '');
    const amt = rule.amount != null ? rule.amount : '';
    return '<' + ev + '>' + (bonds ? '【' + bonds + '】' : '') + (amt !== '' ? '+' + amt : '');
  }

  function ruleSummaryHtml(name, elite) {
    const rules = (RULES[name] || []).filter(function (r) { return r.elite == null || (!!r.elite === !!elite); });
    if (!rules.length) return '<div class="detail-note">该干员没有叠层规则。</div>';
    const active = rules.filter(function (r) { return !r.special; });
    const special = rules.filter(function (r) { return r.special; });
    let html = '';
    if (active.length) {
      html += '<div class="detail-note"><b>叠层规则</b><br>' + active.map(function (r) {
        return '· ' + esc(ruleTextOf(r)) + (r.passive ? '（被动光环）' : '');
      }).join('<br>') + '</div>';
    }
    if (special.length) {
      html += '<div class="detail-note"><b>未模拟特殊效果</b><br>' + special.map(function (r) {
        return '· ' + esc(ruleTextOf(r));
      }).join('<br>') + '<br><span class="muted">这些效果依赖敌人状态、装备或战斗数值，当前沙盘不结算。</span></div>';
    }
    return html;
  }

  function opBattleCapText(op) {
    if (state.phase !== 'combat') return '';
    const rules = (RULES[op.name] || []).filter(function (r) {
      return !r.special && (r.elite == null || (!!r.elite === !!op.elite)) && (r.perRound || r.perBattle);
    });
    if (!rules.length && !specialCapEntries(op).length) return '';
    const lines = [];
    function capText(info) {
      const parts = [info.base].concat((info.bonuses || []).map(function (b) { return b.amount; })).filter(function (n) { return n > 0; });
      return info.total !== info.base ? ' → <b>' + info.total + '</b>（' + parts.join('+') + '）' : '';
    }
    rules.forEach(function (r) {
      if (r.perRound && COMBAT_ROUND_EVENTS[r.event]) {
        const info = stackCapParts(op, r.perRound);
        lines.push('· ' + esc(EVENT_LABEL[r.event] || r.event) + '：每回合至多 ' + r.perRound + ' 层' + capText(info));
      }
      if (r.perBattle) {
        const info = stackCapParts(op, r.perBattle);
        lines.push('· ' + esc(EVENT_LABEL[r.event] || r.event) + '：每场战斗至多 ' + r.perBattle + ' 层' + capText(info));
      }
    });
    specialCapEntries(op).forEach(function (e) {
      const cap = Math.max(0, Math.floor(Number(e.cap) || 0));
      if (!cap) return;
      lines.push('· 特殊上限（' + esc(e.scope === 'battle' ? '每场' : '每回合') + '）：' + cap + ' 层；' +
        (Array.isArray(e.bonds) ? '【' + e.bonds.join('】【') + '】' : e.bonds === 'activeSelf' ? '自身已激活盟约' : '已激活盟约'));
    });
    if (!lines.length) return '';
    return '<div class="detail-note"><b>战斗中叠加上限</b><br>' + lines.join('<br>') + '</div>';
  }

  function opTraitText(op) {
    const traits = state.grantedTraits.filter(function (t) { return t.targetUid === op.uid; });
    if (!traits.length) return '';
    return '<div class="detail-note"><b>获得特质</b><br>' + traits.map(function (t) {
      return '· 来自 ' + esc(t.source) + '：开启技能时使自身已激活盟约 +' + t.amount + '（每回合至多 ' + t.perRound + ' 层）';
    }).join('<br>') + '</div>';
  }

  function covOptions(selected) {
    let opts = '<option value="">选择盟约…</option>';
    DATA.covenants.forEach(function (c) {
      opts += '<option value="' + esc(c.name) + '"' + (c.name === selected ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    });
    return opts;
  }

  /** 右侧详情里的装备区：已装备列表 + 转职结论 / 手动选择 + 编辑入口。 */
  function gearInspectorHtml(op) {
    const items = op.it || [];
    const cap = itemCapOf(op);
    const mi = morphInfoOf(op);
    let rows = '';
    for (let i = 0; i < items.length; i++) {
      const entry = normGearEntry(items[i]);
      const def = entry ? GEAR_BY_NAME[entry.k] : null;
      if (!def) continue;
      const eff = gearEffectOf(def, entry.e);
      rows += '<div class="gear-row">' +
        '<span class="gear-row-ico">' + gearIconHtml(def, 22) + '</span>' +
        '<div class="gear-row-main">' +
          '<div class="gear-row-name">' + esc(def.name) + (entry.e ? '<span class="gear-elite-tag">进阶</span>' : '') + '</div>' +
          '<div class="gear-row-eff">' + nl2br(eff || '无效果描述') + '</div>' +
        '</div>' +
        '<button type="button" class="gear-row-x" data-act="gear-remove" data-gear-index="' + i + '"' +
        ' title="卸下 ' + esc(def.name) + '" aria-label="卸下 ' + esc(def.name) + '">×</button>' +
      '</div>';
    }
    if (!rows) rows = '<div class="gear-empty">未装备。装备目前只结算转职与效果描述，数值加成不计入叠层。</div>';

    let morph = '';
    if (mi.hasMorph) {
      if (mi.covenant) {
        morph = '<div class="gear-morph"><span>转职</span>' + covIcon(mi.covenant) +
          '<b>' + esc(mi.covenant) + '</b>' + (mi.manual ? '<span class="muted">（手动指定）</span>' : '') + '</div>';
      } else {
        morph = '<label class="gear-morph is-ask"><span>转职</span>' +
          '<select data-gear-morph aria-label="变形同构体转职盟约">' + covOptions('') + '</select></label>';
      }
    }
    const special = cap > window.Calc.RULES.itemsMax
      ? '<span class="gear-special">特殊槽位 ' + cap + ' 件</span>' : '';
    return '<div class="gear-panel">' +
      '<div class="gear-panel-head"><b>装备</b><span class="muted">' + items.length + ' / ' + cap + '</span>' +
        special + '<button type="button" class="mini" data-act="gear-edit">编辑装备</button></div>' +
      rows + morph +
    '</div>';
  }

  /* ---------------- 装备编辑面板（仿配队装备面板） ---------------- */
  function gearEditorOp() {
    return state.board.find(function (o) { return o.uid === gearEditor.uid; }) || null;
  }

  function openGearEditor(uid) {
    const op = state.board.find(function (o) { return o.uid === uid; });
    if (!op) return;
    gearEditor.open = true;
    gearEditor.uid = uid;
    gearEditor.q = '';
    gearEditor.eliteMode = {};
    if (gearSearchEl) gearSearchEl.value = '';
    hideTip();
    renderGearEditor();
    if (gearModal) gearModal.hidden = false;
    document.body.classList.add('gear-open');
  }

  function closeGearEditor() {
    if (!gearEditor.open) return;
    gearEditor.open = false;
    gearEditor.uid = 0;
    gearEditor.q = '';
    gearEditor.eliteMode = {};
    if (gearModal) gearModal.hidden = true;
    if (gearSearchEl) gearSearchEl.value = '';
    document.body.classList.remove('gear-open');
    hideTip();
  }

  function gearEquippedHtml(op) {
    const items = op.it || [];
    const cap = itemCapOf(op);
    const mi = morphInfoOf(op);
    let rows = '';
    for (let i = 0; i < items.length; i++) {
      const entry = normGearEntry(items[i]);
      const def = entry ? GEAR_BY_NAME[entry.k] : null;
      if (!def) continue;
      const eff = gearEffectOf(def, entry.e);
      rows += '<div class="gear-eq-row">' +
        '<span class="gear-row-ico">' + gearIconHtml(def, 26) + '</span>' +
        '<div class="gear-row-main">' +
          '<div class="gear-row-name">' + esc(def.name) + (entry.e ? '<span class="gear-elite-tag">进阶</span>' : '') + '</div>' +
          '<div class="gear-row-eff">' + nl2br(eff || '无效果描述') + '</div>' +
        '</div>' +
        '<button type="button" class="gear-row-x" data-gear-remove="' + i + '"' +
        ' title="卸下 ' + esc(def.name) + '" aria-label="卸下 ' + esc(def.name) + '">×</button>' +
      '</div>';
    }
    if (!rows) rows = '<div class="gear-empty">还没有装备。从下方列表点「＋」添加。</div>';

    let morph = '';
    if (mi.hasMorph) {
      if (mi.covenant) {
        morph = '<div class="gear-morph"><span>转职</span>' + covIcon(mi.covenant) +
          '<b>' + esc(mi.covenant) + '</b>' + (mi.manual ? '<span class="muted">（手动指定）</span>' : '') + '</div>';
      } else {
        morph = '<label class="gear-morph is-ask"><span>转职</span>' +
          '<select data-gear-morph aria-label="变形同构体转职盟约">' + covOptions('') + '</select></label>';
      }
    }
    return '<div class="gear-eq-head"><b>已装备 ' + items.length + ' / ' + cap + '</b>' +
      (cap > window.Calc.RULES.itemsMax ? '<span class="gear-special">“暴躁铁皮”特殊槽位</span>' : '') +
      '</div><div class="gear-eq-list">' + rows + '</div>' + morph;
  }

  function gearEditorListHtml(op) {
    const items = op.it || [];
    const wornAt = {};
    for (let w = 0; w < items.length; w++) wornAt[items[w].k] = w;
    const q = (gearEditor.q || '').trim().toLowerCase();
    let out = '';
    let shown = 0;
    for (let i = 0; i < GEAR_ITEMS.length; i++) {
      const it = GEAR_ITEMS[i];
      const hay = (it.name + ' ' + (it.normalText || '') + ' ' + (it.eliteText || '') + ' ' + (it.covenant || '')).toLowerCase();
      if (q && hay.indexOf(q) < 0) continue;
      shown++;
      const worn = wornAt[it.name] != null;
      const elite = worn ? !!items[wornAt[it.name]].e : !!gearEditor.eliteMode[it.name];
      const eff = gearEffectOf(it, elite);
      out += '<div class="gear-pick' + (worn ? ' is-worn' : '') + '">' +
        '<span class="gear-pick-ico">' + gearIconHtml(it, 30) + '</span>' +
        '<div class="gear-pick-main">' +
          '<div class="gear-pick-name">' + esc(it.name) +
            (it.covenant ? '<span class="gear-cov">' + covIcon(it.covenant) + esc(it.covenant) + '</span>' : '') +
          '</div>' +
          '<div class="gear-pick-eff">' + nl2br(eff || '无效果描述') + '</div>' +
        '</div>' +
        (it.hasElite
          ? '<button type="button" class="gear-form-btn" data-gear-form="' + esc(it.name) + '"' +
            ' aria-pressed="' + (elite ? 'true' : 'false') + '" title="' +
            (elite ? '取消进阶，按普通形态装备' : '以进阶形态装备') + '">' + (elite ? '取消进阶' : '进阶') + '</button>'
          : '') +
        (worn
          ? '<button type="button" class="gear-add-btn is-worn" disabled>已装备</button>'
          : '<button type="button" class="gear-add-btn" data-gear-add-item="' + esc(it.name) + '"' +
            ' title="添加到 ' + esc(op.name) + '">＋</button>') +
      '</div>';
    }
    if (!shown) out = '<div class="gear-empty">没有匹配的装备</div>';
    return out;
  }

  function renderGearEditor() {
    if (!gearEditor.open) return;
    const op = gearEditorOp();
    if (!op) { closeGearEditor(); return; }
    const cap = itemCapOf(op);
    if (gearTitleEl) gearTitleEl.textContent = op.name + ' · 装备';
    if (gearSubEl) {
      gearSubEl.textContent = 'r' + (op.r + 1) + 'c' + (op.c + 1) + ' · ' + (op.elite ? '精锐' : '普通') +
        ' · ' + (op.it || []).length + ' / ' + cap + ' 件' +
        (cap > window.Calc.RULES.itemsMax ? '（特殊干员槽位）' : '');
    }
    if (gearEquippedEl) gearEquippedEl.innerHTML = gearEquippedHtml(op);
    if (gearListEl) gearListEl.innerHTML = gearEditorListHtml(op);
  }

  function addGearToOp(name) {
    const op = gearEditorOp();
    const def = GEAR_BY_NAME[name];
    if (!op || !def) return;
    const cap = itemCapOf(op);
    op.it = op.it || [];
    if (op.it.some(function (it) { return it.k === name; })) {
      toast('已经装备了 ' + name);
      return;
    }
    if (op.it.length >= cap) {
      toast('装备槽已满（' + cap + ' 件）');
      return;
    }
    const elite = !!gearEditor.eliteMode[name];
    op.it.push({ k: name, e: elite });
    if (!hasMorphGear(op)) delete op.m;
    log('为 ' + op.name + ' 装备 ' + name + (elite ? '（进阶）' : '') + ' · ' + (op.it.length + ' / ' + cap), 'event');
    renderAll();
    toast('已装备 ' + name);
  }

  function removeGearAtIndex(index, targetOp) {
    const op = targetOp || gearEditorOp();
    if (!op || !op.it || !op.it[index]) return;
    const entry = normGearEntry(op.it[index]);
    op.it.splice(index, 1);
    if (!op.it.length) delete op.it;
    if (!hasMorphGear(op)) delete op.m;
    log('卸下 ' + op.name + ' 的 ' + (entry ? entry.k : '装备'), 'event');
    renderAll();
    toast('已卸下 ' + (entry ? entry.k : '装备'));
  }

  function toggleGearForm(name) {
    const op = gearEditorOp();
    if (!op) return;
    const idx = (op.it || []).findIndex(function (it) { return it.k === name; });
    if (idx >= 0) {
      op.it[idx].e = !op.it[idx].e;
      log(op.name + ' 的 ' + name + (op.it[idx].e ? ' 已进阶' : ' 已取消进阶'), 'event');
      renderAll();
      toast(name + (op.it[idx].e ? '：已进阶' : '：已取消进阶'));
    } else {
      gearEditor.eliteMode[name] = !gearEditor.eliteMode[name];
      renderGearEditor();
      toast(name + (gearEditor.eliteMode[name] ? '：本次添加为进阶形态' : '：本次添加为普通形态'));
    }
  }

  function setOpMorph(covenant, targetOp) {
    const op = targetOp || gearEditorOp();
    if (!op || !hasMorphGear(op)) return;
    if (covenant) op.m = covenant; else delete op.m;
    log(op.name + ' 的变形同构体转职：' + (covenant || '未指定'), 'event');
    renderAll();
  }

  function trimGearToCap(op) {
    if (!op || !op.it) return 0;
    const cap = itemCapOf(op);
    if (op.it.length <= cap) return 0;
    const removed = op.it.length - cap;
    op.it = op.it.slice(0, cap);
    if (!hasMorphGear(op)) delete op.m;
    return removed;
  }

  function renderInspector() {
    if (!inspectorEl) return;
    if (state.pending) {
      const p = state.pending;
      const m = metaOf(p.name);
      const hm = handOf(p.name);
      if (!m || !hm) { inspectorEl.innerHTML = ''; return; }
      inspectorEl.innerHTML =
        '<div class="op-detail">' +
          '<img class="big-avatar" src="' + esc(avatarOf(p.name)) + '" alt="' + esc(p.name) + '" onerror="this.style.visibility=\'hidden\'">' +
          '<div style="min-width:0">' +
            '<h3>' + esc(p.name) + '<span class="tag gold">' + (p.kind === 'move' ? '重新部署' : '待部署') + '</span>' + (p.elite ? '<span class="tag gold">精锐</span>' : '') + '</h3>' +
            '<div class="meta">r' + (p.r + 1) + 'c' + (p.c + 1) + ' · ' + posLabel(hm) + ' · 范围 ' + esc(rangeIdOf(p.name, p.elite)) + '</div>' +
            '<div class="cov-tags">' + covTags(m.tags) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-actions"><button class="btn ghost" data-act="cancel-pending">' + (p.kind === 'move' ? '取消并还原' : '取消放置') + '</button></div>' +
        '<div class="detail-note">' + (p.kind === 'move' ? '已移动 / 交换：拖动方向确定新朝向；取消则还原位置。' : '朝向设置：从地块向上下左右拖动，或点击方向箭头；确认后完成部署。') + '</div>';
      return;
    }
    const op = selectedOpObj();
    if (op) {
      const m = metaOf(op.name);
      const hm = handOf(op.name);
      if (!m || !hm) { inspectorEl.innerHTML = '<div class="inspector-empty">未知干员：' + esc(op.name) + '</div>'; return; }
      inspectorEl.innerHTML =
        '<div class="op-detail">' +
          '<img class="big-avatar" src="' + esc(avatarOf(op.name)) + '" alt="' + esc(op.name) + '" onerror="this.style.visibility=\'hidden\'">' +
          '<div style="min-width:0">' +
            '<h3>' + esc(op.name) + '<span class="tag gold">' + esc(m.tierLabel || '') + '</span>' + (op.elite ? '<span class="tag gold">精锐</span>' : '') + '</h3>' +
            '<div class="meta">' + posLabel(hm) + ' · 范围 ' + esc(rangeIdOf(op.name, op.elite)) + ' · 朝向 ' + DIR_LABEL[op.dir] + '</div>' +
            '<div class="cov-tags">' + covTags(m.tags) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-actions">' +
          '<button class="btn" data-act="skill"' + (state.phase !== 'combat' ? ' disabled title="进入作战期后可用"' : '') + '>开启技能</button>' +
          '<button class="btn ghost" data-act="toggle-op-elite"' + (state.phase === 'combat' ? ' disabled title="作战期锁定"' : '') + '>' + (op.elite ? '撤销精锐' : '设为精锐') + '</button>' +
        '</div>' +
        gearInspectorHtml(op) +
        opBattleCapText(op) +
        opTraitText(op) +
        ruleSummaryHtml(op.name, op.elite) +
        '<div class="detail-note">选中后战场显示攻击范围；拖动干员可移动或交换位置，并重新确定朝向；点击头像右上角的「紧急出口」可撤退。</div>';
      return;
    }

    const item = selectedHandItem();
    const hm = selectedHandMeta();
    if (item && hm) {
      const m = metaOf(hm.name);
      inspectorEl.innerHTML =
        '<div class="op-detail">' +
          '<img class="big-avatar" src="' + esc(avatarOf(hm.name)) + '" alt="' + esc(hm.name) + '" onerror="this.style.visibility=\'hidden\'">' +
          '<div style="min-width:0">' +
            '<h3>' + esc(hm.name) + '<span class="tag gold">待放置</span>' + (item.elite ? '<span class="tag gold">精锐</span>' : '') + '</h3>' +
            '<div class="meta">' + posLabel(hm) + ' · 范围 ' + esc(rangeIdOf(hm.name, item.elite)) + '</div>' +
            '<div class="cov-tags">' + covTags(m.tags) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-actions">' +
          (item.gained ? '<span class="tag gold">已获得</span>' : '<button class="btn" data-act="gain-hand">触发获得时</button>') +
          '<button class="btn ghost" data-act="toggle-hand-elite">' + (item.elite ? '撤销精锐' : '设为精锐') + '</button>' +
          '<button class="btn ghost" data-act="to-warehouse">移回仓库</button>' +
        '</div>' +
        ruleSummaryHtml(hm.name, item.elite) +
        '<div class="detail-note">放置干员：将干员拖入战场，放置后拖动方向确定朝向。高台仅可部署远程干员；不可部署地块无法放置干员。</div>';
      return;
    }

    if (state.selectedWarehouse) {
      const name = state.selectedWarehouse;
      const m = metaOf(name);
      const hm = handOf(name);
      inspectorEl.innerHTML =
        '<div class="op-detail">' +
          '<img class="big-avatar" src="' + esc(avatarOf(name)) + '" alt="' + esc(name) + '" onerror="this.style.visibility=\'hidden\'">' +
          '<div style="min-width:0">' +
            '<h3>' + esc(name) + '<span class="tag">卡牌仓库</span></h3>' +
            '<div class="meta">' + posLabel(hm) + ' · 范围 ' + esc(rangeIdOf(name, false)) + '</div>' +
            '<div class="cov-tags">' + covTags(m.tags) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-actions"><button class="btn" data-act="to-hand">移入待部署区</button></div>' +
        '<div class="detail-note">拖入下方「待部署区」，或点击「移入待部署区」。卡牌仓库中的干员不参与待部署区效果。</div>';
      return;
    }

    inspectorEl.innerHTML =
      '<div class="inspector-empty">选择干员查看详情。</div>';
  }

  let openBondName = null;

  function bondStateText(st) {
    return { active: '激活', empowered: '强化', near: '待激活', inactive: '未激活', conflict: '冲突' }[st] || '未激活';
  }

  function renderBonds() {
    const ev = getEval();
    const layerCount = ev.rows.filter(function (r) { return (state.layers[r.name] || 0) + (state.temp[r.name] || 0) > 0; }).length;
    if (bondSummaryEl) bondSummaryEl.textContent = ev.summary.active + ' 激活 / ' + ev.rows.length + ' · ' + layerCount + ' 项有层';
    if (clearLayersBtn) clearLayersBtn.disabled = !hasLayerState();
    if (!bondStripEl) return;
    bondStripEl.innerHTML = ev.rows.map(function (row) {
      const layer = (state.layers[row.name] || 0) + (state.temp[row.name] || 0);
      const c = DATA.covenants.find(function (x) { return x.name === row.name; });
      const icon = c && c.icon ? '<img src="' + esc(c.icon) + '" alt="">' : '<span class="bc-noicon">' + esc(row.name.slice(0, 1)) + '</span>';
      const cls = row.state === 'empowered' ? ' empowered'
        : row.state === 'active' ? ' active'
        : row.state === 'near' ? ' near'
        : row.state === 'conflict' ? ' conflict'
        : ' inactive';
      return '<button type="button" class="bond-chip' + cls + '" data-bond="' + esc(row.name) + '" data-tip="bond" data-count="' + row.count + '" data-layer="' + layer + '" title="' + esc(row.name) + ' · ' + row.count + '/' + row.threshold + ' · ' + layer + ' 层">' +
        icon +
        '<span class="bc-count">' + row.count + '</span>' +
        '<span class="bc-layer">' + layer + '</span>' +
      '</button>';
    }).join('');
    if (openBondName) updateBondPop(openBondName);
  }

  function bondPopHtml(name) {
    const row = getEval().rows.find(function (r) { return r.name === name; });
    if (!row) return '';
    const c = DATA.covenants.find(function (x) { return x.name === name; });
    const fixed = state.layers[name] || 0;
    const temp = state.temp[name] || 0;
    const total = fixed + temp;
    const count = row.count + '/' + row.threshold + (row.empowerThreshold != null ? ' → ' + row.empowerThreshold : '');
    const desc = c && c.desc ? nl2br(c.desc) : '';
    // 「当前数值」必须给出代入层数后的结果（0 层也要显示基础值），不能停留在公式原文。
    const value = c && c.valueText
      ? nl2br(window.Calc && window.Calc.substLayers ? window.Calc.substLayers(c.valueText, total, true) : c.valueText)
      : '';
    return '<button class="bond-pop-close" data-bond-close="1" title="关闭">×</button>' +
      '<div class="bp-head"><img src="' + esc(c && c.icon ? c.icon : '') + '" alt=""><div><h4>' + esc(name) + '</h4><div class="muted">' +
      '<span class="bond-state is-' + esc(row.state) + '">' + bondStateText(row.state) + '</span> · ' + count + ' · 层数 ' + total + (temp ? '（含临时 ' + temp + '）' : '') + '</div></div></div>' +
      (value ? '<div class="bp-block"><b>当前数值</b><div>' + value + '</div></div>' : '') +
      (desc ? '<div class="bp-block"><b>盟约说明</b><div>' + desc + '</div></div>' : '') +
      (row.nodes && row.nodes.length ? '<div class="bp-small">层数节点：' + esc(row.nodes.join(' / ')) + '</div>' : '') +
      '<div class="bp-edit"><span>固定层数</span>' +
      '<button class="bp-step" data-bond-step="-1" data-bond-name="' + esc(name) + '">−</button>' +
      '<input class="bp-input" data-bond-input="' + esc(name) + '" type="number" min="0" max="999" value="' + fixed + '">' +
      '<button class="bp-step" data-bond-step="1" data-bond-name="' + esc(name) + '">+</button>' +
      (temp ? '<span class="bp-temp">临时 ' + temp + '</span>' : '') + '</div>';
  }

  function placeBondPop(anchor) {
    if (!bondPopEl || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 24);
    bondPopEl.style.width = w + 'px';
    bondPopEl.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
    bondPopEl.style.top = Math.min(r.bottom + 7, window.innerHeight - 260) + 'px';
  }

  function updateBondPop(name) {
    if (!bondPopEl) return;
    const chip = bondStripEl ? bondStripEl.querySelector('[data-bond="' + name.replace(/"/g, '\\"') + '"]') : null;
    if (!chip) { hideBondPop(); return; }
    bondPopEl.innerHTML = bondPopHtml(name);
    bondPopEl.hidden = false;
    placeBondPop(chip);
  }

  function showBondPop(name) {
    openBondName = name;
    updateBondPop(name);
  }

  function hideBondPop() {
    openBondName = null;
    if (bondPopEl) bondPopEl.hidden = true;
  }

  function setBondLayer(name, value) {
    const n = Math.max(0, Math.min(999, Math.floor(Number(value) || 0)));
    if (!DATA.covenants.some(function (c) { return c.name === name; })) return;
    state.layers[name] = n;
    renderBonds();
    renderAll();
    if (openBondName === name) updateBondPop(name);
  }

  function hasLayerState() {
    const anyPositive = function (map) {
      return Object.keys(map || {}).some(function (k) { return (map[k] || 0) > 0; });
    };
    return anyPositive(state.layers) || anyPositive(state.temp) ||
      Object.keys(state.counters || {}).length > 0 ||
      Object.keys(state.battleCounters || {}).length > 0 ||
      Object.keys(state.totalCounters || {}).length > 0 ||
      state.stackEvents.length > 0;
  }

  // 一键归零：固定层 + 临时层 + 各种上限计数 + 层数事件；不动干员、特质、刷新/获得计数。
  function clearAllLayers() {
    if (!hasLayerState()) { toast('暂无可归零的叠层'); return; }
    const names = {};
    Object.keys(state.layers || {}).forEach(function (k) { if ((state.layers[k] || 0) > 0) names[k] = true; });
    Object.keys(state.temp || {}).forEach(function (k) { if ((state.temp[k] || 0) > 0) names[k] = true; });
    const count = Object.keys(names).length;
    state.layers = {};
    state.temp = {};
    state.counters = {};
    state.battleCounters = {};
    state.totalCounters = {};
    state.stackEvents = [];
    state.lastReport = null;
    if (reportPanel) reportPanel.hidden = true;
    log('所有叠层已归零：固定层 / 临时层 / 上限计数已清空', 'event');
    renderAll();
    toast(count ? '已归零 ' + count + ' 个盟约的层数' : '所有叠层已归零');
  }

  function renderLog() {
    if (!logListEl) return;
    if (!state.logs.length) {
      logListEl.innerHTML = '<div class="log-empty">还没有事件。</div>';
      return;
    }
    logListEl.innerHTML = state.logs.slice(0, 60).map(function (l) {
      const t = l.time ? new Date(l.time).toLocaleTimeString('zh-CN', { hour12: false }) : '';
      return '<div class="log-item ' + l.kind + '"><span class="t">R' + l.round + (t ? ' ' + t : '') + '</span>' + esc(l.text) + '</div>';
    }).join('');
  }

  function renderHint() {
    if (state.pending) {
      hintEl.innerHTML = '<b>已放置：</b>金色地块为当前朝向的攻击范围预览；拖动方向或点击箭头后完成部署；点击 ✕ 取消。';
    } else if (state.mode === 'killEnemy') {
      hintEl.innerHTML = '<b>击倒敌人：</b>选中干员后点击此按钮，由该干员击倒并触发其范围词条；未选中干员时进入选择地块模式。';
    } else if (state.selectedOp && capAuraHintFor(selectedOpObj())) {
      hintEl.innerHTML = capAuraHintFor(selectedOpObj()) + '<br><span class="muted">仅作战期生效。</span>';
    } else if (state.phase === 'combat') {
      const sel = selectedOpObj();
      hintEl.innerHTML = '<b>作战期：</b>已上场干员锁定，无法移动、撤退或晋升；仍可从卡牌仓库 / 待部署区部署，并触发「部署时」。' + (sel ? '已选中 ' + esc(sel.name) + '，可开启技能。' : '可选择干员开启技能，或击倒敌人。');
    } else if (state.selectedHand) {
      const item = selectedHandItem();
      hintEl.innerHTML = '<b>' + esc(item ? item.name : '') + (item && item.elite ? '（精锐）' : '') + '：</b>拖入战场并放置后，再拖动方向确定朝向；「获得时」仅对该干员生效。';
    } else if (state.selectedWarehouse) {
      hintEl.innerHTML = '<b>' + esc(state.selectedWarehouse) + '：</b>拖入战场即可部署，或拖入下方「待部署区」；也可点击右侧「移入待部署区」。';
    } else if (state.selectedOp) {
      const op = selectedOpObj();
      hintEl.innerHTML = op ? '<b>' + esc(op.name) + '：</b>战场显示攻击范围；点击干员左下角「装」可编辑装备，点击右上角「紧急出口」可撤退。' : '';
    } else {
      hintEl.innerHTML = '将卡牌仓库或待部署区中的干员拖入战场地块，放置后拖动方向确定朝向。';
    }
  }

  function renderEventBar() {
    const prepStartBtn = eventBarEl.querySelector('[data-event="prepStart"]');
    const prepEndBtn = eventBarEl.querySelector('[data-event="prepEnd"]');
    const battleEndBtn = eventBarEl.querySelector('[data-event="battleEnd"]');
    const battleCapBtn = eventBarEl.querySelector('[data-event="battleCap"]');
    const gainBtn = eventBarEl.querySelector('[data-event="gain"]');
    const killBtn = eventBarEl.querySelector('[data-event="killEnemy"]');
    const skillBtn = eventBarEl.querySelector('[data-event="skill"]');
    const knockdownBtn = eventBarEl.querySelector('[data-event="knockdown"]');

    if (combatBar) combatBar.hidden = state.phase !== 'combat';
    if (prepStartBtn) {
      prepStartBtn.hidden = !(state.phase === 'prep' && !state.prepStarted);
      prepStartBtn.disabled = state.phase !== 'prep' || state.prepStarted;
      prepStartBtn.title = state.phase !== 'prep' ? '仅可在休整期使用' : state.prepStarted ? '本回合休整期已开始' : '开始本回合休整期';
    }
    if (prepEndBtn) {
      prepEndBtn.disabled = state.phase !== 'prep' || !state.prepStarted;
      prepEndBtn.title = state.phase !== 'prep' ? '当前不在休整期' : !state.prepStarted ? '请先进入休整期' : '结束休整期并进入作战期';
    }
    if (battleEndBtn) {
      battleEndBtn.disabled = state.phase !== 'combat';
      battleEndBtn.title = state.phase === 'combat' ? '结束本回合作战期' : '仅可在作战期使用';
    }
    if (battleCapBtn) {
      battleCapBtn.disabled = state.phase !== 'combat';
      battleCapBtn.title = state.phase === 'combat' ? '测试功能：补满本回合战斗中的叠层与已获得特质' : '仅可在作战期使用';
    }
    if (gainBtn) {
      const gainItem = selectedHandItem();
      const gainOk = state.phase === 'prep' && !!gainItem && !gainItem.gained;
      gainBtn.disabled = !gainOk;
      gainBtn.title = gainOk ? '对选中待部署区干员触发获得时' : state.phase !== 'prep' ? '仅可在休整期触发获得时' : gainItem ? '该干员已触发过获得时' : '请先选择一名待部署区干员';
    }
    if (killBtn) {
      killBtn.disabled = state.phase !== 'combat';
      killBtn.title = state.phase === 'combat' ? '点击地块或干员触发击倒' : '仅可在作战期击倒敌人';
      killBtn.classList.toggle('active', state.mode === 'killEnemy');
    }
    if (skillBtn) {
      const ok = !!state.selectedOp && state.phase === 'combat';
      skillBtn.disabled = !ok;
      skillBtn.title = ok ? '对选中干员触发「开启技能」' : '需选中已上场干员并处于作战期';
    }
    if (knockdownBtn) {
      const ok = !!state.selectedOp && state.phase === 'combat';
      knockdownBtn.disabled = !ok;
      knockdownBtn.title = ok ? '对选中干员触发「我方被击倒」' : '需选中已上场干员并处于作战期';
    }
  }

  function renderAll() {
    renderStatus();
    renderHand();
    renderWarehouse();
    renderBoard();
    renderInspector();
    renderBonds();
    renderLog();
    renderHint();
    renderEventBar();
    if (gearEditor.open) renderGearEditor();
  }

  // ---- hover tooltip ----
  function nl2br(s) {
    return esc(s).replace(/\n/g, '<br>');
  }

  function tipHtmlFor(el) {
    const kind = el.getAttribute('data-tip');

    if (kind === 'op') {
      const name = el.getAttribute('data-name');
      const m = metaOf(name);
      if (!m) return '';
      const hm = handOf(name);
      const tags = covTags(m.tags);
      const pos = hm ? posLabel(hm) : '';
      const range = rangeIdOf(name, false);
      const price = m.price != null ? m.price : '—';
      const metaBits = [];
      if (pos) metaBits.push(pos);
      if (range) metaBits.push('范围 ' + range);
      metaBits.push('售价 ' + price);
      return '<div class="tip-head">' +
        '<img src="' + esc(avatarOf(name)) + '" alt="' + esc(name) + '" onerror="this.style.visibility=\'hidden\'">' +
        '<div><h4>' + esc(name) + '<span class="tag gold">' + esc(m.tierLabel || '') + '</span></h4>' +
        '<div class="muted">' + esc(metaBits.join(' · ')) + '</div></div>' +
      '</div>' +
      (tags ? '<div class="cov-tags">' + tags + '</div>' : '') +
      '<div class="tip-block"><b>普通</b><div class="tip-text">' + nl2br(m.normalText || '—') + '</div></div>' +
      '<div class="tip-block"><b>精锐</b><div class="tip-text">' + nl2br(m.eliteText || '—') + '</div></div>' +
      '<div class="tip-small">触发：' + esc(m.normalTrigger || '—') + '</div>';
    }

    if (kind === 'bond') {
      const name = el.getAttribute('data-bond');
      const c = DATA.covenants.find(function (x) { return x.name === name; });
      if (!c) return '';
      const row = getEval().rows.find(function (x) { return x.name === name; });
      const layer = (state.layers[name] || 0) + (state.temp[name] || 0);
      const st = row ? ({ active: '激活', empowered: '强化', near: '待激活', inactive: '未激活', conflict: '冲突' }[row.state] || '未激活') : '未激活';
      return '<h4>' + covIcon(name) + esc(name) + '<span class="tag">' + (c.rank === 'core' ? '核心' : '附加') + '</span></h4>' +
        '<div class="muted">' + (row ? row.count : 0) + '/' + (row ? row.threshold : c.activation.threshold) + ' · ' +
        (row ? '<span class="bond-state is-' + esc(row.state) + '">' + st + '</span>' : st) + ' · 层 ' + layer + '</div>';
    }

    if (kind === 'cell') {
      const r = Number(el.getAttribute('data-r'));
      const c = Number(el.getAttribute('data-c'));
      const t = terrainAt(r, c);
      const info = TERRAIN[t] || TERRAIN.ground;
      const deployText = info.deploy === 'none' ? '不可部署' : info.deploy === 'ranged' ? '仅远程可部署' : '可部署';
      const walkText = info.walk ? '可通行' : '不可通行';
      const op = opAt(r, c);
      return '<h4>r' + (r + 1) + 'c' + (c + 1) + ' · ' + esc(info.label) + '</h4>' +
        '<div class="muted">' + esc(info.key) + ' · ' + deployText + ' · ' + walkText + '</div>' +
        (boxAt(r, c) ? '<div class="tip-block"><b>箱子</b><div class="tip-text">该格有箱子，无法部署 / 通行。</div></div>' : '') +
        '<div class="tip-block"><b>部署规则</b><div class="tip-text">' + deployText + '</div></div>' +
        '<div class="tip-block"><b>通行规则</b><div class="tip-text">' + walkText + '</div></div>' +
        '<div class="tip-block"><b>说明</b><div class="tip-text">' + esc(info.note || '') + '</div></div>' +
        (op ? '<div class="tip-block"><b>干员</b><div class="tip-text">' + esc(op.name) + ' · 朝' + DIR_LABEL[op.dir] + '</div></div>' : '') +
        (function () {
          const sel = selectedOpObj();
          if (!sel) return '';
          const target = op || { uid: 'cell', r: r, c: c };
          const lines = [];
          (RULES[sel.name] || []).forEach(function (rule) {
            if (!rule.capAura || !ruleMatchesElite(sel, rule)) return;
            if (!auraApplies(sel, target, rule.capAura)) return;
            lines.push('<div class="tip-block"><b>' + esc(sel.name) + ' 加成范围</b><div class="tip-text">该格干员每场战斗叠层上限 ' + esc(capAuraLabel(rule)) + '</div></div>');
          });
          return lines.join('');
        })();
    }

    if (kind === 'event') {
      const ev = el.getAttribute('data-event');
      const labels = { prepStart: '进入休整期', prepEnd: '休整期结束', battleStart: '作战开始', battleEnd: '作战结束', battleCap: '补满叠层', skill: '开启技能', knockdown: '我方击倒', gain: '获得时', refresh: '刷新', killEnemy: '击倒敌人' };
      return '<h4>' + esc(labels[ev] || ev) + '</h4><div class="tip-text">' + esc(EVENT_TIP[ev] || '') + '</div>';
    }

    return '';
  }

  function positionTip(e) {
    if (!tipEl || tipEl.hidden) return;
    const pad = 12;
    const w = tipEl.offsetWidth || 320;
    const h = tipEl.offsetHeight || 160;
    let left = e.clientX + 14;
    let top = e.clientY + 14;
    if (left + w > window.innerWidth - pad) left = e.clientX - w - 14;
    if (top + h > window.innerHeight - pad) top = e.clientY - h - 14;
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - h - pad));
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }

  function hideTip() {
    tipTarget = null;
    if (!tipEl) return;
    tipEl.hidden = true;
    tipEl.innerHTML = '';
  }

  function showTip(el, e) {
    if (!tipEl || drag || state.pending) return;
    const html = tipHtmlFor(el);
    if (!html) { hideTip(); return; }
    tipTarget = el;
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    positionTip(e);
  }

  document.addEventListener('mouseover', function (e) {
    if (drag) return;
    const el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!el || el === tipTarget) return;
    showTip(el, e);
  });

  document.addEventListener('mouseout', function (e) {
    const el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!el) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    if (el === tipTarget) hideTip();
  });

  document.addEventListener('mousemove', function (e) {
    if (tipTarget) positionTip(e);
  });

  window.addEventListener('scroll', hideTip, true);

  // ---- events ----
  handEl.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.hand-del') || e.target.closest('.hand-elite')) return;
    const card = e.target.closest('[data-hand]');
    if (!card) return;
    startDrag(card.getAttribute('data-hand'), e, 'hand', card.getAttribute('data-hand-id'));
  });

  handEl.addEventListener('click', function (e) {
    const del = e.target.closest('[data-del-hand]');
    if (del) { e.stopPropagation(); deleteHandItem(del.getAttribute('data-del-hand')); return; }
    const elite = e.target.closest('[data-elite-hand]');
    if (elite) { e.stopPropagation(); toggleHandElite(elite.getAttribute('data-elite-hand')); return; }
    if (Date.now() - lastDragEnd < 250) return;
    const card = e.target.closest('[data-hand]');
    if (!card) return;
    selectHand(card.getAttribute('data-hand-id'));
  });

  if (warehouseEl) {
    warehouseEl.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.add-hand')) return;
      const card = e.target.closest('[data-warehouse]');
      if (!card) return;
      startDrag(card.getAttribute('data-warehouse'), e, 'warehouse');
    });
    warehouseEl.addEventListener('click', function (e) {
      const add = e.target.closest('.add-hand');
      if (add) {
        e.stopPropagation();
        addToHand(add.getAttribute('data-add-hand'));
        return;
      }
      if (Date.now() - lastDragEnd < 250) return;
      const card = e.target.closest('[data-warehouse]');
      if (!card) return;
      selectWarehouse(card.getAttribute('data-warehouse'));
    });
  }

  boardEl.addEventListener('pointerdown', function (e) {
    if (state.pending) return;
    if (e.target.closest('.op-retreat') || e.target.closest('.op-elite') ||
        e.target.closest('.op-gear-edit') || e.target.closest('.op-gear-count')) return;
    const opEl = e.target.closest('.op');
    if (opEl) startMoveDrag(Number(opEl.getAttribute('data-uid')), e);
  });

  boardEl.addEventListener('pointerdown', function (e) {
    if (!state.pending) return;
    if (e.target.closest('.pending-dir') || e.target.closest('.pending-cancel')) return;
    if (e.target.closest('.pending-cell')) startFacing(e);
  });

  boardEl.addEventListener('click', function (e) {
    if (Date.now() - lastDragEnd < 250) return;
    if (state.pending) {
      const dirEl = e.target.closest('.pending-dir');
      if (dirEl) { confirmPending(dirEl.getAttribute('data-dir')); return; }
      if (e.target.closest('.pending-cancel')) { cancelPending(); return; }
      if (e.target.closest('.pending-preview')) { toast('请拖动方向或点击箭头确定朝向'); return; }
      toast('请先完成或取消当前放置');
      return;
    }
    const gearEl = e.target.closest('.op-gear-edit, .op-gear-count');
    if (gearEl) { openGearEditor(Number(gearEl.getAttribute('data-gear-op'))); return; }
    const eliteEl = e.target.closest('.op-elite');
    if (eliteEl) { toggleOpElite(Number(eliteEl.getAttribute('data-elite-op'))); return; }
    const retreatEl = e.target.closest('.op-retreat');
    if (retreatEl) {
      retreat(Number(retreatEl.getAttribute('data-retreat')));
      return;
    }
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const r = Number(cell.getAttribute('data-r'));
    const c = Number(cell.getAttribute('data-c'));

    if (state.mode === 'killEnemy') {
      const targetOp = opAt(r, c);
      if (targetOp) killEnemyByOp(targetOp);
      else killEnemyAtCell(r, c);
      return;
    }

    const op = opAt(r, c);
    if (op) {
      selectOp(op.uid);
      return;
    }
    if (state.selectedHand) {
      toast('请将待部署区干员拖入战场，拖动上 / 右 / 下 / 左确定朝向');
      return;
    }
    state.selectedHand = null;
    state.selectedOp = null;
    renderAll();
  });

  inspectorEl.addEventListener('change', function (e) {
    const sel = e.target.closest('[data-gear-morph]');
    if (sel) setOpMorph(sel.value, selectedOpObj());
  });

  inspectorEl.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    const op = selectedOpObj();
    if (act === 'skill') handleEvent('skill');
    else if (act === 'cancel-pending') cancelPending();
    else if (act === 'gain-hand') handleEvent('gain');
    else if (act === 'toggle-hand-elite' && state.selectedHand) toggleHandElite(state.selectedHand);
    else if (act === 'toggle-op-elite' && op) toggleOpElite(op.uid);
    else if (act === 'gear-edit' && op) openGearEditor(op.uid);
    else if (act === 'gear-remove' && op) removeGearAtIndex(Number(btn.getAttribute('data-gear-index')), op);
    else if (act === 'to-warehouse' && state.selectedHand) moveHandToWarehouse(state.selectedHand);
    else if (act === 'to-hand' && state.selectedWarehouse) addToHand(state.selectedWarehouse);
  });

  if (gearModal) {
    gearModal.addEventListener('click', function (e) {
      if (e.target === gearModal) { closeGearEditor(); return; }
      if (e.target.closest('#gearClose')) { closeGearEditor(); return; }
      const rm = e.target.closest('[data-gear-remove]');
      if (rm) { removeGearAtIndex(Number(rm.getAttribute('data-gear-remove'))); return; }
      const add = e.target.closest('[data-gear-add-item]');
      if (add) { addGearToOp(add.getAttribute('data-gear-add-item')); return; }
      const form = e.target.closest('[data-gear-form]');
      if (form) { toggleGearForm(form.getAttribute('data-gear-form')); return; }
    });
    gearModal.addEventListener('change', function (e) {
      const sel = e.target.closest('[data-gear-morph]');
      if (sel) setOpMorph(sel.value);
    });
  }
  if (gearSearchEl) {
    gearSearchEl.addEventListener('input', function () {
      gearEditor.q = gearSearchEl.value;
      renderGearEditor();
    });
  }

  eventBarEl.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-event]');
    if (!btn) return;
    handleEvent(btn.getAttribute('data-event'));
  });




  if (bondStripEl) {
    bondStripEl.addEventListener('click', function (e) {
      const chip = e.target.closest('[data-bond]');
      if (!chip) return;
      const name = chip.getAttribute('data-bond');
      if (openBondName === name && bondPopEl && !bondPopEl.hidden) hideBondPop();
      else showBondPop(name);
    });
  }
  if (bondPopEl) {
    bondPopEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-bond-close]')) { hideBondPop(); return; }
      const step = e.target.closest('[data-bond-step]');
      if (step) {
        const name = step.getAttribute('data-bond-name');
        setBondLayer(name, (state.layers[name] || 0) + Number(step.getAttribute('data-bond-step')));
      }
    });
    bondPopEl.addEventListener('change', function (e) {
      const input = e.target.closest('[data-bond-input]');
      if (input) setBondLayer(input.getAttribute('data-bond-input'), input.value);
    });
    bondPopEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.closest('[data-bond-input]')) e.target.blur();
    });
  }
  document.addEventListener('click', function (e) {
    if (!openBondName) return;
    if (e.target.closest('#bondStrip') || e.target.closest('#bondPop')) return;
    hideBondPop();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (gearEditor.open) { closeGearEditor(); return; }
      hideBondPop();
      closeSandboxShare();
    }
  });
  if (reportClose) reportClose.addEventListener('click', function () { if (reportPanel) reportPanel.hidden = true; });
  if (reportToggle) reportToggle.addEventListener('click', showLastReport);
  if (sandboxShareBtn) sandboxShareBtn.addEventListener('click', openSandboxShare);
  if (sandboxShareClose) sandboxShareClose.addEventListener('click', closeSandboxShare);
  if (sandboxCopyBtn) sandboxCopyBtn.addEventListener('click', copySandboxCode);
  if (sandboxImportBtn) sandboxImportBtn.addEventListener('click', function () {
    const text = sandboxCodeText ? String(sandboxCodeText.value || '').trim() : '';
    if (!text) { toast('请先在文本框中粘贴沙盒码'); return; }
    importSandboxCode(text);
  });
  if (sandboxDownloadBtn) sandboxDownloadBtn.addEventListener('click', downloadSandboxCode);
  if (copyLogBtn) copyLogBtn.addEventListener('click', copyFeedbackLog);
  if (exportDiagBtn) exportDiagBtn.addEventListener('click', exportDiagnostics);

  if (logToggle) {
    logToggle.addEventListener('click', function () {
      logsPanel.classList.toggle('collapsed');
      const collapsed = logsPanel.classList.contains('collapsed');
      logToggle.textContent = collapsed ? '展开' : '收起';
      hideTip();
    });
  }

  if (clearHandBtn) clearHandBtn.addEventListener('click', clearHand);
  if (whSearch) whSearch.addEventListener('input', function () { state.whFilter.q = whSearch.value; updateWhFilterUI(); renderWarehouse(); });
  if (whFilterToggle) whFilterToggle.addEventListener('click', toggleWhFilterPanel);
  if (whFilters) {
    whFilters.addEventListener('click', function (e) {
      const t = e.target;
      if (!t || !t.closest) return;
      const tier = t.closest('[data-wh-tier]');
      if (tier) { toggleWhTier(tier.getAttribute('data-wh-tier')); return; }
      const tag = t.closest('[data-wh-tag]');
      if (tag) { toggleWhTag(tag.getAttribute('data-wh-tag')); return; }
      const trg = t.closest('[data-wh-trigger]');
      if (trg) { toggleWhTrigger(trg.getAttribute('data-wh-trigger')); return; }
      const mode = t.closest('[data-wh-mode]');
      if (mode) { setWhTagMode(mode.getAttribute('data-wh-mode')); return; }
      const clear = t.closest('[data-wh-clear]');
      if (clear) clearWhGroup(clear.getAttribute('data-wh-clear'));
    });
  }
  if (importCodeBtn) importCodeBtn.addEventListener('click', importTeamCode);
  if (teamFilterBtn) teamFilterBtn.addEventListener('click', toggleTeamFilter);
  if (whClearAllBtn) whClearAllBtn.addEventListener('click', clearWhFilters);

  if (freePlus) freePlus.addEventListener('click', function () { state.freeRefreshes++; renderStatus(); });
  if (freeMinus) freeMinus.addEventListener('click', function () { state.freeRefreshes = Math.max(0, state.freeRefreshes - 1); renderStatus(); });

  if (refreshBtn) refreshBtn.addEventListener('click', function () { handleEvent('refresh'); });

  function resetSandbox() {
    if (drag) cleanupDrag();
    if (facing) cleanupFacing();
    state = initState();
    closeGearEditor();
    hideBondPop();
    hideTip();
    if (reportPanel) reportPanel.hidden = true;
    closeSandboxShare();
    initWhControls();
    log('沙盘已重置', 'event');
    // 重置后直接落在第 1 回合休整期，不需要再手动点一次「进入休整期」。
    beginPrep({ trigger: false });
    renderAll();
    return state;
  }

  resetBtn.addEventListener('click', resetSandbox);

  clearLogBtn.addEventListener('click', function () {
    state.logs = [];
    renderLog();
  });

  if (clearLayersBtn) clearLayersBtn.addEventListener('click', clearAllLayers);

  // ---- 战场选择 ----
  if (mapPickBtn) mapPickBtn.addEventListener('click', openMapPicker);
  function showCurrentMapDetail() {
    const p = presetById(CURRENT_PRESET);
    if (p && window.GSPA_MAP_PICKER) window.GSPA_MAP_PICKER.showDetail(p);
    else toast('请先在「更换战场」中选择战场');
  }
  if (mapThumbEl) { mapThumbEl.style.cursor = 'zoom-in'; mapThumbEl.addEventListener('click', showCurrentMapDetail); }
  if (mapNameEl) { mapNameEl.style.cursor = 'pointer'; mapNameEl.addEventListener('click', showCurrentMapDetail); }
  if (mapModal) {
    mapModal.addEventListener('click', function (e) {
      if (e.target === mapModal) closeMapPicker();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e && e.key === 'Escape' && mapModal && !mapModal.hidden) closeMapPicker();
  });
  window.addEventListener('resize', function () { fitBoard(); });

  // ---- boot ----
  loadStoredMap();
  // ?map=01-2 直接载入某张规程场地（方便分享/验收）
  (function () {
    let preset = null;
    try {
      if (typeof URLSearchParams !== 'undefined' && typeof location !== 'undefined' && location.search) {
        preset = presetById(new URLSearchParams(location.search).get('map'));
      }
    } catch (e) { /* 忽略非法参数 */ }
    if (!preset) return;
    MAP_W = preset.w;
    MAP_H = preset.h;
    MAP = preset.tiles.map(function (row) { return row.slice(); });
    MAP_BOX = buildBoxGrid(preset.boxes);
    CURRENT_PRESET = preset.id;
    persistMap();
  })();
  state = initState();
  initWhControls();
  // 打开沙盘即处于第 1 回合休整期；场上为空，不触发 onPrepStart。
  beginPrep({ trigger: false });
  renderAll();
  (function () {
    try {
      if (typeof URLSearchParams !== 'undefined' && typeof location !== 'undefined' &&
          new URLSearchParams(location.search).get('picker') === '1') openMapPicker();
    } catch (e) { /* 忽略 */ }
  })();
})();



