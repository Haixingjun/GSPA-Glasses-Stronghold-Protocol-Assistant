/**
 * 配队视图冒烟测试：用最小 DOM 桩在 Node 里跑完「data → store → calc → ui → team」整条链路。
 * 目的不是替代浏览器，而是抓运行时报错、URL 编解码错误、渲染分支与状态不同步。
 *
 *   node tools/smoke_team.mjs
 *
 * 输出：若干条 ok / FAIL，全部通过时退出码 0。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

/* ---------------- 最小 DOM 桩 ---------------- */
function makeEl(id) {
  const el = {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    className: '',
    title: '',
    href: '',
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
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    cloneNode() { return makeEl(this.id); },
    setPointerCapture() {},
    focus() {},
    blur() {},
    scrollIntoView() {},
    setSelectionRange() {},
    select() {},
    insertBefore() {}
  };
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

const store = new Map();
const win = globalThis;
win.window = win;
win.document = doc;
win.location = { hash: '#/team', href: 'http://localhost/#/team', pathname: '/', search: '' };
win.history = { replaceState(_a, _b, url) { if (url) win.location.hash = url; }, pushState(_a, _b, url) { if (url) win.location.hash = url; } };
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
win.confirm = () => true;
win.console = console;
win.GSPA_DATA = JSON.parse(fs.readFileSync(new URL('../web/data/data.json', import.meta.url), 'utf8'));

/* ---------------- 按页面顺序加载脚本 ---------------- */
const scripts = ['store.js', 'search.js', 'calc.js', 'code.js', 'ui.js', 'team.js', 'app.js'];
for (const f of scripts) {
  const src = fs.readFileSync(new URL('../web/js/' + f, import.meta.url), 'utf8');
  try {
    new Function(src)();
  } catch (e) {
    console.error(`FAIL 加载 ${f} 时抛错：`, e.message);
    process.exit(1);
  }
}

const { Store, Calc, Team } = win;
const cards = doc.getElementById('cards');
const sheet = doc.getElementById('sheet');
const results = [];

function check(name, fn) {
  try {
    fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name + ' — ' + e.message]);
  }
}

/* ---------------- 断言 ---------------- */
check('boot 后停在配队视图并完成渲染', () => {
  assert.equal(Store.state.view, 'team');
  assert.match(cards.innerHTML, /class="team"/);
  assert.match(cards.innerHTML, /tm-slots/);
});

check('默认 8 席 + 人事部文档按钮（第 9 席）', () => {
  const empty = cards.innerHTML.match(/slot slot-empty/g) || [];
  assert.equal(empty.length, 8, '空位应为 8 个，实际 ' + empty.length);
  assert.match(cards.innerHTML, /data-add-slot/);
  assert.match(cards.innerHTML, /人事部文档/);
});

check('26 个盟约全部渲染，初始无激活', () => {
  const tiles = cards.innerHTML.match(/class="cov is-/g) || [];
  assert.equal(tiles.length, 26);
  assert.doesNotMatch(cards.innerHTML, /cov is-active/);
});

check('加 3 个炎 → 炎激活且带发光态', () => {
  const cov = win.GSPA_DATA.covenants.find((c) => c.name === '炎');
  const team = Calc.emptyTeam(8);
  cov.members.slice(0, 3).forEach((n, i) => { team.slots[i] = { k: n, e: false }; });
  Store.setTeam(team);
  assert.match(cards.innerHTML, /cov is-active/);
  assert.match(cards.innerHTML, /已激活/);
  // 普通人数盟约也随层数成长（如炎的攻击力 +23+0.9×层数），所以也要给层数输入
  assert.match(cards.innerHTML, /data-layer="炎"/);
});

check('第 9 席：用人事部文档后出现 9 席，且不再显示加席按钮', () => {
  const team = Store.getTeam();
  const before = team.slots.filter(Boolean).length;
  team.size = 9;
  team.slots.push(null);
  Store.setTeam(team);
  assert.equal(Store.getTeam().size, 9);
  const empty = cards.innerHTML.match(/slot slot-empty/g) || [];
  assert.equal(empty.length, 9 - before);
  assert.doesNotMatch(cards.innerHTML, /data-add-slot/);
});

check('精锐：切换后界面立即重渲染，并点亮绝技（回归）', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { k: '拜松', e: false };
  team.slots[1] = { k: '乌有', e: false };
  Store.setTeam(team);
  const before = cards.innerHTML;

  const t2 = Store.getTeam();
  t2.slots[0].e = true;
  t2.slots[1].e = true;
  Store.setTeam(t2);

  assert.notEqual(cards.innerHTML, before, '界面没有重渲染');
  assert.match(cards.innerHTML, /slot-btn is-on/);
  assert.match(win.location.hash, /e=0,1/, 'URL 应带精锐位');
  const res = Calc.evaluate(Store.getTeam(), win.GSPA_DATA);
  assert.equal(res.rows.find((r) => r.name === '绝技').state, 'active');
});

