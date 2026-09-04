#!/usr/bin/env bun
/**
 * scan-skills.ts — 扫描 Hermes skills 目录，生成 VitePress 站点数据 + 原生页面
 *
 * 运行：bun run scan（dev/build 已前置）
 *
 * 产物：
 *   .vitepress/skills-data.json   元数据（config.ts 侧边栏 + SkillsHub 组件共用）
 *   skills/index.md               分类总览页
 *   skills/<cat>/index.md          分类页（挂 SkillsHub）
 *   skills/<cat>/<id>.md           技能详情页（VitePress 原生渲染 SKILL.md 正文）
 *   tags/index.md                 标签页
 *
 * 规则：
 *   - 顶层目录 = 分类；目录内含 SKILL.md 即为一个技能（递归下探，兼容 mlops/evaluation 这类嵌套分类）
 *   - 顶层目录自身只有 SKILL.md、无子技能 → 归入 "other" 分类（如 feature-dev / loopx / hamsterstore）
 *   - skills/ 与 tags/ 为生成产物，每次全量重建，勿手改
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(import.meta.dir, '..');
const SKILLS_DIR = process.env.SKILLS_DIR || 'C:/Users/GauTown/AppData/Local/hermes/skills';

if (!existsSync(SKILLS_DIR)) {
  console.error(`skills 目录不存在: ${SKILLS_DIR}`);
  process.exit(1);
}

type Attrs = Record<string, any>;

function readMd(file: string): { attrs: Attrs; body: string } | null {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, 'utf-8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return { attrs: {}, body: raw.trim() };
  let attrs: Attrs = {};
  try {
    attrs = parseYaml(m[1]) ?? {};
  } catch {
    /* 非法 YAML 按无 frontmatter 处理 */
  }
  return { attrs, body: raw.slice(m[0].length).trim() };
}

function excerpt(body: string, n = 160): string {
  const line = body
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => l && !l.startsWith('#') && !l.startsWith('---'));
  return (line ?? '').replace(/[*`_[\]()]/g, '').slice(0, n).trim();
}

/** 递归收集技能目录（含 SKILL.md 即技能，不再下探） */
function findSkillDirs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (existsSync(join(p, 'SKILL.md'))) out.push(p);
    else out.push(...findSkillDirs(p));
  }
  return out;
}

function str(v: any): string | undefined {
  return v == null ? undefined : String(v);
}
function strArr(v: any): string[] | undefined {
  return Array.isArray(v) ? v.map(String) : undefined;
}

/**
 * 标签归一化：小写 + 空格→连字符 + 技能内去重。
 * 解决原始数据的三类问题：大小写冲突（Git/git）、含空格（Hugging Face Hub）、
 * 同一技能重复标签。443 个原始标签经此收敛。
 */
function normalizeTags(v: any): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of v.map(String)) {
    const norm = t.trim().toLowerCase().replace(/\s+/g, '-');
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out.length ? out : undefined;
}

/**
 * 裸标签转义（仅代码围栏外）：
 * 逐行跟踪 ``` / ~~~ 围栏状态，围栏外的未知 HTML 标签转义为 &lt;...&gt;。
 * 围栏内的内容由 shiki 高亮转义，这里跳过，否则双重转义。
 * 常见 HTML 标签（a/p/div 等）保留不转 —— markdown-it 本就支持行内 HTML，
 * 且它们不会触发 Vue tokenizer 的 unclosed-tag 错误。
 */
function escapeOutsideFences(body: string): string {
  const KNOWN = /^(a|abbr|b|bdi|bdo|blockquote|body|br|button|caption|cite|code|col|dd|del|details|div|dl|dt|em|embed|figure|figcaption|h[1-6]|head|header|hr|html|i|img|input|ins|kbd|label|li|mark|meta|nav|ol|p|picture|pre|q|rp|rt|ruby|s|samp|section|small|source|span|strong|sub|summary|sup|table|tbody|td|template|tfoot|th|thead|time|tr|track|u|ul|var|wbr)$/i;
  let inFence = false;
  let fenceChar = '';
  return body
    .split(/\r?\n/)
    .map(line => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        const c = fence[1][0];
        if (!inFence) {
          inFence = true;
          fenceChar = c;
        } else if (c === fenceChar) {
          inFence = false;
        }
        return line; // 围栏行本身不转义
      }
      if (inFence) return line; // 围栏内：shiki 负责，跳过
      return line.replace(
        /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?\/?>/g,
        (whole, slash, name, attrs) =>
          KNOWN.test(name) ? whole : `&lt;${slash}${name}${attrs ?? ''}&gt;`
      );
    })
    .join('\n');
}

