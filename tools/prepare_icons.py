# -*- coding: utf-8 -*-
"""
从 PRTS wiki 抓取「道具 / 策略发起人 / 盟约」图标，统一裁成方形 WebP。

用法（推荐用带 Pillow + openpyxl 的 Python，见 开发说明.md）：
    python tools/prepare_icons.py                 # 增量：命中缓存的不重下
    python tools/prepare_icons.py --force         # 全部重下
    python tools/prepare_icons.py --only items    # 只跑某一类：items / strategies / covenants
    python tools/prepare_icons.py --limit 5       # 每类只试前 5 个
    python tools/prepare_icons.py --delay 0.5     # 放慢请求（默认 0.25s）

产物：
    build/icon-cache/<slug>.png          原始 PNG（重复运行不再下载）
    web/assets/icons/<slug>-<size>.webp  小图（卡片）/ 大图（详情）
    data/icons.json                      清单（build_web_data.py 读取后写进 data.json）
    build/icon_report.md                 成功/缺失/失败清单与体积

三套命名规则（均来自本期「卫戍协议·规程」的 PRTS 页面）：
    · 道具：    文件:卫戍协议 道具 <名称>.png                 （多数 164×164）
    · 策略：    文件:卫戍协议：盟约 策略发起人 <角色>.png      （184×184）
    · 盟约：    文件:卫戍协议：盟约 icon <盟约ID>.png          （白色线稿，尺寸不一）

版权：
    · 图标为游戏内美术，版权归鹰角网络所有；本项目仅作非商业的玩家查询用途。
    · 文件下载到本地随包发布，不热链 PRTS；顶栏可一键隐藏全部头像与图标。
"""
import sys, io, os, re, json, time, argparse, hashlib
import urllib.parse
import urllib.request
import urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

try:
    from PIL import Image, ImageOps
except ImportError:
    print("缺少 Pillow。请用工作区自带的 Python 运行，或先 pip install Pillow。")
    sys.exit(1)

try:
    from openpyxl import load_workbook
except ImportError:
    print("缺少 openpyxl。请用工作区自带的 Python 运行，或先 pip install openpyxl。")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "卫戍协议数据表.xlsx")
CACHE_DIR = os.path.join(ROOT, "build", "icon-cache")
OUT_DIR = os.path.join(ROOT, "web", "assets", "icons")
MANIFEST = os.path.join(ROOT, "data", "icons.json")
REPORT = os.path.join(ROOT, "build", "icon_report.md")
API = "https://prts.wiki/api.php"

# 版本锚点：只认本期「卫戍协议·规程」页面实际渲染出来的图标文件。
# 这样即使 PRTS 上还留着 2024 / 2025-11「盟约」/ 2026-03「盟约 下半」的同名旧文件，
# 也不会把其它期的美术混进来。
PAGE = "卫戍协议·规程/PRTS盟约记录"
PAGE_SECTIONS = ("1", "2", "3", "4", "10")  # 核心盟约 / 附加盟约 / 策略 / 装备

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://prts.wiki/",
}
IMG_HEADERS = dict(HEADERS, Accept="image/avif,image/webp,image/png,*/*;q=0.8")

# 类别配置：
#   prefix  文件名前缀
#   label   报告里的中文名
#   title   文件标题模板（%s 为名称/角色/ID）
#   sizes   (卡片, 详情) 两档边长
#   pad     内容四周留白比例（白线稿 / 非方形道具留多一点）
#   cover   True = 直接裁方（策略发起人本来就是方图）
CATS = {
    "items": {
        "prefix": "it", "label": "道具", "sizes": (64, 128), "pad": 0.07,
        "cover": False, "trim": True, "title": "卫戍协议 道具 %s.png",
    },
    "strategies": {
        "prefix": "st", "label": "策略发起人", "sizes": (96, 184), "pad": 0.0,
        "cover": True, "trim": False, "title": "卫戍协议：盟约 策略发起人 %s.png",
    },
    "covenants": {
        "prefix": "cv", "label": "盟约", "sizes": (48, 96), "pad": 0.10,
        "cover": False, "trim": True, "title": "卫戍协议：盟约 icon %s.png",
    },
}