check('装备：渲染装备格、转职标记，维多利亚 +1', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { k: '拜松', e: false, it: [{ k: '维式重锤', e: false }, { k: '变形同构体', e: false }] };
  Store.setTeam(team);
  assert.match(cards.innerHTML, /gear-chip/);
  assert.match(cards.innerHTML, /转职/);
  assert.match(cards.innerHTML, /维多利亚/);
  const res = Calc.evaluate(Store.getTeam(), win.GSPA_DATA);
  assert.equal(res.rows.find((r) => r.name === '维多利亚').count, 1);
});

check('变形同构体缺伙伴：出现手动选择与提示', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { k: '拜松', e: false, it: [{ k: '变形同构体', e: false }] };
  Store.setTeam(team);
  assert.match(cards.innerHTML, /data-morph="0"/);
  assert.match(cards.innerHTML, /变形同构体还缺/);

  const t2 = Store.getTeam();
  t2.slots[0].m = '维多利亚';
  Store.setTeam(t2);
  assert.doesNotMatch(cards.innerHTML, /data-morph="0"/);
  assert.match(cards.innerHTML, /转职/);
});

check('URL 往返：席位数、精锐、装备、转职、层数都能还原', () => {
  const team = Calc.emptyTeam(9);
  team.slots[0] = { k: '拜松', e: true, it: [{ k: '维式重锤', e: false }, { k: '变形同构体', e: false }], m: '维多利亚' };
  team.slots[7] = { k: '乌有', e: false };
  team.layers = { 远见: 80, 迅捷: 40 };
  Store.setTeam(team);

  const hash = win.location.hash;
  const parsed = Store.parseHash(hash);
  assert.equal(parsed.team.size, 9);
  assert.equal(parsed.team.slots[0].e, true);
  assert.deepEqual(parsed.team.slots[0].it, [{ k: '维式重锤', e: false }, { k: '变形同构体', e: false }]);
  assert.equal(parsed.team.slots[0].m, '维多利亚');
  assert.equal(parsed.team.slots[8], null);
  assert.equal(parsed.team.layers['远见'], 80);
  assert.match(hash, /bs=9/);
  assert.match(hash, /e=0/);
  assert.match(hash, /it=0:/);
  assert.match(hash, /m=0:/);
  assert.match(hash, /L=/);
});

check('空队伍 URL 不带 t=（避免脏链接）', () => {
  Store.setTeam(Calc.emptyTeam(8));
  assert.doesNotMatch(Store.buildUrl(Store.state), /[?&]t=/);
});

check('切到干员视图再切回来，队伍不丢', () => {
  const team = Store.getTeam();
  team.slots[0] = { k: '折桠', e: false };
  Store.setTeam(team);
  Store.switchView('op');
  assert.equal(Store.getTeam().slots[0].k, '折桠');
  Store.switchView('team');
  assert.match(cards.innerHTML, /折桠/);
});

check('未知干员名不会让整队失效', () => {
  const parsed = Store.parseHash('#/team?t=' + encodeURIComponent('不存在的干员') + ',' + encodeURIComponent('拜松'));
  assert.equal(parsed.team.slots[1].k, '拜松');
  Store.setTeam(parsed.team);
  assert.match(cards.innerHTML, /拜松/);
});

check('重复干员只计一次，并在界面提示', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { k: '拜松', e: false };
  team.slots[1] = { k: '拜松', e: false };
  Store.setTeam(team);
  assert.match(cards.innerHTML, /重复干员只计一次/);
  assert.equal(Calc.evaluate(Store.getTeam(), win.GSPA_DATA).summary.filled, 1);
});

check('调和：出现「调和 +1」，核心盟约人数 +1', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { k: '魔王', e: false };
  Store.setTeam(team);
  assert.match(cards.innerHTML, /调和 \+1/);
  assert.equal(Calc.evaluate(Store.getTeam(), win.GSPA_DATA).rows.find((r) => r.name === '炎').count, 1);
});

