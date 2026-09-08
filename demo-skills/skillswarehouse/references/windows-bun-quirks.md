# Windows + Bun 1.4.x 坑位速查

## 文件系统

1. **`new Response(Bun.file())` 在 Windows 返回空 body** → 用 `readFileSync` + `new Response(new Uint8Array(buf))`

2. **验证 Bun.serve 用 `bun fetch`，不要用 curl** —— curl 显示 0 字节下载 + exit 23 是传输层假象，bun fetch 才反映真实状态

3. **EADDRINUSE 先 `netstat -ano | grep :PORT`** —— 端口可能被其他服务占着（还会响应乱码），换个 PORT 启动

## Bun 运行时

4. **Bun.serve `idleTimeout` 默认 10s 会捤断 rebuild 请求**（发布/下架内嵌 scan+build 约 30~60s）→ fetch 自动重试 DELETE → 撞上改名中的目录返回**假 404**（客户端看到失败但实际成功）。必须 `idleTimeout: 120`

5. **Bun.spawn 与 node child_process 签名不同**：`Bun.spawn(cmdArray, options)` 无独立 args 参数，且 `subprocess.exited` 是 Promise（不是 `.on('exit')`）——dev.ts 用 `exited.then(code => ...)`

6. **无子进程 `.on('close')` 回调**：Bun.spawn 的 subprocess 对象没有 `.on()` 方法，监听退出用 `await subprocess.exited`

## VitePress

7. **cleanUrls 三段探测**：`/dir/` → `dir/index.html`；`/page` 或 `/page/` `/` → `page.html`；assets 原样

8. **Vite esbuild 会 externalize node:fs**：VitePress build 时 `readFileSync` 报错 `Module not found`，必须用脚本生成物预写 config 或数据文件

9. **defineConfig 导入路径**：必须从 `'vitepress/dist/node/index.js'` 导入，`import { defineConfig } from 'vitepress'` 在 build 时会找不到

10. **md 裸 `<tag>` 触发 tokenizer 报错**：生成 md 时需转义为 `&lt;tag&gt;`，且必须跳过代码围栏，否则 shiki 高亮再转义一次显示成 `&amp;lt;`

11. **{% raw %} Liquid 渲染成重复属性**：整行剥离

12. **{{ }} 正文包 ::: v-pre**：防止 VitePress 把模板变量当 liquid 解析

## 认证 / 会话

13. **无状态 HMAC 的登出必须服务端作废**：旧 token 到 exp 前签名始终有效，logout 必须服务端内存 Set 作废（`revokeSession`），Max-Age=0 只清浏览器

14. **SQLite WAL 文件被运行中服务持锁**：清理/删用户库前先杀 serve 进程，否则 `rm data/users.db` 报 \"Device or resource busy\"；删库 = db + db-shm + db-wal 三个文件一起删

15. **bun:sqlite 不自建父目录**：`new Database('data/users.db')` 在 data/ 不存在时 SQLITE_CANTOPEN 直接炸——先 `mkdirSync('data', {recursive:true})`

16. **SESSION_SECRET 零配置化**：优先级 = 环境变量 > `data/.session-secret` 持久化文件（首次自动生成 64hex，之后复用）

## 样式 / 渲染

17. **靠 CSS 隐藏的\"替补\"元素，隐藏规则必须无条件**：插槽注入常驻的元素，其原生对应物的隐藏规则要提出所有条件块（@media / 类选择器等）

18. **统一函数签名后必查所有调用方的数据形状**：收缩重构把分类页卡片链接统一成依赖 `s.cat`，但分类页对象没有该字段 → 死链

19. **默认主题 scoped 样式（data-v hash）只能覆盖不能删**：手改 theme.css 会被下次 build 冲掉。正确做法：style.css 加同选择器同优先级覆盖

20. **移动端抽屉 visibility 由 JS :class 控制**：媒体查询里不能硬编码 `display: block`，否则覆盖 JS 的 `:class="{ open: menuOpen }"` 控制，抽屉始终可见

21. **弹窗组件必须 teleport to body**：被父容器的 `overflow:hidden` / `z-index` / `transform` 裁剪。用 `<Teleport to="body">` 挂载到 DOM 顶层

22. **60px+ 导航栏 logo 必须同步 `--vp-nav-height`**：默认 48px 裁切

## 数据源

23. **发布查重必须查全站 `skills-data.json`**，不能只查写入目录 `.custom-skills/` —— 否则与本地同名的发布\"成功\"但被合并去重静默遮蔽

24. **下架暂存目录必须点前缀**：改名暂存若留在树内，下架过程中的 rebuild 会把它扫成新技能污染数据层

25. **错误语义检查顺序**：数据源检查（403 本地技能勿删）必须在目录存在检查（404）之前，否则误导用户

26. **scan-skills.ts 的 tags 正则必须允许缩进**（`/^[ \t]*tags:.../m`）—— tags 写在 metadata.hermes 嵌套下，顶层 `^tags:` 匹配不到，编辑回填会丢标签

## API 设计

27. **POST /api/publish 成功后自动重建**：写 .custom-skills/ + 跑 scan-skills + 重建 markdown 页面 + 清理 dist

28. **PUT /api/skills/:cat/:name 的 category/name 锁定**：改标识 = 下架重发

29. **DELETE /api/skills/:cat/:name 只允许 custom 源**：本地技能返回 403

30. **GET /api/skills/:cat/:name 详情页回填**：用于编辑表单