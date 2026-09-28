/**
 * parse.test.ts — skill-parse.ts 回归测试（bun run tests/parse.test.ts）
 * 覆盖：YAML frontmatter / JSON frontmatter（三种形态）/ 无 frontmatter 降级 /
 *       zip 解包（根目录剥离、附件清单、skill.json 补元数据、路径校验、限额）
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { zipSync } from 'fflate';
import {
  extractSkillZip,
  invalidAttachmentPath,
  isZipBytes,
  parseSkillText,
} from '../.vitepress/theme/skill-parse';

let failed = 0;
function check(cond: boolean, msg: string, extra?: unknown): void {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) {
    failed++;
    if (extra !== undefined) console.log('   →', JSON.stringify(extra));
  }
}

/** 仓库根目录（本文件位于 tests/ 下） */
const ROOT = join(import.meta.dir, '..');

// ===== 1. YAML frontmatter（真实 demo 技能）=====
{
  const raw = readFileSync(join(ROOT, 'demo-skills/creative/ascii-video/SKILL.md'), 'utf-8');
  const p = parseSkillText(raw, 'SKILL.md');
  check(p.format === 'yaml' && p.hasFrontmatter, 'YAML frontmatter → format=yaml');
  check(p.name.length > 0, 'YAML: name 已提取', p.name);
  check(p.description.length > 0, 'YAML: description 已提取');
  check(p.tags.length > 0, `YAML: tags 已提取（${p.tags.length} 个）`);
  check(p.body.length > 100 && !p.body.startsWith('---'), 'YAML: 正文已去 frontmatter');
}

// ===== 2a. 整文件 JSON =====
{
  const p = parseSkillText(JSON.stringify({
    name: 'Json Skill', description: '整文件 JSON 描述', category: 'CREATIVE',
    tags: ['json', 'test'], version: '2.1.0', author: 'json-author', license: 'MIT',
    body: '# JSON 正文\n\n来自整文件 JSON 的正文内容。',
  }), 'skill.json');
  check(p.format === 'json' && p.hasFrontmatter, '整文件 JSON → format=json');
  check(p.name === 'json skill', 'JSON: name 小写归一', p.name);
  check(p.category === 'creative', 'JSON: category 小写归一', p.category);
  check(p.tags.join(',') === 'json,test', 'JSON: tags', p.tags);
  check(p.version === '2.1.0' && p.author === 'json-author' && p.license === 'MIT', 'JSON: version/author/license');
  check(p.body.startsWith('# JSON 正文'), 'JSON: body 取 body 字段', p.body);
}

// ===== 2b. frontmatter 围栏内 JSON（---{...}---）=====
{
  const raw = '---\n{"name": "Fenced Json", "description": "围栏 JSON 描述", "tags": ["a","b"]}\n---\n\n正文段落在这里。';
  const p = parseSkillText(raw, 'SKILL.md');
  check(p.format === 'json' && p.hasFrontmatter, '围栏 JSON → format=json');
  check(p.name === 'fenced json' && p.tags.length === 2, '围栏 JSON: name/tags', p.name);
  check(p.body === '正文段落在这里。', '围栏 JSON: 正文', p.body);
}

// ===== 2c. ---json 显式标记 + 语法错误必须报错 =====
{
  const ok = parseSkillText('---json\n{"name": "marked", "description": "标记描述"}\n---\n正文内容够长。', 'SKILL.md');
  check(ok.format === 'json' && ok.name === 'marked', '---json 标记 → 解析成功', ok.name);
  const bad = parseSkillText('---json\n{"name": broken,}\n---\n正文', 'SKILL.md');
  check(bad.error !== undefined && bad.error.includes('JSON'), '---json 语法错 → 致命报错', bad.error);
}

// ===== 2d. .json 文件语法错误必须报错；markdown 以 { 开头但非法 → 降级 =====
{
  const bad = parseSkillText('{ not valid json }', 'meta.json');
  check(bad.error?.includes('JSON 解析失败'), '.json 语法错 → 致命', bad.error);
  const md = parseSkillText('{ 这是正文的花括号开头\n\n普通 markdown。', 'note.md');
  check(md.error === undefined && md.format === 'plain', 'md 以 { 开头但非法 JSON → 降级 plain', md.format);
}

