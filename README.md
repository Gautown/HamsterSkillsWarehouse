<div align="center">
  <h1>OpenSkillsWarehouse</h1>
  <img src="./public/hero-logo.png" alt="OpenSkillsWarehouse Logo" width="160" />
  <p>基于 <a href="https://vitepress.dev">VitePress</a> + <a href="https://bun.com">Bun</a> 的技能仓库站</p>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.0.1-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/framework-vitepress%201.6.4-green" alt="Framework">
  <img src="https://img.shields.io/badge/runtime-bun-black" alt="Runtime">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/power%20by-GauTown%20Studio-purple" alt="GauTown Studio">
</p>

**OpenSkillsWarehouse** 是一个开箱即用的技能（Skill）仓库站点：内置 92 个技能作为默认数据，自动生成**分类浏览 / 标签筛选 / 全文搜索**的静态站点，并附带 Bun 后端 —— 支持在网页上**发布、编辑、下架技能**，以及由管理员维护**站点信息**（标题、关键词、logo、导航、首页 Hero、页脚）。

## 特性

- 🗂️ **分类 + 标签双维度浏览** —— 递归扫描技能目录，自动生成分类页、标签页与详情页
- 🔍 **全站全文搜索** —— 顶栏搜索框 / `/` / `Ctrl+K` 唤起官方 `VPLocalSearchBox`（懒加载，不占首屏）
- 📤 **站内发布技能** —— 上传单文件或 `.zip` 技能包，自动解析元数据回填表单
- 🧩 **多格式识别** —— YAML / JSON / TOML frontmatter，兼容 `SKILL.md`、`AGENTS.md`、`.mdc`(Cursor) 等主流入口
- 🔐 **团队认证** —— 首个注册用户自动成为管理员，HMAC 签名 Cookie 会话
- ⚙️ **站点信息管理** —— 管理员在独立页面 `/site/` 维护标题/关键词/logo/导航/Hero/页脚
- 🚀 **零停机发布** —— 写操作 202 立即返回，后台构建到暂存目录后原子切换，构建期间站点照常访问
- 🎨 **完全自定义主题** —— OpenSkillsTheme 自写布局，不依赖官方默认主题

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交前请阅读本仓库的贡献指南：[CONTRIBUTING.md](./CONTRIBUTING.md)。

## 快速开始

```bash
bun install          # 安装依赖
bun run dev          # 开发：5173 VitePress dev（/api 代理到 4310）+ 4310 API-only 子进程
bun run build        # 生产构建 → .vitepress/dist/
bun run preview      # 预览产物（纯静态，无后端）
bun run serve        # 生产服务（站点 + API 同端口；PORT 环境变量可改，默认 4310）
```

日常使用只需两条：

```bash
bun run build && bun run serve
```

然后浏览器打开 `http://localhost:4310/`，进入 `/publish/` 发布技能、`/site/` 管理站点信息（需管理员）。

> ⚠️ **不要**直接跑 `bunx vitepress dev` / `bunx vitepress build` —— `config.ts` 是生成物且已 gitignore，必须先经 `bun run scan`（`dev` / `build` 已内置前置步骤）。

## 页面一览

| 路径 | 说明 | 权限 |
|---|---|---|
| `/` | 首页：Hero + 统计 + 分类卡片 + 本页搜索 | 公开 |
| `/skills/` | 所有技能（分类总览） | 公开 |
| `/skills/<分类>/` | 分类页：技能列表 + 标签筛选 | 公开 |
| `/skills/<分类>/<技能>/` | 技能详情页（原生 Markdown 渲染） | 公开 |
| `/tags/` | 标签页：按标签筛选全站技能 | 公开 |
| `/publish/` | 发布 / 编辑 / 下架技能 | 登录 |
| `/site/` | 网站信息管理 | 管理员 |

## 团队认证

- 首个注册用户自动成为 **admin**，其后注册为 member
- 认证接口：`POST /api/auth/register | login | logout`、`GET /api/auth/me`
- 会话用 HMAC-SHA256 签名 Cookie（密钥自动持久化到 `data/.session-secret`，零配置启动）
- 登录防爆破：同用户名连续失败 5 次锁定 5 分钟
- 导航栏「发布技能」：已登录直接进 `/publish/`，未登录先弹登录/注册框（AuthModal），成功后自动跳转
- 管理员登录后，导航栏额外出现「⚙ 网站信息管理」按钮

## 数据源

> 本仓库是**开源项目**：所有技能数据都固化在仓库内 `demo-skills/`（92 个技能作为默认数据，随仓库一起版本控制），**不依赖任何机器本地环境**，clone 即可构建。

