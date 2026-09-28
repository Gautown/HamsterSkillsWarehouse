#!/usr/bin/env bun
/**
 * server.ts — Skills Warehouse 站点服务（Bun 后端）
 *
 * 职责（一个进程）：
 *   1. POST /api/publish  发布技能（真后端核心）
 *        body: { category, name, description, tags?: string[], body: string,
 *                version?, author?, license? }
 *        流程: 校验 → 写 .custom-skills/<cat>/<name>/SKILL.md → 排队后台重建 → 202
 *        并发保护: 同名技能已存在 → 409
 *   2. PUT/DELETE /api/skills/:cat/:name   编辑 / 下架（同样 202 + 后台重建）
 *   3. GET  /api/rebuild/status            后台重建进度（前端轮询收尾）
 *   4. GET  /api/health                    存活探测
 *   5. GET  /*                             静态服务 .vitepress/dist/（站点+API 同端口）
 *
 * 运行：bun run serve（默认 4310，PORT 环境变量可改）
 *
 * 安全边界：
 *   - name/category 白名单字符校验（防路径穿越 ../）
 *   - 正文长度上限 512KB
 *   - build 是全量重建（幂等）：先构建到 dist-next，再切换进 dist（rename 优先，
 *     Windows 目录被监视器占用时自动退化为镜像覆盖同步），站点全程可用；
 *     构建失败按逆序回滚本批次写操作（站点与仓库始终一致）
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { type AuthUser, canManage, clearSessionCookie, getSession, issueSessionCookie, login, register, requireAuth, revokeSession } from './auth';
import { join, resolve, sep } from 'path';
import { $ } from 'bun';

const ROOT = resolve(import.meta.dir, '..');
const DIST = join(ROOT, '.vitepress/dist');
const CUSTOM_DIR = join(ROOT, '.custom-skills');
const DATA_JSON = join(ROOT, '.vitepress/skills-data.json'); // 已收录技能清单（发布查重用）
const PORT = Number(process.env.PORT || 4310);
/** API_ONLY=1 → 只起 API 不做静态服务（bun run dev 组合模式用，
 *  静态页面由 vitepress dev 的 5173 承载，/api 经 vite proxy 回本服务） */
const API_ONLY = process.env.API_ONLY === '1';
const MAX_BODY = 512 * 1024;

/** 发布字段白名单字符：小写字母/数字/连字符（name、category 用） */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** zip 解包后随表单提交的附件（与 skill-parse.ts 限额保持一致） */
interface AttachmentFile {
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';
}
const MAX_ATTACH_FILES = 100;
const MAX_ATTACH_FILE = 1024 * 1024;
const MAX_ATTACH_TOTAL = 5 * 1024 * 1024;

interface PublishPayload {
  category: string;
  name: string;
  description: string;
  body: string;
  tags?: string[];
  version?: string;
  author?: string;
  license?: string;
  /** 附件（.zip 解包后的额外文件；不传 = 不改动已有附件） */
  files?: AttachmentFile[];
  /** 发布者用户名（服务端从会话注入，前端提交被忽略） */
  publisher?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** 校验发布载荷，返回错误消息（null=通过） */
function validate(p: Partial<PublishPayload>): string | null {
  if (!p.category || !SLUG_RE.test(p.category)) return '分类名只能包含小写字母、数字、连字符';
  if (!p.name || !SLUG_RE.test(p.name)) return '技能名只能包含小写字母、数字、连字符';
  if (!p.description || p.description.trim().length < 5) return '描述至少 5 个字符';
  if (!p.body || p.body.trim().length < 10) return '正文至少 10 个字符';
  if (p.body.length > MAX_BODY) return `正文超过 ${MAX_BODY / 1024}KB 上限`;
  return null;
}

/** 校验附件清单（路径白名单防穿越 + 限额），返回错误消息（null=通过）
 *  规则与前端 skill-parse.ts invalidAttachmentPath 完全一致 */
function validateAttachments(files: unknown): string | null {
  if (!Array.isArray(files)) return 'files 必须是数组';
  if (files.length > MAX_ATTACH_FILES) return `附件数量超过 ${MAX_ATTACH_FILES} 个上限`;
  const seen = new Set<string>();
  let total = 0;
  for (const f of files as AttachmentFile[]) {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') {
      return '附件项必须包含 path 与 content';
    }
    const path = f.path;
    if (!path || path.length > 200) return '附件路径为空或过长';
    if (path.includes('\\') || path.startsWith('/')) return `附件路径不合法: ${path}`;
    for (const seg of path.split('/')) {
      if (!seg || seg === '.' || seg === '..') return `附件路径不合法: ${path}`;
      if (!/^[a-zA-Z0-9._-]+$/.test(seg)) return `附件路径含非法字符: ${path}`;
      if (seg.toLowerCase() === 'skill.md') return 'SKILL.md 由正文字段承载，不作为附件';
    }
    // 根级 index.html 会遮蔽详情页（serveStatic 目录 index 探测优先于 cleanUrls 页面）
    if (path.toLowerCase() === 'index.html' || path.toLowerCase() === 'index.htm') {
      return '附件不能是根级 index.html（会遮蔽技能详情页）';
    }
    if (seen.has(path)) return `附件路径重复: ${path}`;
    seen.add(path);
    if (f.encoding && f.encoding !== 'utf8' && f.encoding !== 'base64') {
      return `附件 ${path} 编码不支持: ${String(f.encoding)}`;
    }
    // 估算解码后大小：base64 每 4 字符 ≈ 3 字节；utf8 按 UTF-8 字节数
    const bytes = f.encoding === 'base64'
      ? Math.floor(f.content.length * 3 / 4)
      : Buffer.byteLength(f.content, 'utf8');
    if (bytes > MAX_ATTACH_FILE) return `附件 ${path} 超过 1MB 单文件上限`;
    total += bytes;
    if (total > MAX_ATTACH_TOTAL) return `附件总大小超过 ${MAX_ATTACH_TOTAL / 1024 / 1024}MB 上限`;
  }
  return null;
}

