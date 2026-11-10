/**
 * calc.js 的规则单测（零依赖，Node 22 原生 test runner）
 *
 *   node --test tools/test_calc.mjs
 *
 * 用例用的是 data.json 里的真实干员名；成员的组合从盟约的 members 列表里取，
 * 这样换赛季数据后测试仍然成立（只要成员列表和 tags 一致）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// calc.js 是浏览器 IIFE，这里给一个 window 壳直接跑
globalThis.window = globalThis;
const calcSrc = fs.readFileSync(new URL('../web/js/calc.js', import.meta.url), 'utf8');
new Function(calcSrc)();

const data = JSON.parse(fs.readFileSync(new URL('../web/data/data.json', import.meta.url), 'utf8'));
const Calc = globalThis.Calc;
const RULES = Calc.RULES;

const cov = (name) => data.covenants.find((c) => c.name === name);
const row = (res, name) => res.rows.find((r) => r.name === name);
const members = (name, n) => cov(name).members.slice(0, n);

function teamOf(names, opts = {}) {
  const size = opts.size || RULES.size;
  const slots = [];
  for (let i = 0; i < size; i++) slots.push(null);
  names.forEach((n, i) => {
    if (!n) return;
    slots[i] = typeof n === 'string' ? { k: n, e: false } : { k: n.k, e: !!n.e, p: n.p };
  });
  return { size, slots, layers: opts.layers || {} };
}

const ev = (names, opts) => Calc.evaluate(teamOf(names, opts), data);

test('空队伍：没有激活，也没有「差一点」', () => {
  const res = Calc.evaluate(Calc.emptyTeam(8), data);
  assert.equal(res.summary.active, 0);
  assert.equal(res.summary.near, 0);
  assert.equal(res.summary.filled, 0);
  assert.equal(res.rows.length, data.covenants.length);
});

test('主盟约：3 人激活、6 人强化', () => {
  const three = ev(members('炎', 3));
  assert.equal(row(three, '炎').count, 3);
  assert.equal(row(three, '炎').state, 'active');

  const six = ev(members('炎', 6));
  assert.equal(row(six, '炎').count, 6);
  assert.equal(row(six, '炎').state, 'empowered');
  assert.equal(row(six, '炎').missingEmpower, 0);
});

test('主盟约：差 1–3 人为 near，差 4 人为 inactive', () => {
  const one = ev(members('炎', 1));
  assert.equal(row(one, '炎').state, 'near');
  assert.equal(row(one, '炎').missing, 2);

  const zero = ev(members('乌萨斯', 0));
  assert.equal(row(zero, '乌萨斯').state, 'inactive');
});

test('副盟约：2 人激活、3 人强化', () => {
  const two = ev(members('精准', 2));
  assert.equal(row(two, '精准').count, 2);
  assert.equal(row(two, '精准').state, 'active');

  const three = ev(members('精准', 3));
  assert.equal(row(three, '精准').state, 'empowered');
});

test('count_layer：人数激活 + 层数点亮节点', () => {
  const base = ev(members('迅捷', 2));
  assert.equal(row(base, '迅捷').state, 'active');
  assert.equal(row(base, '迅捷').node, 0);

  const lit = ev(members('迅捷', 2), { layers: { 迅捷: 40 } });
  assert.equal(row(lit, '迅捷').node, 40);
  assert.equal(row(lit, '迅捷').state, 'empowered');

  // 远见三个节点逐级点亮
  const far = ev(members('远见', 2), { layers: { 远见: 85 } });
  assert.equal(row(far, '远见').node, 80);
  assert.equal(row(far, '远见').state, 'active');

  // 人数不够时，层数再高也不激活（层数不替代人数）
  const noCount = ev(members('远见', 1), { layers: { 远见: 150 } });
  assert.notEqual(noCount.state, 'active');
  assert.equal(row(noCount, '远见').state, 'near');
  assert.equal(row(noCount, '远见').node, 150, '节点照样点亮，但不算激活');
});

test('投资人需要 3 人', () => {
  const two = ev(members('投资人', 2));
  assert.equal(row(two, '投资人').state, 'near');
  assert.equal(row(two, '投资人').missing, 1);
  const three = ev(members('投资人', 3));
  assert.equal(row(three, '投资人').state, 'active');
});

test('绝技：按精锐数，2 名激活、5 名强化', () => {
  const normal = data.operators.filter((o) => o.type !== '自选配置').slice(0, 5);
  const none = ev(normal.map((o) => ({ k: o.name, e: false })));
  assert.equal(row(none, '绝技').count, 0);
  assert.equal(row(none, '绝技').state, 'inactive');

  const two = ev(normal.map((o, i) => ({ k: o.name, e: i < 2 })));
  assert.equal(row(two, '绝技').count, 2);
  assert.equal(row(two, '绝技').state, 'active');

  const five = ev(normal.map((o) => ({ k: o.name, e: true })));
  assert.equal(row(five, '绝技').count, 5);
  assert.equal(row(five, '绝技').state, 'empowered');
});

test('独行：恰好 1 名生效，2 名失效', () => {
  const one = ev(members('独行', 1));
  assert.equal(row(one, '独行').state, 'active');

  const two = ev(members('独行', 2));
  assert.equal(row(two, '独行').state, 'conflict');
  assert.equal(row(two, '独行').count, 2);
});

test('调和：激活后给每个主盟约 +1，且只加核心盟约', () => {
  const one = ev([members('调和', 1)[0]]);
  assert.equal(row(one, '调和').state, 'active');
  assert.equal(row(one, '炎').count, 1, '核心盟约 0 人 + 调和 1');
  assert.equal(row(one, '精准').count, 0, '副盟约不吃调和');
  assert.equal(row(one, '炎').bonus, 1);

  const three = ev([members('调和', 1)[0], ...members('炎', 2)]);
  assert.equal(row(three, '炎').count, 3);
  assert.equal(row(three, '炎').state, 'active');

  // 调和把人数的 +1 也算进强化档：5 名炎 + 调和 = 6
  const six = ev([members('调和', 1)[0], ...members('炎', 5)], { size: 9 });
  assert.equal(row(six, '炎').count, 6);
  assert.equal(row(six, '炎').state, 'empowered');
});

test('调和：多名调和干员不叠加', () => {
  const two = ev(members('调和', 2));
  assert.equal(row(two, '炎').count, 1, '仍然只 +1');
  assert.equal(row(two, '调和').count, 2);
});

test('协防干员：按表内 2 人', () => {
  const one = ev(members('协防干员', 1));
  assert.equal(row(one, '协防干员').state, 'near');
  const two = ev(members('协防干员', 2));
  assert.equal(row(two, '协防干员').state, 'active');
});

test('同一干员重复上场：只计一次，并记录重复', () => {
  const res = ev([members('炎', 1)[0], members('炎', 1)[0]]);
  assert.equal(row(res, '炎').count, 1);
  assert.deepEqual(res.dupes, [members('炎', 1)[0]]);
  assert.equal(res.summary.filled, 1);
});

test('席位数：8 与 9 都能装，超出部分被忽略', () => {
  const names = data.operators.filter((o) => o.type !== '自选配置').slice(0, 10).map((o) => o.name);
  const eight = ev(names, { size: 8 });
  assert.equal(eight.summary.size, 8);
  assert.equal(eight.summary.filled, 8);

  const nine = ev(names, { size: 9 });
  assert.equal(nine.summary.filled, 9);
});

test('未知干员名被忽略，不影响其余判定', () => {
  const res = ev(['不存在的干员', members('炎', 2)[0], members('炎', 2)[1]]);
  assert.equal(row(res, '炎').count, 2);
  assert.equal(res.summary.filled, 2);
});

test('总体：激活数 = active + empowered，且排序把已激活放前面', () => {
  const res = ev([...members('炎', 3), ...members('精准', 2)], { size: 8 });
  assert.equal(res.summary.active, 2);
  assert.equal(res.rows[0].state === 'active' || res.rows[0].state === 'empowered', true);
  const last = res.rows[res.rows.length - 1];
  assert.equal(last.state === 'inactive' || last.state === 'near', true);
});

/* ---------------- 装备与转职 ---------------- */
test('装备：变形同构体按「另一件装备」的盟约转职', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { k: '拜松', e: false, it: ['维式重锤', '变形同构体'] };
  const res = Calc.evaluate(team, data);
  assert.equal(row(res, '维多利亚').count, 1, '维式重锤 → 维多利亚');
  assert.equal(res.morphIssues.length, 0);
});

