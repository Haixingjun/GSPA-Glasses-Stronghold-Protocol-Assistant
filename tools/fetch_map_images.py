# -*- coding: utf-8 -*-
"""下载《卫戍协议·规程》战场地图（PRTS）并转成 WebP。

来源：https://prts.wiki/w/卫戍协议·规程/战场一览
  · 10 张地图（#01–#06、#09–#12；#07/#08 未开放），每张 3 个场地
  · 文件命名：卫戍协议规程 战场NN 场地M 地图.png
  · 使用 MediaWiki 的 md5 路径规则构造 600px 缩略图 URL
运行：
    python tools/fetch_map_images.py
"""
from __future__ import annotations

import hashlib
import io
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "assets" / "maps"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
MAPS = ["01", "02", "03", "04", "05", "06", "09", "10", "11", "12"]


def thumb_url(nn: str, field: str) -> str:
    name = f"卫戍协议规程 战场{nn} 场地{field} 地图.png"
    path = name.replace(" ", "_")
    digest = hashlib.md5(path.encode("utf-8")).hexdigest()
    quoted = urllib.parse.quote(path)
    return f"https://media.prts.wiki/thumb/{digest[0]}/{digest[:2]}/{quoted}/600px-{quoted}"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for nn in MAPS:
        for field in ("1", "2", "3"):
            dest = OUT / f"map{nn}-{field}.webp"
            if dest.exists():
                continue
            url = thumb_url(nn, field)
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
            im = Image.open(io.BytesIO(raw)).convert("RGB")
            im = im.resize((600, round(im.height * 600 / im.width)), Image.LANCZOS)
            im.save(dest, "WEBP", quality=82, method=6)
            total += 1
            print(f"{dest.name} {im.size} {dest.stat().st_size // 1024} KB")
            time.sleep(0.2)
    print(f"done, new={total}, total={len(list(OUT.glob('*.webp')))}")


if __name__ == "__main__":
    main()