check('层数：输入后写进 URL，盟约块显示节点与层数', () => {
  Store.setTeam(Calc.emptyTeam(8));
  const st = Store.parseHash('#/team?L=' + encodeURIComponent('迅捷') + ':40');
  Store.setTeam(st.team);
  assert.equal(Store.getTeam().layers['迅捷'], 40);
  assert.match(win.location.hash, /L=/);
  assert.match(cards.innerHTML, /data-layer="迅捷"/);
  assert.match(cards.innerHTML, /cov-nodes/);
});

check('选人面板：搜索框、候选、筛选齐全，自选作为阶数 chip', () => {
  Team.openSheet(3, 'op', -1);
  assert.equal(sheet.hidden, false);
  assert.match(sheet.innerHTML, /id="pq"/);
  assert.match(sheet.innerHTML, /data-pick=/);
  assert.match(sheet.innerHTML, /chip-tag/);
  assert.match(sheet.innerHTML, /data-ptier="0"[^>]*>自选/);
  assert.match(sheet.innerHTML, /data-choose-pick=/);
  assert.doesNotMatch(sheet.innerHTML, /data-pick="自选配置/);
  // 连续添加开关默认打开
  assert.match(sheet.innerHTML, /data-batch-toggle/);
  assert.match(sheet.innerHTML, /data-batch-toggle aria-pressed="true"/);
  Team.closeSheet();
  assert.equal(sheet.hidden, true);
});

check('配队页有「批量添加」入口（未满时）', () => {
  Store.setTeam(Calc.emptyTeam(8));
  assert.match(cards.innerHTML, /data-batch-add/);
  const team = Calc.emptyTeam(8);
  for (let i = 0; i < 8; i++) team.slots[i] = { k: '拜松', e: false };
  // 同名会被去重，这里只验证「充满后入口消失」的渲染条件
  assert.equal(Calc.evaluate(team, win.GSPA_DATA).summary.filled, 1);
  team.slots = win.GSPA_DATA.operators.filter((o) => o.type !== '自选配置').slice(0, 8)
    .map((o) => ({ k: o.name, e: false }));
  Store.setTeam(team);
  assert.doesNotMatch(cards.innerHTML, /data-batch-add/);
});

check('装备面板：列出装备，替换时出现「卸下」', () => {
  Team.openSheet(0, 'item', -1);
  assert.match(sheet.innerHTML, /data-gear=/);
  assert.match(sheet.innerHTML, /搜索装备/);
  assert.doesNotMatch(sheet.innerHTML, /data-unequip/);

  Team.openSheet(0, 'item', 0);
  assert.match(sheet.innerHTML, /data-unequip/);
  Team.closeSheet();
});

check('装备面板：有阶数筛选、名称后不再带「N 阶」、每件有进阶开关', () => {
  Team.openSheet(0, 'item', -1);
  assert.match(sheet.innerHTML, /data-ptier="1"/);
  assert.match(sheet.innerHTML, /data-ptier="6"/);
  assert.doesNotMatch(sheet.innerHTML, /pick-tier/, '名称后不该再出现阶数标签');
  assert.match(sheet.innerHTML, /data-gear-elite=/, '每件装备应有进阶开关');
  assert.match(sheet.innerHTML, /data-gear-elite="[^"]+" aria-pressed="false"/);
  Team.closeSheet();
});

check('装备：进阶形态能进 URL 并还原', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { k: '拜松', e: false, it: [{ k: '维式重锤', e: true }] };
  Store.setTeam(team);
  assert.match(win.location.hash, /\*/, 'URL 里用 * 标记进阶装备');

  const parsed = Store.parseHash(win.location.hash);
  assert.deepEqual(parsed.team.slots[0].it, [{ k: '维式重锤', e: true }]);
});

check('详情气泡：tip 节点存在，隐藏后内容清空', () => {
  const tip = doc.getElementById('tip');
  assert.equal(typeof Team.hideTip, 'function');
  Team.hideTip();
  assert.equal(tip.hidden, true);
  assert.equal(tip.innerHTML, '');
});

