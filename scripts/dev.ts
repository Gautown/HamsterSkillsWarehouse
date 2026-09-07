#!/usr/bin/env bun
/**
 * dev.ts — 开发组合器（bun run dev 唯一入口）
 *
 * 一个命令同时提供：
 *   1. vitepress dev（5173）—— 页面热更新，/api/* 反向代理到本机 API
 *   2. Bun API 服务（4310）—— 发布/登录/管理全套后端（API_ONLY 模式）
 *
 * 退出处理：Ctrl+C / 任一子进程退出 → 全组退出（不留孤儿进程）。
 */
import { $ } from 'bun';

const ROOT = import.meta.dir + '/..';

// ⓪ 前置：扫描 + 汇总 CSS（原 bun run dev 的前置链，dev 模式需要最新数据）
console.log('▸ 扫描技能库 + 汇总主题 CSS…');
await $`bun run scan`.cwd(ROOT).quiet();
await $`bun run collect-css`.cwd(ROOT).quiet();
console.log('  ✓ 数据就绪');

// ① API 后端（API_ONLY：不做静态服务，避免和 vitepress 端口语义混淆）
const api = Bun.spawn(['bun', 'run', 'scripts/server.ts'], {
  cwd: ROOT,
  env: { ...process.env, API_ONLY: '1', PORT: process.env.API_PORT || '4310' },
  stdout: 'inherit',
  stderr: 'inherit',
});
console.log('▸ API 服务启动中 → http://localhost:4310（仅 API）');

// ② vitepress dev（5173）—— proxy /api → 4310 由 vite.config 补充
//    vitepress 的 vite 选项在 .vitepress/config.ts 的 vite 字段，见该文件
const dev = Bun.spawn(['bun', 'x', 'vitepress', 'dev'], {
  cwd: ROOT,
  stdout: 'inherit',
  stderr: 'inherit',
});
console.log('▸ VitePress dev 启动中 → http://localhost:5173（/api 自动代理到 4310）');

// ③ 进程组管理：任一退出 → 杀另一个 + 全退
const killAll = () => {
  api.kill();
  dev.kill();
  process.exit(0);
};
const apiExited = api.exited.then(code => {
  if (code !== 0) {
    console.error(`✗ API 服务异常退出 (${code})`);
    killAll();
  }
});
dev.exited.then(code => {
  console.log(`vitepress dev 退出 (${code})`);
  killAll();
});
void apiExited;
process.on('SIGINT', killAll);  // Ctrl+C
process.on('SIGTERM', killAll);