test('装备：缺另一件时不给盟约，可用 slot.m 手动指定', () => {
  const t1 = Calc.emptyTeam(8);
  t1.slots[0] = { k: '拜松', e: false, it: ['变形同构体'] };
  const r1 = Calc.evaluate(t1, data);
  assert.equal(row(r1, '维多利亚').count, 0);
  assert.equal(r1.morphIssues.length, 1);

  const t2 = Calc.emptyTeam(8);
  t2.slots[0] = { k: '拜松', e: false, it: ['变形同构体'], m: '维多利亚' };
  const r2 = Calc.evaluate(t2, data);
  assert.equal(row(r2, '维多利亚').count, 1);
  assert.equal(r2.morphIssues.length, 0);
});

test('装备：携带者已有该盟约时不重复计数', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { k: '拜松', e: false, it: ['炎国短刀', '变形同构体'] };
  const res = Calc.evaluate(team, data);
  assert.equal(row(res, '炎').count, 1, '拜松本身是炎，转职炎不再 +1');
});

test('装备：售价计入总价', () => {
  const plain = Calc.emptyTeam(8);
  plain.slots[0] = { k: '拜松', e: false };
  const a = Calc.evaluate(plain, data).summary.price;

  const geared = Calc.emptyTeam(8);
  geared.slots[0] = { k: '拜松', e: false, it: ['维式重锤', '变形同构体'] };
  const b = Calc.evaluate(geared, data).summary.price;
  assert.equal(b - a, 4, '维式重锤 1 + 变形同构体 3');
});

