<script setup lang="ts">
/**
 * PublishForm — 站内技能发布表单（真后端 POST /api/publish）
 * 提交 → 后端校验+落盘 .custom-skills/+自动重建 → 返回新页 URL
 * 支持上传单文件（.md/.mdx/.mdc/.skill/.yaml/.yml/.txt/.json/.toml 及各类 rules 文件）
 * 或 .zip 打包技能（含多文件），解析元数据自动回填表单，zip 附件随表单提交（files 字段）。
 * 成功后 3 秒自动跳转到新页面。服务不可达时降级提示。
 */
import { computed, onMounted, ref } from 'vue';
import skillsData from '../skills-data.json';
import {
  ATTACH_MAX_FILES,
  ATTACH_MAX_TOTAL_BYTES,
  type ParsedSkillMeta,
  type SkillAttachment,
  encodeAttachment,
  extractSkillZip,
  isZipBytes,
  parseSkillText,
} from './skill-parse';

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

/** zip 解包附件（随表单 files 字段提交；attachmentsDirty 决定是否发送） */
const attachments = ref<SkillAttachment[]>([]);
/** 附件是否被本次会话改动（编辑模式：未改动不发 files，服务端保持原附件） */
const attachmentsDirty = ref(false);
/** 编辑模式：服务端已存在的附件（只读展示，重新上传 zip 或「全部移除」才替换） */
const existingFiles = ref<Array<{ path: string; size: number }>>([]);

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

/** 解析结果 → 回填表单 + 提示条（单文件与 zip 共用） */
function applyParsedMeta(meta: ParsedSkillMeta, sourceLabel: string, extraDetails: string[] = []): void {
  if (meta.error) {
    parseNotice.value = { type: 'err', msg: meta.error };
    return;
  }

  // 分类：frontmatter 未声明时按全站标签权重 + 正文关键词推断
  const parsedCategory = meta.category || guessCategoryFromContent(meta.tags, meta.body);

  // 自动填充（编辑模式下分类与技能名不可变 —— 改标识 = 下架重发）
  if (!editing.value) {
    if (parsedCategory) category.value = parsedCategory;
    if (meta.name) name.value = meta.name;
  }
  if (meta.description) description.value = meta.description;
  if (meta.tags.length) tagsInput.value = meta.tags.join(', ');
  if (meta.version) version.value = meta.version;
  if (meta.author) author.value = meta.author;
  if (meta.license) license.value = meta.license;
  if (meta.body) body.value = meta.body;

  // 汇总已识别字段
  const recognized: string[] = [...extraDetails];
  if (parsedCategory) recognized.push(`分类: ${parsedCategory}`);
  if (meta.name) recognized.push(`技能名: ${meta.name}`);
  if (meta.description) recognized.push('描述');
  if (meta.tags.length) recognized.push(`标签 (${meta.tags.length}个)`);
  if (meta.version) recognized.push(`版本: ${meta.version}`);
  if (meta.author) recognized.push(`作者: ${meta.author}`);
  if (meta.license) recognized.push(`许可: ${meta.license}`);
  if (meta.body) recognized.push(`正文 (${meta.body.length} 字符)`);

  const fmtLabel = meta.format === 'json' ? 'JSON frontmatter' : meta.format === 'yaml' ? 'YAML frontmatter' : meta.format === 'toml' ? 'TOML frontmatter' : '纯正文';
  parseNotice.value = {
    type: 'ok',
    msg: meta.hasFrontmatter
      ? `✓ 已识别 ${sourceLabel} 的元数据（${fmtLabel}）并自动填充`
      : `✓ 已导入 ${sourceLabel} 正文（无 frontmatter，已降级提取）`,
    details: recognized,
  };
}

/** 单文件（.md/.skill/.yaml/.txt/.json）解析回填
 *  不触碰附件状态：单文件上传隐含"没有新附件"，但编辑模式下清空附件
 *  必须由用户显式操作（全部移除 / 重新上传 zip），避免误清服务端已有附件 */
function handleSkillContent(rawText: string, filename = ''): void {
  parseNotice.value = null;
  const meta = parseSkillText(rawText, filename);
  applyParsedMeta(meta, filename ? `"${filename}"` : 'Skill 文件');
}

/** .zip 打包技能：解包 → SKILL.md 回填表单 → 其余文件进附件区 */
function handleSkillZip(bytes: Uint8Array, filename: string): void {
  parseNotice.value = null;
  let result;
  try {
    result = extractSkillZip(bytes, filename);
  } catch (e) {
    // 解包失败 → 不动表单与附件区（已有的 pending / 服务端附件保持原状）
    parseNotice.value = { type: 'err', msg: (e as Error).message };
    return;
  }
  if (result.meta.error) {
    // SKILL.md 元数据解析失败 → 同样不应用任何改动
    parseNotice.value = { type: 'err', msg: result.meta.error };
    return;
  }
  // 附件区整体替换为本包内容（可再逐个移除）
  attachments.value = result.attachments.map(a => encodeAttachment(a.path, a.bytes));
  attachmentsDirty.value = true;

  const extra: string[] = [`包内 SKILL.md: ${result.skillPath}`];
  if (attachments.value.length) {
    const totalKB = Math.round(
      attachments.value.reduce((n, f) => n + (f.encoding === 'base64' ? Math.floor(f.content.length * 3 / 4) : new TextEncoder().encode(f.content).length), 0) / 1024
    );
    extra.push(`附件 ${attachments.value.length} 个（${totalKB} KB）`);
  } else {
    extra.push('无附件文件');
  }
  applyParsedMeta(result.meta, `"${filename}"`, extra);
  // 解包警告（剥离根目录/忽略条目）追加到提示明细
  if (result.warnings.length && parseNotice.value) {
    parseNotice.value.details = [...(parseNotice.value.details ?? []), ...result.warnings.map(w => `⚠ ${w}`)];
  }
}

