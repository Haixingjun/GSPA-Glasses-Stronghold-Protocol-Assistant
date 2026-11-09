# 卫戍协议小助手

> 《明日方舟》卫戍协议的数据查询工具 —— **手机一打开就能查，链接一发就能看**。
> 纯静态、零依赖、可离线；数据源自 Excel，改表 → 重跑脚本 → 1 分钟上线。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![素材](https://img.shields.io/badge/%E7%B4%A0%E6%9D%90-%E9%9D%9E%E5%95%86%E4%B8%9A%20%C2%B7%20%E9%9D%9E%E5%AE%98%E6%96%B9-orange.svg)
![无构建](https://img.shields.io/badge/%E5%89%8D%E7%AB%AF-%E6%97%A0%E6%9E%84%E5%BB%BA%E3%80%81%E9%9B%B6%E4%BE%9D%E8%B5%96-brightgreen.svg)

![桌面端](docs/screenshot-desktop.png)

<p align="center"><img src="docs/screenshot-mobile.png" width="320" alt="手机端"></p>

## 这是什么

把《明日方舟》卫戍协议（Garrison Protocol）的官方数据表，做成一款**响应式网页查询工具**：

- 电脑打游戏时用手机查，或双开在副屏；
- 筛选后的结果就是一条 URL，复制发给群友，对方点开即还原同样的筛选；
- 没有后端、没有数据库、没有登录，一个静态目录扔到任何托管处就能用。

**数据规模**：干员 155 · 道具 70 · 策略 61 · 盟约 26 · 头像 143 名（96/180px WebP）·
道具/策略/盟约图标 157 个（本期「规程」，WebP）。

## 功能

- **四个视图**：干员 / 道具 / 策略 / 盟约，外加「关于」页（数据版本、来源、免责声明）。
- **搜索**：空格分词、全部命中（AND）、80ms 防抖、命中高亮；`/` 聚焦、`Esc` 清空。
- **分面筛选**：阶数、盟约、触发时机、售价、类型、类别……每个 chip 显示「当前结果集里的数量」，点下去不会筛成 0 条。
- **图标**：道具 / 策略发起人 / 盟约徽记使用本期「规程」官方图标，透明底白线稿配深色底座，深浅主题都清楚。
- **盟约 AND / OR**：默认全部命中，可一键切「任一命中」。
- **详情**：桌面是右侧常驻栏，手机是底部抽屉；详情内可点盟约、成员、合成材料继续跳转。
- **状态全在 URL 里**：筛选、排序、详情都是 hash 参数，前进/后退、刷新、分享都成立，不需要服务端重写。
- **响应式**：< 640 单列 + 底部 Tab；640–1023 两列；≥ 1024 三栏（筛选 / 列表 / 详情）。
- **深色 / 浅色**主题、**头像 / 图标开关**（纯色块 + 首字回退）、键盘导航、系统分享面板。
- **离线可用**：`dist/standalone.html` 是单文件版（CSS/JS/数据全内联），微信里直接发文件、双击即开。

## 三种用法

| 场景 | 用什么 |
| --- | --- |
| 手机 / 群友 | 打开发布网址（见下方「部署」） |
| 自己电脑离线看 | 双击 `web/index.html`（或 `dist/index.html`） |
| 发单个文件给别人 | `dist/standalone.html`（约 308 KB，不含头像与图标） |

## 目录结构

```
卫戍协议小助手/
├── 卫戍协议数据表.xlsx          # ★ 唯一可编辑数据源（7 张表）
├── 开发说明.md                  # 工程约定、交互细则、字段字典（唯一开发文档）
├── deploy/README.md             # 部署手册（Cloudflare / 服务器 / B站 Toy）
├── tools/
│   ├── build_web_data.py         # Excel → JSON，含表头/行数/枚举校验
│   ├── build_dist.py             # web/ → dist/，含单文件版、zip、体积自检
│   ├── prepare_avatars.py        # PRTS → 干员头像（增量抓取 + 清单）
│   └── prepare_icons.py          # PRTS → 道具/策略/盟约图标（本期规程锚定）
├── data/
│   ├── avatars.json              # 头像清单：文件、来源、许可、抓取日期
│   └── icons.json                # 图标清单：赛季、文件、来源、许可
├── web/                          # 源码，可直接双击 index.html 预览
│   ├── index.html
│   ├── assets/app.css
│   ├── assets/{avatars,icons}/   # 头像 / 图标 WebP（生成物）
│   ├── js/{store,search,ui,app}.js
│   └── data/{data.js,data.json}  # 生成物，勿手改
├── deploy/                       # nginx.conf / _headers / robots.txt / Dockerfile
├── build/                        # 校验报告、数据 diff、头像/图标缓存（缓存不入库）
└── dist/                         # ★ 发布产物，GitHub Pages 直接发布它
```

## 数据更新流程

```bash
# 1. 改根目录的 卫戍协议数据表.xlsx（先备份成 source/卫戍协议数据表_YYYYMMDD.xlsx）
# 2. 有新增/改名的干员、道具、策略、盟约时才重新抓素材（增量，已缓存的不重下）
python tools/prepare_avatars.py
python tools/prepare_icons.py
# 3. Excel → JSON（校验不过会直接中止，不产出数据）
python tools/build_web_data.py
# 4. 生成发布产物 dist/（含单文件版与体积自检）
python tools/build_dist.py
```

依赖：`build_web_data.py` 需要 `openpyxl`，`prepare_avatars.py` / `prepare_icons.py`
需要 `openpyxl` + `Pillow`，`build_dist.py` **只用标准库**。

```bash
pip install openpyxl pillow
```

数据改动后提交前建议看一眼 `build/validation_report.md`、`build/diff_report.md`、`build/icon_report.md`。

## 本地预览

任选一种，**不要**用 `file://` 以外的绝对路径（资源全是相对路径，子目录部署才不会 404）：

```bash
python -m http.server 8080      # 然后开 http://localhost:8080
# 或者直接双击 web/index.html
```

## 部署

`dist/` 就是全部产物：丢到任何能发静态文件的地方即可。

### GitHub Pages（本仓库已配好）

推送到 `main` 后，`.github/workflows/pages.yml` 会把 `dist/` 发布到 Pages。
**首次需要在仓库 Settings → Pages → Source 选 `GitHub Actions`。**

访问地址：<https://haixingjun.github.io/ASA-Amiya-Stronghold-Assistant/>

> 国内访问 GitHub Pages 可能不稳，想要稳定地址可换 Cloudflare Pages。

### Cloudflare Pages（0 元、免备案、国内可用）

Workers & Pages → Create → Pages → 连接 Git 仓库 → 构建命令**留空**、输出目录填 `dist`。
或直接本地跑 `build_dist.py` 后把 `dist/` 拖上去（Upload assets）。

### 自己的服务器

```bash
python tools/build_dist.py
rsync -avz --delete dist/ root@<IP>:/var/www/garrison/
```

Nginx 配置见 [`deploy/nginx.conf`](deploy/nginx.conf)（根目录 / 子目录两种），完整步骤见 [`deploy/README.md`](deploy/README.md)。

### B站 Toy（第二渠道）

上传 `build/garrison-web.zip` 或 `dist/standalone.html`，具体限制以官方最新文档为准。

## 版权与免责

- 本项目是**非官方、非商业**的玩家工具，与鹰角网络无关。
- 《明日方舟》的干员美术、图标、名称、数值与技能文本归**鹰角网络**所有；头像与图标原文件取自 **PRTS Wiki**（其文本授权为 CC BY-NC-SA，**非商业**）。
  逐条溯源见 [`data/avatars.json`](data/avatars.json) 与 [`data/icons.json`](data/icons.json)。
- 图标只取本期「卫戍协议·规程」页面实际渲染的文件；PRTS 上 2024 / 2025-11「盟约」/ 2026-03「盟约 下半」的同名旧素材不使用。
- 因此**本项目整体不得用于商业用途**。若权利人提出异议，会立即移除相关内容。
- 详见 [NOTICE.md](NOTICE.md)。

## 许可证

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

代码（脚本、前端、构建与部署配置）以 **MIT** 发布。
MIT **不覆盖**上述第三方素材与数据 —— 它们仍归原作者，见 [NOTICE.md](NOTICE.md)。

---

其他文档：[开发说明.md](开发说明.md)（工程细节）· [deploy/README.md](deploy/README.md)（部署）· [卫戍协议小助手-方案.md](卫戍协议小助手-方案.md)（早期选型，已归档）