/** 解码附件内容（base64 解码失败返回 null） */
function decodeAttachment(f: AttachmentFile): Buffer | null {
  if (f.encoding === 'base64') {
    const buf = Buffer.from(f.content, 'base64');
    // Buffer.from 对非法 base64 是宽松解析，做一次回环粗校验
    if (!buf.length && f.content.length) return null;
    return buf;
  }
  return Buffer.from(f.content, 'utf8');
}

/** 写附件到技能目录（逐个路径段 mkdir，防深嵌套路径不存在） */
function writeAttachments(skillDir: string, files: AttachmentFile[]): string | null {
  for (const f of files) {
    const buf = decodeAttachment(f);
    if (!buf) return `附件 ${f.path} 内容解码失败`;
    const target = join(skillDir, ...f.path.split('/'));
    // 双保险：即便校验被绕过，resolve 后必须仍在技能目录内
    if (!resolve(target).startsWith(resolve(skillDir) + sep)) {
      return `附件路径越界: ${f.path}`;
    }
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, buf);
  }
  return null;
}

/** 列出技能目录内的附件（相对路径 + 字节数，不含根级 SKILL.md） */
function listAttachments(skillDir: string): Array<{ path: string; size: number }> {
  const out: Array<{ path: string; size: number }> = [];
  const walk = (dir: string, prefix: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), rel);
      else if (rel.toLowerCase() !== 'skill.md') {
        out.push({ path: rel, size: statSync(join(dir, e.name)).size });
      }
    }
  };
  if (existsSync(skillDir)) walk(skillDir, '');
  return out;
}

/** SKILL.md 渲染（frontmatter + 正文）
 *  publisher: 发布者用户名（由会话注入，不由表单传——防伪造） */
function renderSkillMd(p: PublishPayload, publisher?: string): string {
  const fm: string[] = [
    '---',
    `name: ${p.name}`,
    `description: ${JSON.stringify(p.description.trim())}`,
  ];
  if (publisher) fm.push(`publisher: ${JSON.stringify(publisher)}`);
  if (p.version) fm.push(`version: ${JSON.stringify(p.version.trim())}`);
  if (p.author) fm.push(`author: ${JSON.stringify(p.author.trim())}`);
  if (p.license) fm.push(`license: ${JSON.stringify(p.license.trim())}`);
  const tags = (p.tags ?? [])
    .map(t => t.trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean);
  if (tags.length) {
    fm.push('metadata:');
    fm.push('  hermes:');
    fm.push(`    tags: [${tags.join(', ')}]`);
  }
  fm.push('---', '');
  return fm.join('\n') + '\n' + p.body.trim() + '\n';
}

// ===== 后台重建：构建到暂存目录 + 原子切换 =====
// 为什么不再直接 build 到 dist：VitePress build 会先清空 outDir，站点在构建的
// ~25s 内会大面积 404（实测 /tags/、/publish/、技能页同时 404），而且发布请求会被
// 阻塞到构建结束。现在：build → .vitepress/dist-next（线上 dist 全程可用）
// → rename 切换（毫秒级）→ 接口立即返回 202，前端轮询 /api/rebuild/status 收尾。
const DIST_NEXT = join(ROOT, '.vitepress/dist-next');
const DIST_PREV = join(ROOT, '.vitepress/dist-prev');

