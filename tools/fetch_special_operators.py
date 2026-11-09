# -*- coding: utf-8 -*-
"""
从 PRTS wiki 抓取「卫戍协议」特殊干员页，解析成 data/special_operators.json。

为什么单独做这一层：
  · 主表（卫戍协议数据表.xlsx）来自官方解包，只有「条目」字段（阶数/盟约/售价/效果），
    没有干员的职业、分支、属性、天赋、技能；解包原始参数里只能看到 chess_char_* 召唤 ID。
  · PRTS 的「干员」页有完整档案，但同名单位跨版本很多（例如 Pith 在 2024 β 是 6★ 术师，
    2025「盟约」的【优等生】召唤的是 4★ 辅助「盟约·辅助干员」），不能按名字直接合并。
  · 因此本脚本把「哪张策略召唤哪个干员、属于哪一期」写在 data/special_operator_pages.json，
    抓取结果只作为「补充档案」注入主数据；主表数值仍以解包 xlsx 为准。

用法：
    python tools/fetch_special_operators.py            # 联网抓取并写缓存 + JSON
    python tools/fetch_special_operators.py --offline  # 只用 source/prts/ 缓存重解析
    python tools/fetch_special_operators.py --only “暴躁铁皮”

产物：
    source/prts/<pageid>.json      原始 wikitext + pageid/revid/时间（溯源用）
    data/special_operators.json    解析结果（build_web_data.py 读取后注入 data.json）

依赖：仅标准库。
"""
import sys, io, os, re, json, time, urllib.parse, urllib.request, urllib.error, argparse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "data", "special_operator_pages.json")
OUT = os.path.join(ROOT, "data", "special_operators.json")
CACHE_DIR = os.path.join(ROOT, "source", "prts")
API = "https://prts.wiki/api.php"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://prts.wiki/",
}

# 只清理真正的 HTML 标签；不要误伤游戏文本里的 <战斗中> 这类尖括号
HTML_TAG_RE = re.compile(r"</?(?:span|div|br|small|b|i|p|a|sup|sub|ruby|rt|rp)\b[^>]*>", re.I)


# ------------------------------------------------------------------ wikitext
def find_matching(s, start):
    """s[start:start+2] == '{{'，返回配对 '}}' 结束后的下标；失败返回 -1。"""
    depth = 0
    i = start
    n = len(s)
    while i < n - 1:
        two = s[i:i + 2]
        if two == "{{":
            depth += 1
            i += 2
            continue
        if two == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return i
            continue
        i += 1
    return -1


def split_top(s, sep="|"):
    """按顶层分隔符切分，忽略 {{...}} / [[...]] 里的分隔符。"""
    parts = []
    buf = []
    depth_t = depth_l = 0
    i = 0
    n = len(s)
    while i < n:
        two = s[i:i + 2]
        if two == "{{":
            depth_t += 1
            buf.append(two)
            i += 2
            continue
        if two == "}}":
            depth_t = max(0, depth_t - 1)
            buf.append(two)
            i += 2
            continue
        if two == "[[":
            depth_l += 1
            buf.append(two)
            i += 2
            continue
        if two == "]]":
            depth_l = max(0, depth_l - 1)
            buf.append(two)
            i += 2
            continue
        if s[i] == sep and depth_t == 0 and depth_l == 0:
            parts.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(s[i])
        i += 1
    parts.append("".join(buf))
    return parts


def top_eq(s):
    depth_t = depth_l = 0
    i = 0
    while i < len(s):
        two = s[i:i + 2]
        if two == "{{":
            depth_t += 1
            i += 2
            continue
        if two == "}}":
            depth_t = max(0, depth_t - 1)
            i += 2
            continue
        if two == "[[":
            depth_l += 1
            i += 2
            continue
        if two == "]]":
            depth_l = max(0, depth_l - 1)
            i += 2
            continue
        if s[i] == "=" and depth_t == 0 and depth_l == 0:
            return i
        i += 1
    return -1


