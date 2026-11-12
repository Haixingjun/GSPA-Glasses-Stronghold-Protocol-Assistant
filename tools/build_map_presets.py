#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把「卫戍协议：规程」的解包关卡地图（内部代号 act3autochess）转成沙盘预设。

数据来源（与 source/ 里的热更版本一致）：
  Kengxxiao/ArknightsGameData · zh_CN/gamedata/levels/activities/act3autochess/
  每个战场 m01–m06 / m09–m12 有 3 个「场地」子关卡：level_act3autochess_mXX_sub_0N.json

输出：
  web/data/maps.js   window.GSPA_MAPS —— 20 张可见预设（10 战场 × 场地 1/3）
                     + 10 张隐藏的场地 2（?map=01-2 仍可打开，图库不显示）
  source/autochess-levels/  原始关卡 JSON 缓存（可重复生成，不进仓库）

裁剪口径（解包关卡把 UI 也画进了网格，必须裁掉）：
  场地 1（sub_01，原始 7×20）：只留 r2–r5 × c3–c11；r6 装备区(tile_acbag)、r7 待部署区(tile_achand)、
                              右侧 r2–r6 × c13–c19 的敌人展示区全部丢弃
  场地 2（sub_02，原始 6×21）：只留 r2–r5 × c3–c19；r6 待部署区丢弃；默认隐藏
  场地 3（sub_03，原始 13×21）：只留 r8–r12 × c3–c19；顶部 r2–r6 × c8–c14 展示块、r13 待部署区丢弃；
                              r12 的装备区格丢弃，但保留该行的传送点(tile_telin/out)

用法：
  python tools/build_map_presets.py            # 有缓存就用缓存
  python tools/build_map_presets.py --refresh  # 重新下载
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "source", "autochess-levels")
OUT = os.path.join(ROOT, "web", "data", "maps.js")

REPO = "Kengxxiao/ArknightsGameData"
BRANCH = "master"
DIR = "zh_CN/gamedata/levels/activities/act3autochess"
CDN = "https://cdn.jsdelivr.net/gh/%s@%s/%s" % (REPO, BRANCH, DIR)
API = "https://api.github.com/repos/%s/contents/%s" % (REPO, DIR)
API_HEADERS = {"User-Agent": "GSPA-map-presets"}

# 解包里的 10 张战场（#07 / #08 官方未开放）
MAP_NUMBERS = ["01", "02", "03", "04", "05", "06", "09", "10", "11", "12"]
FIELDS = [1, 2, 3]
VISIBLE_FIELDS = (1, 3)
VERSION = "26-11-06-12-56-09-07186384"

# 场地 → 裁剪矩形（0 基、含端点）：rows (r0, r1), cols (c0, c1)
CROPS = {
    1: {"rows": (1, 4), "cols": (2, 10)},    # r2–r5 × c3–c11
    2: {"rows": (1, 4), "cols": (2, 18)},    # r2–r5 × c3–c19（隐藏）
    3: {"rows": (7, 11), "cols": (2, 18)},   # r8–r12 × c3–c19（保留 r12 传送点）
}

# 地形口径（与 web/js/sandbox.js、map-editor.js 的 TERRAIN 键保持一致）
DEPLOYABLE = {"ALL", "MELEE", "RANGED"}


def classify(tile):
    """把解包地块属性映射成沙盘地形键。"""
    key = tile.get("tileKey") or ""
    height = tile.get("heightType") or "LOWLAND"
    build = tile.get("buildableType") or "NONE"
    passable = tile.get("passableMask") or "NONE"

    if key == "tile_start":
        return "spawn"
    if key == "tile_end":
        return "goal"
    if key == "tile_telin":
        return "telin"
    if key == "tile_telout":
        return "telout"
    # 装备区 / 待部署区是 UI，不是战场；裁剪后若还有残留一律作场外
    if key in ("tile_acbag", "tile_achand"):
        return "void"
    # 边界高台：本赛季按「特殊高台」处理（可部署任意单位）
    if key == "tile_fence_bound":
        return "highSpecial"
    # 高台（仅远程）
    if key == "tile_wall":
        return "high"
    # 特殊地形：保留类型，别当成普通地面
    if key == "tile_mire":
        return "mire"
    if key == "tile_infection":
        return "infection"
    if key == "tile_speedup":
        return "speedup"
    if key == "tile_duel_grassland":
        return "duel"
    if build in DEPLOYABLE:
        if height == "HIGHLAND":
            return "highAny" if build == "ALL" else "high"
        return "ground"
    return "floor" if passable == "ALL" else "void"


