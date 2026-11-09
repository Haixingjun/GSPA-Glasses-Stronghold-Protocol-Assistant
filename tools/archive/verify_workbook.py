# -*- coding: utf-8 -*-
"""校验 卫戍协议数据表.xlsx：与解包源逐字段比对 + 结构/一致性检查。

用法: python tools/verify_workbook.py [待校验表] [解包源] [原表备份]
默认: 卫戍协议数据表.xlsx / 卫戍协议_完整数据表.xlsx / bak/ 下最新备份
"""
import sys, io, glob, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from openpyxl import load_workbook
from collections import Counter

NEW = sys.argv[1] if len(sys.argv) > 1 else "卫戍协议数据表.xlsx"
SRC = sys.argv[2] if len(sys.argv) > 2 else "source/卫戍协议_完整数据表.xlsx"
if len(sys.argv) > 3:
    OLD = sys.argv[3]
else:
    cands = sorted(glob.glob("source/卫戍协议数据表_*.xlsx"))
    OLD = cands[-1] if cands else NEW
print("待校验:", NEW, "\n解包源:", SRC, "\n对比原表:", OLD)

src = load_workbook(SRC, data_only=True)
new = load_workbook(NEW, data_only=True)
old = load_workbook(OLD, data_only=True)

problems = []
checks = 0


def eq(a, b):
    global checks
    checks += 1
    sa = "" if a is None else str(a)
    sb = "" if b is None else str(b)
    return sa == sb


def data_rows(ws, start, ncol):
    out = []
    for r in range(start, ws.max_row + 1):
        vals = [ws.cell(row=r, column=c).value for c in range(1, ncol + 1)]
        if all(v is None for v in vals):
            continue
        out.append((r, vals))
    return out


print("工作表:", new.sheetnames)
expect = ["干员表", "道具表", "策略表", "盟约表", "合成配方", "指令阶段", "补给增益", "修订记录"]
if new.sheetnames != expect:
    problems.append("工作表名/顺序不符: %s" % new.sheetnames)

# ---------------- 干员表 ----------------
ws = new["干员表"]
hdr = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
print("\n干员表 表头:", hdr)
rows = data_rows(ws, 2, len(hdr))
s = data_rows(src["干员与特质"], 7, 8)
if len(rows) != len(s):
    problems.append("干员表行数 %d != 源 %d" % (len(rows), len(s)))