def render_inner(inner):
    parts = split_top(inner, "|")
    name = parts[0].strip()
    args = parts[1:]
    pos = [a for a in args if top_eq(a) < 0]
    vals = [clean(a) for a in pos]
    if name in ("color", "*", "变动数值lite", "术语", "特殊机制", "+", "popup", "攻击范围"):
        return vals[-1] if vals else ""
    if name == "异常效果":
        # {{异常效果|冻结|免疫}} → 冻结免疫
        return "".join(vals)
    if name == "±":
        return vals[1] if len(vals) > 1 else (vals[0] if vals else "")
    if name == "修正":
        return vals[0] if vals else ""
    if name in ("材料消耗", "干员头像", "FULLPAGENAME"):
        return ""
    # 未知模板：取最后一个位置参数，通常就是展示文本
    return vals[-1] if vals else ""


def render_templates(s):
    out = []
    i = 0
    while i < len(s):
        j = s.find("{{", i)
        if j < 0:
            out.append(s[i:])
            break
        out.append(s[i:j])
        end = find_matching(s, j)
        if end < 0:
            out.append(s[j:])
            break
        out.append(render_inner(s[j + 2:end - 2]))
        i = end
    return "".join(out)


def strip_links(s):
    s = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", s)
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    return s


def clean(v):
    if v is None:
        return ""
    s = str(v)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = s.replace("<br/>", "\n").replace("<br />", "\n").replace("<br>", "\n")
    s = strip_links(s)
    s = render_templates(s)
    s = HTML_TAG_RE.sub("", s)
    s = s.replace("'''", "").replace("''", "")
    s = s.replace("&nbsp;", " ").replace("&mdash;", "—")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n[ \t]+", "\n", s)
    s = re.sub(r"\n{2,}", "\n", s)
    return s.strip()


def params(block):
    """block 是 {{...}} 内部的字符串。"""
    d = {}
    for p in split_top(block, "|")[1:]:
        eq = top_eq(p)
        if eq < 0:
            continue
        d[p[:eq].strip()] = p[eq + 1:].strip()
    return d


def blocks(wikitext, name):
    """找出所有 {{name ...}} 的块（内部字符串）。"""
    out = []
    pat = re.compile(r"\{\{" + re.escape(name) + r"(?=[\s|}])")
    for m in pat.finditer(wikitext):
        end = find_matching(wikitext, m.start())
        if end > 0:
            out.append(wikitext[m.start() + 2 + len(name):end - 2])
    return out


# ------------------------------------------------------------------ 解析
def to_int(v, default=None):
    try:
        return int(str(v).strip())
    except Exception:
        return default


