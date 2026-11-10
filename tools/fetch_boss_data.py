# -*- coding: utf-8 -*-
"""生成 data/bosses.json：10 名领袖的档案 + PRTS 领袖属性表（4 模式 / 规程等级 1–20）。

输入：
  · source/prts/guicheng_leader_table.txt  PRTS「卫戍协议·规程/PRTS盟约记录#敌方资料·领袖」表格快照
  · PRTS 敌人页（人工核对的基础属性，见 BASE_STATS）
  · media.prts.wiki 敌人头像（按 MediaWiki MD5 路径下载）

输出：
  · data/bosses.json
  · source/prts/boss_portraits/<slug>.png

用法：
    python tools/fetch_boss_data.py
    python tools/fetch_boss_data.py --offline   # 不下载头像，只重算 JSON
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
TABLE = ROOT / "source" / "prts" / "guicheng_leader_table.txt"
OUT = ROOT / "data" / "bosses.json"
PORTRAIT_DIR = ROOT / "source" / "prts" / "boss_portraits"

MODES = ["标准模拟", "险境模拟", "绝境模拟", "终极模拟"]

# 基础属性来自 PRTS 敌人页「级别0」；胄另取「级别0(隐秘核心)」。
# hp 只作基础展示，实际领袖生命以 PRTS 领袖表为准。
BASE_STATS = {
    "假想敌：胄": {
        "slug": "helm", "index": "SP08", "prtsTitle": "假想敌：胄",
        "base": {"hp": 600000, "atk": 650, "def": 1000, "res": 25, "ms": 0.1, "interval": 4.0, "weight": 10},
        "hidden": {"hp": 1200000, "atk": 750, "def": 1200, "res": 30, "ms": 0.1, "interval": 4.0, "weight": 10},
    },
    "假想敌：铳": {
        "slug": "gun", "index": "SP12", "prtsTitle": "假想敌：铳",
        "base": {"hp": 120000, "atk": 750, "def": 1100, "res": 60, "ms": 0.4, "interval": 4.5, "weight": 10},
        "hidden": {"hp": 120000, "atk": 750, "def": 1100, "res": 60, "ms": 0.4, "interval": 4.5, "weight": 10},
    },
    "假想敌：管": {
        "slug": "pipe", "index": "SP16", "prtsTitle": "假想敌：管",
        "base": {"hp": 85000, "atk": 300, "def": 700, "res": 50, "ms": 1.0, "interval": 3.0, "weight": 7},
        "hidden": {"hp": 85000, "atk": 300, "def": 700, "res": 50, "ms": 1.0, "interval": 3.0, "weight": 7},
    },
    "盐风主教昆图斯": {
        "slug": "quintus", "index": "SVK", "prtsTitle": "盐风主教昆图斯",
        "base": {"hp": 100000, "atk": 380, "def": 500, "res": 50, "ms": 0.1, "interval": 3.5, "weight": 10},
        "hidden": None,
    },
    "阿利斯泰尔，帝国余晖": {
        "slug": "alistair", "index": "ALS", "prtsTitle": "阿利斯泰尔，帝国余晖",
        "base": {"hp": 81000, "atk": 920, "def": 1030, "res": 20, "ms": 0.0, "interval": 8.2, "weight": 10},
        "hidden": None,
    },
    "“萨米的意志”": {
        "slug": "sami", "index": "SAM", "prtsTitle": "“萨米的意志”",
        "base": {"hp": 240000, "atk": 800, "def": 800, "res": 40, "ms": 1.0, "interval": 6.0, "weight": 10},
        "hidden": None,
    },
    "假想敌：械": {
        "slug": "gear", "index": "SP28", "prtsTitle": "假想敌：械",
        "base": {"hp": 120000, "atk": 650, "def": 600, "res": 30, "ms": 1.0, "interval": 10.0, "weight": 9},
        "hidden": {"hp": 120000, "atk": 650, "def": 600, "res": 30, "ms": 1.0, "interval": 10.0, "weight": 9},
    },
    "假想敌：茧": {
        "slug": "cocoon", "index": "SP29", "prtsTitle": "假想敌：茧",
        "base": {"hp": 120000, "atk": 500, "def": 800, "res": 30, "ms": 1.0, "interval": 2.5, "weight": 9},
        "hidden": {"hp": 120000, "atk": 500, "def": 800, "res": 30, "ms": 1.0, "interval": 2.5, "weight": 9},
    },
    "假想敌：鳍": {
        "slug": "fin", "index": "SP31", "prtsTitle": "假想敌：鳍",
        "base": {"hp": 120000, "atk": 750, "def": 600, "res": 30, "ms": 0.8, "interval": 5.0, "weight": 9},
        "hidden": {"hp": 120000, "atk": 750, "def": 600, "res": 30, "ms": 0.8, "interval": 5.0, "weight": 9},
    },
    "矩兽": {
        "slug": "beast", "index": "JU", "prtsTitle": "矩兽",
        "base": {"hp": 350000, "atk": 1500, "def": 1000, "res": 10, "ms": 0.3, "interval": 6.0, "weight": 10},
        "hidden": None,
    },
}


def numbers(text: str) -> list[int]:
    # 去掉 {{color|#ff9a9a|...}} 里的颜色码，避免把 ff9a9a 里的 9 当成数值。
    text = re.sub(r"#[0-9a-fA-F]{6}", "", text)
    return [int(x.replace(",", "")) for x in re.findall(r"\d[\d,]*", text)]


def parse_primary_table(lines: list[str]) -> dict:
    """4 模式表：返回 {name: {mode: (hp, hiddenHp)}}。"""
    start = next(i for i, line in enumerate(lines) if "标准模拟" in line and line.lstrip().startswith("!"))
    out: dict[str, dict[str, list[int | None]]] = {}
    i = start
    while i < len(lines):
        line = lines[i].strip()
        m = re.match(r"\|\s*\{\{敌人头像\|([^|}]+)", line)
        if m:
            name = m.group(1).strip()
            vals = []
            j = i + 1
            while j < len(lines) and len(vals) < 4:
                cell = lines[j].strip()
                if cell.startswith("|") and not cell.startswith("|-") and not cell.startswith("|}"):
                    ns = numbers(cell)
                    vals.append((ns[0] if ns else None, ns[1] if len(ns) > 1 else None))
                j += 1
            out[name] = {
                MODES[k]: vals[k] for k in range(min(4, len(vals)))
            }
            i = j
            continue
        i += 1
    return out


def parse_level_table(lines: list[str]) -> tuple[list[str], dict[int, list[tuple[int | None, int | None]]]]:
    """规程等级表：返回 (boss 顺序, {level: [(hp, hiddenHp) × 10]})。"""
    header_idx = next(i for i, line in enumerate(lines) if line.strip().startswith("! {{敌人头像|"))
    order = []
    for line in lines[header_idx:]:
        m = re.match(r"!\s*\{\{敌人头像\|([^|}]+)", line.strip())
        if not m:
            break
        order.append(m.group(1).strip())
    levels: dict[int, list[tuple[int | None, int | None]]] = {}
    for i, line in enumerate(lines):
        m = re.match(r"\|\s*规程等级\s*(\d+)\s*$", line.strip())
        if not m:
            continue
        level = int(m.group(1))
        cells = []
        j = i + 1
        while j < len(lines) and len(cells) < len(order):
            cell = lines[j].strip()
            if cell.startswith("|") and not cell.startswith("|-") and not cell.startswith("|}"):
                ns = numbers(cell)
                cells.append((ns[0] if ns else None, ns[1] if len(ns) > 1 else None))
            j += 1
        levels[level] = cells
    return order, levels


def portrait_url(name: str) -> tuple[str, str]:
    filename = f"头像_敌人_{name}.png"
    digest = hashlib.md5(filename.encode("utf-8")).hexdigest()
    url = f"https://media.prts.wiki/{digest[0]}/{digest[:2]}/{urllib.parse.quote(filename)}"
    return filename, url


def download_portraits(bosses: list[dict], offline: bool) -> None:
    PORTRAIT_DIR.mkdir(parents=True, exist_ok=True)
    for boss in bosses:
        slug = boss["slug"]
        dst = PORTRAIT_DIR / f"{slug}.png"
        boss["portraitFile"] = f"source/prts/boss_portraits/{slug}.png"
        if offline or dst.exists():
            continue
        _, url = portrait_url(boss["name"])
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            "Referer": "https://prts.wiki/",
        })
        try:
            data = urllib.request.urlopen(req, timeout=30).read()
            dst.write_bytes(data)
            print("portrait", boss["name"], len(data))
            time.sleep(0.2)
        except Exception as exc:  # noqa: BLE001
            print("portrait failed", boss["name"], exc)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="不下载头像")
    args = parser.parse_args()

    lines = TABLE.read_text(encoding="utf-8").splitlines()
    primary = parse_primary_table(lines)
    order, level_table = parse_level_table(lines)

    bosses = []
    for name in order:
        meta = BASE_STATS.get(name)
        if not meta:
            raise SystemExit(f"缺少基础属性：{name}")
        if name not in primary:
            raise SystemExit(f"4 模式表缺少：{name}")
        base = meta["base"]
        hidden = meta["hidden"]
        boss = {
            "id": f"boss_{meta['slug']}",
            "name": name,
            "slug": meta["slug"],
            "index": meta["index"],
            "prtsTitle": meta["prtsTitle"],
            "base": base,
            "hiddenBase": hidden,
            "hpByMode": {},
            "hiddenHpByMode": {},
            "hpByLevel": {},
            "hiddenHpByLevel": {},
        }
        for mode, (hp, hidden_hp) in primary[name].items():
            boss["hpByMode"][mode] = hp
            if hidden_hp is not None:
                boss["hiddenHpByMode"][mode] = hidden_hp
        for level, cells in level_table.items():
            idx = order.index(name)
            if idx >= len(cells):
                continue
            hp, hidden_hp = cells[idx]
            if hp is not None:
                boss["hpByLevel"][str(level)] = hp
            if hidden_hp is not None:
                boss["hiddenHpByLevel"][str(level)] = hidden_hp
        bosses.append(boss)

    download_portraits(bosses, args.offline)

    payload = {
        "meta": {
            "source": "PRTS「卫戍协议·规程/PRTS盟约记录」敌方资料·领袖",
            "tableSnapshot": "source/prts/guicheng_leader_table.txt",
            "generatedAt": time.strftime("%Y-%m-%d %H:%M"),
            "bossCount": len(bosses),
            "note": "领袖生命值来自 PRTS 领袖表（4 模式 + 规程等级 1–20，含隐秘核心红字）；攻击力/防御力/法抗来自 PRTS 敌人页级别 0，实际战斗只乘攻击与移速倍率，生命不乘普通敌人倍率。",
        },
        "modes": [
            {"name": "标准模拟", "levelFrom": 1, "levelTo": 4},
            {"name": "险境模拟", "levelFrom": 5, "levelTo": 8},
            {"name": "绝境模拟", "levelFrom": 9, "levelTo": 14},
            {"name": "终极模拟", "levelFrom": 15, "levelTo": 20},
        ],
        "bosses": bosses,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"saved {OUT} ({OUT.stat().st_size // 1024} KB), bosses={len(bosses)}")
    print("HP 标准:", {b["name"]: b["hpByMode"].get("标准模拟") for b in bosses})


if __name__ == "__main__":
    main()
