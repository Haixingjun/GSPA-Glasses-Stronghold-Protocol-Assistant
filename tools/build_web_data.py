# -*- coding: utf-8 -*-
"""
卫戍协议数据表.xlsx  ->  web/data/data.json + data.js + 校验/变更报告

用法：
    python tools/build_web_data.py

原则：
    1. 唯一可编辑源是「卫戍协议数据表.xlsx」，本脚本只读不写。
    2. 先校验，后导出；有 ERROR 时不产出数据文件（避免把坏数据发上线）。
    3. 所有规则性字段（盟约激活方式/阈值/强化条件）都写进 JSON，前端不写死。
"""
import sys, io, os, re, json, time, hashlib, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

try:
    from openpyxl import load_workbook
except ImportError:
    print("缺少 openpyxl。请先 pip install openpyxl，或用带该依赖的 Python 运行：")
    print("    python tools/build_web_data.py")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "卫戍协议数据表.xlsx")
OUT_DIR = os.path.join(ROOT, "web", "data")
BUILD_DIR = os.path.join(ROOT, "build")
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(BUILD_DIR, exist_ok=True)

TIERS = ["I", "II", "III", "IV", "V", "VI"]
LAYER_CV = {"迅捷", "灵巧", "远见", "奇迹", "投资人", "突袭"}
SPECIAL_CV = {"调和", "独行", "协防干员"}
ELITE_CV = {"绝技"}

# 盟约分类是编辑口径，不写死在代码里：data/covenant_meta.json 维护
#   rank:    core（核心盟约/主） | additional（附加盟约/副）
#   family:  faction（阵营） | combat（战斗） | growth（成长） | special（特殊）
#   functions: output/survival/sustain/stack/economy/summon/rule
COV_RANK = {"core", "additional"}
COV_FAMILY = {"faction", "combat", "growth", "special"}
COV_FUNC = {"output", "survival", "sustain", "stack", "economy", "summon", "rule"}
COV_RANK_LABEL = {"core": "核心（主）", "additional": "附加（副）"}
COV_FAMILY_LABEL = {"faction": "阵营", "combat": "战斗", "growth": "成长", "special": "特殊"}
COV_FUNC_LABEL = {
    "output": "输出", "survival": "生存", "sustain": "续航", "stack": "叠层",
    "economy": "经济", "summon": "召唤", "rule": "规则",
}
COV_META_PATH = os.path.join(ROOT, "data", "covenant_meta.json")

errors, warnings = [], []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def txt(v):
    if v is None:
        return ""
    return str(v).strip()


def rows(ws):
    out = []
    for r in range(2, ws.max_row + 1):
        vals = [ws.cell(row=r, column=c).value for c in range(1, ws.max_column + 1)]
        if all(v in (None, "") for v in vals):
            continue
        out.append([txt(v) for v in vals])
    return out


def header(ws):
    return [txt(ws.cell(row=1, column=c).value) for c in range(1, ws.max_column + 1)]


def need_header(ws, expect):
    got = header(ws)
    if got[:len(expect)] != expect:
        err("表「%s」表头不符：期望 %s，实际 %s" % (ws.title, expect, got))
        return False
    return True


def int_or(v):
    try:
        return int(float(v))
    except Exception:
        return None


# ---------------------------------------------------------------- 读表
wb = load_workbook(SRC, data_only=True)

need_header(wb["干员表"], ["干员名称", "阶数", "特性", "特殊说明（普通）", "特殊说明（精锐）",
                          "售价", "盟约一", "盟约二", "盟约三", "条目类型", "隐藏",
                          "触发时机（普通）", "触发时机（精锐）"])
need_header(wb["道具表"], ["道具名称", "普通效果", "精锐效果", "普通售价", "精锐售价",
                          "阶数", "类型", "合成进阶所需件数"])
need_header(wb["策略表"], ["角色", "策略", "类别", "策略描述", "生命值", "解锁条件", "禁用模式", "策略ID"])
need_header(wb["盟约表"], ["盟约名称", "盟约描述", "激活计数", "条件原值", "成员名单", "成员数", "盟约ID"])
need_header(wb["合成配方"], ["材料一", "材料一阶数", "材料二", "材料二阶数", "合成成品", "成品效果"])
need_header(wb["指令阶段"], ["角色", "策略", "阶段序号", "状态", "配置费用", "使用次数规则",
                          "阶段效果", "升级条件类型", "条件参数", "下一阶段ID", "当前阶段ID"])