interface Skill {
  id: string;
  category: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  license?: string;
  platforms?: string[];
  tags?: string[];
  related?: string[];
}

function buildSkill(dir: string, category: string): Skill {
  const md = readMd(join(dir, 'SKILL.md'))!;
  const a = md.attrs;
  const h = a.metadata?.hermes ?? {};
  return {
    id: basename(dir),
    category,
    name: str(a.name) ?? basename(dir),
    description: str(a.description) ?? excerpt(md.body),
    version: str(a.version),
    author: str(a.author),
    license: str(a.license),
    platforms: strArr(a.platforms),
    tags: normalizeTags(h.tags),
    related: strArr(h.related_skills),
  };
}

// ===== 1. 扫描 =====
const catDefs: { name: string; description: string; items: { skill: Skill; dir: string }[] }[] = [];
const otherItems: { skill: Skill; dir: string }[] = [];

for (const e of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('.')) continue;
  const top = join(SKILLS_DIR, e.name);
  const subSkillDirs = findSkillDirs(top);
  if (existsSync(join(top, 'SKILL.md')) && subSkillDirs.length === 0) {
    // 顶层单技能 → 归入 other
    otherItems.push({ skill: buildSkill(top, 'other'), dir: top });
    continue;
  }
  const descMd = readMd(join(top, 'DESCRIPTION.md'));
  catDefs.push({
    name: e.name,
    description: str(descMd?.attrs?.description) || excerpt(descMd?.body ?? ''),
    items: subSkillDirs.map(d => ({ skill: buildSkill(d, e.name), dir: d })),
  });
}
if (otherItems.length) {
  catDefs.push({ name: 'other', description: '未归入常规分类的顶层技能', items: otherItems });
}
catDefs.sort((a, b) => a.name.localeCompare(b.name));

const totalSkills = catDefs.reduce((n, c) => n + c.items.length, 0);

// ===== 2. 生成 skills-data.json =====
const payload = {
  generatedAt: new Date().toISOString(),
  skillsDir: SKILLS_DIR,
  totalSkills,
  categories: catDefs.map(c => ({
    name: c.name,
    description: c.description,
    count: c.items.length,
    skills: c.items.map(i => i.skill).sort((a, b) => a.name.localeCompare(b.name)),
  })),
};
writeFileSync(join(ROOT, '.vitepress/skills-data.json'), JSON.stringify(payload, null, 2));

// ===== 3. 生成页面 =====
rmSync(join(ROOT, 'skills'), { recursive: true, force: true });
rmSync(join(ROOT, 'tags'), { recursive: true, force: true });
rmSync(join(ROOT, 'public/skills-data.json'), { force: true }); // 清理旧版产物
mkdirSync(join(ROOT, 'skills'), { recursive: true });
mkdirSync(join(ROOT, 'tags'), { recursive: true });

function tagUrl(t: string) {
  return `/tags/?tag=${encodeURIComponent(t)}`;
}

writeFileSync(
  join(ROOT, 'skills/index.md'),
  `---\ntitle: 所有技能\n---\n\n<SkillsHub mode="category-list" />\n`
);
writeFileSync(
  join(ROOT, 'tags/index.md'),
  `---\ntitle: 按标签\n---\n\n<SkillsHub mode="tags" />\n`
);

