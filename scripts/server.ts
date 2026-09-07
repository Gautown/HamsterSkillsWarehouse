#!/usr/bin/env bun
/**
 * server.ts — Skills Warehouse 站点服务（Bun 后端）
 *
 * 职责（一个进程）：
 *   1. POST /api/publish  发布技能（真后端核心）
 *        body: { category, name, description, tags?: string[], body: string,
 *                version?, author?, license? }
 *        流程: 校验 → 写 .custom-skills/<cat>/<name>/SKILL.md → scan+build → 返回新页 URL
 *        并发保护: 同名技能已存在 → 409
 *   2. GET  /api/health   存活探测
 *   3. GET  /*            静态服务 .vitepress/dist/（生产形态：站点+API 同端口）
 *
 * 运行：bun run serve（默认 4310，PORT 环境变量可改）
 *
 * 安全边界：
 *   - name/category 白名单字符校验（防路径穿越 ../）
 *   - 正文长度上限 512KB
 *   - build 是全量重建（幂等），失败自动回滚已写入文件
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { type AuthUser, canManage, clearSessionCookie, getSession, issueSessionCookie, login, register, requireAuth, revokeSession } from './auth';
import { join, resolve } from 'path';
import { $ } from 'bun';

const ROOT = resolve(import.meta.dir, '..');
const DIST = join(ROOT, '.vitepress/dist');
const CUSTOM_DIR = join(ROOT, '.custom-skills');
const DATA_JSON = join(ROOT, '.vitepress/skills-data.json'); // 已收录技能清单（发布查重用）
const PORT = Number(process.env.PORT || 4310);
const MAX_BODY = 512 * 1024;

/** 发布字段白名单字符：小写字母/数字/连字符（name、category 用） */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