need_header(wb["补给增益"], ["名称", "效果", "效果ID"])

if errors:
    print("\n".join(errors))
    sys.exit(1)

OP = rows(wb["干员表"])
ITEM = rows(wb["道具表"])
STRAT = rows(wb["策略表"])
COV = rows(wb["盟约表"])
FUSE = rows(wb["合成配方"])
STAGE = rows(wb["指令阶段"])
BUFF = rows(wb["补给增益"])

expect = {"干员表": (OP, 155), "道具表": (ITEM, 70), "策略表": (STRAT, 61), "盟约表": (COV, 26),
          "合成配方": (FUSE, 5), "指令阶段": (STAGE, 74), "补给增益": (BUFF, 31)}
for name, (data, n) in expect.items():
    if len(data) != n:
        err("%s 行数为 %d，期望 %d（表结构可能变了）" % (name, len(data), n))

COV_NAMES = {r[0] for r in COV}
OP_NAMES = {r[0] for r in OP}
ITEM_NAMES = {r[0] for r in ITEM}

# 盟约分类元数据：缺文件/缺条目直接报错，避免前端拿到半套分类。
COV_META = {}
if not os.path.exists(COV_META_PATH):
    err("缺少盟约分类文件 data/covenant_meta.json")
else:
    try:
        with open(COV_META_PATH, encoding="utf-8") as f:
            _meta = json.load(f)
        if not isinstance(_meta, dict):
            err("data/covenant_meta.json 顶层必须是对象")
        else:
            COV_META = _meta
    except Exception as e:
        err("data/covenant_meta.json 读取失败：%s" % e)

for _name in sorted(set(COV_META) - COV_NAMES):
    warn("盟约分类文件里的「%s」不在盟约表（跨期残留？）" % _name)
for _name in sorted(COV_NAMES - set(COV_META)):
    err("盟约「%s」缺少分类（data/covenant_meta.json）" % _name)

# 头像清单（可选）：data/avatars.json = {"幽灵鲨": {"list": "assets/avatars/youlingxia-96.webp",
#                                                   "full": "assets/avatars/youlingxia-256.webp",
#                                                   "source": "prts", "license": "official-art"}}
# 没有清单时 avatar 为 null，前端自动回退到「色块 + 首字」。
AVATAR_MANIFEST = os.path.join(ROOT, "data", "avatars.json")
AVATARS = {}
if os.path.exists(AVATAR_MANIFEST):
    try:
        with open(AVATAR_MANIFEST, encoding="utf-8") as f:
            AVATARS = json.load(f)
    except Exception as e:
        warn("头像清单读取失败：%s" % e)
    for name, meta in AVATARS.items():
        if name not in OP_NAMES:
            warn("头像清单中的「%s」不在干员表" % name)
            continue
        for k in ("list", "full"):
            p = meta.get(k)
            if p and not os.path.exists(os.path.join(ROOT, "web", p)):
                warn("头像文件缺失：%s -> %s" % (name, p))

# 图标清单（可选）：data/icons.json = {"season": "卫戍协议·规程",
#     "items": {"维式重锤": {"list": "assets/icons/it-xxx-64.webp", ...}}, ...}
# 只给「本期·规程」的道具 / 策略发起人 / 盟约图标；缺图时 icon 为 null，前端回退色块首字。
ICON_MANIFEST = os.path.join(ROOT, "data", "icons.json")
ICONS = {"items": {}, "strategies": {}, "covenants": {}}
if os.path.exists(ICON_MANIFEST):
    try:
        with open(ICON_MANIFEST, encoding="utf-8") as f:
            _icons = json.load(f)
        for cat in ICONS:
            if isinstance(_icons.get(cat), dict):
                ICONS[cat] = _icons[cat]
        if _icons.get("season") and _icons.get("season") != "卫戍协议·规程":
            warn("图标清单的赛季是「%s」，与本项目「卫戍协议·规程」不一致" % _icons.get("season"))
    except Exception as e:
        warn("图标清单读取失败：%s" % e)
    for cat in ICONS:
        for key, meta in ICONS[cat].items():
            for k in ("list", "full"):
                p = meta.get(k)
                if p and not os.path.exists(os.path.join(ROOT, "web", p)):
                    warn("图标文件缺失：%s/%s -> %s" % (cat, key, p))