interface RebuildState {
  /** 是否有构建在跑 */
  building: boolean;
  /** 构建期间又来了写请求 → 本轮结束后合并再跑一轮 */
  queued: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  runs: number;
}
const buildState: RebuildState = {
  building: false, queued: false, startedAt: null, finishedAt: null,
  lastDurationMs: null, lastError: null, runs: 0,
};

/** 本批次待回滚的写操作（构建失败时按逆序执行，保证站点与仓库一致） */
interface Undo { label: string; run: () => void }
let pendings: Undo[] = [];

/** 构建到 dist-next（全程不碰线上 dist） */
async function buildToStaging(): Promise<void> {
  const proc = Bun.spawn(['bun', 'run', 'build'], {
    cwd: ROOT,
    env: { ...process.env, SW_OUT_DIR: '.vitepress/dist-next' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`build 失败(exit ${code}):\n${stderr.slice(-1500) || stdout.slice(-1500)}`);
  }
  if (!existsSync(join(DIST_NEXT, 'index.html'))) {
    throw new Error('build 退出码为 0，但没有产出 dist-next/index.html');
  }
}

/** 递归镜像同步 src → dst（只新增/覆盖，不删除；返回 {copied, skipped}）
 *  单文件覆盖被拒时退化为"先删再写"，仍失败则跳过（保留旧副本，站点不空窗） */
function mirrorSyncDir(src: string, dst: string): { copied: number; skipped: string[] } {
  let copied = 0;
  const skipped: string[] = [];
  const walk = (s: string, d: string): void => {
    mkdirSync(d, { recursive: true });
    for (const e of readdirSync(s, { withFileTypes: true })) {
      const sPath = join(s, e.name);
      const dPath = join(d, e.name);
      if (e.isDirectory()) { walk(sPath, dPath); continue; }
      try {
        copyFileSync(sPath, dPath);
        copied++;
      } catch {
        try {
          rmSync(dPath, { force: true });
          copyFileSync(sPath, dPath);
          copied++;
        } catch {
          skipped.push(sPath.slice(dst.length + 1));
        }
      }
    }
  };
  walk(src, dst);
  return { copied, skipped };
}

/** 删除 dst 中 src 里已不存在的文件（仅在全程无跳过时调用，语义等价于整目录替换）
 *  目录清空后顺手删目录，删不掉（被监视器占用）就留着——空目录不影响路由 */
function pruneOrphans(src: string, dst: string): number {
  let removed = 0;
  const walk = (d: string, rel: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      const target = join(d, e.name);
      if (e.isDirectory()) {
        walk(target, relPath);
        try { if (readdirSync(target).length === 0) rmSync(target, { recursive: true, force: true }); } catch { /* 被占用 */ }
        continue;
      }
      if (existsSync(join(src, ...relPath.split('/')))) continue;
      try { rmSync(target, { force: true }); removed++; } catch { /* 被占用：保留旧文件不影响新页面 */ }
    }
  };
  if (existsSync(dst)) walk(dst, '');
  return removed;
}

/** 移动目录 src → dst：rename 优先；Windows 监视器占用目录句柄导致 EPERM 时，
 *  退化为"复制 + 删除"（语义等价于移动，站点/仓库始终一致）。
 *  复制中途失败必须清理半成品 dst 并抛出——src 保持原样，调用方据此判定移动失败。 */
function moveDirSync(src: string, dst: string): void {
  try {
    renameSync(src, dst);
    return;
  } catch (e) {
    console.warn(`▸ 目录 rename 被拒（${(e as Error).message}）→ 改用复制+删除移动`);
  }
  try {
    const walk = (s: string, d: string): void => {
      mkdirSync(d, { recursive: true });
      for (const ent of readdirSync(s, { withFileTypes: true })) {
        const sPath = join(s, ent.name);
        const dPath = join(d, ent.name);
        if (ent.isDirectory()) walk(sPath, dPath);
        else copyFileSync(sPath, dPath);
      }
    };
    walk(src, dst);
  } catch (e) {
    rmSync(dst, { recursive: true, force: true }); // 清掉半成品，避免暂存区残留脏数据
    throw e;
  }
  rmSync(src, { recursive: true, force: true });
}

/** 切换产物 dist-next → dist。
 *  首选 rename 原子切换（毫秒级窗口）。但 Windows 上只要工作区被 IDE / 编辑器 / 杀软
 *  挂了文件监视（VS Code 默认监视整个工作区，句柄不带 FILE_SHARE_DELETE），目录级
 *  rename 就一律被拒（实测 EPERM：连新建的空目录都改不了名，而文件读写与递归删除正常），
 *  此时退化为"镜像覆盖同步"：逐文件覆盖（站点全程可用）→ 全程无跳过才清理孤儿文件。
 *  rename 半途失败必须先把 dist 还原回去，绝不留空窗。 */
