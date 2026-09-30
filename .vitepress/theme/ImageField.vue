<script setup lang="ts">
/**
 * ImageField — 图片路径输入 + 上传 + 预览（网站信息管理用）
 *
 * 功能：
 *   - 手动输入图片路径（public 下，如 /logo.png）
 *   - 选择本地图片 → base64 → POST /api/upload-image → 回填返回的 URL
 *   - 实时预览（输入框有值即显示缩略图，加载失败显示占位）
 *
 * 上传接口仅管理员可用；非管理员点上传会收到 403 提示。
 */
import { ref, watch } from 'vue';

const props = defineProps<{
  /** 字段标签 */
  label: string;
  /** 输入框占位符 */
  placeholder?: string;
  /** 预览区尺寸（CSS 值，默认 64px） */
  previewSize?: string;
}>();

const model = defineModel<string>({ default: '' });

const uploading = ref(false);
const error = ref('');
const previewFailed = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

/** 路径变化时重置预览失败态 */
watch(model, () => { previewFailed.value = false; });

function pickFile(): void {
  error.value = '';
  fileInput.value?.click();
}

async function onFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // 允许重复选择同一文件
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    error.value = '图片超过 2MB 上限';
    return;
  }

  uploading.value = true;
  error.value = '';
  try {
    const content = await fileToBase64(file);
    const res = await fetch('/api/upload-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: file.name, content }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      error.value = data.error ?? `上传失败（HTTP ${res.status}）`;
      return;
    }
    model.value = data.url as string;
    previewFailed.value = false;
  } catch {
    error.value = '服务不可达 —— 请用 bun run serve 启动站点服务';
  } finally {
    uploading.value = false;
  }
}

/** File → base64（去掉 data URL 前缀） */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
</script>

<template>
  <div class="img-field">
    <span class="img-field-label">{{ label }}</span>
    <div class="img-field-row">
      <div class="img-field-preview" :style="{ width: previewSize || '64px', height: previewSize || '64px' }">
        <img
          v-if="model && !previewFailed"
          :src="model"
          alt="预览"
          @error="previewFailed = true"
        />
        <span v-else class="img-field-empty">{{ model ? '加载失败' : '无图' }}</span>
      </div>
      <div class="img-field-controls">
        <input v-model="model" :placeholder="placeholder" class="img-field-input" />
        <div class="img-field-actions">
          <button type="button" class="img-field-btn" :disabled="uploading" @click="pickFile">
            {{ uploading ? '上传中…' : '上传图片' }}
          </button>
          <button
            v-if="model"
            type="button"
            class="img-field-btn ghost"
            @click="model = ''"
          >清除</button>
        </div>
        <p v-if="error" class="img-field-error">{{ error }}</p>
      </div>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon,.ico"
      class="img-field-file"
      @change="onFileChange"
    />
  </div>
</template>

<style scoped>
.img-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.img-field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2, #475569);
}
.img-field-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.img-field-preview {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--vp-c-border, #e2e8f0);
  border-radius: 8px;
  background: var(--vp-c-bg-soft, #f8fafc);
  overflow: hidden;
}
.img-field-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.img-field-empty {
  font-size: 11px;
  color: var(--vp-c-text-3, #94a3b8);
}
.img-field-controls {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.img-field-input {
  padding: 8px 10px;
  font-size: 14px;
  border: 1px solid var(--vp-c-border, #e2e8f0);
  border-radius: 8px;
  background: var(--vp-c-bg, #fff);
  color: var(--vp-c-text-1, #0f172a);
  outline: none;
  font-family: inherit;
}
.img-field-input:focus {
  border-color: var(--vp-c-brand, #0ea5e9);
}
.img-field-actions {
  display: flex;
  gap: 8px;
}
.img-field-btn {
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid var(--vp-c-border, #e2e8f0);
  border-radius: 6px;
  background: var(--vp-c-bg-soft, #f8fafc);
  color: var(--vp-c-text-2, #475569);
  cursor: pointer;
}
.img-field-btn:hover:not(:disabled) {
  background: var(--vp-c-bg-alt, #f1f5f9);
  border-color: var(--vp-c-brand, #0ea5e9);
  color: var(--vp-c-brand, #0ea5e9);
}
.img-field-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.img-field-btn.ghost {
  color: #ef4444;
}
.img-field-error {
  font-size: 12px;
  color: #ef4444;
  margin: 0;
}
.img-field-file {
  display: none;
}
</style>
