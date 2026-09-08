---
name: skillswarehouse
description: SkillsWarehouse 站点开发：双源数据+团队认证+发布全生命周期+坑位速查.
---

# Skills Warehouse 站点开发

Hermes Agent 技能目录站（`F:/GoghStudio/GitHub/vitepress/SkillsWarehouse`）：VitePress v1.6.4 + Bun 静态站 + Bun 后端发布服务。中文交流。

## 架构（双源数据 → 静态站 + 后端）

**2026-09-06 收缩**：官方站远程源已整体移除（用户明确要求去掉网络数据、只保留手动发布）。`scripts/fetch-remote.ts` 与 `.remote-skills.json` 已删除，**勿恢复**；remote 徽章/外链 target/官方外链统计细分已从 SkillsHub.vue 和 style.css 清除，残留检查以 `grep -r remote` 归零为准。

1. **本地源** `~/.hermes/skills`（SKILL.md frontmatter）→ 全文详情页，`source:'local'`（缺省）
2. **站内发布源** `.custom-skills/`（`scripts/server.ts` 的 `POST /api/publish` 写入）→ 全文详情页，`source:'custom'`，卡片带「已发布」徽章

**生命周期闭环**（2026-09-06 补全发布/列表/下架/编辑四环节）：
- 发布 `POST /api/publish` → 管理列表 `GET /api/custom-skills`（/publish/ 页常驻）→ 详情回填 `GET /api/skills/:cat/:name` → 编辑 `PUT /api/skills/:cat/:name`（category/name 锁定，改标识=下架重发）→ 下架 `DELETE /api/skills/:cat/:name`（只允许 custom 源，本地技能 403 提示去 ~/.hermes/skills 管理；数据源检查在目录检查之前）
- 回滚保险统一 `.custom-skills/.stash/`（**点前缀**——扫描器/列表 API 两层都跳过 `.` 开头；实测踩坑：暂存目录放树内会被 rebuild 扫成新技能）；重建失败自动还原
- **readCustomSkill 的 tags 正则必须允许缩进**（`/^[ \t]*tags:.../m`）——tags 写在 metadata.hermes 嵌套下，顶层 `^tags:` 匹配不到，编辑回填会丢标签（实测踩坑）

**团队认证体系**（2026-09-07 加入，自建——用户明确否决 QQ 等第三方 OAuth：内网站点无公网回调域名，QQ 互联物理上接不了，且账号数据不应流向第三方；勿再提议第三方登录）：
- `scripts/auth.ts`：`bun:sqlite` 用户表 `data/users.db`（WAL）+ argon2id 哈希（`Bun.password` 内置）+ HMAC-SHA256 签名 Cookie 会话（无状态，重启不掉线）
- 注册自助开放：**首个注册用户自动 admin**，其后 member；登录防爆破（同用户名连败 5 次锁 5 分钟，内存态）
- 权限矩阵：浏览/搜索公开 ｜ 发布需登录（`publisher`=会话注入的当前用户名，表单字段不可伪造）｜ 编辑/下架仅发布者本人或 admin（canManage）
- 端点：POST `/api/auth/register|login|logout`、GET `/api/auth/me`；写操作三端点（publish / PUT / DELETE）全过 `requireAuth` 守卫
- **登出黑名单（实测踩坑）**：无状态 HMAC 的旧 token 到 exp 前签名始终有效——logout 必须服务端内存 Set 作废（`revokeSession`），Max-Age=0 只清浏览器；E2E 信号：「登出后 me 200 ✗」
- **SESSION_SECRET 零配置化（2026-09-07，因用户 PowerShell 启动报错而改）**：优先级 = 环境变量 > `data/.session-secret` 持久化文件（首次自动生成 64hex，之后复用）→ `bun run serve` 直接可跑；持久化保证**重启后登录态不掉线**（实测：杀进程重启旧 cookie 仍 200）；踢全部会话 = 删该文件或换环境变量；data/ 已 gitignore。auth.ts 里 sqlite 也不自建父目录（mkdirSync 兜底），同类问题详见坑 14
- publisher 数据链：frontmatter `publisher` → scan-skills → skills-data.json → 卡片 ⚑ 徽标 + 详情页「发布者」meta；编辑保留原 publisher（归属不变）
- 前端 PublishForm.vue：未登录显示登录/注册卡（可切换），已登录显示用户条（用户名/角色/退出）+ 表单 + 管理列表；onMounted 先探 /api/auth/me