def icon_meta(cat, key):
    return ICONS.get(cat, {}).get(key) or {}


def split_tags(*vals):
    out = []
    for v in vals:
        v = txt(v)
        if v and v not in out:
            out.append(v)
    return out


def split_triggers(v):
    v = txt(v)
    if not v or v in ("—", "无"):
        return []
    return [x.strip() for x in re.split(r"[+＋]", v) if x.strip() and x.strip() not in ("—", "无")]


# ---------------------------------------------------------------- 干员
operators = []
for i, r in enumerate(OP):
    name, tier, feat, normal, elite, price, t1, t2, t3, typ, hidden, trg_n, trg_e = r[:13]
    price = int_or(price)
    if tier not in TIERS:
        err("干员「%s」阶数非法：%r" % (name, tier))
    if price is None or not (1 <= price <= 4):
        err("干员「%s」售价非法：%r" % (name, price))
    tags = split_tags(t1, t2, t3)
    for t in tags:
        if t not in COV_NAMES:
            err("干员「%s」的盟约「%s」不在盟约表" % (name, t))
    if feat and "/".join(tags) != feat:
        warn("干员「%s」特性列与盟约列不一致：%s vs %s" % (name, feat, "/".join(tags)))
    if not normal or not elite:
        err("干员「%s」普通/精锐效果为空" % name)
    operators.append({
        "key": name, "name": name,
        "tier": TIERS.index(tier) + 1, "tierLabel": tier,
        "tags": tags, "type": typ,
        "hidden": hidden == "是",
        "price": price,
        "normalText": normal, "eliteText": elite,
        "normalTrigger": trg_n or "—", "eliteTrigger": trg_e or "—",
        "normalTriggers": split_triggers(trg_n), "eliteTriggers": split_triggers(trg_e),
        "avatar": (AVATARS.get(name) or {}).get("list"),
        "avatarFull": (AVATARS.get(name) or {}).get("full"),
    })

names = [o["name"] for o in operators]
if len(set(names)) != len(names):
    err("干员存在重名：%s" % [n for n in set(names) if names.count(n) > 1])

# ---------------------------------------------------------------- 道具
items = []
for r in ITEM:
    name, normal, elite, p1, p2, tier, typ, fuse = r[:8]
    p1 = int_or(p1)
    tier = int_or(tier)
    elite_price = None if p2 in ("", "—") else int_or(p2)
    if tier is None or not (1 <= tier <= 6):
        err("道具「%s」阶数非法：%r" % (name, tier))
    if p1 is None:
        err("道具「%s」普通售价非法" % name)
    if p2 not in ("", "—") and elite_price is None:
        err("道具「%s」精锐售价非法：%r" % (name, p2))
    if typ not in ("装备", "消耗道具", "合成成品"):
        err("道具「%s」类型非法：%r" % (name, typ))
    if not normal:
        err("道具「%s」普通效果为空" % name)
    items.append({
        "key": name, "name": name, "type": typ, "tier": tier,
        "price": p1, "elitePrice": elite_price,
        "normalText": normal, "eliteText": elite or "未配置独立进阶形态",
        "hasElite": p2 not in ("", "—"),
        "fuseCount": int_or(fuse),
        "icon": icon_meta("items", name).get("list"),
        "iconFull": icon_meta("items", name).get("full"),
    })

names = [x["name"] for x in items]
if len(set(names)) != len(names):
    err("道具存在重名：%s" % [n for n in set(names) if names.count(n) > 1])

# ---------------------------------------------------------------- 策略 + 阶段
stages_by = {}
for r in STAGE:
    role, sname, seq, state, cost, rule, eff, uptype, param, nxt, cur = r[:11]
    stages_by.setdefault(role + "/" + sname, []).append({
        "seq": int_or(seq) or 0, "state": state, "cost": cost,
        "rule": rule, "effect": eff,
        "upgradeType": uptype, "param": param, "nextId": nxt, "id": cur,
    })

strategies = []
for r in STRAT:
    role, name, cat, desc, hp, unlock, banned, sid = r[:8]
    key = role + "/" + name
    hp = int_or(hp)
    if hp is None or not (1 <= hp <= 100):
        err("策略「%s」生命值非法：%r" % (key, hp))
    if cat not in ("通用策略", "盟约策略"):
        err("策略「%s」类别非法：%r" % (key, cat))
    st = sorted(stages_by.get(key, []), key=lambda x: x["seq"])
    if not st:
        warn("策略「%s」没有指令阶段记录" % key)
    strategies.append({
        "key": key, "role": role, "name": name, "category": cat,
        "hp": hp, "text": desc, "unlock": unlock, "banned": banned,
        "stages": st,
        "icon": icon_meta("strategies", role).get("list"),
        "iconFull": icon_meta("strategies", role).get("full"),
    })

