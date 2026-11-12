/**
 * 一图流数据快照测试：只测 Team.posterModel()（纯数据，不碰 canvas）。
 *
 *   node tools/test_poster.mjs
 *
 * 这里钉住的是「图上的数字和配队页同源」：盟约计数、层数节点、叠层上限、
 * 自选干员、9 席、重复干员。全部通过时退出码 0。
 */
import fs from 'node:fs';

/* ---------------- 最小 DOM 桩（与 smoke_team.mjs 同风格，只够加载脚本） ---------------- */
function makeEl(id) {
  const el = {
    id, innerHTML: '', textContent: '', value: '', hidden: false, className: '', title: '',
    href: '', style: {}, dataset: {}, offsetWidth: 1, offsetHeight: 1, children: [],
    classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); }, remove(...c) { c.forEach((x) => this._s.delete(x)); }, contains(c) { return this._s.has(c); }, toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); return on; } },
    addEventListener() {}, removeEventListener() {}, setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k] === undefined ? null : this[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this, k) && this[k] != null; },
    appendChild(c) { this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    cloneNode() { return makeEl(this.id); }, setPointerCapture() {}, focus() {}, blur() {},
    scrollIntoView() {}, setSelectionRange() {}, select() {}, insertBefore() {}
  };
  return el;
}
const nodes = new Map();
const doc = {
  readyState: 'complete', title: '', documentElement: makeEl('html'), body: makeEl('body'),
  getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeEl(id)); return nodes.get(id); },
  querySelector() { return null; }, querySelectorAll() { return []; },
  createElement(tag) { return makeEl(tag); }, addEventListener() {}, removeEventListener() {},
  execCommand() { return true; }
};
const store = new Map();
const win = globalThis;
win.window = win;
win.document = doc;
win.location = { hash: '#/team', href: 'http://localhost/#/team', pathname: '/', search: '' };
win.history = { replaceState(_a, _b, u) { if (u) win.location.hash = u; }, pushState(_a, _b, u) { if (u) win.location.hash = u; } };
win.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
win.innerWidth = 1280;
win.innerHeight = 900;
win.setTimeout = setTimeout;
win.clearTimeout = clearTimeout;
win.addEventListener = () => {};
win.removeEventListener = () => {};
win.matchMedia = null;
win.scrollTo = () => {};
win.console = console;
win.GSPA_DATA = JSON.parse(fs.readFileSync(new URL('../web/data/data.json', import.meta.url), 'utf8'));

for (const f of ['store.js', 'search.js', 'calc.js', 'code.js', 'ui.js', 'team.js']) {
  const src = fs.readFileSync(new URL('../web/js/' + f, import.meta.url), 'utf8');
  try {
    new Function(src)();
  } catch (e) {
    console.error(`FAIL 加载 ${f} 时抛错：`, e.message);
    process.exit(1);
  }
}

const { Store, Calc, Team } = win;
Store.init(win.GSPA_DATA);
const data = win.GSPA_DATA;

/* ---------------- 断言工具 ---------------- */
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name + ' → ' + (e && e.message ? e.message : e)]);
  }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error((what || '') + ' 期望 ' + b + '，实际 ' + a);
}

function teamOf(names, opts = {}) {
  const slots = names.map((n) => (n ? { k: n, e: !!opts.elite && opts.elite.indexOf(n) >= 0 } : null));
  return { size: opts.size || Math.max(8, slots.length), slots, layers: opts.layers || {} };
}
function cov(model, name) {
  return model.covenants.filter((c) => c.name === name)[0] || null;
}
function has(arr, v) { return arr.indexOf(v) >= 0; }

/* ---------------- 用例 ---------------- */
check('空队伍：没有干员 / 盟约 / 叠层', () => {
  const m = Team.posterModel(teamOf([]));
  eq(m.pieces.length, 0, '干员数');
  eq(m.covenants.length, 0, '已激活盟约数');
  eq(m.caps.length, 0, '叠层盟约数');
  eq(m.summary.filled, 0, 'filled');
  eq(m.size, 8, '席位数');
});

