/**
 * auth.ts — 用户账户与会话（bun:sqlite + Bun.password argon2 + HMAC Cookie）
 *
 * 设计：
 *   - 用户表 data/users.db（首个注册用户自动 admin）
 *   - 密码 argon2id 哈希（Bun.password 内置）
 *   - 会话 = HMAC-SHA256 签名 Cookie {uid, role, exp}——无状态，
 *     重启不掉线；换 SESSION_SECRET 全踢；exp 默认 7 天
 *   - 登录防爆破：内存计数，同用户名连续失败 5 次 → 锁 5 分钟
 *
 * 环境变量：
 *   SESSION_SECRET —— 必须（serve 启动时 fail-fast 校验）
 *   COOKIE_MAX_AGE —— 可选，秒（默认 7 天）
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Database } from 'bun:sqlite';

export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'member';
}

const COOKIE_NAME = 'sw_auth';
const MAX_AGE_SEC = Number(process.env.COOKIE_MAX_AGE || 7 * 24 * 3600);

// ---------- DB ----------
import { mkdirSync } from 'node:fs';
mkdirSync('data', { recursive: true }); // SQLite 不会自建父目录
const db = new Database('data/users.db', { create: true });
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
)`);
db.exec('PRAGMA journal_mode = WAL');

// ---------- Session Secret（fail-fast）----------
const rawSecret = process.env.SESSION_SECRET;
if (!rawSecret || rawSecret.length < 16) {
  console.error('✗ 缺少 SESSION_SECRET 环境变量（≥16 字符）—— 例: SESSION_SECRET=xxxx bun run serve');
  process.exit(1);
}
const SECRET = Buffer.from(rawSecret);

// ---------- 注册/登录 ----------
export async function register(
  username: string,
  password: string
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  if (!/^[a-zA-Z0-9_-]{2,32}$/.test(username)) {
    return { ok: false, error: '用户名 2-32 位，仅字母/数字/_/-' };
  }
  if (typeof password !== 'string' || password.length < 6) {
    return { ok: false, error: '密码至少 6 位' };
  }
  const exists = db.query('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return { ok: false, error: '用户名已被注册' };
  // 首个注册用户 → admin
  const count = (db.query('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
  const hash = await Bun.password.hash(password, { algorithm: 'argon2id' });
  const role = count === 0 ? 'admin' : 'member';
  const info = db.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, role) as unknown as { lastInsertRowid: number };
  return { ok: true, user: { id: Number(info.lastInsertRowid), username, role } };
}

// 登录防爆破（内存态，重启清零——内网场景够用）
const failCounts = new Map<string, { n: number; until: number }>();

export async function login(
  username: string,
  password: string
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string; lockedUntil?: number }> {
  // 锁检查
  const st = failCounts.get(username);
  if (st && st.n >= 5 && Date.now() < st.until) {
    return { ok: false, error: '失败次数过多，请 5 分钟后再试', lockedUntil: st.until };
  }
  const row = db
    .query('SELECT id, username, password_hash, role FROM users WHERE username = ?')
    .get(username) as { id: number; username: string; password_hash: string; role: 'admin' | 'member' } | null;
  const valid = row ? await Bun.password.verify(password, row.password_hash) : false;
  if (!row || !valid) {
    const cur = failCounts.get(username) ?? { n: 0, until: 0 };
    cur.n += 1;
    if (cur.n >= 5) cur.until = Date.now() + 5 * 60_000;
    failCounts.set(username, cur);
    return { ok: false, error: '用户名或密码错误' };
  }
  failCounts.delete(username);
  return { ok: true, user: { id: row.id, username: row.username, role: row.role } };
}

// ---------- 会话 Cookie（HMAC 签名，无状态）----------
interface SessionClaims { uid: number; username: string; role: 'admin' | 'member'; exp: number }

function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString('base64url');
}

export function issueSessionCookie(user: AuthUser): string {
  const claims: SessionClaims = {
    uid: user.id, username: user.username, role: user.role,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  };
  const payload = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${COOKIE_NAME}=${payload}.${sig}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// 登出黑名单（内存）。无状态会话的登出补偿：旧 token 在 exp 前仍签名有效，
// 黑名单显式作废。重启清空——可接受（token 自带 exp 兜底）。
const revoked = new Set<string>();

/** 把请求头里的当前会话 token 加入黑名单（登出用） */
export function revokeSession(req: Request): void {
  const raw = req.headers.get('cookie') ?? '';
  const m = raw.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (m) {
    revoked.add(m[1]);
    // 黑名单只留到最长期限，防无限膨胀
    if (revoked.size > 1000) revoked.clear(); // 粗暴但内网场景够用
  }
}

/** 从请求头解析会话；无效/过期返回 null */
export function getSession(req: Request): AuthUser | null {
  const raw = req.headers.get('cookie') ?? '';
  const m = raw.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!m) return null;
  if (revoked.has(m[1])) return null; // 已登出的 token 作废
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const expect = createHmac('sha256', SECRET).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionClaims;
    if (claims.exp * 1000 < Date.now()) return null;
    return { id: claims.uid, username: claims.username, role: claims.role };
  } catch {
    return null;
  }
}

/** 写操作守卫：返回用户或 401 Response（调用方直接 return） */
export function requireAuth(req: Request): AuthUser | Response {
  const user = getSession(req);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: '请先登录' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  return user;
}

/** 判断技能发布者是否为当前用户（本人或 admin 放行） */
export function canManage(user: AuthUser, skillAuthor: string | undefined): boolean {
  if (user.role === 'admin') return true;
  return !!skillAuthor && skillAuthor === user.username;
}
