# -*- coding: utf-8 -*-
"""
根据解包数据表（卫戍协议_完整数据表.xlsx）重建 卫戍协议数据表.xlsx。

用法
----
    python tools/build_data_workbook.py         # 生成 work/out/卫戍协议数据表.xlsx
    python tools/verify_workbook.py             # 与解包源逐字段校验
    copy work\\out\\卫戍协议数据表.xlsx 卫戍协议数据表.xlsx   # 校验通过后再覆盖

原则
----
1. 所有解包中存在的文本字段，逐字采用解包原文（不做"美化"、不补同义词）。
2. 解包未提供的字段（干员售价）保留原表数值，并在「修订记录」中标注为未校验。
3. 结构以原表 4 张表为基础，仅"追加"列；解包中另有而原表缺失的 3 张表新增。
4. 全部改动写入「修订记录」工作表，可逐条复核。
"""
import sys, io, os, re, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

SRC_PATH = "source/卫戍协议_完整数据表.xlsx"
OUT_PATH = "work/out/卫戍协议数据表.xlsx"
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

# 基线（改动前原表）：默认取 bak/ 下最新的备份，保证重复运行得到同一份「修订记录」
import glob
if len(sys.argv) > 1:
    OLD_PATH = sys.argv[1]
else:
    _cands = sorted(glob.glob("source/卫戍协议数据表_*.xlsx"))
    OLD_PATH = _cands[-1] if _cands else "卫戍协议数据表.xlsx"