function swapDist(): void {
  rmSync(DIST_PREV, { recursive: true, force: true });
  let renameErr: string | null = null;
  if (existsSync(DIST)) {
    try {
      renameSync(DIST, DIST_PREV);
      try {
        renameSync(DIST_NEXT, DIST);
        rmSync(DIST_PREV, { recursive: true, force: true });
        return;
      } catch (e) {
        renameSync(DIST_PREV, DIST); // 线上产物先归位，再走兜底同步
        renameErr = (e as Error).message;
      }
    } catch (e) {
      renameErr = (e as Error).message;
    }
  } else {
    try { renameSync(DIST_NEXT, DIST); return; } catch (e) { renameErr = (e as Error).message; }
  }
  console.warn(`▸ 产物目录 rename 被拒（${renameErr}）→ 改用镜像覆盖同步（Windows 监视器占用常见，非致命）`);
  const { copied, skipped } = mirrorSyncDir(DIST_NEXT, DIST);
  let removed = 0;
  if (skipped.length === 0) {
    removed = pruneOrphans(DIST_NEXT, DIST);
  } else {
    console.warn(`  ${skipped.length} 个文件被占用未覆盖 → 本轮跳过孤儿清理（避免旧页面引用失效）`);
  }
  console.log(`  镜像同步完成：覆盖 ${copied} 个文件，清理 ${removed} 个孤儿`);
  if (skipped.length) console.warn(`  未覆盖: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ' …' : ''}`);
}


/** 调度重建（立即返回）；构建期间的写请求合并进下一轮 */
function scheduleRebuild(): void {
  if (buildState.building) {
    buildState.queued = true;
    console.log('▸ 已有重建在进行 → 本次写入排队合并到下一轮');
    return;
  }
  void runRebuildLoop();
}

async function runRebuildLoop(): Promise<void> {
  do {
    const batch = pendings;
    pendings = [];
    buildState.queued = false;
    buildState.building = true;
    buildState.startedAt = Date.now();
    buildState.lastError = null;
    console.log(`▸ 后台重建开始（本批 ${batch.length} 项写入）…`);
    try {
      await buildToStaging();
      swapDist();
      // 本批次已生效 → 清掉下架暂存（构建失败时它是回滚源，不能提前删）
      rmSync(join(CUSTOM_DIR, '.stash'), { recursive: true, force: true });
      console.log(`✓ 后台重建完成并已切换产物（${buildState.runs + 1} 次）`);
    } catch (e) {
      let msg = (e as Error).message;
      const rolled: string[] = [];
      for (const u of batch.reverse()) {
        try { u.run(); rolled.push(u.label); } catch { rolled.push(`${u.label}(回滚失败)`); }
      }
      if (rolled.length) msg += `\n已回滚: ${rolled.join('、')}`;
      buildState.lastError = msg;
      console.error(`✗ 后台重建失败：\n${msg}`);
    } finally {
      buildState.finishedAt = Date.now();
      buildState.lastDurationMs = buildState.finishedAt - (buildState.startedAt ?? buildState.finishedAt);
      buildState.building = false;
      buildState.runs += 1;
    }
  } while (buildState.queued);
}

/** 写操作受理回执（202）：重建在后台跑，前端轮询 /api/rebuild/status 收尾 */
function accepted(message: string, pageUrl: string, extra: Record<string, unknown> = {}): Response {
  return json({
    ok: true,
    queued: true,
    message: `${message} —— 正在后台重建站点（约 30s，完成后自动生效）`,
    pageUrl,
    rebuildStatus: '/api/rebuild/status',
    ...extra,
  }, 202);
}