check('分享：面板里有代码、链接和说明文本', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { k: '拜松', e: true, it: [{ k: '维式重锤', e: false }, { k: '变形同构体', e: false }], m: '维多利亚' };
  team.layers = { 炎: 80 };
  Store.setTeam(team);

  const text = Team.shareText();
  assert.match(text, /GSPA3\.[A-Za-z0-9_-]+/);
  assert.match(text, /#\/team\?c=/);
  assert.match(text, /我分享了一个卫戍协议配队/);

  Team.openSheet(-1, 'share', -1);
  assert.match(sheet.innerHTML, /分享配队/);
  assert.match(sheet.innerHTML, /GSPA3\./);
  assert.match(sheet.innerHTML, /data-copy-share/);
  Team.closeSheet();
});

check('导入：粘贴分享文本能识别并还原队伍', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { k: '拜松', e: true, it: [{ k: '维式重锤', e: false }, { k: '变形同构体', e: false }], m: '维多利亚' };
  team.slots[1] = { k: '魔王', e: false };
  team.layers = { 炎: 80 };
  Store.setTeam(team);
  const text = Team.shareText();

  Store.setTeam(Calc.emptyTeam(8));
  const res = Team.parseShareText(text);
  assert.ok(res, '应能解析');
  assert.equal(res.team.slots[0].k, '拜松');
  assert.equal(res.team.slots[0].e, true);
  assert.deepEqual(res.team.slots[0].it, [{ k: '维式重锤', e: false }, { k: '变形同构体', e: false }]);
  assert.equal(res.team.slots[0].m, '维多利亚');
  assert.equal(res.team.layers['炎'], 80);

  Team.openSheet(-1, 'import', -1);
  assert.match(sheet.innerHTML, /id="import-text"/);
  assert.match(sheet.innerHTML, /data-apply-import/);
  Team.closeSheet();
});

check('导入：也接受带 #/team 的链接', () => {
  const res = Team.parseShareText('看看这个 https://example.com/gspa/#/team?t=' +
    encodeURIComponent('拜松') + ',' + encodeURIComponent('魔王'));
  assert.ok(res);
  assert.equal(res.team.slots[0].k, '拜松');
  assert.equal(res.team.slots[1].k, '魔王');
});

check('分享链接：?c= 打开即还原，不用再粘贴', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { k: '拜松', e: true, it: [{ k: '维式重锤', e: false }, { k: '变形同构体', e: false }], m: '维多利亚' };
  team.slots[1] = { k: '魔王', e: false };
  team.layers = { 炎: 80 };
  Store.setTeam(team);

  const text = Team.shareText();
  assert.match(text, /#\/team\?c=GSPA3\./);

  const link = text.split('\n')[1];
  const parsed = Store.parseHash(link.slice(link.indexOf('#')));
  assert.equal(parsed.team.slots[0].k, '拜松');
  assert.equal(parsed.team.slots[0].e, true);
  assert.deepEqual(parsed.team.slots[0].it, [{ k: '维式重锤', e: false }, { k: '变形同构体', e: false }]);
  assert.equal(parsed.team.slots[0].m, '维多利亚');
  assert.equal(parsed.team.layers['炎'], 80);
});

check('导入：粘贴带 ?c= 的链接也能还原', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { k: '初雪', e: false };
  Store.setTeam(team);
  const link = Team.shareText().split('\n')[1];
  Store.setTeam(Calc.emptyTeam(8));
  const res = Team.parseShareText('看看 ' + link);
  assert.ok(res);
  assert.equal(res.team.slots[0].k, '初雪');
});

check('导入：识别不到时返回 null', () => {
  assert.equal(Team.parseShareText('随便一段话'), null);
  assert.equal(Team.parseShareText(''), null);
});

/* ---------------- 自选干员 ---------------- */
check('自选干员：面板、占席、计入盟约', () => {
  Team.openSheet(0, 'op', -1);
  assert.match(sheet.innerHTML, /data-choose-pick="斩业星熊"/);
  assert.match(sheet.innerHTML, /不计入盟约固定 10 人/);
  Team.closeSheet();

  const team = Calc.emptyTeam(8);
  team.slots[0] = { p: '斩业星熊', e: false };
  Store.setTeam(team);
  const res = Calc.evaluate(Store.getTeam(), win.GSPA_DATA);
  assert.equal(res.rows.find((r) => r.name === '炎').count, 1);
  assert.equal(res.summary.price, 4, '自选干员售价 4');
  const html = Team.render();
  assert.match(html, /斩业星熊/);
  assert.match(html, /自选/);
  assert.match(html, /data-tip-op="斩业星熊"/);
});

