#!/usr/bin/env bun
/**
 * collect-css.ts — 把 VitePress 默认主题的全部全局 CSS 汇总进一个文件
 *
 * 产物：.vitepress/theme/theme.css
 *   - vars.css / base.css / icons.css / utils.css / components/*.css 全部拼接
 *   - 字体文件保留原 @import（fonts.css 引用的是包内字体，不能复制）
 *
 * 配合 theme/index.ts 的加载顺序：
 *   theme.css（主题全部全局样式，可手动维护）→ style.css（我们的自定义覆盖）→ 组件 scoped 样式（构建时自动生成）
 * 注意：约 90 个主题组件的 <style scoped> 样式无法手工汇总（带 data-v-xxx 哈希，
 * 由构建自动生成）；要覆盖某个组件，用覆盖选择器写进 style.css 即可。
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dir, '..');
const THEME = 'node_modules/vitepress/dist/client/theme-default';

// 加载顺序必须与 without-fonts.js 完全一致，保证级联优先级不变
const ORDER = [
  'styles/vars.css',
  'styles/base.css',
  'styles/icons.css',
  'styles/utils.css',
  'styles/components/custom-block.css',
  'styles/components/vp-code.css',
  'styles/components/vp-code-group.css',
  'styles/components/vp-doc.css',
  'styles/components/vp-sponsor.css',
];

const parts = [
  `/* ============================================================
   theme.css — VitePress 默认主题全局样式汇总（自动生成，勿手改）
   生成命令：bun run scripts/collect-css.ts
   依赖版本：vitepress（node_modules 实际安装版）
   来源：${THEME}/styles/{vars,base,icons,utils}.css + styles/components/*.css
   加载顺序与官方 without-fonts.js 一致，级联优先级不变。
   ============================================================ */

/* 字体：保留官方 @import（引用包内字体文件，复制会丢失） */
@import url('vitepress/dist/client/theme-default/styles/fonts.css');
`,
];

for (const rel of ORDER) {
  const css = readFileSync(join(ROOT, THEME, rel), 'utf-8');
  parts.push(`\n/* ===== 来源: ${rel} ===== */\n\n${css.trim()}\n`);
}

const out = join(ROOT, '.vitepress/theme/theme.css');
writeFileSync(out, parts.join(''), 'utf-8');

const kb = (readFileSync(out, 'utf-8').length / 1024).toFixed(1);
console.log(`✓ theme.css 已生成（${kb} KB）— ${ORDER.length} 个源文件`);
console.log('  → .vitepress/theme/theme.css');
