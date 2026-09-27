/**
 * theme/index.ts — HamsterTheme 入口（完全自定义，不依赖官方 extends 主题）
 *
 * 组件：
 *   Layout         —— 完全自写布局（顶栏+侧边栏+主内容+页脚）
 *   SkillsHub      —— 技能目录核心组件（首页/分类/标签）
 *   PublishForm    —— 发布表单 + 管理台
 *   AuthModal      —— 登录/注册弹窗
 *
 * 样式：
 *   style.css —— 全站自定义样式（唯一样式维护点）
 *   fonts.css + vars.css —— 仅字体和 CSS 变量（不含组件样式）
 *
 * 全文搜索：Layout.vue 懒加载官方 VPLocalSearchBox（自带 scoped 样式），
 *          因此不再需要 collect-css.ts 汇总的官方全量 theme.css。
 */
import Layout from './Layout.vue';
import SkillsHub from './SkillsHub.vue';
import PublishForm from './PublishForm.vue';
import AuthModal from './AuthModal.vue';
import './style.css';

// 只加载字体 + CSS 变量（不含官方组件样式）
import 'vitepress/dist/client/theme-default/styles/vars.css';
import 'vitepress/dist/client/theme-default/styles/fonts.css';

export default {
  Layout,
  enhanceApp({ app }) {
    app.component('SkillsHub', SkillsHub);
    app.component('PublishForm', PublishForm);
    app.component('AuthModal', AuthModal);
  },
};