async function handlePublish(req: Request, user: AuthUser): Promise<Response> {
  let payload: Partial<PublishPayload>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: '请求体必须是 JSON' }, 400);
  }
  const err = validate(payload);
  if (err) return json({ ok: false, error: err }, 400);
  if (payload.files !== undefined) {
    const ferr = validateAttachments(payload.files);
    if (ferr) return json({ ok: false, error: ferr }, 400);
  }

  const { category, name } = payload as PublishPayload;
  const skillDir = join(CUSTOM_DIR, category, name);
  const skillMd = join(skillDir, 'SKILL.md');
  const pageUrl = `/skills/${category}/${name}/`;

  if (existsSync(skillMd)) {
    return json({ ok: false, error: `技能 ${category}/${name} 已存在（站内发布库）`, pageUrl }, 409);
  }

  // 查重范围扩大到已收录技能（演示库 demo-skills/ + 已发布）——
  // 否则发布与本地同名的技能会"成功"但被合并去重遮蔽，静默失败
  try {
    const data = JSON.parse(readFileSync(DATA_JSON, 'utf-8')) as {
      categories: Array<{ name: string; skills: Array<{ name: string; source?: string }> }>;
    };
    const cat = data.categories.find(c => c.name === category);
    const conflict = cat?.skills.find(s => s.name === name);
    if (conflict) {
      const src = conflict.source === 'custom' ? '站内已发布' : '演示技能库';
      return json({ ok: false, error: `技能 ${category}/${name} 已存在于${src}，换个名字或分类`, pageUrl }, 409);
    }
  } catch {
    // skills-data.json 读不到不阻塞发布（降级为仅查站内库重名）
  }

  // 落盘 → 排队后台重建（接口立即返回；构建失败由后台按逆序回滚本批次写入）
  // publisher = 当前登录用户（会话注入，表单 author 字段仅作展示别名）
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillMd, renderSkillMd(payload as PublishPayload, user.username), 'utf-8');
  if (payload.files?.length) {
    const werr = writeAttachments(skillDir, payload.files);
    if (werr) {
      // 落盘失败 → 立即清理半成品目录（尚未进重建批次）
      rmSync(skillDir, { recursive: true, force: true });
      return json({ ok: false, error: werr }, 400);
    }
  }
  pendings.push({ label: `删除 ${category}/${name}`, run: () => rmSync(skillDir, { recursive: true, force: true }) });
  scheduleRebuild();
  return accepted(`技能 ${name} 已发布到分类 ${category}`, pageUrl, {
    skillMd: `.custom-skills/${category}/${name}/SKILL.md`,
    files: payload.files?.length ?? 0,
  });
}

/** 静态文件服务（dist/；cleanUrls 三段探测） */
function serveStatic(pathname: string): Response {
  // cleanUrls 探测顺序：
  //   /skills/creative/    → skills/creative/index.html（目录页）
  //   /skills/c/a-diagram  → skills/c/a-diagram.html（详情页，带不带尾斜杠同）
  const p = pathname.replace(/\/+$/, '') || '/index.html';
  const base = p === '/index.html' ? '' : p;
  const candidates = [
    join(DIST, base, 'index.html'),   // 目录页
    join(DIST, base + '.html'),       // cleanUrls 详情页
    join(DIST, p),                     // 静态资源原样
  ];
  let file: string | null = null;
  for (const c of candidates) {
    if (existsSync(c)) { file = c; break; }
  }
  if (!file) {
    // 未命中 → dist 的 404.html 美化页（存在时），否则纯文本
    const notFound = join(DIST, '404.html');
    if (existsSync(notFound)) {
      const content = readFileSync(notFound) as Buffer;
      return new Response(new Uint8Array(content), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response('Not Found', { status: 404 });
  }
  // 简单 MIME 推断
  const ext = file.split('.').pop() ?? '';
  const mime: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    woff2: 'font/woff2',
    txt: 'text/plain; charset=utf-8',
  };
  const headers: Record<string, string> = {
    'content-type': mime[ext] ?? 'application/octet-stream',
  };
  if (ext === 'js' || ext === 'css' || ext === 'woff2') {
    headers['cache-control'] = 'public, max-age=31536000, immutable'; // 带内容哈希
  }
  // 注意: Bun Windows 1.3.x 下 new Response(Bun.file()) body 为空，改 readFileSync
  try {
    const content = readFileSync(file) as Buffer;
    return new Response(new Uint8Array(content), { headers });
  } catch {
    // 产物原子切换（dist → dist-prev）的瞬间，可能"探测到但读不到" → 按 404 兜底
    return new Response('Not Found', { status: 404 });
  }
}

/** 读取站内发布技能详情（frontmatter 解析回表单字段） */
function readCustomSkill(category: string, name: string): PublishPayload | null {
  const mdPath = join(CUSTOM_DIR, category, name, 'SKILL.md');
  if (!existsSync(mdPath)) return null;
  const md = readFileSync(mdPath, 'utf-8');
  // 拆 frontmatter / 正文
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return null;
  const [, fm, body] = fmMatch;
  const unquote = (v: string) => v.trim().replace(/^"(.*)"$/s, '$1');
  const get = (key: string): string | undefined => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? unquote(m[1]) : undefined;
  };
  // tags 在 metadata.hermes 下（缩进书写），正则允许前导空白
  const tagsM = fm.match(/^[ \t]*tags:[ \t]*\[(.*)\]$/m);
  return {
    category, name,
    description: get('description') ?? '',
    body: body.trim(),
    version: get('version'),
    author: get('author'),
    license: get('license'),
    publisher: get('publisher'),
    tags: tagsM ? tagsM[1].split(',').map(t => t.trim()).filter(Boolean) : [],
  };
}

