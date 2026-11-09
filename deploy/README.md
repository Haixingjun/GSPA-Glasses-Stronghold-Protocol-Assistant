# GSPA · 部署说明

站点是**纯静态**的：一个 `index.html` + 几个 CSS/JS + 一份数据，没有后端、没有数据库、没有构建工具依赖。
所以「部署」= 把 `dist/` 里的文件放到任意能发静态文件的地方。

```
python tools/build_dist.py
```

产物：

| 路径 | 用途 |
| --- | --- |
| `dist/` | 目录版，服务器 / Cloudflare Pages / B站 Toy 静态包都用它 |
| `dist/standalone.html` | 单文件版，CSS+JS+数据全内联，双击即开、单文件发送（不含头像与图标） |
| `dist/assets/avatars/` | 143 名干员头像（96px / 180px WebP，共约 2.7 MB，懒加载） |
| `dist/assets/icons/` | 157 个道具/策略/盟约图标（两档 WebP，共约 2.0 MB，懒加载） |
| `build/gspa-web.zip` | 目录版的 zip，B站 Toy 上传用 |
| `dist/BUILD_INFO.txt` | 本次构建的版本、指纹、体积报告 |

三条硬约束（代码已保证，改代码时别破坏）：

1. **所有资源都是相对路径**（`assets/…`、`js/…`、`data/…`），所以能放在任意子目录。
2. **路由只用 `location.hash`**（`#/op/幽灵鲨`），不需要服务端重写规则，`file://` 也能用。
3. **零外部请求**：不引 CDN、不引外链字体、不热链图片；头像与图标都是本地 WebP，随 `dist/` 一起上传。

---

## 一、本地验证（不花钱，先做这个）

```bash
# 方式 1：双击打开（验证 file:// 可用性）
start web/index.html

# 方式 2：局域网给手机看
cd web && python -m http.server 8080
# 手机访问 http://<电脑局域网 IP>:8080/
```

`file://` 下 `localStorage` 和 `history.replaceState` 可能被浏览器限制，代码里已经做了降级（深链会退化成 `location.hash`），功能不受影响。

---

## 二、Cloudflare Pages（0 元、免备案，首发推荐）

**最简单的做法（不用接 Git）：**

1. 本机运行 `python tools/build_dist.py`。
2. 打开 Cloudflare Dashboard → Workers & Pages → Create → Pages → **Upload assets**。
3. 把 `dist/` **里面的内容**（不是 dist 目录本身）拖进去，Deploy。
4. 得到 `https://<项目名>.pages.dev`。

**接 Git 自动部署：**

- 构建命令留空，输出目录填 `dist`。
- 但 Cloudflare 的构建镜像不一定有 Python，所以更稳的是：本地跑完 `build_dist.py` 后把 `dist/` 一起提交，构建命令留空、输出目录 `dist`。
- `deploy/_headers` 会被 `build_dist.py` 复制进 `dist/`，Pages 会自动读取它来设置缓存与安全头。

免费额度对这个项目是压倒性富余：静态请求与带宽不限，单文件 25 MiB 上限，而我们的单文件版约 0.29 MB。

---

## 三、国内轻量服务器 / 自有 VPS（Nginx）

```bash
# 服务器（Ubuntu 22.04 / Debian 12）
apt update && apt install -y nginx
mkdir -p /var/www/gspa

# 本机（Windows PowerShell / Git Bash 均可）
python tools/build_dist.py
scp -r dist/* root@<服务器IP>:/var/www/gspa/

# 服务器：套用配置
#   把 deploy/nginx.conf 复制到 /etc/nginx/conf.d/gspa.conf
#   把 server_name 与 root 改成自己的
nginx -t && systemctl reload nginx
```

HTTPS（域名解析到服务器后）：

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

**日常更新（一条命令）：**

```bash
# 有新干员 / 道具 / 策略 / 盟约时才需要先抓素材（需要 Pillow；系统 Python 没装就用工作区自带的）
python tools/prepare_avatars.py
python tools/prepare_icons.py
python tools/build_dist.py && scp -r dist/* root@<IP>:/var/www/gspa/
```

或者用 `rsync`（更干净，会删掉旧文件）：

```bash
rsync -avz --delete dist/ root@<IP>:/var/www/gspa/
```

> 备案：服务器在境内 + 绑域名就必须 ICP 备案（1–2 周）。备案期间可以先用 `http://IP:8080/` 给朋友试，80 端口未备案会被拦。

