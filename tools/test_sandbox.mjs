/**
 * 沙盒叠层规则回归测试（Node + 最小 DOM 桩，不需要浏览器）。
 *
 *   node tools/test_sandbox.mjs
 *
 * 覆盖：精英/普通分支、bonds:active、priceSumMul、perGain/perRefresh/perBench、
 * 免费刷新上限、战斗叠加上限光环、获得时一次性、非叠层特殊效果不误报等。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function makeEl(id) {
  const el = {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    className: '',
    title: '',
    disabled: false,
    style: {},
    dataset: {},
    offsetWidth: 1,
    offsetHeight: 1,
    children: [],
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); return on; }
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k] === undefined ? null : this[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this, k) && this[k] != null; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    querySelector(sel) {
      if (sel === '[data-phase="prep"]') return makeStep('prep');
      if (sel === '[data-phase="combat"]') return makeStep('combat');
      if (/^\[data-event=/.test(sel)) return makeEl('btn:' + sel);
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.pp-step') return [makeStep('prep'), makeStep('combat')];
      return [];
    },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    cloneNode() { return makeEl(this.id); },
    setPointerCapture() {},
    focus() {},
    blur() {},
    scrollIntoView() {},
    setSelectionRange() {},
    select() {},
    insertBefore() {},
    insertAdjacentHTML() {},
    remove() {},
    matches() { return false; }
  };
  return el;
}

function makeStep(phase) {
  const el = makeEl('step:' + phase);
  el.getAttribute = (k) => (k === 'data-phase' ? phase : null);
  return el;
}

const nodes = new Map();
const doc = {
  readyState: 'complete',
  title: '',
  documentElement: makeEl('html'),
  body: makeEl('body'),
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, makeEl(id));
    return nodes.get(id);
  },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement(tag) { return makeEl(tag); },
  addEventListener() {},
  removeEventListener() {},
  execCommand() { return true; }
};

const storage = new Map();
const ctx = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Math,
  Date,
  JSON,
  Set,
  Map,
  Number,
  String,
  Boolean,
  Array,
  Object,
  RegExp,
  parseInt,
  parseFloat,
  isFinite,
  isNaN,
  Infinity,
  NaN,
  prompt() { return null; },
  alert() {},
  localStorage: {
    getItem(k) { return storage.has(k) ? storage.get(k) : null; },
    setItem(k, v) { storage.set(k, String(v)); },
    removeItem(k) { storage.delete(k); }
  },
  document: doc
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.self = ctx;
ctx.innerWidth = 1280;
ctx.innerHeight = 800;
ctx.location = { hash: '', href: 'http://localhost/sandbox.html', pathname: '/sandbox.html', search: '' };
ctx.CSS = { escape: (s) => String(s) };
ctx.addEventListener = () => {};
ctx.removeEventListener = () => {};
ctx.requestAnimationFrame = (fn) => setTimeout(fn, 0);
vm.createContext(ctx);

const FILES = [
  'web/data/data.js',
  'web/data/ranges.js',
  'web/data/operator_positions.js',
  'web/data/operator_ranges.js',
  'web/data/operator_rules.js',
  'web/data/maps.js',
  'web/js/code.js',
  'web/js/sandbox-code.js',
  'web/js/calc.js',
  'web/js/stack-core.js'
];
for (const rel of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
}

let sandboxSrc = fs.readFileSync(path.join(ROOT, 'web/js/sandbox.js'), 'utf8');
sandboxSrc = sandboxSrc.replace(
  '  // ---- boot ----',
  `  window.__sb = {
    state: function () { return state; },
    reset: function () { state = initState(); renderAll(); return state; },
    resetSandbox: resetSandbox,
    addToHand: addToHand,
    placeHand: placeHand,
    triggerEvent: triggerEvent,
    handleEvent: handleEvent,
    applyRule: applyRule,
    retreat: retreat,
    beginBattle: beginBattle,
    planEgirDevour: planEgirDevour,
    applyEgirDevour: applyEgirDevour,
    applyDeputLayers: applyDeputLayers,
    applySpecialBattleCaps: applySpecialBattleCaps,
    getEval: getEval,
    effectiveBattleCap: effectiveBattleCap,
    setBondLayer: setBondLayer,
    bondPopHtml: bondPopHtml,
    rulesFor: function (name) { return RULES[name] || []; },
    buildSandboxSnapshot: buildSandboxSnapshot,
    applySandboxSnapshot: applySandboxSnapshot,
    makeSandboxCode: makeSandboxCode,
    importSandboxCode: importSandboxCode,
    buildFeedbackObject: buildFeedbackObject,
    buildFeedbackText: buildFeedbackText,
    applyPreset: applyPreset,
    mapInfo: function () { return { w: MAP_W, h: MAP_H, preset: CURRENT_PRESET, map: MAP, boxes: boxList() }; },
    renderAll: renderAll
  };
  // ---- boot ----`
);
vm.runInContext(sandboxSrc, ctx, { filename: 'web/js/sandbox.js' });

const sb = ctx.window.__sb;
assert.ok(sb, 'sandbox 暴露测试钩子');

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok   ' + name);
  } catch (e) {
    console.error('FAIL ' + name);
    console.error(e && e.stack || e);
    process.exitCode = 1;
  }
}
function st() { return sb.state(); }
function reset() { return sb.reset(); }
function addBoard(name, elite, r, c, dir) {
  const s = st();
  const op = { uid: s.uid++, name, elite: !!elite, r: r == null ? 0 : r, c: c == null ? 0 : c, dir: dir || 'right' };
  s.board.push(op);
  return op;
}
function layer(bond) { return st().layers[bond] || 0; }

ok('初始状态可渲染，未触发运行时错误', () => {
  const s = reset();
  assert.equal(s.round, 1);
  assert.equal(s.phase, 'prep');
  assert.ok(Array.isArray(s.hand));
});

ok('阶段进度条：data-phase 随休整期 / 作战期切换', () => {
  const s = reset();
  const pp = nodes.get('phaseProgress');
  assert.equal(pp.getAttribute('data-phase'), 'prep');
  assert.match(pp.getAttribute('aria-label'), /休整期/);
  s.phase = 'combat';
  sb.renderAll();
  assert.equal(pp.getAttribute('data-phase'), 'combat');
  assert.match(pp.getAttribute('aria-label'), /作战期/);
});

ok('沙盒筛选器：阶数 / 盟约 / 触发时机多选', () => {
  const s = reset();
  s.whFilter.tiers = [1];
  s.whFilter.tags = ['阿戈尔'];
  s.whFilter.triggers = ['战斗中'];
  s.whFilter.tagMode = 'or';
  sb.renderAll();
  const html = nodes.get('warehouseList').innerHTML;
  assert.ok(html.includes('幽灵鲨'), '应包含阿戈尔·战斗中干员');
  assert.ok(!html.includes('灰喉'), '灰喉不是阿戈尔，不应出现');
  s.whFilter.tagMode = 'and';
  s.whFilter.tags = ['阿戈尔', '精准'];
  sb.renderAll();
  assert.ok(nodes.get('warehouseList').innerHTML.includes('没有匹配的干员'), 'AND 模式无交集应为空');
});

ok('精英分支只结算精英规则（灰喉普通 +2 / 精英 +4）', () => {
  let s = reset();
  s.phase = 'prep';
  sb.addToHand('灰喉', false);
  s.selectedHand = s.hand[0].id;
  s.hand[0].gained = false;
  sb.handleEvent('gain');
  assert.equal(layer('精准'), 2);

  s = reset();
  s.phase = 'prep';
  sb.addToHand('灰喉', true);
  s.selectedHand = s.hand[0].id;
  s.hand[0].gained = false;
  sb.handleEvent('gain');
  assert.equal(layer('精准'), 4, '精英不应再叠加普通规则的 +2');
});

ok('bonds:active 按自身已激活盟约结算，不崩溃', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('云迹', false, 0, 0, 'right');
  addBoard('霜叶', false, 0, 1, 'right');
  addBoard('暗索', false, 0, 2, 'right');
  // 云迹带灵巧/奇迹；补足灵巧人数后按自身已激活盟约加层
  const before = JSON.stringify(s.layers);
  sb.triggerEvent('onSkill', { op: s.board[0] });
  assert.notEqual(JSON.stringify(s.layers), before, '应至少增加一个有效盟约层');
  assert.ok(layer('灵巧') > 0, '应写入【灵巧】层数，而不是把 active 当字符串拆字');
});

ok('priceSumMul：棘刺精英按售出价 2 倍结算，且受每回合 24 层上限', () => {
  const s = reset();
  s.phase = 'prep';
  addBoard('棘刺', true, 0, 0, 'right');
  addBoard('蓝毒', false, 0, 1, 'right');
  addBoard('温蒂', false, 0, 2, 'right');
  const sum = s.board.reduce((n, o) => n + ctx.window.StackCore.sellPriceOf(o.name, { elite: !!o.elite }), 0);
  s.prepStarted = true;
  sb.handleEvent('prepEnd');
  assert.equal(layer('伊比利亚'), Math.min(24, sum * 2), '精英应按售出价 2 倍结算（sum=' + sum + '，实际 ' + layer('伊比利亚') + '）');
});

ok('perGain：风絮按本回合获得数 ×2 结算', () => {
  const s = reset();
  s.phase = 'prep';
  addBoard('风絮', false, 0, 0, 'right');
  addBoard('拜松', false, 1, 0, 'right');
  addBoard('矩', false, 1, 1, 'right');
  addBoard('褐果', false, 1, 2, 'right');
  s.roundGains = 3;
  s.prepStarted = true;
  sb.handleEvent('prepEnd');
  assert.ok(layer('炎') >= 6, '3 名获得 ×2，炎应至少 +6（实际 ' + layer('炎') + '）');
});

ok('perRefresh：安洁莉娜按刷新次数结算', () => {
  const s = reset();
  s.phase = 'prep';
  addBoard('安洁莉娜', false, 0, 0, 'right');
  const helpers = ctx.window.GSPA_DATA.operators.filter((o) => o.name !== '安洁莉娜' && (o.tags || []).includes('叙拉古')).slice(0, 2);
  helpers.forEach((o, i) => addBoard(o.name, false, 1, i, 'right'));
  s.refreshes = 2;
  s.prepStarted = true;
  sb.handleEvent('prepEnd');
  assert.ok(layer('叙拉古') >= 4, '2 次刷新 ×2，叙拉古应至少 +4（实际 ' + layer('叙拉古') + '）');
});

ok('perBench：焰尾按整备区人数结算', () => {
  const s = reset();
  s.phase = 'prep';
  addBoard('焰尾', false, 0, 0, 'right');
  addBoard('野鬃', false, 1, 0, 'right');
  addBoard('砾', false, 1, 1, 'right');
  for (let i = 0; i < 3; i++) sb.addToHand('灰喉', false);
  s.prepStarted = true;
  sb.handleEvent('prepEnd');
  assert.ok(layer('卡西米尔') >= 3, '3 名整备 ×1，卡西米尔应至少 +3（实际 ' + layer('卡西米尔') + '）');
});

ok('免费刷新：奥斯塔 +1，忍冬最多 3 次', () => {
  let s = reset();
  s.phase = 'prep';
  sb.addToHand('奥斯塔', false);
  s.selectedHand = s.hand[0].id;
  sb.handleEvent('gain');
  assert.equal(s.freeRefreshes, 1);

  s = reset();
  s.phase = 'prep';
  for (let i = 0; i < 4; i++) {
    sb.addToHand('忍冬', false);
    s.selectedHand = s.hand[i].id;
    s.hand[i].gained = false;
    sb.handleEvent('gain');
  }
  assert.equal(s.freeRefreshes, 3, 'maxFree=3 应封顶');
});

ok('复奏：只有本回合第一次刷新触发', () => {
  const s = reset();
  s.phase = 'prep';
  s.prepStarted = true;
  addBoard('地灵', false, 0, 0, 'right');
  addBoard('折光', false, 0, 1, 'right');
  addBoard('卡涅利安', false, 0, 2, 'right');
  addBoard('拉普兰德', false, 1, 0, 'right');
  addBoard('安洁莉娜', false, 1, 1, 'right');
  addBoard('铃兰', false, 1, 2, 'right');
  sb.addToHand('复奏', false);
  sb.handleEvent('refresh');
  assert.equal(layer('莱塔尼亚'), 2, '首次刷新莱塔尼亚 +2（实际 ' + layer('莱塔尼亚') + '）');
  const before = layer('莱塔尼亚');
  sb.handleEvent('refresh');
  assert.equal(layer('莱塔尼亚'), before, '第二次刷新不应再加');
});

ok('免费刷新会被优先消耗', () => {
  const s = reset();
  s.phase = 'prep';
  s.prepStarted = true;
  sb.addToHand('奥斯塔', false);
  s.selectedHand = s.hand[0].id;
  sb.handleEvent('gain');
  assert.equal(s.freeRefreshes, 1);
  sb.handleEvent('refresh');
  assert.equal(s.freeRefreshes, 0);
  assert.equal(s.refreshes, 1);
});

ok('流明：战斗结束时按存活人数 ×普通/精锐倍率结算', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('流明', true, 0, 0, 'right');
  addBoard('蓝毒', false, 0, 1, 'right');
  addBoard('温蒂', false, 0, 2, 'right');
  addBoard('褐果', false, 1, 0, 'right');
  const n = s.board.length;
  sb.triggerEvent('onBattleEnd');
  assert.equal(layer('伊比利亚'), n * 2, '精锐流明应按人数 ×2（实际 ' + layer('伊比利亚') + '）');
  assert.equal(layer('聚合'), n * 2, '精锐流明应按人数 ×2（实际 ' + layer('聚合') + '）');
});

ok('战斗叠加上限：Mon3tr 相邻 +60%，薇薇安娜同盟约 +14', () => {
  const s = reset();
  s.phase = 'combat';
  const m3 = addBoard('Mon3tr', true, 1, 1, 'right');
  const target = addBoard('灰喉', false, 1, 2, 'right');
  addBoard('薇薇安娜', true, 1, 3, 'right');
  // 灰喉与薇薇安娜需要同盟约才吃 +14；这里至少验证百分比光环
  const cap = sb.effectiveBattleCap(target, 10);
  assert.equal(cap, 16, '10 × 1.6 = 16（实际 ' + cap + '）');
});

ok('获得时只触发一次', () => {
  const s = reset();
  s.phase = 'prep';
  sb.addToHand('灰喉', false);
  s.selectedHand = s.hand[0].id;
  s.hand[0].gained = false;
  sb.handleEvent('gain');
  const first = layer('精准');
  sb.handleEvent('gain');
  assert.equal(layer('精准'), first, '第二次不应再加层');
});

ok('战斗上限按钮把每场战斗规则补到有效上限', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('砾', false, 0, 0, 'right');
  // 让卡西米尔/不屈激活
  const helpers = ctx.window.GSPA_DATA.operators.filter((o) => o.name !== '砾' && (o.tags || []).some((t) => t === '卡西米尔' || t === '不屈')).slice(0, 3);
  helpers.forEach((o, i) => addBoard(o.name, false, 1, i, 'right'));
  sb.handleEvent('battleCap');
  assert.ok(layer('卡西米尔') >= 12 || layer('不屈') >= 12, '应补到 12 层（实际 ' + layer('卡西米尔') + '/' + layer('不屈') + '）');
});

ok('非叠层特殊效果不会被当成叠层结算', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('角峰', false, 0, 0, 'right');
  const before = JSON.stringify(s.layers);
  sb.triggerEvent('onCombat');
  assert.equal(JSON.stringify(s.layers), before, '角峰的寒冷效果不应加层');
});

ok('自选干员也能参与盟约计数（Calc 的 slots.p 分支）', () => {
  const s = reset();
  const pick = ctx.window.GSPA_DATA.picks.find((p) => (p.tags || []).includes('炎'));
  assert.ok(pick, '应有一个炎盟约自选干员');
  addBoard(pick.name, false, 0, 0, 'right');
  addBoard('拜松', false, 0, 1, 'right');
  const row = sb.getEval().rows.find((r) => r.name === '炎');
  assert.ok(row.count >= 2, '自选干员应计入炎人数（实际 ' + row.count + '）');
});

ok('绝技按精锐人数判定（elite 传入 Calc）', () => {
  const s = reset();
  addBoard('灰喉', true, 0, 0, 'right');
  addBoard('棘刺', true, 0, 1, 'right');
  const ev = sb.getEval();
  const row = ev.rows.find((r) => r.name === '绝技');
  assert.ok(row, '应有绝技行');
  assert.ok(row.count >= 2, '精锐人数应 >=2（实际 ' + row.count + '）');
});

ok('渲染路径：选中场上干员 / 手牌 / 待放置时都能渲染', () => {
  const s = reset();
  s.phase = 'prep';
  const op = addBoard('灰喉', false, 0, 0, 'right');
  s.selectedOp = op.uid;
  sb.renderAll();
  assert.ok(nodes.get('inspector').innerHTML.includes('灰喉'));
  assert.ok(nodes.get('board').innerHTML.includes('class="cell'));

  sb.addToHand('棘刺', false);
  s.selectedHand = s.hand[0].id;
  sb.renderAll();
  assert.ok(nodes.get('inspector').innerHTML.includes('棘刺'));

  s.selectedHand = null;
  s.selectedOp = null;
  s.pending = { kind: 'place', handId: 'x', name: '棘刺', r: 0, c: 1, dir: null, elite: false };
  sb.renderAll();
  assert.ok(nodes.get('inspector').innerHTML.includes('待部署'));
});

ok('准备期流程：进入休整期触发 onPrepStart，结束休整期进入作战期', () => {
  const s = reset();
  s.phase = 'prep';
  addBoard('空弦', false, 0, 0, 'right');
  addBoard('霜叶', false, 0, 1, 'right'); // 灵巧
  addBoard('华法琳', false, 1, 1, 'right'); // 灵巧
  addBoard('灰喉', false, 1, 0, 'right'); // 精准
  addBoard('渡桥', false, 0, 2, 'right'); // 远见
  sb.handleEvent('prepStart');
  assert.equal(s.prepStarted, true);
  assert.ok(layer('灵巧') >= 3, '空弦应使自身/前方已激活灵巧 +3（实际 ' + layer('灵巧') + '）');
  sb.handleEvent('prepEnd');
  assert.equal(s.phase, 'combat');
  sb.handleEvent('battleEnd');
  assert.equal(s.phase, 'prep');
  assert.equal(s.round, 2);
  assert.equal(s.prepStarted, false);
});

ok('进入沙盘 / 重置：第 1 回合直接处于休整期，不需要手动开始', () => {
  const s = sb.resetSandbox();
  assert.equal(s.round, 1);
  assert.equal(s.phase, 'prep');
  assert.equal(s.prepStarted, true);
  assert.equal(s.roundStarted, true);
  assert.equal(s.counters && Object.keys(s.counters).length, 0);
  assert.ok(s.logs.some((x) => x.text.includes('第 1 回合 · 进入休整期')), '日志应记录进入休整期');
});

ok('乌啾：按场上乌萨斯人数转化临时层', () => {
  const s = reset();
  s.phase = 'prep';
  addBoard('乌啾', false, 0, 0, 'right');
  addBoard('烈夏', false, 0, 1, 'right');
  addBoard('赫拉格', false, 0, 2, 'right');
  s.temp['乌萨斯'] = 10;
  sb.handleEvent('prepStart');
  assert.equal(layer('乌萨斯'), 3, '3 名乌萨斯应转化 3 层（实际 ' + layer('乌萨斯') + '）');
  assert.equal(s.temp['乌萨斯'], 7);
});

ok('华法琳：战斗开始时给身前一格特质，开技能时触发', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('华法琳', false, 0, 0, 'right');
  const target = addBoard('灰喉', false, 0, 1, 'right');
  addBoard('旅骨', false, 1, 1, 'right'); // 精准激活
  sb.triggerEvent('onBattleStart');
  assert.equal(s.grantedTraits.length, 1, '应授予 1 个特质');
  sb.triggerEvent('onSkill', { op: target });
  assert.ok(layer('精准') >= 1, '特质应使精准 +1（实际 ' + layer('精准') + '）');
});

ok('铃兰：进入休整期触发身前一格的获得时效果', () => {
  const s = reset();
  s.phase = 'prep';
  addBoard('铃兰', false, 0, 0, 'right');
  addBoard('灰喉', false, 0, 1, 'right');
  sb.handleEvent('prepStart');
  assert.ok(layer('精准') >= 2, '灰喉获得时 +2（实际 ' + layer('精准') + '）');
});

ok('凛御银灰：身前一格谢拉格/灵巧干员战斗上限 +75%', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('凛御银灰', false, 0, 0, 'right');
  const target = addBoard('极光', false, 0, 1, 'right');
  assert.equal(sb.effectiveBattleCap(target, 10), 17);
});

ok('旅骨：自身与身前一格按各自售价叠层', () => {
  const s = reset();
  s.phase = 'prep';
  const self = addBoard('旅骨', false, 0, 0, 'right');
  addBoard('灰喉', false, 0, 1, 'right'); // 精准
  addBoard('温蒂', false, 0, 2, 'right'); // 伊比利亚
  addBoard('蓝毒', false, 1, 0, 'right'); // 伊比利亚（凑 3 人）
  const rule = sb.rulesFor('旅骨').find((r) => r.event === 'onPrepEnd' && !r.elite);
  const n = sb.applyRule(self, rule, {});
  assert.ok(n > 0, '应至少给一个目标加层');
  assert.ok(layer('伊比利亚') >= 1, '旅骨自身售出价 1，应至少 +1（实际 ' + layer('伊比利亚') + '）');
  assert.ok(layer('精准') >= 1, '灰喉精准应按其售出价叠层（实际 ' + layer('精准') + '）');
});

ok('极光：perTotal 封顶 12 层', () => {
  const s = reset();
  s.phase = 'prep';
  const op = addBoard('极光', false, 0, 0, 'right');
  const rule = { event: 'onGain', bonds: ['谢拉格'], amount: 1, perTotal: 12, requireActive: false, elite: false };
  for (let i = 0; i < 20; i++) sb.applyRule(op, rule, { op: op });
  assert.equal(layer('谢拉格'), 12);
});

ok('荒芜拉普兰德（精锐）：其他叙拉古击倒敌人也给全队叙拉古加层', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('荒芜拉普兰德', true, 0, 0, 'right');
  const killer = addBoard('拉普兰德', false, 0, 1, 'right');
  addBoard('铃兰', false, 0, 2, 'right');
  const before = layer('叙拉古');
  sb.triggerEvent('onKill', { op: killer, noCell: true, forceInRange: true });
  assert.equal(layer('叙拉古') - before, 4, '精锐荒芜应让其他叙拉古的击倒也 +4');
});

ok('罗比菈塔：同一行人数 ×2 结算坚守/助力', () => {
  const s = reset();
  s.phase = 'prep';
  const robbi = addBoard('罗比菈塔', false, 0, 0, 'right');
  addBoard('温蒂', false, 0, 1, 'right'); // 坚守
  addBoard('帕拉斯', false, 0, 2, 'right'); // 助力
  const rule = sb.rulesFor('罗比菈塔').find((r) => r.event === 'onPrepEnd' && !r.elite);
  sb.applyRule(robbi, rule, {});
  assert.ok(layer('坚守') >= 6, '3 人同行 ×2 = 6（实际 ' + layer('坚守') + '）');
  assert.ok(layer('助力') >= 6, '3 人同行 ×2 = 6（实际 ' + layer('助力') + '）');
});

ok('维娜·维多利亚：按不同阶维多利亚人数结算', () => {
  const s = reset();
  s.phase = 'prep';
  const vina = addBoard('维娜·维多利亚', false, 0, 0, 'right');
  addBoard('慕斯', false, 0, 1, 'right'); // 维多利亚
  addBoard('水灯心', false, 0, 2, 'right'); // 维多利亚
  const rule = sb.rulesFor('维娜·维多利亚').find((r) => r.event === 'onPrepEnd' && !r.elite);
  sb.applyRule(vina, rule, {});
  assert.ok(layer('维多利亚') >= 2, '至少按 1 个不同阶 ×2 结算（实际 ' + layer('维多利亚') + '）');
});

ok('淬羽赫默：给整备区每名干员的已激活盟约加层', () => {
  const s = reset();
  s.phase = 'prep';
  const op = addBoard('淬羽赫默', false, 0, 0, 'right');
  addBoard('灰喉', false, 0, 1, 'right');
  addBoard('旅骨', false, 0, 2, 'right'); // 精准激活
  sb.addToHand('灰喉', false);
  const rule = sb.rulesFor('淬羽赫默').find((r) => r.event === 'onPrepEnd' && !r.elite);
  sb.applyRule(op, rule, {});
  assert.ok(layer('精准') >= 1, '整备区灰喉的精准应 +1（实际 ' + layer('精准') + '）');
});

ok('青枳：使自身及身后一格已激活盟约 +3', () => {
  const s = reset();
  s.phase = 'prep';
  const op = addBoard('青枳', false, 0, 1, 'right');
  addBoard('霜叶', false, 0, 0, 'right'); // 身后，灵巧
  addBoard('华法琳', false, 1, 0, 'right'); // 灵巧
  const rule = sb.rulesFor('青枳').find((r) => r.event === 'onPrepStart' && !r.elite);
  sb.applyRule(op, rule, {});
  assert.ok(layer('灵巧') >= 3, '身后霜叶的灵巧应 +3（实际 ' + layer('灵巧') + '）');
});

ok('浊心斯卡蒂：作战期友军部署进范围触发阿戈尔叠层', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('浊心斯卡蒂', false, 1, 1, 'right');
  addBoard('斯卡蒂', false, 1, 0, 'right');
  addBoard('幽灵鲨', false, 0, 1, 'right');
  sb.addToHand('安哲拉', false);
  const item = s.hand[0];
  sb.placeHand(item.name, 1, 2, 'right', item.id);
  assert.ok(layer('阿戈尔') >= 2, '部署进范围应触发 +2（实际 ' + layer('阿戈尔') + '）');
});

ok('沙盒码：地图 / 回合 / 手牌 / 场上 / 层数 / 计数器可往返', () => {
  const w = 5, h = 4;
  const tiles = [];
  for (let r = 0; r < h; r++) {
    const row = [];
    for (let c = 0; c < w; c++) row.push(r === 1 && c === 2 ? 'high' : r === 3 && c === 0 ? 'fence' : 'ground');
    tiles.push(row);
  }
  const pick = ctx.window.GSPA_DATA.picks[0];
  const snap = {
    map: { w, h, tiles },
    round: 3,
    phase: 'combat',
    prepStarted: false,
    uid: 400,
    hand: [
      { id: 'h201', name: '灰喉', elite: true, gained: true },
      { id: 'h202', name: pick.name, elite: false, gained: false }
    ],
    board: [
      { uid: 301, name: '棘刺', elite: true, r: 1, c: 2, dir: 'down' },
      { uid: 302, name: '华法琳', elite: false, r: 0, c: 0, dir: 'right' }
    ],
    layers: { '伊比利亚': 12, '精准': 7 },
    temp: { '乌萨斯': 3 },
    refreshes: 2,
    freeRefreshes: 1,
    roundGains: 4,
    grantedTraits: [{ targetUid: 301, targetName: '棘刺', source: '华法琳', amount: 1, perRound: 7, elite: false }],
    freeGainCounts: { '忍冬': 2 },
    counters: { '301:伊比利亚:onPrepEnd::r': 12 },
    battleCounters: { '301:伊比利亚:onKill:b': 5 },
    totalCounters: { '302:谢拉格:onGain::t': 4 }
  };
  const code = ctx.window.SandboxCode.encode(snap, ctx.window.GSPA_DATA);
  assert.match(code, /^GSPS1\./);
  const res = ctx.window.SandboxCode.decode(code, ctx.window.GSPA_DATA);
  assert.ok(res && res.snapshot);
  assert.equal(res.snapshot.round, 3);
  assert.equal(res.snapshot.phase, 'combat');
  assert.equal(res.snapshot.prepStarted, false);
  assert.equal(JSON.stringify(res.snapshot.map), JSON.stringify(snap.map));
  assert.equal(res.snapshot.hand.length, 2);
  assert.equal(res.snapshot.board.length, 2);
  assert.equal(res.snapshot.board[0].uid, 301);
  assert.equal(res.snapshot.board[0].dir, 'down');
  assert.equal(JSON.stringify(res.snapshot.layers), JSON.stringify(snap.layers));
  assert.equal(JSON.stringify(res.snapshot.temp), JSON.stringify(snap.temp));
  assert.equal(res.snapshot.refreshes, 2);
  assert.equal(res.snapshot.freeRefreshes, 1);
  assert.equal(res.snapshot.roundGains, 4);
  assert.equal(res.snapshot.grantedTraits[0].targetUid, 301);
  assert.equal(JSON.stringify(res.snapshot.counters), JSON.stringify(snap.counters));
  assert.equal(JSON.stringify(res.snapshot.battleCounters), JSON.stringify(snap.battleCounters));
  assert.equal(JSON.stringify(res.snapshot.totalCounters), JSON.stringify(snap.totalCounters));
  assert.equal(JSON.stringify(res.snapshot.freeGainCounts), JSON.stringify(snap.freeGainCounts));

  assert.ok(sb.applySandboxSnapshot(res.snapshot, res.warnings));
  const st = sb.state();
  assert.equal(st.round, 3);
  assert.equal(st.board.length, 2);
  assert.equal(st.hand.length, 2);
  assert.equal(st.layers['伊比利亚'], 12);
  assert.equal(st.grantedTraits[0].targetUid, 301);
  assert.equal(st.counters['301:伊比利亚:onPrepEnd::r'], 12);
  assert.equal(st.uid, 400);
});

ok('沙盒码：空状态可往返，坏码被校验拒绝', () => {
  const code = sb.makeSandboxCode();
  assert.match(code, /^GSPS1\./);
  const res = ctx.window.SandboxCode.decode(code, ctx.window.GSPA_DATA);
  assert.ok(res && res.snapshot);
  const bad = code.slice(0, -2) + (code.slice(-2, -1) === 'A' ? 'B' : 'A') + code.slice(-1);
  assert.equal(ctx.window.SandboxCode.decode(bad, ctx.window.GSPA_DATA), null);
});

ok('反馈码中的华法琳特质在霍尔海雅开技能时应加层', () => {
  const code = 'GSPS1.8TEiIiIiIiIQAAMiIgCKIgiAESI4AAAAMIADcBZGBGgDTK4ZYAapfDNADXOgRUAbJrDGgDaBBQYjILAAAAAAjL4CDgAAAAAA5g';
  const res = ctx.window.SandboxCode.decode(code, ctx.window.GSPA_DATA);
  assert.ok(res && res.snapshot);
  assert.ok(sb.applySandboxSnapshot(res.snapshot, res.warnings));
  const s = sb.state();
  s.phase = 'combat';
  const target = s.board.find((o) => o.name === '霍尔海雅');
  const before = { jz: s.layers['精准'] || 0, as: s.layers['奥术'] || 0 };
  sb.triggerEvent('onSkill', { op: target });
  // 霍尔海雅自身 onSkill +4，华法琳特质再 +1，共 +5
  assert.equal(s.layers['精准'], before.jz + 5, '自身 +4 与特质 +1 应共加 5（实际 ' + s.layers['精准'] + '）');
  assert.equal(s.layers['奥术'], before.as + 5, '自身 +4 与特质 +1 应共加 5（实际 ' + s.layers['奥术'] + '）');
});

ok('反馈码中的黑键击倒敌人时应按已激活精准加层', () => {
  const code = 'GSPS1.8TEiIiIiIiIQAAMiIgCKIgiAESI4AAAAMIADcBZGBGgDTK4ZYAapfDNADXOgRUAbJrDGgDaBBQYjILAAAAAAjL4CDgAAAAAA5g';
  const res = ctx.window.SandboxCode.decode(code, ctx.window.GSPA_DATA);
  assert.ok(res && res.snapshot);
  assert.ok(sb.applySandboxSnapshot(res.snapshot, res.warnings));
  const s = sb.state();
  s.phase = 'combat';
  const bk = s.board.find((o) => o.name === '黑键');
  const before = s.layers['精准'] || 0;
  sb.triggerEvent('onKill', { op: bk, noCell: true, forceInRange: true });
  assert.equal(s.layers['精准'], before + 1, '黑键击倒应给精准 +1（实际 ' + s.layers['精准'] + '）');
  assert.equal(s.layers['莱塔尼亚'] || 0, 0, '莱塔尼亚未激活，不应加层');
});

ok('补满叠层：覆盖黑键的每回合上限与华法琳特质', () => {
  const code = 'GSPS1.8TEiIiIiIiIQAAMiIgCKIgiAESI4AAAAMIADcBZGBGgDTK4ZYAapfDNADXOgRUAbJrDGgDaBBQYjILAAAAAAjL4CDgAAAAAA5g';
  const res = ctx.window.SandboxCode.decode(code, ctx.window.GSPA_DATA);
  assert.ok(res && res.snapshot);
  assert.ok(sb.applySandboxSnapshot(res.snapshot, res.warnings));
  const s = sb.state();
  s.phase = 'combat';
  const beforeJz = s.layers['精准'] || 0;
  const beforeAs = s.layers['奥术'] || 0;
  sb.handleEvent('battleCap');
  assert.ok((s.layers['精准'] || 0) >= beforeJz + 8, '黑键每回合上限 8 层应被补上（实际 +' + ((s.layers['精准'] || 0) - beforeJz) + '）');
  assert.ok((s.layers['奥术'] || 0) >= beforeAs + 7, '华法琳特质每回合上限 7 层应被补上（实际 +' + ((s.layers['奥术'] || 0) - beforeAs) + '）');
  assert.ok(s.logs.some((l) => l.text.includes('补满叠层')), '应记录补满叠层日志');
});

ok('战斗开始时只记录特质，不应误报为 +1 层', () => {
  const code = 'GSPS1.8TEiIiIiIiIQAAMiIgCKIgiAESI4AAAAMIADcBZGBGgDTK4ZYAapfDNADXOgRUAbJrDGgDaBBQYjILAAAAAAjL4CDgAAAAAA5g';
  const res = ctx.window.SandboxCode.decode(code, ctx.window.GSPA_DATA);
  assert.ok(res && res.snapshot);
  assert.ok(sb.applySandboxSnapshot(res.snapshot, res.warnings));
  const s = sb.state();
  s.phase = 'combat';
  s.prepStarted = false;
  const before = JSON.stringify(s.layers);
  sb.triggerEvent('onBattleStart');
  assert.equal(JSON.stringify(s.layers), before, '特质授予不应直接改层数');
  assert.ok(s.logs.some((l) => l.text.includes('已授予 1 个特质')), '应提示只授予特质');
});

ok('报表按盟约来源显示实际贡献与上限构成（R2 精准 48）', () => {
  const code = 'GSPS1.8TEiIiIiIiIQAAMiIgCKIgiAESI4AAAAMGADsKKwAZZhABzaXwzQA2SuGWAG2RgRoA3yOGIAHGGRAgA6TWGNAHUDGQ0ChLCQXAAAAABGXwEHAAAAAADB';
  const res = ctx.window.SandboxCode.decode(code, ctx.window.GSPA_DATA);
  assert.ok(res && res.snapshot);
  assert.ok(sb.applySandboxSnapshot(res.snapshot, res.warnings));
  const s = sb.state();
  s.phase = 'combat';
  sb.handleEvent('battleCap');
  sb.handleEvent('battleEnd');
  const rep = s.lastReport;
  const row = rep.rows.find((r) => r.bond === '精准');
  assert.ok(row, '应有精准行');
  assert.equal(row.total, 48, '精准总计应为 19+15+14=48（实际 ' + row.total + '）');
  assert.equal(row.sources.length, 3);
  const hh = row.sources.find((x) => x.name === '霍尔海雅');
  const bk = row.sources.find((x) => x.name === '黑键');
  const hf = row.sources.find((x) => x.name === '华法琳');
  assert.ok(hh && bk && hf);
  assert.deepEqual([hh.amount, bk.amount, hf.amount], [19, 15, 14]);
  function bonus(s, src) { return (s.bonuses.find((b) => b.source === src) || {}).amount || 0; }
  assert.equal(hh.base, 12); assert.equal(bonus(hh, '薇薇安娜'), 7);
  assert.equal(bk.base, 8); assert.equal(bonus(bk, '薇薇安娜'), 7);
  assert.equal(hf.base, 7); assert.equal(bonus(hf, '薇薇安娜'), 7);
  const html = nodes.get('reportBody').innerHTML;
  assert.ok(html.includes('<b>+48</b>'), '应显示精准总层数 +48');
  assert.ok(html.includes('霍尔海雅 <b>+19</b>（12+7）'), '霍尔海雅应显示薇薇安娜加成（12+7）');
  assert.ok(html.includes('黑键 <b>+15</b>（8+7）'), '黑键应显示（8+7）');
  assert.ok(html.includes('华法琳 <b>+14</b>（7+7）'), '华法琳应显示薇薇安娜加成（7+7）');
  assert.ok(!html.includes('干员叠层'), '不再显示额外的干员叠层区块');
});

ok('新增 M3 后报表自动出现 Mon3tr 分项（不写死干员名）', () => {
  const code = 'GSPS1.8TEiIiIiIiIQAAMiIgCKIgiAESI4AAAAMGADsKKwAZZhABzaXwzQA2SuGWAG2RgRoA3yOGIAHGGRAgA6TWGNAHUDGQ0ChLCQXAAAAABGXwEHAAAAAADB';
  const res = ctx.window.SandboxCode.decode(code, ctx.window.GSPA_DATA);
  assert.ok(res && res.snapshot);
  assert.ok(sb.applySandboxSnapshot(res.snapshot, res.warnings));
  const s = sb.state();
  s.board.push({ uid: s.uid++, name: 'Mon3tr', elite: false, r: 1, c: 4, dir: 'right' });
  s.phase = 'combat';
  sb.handleEvent('battleCap');
  sb.handleEvent('battleEnd');
  const row = s.lastReport.rows.find((r) => r.bond === '精准');
  const bk = row.sources.find((x) => x.name === '黑键');
  const m3 = bk.bonuses.find((b) => b.source === 'Mon3tr');
  const vivi = bk.bonuses.find((b) => b.source === '薇薇安娜');
  assert.ok(m3 && m3.amount > 0, '黑键的上限构成里应自动出现 Mon3tr');
  assert.ok(vivi && vivi.amount === 7, '仍应保留薇薇安娜 +7');
  const html = nodes.get('reportBody').innerHTML;
  assert.ok(html.includes('黑键 <b>+' + bk.amount + '</b>'), '应按实际值显示黑键');
  assert.ok(html.includes('（8+' + m3.amount + '+7）'), '应按 base+M3+薇薇安娜 顺序显示（8+' + m3.amount + '+7）');
});

ok('无光环时报表来源不显示多余括号（精准 27）', () => {
  const code = 'GSPS1.8TEiIiIiIiIQAAMiIgCKIgiAESI4AAAAMGADsKKwAZZhABzaXwzQA2SuGWAG2RgRoA3yOGIAHGGRAgA6TWGNAHUDGQ0ChLCQXAAAAABGXwEHAAAAAADB';
  const res = ctx.window.SandboxCode.decode(code, ctx.window.GSPA_DATA);
  assert.ok(res && res.snapshot);
  assert.ok(sb.applySandboxSnapshot(res.snapshot, res.warnings));
  const s = sb.state();
  s.board = s.board.filter((o) => o.name !== '薇薇安娜'); // 模拟 R1 无薇薇安娜/无 M3 的状态
  s.phase = 'combat';
  sb.handleEvent('battleCap');
  sb.handleEvent('battleEnd');
  const row = s.lastReport.rows.find((r) => r.bond === '精准');
  assert.ok(row);
  assert.equal(row.total, 27);
  const html = nodes.get('reportBody').innerHTML;
  assert.ok(html.includes('霍尔海雅 <b>+12</b>'), '无光环时霍尔海雅应显示 +12');
  assert.ok(html.includes('黑键 <b>+8</b>'), '无光环时黑键应显示 +8');
  assert.ok(html.includes('华法琳 <b>+7</b>'), '无光环时华法琳应显示 +7');
  assert.ok(!html.includes('黑键 <b>+8</b>（'), '无光环且已补满时不应显示括号');
});

ok('阿米娅（医疗形态）的额外层数改为规则字段，不再写死名字', () => {
  const s = reset();
  addBoard('阿米娅（医疗形态）', false, 0, 0, 'right');
  const target = addBoard('灰喉', false, 0, 1, 'right');
  const rule = sb.rulesFor('灰喉').find((r) => r.event === 'onGain' && !r.elite);
  sb.applyRule(target, rule, { op: target });
  assert.equal(layer('精准'), 3, '灰喉自身 +2 + 阿米娅光环 +1 = 3（实际 ' + layer('精准') + '）');
});

ok('反馈对象包含日志、沙盒码和当前状态摘要', () => {
  const s = reset();
  s.phase = 'prep';
  s.prepStarted = true;
  addBoard('灰喉', false, 0, 0, 'right');
  s.logs.unshift({ round: 1, kind: 'event', text: '测试日志' });
  const fb = sb.buildFeedbackObject();
  assert.equal(fb.type, 'gspa-sandbox-feedback');
  assert.match(fb.sandboxCode, /^GSPS1\./);
  assert.ok(fb.logs.some((l) => l.text === '测试日志'));
  assert.ok(fb.state.board.length === 1);
  const text = sb.buildFeedbackText();
  assert.ok(text.includes('测试日志'));
  assert.ok(text.includes('GSPS1.'));
});

ok('盟约状态类：未激活 / 激活 / 强化分色', () => {
  reset();
  ['慕斯', 'Miss.Christine', '哈洛德', '水灯心', '凯瑟琳', '涤火杰西卡', '灰喉', '雪猎']
    .forEach((n, i) => addBoard(n, false, 1, i, 'right'));
  sb.renderAll();
  const html = nodes.get('bondStrip').innerHTML;
  assert.ok(html.includes('class="bond-chip empowered" data-bond="维多利亚"'), '维多利亚应使用强化类');
  assert.ok(html.includes('class="bond-chip active" data-bond="精准"'), '精准应使用激活类');
  assert.ok(/class="bond-chip (near|inactive)" data-bond="炎"/.test(html), '炎应使用未激活 / 待激活类');
  assert.ok(!/class="bond-chip active" data-bond="维多利亚"/.test(html), '强化不应与激活共用类');
});

ok('盟约弹层：当前数值代入层数（阿戈尔基础值 +35%）', () => {
  const s = reset();
  s.layers['阿戈尔'] = 18;
  const html = sb.bondPopHtml('阿戈尔');
  assert.ok(html.includes('+53%（35%+1%×18）'), '18 层应显示 +53%（实际：' + html + '）');
  s.layers['阿戈尔'] = 0;
  const html0 = sb.bondPopHtml('阿戈尔');
  assert.ok(html0.includes('+35%（35%+1%×0）'), '0 层也应显示基础值（实际：' + html0 + '）');
});

ok('StackCore：账本 add/封顶/事件字段可独立复用', () => {
  const core = ctx.window.StackCore;
  const led = core.createLedger();
  assert.equal(led.add('阿戈尔', 3, 'test', { kind: 'bond:devour', tier: 3 }), 3);
  assert.equal(led.add('阿戈尔', 2, 'test'), 2);
  assert.equal(led.get('阿戈尔'), 5);
  assert.equal(led.events[0].kind, 'bond:devour');
  assert.equal(led.events[0].tier, 3);
  const led2 = core.createLedger({ maxLayers: 2 });
  assert.equal(led2.add('炎', 5, 'test'), 2);
  assert.equal(led2.get('炎'), 2);
  const bus = core.createEventBus();
  const order = [];
  bus.on('x', () => order.push('low'), { priority: 0 });
  bus.on('x', () => order.push('high'), { priority: 10 });
  bus.on('x', () => order.push('once'), { once: true });
  bus.emit('x', {});
  bus.emit('x', {});
  assert.deepEqual(order, ['high', 'low', 'once', 'high', 'low']);
});

ok('阿戈尔：战斗开始链式吞噬，按等阶加层且同一目标只加一次', () => {
  const s = reset();
  s.phase = 'combat';
  const a = addBoard('幽灵鲨', false, 0, 0, 'right');
  addBoard('安哲拉', false, 0, 1, 'right');
  addBoard('深巡', false, 0, 2, 'right');
  const f = addBoard('灰喉', false, 0, 3, 'right');
  const tier = (name) => ctx.window.GSPA_DATA.operators.find((o) => o.name === name).tier;
  const plan = sb.planEgirDevour();
  assert.equal(plan.members.length, 3, '应有 3 名阿戈尔发起吞噬');
  const gains = sb.applyEgirDevour();
  const expected = tier('安哲拉') + tier('深巡') + tier('灰喉');
  assert.equal(layer('阿戈尔'), expected, '链式目标应按等阶各加一次（实际 ' + layer('阿戈尔') + '）');
  assert.equal(gains, expected);
  assert.equal(s.stackEvents.filter((e) => e.kind === 'bond:devour').length, 3, '同一目标不应产生重复层数事件');
  assert.equal(sb.applyEgirDevour(), 0, '同一场战斗不应重复吞噬');
  assert.equal(s.egirStarted, true);
  assert.ok(!s.logs.some((l) => l.text.includes('立刻复活')), '3 名阿戈尔不应触发 6 人复活');
});

ok('阿戈尔：递归吞噬按前一名干员归属，叠层单独标注', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('安哲拉', false, 0, 0, 'right');
  addBoard('克莱门莎', false, 0, 1, 'right');
  addBoard('深巡', false, 0, 2, 'right');
  addBoard('灰喉', false, 0, 3, 'right');
  const plan = sb.planEgirDevour();
  assert.equal(plan.marks.map((m) => m.from.name).join(','), '安哲拉,克莱门莎,深巡');
  assert.equal(plan.marks.map((m) => m.to.name).join(','), '克莱门莎,深巡,灰喉');
  sb.applyEgirDevour();
  const ev = s.stackEvents.filter((e) => e.kind === 'bond:devour');
  assert.equal(ev.length, 3, '每个目标只应产生一条吞噬层事件');
  ev.forEach((e) => assert.equal(e.op, '阿戈尔吞噬', '吞噬层不应记在干员头上'));
  [
    '阿戈尔吞噬 · 安哲拉 → 克莱门莎',
    '阿戈尔吞噬 · 克莱门莎 → 深巡',
    '阿戈尔吞噬 · 深巡 → 灰喉'
  ].forEach((needle, i) => {
    assert.ok(ev[i].source.includes(needle), '第 ' + (i + 1) + ' 段应由前一名干员发起：' + ev[i].source);
  });
  s.phase = 'combat';
  sb.handleEvent('battleEnd');
  const row = s.lastReport.rows.find((r) => r.bond === '阿戈尔');
  assert.ok(row, '报表应有阿戈尔行');
  assert.ok(row.sources.some((src) => src.name === '阿戈尔吞噬'), '吞噬层应单独标注为「阿戈尔吞噬」');
  assert.ok(!row.sources.some((src) => src.name === '安哲拉'), '吞噬层不应记在安哲拉头上');
});

ok('阿戈尔：相互吞噬时更靠左的干员优先', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('安哲拉', false, 0, 0, 'right');
  addBoard('克莱门莎', false, 0, 1, 'left');
  addBoard('深巡', false, 2, 0, 'right'); // 凑满 3 人激活，且身前一格为空
  const plan = sb.planEgirDevour();
  assert.equal(plan.marks.length, 1, '相互吞噬只结算一次');
  assert.equal(plan.marks[0].from.name, '安哲拉', '更靠左的安哲拉先发起');
  assert.equal(plan.marks[0].to.name, '克莱门莎');
  assert.equal(sb.applyEgirDevour(), 6, '克莱门莎 VI 阶应 +6');
});

ok('阿戈尔：战斗开始击倒身前干员，6 名时前 3 名阿戈尔立刻复活', () => {
  const s = reset();
  s.phase = 'combat';
  const names = ['幽灵鲨', '安哲拉', '深巡', '斯卡蒂', '歌蕾蒂娅', '水月'];
  names.forEach((n, i) => addBoard(n, false, 0, i, 'right'));
  const tier = (name) => ctx.window.GSPA_DATA.operators.find((o) => o.name === name).tier;
  const expected = names.slice(1).reduce((sum, n) => sum + tier(n), 0);
  const gains = sb.applyEgirDevour();
  assert.equal(layer('阿戈尔'), expected, '6 名链式吞噬应按目标等阶加层（实际 ' + layer('阿戈尔') + '）');
  assert.equal(gains, expected);
  assert.equal(s.board.length, 6, '沙盒不把被击倒单位移出棋盘');
  assert.ok(s.logs.some((l) => l.text.includes('击倒')), '应记录击倒');
  const reviveLog = s.logs.find((l) => l.text.includes('立刻复活'));
  assert.ok(reviveLog, '6 名不同阿戈尔应触发复活');
  ['安哲拉', '深巡', '斯卡蒂'].forEach((n) => {
    assert.ok(reviveLog.text.includes(n), '复活名单应包含 ' + n);
  });
  assert.ok(!reviveLog.text.includes('歌蕾蒂娅'), '第 4 名被击倒的阿戈尔不应复活');
  assert.ok(!reviveLog.text.includes('水月'), '第 5 名被击倒的阿戈尔不应复活');
});

ok('阿戈尔反馈码：战斗开始吞噬 5 名、+17 层，前 3 名阿戈尔复活', () => {
  const code = 'GSPS1.8TCvAAABsvB3cBqvB3cBq4AqqAMEADgBp-DFgDVAQIsAa40CFgDZJ4AgAbZpAGADdKABAAbwEEBIAAAAAAAAAAAAzw';
  const res = ctx.window.SandboxCode.decode(code, ctx.window.GSPA_DATA);
  assert.ok(res && res.snapshot);
  assert.ok(sb.applySandboxSnapshot(res.snapshot, res.warnings));
  const s = sb.state();
  s.phase = 'combat';
  s.egirStarted = false;
  const gains = sb.applyEgirDevour();
  assert.equal(gains, 17, '反馈码应吞噬 5 名、+17 层（实际 ' + gains + '）');
  assert.equal(s.board.length, 6, '沙盒不移除被击倒单位');
  const reviveLog = s.logs.find((l) => l.text.includes('立刻复活'));
  assert.ok(reviveLog, '6 名阿戈尔应触发复活');
  ['深巡', '幽灵鲨', '归溟幽灵鲨'].forEach((n) => {
    assert.ok(reviveLog.text.includes(n), '复活名单应包含 ' + n);
  });
});

ok('战斗开始幂等：重复 beginBattle 不重复触发烈夏临时层', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('烈夏', false, 0, 0, 'right');
  addBoard('折桠', false, 0, 1, 'right');
  addBoard('赫拉格', false, 0, 2, 'right');
  s.battleStartDone = false;
  s.egirStarted = false;
  sb.beginBattle();
  const first = s.temp['乌萨斯'] || 0;
  assert.ok(first >= 4, '烈夏应至少 +4 临时层（实际 ' + first + '）');
  sb.beginBattle();
  assert.equal(s.temp['乌萨斯'] || 0, first, '重复 beginBattle 不应再次加层');
  assert.equal(s.battleStartDone, true);
});

ok('助力：休整期结束给所有已激活盟约 +4（3 名强化）', () => {
  const s = reset();
  s.phase = 'prep';
  addBoard('野鬃', false, 0, 0, 'right');
  addBoard('安哲拉', false, 0, 1, 'right');
  addBoard('夏栎', false, 0, 2, 'right');
  const row = sb.getEval().rows.find((r) => r.name === '助力');
  assert.equal(row.state, 'empowered', '3 名助力应强化');
  sb.applyDeputLayers();
  assert.equal(layer('助力'), 4, '强化助力应 +4（实际 ' + layer('助力') + '）');
});

ok('售价：默认 1，温蒂 3/6；旅骨/棘刺读售出价', () => {
  const core = ctx.window.StackCore;
  assert.equal(core.sellPriceOf('灰喉'), 1);
  assert.equal(core.sellPriceOf('温蒂'), 3);
  assert.equal(core.sellPriceOf('温蒂', { elite: true }), 6);
  const s = reset();
  s.phase = 'prep';
  addBoard('棘刺', true, 0, 0, 'right');
  addBoard('蓝毒', false, 0, 1, 'right');
  addBoard('温蒂', false, 0, 2, 'right');
  s.prepStarted = true;
  sb.handleEvent('prepEnd');
  const sum = s.board.reduce((n, o) => n + core.sellPriceOf(o.name, { elite: !!o.elite }), 0);
  assert.equal(layer('伊比利亚'), Math.min(24, sum * 2), '棘刺精英按售出价 2 倍（sum=' + sum + '）');
});

ok('事件修正：远牙 onKill、耀骑士/归溟/风丸/历阵 onKnockdown', () => {
  assert.equal(sb.rulesFor('远牙')[0].event, 'onKill');
  ['耀骑士临光', '归溟幽灵鲨', '风丸', '历阵锐枪芬'].forEach((n) => {
    assert.ok(sb.rulesFor(n).every((r) => r.event !== 'onKill' || r.special), n + ' 不应再误用 onKill');
    assert.ok(sb.rulesFor(n).some((r) => r.event === 'onKnockdown'), n + ' 应改为 onKnockdown');
  });
});

ok('报表时点：吞噬层归作战期，不混入休整期报表', () => {
  const s = reset();
  s.phase = 'prep';
  s.prepStarted = true;
  addBoard('幽灵鲨', false, 0, 0, 'right');
  addBoard('安哲拉', false, 0, 1, 'right');
  addBoard('深巡', false, 0, 2, 'right');
  sb.handleEvent('prepEnd');
  assert.ok(layer('阿戈尔') > 0, '战斗开始应已吞噬');
  assert.ok(!s.lastReport.rows.some((r) => r.bond === '阿戈尔'), '休整期报表不应包含吞噬层');
  sb.handleEvent('battleEnd');
  assert.ok(s.lastReport.rows.some((r) => r.bond === '阿戈尔'), '作战期报表应包含吞噬层');
});

ok('convert 封顶时不吞临时层', () => {
  const s = reset();
  const op = addBoard('折桠', false, 0, 0, 'right');
  s.layers['乌萨斯'] = 999;
  s.temp['乌萨斯'] = 5;
  const n = sb.applyRule(op, { event: 'onPrepStart', convert: { bond: '乌萨斯', amount: 2 } }, { op: op });
  assert.equal(n, 0);
  assert.equal(s.temp['乌萨斯'], 5, '不可把临时层先扣掉再失败');
  assert.equal(layer('乌萨斯'), 999);
});

ok('battleEnd 清空每场特质，retreat 也清理来源', () => {
  let s = reset();
  s.phase = 'combat';
  const target = addBoard('灰喉', false, 0, 1, 'right');
  addBoard('华法琳', false, 0, 0, 'right');
  sb.triggerEvent('onBattleStart');
  assert.equal(s.grantedTraits.length, 1);
  sb.handleEvent('battleEnd');
  assert.equal(s.grantedTraits.length, 0, 'battleEnd 应清理每场特质');

  s = reset();
  s.phase = 'prep';
  addBoard('华法琳', false, 0, 0, 'right');
  addBoard('灰喉', false, 0, 1, 'right');
  sb.triggerEvent('onBattleStart');
  assert.equal(s.grantedTraits.length, 1);
  s.selectedOp = s.board[0].uid;
  sb.retreat(s.board[0].uid);
  assert.equal(s.grantedTraits.length, 0, '撤退来源也应清理特质');
});

ok('沙盒码快照保留战斗开始标记，导入后不重复吞噬', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('幽灵鲨', false, 0, 0, 'right');
  addBoard('安哲拉', false, 0, 1, 'right');
  addBoard('深巡', false, 0, 2, 'right');
  sb.beginBattle();
  const before = layer('阿戈尔');
  assert.ok(before > 0);
  const snap = sb.buildSandboxSnapshot();
  sb.reset();
  assert.equal(sb.applySandboxSnapshot(snap), true);
  assert.equal(st().battleStartDone, true);
  assert.equal(st().egirStarted, true);
  assert.equal(sb.applyEgirDevour(), 0, '导入后不应再次吞噬');
  assert.equal(layer('阿戈尔'), before);
});

ok('特殊上限：初雪按每回合 16 层补满，且重复补不叠加', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('初雪', false, 0, 0, 'right');
  addBoard('银灰', false, 0, 1, 'right');
  addBoard('灵知', false, 0, 2, 'right');
  s.layers['谢拉格'] = 0;
  const first = sb.applySpecialBattleCaps();
  assert.equal(first, 16, '初雪普通应补到 16（实际 ' + first + '）');
  assert.equal(layer('谢拉格'), 16);
  assert.equal(sb.applySpecialBattleCaps(), 0, '重复补满不应再叠加');
});

ok('特殊上限：浊心斯卡蒂按每场 20 层补满', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('浊心斯卡蒂', false, 0, 0, 'right');
  addBoard('幽灵鲨', false, 0, 1, 'right');
  addBoard('深巡', false, 0, 2, 'right');
  s.layers['阿戈尔'] = 0;
  assert.equal(sb.applySpecialBattleCaps(), 20, '浊心斯卡蒂普通应补到 20');
  assert.equal(layer('阿戈尔'), 20);
});

ok('补满叠层按钮包含特殊上限', () => {
  const s = reset();
  s.phase = 'combat';
  addBoard('初雪', false, 0, 0, 'right');
  addBoard('灵知', false, 0, 1, 'right');
  addBoard('极光', false, 0, 2, 'right');
  s.layers['谢拉格'] = 0;
  sb.handleEvent('battleCap');
  assert.ok(layer('谢拉格') >= 16, '一键补满应包含初雪的特殊上限（实际 ' + layer('谢拉格') + '）');
  assert.ok(s.logs.some((l) => l.text.includes('特殊上限补满')), '应记录特殊上限补满');
});

ok('载入规程预设：尺寸、地形、预设编号同步，且清空场上干员', () => {
  const p = ctx.window.GSPA_MAPS.maps.find(function (x) { return x.id === '01-2'; });
  assert.ok(p, '预设 01-2 存在');
  assert.equal(p.hidden, true, '场地二在图库中隐藏');
  assert.ok(p.tiles.some(function (row) { return row.indexOf('highSpecial') >= 0; }), '边界高台应映射为特殊高台');
  const s = reset();
  s.board.push({ uid: 1, name: '幽灵鲨', elite: false, r: 0, c: 0, dir: 'right' });
  assert.equal(sb.applyPreset(p, { force: true }), true);
  const info = sb.mapInfo();
  assert.equal(info.w, p.w);
  assert.equal(info.h, p.h);
  assert.equal(info.preset, '01-2');
  assert.deepEqual(info.map[0], p.tiles[0]);
  assert.equal(st().board.length, 0, '切换战场应清空场上干员');
  // 还原默认空白 9×5，避免影响其它用例
  assert.equal(sb.applyPreset({ id: '', title: '空白训练场', w: 9, h: 5, tiles: Array.from({ length: 5 }, function () { return Array(9).fill('ground'); }) }, { force: true }), true);
});

ok('场地一已裁掉 UI：9×4、2 个侵入点，沙盒码往返不截断', () => {
  const p = ctx.window.GSPA_MAPS.maps.find(function (x) { return x.id === '01-1'; });
  assert.equal(p.w, 9);
  assert.equal(p.h, 4);
  assert.equal(p.spawns.length, 2);
  assert.equal(p.goals.length, 1);
  assert.equal(p.boxes.length, 3, '01-1 场地上的箱子');
  assert.equal(p.tiles.reduce(function (n, row) { return n + row.filter(function (t) { return t === 'box'; }).length; }, 0), 0, '箱子不再替换地形');
  sb.applyPreset(p, { force: true });
  assert.equal(sb.mapInfo().boxes.length, 3, '箱子作为独立图层载入沙盘');
  const code = sb.makeSandboxCode();
  assert.ok(/^GSPS1\./.test(code), '生成 GSPS1 码');
  sb.reset();
  assert.equal(sb.importSandboxCode(code), true);
  const imported = sb.mapInfo();
  assert.equal(imported.w, 9);
  assert.equal(imported.h, 4);
  assert.deepEqual(imported.map[0], p.tiles[0]);
  sb.applyPreset({ id: '', title: '空白训练场', w: 9, h: 5, tiles: Array.from({ length: 5 }, function () { return Array(9).fill('ground'); }) }, { force: true });
});

ok('场地三：17×5，保留 r12 传送点、没有侵入点', () => {
  const p = ctx.window.GSPA_MAPS.maps.find(function (x) { return x.id === '12-3'; });
  assert.equal(p.w, 17);
  assert.equal(p.h, 5);
  assert.equal(p.spawns.length, 0);
  assert.equal(p.goals.length, 2);
  const last = p.tiles[p.h - 1];
  assert.equal(last.filter(function (t) { return t === 'telin' || t === 'telout'; }).length, 2, '末行保留 2 个传送点');
  sb.applyPreset(p, { force: true });
  const code = sb.makeSandboxCode();
  sb.reset();
  assert.equal(sb.importSandboxCode(code), true);
  assert.equal(sb.mapInfo().w, 17);
  assert.equal(sb.mapInfo().h, 5);
  sb.applyPreset({ id: '', title: '空白训练场', w: 9, h: 5, tiles: Array.from({ length: 5 }, function () { return Array(9).fill('ground'); }) }, { force: true });
});

console.log('\n' + passed + ' 项通过' + (process.exitCode ? '，存在失败' : ''));
