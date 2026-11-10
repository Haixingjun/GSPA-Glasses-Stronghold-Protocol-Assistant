# 第三方素材与版权声明（NOTICE）

本项目是**非官方、非商业**的玩家自用查询工具，与鹰角网络（Hypergryph）无任何隶属或合作关系。

## 1. 权利归属

| 内容 | 位置 | 权利方 / 授权 |
| --- | --- | --- |
| 游戏名称、干员名、数值、技能与盟约文本 | `卫戍协议数据表.xlsx`、`source/`、`web/data/` | 归**鹰角网络**所有。本项目仅作非商业的玩家查询用途，不主张任何版权。 |
| 干员头像（286 个 WebP） | `web/assets/avatars/`、`dist/assets/avatars/` | 游戏美术版权归**鹰角网络**所有；原始文件取自 **PRTS Wiki**。 |
| 敌人头像（189 个，96 / 160 两档） | `web/assets/enemies/`、`dist/assets/enemies/` | 游戏美术版权归**鹰角网络**所有；179 个原始 160×160 WebP 内嵌在 `卫戍协议-规程-特殊敌人图鉴.html`，10 名领袖头像取自 **PRTS Wiki** 敌人页；图源均为 PRTS / 本地解包。 |
| 战场地图（10 图 × 3 场地） | `web/assets/maps/`、`dist/assets/maps/` | 游戏美术版权归**鹰角网络**所有；取自 **PRTS Wiki**「卫戍协议·规程/战场一览」。 |
| 道具 / 策略 / 盟约图标（314 个 WebP） | `web/assets/icons/`、`dist/assets/icons/` | 游戏美术版权归**鹰角网络**所有；原始文件取自 **PRTS Wiki** 的本期「卫戍协议·规程」页面。 |
| 特殊干员档案（职业/属性/天赋/技能文本） | `data/special_operators.json`、`web/data/` | 游戏内容版权归**鹰角网络**所有；字段补充自 **PRTS Wiki** 干员页，原始 wikitext 快照在 `source/prts/`。 |
| PRTS Wiki 的文本内容 | 数据整理过程参考 | PRTS 采用 **CC BY-NC-SA**（署名—非商业性使用—相同方式共享）。**因此本项目整体不得用于商业用途。** |
| 本项目代码 | `tools/`、`web/` 下的 HTML/CSS/JS、`deploy/`、`.github/` | 归本项目作者所有，以 **MIT** 许可发布（见 [LICENSE](LICENSE)）。 |

## 2. 头像与图标溯源

每个头像的来源、许可标记与抓取日期都逐条记录在 [`data/avatars.json`](data/avatars.json) 中，形如：

```json
{
  "折桠": {
    "list": "assets/avatars/av-b3174a27-96.webp",
    "full": "assets/avatars/av-b3174a27-180.webp",
    "source": "prts",
    "license": "official-art",
    "sourcePage": "https://prts.wiki/w/文件:头像_折桠.png",
    "fetchedAt": "2026-11-09"
  }
}
```

重新抓取方式是 `python tools/prepare_avatars.py`（增量，已缓存的不重下）。

图标清单在 [`data/icons.json`](data/icons.json)，格式与头像类似，并记录了赛季锚点：

```json
{
  "season": "卫戍协议·规程",
  "page": "卫戍协议·规程/PRTS盟约记录",
  "items": {
    "维式重锤": {
      "list": "assets/icons/it-33981944-64.webp",
      "full": "assets/icons/it-33981944-128.webp",
      "file": "卫戍协议_道具_维式重锤.png",
      "sourcePage": "https://prts.wiki/w/文件:卫戍协议_道具_维式重锤.png"
    }
  }
}
```

重新抓取方式是 `python tools/prepare_icons.py`。脚本会先读取本期「规程」页面实际渲染的
图标文件名并逐一比对，只接受页面真正引用的文件，避免混入其它期的同名旧图。

特殊干员的 PRTS 文本在 [`data/special_operators.json`](data/special_operators.json)，记录了每页的
`pageid` / `revid` / 修订时间与所属版本；原始 wikitext 保存在 `source/prts/<pageid>.json`。
重新抓取方式是 `python tools/fetch_special_operators.py`（`--offline` 可只用已有快照重解析）。

领袖数据在 [`data/bosses.json`](data/bosses.json)：生命值来自 PRTS「卫戍协议·规程/PRTS盟约记录」敌方资料·领袖表，
攻击/防御/法抗来自 PRTS 敌人页级别 0；表格快照在 `source/prts/guicheng_leader_table.txt`，头像原图在
`source/prts/boss_portraits/`。重新抓取方式是 `python tools/fetch_boss_data.py`。

## 3. 数据来源

`source/` 中的 `卫戍协议_完整数据表.xlsx` 来自官方热更包解包，仅用于核对与溯源；
可编辑的唯一主表是根目录的 `卫戍协议数据表.xlsx`。`source/prts/` 是 PRTS 特殊干员页的 wikitext 快照、
领袖表快照与领袖头像原图，仅用于生成 `data/special_operators.json` / `data/bosses.json`，不参与页面热链。

## 4. 权利人诉求

如果权利人认为本仓库中的任何内容构成侵权，请通过 GitHub Issue 联系，
会**立即删除**相关内容或整个仓库，无需任何前置条件。