**子目录部署**（`https://example.com/gspa/`）：直接用 `deploy/nginx.conf` 末尾的 `location /gspa/` 版本，**不需要改一行前端代码**，因为资源全是相对路径。

---

## 四、B站 Toy（站内网页平台）

Toy 的定位是「绑在视频/动态上的互动小玩具」，不是独立站点。它要的是**一个自包含的静态包**，审核通过后绑定视频才有流量。

我们这边已经按最保守的口径准备了两份产物，上传时按平台当下的要求二选一：

| 平台要求 | 用哪个 |
| --- | --- |
| 上传 zip / 目录，入口是根目录 `index.html` | `build/gspa-web.zip` |
| 只接受单个 HTML 文件 | `dist/standalone.html` |

上传前自查（这些是我们能保证的）：

- [x] 入口文件在包根目录，文件名 `index.html`
- [x] 所有资源相对路径，没有 `http(s)://` 外链
- [x] 没有 CDN、外链字体、外部接口、`fetch`/`XHR`
- [x] 不依赖后端、不依赖登录态（`localStorage` 失败也能用）
- [x] hash 路由，不需要服务端重写；iframe 内嵌不会被 `pushState` 卡住
- [x] 移动端优先：单列布局、底部 Tab、安全区适配、`viewport-fit=cover`
- [x] 触控目标 ≥ 27px，支持 320px 宽度不横向滚动
- [x] 包体：目录版约 4.9 MB（含 143 名干员头像 2.7 MB + 157 个图标 2.0 MB）；单文件版约 0.31 MB

上传后建议在**B站 App 内**真机过一遍：微信/B站 WebView 的内核版本较杂，重点看首屏、搜索输入、详情抽屉和返回。

> 具体包体上限、审核细则、是否需要绑定视频、是否允许外链，以 Toy 官方最新文档和开发者 FAQ 为准；本文件不代官方承诺。相关链接：
> - Toy 开发者 FAQ：<https://www.bilibili.com/opus/1241171666570051585>
> - 官方示例仓库（含内容自检清单）：<https://github.com/bilibili/toy>

**头像与图标版权**：干员头像、道具/策略/盟约图标来自 PRTS wiki 的本期「规程」页面，美术版权归鹰角网络所有。
若审核敏感或收到权利人异议，删掉 `dist/assets/avatars/`、`dist/assets/icons/` 即可
（页面自动回退成色块首字，不会报错）；也可以把 `web/js/app.js` 里 `initAvatarPref()` 的默认值改成关闭，
让公开版默认不显示头像与图标。

### 如果 Toy 的沙箱限制比预期严格

1. 把 `dist/standalone.html` 当兜底：单文件、零请求，最不容易踩沙箱。
2. 若平台禁止 `localStorage`：只是主题记忆失效，不影响功能（代码已 try/catch）。
3. 若平台在 iframe 里注入了顶部导航：页面顶部已留安全区（`env(safe-area-inset-top)`），底部 Tab 也不会与页面内容重叠。

---

## 五、其它托管

| 平台 | 做法 | 备注 |
| --- | --- | --- |
| GitHub Pages | 把 `dist/` 推到 `gh-pages` 分支 | 已生成 `.nojekyll`；国内访问不稳定 |
| Vercel / Netlify | 输出目录 `dist` | `_headers` 由 Netlify 识别 |
| 对象存储 + CDN（OSS/COS） | 上传 `dist/`，开启静态网站托管 | 绑自定义域名需备案 |
| Docker | `docker build -f deploy/Dockerfile -t gspa .` | 内置 Nginx，`-p 8080:80` |

---

## 六、缓存与发版

- `build_dist.py` 给 `assets/app.css`、`js/*.js`、`data/data.js` 自动加 `?v=<内容指纹>`。
  内容一变，URL 就变，**用户不会看到新旧混搭的页面**。
- `index.html` / `standalone.html` 必须 **不缓存**（`deploy/nginx.conf` 与 `_headers` 已配好）。
- 如果用户说「还是旧数据」：先看页脚的数据版本，再让他强制刷新一次（`Ctrl+F5`）。

---

## 七、常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 白屏，控制台 404 `data/data.js` | 只传了 `index.html`，没传 `data/` | 整个 `dist/` 一起传 |
| 页面能开但样式丢失 | 子目录部署 + 用了绝对路径（改坏了） | 资源引用必须是 `assets/…` 而不是 `/assets/…` |
| 刷新后 404 | 用了 history 路由（不是本项目） | 本项目只用 hash，正常不会出现 |
| 中文乱码 | 服务器没发 `charset=utf-8` | Nginx 加 `charset utf-8;`（配置里已有） |
| 手机上底部 Tab 挡住内容 | 自定义 CSS 覆盖了 `padding-bottom` | 保留 `body { padding-bottom: calc(60px + env(safe-area-inset-bottom)) }` |
| 更新后样式错乱 | 只替换了 HTML，JS/CSS 还是旧的 | `index.html` 与资源一起替换；或整目录覆盖 |