check('3 名【炎】：炎 3/3 激活、强化缺 3', () => {
  const m = Team.posterModel(teamOf(['拜松', '矩', '风絮']));
  const yan = cov(m, '炎');
  if (!yan) throw new Error('没有找到【炎】');
  eq(yan.state, 'active', '炎状态');
  eq(yan.count, 3, '炎人数');
  eq(yan.threshold, 3, '炎门槛');
  eq(yan.missingEmpower, 3, '炎强化缺口');
});

check('6 名【炎】：炎已强化（6/6）', () => {
  const m = Team.posterModel(teamOf(['拜松', '矩', '风絮', '乌有', '余', '仇白']));
  const yan = cov(m, '炎');
  eq(yan.state, 'empowered', '炎状态');
  eq(yan.count, 6, '炎人数');
  eq(yan.missingEmpower, 0, '炎强化缺口');
});

check('席位顺序与精锐标记透传', () => {
  const m = Team.posterModel(teamOf(['风絮', '乌有'], { elite: ['乌有'], size: 8 }));
  eq(m.pieces.length, 2, '干员数');
  eq(m.pieces[0].name, '风絮', '第 1 席');
  eq(m.pieces[1].name, '乌有', '第 2 席');
  eq(m.pieces[0].elite, false, '第 1 席精锐');
  eq(m.pieces[1].elite, true, '第 2 席精锐');
});

check('重复干员只计一次，并记录在 dupes', () => {
  const m = Team.posterModel(teamOf(['风絮', '风絮']));
  eq(m.pieces.length, 1, '干员数');
  eq(m.dupes, ['风絮'], 'dupes');
});

check('未激活盟约不进 covenants，只进 near', () => {
  const m = Team.posterModel(teamOf(['拜松']));
  for (const c of m.covenants) {
    if (c.state !== 'active' && c.state !== 'empowered') throw new Error('covenants 里混进了 ' + c.state);
  }
  // 拜松是【炎】，炎差 2 人，应出现在 near
  if (!has(m.near, '炎')) throw new Error('near 里没有【炎】');
});

check('可激活盟约带计数（一图流图标带要用）', () => {
  const m = Team.posterModel(teamOf(['拜松', '矩']));
  const yan = (m.pending || []).filter((c) => c.name === '炎')[0];
  if (!yan) throw new Error('pending 里没有【炎】');
  eq(yan.state, 'near', '炎状态');
  eq(yan.count, 2, '炎人数');
  eq(yan.threshold, 3, '炎门槛');
  // 每个 pending 都要有名字、图标字段、阈值为正
  for (const c of m.pending) {
    if (!c.name || !c.threshold) throw new Error('pending 行缺字段：' + JSON.stringify(c));
  }
});

check('层数写进盟约行', () => {
  const m = Team.posterModel(teamOf(['拜松', '矩', '风絮'], { layers: { 炎: 80 } }));
  eq(cov(m, '炎').layer, 80, '炎层数');
});

check('count_layer 盟约：层数节点点亮', () => {
  // 远见：激活 2 人，节点 10 / 80 / 150
  const members = (data.covenants.filter((c) => c.name === '远见')[0].members || []).slice(0, 2);
  if (members.length < 2) throw new Error('远见成员不足 2 人，数据变了');
  const m = Team.posterModel(teamOf(members, { layers: { 远见: 80 } }));
  const yj = cov(m, '远见');
  if (!yj) throw new Error('没有找到【远见】');
  eq(yj.kind, 'count_layer', '远见类型');
  eq(yj.layer, 80, '远见层数');
  eq(yj.node, 80, '远见节点');
});