roles = [s["role"] for s in strategies]
if len(set(roles)) != len(roles):
    err("策略角色存在重复：%s" % [n for n in set(roles) if roles.count(n) > 1])

# ---------------------------------------------------------------- 盟约
NUM_RE = re.compile(r"(\d+)")


def parse_members(s):
    out = []
    for part in re.split(r"[、,，]", s):
        part = part.strip()
        if not part:
            continue
        part = re.sub(r"[（(]\s*\d+\s*阶\s*[）)]\s*$", "", part).strip()
        out.append(part)
    return out


covenants = []
for r in COV:
    name, desc, count, cond, members_raw, mcount, cid = r[:7]
    count = int_or(count)
    mcount = int_or(mcount)
    tags = [x.strip() for x in re.findall(r"<([^<>]+)>", desc)]
    nums = []
    for t in tags:
        for n in NUM_RE.findall(t):
            n = int(n)
            if n not in nums:
                nums.append(n)
    nums.sort()

    if name in ELITE_CV:
        kind = "elite"
    elif name in LAYER_CV:
        # 这 6 个盟约仍然是「按人数激活」，层数只决定强化档位
        kind = "count_layer"
    elif name in SPECIAL_CV:
        kind = "special"
    else:
        kind = "count"

    members = parse_members(members_raw)
    for m in members:
        if m not in OP_NAMES:
            warn("盟约「%s」成员「%s」不在干员表" % (name, m))
    if mcount is not None and len(members) != mcount:
        warn("盟约「%s」成员数标注 %s，实际解析 %d" % (name, mcount, len(members)))
    if count is None:
        err("盟约「%s」激活计数非法" % name)

    nodes = []
    if kind == "count_layer":
        nodes = nums
    elif kind == "elite":
        nodes = nums or [2, 5]

    # 官方口径：核心盟约=阵营，附加盟约=能力。
    meta = COV_META.get(name) or {}
    rank = meta.get("rank")
    family = meta.get("family")
    functions = meta.get("functions")
    if rank not in COV_RANK:
        err("盟约「%s」层级非法：%r" % (name, rank))
        rank = "additional"
    if family not in COV_FAMILY:
        err("盟约「%s」子类非法：%r" % (name, family))
        family = "special"
    if not isinstance(functions, list) or not functions:
        err("盟约「%s」功能标签为空或非法：%r" % (name, functions))
        functions = []
    else:
        for fn in functions:
            if fn not in COV_FUNC:
                err("盟约「%s」功能标签「%s」非法" % (name, fn))

    # 强化人数从描述里的「在场N名…」取；特殊盟约（调和/协防/独行）没有统一人数强化。
    emp_nums = []
    if kind != "special":
        for t in tags:
            for n in re.findall(r"在场(\d+)名", t):
                emp_nums.append(int(n))
    empower_threshold = max(emp_nums) if emp_nums else None

    covenants.append({
        "key": cid or name, "id": cid, "name": name, "desc": desc,
        "rank": rank, "family": family, "functions": functions,
        "activation": {
            "kind": kind, "threshold": count, "nodes": nodes,
            "empower": tags, "empowerThreshold": empower_threshold,
        },
        "cond": cond, "members": members, "memberCount": len(members),
        # 只有 BOARD_AND_DECK 才把整备区计入激活；卡西米尔是 BOARD，
        # 它的「整备区」只出现在 6 人强化的召唤效果里。
        "garrison": cond == "BOARD_AND_DECK",
        "icon": icon_meta("covenants", cid or name).get("list"),
        "iconFull": icon_meta("covenants", cid or name).get("full"),
    })

if len(covenants) != 26:
    err("盟约数为 %d" % len(covenants))

rank_counts = collections.Counter(c["rank"] for c in covenants)
family_counts = collections.Counter(c["family"] for c in covenants)
if rank_counts.get("core") != 10 or rank_counts.get("additional") != 16:
    err("盟约层级数量不符：核心 %d / 附加 %d（期望 10 / 16）" %
        (rank_counts.get("core", 0), rank_counts.get("additional", 0)))
