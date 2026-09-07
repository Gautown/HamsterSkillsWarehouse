#!/usr/bin/env bun
/**
 * collect-css.ts — 汇总官方 VitePress 默认主题 CSS，输出到 .vitepress/theme/theme.css
 *
 * 产物由 index.ts 全局 @import；自定义主题 HamsterTheme 不再导入此文件。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dir, '..');
const VP_ROOT = join(ROOT, 'node_modules', 'vitepress');
const STYLE_DIR = join(VP_ROOT, 'dist', 'client', 'theme-default', 'styles');
const OUT = join(ROOT, '.vitepress', 'theme', 'theme.css');

const FILES = [
  'vars.css',
  'base.css',
  'icons.css',
  'utils.css',
  'fonts.css',
  'components/custom-block.css',
  'components/VPBadge.css',
  'components/VPCard.css',
  'components/VPLink.css',
];

const parts: string[] = [];
parts.push(`/* ============================================================
   theme.css — VitePress 默认主题全局样式汇总（自动生成，勿手改）
   生成命令：bun run scripts/collect-css.ts
   依赖版本：vitepress（node_modules 实际安装版）
   来源：node_modules/vitepress/dist/client/theme-default/styles/{...}
   ============================================================ */\n`);

for (const f of FILES) {
  const p = join(STYLE_DIR, f);
  if (!existsSync(p)) {
    console.warn(`⚠ 缺少源文件: ${p}`);
    continue;
  }
  const content = readFileSync(p, 'utf-8');
  parts.push(`/* ===== 来源: ${f} ===== */\n${content}\n`);
}

// 也收集 components/*.css（VPNavBar、VPSidebar 等）
const compDir = join(STYLE_DIR, 'components');
if (existsSync(compDir)) {
  for (const f of readdirSync(compDir)) {
    if (f.endsWith('.css')) {
      const p = join(compDir, f);
      parts.push(`/* ===== 来源: components/${f} ===== */\n${readFileSync(p, 'utf-8')}\n`);
    }
  }
}

writeFileSync(OUT, parts.join('\n'));
console.log(`✓ theme.css 已生成（${(readFileSync(OUT, 'utf-8').length / 1024).toFixed(1)} KB）— ${FILES.length + readdirSync(compDir).filter(f => f.endsWith('.css')).length} 个源文件`);
console.log(`  → ${OUT}`);
