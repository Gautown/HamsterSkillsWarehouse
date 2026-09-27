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

/** 探测可用端口：默认 4310，若被其他应用（如后台进程、QQ 等）占用则顺延 */
function findAvailablePort(start = 4310, max = 4330): number {
  for (let p = start; p <= max; p++) {
    try {
      const s = Bun.serve({ port: p, fetch() { return new Response(); } });
      s.stop(true);
      return p;
    } catch (e) {
      if ((e as Error & { code?: string }).code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error(`在 [${start}, ${max}] 区间内未找到可用端口`);
}

const customPort = process.env.API_PORT || process.env.PORT;
const apiPort = customPort ? Number(customPort) : findAvailablePort(4310);
if (!customPort && apiPort !== 4310) {
  console.log(`ℹ 默认端口 4310 已被占用，开发 API 自动切换至可用端口 ${apiPort}`);
}

// 将最终选定的 API_PORT 同步到环境变量，供 scan-skills.ts 生成 config.ts 中的 proxy 以及 vitepress dev 消费
process.env.API_PORT = String(apiPort);

// ⓪ 前置：扫描技能库（生成 skills-data.json + config.ts + skills//tags/ 页面）
console.log('▸ 扫描技能库…');
await $`bun run scan`.cwd(ROOT).env(process.env).quiet();
console.log('  ✓ 数据就绪（config.ts / skills-data.json / 页面已重建）');

// ① API 后端（API_ONLY：不做静态服务，避免和 vitepress 端口语义混淆）
const api = Bun.spawn(['bun', 'run', 'scripts/server.ts'], {
  cwd: ROOT,
  env: { ...process.env, API_ONLY: '1', PORT: String(apiPort) },
  stdout: 'inherit',
  stderr: 'inherit',
});
console.log(`▸ API 服务启动中 → http://localhost:${apiPort}（仅 API）`);

// ② vitepress dev（5173）—— proxy /api → apiPort 由 vite.config 补充
//    vitepress 的 vite 选项在 .vitepress/config.ts 的 vite 字段，见该文件
const dev = Bun.spawn(['bun', 'x', 'vitepress', 'dev'], {
  cwd: ROOT,
  env: process.env,
  stdout: 'inherit',
  stderr: 'inherit',
});
console.log(`▸ VitePress dev 启动中 → http://localhost:5173（/api 自动代理到 ${apiPort}）`);

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