if family_counts.get("faction") != 10 or family_counts.get("combat") != 6 \
        or family_counts.get("growth") != 6 or family_counts.get("special") != 4:
    err("盟约子类数量不符：阵营 %d / 战斗 %d / 成长 %d / 特殊 %d（期望 10 / 6 / 6 / 4）" %
        (family_counts.get("faction", 0), family_counts.get("combat", 0),
         family_counts.get("growth", 0), family_counts.get("special", 0)))
for c in covenants:
    if c["rank"] == "core" and c["family"] != "faction":
        err("核心盟约「%s」的子类必须是 faction，实际 %s" % (c["name"], c["family"]))
    if c["rank"] == "additional" and c["family"] == "faction":
        err("附加盟约「%s」不应使用 faction 子类" % c["name"])

# 图标清单的键必须能在本期数据里找到；多出来的多半是跨期残留
for k in sorted(set(ICONS["items"]) - ITEM_NAMES):
    warn("图标清单里的道具「%s」不在道具表（跨期残留？）" % k)
for k in sorted(set(ICONS["strategies"]) - {s["role"] for s in strategies}):
    warn("图标清单里的策略角色「%s」不在策略表（跨期残留？）" % k)
for k in sorted(set(ICONS["covenants"]) - {(c["id"] or c["name"]) for c in covenants}):
    warn("图标清单里的盟约「%s」不在盟约表（跨期残留？）" % k)

# ---------------------------------------------------------------- 配方 / 增益
fusions = []
for r in FUSE:
    m1, r1, m2, r2, res, eff = r[:6]
    for n in (m1, m2, res):
        if n not in ITEM_NAMES:
            err("配方引用了不存在的道具「%s」" % n)
    fusions.append({
        "key": res, "m1": m1, "m1Tier": int_or(r1), "m2": m2, "m2Tier": int_or(r2),
        "result": res, "effect": eff,
    })

buffs = [{"key": r[2] or r[0], "name": r[0], "effect": r[1], "id": r[2]} for r in BUFF]

# ---------------------------------------------------------------- 装配
mtime = os.path.getmtime(SRC)
version = time.strftime("%Y-%m-%d %H:%M", time.localtime(mtime))
payload = {
    "version": version,
    "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    "source": os.path.basename(SRC),
    "counts": {
        "operators": len(operators), "items": len(items), "strategies": len(strategies),
        "covenants": len(covenants), "fusions": len(fusions),
        "stages": sum(len(s["stages"]) for s in strategies), "buffs": len(buffs),
    },
    "tiers": TIERS,
    "operators": operators,
    "items": items,
    "strategies": strategies,
    "covenants": covenants,
    "fusions": fusions,
    "buffs": buffs,
}

# ---------------------------------------------------------------- 报告
def dist(keyfn, seq):
    d = {}
    for x in seq:
        k = keyfn(x)
        d[k] = d.get(k, 0) + 1
    return "、".join("%s %d" % (k, v) for k, v in sorted(d.items(), key=lambda kv: str(kv[0])))


lines = []
lines.append("# 数据校验报告\n")
lines.append("- 源文件：`%s`" % os.path.basename(SRC))
lines.append("- 数据版本：%s" % version)
lines.append("- 生成时间：%s" % payload["generatedAt"])
lines.append("- 结果：%s\n" % ("**通过**" if not errors else "**失败（%d 个错误）**" % len(errors)))
lines.append("| 表 | 行数 | 基线 | 状态 |")
lines.append("| --- | --- | --- | --- |")
for name, (data, n) in expect.items():
    lines.append("| %s | %d | %d | %s |" % (name, len(data), n, "✅" if len(data) == n else "❌"))
lines.append("")
lines.append("## 分布\n")
lines.append("- 阶数：" + dist(lambda o: o["tierLabel"], operators))
lines.append("- 售价：" + dist(lambda o: o["price"], operators))
lines.append("- 条目类型：" + dist(lambda o: o["type"], operators))
lines.append("- 触发时机：" + dist(lambda o: o["normalTrigger"], operators))
lines.append("- 道具类型：" + dist(lambda o: o["type"], items))
lines.append("- 道具阶数：" + dist(lambda o: o["tier"], items))
lines.append("- 策略类别：" + dist(lambda s: s["category"], strategies))
lines.append("- 盟约层级：" + dist(lambda c: COV_RANK_LABEL.get(c["rank"], c["rank"]), covenants))
lines.append("- 盟约子类：" + dist(lambda c: COV_FAMILY_LABEL.get(c["family"], c["family"]), covenants))
func_counts = collections.Counter(fn for c in covenants for fn in c["functions"])
lines.append("- 盟约功能：" + "、".join("%s %d" % (COV_FUNC_LABEL[k], func_counts[k])
    for k in ["output", "survival", "sustain", "stack", "economy", "summon", "rule"]))
