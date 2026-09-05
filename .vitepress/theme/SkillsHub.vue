<script setup lang="ts">
/**
 * SkillsHub — 技能目录核心组件（首页 / 分类总览 / 分类页 / 标签页）
 * 数据：.vitepress/skills-data.json（由 scripts/scan-skills.ts 生成）
 * 技能详情页是 VitePress 原生页面（/skills/<分类>/<技能>/），此处只做列表与导航。
 * 导航统一用原生 <a> —— VitePress 客户端路由会拦截站内链接点击。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vitepress';
import skillsData from '../skills-data.json';

interface SkillEntry {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  license?: string;
  platforms?: string[];
  tags?: string[];
  related?: string[];
  source?: 'local' | 'remote' | 'custom';
  detailUrl?: string;
}
interface CategoryEntry {
  name: string;
  description?: string;
  count: number;
  skills: SkillEntry[];
}

const data = skillsData as unknown as {
  generatedAt: string;
  totalSkills: number;
  categories: CategoryEntry[];
};

const props = defineProps<{
  mode: 'home' | 'category-list' | 'category' | 'tags';
  categoryPath?: string;
}>();

const route = useRoute();
const search = ref('');
// route.query 在 SSR 渲染阶段可能不存在，可选链防炸
const selectedTag = ref<string | null>(((route as any).query?.tag as string) ?? null);
watch(
  () => (route as any).query?.tag,
  v => { selectedTag.value = (v as string) ?? null; }
);

/** 标签页 pills 展开状态（高频标签之外的可折叠区） */
const tagPillsExpanded = ref(false);
/** 高频标签数：pills 行直接展示的数量（按技能命中数排序） */
const TOP_TAG_COUNT = 12;

/** "/" 快捷键聚焦搜索框（参考 Hermes Skills Hub 交互） */
const searchInput = ref<HTMLInputElement | null>(null);
onMounted(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '')) {
      e.preventDefault();
      searchInput.value?.focus();
    }
  };
  window.addEventListener('keydown', onKey);
});

const categories = computed(() => data.categories.filter(c => c.count > 0));
const currentCategory = computed(
  () => data.categories.find(c => c.name === props.categoryPath) ?? null
);

/** 全站唯一标签数（首页统计条用） */
const totalTags = computed(() => {
  const s = new Set<string>();
  for (const c of data.categories) for (const sk of c.skills) for (const t of sk.tags ?? []) s.add(t);
  return s.size;
});

function matches(s: SkillEntry, q: string): boolean {
  return (
    s.name.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q) ||
    (s.tags ?? []).some(t => t.toLowerCase().includes(q))
  );
}

/** 首页全局搜索结果 */
const globalMatches = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return [] as (SkillEntry & { cat: string })[];
  const out: (SkillEntry & { cat: string })[] = [];
  for (const c of categories.value)
    for (const s of c.skills) if (matches(s, q)) out.push({ ...s, cat: c.name });
  return out.sort((a, b) => a.name.localeCompare(b.name));
});