ROMAN = {1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI"}
for (r, v), (_, sv) in zip(rows, s):
    rank = int(sv[0])
    src_cov = "/".join([x for x in (sv[2], sv[3], sv[4]) if x])
    pairs = [("名称", v[0], sv[1]), ("阶数", v[1], ROMAN[rank]), ("特性", v[2], src_cov),
             ("盟约一", v[7], sv[2]), ("盟约二", v[8], sv[3]), ("盟约三", v[9], sv[4]),
             ("条目类型", v[10], sv[7])]
    if str(sv[7]) != "自选配置":
        pairs += [("普通特质", v[3], sv[5]), ("精锐特质", v[4], sv[6])]
    for label, a, b in pairs:
        if not eq(a, b):
            problems.append("干员表 行%d [%s] %r != 源 %r" % (r, label, a, b))
names = [v[0] for _, v in rows]
dup = [k for k, c in Counter(names).items() if c > 1]
if dup:
    problems.append("干员表重名: %s" % dup)

# 售价沿用原表（精锐售价若原表为空则按普通售价还原）
o = data_rows(old["干员表"], 2, 7)
for (r, v), (_, ov) in zip(rows, o):
    exp_e = ov[6] if (ov[6] is not None and str(ov[6]).strip()) else ov[5]
    if str(v[5]) != str(ov[5]):
        problems.append("干员表 行%d 普通售价被改动 %s -> %s" % (r, ov[5], v[5]))
    if str(v[6]) != str(exp_e):
        problems.append("干员表 行%d 精锐售价 %s != %s" % (r, v[6], exp_e))
    if v[6] in (None, ""):
        problems.append("干员表 行%d 精锐售价为空" % r)

# 触发时机
print("触发时机分布:", Counter(v[12] for _, v in rows))

# ---------------- 道具表 ----------------
ws = new["道具表"]
rows = data_rows(ws, 2, ws.max_column)
s = data_rows(src["装备道具"], 7, 8)
if len(rows) != len(s):
    problems.append("道具表行数 %d != 源 %d" % (len(rows), len(s)))
for (r, v), (_, sv) in zip(rows, s):
    for label, a, b in (("名称", v[0], sv[1]), ("普通效果", v[1], sv[5]),
                        ("精锐效果", v[2], sv[6]), ("普通售价", v[3], sv[3]),
                        ("阶数", v[5], sv[0]), ("类型", v[6], sv[2])):
        if not eq(a, b):
            problems.append("道具表 行%d [%s] %r != 源 %r" % (r, label, a, b))
    adv = "" if sv[4] in (None, "") else sv[4]
    exp_adv = "—" if adv == "" else adv
    if not eq(v[4], exp_adv):
        problems.append("道具表 行%d [精锐售价] %r != %r" % (r, v[4], exp_adv))
    exp_fuse = "" if sv[7] in (None, "") else sv[7]
    if not eq(v[7], exp_fuse):
        problems.append("道具表 行%d [合成件数] %r != %r" % (r, v[7], exp_fuse))

# ---------------- 策略表 ----------------
ws = new["策略表"]
rows = data_rows(ws, 2, ws.max_column)
s = data_rows(src["策略"], 7, 8)
if len(rows) != len(s):
    problems.append("策略表行数 %d != 源 %d" % (len(rows), len(s)))
for (r, v), (_, sv) in zip(rows, s):
    for label, a, b in (("角色", v[0], sv[0]), ("策略", v[1], sv[1]), ("类别", v[2], sv[2]),
                        ("描述", v[3], sv[4]), ("生命值", v[4], sv[3]),
                        ("解锁", v[5], sv[5]), ("禁用", v[6], sv[6]), ("ID", v[7], sv[7])):
        if not eq(a, b):
            problems.append("策略表 行%d [%s] %r != 源 %r" % (r, label, a, b))

# ---------------- 盟约表 ----------------
ws = new["盟约表"]
rows = data_rows(ws, 2, ws.max_column)
s = data_rows(src["盟约"], 7, 6)
if len(rows) != len(s):
    problems.append("盟约表行数 %d != 源 %d" % (len(rows), len(s)))
for (r, v), (_, sv) in zip(rows, s):
    for label, a, b in (("名称", v[0], sv[0]), ("描述", v[1], sv[3]),
                        ("激活计数", v[2], sv[1]), ("条件", v[3], sv[2]),
                        ("成员名单", v[4], sv[4]), ("ID", v[6], sv[5])):
        if not eq(a, b):
            problems.append("盟约表 行%d [%s] %r != 源 %r" % (r, label, a, b))
    n = len([x for x in ("" if sv[4] is None else str(sv[4])).split("、") if x.strip()])
    if not eq(v[5], n):
        problems.append("盟约表 行%d [成员数] %r != %d" % (r, v[5], n))

# ---------------- 新增三表 ----------------
ws = new["合成配方"]
rows = data_rows(ws, 2, 6)
s = data_rows(src["合成配方"], 7, 6)
if len(rows) != len(s):
    problems.append("合成配方行数不符")
for (r, v), (_, sv) in zip(rows, s):
    for k in range(6):
        if not eq(v[k], sv[k]):
            problems.append("合成配方 行%d 列%d %r != %r" % (r, k + 1, v[k], sv[k]))

ws = new["指令阶段"]
rows = data_rows(ws, 2, 11)
s = data_rows(src["指令阶段"], 7, 11)
if len(rows) != len(s):
    problems.append("指令阶段行数不符")
for (r, v), (_, sv) in zip(rows, s):
    for k in range(11):
        if not eq(v[k], sv[k]):
            problems.append("指令阶段 行%d 列%d %r != %r" % (r, k + 1, v[k], sv[k]))

ws = new["补给增益"]
rows = data_rows(ws, 2, 3)
s = data_rows(src["补给增益"], 7, 3)
if len(rows) != len(s):
    problems.append("补给增益行数不符")
for (r, v), (_, sv) in zip(rows, s):
    for k in range(3):
        if not eq(v[k], sv[k]):
            problems.append("补给增益 行%d 列%d %r != %r" % (r, k + 1, v[k], sv[k]))

# ---------------- 格式 ----------------
for name in expect:
    ws = new[name]
    if ws.freeze_panes != "A2":
        problems.append("%s 未冻结首行" % name)
    if not ws.auto_filter.ref:
        problems.append("%s 无筛选" % name)
    if ws.max_row < 2:
        problems.append("%s 无数据" % name)
print("\n修订记录行数:", new["修订记录"].max_row - 1)
print("总比对断言:", checks)

print("\n" + "=" * 70)
if problems:
    print("发现 %d 个问题:" % len(problems))
    for p in problems[:80]:
        print("  !", p)
else:
    print("校验通过：全部字段与解包源逐字一致，结构/一致性检查无异常。")
src.close(); new.close(); old.close()

