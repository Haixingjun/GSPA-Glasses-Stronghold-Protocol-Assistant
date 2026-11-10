# -*- coding: utf-8 -*-
"""
把 web/ 打成可部署的 dist/：
    1. dist/                 —— 目录版（服务器 / Cloudflare Pages / B站 Toy 静态包）
    2. dist/standalone.html  —— 单文件版（微信里发、本地双击、压缩包直传）
    3. build/gspa-web.zip    —— 目录版的 zip（B站 Toy 上传用）

用法：
    python tools/build_dist.py            # 全量
    python tools/build_dist.py --no-zip   # 不生成 zip

要点：
    · 资源 URL 自动加 ?v=<指纹>，配合 nginx / Pages 的长缓存策略，改版后不必清缓存。
    · 单文件版把所有 CSS / JS / 数据内联，零外部请求，file:// 双击可开。
    · 产物里没有绝对路径（没有 /assets 这种），所以可以部署在任意子目录
      （https://example.com/gspa/、B站 Toy 的沙箱路径都没问题）。
"""
import sys, io, os, re, json, time, gzip, shutil, hashlib, zipfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
DIST = os.path.join(ROOT, "dist")
BUILD = os.path.join(ROOT, "build")
DEPLOY = os.path.join(ROOT, "deploy")
ZIP_PATH = os.path.join(BUILD, "gspa-web.zip")
BUDGET_KB = 120.0   # 2026-11 功能累积（盟约图标标签 / 移动端输入防缩放 / 词条栏拖动）后首屏 117.5 KB；预算留约 2.5 KB 余量