def parse_page(title, wikitext):
    info = {}
    char_blocks = blocks(wikitext, "CharinfoV2")
    if char_blocks:
        p = params(char_blocks[0])
        rarity_raw = to_int(p.get("稀有度"))
        info.update({
            "name": clean(p.get("干员名")) or title,
            "charId": clean(p.get("干员id")),
            # PRTS 的稀有度是 0–5（5=6★），前端统一按星级展示
            "rarity": (rarity_raw + 1) if rarity_raw is not None else None,
            "class": clean(p.get("职业")),
            "branch": clean(p.get("分支")),
            "trait": clean(p.get("特性")),
            "position": clean(p.get("位置")),
            "tags": [x for x in clean(p.get("标签")).split() if x],
        })

    obtain_blocks = blocks(wikitext, "干员获得方式")
    if obtain_blocks:
        p = params(obtain_blocks[0])
        info["obtain"] = clean(p.get("获得方式"))
        info["onlineAt"] = clean(p.get("上线时间"))

    stat_blocks = blocks(wikitext, "属性")
    stats = []
    trust = {}
    if stat_blocks:
        p = params(stat_blocks[0])
        info["redeploy"] = clean(p.get("再部署"))
        info["deployCost"] = clean(p.get("部署费用"))
        info["block"] = clean(p.get("阻挡数"))
        info["attackInterval"] = clean(p.get("攻击速度"))
        for label, prefix in (
            ("精英0 · 1级", "精英0_1级"),
            ("精英0 · 满级", "精英0_满级"),
            ("精英1 · 满级", "精英1_满级"),
            ("精英2 · 满级", "精英2_满级"),
        ):
            hp = to_int(p.get(prefix + "_生命上限"))
            atk = to_int(p.get(prefix + "_攻击"))
            dfs = to_int(p.get(prefix + "_防御"))
            res = to_int(p.get(prefix + "_法术抗性"))
            if any(x is not None for x in (hp, atk, dfs, res)):
                level = 1 if prefix == "精英0_1级" else to_int(p.get(prefix))
                stats.append({
                    "phase": label,
                    "level": level,
                    "hp": hp, "atk": atk, "def": dfs, "res": res,
                })
        for label, key in (("生命上限", "信赖加成_生命上限"), ("攻击", "信赖加成_攻击"), ("防御", "信赖加成_防御")):
            n = to_int(p.get(key))
            if n:
                trust[label] = n
    info["stats"] = stats
    info["trust"] = trust

    ranges = {}
    range_blocks = blocks(wikitext, "干员攻击范围")
    if range_blocks:
        p = params(range_blocks[0])
        for key in ("精英0范围", "精英1范围", "精英2范围"):
            if p.get(key):
                ranges[key.replace("范围", "")] = clean(p[key])
    info["range"] = ranges

    talents = []
    for b in blocks(wikitext, "天赋列表3"):
        p = params(b)
        rows = []
        i = 1
        while ("天赋%d" % i) in p:
            rows.append({
                "cond": clean(p.get("天赋%d条件" % i)),
                "effect": clean(p.get("天赋%d效果" % i)),
            })
            i += 1
        if rows:
            talents.append({
                "slot": clean(p.get("天赋")),
                "name": clean(p.get("天赋1")),
                "rows": rows,
                "note": clean(p.get("备注")),
            })
    info["talents"] = talents

    skills = []
    for b in blocks(wikitext, "技能"):
        p = params(b)
        name = clean(p.get("技能名"))
        if not name:
            continue
        rows = []
        for suffix in ["1", "2", "3", "4", "5", "6", "7", "专精1", "专精2", "专精3"]:
            desc = clean(p.get("技能%s描述" % suffix))
            if desc:
                rows.append({
                    "level": suffix,
                    "desc": desc,
                    "init": clean(p.get("技能%s初始" % suffix)),
                    "cost": clean(p.get("技能%s消耗" % suffix)),
                    "dur": clean(p.get("技能%s持续" % suffix)),
                })
        skills.append({
            "name": name,
            "recovery": clean(p.get("技能类型1")),
            "trigger": clean(p.get("技能类型2")),
            "rows": rows,
            "note": clean(p.get("备注")),
        })
    info["skills"] = skills

    module = None
    mod_blocks = blocks(wikitext, "模组/卫戍协议")
    if mod_blocks:
        p = params(mod_blocks[0])
        mstats = []
        for i, suffix in ((1, ""), (2, "2"), (3, "3")):
            mstats.append({
                "level": i,
                "hp": to_int(p.get("生命" + suffix)),
                "atk": to_int(p.get("攻击" + suffix)),
                "def": to_int(p.get("防御" + suffix)),
            })
        module = {
            "name": clean(p.get("名称")),
            "type": clean(p.get("类型")),
            "trait": clean(p.get("特性")),
            "talent": clean(p.get("天赋2")),
            "talent3": clean(p.get("天赋3")),
            "unlock": clean(p.get("解锁等级")),
            "stats": mstats,
        }
    info["module"] = module

    return info


# ------------------------------------------------------------------ 抓取
def http_json(url, tries=3, timeout=30):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        except Exception as e:
            last = e
            time.sleep(1.0 * (attempt + 1))
    raise last


