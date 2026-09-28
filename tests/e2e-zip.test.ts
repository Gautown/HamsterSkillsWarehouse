#!/usr/bin/env bun
/**
 * e2e-zip.test.ts — .zip 打包技能 / JSON frontmatter 上传端到端验收
 *
 * 走真实客户端代码路径：fflate 造包 → extractSkillZip + encodeAttachment（前端同源函数）
 * → POST /api/publish（files 附件）→ 后台重建 → 详情页 + /skills/<cat>/<name>/<附件> 静态访问
 * → PUT 全量替换附件 → 清空附件 → DELETE 下架复原。
 *
 * 用法：BASE=http://127.0.0.1:4311 bun run tests/e2e-zip.test.ts
 */
import { zipSync, strToU8 } from 'fflate';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { encodeAttachment, extractSkillZip } from '../.vitepress/theme/skill-parse';

const BASE = Bun.env.BASE ?? 'http://127.0.0.1:4311';
const ROOT = join(import.meta.dir, '..');
const CUSTOM_DIR = join(ROOT, '.custom-skills');
const CAT = 'qa';
const NAME = 'zip-demo';
const SKILL_DIR = join(CUSTOM_DIR, CAT, NAME);
const PASS = 'qa-zip-pass-123';
const USER = `qa-zip-${Date.now().toString(36)}`;
const STAMP = new Date().toISOString();

let cookie = '';
const report: string[] = [];
let failed = 0;
function check(cond: boolean, msg: string): void {
  report.push(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failed++;
}
/** 致命断言：失败立即打印上下文并退出（避免被后续 ENOENT 掩盖真实原因） */
function fatal(cond: boolean, msg: string, ctx?: unknown): void {
  check(cond, msg);
  if (!cond) {
    console.error(`\n✗ 致命失败：${msg}`);
    if (ctx !== undefined) console.error('  上下文:', JSON.stringify(ctx, null, 2));
    console.error('\n--- 已收集报告 ---');
    for (const line of report) console.error(line);
    process.exit(1);
  }
}

async function req(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: any; raw: Uint8Array; text: string }> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, data, raw: bytes, text };
}

/** 等后台重建收尾：runs 增加且 building/queued 均归位 */
async function waitRebuild(prevRuns: number, timeoutMs = 240_000): Promise<any> {
  const start = Date.now();
  await Bun.sleep(900);
  while (Date.now() - start < timeoutMs) {
    const st = (await req('GET', '/api/rebuild/status')).data;
    if (!st.building && !st.queued && st.runs > prevRuns) return st;
    await Bun.sleep(1500);
  }
  return null;
}
async function rebuildState(): Promise<any> {
  return (await req('GET', '/api/rebuild/status')).data;
}
function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ===== 构造 zip 技能包（根目录包裹 + 系统垃圾 + 二进制附件）=====
const GUIDE = '# 引用文档\n\n这是 zip 包内的引用文档，正文附件清单里的直链可达。\n';
const RUN_PY = '#!/usr/bin/env python3\nprint("zip attachment script")\n';
const NOTES = '# 变更说明\n\n编辑阶段全量替换后新增的附件。\n';
const BIN = new Uint8Array(1024);
for (let i = 0; i < BIN.length; i++) BIN[i] = (i * 7 + 128) & 0xff; // 非 utf8 → 应转 base64

const SKILL_MD = `---
name: zip-demo
description: zip 打包技能端到端验收（含多文件与二进制附件）${STAMP}
version: 1.4.2
author: qa-zipper
license: Apache-2.0
metadata:
  hermes:
    tags: [zip-upload, multi-file, e2e]
---

# zip-demo

由 .zip 上传链路生成的技能正文（多文件包）。

## 附件

包内 references/guide.md、scripts/run.py、assets/logo.bin 应随发布落盘并可静态访问。
`;

const zipBytes = zipSync({
  'zip-demo/': new Uint8Array(0),                  // 目录条目（应忽略）
  'zip-demo/SKILL.md': strToU8(SKILL_MD),
  'zip-demo/references/guide.md': strToU8(GUIDE),
  'zip-demo/scripts/run.py': strToU8(RUN_PY),
  'zip-demo/assets/logo.bin': BIN,
  'zip-demo/skill.json': strToU8(JSON.stringify({ name: 'ignored-because-yaml-exists' })),
  'zip-demo/.hidden/x.txt': strToU8('hidden'),      // 隐藏目录 → 忽略
  '.DS_Store': strToU8('junk'),                     // 系统垃圾 → 忽略
  '__MACOSX/._SKILL.md': strToU8('junk'),           // macOS 资源叉 → 忽略
});

