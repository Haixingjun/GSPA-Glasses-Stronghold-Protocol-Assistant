# -*- coding: utf-8 -*-
"""把《卫戍协议-特殊敌人数据表.xlsx》+ 图鉴 HTML 头像 + PRTS 地图整理成前端数据。

输入：
  · 卫戍协议-特殊敌人数据表.xlsx      配置 / 档案 / 数值三张表
  · 卫戍协议-规程-特殊敌人图鉴.html   179 张内嵌 160×160 WebP 头像（PRTS 图源）
  · data/maps.json                    PRTS 战场一览整理（10 张地图 × 3 场地）
输出：
  · web/data/enemies.js               window.GSPA_ENEMIES
  · web/assets/enemies/*-96.webp      列表头像
  · web/assets/enemies/*-160.webp     详情头像

运行：
    python tools/build_enemy_data.py
"""
from __future__ import annotations

import base64
import io
import json
import re
import time
from pathlib import Path

from openpyxl import load_workbook
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
XLSX = ROOT / "卫戍协议-特殊敌人数据表.xlsx"
HTML = ROOT / "卫戍协议-规程-特殊敌人图鉴.html"
MAPS = ROOT / "data" / "maps.json"
OUT_JS = ROOT / "web" / "data" / "enemies.js"
OUT_IMG = ROOT / "web" / "assets" / "enemies"

TYPE_ORDER = ["FLY", "TIMES", "ELEMENT", "DOT", "INVISIBLE", "REFLECTION", "SPECIAL", "CRITIC", "REBORN"]
TYPE_NAME = {
    "FLY": "飞行", "TIMES": "频次", "ELEMENT": "元素", "DOT": "持续",
    "INVISIBLE": "隐匿", "REFLECTION": "折射", "SPECIAL": "特异",
    "CRITIC": "致命", "REBORN": "复苏",
}
NAME_TO_TYPE = {v: k for k, v in TYPE_NAME.items()}
ROLE_LABEL = {"special": "特殊敌人", "normal": "普通随从", "elite": "精英随从"}
# Excel 的 enemy_database 名称与 PRTS 页面名不同的个别条目
PRTS_NAME = {"深池方阵步兵": "深池方阵战士"}


def split_list(value) -> list[str]:
    if value is None:
        return []
    text = str(value).strip()
    return [p for p in re.split(r"[、,，]", text) if p] if text else []


def main():
    wb = load_workbook(XLSX, data_only=True)

    # ---------------- 配置 ----------------
    ws = wb["特殊敌人配置"]
    configs = []
    for idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=1):
        if not row[5]:
            continue
        configs.append({
            "i": idx,
            "type": row[1],
            "tag": row[2],
            "half": row[3],
            "weight": int(row[4]),
            "special": row[5],
            "normal": split_list(row[7]),
            "elite": split_list(row[9]),
            "training": row[11] == "是",
        })

    # ---------------- 档案 ----------------
    enemies = {}
    for row in wb["敌人档案"].iter_rows(min_row=2, values_only=True):
        eid = row[0]
        if not eid:
            continue
        enemies[eid] = {
            "id": eid,
            "name": row[1],
            "desc": row[2] or "",
            "tags": [NAME_TO_TYPE[t] for t in split_list(row[6]) if t in NAME_TO_TYPE],
            "roles": [k for k, v in ROLE_LABEL.items() if v in split_list(row[4])],
            "levelCount": int(row[3] or 0),
            "relatedCount": int(row[5] or 0),
            "levels": [],
            "prtsName": PRTS_NAME.get(row[1], row[1]),
        }

    # ---------------- 数值 ----------------
    for row in wb["敌人数值"].iter_rows(min_row=2, values_only=True):
        eid = row[0]
        if not eid or eid not in enemies:
            continue
        enemies[eid]["levels"].append({
            "level": int(row[2]),
            "hp": row[3],
            "atk": row[4],
            "def": row[5],
            "res": row[6],
        })
    for enemy in enemies.values():
        enemy["levels"].sort(key=lambda lv: lv["level"])

    # ---------------- 头像 ----------------
    html = HTML.read_text(encoding="utf-8")
    match = re.search(r'<script id="report-data" type="application/json">(.*?)</script>', html, re.S)
    if not match:
        raise SystemExit("HTML 中未找到 report-data")
    report = json.loads(match.group(1))
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    missing = []
    for eid, enemy in enemies.items():
        source = report["enemies"].get(eid)
        if not source or not source.get("portrait"):
            missing.append(eid)
            continue
        raw = base64.b64decode(source["portrait"].split(",", 1)[1])
        image = Image.open(io.BytesIO(raw)).convert("RGBA")
        image.save(OUT_IMG / f"{eid}-160.webp", "WEBP", quality=90, method=6)
        thumb = image.resize((96, 96), Image.LANCZOS)
        thumb.save(OUT_IMG / f"{eid}-96.webp", "WEBP", quality=86, method=6)
        enemy["img"] = f"assets/enemies/{eid}-96.webp"
        enemy["imgLarge"] = f"assets/enemies/{eid}-160.webp"
    if missing:
        raise SystemExit("缺少头像：" + "、".join(missing))

    # ---------------- 词条 / 地图 ----------------
    tag_counts = {t: 0 for t in TYPE_ORDER}
    for enemy in enemies.values():
        for tag in enemy["tags"]:
            tag_counts[tag] += 1
    tags = [{"key": t, "name": TYPE_NAME[t], "count": tag_counts[t]} for t in TYPE_ORDER]
    maps_data = json.loads(MAPS.read_text(encoding="utf-8"))
    for m in maps_data["maps"]:
        m["fields"] = [f"assets/maps/map{m['id']}-{i}.webp" for i in (1, 2, 3)]

    # ---------------- 输出 ----------------
    payload = {
        "meta": {
            "version": "V3_1",
            "generatedAt": time.strftime("%Y-%m-%d %H:%M"),
            "source": "卫戍协议-特殊敌人数据表.xlsx + 图鉴 HTML 头像 + PRTS 战场一览",
            "counts": {
                "enemies": len(enemies),
                "configs": len(configs),
                "tags": len(tags),
                "maps": len(maps_data["maps"]),
                "levels": sum(len(e["levels"]) for e in enemies.values()),
                "images": len(list(OUT_IMG.glob("*-96.webp"))),
            },
            "note": "地图与敌方势力随机搭配；地图数据不能用于限定敌人。",
        },
        "typeNames": TYPE_NAME,
        "tags": tags,
        "enemies": [enemies[k] for k in sorted(enemies)],
        "configs": configs,
        "maps": maps_data,
    }
    js = "/* 由 tools/build_enemy_data.py 生成，请勿手改 */\nwindow.GSPA_ENEMIES = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text(js, encoding="utf-8")
    print(f"saved {OUT_JS} ({OUT_JS.stat().st_size // 1024} KB)")
    print("counts:", payload["meta"]["counts"])
    print("tags:", {t["name"]: t["count"] for t in tags})


if __name__ == "__main__":
    main()