| 来源 | 路径 | `source` | 行为 |
|---|---|---|---|
| 默认数据 | `demo-skills/`（仓库内自带） | （无） | 全文详情页 |
| 用户上传 | `.custom-skills/`（发布 API 写入，git 跟踪） | `custom` | 全文详情页，卡片带「已发布」徽章 |

同名去重：默认数据优先。

**生成物**（均已 gitignore，由 `bun run scan` 全量重建，勿手改）：

- `skills/`、`tags/` —— 原生 Markdown 页面
- `.vitepress/skills-data.json` —— 技能元数据（含分类 emoji，图标唯一来源）
- `.vitepress/site-config.json` —— 站点信息（由 `site.config.json` 注入）
- `.vitepress/config.ts` —— VitePress 配置（内联 sidebar/nav/搜索译文/vite 代理）

`.custom-skills/` 用 `.gitkeep` 占位以保持目录入库；发布 / 编辑失败时的回滚暂存区 `.custom-skills/.stash/` 已 gitignore（正常流程不留痕）。

## 技能生命周期（站内发布）

发布页 `/publish/` 是一站式管理台：上半区发布/编辑表单，下半区已发布技能列表（每行带编辑、下架按钮）。

| 方法 | 端点 | 功能 |
|---|---|---|
| POST | `/api/publish` | 发布新技能 → 写 `.custom-skills/` → **202 已受理**，后台重建 |
| GET | `/api/custom-skills` | 已发布技能清单 |
| GET | `/api/skills/:cat/:name` | 技能详情（frontmatter 解析回表单字段） |
| PUT | `/api/skills/:cat/:name` | 编辑（category/技能名锁定；改标识 = 下架后重发） |
| DELETE | `/api/skills/:cat/:name` | 下架（发布者本人或 admin） |
| GET | `/api/rebuild/status` | 后台重建进度（`building` / `queued` / `runs` / `lastError`） |

**三个写接口一律 202 立即返回**，站点在后台重建（约 30s）。前端拿到 `queued: true` 后轮询 `/api/rebuild/status`，等 `!building && !queued && runs > 提交前轮次` 才算真正生效 —— 判定必须带上 `queued`，否则被合并进下一轮的写入会被误报成功。

**安全设计：**

- 发布查重查全站（默认数据 + 用户上传），同名冲突返回 409 并指明冲突源
- 编辑 / 下架带回滚保险：编辑原文留在内存、下架原目录暂存 `.custom-skills/.stash/`；**后台构建失败会按逆序回滚本批次全部写入**，并把原因写进 `lastError`
- slug 白名单字符校验（防路径穿越），正文 512KB 上限
- 权限：编辑 / 下架仅发布者本人或 admin；下架仅限站内发布技能（默认数据不可站内删除）
- 服务不可达时前端降级提示（preview 模式无后端）

## 站点信息管理

`site.config.json`（仓库根，git 跟踪）是站点信息的**唯一数据源**，管理员在独立页面 `/site/` 维护：

| 字段 | 生效位置 |
|---|---|
| 标题 | 顶栏 + `<title>` |
| 关键词 | `<meta name="keywords">` |
| 关键词说明 | `<meta name="description">` |
| logo / favicon | 顶栏 logo / `<link rel="icon">` |
| logo 文字 / 显示开关 | 顶栏 logo 右侧文字（可隐藏） |
| 导航 | 顶栏菜单（可增删、排序） |
| Hero 图片 / 主标题 / 副标题 | 首页 Hero 区 |
| 页脚版权 / 品牌 | 页脚 |
| GitHub 链接 | 顶栏图标（留空隐藏） |

| 方法 | 端点 | 功能 |
|---|---|---|
| GET | `/api/site-config` | 读取站点信息（公开） |
| PUT | `/api/site-config` | 更新站点信息（仅 admin）→ 写 `site.config.json` → 后台重建 |
| POST | `/api/upload-image` | 上传站点图片（仅 admin，base64 → `public/uploads/`，返回可直接引用的 URL） |

**图片字段**（Logo / Favicon / Hero 图片）均支持**上传 + 实时预览**：选择本地图片（png/jpg/jpeg/gif/webp/svg/ico，≤2MB）→ 前端转 base64 → 上传接口落盘 `public/uploads/` → 回填 URL。上传的图片经 `serveStatic` 从 `public/uploads/` 直接提供（无需等重建），构建后 `dist` 也有副本。

**数据流**：`site.config.json` → `scan-skills.ts` 读取 → 注入 `.vitepress/site-config.json`（生成物）与 `config.ts`（`<title>`/`<meta>`/nav/logo/footer）→ 主题组件（Layout / SkillsHub）import 生成物渲染。