QUALITY = {64: 82, 128: 88, 96: 82, 184: 88, 48: 82}

_last_request = [0.0]


def throttle(delay):
    gap = time.time() - _last_request[0]
    if gap < delay:
        time.sleep(delay - gap)
    _last_request[0] = time.time()


def http_get(url, headers, tries=3, timeout=35):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        except Exception as e:  # 网络抖动 / 超时
            last = e
            time.sleep(1.0 * (attempt + 1))
    raise last


def slug(category, key):
    seed = CATS[category]["prefix"] + "|" + key
    return CATS[category]["prefix"] + "-" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:8]


def rel_web(path):
    return os.path.relpath(path, os.path.join(ROOT, "web")).replace("\\", "/")


def read_entities():
    """从主表读出三类名称，返回 {category: [(key, title_name)]}。"""
    wb = load_workbook(SRC, data_only=True)
    out = {"items": [], "strategies": [], "covenants": []}

    ws = wb["道具表"]
    seen = set()
    for r in range(2, ws.max_row + 1):
        n = ws.cell(row=r, column=1).value
        n = str(n).strip() if n is not None else ""
        if n and n not in seen:
            seen.add(n)
            out["items"].append((n, n))

    ws = wb["策略表"]
    seen = set()
    for r in range(2, ws.max_row + 1):
        n = ws.cell(row=r, column=1).value
        n = str(n).strip() if n is not None else ""
        if n and n not in seen:
            seen.add(n)
            out["strategies"].append((n, n))

    ws = wb["盟约表"]
    for r in range(2, ws.max_row + 1):
        name = ws.cell(row=r, column=1).value
        cid = ws.cell(row=r, column=7).value
        name = str(name).strip() if name is not None else ""
        cid = str(cid).strip() if cid is not None else ""
        key = cid or name
        if key:
            out["covenants"].append((key, key))

    wb.close()
    return out


def query_info(titles, delay, chunk_size=40):
    """批量查 imageinfo，返回 {原始标题: imageinfo}。"""
    found = {}
    for i in range(0, len(titles), chunk_size):
        chunk = titles[i:i + chunk_size]
        params = {
            "action": "query", "format": "json", "prop": "imageinfo",
            "iiprop": "url|size|mime", "titles": "|".join(chunk),
        }
        url = API + "?" + urllib.parse.urlencode(params)
        throttle(delay)
        raw = http_get(url, HEADERS)
        data = json.loads(raw.decode("utf-8"))
        norm = {}
        for n in (data.get("query") or {}).get("normalized", []):
            norm[n.get("to")] = n.get("from")
        for _pid, page in ((data.get("query") or {}).get("pages") or {}).items():
            if "missing" in page:
                continue
            info = (page.get("imageinfo") or [{}])[0]
            if not info.get("url"):
                continue
            title = page.get("title", "")
            found[norm.get(title, title)] = info
    return found


def actual_filename(info):
    """imageinfo 里真实文件的名字（处理 MediaWiki 重定向，如 盟约之币 → 幸运硬币）。"""
    url = (info or {}).get("url") or ""
    return urllib.parse.unquote(url.split("?", 1)[0].rsplit("/", 1)[-1])


def current_page_filenames(delay):
    """抓本期页面的渲染结果，返回页面里实际用到的图标文件名集合。

    只信任「卫戍协议·规程」页面自己渲染的图，不按文件名前缀猜版本。
    """
    names = set()
    for sec in PAGE_SECTIONS:
        params = {
            "action": "parse", "format": "json", "page": PAGE,
            "prop": "text", "section": sec,
        }
        url = API + "?" + urllib.parse.urlencode(params)
        throttle(delay)
        raw = http_get(url, HEADERS)
        data = json.loads(raw.decode("utf-8"))
        text = ((data.get("parse") or {}).get("text") or {}).get("*", "")
        for src in re.findall(r'<img[^>]+src="([^"]+)"', text):
            base = urllib.parse.unquote(src).rsplit("/", 1)[-1].split("?")[0]
            base = re.sub(r"^\d+px-", "", base)
            if base:
                names.add(base)
    return names