interface PublishPayload {
  category: string;
  name: string;
  description: string;
  body: string;
  tags?: string[];
  version?: string;
  author?: string;
  license?: string;
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

/** 重建站点（scan + collect-css + vitepress build）；失败时抛出带 stderr 的错误 */
async function rebuild(): Promise<void> {
  const proc = Bun.spawn(['bun', 'run', 'build'], {
    cwd: ROOT,
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

  const { category, name } = payload as PublishPayload;
  const skillDir = join(CUSTOM_DIR, category, name);
  const skillMd = join(skillDir, 'SKILL.md');
  const pageUrl = `/skills/${category}/${name}/`;

  if (existsSync(skillMd)) {
    return json({ ok: false, error: `技能 ${category}/${name} 已存在（站内发布库）`, pageUrl }, 409);
  }

  // 查重范围扩大到已收录技能（本地 ~/.hermes/skills + 已发布）——
  // 否则发布与本地同名的技能会"成功"但被合并去重遮蔽，静默失败
  try {
    const data = JSON.parse(readFileSync(DATA_JSON, 'utf-8')) as {
      categories: Array<{ name: string; skills: Array<{ name: string; source?: string }> }>;
    };
    const cat = data.categories.find(c => c.name === category);
    const conflict = cat?.skills.find(s => s.name === name);
    if (conflict) {
      const src = conflict.source === 'custom' ? '站内已发布' : '本地技能库';
      return json({ ok: false, error: `技能 ${category}/${name} 已存在于${src}，换个名字或分类`, pageUrl }, 409);
    }
  } catch {
    // skills-data.json 读不到不阻塞发布（降级为仅查站内库重名）
  }

  // 落盘 → 重建；失败回滚（保持目录干净，避免半成品）
  // publisher = 当前登录用户（会话注入，表单 author 字段仅作展示别名）
  mkdirSync(skillDir, { recursive: true });
  const content = renderSkillMd(payload as PublishPayload, user.username);
  writeFileSync(skillMd, content, 'utf-8');
  try {
    await rebuild();
  } catch (e) {
    rmSync(skillDir, { recursive: true, force: true });
    return json({ ok: false, error: `重建失败，已回滚: ${(e as Error).message}` }, 500);
  }

  return json({
    ok: true,
    message: `技能 ${name} 已发布到分类 ${category}`,
    pageUrl,
    skillMd: `.custom-skills/${category}/${name}/SKILL.md`,
  }, 201);
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
  const content = readFileSync(file) as Buffer;
  return new Response(new Uint8Array(content), { headers });
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

/** 编辑站内发布技能：覆写 SKILL.md + 重建；失败还原备份（.stash 回滚保险） */
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

  // 回滚保险：备份原文到 .stash，覆写失败/重建失败还原
  const { renameSync, mkdirSync } = await import('fs');
  const stashDir = join(CUSTOM_DIR, '.stash');
  const backup = join(stashDir, `${category}__${name}.SKILL.md.bak`);
  mkdirSync(stashDir, { recursive: true });
  writeFileSync(backup, readFileSync(skillMd, 'utf-8'), 'utf-8');
  const original = readFileSync(skillMd, 'utf-8');
  writeFileSync(skillMd, renderSkillMd(merged, detail?.publisher), 'utf-8');
  try {
    await rebuild();
  } catch (e) {
    writeFileSync(skillMd, original, 'utf-8'); // 还原原文
    return json({ ok: false, error: `重建失败，已还原: ${(e as Error).message}` }, 500);
  }
  rmSync(backup, { force: true }); // 成功 → 删备份
  return json({
    ok: true, message: `技能 ${name} 已更新`,
    pageUrl: `/skills/${category}/${name}/`,
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
      return json({ ok: false, error: '只能下架站内发布的技能，本地技能库请到 ~/.hermes/skills 管理' }, 403);
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
  // 重建失败再挪回；直接留在树内会被 rebuild 扫成新技能（实测踩坑）
  const { renameSync, mkdirSync } = await import('fs');
  const STASH_ROOT = join(CUSTOM_DIR, '.stash');
  const stash = join(STASH_ROOT, `${category}__${name}`);
  rmSync(stash, { recursive: true, force: true });
  mkdirSync(STASH_ROOT, { recursive: true });
  renameSync(skillDir, stash);
  try {
    await rebuild();
  } catch (e) {
    renameSync(stash, skillDir); // 重建失败 → 恢复
    return json({ ok: false, error: `重建失败，已恢复: ${(e as Error).message}` }, 500);
  }
  rmSync(stash, { recursive: true, force: true }); // 重建成功 → 真删
  // 空分类目录 + 空暂存区清理
  const catDir = join(CUSTOM_DIR, category);
  try {
    const { readdirSync } = await import('fs');
    if (readdirSync(catDir).length === 0) rmSync(catDir, { recursive: true, force: true });
    const stashRoot = join(CUSTOM_DIR, '.stash');
    if (existsSync(stashRoot) && readdirSync(stashRoot).length === 0) rmSync(stashRoot, { recursive: true, force: true });
  } catch { /* 目录不存在/非空都无所谓 */ }
  return json({ ok: true, message: `技能 ${name} 已下架`, category, name });
}

const server = Bun.serve({
  port: PORT,
  // rebuild（scan+build）耗时约 30~60s，默认 idleTimeout=10s 会掐断发布/下架请求
  // 导致 fetch 自动重试出现假 404 —— 必须放大到 120s
  idleTimeout: 120,
  async fetch(req): Promise<Response> {
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
        return json({ ok: true, skill: detail });
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
    if (req.method === 'GET' && pathname === '/api/health') {
      return json({ ok: true, dist: existsSync(DIST), ts: Date.now() });
    }
    // GET /api/custom-skills — 已发布技能清单（管理列表用）
    if (req.method === 'GET' && pathname === '/api/custom-skills') {
      const { readdirSync } = await import('fs');
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
    if (req.method === 'GET') return serveStatic(pathname);
    return json({ ok: false, error: '不支持的请求' }, 405);
  },
});

console.log(`✓ Skills Warehouse 服务: http://localhost:${server.port}`);
console.log(`  认证:   POST /api/auth/register|login|logout · GET /api/auth/me（首个注册用户=admin）`);
console.log(`  POST   /api/publish           发布技能（需登录，publisher 自动记录）`);
console.log(`  DELETE /api/skills/:cat/:name 下架（发布者本人或 admin）`);
console.log(`  PUT    /api/skills/:cat/:name 编辑（发布者本人或 admin）`);
console.log(`  GET    /api/custom-skills     已发布技能清单`);
console.log(`  GET    /*                     静态站点（.vitepress/dist）`);
