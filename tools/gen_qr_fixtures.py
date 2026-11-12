# -*- coding: utf-8 -*-
"""
生成二维码黄金样本（仅开发机使用，不参与页面运行与构建）

    python -m pip install qrcode
    python tools/gen_qr_fixtures.py

用独立实现 python-qrcode 生成模块矩阵，存到 tools/fixtures/qr-cases.json，
给 `node tools/test_qr.mjs` 逐模块比对，证明自研编码器（web/js/qr.js）不是"看着像"。

为什么不用 segno：segno 会在终止符后多补一个 0x00 再开始 0xEC/0x11 填充
（扫描结果不受影响，但与标准填充序列不同，逐位比对会全部对不上）。
python-qrcode 的填充序列与 ISO 18004 一致。

掩码的选择由 python-qrcode 自带的 lost_point（标准四条罚分）逐掩码评分取最小，
与本项目 encode() 的自动选掩码互相独立——这样测试同时验证了「码字」和「选掩码」。

改了二维码相关逻辑或要新增样本时重跑本脚本；平时不用跑。
"""
import io
import json
import os
import sys

import qrcode
from qrcode.constants import ERROR_CORRECT_M
from qrcode.util import MODE_8BIT_BYTE, QRData, lost_point

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tools", "fixtures", "qr-cases.json")

BASE = "https://haixingjun.github.io/GSPA-Glasses-Stronghold-Protocol-Assistant/"

CASES = [
    {"id": "min-1byte", "text": "A"},
    {"id": "short-v1", "text": "GSPA3.AAAA"},
    {"id": "utf8-cn", "text": "配队码 GSPA3.测试"},
    {"id": "url-lite", "text": "https://example.com/#/team?c=GSPA3.JZh2D8ONAIIAFAA"},
    {"id": "real-8p", "text": BASE + "#/team?c=GSPA3.JZh2D8ONAIIAFAA"},
    {"id": "real-8p-gear", "text": BASE + "#/team?c=GSPA3.JZh2D8ONAIIAFAAx9Qz7KpLmN0sTuVwXyZ"},
    {"id": "real-9p", "text": BASE + "#/team?c=GSPA3.9JZh2D8ONAIIAFAAx9Qz7KpLmN0sTu"},
    {"id": "long-v7", "text": BASE + "#/team?c=GSPA3." + "A" * 30},
]


def build(text, mask):
    qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_M, box_size=1, border=0)
    qr.add_data(QRData(text.encode("utf-8"), mode=MODE_8BIT_BYTE))
    qr.makeImpl(False, mask)
    return qr


def main():
    out = []
    for case in CASES:
        scores = []
        mats = []
        for mask in range(8):
            qr = build(case["text"], mask)
            mats.append(qr.modules)
            scores.append(lost_point(qr.modules))
        best = min(range(8), key=lambda m: scores[m])
        rows = ["".join("1" if v else "0" for v in row) for row in mats[best]]
        out.append({
            "id": case["id"],
            "text": case["text"],
            "version": qr.version,
            "size": len(rows),
            "mask": best,
            "scores": scores,
            "modules": rows,
        })
        print("%-14s v%-2d %2dx%-2d mask=%d 罚分 %s" % (
            case["id"], qr.version, len(rows), len(rows), best, scores))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"generator": "python-qrcode", "cases": out}, f, ensure_ascii=False, indent=0)
        f.write("\n")
    print("已写入 %s（%d 例）" % (os.path.relpath(OUT, ROOT), len(out)))


if __name__ == "__main__":
    main()