def square_image(im, size, pad, cover, trim):
    im = im.convert("RGBA")
    if cover:
        return ImageOps.fit(im, (size, size), Image.LANCZOS, centering=(0.5, 0.5))
    if trim:
        # 游戏图标 PNG 四周常有大量透明边；先裁掉，卡片里才够饱满
        bbox = im.getbbox()
        if bbox:
            im = im.crop(bbox)
    inner = max(1, int(round(size * (1 - 2 * pad))))
    w, h = im.size
    scale = min(inner / float(w), inner / float(h))
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    art = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(art, ((size - nw) // 2, (size - nh) // 2), art)
    return canvas


def process(raw_path, category, key):
    cfg = CATS[category]
    im = Image.open(raw_path)
    base = slug(category, key)
    out = {}
    for size in cfg["sizes"]:
        path = os.path.join(OUT_DIR, "%s-%d.webp" % (base, size))
        square_image(im, size, cfg["pad"], cfg["cover"], cfg["trim"]).save(
            path, "WEBP", quality=QUALITY.get(size, 85), method=6
        )
        out[size] = path
    return out


def write_outputs(manifest, stats, started):
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write("\n")

    lines = ["# 图标抓取报告\n"]
    lines.append("- 时间：%s" % time.strftime("%Y-%m-%d %H:%M:%S"))
    lines.append("- 来源：PRTS wiki（本期「卫戍协议·规程」）")
    lines.append("- 本次耗时：%.1f 秒" % (time.time() - started))
    lines.append("")
    lines.append("| 类别 | 目标 | 成功 | 缺失 | 失败 | 小图 | 大图 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- |")
    for cat in ("items", "strategies", "covenants"):
        s = stats.get(cat)
        if not s:
            continue
        lines.append("| %s | %d | **%d** | %d | %d | %.0f KB | %.0f KB |" % (
            CATS[cat]["label"], s["total"], s["ok"], len(s["missing"]), len(s["failed"]),
            s["bytes"][0] / 1024.0, s["bytes"][1] / 1024.0))
    lines.append("")
    for cat in ("items", "strategies", "covenants"):
        s = stats.get(cat)
        if not s:
            continue
        if s["missing"]:
            lines.append("## %s 缺失（PRTS 无此文件，前端回退色块首字）\n" % CATS[cat]["label"])
            for n in s["missing"]:
                lines.append("- %s" % n)
            lines.append("")
        if s.get("unverified"):
            lines.append("## %s 未通过本期页面校验（已跳过）\n" % CATS[cat]["label"])
            for n in s["unverified"]:
                lines.append("- %s" % n)
            lines.append("")
        if s["failed"]:
            lines.append("## %s 失败（网络/解析，可重跑）\n" % CATS[cat]["label"])
            for n, e in s["failed"]:
                lines.append("- %s：%s" % (n, e))
            lines.append("")
    with open(REPORT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="只跑某类，逗号分隔：items,strategies,covenants")
    ap.add_argument("--limit", type=int, default=0, help="每类只处理前 N 个（试跑）")
    ap.add_argument("--force", action="store_true", help="忽略缓存，全部重下")
    ap.add_argument("--delay", type=float, default=0.25, help="请求间隔秒数")
    ap.add_argument("--no-verify", action="store_true",
                    help="跳过「本期页面是否真的引用该图标」的版本校验（不建议）")
    args = ap.parse_args()

    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)

    wanted = [x.strip() for x in args.only.split(",") if x.strip()]
    for w in wanted:
        if w not in CATS:
            print("未知类别：%s（可选：%s）" % (w, "、".join(CATS)))
            return 1

    entities = read_entities()
    started = time.time()
    manifest = {"generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
                "season": "卫戍协议·规程",
                "page": PAGE,
                "source": "prts", "license": "official-art", "items": {},
                "strategies": {}, "covenants": {}}

    # --only 时保留其它类别的旧清单，避免把另外两类清空
    if wanted and os.path.exists(MANIFEST):
        try:
            with open(MANIFEST, encoding="utf-8") as f:
                old = json.load(f)
            for cat in ("items", "strategies", "covenants"):
                if isinstance(old.get(cat), dict):
                    manifest[cat] = old[cat]
        except Exception:
            pass

    referenced = set()
    verify_ok = False
    if not args.no_verify:
        try:
            referenced = current_page_filenames(args.delay)
            verify_ok = bool(referenced)
            print("版本校验：本期「%s」页面引用 %d 个图标文件。" % (PAGE, len(referenced)))
        except Exception as e:
            print("版本校验失败（%s）；继续抓取，但本轮不做页面引用校验。" % e)

    stats = {}

    for cat in ("items", "strategies", "covenants"):
        if wanted and cat not in wanted:
            continue
        cfg = CATS[cat]
        pairs = entities[cat]
        if args.limit:
            pairs = pairs[: args.limit]
        s = {"total": len(pairs), "ok": 0, "missing": [], "failed": [],
             "unverified": [], "bytes": [0, 0]}
        stats[cat] = s
        print("\n%s（%d 个）…" % (cfg["label"], len(pairs)))

        titles = ["文件:" + (cfg["title"] % name) for _key, name in pairs]
        try:
            infos = query_info(titles, args.delay)
        except Exception as e:
            print("  查询失败：%s" % e)
            infos = {}

        for idx, (key, name) in enumerate(pairs, 1):
            title = "文件:" + (cfg["title"] % name)
            tag = "[%s %3d/%3d] %s" % (cfg["prefix"], idx, len(pairs), key)
            raw_path = os.path.join(CACHE_DIR, slug(cat, key) + ".png")

            want_file = (cfg["title"] % name).replace(" ", "_")
            info = infos.get(title)
            real_file = actual_filename(info) if info else want_file
            if verify_ok and real_file not in referenced:
                s["unverified"].append(key)
                print(tag, "→ 本期页面未引用，跳过")
                continue
            if info and real_file != want_file:
                print(tag, "→ 重定向至 %s" % real_file)

            try:
                if os.path.exists(raw_path) and not args.force:
                    out = process(raw_path, cat, key)
                else:
                    if not info:
                        s["missing"].append(key)
                        print(tag, "→ 无此文件")
                        continue
                    throttle(args.delay)
                    blob = http_get(info["url"], IMG_HEADERS)
                    if len(blob) < 300:
                        raise ValueError("图片过小（%d 字节）" % len(blob))
                    with open(raw_path, "wb") as f:
                        f.write(blob)
                    out = process(raw_path, cat, key)

                for i, size in enumerate(cfg["sizes"]):
                    s["bytes"][i] += os.path.getsize(out[size])
                manifest[cat][key] = {
                    "list": rel_web(out[cfg["sizes"][0]]),
                    "full": rel_web(out[cfg["sizes"][1]]),
                    "source": "prts",
                    "license": "official-art",
                    "file": real_file,
                    "sourcePage": (info.get("descriptionurl") if info else
                                   "https://prts.wiki/w/" + urllib.parse.quote(title)),
                    "fetchedAt": time.strftime("%Y-%m-%d"),
                }
                s["ok"] += 1
                print(tag, "→ ok %.1fKB" % (os.path.getsize(out[cfg["sizes"][1]]) / 1024.0))
            except Exception as e:
                s["failed"].append((key, str(e)))
                print(tag, "→ 失败：", e)

        write_outputs(manifest, stats, started)

    write_outputs(manifest, stats, started)

    print("")
    total_ok = sum(s["ok"] for s in stats.values())
    total_all = sum(s["total"] for s in stats.values())
    print("完成 %d / %d，缺失 %d，失败 %d" % (
        total_ok, total_all,
        sum(len(s["missing"]) for s in stats.values()),
        sum(len(s["failed"]) for s in stats.values())))
    print("清单：%s" % os.path.relpath(MANIFEST, ROOT))
    print("报告：%s" % os.path.relpath(REPORT, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
