#!/usr/bin/env bun
/**
 * fetch-remote.ts — 从官方 Hermes Skills Hub 的 catalog 页面拉取技能清单
 *
 * 数据源（SSR HTML，无需 API/代理）：
 *   /docs/zh-Hans/reference/skills-catalog          → bundled 技能
 *   /docs/zh-Hans/reference/optional-skills-catalog → optional 技能
 *
 * 产物：.remote-skills.json
 *   [{ name, description, category, path, remote: 'bundled'|'optional',
 *      detailUrl }]
 * 用途：scan-skills.ts 合并时对本地不存在的技能补充收录（卡片外链官方站）
 *
 * 运行：bun run fetch-remote（手动/CI；网络失败不阻塞，保留上次数据）
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const BASE = 'https://hermes-agent.nousresearch.com';
const ROOT = resolve(import.meta.dir, '..');
const OUT = resolve(ROOT, '.remote-skills.json');

interface RemoteSkill {
  name: string;
  description: string;
  category: string;
  path: string;
  remote: 'bundled' | 'optional';
  detailUrl: string;
}

/** 从 catalog 页 SSR HTML 提取技能表格
 *  实际结构（Docusaurus 中文站）：
 *    <h2>apple\u200b</h2>                        ← 分类（含零宽字符）
 *    <tr><td><a href><code>apple-notes</code></a></td>
 *        <td>描述</td><td><code>apple/apple-notes</code></td></tr> */
function parseCatalog(html: string, kind: 'bundled' | 'optional'): RemoteSkill[] {
  const out: RemoteSkill[] = [];
  let category = '';
  const re = /<h2[^>]*>((?:(?!<\/h2>)[\s\S])*)<\/h2>|<tr[^>]*>([\s\S]*?)<\/tr>/g;
  for (const m of html.matchAll(re)) {
    if (m[1] !== undefined) {
      // h2 内容含 hash-link anchor：<h2 id>apple<a ...>\u200b</a></h2>
      // 分类名 = 第一个 <a 之前的文本
      category = m[1].split('<a')[0].replace(/\u200b/g, '').trim();
      continue;
    }
    if (!m[2]) continue;
    const row = m[2];
    // 技能链接：<a href><code>name</code></a> 或 <a href><strong>name</strong></a>
    const link = row.match(/<a[^>]*href="([^"]+)"[^>]*>(?:<(?:code|strong)>[^<]*<\/(?:code|strong)>|<code>[^<]*<\/code>|[^<]+)<\/a>/);
    if (!link) continue;
    const detailUrl = link[1].startsWith('http') ? link[1] : BASE + link[1];
    const nameM = row.match(/<(?:strong|code)[^>]*>\s*`?([^<]+?)`?\s*<\/(?:strong|code)>/);
    const name = (nameM ? nameM[1] : decodeURIComponent(link[1].split('/').pop() ?? '')).trim();
    // 描述：第一个 </a></td> 之后到 </td> 的文本（去标签）
    const tds = row.split(/<\/td>/);
    const desc = (tds[1] ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    // 路径：最后一个 td 里的 code（bundled 页有路径列；optional 页无路径列，
    // 从 detailUrl 提取 …/optional/<cat>/<cat>-<name> → cat/name）
    const pm = (tds[2] ?? '').match(/`?([a-z0-9-]+\/[a-z0-9-]+)`?/i);
    let path: string;
    if (pm) {
      path = pm[1];
    } else {
      const um = detailUrl.match(/\/optional\/([a-z0-9-]+)\/([a-z0-9-]+)-([a-z0-9-]+)$/i)
        ?? detailUrl.match(/\/bundled\/([a-z0-9-]+)\/([a-z0-9-]+)-([a-z0-9-]+)$/i);
      path = um ? `${um[1]}/${um[3]}` : `${category}/${name}`;
    }
    // optional 页分类从 URL 兜底（h2 顺序正常时直接用扫描到的 category）
    const catFromUrl = detailUrl.match(/\/(?:optional|bundled)\/([a-z0-9-]+)\//i);
    const cat = category || (catFromUrl ? catFromUrl[1] : 'other');
    out.push({ name, description: desc, category: cat, path, remote: kind, detailUrl });
  }
  return out;
}

async function fetchPage(path: string): Promise<string> {
  const res = await fetch(BASE + path, {
    headers: { 'user-agent': 'SkillsWarehouse/1.0 (fetch-remote)' },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.text();
}

const [bundledHtml, optionalHtml] = await Promise.all([
  fetchPage('/docs/zh-Hans/reference/skills-catalog'),
  fetchPage('/docs/zh-Hans/reference/optional-skills-catalog'),
]);

const bundled = parseCatalog(bundledHtml, 'bundled');
const optional = parseCatalog(optionalHtml, 'optional');
const all = [...bundled, ...optional];

// 按去重键（category/name）去重
const seen = new Set<string>();
const deduped = all.filter(s => {
  const k = `${s.category}/${s.name}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), skills: deduped }, null, 2));
console.log(`✓ 远程技能清单: bundled ${bundled.length} + optional ${optional.length} → 去重后 ${deduped.length}`);
console.log(`✓ 数据 → .remote-skills.json`);
const catCount = new Map<string, number>();
for (const s of deduped) catCount.set(s.category, (catCount.get(s.category) ?? 0) + 1);
for (const [c, n] of [...catCount.entries()].sort()) console.log(`  - ${c}: ${n}`);
