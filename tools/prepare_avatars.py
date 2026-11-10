# -*- coding: utf-8 -*-
"""
从 PRTS wiki 抓取干员头像，裁方、压缩成 WebP，并生成头像清单。

用法（推荐用带 Pillow 的 Python，见 开发说明.md）：
    python tools/prepare_avatars.py                # 增量：已缓存的跳过
    python tools/prepare_avatars.py --force        # 全部重下
    python tools/prepare_avatars.py --only 幽灵鲨,老鲤
    python tools/prepare_avatars.py --limit 5      # 先试 5 个
    python tools/prepare_avatars.py --delay 0.5    # 放慢请求（默认 0.3s）

产物：
    build/avatar-cache/<slug>.png        原始 180×180 PNG（重复运行不再下载）
    web/assets/avatars/<slug>-96.webp    列表用（卡片）
    web/assets/avatars/<slug>-180.webp   详情用
    data/avatars.json                    清单（build_web_data.py 读取后写进 data.json）
    build/avatar_report.md               成功/缺失/失败清单与体积

数据来源与版权：
    · 文件来自 PRTS wiki（MediaWiki），命名规则为「文件:头像_<干员名>.png」，180×180。
    · 游戏美术版权归鹰角网络所有；本项目仅作非商业的玩家查询用途。
    · 站点默认展示头像，但顶栏可一键关闭（纯文字 / 色块首字），
      公开部署如收到权利人异议，关掉即可，不需要改数据。
"""
import sys, io, os, re, json, time, argparse, hashlib
import urllib.parse
import urllib.request
import urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

try:
    from PIL import Image
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
CACHE_DIR = os.path.join(ROOT, "build", "avatar-cache")
OUT_DIR = os.path.join(ROOT, "web", "assets", "avatars")
MANIFEST = os.path.join(ROOT, "data", "avatars.json")
REPORT = os.path.join(ROOT, "build", "avatar_report.md")
API = "https://prts.wiki/api.php"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://prts.wiki/",
}
IMG_HEADERS = dict(HEADERS, Accept="image/avif,image/webp,image/png,*/*;q=0.8")

# 数据表里的名字与 PRTS 文件名不一致时在这里补一条（键=表内名称，值=PRTS 用的名字）
ALIASES = {
    "阿米娅（医疗形态）": "阿米娅(医疗)",
}


def prts_name(name):
    return ALIASES.get(name, name)

_last_request = [0.0]


def throttle(delay):
    gap = time.time() - _last_request[0]
    if gap < delay:
        time.sleep(delay - gap)
    _last_request[0] = time.time()


def http_get(url, headers, tries=3, timeout=30):
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


def slug(name):
    return "av-" + hashlib.sha1(name.encode("utf-8")).hexdigest()[:8]


def operator_names(wanted=None):
    wb = load_workbook(SRC, data_only=True)
    ws = wb["干员表"]
    names = []
    for r in range(2, ws.max_row + 1):
        v = ws.cell(row=r, column=1).value
        if v is None:
            continue
        n = str(v).strip()
        if not n or n.startswith("自选配置"):
            continue
        if n not in names:
            names.append(n)
    # 自选干员（6★ 甄选池）也要头像；它们不在 155 条干员表里。
    if "自选干员" in wb.sheetnames:
        ps = wb["自选干员"]
        for r in range(2, ps.max_row + 1):
            v = ps.cell(row=r, column=1).value
            if v is None:
                continue
            n = str(v).strip()
            if n and n not in names:
                names.append(n)
    wb.close()
    if wanted:
        keep = [n for n in names if n in wanted]
        unknown = [n for n in wanted if n not in names]
        if unknown:
            print("不在干员表 / 自选干员表里的名字（忽略）：%s" % "、".join(unknown))
        return keep
    return names


def lookup(name, delay):
    """返回 (原始图片 URL, 文件名)；文件不存在返回 (None, None)。"""
    file_name = prts_name(name)
    title = "File:头像_%s.png" % file_name
    params = {
        "action": "query",
        "format": "json",
        "prop": "imageinfo",
        "iiprop": "url|size",
        "iiurlwidth": "180",
        "titles": title,
    }
    url = API + "?" + urllib.parse.urlencode(params)
    throttle(delay)
    raw = http_get(url, HEADERS)
    data = json.loads(raw.decode("utf-8"))
    pages = (data.get("query") or {}).get("pages") or {}
    for _pid, page in pages.items():
        if "missing" in page:
            return None, None
        info = (page.get("imageinfo") or [{}])[0]
        src = info.get("url")
        if src:
            return src, title
    return None, None