/** 编辑站内发布技能：覆写 SKILL.md（可选全量替换附件）+ 重建；失败整目录快照回滚 */
async function handleEdit(category: string, name: string, req: Request, user: AuthUser): Promise<Response> {
  let payload: Partial<PublishPayload>;
  try { payload = await req.json(); } catch {
    return json({ ok: false, error: '请求体必须是 JSON' }, 400);
  }
  // 编辑不改 category/name（改了等于新技能，走发布）——从 URL 取
  const merged: PublishPayload = {
    category, name,
    description: String(payload.description ?? ''),
    body: String(payload.body ?? ''),
    tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
    version: payload.version ? String(payload.version) : undefined,
    author: payload.author ? String(payload.author) : undefined,
    license: payload.license ? String(payload.license) : undefined,
  };
  const err = validate(merged);
  if (err) return json({ ok: false, error: err }, 400);
  // files 语义：undefined = 附件不动；数组 = 全量替换（可为空数组 = 清空附件）
  if (payload.files !== undefined) {
    const ferr = validateAttachments(payload.files);
    if (ferr) return json({ ok: false, error: ferr }, 400);
  }

  const skillMd = join(CUSTOM_DIR, category, name, 'SKILL.md');
  if (!existsSync(skillMd)) {
    return json({ ok: false, error: `技能 ${category}/${name} 不在站内发布库（编辑只支持已发布技能）` }, 404);
  }
  // 权限：仅发布者本人或 admin 可编辑
  const detail = readCustomSkill(category, name);
  if (!canManage(user, detail?.publisher)) {
    return json({ ok: false, error: '只有发布者本人或管理员可以编辑该技能' }, 403);
  }
  // 编辑保留原 publisher（归属不变）
  merged.publisher = detail?.publisher;

  // 回滚保险：只改正文 → 原文留内存（快路径）；动了附件 → 整目录快照
  // （附件替换会删改多个文件，单文件原文不够；快照 ≤ 附件 5MB + 正文 512KB，内存可承受）
  const skillDir = join(CUSTOM_DIR, category, name);
  const replaceFiles = payload.files;
  const original = readFileSync(skillMd, 'utf-8');
  let snapshot: Map<string, Buffer> | null = null;
  if (replaceFiles !== undefined) {
    snapshot = new Map<string, Buffer>();
    const walk = (dir: string, prefix: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(dir, e.name), rel);
        else snapshot!.set(rel, readFileSync(join(dir, e.name)));
      }
    };
    walk(skillDir, '');
    // 全量替换：清空目录里除 SKILL.md 外的旧附件，再写新附件
    for (const rel of snapshot.keys()) {
      if (rel.toLowerCase() !== 'skill.md') rmSync(join(skillDir, ...rel.split('/')), { force: true });
    }
    if (replaceFiles.length) {
      const werr = writeAttachments(skillDir, replaceFiles);
      if (werr) {
        // 写失败 → 立即从快照还原（本请求内，不等后台构建）
        rmSync(skillDir, { recursive: true, force: true });
        mkdirSync(skillDir, { recursive: true });
        for (const [rel, buf] of snapshot) {
          const target = join(skillDir, ...rel.split('/'));
          mkdirSync(join(target, '..'), { recursive: true });
          writeFileSync(target, buf);
        }
        return json({ ok: false, error: werr }, 400);
      }
    }
  }
  writeFileSync(skillMd, renderSkillMd(merged, detail?.publisher), 'utf-8');
  if (snapshot) {
    pendings.push({
      label: `还原 ${category}/${name}`,
      run: () => {
        // 整目录删除后按快照重建：新增但不在快照里的文件也会被清掉
        rmSync(skillDir, { recursive: true, force: true });
        mkdirSync(skillDir, { recursive: true });
        for (const [rel, buf] of snapshot!) {
          const target = join(skillDir, ...rel.split('/'));
          mkdirSync(join(target, '..'), { recursive: true });
          writeFileSync(target, buf);
        }
      },
    });
  } else {
    pendings.push({ label: `还原 ${category}/${name}`, run: () => writeFileSync(skillMd, original, 'utf-8') });
  }
  scheduleRebuild();
  return accepted(`技能 ${name} 已更新`, `/skills/${category}/${name}/`, {
    files: listAttachments(skillDir).length,
  });
}