`scan-skills.ts` 合并双源（1=本地, 1b=custom；同名去重本地优先），生成 `.vitepress/skills-data.json` + `skills/<cat>/<name>.md` 页面。当前 93 技能/18 分类（本地库是活数字，以实时扫描为准）。

**许可证**：Apache-2.0（LICENSE 全文 + README 徽章 + package.json license 字段，2026-09-06）。README 已重写对齐现状：生命周期 5 端点表 + 安全设计 + 7 条坑位（md 生成侧 5 + Bun 侧 2）+ 仓库根 logo `public/Hamster.png`（曾误写 `../public/` 跳出仓库根，已修）。

## 常用命令

```bash
bun run scan          # 只扫描重建数据+页面
bun run build         # scan + collect-css + vitepress build → .vitepress/dist/
bun run serve         # 生产形态: 静态站 + API 同端口（PORT 默认 4310，EADDRINUSE 有友好提示）
#                      auth: register|login|logout|me · POST /api/publish · GET|PUT|DELETE /api/skills/:cat/:name · GET /api/custom-skills
bun run dev           # 开发形态（2026-09-07 起自带完整后端，见下）
```

**dev 组合模式**（`scripts/dev.ts`，与 serve 已合并语义）：前置 scan+collect-css → 子进程① API 后端（`API_ONLY=1` 仅答 API，4310）+ 子进程② vitepress dev（5173）。API 代理靠 **VitePress config.ts 的 `vite.server.proxy` 字段**（官方原生透传给 Vite dev server，`/api` → `127.0.0.1:4310`，changeOrigin）；实测 set-cookie 经代理透传不丢。进程组管理：任一子进程退出/Ctrl+C → 全退不留孤儿。**Bun.spawn 与 node child_process 签名不同**：`Bun.spawn(cmdArray, options)` 无独立 args 参数，且 `subprocess.exited` 是 Promise（不是 `.on('exit')`）——dev.ts 用 `exited.then(code => ...)`。生产 serve 不走代理（同端口直出）

## 核心坑位（Windows + Bun 1.3.x，全部实测验证）

详见 [references/windows-bun-quirks.md](references/windows-bun-quirks.md)，速记：

