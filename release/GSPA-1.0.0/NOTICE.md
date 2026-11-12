# 第三方素材与版权声明（NOTICE）

本项目是**非官方、非商业**的玩家自用查询工具，与鹰角网络（Hypergryph）无任何隶属或合作关系。

本发布目录（`GSPA-1.0.0`）是可直接运行的静态站点副本；完整的源码、数据整理过程与素材溯源记录见
[源代码仓库](https://github.com/Haixingjun/GSPA-Glasses-Stronghold-Protocol-Assistant)。

## 1. 权利归属

| 内容 | 本目录位置 | 权利方 / 授权 |
| --- | --- | --- |
| 游戏名称、干员名、数值、技能与盟约文本 | `data/`、`standalone.html` | 归**鹰角网络**所有。本项目仅作非商业的玩家查询用途，不主张任何版权。 |
| 干员头像（418 个 WebP，209 名 × 96 / 180 两档） | `assets/avatars/` | 游戏美术版权归**鹰角网络**所有；原始文件取自 **PRTS Wiki**。 |
| 敌人头像（378 个 WebP，189 条 × 96 / 160 两档） | `assets/enemies/` | 游戏美术版权归**鹰角网络**所有；179 条原始 160×160 WebP 内嵌在官方「特殊敌人图鉴」HTML 中，10 名领袖头像取自 **PRTS Wiki** 敌人页。 |
| 战场地图（10 图 × 3 场地，30 个 WebP） | `assets/maps/` | 游戏美术版权归**鹰角网络**所有；取自 **PRTS Wiki**「卫戍协议·规程/战场一览」。 |
| 道具 / 策略 / 盟约图标（314 个 WebP） | `assets/icons/` | 游戏美术版权归**鹰角网络**所有；原始文件取自 **PRTS Wiki** 本期「卫戍协议·规程」页面。 |
| PRTS Wiki 的文本内容 | 数据整理过程参考 | PRTS 采用 **CC BY-NC-SA**（署名—非商业性使用—相同方式共享）。**因此本项目整体不得用于任何商业用途。** |
| 本项目代码（HTML / CSS / JavaScript） | `index.html`、`enemies.html`、`sandbox.html`、`map-editor.html`、`standalone.html`、`js/`、`assets/*.css` | 归本项目作者所有，以 **MIT** 许可发布（见 [LICENSE](LICENSE)）。 |

## 2. 素材来源与溯源

- 头像、图标、地图与领袖头像均**下载后本地使用**，页面不热链 PRTS 或其他站点。
- 每个头像与图标的来源页、许可标记与抓取日期，逐条记录在源代码仓库的
  `data/avatars.json`、`data/icons.json`、`data/bosses.json` 中。
- 图标只认本期「卫戍协议·规程」页面实际渲染的文件，不混用 2024 / 2025-11「盟约」/
  2026-03「盟约 下半」的同名旧图。
- 特殊干员的职业、属性、天赋与技能文本补充自 PRTS 干员页；原始 wikitext 快照保存在
  源代码仓库的 `source/prts/`。

## 3. 数据来源

- 数据取自官方 Android 热更新 **26-11-06-12-56-09-07186384**（本期 V3_1），经构建期校验后生成
  `data/` 下的只读 JSON / JS。
- 数据版本以页脚显示为准（本版本为 2026-11-11）。
- 数据由玩家整理，可能存在遗漏、笔误或版本滞后，不构成任何官方说明。

## 4. 权利人诉求

如果权利人认为本目录中的任何内容构成侵权，请通过
[GitHub Issue](https://github.com/Haixingjun/GSPA-Glasses-Stronghold-Protocol-Assistant/issues)
联系，会**立即删除**相关内容或整个发布目录，无需任何前置条件。