/** 下架站内发布的技能：删除 .custom-skills/<cat>/<name>/ + 重建；失败回滚（改名暂存） */
async function handleUnpublish(category: string, name: string, user: AuthUser): Promise<Response> {
  if (!SLUG_RE.test(category) || !SLUG_RE.test(name)) {
    return json({ ok: false, error: '分类/技能名字符不合法' }, 400);
  }
  // 只允许下架站内发布的技能（本地库技能不提供站点删除，防误删）
  // —— 数据源检查必须在目录存在性检查之前，本地技能才能得到 403 提示
  try {
    const data = JSON.parse(readFileSync(DATA_JSON, 'utf-8')) as {
      categories: Array<{ name: string; skills: Array<{ name: string; source?: string }> }>;
    };
    const entry = data.categories.find(c => c.name === category)?.skills.find(s => s.name === name);
    if (entry && entry.source !== 'custom') {
      return json({ ok: false, error: '只能下架站内发布的技能，演示库技能请到 demo-skills/ 管理' }, 403);
    }
  } catch { /* 数据读不到时退化为仅按目录存在判断 */ }

  // 权限：仅发布者本人或 admin 可下架（读 frontmatter publisher）
  const detail = readCustomSkill(category, name);
  if (detail && !canManage(user, detail.publisher)) {
    return json({ ok: false, error: '只有发布者本人或管理员可以下架该技能' }, 403);
  }

  const skillDir = join(CUSTOM_DIR, category, name);
  if (!existsSync(skillDir)) {
    return json({ ok: false, error: `技能 ${category}/${name} 不在站内发布库` }, 404);
  }

  // 回滚保险：先改名挪进点前缀隐藏暂存区（扫描器/列表 API 都跳过 . 开头目录），
  // 构建失败由后台挪回；直接留在树内会被 rebuild 扫成新技能（实测踩坑）
  const STASH_ROOT = join(CUSTOM_DIR, '.stash');
  const stash = join(STASH_ROOT, `${category}__${name}`);
  const catDir = join(CUSTOM_DIR, category);
  rmSync(stash, { recursive: true, force: true });
  mkdirSync(STASH_ROOT, { recursive: true });
  moveDirSync(skillDir, stash);
  // 空分类目录顺手清理（回滚时会重新建出来）
  try {
    if (readdirSync(catDir).length === 0) rmSync(catDir, { recursive: true, force: true });
  } catch { /* 目录不存在/非空都无所谓 */ }
  pendings.push({
    label: `恢复 ${category}/${name}`,
    run: () => {
      mkdirSync(catDir, { recursive: true });
      moveDirSync(stash, skillDir);
    },
  });
  scheduleRebuild();
  return accepted(`技能 ${name} 已下架`, '/skills/', { category, name });
}

