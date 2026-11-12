# GSPA · 眼镜卫戍协议小助手

**GSPA** = **G**lasses **S**tronghold **P**rotocol **A**ssistant（眼镜卫戍协议小助手）

《明日方舟》卫戍协议数据速查网页工具。纯静态、无构建步骤、零运行时依赖，电脑与手机通用。

| 项目 | 内容 |
| --- | --- |
| 发布版本 | **1.0.0**（见 [`VERSION`](VERSION)） |
| 数据版本 | 2026-11-11（卫戍协议·规程） |
| 发布日期 | 2026-11-12 |
| 在线地址 | <https://haixingjun.github.io/GSPA-Glasses-Stronghold-Protocol-Assistant/> |
| 源代码 | <https://github.com/Haixingjun/GSPA-Glasses-Stronghold-Protocol-Assistant> |

本网页由 [@眼镜](https://space.bilibili.com/20597523) 提议，[@海星君](https://space.bilibili.com/341607034) 开发。
思路提供与测试：[@夕阳](https://space.bilibili.com/327907133) 等星海攻略组成员。

[星海攻略组卫戍协议直播间](https://live.bilibili.com/22354757)，每晚 18:30 开播。

## 功能

- **图鉴**：干员 209 条（143 名 + 66 名自选）、道具 70 件、策略 61 个、盟约 26 条。
- **搜索**：干员、道具、策略、盟约统一检索；特殊干员的别称、职业、技能名也进入索引。
- **筛选**：按阶数、盟约、触发时机、售价等组合筛选；盟约标签统一为「图标 + 名称」。
- **敌人图鉴**：189 条敌人（179 普通 + 10 领袖），支持名称 / ID 搜索与词条组合筛选；
  按「难度 + 回合」换算数值；战场地图可查场地、地形、装置与适用难度。
- **模拟配队（BETA）**：8 人配队，自动点亮盟约、统计一回合叠层上限；
  支持导出共享码与配队一图流（含扫码直达的二维码）。
- **沙盒叠层（BETA）**：选择规程战场，摆位、朝向与逐事件叠层；支持日志复制、
  诊断导出与 `GSPS1` 沙盒码分享。
- 深色 / 浅色主题、移动端适配、头像与图标显示开关；无账号、无后端。

## 快速开始

本目录即完整的可运行站点，不需要安装依赖或执行构建。

**方式一：直接打开**

双击 `index.html` 即可。`file://` 下深链会退化为 hash 路由，功能不受影响。

**方式二：本地静态服务器**（便于手机在同一局域网访问）

```bash
cd GSPA-1.0.0
python -m http.server 8080
# 打开 http://127.0.0.1:8080/
```

**方式三：单文件版**

`standalone.html` 把 CSS、JS 与数据全部内联（不含头像与图标，约 612 KB），
可离线双击打开，或直接发送给他人。

## 目录结构

```text
GSPA-1.0.0/
├── index.html            # 主入口：干员 / 道具 / 策略 / 盟约图鉴、搜索、配队
├── enemies.html          # 敌人图鉴与战场地图
├── sandbox.html          # 沙盒叠层
├── map-editor.html       # 战场地图查看 / 编辑（沙盒内入口）
├── standalone.html       # 单文件离线版
├── assets/
│   ├── app.css           # 主样式（含深色 / 浅色主题）
│   ├── enemies.css       # 敌人图鉴样式
│   ├── sandbox.css       # 沙盒样式
│   ├── map-*.css         # 地图组件样式
│   ├── avatars/          # 干员头像（96 / 180 px WebP）
│   ├── icons/            # 道具 / 策略 / 盟约图标
│   ├── enemies/          # 敌人头像（96 / 160 px WebP）
│   └── maps/             # 战场地图（10 图 × 3 场地）
├── js/                   # 前端模块（原生 JS，无打包）
├── data/                 # 构建期生成的数据（data.js / enemies.js / maps.js 等）
├── _headers              # Cloudflare Pages / Netlify 缓存与安全响应头
├── robots.txt            # 允许搜索引擎收录
├── .nojekyll             # 关闭 GitHub Pages 的 Jekyll 处理
├── VERSION               # 语义化版本号
├── CHANGELOG.md          # 版本变更记录
├── README.md             # 本文件
├── LICENSE               # 代码许可证（MIT）
└── NOTICE.md             # 第三方素材与版权声明
```

`js/` 中的脚本按 `index.html` 的 `<script>` 顺序加载；资源 URL 均带 `?v=<内容指纹>`，
便于长缓存与平滑更新。

## 部署

站点是纯静态的，把本目录整个上传到任意静态托管即可。

- **GitHub Pages**：将本目录作为发布产物上传（保证 `.nojekyll` 一并保留）。
- **Cloudflare Pages / Netlify**：直接指向本目录，`_headers` 会自动生效。
- **Nginx / 对象存储 / 子目录**：所有资源引用均为相对路径，可部署在
  `https://example.com/gspa/` 这类子目录下。

入口 HTML 建议 `no-cache`，`assets/`、`js/` 可长缓存；具体配置见 `_headers`。

## 版本与发布约定

- 目录名与版本号：`GSPA-<语义化版本>`，对应 git tag `v<版本>`（例如 `v1.0.0`）。
- `VERSION` 为纯文本版本号，`CHANGELOG.md` 按 Keep a Changelog 记录变更。
- 发布目录只保留运行所需文件与法务文档，不包含构建日志、测试脚本和开发文档。
- 如需压缩包分发，直接压缩本目录即可。

## 隐私

本站不收集个人信息，没有账号体系，也不接入第三方统计；仅在浏览器本地保存主题与
图片显示偏好（`localStorage`），清除浏览器数据即可移除。页面不发起任何外部网络请求，
游戏素材均为本地文件。

## 版权与免责

本项目是**非官方、非商业**的玩家自用查询工具，与鹰角网络（Hypergryph）无任何隶属或合作关系。

- 游戏名称、干员名、数值、技能与盟约文本，以及头像、图标、地图等美术素材，
  著作权均归**鹰角网络**所有；本项目仅作非商业的玩家查询与交流用途。
- 素材抓取自 [PRTS Wiki](https://prts.wiki)，其内容采用 **CC BY-NC-SA**，
  因此本项目整体**不得用于任何商业用途**。
- 数据由玩家整理，可能存在遗漏、笔误或版本滞后，不构成官方说明，一切以游戏内实际内容为准。
- 本项目按「现状」提供，不提供任何明示或默示的担保。
- 权利人如认为本目录中的内容构成侵权，请通过
  [GitHub Issue](https://github.com/Haixingjun/GSPA-Glasses-Stronghold-Protocol-Assistant/issues)
  联系，会立即删除相关内容。

完整清单见 [`NOTICE.md`](NOTICE.md)。

## 许可证

- **代码**：`js/` 下的 JavaScript、`assets/` 下的 CSS、入口 HTML，以
  [MIT License](LICENSE) 发布，Copyright (c) 2026 Haixingjun。
- **数据与素材**：游戏数据、文本、头像与图标的权利归鹰角网络所有，PRTS 相关内容遵循
  CC BY-NC-SA。**这些内容不在 MIT 许可范围内**，不得单独提取或用于商业用途。

转载、二次开发或分发时，请保留本 README 的版权与免责说明，以及 `LICENSE` 和 `NOTICE.md`。

## 反馈与致谢

- 发现数据错误、缺图或页面问题，欢迎提
  [Issue](https://github.com/Haixingjun/GSPA-Glasses-Stronghold-Protocol-Assistant/issues)，
  数据类问题请附上名称与游戏内截图。
- 感谢 [PRTS Wiki](https://prts.wiki) 提供的素材与资料，感谢星海攻略组和各位测试者的反馈。

---

祝使用愉快
Haixingjun
