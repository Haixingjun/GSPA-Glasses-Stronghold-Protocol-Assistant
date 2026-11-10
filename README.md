# GSPA · 眼镜卫戍协议小助手

**GSPA** : **G**lasses **S**tronghold **P**rotocol **A**ssistant（眼镜卫戍协议小助手）。

本网页由 [@眼镜](https://space.bilibili.com/20597523) 提议，[@海星君](https://space.bilibili.com/341607034) 开发。
思路提供、测试：[@夕阳](https://space.bilibili.com/327907133) 等星海攻略组成员

关注眼镜谢谢喵　关注海星谢谢喵　关注星海攻略组谢谢喵

在线访问地址：<https://haixingjun.github.io/GSPA-Glasses-Stronghold-Protocol-Assistant/>

《明日方舟》卫戍协议的数据速查工具：纯静态网页，手机与电脑通用，打开即用、无需登录、不发起任何外部请求。

## 功能介绍

- **图鉴**：快速查找干员、盟约、装备/道具、策略；盟约列表按主盟约 / 副盟约分区显示
- **敌人图鉴（独立页）**：179 个特殊敌人 / 随从 + 10 名领袖，支持名称与敌人 ID 搜索、9 类词条组合（AND/OR）、身份筛选（含「首领」）、双等级 / 跨词条筛选；详情含各等级生命/攻击/防御/法抗、出现身份与特殊敌人包反查；选择难度 + 回合后，普通敌人按官方回合倍率、领袖按 PRTS 领袖表自动换算实际生命/攻击，不再只给基础值；另附 10 张战场地图的场地、地形、装置与适用难度速查，可按难度模式 / 规程等级筛选；地图与敌方势力随机搭配，不声称固定出怪
- **自选干员**：并入「干员」查询，卡片带与阶数并列的「自选」标签；搜「自选 炎」即可命中斩业星熊等自选干员，也可用阶数筛选里的「自选」。不写入盟约固定 10 人，但在配队里正常激活盟约
- **特殊干员**：森蚺的「暴躁铁皮」、Pith 的【优等生】等由策略召唤的特殊干员，可直接搜名字/别称，也可从策略详情一键跳转；档案补充自 PRTS，并区分 2024 β / 2025「盟约」/ 2026「规程」等版本
- **搜索**：快速搜索想查找的干员、道具、策略、盟约（特殊干员的别称、职业、技能名也进索引）
- **筛选**：按阶数、盟约、触发时机、售价等组合筛选；干员 / 盟约卡片与筛选 chip 上的盟约标签统一为「盟约图标 + 名称」，主盟约后换行显示副盟约；自选干员使用与 I–VI 并列的「自选」阶数标签
- **图鉴直连配队**：干员卡片和详情里可直接「加入配队 / 移出配队」，无需先切到配队页
- **模拟配队（BETA）**：默认 8 个场上席位，可用「人事部文档」开第 9 席；每位干员最多带 2 件装备（含「变形同构体」转职）；**自选干员直接占席，最多 2 名**，在阶数筛选里与 I–VI 并列；鼠标悬停席位头像可看干员详情；实时判定 26 个盟约的激活 / 强化 / 缺几人 / 层数节点，支持层数换算具体数值、连续添加干员与装备、拖拽调整站位；右侧「词条」浮层按触发时机汇总全队词条，可用「只看叠层」隐藏非叠层词条（收起后缩成贴右侧的竖排工具栏，可上下拖动或拖到左半边吸附左侧，点击可再展开）；以及**分享码**（GSPA3，一段文本即可把整队发给别人，粘贴自动识别；旧 GSPA2 仍可导入）
- **模拟叠层**：开发中

## 界面预览

<p align="center">
  <img src="docs/screenshot-desktop.png" alt="桌面端截图" width="68%">
  <img src="docs/screenshot-mobile.png" alt="手机端截图" width="26%">
</p>
<p align="center">
  <img src="docs/screenshot-enemies.png" alt="敌人图鉴截图" width="68%">
</p>

## 快速开始

### 在线使用

直接打开 <https://haixingjun.github.io/GSPA-Glasses-Stronghold-Protocol-Assistant/>。支持手机与电脑，可切换深色 / 浅色主题。

### 本地运行

项目没有构建步骤，`web/` 就是可直接运行的源码：

```bash
git clone https://github.com/Haixingjun/GSPA-Glasses-Stronghold-Protocol-Assistant.git
cd GSPA-Glasses-Stronghold-Protocol-Assistant
```

- 直接双击 `web/index.html` 即可打开（`file://` 下深链会退化为 hash，功能不受影响）；
- 或在 `web/` 下起一个静态服务器，方便手机在同一局域网访问：

```bash
cd web
python -m http.server 8080
# 打开 http://127.0.0.1:8080/
```

## 数据说明

- 数据取自官方 Android 热更新解包（本期 V3_1），并经过构建期校验：表头守卫、行数断言、枚举校验、引用完整性检查。
- 共收录 143 条固定干员条目（默认展示 141 条，2 条特殊干员默认隐藏）+ 66 名自选干员；干员查询合计 209 条（默认 207 条）。70 件道具、61 个策略、26 个盟约。
- 共收录 189 个敌人图鉴条目：179 个特殊敌人 / 随从 + 10 名领袖；另有 10 张战场地图。领袖生命值来自 PRTS 领袖表（4 模式 + 规程等级 1–20，含隐秘核心），普通敌人的难度/回合倍率来自官方 PRTS 敌方属性表（规程等级 1–4 / 5–8 / 9–14 / 15–20 归入标准 / 险境 / 绝境 / 终极模式）。
- 自选干员的 `核心盟约` 由 PRTS 的 `ingameFaction ∪ hiddenFaction` 推导（`炎-龙门` → 炎；无匹配 → 协防干员），`自选干员` 工作表是唯一可编辑源；配队里按标签计入激活 / 强化，但不进入盟约 `members`。
- 特殊干员（`盟约·辅助干员`、`“暴躁铁皮”`）的职业、属性、天赋、技能补充自 PRTS 干员页；`data/special_operators.json` 记录 PRTS pageid / revid / 修订时间与所属版本，`source/prts/` 保存原始 wikitext 快照。
- 另审计到 `Touch/外勤医疗` 固定添加的 `预备干员-医疗` / `Touch`：它们是 2024「卫戍协议β」专属干员，不在 143 条主表，也不写「特殊干员」，因此在策略详情单列说明与 PRTS 外链，不混入特殊干员档案。
- 干员头像与道具 / 策略 / 盟约图标来自 [PRTS Wiki](https://prts.wiki)，锚定本期「卫戍协议·规程」页面，美术版权归鹰角网络所有。
- 页脚会显示数据版本与生成时间，可据此确认看到的是不是最新一版。
- 游戏更新后数据可能滞后，具体数值请以游戏内为准。

## 数据更新

数据源是根目录的 `卫戍协议数据表.xlsx`（改前先备份为 `source/卫戍协议数据表_YYYYMMDD.xlsx`）。有新干员、道具、策略或盟约时，先增量抓取素材，再重新生成前端数据与发布产物：

```bash
python tools/prepare_avatars.py  # 头像：PRTS → WebP + data/avatars.json（含 66 名自选干员；有新增/改名时才跑）
python tools/prepare_icons.py    # 图标：PRTS → WebP + data/icons.json（有新增/改名时才跑）
python tools/fetch_special_operators.py  # 特殊干员：PRTS → data/special_operators.json + source/prts/ 快照
python tools/fetch_boss_data.py  # 领袖：PRTS 领袖表 + 敌人页基础属性/头像 → data/bosses.json
python tools/build_enemy_data.py  # 敌人图鉴：特殊敌人 xlsx + 图鉴 HTML 头像 + 领袖 → web/data/enemies.js + WebP
python tools/fetch_map_images.py  # 战场地图：PRTS → web/assets/maps/*.webp（首次/换图时才跑）
python tools/build_web_data.py   # Excel（8 张表）+ 特殊干员档案 → web/data/data.js + data.json（含校验与变更报告）
python tools/build_dist.py       # 生成 dist/、单文件版和发布包
```

依赖 Python 3 与 `openpyxl`；抓取头像 / 图标还需要 `Pillow`。`build_web_data.py` 校验不通过会直接中止、不产出数据；提交前建议先看 `build/validation_report.md` 与 `build/diff_report.md`。完整流程与工程约定见 [开发说明.md](开发说明.md)。

## 项目结构

```text
GSPA-Glasses-Stronghold-Protocol-Assistant/
├── 卫戍协议数据表.xlsx   # 唯一可编辑的数据源
├── web/                  # 前端源码，可直接双击 index.html 预览
├── tools/                # 数据构建与素材抓取脚本
├── data/                 # 头像、图标清单、盟约分类、特殊干员/领袖档案、难度回合倍率
├── source/               # 解包原始数据、PRTS wikitext 快照（溯源用）
├── dist/                 # 发布产物（由脚本生成，勿手改）
├── deploy/               # Nginx / Docker / 各托管平台的部署配置
└── docs/                 # 截图
```

## 部署

站点是纯静态的，构建后把 `dist/` 整个目录上传到任意能托管静态文件的地方即可（GitHub Pages、Cloudflare Pages、Nginx、对象存储等）。
推送到 `main` 后，GitHub Actions 会自动把 `dist/` 发布到 GitHub Pages（首次使用需在仓库 Settings → Pages → Source 选择 `GitHub Actions`）；详细步骤与各平台注意事项见 [deploy/README.md](deploy/README.md)。

另外，`dist/standalone.html` 是单文件版（约 525 KB，CSS、JS、数据全部内联），不含头像与图标，可离线双击打开或直接发给别人。

## 版权与免责

本项目是**非官方、非商业**的玩家自用查询工具，与鹰角网络（Hypergryph）无任何隶属或合作关系。

- **游戏内容**：游戏名称、干员名、数值、技能与盟约文本，以及头像、道具 / 策略 / 盟约图标等美术素材，著作权均归**鹰角网络**所有。本项目仅作非商业的玩家查询与交流用途，不主张任何版权。
- **素材来源**：头像与图标抓取自 [PRTS Wiki](https://prts.wiki)，特殊干员的职业/属性/天赋/技能文本同样补充自 PRTS 干员页，仅下载后本地使用，不热链。PRTS 的内容采用 **CC BY-NC-SA**（署名—非商业性使用—相同方式共享），**因此本项目整体不得用于任何商业用途**。
- **数据来源**：`source/` 中的完整数据表来自官方热更包解包，仅用于核对与溯源；可编辑的唯一主表是根目录的 `卫戍协议数据表.xlsx`。
- **仅供参考**：本站数据由玩家整理，可能存在遗漏、笔误或版本滞后，不构成任何官方说明，一切以游戏内实际内容为准。因使用本站产生的任何后果由使用者自行承担。
- **无担保**：本项目按「现状」提供，不提供任何明示或默示的担保，包括但不限于准确性、完整性与特定用途适用性。
- **隐私**：本站不收集个人信息，没有账号体系，也不接入第三方统计；仅在浏览器本地保存主题与图片显示偏好（`localStorage`），清除浏览器数据即可移除。
- **权利人诉求**：如果权利人认为本仓库中的任何内容构成侵权，请通过 [GitHub Issue](https://github.com/Haixingjun/GSPA-Glasses-Stronghold-Protocol-Assistant/issues) 联系，会**立即删除**相关内容或整个仓库，无需任何前置条件。

完整的第三方素材清单与逐项授权说明见 [NOTICE.md](NOTICE.md)。

## 许可证

- **代码**：`tools/`、`web/` 下的 HTML / CSS / JS、`deploy/`、`.github/` 等本项目代码，以 [MIT License](LICENSE) 发布，Copyright (c) 2026 Haixingjun。
- **数据与素材**：游戏数据、文本、头像与图标的权利归鹰角网络所有，PRTS 相关内容遵循 CC BY-NC-SA。**这些内容不在 MIT 许可范围内**，不得单独提取或用于商业用途。
- 转载、二次开发或分发时，请保留本 README 中的版权与免责说明，以及 [LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md)。

## 反馈与致谢

- 发现数据错误、缺图或页面问题，欢迎提 [Issue](https://github.com/Haixingjun/GSPA-Glasses-Stronghold-Protocol-Assistant/issues)。数据类问题请附上干员 / 道具名称与游戏内截图，方便核对。
- 感谢 [PRTS Wiki](https://prts.wiki) 提供的素材与资料，感谢星海攻略组和各位测试者的反馈。

---

祝使用愉快
Haixingjun




