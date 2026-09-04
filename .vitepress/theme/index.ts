/**
 * theme entry — 手动组装默认主题（不 extends，避免官方 CSS 重复加载）
 *
 * 样式加载顺序（级联优先级从低到高）：
 *   1. theme.css  — 默认主题全部全局样式（scripts/collect-css.ts 自动汇总）
 *   2. style.css  — 我们的自定义覆盖（手动维护入口）
 *   3. 组件 scoped 样式 — 构建时自动生成（VPNavBar/VPSidebar 等内部组件的 data-v-xxx 规则）
 *
 * 组件导入路径：vitepress 包 exports 全开放（./dist/*），
 * Layout/VPBadge 等官方组件可直接 import，无需 extends。
 */
import Layout from './Layout.vue';
import SkillsHub from './SkillsHub.vue';
import './theme.css';
import './style.css';

import OfficialLayout from 'vitepress/dist/client/theme-default/Layout.vue';
import VPBadge from 'vitepress/dist/client/theme-default/components/VPBadge.vue';

export default {
  // 包装官方 Layout（内部 <Layout/> 即官方默认主题布局）
  Layout,
  enhanceApp({ app }) {
    app.component('SkillsHub', SkillsHub);
    app.component('Badge', VPBadge); // 官方 extends 主题注册的组件，补齐
  },
};

// 保留引用防止 tree-shake 误删（官方 Layout 经 Layout.vue 包装使用）
export { OfficialLayout };
