<script setup lang="ts">
/**
 * AuthModal — 登录/注册弹窗组件
 *
 * 用法：在 Layout.vue 或其他组件里引入并绑定 visible prop，
 * 登录/注册成功后通过 emit('success') 通知父组件跳转。
 *
 * 样式：继承 PublishForm.vue 的 auth-card / pub-field 等类名，
 *       但外层包一层 modal 遮罩布局。
 */
import { ref } from 'vue';

interface Me { username: string; role: 'admin' | 'member' }

const visible = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'success', user: Me): void }>();

const authMode = ref<'login' | 'register'>('login');
const authUser = ref('');
const authPass = ref('');
const authError = ref('');
const authBusy = ref(false);
const me = ref<Me | null>(null);
const authChecked = ref(false);

// 挂载时检测是否已登录
async function checkAuth(): Promise<void> {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      me.value = data.user;
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
      authUser.value = '';
      authPass.value = '';
      emit('success', data.user);
    } else {
      authError.value = data.error ?? `HTTP ${res.status}`;
    }
  } catch {
    authError.value = '服务不可达 —— 请用 bun run serve 启动（dev/preview 无后端）';
  } finally {
    authBusy.value = false;
  }
}

function switchMode(): void {
  authMode.value = authMode.value === 'login' ? 'register' : 'login';
  authError.value = '';
}

function close(): void {
  emit('close');
}

// 点击遮罩关闭
function onOverlayClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) close();
}

checkAuth();
</script>

<template>
  <teleport to="body">
    <div v-if="visible" class="auth-modal-overlay" @click="onOverlayClick">
      <div class="auth-modal">
        <button class="auth-modal-close" @click="close">✕</button>

        <!-- 已登录状态 -->
        <div v-if="me" class="auth-modal-logged-in">
          <p class="auth-modal-greeting">👋 你好，{{ me.username }}</p>
          <p class="auth-modal-role">
            {{ me.role === 'admin' ? '管理员' : '成员' }}
          </p>
          <button class="auth-modal-confirm" @click="emit('success', me)">
            继续发布 →
          </button>
        </div>

        <!-- 未登录：登录/注册表单 -->
        <template v-else>
          <h2 class="auth-modal-title">{{ authMode === 'login' ? '登录' : '注册' }}</h2>
          <p class="auth-modal-hint">
            发布技能需要团队账户。
            {{ authMode === 'login' ? '还没有账户？' : '已有账户？' }}
            <a href="" @click.prevent="switchMode">
              {{ authMode === 'login' ? '去注册' : '去登录' }}
            </a>
            <span class="stat-sub">（首个注册用户自动成为管理员）</span>
          </p>
          <label class="pub-field">
            <span>用户名</span>
            <input
              v-model="authUser"
              placeholder="2-32 位，字母/数字/_/-"
              @keyup.enter="submitAuth"
            />
          </label>
          <label class="pub-field">
            <span>密码</span>
            <input
              v-model="authPass"
              type="password"
              placeholder="至少 6 位"
              @keyup.enter="submitAuth"
            />
          </label>
          <div v-if="authError" class="pub-result err">
            <p>✗ {{ authError }}</p>
          </div>
          <div class="pub-actions">
            <button
              class="pub-submit"
              :disabled="authBusy || !authUser || !authPass"
              @click="submitAuth"
            >
              {{ authBusy ? '提交中…' : (authMode === 'login' ? '登录' : '注册') }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
/* 遮罩层 */
.auth-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 弹窗主体 */
.auth-modal {
  position: relative;
  background: var(--vp-c-bg, #ffffff);
  border: 1px solid var(--vp-c-divider, #e2e8f0);
  border-radius: 12px;
  padding: 32px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  animation: slideUp 0.2s ease;
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* 关闭按钮 */
.auth-modal-close {
  position: absolute;
  top: 16px;
  right: 16px;
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--vp-c-text-3, #94a3b8);
  padding: 4px 8px;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
}

.auth-modal-close:hover {
  color: var(--vp-c-text-1, #0f172a);
  background: var(--vp-c-bg-soft, #f8fafc);
}

/* 标题 */
.auth-modal-title {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 600;
  color: var(--vp-c-text-1, #0f172a);
}

/* 提示文字 */
.auth-modal-hint {
  margin: 0 0 20px;
  font-size: 14px;
  color: var(--vp-c-text-2, #475569);
  line-height: 1.6;
}

.auth-modal-hint a {
  color: var(--vp-c-brand, #0ea5e9);
  text-decoration: none;
  font-weight: 500;
}

.auth-modal-hint a:hover {
  text-decoration: underline;
}

/* 已登录状态 */
.auth-modal-logged-in {
  text-align: center;
  padding: 16px 0;
}

.auth-modal-greeting {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 500;
  color: var(--vp-c-text-1, #0f172a);
}

.auth-modal-role {
  margin: 0 0 24px;
  font-size: 14px;
  color: var(--vp-c-text-2, #475569);
}

.auth-modal-confirm {
  background: var(--vp-c-brand, #0ea5e9);
  color: #fff;
  border: none;
  padding: 10px 24px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}

.auth-modal-confirm:hover {
  background: var(--vp-c-brand-dark, #0284c7);
  transform: translateY(-1px);
}

/* 复用 PublishForm 的表单样式 */
.pub-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}

.pub-field span {
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-text-2, #475569);
}

.pub-field input {
  padding: 10px 12px;
  border: 1px solid var(--vp-c-divider, #e2e8f0);
  border-radius: 8px;
  font-size: 14px;
  background: var(--vp-c-bg-soft, #f8fafc);
  color: var(--vp-c-text-1, #0f172a);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.pub-field input:focus {
  outline: none;
  border-color: var(--vp-c-brand, #0ea5e9);
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1);
}

.pub-field input::placeholder {
  color: var(--vp-c-text-3, #94a3b8);
}

.pub-actions {
  margin-top: 8px;
}

.pub-submit {
  width: 100%;
  padding: 12px 24px;
  background: var(--vp-c-brand, #0ea5e9);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}

.pub-submit:hover:not(:disabled) {
  background: var(--vp-c-brand-dark, #0284c7);
  transform: translateY(-1px);
}

.pub-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 错误提示 */
.pub-result {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
}

.pub-result.err {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #dc2626;
}

.pub-result.ok {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #16a34a;
}

/* 响应式 */
@media (max-width: 480px) {
  .auth-modal {
    padding: 24px;
    width: 95%;
  }
}
</style>