const seen = new Set<string>();
for (const c of catDefs) {
  mkdirSync(join(ROOT, 'skills', c.name), { recursive: true });
  writeFileSync(
    join(ROOT, 'skills', c.name, 'index.md'),
    `---\ntitle: ${c.name}\ndescription: ${JSON.stringify(c.description || `${c.name} 分类下的技能`)}\n---\n\n<SkillsHub mode="category" category-path="${c.name}" />\n`
  );
  for (const it of c.items) {
    const s = it.skill;
    const pagePath = join(ROOT, 'skills', c.name, `${s.id}.md`);
    if (seen.has(pagePath)) console.warn(`⚠ 重名技能被覆盖: ${pagePath}`);
    seen.add(pagePath);

    const md = readMd(join(it.dir, 'SKILL.md'))!;
    // 正文：去掉与 frontmatter title 重复的首个 H1
    let body = md.body.replace(/^#[^\r\n]*\r?\n+/, '');
    // Liquid 标记（{% raw %} / {% endraw %} 等）：markdown-it 会把它渲染成
    // <p %="" raw="" %=""> —— 重复属性 % 直接让 Vue 编译报错。整行剥掉。
    body = body.replace(/^\s*\{%\s*(raw|endraw)\s*%\}\s*$/gm, '');
    // 防御 1：裸尖括号标签（如 <machine-name>、<token>）会被 Vue 模板编译器
    // 当成未闭合元素报 "Element is missing end tag"（::: v-pre 也救不了，
    // 因为错误发生在 tokenizer 层）。转义为 HTML 实体，显示效果不变。
    // ⚠ 仅处理代码围栏（``` / ~~~）之外的行 —— 围栏内的占位符（<username> 等）
    // 由 shiki 高亮自行转义，这里再转一次会变成 &amp;lt; 双重转义。
    body = escapeOutsideFences(body);
    // 防御 2：含 {{ }} 的正文包进 v-pre 容器，避免被 Vue 模板插值解析
    if (/\{\{/.test(body)) {
      body = `::: v-pre\n\n${body}\n\n:::`;
    }

    const meta: string[] = [`分类：[${c.name}](/skills/${c.name}/)`];
    if (s.version) meta.push(`版本 ${s.version}`);
    if (s.author) meta.push(`作者 ${s.author}`);
    if (s.license) meta.push(`许可 ${s.license}`);
    if (s.platforms?.length) meta.push(`平台 ${s.platforms.join(' / ')}`);
    const tagLine = s.tags?.length
      ? `\n\n**标签：** ${s.tags.map(t => `[${t}](${tagUrl(t)})`).join(' ')}`
      : '';

    // 相关技能：按 id 在全站索引中解析（related 值可能跨分类），
    // 未命中的静默跳过（frontmatter 里的 related_skills 可能指向不存在的技能）
    const relatedLine = (() => {
      if (!s.related?.length) return '';
      const links: string[] = [];
      for (const rid of s.related) {
        const hit = catDefs.flatMap(cd => cd.items)
          .find(x => x.skill.id === rid || x.skill.name === rid);
        if (hit) {
          links.push(`[${hit.skill.name}](/skills/${hit.skill.category}/${hit.skill.id}/)`);
        }
      }
      return links.length
        ? `\n\n**相关技能：** ${links.join(' · ')}`
        : '';
    })();

    writeFileSync(
      pagePath,
      `---\ntitle: ${JSON.stringify(s.name)}\ndescription: ${JSON.stringify(s.description)}\n---\n\n> ${meta.join(' · ')}${tagLine}${relatedLine}\n\n${body}\n`
    );
  }
}

// ===== 4. 汇总 =====
console.log(`✓ ${totalSkills} 个技能 / ${catDefs.length} 个分类`);
for (const c of catDefs) console.log(`  - ${c.name}: ${c.items.length}`);
console.log(`✓ 数据 → .vitepress/skills-data.json`);
console.log(`✓ 页面 → skills/ + tags/（${seen.size + catDefs.length + 2} 个 md）`);