// ===== 3. 无 frontmatter 降级 =====
{
  const p = parseSkillText('# 标题\n\n这是第一段正文，用于提取描述兜底。\n\n第二段。', 'my-cool-skill.md');
  check(p.format === 'plain' && !p.hasFrontmatter, '无 frontmatter → plain');
  check(p.name === 'my-cool-skill', '降级: 文件名推技能名', p.name);
  check(p.description.startsWith('这是第一段正文'), '降级: 首段提描述', p.description);
  const empty = parseSkillText('   ', 'x.md');
  check(empty.error !== undefined, '空文件 → 报错', empty.error);
}

// ===== 4a. isZipBytes =====
{
  check(isZipBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])), 'zip 魔数命中');
  check(!isZipBytes(new Uint8Array([0x23, 0x21, 0x0a, 0x00])), '非 zip 魔数拒绝');
}

// ===== 4b. zip：根目录包裹 + 附件清单 + 垃圾过滤 =====
{
  const z = zipSync({
    'my-skill/SKILL.md': new TextEncoder().encode('---\nname: zip-skill\ndescription: zip 内的描述\nversion: 3.0.0\ntags: [zip, pack]\n---\n\n# 正文\n\nzip 内 SKILL.md 的正文。'),
    'my-skill/references/extra.md': new TextEncoder().encode('# 附属文档\n\n附件内容。'),
    'my-skill/scripts/run.py': new TextEncoder().encode('print("hello")\n'),
    'my-skill/.DS_Store': new Uint8Array([0, 1, 2]),
    '__MACOSX/my-skill/SKILL.md': new Uint8Array([0]),
    'my-skill/': new Uint8Array(0),
  });
  const r = extractSkillZip(z, 'my-skill.zip');
  check(r.skillPath === 'my-skill/SKILL.md', 'zip: 定位 SKILL.md', r.skillPath);
  check(r.meta.name === 'zip-skill' && r.meta.version === '3.0.0', 'zip: SKILL.md 元数据', r.meta.name);
  check(r.meta.tags.join(',') === 'zip,pack', 'zip: tags', r.meta.tags);
  check(r.attachments.length === 2, `zip: 附件 2 个（过滤垃圾）→ ${r.attachments.length}`, r.attachments.map(a => a.path));
  check(r.attachments.some(a => a.path === 'references/extra.md'), 'zip: 已剥离根目录 my-skill/');
  check(r.warnings.some(w => w.includes('剥离')), 'zip: 剥离根目录有提示', r.warnings);
}

// ===== 4c. zip：无根目录包裹（SKILL.md 在顶层）=====
{
  const z = zipSync({
    'SKILL.md': new TextEncoder().encode('---\nname: flat-skill\ndescription: 顶层 SKILL.md\n---\n\n正文内容足够长。'),
    'references/a.md': new TextEncoder().encode('A'),
  });
  const r = extractSkillZip(z, 'flat.zip');
  check(r.skillPath === 'SKILL.md', 'zip 平铺: SKILL.md 顶层', r.skillPath);
  check(r.attachments.length === 1 && r.attachments[0].path === 'references/a.md', 'zip 平铺: 附件路径不被截断');
  check(!r.warnings.some(w => w.includes('剥离')), 'zip 平铺: 无剥离警告');
}

// ===== 4d. zip：SKILL.md 无 frontmatter → skill.json 补元数据 =====
{
  const z = zipSync({
    'pkg/SKILL.md': new TextEncoder().encode('# 纯正文技能\n\n没有 frontmatter 的正文。'),
    'pkg/skill.json': new TextEncoder().encode(JSON.stringify({
      name: 'from-json', description: 'skill.json 提供的描述', category: 'productivity',
      tags: ['meta'], version: '1.2.3', author: 'jsoner', license: 'Apache-2.0',
    })),
    'pkg/notes.md': new TextEncoder().encode('N'),
  });
  const r = extractSkillZip(z, 'pkg.zip');
  check(r.meta.format === 'plain', 'skill.json: SKILL.md 确为 plain');
  check(r.meta.name === 'from-json', 'skill.json: 补 name', r.meta.name);
  check(r.meta.description === 'skill.json 提供的描述', 'skill.json: 补 description', r.meta.description);
  check(r.meta.category === 'productivity' && r.meta.version === '1.2.3', 'skill.json: 补 category/version');
  check(r.warnings.some(w => w.includes('补全元数据')), 'skill.json: 有补全提示');
}