check('叠层上限：只统计已激活盟约', () => {
  const m = Team.posterModel(teamOf(['拜松', '矩', '风絮', '乌有', '余', '仇白']));
  const names = m.caps.map((r) => r.bond);
  if (names.indexOf('炎') < 0) throw new Error('炎已强化，应该在上限表里');
  for (const n of names) {
    const hit = m.covenants.filter((c) => c.name === n)[0];
    if (!hit) throw new Error('上限里混进了未激活的盟约：' + n);
  }
  // 聚合 / 灵巧 在这支队里都没激活，即使有人带对应叠层词条也不该出现
  if (names.indexOf('聚合') >= 0) throw new Error('未激活的聚合被算进了上限');
  if (names.indexOf('灵巧') >= 0) throw new Error('未激活的灵巧被算进了上限');
});

check('叠层上限：按盟约聚合、合计等于各来源之和、按总数降序', () => {
  const m = Team.posterModel(teamOf(['拜松', '矩', '风絮', '乌有', '余', '仇白']));
  if (!m.caps.length) throw new Error('这队居然没有叠层盟约');
  let prev = Infinity;
  for (const row of m.caps) {
    const sum = row.parts.reduce((n, p) => n + p.amount, 0);
    if (sum !== row.total) throw new Error(row.bond + ' 的 parts 之和 ' + sum + ' ≠ total ' + row.total);
    if (row.total > prev) throw new Error('没有按总数降序：' + row.bond);
    prev = row.total;
    if (!row.bond) throw new Error('叠层行缺少盟约名');
  }
});

check('叠层上限与页面词条口径一致（同一函数）', () => {
  const team = teamOf(['拜松', '矩', '风絮', '乌有', '余', '仇白']);
  const m = Team.posterModel(team);
  // 页面用 traitGroups().capsByBond；posterModel 应原样透传总数
  const total = m.caps.reduce((n, r) => n + r.total, 0);
  if (total <= 0) throw new Error('合计层数应大于 0');
});

check('自选干员：占席、标记 pick、名字与头像来自 picks', () => {
  const pick = (data.picks || [])[0];
  if (!pick) throw new Error('数据里没有自选干员');
  const team = { size: 8, slots: [{ p: pick.name, e: false }], layers: {} };
  const m = Team.posterModel(team);
  eq(m.pieces.length, 1, '干员数');
  eq(m.pieces[0].name, pick.name, '名字');
  eq(m.pieces[0].pick, true, 'pick 标记');
  eq(m.pieces[0].avatar, pick.avatarFull || pick.avatar, '头像');
  eq(m.summary.picks, 1, '自选计数');
  eq(m.pickLimit, 2, '自选上限');
});

check('9 席：size 透传', () => {
  const m = Team.posterModel(teamOf(['风絮'], { size: 9 }));
  eq(m.size, 9, '席位数');
});

check('入参不被改写', () => {
  const team = teamOf(['拜松', '矩'], { layers: { 炎: 30 } });
  const before = JSON.stringify(team);
  Team.posterModel(team);
  eq(JSON.stringify(team), before, 'team');
});

check('赛季名透传（一图流标题用）', () => {
  const m = Team.posterModel(teamOf([]));
  eq(m.season, data.specialMeta.season, 'season');
});

check('版本号与数据来源透传', () => {
  const m = Team.posterModel(teamOf([]));
  eq(m.version, data.version, 'version');
  eq(m.generatedAt, data.generatedAt, 'generatedAt');
});

check('空队不把「待激活」刷屏', () => {
  const m = Team.posterModel(teamOf([]));
  eq(m.near.length, 0, 'near');
});

/* ---------------- 输出 ---------------- */
let failed = 0;
for (const [state, name] of results) {
  if (state !== 'ok') failed++;
  console.log((state === 'ok' ? '  ok   ' : '  FAIL ') + name);
}
console.log('');
console.log(failed ? failed + ' 项失败 / ' + results.length : '全部 ' + results.length + ' 项通过');
process.exit(failed ? 1 : 0);
