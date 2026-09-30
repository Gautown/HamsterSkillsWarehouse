<script setup lang="ts">
/**
 * SiteConfigForm — 网站信息管理（仅管理员）
 *
 * 管理：标题 / 关键词 / 关键词说明 / logo / favicon / 导航 / hero 图片与文字 / 底部信息 / 社交链接。
 * 数据源：GET /api/site-config（公开读）→ 表单 → PUT /api/site-config（仅管理员）→ 后台重建。
 * 提交后轮询 /api/rebuild/status 收尾（与发布技能一致）。
 */
import { computed, onMounted, ref } from 'vue';
import { DEFAULT_SITE_CONFIG, type NavItem, type SiteConfig } from './site-config';

interface Me { username: string; role: 'admin' | 'member' }

const me = ref<Me | null>(null);
const loading = ref(true);
const saving = ref(false);
const rebuilding = ref(false);
const queuedMessage = ref('');
const result = ref<{ ok: boolean; msg: string } | null>(null);

/** 表单模型（各字段独立 ref，便于逐项编辑） */
const title = ref('');
const description = ref('');
const keywordsInput = ref('');
const logo = ref('');
const logoText = ref('');
const logoTextVisible = ref(true);
const favicon = ref('');
const nav = ref<NavItem[]>([]);
const heroImage = ref('');
const heroTitle = ref('');
const heroSubtitle = ref('');
const footerCopyright = ref('');
const footerBrand = ref('');
const github = ref('');

/** 左侧导航 Tab 定义 */
const tabs = [
  { id: 'basic', label: '基本信息', icon: '📝' },
  { id: 'nav', label: '导航设置', icon: '🧭' },
  { id: 'hero', label: '首页 Hero 区', icon: '🖼️' },
  { id: 'footer', label: '底部信息', icon: '📄' },
] as const;
type TabId = (typeof tabs)[number]['id'];
const activeTab = ref<TabId>('basic');

/** 关键词：逗号/空格/换行分隔 → 数组 */
const keywords = computed(() =>
  keywordsInput.value.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
);

function applyConfig(c: SiteConfig): void {
  title.value = c.title;
  description.value = c.description;
  keywordsInput.value = c.keywords.join(', ');
  logo.value = c.logo;
  logoText.value = c.logoText;
  logoTextVisible.value = c.logoTextVisible !== false;
  favicon.value = c.favicon;
  nav.value = c.nav.map(n => ({ ...n }));
  heroImage.value = c.hero.image;
  heroTitle.value = c.hero.title;
  heroSubtitle.value = c.hero.subtitle;
  footerCopyright.value = c.footer.copyright;
  footerBrand.value = c.footer.brand;
  github.value = c.socialLinks.github;
}

async function loadConfig(): Promise<void> {
  try {
    const res = await fetch('/api/site-config');
    const data = await res.json();
    if (data.ok) applyConfig(data.config as SiteConfig);
    else applyConfig(DEFAULT_SITE_CONFIG);
  } catch {
    applyConfig(DEFAULT_SITE_CONFIG);
  }
}

async function checkAuth(): Promise<void> {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) me.value = (await res.json()).user;
  } catch { /* dev 模式无后端 */ }
}

onMounted(async () => {
  await Promise.all([checkAuth(), loadConfig()]);
  loading.value = false;
});

// ---- 导航项编辑 ----
function addNav(): void {
  if (nav.value.length >= 20) return;
  nav.value.push({ text: '', link: '' });
}
function removeNav(i: number): void {
  nav.value.splice(i, 1);
}
function moveNav(i: number, dir: -1 | 1): void {
  const j = i + dir;
  if (j < 0 || j >= nav.value.length) return;
  const tmp = nav.value[i]!;
  nav.value[i] = nav.value[j]!;
  nav.value[j] = tmp;
}