1. **`new Response(Bun.file())` 在 Windows 返回空 body** → 用 `readFileSync` + `new Response(new Uint8Array(buf))`
2. **验证 Bun.serve 用 bun fetch，不要用 curl** —— curl 显示 0 字节下载 + exit 23 是传输层假象，bun fetch 才反映真实状态
3. **EADDRINUSE 先 `netstat -ano | grep :PORT`** —— 端口可能被其他服务占着（还会响应乱码），换个 PORT 启动
4. **cleanUrls 三段探测**：`/dir/` → `dir/index.html`；`/page` 或 `/page/` → `page.html`；assets 原样
5. **发布查重必须查全站 `skills-data.json`**，不能只查写入目录 `.custom-skills/` —— 否则与本地同名的发布"成功"但被合并去重静默遮蔽；409 时指明冲突源（本地技能库/站内已发布）
6. VitePress 深坑（CJS 打包 JSON 转译、md 转义、插槽等）见记忆库 "VitePress 1.6.4 坑位" 条目，勿重复踩
7. **60px+ 导航栏 logo 必须同步 `--vp-nav-height`**（默认 48px 裁切）；现状：logo 52px / nav 64px / 发布技能菜单项品牌色实心按钮（style.css 尾部「导航栏 logo」段）
8. **Bun.serve `idleTimeout` 默认 10s 会捤断 rebuild 请求**（发布/下架内嵌 scan+build 约 30~60s）→ fetch 自动重试 DELETE → 撞上改名中的目录返回**假 404**（客户端看到失败但实际成功）。必须 `idleTimeout: 120`
9. **下架暂存目录必须点前缀**：改名暂存若留在树内（如 `xxx.__unpublishing__`），下架过程中的 rebuild 会把它扫成新技能污染数据层。正确做法：挪进 `.custom-skills/.stash/`（扫描器两层都跳过 `.` 开头）
10. **错误语义检查顺序**：数据源检查（403 本地技能勿删）必须在目录存在检查（404）之前，否则本地技能下架报"不在发布库"误导用户
11. **靠 CSS 隐藏的"替补"元素，隐藏规则必须无条件**：原生导航标题 `.title` 的 display:none 曾包在 `@media(min-width:960px)` + `.has-sidebar` 双重条件里——发布页（无侧栏）/窄屏下条件不满足 → 原生标题与插槽注入标题同时可见 = 双 Logo 双标题（用户截图实锤）。插槽注入常驻的元素，其原生对应物的隐藏规则要提出所有条件块
12. **统一函数签名后必查所有调用方的数据形状**：收缩重构把分类页卡片链接统一成 `cardHref(s)`（依赖 `s.cat` 字段），但只有标签/搜索页构造对象时展开 cat，分类页对象没有 → `skillUrl('', id)` 产出 `/skills//xxx/` 双斜杠死链 26 个。修复模式：加 fallbackCat 参数 + 函数内 currentCategory 兜底
13. **默认主题 scoped 样式（data-v hash）只能覆盖不能删**：带 `data-v-xxx` 属性的选择器来自默认主题组件的 scoped style，编译进 theme.css 生成物（有的仅存在于 dist 产物 CSS，源文件里搜不到）；手改 theme.css 会被下次 build 冲掉。正确做法：style.css 加同选择器同优先级覆盖（style.css 在 theme.css 后加载，级联后者胜）。实例：≥1440px 宽屏 `.VPNavBar.has-sidebar .content[data-v-9fd4d1dd]` 的 `padding-left: calc(...+var(--vp-sidebar-width))` → 覆盖为 32px（用户明确要求删除该偏移）。**data-v hash 跟 vitepress 版本走，升级依赖后覆盖会静默失效，需重新核对产物里的新 hash**（2026-09-06 该项的最终 build 验证被审批超时中断，重访问时先确认产物 CSS 含覆盖规则且在默认规则之后）
14. **bun:sqlite 不自建父目录**：`new Database('data/users.db')` 在 data/ 不存在时 SQLITE_CANTOPEN 直接炸——先 `mkdirSync('data', {recursive:true})`（auth.ts 已兜底）
15. **SQLite WAL 文件被运行中服务持锁**：清理/删用户库前先杀 serve 进程，否则 `rm data/users.db` 报 "Device or resource busy"；删库 = db + db-shm + db-wal **三个文件**一起删
16. **无状态会话的登出必须服务端作废**（详见认证体系节）：无黑名单时旧 token 到 exp 前始终有效
17. **hero 图引用 `/public/Hamster.png` 不规范**（SkillsHub.vue:201）：靠构建器容错自动改写为 `/assets/Hamster.*.png` 才没裂；规范写法是 `/Hamster.png`（public 资源引用不带 public 前缀）。升级 vitepress 后若 hero 裂图先查这里

## 维护点与约定

