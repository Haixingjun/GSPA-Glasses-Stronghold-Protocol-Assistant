/**
 * 特殊干员回归：深链详情、搜索别名、策略 ↔ 干员双向跳转的 DOM 输出。
 *
 *   node tools/test_special.mjs
 *
 * 和 smoke_team.mjs 一样用最小 DOM 桩，不依赖浏览器。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

function makeEl(id) {
  const el = {
    id, innerHTML: '', textContent: '', value: '', hidden: false, className: '',
    title: '', href: '', style: {}, dataset: {}, offsetWidth: 1, offsetHeight: 1,
    children: [],
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); return on; }
    },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k] === undefined ? null : this[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this, k) && this[k] != null; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    cloneNode() { return makeEl(this.id); },
    setPointerCapture() {}, focus() {}, blur() {}, scrollIntoView() {},
    setSelectionRange() {}, select() {}, insertBefore() {}
  };
  return el;
}

const nodes = new Map();
const doc = {
  readyState: 'complete', title: '', documentElement: makeEl('html'), body: makeEl('body'),
  getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeEl(id)); return nodes.get(id); },
  querySelector() { return null; }, querySelectorAll() { return []; },
  createElement(tag) { return makeEl(tag); },
  addEventListener() {}, removeEventListener() {}, execCommand() { return true; }
};

const store = new Map();
const win = globalThis;
win.window = win;
win.document = doc;
win.location = {
  hash: '#/op/' + encodeURIComponent('“暴躁铁皮”'),
  href: 'http://localhost/#' + encodeURIComponent('“暴躁铁皮”'),
  pathname: '/', search: ''
};
win.history = {
  replaceState(_a, _b, url) { if (url) win.location.hash = url; },
  pushState(_a, _b, url) { if (url) win.location.hash = url; }
};
win.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
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

for (const f of ['store.js', 'search.js', 'calc.js', 'code.js', 'ui.js', 'app.js']) {
  new Function(fs.readFileSync(new URL('../web/js/' + f, import.meta.url), 'utf8'))();
}

const { Store, UI } = win;
const drawer = doc.getElementById('drawer');
const cards = doc.getElementById('cards');
const results = [];
function check(name, fn) {
  try { fn(); results.push(['ok', name]); }
  catch (e) { results.push(['FAIL', name + ' — ' + e.message]); }
}

check('特殊干员深链：打开详情并渲染 PRTS 档案', () => {
  assert.equal(Store.state.view, 'op');
  assert.equal(Store.state.sel, '“暴躁铁皮”');
  assert.match(drawer.innerHTML, /干员档案（PRTS）/);
  assert.match(drawer.innerHTML, /大丑的愤怒/);
  assert.match(drawer.innerHTML, /荒蛮之心/);
  assert.match(drawer.innerHTML, /版本说明/);
  assert.match(drawer.innerHTML, /6★/);
  assert.match(drawer.innerHTML, /Pith/); // 版本对照里应提到跨版本
});

check('特殊干员卡片：带「特殊干员」徽标与别名', () => {
  assert.match(cards.innerHTML, /pill-special/);
  assert.match(cards.innerHTML, /森蚺/);
  assert.match(cards.innerHTML, /由策略「暴躁铁皮」召唤/);
});

check('盟约·辅助干员深链：4★ 辅助/巫役 + 版本说明', () => {
  Store.set({ view: 'op', sel: '盟约·辅助干员', hidden: true, q: '' });
  assert.match(drawer.innerHTML, /4★/);
  assert.match(drawer.innerHTML, /辅助 \/ 巫役/);
  assert.match(drawer.innerHTML, /战术咏唱·双型/);
  assert.match(drawer.innerHTML, /2025-11-14/);
  assert.match(drawer.innerHTML, /Pith/);
});

check('默认列表仍是 153 条，不把隐藏条目塞进首屏', () => {
  Store.set({ sel: null, q: '', hidden: false });
  assert.equal(UI.getList().length, 153);
});

check('搜索「优等生」能命中「盟约·辅助干员」', () => {
  Store.set({ q: '优等生', sel: null, hidden: false });
  const list = UI.getList();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, '盟约·辅助干员');
});

check('搜索「Pith」/「森冉」也能命中（别名 + 易错字）', () => {
  Store.set({ q: 'Pith', sel: null, hidden: false });
  assert.equal(UI.getList()[0].name, '盟约·辅助干员');
  Store.set({ q: '森冉', sel: null, hidden: false });
  assert.equal(UI.getList()[0].name, '“暴躁铁皮”');
});

check('策略「优等生」详情出现召唤干员入口', () => {
  Store.set({ view: 'strategy', sel: 'Pith/优等生', q: '', hidden: false });
  assert.match(drawer.innerHTML, /召唤的特殊干员/);
  assert.match(drawer.innerHTML, /data-op="盟约·辅助干员"/);
  assert.match(drawer.innerHTML, /策略发起人/);
});

check('策略「森蚺/暴躁铁皮」详情出现召唤干员入口', () => {
  Store.set({ view: 'strategy', sel: '森蚺/暴躁铁皮', q: '', hidden: false });
  assert.match(drawer.innerHTML, /召唤的特殊干员/);
  assert.match(drawer.innerHTML, /data-op="“暴躁铁皮”"/);
});

check('Touch/外勤医疗：固定添加单位单列说明，不混入特殊干员', () => {
  Store.set({ view: 'strategy', sel: 'Touch/外勤医疗', q: '', hidden: false });
  assert.match(drawer.innerHTML, /固定添加的专属干员（非本期特殊干员）/);
  assert.match(drawer.innerHTML, /预备干员-医疗/);
  assert.match(drawer.innerHTML, /Touch/);
  assert.match(drawer.innerHTML, /prts\.wiki/);
  assert.match(drawer.innerHTML, /未计入本期 155 条干员表/);
  const st = Store.entity('strategy', 'Touch/外勤医疗');
  assert.equal(st.fixedUnits.units.length, 2);
  assert.equal(st.specialOperator, undefined);
});

check('从策略跳干员会顺带打开 hidden，列表里能找到卡片', () => {
  Store.set({ view: 'op', sel: '盟约·辅助干员', hidden: true, q: '' });
  assert.equal(Store.state.hidden, true);
  assert.ok(UI.getList().some((o) => o.name === '盟约·辅助干员'));
  assert.match(cards.innerHTML, /is-active/);
});

let fail = 0;
for (const [state, name] of results) {
  if (state === 'FAIL') fail++;
  console.log(state.padEnd(4), name);
}
if (process.env.DUMP) {
  Store.set({ view: 'op', sel: '“暴躁铁皮”', hidden: true, q: '' });
  fs.writeFileSync(new URL('../build/special_detail.html', import.meta.url), drawer.innerHTML);
  Store.set({ view: 'op', sel: '盟约·辅助干员', hidden: true, q: '' });
  fs.writeFileSync(new URL('../build/special_detail2.html', import.meta.url), drawer.innerHTML);
}
console.log('\n' + (results.length - fail) + ' / ' + results.length + ' 通过');
process.exit(fail ? 1 : 0);