console.log(`▸ 目标 ${BASE}  测试用户 ${USER}  zip ${zipBytes.length} 字节`);

const extracted = extractSkillZip(zipBytes, 'zip-demo.zip');
const payloadBase = {
  category: CAT,
  name: NAME,
  description: extracted.meta.description,
  body: extracted.meta.body,
  tags: extracted.meta.tags,
  version: extracted.meta.version,
  author: extracted.meta.author,
  license: extracted.meta.license,
};
const sentFiles = extracted.attachments.map(a => encodeAttachment(a.path, a.bytes));
const EXPECT_PATHS = 'assets/logo.bin,references/guide.md,scripts/run.py,skill.json';

// 0) 客户端解包自检（不依赖服务端）
check(extracted.meta.name === 'zip-demo', `解包 name=${extracted.meta.name}`);
check(extracted.meta.format === 'yaml' && extracted.meta.hasFrontmatter, '解包 format=yaml');
check(extracted.skillPath === 'zip-demo/SKILL.md', `解包 skillPath=${extracted.skillPath}`);
check(EXPECT_PATHS === sentFiles.map(f => f.path).sort().join(','), `附件清单 = ${sentFiles.map(f => f.path).sort().join(', ')}`);
check(extracted.warnings.some(w => w.includes('剥离')), `已剥离根目录（${extracted.warnings.join(' | ')}）`);
check(sentFiles.find(f => f.path === 'assets/logo.bin')?.encoding === 'base64', '二进制附件转 base64');
check(sentFiles.find(f => f.path === 'references/guide.md')?.encoding === 'utf8', '文本附件保持 utf8');
check(sentFiles.every(f => !/skill\.md$/i.test(f.path)), 'SKILL.md 不进附件');

// 1) 健康 + 未登录拒绝 + 注册
const health = await req('GET', '/api/health');
check(health.status === 200 && health.data.ok, `GET /api/health → ${health.status}`);
const anon = await req('POST', '/api/publish', { ...payloadBase, files: sentFiles });
check(anon.status === 401, `未登录发布 → ${anon.status}（期望 401）`);
const reg = await req('POST', '/api/auth/register', { username: USER, password: PASS });
check(reg.status === 201 && reg.data.user?.username === USER, `注册 → ${reg.status} role=${reg.data.user?.role}`);

// 2) 附件校验负例：必须 400，且不触发重建、不落盘
const runsBase = (await rebuildState()).runs ?? 0;
const negatives: Array<[string, unknown, string]> = [
  ['路径穿越', [{ path: '../evil.txt', content: 'x' }], '不合法'],
  ['嵌套穿越', [{ path: 'a/../../evil.txt', content: 'x' }], '不合法'],
  ['附件为 SKILL.md', [{ path: 'SKILL.md', content: 'x' }], 'SKILL.md'],
  ['根级 index.html', [{ path: 'index.html', content: '<html>' }], 'index.html'],
  ['路径重复', [{ path: 'a.md', content: '1' }, { path: 'a.md', content: '2' }], '重复'],
  ['编码不支持', [{ path: 'a.md', content: 'eJw=', encoding: 'gzip' }], '编码'],
  ['files 非数组', 'not-an-array', '数组'],
  ['单文件超 1MB', [{ path: 'big.txt', content: Buffer.alloc(1_200_000, 0x41).toString('base64'), encoding: 'base64' }], '1MB'],
];
for (const [label, files, kw] of negatives) {
  const r = await req('POST', '/api/publish', { ...payloadBase, files });
  const msg = String(r.data?.error ?? '');
  check(r.status === 400 && msg.includes(kw), `负例 ${label} → ${r.status} ${msg}`);
}
const runsAfterNeg = (await rebuildState()).runs ?? 0;
check(runsAfterNeg === runsBase, `负例未触发重建（runs ${runsBase} → ${runsAfterNeg}）`);
check(!existsSync(SKILL_DIR), '负例未落盘（.custom-skills 未创建技能目录）');

// 3) 发布（zip 解包附件随表单 files 提交）
let runs = (await rebuildState()).runs ?? 0;
const pub = await req('POST', '/api/publish', { ...payloadBase, files: sentFiles });
fatal(
  pub.status === 202 && pub.data.ok === true && pub.data.files === sentFiles.length,
  `发布 → ${pub.status} files=${pub.data.files} ${pub.data.message ?? pub.data.error ?? ''}`,
  { status: pub.status, body: pub.data }
);