## 技能收录格式

每个技能目录含 `SKILL.md`，YAML frontmatter 支持字段：

```yaml
---
name: my-skill
description: 一句话说明技能用途
version: 1.0.0
author: Your Name
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [tag-a, tag-b]          # 自动归一化：小写 + 空格转连字符
    related_skills: [other-skill] # 详情页渲染「相关技能」链接
---
```

### 上传识别能力

发布页支持上传**单文件**或 **`.zip` 技能包**，自动解析元数据回填表单：

**单文件扩展名**：`.md` / `.mdx` / `.mdc` / `.skill` / `.yaml` / `.yml` / `.txt` / `.json` / `.toml`，以及 `.cursorrules` / `.windsurfrules` / `.clinerules` / `.goosehints` 等规则文件。

**元数据格式**：

1. YAML frontmatter —— `---\nkey: v\n---\n正文`
2. JSON frontmatter —— `---\n{...}\n---` 或整文件 JSON（正文取 `body`/`content`/`markdown` 字段）
3. TOML frontmatter —— `+++\nkey = "v"\n+++\n正文`
4. 无 frontmatter —— 降级：文件名推技能名、首段正文提描述

**字段别名**（兼容主流生态）：`name`/`title`/`displayName`、`description`/`summary`/`when_to_use`、`tags`/`labels`/`keywords`、`author`/`maintainer`/`owner`、`license`/`licence`。

**`.zip` 入口定位优先级**：`SKILL.md` → `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`/`copilot-instructions.md`/`WARP.md`/`CONVENTIONS.md`/`README.md` → 任意 `.md`/`.mdx`/`.mdc` → 清单文件（`skill.json`/`manifest.json`/`metadata.json`/`skill.toml`/`skill.yaml`/`package.json`）。包内其余文件作为附件随发布提交（单文件 ≤1MB、总数 ≤100、总计 ≤5MB）。

## 搜索

| 入口 | 搜索范围 | 实现 |
|---|---|---|
| 顶栏搜索框 · `/` · `Ctrl+K` | **全站全文**（标题 + 正文） | 懒加载官方 `VPLocalSearchBox`；索引由 VitePress local search 构建，界面译文写在 `config.ts` 的 `themeConfig.search.options` |
| 首页 / 分类页 / 标签页内输入框 | 当前页列表 | 仅匹配技能名 / 描述 / 标签（读 `skills-data.json`，不发请求） |

## 架构

```
scripts/
├── scan-skills.ts    # 扫描默认数据 + 用户上传 → skills-data.json + site-config.json + config.ts + skills//tags/ md 页面
├── server.ts         # Bun 后端：认证 + 生命周期 API + 站点信息 API + dist/ 静态服务（API_ONLY=1 可单独跑）
└── dev.ts            # dev 组合器：并行拉起 5173(vitepress) + 4310(API-only 子进程)
```

```
.vitepress/
├── config.ts         # 【生成物·gitignore】站点配置（内联 sidebar/nav + 搜索译文 + vite /api 代理）
├── skills-data.json  # 【生成物·gitignore】技能元数据（含分类 emoji —— 图标唯一来源）
├── site-config.json  # 【生成物·gitignore】站点信息（标题/关键词/logo/导航/hero/页脚）
└── theme/            # OpenSkillsTheme：完全自定义布局，不 import 官方 Layout
    ├── index.ts          # 主题入口（手动组装，不 extends；CSS 变量/字体直接 import 官方 styles/vars.css、fonts.css）
    ├── Layout.vue        # 自写布局（顶栏 + 侧边栏 + 内容 + 页脚 + 移动端抽屉）
    ├── SkillsHub.vue     # 首页 / 分类 / 标签三页同构组件
    ├── PublishForm.vue   # 发布 + 管理台（编辑 / 下架）
    ├── SiteConfigForm.vue# 网站信息管理（独立页 /site/，仅管理员）
    ├── ImageField.vue    # 图片字段（路径输入 + 上传 + 预览）
    ├── AuthModal.vue     # 登录 / 注册弹窗
    ├── skill-parse.ts    # 上传解析（YAML/JSON/TOML frontmatter + zip 解包，浏览器与测试共用）
    ├── site-config.ts    # 站点信息类型与默认值（浏览器 / 服务端共用）
    └── style.css         # 【手动维护】全站自定义样式（唯一样式维护点）
```

