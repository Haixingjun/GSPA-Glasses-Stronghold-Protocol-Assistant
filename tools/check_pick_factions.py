# -*- coding: utf-8 -*-
"""
自选（甄选）干员阵营审计：主表「自选干员」工作表 <- 解包 character_table / activity_table

用法：
    python tools/check_pick_factions.py           # 只审计，不写文件
    python tools/check_pick_factions.py --detail  # 额外打印 66 名干员的完整推导过程
    python tools/check_pick_factions.py --json    # 以 JSON 输出差异（CI 用）

口径（2026-11-14 修正）：
    1. 取 character_table.mainPower 中「最具体」的阵营：teamId > groupId > nationId；
    2. 再并入 character_table.subPower 的全部阵营（即 PRTS 的隐藏阵营）；
    3. 用 activity_table.autoChessData.bondInfoDict 里本季 10 个核心盟约的 powerIdList 求交；
    4. 交集为空 -> 协防干员。
    依据：PRTS「卫戍协议」——「自选加入的干员会根据其实际阵营所属分配核心盟约，若没有可匹配的
    则改为分配协防干员盟约」；「实际阵营所属」按最具体的所属组织/团队解释，主表「游戏阵营/隐藏阵营」
    只保留展示名，不直接决定核心盟约。

退出码：0 = 主表与解包推导一致；1 = 存在差异或数据缺失。
"""
import sys
import io
import os
import json
import argparse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

try:
    from openpyxl import load_workbook
except ImportError:
    print("缺少 openpyxl。请先 pip install openpyxl，或用带该依赖的 Python 运行。")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "卫戍协议数据表.xlsx")
SNAP = os.path.join(ROOT, "source", "unpacked", "pick_factions.json")
PICK_SHEET = "自选干员"
CORE_ORDER = ["炎", "萨尔贡", "维多利亚", "谢拉格", "阿戈尔", "叙拉古", "卡西米尔", "乌萨斯", "伊比利亚", "莱塔尼亚"]


def split_tags(v):
    return [x.strip() for x in (v or "").replace("／", "/").replace("、", "/").split("/") if x.strip()]


def derive(char_id, snap, detail=False):
    """返回 (tags, powers, picked_main)；缺失数据时 tags=None。"""
    rec = snap.get("picks", {}).get(char_id)
    if not rec:
        return None, [], None
    powers = snap.get("powers", {})
    lv = lambda pid: (powers.get(pid) or {}).get("level", 0)  # noqa: E731
    main = list(rec.get("mainPower") or [])
    picked = max(main, key=lv) if main else None
    chosen = [picked] if picked else []
    for pid in rec.get("subPower") or []:
        if pid not in chosen:
            chosen.append(pid)
    hit = [c for c in CORE_ORDER if set(snap.get("cores", {}).get(c, [])) & set(chosen)]
    tags = hit if hit else ["协防干员"]
    if detail:
        name = lambda pid: (powers.get(pid) or {}).get("name", pid)  # noqa: E731
        return tags, [name(p) for p in chosen], name(picked) if picked else None
    return tags, chosen, picked


def read_sheet():
    wb = load_workbook(SRC, data_only=True)
    ws = wb[PICK_SHEET]
    hdr = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    idx = {k: hdr.index(k) + 1 for k in ("干员名称", "游戏阵营", "隐藏阵营", "核心盟约", "盟约来源", "PRTS ID")}
    out = []
    for r in range(2, ws.max_row + 1):
        name = ws.cell(row=r, column=idx["干员名称"]).value
        if not name:
            continue
        out.append({
            "row": r,
            "name": name,
            "ingame": ws.cell(row=r, column=idx["游戏阵营"]).value,
            "hidden": ws.cell(row=r, column=idx["隐藏阵营"]).value,
            "tags": split_tags(ws.cell(row=r, column=idx["核心盟约"]).value),
            "source": ws.cell(row=r, column=idx["盟约来源"]).value,
            "charId": ws.cell(row=r, column=idx["PRTS ID"]).value,
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--detail", action="store_true", help="打印每名干员的推导过程")
    ap.add_argument("--json", action="store_true", help="以 JSON 输出结果")
    args = ap.parse_args()

    if not os.path.exists(SNAP):
        print("缺少解包快照：%s" % SNAP)
        return 1
    snap = json.load(open(SNAP, encoding="utf-8"))
    rows = read_sheet()
    diffs = []
    table = []
    for r in rows:
        expected, powers, picked = derive(r["charId"], snap, detail=True)
        if expected is None:
            diffs.append({"name": r["name"], "charId": r["charId"], "error": "解包快照缺少该干员"})
            continue
        ok = sorted(expected) == sorted(r["tags"])
        table.append({
            "name": r["name"], "charId": r["charId"],
            "current": r["tags"], "expected": expected,
            "main": picked, "powers": powers, "ok": ok,
        })
        if not ok:
            diffs.append({"name": r["name"], "charId": r["charId"], "current": r["tags"], "expected": expected})

    if args.json:
        print(json.dumps({"meta": snap.get("meta"), "diffs": diffs, "rows": table}, ensure_ascii=False, indent=1))
        return 0 if not diffs else 1

    print("解包口径：%s" % snap.get("meta", {}).get("rule", ""))
    print("数据版本：%s　快照：%s" % (snap.get("meta", {}).get("gameDataVersion", ""), os.path.relpath(SNAP, ROOT)))
    print("")
    print("%-10s %-14s %-14s %-16s %s" % ("干员", "主表核心盟约", "解包推导", "主阵营", "参与推导的阵营"))
    for t in table:
        mark = "" if t["ok"] else "  <-- 不一致"
        print("%-10s %-14s %-14s %-16s %s%s" % (
            t["name"], "/".join(t["current"]), "/".join(t["expected"]),
            t["main"] or "", "、".join(t["powers"]), mark))
    print("")
    print("合计 %d 名；不一致 %d 名。" % (len(table), len(diffs)))
    for d in diffs:
        if "error" in d:
            print("  ! %s：%s" % (d["name"], d["error"]))
        else:
            print("  ! %s：主表 %s -> 应为 %s" % (d["name"], "/".join(d["current"]), "/".join(d["expected"])))
    return 0 if not diffs else 1


if __name__ == "__main__":
    sys.exit(main())
