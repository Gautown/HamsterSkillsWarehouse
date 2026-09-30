/**
 * skill-parse.ts — Skill 文件上传解析（纯函数模块，浏览器与 bun 测试共用）
 *
 * 支持三种元数据格式：
 *   1. YAML frontmatter：`---\nkey: v\n---\n正文`（主流 SKILL.md 写法）
 *   2. JSON frontmatter：`---\n{...json...}\n---` 或整文件 JSON
 *      （整文件 JSON 的正文取 body/content/markdown 字段）
 *   3. TOML frontmatter：`+++\nkey = "v"\n+++\n正文`（Hugo/Zola/部分 Agent 生态）
 *   4. 无 frontmatter：降级 —— 文件名推技能名、首段正文提描述
 *
 * 字段别名覆盖主流生态：name/title/displayName、description/summary/when_to_use、
 * tags/labels/keywords、author/maintainer/owner、license/licence。
 *
 * 支持 .zip 打包技能（含多文件）：
 *   - 浏览器端用 fflate 解压（服务端只收解包后的明文文件，无 zip bomb 风险）
 *   - 入口定位优先级：SKILL.md → AGENTS.md/CLAUDE.md/GEMINI.md 等主流入口 →
 *     任意 .md/.mdc → 清单文件（skill.json/manifest.json/package.json/skill.toml）
 *   - 入口无 frontmatter 时，同目录清单文件补元数据
 *   - 其余文件进附件清单（上传时随表单提交，发布后由 scan 复制进站点）
 *
 * 附件约束（与 server.ts validateAttachments 保持一致）：
 *   路径段 [a-zA-Z0-9._-]（拒绝 . / .. / 绝对路径 / 反斜杠）、禁止 SKILL.md，
 *   单文件 ≤ 1MB、总数 ≤ 100、总大小 ≤ 5MB。
 */
import { unzipSync } from 'fflate';
import { parse as yamlParse } from 'yaml';

/** 附件限额（前后端一致；服务端有独立校验，此处为用户侧提前反馈） */
export const ATTACH_MAX_FILES = 100;
export const ATTACH_MAX_FILE_BYTES = 1024 * 1024;
export const ATTACH_MAX_TOTAL_BYTES = 5 * 1024 * 1024;

/** 解析后的技能元数据 + 正文 */
export interface ParsedSkillMeta {
  name: string;
  description: string;
  category: string;
  tags: string[];
  version: string;
  author: string;
  license: string;
  body: string;
  /** 是否含 frontmatter（false = 纯正文降级） */
  hasFrontmatter: boolean;
  /** 元数据来源格式（用于提示条文案） */
  format: 'yaml' | 'json' | 'toml' | 'plain';
  /** 致命错误（如 .json 文件语法错误）——非致命降级不走这里 */
  error?: string;
}

/** 提交给服务端的附件（content 为 utf8 文本或 base64） */
export interface SkillAttachment {
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
}

/** zip 解包结果 */
export interface ZipSkillResult {
  meta: ParsedSkillMeta;
  /** SKILL.md 在 zip 内的路径 */
  skillPath: string;
  /** 附件（已剔除 SKILL.md，path 为剥离根目录后的相对路径） */
  attachments: Array<{ path: string; bytes: Uint8Array }>;
  /** 非致命提示（如剥离了根目录、忽略的条目数） */
  warnings: string[];
}

/**
 * 从 frontmatter 对象提取七项字段（统一 YAML/JSON/TOML 取值路径）。
 *
 * 字段别名覆盖主流技能/Agent 生态的写法：
 *   - name：name / title / displayName / display_name / slug / id
 *   - description：description / desc / summary / when_to_use / whenToUse / about
 *   - tags：tags / labels / keywords / topics / categories
 *   - author：author / authors / maintainer / owner / publisher / created_by
 *   - license：license / licence
 * 嵌套命名空间：metadata.hermes.*（本仓库）、metadata.*、顶层
 */
