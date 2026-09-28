/**
 * skill-parse.ts — Skill 文件上传解析（纯函数模块，浏览器与 bun 测试共用）
 *
 * 支持三种元数据格式：
 *   1. YAML frontmatter：`---\nkey: v\n---\n正文`（主流 SKILL.md 写法）
 *   2. JSON frontmatter：`---\n{...json...}\n---` 或整文件 JSON
 *      （整文件 JSON 的正文取 body/content/markdown 字段）
 *   3. 无 frontmatter：降级 —— 文件名推技能名、首段正文提描述
 *
 * 支持 .zip 打包技能（含多文件）：
 *   - 浏览器端用 fflate 解压（服务端只收解包后的明文文件，无 zip bomb 风险）
 *   - 定位包内 SKILL.md（支持单层根目录包裹，如 my-skill/SKILL.md）
 *   - SKILL.md 无 frontmatter 时，同目录 skill.json / metadata.json 补元数据
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
  format: 'yaml' | 'json' | 'plain';
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

/** 从 frontmatter 对象提取七项字段（统一 YAML/JSON 取值路径） */
function pickFields(fm: Record<string, any>): Omit<ParsedSkillMeta, 'body' | 'hasFrontmatter' | 'format' | 'error'> {
  const meta = fm.metadata && typeof fm.metadata === 'object' ? fm.metadata : {};
  const hermes = meta.hermes && typeof meta.hermes === 'object' ? meta.hermes : {};

  const name = String(fm.name ?? fm.title ?? hermes.name ?? meta.name ?? '').trim().toLowerCase();
  const description = String(
    fm.description ?? fm.desc ?? fm.summary ?? hermes.description ?? meta.description ?? ''
  ).trim();
  const category = String(
    fm.category ?? hermes.category ?? meta.category ?? ''
  ).trim().toLowerCase();

  const rawTags = fm.tags ?? fm.labels ?? hermes.tags ?? meta.tags ?? [];
  const tags = Array.isArray(rawTags)
    ? rawTags.map(t => String(t).trim()).filter(Boolean)
    : typeof rawTags === 'string'
      ? rawTags.split(/[,，\s]+/).filter(Boolean)
      : [];

  const version = String(fm.version ?? hermes.version ?? meta.version ?? '').trim();
  const authorRaw = fm.author ?? hermes.author ?? meta.author;
  const author = Array.isArray(authorRaw)
    ? authorRaw.map(a => String(a).trim()).filter(Boolean).join(', ')
    : String(authorRaw ?? '').trim();
  const license = String(fm.license ?? hermes.license ?? meta.license ?? '').trim();

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

/** 文件名 → 技能名 slug 兜底（readme/skill 这类通用名不采用） */
function nameFromFilename(filename: string): string {
  const clean = filename.replace(/^.*[\\/]/, '').replace(/\.(md|skill|yaml|yml|txt|json)$/i, '');
  const low = clean.toLowerCase();
  if (!clean || low === 'skill' || low === 'readme') return '';
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
    const block = m[2].trim();
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

  // 定位 SKILL.md（取路径最浅的一个；大小写不敏感）
  const skillHits = files.filter(f => (f.path.split('/').pop() ?? '').toLowerCase() === 'skill.md');
  if (!skillHits.length) throw new Error('zip 包内未找到 SKILL.md');
  skillHits.sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.length - b.path.length);
  const skillPath = skillHits[0].path;

  // 单层根目录剥离：SKILL.md 在 my-skill/SKILL.md 且其余文件都在 my-skill/ 下 → 去掉前缀
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

  // SKILL.md → 元数据
  const skillBytes = files.find(f => f.path === skillPath)!.bytes;
  const skillText = decodeUtf8(skillBytes) ?? '';
  if (!skillText.trim()) throw new Error('SKILL.md 内容为空');
  const meta = parseSkillText(skillText, 'SKILL.md');

  // SKILL.md 无 frontmatter → 同目录 skill.json / metadata.json 补元数据（仅补空缺）
  if (meta.format === 'plain' && !meta.error) {
    const skillDir = skillPath.includes('/') ? skillPath.slice(0, skillPath.lastIndexOf('/') + 1) : '';
    const jsonSibling = files.find(f => {
      const rp = relPath(f.path);
      const dir = rp.includes('/') ? rp.slice(0, rp.lastIndexOf('/') + 1) : '';
      const base = rp.slice(dir.length).toLowerCase();
      return dir === (skillDir ? relPath(skillDir) : '') && (base === 'skill.json' || base === 'metadata.json');
    });
    if (jsonSibling) {
      try {
        const obj = JSON.parse(decodeUtf8(jsonSibling.bytes) ?? '');
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          const fields = pickFields(obj);
          meta.name = meta.name || fields.name || nameFromFilename(zipName);
          meta.description = fields.description || meta.description;
          meta.category = fields.category || meta.category;
          meta.tags = fields.tags.length ? fields.tags : meta.tags;
          meta.version = fields.version || meta.version;
          meta.author = fields.author || meta.author;
          meta.license = fields.license || meta.license;
          if (fields.description || fields.name) {
            warnings.push(`已从 ${relPath(jsonSibling.path)} 补全元数据`);
          }
        }
      } catch {
        warnings.push(`${relPath(jsonSibling.path)} 解析失败，已忽略`);
      }
    }
    if (!meta.name) meta.name = nameFromFilename(zipName);
  }

  // 附件清单：剔除所有 SKILL.md（正文由表单承载），逐个校验路径与限额
  const attachments: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const f of files) {
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
