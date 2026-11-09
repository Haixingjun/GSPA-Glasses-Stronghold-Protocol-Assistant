# -*- coding: utf-8 -*-
"""
从 PRTS 抓「卫戍协议·规程」本季的盟约数值文本（含层数公式），写到 data/covenant_values.json。

用法：
    python tools/fetch_covenant_values.py
    python tools/fetch_covenant_values.py --check      # 只比对，不写文件

为什么单独抓：
    Excel 主表只存「（受层数影响）」这类定性描述，没有数值；
    而 PRTS 的盟约页给了 (23+0.9×层数) 这样的公式，配队要按层数算具体数值就需要它。

版本锚定（重要）：
    PRTS 上同时存在 2024 / 2025-11「盟约」/ 2026-03「盟约 下半」/ 2026-11「规程」多期数据。
    本脚本只读 [[卫戍协议·规程/PRTS盟约记录]] 的「核心盟约」「附加盟约」两节，
    并记录抓取时的赛季、页面修订时间、游戏数据版本；
    同时和 data/covenant_meta.json / data.json 对账，名字或人数对不上直接报错退出，
    避免把别期的数值写进本期。
"""
import sys, io, os, re, json, time
import urllib.parse
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "covenant_values.json")
META_JSON = os.path.join(ROOT, "data", "covenant_meta.json")
DATA_JSON = os.path.join(ROOT, "web", "data", "data.json")

API = "https://prts.wiki/api.php"
PAGE = "卫戍协议·规程/PRTS盟约记录"
SEASON = "卫戍协议·规程"
SECTIONS = ("2", "3")  # 核心盟约 / 附加盟约

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://prts.wiki/",
}


def api(params, tries=3):
    params = dict(params, format="json")
    url = API + "?" + urllib.parse.urlencode(params)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # 网络抖动 / 429
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


# 只清 HTML 标签，保留 <在场6名不同【炎】干员> 这类游戏内条件写法
HTML_TAG = re.compile(
    r"</?(?:span|div|p|b|i|em|strong|a|small|sup|sub|ruby|rt|rp|font|"
    r"table|tbody|thead|tr|td|th|center|big|code|ref|nowiki)\b[^>]*>",
    re.I,
)


def clean(s):
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    for _ in range(8):
        new = re.sub(r"\{\{([^{}]*)\}\}", lambda m: m.group(1).split("|")[-1], s)
        if new == s:
            break
        s = new
    s = HTML_TAG.sub("", s)
    s = s.replace("[[", "").replace("]]", "")
    s = re.sub(r"[ \t\u3000]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def main():
    check_only = "--check" in sys.argv

    # ---- 期望的盟约名单（以主表的分类文件为准）----
    with open(META_JSON, encoding="utf-8") as f:
        expected = set(json.load(f))

    texts, counts = {}, {}
    for sec in SECTIONS:
        r = api({"action": "parse", "page": PAGE, "section": sec, "prop": "wikitext"})
        wt = r["parse"]["wikitext"]["*"]
        for m in re.finditer(r"\{\{卫戍协议/盟约\|盟约=([^|]+)\|人数=(\d+)\|效果=(.*?)\|干员=", wt, re.S):
            name = m.group(1).strip()
            texts[name] = clean(m.group(3))
            counts[name] = int(m.group(2))

    if not texts:
        print("没解析到任何盟约，页面结构可能变了")
        return 1

    # ---- 对账 1：名字集合必须与主表一致 ----
    missing = expected - set(texts)
    extra = set(texts) - expected
    if missing or extra:
        print("盟约名单与主表不一致，疑似串季或页面改版：")
        if missing:
            print("  页面缺少：", "、".join(sorted(missing)))
        if extra:
            print("  页面多出：", "、".join(sorted(extra)))
        return 1

    # ---- 对账 2：人数（激活门槛）与 data.json 一致 ----
    drift = []
    if os.path.exists(DATA_JSON):
        with open(DATA_JSON, encoding="utf-8") as f:
            data = json.load(f)
        for c in data["covenants"]:
            n = counts.get(c["name"])
            t = (c.get("activation") or {}).get("threshold")
            if n is not None and t is not None and n != t and c["name"] not in ("调和", "协防干员", "独行", "绝技"):
                drift.append("%s：页面 %s / 主表 %s" % (c["name"], n, t))
    if drift:
        print("激活人数对不上（可能是期次不同，先核对再抓）：")
        for d in drift:
            print("  -", d)
        return 1

    # ---- 版本信息 ----
    rev = api({"action": "query", "prop": "revisions", "titles": PAGE,
               "rvprop": "timestamp|comment", "rvlimit": "1"})
    page = list(rev["query"]["pages"].values())[0]
    last = (page.get("revisions") or [{}])[0]
    comment = last.get("comment", "")
    m = re.search(r"数据版本([0-9A-Za-z\-]+)", comment)
    game_data = m.group(1) if m else ""

    payload = {
        "meta": {
            "season": SEASON,
            "page": PAGE,
            "source": "https://prts.wiki/w/" + urllib.parse.quote(PAGE),
            "revisionAt": last.get("timestamp", ""),
            "gameDataVersion": game_data,
            "fetchedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "license": "CC BY-NC-SA（PRTS）",
            "note": "只含『规程』本期核心/附加盟约的数值文本；层数公式形如 (23+0.9×层数)",
        },
        "texts": {k: texts[k] for k in sorted(texts)},
    }

    print("赛季：%s" % SEASON)
    print("页面修订：%s（%s）" % (last.get("timestamp", "?"), comment[:50]))
    print("游戏数据版本：%s" % (game_data or "未标注"))
    print("盟约：%d 条，人数对账通过" % len(texts))

    if check_only:
        print("--check：不写文件")
        return 0

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("写入 %s" % os.path.relpath(OUT, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