function pickFields(fm: Record<string, any>): Omit<ParsedSkillMeta, 'body' | 'hasFrontmatter' | 'format' | 'error'> {
  const meta = fm.metadata && typeof fm.metadata === 'object' ? fm.metadata : {};
  const hermes = meta.hermes && typeof meta.hermes === 'object' ? meta.hermes : {};
  // 取值优先级：顶层 → metadata.hermes → metadata（首个非空命中）
  const pick = (...keys: string[]): unknown => {
    for (const src of [fm, hermes, meta]) {
      for (const k of keys) {
        const v = (src as Record<string, unknown>)[k];
        if (v !== undefined && v !== null && v !== '') return v;
      }
    }
    return undefined;
  };

  const name = String(
    pick('name', 'title', 'displayName', 'display_name', 'slug', 'id') ?? ''
  ).trim().toLowerCase();
  const description = String(
    pick('description', 'desc', 'summary', 'when_to_use', 'whenToUse', 'about') ?? ''
  ).trim();
  const category = String(pick('category', 'categories') ?? '').trim().toLowerCase();

  const rawTags = pick('tags', 'labels', 'keywords', 'topics');
  const tags = Array.isArray(rawTags)
    ? rawTags.map(t => String(t).trim()).filter(Boolean)
    : typeof rawTags === 'string'
      ? rawTags.split(/[,，\s]+/).filter(Boolean)
      : [];

  const version = String(pick('version') ?? '').trim();
  const authorRaw = pick('author', 'authors', 'maintainer', 'owner', 'publisher', 'created_by');
  const author = Array.isArray(authorRaw)
    ? authorRaw.map(a => String(a).trim()).filter(Boolean).join(', ')
    : String(authorRaw ?? '').trim();
  const license = String(pick('license', 'licence') ?? '').trim();

  return { name, description, category, tags, version, author, license };
}

