/**
 * 二维码编码器测试：结构检查 + 与 segno 黄金样本逐模块比对。
 *
 *   node tools/test_qr.mjs
 *
 * 黄金样本由 tools/gen_qr_fixtures.py 生成（第三方实现 segno，仅开发机）。
 * 全部通过时退出码 0。
 */
import fs from 'node:fs';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name + ' → ' + (e && e.message ? e.message : e)]);
  }
}

/* ---------------- 加载 qr.js ---------------- */
const win = globalThis;
win.window = win;
new Function(fs.readFileSync(new URL('../web/js/qr.js', import.meta.url), 'utf8'))();
const Qr = win.Qr;

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/qr-cases.json', import.meta.url), 'utf8'));

/* ---------------- 结构 ---------------- */
check('模块可加载', () => {
  if (!Qr || typeof Qr.encode !== 'function') throw new Error('Qr.encode 不存在');
});

check('选版本与容量自洽', () => {
  // V1-M 16 数据码字 → 最多 14 字节
  if (Qr.capacityBytes(1) !== 14) throw new Error('V1 容量应为 14，实际 ' + Qr.capacityBytes(1));
  if (Qr.capacityBytes(6) !== 106) throw new Error('V6 容量应为 106，实际 ' + Qr.capacityBytes(6));
  if (Qr.capacityBytes(7) !== 122) throw new Error('V7 容量应为 122，实际 ' + Qr.capacityBytes(7));
  if (Qr.pickVersion('x'.repeat(14)) !== 1) throw new Error('14 字节应选 V1');
  if (Qr.pickVersion('x'.repeat(15)) !== 2) throw new Error('15 字节应选 V2');
});

check('超长输入返回 null', () => {
  if (Qr.encode('x'.repeat(400)) !== null) throw new Error('超过 V10 容量应返回 null');
});

check('同一输入输出稳定', () => {
  const a = Qr.encode('https://example.com/#/team?c=GSPA3.JZh2D8ONAIIAFAA');
  const b = Qr.encode('https://example.com/#/team?c=GSPA3.JZh2D8ONAIIAFAA');
  if (a.size !== b.size) throw new Error('尺寸不稳定');
  for (let i = 0; i < a.modules.length; i++) {
    if (a.modules[i] !== b.modules[i]) throw new Error('第 ' + i + ' 个模块不稳定');
  }
});

check('定位图形 / 定时图形正确', () => {
  const qr = Qr.encode('GSPA3.AAAA');
  const s = qr.size;
  const at = (x, y) => qr.modules[y * s + x];
  // 三个 7×7 定位图形的外框必须为黑
  for (const [ox, oy] of [[0, 0], [s - 7, 0], [0, s - 7]]) {
    for (let i = 0; i < 7; i++) {
      if (at(ox + i, oy) !== 1) throw new Error('定位图形上边缺失');
      if (at(ox + i, oy + 6) !== 1) throw new Error('定位图形下边缺失');
      if (at(ox, oy + i) !== 1) throw new Error('定位图形左边缺失');
      if (at(ox + 6, oy + i) !== 1) throw new Error('定位图形右边缺失');
    }
    if (at(ox + 3, oy + 3) !== 1) throw new Error('定位图形中心缺失');
  }
  // 定时图形：第 6 行 / 第 6 列交替，起点为黑
  for (let i = 8; i < s - 8; i++) {
    const want = i % 2 === 0 ? 1 : 0;
    if (at(i, 6) !== want) throw new Error('第 6 行定时图形第 ' + i + ' 格错误');
    if (at(6, i) !== want) throw new Error('第 6 列定时图形第 ' + i + ' 格错误');
  }
  // 固定黑点
  if (at(8, s - 8) !== 1) throw new Error('固定黑点缺失');
});

check('格式信息两份拷贝一致', () => {
  // 按 ISO 18004 的位序把两份格式信息读回成 15 bit，必须完全相同
  for (const text of ['GSPA3.AAAA', 'https://example.com/#/team?c=GSPA3.JZh2D8ONAIIAFAA']) {
    const qr = Qr.encode(text);
    const s = qr.size;
    const at = (x, y) => qr.modules[y * s + x];
    let a = 0;
    let b = 0;
    for (let i = 0; i < 15; i++) {
      let pa;
      let pb;
      if (i < 6) { pa = at(8, i); pb = at(s - 1 - i, 8); }
      else if (i < 8) { pa = at(8, i + 1); pb = at(s - 1 - i, 8); }
      else if (i === 8) { pa = at(7, 8); pb = at(8, s - 15 + i); }
      else { pa = at(14 - i, 8); pb = at(8, s - 15 + i); }
      a |= pa << i;
      b |= pb << i;
    }
    if (a !== b) {
      throw new Error('两份格式信息不一致：0x' + a.toString(16) + ' vs 0x' + b.toString(16));
    }
    // 与自研的 formatBits 对账（掩码是自动选的，从返回结果取）
    const expect = Qr._formatBits(qr.mask);
    if (a !== expect) {
      throw new Error('格式信息与 _formatBits 不一致：0x' + a.toString(16) + ' vs 0x' + expect.toString(16));
    }
  }
});

/* ---------------- 与 segno 逐模块比对 ---------------- */
for (const c of fixtures.cases) {
  check('黄金样本 ' + c.id + '（v' + c.version + '）', () => {
    const qr = Qr.encode(c.text);
    if (!qr) throw new Error('编码返回 null');
    if (qr.version !== c.version) {
      throw new Error('版本不一致：自研 V' + qr.version + '，segno V' + c.version);
    }
    if (qr.size !== c.size) throw new Error('尺寸不一致：' + qr.size + ' vs ' + c.size);
    for (let y = 0; y < c.size; y++) {
      for (let x = 0; x < c.size; x++) {
        const want = c.modules[y][x] === '1' ? 1 : 0;
        const got = qr.modules[y * c.size + x];
        if (want !== got) {
          throw new Error('模块不一致 @(' + x + ',' + y + ')：segno=' + want + ' 自研=' + got);
        }
      }
    }
  });
}

/* ---------------- 真实链接的长度/版本 ---------------- */
check('真实分享链接可选到版本', () => {
  const url = 'https://haixingjun.github.io/GSPA-Glasses-Stronghold-Protocol-Assistant/#/team?c=GSPA3.JZh2D8ONAIIAFAA';
  const v = Qr.pickVersion(url);
  if (v < 5 || v > 7) throw new Error('真实链接版本应落在 V5–V7，实际 V' + v);
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