def fetch_page(title, refresh=False):
    page_id = None
    cache_path = None
    # 先用标题查 pageid，缓存文件名用 pageid，避免标题里的引号/括号做文件名
    query = {
        "action": "query", "format": "json", "formatversion": "2",
        "prop": "revisions", "rvprop": "ids|timestamp|content", "rvslots": "main",
        "titles": title,
    }
    data = http_json(API + "?" + urllib.parse.urlencode(query))
    pages = (data.get("query") or {}).get("pages") or []
    if not pages:
        raise RuntimeError("PRTS 查不到页面：%s" % title)
    page = pages[0]
    if page.get("missing"):
        raise RuntimeError("PRTS 页面不存在：%s" % title)
    page_id = page.get("pageid")
    rev = (page.get("revisions") or [{}])[0]
    wikitext = ((rev.get("slots") or {}).get("main") or {}).get("content")
    if not wikitext:
        raise RuntimeError("PRTS 页面没有 wikitext：%s" % title)
    record = {
        "title": page.get("title") or title,
        "pageid": page_id,
        "revid": rev.get("revid"),
        "timestamp": rev.get("timestamp"),
        "fetchedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "wikitext": wikitext,
    }
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(CACHE_DIR, "%s.json" % page_id)
    with open(cache_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(record, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return record


def load_cache(title):
    # 没有 pageid 索引时，按标题在缓存里找
    if not os.path.isdir(CACHE_DIR):
        raise RuntimeError("没有 source/prts/ 缓存，先联网跑一次")
    for name in sorted(os.listdir(CACHE_DIR)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(CACHE_DIR, name), encoding="utf-8") as f:
            rec = json.load(f)
        if rec.get("title") == title:
            return rec
    raise RuntimeError("缓存里没有「%s」，先联网跑一次" % title)


# ------------------------------------------------------------------ 主流程
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="只用 source/prts/ 缓存")
    ap.add_argument("--only", default="", help="只抓这些干员名，逗号分隔")
    args = ap.parse_args()

    with open(CONFIG, encoding="utf-8") as f:
        cfg = json.load(f)
    wanted = [x.strip() for x in args.only.split(",") if x.strip()]
    entries = cfg.get("operators") or []
    if wanted:
        entries = [e for e in entries if e["name"] in wanted]

    out_ops = {}
    for e in entries:
        title = e["prtsTitle"]
        print("抓取「%s」→ PRTS「%s」…" % (e["name"], title))
        rec = load_cache(title) if args.offline else fetch_page(title)
        info = parse_page(rec["title"], rec["wikitext"])
        if info.get("name") != e["name"]:
            print("  ! 页面干员名「%s」与配置名「%s」不一致，按配置名归档" % (info.get("name"), e["name"]))
        out_ops[e["name"]] = {
            "strategy": e["strategy"],
            "chessId": e.get("chessId", ""),
            "unpackNote": e.get("unpackNote", ""),
            "debut": e.get("debut") or info.get("onlineAt"),
            "debutSeason": e.get("debutSeason", ""),
            "aliases": e.get("aliases", []),
            "versionNote": e.get("versionNote", ""),
            "prts": dict(info, **{
                "title": rec["title"],
                "pageId": rec["pageid"],
                "revid": rec["revid"],
                "revAt": rec["timestamp"],
                "url": "https://prts.wiki/w/" + urllib.parse.quote(rec["title"].replace(" ", "_")),
            }),
        }
        print("  ok：%s / %s%s / %d 个技能" % (
            info.get("class"), info.get("branch"),
            (" %d★" % info["rarity"]) if info.get("rarity") else "",
            len(info.get("skills") or [])))

    payload = {
        "meta": {
            "season": cfg.get("season"),
            "gameDataVersion": cfg.get("gameDataVersion"),
            "source": "PRTS wiki",
            "license": "CC BY-NC-SA",
            "fetchedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "note": cfg.get("note", ""),
            "versions": cfg.get("versions", []),
        },
        "operators": out_ops,
        # 不由「特殊干员」档案覆盖、但确实由策略固定添加的单位（例如 Touch/外勤医疗）
        "strategyUnits": cfg.get("strategy_units", []),
    }
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
        f.write("\n")

    print("")
    print("已写出 %s（%d 名特殊干员）" % (os.path.relpath(OUT, ROOT), len(out_ops)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
