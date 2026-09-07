<script setup lang="ts">
/**
 * Layout.vue — HamsterTheme 主布局（完全自定义，不依赖官方 Layout）
 *
 * 结构（桌面端 ≥960px）:
 *   ┌─────────────────────────────────────────┐
 *   │  VPNavBar（自定义 topbar）              │
 *   ├──────────────┬──────────────────────────┤
 *   │  HamsterSide │  VPContent              │
 *   │  bar         │  (slot)                 │
 *   ├──────────────┴──────────────────────────┤
 *   │  VPFooter（自定义 footer）              │
 *   └─────────────────────────────────────────┘
 *
 * 移动端 (<960px):
 *   顶栏固定，汉堡菜单 → 全屏抽屉式侧边栏覆盖内容
 *
 * 数据源:
 *   - .vitepress/skills-data.json（由 scan-skills.ts 生成）
 *   - config.ts 传入的 nav/sidebar items（通过 VitePress provide/inject 或
 *     直接用 config 里的 themeConfig.nav/themeConfig.sidebar 读取——这里
 *     直接 import config.ts 拿数据最稳）
 */
import { computed, onMounted, ref } from 'vue';
import { useData, useRoute } from 'vitepress';
import type { DefaultTheme } from 'vitepress/theme';
import AuthModal from './AuthModal.vue';

const { site, page, frontmatter, isDark, toggleDark, theme } = useData();
const route = useRoute();
// theme 对象包含 VitePress 注入的 themeConfig
const navItems = computed(() => (theme.value?.nav ?? []) as DefaultTheme.NavItem[]);
const sidebarItems = computed(() => (theme.value?.sidebar ?? []) as DefaultTheme.SidebarItem[]);
// 找"技能分类 · N 个技能"这一项，展开分类链接
const categoryGroup = computed(() =>
  sidebarItems.value.find(i => typeof i === 'object' && (i as any).text?.toString().includes('个技能')) as
    (DefaultTheme.SidebarItem & { items: DefaultTheme.SidebarItem[] }) | null
);

/** 分类列表（导航用 + 侧栏用同一个源） */
const categories = computed(() => {
  const g = categoryGroup.value;
  return (g?.items ?? []) as Array<{ text: string; link: string }>;
});

/** 当前是否为 skill 目录页（/skills/*） */
const isSkillsPage = computed(() => {
  const path = route.path;
  return path.startsWith('/skills/') || path === '/skills' || path === '/';
});

// ---- 移动端菜单 ----
const menuOpen = ref(false);
const openMenu = () => { menuOpen.value = true; };
const closeMenu = () => { menuOpen.value = false; };

// 搜索快捷键：/ 聚焦输入框
const searchInput = ref<HTMLInputElement | null>(null);
onMounted(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '')) {
      e.preventDefault();
      searchInput.value?.focus();
    }
  };
  window.addEventListener('keydown', onKey);
  checkAuth();
});

// 标题（用于顶栏）
const title = computed(() => site.value.title);

// ---- 发布弹窗 ----
const authModalOpen = ref(false);
const authUser = ref<{ username: string; role: 'admin' | 'member' } | null>(null);

/** 点击"发布技能"：已登录跳 /publish/，未登录弹登录窗（button 元素，router 不劫持） */
function handlePublishClick(): void {
  if (authUser.value) {
    window.location.href = '/publish/';
    return;
  }
  authModalOpen.value = true;
}

/** 登录/注册成功后跳转发布页 */
function handleAuthSuccess(user: { username: string; role: 'admin' | 'member' }): void {
  authUser.value = user;
  authModalOpen.value = false;
  window.location.href = '/publish/';
}

/** 检查当前登录态 */
async function checkAuth(): Promise<void> {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      authUser.value = data.user;
    }
  } catch { /* dev 模式无后端 */ }
}
</script>

