/**
 * theme/index.ts — HamsterTheme 入口（完全自定义，不依赖官方 extends 主题）
 *
 * 组件：
 *   Layout         —— 完全自写布局（顶栏+侧边栏+主内容+页脚）
 *   SkillsHub      —— 技能目录核心组件（首页/分类/标签）
 *   PublishForm    —— 发布表单
 *   OfficialLayout —— 官方默认 Layout（VitePress 内部仍需要它）
 *
 * 样式：
 *   style.css —— 全站自定义样式
 *   fonts.css + vars.css —— 仅字体和 CSS 变量（不含组件样式）
 *
 * 注意：不再导入 theme.css（官方 2000+ 行全量 CSS），
 *       颜色/间距/字体等通过 --vp-c-* CSS 变量提供。
 */
import Layout from './Layout.vue';
import SkillsHub from './SkillsHub.vue';
import PublishForm from './PublishForm.vue';
import AuthModal from './AuthModal.vue';
import './style.css';

// 只加载字体 + CSS 变量（不含官方组件样式）
import 'vitepress/dist/client/theme-default/styles/vars.css';
import 'vitepress/dist/client/theme-default/styles/fonts.css';

// 官方 Layout 引用（VitePress 内部依赖）
import OfficialLayout from 'vitepress/dist/client/theme-default/Layout.vue';

export default {
  Layout,
  enhanceApp({ app }) {
    app.component('SkillsHub', SkillsHub);
    app.component('PublishForm', PublishForm);
    app.component('AuthModal', AuthModal);
  },
  OfficialLayout,
};
