# -*- coding: utf-8 -*-
"""把单文件《卫戍协议-规程-特殊敌人图鉴.html》解析为 Excel 数据表。

HTML 内嵌的 report-data JSON 有三部分：
  rows      specialEnemyInfoDict 的 93 条配置（类型、上下半场、权重、特殊敌人、普通/精英随从）
  training  训练表收录的 2 个特殊敌人 key（与主表重复）
  enemies   179 个敌人的名称、描述、各等级原始数值、内嵌 WebP 头像

输出 `卫戍协议-特殊敌人数据表.xlsx`：6 张工作表，样式与仓库中
`卫戍协议数据表.xlsx` / `source/卫戍协议_完整数据表.xlsx` 保持一致
（深蓝表头、白色加粗字、浅灰蓝细边框、冻结首行、自动筛选）。

用法：
    python tools/build_special_enemy_xlsx.py
    python tools/build_special_enemy_xlsx.py --html 路径 --out 路径
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import re
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HTML = ROOT / "卫戍协议-规程-特殊敌人图鉴.html"
DEFAULT_OUT = ROOT / "卫戍协议-特殊敌人数据表.xlsx"

# 配置里的英文类型码对应 PRTS 九组战术标签。依据：
# docs/出怪查询-可行性调研.md §3 给出 9 组标签与数量，本文件 9 类敌人的
# 组内去重数正好是 14/10/18/12/18/15/35/33/32，且唯一三标签敌人
# `enemy_1381_winman`（访问团新兵）正好落在 SPEC/CRITIC/INVISIBLE 三组。
TYPE_ORDER = ["FLY", "TIMES", "ELEMENT", "DOT", "INVISIBLE", "REFLECTION", "SPECIAL", "CRITIC", "REBORN"]
TYPE_NAME = {
    "FLY": "飞行",
    "TIMES": "频次",
    "ELEMENT": "元素",
    "DOT": "持续",
    "INVISIBLE": "隐匿",
    "REFLECTION": "折射",
    "SPECIAL": "特异",
    "CRITIC": "致命",
    "REBORN": "复苏",
}

# 与现有工作簿一致的视觉规范
HEADER_FILL = PatternFill("solid", fgColor="FF2F5597")
HEADER_FONT = Font(name="微软雅黑", size=10.5, bold=True, color="FFFFFFFF")
BODY_FONT = Font(name="微软雅黑", size=10, color="FF1F2933")
NOTE_FONT = Font(name="微软雅黑", size=9, color="FF637580")
TITLE_FONT = Font(name="微软雅黑", size=16, bold=True, color="FF163F52")
SECTION_FILL = PatternFill("solid", fgColor="FFDCE6F1")
SECTION_FONT = Font(name="微软雅黑", size=11, bold=True, color="FF1F3864")
TOTAL_FILL = PatternFill("solid", fgColor="FFF2F5FA")
THIN = Side(style="thin", color="FFD0D7E5")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)
LEFT_TOP = Alignment(horizontal="left", vertical="top", wrap_text=True)


def load_report(html_path: Path) -> dict:
    text = html_path.read_text(encoding="utf-8")
    match = re.search(r'<script id="report-data" type="application/json">(.*?)</script>', text, re.S)
    if not match:
        raise SystemExit(f"未在 {html_path} 中找到 report-data JSON")
    return json.loads(match.group(1))


def display_rows(rows: list[dict]) -> list[dict]:
    """按 HTML 表格的展示顺序排序：类型 → 上半场 → 下半场，场内保持原顺序。"""
    order = {t: i for i, t in enumerate(TYPE_ORDER)}
    seen = [r["type"] for r in rows]
    for t in seen:
        if t not in order:
            order[t] = len(order)
    return sorted(
        rows,
        key=lambda r: (order.get(r["type"], 99), not r["isInFirstHalf"]),
    )


def write_header(ws, headers: list[str], row: int = 1, widths: list[float] | None = None):
    for col, (title, width) in enumerate(zip(headers, widths or []), start=1):
        cell = ws.cell(row=row, column=col, value=title)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = CENTER
        cell.border = BORDER
        ws.column_dimensions[get_column_letter(col)].width = width
    ws.row_dimensions[row].height = 32


def text_lines(value: str, width: float) -> int:
    """按列宽估算换行数：CJK 约 1.9 个宽度单位，ASCII 约 1.05 个。"""
    total = 0.0
    for ch in value:
        total += 1.9 if ord(ch) > 0x2E80 else 1.05
    return max(1, math.ceil(total / max(4.0, width * 0.98)))


def style_body(ws, first_row: int, last_row: int, aligns: list[str], wrap_cols: set[int], widths: list[float]):
    """套用正文样式，并按换行列估算行高（Excel 不会自动撑高）。"""
    for row in range(first_row, last_row + 1):
        lines = 1
        for col, align in enumerate(aligns, start=1):
            cell = ws.cell(row=row, column=col)
            cell.font = BODY_FONT
            cell.border = BORDER
            cell.alignment = CENTER if align == "center" else LEFT
            if col in wrap_cols and cell.value is not None:
                n = sum(text_lines(part, widths[col - 1]) for part in str(cell.value).split("\n"))
                lines = max(lines, n)
        ws.row_dimensions[row].height = min(110.0, max(17.0, lines * 13.5 + 4))


def finish_sheet(ws, freeze: str, tab_color: str, filter_ref: str | None = None):
    ws.freeze_panes = freeze
    ws.auto_filter.ref = filter_ref or ws.dimensions
    ws.sheet_properties.tabColor = tab_color
    ws.sheet_view.zoomScale = 90
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = "1:1"


def build_config_sheet(wb: Workbook, ordered: list[dict], enemies: dict, training: set[str]):
    ws = wb.active
    ws.title = "特殊敌人配置"
    headers = [
        "序号", "类型", "类型名称", "阶段", "权重", "特殊敌人ID", "特殊敌人",
        "普通随从ID", "普通随从", "精英随从ID", "精英随从", "训练表收录",
    ]
    widths = [6, 10, 10, 9, 7, 24, 20, 24, 18, 24, 18, 12]
    write_header(ws, headers, widths=widths)

    rows = []
    for i, r in enumerate(ordered, start=1):
        rows.append([
            i,
            r["type"],
            TYPE_NAME.get(r["type"], ""),
            "上半场" if r["isInFirstHalf"] else "下半场",
            r["randomWeight"],
            r["specialEnemyKey"],
            enemies[r["specialEnemyKey"]]["name"],
            "、".join(r["attachedNormalEnemyKeys"]),
            "、".join(enemies[k]["name"] for k in r["attachedNormalEnemyKeys"]),
            "、".join(r["attachedEliteEnemyKeys"]),
            "、".join(enemies[k]["name"] for k in r["attachedEliteEnemyKeys"]),
            "是" if r["specialEnemyKey"] in training else "否",
        ])
    for row in rows:
        ws.append(row)
    style_body(ws, 2, len(rows) + 1, ["center", "center", "center", "center", "center", "left", "left", "left", "left", "left", "left", "center"], {7, 9, 11}, widths)
    finish_sheet(ws, "C2", "FF2F5597")
    return ws


def build_archive_sheet(wb: Workbook, enemies: dict, roles: dict[str, set], related: dict[str, list[dict]]):
    ws = wb.create_sheet("敌人档案")
    headers = ["敌人ID", "名称", "数据库描述", "等级条目数", "出现身份", "关联配置数", "关联类型"]
    widths = [24, 20, 66, 13, 22, 13, 24]
    write_header(ws, headers, widths=widths)
    ws.row_dimensions[1].height = 42
    role_order = ["特殊敌人", "普通随从", "精英随从"]
    rows = []
    for eid in sorted(enemies):
        enemy = enemies[eid]
        type_names = []
        for r in related[eid]:
            name = TYPE_NAME.get(r["type"], r["type"])
            if name not in type_names:
                type_names.append(name)
        rows.append([
            eid,
            enemy["name"],
            enemy.get("description") or "",
            len(enemy.get("levels") or []),
            "、".join(r for r in role_order if r in roles[eid]),
            len(related[eid]),
            "、".join(type_names),
        ])
    for row in rows:
        ws.append(row)
    style_body(ws, 2, len(rows) + 1, ["left", "left", "left", "center", "left", "center", "left"], {3}, widths)
    finish_sheet(ws, "B2", "FF548235")
    return ws


def build_stats_sheet(wb: Workbook, enemies: dict, levels: list[list]):
    ws = wb.create_sheet("敌人数值")
    headers = ["敌人ID", "名称", "等级（0=基础）", "生命上限", "攻击力", "防御力", "法术抗性"]
    widths = [24, 20, 12, 11, 10, 10, 10]
    write_header(ws, headers, widths=widths)
    for eid, name, level, hp, atk, defence, res in levels:
        ws.append([eid, name, level, hp, atk, defence, res])
    style_body(ws, 2, len(levels) + 1, ["left", "left", "center", "center", "center", "center", "center"], set(), widths)
    finish_sheet(ws, "B2", "FF2F75B5")
    return ws


def build_type_stats_sheet(wb: Workbook, ordered: list[dict], enemies: dict):
    ws = wb.create_sheet("类型统计")
    headers = ["类型", "类型名称", "配置条数", "上半场", "下半场", "权重8", "权重10", "权重15", "涉及敌人（组内去重）"]
    widths = [12, 12, 11, 9, 9, 9, 9, 9, 20]
    write_header(ws, headers, widths=widths)
    ws.row_dimensions[1].height = 42

    total_types = 0
    rows = []
    for t in TYPE_ORDER:
        sub = [r for r in ordered if r["type"] == t]
        if not sub:
            continue
        distinct = len({k for r in sub for k in [r["specialEnemyKey"], *r["attachedNormalEnemyKeys"], *r["attachedEliteEnemyKeys"]]})
        weights = collections.Counter(r["randomWeight"] for r in sub)
        rows.append([
            t, TYPE_NAME[t], len(sub),
            sum(1 for r in sub if r["isInFirstHalf"]),
            sum(1 for r in sub if not r["isInFirstHalf"]),
            weights.get(8, 0), weights.get(10, 0), weights.get(15, 0),
            distinct,
        ])
        total_types += distinct
    for row in rows:
        ws.append(row)
    total = [
        "合计", "",
        len(ordered),
        sum(1 for r in ordered if r["isInFirstHalf"]),
        sum(1 for r in ordered if not r["isInFirstHalf"]),
        sum(r[5] for r in rows), sum(r[6] for r in rows), sum(r[7] for r in rows),
        len(enemies),
    ]
    ws.append(total)
    last = len(rows) + 2
    style_body(ws, 2, last, ["center"] * 9, set(), widths)
    for cell in ws[last]:
        cell.font = Font(name="微软雅黑", size=10, bold=True, color="FF1F3864")
        cell.fill = TOTAL_FILL
    ws.cell(row=last + 2, column=1, value=(
        "注：各类型“涉及敌人”按组内去重，合计 187；跨类型重复计数 8 次（6 个敌人属 2 类、"
        "1 个敌人属 3 类），全局去重为 179 个敌人。"
    )).font = NOTE_FONT
    ws.merge_cells(start_row=last + 2, start_column=1, end_row=last + 2, end_column=9)
    ws.cell(row=last + 2, column=1).alignment = LEFT
    ws.row_dimensions[last + 2].height = 30
    finish_sheet(ws, "B2", "FFED7D31", filter_ref=f"A1:I{last}")
    return ws


def build_relation_sheet(wb: Workbook, ordered: list[dict], enemies: dict):
    ws = wb.create_sheet("随从关联")
    headers = ["特殊敌人ID", "特殊敌人", "身份", "敌人ID", "名称", "类型", "类型名称", "阶段", "权重"]
    widths = [24, 20, 11, 24, 20, 9, 10, 9, 7]
    write_header(ws, headers, widths=widths)
    rows = []
    for r in ordered:
        stage = "上半场" if r["isInFirstHalf"] else "下半场"
        for role, ids in (
            ("特殊敌人", [r["specialEnemyKey"]]),
            ("普通随从", r["attachedNormalEnemyKeys"]),
            ("精英随从", r["attachedEliteEnemyKeys"]),
        ):
            for eid in ids:
                rows.append([
                    r["specialEnemyKey"], enemies[r["specialEnemyKey"]]["name"], role,
                    eid, enemies[eid]["name"], r["type"], TYPE_NAME.get(r["type"], ""),
                    stage, r["randomWeight"],
                ])
    for row in rows:
        ws.append(row)
    style_body(ws, 2, len(rows) + 1, ["left", "left", "center", "left", "left", "center", "center", "center", "center"], set(), widths)
    finish_sheet(ws, "C2", "FF7030A0")
    return ws, len(rows)


def build_notes_sheet(wb: Workbook, stats: dict):
    ws = wb.create_sheet("数据说明")
    widths = [26, 22, 78]
    for i, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width

    def section(row: int, title: str):
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=3)
        cell = ws.cell(row=row, column=1, value=title)
        cell.fill = SECTION_FILL
        cell.font = SECTION_FONT
        cell.alignment = LEFT
        ws.row_dimensions[row].height = 24

    def text(row: int, value: str, font=BODY_FONT, height=None):
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=3)
        cell = ws.cell(row=row, column=1, value=value)
        cell.font = font
        cell.alignment = LEFT_TOP
        if height:
            ws.row_dimensions[row].height = height

    def table_header(row: int, cols: list[str]):
        for col, value in enumerate(cols, start=1):
            cell = ws.cell(row=row, column=col, value=value)
            cell.fill = HEADER_FILL
            cell.font = HEADER_FONT
            cell.alignment = CENTER
            cell.border = BORDER
        ws.row_dimensions[row].height = 26

    def table_row(row: int, cols: list, aligns=("left", "center", "left"), height=20, bold=False, fill=None):
        for col, value in enumerate(cols, start=1):
            cell = ws.cell(row=row, column=col, value=value)
            cell.font = BODY_FONT if not bold else Font(name="微软雅黑", size=10, bold=True, color="FF1F3864")
            cell.alignment = CENTER if aligns[col - 1] == "center" else LEFT
            cell.border = BORDER
            if fill:
                cell.fill = fill
        ws.row_dimensions[row].height = height

    ws.row_dimensions[1].height = 8
    ws.merge_cells("A2:C2")
    ws["A2"] = "卫戍协议·规程 特殊敌人图鉴 · 数据说明"
    ws["A2"].font = TITLE_FONT
    ws["A2"].alignment = LEFT
    ws.row_dimensions[2].height = 30
    ws.merge_cells("A3:C3")
    ws["A3"] = "解析对象：卫戍协议-规程-特殊敌人图鉴.html（单文件，约 6.7 MB）　数据版本：V3_1"
    ws["A3"].font = Font(name="微软雅黑", size=10, color="FF637580")
    ws.merge_cells("A4:C4")
    ws["A4"] = "配置源：activity_table.json → activity.AUTOCHESS.act3autochess.V3_1.specialEnemyInfoDict；训练表：同一节点的 training 列表。"
    ws["A4"].font = NOTE_FONT
    ws.merge_cells("A5:C5")
    ws["A5"] = "名称/描述/等级数值：本机 PC 热更 26-11-06-12-42-25-70182449 的 enemy_database；头像：179 张 WebP 内嵌于 HTML，本表未导出。"
    ws["A5"].font = NOTE_FONT
    for row in (3, 4, 5):
        ws.cell(row=row, column=1).alignment = LEFT_TOP
        ws.row_dimensions[row].height = 18

    section(7, "一、规模")
    table_header(8, ["指标", "数值", "说明"])
    stat_rows = [
        ("特殊敌人配置", stats["rows"], "主表 93 条；训练表的 2 条与主表重复，仅标记、不重复计数"),
        ("敌人档案", stats["enemies"], "enemy_database 中出现的全部敌人，按 ID 去重"),
        ("等级数值条目", stats["levels"], "171 个单等级敌人 + 8 个双等级敌人（0 基础 / 1）"),
        ("随从关联", stats["relations"], "93 条配置 ×（1 特殊敌人 + 1 普通随从 + 1 精英随从）"),
        ("战术类型", stats["types"], "类型码对应 PRTS 九组战术标签，见下方口径说明"),
        ("权重分布", stats["weight_text"], "randomWeight 原值，未归一化"),
    ]
    for i, cols in enumerate(stat_rows, start=9):
        table_row(i, list(cols), ("left", "center", "left"), 22)

    section(16, "二、工作表")
    table_header(17, ["工作表", "行数", "内容"])
    sheet_rows = [
        ("特殊敌人配置", stats["rows"], "每条 specialEnemyInfoDict 配置一行：类型、阶段、权重、特殊敌人、普通/精英随从、训练表标记"),
        ("敌人档案", stats["enemies"], "每个敌人一行：名称、数据库描述、等级条目数、出现身份、关联配置数与类型"),
        ("敌人数值", stats["levels"], "长表：敌人 × 等级，生命上限 / 攻击力 / 防御力 / 法术抗性原始值"),
        ("类型统计", stats["types"], "按类型汇总配置条数、上下半场、权重分布、组内去重敌人数"),
        ("随从关联", stats["relations"], "长表：配置 × 身份，把“哪个特殊敌人带哪个随从”拆成可筛选的关系行"),
    ]
    for i, cols in enumerate(sheet_rows, start=18):
        table_row(i, list(cols), ("left", "center", "left"), 32)

    section(24, "三、字段口径")
    table_header(25, ["字段 / 概念", "所在表", "说明"])
    field_rows = [
        ("类型", "配置 / 类型统计", "配置原值：FLY、TIMES、ELEMENT、DOT、INVISIBLE、REFLECTION、SPECIAL、CRITIC、REBORN"),
        ("类型名称", "全部表", "九组战术标签映射：飞行、频次、元素、持续、隐匿、折射、特异、致命、复苏"),
        ("阶段", "配置 / 随从关联", "isInFirstHalf = true → 上半场；false → 下半场"),
        ("权重", "配置 / 随从关联", "randomWeight 原值；10 有 86 条、8 有 6 条、15 有 1 条，未归一化"),
        ("训练表收录", "配置", "training 列表中的 2 个特殊敌人 key，与主表为同一条目，仅作标记"),
        ("身份", "敌人档案 / 随从关联", "敌人出现的位置：特殊敌人、普通随从、精英随从；同一敌人可同时占多个身份"),
        ("关联配置数", "敌人档案", "该敌人出现在多少条配置中（同一配置只计一次）"),
        ("等级（0=基础）", "敌人数值", "数据库 level 为 null 时记 0，表示基础条目；8 个敌人另有 level 1"),
        ("空单元格", "敌人数值", "该等级条目未显式设置该字段，不是 0；HTML 弹窗中显示为 —"),
        ("头像", "—", "179 张 WebP 以 base64 内嵌在 HTML 中，未写入 Excel"),
    ]
    for i, cols in enumerate(field_rows, start=26):
        table_row(i, list(cols), ("left", "center", "left"), 34)

    section(38, "四、与 HTML 的对应关系")
    text(39, "HTML 首屏表格（类型/阶段 · 特殊敌人 · 普通随从 · 精英随从 · 权重）→「特殊敌人配置」；点击敌人弹出的详情（名称、ID、描述、各等级 HP/ATK/DEF/RES）→「敌人档案」+「敌人数值」。", height=32)
    text(40, "HTML 的搜索框、类型/上下半场/训练表下拉筛选 → Excel 首行自动筛选；搜索可用 Ctrl+F 或筛选器中的“包含”。", height=22)
    text(41, "HTML 的 179 张头像、点击弹窗与懒加载不进入 Excel；头像仍保留在 HTML 内嵌数据中。", height=22)

    section(43, "五、口径说明")
    notes = [
        "1. 类型码来自 specialEnemyInfoDict 的原始配置；中文名称是九组战术标签的对应，依据 docs/出怪查询-可行性调研.md §3，并已用组内去重数（14/10/18/12/18/15/35/33/32）与三标签敌人“访问团新兵”核对。",
        "2. 93 条配置不等于 93 个特殊敌人，也不等于 179 个敌人：配置会复用随从，敌人也会跨类型、跨身份出现。179 个敌人的类型归属合计为 187，跨类型重复 8 次，全局去重 179。",
        "3. 数据为快照。游戏热更后 specialEnemyInfoDict、enemy_database 都可能变化，重跑 tools/build_special_enemy_xlsx.py 即可再生成。",
        "4. 本表只做数据整理，不改变原值；百分比、数值口径请结合游戏内说明理解。",
    ]
    row = 44
    for i, note in enumerate(notes):
        text(row, note, height=32 if i < 2 else 22)
        row += 1

    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = "FF24465B"
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    return ws


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", type=Path, default=DEFAULT_HTML)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    data = load_report(args.html)
    rows = data["rows"]
    enemies = data["enemies"]
    training = set(data["training"])
    ordered = display_rows(rows)

    # 关系索引
    roles: dict[str, set] = collections.defaultdict(set)
    related: dict[str, list[dict]] = collections.defaultdict(list)
    for r in ordered:
        for role, ids in (
            ("特殊敌人", [r["specialEnemyKey"]]),
            ("普通随从", r["attachedNormalEnemyKeys"]),
            ("精英随从", r["attachedEliteEnemyKeys"]),
        ):
            for eid in ids:
                roles[eid].add(role)
                if r not in related[eid]:
                    related[eid].append(r)

    levels = []
    for eid in sorted(enemies):
        enemy = enemies[eid]
        for lv in enemy.get("levels") or []:
            levels.append([
                eid, enemy["name"], 0 if lv.get("level") is None else lv["level"],
                lv.get("maxHp"), lv.get("atk"), lv.get("def"), lv.get("magicResistance"),
            ])

    # 数据自检：HTML 内部引用完整，且计数与调研口径一致
    referenced = {k for r in rows for k in [r["specialEnemyKey"], *r["attachedNormalEnemyKeys"], *r["attachedEliteEnemyKeys"]]}
    assert referenced == set(enemies), ("HTML 内引用与 enemies 字典不一致", referenced ^ set(enemies))
    assert len(rows) == 93 and len(enemies) == 179 and len(levels) == 187
    assert len(training) == 2
    assert all(len(r["attachedNormalEnemyKeys"]) == 1 and len(r["attachedEliteEnemyKeys"]) == 1 for r in rows)
    assert sum(1 for e in enemies.values() if len(e["levels"]) == 2) == 8
    assert len({r["specialEnemyKey"] for r in rows}) == 93

    wb = Workbook()
    build_config_sheet(wb, ordered, enemies, training)
    build_archive_sheet(wb, enemies, roles, related)
    build_stats_sheet(wb, enemies, levels)
    build_type_stats_sheet(wb, ordered, enemies)
    _, relation_count = build_relation_sheet(wb, ordered, enemies)

    weight_counter = collections.Counter(r["randomWeight"] for r in rows)
    weight_text = " / ".join(f"{w}×{c}" for w, c in sorted(weight_counter.items()))
    build_notes_sheet(wb, {
        "rows": len(rows),
        "enemies": len(enemies),
        "levels": len(levels),
        "relations": relation_count,
        "types": len({r["type"] for r in rows}),
        "weight_text": weight_text,
    })

    wb.active = 0
    wb.properties.title = "卫戍协议·规程 特殊敌人数据表"
    wb.properties.subject = "解析自单文件 HTML 图鉴"
    wb.properties.creator = "GSPA"
    wb.properties.description = "配置源 specialEnemyInfoDict；数值源 enemy_database（V3_1）"
    args.out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(args.out)
    print(f"saved {args.out}")
    print(f"配置 {len(rows)} / 敌人 {len(enemies)} / 数值 {len(levels)} / 关联 {relation_count} / 权重 {weight_text}")


if __name__ == "__main__":
    main()