// ===== 4e. zip：缺 SKILL.md / 非 zip 字节 → 中文报错 =====
{
  let err = '';
  try { extractSkillZip(zipSync({ 'readme.md': new TextEncoder().encode('x') }), 'x.zip'); }
  catch (e) { err = (e as Error).message; }
  check(err.includes('SKILL.md'), 'zip 缺 SKILL.md → 报错', err);

  err = '';
  try { extractSkillZip(new Uint8Array([1, 2, 3, 4, 5]), 'x.zip'); }
  catch (e) { err = (e as Error).message; }
  check(err.includes('解压失败') || err.includes('没有'), '非 zip 字节 → 解压报错', err);
}

// ===== 4f. zip：非法路径附件被忽略（路径穿越防御）=====
{
  const z = zipSync({
    'SKILL.md': new TextEncoder().encode('---\ndescription: 防御测试描述\n---\n\n正文。'),
    'references/ok.md': new TextEncoder().encode('ok'),
    'evil/../etc/passwd': new TextEncoder().encode('pwn'),
    'back\\slash.md': new TextEncoder().encode('b'),
    'sub/SKILL.md': new TextEncoder().encode('second'),
    'index.html': new TextEncoder().encode('<html>'),
  });
  const r = extractSkillZip(z, 'evil.zip');
  check(r.attachments.some(a => a.path === 'references/ok.md'), '防御: 合法附件保留');
  check(!r.attachments.some(a => a.path.includes('..')), '防御: ../ 路径被过滤', r.attachments.map(a => a.path));
  check(!r.attachments.some(a => a.path.includes('\\')), '防御: 反斜杠路径被过滤', r.attachments.map(a => a.path));
  check(!r.attachments.some(a => a.path.toLowerCase() === 'index.html'), '防御: index.html 被过滤');
  check(!r.attachments.some(a => a.path.toLowerCase().endsWith('skill.md')), '防御: 嵌套 SKILL.md 不进附件');
}

// ===== 4g. invalidAttachmentPath 单测 =====
{
  check(invalidAttachmentPath('references/a.md') === null, '路径: references/a.md 合法');
  check(invalidAttachmentPath('../x.md') !== null, '路径: ../ 拒绝');
  check(invalidAttachmentPath('/abs.md') !== null, '路径: 绝对路径拒绝');
  check(invalidAttachmentPath('a\\b.md') !== null, '路径: 反斜杠拒绝');
  check(invalidAttachmentPath('SKILL.md') !== null, '路径: SKILL.md 拒绝');
  check(invalidAttachmentPath('index.html') !== null, '路径: index.html 拒绝');
  check(invalidAttachmentPath('中文名.md') !== null, '路径: 非白名单字符拒绝');
}

// ===== 4h. 附件限额：单文件 >1MB =====
{
  const big = new Uint8Array(1024 * 1024 + 10);
  big.fill(65);
  let err = '';
  try {
    extractSkillZip(zipSync({
      'SKILL.md': new TextEncoder().encode('---\ndescription: 限额测试描述\n---\n\n正文。'),
      'big.txt': big,
    }), 'big.zip');
  } catch (e) { err = (e as Error).message; }
  check(err.includes('1MB'), '限额: 单文件 >1MB 拒绝', err);
}

// ===== 5. 真实 demo 技能 zip 打包回归（ascii-video）=====
{
  const skillMd = readFileSync(join(ROOT, 'demo-skills/creative/ascii-video/SKILL.md'));
  const archMd = readFileSync(join(ROOT, 'demo-skills/creative/ascii-video/references/architecture.md'));
  const z = zipSync({
    'ascii-video/SKILL.md': skillMd,
    'ascii-video/references/architecture.md': archMd,
  });
  const r = extractSkillZip(z, 'ascii-video.zip');
  check(r.meta.name.length > 0 && r.meta.tags.length > 0, `真实技能 zip: 元数据 name=${r.meta.name} tags=${r.meta.tags.length}`);
  check(r.attachments.length === 1 && r.attachments[0].path === 'references/architecture.md', '真实技能 zip: 附件路径');
  check(r.meta.body.length > 1000, `真实技能 zip: 正文 ${r.meta.body.length} 字符`);
}

console.log(failed ? `\n✗ ${failed} 项失败` : '\n✓ 全部通过');
process.exit(failed ? 1 : 0);
