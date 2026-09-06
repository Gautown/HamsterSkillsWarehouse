import { defineConfig } from 'vitepress';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 技能数据由 scripts/scan-skills.ts 生成到 .vitepress/skills-data.json
// （dev / build 已前置扫描，正常运行不会缺文件）
// 注意：不要用 import 导入 JSON —— esbuild 打包 config 时 interop 出过 undefined 的坑
const here = dirname(fileURLToPath(import.meta.url));
const skillsData = JSON.parse(readFileSync(resolve(here, 'skills-data.json'), 'utf-8')) as {
  totalSkills: number;
  categories: Array<{ name: string; count: number }>;
};
if (!Array.isArray(skillsData.categories)) {
  throw new Error('skills-data.json 缺少 categories —— 请先运行: bun run scan');
}

const cats = skillsData.categories.filter(c => c.count > 0);

/** 分类 emoji 图标（与 SkillsHub.vue CAT_EMOJI 同源；未命中用 📦） */
const CAT_EMOJI: Record<string, string> = {
  creative: '🎨', productivity: '📋', github: '🐙', 'software-development': '💻',
  'autonomous-ai-agents': '🤖', research: '🔬', media: '🎬', 'note-taking': '📝',
  email: '✉️', debugging: '🐛', windows: '🪟', devops: '🔧', mlops: '🧠',
  'smart-home': '🏠', 'social-media': '📱', apple: '🍎', web: '🌐', other: '📦',
};
const catEmoji = (name: string) => CAT_EMOJI[name] ?? '📦';

export default defineConfig({
  head: [
['link', { rel: 'icon', href: '/favicon.ico' }]
],
  title: 'Hamster Skills Warehouse',
  description: 'Hamster Skills Warehouse 技能目录 —— 分类浏览 · 标签筛选 · 全文搜索',
  cleanUrls: true,
  ignoreDeadLinks: true, // 内容为扫描生成，源数据里的链接不应导致构建失败
  markdown: {
    // 启用 headers 收集插件（@mdit-vue/plugin-headers）——
    // 右侧 "On this page" 大纲组件一直存在，但此开关默认关闭，
    // 不开则全站 headers 为空、大纲空白（vitepress 渲染器源码 if (options.headers)）
    headers: true,
  },
  themeConfig: {
    logo: '/Hamster.png',
    nav: [
      { text: '首页', link: '/' },
      { text: '所有技能', link: '/skills/' },
      { text: '按标签', link: '/tags/' },
      { text: '发布技能', link: '/publish/' },
    ],
    sidebar: [
      { text: '首页', link: '/' },
      { text: '所有技能', link: '/skills/' },
      {
        text: `技能分类 · ${skillsData.totalSkills} 个技能`,
        items: cats.map(c => ({
          text: `${catEmoji(c.name)} ${c.name}（${c.count}）`,
          link: `/skills/${c.name}/`,
        })),
      },
      { text: '按标签', link: '/tags/' },
    ],
    search: { provider: 'local' },
    footer: {
     
      copyright: '© 2026 Skills Warehouse',
    },
  },
});