def crate_cells(level):
    """场地上的箱子（trap_1105_accrate）坐标，0 基。"""
    cells = set()
    for token in (level.get("predefines") or {}).get("tokenInsts") or []:
        key = ((token.get("inst") or {}).get("characterKey")) or ""
        if key != "trap_1105_accrate":
            continue
        pos = token.get("position") or {}
        cells.add((int(pos.get("row", -1)), int(pos.get("col", -1))))
    return cells


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers=API_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def download(map_no, field):
    name = "level_act3autochess_m%s_sub_%02d.json" % (map_no, field)
    path = os.path.join(CACHE, name)
    if os.path.exists(path) and os.path.getsize(path) > 1024:
        return path
    os.makedirs(CACHE, exist_ok=True)
    last = None
    for attempt in range(3):
        try:
            data = fetch("%s/level_act3autochess_m%s/level_act3autochess_m%s_sub_%02d.json"
                         % (CDN, map_no, map_no, field))
            if data.lstrip().startswith(b"{"):
                with open(path, "wb") as fh:
                    fh.write(data)
                return path
            last = RuntimeError("CDN 返回非 JSON（%d 字节）" % len(data))
        except Exception as exc:  # noqa: BLE001 - 网络重试
            last = exc
        time.sleep(1.5 * (attempt + 1))
    # 兜底：GitHub contents API（base64）
    try:
        blob = json.loads(fetch("%s/level_act3autochess_m%s/level_act3autochess_m%s_sub_%02d.json"
                                % (API, map_no, map_no, field)))
        raw = base64.b64decode(blob["content"])
        with open(path, "wb") as fh:
            fh.write(raw)
        return path
    except Exception as exc:  # noqa: BLE001
        raise SystemExit("下载失败：m%s sub_%02d（%s / %s）" % (map_no, field, last, exc))


def load_prts_meta():
    """合并 data/maps.json 里 PRTS 的战场机制文本（地形 / 装置 / 备注）。"""
    path = os.path.join(ROOT, "data", "maps.json")
    meta = {}
    if not os.path.exists(path):
        return meta
    try:
        obj = json.load(open(path, encoding="utf-8"))
    except Exception:  # noqa: BLE001 - 缺文件时照常出图
        return meta
    for m in obj.get("maps") or []:
        meta[str(m.get("id"))] = {
            "terrain": [{"name": t.get("name"), "desc": t.get("desc")} for t in (m.get("terrain") or [])],
            "devices": [{"name": d.get("name"), "desc": d.get("desc")} for d in (m.get("devices") or [])],
            "note": m.get("note") or "",
        }
    return meta