def process(raw_path, name):
    im = Image.open(raw_path)
    im = im.convert("RGBA")
    w, h = im.size
    side = min(w, h)
    if (w, h) != (side, side):
        left = (w - side) // 2
        top = (h - side) // 2
        im = im.crop((left, top, left + side, top + side))

    base = slug(name)
    out = {}
    for size, quality in ((96, 82), (180, 90)):
        path = os.path.join(OUT_DIR, "%s-%d.webp" % (base, size))
        im.resize((size, size), Image.LANCZOS).save(
            path, "WEBP", quality=quality, method=6
        )
        out[size] = path
    return out


def rel_web(path):
    return os.path.relpath(path, os.path.join(ROOT, "web")).replace("\\", "/")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="只处理这些名字，逗号分隔")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 个（试跑）")
    ap.add_argument("--force", action="store_true", help="忽略缓存，全部重下")
    ap.add_argument("--delay", type=float, default=0.3, help="请求间隔秒数")
    args = ap.parse_args()

    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)

    wanted = [x.strip() for x in args.only.split(",") if x.strip()] if args.only else None
    names = operator_names(wanted)
    if args.limit:
        names = names[: args.limit]

    print("干员 %d 名，开始抓取（间隔 %.2fs）…" % (len(names), args.delay))

    manifest = {}
    ok, cached, missing, failed = [], [], [], []
    total_bytes = {96: 0, 180: 0}
    started = time.time()

    for i, name in enumerate(names, 1):
        tag = "[%3d/%3d] %s" % (i, len(names), name)
        raw_path = os.path.join(CACHE_DIR, slug(name) + ".png")

        try:
            if os.path.exists(raw_path) and not args.force:
                # 原图在缓存里：直接重新编码（换尺寸/质量时不用重新下载）
                sizes = process(raw_path, name)
                cached.append(name)
                state = "cached"
            else:
                url, title = lookup(name, args.delay)
                if not url:
                    missing.append(name)
                    print(tag, "→ 无此文件")
                    continue
                throttle(args.delay)
                blob = http_get(url, IMG_HEADERS)
                if len(blob) < 500:
                    raise ValueError("图片过小（%d 字节）" % len(blob))
                with open(raw_path, "wb") as f:
                    f.write(blob)
                sizes = process(raw_path, name)
                ok.append(name)
                state = "ok"

            for size, path in sizes.items():
                total_bytes[size] += os.path.getsize(path)

            manifest[name] = {
                "list": rel_web(sizes[96]),
                "full": rel_web(sizes[180]),
                "source": "prts",
                "license": "official-art",
                "file": "头像_%s.png" % prts_name(name),
                "sourcePage": "https://prts.wiki/w/" + urllib.parse.quote("文件:头像_%s.png" % prts_name(name)),
                "fetchedAt": time.strftime("%Y-%m-%d"),
            }
            print(tag, "→", state, "%.1fKB" % (os.path.getsize(sizes[180]) / 1024.0))
        except Exception as e:
            failed.append((name, str(e)))
            print(tag, "→ 失败：", e)

        # 每 20 个落一次盘，避免中途断掉丢进度
        if i % 20 == 0:
            write_outputs(manifest, ok, cached, missing, failed, total_bytes, started)

    write_outputs(manifest, ok, cached, missing, failed, total_bytes, started)

    print("")
    print("成功 %d（新下载 %d / 缓存 %d）、缺失 %d、失败 %d"
          % (len(manifest), len(ok), len(cached), len(missing), len(failed)))
    print("头像 96px 合计 %.0f KB，180px 合计 %.0f KB"
          % (total_bytes[96] / 1024.0, total_bytes[180] / 1024.0))
    print("清单：%s" % os.path.relpath(MANIFEST, ROOT))
    print("报告：%s" % os.path.relpath(REPORT, ROOT))
    return 0


def write_outputs(manifest, ok, cached, missing, failed, total_bytes, started):
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write("\n")

    lines = []
    lines.append("# 干员头像抓取报告\n")
    lines.append("- 时间：%s" % time.strftime("%Y-%m-%d %H:%M:%S"))
    lines.append("- 来源：PRTS wiki（文件:头像_<干员名>.png）")
    lines.append("- 本次耗时：%.1f 秒" % (time.time() - started))
    lines.append("- 成功：**%d**（新下载 %d / 命中缓存 %d）" % (len(manifest), len(ok), len(cached)))
    lines.append("- 缺失：%d，失败：%d" % (len(missing), len(failed)))
    lines.append("- 体积：96px %.0f KB，180px %.0f KB" % (total_bytes[96] / 1024.0, total_bytes[180] / 1024.0))
    lines.append("")
    if missing:
        lines.append("## 缺失（PRTS 无此文件，前端回退色块首字）\n")
        for n in missing:
            lines.append("- %s" % n)
        lines.append("")
    if failed:
        lines.append("## 失败（网络/解析，可重跑）\n")
        for n, e in failed:
            lines.append("- %s：%s" % (n, e))
        lines.append("")
    with open(REPORT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    sys.exit(main())