ROMAN = {1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI"}
SRC_NOTE = ("数据来源：官方 Android 热更新 26-11-06-12-56-09-07186384；本期 V3_1；"
            "https://ak.hycdn.cn/assetbundle/official/Android/assets/26-11-06-12-56-09-07186384/hot_update_list.json")

src = load_workbook(SRC_PATH, data_only=True)
old = load_workbook(OLD_PATH, data_only=True)


def srow(ws, start, ncols):
    """读取整表数据行（跳过全空行），返回 list[list]"""
    out = []
    for r in range(start, ws.max_row + 1):
        vals = [ws.cell(row=r, column=c).value for c in range(1, ncols + 1)]
        if all(v is None for v in vals):
            continue
        out.append(vals)
    return out


def txt(v):
    return "" if v is None else str(v)


# 基线表头守卫：防止误用「已重建的表」当基线导致列错位
EXPECT_HDR = {
    "干员表": ["干员名称", "阶数", "特性", "特殊说明（普通）", "特殊说明（精锐）", "普通售价", "精锐售价"],
    "道具表": ["道具名称", "普通效果", "精锐效果", "普通售价", "精锐售价"],
    "策略表": ["策略名称", "策略描述", "生命值"],
    "盟约表": ["盟约名称", "盟约描述"],
}
for _s, _h in EXPECT_HDR.items():
    _got = [txt(old[_s].cell(row=1, column=c).value) for c in range(1, len(_h) + 1)]
    if _got == _h:
        continue
    # 允许基线末尾列整列为空（本次会话中该文件曾被外部程序清空「精锐售价」整列）
    if _got[:-1] == _h[:-1] and _got[-1] == "":
        print("注意: 基线表 %s 的「%s」列已为空，按缺失处理" % (_s, _h[-1]))
        continue
    sys.exit("基线表 %s 表头不符：%s\n请指定改动前的原表：python %s <原表.xlsx>"
             % (_s, _got, sys.argv[0]))
print("基线:", OLD_PATH)


def leading_tags(s):
    """取单元格开头连续的 <...> 触发标记。"""
    s = txt(s)
    if not s:
        return ""
    tags, i = [], 0
    while True:
        m = re.match(r"\s*<([^<>]+)>", s[i:])
        if not m:
            break
        t = m.group(1).strip()
        if t not in tags:
            tags.append(t)
        i += m.end()
    return "+".join(tags) if tags else "无"


PUNCT = set("，。；：、（）()【】“”\"'‘’　 \n\t")
DIFF_PUNCT = set("，,；;：:。.、")


def skeleton(s):
    s = txt(s)
    for ch in PUNCT:
        s = s.replace(ch, "")
    return "".join("，" if ch in DIFF_PUNCT else ch for ch in s)


def classify(a, b):
    """判断变更类型。"""
    a, b = txt(a), txt(b)
    if not a.strip() and b.strip():
        return "补齐缺失"
    if skeleton(a) == skeleton(b):
        return "格式对齐"
    return "错误修正"


# ------------------------------------------------------------------ 源数据
SRC_OP = srow(src["干员与特质"], 7, 8)     # 阶,名称,盟约1,2,3,普通,精锐,类型
SRC_ITEM = srow(src["装备道具"], 7, 8)     # 阶,名称,类型,基础价,进阶价,基础效果,进阶效果,件数
SRC_STRAT = srow(src["策略"], 7, 8)        # 角色,策略,类别,生命,效果,解锁,禁用,ID
SRC_COV = srow(src["盟约"], 7, 6)          # 名称,计数,条件,效果,成员,ID
SRC_FUSE = srow(src["合成配方"], 7, 6)     # 材料一,阶,材料二,阶,成品,成品效果
SRC_STAGE = srow(src["指令阶段"], 7, 11)   # 角色,策略,序号,状态,费用,次数,效果,升级类型,参数,下一ID,当前ID
SRC_BUFF = srow(src["补给增益"], 7, 3)     # 名称,效果,ID

print("源数据行数: 干员%d 道具%d 策略%d 盟约%d 配方%d 阶段%d 增益%d"
      % (len(SRC_OP), len(SRC_ITEM), len(SRC_STRAT), len(SRC_COV),
         len(SRC_FUSE), len(SRC_STAGE), len(SRC_BUFF)))

# 原表数据
OLD_OP = srow(old["干员表"], 2, 7)
OLD_ITEM = srow(old["道具表"], 2, 5)
OLD_STRAT = srow(old["策略表"], 2, 3)
OLD_COV = srow(old["盟约表"], 2, 2)
assert len(OLD_OP) == len(SRC_OP), (len(OLD_OP), len(SRC_OP))
assert len(OLD_ITEM) == len(SRC_ITEM)
assert len(OLD_STRAT) == len(SRC_STRAT)
assert len(OLD_COV) == len(SRC_COV)

# 检测原表「精锐售价」列是否整体为空（本次会话中该列曾被外部程序清空）
ELITE_PRICE_LOST = all(txt(r[6]).strip() == "" for r in OLD_OP)
print("原表「精锐售价」列整体为空:", ELITE_PRICE_LOST)

CHANGES = []   # (表, 行号, 条目, 字段, 原值, 新值, 类型, 说明)


def add_change(sheet, row, name, field, a, b, ctype=None, note=""):
    CHANGES.append([sheet, row, name, field, txt(a), txt(b),
                    ctype or classify(a, b), note])


# ------------------------------------------------------------------ 干员表
op_rows = []
for i, s in enumerate(SRC_OP):
    rank, name, c1, c2, c3, normal, elite, kind = s
    rank = int(rank) if isinstance(rank, (int, float)) else rank
    is_flex = txt(kind) == "自选配置"
    is_hidden = txt(name) in ("盟约·辅助干员", "“暴躁铁皮”")
    o = OLD_OP[i]
    # 售价：解包无此数据，沿用原表；原表「精锐售价」若为空则按「普通售价」还原
    price_n = o[5]
    price_e = o[6] if txt(o[6]).strip() else price_n
    note_parts = []
    if is_flex:
        normal_t, elite_t = "按自选干员配置", "按自选干员配置"
        trig_n = trig_e = "—"
        note_parts.append("解包「普通特质」字段为占位符 error，此处按精锐栏口径填「按自选干员配置」；"
                          "盟约随所选自选干员而定")
    else:
        normal_t, elite_t = txt(normal), txt(elite)
        trig_n, trig_e = leading_tags(normal_t), leading_tags(elite_t)
    if is_hidden:
        note_parts.append("隐藏干员（该标注沿用原表，解包数据无此字段）")

    # 生成校对备注
    fixed = []
    if txt(o[0]) != txt(name) and not is_flex:
        fixed.append("名称")
    if txt(o[1]) != ROMAN.get(rank, rank):
        fixed.append("阶数")
    if txt(o[2]) != "/".join([x for x in (txt(c1), txt(c2), txt(c3)) if x]) and not is_flex:
        fixed.append("特性")
    if txt(o[3]) != normal_t and not is_flex:
        fixed.append("普通特质")
    if txt(o[4]) != elite_t and not is_flex:
        fixed.append("精锐特质")
    if fixed:
        note_parts.insert(0, "已按解包校对：" + "、".join(fixed))

    op_rows.append([txt(name), ROMAN.get(rank, rank),
                    "/".join([x for x in (txt(c1), txt(c2), txt(c3)) if x]),
                    normal_t, elite_t, price_n, price_e,
                    txt(c1), txt(c2), txt(c3), txt(kind),
                    "是" if is_hidden else "否", trig_n, trig_e,
                    "；".join(note_parts)])

    # 变更记录
    r = i + 2
    if not is_flex:
        name_note = ""
        if txt(o[0]) != txt(name):
            if txt(o[0]) == "铜":
                name_note = "形近字误录，解包为「锏」"
            elif txt(o[0]) == "阿米娅":
                name_note = "漏「（医疗形态）」后缀，与策略表「阿米娅」重名"
            elif txt(o[0]).endswith("（隐藏）"):
                name_note = "「（隐藏）」为原表后缀标注，已移入独立「隐藏」列"
        for field, a, b in (("干员名称", o[0], name), ("阶数", o[1], ROMAN.get(rank, rank)),
                            ("特性", o[2], "/".join([x for x in (txt(c1), txt(c2), txt(c3)) if x])),
                            ("特殊说明（普通）", o[3], normal_t),
                            ("特殊说明（精锐）", o[4], elite_t)):
            if txt(a) != txt(b):
                add_change("干员表", r, name, field, a, b,
                           "标注调整" if field == "干员名称" and txt(a).endswith("（隐藏）") else None,
                           name_note if field == "干员名称" else "")

# 补充：原表将「隐藏」写进名称
for i, s in enumerate(SRC_OP):
    o = OLD_OP[i]
    if txt(o[0]).endswith("（隐藏）"):
        add_change("干员表", i + 2, s[1], "隐藏", "（无此列）", "是", "结构新增",
                   "「（隐藏）」由名称后缀改为独立标记列")

# 自选配置 12 行：名称/特性/特质口径统一（成组记录）
add_change("干员表", "125-130", "自选配置 5阶-1~6", "干员名称",
           "自选调配干员（槽位1~6）", "自选配置 5阶-1~6", "名称规范",
           "原表 5/6 阶两批同名造成重名，改用解包名称；「特性」置空（解包无盟约），"
           "「特殊说明」按精锐栏口径统一为「按自选干员配置」")
add_change("干员表", "151-156", "自选配置 6阶-1~6", "干员名称",
           "自选调配干员（槽位1~6）", "自选配置 6阶-1~6", "名称规范",
           "同上")

if ELITE_PRICE_LOST:
    add_change("干员表", "2-156", "全部干员", "精锐售价", "（整列为空）",
               "同「普通售价」", "还原缺失",
               "整理期间该表被外部程序保存过一次，「精锐售价」整列（含表头）变为空白；"
               "按整理前快照及《卫戍协议小助手-方案.md》记录（155 行两列数值完全相同）还原")

# ------------------------------------------------------------------ 道具表
item_rows = []
for i, s in enumerate(SRC_ITEM):
    rank, name, typ, base_p, adv_p, base_e, adv_e, fuse_n = s
    o = OLD_ITEM[i]
    rank = int(rank) if isinstance(rank, (int, float)) else rank
    fixed = []
    if txt(o[0]) != txt(name):
        fixed.append("名称")
    if txt(o[1]) != txt(base_e):
        fixed.append("普通效果")
    if txt(o[2]) != txt(adv_e):
        fixed.append("精锐效果")
    if txt(o[3]) != txt(base_p):
        fixed.append("普通售价")
    # 原表用「—」表示无进阶形态
    adv_price_disp = adv_p if adv_p not in (None, "") else "—"
    if txt(o[4]) != txt(adv_price_disp) and txt(o[4]) not in ("", "—"):
        fixed.append("精锐售价")
    note = ("已按解包校对：" + "、".join(fixed)) if fixed else ""
    if txt(adv_e) == "未配置独立进阶形态":
        note = ("；".join([x for x in (note, "无独立进阶形态") if x]))
    item_rows.append([txt(name), txt(base_e), txt(adv_e), base_p, adv_price_disp,
                      rank, txt(typ),
                      int(fuse_n) if isinstance(fuse_n, (int, float)) else txt(fuse_n),
                      note])

    r = i + 2
    for field, a, b in (("道具名称", o[0], name), ("普通效果", o[1], base_e),
                        ("精锐效果", o[2], adv_e), ("普通售价", o[3], base_p),
                        ("精锐售价", o[4], adv_price_disp)):
        if txt(a) != txt(b):
            if field == "精锐售价" and txt(a) == "—" and txt(b) == "—":
                continue
            add_change("道具表", r, name, field, a, b,
                       "术语统一" if field == "精锐效果"
                       and txt(b) == "未配置独立进阶形态" else None,
                       "「无精锐形态」改用解包口径" if field == "精锐效果"
                       and txt(b) == "未配置独立进阶形态" else "")

# ------------------------------------------------------------------ 策略表
strat_rows = []
for i, s in enumerate(SRC_STRAT):
    role, sname, cat, hp, eff, unlock, banned, sid = s
    o = OLD_STRAT[i]
    fixed = []
    if txt(o[0]) != txt(role):
        fixed.append("角色")
    if txt(o[1]) != txt(eff):
        fixed.append("策略描述")
    if txt(o[2]) != txt(hp):
        fixed.append("生命值")
    note = ("已按解包校对：" + "、".join(fixed)) if fixed else ""
    strat_rows.append([txt(role), txt(sname), txt(cat), txt(eff),
                       int(hp) if isinstance(hp, (int, float)) else txt(hp),
                       txt(unlock), txt(banned), txt(sid), note])

    r = i + 2
    for field, a, b in (("角色", o[0], role), ("策略描述", o[1], eff), ("生命值", o[2], hp)):
        if txt(a) != txt(b):
            add_change("策略表", r, role, field, a, b)

# ------------------------------------------------------------------ 盟约表
cov_rows = []
for i, s in enumerate(SRC_COV):
    name, cnt, cond, eff, members, cid = s
    o = OLD_COV[i]
    mlist = txt(members)
    mcount = (len([x for x in mlist.split("、") if x.strip()]) if mlist.strip() else 0)
    fixed = []
    if txt(o[0]) != txt(name):
        fixed.append("盟约名称")
    if txt(o[1]) != txt(eff):
        fixed.append("盟约描述")
    note = ("已按解包校对：" + "、".join(fixed)) if fixed else ""
    cov_rows.append([txt(name), txt(eff),
                     int(cnt) if isinstance(cnt, (int, float)) else txt(cnt),
                     txt(cond), mlist, mcount, txt(cid), note])

    r = i + 2
    if txt(o[0]) != txt(name):
        add_change("盟约表", r, name, "盟约名称", o[0], name)
    if txt(o[1]) != txt(eff):
        add_change("盟约表", r, name, "盟约描述", o[1], eff,
                   None, "以解包原文为准；原表【…】占位标记改为官方（…）原文与括号层级")

# ------------------------------------------------------------------ 组装工作簿
HDR_FILL = PatternFill("solid", fgColor="FF2F5597")
HDR_FONT = Font(name="微软雅黑", size=11, bold=True, color="FFFFFFFF")
BODY_FONT = Font(name="微软雅黑", size=10)
THIN = Side(style="thin", color="FFD0D7E5")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HDR_ALIGN = Alignment(horizontal="center", vertical="center", wrap_text=True)
BODY_ALIGN = Alignment(horizontal="left", vertical="center", wrap_text=True)
CENTER_ALIGN = Alignment(horizontal="center", vertical="center", wrap_text=True)

wb = Workbook()
wb.remove(wb.active)


def add_sheet(title, widths, headers, rows, center_cols=(), tab_color=None):
    ws = wb.create_sheet(title)
    ws.append(headers)
    for rng in rows:
        ws.append(rng)
    ncol = len(headers)
    for c in range(1, ncol + 1):
        cell = ws.cell(row=1, column=c)
        cell.font = HDR_FONT
        cell.fill = HDR_FILL
        cell.alignment = HDR_ALIGN
        cell.border = BORDER
        ws.column_dimensions[get_column_letter(c)].width = widths[c - 1]
    ws.row_dimensions[1].height = 32
    for r in range(2, ws.max_row + 1):
        for c in range(1, ncol + 1):
            cell = ws.cell(row=r, column=c)
            cell.font = BODY_FONT
            cell.alignment = CENTER_ALIGN if c in center_cols else BODY_ALIGN
            cell.border = BORDER
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = "A1:%s%d" % (get_column_letter(ncol), ws.max_row)
    if tab_color:
        ws.sheet_properties.tabColor = tab_color
    return ws


add_sheet("干员表",
          [24, 7, 20, 46, 46, 10.5, 10.5, 14, 14, 14, 10, 8, 19, 19, 46],
          ["干员名称", "阶数", "特性", "特殊说明（普通）", "特殊说明（精锐）",
           "普通售价", "精锐售价", "盟约一", "盟约二", "盟约三", "条目类型",
           "隐藏", "触发时机（普通）", "触发时机（精锐）", "备注"],
          op_rows, center_cols=(2, 6, 7, 8, 9, 10, 11, 12, 13, 14), tab_color="2F5597")

add_sheet("道具表",
          [24, 56, 56, 9, 9, 7, 10, 12, 40],
          ["道具名称", "普通效果", "精锐效果", "普通售价", "精锐售价",
           "阶数", "类型", "合成进阶所需件数", "备注"],
          item_rows, center_cols=(4, 5, 6, 7, 8), tab_color="C00000")

add_sheet("策略表",
          [20, 18, 12, 88, 8, 34, 34, 20, 34],
          ["角色", "策略", "类别", "策略描述", "生命值", "解锁条件", "禁用模式", "策略ID", "备注"],
          strat_rows, center_cols=(3, 5, 8), tab_color="548235")

add_sheet("盟约表",
          [14, 96, 10.5, 15, 60, 8.5, 18, 36],
          ["盟约名称", "盟约描述", "激活计数", "条件原值", "成员名单", "成员数", "盟约ID", "备注"],
          cov_rows, center_cols=(1, 3, 4, 6, 7), tab_color="7030A0")

# 合成配方
fuse_rows = []
for i, s in enumerate(SRC_FUSE):
    m1, r1, m2, r2, res, eff = s
    fuse_rows.append([txt(m1), int(r1) if isinstance(r1, (int, float)) else txt(r1),
                      txt(m2), int(r2) if isinstance(r2, (int, float)) else txt(r2),
                      txt(res), txt(eff)])
add_sheet("合成配方",
          [16, 12, 16, 12, 20, 76],
          ["材料一", "材料一阶数", "材料二", "材料二阶数", "合成成品", "成品效果"],
          fuse_rows, center_cols=(2, 4), tab_color="ED7D31")

# 指令阶段
stage_rows = []
for s in SRC_STAGE:
    role, sname, seq, state, cost, rule, eff, uptype, param, nxt, cur = s
    stage_rows.append([txt(role), txt(sname),
                       int(seq) if isinstance(seq, (int, float)) else txt(seq),
                       txt(state), cost, txt(rule), txt(eff), txt(uptype),
                       txt(param), txt(nxt), txt(cur)])
add_sheet("指令阶段",
          [18, 16, 8, 10, 9, 18, 80, 24, 18, 22, 22],
          ["角色", "策略", "阶段序号", "状态", "配置费用", "使用次数规则", "阶段效果",
           "升级条件类型", "条件参数", "下一阶段ID", "当前阶段ID"],
          stage_rows, center_cols=(3, 4, 5, 10, 11), tab_color="FFC000")

# 补给增益
buff_rows = [[txt(a), txt(b), txt(c)] for a, b, c in SRC_BUFF]
add_sheet("补给增益",
          [22, 76, 22],
          ["名称", "效果", "效果ID"],
          buff_rows, center_cols=(3,), tab_color="A9D08E")

# 结构说明行（写入修订记录尾部）
MANUAL = [
    [None, None, None, None, None, None, None, "说明", SRC_NOTE],
    [None, None, None, None, None, None, None, "说明",
     "本表所有「干员/道具/策略/盟约」文本字段逐字取自解包数据，未做改写；"
     "原表与之不符处已全部按解包原文替换，逐条见上表。"],
    [None, None, None, None, None, None, None, "说明",
     "干员表「普通售价/精锐售价」：解包数据未提供干员价格字段，故保留原表数值，未校验；"
     "道具售价已核对，与解包「基础价格/进阶价格」一致。"],
    [None, None, None, None, None, None, None, "说明",
     "干员表「隐藏」列：盟约·辅助干员、“暴躁铁皮”为隐藏条目（沿用原表标注；解包无此字段）。"],
    [None, None, None, None, None, None, None, "说明",
     "干员表「触发时机」由特质开头的 <…> 标记机械提取，原文无标记则为「无」，自选配置为「—」。"],
    [None, None, None, None, None, None, None, "说明",
     "自选配置共 12 行（5 阶 6 行、6 阶 6 行），解包名称形如「自选配置 5阶-1」，"
     "其盟约与特质随玩家选择而定；解包「普通特质」为占位符 error。原表把 5/6 阶同名写作"
     "「自选调配干员（槽位N）」造成重名，现按解包名称区分。"],
    [None, None, None, None, None, None, None, "说明",
     "新增表：合成配方（5 组）、指令阶段（74 条）、补给增益（31 条），"
     "均原样取自解包「合成配方」「指令阶段」「补给增益」；解包「原始参数」明细表属原始数据，未纳入。"],
    [None, None, None, None, None, None, None, "说明",
     "干员表新增列：盟约一/盟约二/盟约三（拆分自「特性」）、条目类型、隐藏、触发时机（普通/精锐）、备注。"],
    [None, None, None, None, None, None, None, "说明",
     "道具表新增列：阶数、类型、合成进阶所需件数、备注；「普通售价/精锐售价」对应解包「基础价格/进阶价格」。"],
    [None, None, None, None, None, None, None, "说明",
     "策略表原「策略名称」列实为角色名，现拆为「角色」「策略」，并新增 类别、解锁条件、禁用模式、策略ID、备注。"],
    [None, None, None, None, None, None, None, "说明",
     "盟约表新增列：激活计数、条件原值、成员名单、成员数、盟约ID、备注。"],
]
if ELITE_PRICE_LOST:
    MANUAL.append([None, None, None, None, None, None, None, "说明",
                   "注意：整理开始后（2026-11-09 04:40）检测到 卫戍协议数据表.xlsx 被外部程序保存，"
                   "干员表「精锐售价」整列（含表头）内容被清空。该列已按整理前快照还原为与「普通售价」相同；"
                   "此项属于未校验字段，若实际存在差异请手工改回。"])

ws = add_sheet("修订记录",
               [7, 10, 8, 26, 19, 60, 60, 12, 46],
               ["序号", "工作表", "行号", "条目", "字段", "原值", "新值", "变更类型", "说明"],
               [], center_cols=(1, 2, 3, 8), tab_color="808080")
for i, ch in enumerate(CHANGES, start=1):
    ws.append([i] + ch)
for ch in MANUAL:
    ws.append(ch)
for r in range(2, ws.max_row + 1):
    for c in range(1, 10):
        cell = ws.cell(row=r, column=c)
        cell.font = BODY_FONT
        cell.alignment = CENTER_ALIGN if c in (1, 2, 3, 8) else BODY_ALIGN
        cell.border = BORDER
ws.auto_filter.ref = "A1:I%d" % ws.max_row

wb.save(OUT_PATH)

stat = {}
for ch in CHANGES:
    stat[ch[6]] = stat.get(ch[6], 0) + 1
print("变更记录条数:", len(CHANGES), stat)
print("已写出:", OUT_PATH)
src.close(); old.close()