- `.vitepress/theme/style.css` = 全站样式唯一手动维护点（`collect-css.ts` 生成的 theme.css 勿手改）
- `.custom-skills/` 站内发布产物，git 跟踪
- 发布测试后：删测试数据 + `bun run build` 恢复干净状态
- API 闭环测试模式：写一次性 bun 脚本（`scripts/_probe*.ts`）用 fetch 打 API，测完删除
- 手动发布 = 站内发布（写 .custom-skills + 自动重建），**不是** GitHub PR
- 做完一个功能（如发布闭环、审计修复）后要主动找下一个增量点（审计边界场景/交互体验/统计口径），不要停下问「下一步做什么」——这是用户明确的协作模式
- UI 微调类请求（改 logo 高度、加按钮背景色）用户只给目标值不给过程——直接查现样式落点（style.css 对应段）→ patch → build → 产物 grep 确认 → 提交，全流程不需要中途确认
- **收缩/移除类重构要全局清残留**：删一个数据源 = 脚本 + 常量 + 合并段 + 前端渲染分支 + 徽章样式 + package.json script + .gitignore + README + 记忆库 + 统一函数的调用方数据形状，一次清完，以 grep 归零 + 死链扫描双验证
- **用户会直接手改 style.css / README 等维护点文件**（外部编辑，工具报 "modified since last read" 警告时）：先 `git diff` 看用户改了什么再动笔；语法正确则保留用户版本直接提交（实例：README logo alt 文本 `HamsterLOGO` + `./public/` 写法、style.css 手写 1440 覆盖块），不要用旧读快照覆盖用户改动；发现用户改错（如 README `../public/` 跳出仓库根）才修正并说明
- **clarify 表单空响应（用户未作答）时按推荐默认执行再汇报**——用户既定协作模式是自主推进；认证三决策（自助注册首个=admin / 仅本人+admin 可改删 / 卡片显示发布者）均这样定的，全部可后改
- `data/`（用户库）已 gitignore；`.custom-skills/` 保持 git 跟踪
- 功能审计必含内部链接全量扫描（不是抽效）：扫 dist 全部 html 的 `href="/skills/..."` → 逐条验证文件存在（`dir/index.html` / `page.html` / 原样三段探测）。收缩重构后曾靠此法抓出 26 个双斜杠死链（坑 12），此前功能审计因没扫死链而漏过。脚本模式：Python glob + re.findall + os.path.exists，全站 2377 链接秒级扫完
- **HamsterTheme 完全自定义布局（2026-09-07）**：Layout.vue 自写完整 DOM（顶栏 + 左侧导航 + 主内容区），不 import 官方 VPNavBar/VPSidebar/Layout。入口 index.ts 只 import vars.css/fonts.css，不再 import theme.css（否则继承 2000+ 行默认样式）。defineConfig 必须从 `'vitepress/dist/node/index.js'` 导入。全局组件注册（SkillsHub / PublishForm / AuthModal）必须在 `enhanceApp` 里 app.component()，否则 Vite 在 SSR 阶段会找不到
- **config.ts 生成绕过 Vite esbuild node:fs externalize**：VitePress build 时 scan-skills.ts 用 readFileSync 直接生成完整的 .vitepress/config.ts（内联 sidebar/nav 数据），否则报错 `Module not found 'fs'` 或 CJS 打包 JSON 变 undefined。不要用 `__dirname` / `require()` / `_config-data.ts as const` 等变通，实测均失败
- **移动端抽屉 visibility 必须完全由 JS :class 控制**（2026-09-07 踩坑修复）：媒体查询里不能硬编码 `display: block`，否则覆盖 JS 的 `:class="{ open: menuOpen }"` 控制，抽屉始终可见。正确写法：媒体查询只设 `position/width/z-index`，visibility 完全交给 `:class` + `v-if="menuOpen"` 遮罩层
- **弹窗组件必须 teleport to body**：登录/注册弹窗（AuthModal.vue）用 `<Teleport to="body">` 挂载到 DOM 顶层，否则被父容器的 `overflow:hidden` / `z-index` / `transform` 裁剪。弹窗关闭用 `v-if="visible"` 而非 CSS display，确保 unmount 时表单状态重置

## 关键文件

- `scripts/scan-skills.ts` — 双源扫描合并（1=本地, 1b=custom 去重）
- `scripts/server.ts` — Bun 后端（auth 四端点 + publish/edit/unpublish API + dist 静态服务 + 全站查重 + 回滚 + 404 美化页回落）
- `scripts/auth.ts` — 团队认证（sqlite 用户表 / argon2 / HMAC 会话 / 防爆破 / 登出黑名单 / requireAuth / canManage / 密钥零配置持久化）
- `scripts/dev.ts` — dev 组合器（scan 前置 + API_ONLY 后端 + vitepress dev + vite proxy + 进程组管理）
- `.vitepress/theme/SkillsHub.vue` — 首页/分类/标签三页同构组件（卡片 custom 徽章）
- `.vitepress/theme/PublishForm.vue` — 发布/编辑双模式表单（编辑回填+锁标识，成功后 3 秒跳转新页）+ 已发布技能管理列表（编辑/下架按钮）