<template>
  <div class="hamster-layout" :class="{ 'menu-open': menuOpen }">

    <!-- ========== 顶栏 ========== -->
    <header class="hamster-topbar">
      <div class="topbar-inner">
        <!-- 左侧：logo + 标题 -->
        <div class="topbar-brand">
          <a class="topbar-logo" href="/">
            <img src="/Hamster.png" alt="Hamster" class="topbar-logo-img" />
          </a>
          <span class="topbar-title">{{ title }}</span>
        </div>

        <!-- 中间：导航菜单 -->
        <nav v-if="navItems.length" class="topbar-nav">
          <template v-for="item in navItems" :key="item.text">
            <button
              v-if="item.text === '发布技能'"
              class="topbar-nav-item topbar-nav-cta"
              @click="handlePublishClick"
            >{{ item.text }}</button>
            <a
              v-else
              :href="item.link"
              class="topbar-nav-item"
              :class="{ active: route.path === item.link || route.path.startsWith(item.link + '/') }"
            >{{ item.text }}</a>
          </template>
        </nav>

        <!-- 右侧：搜索 + 暗色切换 + GitHub + 汉堡 -->
        <div class="topbar-actions">
          <input
            ref="searchInput"
            class="topbar-search"
            placeholder="搜索技能…"
            aria-label="搜索"
            readonly
            @click="route.path.startsWith('/skills') ? searchInput?.focus() : undefined"
          />
          <kbd class="topbar-search-kbd">/</kbd>

          <button
            class="topbar-icon-btn"
            :class="{ 'is-dark': isDark, 'is-light': !isDark }"
            @click="toggleDark()"
            aria-label="切换明暗主题"
          >
            <!-- 太阳/月亮 icon（用纯 SVG 避免依赖外部图标库） -->
            <svg v-if="!isDark" class="icon-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
            <svg v-else class="icon-moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          </button>

          <a
            v-if="themeConfig?.socialLinks?.github"
            :href="themeConfig.socialLinks.github"
            target="_blank"
            rel="noopener"
            class="topbar-icon-btn"
            aria-label="GitHub"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
          </a>

          <button class="topbar-hamburger" :class="{ open: menuOpen }" @click="menuOpen = !menuOpen" aria-label="菜单">
            <span></span><span></span><span></span>
          </button>
        </div>
      </div>
    </header>

    <!-- ========== 主体容器 ========== -->
    <div class="hamster-body">

      <!-- 桌面端侧边栏 -->
      <aside v-if="isSkillsPage" class="hamster-sidebar desktop-only">
        <div class="sidebar-header">
          <span class="sidebar-label">CATEGORIES</span>
        </div>
        <nav class="sidebar-nav">
          <!-- All Skills 项 -->
          <a href="/skills/" class="sidebar-item" :class="{ active: route.path === '/skills/' || (route.path === '/skills' && !route.path.endsWith('/')) }">
            <span class="sidebar-icon">📋</span>
            <span class="sidebar-name">All Skills</span>
            <span class="sidebar-count">{{ (categoryGroup && categoryGroup.items && categoryGroup.items.length) || 0 }}</span>
          </a>
          <!-- 分类列表 -->
          <a
            v-for="item in categories"
            :key="item.link"
            :href="item.link"
            class="sidebar-item"
            :class="{ active: route.path === item.link || route.path.startsWith(item.link + '/') }"
          >
            <span class="sidebar-icon">{{ (item.text as string)?.match(/^([^\s]+)/)?.[1] ?? '📦' }}</span>
            <span class="sidebar-name">{{ (item.text as string)?.replace(/^([^\s]+\s+)/, '') ?? '' }}</span>
          </a>
        </nav>
      </aside>

      <!-- 移动端全屏抽屉侧边栏 -->
      <div v-if="isSkillsPage" class="hamster-sidebar mobile-drawer" :class="{ open: menuOpen }">
        <div class="sidebar-header">
          <span class="sidebar-label">CATEGORIES</span>
          <button class="sidebar-close" @click="menuOpen = false">✕</button>
        </div>
        <nav class="sidebar-nav">
          <a href="/skills/" class="sidebar-item" :class="{ active: !route.path.startsWith('/skills/') }" @click="closeMenu()">
            <span class="sidebar-icon">📋</span>
            <span class="sidebar-name">All Skills</span>
            <span class="sidebar-count">{{ (categoryGroup && categoryGroup.items && categoryGroup.items.length) || 0 }}</span>
          </a>
          <a
            v-for="item in categories"
            :key="item.link"
            :href="item.link"
            class="sidebar-item"
            :class="{ active: route.path === item.link || route.path.startsWith(item.link + '/') }"
            @click="closeMenu()"
          >
            <span class="sidebar-icon">{{ (item.text as string)?.match(/^([^\s]+)/)?.[1] ?? '📦' }}</span>
            <span class="sidebar-name">{{ (item.text as string)?.replace(/^([^\s]+\s+)/, '') ?? '' }}</span>
          </a>
        </nav>
      </div>

      <!-- 遮罩（移动端） -->
      <div v-if="menuOpen" class="hamster-overlay" @click="closeMenu()"></div>

      <!-- 主内容区 -->
      <main class="hamster-main">
        <Content />
      </main>
    </div>

    <!-- ========== 页脚 ========== -->
    <footer class="hamster-footer">
      <div class="footer-inner">
        <span class="footer-copy">{{ themeConfig?.footer?.copyright ?? '© 2026 Skills Warehouse' }}</span>
        <span class="footer-brand">Powered by VitePress + Bun</span>
      </div>
    </footer>

    <!-- 发布技能登录/注册弹窗 -->
    <AuthModal
      v-if="authModalOpen"
      :visible="authModalOpen"
      @close="authModalOpen = false"
      @success="handleAuthSuccess"
    />
  </div>
