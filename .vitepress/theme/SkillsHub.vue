<script setup lang="ts">
/**
 * SkillsHub — 技能目录核心组件（首页 / 分类总览 / 分类页 / 标签页）
 * 数据：.vitepress/skills-data.json（由 scripts/scan-skills.ts 生成）
 * 技能详情页是 VitePress 原生页面（/skills/<分类>/<技能>/），此处只做列表与导航。
 * 导航统一用原生 <a> —— VitePress 客户端路由会拦截站内链接点击。
 */
import { computed, ref, watch } from 'vue';
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

/** 全站标签（含计数） */
const allTags = computed(() => {
  const m = new Map<string, number>();
  for (const c of categories.value)
    for (const s of c.skills)
      for (const t of s.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
});

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

// ---- 配色（按名称哈希出稳定色相） ----
const HUES: Record<string, number> = {
  creative: 262, productivity: 152, github: 275, 'software-development': 21,
  'autonomous-ai-agents': 199, research: 340, media: 24, 'note-taking': 187,
  email: 210, debugging: 355, windows: 210, devops: 100, mlops: 250,
  'smart-home': 300, 'social-media': 350, apple: 0, web: 190, other: 120,
};
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
        <h1>Skills Warehouse</h1>
        <p>Hermes Agent 技能目录 —— 分类浏览 · 标签筛选 · 全文搜索</p>
        <input v-model="search" class="hub-search" placeholder="搜索技能名 / 描述 / 标签…" />
        <div class="stats-bar">
          <a class="stat" href="/skills/">
            <span class="stat-num">{{ data.totalSkills }}</span>
            <span class="stat-label">技能</span>
          </a>
          <a class="stat" href="/skills/">
            <span class="stat-num">{{ categories.length }}</span>
            <span class="stat-label">分类</span>
          </a>
          <a class="stat" href="/tags/">
            <span class="stat-num">{{ totalTags }}</span>
            <span class="stat-label">标签</span>
          </a>
        </div>
      </section>

      <template v-if="search.trim()">
        <h2 class="sec-title">搜索结果（{{ globalMatches.length }}）</h2>
        <div v-if="globalMatches.length" class="grid">
          <a v-for="s in globalMatches" :key="s.cat + '/' + s.id" :href="skillUrl(s.cat, s.id)" class="card">
            <div class="card-top">
              <span class="card-name">{{ s.name }}</span>
              <span v-if="s.version" class="badge">v{{ s.version }}</span>
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
            <span class="swatch" :style="{ background: catColor(c.name) }">{{ c.name[0].toUpperCase() }}</span>
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
          <span class="swatch" :style="{ background: catColor(c.name) }">{{ c.name[0].toUpperCase() }}</span>
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
            {{ currentCategory.name[0].toUpperCase() }}
          </span>
          <span class="cat-head-count">{{ currentCategory.count }} 个技能</span>
        </div>
        <p v-if="currentCategory.description" class="cat-head-desc">{{ currentCategory.description }}</p>

        <div v-if="categoryTags.length" class="chips">
          <button type="button" class="chip" :class="{ active: !selectedTag }" @click="selectedTag = null">全部</button>
          <button
            v-for="[t, n] in categoryTags" :key="t" type="button"
            class="chip" :class="{ active: selectedTag === t }"
            :style="{ borderColor: tagColor(t) }" @click="toggleTag(t)"
          >{{ t }}（{{ n }}）</button>
        </div>

        <input v-model="search" class="hub-search small" placeholder="在本分类搜索…" />
      </div>

      <div v-if="categorySkills.length" class="grid">
        <a
          v-for="s in categorySkills" :key="s.id"
          :href="skillUrl(currentCategory!.name, s.id)" class="card"
        >
          <div class="card-top">
            <span class="card-name">{{ s.name }}</span>
            <span v-if="s.version" class="badge">v{{ s.version }}</span>
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
      <div class="tag-cloud">
        <button type="button" class="chip" :class="{ active: !selectedTag }" @click="selectedTag = null">
          全部（{{ data.totalSkills }}）
        </button>
        <button
          v-for="[t, n] in allTags" :key="t" type="button"
          class="chip" :class="{ active: selectedTag === t }"
          :style="{ borderColor: tagColor(t) }" @click="toggleTag(t)"
        >{{ t }}（{{ n }}）</button>
      </div>

      <div class="grid">
        <a v-for="s in tagSkills" :key="s.cat + '/' + s.id" :href="skillUrl(s.cat, s.id)" class="card">
          <div class="card-top">
            <span class="card-name">{{ s.name }}</span>
            <span v-if="s.version" class="badge">v{{ s.version }}</span>
          </div>
          <p class="card-desc">{{ s.description || '—' }}</p>
          <div class="card-meta">
            <span class="cat-pill" :style="{ background: catColor(s.cat) }">{{ s.cat }}</span>
          </div>
        </a>
      </div>
    </template>
  </div>
</template>

<!-- 所有样式已抽离到 ./style.css（由 theme/index.ts 全局导入），方便手动维护 -->