// ---- 重建轮询（与 PublishForm 一致）----
interface RebuildStatus { building: boolean; queued: boolean; runs: number; lastError: string | null }
async function fetchRebuildStatus(): Promise<RebuildStatus | null> {
  try {
    const res = await fetch('/api/rebuild/status');
    const data = await res.json();
    return data.ok ? (data as RebuildStatus) : null;
  } catch { return null; }
}
async function waitForRebuild(round: number, timeoutMs = 5 * 60_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1200));
    const st = await fetchRebuildStatus();
    if (!st) return '服务不可达 —— 请确认 bun run serve 正在运行';
    if (st.building || st.queued) { rebuilding.value = true; continue; }
    if (st.runs > round) return st.lastError ? `重建失败：${st.lastError}` : null;
  }
  return '等待重建超时 —— 请查看服务端日志';
}

const canSave = computed(() => !!title.value.trim() && !saving.value);

async function save(): Promise<void> {
  if (!canSave.value) return;
  saving.value = true;
  result.value = null;
  rebuilding.value = false;
  queuedMessage.value = '';
  try {
    const round = (await fetchRebuildStatus())?.runs ?? 0;
    const res = await fetch('/api/site-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: title.value.trim(),
        description: description.value.trim(),
        keywords: keywords.value,
        logo: logo.value.trim(),
        logoText: logoText.value.trim(),
        logoTextVisible: logoTextVisible.value,
        favicon: favicon.value.trim(),
        nav: nav.value.map(n => ({ text: n.text.trim(), link: n.link.trim() })).filter(n => n.text && n.link),
        hero: {
          image: heroImage.value.trim(),
          title: heroTitle.value.trim(),
          subtitle: heroSubtitle.value.trim(),
        },
        footer: {
          copyright: footerCopyright.value.trim(),
          brand: footerBrand.value.trim(),
        },
        socialLinks: { github: github.value.trim() },
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      result.value = { ok: false, msg: data.error ?? `HTTP ${res.status}` };
      return;
    }
    if (data.queued) {
      rebuilding.value = true;
      queuedMessage.value = data.message ?? '已受理，正在后台重建站点…';
      const err = await waitForRebuild(round);
      rebuilding.value = false;
      if (err) { result.value = { ok: false, msg: err }; return; }
    }
    result.value = { ok: true, msg: '网站信息已更新并生效' };
    if (data.config) applyConfig(data.config as SiteConfig);
  } catch {
    result.value = { ok: false, msg: '服务不可达 —— 请用 bun run serve 启动站点服务' };
  } finally {
    saving.value = false;
  }
}

/** 恢复默认值（仅填充表单，需点保存才生效） */
function resetDefaults(): void {
  if (!confirm('将表单恢复为默认值？需点击「保存」才会生效。')) return;
  applyConfig(DEFAULT_SITE_CONFIG);
}
</script>

