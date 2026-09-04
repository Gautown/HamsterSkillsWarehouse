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

export default defineConfig({
  title: 'Skills Warehouse',
  description: 'Hermes Agent 技能目录 —— 分类浏览 · 标签筛选 · 全文搜索',
  cleanUrls: true,
  ignoreDeadLinks: true, // 内容为扫描生成，源数据里的链接不应导致构建失败
  themeConfig: {
    logo: '≋',
    nav: [
      { text: '首页', link: '/' },
      { text: '所有技能', link: '/skills/' },
      { text: '按标签', link: '/tags/' },
    ],
    sidebar: [
      { text: '首页', link: '/' },
      { text: '所有技能', link: '/skills/' },
      {
        text: `技能分类 · ${skillsData.totalSkills} 个技能`,
        items: cats.map(c => ({
          text: `${c.name}（${c.count}）`,
          link: `/skills/${c.name}/`,
        })),
      },
      { text: '按标签', link: '/tags/' },
    ],
    search: { provider: 'local' },
    footer: {
      message: '基于 Hermes Agent 技能目录自动生成',
      copyright: '© 2026 Skills Warehouse',
    },
  },
});
