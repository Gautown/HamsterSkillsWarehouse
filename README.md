# Skills Warehouse
<div style="width:100%; display: flex; justify-content: center;align-items: center;">
  <img src="./public/Hamsterlogo.png" alt="HamsterLOGO" >
</div>



基于 [VitePress](https://vitepress.dev) + [Bun](https://bun.com) 构建的 **Hermes Agent / SkillsWarehouse 技能仓库站**：
双源数据（本地技能库 + 站内发布），自动生成分类浏览、标签筛选、全文搜索的静态站点，附带 Bun 后端 —— 支持在网页上发布、编辑、下架技能，全流程自动重建。

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

## License

本项目基于 [Apache License 2.0](./LICENSE) 开源。

## 快速开始

```bash
bun install          # 依赖
bun run dev          # 开发（扫描 + 汇总 CSS + dev server；此模式无后端）
bun run build        # 生产构建 → .vitepress/dist/
bun run preview      # 预览产物（纯静态，无后端）
bun run serve        # 生产服务（站点 + API 同端口；PORT 环境变量可改，默认 4310）
```

日常使用只需两条：`bun run build && bun run serve`，然后浏览器打开 `/publish/` 管理技能。

## 数据源（双源）

| 源 | 路径 | source | 行为 |
|---|------|--------|------|
| 本地 | `~/.hermes/skills`（`SKILLS_DIR` 环境变量可覆盖） | `local` | 全文详情页 |
| 站内发布 | `.custom-skills/`（发布 API 写入，git 跟踪） | `custom` | 全文详情页，卡片带「已发布」徽章 |

同名去重：本地优先。`skills/`、`tags/`、`.vitepress/skills-data.json` 均为生成物，勿手改。

## 技能生命周期（站内发布技能）

发布页 `/publish/` 是一站式管理台：上半区发布/编辑表单，下半区已发布技能列表（每行带编辑、下架按钮）。

| 方法 | 端点 | 功能 |
|---|---|---|
| POST | `/api/publish` | 发布新技能 → 写 `.custom-skills/` → 自动重建 |
| GET | `/api/custom-skills` | 已发布技能清单 |
| GET | `/api/skills/:cat/:name` | 技能详情（frontmatter 解析回表单字段） |
| PUT | `/api/skills/:cat/:name` | 编辑（category/技能名锁定；改标识 = 下架后重发） |
| DELETE | `/api/skills/:cat/:name` | 下架（仅限站内发布技能；本地技能 403，请到 `~/.hermes/skills` 管理） |

安全设计：

- 发布查重查全站（本地库 + 已发布），同名冲突返回 409 并指明冲突源
- 编辑/下架均带回滚保险（原文/原目录暂存 `.custom-skills/.stash/`），重建失败自动还原
- slug 白名单字符校验（防路径穿越），正文 512KB 上限
- 服务不可达时前端降级提示（dev/preview 模式无后端）

## 架构

```
scripts/
├── scan-skills.ts    # 扫描双源 → skills-data.json + skills//tags/ 全部 md 页面
├── server.ts         # Bun 后端: 生命周期 API + dist/ 静态服务（同端口）
└── collect-css.ts    # 汇总默认主题全局 CSS → theme/theme.css
```

```
.vitepress/
├── config.ts         # 站点配置（侧边栏/导航/搜索，数据读 skills-data.json）
├── skills-data.json  # 【生成物】技能元数据
└── theme/
    ├── index.ts      # 主题入口（手动组装，不 extends，避免 CSS 重复加载）
    ├── Layout.vue    # 官方 Layout 包装（标题注入导航栏）
    ├── SkillsHub.vue # 首页/分类/标签三页同构组件
    ├── PublishForm.vue # 发布 + 管理台（编辑/下架）
    ├── theme.css     # 【生成物】默认主题样式汇总
    └── style.css     # 【手动维护】全站自定义样式（唯一样式维护点）
```

**数据流**：`SKILLS_DIR` → scan-skills.ts 递归扫描（含嵌套分类；顶层单技能归 `other`）→ 元数据 JSON + 原生 md → VitePress 渲染 → server.ts 同端口服务产物 + 处理 API（API 触发全量 rebuild，幂等）。

## 技能收录格式

每个技能目录含 `SKILL.md`，YAML frontmatter 支持字段：
`name` / `description` / `version` / `author` / `license` / `platforms` /
`metadata.hermes.tags`（自动归一化：小写 + 空格转连字符）/
`metadata.hermes.related_skills`（详情页渲染"相关技能"链接）。

## 已知坑位（生成器内已防御，改代码前先读）

1. md 正文里的裸 `<tag>`（如 `<machine-name>`）会触发 Vue tokenizer 报错
   → 生成时转义为 `&lt;`（仅围栏外；围栏内由 shiki 负责，双重转义会显示错）
2. `{% raw %}` Liquid 标记会被渲染成重复属性 → 整行剥离
3. 含 `{{ }}` 的正文包 `::: v-pre` 防插值
4. `config.ts` 不能 import JSON（esbuild 打包后 undefined）→ 用 `readFileSync`
5. 围栏跟踪必须按 CommonMark 规则（同字符 + 闭围栏长度 ≥ 开围栏 + ≤3 缩进 +
   行内反引号片段不转义）—— ```` ```markdown ```` 内嵌缩进的 ```` ```yaml ````
   用简单开关翻转会状态错位（llm-wiki 实例）
6. **Bun.serve `idleTimeout` 默认 10s**，rebuild 约 40s —— 不放大到 120s 会掐断
   请求，fetch 自动重试出现假 404（下架实测踩坑）
7. **Windows Bun 1.3.x：`new Response(Bun.file())` body 为空** → 用
   `readFileSync` + `new Response(new Uint8Array(buf))`；验证服务用 bun fetch 而非 curl
   （curl 0 字节下载 + exit 23 是传输层假象）

   
## 访问统计

<p align="center"> <img src="https://visitor-badge.laobi.icu/badge?page_id=Gautown.HamsterSkillsWarehouse" alt="访问量" /> <img src="https://hits.seeyoufarm.com/api/count/incr?url=https://github.com/Gautown/HamsterSkillsWarehouse&count_bg=%2379C83D&title_bg=%23555555&icon=&icon_color=%23E7E7E7&title=访问&edge_flat=true" alt="访问计数" /> </p>
