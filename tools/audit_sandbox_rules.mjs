#!/usr/bin/env node
/**
 * 叠层规则与干员文本的静态一致性审查。
 *
 *   node tools/audit_sandbox_rules.mjs
 *   node tools/audit_sandbox_rules.mjs --json
 *
 * 只做确定性检查，不替代人工核对：
 *   - 触发事件是否与文本触发词一致
 *   - 文本里的【盟约】是否写进 rule.bonds
 *   - 「每回合/每场至多 N 层」是否写进 perRound/perBattle
 *   - 「层数 +N」是否与 rule.amount 一致
 *   - 列出仍为 special 的加层规则
 *
 * 运行时修正见 web/js/sandbox.js 的 EVENT_FIXES；这里把它标为 known，不算失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const JSON_OUT = process.argv.includes('--json');

function readJsonAssign(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  return JSON.parse(src.slice(start, end + 1));
}

const RULES = readJsonAssign('web/data/operator_rules.js');
const DATA = readJsonAssign('web/data/data.js');
const COV = new Set((DATA.covenants || []).map((c) => c.name));
const OP = new Map();
for (const o of DATA.operators || []) OP.set(o.name, o);
for (const p of DATA.picks || []) if (!OP.has(p.name)) OP.set(p.name, p);

const EVENT_FIXES = new Map([
  ['远牙', 'onKill'],
  ['耀骑士临光', 'onKnockdown'],
  ['归溟幽灵鲨', 'onKnockdown'],
  ['风丸', 'onKnockdown'],
  ['历阵锐枪芬', 'onKnockdown']
]);

const EVENT_LABEL = {
  onGain: '获得时', onRefresh: '刷新时', onPrepStart: '进入休整期时',
  onPrepEnd: '休整期结束时', onBattleStart: '战斗开始时', onBattleEnd: '战斗结束时',
  onDeploy: '部署时', onSkill: '开启技能时', onKill: '击倒敌人时',
  onKnockdown: '我方被击倒时', onSubstitute: '替身切换时', onSell: '售出时'
};

function textFor(name, rule) {
  const o = OP.get(name);
  if (!o) return '';
  if (rule.text) return String(rule.text);
  return String((rule.elite ? o.eliteText : o.normalText) || o.normalText || o.eliteText || '');
}

function expectedEvents(text) {
  if (/特质.*相同|复制.*特质/.test(text)) return new Set();
  const out = new Set();
  if (/自身被击倒|与替身|与傀儡|被击倒时/.test(text) && !/敌人被击倒/.test(text)) out.add('onKnockdown');
  if (/敌人被击倒|每击倒一名敌人|每击倒\d+名敌人/.test(text)) out.add('onKill');
  if (/部署时/.test(text) && !/再部署时间/.test(text)) out.add('onDeploy');
  if (/开启技能/.test(text)) out.add('onSkill');
  if (/获得时/.test(text)) out.add('onGain');
  if (/进入休整期时|休整期开始时/.test(text)) out.add('onPrepStart');
  if (/休整期结束时/.test(text)) out.add('onPrepEnd');
  if (/刷新时/.test(text)) out.add('onRefresh');
  return out;
}

const findings = [];
function add(level, name, rule, kind, message) {
  findings.push({ level, name, event: rule.event || '', kind, message });
}

let ruleCount = 0;
let specialGain = 0;

// 同一条文本常被拆成多条规则（按盟约/按触发拆分）；先用并集判断“文本里的盟约是否被覆盖”，
// 避免把「叙拉古 rule + 奇迹 rule」误判成两条都缺盟约。
const coverage = new Map();
for (const [name, rules] of Object.entries(RULES)) {
  for (const rule of rules || []) {
    if (rule.special || !Array.isArray(rule.bonds)) continue;
    const key = name + '|' + (rule.elite ? 'E' : 'N') + '|' + rule.event;
    if (!coverage.has(key)) coverage.set(key, new Set());
    rule.bonds.forEach((b) => coverage.get(key).add(b));
  }
}

for (const [name, rules] of Object.entries(RULES)) {
  for (const rule of rules || []) {
    ruleCount++;
    const text = textFor(name, rule);
    if (!text) continue;
    const groupKey = name + '|' + (rule.elite ? 'E' : 'N') + '|' + rule.event;
    const groupRules = (rules || []).filter((r) => (r.elite ? 'E' : 'N') === (rule.elite ? 'E' : 'N') && r.event === rule.event);

    const expected = expectedEvents(text);
    if (expected.size && !expected.has(rule.event) && !rule.grantFrontTrait) {
      const fixed = EVENT_FIXES.get(name);
      if (fixed && expected.has(fixed)) {
        add(rule.special ? 'inert' : 'known', name, rule, 'event',
          `已运行时修正为 ${fixed}（原文触发词 ${[...expected].join('/')}）${rule.special ? '；但仍是 special，不结算' : ''}`);
      } else if (rule.special || rule.grantFrontTrait || rule.triggerFrontGain || rule.teamWide || rule.capAura || rule.battleCapAura) {
        add('warn', name, rule, 'event', `event=${rule.event}，文本触发词为 ${[...expected].join('/')}（special/光环，暂不结算）`);
      } else {
        add('error', name, rule, 'event', `event=${rule.event}，文本触发词应为 ${[...expected].join('/')}`);
      }
    }

    // 文本中的盟约 vs 同组规则的盟约并集
    if (Array.isArray(rule.bonds)) {
      const named = [...text.matchAll(/【([^】]+)】/g)].map((m) => m[1]).filter((b) => COV.has(b));
      const covered = coverage.get(groupKey) || new Set();
      const missing = named.filter((b) => !covered.has(b));
      if (missing.length) add('error', name, rule, 'bonds', `文本提到【${missing.join('】【')}】，同组规则未包含`);
      const extra = rule.bonds.filter((b) => named.length && named.indexOf(b) < 0);
      if (extra.length) add('warn', name, rule, 'bonds', `规则含【${extra.join('】【')}】，文本未点名（可能是通用/转化）`);
    }

    // 上限：同组有多条规则时文本上限可能分属不同盟约，跳过静态比较，避免误报。
    if (!rule.special && groupRules.length === 1) {
      const round = text.match(/每回合至多(?:叠加)?\s*(\d+)\s*层/);
      const battle = text.match(/每场战斗至多(?:叠加)?\s*(\d+)\s*层/);
      const ruleRound = rule.perRound != null ? rule.perRound
        : rule.grantFrontTrait && rule.grantFrontTrait.perRound;
      if (round && Number(round[1]) !== Number(ruleRound)) {
        add('error', name, rule, 'cap', `文本每回合至多 ${round[1]} 层，规则 perRound=${ruleRound}`);
      }
      if (battle && Number(battle[1]) !== Number(rule.perBattle)) {
        add('error', name, rule, 'cap', `文本每场至多 ${battle[1]} 层，规则 perBattle=${rule.perBattle}`);
      }
    }

    // 数值：同组多条规则时，文本里的多个“层数 +N”可能分属不同盟约，跳过。
    const amounts = [...text.matchAll(/层数\s*\+\s*(\d+)/g)].map((m) => Number(m[1]));
    if (!rule.special && groupRules.length === 1 && amounts.length === 1 && rule.amount != null && Number(rule.amount) !== amounts[0]) {
      add('warn', name, rule, 'amount', `文本层数 +${amounts[0]}，规则 amount=${rule.amount}（可能受“每有”倍率影响）`);
    }

    if (rule.special && /层数\s*\+|叠加[^。]{0,16}层数|转化[^。]{0,16}层数|获得[^。]{0,16}层数/.test(text)) {
      specialGain++;
    }
  }
}

const errors = findings.filter((f) => f.level === 'error');
const warns = findings.filter((f) => f.level === 'warn');
const known = findings.filter((f) => f.level === 'known');
const inert = findings.filter((f) => f.level === 'inert');

if (JSON_OUT) {
  console.log(JSON.stringify({ ruleCount, specialGain, errors, warns, known, inert }, null, 2));
} else {
  console.log('叠层文本审查');
  console.log('规则数：' + ruleCount + '；仍为 special 的加层规则：' + specialGain);
  console.log('错误：' + errors.length + '；警告：' + warns.length + '；已知运行时修正：' + known.length + '；仅改事件但仍 special：' + inert.length);
  const show = (title, list) => {
    if (!list.length) return;
    console.log('\n' + title);
    for (const f of list) console.log(`- [${f.name}] ${f.message}`);
  };
  show('错误（应修）', errors);
  show('警告（需人工确认）', warns.slice(0, 30));
  if (warns.length > 30) console.log(`- …另有 ${warns.length - 30} 条警告`);
  show('已知运行时修正', known);
  show('仅改事件、仍 special（不结算）', inert);
}

process.exitCode = errors.length ? 1 : 0;