def read_text(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def read_bytes(p):
    with open(p, "rb") as f:
        return f.read()


def write_text(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)


def write_bytes(p, b):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(b)


def gzkb(b):
    return len(gzip.compress(b, 9)) / 1024.0


def kb(n):
    return n / 1024.0


def human(n):
    return "%.1f KB" % kb(n)


def main():
    no_zip = "--no-zip" in sys.argv

    if not os.path.isdir(WEB):
        print("找不到 web/ 目录")
        return 1
    if not os.path.exists(os.path.join(WEB, "data", "data.js")):
        print("缺少 web/data/data.js，请先运行：python tools/build_web_data.py")
        return 1

    index_path = os.path.join(WEB, "index.html")
    css_path = os.path.join(WEB, "assets", "app.css")
    data_path = os.path.join(WEB, "data", "data.js")

    index_src = read_text(index_path)
    # 按 index.html 里 <script src="js/..."> 的出现顺序收集：
    # 以后再加前端模块（calc.js / team.js 这类）不用回来改本脚本。
    js_names = re.findall(r'<script\b[^>]*\bsrc="js/([^"?]+)', index_src)
    if not js_names:
        print("index.html 里没有找到 js/ 脚本，先确认页面没被改坏")
        return 1

    css_src = read_text(css_path)
    js_src = {n: read_text(os.path.join(WEB, "js", n)) for n in js_names}
    data_src = read_text(data_path)

    # 敌人图鉴是独立页面（web/enemies.html），资源单独收集；
    # 不存在时不影响主站构建。
    enemy_path = os.path.join(WEB, "enemies.html")
    enemy_src = read_text(enemy_path) if os.path.exists(enemy_path) else ""
    enemy_extra = []
    for rel in ("assets/enemies.css", "data/enemies.js", "js/enemies.js"):
        p = os.path.join(WEB, rel)
        if os.path.exists(p):
            enemy_extra.append(read_text(p))

    # ---------- 指纹：任何资源变了，URL 就变 ----------
    h = hashlib.sha1()
    h.update(css_src.encode("utf-8"))
    for n in js_names:
        h.update(js_src[n].encode("utf-8"))
    h.update(data_src.encode("utf-8"))
    h.update(enemy_src.encode("utf-8"))
    for body in enemy_extra:
        h.update(body.encode("utf-8"))
    stamp = h.hexdigest()[:8]

    data_meta = {}
    try:
        data_meta = json.loads(read_text(os.path.join(WEB, "data", "data.json")))
    except Exception:
        data_meta = {}

    # ---------- dist/ 目录版 ----------
    if os.path.isdir(DIST):
        try:
            shutil.rmtree(DIST)
        except PermissionError:
            # Windows 上目录可能被正在运行的预览服务器占着。删不掉不等于不能更新：
            # 改为覆盖写入，旧版本的残留文件不会被删（带指纹的资源不会互相干扰）。
            print("dist/ 正被占用，改为增量覆盖；旧版本残留文件不会删除。")
            print("需要彻底清理时，先关掉预览服务再重跑本脚本。")
    shutil.copytree(WEB, DIST, dirs_exist_ok=True)

    def bust(m):
        attr, url = m.group(1), m.group(2)
        return '%s="%s?v=%s"' % (attr, url, stamp)

    index_out = re.sub(r'(href|src)="((?:assets|js|data)/[^"?#]+)"', bust, index_src)
    write_text(os.path.join(DIST, "index.html"), index_out)
    if enemy_src:
        enemy_out = re.sub(r'(href|src)="((?:assets|js|data)/[^"?#]+)"', bust, enemy_src)
        write_text(os.path.join(DIST, "enemies.html"), enemy_out)

    if os.path.isdir(DEPLOY):
        for name in ("_headers", "robots.txt"):
            src = os.path.join(DEPLOY, name)
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(DIST, name))

    # .nojekyll：放 GitHub Pages 时别让 Jekyll 干扰
    write_bytes(os.path.join(DIST, ".nojekyll"), b"")

    # ---------- 单文件版 ----------
    def inline_link(m):
        tag = m.group(0)
        href = m.group(1).split("?")[0]
        if href.endswith("app.css"):
            body = css_src.replace("</style>", "<\\/style>")
            return "<style>\n" + body + "\n</style>"
        return tag  # favicon 等 data: URI 原样保留

    def inline_script(m):
        tag = m.group(0)
        src = m.group(1).split("?")[0]
        if src.startswith("data/"):
            body = data_src
        elif src.startswith("js/"):
            body = js_src.get(src.split("/")[-1], "")
        else:
            return tag
        body = body.replace("</script", "<\\/script")
        return "<script>\n" + body + "\n</script>"

    standalone = re.sub(r'<link\b[^>]*href="([^"]+)"[^>]*>', inline_link, index_src)
    # 敌人图鉴是独立页面，单文件版没有它的资源与头像；构建时隐藏入口，避免死链。
    standalone = re.sub(r'<a\b[^>]*data-standalone-hide[^>]*>.*?</a>', '', standalone, flags=re.S)
    standalone = re.sub(r'<script\b[^>]*src="([^"]+)"[^>]*>\s*</script>', inline_script, standalone)
    standalone = standalone.replace(
        "<head>",
        "<head>\n<!-- 单文件版（由 tools/build_dist.py 生成）：CSS / JS / 数据全部内联，"
        "零外部请求，可直接双击或整份发送。 -->",
        1,
    )
    standalone = standalone.replace(
        "</head>",
        "<script>window.GSPA_NO_AVATARS = true; window.GSPA_NO_ICONS = true;</script>\n</head>",
        1,
    )
    write_text(os.path.join(DIST, "standalone.html"), standalone)

    # ---------- 体积报告 ----------
    files = []
    for base, _dirs, names in os.walk(DIST):
        for n in names:
            p = os.path.join(base, n)
            rel = os.path.relpath(p, DIST).replace("\\", "/")
            files.append((rel, os.path.getsize(p)))
    files.sort()

    first_screen = [
        ("index.html", os.path.join(DIST, "index.html")),
        ("assets/app.css", os.path.join(DIST, "assets", "app.css")),
    ] + [("js/" + n, os.path.join(DIST, "js", n)) for n in js_names] + [
        ("data/data.js", os.path.join(DIST, "data", "data.js")),
    ]

    lines = []
    lines.append("首屏（gzip 前 → 后）：")
    total_raw = total_gz = 0
    for label, p in first_screen:
        b = read_bytes(p)
        gz = len(gzip.compress(b, 9))
        total_raw += len(b)
        total_gz += gz
        lines.append("  %-18s %8s  →  %7s" % (label, human(len(b)), human(gz)))
    lines.append("  %-18s %8s  →  %7s" % ("合计", human(total_raw), human(total_gz)))
    ok = (total_gz / 1024.0) < BUDGET_KB
    lines.append("  预算 %.0f KB（gzip）：%s" % (BUDGET_KB, "通过" if ok else "超出！"))

    sa_size = os.path.getsize(os.path.join(DIST, "standalone.html"))
    lines.append("")
    lines.append("单文件版 standalone.html：%s（gzip %s）" % (human(sa_size), human(len(gzip.compress(read_bytes(os.path.join(DIST, 'standalone.html')), 9)))))

    lines.append("")
    avatar_files = [(r, s) for r, s in files if r.startswith("assets/avatars/")]
    icon_files = [(r, s) for r, s in files if r.startswith("assets/icons/")]
    other_files = [(r, s) for r, s in files
                   if not r.startswith("assets/avatars/") and not r.startswith("assets/icons/")]
    lines.append("dist 文件清单：")
    for rel, size in other_files:
        lines.append("  %-26s %8s" % (rel, human(size)))
    if avatar_files:
        lines.append("  %-26s %8s" % ("assets/avatars/ (%d 个)" % len(avatar_files),
                                      human(sum(s for _r, s in avatar_files))))
    if icon_files:
        lines.append("  %-26s %8s" % ("assets/icons/ (%d 个)" % len(icon_files),
                                      human(sum(s for _r, s in icon_files))))

    image_lines = []
    if avatar_files:
        image_lines.append("头像：dist/assets/avatars 共 %d 个 WebP（%s），懒加载；单文件版不含头像。" % (
            len(avatar_files), human(sum(s for _r, s in avatar_files))))
    if icon_files:
        image_lines.append("图标：dist/assets/icons 共 %d 个 WebP（%s，本期「规程」道具 / 策略 / 盟约）；"
                           "单文件版不含图标。" % (
                               len(icon_files), human(sum(s for _r, s in icon_files))))

    info = "\n".join([
        "GSPA · 眼镜卫戍协议小助手 · 构建产物说明",
        "=" * 40,
        "构建时间：%s" % time.strftime("%Y-%m-%d %H:%M:%S"),
        "数据版本：%s" % data_meta.get("version", "?"),
        "数据生成：%s" % data_meta.get("generatedAt", "?"),
        "资源指纹：%s" % stamp,
        "",
        "部署：把整个 dist/ 目录上传到站点根目录或任意子目录即可。",
        "单文件：dist/standalone.html 可单独发送 / 双击打开，无需其他文件。",
        "\n".join(image_lines),
        "缓存：资源已带 ?v=%s，index.html 建议 no-cache，静态资源可长缓存。" % stamp,
        "",
    ] + lines + [""])
    write_text(os.path.join(DIST, "BUILD_INFO.txt"), info)
    print(info)

    # ---------- 自检 ----------
    problems = []

    def local_refs(html):
        refs = []
        for m in re.finditer(r'(?:src|href)="([^"]+)"', html):
            url = m.group(1)
            if url.startswith(("data:", "#", "mailto:", "http://", "https://", "//")):
                continue
            refs.append(url.split("?")[0])
        return refs

    idx_html = read_text(os.path.join(DIST, "index.html"))
    for ref in local_refs(idx_html):
        if not os.path.exists(os.path.join(DIST, ref)):
            problems.append("index.html 引用了不存在的文件：" + ref)
    if re.search(r'(?:src|href)="/(?!/)', idx_html):
        problems.append("index.html 出现绝对路径（部署到子目录会 404）")

    sa_html = read_text(os.path.join(DIST, "standalone.html"))
    if re.search(r'<script[^>]+src=', sa_html):
        problems.append("standalone.html 仍有外链 script")
    if re.search(r'<link[^>]+rel="stylesheet"', sa_html):
        problems.append("standalone.html 仍有外链样式")
    if re.search(r'src="https?://', sa_html) or re.search(r'<link[^>]+href="https?://', sa_html):
        problems.append("standalone.html 存在外部资源请求")
    if re.search(r'url\(\s*["\']?https?://', sa_html):
        problems.append("standalone.html 的样式里引用了外部图片/字体")
    if "window.GSPA_DATA" not in sa_html:
        problems.append("standalone.html 未内联数据")
    if "window.GSPA_NO_AVATARS" not in sa_html:
        problems.append("standalone.html 缺少关闭头像的标记（单文件版不应引用外部头像）")
    if "window.GSPA_NO_ICONS" not in sa_html:
        problems.append("standalone.html 缺少关闭图标的标记（单文件版不应引用外部图标）")
    if re.search(r'(?:src|href)="/(?!/)', sa_html):
        problems.append("standalone.html 出现绝对路径")

    # data.json 里引用的头像必须随包上传，否则线上会 404（前端会回退，但没必要发坏链）
    data_json = os.path.join(DIST, "data", "data.json")
    if os.path.exists(data_json):
        try:
            dj = json.loads(read_text(data_json))
        except Exception as e:
            problems.append("data.json 解析失败：%s" % e)
            dj = {}
        missing_avatar = 0
        for o in dj.get("operators", []):
            for k in ("avatar", "avatarFull"):
                p = o.get(k)
                if p and not os.path.exists(os.path.join(DIST, p)):
                    missing_avatar += 1
                    if missing_avatar <= 3:
                        problems.append("data.json 引用的头像不存在：%s（%s）" % (p, o.get("name")))
        if missing_avatar > 3:
            problems.append("还有 %d 个头像引用缺失" % (missing_avatar - 3))

        missing_icon = 0
        for group in ("items", "strategies", "covenants"):
            for e in dj.get(group, []):
                for k in ("icon", "iconFull"):
                    p = e.get(k)
                    if p and not os.path.exists(os.path.join(DIST, p)):
                        missing_icon += 1
                        if missing_icon <= 3:
                            problems.append("data.json 引用的图标不存在：%s（%s/%s）" % (
                                p, group, e.get("name") or e.get("role") or e.get("key")))
        if missing_icon > 3:
            problems.append("还有 %d 个图标引用缺失" % (missing_icon - 3))

    if problems:
        print("\n自检未通过：")
        for p in problems:
            print("  ✗ " + p)
        ok = False
    else:
        print("自检通过：无外链、无绝对路径、引用文件齐全。")

    # ---------- zip ----------
    if not no_zip:
        os.makedirs(BUILD, exist_ok=True)
        if os.path.exists(ZIP_PATH):
            os.remove(ZIP_PATH)
        with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as z:
            for base, _dirs, names in os.walk(DIST):
                for n in names:
                    p = os.path.join(base, n)
                    rel = os.path.relpath(p, DIST).replace("\\", "/")
                    z.write(p, rel)
        print("已生成 %s（%s）" % (os.path.relpath(ZIP_PATH, ROOT), human(os.path.getsize(ZIP_PATH))))

    print("完成：dist/ 与 dist/standalone.html")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())