<template>
  <section class="site-config">
    <h2>网站信息管理</h2>

    <p v-if="loading" class="sc-hint">加载中…</p>

    <!-- 非管理员：只读提示 -->
    <template v-else-if="!me || me.role !== 'admin'">
      <p class="sc-hint">
        <template v-if="!me">请先登录管理员账户（在「发布技能」页登录）。</template>
        <template v-else>当前账户 <strong>{{ me.username }}</strong> 不是管理员，无法修改网站信息。</template>
      </p>
    </template>

    <!-- 管理员：完整表单 -->
    <template v-else>
      <p class="sc-hint">
        修改后写入 <code>site.config.json</code>，站点在<strong>后台</strong>重建（约 30s，期间站点照常访问）。
      </p>

      <div class="sc-layout">
        <!-- 左侧导航栏（Tab 按钮） -->
        <nav class="sc-tabs">
          <button
            v-for="t in tabs"
            :key="t.id"
            type="button"
            :class="['sc-tab', { active: activeTab === t.id }]"
            @click="activeTab = t.id"
          >
            <span class="sc-tab-icon">{{ t.icon }}</span>
            <span class="sc-tab-label">{{ t.label }}</span>
          </button>
        </nav>

        <!-- 右侧面板 -->
        <div class="sc-panel">
          <!-- 基本信息 -->
          <div v-show="activeTab === 'basic'" class="sc-pane">
            <h3 class="sc-pane-title">基本信息</h3>
            <label class="sc-field">
              <span>网站标题 *</span>
              <input v-model="title" placeholder="如 OpenSkillsWarehouse" />
            </label>
            <label class="sc-field">
              <span>关键词（逗号分隔，用于 SEO）</span>
              <input v-model="keywordsInput" placeholder="如 skills, agent, 技能仓库" />
            </label>
            <label class="sc-field">
              <span>关键词说明 / 站点描述（用于 SEO description）</span>
              <textarea v-model="description" rows="3" placeholder="一句话说明站点用途" />
            </label>
            <ImageField v-model="favicon" label="Favicon" placeholder="/favicon.ico" preview-size="48px" />
          </div>

          <!-- 导航设置 -->
          <div v-show="activeTab === 'nav'" class="sc-pane">
            <h3 class="sc-pane-title">导航设置</h3>
            <ImageField v-model="logo" label="Logo 图片" placeholder="/logo.png" />
            <label class="sc-field">
              <span>Logo 文字（显示在 Logo 图片右侧）</span>
              <input v-model="logoText" placeholder="如 OpenSkillsWarehouse" />
            </label>
            <label class="sc-field sc-field-inline">
              <input type="checkbox" v-model="logoTextVisible" />
              <span>显示 Logo 文字（取消勾选则隐藏）</span>
            </label>
            <div class="sc-field">
              <div class="sc-field-header">
                <span>导航菜单（{{ nav.length }} 项）</span>
                <button type="button" class="sc-mini-btn" @click="addNav">+ 添加</button>
              </div>
              <ul class="sc-nav-list">
                <li v-for="(n, i) in nav" :key="i">
                  <input v-model="n.text" placeholder="文字" class="sc-nav-text" />
                  <input v-model="n.link" placeholder="/link/" class="sc-nav-link" />
                  <button type="button" class="sc-mini-btn" :disabled="i === 0" title="上移" @click="moveNav(i, -1)">↑</button>
                  <button type="button" class="sc-mini-btn" :disabled="i === nav.length - 1" title="下移" @click="moveNav(i, 1)">↓</button>
                  <button type="button" class="sc-mini-btn danger" title="删除" @click="removeNav(i)">✕</button>
                </li>
              </ul>
            </div>
          </div>

          <!-- 首页 Hero 区 -->
          <div v-show="activeTab === 'hero'" class="sc-pane">
            <h3 class="sc-pane-title">首页 Hero 区</h3>
            <ImageField v-model="heroImage" label="Hero 图片" placeholder="/hero-logo.png" preview-size="80px" />
            <label class="sc-field">
              <span>Hero 主标题</span>
              <input v-model="heroTitle" placeholder="OpenSkillsWarehouse" />
            </label>
            <label class="sc-field">
              <span>Hero 副标题</span>
              <input v-model="heroSubtitle" placeholder="发现、搜索技能 —— 分类浏览 · 标签筛选 · 全文搜索" />
            </label>
          </div>

          <!-- 底部信息 -->
          <div v-show="activeTab === 'footer'" class="sc-pane">
            <h3 class="sc-pane-title">底部信息</h3>
            <label class="sc-field">
              <span>版权信息</span>
              <input v-model="footerCopyright" placeholder="© 2026 OpenSkillsWarehouse" />
            </label>
            <label class="sc-field">
              <span>品牌 / 技术栈说明</span>
              <input v-model="footerBrand" placeholder="Powered by VitePress + Bun" />
            </label>
            <label class="sc-field">
              <span>GitHub 链接（留空则不显示图标）</span>
              <input v-model="github" placeholder="https://github.com/owner/repo" />
            </label>
          </div>
        </div>
      </div>

      <div class="sc-actions">
        <button type="button" class="sc-save" :disabled="!canSave" @click="save">
          {{ saving ? '提交中…' : '保存网站信息' }}
        </button>
        <button type="button" class="sc-reset" @click="resetDefaults">恢复默认值</button>
      </div>

      <div v-if="rebuilding" class="sc-result ok">
        <p>⏳ {{ queuedMessage }}</p>
        <p class="sc-sub">构建期间站点照常访问，完成后自动切换产物。</p>
      </div>
      <div v-else-if="result" :class="['sc-result', result.ok ? 'ok' : 'err']">
        <p>{{ result.ok ? '✓' : '✗' }} {{ result.msg }}</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.site-config {
  max-width: 900px;
}
.site-config h2 {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 8px;
}
.sc-hint {
  font-size: 13px;
  color: var(--vp-c-text-2, #475569);
  margin-bottom: 16px;
}
.sc-hint code {
  background: var(--vp-c-bg-soft, #f1f5f9);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}
.sc-layout {
  display: grid;
  grid-template-columns: 176px 1fr;
  gap: 20px;
  align-items: start;
}
.sc-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 80px;
}
.sc-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  font-size: 14px;
  text-align: left;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--vp-c-text-2, #475569);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.sc-tab:hover {
  background: var(--vp-c-bg-soft, #f1f5f9);
}
.sc-tab.active {
  background: var(--vp-c-brand-soft, #e0f2fe);
  color: var(--vp-c-brand, #0ea5e9);
  font-weight: 600;
}
.sc-tab-icon {
  font-size: 15px;
  line-height: 1;
}
.sc-panel {
  min-width: 0;
}
.sc-pane-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--vp-c-divider, #e2e8f0);
}
.sc-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.sc-field > span {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2, #475569);
}
.sc-field-inline {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.sc-field-inline input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: var(--vp-c-brand, #0ea5e9);
  cursor: pointer;
}
.sc-field-inline > span {
  font-weight: 500;
  cursor: pointer;
}
.sc-field input,
.sc-field textarea {
  padding: 8px 10px;
  font-size: 14px;
  border: 1px solid var(--vp-c-border, #e2e8f0);
  border-radius: 8px;
  background: var(--vp-c-bg, #fff);
  color: var(--vp-c-text-1, #0f172a);
  outline: none;
  font-family: inherit;
}
.sc-field input:focus,
.sc-field textarea:focus {
  border-color: var(--vp-c-brand, #0ea5e9);
}
.sc-field-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2, #475569);
  margin-bottom: 6px;
}
.sc-nav-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sc-nav-list li {
  display: flex;
  gap: 6px;
  align-items: center;
}
.sc-nav-text { flex: 0 0 160px; }
.sc-nav-link { flex: 1; }
.sc-nav-list input {
  padding: 6px 8px;
  font-size: 13px;
  border: 1px solid var(--vp-c-border, #e2e8f0);
  border-radius: 6px;
  background: var(--vp-c-bg, #fff);
  color: var(--vp-c-text-1, #0f172a);
  outline: none;
}
.sc-mini-btn {
  padding: 5px 9px;
  font-size: 12px;
  border: 1px solid var(--vp-c-border, #e2e8f0);
  border-radius: 6px;
  background: var(--vp-c-bg-soft, #f8fafc);
  color: var(--vp-c-text-2, #475569);
  cursor: pointer;
}
.sc-mini-btn:hover:not(:disabled) { background: var(--vp-c-bg-alt, #f1f5f9); }
.sc-mini-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.sc-mini-btn.danger { color: #ef4444; }
.sc-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
.sc-save {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: #39d08a;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}
.sc-save:hover:not(:disabled) { background: #2fb876; }
.sc-save:disabled { opacity: 0.5; cursor: not-allowed; }
.sc-reset {
  padding: 10px 16px;
  font-size: 14px;
  border: 1px solid var(--vp-c-border, #e2e8f0);
  border-radius: 8px;
  background: var(--vp-c-bg-soft, #f8fafc);
  color: var(--vp-c-text-2, #475569);
  cursor: pointer;
}
.sc-result {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 14px;
}
.sc-result.ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.sc-result.err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.sc-sub { font-size: 12px; opacity: 0.8; margin-top: 4px; }
@media (max-width: 640px) {
  .sc-layout {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .sc-tabs {
    flex-direction: row;
    flex-wrap: wrap;
    position: static;
  }
  .sc-nav-text { flex: 0 0 100px; }
}
</style>
