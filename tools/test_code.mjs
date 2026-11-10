/**
 * 分享码编解码单测（零依赖）
 *
 *   node tools/test_code.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

globalThis.window = globalThis;
globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
new Function(fs.readFileSync(new URL('../web/js/calc.js', import.meta.url), 'utf8'))();
new Function(fs.readFileSync(new URL('../web/js/code.js', import.meta.url), 'utf8'))();

const data = JSON.parse(fs.readFileSync(new URL('../web/data/data.json', import.meta.url), 'utf8'));
const { Calc, Code } = globalThis;

function sampleTeam() {
  const team = Calc.emptyTeam(9);
  team.slots[0] = {
    k: '拜松', e: true,
    it: [{ k: '维式重锤', e: false }, { k: '变形同构体', e: true }],
    m: '维多利亚'
  };
  team.slots[1] = { k: '魔王', e: false };
  team.slots[2] = { k: '艾丝黛尔', e: true, it: [{ k: '萨尔贡浓茶', e: false }] };
  team.slots[3] = { k: '初雪', e: false };
  team.layers = { 炎: 80, 萨尔贡: 100, 迅捷: 40 };
  return team;
}

test('分享码：编码 → 解码能还原队伍、精锐、装备、转职、层数', () => {
  const team = sampleTeam();
  const code = Code.encode(team, data);
  assert.match(code, /^GSPA3\.[A-Za-z0-9_-]+$/);

  const res = Code.decode(code, data);
  assert.ok(res, '应能解码');
  assert.deepEqual(res.warnings, []);
  assert.equal(res.team.size, 9);

  for (let i = 0; i < 4; i++) {
    assert.deepEqual(res.team.slots[i], team.slots[i], '第 ' + (i + 1) + ' 席');
  }
  assert.equal(res.team.slots[4], null);
  assert.deepEqual(res.team.layers, team.layers);
});

test('分享码：无装备的 8 人队 ≤ 30 字符，带装备的也够短', () => {
  const plain = Calc.emptyTeam(8);
  data.operators.filter((o) => o.type !== '自选配置').slice(0, 8).forEach((o, i) => {
    plain.slots[i] = { k: o.name, e: i % 2 === 0 };
  });
  const short = Code.encode(plain, data);
  assert.ok(short.length <= 30, '无装备 8 人实际长度 ' + short.length);

  const geared = Calc.emptyTeam(8);
  data.operators.filter((o) => o.type !== '自选配置').slice(0, 8).forEach((o, i) => {
    geared.slots[i] = {
      k: o.name,
      e: i % 2 === 0,
      it: i < 2 ? ['维式重锤', '变形同构体'] : undefined,
      m: i < 2 ? '维多利亚' : undefined
    };
  });
  const long = Code.encode(geared, data);
  assert.ok(long.length <= 45, '带装备 8 人实际长度 ' + long.length);
  assert.ok(long.length > short.length);
});

test('分享码：从一段聊天文本里自动捞出代码', () => {
  const code = Code.encode(sampleTeam(), data);
  const text = '我分享了一个卫戍协议配队，快来看看吧\n【GSPA 配队】' + code + '\nhttps://example.com/gspa/#/team';
  const res = Code.decode(text, data);
  assert.ok(res);
  assert.equal(res.team.slots[0].k, '拜松');
});

test('分享码：乱码 / 空文本 / 别的版本都返回 null', () => {
  assert.equal(Code.decode('', data), null);
  assert.equal(Code.decode('随便一句话', data), null);
  assert.equal(Code.decode('GSPA2.!!!!', data), null);
  assert.equal(Code.decode('GSPA1.AQhLAgEOAT4DjQAAAAEAAFA', data), null, '旧版码不再支持');
  assert.equal(Code.decode('GSPA2.', data), null);
});

test('分享码：数据版本对不上时给出警告但仍尽量还原', () => {
  const code = Code.encode(sampleTeam(), data);
  const drifted = JSON.parse(JSON.stringify(data));
  drifted.operators.push({ key: '新干员', name: '新干员', tier: 1, tags: [] });
  const res = Code.decode(code, drifted);
  assert.ok(res);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /数据版本/);
  assert.equal(res.team.slots[0].k, '拜松', '下标仍然对得上时照样还原');
});

test('分享码：转职盟约、两件装备与「进阶形态」分别还原', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = {
    k: '拜松', e: false,
    it: [{ k: '变形同构体', e: true }, { k: '维式重锤', e: false }],
    m: '萨尔贡'
  };
  const res = Code.decode(Code.encode(team, data), data);
  assert.deepEqual(res.team.slots[0].it, [
    { k: '变形同构体', e: true },
    { k: '维式重锤', e: false }
  ]);
  assert.equal(res.team.slots[0].m, '萨尔贡');
});

test('分享码：自选干员（p）随 GSPA3 还原，最多 2 名', () => {
  const team = Calc.emptyTeam(8);
  team.slots[0] = { p: '斩业星熊', e: true };
  const code = Code.encode(team, data);
  assert.match(code, /^GSPA3\./);
  const res = Code.decode(code, data);
  assert.ok(res);
  assert.equal(res.team.slots[0].k, undefined);
  assert.equal(res.team.slots[0].p, '斩业星熊');
  assert.equal(res.team.slots[0].e, true);

  const over = Calc.emptyTeam(8);
  over.slots[0] = { p: '斩业星熊' };
  over.slots[1] = { p: '煌' };
  over.slots[2] = { p: '凯尔希' };
  const dec = Code.decode(Code.encode(over, data), data);
  assert.equal(dec.team.slots.filter((s) => s && s.p).length, 2);
});