/** 路由分发（fetch 的 try/catch 兜底调用它；异常统一转结构化 JSON） */
async function route(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (req.method === 'POST' && pathname === '/api/publish') {
    const user = requireAuth(req);
    if (user instanceof Response) return user;
    return handlePublish(req, user);
  }
  // /api/skills/:cat/:name — GET 详情 / PUT 编辑 / DELETE 下架
  const skillMatch = pathname.match(/^\/api\/skills\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
  if (skillMatch) {
    const [, cat, name] = skillMatch;
    if (req.method === 'DELETE') {
      const user = requireAuth(req);
      if (user instanceof Response) return user;
      return handleUnpublish(cat, name, user);
    }
    if (req.method === 'PUT') {
      const user = requireAuth(req);
      if (user instanceof Response) return user;
      return handleEdit(cat, name, req, user);
    }
    if (req.method === 'GET') {
      const detail = readCustomSkill(cat, name);
      if (!detail) return json({ ok: false, error: `技能 ${cat}/${name} 不在站内发布库` }, 404);
      // 附件清单（仅路径+大小；编辑提交时 files 不传 = 附件保持不动）
      const files = listAttachments(join(CUSTOM_DIR, cat, name));
      return json({ ok: true, skill: { ...detail, fileList: files, fileCount: files.length } });
    }
    return json({ ok: false, error: '不支持的请求' }, 405);
  }
  // ===== auth =====
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    let body: { username?: string; password?: string };
    try { body = await req.json(); } catch { return json({ ok: false, error: '请求体必须是 JSON' }, 400); }
    const r = await login(String(body.username ?? ''), String(body.password ?? ''));
    if (!r.ok) return json({ ok: false, error: r.error }, 401);
    return new Response(JSON.stringify({ ok: true, user: { username: r.user.username, role: r.user.role } }), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': issueSessionCookie(r.user) },
    });
  }
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    let body: { username?: string; password?: string };
    try { body = await req.json(); } catch { return json({ ok: false, error: '请求体必须是 JSON' }, 400); }
    const r = await register(String(body.username ?? ''), String(body.password ?? ''));
    if (!r.ok) return json({ ok: false, error: r.error }, 400);
    return new Response(JSON.stringify({ ok: true, user: { username: r.user.username, role: r.user.role }, message: '注册成功，已自动登录' }), {
      status: 201,
      headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': issueSessionCookie(r.user) },
    });
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    revokeSession(req); // 服务端作废该 token（无状态会话的登出补偿）
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': clearSessionCookie() },
    });
  }
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = getSession(req);
    if (!user) return json({ ok: false, error: '未登录' }, 401);
    return json({ ok: true, user: { username: user.username, role: user.role } });
  }
  // GET /api/rebuild/status — 后台重建进度（发布/编辑/下架返回 202 后前端轮询收尾）
  if (req.method === 'GET' && pathname === '/api/rebuild/status') {
    return json({ ok: true, ...buildState, pendingOps: pendings.map(p => p.label) });
  }
  if (req.method === 'GET' && pathname === '/api/health') {
    return json({ ok: true, dist: existsSync(DIST), ts: Date.now() });
  }
  // GET /api/custom-skills — 已发布技能清单（管理列表用）
  if (req.method === 'GET' && pathname === '/api/custom-skills') {
    const out: Array<{ category: string; name: string; description?: string; tags?: string[] }> = [];
    if (existsSync(CUSTOM_DIR)) {
      for (const c of readdirSync(CUSTOM_DIR, { withFileTypes: true })) {
        if (!c.isDirectory() || c.name.startsWith('.')) continue;
        const catDir = join(CUSTOM_DIR, c.name);
        for (const s of readdirSync(catDir, { withFileTypes: true })) {
          if (!s.isDirectory() || s.name.startsWith('.')) continue;
          // 读 frontmatter description（只解析首屏，不引重依赖）
          const mdPath = join(catDir, s.name, 'SKILL.md');
          let description: string | undefined;
          try {
            const md = readFileSync(mdPath, 'utf-8');
            const m = md.match(/^description:\s*"?([^"\n]+)"?\s*$/m);
            if (m) description = m[1].trim();
          } catch { /* 无 SKILL.md 跳过 */ }
          out.push({ category: c.name, name: s.name, description });
        }
      }
    }
    return json({ ok: true, skills: out });
  }
  // dev 组合模式下静态资源交给 vitepress dev（5173），这里只答 API
  if (req.method === 'GET' && !API_ONLY) return serveStatic(pathname);
  if (req.method === 'GET' && API_ONLY) return json({ ok: false, error: 'dev 模式请走 5173 端口访问站点' }, 404);
  return json({ ok: false, error: '不支持的请求' }, 405);
}

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    port: PORT,
  // 重建已改为后台异步（写接口不再等待构建），这里无需容忍长任务；
  // 保留 30s 只为慢磁盘/大文件留余量（Bun 默认 10s）
  idleTimeout: 30,
  async fetch(req): Promise<Response> {
    try {
      return await route(req);
    } catch (e) {
      // 兜底：任何未捕获异常（如 Windows 目录锁导致移动/写入失败）都返回结构化 JSON，
      // 而不是裸 500 —— 前端能展示可读错误，日志保留完整堆栈便于排查
      console.error(`✗ 请求处理异常 ${req.method} ${new URL(req.url).pathname}:\n${(e as Error).stack ?? e}`);
      return json({ ok: false, error: `服务端处理失败：${(e as Error).message}` }, 500);
    }
  },
  });
} catch (e) {
  if ((e as Error & { code?: string }).code === 'EADDRINUSE') {
    console.error(`✗ 端口 ${PORT} 已被占用 —— 可能已有一个 serve 在跑。`);
    console.error(`  排查: netstat -ano | findstr :${PORT}  然后 taskkill /PID <pid> /F`);
    console.error(`  或换端口启动: PORT=${PORT + 1} bun run serve`);
    process.exit(1);
  }
  throw e;
}

console.log(`✓ Skills Warehouse 服务: http://localhost:${server.port}`);
console.log(`  认证:   POST /api/auth/register|login|logout · GET /api/auth/me（首个注册用户=admin）`);
console.log(`  POST   /api/publish           发布技能（需登录，publisher 自动记录）`);
console.log(`  DELETE /api/skills/:cat/:name 下架（发布者本人或 admin）`);
console.log(`  PUT    /api/skills/:cat/:name 编辑（发布者本人或 admin）`);
console.log(`  GET    /api/custom-skills     已发布技能清单`);
console.log(`  GET    /api/rebuild/status    后台重建进度（写接口返回 202 后轮询它收尾）`);
console.log(`  GET    /*                     静态站点（.vitepress/dist）`);