test('装备：进阶形态按进阶售价计价', () => {
  const base = Calc.emptyTeam(8);
  base.slots[0] = { k: '拜松', e: false, it: [{ k: '维式重锤', e: false }] };
  const elite = Calc.emptyTeam(8);
  elite.slots[0] = { k: '拜松', e: false, it: [{ k: '维式重锤', e: true }] };

  const a = Calc.evaluate(base, data).summary.price;
  const b = Calc.evaluate(elite, data).summary.price;
  const item = data.items.find((i) => i.name === '维式重锤');
  assert.equal(b - a, item.elitePrice - item.price, '进阶价 5 - 基础价 1');
});

/* ---------------- 连续添加 ---------------- */
test('连续添加：环形找下一个空席', () => {
  const slots = [null, { k: 'a' }, null, null, { k: 'b' }, null];
  assert.equal(Calc.nextEmptySlot(slots, -1), 0, '从头开始');
  assert.equal(Calc.nextEmptySlot(slots, 0), 2);
  assert.equal(Calc.nextEmptySlot(slots, 2), 3);
  assert.equal(Calc.nextEmptySlot(slots, 4), 5);
  assert.equal(Calc.nextEmptySlot(slots, 5), 0, '末尾之后绕回开头');

  assert.equal(Calc.nextEmptySlot([{ k: 'a' }, { k: 'b' }], 0), -1, '满了返回 -1');
  assert.equal(Calc.nextEmptySlot([], 0), -1);
});

/* ---------------- 层数数值 ---------------- */
test('层数数值：数值在前、算式在后，百分数带 + 号', () => {
  const sal = data.covenants.find((c) => c.name === '萨尔贡').valueText;
  const out = Calc.substLayers(sal, 80);
  assert.match(out, /22\.6（5\+0\.22×80）/, '持续时间：数值（算式）');
  assert.match(out, /\+22%（20%\+0\.025%×80）/, '百分数：+22%（20%+0.025%×80）');
  assert.match(out, /7000（5000\+25×80）/, '点伤不带 + 号');

  const arc = data.covenants.find((c) => c.name === '奥术').valueText;
  assert.match(Calc.substLayers(arc, 80), /-34（-30-0\.05×80）/, '负系数');

  assert.equal(Calc.substLayers(sal, 0), sal, '0 层保持原文');
  assert.equal(Calc.hasLayerFormula(sal), true);
  assert.equal(Calc.hasLayerFormula(data.covenants.find((c) => c.name === '调和').valueText), false);
});