---

## 八、临时分发测试（给几个人先试）

测试阶段不需要买服务器、也不需要备案。按「测试者在哪里」选一种即可。

> 共同前提：**只把 `dist/` 目录暴露出去**（里面只有网页产物）。不要 serve 项目根目录，
> 否则 `source/` 的解包数据、xlsx、文档都会被人下载到。

### 8.1 同一 Wi-Fi：局域网链接（最快）

```powershell
cd dist
python -m http.server 8080 --bind 0.0.0.0
```

查本机 IPv4（`ipconfig`，看 WLAN 那一项），手机浏览器打开：

```
http://<电脑局域网IP>:8080/
```

例：`http://192.168.1.9:8080/`。

- 手机和电脑必须在**同一 Wi-Fi**；访客网络、公司网络的「AP 隔离」会导致连不上。
- Windows 防火墙第一次会弹窗，勾选「专用网络」并允许；没弹窗就连不上时，
  用**管理员** PowerShell 补一条规则（只开 8080，测试完可删）：

```powershell
New-NetFirewallRule -DisplayName "GSPA Test 8080" -Direction Inbound `
  -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
# 测试结束删除：
# Remove-NetFirewallRule -DisplayName "GSPA Test 8080"
```

- 电脑休眠 / 关掉这个终端，链接就失效。它只是临时测试服务器。

### 8.2 异地但都想省事：虚拟局域网

如果测试者愿意装一个虚拟局域网工具（例如 Radmin VPN、ZeroTier、Tailscale），
让他们加入你的网络后，直接访问你在那个网络里的 IP + 8080 即可，不用公网、不用备案。

> 优点：稳定、无流量限制、不依赖第三方网页托管。
> 缺点：每个测试者都要装客户端。

### 8.3 临时公网链接（不装客户端）

用隧道工具把本机 8080 映射成一个公网 HTTPS 地址：

```powershell
# Cloudflare 快速隧道：不需要账号，命令停掉链接即失效
cloudflared tunnel --url http://127.0.0.1:8080
# 输出形如 https://random-words.trycloudflare.com
```

- 国内访问 `trycloudflare.com` 速度一般，适合「几个人看一眼」，不适合正式发布。
- 同类工具：cpolar / natapp / 花生壳（国内，需注册实名）、ngrok（国内常被墙）。
- 隧道地址每次启动都会变，别把它印在二维码或文档里。

### 8.4 需要固定地址、要发群里：Cloudflare Pages

把 `dist/` 拖到 Cloudflare Pages（步骤见本文第二节），拿到 `https://xxx.pages.dev`。
这是测试期最省事的「固定链接」：改完重传即可，链接不变。

### 8.5 完全离线：直接发文件

| 给谁 | 发什么 | 说明 |
| --- | --- | --- |
| 安卓 / 电脑 | `dist/standalone.html`（约 308 KB，无头像与图标） | 对方保存后用浏览器打开，断网也能用 |
| 微信 / QQ | `build/gspa-standalone.zip`（约 59 KB） | 单文件压缩包；微信对 `.html` 直传不友好，zip 更稳 |
| 想连数据 + 头像 + 图标一起给 | `build/gspa-web.zip`（约 4.9 MB） | 整站目录版，解压后打开 `index.html` |
| iPhone | 建议发**链接**而不是文件 | iOS「文件」App 打开本地 HTML 的体验较差 |

### 8.6 让测试者怎么反馈

- 页脚有**数据版本**和**生成时间**，先确认他看到的是不是最新构建。
- 让他直接**复制地址栏**发回来：链接里带着视图、搜索词、筛选和打开的详情，
  你打开就能复现（这是深链设计的主要用途）。
- 建议固定三个动作：手机打开 → 搜「炎」→ 点一张卡 → 点「复制链接」发给你。
- 看到旧样式先 `Ctrl+F5`（或手机清缓存）；资源带 `?v=` 指纹，正常不会新旧混搭。

### 8.7 B站 Toy 不是测试渠道

Toy 需要提交审核、绑定视频才有流量，流程以天计；测试阶段不要走它。
等主站稳定、有视频素材后再按本文第四节接。