**数据流**：`demo-skills/`（默认数据）+ `.custom-skills/`（用户上传）→ `scan-skills.ts` 递归扫描（含嵌套分类；顶层单技能归 `other`）→ 元数据 JSON + 原生 md → VitePress 渲染 → `server.ts` 同端口服务产物。

**重建与切换**：写操作返回 202 后，`server.ts` 在后台跑 `bun run build`（带 `SW_OUT_DIR=.vitepress/dist-next`）→ 构建到**暂存目录** → `rename` 原子切换 `dist-ne[...]

**开发链**：`bun run dev` → `dev.ts` 同时拉起 vitepress dev（5173，`/api` 经 vite proxy 转发）+ API-only Bun 服务（4310）—— 一条命令覆盖「前端热更 + 后端 API」完整开发场景。

## 类型检查

```bash
bun run typecheck    # TypeScript 类型检查（tsc --noEmit）
```

## 已知坑位（改代码前先读）

1. md 正文里的裸 `<tag>`（如 `<machine-name>`）会触发 Vue tokenizer 报错 → 生成时转义为 `&lt;`（仅围栏外；围栏内由 shiki 负责，双重转义会显示错）
2. `{% raw %}` Liquid 标记会被渲染成重复属性 → 整行剥离
3. 含 `{{ }}` 的正文包 `::: v-pre` 防插值
4. `config.ts` 不能 import JSON（esbuild 打包后 undefined）→ 数据内联生成
5. 围栏跟踪必须按 CommonMark 规则（同字符 + 闭围栏长度 ≥ 开围栏 + ≤3 缩进 + 行内反引号片段不转义）—— ```` ```markdown ```` 内嵌缩进的 ```` ```yaml ```` 用简单开关翻转会状态错位
6. **`Bun.serve` 的 `idleTimeout` 默认 10s**：早期 rebuild 是同步的（约 40s），要靠放大到 120s 才不被掐断（表现为 fetch 自动重试出现假 404）。现已改为后台异步重建（写接口 202），保留 30s 即可 —— 若将来再引入同步长任务，必须同步评估这个值
7. **Windows Bun 1.3.x：`new Response(Bun.file())` body 为空** → 用 `readFileSync` + `new Response(new Uint8Array(buf))`；验证服务用 bun fetch 而非 curl（curl 0 字节下载 + exit 23 是传输层假象）
8. **VitePress router 在 window capture 阶段劫持所有站内 `<a>` 点击**（源码 `router.js:120` `addEventListener('click', …, { capture: true })`），元素上的 Vue `@click` + `preventDefault` 来不及生效 → 导航「发布技能」必须用 `<button>` 而非 `<a href="/publish/">`（router 明确跳过 button），点击逻辑才能自控
9. **`config.ts` 是生成物且已 gitignore** → clone 后直接跑 `bunx vitepress dev` / `bunx vitepress build` 都会因缺配置失败；必须走 `bun run dev`（内含前置 scan）或 `bun run build`。要改站点配置，改 `scripts/scan-skills.ts` 里的模板，别手改产物
10. **顶栏搜索框是 `readonly` 触发器，真正的全文搜索是懒加载的官方 VPLocalSearchBox**（`/` 或 `Ctrl+K` 唤起）→ 不要给它加 `.focus()` / 别在子组件里再注册一份 keydown：子组件先挂载、父组件后挂载，两次 `preventDefault + focus` 会让焦点落回只读框，用户按 `/` 后打字毫无反应（看起来像「搜索坏了」）
11. **分类图标唯一来源是 `skills-data.json` 的 `emoji` 字段**（生成源：`scan-skills.ts` 的 EMOJI 表）→ 别在组件里另抄一份分类 emoji：历史上 SkillsHub 抄成 `⊞`、生成器写 `🪟`，导致侧栏与首页卡片图标不一致
12. **`skills-data.json` 的 `source: "custom"` 是下架判定与「已发布」徽章的唯一依据** → 生成器只对 `.custom-skills/` 扫描出来的技能打这个标记（`buildSkill(dir, cat, 'custom')`）。丢了它，`server.ts` 会把站内技能当演示库技能，下架永远 403、卡片也不显示徽章
13. **`SW_OUT_DIR` 是后台重建的产物目录开关**（生成在 `config.ts` 的 `outDir`）→ `server.ts` 用它构建到 `dist-next` 再 rename 切换。手改 `config.ts` 时必须保留这一行，否则后台重建会直接写线上 `dist`，404 窗口会回来；同理**手动跑 `bun run build`（不带 `SW_OUT_DIR`）会原地重写 `dist`** —— 开发无所谓，线上请走发布接口

## License

本项目基于 [MIT License](./LICENSE) 开源。