def build_preset(map_no, field, level_path, prts=None):
    level = json.load(open(level_path, encoding="utf-8"))
    map_data = level["mapData"]
    tiles_flat = map_data["tiles"]
    grid = [[tiles_flat[i] for i in row] for row in map_data["map"]]
    full_h = len(grid)

    # 裁掉 UI（装备区 / 待部署区 / 敌人展示区）
    crop = CROPS[field]
    r0, r1 = crop["rows"]
    c0, c1 = crop["cols"]
    grid = [row[c0:c1 + 1] for row in grid[r0:r1 + 1]]
    h, w = len(grid), len(grid[0])
    last = h - 1

    rows, spawns, goals = [], [], []
    for r in range(h):
        row = []
        for c in range(w):
            t = classify(grid[r][c])
            # 场地 3 最后一行是装备区行，只保留其中的传送点
            if field == 3 and r == last and t not in ("telin", "telout"):
                t = "void"
            row.append(t)
            if t == "spawn":
                spawns.append([r, c])
            elif t == "goal":
                goals.append([r, c])
        rows.append(row)

    # 箱子（trap_1105_accrate）只记录坐标，不覆盖地形；渲染时叠加在地块上。
    # 注意：token 的 position.row 以底边为原点（自下而上），地图网格是自上而下，
    # 必须先做 row → (full_h-1-row) 翻转，否则箱子会整体上下颠倒。
    boxes = []
    for br, bc in crate_cells(level):
        br = full_h - 1 - br
        if not (r0 <= br <= r1 and c0 <= bc <= c1):
            continue  # UI 区（装备区 / 待部署区 / 展示块）里的箱子不算
        boxes.append([br - r0, bc - c0])

    num = int(map_no)
    image = "assets/maps/map%s-%d.webp" % (map_no, field)
    preset = {
        "id": "%s-%d" % (map_no, field),
        "map": map_no,
        "field": field,
        "label": "#%02d" % num,
        "title": "战场 %02d · 场地 %d" % (num, field),
        "image": image,
        "w": w,
        "h": h,
        "spawns": spawns,
        "goals": goals,
        "boxes": boxes,
        "tiles": rows,
    }
    if field not in VISIBLE_FIELDS:
        preset["hidden"] = True
    if prts:
        preset["devices"] = prts.get("devices") or []
        preset["terrain"] = prts.get("terrain") or []
        preset["note"] = prts.get("note") or ""
    return preset


def main():
    refresh = "--refresh" in sys.argv
    if refresh and os.path.isdir(CACHE):
        for f in os.listdir(CACHE):
            if f.endswith(".json"):
                os.remove(os.path.join(CACHE, f))

    presets = []
    prts_meta = load_prts_meta()
    for map_no in MAP_NUMBERS:
        for field in FIELDS:
            path = download(map_no, field)
            presets.append(build_preset(map_no, field, path, prts_meta.get(map_no)))
            p = presets[-1]
            deploy = sum(1 for row in p["tiles"] for t in row if t in ("ground", "high", "highAny", "highSpecial"))
            print("  #%s 场地%d  %2d×%-2d  可部署 %-3d 箱子 %-2d 侵入点 %d  终点 %d%s"
                  % (map_no, field, p["w"], p["h"], deploy, len(p["boxes"]),
                     len(p["spawns"]), len(p["goals"]),
                     "  [隐藏]" if p.get("hidden") else ""))

    susp = []
    for p in presets:
        for r, c in p["boxes"]:
            terrain = p["tiles"][r][c]
            if terrain == "void":
                susp.append("%s r%dc%d" % (p["id"], r + 1, c + 1))
    if susp:
        print("  注意：箱子落在场外格：" + "、".join(susp))

    payload = {
        "version": VERSION,
        "source": "https://github.com/%s/tree/%s/%s" % (REPO, BRANCH, DIR),
        "scale": "解包地块属性 → 沙盘地形键：tile_road=ground，tile_acbag/tile_achand=场外(UI)，"
                 "tile_floor=floor，tile_fence_bound=highSpecial（特殊高台），tile_forbidden=void，"
                 "tile_start=spawn，tile_end=goal，tile_telin/tile_telout=传送",
        "boxes": "trap_1105_accrate 只记录坐标（boxes），渲染时叠加在地块上，不替换地形；UI 区里的箱子丢弃",
        "crop": "已裁掉网格内的 UI：装备区(tile_acbag)、待部署区(tile_achand)、敌人展示区；"
                "场地1 r2–r5×c3–c11，场地2(隐藏) r2–r5×c3–c19，场地3 r8–r12×c3–c19（r12 只留传送点）",
        "meta": "devices/terrain/note 合并自 data/maps.json（PRTS 战场一览文本）",
        "maps": presets,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    body = "window.GSPA_MAPS = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)

    print("\n共 %d 张预设 → %s（%.1f KB）" % (len(presets), os.path.relpath(OUT, ROOT), len(body.encode()) / 1024))


if __name__ == "__main__":
    main()