</template>

<style scoped>
/* =========================================
   HamsterTheme 样式（与 theme.css 解耦）
   ========================================= */

/* 顶栏 */
.hamster-topbar {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--vp-c-bg, #fff);
  border-bottom: 1px solid var(--vp-c-divider, #e2e8f0);
  height: var(--hamster-topbar-h, 64px);
}
.topbar-inner {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 24px;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 24px;
}
.topbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.topbar-logo {
  display: flex;
  align-items: center;
}
.topbar-logo-img {
  height: 40px;
  width: auto;
}
.topbar-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--vp-c-text-1, #0f172a);
  letter-spacing: -0.01em;
  white-space: nowrap;
}

/* 导航菜单 */
.topbar-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}
.topbar-nav-item {
  padding: 6px 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-2, #475569);
  border-radius: 8px;
  transition: color 0.12s, background 0.12s;
  text-decoration: none;
}
.topbar-nav-item:hover {
  color: var(--vp-c-text-1, #0f172a);
  background: var(--vp-c-bg-soft, #f8fafc);
}
.topbar-nav-item.active {
  color: var(--vp-c-brand, #0ea5e9);
}

/* 右侧动作区 */
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.topbar-search {
  height: 36px;
  padding: 0 12px;
  font-size: 14px;
  border: 1px solid var(--vp-c-border, #e2e8f0);
  border-radius: 8px;
  background: var(--vp-c-bg-soft, #f8fafc);
  color: var(--vp-c-text-1, #0f172a);
  width: 200px;
  outline: none;
  cursor: text;
}
.topbar-search:focus {
  border-color: var(--vp-c-brand, #0ea5e9);
  background: var(--vp-c-bg, #fff);
}
.topbar-search-kbd {
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--vp-c-border, #e2e8f0);
  border-radius: 4px;
  color: var(--vp-c-text-3, #94a3b8);
  background: var(--vp-c-bg, #fff);
}
.topbar-icon-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: var(--vp-c-text-2, #475569);
  transition: background 0.12s, color 0.12s;
}
.topbar-icon-btn:hover {
  background: var(--vp-c-bg-soft, #f8fafc);
  color: var(--vp-c-text-1, #0f172a);
}
.topbar-icon-btn.is-dark svg { fill: #fbbf24; stroke: #fbbf24; }
.topbar-icon-btn.is-light svg { fill: none; stroke: #64748b; }

/* 汉堡按钮 */
.topbar-hamburger {
  display: none;
  flex-direction: column;
  gap: 4px;
  width: 36px;
  height: 36px;
  padding: 6px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
}
.topbar-hamburger span {
  display: block;
  width: 100%;
  height: 2px;
  background: var(--vp-c-text-2, #475569);
  border-radius: 2px;
  transition: transform 0.2s, opacity 0.2s;
}
.topbar-hamburger.open span:nth-child(1) { transform: translateY(6px) rotate(45deg); }
.topbar-hamburger.open span:nth-child(2) { opacity: 0; }
.topbar-hamburger.open span:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }

/* 主体布局 */
.hamster-body {
  display: flex;
  max-width: 1440px;
  margin: 0 auto;
  min-height: calc(100vh - var(--hamster-topbar-h, 64px) - var(--hamster-footer-h, 48px));
}

/* 侧边栏 */
.hamster-sidebar {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--vp-c-divider, #e2e8f0);
  padding: 16px 0;
  overflow-y: auto;
  background: var(--vp-c-bg, #fff);
  height: calc(100vh - var(--hamster-topbar-h, 64px));
  position: sticky;
  top: var(--hamster-topbar-h, 64px);
}
.sidebar-header {
  padding: 0 16px 12px;
  border-bottom: 1px solid var(--vp-c-divider, #e2e8f0);
  margin-bottom: 8px;
}
.sidebar-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--vp-c-text-3, #94a3b8);
}
.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px;
}
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  text-decoration: none;
  color: var(--vp-c-text-2, #475569);
  font-size: 14px;
  transition: background 0.12s, color 0.12s;
}
.sidebar-item:hover {
  background: var(--vp-c-bg-soft, #f8fafc);
  color: var(--vp-c-text-1, #0f172a);
}
.sidebar-item.active {
  background: var(--vp-c-brand-soft, #e0f2fe);
  color: var(--vp-c-brand, #0ea5e9);
  font-weight: 600;
}
.sidebar-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}
.sidebar-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sidebar-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-3, #94a3b8);
  font-variant-numeric: tabular-nums;
}

/* 主内容区 */
.hamster-main {
  flex: 1;
  min-width: 0;
  padding: 24px 32px 40px;
  background: var(--vp-c-bg, #fff);
}

/* 页脚 */
.hamster-footer {
  height: var(--hamster-footer-h, 48px);
  background: var(--vp-c-bg-soft, #f8fafc);
  border-top: 1px solid var(--vp-c-divider, #e2e8f0);
}
.footer-inner {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 24px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--vp-c-text-3, #94a3b8);
}
.footer-copy {
  color: var(--vp-c-text-2, #475569);
}
.footer-brand {
  font-size: 12px;
}

/* 移动端抽屉 */
.hamster-sidebar.mobile-drawer {
  display: none;
  position: fixed;
  top: var(--hamster-topbar-h, 64px);
  left: 0;
  bottom: 0;
  width: 280px;
  z-index: 200;
  box-shadow: 4px 0 24px rgba(0,0,0,0.1);
  transform: translateX(-100%);
  transition: transform 0.2s ease;
}
.hamster-sidebar.mobile-drawer.open {
  transform: translateX(0);
}
.sidebar-close {
  margin-left: auto;
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--vp-c-text-3, #94a3b8);
  padding: 4px 8px;
  border-radius: 6px;
}
.sidebar-close:hover { background: var(--vp-c-bg-soft, #f8fafc); }

.hamster-overlay {
  display: none;
  position: fixed;
  inset: 0;
  top: var(--hamster-topbar-h, 64px);
  background: rgba(0,0,0,0.4);
  z-index: 150;
}
.hamster-overlay.open {
  display: block;
}

/* 响应式 */
@media (max-width: 959px) {
  .desktop-only { display: none !important; }
  /* mobile-drawer 默认仍由 JS 控制 display，媒体查询只让 overlay 和 hamburger 生效 */
  .hamster-overlay.open { display: block; }
  .topbar-hamburger { display: flex; }
  .topbar-nav { display: none; }
  .topbar-search { width: 140px; }
  .hamster-main { padding: 16px; }
}
@media (min-width: 960px) {
  .mobile-drawer, .hamster-overlay { display: none !important; }
}
</style>