test('层数数值：layerSegments 给出可着色的片段', () => {
  const sal = data.covenants.find((c) => c.name === '萨尔贡').valueText;
  const segs = Calc.layerSegments(sal, 100);
  const nums = segs.filter((s) => s.t === 'num');
  assert.equal(nums.length, 4, '萨尔贡这条有 4 个层数公式');
  assert.deepEqual(nums[0], { t: 'num', v: '27', f: '5+0.22×100' });
  assert.equal(nums[1].v.endsWith('%') && nums[1].v.startsWith('+'), true);
});

/* ---------------- 自选干员 ---------------- */
const pickOf = (name) => data.picks.find((p) => p.name === name);

test('自选干员：按 tags 计入盟约，但不进固定成员', () => {
  const p = pickOf('斩业星熊');
  assert.ok(p, '斩业星熊在自选干员表');
  assert.deepEqual(p.tags, ['炎']);

  const two = members('炎', 2);
  const team = teamOf([two[0], two[1], { p: '斩业星熊' }]);
  const res = Calc.evaluate(team, data);

  assert.equal(row(res, '炎').count, 3);
  assert.equal(row(res, '炎').state, 'active');
  const basePrice = Calc.evaluate(teamOf([two[0], two[1]]), data).summary.price;
  assert.equal(res.summary.price - basePrice, 4, '自选干员售价 4');
  assert.equal(res.summary.picks, 1);
  // 固定成员仍然是 10 人；斩业星熊只在 pickMembers
  assert.equal(cov('炎').members.length, 10);
  assert.ok(cov('炎').pickMembers.includes('斩业星熊'));
});

test('自选干员：多核心（炎/维多利亚）两边都计', () => {
  const p = pickOf('煌');
  assert.ok(p);
  assert.deepEqual(p.tags.sort(), ['维多利亚', '炎'].sort());
  const res = Calc.evaluate(teamOf([{ p: '煌' }]), data);
  assert.equal(row(res, '炎').count, 1);
  assert.equal(row(res, '维多利亚').count, 1);
});

test('自选干员：无核心 → 协防干员', () => {
  const p = pickOf('凯尔希');
  assert.ok(p);
  assert.deepEqual(p.tags, ['协防干员']);
  const res = Calc.evaluate(teamOf([
    { p: '凯尔希' },
    { p: '闪灵' }
  ]), data);
  assert.equal(row(res, '协防干员').count, 2);
  assert.equal(row(res, '协防干员').state, 'active');
});

test('自选干员：同一人重复只计一次', () => {
  const res = Calc.evaluate(teamOf([
    { p: '斩业星熊' },
    { p: '斩业星熊' }
  ]), data);
  assert.equal(res.dupes.length, 1);
  assert.equal(row(res, '炎').count, 1);
});

test('自选干员：最多 2 名的标记', () => {
  const res = Calc.evaluate(teamOf([
    { p: '斩业星熊' },
    { p: '煌' },
    { p: '凯尔希' }
  ]), data);
  assert.equal(res.summary.picks, 3);
  assert.equal(res.pickOverflow, true);
  const ok = Calc.evaluate(teamOf([{ p: '斩业星熊' }, { p: '煌' }]), data);
  assert.equal(ok.pickOverflow, false);
});

test('自选干员：缺 picks 的旧数据不崩', () => {
  const old = { operators: data.operators, items: data.items, covenants: data.covenants };
  const res = Calc.evaluate(teamOf(['拜松', '矩', '乌有']), old);
  assert.equal(row(res, '炎').count, 3);
});