/** 首段非标题/引用正文 → 描述兜底（≤160 字符） */
function excerpt(body: string): string {
  const firstLine = body
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => l && !l.startsWith('#') && !l.startsWith('---') && !l.startsWith('>') && !l.startsWith('!'));
  if (!firstLine) return '';
  return firstLine.replace(/[*`_[\]()]/g, '').slice(0, 160).trim();
}

/**
 * 轻量 TOML 解析（仅覆盖 frontmatter 常见子集，不引第三方依赖）：
 *   - `key = "value"` / `key = 'value'` / `key = 123` / `key = true`
 *   - `key = [a, b, c]`（字符串/数字数组，支持跨行）
 *   - `[table]` / `[table.sub]` 段（嵌套对象）
 * 解析失败返回 null（调用方按无 frontmatter 降级）。
 */
function parseTomlLite(text: string): Record<string, any> | null {
  const root: Record<string, any> = {};
  let cur: Record<string, any> = root;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!.trim();
    if (!line || line.startsWith('#')) continue;
    // 段头 [a.b]
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      cur = root;
      for (const part of sec[1]!.split('.')) {
        const key = part.trim();
        if (!key) return null;
        if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {};
        cur = cur[key];
      }
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) return null;
    const key = line.slice(0, eq).trim().replace(/^["']|["']$/g, '');
    if (!key) return null;
    let val = line.slice(eq + 1).trim();
    // 跨行数组：本行 [ 未闭合 → 续读后续行
    if (val.startsWith('[') && !val.includes(']')) {
      while (i + 1 < lines.length && !val.includes(']')) {
        i++;
        val += ' ' + lines[i]!.trim();
      }
    }
    cur[key] = parseTomlValue(val);
  }
  return root;
}

/** TOML 标量/数组取值 */
function parseTomlValue(val: string): unknown {
  const v = val.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map(s => parseTomlValue(s)).filter(s => s !== '');
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** 解析清单文件（skill.json / manifest.json / package.json / skill.toml / skill.yaml）→ 对象 */
function parseManifest(text: string, path: string): Record<string, any> | null {
  const low = path.toLowerCase();
  try {
    if (low.endsWith('.toml')) return parseTomlLite(text);
    if (low.endsWith('.yaml') || low.endsWith('.yml')) {
      const o = yamlParse(text);
      return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, any>) : null;
    }
    const o = JSON.parse(text);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** 通用入口文件名（这些名字不体现技能语义，不作为技能名兜底） */
const GENERIC_ENTRY_NAMES = new Set([
  'skill', 'readme', 'index', 'manifest', 'metadata', 'meta',
  'agents', 'claude', 'gemini', 'cursor', 'copilot', 'warp', 'conventions',
  'skill', 'rules', 'instructions', 'prompt', 'system',
]);

/** 文件名 → 技能名 slug 兜底（readme/skill 这类通用名不采用） */
function nameFromFilename(filename: string): string {
  const clean = filename
    .replace(/^.*[\\/]/, '')
    .replace(/\.(md|mdx|mdc|skill|yaml|yml|txt|json|toml|cursorrules|windsurfrules|clinerules|goosehints|rules)$/i, '');
  const low = clean.toLowerCase();
  if (!clean || GENERIC_ENTRY_NAMES.has(low)) return '';
  return low.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * 解析 Skill 文本文件的元数据与正文。
 * @param rawText 文件原文
 * @param filename 原文件名（用于技能名兜底与 .json 判定）
 */
export function parseSkillText(rawText: string, filename = ''): ParsedSkillMeta {
  const raw = rawText.replace(/^\uFEFF/, ''); // 去 BOM
  const trimmed = raw.trim();
  const isJsonFile = /\.json$/i.test(filename);

  if (!trimmed) {
    return {
      name: '', description: '', category: '', tags: [], version: '', author: '', license: '',
      body: '', hasFrontmatter: false, format: 'plain', error: '上传的文件内容为空',
    };
  }

  // —— 格式 2a：整文件 JSON（.json 上传，或内容直接以 { 开头且是合法 JSON 对象）——
  if (trimmed.startsWith('{')) {
    let obj: any = null;
    try {
      obj = JSON.parse(trimmed);
    } catch (e) {
      // .json 文件语法错误 → 致命；markdown 恰好以 { 开头 → 按纯文本降级
      if (isJsonFile) {
        return {
          name: '', description: '', category: '', tags: [], version: '', author: '', license: '',
          body: '', hasFrontmatter: true, format: 'json',
          error: `JSON 解析失败：${(e as Error).message}`,
        };
      }
      obj = null;
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const fields = pickFields(obj);
      const body = String(obj.body ?? obj.content ?? obj.markdown ?? obj.readme ?? '').trim();
      return {
        ...fields,
        name: fields.name || nameFromFilename(filename),
        description: fields.description || excerpt(body),
        body,
        hasFrontmatter: true,
        format: 'json',
      };
    }
  }

  // —— 格式 1/2b：frontmatter 围栏（YAML，或 ---json 标记 / 内容以 { 开头的 JSON）——
  const m = raw.match(/^---[ \t]*(json)?[ \t]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/i);
  if (m) {
    const jsonMark = !!m[1];
    const block = (m[2] ?? '').trim();
    const isJsonBlock = jsonMark || block.startsWith('{');
    const body = raw.slice(m[0].length).trim();

    if (isJsonBlock) {
      let obj: any = null;
      try {
        obj = JSON.parse(block);
      } catch (e) {
        // 显式 ---json 标记 → 解析失败必须报错（静默降级会丢元数据）；
        // 仅"以 { 开头"的形似 → 交给下面的 YAML 流式语法兜底（如 {name: foo}）
        if (jsonMark) {
          return {
            name: '', description: '', category: '', tags: [], version: '', author: '', license: '',
            body: '', hasFrontmatter: true, format: 'json',
            error: `frontmatter JSON 解析失败：${(e as Error).message}`,
          };
        }
      }
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const fields = pickFields(obj);
        return {
          ...fields,
          name: fields.name || nameFromFilename(filename),
          description: fields.description || excerpt(body),
          body,
          hasFrontmatter: true,
          format: 'json',
        };
      }
    }

    try {
      const fm = yamlParse(block);
      if (fm && typeof fm === 'object' && !Array.isArray(fm)) {
        const fields = pickFields(fm as Record<string, any>);
        return {
          ...fields,
          name: fields.name || nameFromFilename(filename),
          description: fields.description || excerpt(body),
          body,
          hasFrontmatter: true,
          format: 'yaml',
        };
      }
    } catch {
      /* YAML 非法 → 按无 frontmatter 降级（与 scan-skills 行为一致） */
    }
  }

  // —— 格式 1b：TOML frontmatter（+++ ... +++，Hugo/Zola/部分 Agent 生态）——
  const tm = raw.match(/^\+\+\+[ \t]*\r?\n([\s\S]*?)\r?\n\+\+\+(?:\r?\n|$)/);
  if (tm) {
    const block = (tm[1] ?? '').trim();
    const body = raw.slice(tm[0].length).trim();
    const obj = parseTomlLite(block);
    if (obj && typeof obj === 'object') {
      const fields = pickFields(obj);
      return {
        ...fields,
        name: fields.name || nameFromFilename(filename),
        description: fields.description || excerpt(body),
        body,
        hasFrontmatter: true,
        format: 'toml',
      };
    }
  }

  // —— 格式 3：纯正文降级 ——
  return {
    name: nameFromFilename(filename),
    description: excerpt(trimmed),
    category: '',
    tags: [],
    version: '',
    author: '',
    license: '',
    body: trimmed,
    hasFrontmatter: false,
    format: 'plain',
  };
}

/** zip 魔数判定（PK\x03\x04 —— 扩展名不可靠，按内容识别） */
export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** 附件路径合法性（与服务端一致；返回 null = 合法） */
export function invalidAttachmentPath(path: string): string | null {
  if (!path) return '路径为空';
  if (path.length > 200) return '路径过长';
  if (path.includes('\\')) return '路径含反斜杠';
  if (path.startsWith('/')) return '不支持绝对路径';
  const segs = path.split('/');
  for (const seg of segs) {
    if (!seg) return '路径含空段';
    if (seg === '.' || seg === '..') return '路径含相对段';
    if (!/^[a-zA-Z0-9._-]+$/.test(seg)) return `路径段 "${seg}" 含非法字符（只允许字母、数字、. _ -）`;
    if (seg.toLowerCase() === 'skill.md') return 'SKILL.md 由正文字段承载，不作为附件';
  }
  if (path.toLowerCase() === 'index.html' || path.toLowerCase() === 'index.htm') {
    return '根级 index.html 会遮蔽技能详情页';
  }
  return null;
}

/** 严格 UTF-8 解码；非法字节序列返回 null（调用方转 base64） */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\u0000') ? null : text; // 含 NUL 视为二进制
  } catch {
    return null;
  }
}

/** bytes → base64（分块避免超长参数列表爆栈） */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** 附件字节 → 提交格式（文本走 utf8，二进制走 base64） */
export function encodeAttachment(path: string, bytes: Uint8Array): SkillAttachment {
  const text = decodeUtf8(bytes);
  if (text !== null) return { path, content: text, encoding: 'utf8' };
  return { path, content: bytesToBase64(bytes), encoding: 'base64' };
}

/**
 * 解包 .zip 技能包。
 * 定位 SKILL.md → 解析元数据 → 其余文件为附件。
 * 致命失败抛出 Error（message 为中文用户提示）。
 */
export function extractSkillZip(data: Uint8Array, zipName = ''): ZipSkillResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch (e) {
    throw new Error(`zip 解压失败：${(e as Error).message}`);
  }

  // 过滤目录条目与系统垃圾（__MACOSX、.DS_Store 等）
  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  let ignored = 0;
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith('/')) continue; // 目录条目
    const segs = path.split('/');
    if (segs.some(s => s.startsWith('.')) || segs.some(s => s === '__MACOSX')) {
      ignored++;
      continue;
    }
    files.push({ path, bytes });
  }
  if (!files.length) throw new Error('zip 包内没有可读取的文件');

  // 定位技能入口文件（取路径最浅的一个；大小写不敏感）。
  // 优先级：SKILL.md（本仓库标准）→ 其他主流 Agent 入口名 → 任意 .md → 清单文件。
  // 这样 Cursor(.mdc)、Claude/Codex(AGENTS.md/CLAUDE.md)、纯 manifest 包都能识别。
  const baseName = (p: string) => (p.split('/').pop() ?? '').toLowerCase();
  const byDepth = (a: { path: string }, b: { path: string }) =>
    a.path.split('/').length - b.path.split('/').length || a.path.length - b.path.length;

  const ENTRY_MD_NAMES = ['skill.md', 'agents.md', 'claude.md', 'gemini.md', 'copilot-instructions.md', 'warp.md', 'conventions.md', 'readme.md'];
  const MANIFEST_NAMES = ['skill.json', 'manifest.json', 'metadata.json', 'skill.toml', 'skill.yaml', 'skill.yml', 'package.json'];

  let skillPath = '';
  let entryKind: 'md' | 'manifest' = 'md';
  // ① 标准入口名（按优先级顺序找，同级取最浅）
  for (const name of ENTRY_MD_NAMES) {
    const hits = files.filter(f => baseName(f.path) === name).sort(byDepth);
    if (hits.length) { skillPath = hits[0]!.path; break; }
  }
  // ② 任意 .md / .mdc（排除 README 之外的杂项仍可作正文）
  if (!skillPath) {
    const hits = files.filter(f => /\.(md|mdx|mdc)$/i.test(f.path)).sort(byDepth);
    if (hits.length) skillPath = hits[0]!.path;
  }
  // ③ 清单文件（无正文入口时，用清单元数据 + 空正文）
  if (!skillPath) {
    for (const name of MANIFEST_NAMES) {
      const hits = files.filter(f => baseName(f.path) === name).sort(byDepth);
      if (hits.length) { skillPath = hits[0]!.path; entryKind = 'manifest'; break; }
    }
  }
  if (!skillPath) throw new Error('zip 包内未找到技能入口（SKILL.md / AGENTS.md / 任意 .md / skill.json 等）');

  // 单层根目录剥离：入口在 my-skill/SKILL.md 且其余文件都在 my-skill/ 下 → 去掉前缀
  const warnings: string[] = [];
  const slash = skillPath.lastIndexOf('/');
  let rootPrefix = slash >= 0 ? skillPath.slice(0, slash + 1) : '';
  if (rootPrefix && !files.every(f => f.path === skillPath || f.path.startsWith(rootPrefix))) {
    rootPrefix = ''; // 有文件散落在根目录 → 不剥离（保留原样路径）
  }
  if (rootPrefix) warnings.push(`已剥离包内根目录 ${rootPrefix.slice(0, -1)}/`);
  const relPath = (p: string) => (rootPrefix && p.startsWith(rootPrefix) ? p.slice(rootPrefix.length) : p);

  // 松弛护栏：解压后原始总量（附件还会逐个过 5MB 总限额）
  const totalBytes = files.reduce((n, f) => n + f.bytes.length, 0);
  if (totalBytes > ATTACH_MAX_TOTAL_BYTES * 4) throw new Error('zip 解压后体积过大');

  // 入口文件 → 元数据
  const skillBytes = files.find(f => f.path === skillPath)!.bytes;
  const skillText = decodeUtf8(skillBytes) ?? '';
  if (!skillText.trim()) throw new Error(`${relPath(skillPath)} 内容为空`);
  let meta: ParsedSkillMeta;
  if (entryKind === 'manifest') {
    // 清单入口：元数据来自清单，正文留空（用户可再补）
    const obj = parseManifest(skillText, skillPath);
    if (!obj) throw new Error(`${relPath(skillPath)} 解析失败`);
    const fields = pickFields(obj);
    meta = {
      ...fields,
      name: fields.name || nameFromFilename(zipName),
      description: fields.description || '',
      body: '',
      hasFrontmatter: true,
      format: skillPath.toLowerCase().endsWith('.toml') ? 'toml' : skillPath.toLowerCase().endsWith('.json') ? 'json' : 'yaml',
    };
    warnings.push(`以清单文件 ${relPath(skillPath)} 作为入口（无正文，请补充正文）`);
  } else {
    meta = parseSkillText(skillText, relPath(skillPath));
    if (relPath(skillPath).toLowerCase() !== 'skill.md') {
      warnings.push(`以 ${relPath(skillPath)} 作为技能入口`);
    }
  }

  // 入口无 frontmatter → 同目录清单文件补元数据（仅补空缺）
  if (meta.format === 'plain' && !meta.error) {
    const skillDir = skillPath.includes('/') ? skillPath.slice(0, skillPath.lastIndexOf('/') + 1) : '';
    const manifestSibling = files.find(f => {
      const rp = relPath(f.path);
      const dir = rp.includes('/') ? rp.slice(0, rp.lastIndexOf('/') + 1) : '';
      const base = rp.slice(dir.length).toLowerCase();
      return dir === (skillDir ? relPath(skillDir) : '') && MANIFEST_NAMES.includes(base);
    });
    if (manifestSibling) {
      const obj = parseManifest(decodeUtf8(manifestSibling.bytes) ?? '', manifestSibling.path);
      if (obj) {
        const fields = pickFields(obj);
        meta.name = meta.name || fields.name || nameFromFilename(zipName);
        meta.description = fields.description || meta.description;
        meta.category = fields.category || meta.category;
        meta.tags = fields.tags.length ? fields.tags : meta.tags;
        meta.version = fields.version || meta.version;
        meta.author = fields.author || meta.author;
        meta.license = fields.license || meta.license;
        if (fields.description || fields.name) {
          warnings.push(`已从 ${relPath(manifestSibling.path)} 补全元数据`);
        }
      } else {
        warnings.push(`${relPath(manifestSibling.path)} 解析失败，已忽略`);
      }
    }
    if (!meta.name) meta.name = nameFromFilename(zipName);
  }

  // 附件清单：剔除入口文件（正文由表单承载），逐个校验路径与限额
  const attachments: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const f of files) {
    if (f.path === skillPath) continue; // 入口文件本身不作附件
    const rp = relPath(f.path);
    if ((rp.split('/').pop() ?? '').toLowerCase() === 'skill.md') continue;
    const bad = invalidAttachmentPath(rp);
    if (bad) {
      ignored++;
      warnings.push(`已忽略 ${rp}（${bad}）`);
      continue;
    }
    if (f.bytes.length > ATTACH_MAX_FILE_BYTES) {
      throw new Error(`附件 ${rp} 超过 1MB 单文件上限`);
    }
    if (attachments.length >= ATTACH_MAX_FILES) {
      throw new Error(`附件数量超过 ${ATTACH_MAX_FILES} 个上限`);
    }
    attachments.push({ path: rp, bytes: f.bytes });
  }
  const attachTotal = attachments.reduce((n, a) => n + a.bytes.length, 0);
  if (attachTotal > ATTACH_MAX_TOTAL_BYTES) {
    throw new Error(`附件总大小超过 ${ATTACH_MAX_TOTAL_BYTES / 1024 / 1024}MB 上限`);
  }
  if (ignored) warnings.push(`已忽略 ${ignored} 个条目（隐藏文件/目录/系统垃圾）`);

  return { meta, skillPath, attachments, warnings };
}