check('自选干员：URL p= 往返', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { p: '斩业星熊', e: false };
  Store.setTeam(team);
  assert.match(win.location.hash, /p=/);
  const parsed = Store.parseHash(win.location.hash);
  assert.equal(parsed.team.slots[0].p, '斩业星熊');
  assert.equal(parsed.team.slots[0].k, undefined);
});

check('自选干员：GSPA3 分享码往返', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { p: '斩业星熊', e: true };
  Store.setTeam(team);
  const code = win.Code.encode(Store.getTeam(), win.GSPA_DATA);
  assert.match(code, /^GSPA3\./);
  const dec = win.Code.decode(code, win.GSPA_DATA);
  assert.ok(dec);
  assert.equal(dec.team.slots[0].p, '斩业星熊');
  assert.equal(dec.team.slots[0].e, true);
});

check('自选干员：超过 2 名时截断到 2', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { p: '斩业星熊' };
  team.slots[1] = { p: '煌' };
  team.slots[2] = { p: '凯尔希' };
  Store.setTeam(team);
  const kept = Store.getTeam();
  assert.equal(kept.slots.filter((s) => s && s.p).length, 2);
  const html = Team.render();
  assert.match(html, /2\/2/);
});

check('GSPA2 旧码仍能解码（无自选字段）', () => {
  const bits = [];
  const w = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  w(0, 1);                                   // 8 席
  w(win.Code.dataTag(win.GSPA_DATA), 8);     // 数据指纹
  w(1, 4);                                   // 1 条记录
  const opIdx = win.GSPA_DATA.operators.findIndex((o) => o.name === '拜松') + 1;
  w(opIdx, 8);                               // 干员下标
  w(0, 1);                                   // 精锐
  w(0, 1);                                   // 无装备
  w(0, 3);                                   // 无层数
  while (bits.length % 8) bits.push(0);
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    bytes.push(v);
  }
  const b64 = Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const dec = win.Code.decode('GSPA2.' + b64, win.GSPA_DATA);
  assert.ok(dec);
  assert.equal(dec.team.slots[0].k, '拜松');
  assert.equal(dec.team.slots[0].p, undefined);
});

check('盟约固定成员仍是 10 人，自选干员只在 pickMembers', () => {
  const c = win.GSPA_DATA.covenants.find((x) => x.name === '炎');
  assert.equal(c.members.length, 10);
  assert.equal(c.memberCount, 10);
  assert.ok(c.pickMembers.includes('斩业星熊'));
  assert.equal(c.pickCount, c.pickMembers.length);
});

check('自选干员并入干员查询：自选 + 炎 命中斩业星熊', () => {
  Store.set({ view: 'op', sel: null, q: '自选 炎', tiers: [], tags: [] });
  win.UI.render();
  assert.match(cards.innerHTML, /斩业星熊/);
  assert.match(cards.innerHTML, /自选干员/);
  assert.match(cards.innerHTML, /data-team-toggle="斩业星熊"/);

  // 阶数筛选项「自选」= 0
  Store.set({ view: 'op', sel: null, q: '', tiers: [0], tags: [] });
  win.UI.render();
  assert.match(cards.innerHTML, /斩业星熊/);
  assert.doesNotMatch(cards.innerHTML, /拜松/);

  Store.set({ view: 'op', sel: null, q: '', tiers: [], tags: [] });
});

check('图鉴：加入 / 移出配队', () => {
  Store.setTeam(Calc.emptyTeam(8));
  Team.toggleFromList('拜松');
  assert.equal(Store.getTeam().slots[0].k, '拜松');
  Team.toggleFromList('拜松');
  assert.equal(Store.getTeam().slots[0], null);

  Team.toggleFromList('斩业星熊');
  assert.equal(Store.getTeam().slots[0].p, '斩业星熊');
  Team.toggleFromList('煌');
  assert.equal(Store.getTeam().slots[1].p, '煌');
  Team.toggleFromList('凯尔希');
  assert.equal(Store.getTeam().slots[2], null, '第 3 名自选被拦截');
});
let failed = 0;
for (const [status, msg] of results) {
  if (status !== 'ok') failed++;
  console.log(`${status === 'ok' ? 'ok  ' : 'FAIL'} ${msg}`);
}
console.log(`\n${results.length - failed} / ${results.length} 通过`);

if (process.env.DUMP) {
  console.log('\n--- cards.innerHTML（截断 4000 字）---\n');
  console.log(cards.innerHTML.slice(0, 4000));
}

process.exit(failed ? 1 : 0);
