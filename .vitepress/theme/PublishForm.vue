<script setup lang="ts">
/**
 * PublishForm — 站内技能发布表单（真后端 POST /api/publish）
 * 提交 → 后端校验+落盘 .custom-skills/+自动重建 → 返回新页 URL
 * 成功后 3 秒自动跳转到新页面。
 * 服务不可达时降级提示。
 */
import { computed, ref } from 'vue';

const category = ref('');
const name = ref('');
const description = ref('');
const body = ref('');
const tagsInput = ref('');
const version = ref('');
const author = ref('');
const license = ref('');

const submitting = ref(false);
const successUrl = ref('');
const result = ref<
  | { ok: true; message: string; pageUrl: string }
  | { ok: false; error: string }
  | null
>(null);

/** 站内已有分类（可输入新分类） */
const existingCategories = computed(() => {
  try {
    const data = require('../skills-data.json');
    return (data.categories as Array<{ name: string }>).map(c => c.name);
  } catch {
    return [] as string[];
  }
});

const canSubmit = computed(() =>
  category.value.trim() && name.value.trim() && description.value.trim().length >= 5 && body.value.trim().length >= 10 && !submitting.value
);

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  result.value = null;
  successUrl.value = '';
  try {
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
    if (res.ok && data.ok) {
      result.value = { ok: true, message: data.message, pageUrl: data.pageUrl };
      successUrl.value = data.pageUrl;
      // 3 秒后自动跳转新页
      setTimeout(() => { window.location.href = data.pageUrl; }, 3000);
    } else {
      result.value = { ok: false, error: data.error || `HTTP ${res.status}` };
    }
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
    <!-- 发布成功：跳转到新页提示 -->
    <div v-if="successUrl" class="pub-result ok pub-success">
      <p>✓ 技能已成功发布！即将跳转到新页面…</p>
      <p><a :href="successUrl">{{ successUrl }}</a>（3 秒后自动跳转）</p>
      <p><a href="/publish/" @click.prevent="successUrl = ''">← 继续发布下一个技能</a></p>
    </div>

    <template v-else>
      <h2>发布技能</h2>
      <p class="pub-hint">
        发布后写入 <code>.custom-skills/</code> 并自动重建站点 —— 新技能立即出现在分类、标签与搜索中。
      </p>

      <div class="pub-grid">
        <label class="pub-field">
          <span>分类 *</span>
          <input v-model="category" list="pub-cats" placeholder="如 creative / 自定义新分类" />
          <datalist id="pub-cats">
            <option v-for="c in existingCategories" :key="c" :value="c" />
          </datalist>
        </label>
        <label class="pub-field">
          <span>技能名 *</span>
          <input v-model="name" placeholder="小写字母/数字/连字符，如 my-cool-skill" />
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

      <label class="pub-field">
        <span>正文 *（SKILL.md 正文，发布后即为详情页）</span>
        <textarea v-model="body" rows="12" placeholder="# 用途说明&#10;&#10;## 使用方法&#10;……（Markdown，支持代码块）" />
      </label>

      <div class="pub-actions">
        <button type="button" class="pub-submit" :disabled="!canSubmit" @click="submit">
          {{ submitting ? '发布中（自动重建约 30s）…' : '发布技能' }}
        </button>
      </div>

      <div v-if="result && !result.ok" class="pub-result err">
        <p>✗ {{ result.error }}</p>
      </div>
    </template>
  </div>
</template>