/** 当前分类的标签（含计数） */
const categoryTags = computed(() => {
  const m = new Map<string, number>();
  if (currentCategory.value)
    for (const s of currentCategory.value.skills)
      for (const t of s.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
});

/** 当前分类技能列表（标签 + 关键词过滤） */
const categorySkills = computed(() => {
  const cat = currentCategory.value;
  if (!cat) return [] as SkillEntry[];
  let list = cat.skills;
  if (selectedTag.value) list = list.filter(s => (s.tags ?? []).includes(selectedTag.value!));
  const q = search.value.trim().toLowerCase();
  if (q) list = list.filter(s => matches(s, q));
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
});

/** 全站标签（含计数）——pills 场景按命中技能数降序，高频标签优先展示 */
const allTags = computed(() => {
  const m = new Map<string, number>();
  for (const c of categories.value)
    for (const s of c.skills)
      for (const t of s.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
});

/** pills 行直接展示的高频标签 */
const visibleTags = computed(() => allTags.value.slice(0, TOP_TAG_COUNT));
/** 折叠区里的其余标签（按字母序，便于查找） */
const restTags = computed(() =>
  [...allTags.value.slice(TOP_TAG_COUNT)].sort((a, b) => a[0].localeCompare(b[0]))
);
/** 高频标签数（统计条第四格） */
const topTagCount = computed(() => visibleTags.value.length);

/** 标签页技能列表 */
const tagSkills = computed(() => {
  const t = selectedTag.value;
  const out: (SkillEntry & { cat: string })[] = [];
  for (const c of categories.value)
    for (const s of c.skills)
      if (!t || (s.tags ?? []).includes(t)) out.push({ ...s, cat: c.name });
  return out.sort((a, b) => a.name.localeCompare(b.name));
});

function toggleTag(t: string) {
  selectedTag.value = selectedTag.value === t ? null : t;
}
function skillUrl(cat: string, id: string) {
  return `/skills/${cat}/${id}/`;
}
/** 卡片链接：remote 技能外链官方站详情页，其余站内路由 */
function cardHref(s: SkillEntry & { cat?: string }): string {
  if (s.source === 'remote' && s.detailUrl) return s.detailUrl;
  return skillUrl(s.cat ?? '', s.id);
}

// ---- 配色（按名称哈希出稳定色相） ----
const HUES: Record<string, number> = {
  creative: 262, productivity: 152, github: 275, 'software-development': 21,
  'autonomous-ai-agents': 199, research: 340, media: 24, 'note-taking': 187,
  email: 210, debugging: 355, windows: 210, devops: 100, mlops: 250,
  'smart-home': 300, 'social-media': 350, apple: 0, web: 190, other: 120,
};

/** 分类 emoji 图标（参考 Hermes Skills Hub catItemIcon 模式；未命中用 📦） */
const CAT_EMOJI: Record<string, string> = {
  creative: '🎨', productivity: '📋', github: '🐙', 'software-development': '💻',
  'autonomous-ai-agents': '🤖', research: '🔬', media: '🎬', 'note-taking': '📝',
  email: '✉️', debugging: '🐛', windows: '🪟', devops: '🔧', mlops: '🧠',
  'smart-home': '🏠', 'social-media': '📱', apple: '🍎', web: '🌐', other: '📦',
};
function catEmoji(name: string): string {
  return CAT_EMOJI[name] ?? '📦';
}
function catColor(name: string): string {
  let h = HUES[name];
  if (h == null) {
    let x = 0;
    for (const ch of name) x = (x * 31 + ch.charCodeAt(0)) | 0;
    h = Math.abs(x) % 360;
  }
  return `hsl(${h}, 62%, 52%)`;
}
function tagColor(t: string): string {
  let x = 0;
  for (const ch of t) x = (x * 33 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(x) % 360}, 55%, 45%)`;
}
</script>

<template>
  <div class="hub">
    <!-- ============ 首页 ============ -->
    <template v-if="mode === 'home'">
      <section class="hero">
        <p class="hero-eyebrow"><img src="/public/Hamster.png" alt="Hamster" class="hero-icon" /></p>
        <h1>Hamster Skills Warehouse</h1>
        <p class="hero-sub">发现、搜索技能 —— 分类浏览 · 标签筛选 · 全文搜索</p>
      </section>

      <!-- 吸顶控制条（参考 Hermes controlsBar：sticky + backdrop-blur，滚动常驻） -->
      <div class="hub-controls">
        <input
          ref="searchInput" v-model="search" class="hub-search"
          placeholder="搜索技能…（按 / 聚焦）" />
        <div class="stats-bar">
          <a class="stat" href="/skills/">
            <span class="stat-num" style="color: #4ade80">{{ data.totalSkills }}</span>
            <span class="stat-label">技能</span>
          </a>
          <a class="stat" href="/skills/">
            <span class="stat-num" style="color: #60a5fa">{{ categories.length }}</span>
            <span class="stat-label">分类</span>
          </a>
          <a class="stat" href="/tags/">
            <span class="stat-num" style="color: #a78bfa">{{ totalTags }}</span>
            <span class="stat-label">标签</span>
          </a>
          <a class="stat" href="/tags/">
            <span class="stat-num" style="color: #fbbf24">{{ topTagCount }}</span>
            <span class="stat-label">高频标签</span>
          </a>
        </div>
      </div>

      <template v-if="search.trim()">
        <h2 class="sec-title">搜索结果（{{ globalMatches.length }}）</h2>
        <div v-if="globalMatches.length" class="grid">
          <a v-for="s in globalMatches" :key="s.cat + '/' + s.id" :href="cardHref(s)" class="card">
            <div class="card-top">
              <span class="card-name">{{ s.name }}</span>
              <span v-if="s.version" class="badge">v{{ s.version }}</span>
            <span v-if="s.source === 'remote'" class="badge badge-remote">官方站</span>
            <span v-else-if="s.source === 'custom'" class="badge badge-custom">已发布</span>
            </div>
            <p class="card-desc">{{ s.description || '—' }}</p>
            <div class="card-meta">
              <span class="cat-pill" :style="{ background: catColor(s.cat) }">{{ s.cat }}</span>
              <span
                v-for="t in (s.tags ?? []).slice(0, 4)" :key="t"
                class="tag-pill" :style="{ color: tagColor(t), borderColor: tagColor(t) }"
              >{{ t }}</span>
            </div>
          </a>
        </div>
        <p v-else class="empty">没有匹配的技能</p>
      </template>

      <template v-else>
        <h2 class="sec-title">按分类浏览</h2>
        <div class="cat-grid">
          <a v-for="c in categories" :key="c.name" :href="`/skills/${c.name}/`" class="cat-card">
            <span class="swatch" :style="{ background: catColor(c.name) }">{{ catEmoji(c.name) }}</span>
            <span class="cat-name">{{ c.name }}</span>
            <span class="cat-count">{{ c.count }} 个技能</span>
          </a>
        </div>
      </template>
    </template>

    <!-- ============ 分类总览 /skills/ ============ -->
    <template v-else-if="mode === 'category-list'">
      <h2 class="sec-title">所有分类 · {{ data.totalSkills }} 个技能</h2>
      <div class="cat-grid">
        <a v-for="c in categories" :key="c.name" :href="`/skills/${c.name}/`" class="cat-card">
          <span class="swatch" :style="{ background: catColor(c.name) }">{{ catEmoji(c.name) }}</span>
          <span class="cat-name">{{ c.name }}</span>
          <span class="cat-count">{{ c.count }} 个技能</span>
        </a>
      </div>
    </template>

    <!-- ============ 分类页 /skills/<cat>/ ============ -->
    <template v-else-if="mode === 'category'">
      <div v-if="currentCategory" class="cat-head">
        <div class="cat-head-row">
          <span class="swatch big" :style="{ background: catColor(currentCategory.name) }">
            {{ catEmoji(currentCategory.name) }}
          </span>
          <span class="cat-head-count">{{ currentCategory.count }} 个技能</span>
        </div>
        <p v-if="currentCategory.description" class="cat-head-desc">{{ currentCategory.description }}</p>
      </div>

      <!-- 吸顶控制条：分类内搜索 + 标签筛选（sticky，滚动筛选常驻） -->
      <div class="hub-controls">
        <input v-model="search" class="hub-search small" placeholder="在本分类搜索…" />
        <div v-if="categoryTags.length" class="chips">
          <button type="button" class="chip" :class="{ active: !selectedTag }" @click="selectedTag = null">全部</button>
          <button
            v-for="[t, n] in categoryTags" :key="t" type="button"
            class="chip" :class="{ active: selectedTag === t }"
            :style="{ borderColor: tagColor(t) }" @click="toggleTag(t)"
          >{{ t }}（{{ n }}）</button>
        </div>
      </div>

      <div v-if="categorySkills.length" class="grid">
        <a
          v-for="s in categorySkills" :key="s.id"
          :href="cardHref(s)" class="card"
        >
          <div class="card-top">
            <span class="card-name">{{ s.name }}</span>
            <span v-if="s.version" class="badge">v{{ s.version }}</span>
            <span v-if="s.source === 'remote'" class="badge badge-remote">官方站</span>
            <span v-else-if="s.source === 'custom'" class="badge badge-custom">已发布</span>
          </div>
          <p class="card-desc">{{ s.description || '—' }}</p>
          <div class="card-meta">
            <span v-if="s.author" class="dim">{{ s.author }}</span>
            <span v-if="s.license" class="dim">{{ s.license }}</span>
            <span
              v-for="t in (s.tags ?? []).slice(0, 4)" :key="t"
              class="tag-pill" :style="{ color: tagColor(t), borderColor: tagColor(t) }"
            >{{ t }}</span>
          </div>
        </a>
      </div>
      <p v-else class="empty">{{ search || selectedTag ? '没有匹配的技能' : '本分类暂无技能' }}</p>
    </template>

    <!-- ============ 标签页 /tags/ ============ -->
    <template v-else-if="mode === 'tags'">
      <!-- 吸顶控制条：pills 行（sticky，滚动筛选常驻） -->
      <div class="hub-controls">
        <div class="tag-pills">
        <button type="button" class="pill pill-all" :class="{ active: !selectedTag }" @click="selectedTag = null">
          全部 <span class="pill-count">{{ data.totalSkills }}</span>
        </button>
        <button
          v-for="[t, n] in visibleTags" :key="t" type="button"
          class="pill" :class="{ active: selectedTag === t }"
          :style="{ borderColor: tagColor(t) }" @click="toggleTag(t)"
        >{{ t }} <span class="pill-count">{{ n }}</span></button>
        <button
          v-if="allTags.length > TOP_TAG_COUNT"
          type="button" class="pill pill-more"
          @click="tagPillsExpanded = !tagPillsExpanded"
        >{{ tagPillsExpanded ? '收起 ▲' : `全部 ${allTags.length} 个标签 ▼` }}</button>
        </div>
        <!-- 折叠区：其余标签（展开后可见，随吸顶条常驻） -->
        <div v-if="tagPillsExpanded && allTags.length > TOP_TAG_COUNT" class="tag-cloud collapsed">
          <button
            v-for="[t, n] in restTags" :key="t" type="button"
            class="chip" :class="{ active: selectedTag === t }"
            :style="{ borderColor: tagColor(t) }" @click="toggleTag(t)"
          >{{ t }}（{{ n }}）</button>
        </div>
      </div>
      <h2 class="sec-title">
        {{ selectedTag ? `标签「${selectedTag}」` : '全部技能' }} · {{ tagSkills.length }} 个
      </h2>

      <div class="grid">
        <a v-for="s in tagSkills" :key="s.cat + '/' + s.id" :href="cardHref(s)" class="card">
          <div class="card-top">
            <span class="card-name">{{ s.name }}</span>
            <span v-if="s.version" class="badge">v{{ s.version }}</span>
            <span v-if="s.source === 'remote'" class="badge badge-remote">官方站</span>
            <span v-else-if="s.source === 'custom'" class="badge badge-custom">已发布</span>
          </div>
          <p class="card-desc">{{ s.description || '—' }}</p>
          <div class="card-meta">
            <span class="cat-pill" :style="{ background: catColor(s.cat) }">{{ s.cat }}</span>
          </div>
        </a>
      </div>
      <p v-if="!tagSkills.length" class="empty">该标签下暂无技能</p>
    </template>
  </div>
</template>

<!-- 所有样式已抽离到 ./style.css（由 theme/index.ts 全局导入），方便手动维护 -->