/** 统一文件入口：按魔数/扩展名分流 zip 与文本 */
async function handleUploadedFile(file: File): Promise<void> {
  parseNotice.value = null;
  if (file.size > 30 * 1024 * 1024) {
    parseNotice.value = { type: 'err', msg: '文件超过 30MB 上限' };
    return;
  }
  let buf: Uint8Array;
  try {
    buf = new Uint8Array(await file.arrayBuffer());
  } catch {
    parseNotice.value = { type: 'err', msg: '读取文件失败，请检查文件权限' };
    return;
  }
  if (isZipBytes(buf) || /\.zip$/i.test(file.name)) {
    handleSkillZip(buf, file.name);
    return;
  }
  handleSkillContent(new TextDecoder('utf-8').decode(buf), file.name);
}

/** 文件选择 change */
function onFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  void handleUploadedFile(file).finally(() => { input.value = ''; });
}

/** 支持在正文文本域上拖拽上传（含 .zip） */
function onDropFile(event: DragEvent): void {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  event.preventDefault();
  void handleUploadedFile(file);
}

/** 移除单个待提交附件 */
function removeAttachment(path: string): void {
  attachments.value = attachments.value.filter(f => f.path !== path);
  attachmentsDirty.value = true;
}

/** 移除全部附件（编辑模式下 = 提交空 files 清空服务端附件） */
function clearAttachments(): void {
  attachments.value = [];
  attachmentsDirty.value = true;
}

/** 附件展示用：格式化字节数 */
function fmtSize(f: SkillAttachment): string {
  const bytes = f.encoding === 'base64' ? Math.floor(f.content.length * 3 / 4) : new TextEncoder().encode(f.content).length;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
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
    // 附件：展示服务端已有清单；本次未改动则不发 files（服务端保持原样）
    existingFiles.value = s.fileList ?? [];
    attachments.value = [];
    attachmentsDirty.value = false;
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
        // 附件仅在本次会话被改动时发送（全量替换语义；空数组 = 清空）
        ...(attachmentsDirty.value ? { files: attachments.value } : {}),
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
  attachments.value = []; attachmentsDirty.value = false; existingFiles.value = [];
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
        // zip 解包附件（仅非空时发送）
        ...(attachments.value.length ? { files: attachments.value } : {}),
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
              accept=".md,.mdx,.mdc,.skill,.yaml,.yml,.txt,.json,.toml,.zip,.cursorrules,.windsurfrules,.clinerules,.goosehints"
              style="display: none"
              @change="onFileSelected"
            />
            <button
              type="button"
              class="pub-upload-btn"
              title="支持 SKILL.md / AGENTS.md / CLAUDE.md / .mdc(Cursor) / .json / .toml / .yaml 等单文件，或 .zip 打包技能（含多文件）；自动解析元数据回填表格，zip 内其余文件作为附件随发布提交"
              @click="triggerUpload"
            >
              📄 上传 Skill 文件
            </button>
          </div>
        </div>
        <textarea
          v-model="body"
          rows="12"
          placeholder="# 用途说明&#10;&#10;## 使用方法&#10;……（Markdown，支持代码块。也可直接拖拽 SKILL.md / AGENTS.md / .mdc / .zip 技能包到此处）"
          @dragover.prevent
          @drop="onDropFile"
        />
        <div v-if="parseNotice" :class="['pub-parse-notice', parseNotice.type]">
          <div class="pub-parse-title">{{ parseNotice.msg }}</div>
          <div v-if="parseNotice.details?.length" class="pub-parse-tags">
            <span v-for="tag in parseNotice.details" :key="tag" class="pub-parse-tag">{{ tag }}</span>
          </div>
        </div>

        <!-- zip 附件区：待提交（可移除） + 编辑模式下服务端已有清单 -->
        <div v-if="attachments.length || (editing && existingFiles.length && !attachmentsDirty)" class="pub-attach-box">
          <div class="pub-attach-header">
            <span>
              📎 附件（{{ attachmentsDirty ? attachments.length : (attachments.length || existingFiles.length) }} 个 ·
              单文件 ≤1MB · 总计 ≤{{ ATTACH_MAX_TOTAL_BYTES / 1024 / 1024 }}MB · 最多 {{ ATTACH_MAX_FILES }} 个）
            </span>
            <button
              v-if="attachments.length"
              type="button"
              class="pub-attach-clear"
              title="移除全部附件（编辑模式保存后将清空服务端附件）"
              @click="clearAttachments"
            >全部移除</button>
          </div>
          <!-- 本次上传的附件（可逐个移除） -->
          <ul v-if="attachments.length" class="pub-attach-list">
            <li v-for="f in attachments" :key="f.path">
              <span class="pub-attach-path">{{ f.path }}</span>
              <span class="pub-attach-size">{{ fmtSize(f) }}</span>
              <button type="button" class="pub-attach-remove" title="移除该附件" @click="removeAttachment(f.path)">✕</button>
            </li>
          </ul>
          <!-- 编辑模式：服务端已有附件（只读；重新上传 zip 或全部移除后保存才会替换） -->
          <ul v-else-if="editing && existingFiles.length" class="pub-attach-list readonly">
            <li v-for="f in existingFiles" :key="f.path">
              <span class="pub-attach-path">{{ f.path }}</span>
              <span class="pub-attach-size">{{ f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(1)} KB` }}</span>
            </li>
          </ul>
          <p v-if="editing && existingFiles.length && !attachments.length" class="pub-attach-hint">
            重新上传 zip 会整体替换以上附件；正文改动不影响附件。
          </p>
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
