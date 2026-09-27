<script setup lang="ts">
/**
 * PublishForm — 站内技能发布表单（真后端 POST /api/publish）
 * 提交 → 后端校验+落盘 .custom-skills/+自动重建 → 返回新页 URL
 * 成功后 3 秒自动跳转到新页面。
 * 服务不可达时降级提示。
 */
import { computed, onMounted, ref } from 'vue';
import { parse as parseYaml } from 'yaml';
import skillsData from '../skills-data.json';

const category = ref('');
const name = ref('');
const description = ref('');
const body = ref('');
const tagsInput = ref('');
const version = ref('');
const author = ref('');
const license = ref('');

/** 上传文件解析提示状态 */
const parseNotice = ref<{
  type: 'ok' | 'err';
  msg: string;
  details?: string[];
} | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

/** 从技能数据中统计全站各标签所属分类，用于当 SKILL.md 未显式声明分类时智能推断 */
const tagCategoryMap = computed(() => {
  const map: Record<string, Record<string, number>> = {};
  const categories = (skillsData as unknown as {
    categories: Array<{ name: string; skills: Array<{ tags?: string[] }> }>;
  }).categories || [];
  for (const c of categories) {
    for (const s of c.skills) {
      if (s.tags) {
        for (const t of s.tags) {
          const norm = String(t).toLowerCase().trim();
          if (!map[norm]) map[norm] = {};
          map[norm][c.name] = (map[norm][c.name] || 0) + 1;
        }
      }
    }
  }
  return map;
});

/** 依据标签权重及正文关键词推断分类 */
function guessCategoryFromContent(tags: string[], content: string): string {
  const scores: Record<string, number> = {};
  for (const t of tags) {
    const norm = t.toLowerCase().trim();
    const hits = tagCategoryMap.value[norm];
    if (hits) {
      for (const [cat, count] of Object.entries(hits)) {
        scores[cat] = (scores[cat] || 0) + count;
      }
    }
  }
  let bestCat = '';
  let bestScore = 0;
  for (const [cat, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat;
    }
  }
  if (bestCat) return bestCat;

  const text = (content || '').toLowerCase();
  const existing = existingCategories.value;
  for (const cat of existing) {
    if (text.includes(cat)) return cat;
  }
  return '';
}

/** 触发文件选择框 */
function triggerUpload(): void {
  fileInputRef.value?.click();
}