lines.append("- 盟约方式：" + dist(lambda c: c["activation"]["kind"], covenants))
lines.append("- 整备区可计入：" + dist(lambda c: "是" if c["garrison"] else "否", covenants))
lines.append("- 图标覆盖：道具 %d/%d、策略 %d/%d、盟约 %d/%d" % (
    sum(1 for x in items if x["icon"]), len(items),
    sum(1 for x in strategies if x["icon"]), len(strategies),
    sum(1 for x in covenants if x["icon"]), len(covenants)))
lines.append("")
lines.append("## 错误\n")
lines.append("\n".join("- " + e for e in errors) if errors else "无")
lines.append("\n## 警告\n")
lines.append("\n".join("- " + w for w in warnings) if warnings else "无")
report = "\n".join(lines) + "\n"

with open(os.path.join(BUILD_DIR, "validation_report.md"), "w", encoding="utf-8") as f:
    f.write(report)

print(report)
if errors:
    print("有错误，未写出数据文件。")
    sys.exit(1)

# ---------------------------------------------------------------- 变更对比
def flatten(seq, fields):
    return {x["key"]: {f: x.get(f) for f in fields} for x in seq}

prev_path = os.path.join(OUT_DIR, "data.json")
prev = None
if os.path.exists(prev_path):
    try:
        with open(prev_path, encoding="utf-8") as f:
            prev = json.load(f)
    except Exception as e:
        warn("旧 data.json 读取失败：%s" % e)

diff_lines = ["# 数据变更报告\n"]
if not prev:
    diff_lines.append("首次生成，无历史版本可比对。\n")
else:
    diff_lines.append("对比基准：上一版 `data.json`（%s）\n" % prev.get("version", "?"))
    groups = [
        ("干员", "operators", ["tierLabel", "tags", "type", "hidden", "price", "normalText", "eliteText"]),
        ("道具", "items", ["type", "tier", "price", "elitePrice", "normalText", "eliteText"]),
        ("策略", "strategies", ["role", "name", "category", "hp", "text"]),
        ("盟约", "covenants", ["name", "desc", "rank", "family", "functions", "members"]),
    ]
    total = 0
    for label, key, fields in groups:
        a = flatten(prev.get(key, []), fields)
        b = flatten(payload[key], fields)
        added = [k for k in b if k not in a]
        removed = [k for k in a if k not in b]
        changed = []
        for k in b:
            if k in a:
                for f in fields:
                    old, new = a[k].get(f), b[k].get(f)
                    if old != new:
                        changed.append((k, f, old, new))
        total += len(added) + len(removed) + len(changed)
        diff_lines.append("## %s：新增 %d / 删除 %d / 修改 %d\n" % (label, len(added), len(removed), len(changed)))
        for k in added[:50]:
            diff_lines.append("- ➕ `%s`" % k)
        for k in removed[:50]:
            diff_lines.append("- ➖ `%s`" % k)
        for k, f, old, new in changed[:50]:
            diff_lines.append("- ✏️ `%s` · %s：`%s` → `%s`" % (k, f, str(old)[:60], str(new)[:60]))
        diff_lines.append("")
    diff_lines.append("合计变更 **%d** 处。\n" % total)

with open(os.path.join(BUILD_DIR, "diff_report.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(diff_lines))

# ---------------------------------------------------------------- 写出
with open(os.path.join(OUT_DIR, "data.json"), "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=1)

js = "/* 由 tools/build_web_data.py 生成，请勿手改 */\nwindow.GARRISON_DATA = " + \
     json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
with open(os.path.join(OUT_DIR, "data.js"), "w", encoding="utf-8") as f:
    f.write(js)

size_kb = os.path.getsize(os.path.join(OUT_DIR, "data.js")) / 1024
print("已写出 web/data/data.json、web/data/data.js（%.1f KB）" % size_kb)
print("校验：%d 错误 / %d 警告" % (len(errors), len(warnings)))