// 3a) 落盘即时校验（不等重建）：目录结构 + 内容一致 + 垃圾未进 + base64 解码正确
check(existsSync(join(SKILL_DIR, 'SKILL.md')), '落盘: SKILL.md 已生成');
check(readFileSync(join(SKILL_DIR, 'references', 'guide.md'), 'utf-8') === GUIDE, '落盘: 文本附件内容一致');
check(readFileSync(join(SKILL_DIR, 'scripts', 'run.py'), 'utf-8') === RUN_PY, '落盘: 深层附件目录已创建');
const binOnDisk = new Uint8Array(readFileSync(join(SKILL_DIR, 'assets', 'logo.bin')));
check(bytesEq(binOnDisk, BIN), `落盘: 二进制附件字节一致（${binOnDisk.length}/${BIN.length}）`);
check(
  !existsSync(join(SKILL_DIR, '.DS_Store')) && !existsSync(join(SKILL_DIR, '__MACOSX')) && !existsSync(join(SKILL_DIR, '.hidden')),
  '落盘: 隐藏文件/系统垃圾未写入'
);
const mdOnDisk = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8');
check(mdOnDisk.includes(`publisher: ${JSON.stringify(USER)}`), '落盘: publisher 由会话注入');
check(mdOnDisk.includes('zip-upload') && mdOnDisk.includes('# zip-demo'), '落盘: tags 归一化 + 正文已渲染');

// 3b) 等后台重建生效 → 详情页 + 附件静态可访问
let st = await waitRebuild(runs);
check(st !== null && !st?.lastError, `重建①完成（runs=${st?.runs} ${st?.lastDurationMs}ms）err=${st?.lastError ?? 'none'}`);
const page = await req('GET', `/skills/${CAT}/${NAME}/`);
check(page.status === 200 && page.text.includes(extracted.meta.description), `详情页已生成 → ${page.status}`);
check(/附件文件（\d+）/.test(page.text), '详情页含附件清单区块');
check(page.text.includes('/skills/qa/zip-demo/references/guide.md'), '详情页含附件直链（references/guide.md）');

const stGuide = await req('GET', `/skills/${CAT}/${NAME}/references/guide.md`);
check(stGuide.status === 200 && stGuide.text === GUIDE, `静态访问文本附件 → ${stGuide.status}`);
const stBin = await req('GET', `/skills/${CAT}/${NAME}/assets/logo.bin`);
check(stBin.status === 200 && bytesEq(stBin.raw, BIN), `静态访问二进制附件 → ${stBin.status} ${stBin.raw.length} 字节`);
const stRun = await req('GET', `/skills/${CAT}/${NAME}/scripts/run.py`);
check(stRun.status === 200 && stRun.text === RUN_PY, `静态访问嵌套附件 → ${stRun.status}`);

// 3c) 详情接口的附件清单（编辑表单展示用）
const detail = await req('GET', `/api/skills/${CAT}/${NAME}`);
const listed: string[] = (detail.data.skill?.fileList ?? []).map((f: any) => f.path).sort();
check(detail.status === 200 && detail.data.skill?.fileCount === sentFiles.length, `详情 fileCount=${detail.data.skill?.fileCount}`);
check(listed.join(',') === EXPECT_PATHS, `详情附件清单 = ${listed.join(', ')}`);
check(detail.data.skill?.publisher === USER, `详情 publisher=${detail.data.skill?.publisher}`);

// 4) 编辑：不传 files → 附件必须原样保留
const desc2 = extracted.meta.description.replace(STAMP, `${STAMP}（已编辑）`);
const editNoFiles = await req('PUT', `/api/skills/${CAT}/${NAME}`, {
  description: desc2, body: extracted.meta.body, tags: extracted.meta.tags, version: '1.4.3',
});
check(editNoFiles.status === 202 && editNoFiles.data.ok, `编辑（不传 files）→ ${editNoFiles.status}`);
const detail2 = await req('GET', `/api/skills/${CAT}/${NAME}`);
check(detail2.data.skill?.fileCount === sentFiles.length, `未传 files 时附件保持不变（${detail2.data.skill?.fileCount} 个）`);
check(detail2.data.skill?.description === desc2, '编辑后描述已更新');
check(readFileSync(join(SKILL_DIR, 'scripts', 'run.py'), 'utf-8') === RUN_PY, '未传 files 时磁盘附件未动');