/** 统一处理 Skill 文件内容解析与字段自动填充 */
function handleSkillContent(rawText: string, filename = ''): void {
  parseNotice.value = null;
  if (!rawText.trim()) {
    parseNotice.value = { type: 'err', msg: '上传的文件内容为空' };
    return;
  }

  const m = rawText.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  let fm: Record<string, any> = {};
  let markdownBody = rawText.trim();
  let hasFrontmatter = false;

  if (m) {
    try {
      fm = parseYaml(m[1]) || {};
      markdownBody = rawText.slice(m[0].length).trim();
      hasFrontmatter = true;
    } catch (e) {
      console.warn('YAML 解析警告:', e);
    }
  }

  const hermesMeta = (fm.metadata && typeof fm.metadata === 'object' ? fm.metadata.hermes : null) || {};
  const meta = (fm.metadata && typeof fm.metadata === 'object' ? fm.metadata : {}) || {};

  // 1. 技能名
  let parsedName = (fm.name != null ? String(fm.name) : '').trim().toLowerCase();
  if (!parsedName && filename) {
    const clean = filename.replace(/\.(md|skill|yaml|yml|txt)$/i, '');
    if (clean.toLowerCase() !== 'skill' && clean.toLowerCase() !== 'readme') {
      parsedName = clean.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }
  }

  // 2. 描述
  let parsedDesc = (fm.description != null ? String(fm.description) : (fm.desc != null ? String(fm.desc) : '')).trim();
  if (!parsedDesc && markdownBody) {
    const firstLine = markdownBody
      .split(/\r?\n/)
      .map(l => l.trim())
      .find(l => l && !l.startsWith('#') && !l.startsWith('---') && !l.startsWith('>') && !l.startsWith('!'));
    if (firstLine) {
      parsedDesc = firstLine.replace(/[*`_[\]()]/g, '').slice(0, 160).trim();
    }
  }

  // 3. 标签
  const rawTags = fm.tags || hermesMeta.tags || meta.tags || [];
  const tagsList: string[] = Array.isArray(rawTags)
    ? rawTags.map(t => String(t).trim()).filter(Boolean)
    : (typeof rawTags === 'string' ? rawTags.split(/[,，\s]+/).filter(Boolean) : []);

  // 4. 分类
  let parsedCategory = (
    fm.category != null
      ? String(fm.category)
      : (hermesMeta.category != null
          ? String(hermesMeta.category)
          : (meta.category != null ? String(meta.category) : ''))
  ).trim().toLowerCase();
  if (!parsedCategory) {
    parsedCategory = guessCategoryFromContent(tagsList, markdownBody);
  }

  // 5. 版本
  const parsedVersion = fm.version != null ? String(fm.version).trim() : '';

  // 6. 作者
  const parsedAuthor = Array.isArray(fm.author)
    ? fm.author.join(', ')
    : (fm.author != null ? String(fm.author).trim() : '');

  // 7. 许可
  const parsedLicense = fm.license != null ? String(fm.license).trim() : '';

  // 自动填充
  if (!editing.value) {
    if (parsedCategory) category.value = parsedCategory;
    if (parsedName) name.value = parsedName;
  }
  if (parsedDesc) description.value = parsedDesc;
  if (tagsList.length) tagsInput.value = tagsList.join(', ');
  if (parsedVersion) version.value = parsedVersion;
  if (parsedAuthor) author.value = parsedAuthor;
  if (parsedLicense) license.value = parsedLicense;
  body.value = markdownBody || rawText;

  // 汇总已识别字段
  const recognized: string[] = [];
  if (parsedCategory) recognized.push(`分类: ${parsedCategory}`);
  if (parsedName) recognized.push(`技能名: ${parsedName}`);
  if (parsedDesc) recognized.push('描述');
  if (tagsList.length) recognized.push(`标签 (${tagsList.length}个)`);
  if (parsedVersion) recognized.push(`版本: ${parsedVersion}`);
  if (parsedAuthor) recognized.push(`作者: ${parsedAuthor}`);
  if (parsedLicense) recognized.push(`许可: ${parsedLicense}`);
  recognized.push(`正文 (${(markdownBody || rawText).length} 字符)`);

  parseNotice.value = {
    type: 'ok',
    msg: hasFrontmatter
      ? `✓ 已识别并自动填充 ${filename ? `"${filename}"` : 'Skill 文件'} 的元数据`
      : `✓ 已导入文件正文${filename ? ` (${filename})` : ''}，并提取了表单信息`,
    details: recognized,
  };
}

/** 文件选择 change */
function onFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = String(e.target?.result || '');
    handleSkillContent(text, file.name);
    input.value = '';
  };
  reader.onerror = () => {
    parseNotice.value = { type: 'err', msg: '读取文件失败，请检查文件权限' };
    input.value = '';
  };
  reader.readAsText(file, 'utf-8');
}

/** 支持在正文文本域上拖拽上传 */
function onDropFile(event: DragEvent): void {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  event.preventDefault();

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = String(e.target?.result || '');
    handleSkillContent(text, file.name);
  };
  reader.readAsText(file, 'utf-8');
}

const submitting = ref(false);
const successUrl = ref('');
const result = ref<
  | { ok: true; message: string; pageUrl: string }
  | { ok: false; error: string }
  | null
>(null);

/** ===== 认证状态 ===== */
interface Me { username: string; role: 'admin' | 'member' }
const me = ref<Me | null>(null);
const authChecked = ref(false); // 已探测过 /api/auth/me
const authMode = ref<'login' | 'register'>('login');
const authUser = ref('');
const authPass = ref('');
const authError = ref('');
const authBusy = ref(false);

async function checkAuth(): Promise<void> {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      me.value = data.user;
      await loadCustomSkills();
    }
  } catch { /* dev 模式无后端 */ }
  authChecked.value = true;
}

async function submitAuth(): Promise<void> {
  if (authBusy.value || !authUser.value || !authPass.value) return;
  authBusy.value = true;
  authError.value = '';
  try {
    const res = await fetch(`/api/auth/${authMode.value}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: authUser.value.trim(), password: authPass.value }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      me.value = data.user;
      authUser.value = ''; authPass.value = '';
      await loadCustomSkills();
    } else {
      authError.value = data.error ?? `HTTP ${res.status}`;
    }
  } catch {
    authError.value = '服务不可达 —— 请用 bun run serve 启动（dev/preview 无后端）';
  } finally {
    authBusy.value = false;
  }
}

async function logout(): Promise<void> {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  me.value = null;
  cancelEdit();
  customSkills.value = [];
}

/** ===== 编辑模式 ===== */
const editing = ref<CustomSkillRow | null>(null); // 编辑中的技能（null=发布新技能）
const saving = ref(false); // 编辑保存中

async function startEdit(row: CustomSkillRow): Promise<void> {
  try {
    const res = await fetch(`/api/skills/${row.category}/${row.name}`);
    const data = await res.json();
    if (!res.ok || !data.ok) { alert(`读取失败: ${data.error}`); return; }
    const s = data.skill;
    editing.value = row;
    successUrl.value = '';
    result.value = null;
    // 回填表单
    category.value = s.category;
    name.value = s.name;
    description.value = s.description ?? '';
    body.value = s.body ?? '';
    tagsInput.value = (s.tags ?? []).join(', ');
    version.value = s.version ?? '';
    author.value = s.author ?? '';
    license.value = s.license ?? '';
    // 滚到表单
    document.querySelector('.publish-form')?.scrollIntoView({ behavior: 'smooth' });
  } catch {
    alert('服务不可达 —— 请确认 bun run serve 正在运行');
  }
}

async function saveEdit(): Promise<void> {
  if (!editing.value || !canSubmit.value) return;
  saving.value = true;
  rebuilding.value = false;
  queuedMessage.value = '';
  try {
    const round = await markRebuildRound();
    const res = await fetch(`/api/skills/${editing.value.category}/${editing.value.name}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: description.value.trim(),
        body: body.value,
        tags: tagsInput.value.split(/[,，\s]+/).filter(Boolean),
        version: version.value.trim() || undefined,
        author: author.value.trim() || undefined,
        license: license.value.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      result.value = { ok: false, error: data.error ?? `HTTP ${res.status}` };
      return;
    }
    // 202 已受理 → 等后台重建切换产物，再报"已生效"
    if (data.queued) {
      rebuilding.value = true;
      queuedMessage.value = data.message ?? '已受理，正在后台重建站点…';
      const err = await waitForRebuild(round);
      rebuilding.value = false;
      if (err) { result.value = { ok: false, error: err }; return; }
    }
    result.value = { ok: true, message: `${data.message ?? `技能 ${editing.value.name} 已更新`}（已生效）`, pageUrl: data.pageUrl };
    await loadCustomSkills(); // 刷新列表（描述可能变了）
    // 2 秒后清编辑态回发布模式
    setTimeout(() => { cancelEdit(); result.value = null; }, 2000);
  } catch {
    result.value = { ok: false, error: '服务不可达 —— 请确认 bun run serve 正在运行' };
  } finally {
    saving.value = false;
  }
}

function cancelEdit(): void {
  editing.value = null;
  category.value = ''; name.value = ''; description.value = ''; body.value = '';
  tagsInput.value = ''; version.value = ''; author.value = ''; license.value = '';
  result.value = null;
}

/** ===== 管理列表：已发布技能 + 下架 ===== */
interface CustomSkillRow { category: string; name: string; description?: string }
const customSkills = ref<CustomSkillRow[]>([]);
const unpublishing = ref<string | null>(null); // 'cat/name' 下架中标记

async function loadCustomSkills(): Promise<void> {
  try {
    const res = await fetch('/api/custom-skills');
    const data = await res.json();
    if (data.ok) customSkills.value = data.skills;
  } catch { /* 服务不可达时保持空列表 */ }
}

async function unpublish(row: CustomSkillRow): Promise<void> {
  if (!confirm(`确定下架 ${row.category}/${row.name}？\n下架后站点会在后台自动重建，该技能页面将从站点移除。`)) return;
  unpublishing.value = `${row.category}/${row.name}`;
  rebuilding.value = false;
  queuedMessage.value = '';
  try {
    const round = await markRebuildRound();
    const res = await fetch(`/api/skills/${row.category}/${row.name}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      alert(`下架失败: ${data.error ?? `HTTP ${res.status}`}`);
      return;
    }
    if (data.queued) {
      rebuilding.value = true;
      queuedMessage.value = data.message ?? '已受理，正在后台重建站点…';
      const err = await waitForRebuild(round);
      rebuilding.value = false;
      if (err) { alert(`下架后重建失败：${err}`); return; }
    }
    await loadCustomSkills(); // 刷新列表
  } catch {
    alert('服务不可达 —— 请确认 bun run serve 正在运行');
  } finally {
    unpublishing.value = null;
  }
}

onMounted(() => { checkAuth(); });

/** 站内已有分类（可输入新分类）。浏览器里没有 require（旧的 require() 写法会静默
 *  退化成空列表），必须用静态 import —— Vite 构建时会把 JSON 打进包里 */
const existingCategories = computed(() =>
  (skillsData as unknown as { categories: Array<{ name: string }> }).categories.map(c => c.name)
);

/** ===== 后台重建进度：写接口返回 202（已受理）后轮询 /api/rebuild/status 收尾 ===== */
interface RebuildStatus {
  building: boolean;
  queued: boolean;
  runs: number;
  lastError: string | null;
  lastDurationMs: number | null;
}
const rebuilding = ref(false);
const queuedMessage = ref('');

async function fetchRebuildStatus(): Promise<RebuildStatus | null> {
  try {
    const res = await fetch('/api/rebuild/status');
    const data = await res.json();
    return data.ok ? (data as RebuildStatus) : null;
  } catch {
    return null;
  }
}

/** 写请求前记录重建轮次，用于判断"我这批"是否已经构建完成 */
async function markRebuildRound(): Promise<number> {
  return (await fetchRebuildStatus())?.runs ?? 0;
}

/**
 * 轮询到本轮（含排队合并的那一轮）构建结束。
 * 判定条件必须同时满足 !building && !queued：写入若被合并进下一轮，
 * 只等 building 结束会提前误报成功（站点其实还没包含本次改动）。
 */
async function waitForRebuild(round: number, timeoutMs = 5 * 60_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1200));
    const st = await fetchRebuildStatus();
    if (!st) return '服务不可达 —— 请确认 bun run serve 正在运行';
    if (st.building || st.queued) {
      rebuilding.value = true;
      continue;
    }
    if (st.runs > round) return st.lastError ? `重建失败：${st.lastError}` : null;
  }
  return '等待重建超时 —— 请查看服务端日志（重建是后台任务，写入可能已成功）';
}

