# Skills Warehouse

基于 [VitePress](https://vitepress.dev) + [Bun](https://bun.com) 构建的 **Hermes Agent 技能目录站**：
扫描本地 skills 目录（SKILL.md + frontmatter），自动生成分类浏览、标签筛选、全文搜索的静态站点。

## 快速开始

```bash
bun install        # 安装依赖
bun run dev         # 开发（自动扫描技能 + 汇总主题 CSS + 启动 dev server）
bun run build       # 生产构建（产物在 .vitepress/dist/）
bun run preview     # 本地预览构建产物
```

## 架构

```
scripts/
├── scan-skills.ts   # 核心：扫描技能目录 → 生成 skills-data.json + 全部 md 页面
└── collect-css.ts   # 汇总默认主题全局 CSS → .vitepress/theme/theme.css

.vitepress/
├── config.ts        # 站点配置（侧边栏/导航/搜索，数据来自 skills-data.json）
├── skills-data.json # 【生成物】技能元数据
└── theme/
    ├── index.ts     # 主题入口（手动组装，不 extends，避免 CSS 重复加载）
    ├── Layout.vue   # 官方 Layout 包装（标题注入导航栏）
    ├── SkillsHub.vue# 列表/网格/筛选组件（纯逻辑，无样式）
    ├── theme.css    # 【生成物】默认主题全局样式汇总
    └── style.css    # 【手动维护】全站自定义样式（唯一样式维护点）

skills/  tags/       # 【生成物】由 scan-skills.ts 全量重建，勿手改
```

**数据流**：`SKILLS_DIR`（默认 `C:/Users/GauTown/AppData/Local/hermes/skills`，
可用环境变量覆盖）→ scan-skills.ts 递归扫描（含嵌套分类；顶层单技能归
`other`）→ 元数据 JSON + 原生 md 页面 → VitePress 原生渲染。

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