// 5) 编辑：传 files → 全量替换（删旧 + 增新）
const runs2 = (await rebuildState()).runs ?? 0;
const newFiles = [
  encodeAttachment('references/guide.md', strToU8(GUIDE + '\n> 替换后的新内容\n')),
  encodeAttachment('notes/extra.md', strToU8(NOTES)),
];
const editFiles = await req('PUT', `/api/skills/${CAT}/${NAME}`, {
  description: desc2, body: extracted.meta.body, tags: extracted.meta.tags, version: '1.5.0', files: newFiles,
});
check(editFiles.status === 202 && editFiles.data.ok, `编辑（全量替换附件）→ ${editFiles.status} ${editFiles.data.message ?? editFiles.data.error ?? ''}`);
const detail3 = await req('GET', `/api/skills/${CAT}/${NAME}`);
const listed3: string[] = (detail3.data.skill?.fileList ?? []).map((f: any) => f.path).sort();
check(listed3.join(',') === 'notes/extra.md,references/guide.md', `替换后清单 = ${listed3.join(', ')}`);
check(!existsSync(join(SKILL_DIR, 'scripts', 'run.py')), '替换后旧附件已删除');
check(!existsSync(join(SKILL_DIR, 'assets', 'logo.bin')), '替换后二进制旧附件已删除');
check(readFileSync(join(SKILL_DIR, 'references', 'guide.md'), 'utf-8').includes('替换后的新内容'), '替换后 guide.md 为新内容');

// 等重建 → 旧附件静态 404、新附件 200、详情页清单同步
st = await waitRebuild(runs2);
check(st !== null && !st?.lastError, `重建②完成（runs=${st?.runs} ${st?.lastDurationMs}ms）err=${st?.lastError ?? 'none'}`);
const gone = await req('GET', `/skills/${CAT}/${NAME}/scripts/run.py`);
check(gone.status === 404, `重建后旧附件 404 → ${gone.status}`);
const fresh = await req('GET', `/skills/${CAT}/${NAME}/notes/extra.md`);
check(fresh.status === 200 && fresh.text === NOTES, `重建后新附件 200 → ${fresh.status}`);
const page2 = await req('GET', `/skills/${CAT}/${NAME}/`);
check(page2.status === 200 && page2.text.includes(desc2) && page2.text.includes('notes/extra.md'), '详情页附件清单已同步替换');

// 6) 清空附件（files: [] = 全量替换为空）
const editClear = await req('PUT', `/api/skills/${CAT}/${NAME}`, {
  description: desc2, body: extracted.meta.body, tags: extracted.meta.tags, files: [],
});
check(editClear.status === 202 && editClear.data.ok, `编辑（清空附件）→ ${editClear.status}`);
const detail4 = await req('GET', `/api/skills/${CAT}/${NAME}`);
check(detail4.data.skill?.fileCount === 0, `清空后 fileCount=${detail4.data.skill?.fileCount}`);
check(!existsSync(join(SKILL_DIR, 'notes', 'extra.md')), '清空后磁盘附件已移除');
check(readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8').includes('name: zip-demo'), '清空附件不影响 SKILL.md');

// 7) 下架复原（附件目录随技能一并移除）
const runs3 = (await rebuildState()).runs ?? 0;
const del = await req('DELETE', `/api/skills/${CAT}/${NAME}`);
check(del.status === 202 && del.data.ok, `下架 → ${del.status} ${del.data.message ?? del.data.error ?? ''}`);
check(!existsSync(SKILL_DIR), '下架后 .custom-skills 目录已移入暂存区');
st = await waitRebuild(runs3);
check(st !== null && !st?.lastError, `重建③完成（runs=${st?.runs} ${st?.lastDurationMs}ms）err=${st?.lastError ?? 'none'}`);
const gonePage = await req('GET', `/skills/${CAT}/${NAME}/`);
check(gonePage.status === 404, `下架后详情页 404 → ${gonePage.status}`);
const goneAtt = await req('GET', `/skills/${CAT}/${NAME}/notes/extra.md`);
check(goneAtt.status === 404, `下架后附件 404 → ${goneAtt.status}`);

// 8) 登出
check((await req('POST', '/api/auth/logout')).status === 200, '登出 → 200');
check((await req('GET', '/api/auth/me')).status === 401, '登出后 /api/auth/me → 401');

console.log(report.join('\n'));
console.log(`\n结果：${failed === 0 ? '全部通过' : failed + ' 项失败'}（共 ${report.length} 项）`);
console.log(`CLEANUP_USER=${USER}`);
process.exit(failed === 0 ? 0 : 1);