const canSubmit = computed(() =>
  category.value.trim() && name.value.trim() && description.value.trim().length >= 5 && body.value.trim().length >= 10 && !submitting.value
);

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  result.value = null;
  successUrl.value = '';
  rebuilding.value = false;
  queuedMessage.value = '';
  try {
    const round = await markRebuildRound();
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        category: category.value.trim().toLowerCase(),
        name: name.value.trim().toLowerCase(),
        description: description.value.trim(),
        body: body.value,
        tags: tagsInput.value.split(/[,，\s]+/).filter(Boolean),
        version: version.value.trim() || undefined,
        author: author.value.trim() || undefined,
        license: license.value.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      result.value = { ok: false, error: data.error || `HTTP ${res.status}` };
      return;
    }
    // 后端返回 202（已受理）：先显示"正在重建"，等产物真正切过来再报成功并跳转
    if (data.queued) {
      rebuilding.value = true;
      queuedMessage.value = data.message ?? '已受理，正在后台重建站点…';
      const err = await waitForRebuild(round);
      rebuilding.value = false;
      if (err) {
        result.value = { ok: false, error: err };
        return;
      }
    }
    result.value = { ok: true, message: `技能 ${name.value.trim()} 已发布并生效`, pageUrl: data.pageUrl };
    successUrl.value = data.pageUrl;
    await loadCustomSkills();
    // 1.5 秒后自动跳转新页
    setTimeout(() => { window.location.href = data.pageUrl; }, 1500);
  } catch {
    result.value = {
      ok: false,
      error: '发布服务不可达 —— 请用 `bun run serve` 启动站点服务（dev/preview 模式无后端）',
    };
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="publish-form">
    <!-- ===== 未登录：登录/注册卡 ===== -->
    <div v-if="authChecked && !me" class="auth-card">
      <h2>{{ authMode === 'login' ? '登录' : '注册' }}</h2>
      <p class="pub-hint">
        发布技能需要团队账户。{{ authMode === 'login' ? '还没有账户？' : '已有账户？' }}
        <a href="" @click.prevent="authMode = authMode === 'login' ? 'register' : 'login'">
          {{ authMode === 'login' ? '去注册' : '去登录' }}
        </a>
        <span class="stat-sub">（首个注册用户自动成为管理员）</span>
      </p>
      <label class="pub-field">
        <span>用户名</span>
        <input v-model="authUser" placeholder="2-32 位，字母/数字/_/-" @keyup.enter="submitAuth" />
      </label>
      <label class="pub-field">
        <span>密码</span>
        <input v-model="authPass" type="password" placeholder="至少 6 位" @keyup.enter="submitAuth" />
      </label>
      <div v-if="authError" class="pub-result err"><p>✗ {{ authError }}</p></div>
      <div class="pub-actions">
        <button class="pub-submit" :disabled="authBusy || !authUser || !authPass" @click="submitAuth">
          {{ authBusy ? '提交中…' : (authMode === 'login' ? '登录' : '注册') }}
        </button>
      </div>
    </div>

    <!-- ===== 已登录：用户条 + 原有全功能 ===== -->
    <template v-else-if="me">
      <div class="auth-bar">
        <span>👤 {{ me.username }} <span class="stat-sub">（{{ me.role === 'admin' ? '管理员' : '成员' }}）</span></span>
        <button class="auth-logout" @click="logout">退出</button>
      </div>

    <!-- 发布成功：后台构建完成、产物切换之后才出现 -->
    <div v-if="successUrl" class="pub-result ok pub-success">
      <p>✓ 技能已发布并生效！即将跳转到新页面…</p>
      <p><a :href="successUrl">{{ successUrl }}</a></p>
      <p><a href="/publish/" @click.prevent="successUrl = ''">← 继续发布下一个技能</a></p>
    </div>

    <!-- 已受理、后台重建中：站点全程可用，构建完成后自动切换产物 -->
    <div v-else-if="rebuilding" class="pub-result ok">
      <p>⏳ {{ queuedMessage }}</p>
      <p class="stat-sub">构建期间站点照常访问（旧版本继续服务），完成后自动切换产物、无需手动刷新。</p>
    </div>

    <template v-else>
      <h2>{{ editing ? `编辑技能：${editing.name}` : '发布技能' }}</h2>
      <p v-if="editing" class="pub-hint">
        正在编辑 <code>{{ editing.category }}/{{ editing.name }}</code>（分类与技能名不可改，改动请下架后重新发布）
        <a href="" @click.prevent="cancelEdit">取消编辑</a>
      </p>
      <p v-else class="pub-hint">
        发布后写入 <code>.custom-skills/</code>，站点在<strong>后台</strong>重建（约 30s，期间站点照常访问）——
        完成后新技能出现在分类、标签与搜索中。
      </p>

      <div class="pub-grid">
        <label class="pub-field">
          <span>分类 *</span>
          <input v-model="category" list="pub-cats" :disabled="!!editing" placeholder="如 creative / 自定义新分类" />
          <datalist id="pub-cats">
            <option v-for="c in existingCategories" :key="c" :value="c" />
          </datalist>
        </label>
        <label class="pub-field">
          <span>技能名 *</span>
          <input v-model="name" :disabled="!!editing" placeholder="小写字母/数字/连字符，如 my-cool-skill" />
        </label>
      </div>

      <label class="pub-field">
        <span>描述 *（一句话说明技能用途）</span>
        <input v-model="description" placeholder="至少 5 个字符" />
      </label>

      <label class="pub-field">
        <span>标签（逗号或空格分隔，自动小写归一）</span>
        <input v-model="tagsInput" placeholder="如: video, ai, cli" />
      </label>

      <div class="pub-grid">
        <label class="pub-field">
          <span>版本</span>
          <input v-model="version" placeholder="如 1.0.0" />
        </label>
        <label class="pub-field">
          <span>作者</span>
          <input v-model="author" placeholder="你的名字" />
        </label>
        <label class="pub-field">
          <span>许可</span>
          <input v-model="license" placeholder="如 MIT" />
        </label>
      </div>

      <div class="pub-field">
        <div class="pub-field-header">
          <span>正文 *（SKILL.md 正文，发布后即为详情页）</span>
          <div class="pub-upload-wrap">
            <input
              ref="fileInputRef"
              type="file"
              accept=".md,.skill,.yaml,.yml,.txt"
              style="display: none"
              @change="onFileSelected"
            />
            <button
              type="button"
              class="pub-upload-btn"
              title="支持上传 SKILL.md、.md 或 .skill 文件，自动解析并回填表格"
              @click="triggerUpload"
            >
              📄 上传 Skill 文件
            </button>
          </div>
        </div>
        <textarea
          v-model="body"
          rows="12"
          placeholder="# 用途说明&#10;&#10;## 使用方法&#10;……（Markdown，支持代码块。也可直接拖拽 SKILL.md 文件到此处）"
          @dragover.prevent
          @drop="onDropFile"
        />
        <div v-if="parseNotice" :class="['pub-parse-notice', parseNotice.type]">
          <div class="pub-parse-title">{{ parseNotice.msg }}</div>
          <div v-if="parseNotice.details?.length" class="pub-parse-tags">
            <span v-for="tag in parseNotice.details" :key="tag" class="pub-parse-tag">{{ tag }}</span>
          </div>
        </div>
      </div>

      <div class="pub-actions">
        <button v-if="editing" type="button" class="pub-submit" :disabled="!canSubmit || saving" @click="saveEdit">
          {{ saving ? '提交中…' : '保存修改' }}
        </button>
        <button v-else type="button" class="pub-submit" :disabled="!canSubmit" @click="submit">
          {{ submitting ? '提交中…' : '发布技能' }}
        </button>
      </div>

      <div v-if="result && !result.ok" class="pub-result err">
        <p>✗ {{ result.error }}</p>
      </div>
    </template>

    <!-- ===== 已发布技能管理 ===== -->
    <section class="pub-manage">
      <h3>已发布技能 <span class="stat-sub">（{{ customSkills.length }} 个 · 可下架）</span></h3>
      <p v-if="!customSkills.length" class="pub-manage-empty">暂无站内发布的技能</p>
      <ul v-else class="pub-manage-list">
        <li v-for="row in customSkills" :key="row.category + '/' + row.name">
          <div class="pub-manage-info">
            <a :href="`/skills/${row.category}/${row.name}/`" class="pub-manage-name">{{ row.name }}</a>
            <span class="pub-manage-cat">{{ row.category }}</span>
            <span v-if="row.description" class="pub-manage-desc">{{ row.description }}</span>
          </div>
          <div class="pub-manage-actions">
            <button class="pub-edit" @click="startEdit(row)">编辑</button>
            <button
              class="pub-unpublish"
              :disabled="unpublishing === row.category + '/' + row.name"
              @click="unpublish(row)"
            >{{ unpublishing === row.category + '/' + row.name ? '下架中…' : '下架' }}</button>
          </div>
        </li>
      </ul>
    </section>
    </template>
  </div>
</template>
