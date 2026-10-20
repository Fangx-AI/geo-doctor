#!/usr/bin/env node
// geo-publish · geo-doctor
// Batch-check, publish and package the articles GEO Doctor wrote. No dependencies.
// 批量检查、发布和打包 GEO 医生写好的文章。零依赖。
//
//   npx -p github:Fangx-AI/geo-doctor geo-publish check geo/drafts
//
// Your own site is published automatically (static HTML, WordPress or any HTTP API).
// Third-party platforms (Zhihu, WeChat, Xiaohongshu…) are packaged for a person to paste
// and publish: the script never logs in to or posts on someone else's platform.
// 自己的官网可以自动发布；知乎、公众号、小红书等第三方平台只打包好，由人点发布，脚本不会登录或代发。
// SPDX-License-Identifier: MIT

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERSION = '1.0.0';
const UA = 'geo-doctor-publish/1.0 (+https://github.com/Fangx-AI/geo-doctor)';

export const SITE = 'site';
// Third-party platforms we package for manual publishing. 只打包、由人发布的第三方平台。
export const PLATFORMS = {
  zhihu: { ext: 'md', editor: 'https://zhuanlan.zhihu.com/write' },
  wechat: { ext: 'html', editor: 'https://mp.weixin.qq.com/' },
  toutiao: { ext: 'html', editor: 'https://mp.toutiao.com/' },
  baijiahao: { ext: 'html', editor: 'https://baijiahao.baidu.com/' },
  sohu: { ext: 'html', editor: 'https://mp.sohu.com/' },
  xiaohongshu: { ext: 'txt', editor: 'https://creator.xiaohongshu.com/', titleMax: 20, bodyMax: 1000 },
  juejin: { ext: 'md', editor: 'https://juejin.cn/editor/drafts/new' },
  medium: { ext: 'md', editor: 'https://medium.com/new-story' },
  reddit: { ext: 'md', editor: 'https://www.reddit.com/submit' },
};
const KNOWN = new Set([SITE, ...Object.keys(PLATFORMS)]);

// Wording that needs proof or breaks advertising rules. Warnings, not errors: context matters.
// 需要证据或可能违反广告法的说法。只提醒不拦截，因为要看上下文。
const HYPE = {
  zh: ['最好的', '最佳', '排名第一', '行业第一', '销量第一', '全国第一', '首选', '顶级', '极致', '国家级', '全网最', '史上最', '100%', '百分百',
    '绝对', '万能', '唯一一', '行业领先', '遥遥领先', '颠覆', '保证', '零风险'],
  en: ['the best', 'best-in-class', '#1', 'number one', 'guaranteed', 'guarantee', '100%', 'world-class', 'revolutionary', 'unbeatable', 'industry-leading', 'risk-free'],
};
const PLACEHOLDER = /\[(待确认|待补充|待核实|TODO|TBD)\]|【(待确认|待补充|待核实)】|\bTODO\b|\bTBD\b|(?<![A-Za-z])XX(?![A-Za-z])|××|\{\{/;
const REVIEW = /(网友|用户|买家|客户)(评价|说|反馈|好评)\s*[:：]|\b(customer|user) (review|testimonial)s?\s*:/i;
// Everything from this heading on is the internal fact-check table and is never published.
// 从这个标题开始是内部核对表，永远不会被发布。
const INTERNAL = /^#{1,6}\s*(核对表|核对清单|发布前核对|事实核对|fact[- ]?check(list)?|internal notes?)\s*$/im;
const CONFIRMED = new Set(['confirmed', '已确认', 'ok']);
const NEAR_DUP = 0.6;

const M = {
  zh: {
    usage: `geo-publish ${VERSION} · GEO 医生的批量发布工具

用法：
  geo-publish check <草稿目录>                     检查所有草稿
  geo-publish site  <草稿目录> --to static --out <目录> [--base-url 网址]
  geo-publish site  <草稿目录> --to wordpress --site 网址 --user 用户名 [--status draft|publish]
  geo-publish site  <草稿目录> --to http --endpoint 网址 [--token-env 变量名] [--header "名: 值"]
  geo-publish pack  <草稿目录> [--out 目录] [--platforms zhihu,wechat,...] [--brand 品牌名]
  geo-publish log   --slug 文章 --platform 平台 --url 链接

选项：
  --facts 文件        事实卡（默认读草稿目录上一级的 fact-card.yaml）
  --log 文件          发布记录（默认草稿目录上一级的 published.csv）
  --dry-run           只显示会做什么，不写文件、不发请求
  --json              check 输出 JSON
  --lang zh|en        输出语言（默认跟随系统）

WordPress 用"应用密码"登录，密码从环境变量 GEO_WP_APP_PASSWORD 读取，不要写在命令里。
只有 status: confirmed 的草稿会被发布或打包。第三方平台只打包，由你本人粘贴、检查、点发布。`,
    noDir: (d) => `找不到草稿目录：${d}`,
    noDrafts: (d) => `${d} 里没有 .md 草稿`,
    unknownCmd: (c) => `不认识的命令：${c}`,
    need: (f) => `缺少 ${f}`,
    badTo: '--to 只能是 static、wordpress 或 http',
    badStatus: '--status 只能是 draft 或 publish',
    noPass: '请先设置环境变量 GEO_WP_APP_PASSWORD（WordPress 后台 → 用户 → 应用密码）',
    noToken: (v) => `环境变量 ${v} 没有值`,
    badHeader: (h) => `--header 格式应为 "名: 值"：${h}`,
    blocked: (n) => `有 ${n} 个错误，先修好再发布。运行 geo-publish check 查看详情。`,
    nothing: '没有可发布的草稿：只有 status: confirmed 且 platforms 里包含对应平台的草稿才会处理。',
    skipped: (n) => `跳过 ${n} 篇未确认的草稿`,
    checkHead: (n, e, w) => `检查了 ${n} 篇草稿：${e} 个错误，${w} 个提醒`,
    checkOk: '可以发布的草稿：',
    wrote: (f) => `已写入 ${f}`,
    removed: (f) => `已删除不再发布的页面 ${f}`,
    noFactFile: (f) => `找不到事实卡 ${f}`,
    sent: (slug, url, st) => `已发布 ${slug} → ${url}（${st}）`,
    updated: (slug, url, st) => `已更新 ${slug} → ${url}（${st}）`,
    dry: (what) => `[演练] ${what}`,
    httpFail: (code, msg) => `请求失败：HTTP ${code}${msg ? ' · ' + msg : ''}`,
    logged: (f) => `已记录到 ${f}`,
    packed: (n, d) => `已打包 ${n} 份稿件到 ${d}，按 ${d}/README.md 的清单逐个发布`,
    issues: {
      'no-frontmatter': '开头缺少 --- 包起来的文章信息（标题、slug、问题、状态等）',
      missing: (f) => `缺少字段 ${f}`,
      'bad-slug': (s) => `slug "${s}" 只能用小写字母、数字和连字符`,
      'dup-slug': (s, o) => `slug "${s}" 和 ${o} 重复`,
      'bad-platform': (p) => `不认识的平台 ${p}，可选：${[...KNOWN].join('、')}`,
      'bad-status': (s) => `status "${s}" 只能是 draft 或 confirmed`,
      placeholder: (m) => `还有占位符「${m}」没填`,
      'unknown-fact': (id) => `事实卡里没有编号 ${id}`,
      'unconfirmed-fact': (id, st) => `事实 ${id} 的状态是"${st}"，只有已确认的事实能写进文章`,
      'no-facts': '没有标注用到了哪些事实卡编号（facts 字段），发布前请核对',
      'no-fact-card': (f) => `用到了事实卡编号，但找不到事实卡 ${f}，无法核对；用 --facts 指定路径`,
      hype: (w) => `用了需要证据的说法「${w}」，确认有依据或改掉`,
      review: '像是引用了用户评价，确认有真实、可公开的出处，不能编',
      'near-dup': (o, p) => `和 ${o} 有 ${p}% 相似，同一内容换个说法重复发属于低质内容，合并或重写`,
      short: (n) => `正文只有约 ${n} 字，可能不足以回答问题`,
      'no-description': '缺少 description（搜索结果和 AI 摘要会用到）',
      draft: '状态还是 draft：确认内容后改成 confirmed 才会发布',
    },
    pack: {
      title: (d) => `# 发布清单（${d} 生成）`,
      intro: '下面这些平台需要你本人发布：打开编辑器 → 粘贴稿件 → 通读、配图 → 点发布。发布后把链接记下来，复查时会用到：',
      cols: '| 文章 | 平台 | 稿件 | 编辑器 | 注意 |',
      general: '每个平台都请按平台要求标注 AI 辅助创作，用实名或机构号，写明你和产品的关系。不要在同一平台用多个账号发同一内容。',
      notes: {
        zhihu: '粘贴 Markdown 后检查排版；回答已有问题时只答这个问题，写明身份',
        wechat: '用浏览器打开 .html，全选复制，粘贴到公众号编辑器',
        toutiao: '用浏览器打开 .html，全选复制，粘贴到头条号编辑器',
        baijiahao: '用浏览器打开 .html，全选复制，粘贴到百家号编辑器',
        sohu: '用浏览器打开 .html，全选复制，粘贴到搜狐号编辑器',
        xiaohongshu: '需要配图；标题和正文长度以平台当前规则为准。AI 很少引用小红书，主要用于触达用户',
        juejin: 'Markdown 编辑器直接粘贴',
        medium: '粘贴后检查标题和链接',
        reddit: '先读版规，很多版块禁止自我推广；保留开头的利益披露',
      },
      disclosure: (b) => `利益相关：我是${b}团队成员。`,
      original: (u) => `原文：${u}`,
      tooLong: (what, n, max) => `${what}约 ${n} 字，超过建议的 ${max} 字`,
      titleW: '标题', bodyW: '正文',
      noBrand: '没有品牌名：用 --brand 或在草稿里写 brand 字段，Reddit 稿件开头的利益披露需要它',
    },
  },
  en: {
    usage: `geo-publish ${VERSION} · batch publishing for GEO Doctor

Usage:
  geo-publish check <drafts-dir>                    check every draft
  geo-publish site  <drafts-dir> --to static --out <dir> [--base-url URL]
  geo-publish site  <drafts-dir> --to wordpress --site URL --user NAME [--status draft|publish]
  geo-publish site  <drafts-dir> --to http --endpoint URL [--token-env VAR] [--header "Name: value"]
  geo-publish pack  <drafts-dir> [--out dir] [--platforms zhihu,medium,...] [--brand NAME]
  geo-publish log   --slug SLUG --platform PLATFORM --url URL

Options:
  --facts file        fact card (default: fact-card.yaml next to the drafts folder)
  --log file          publishing log (default: published.csv next to the drafts folder)
  --dry-run           show what would happen; write nothing, send nothing
  --json              JSON output for check
  --lang zh|en        output language (default: system locale)

WordPress uses an application password read from the GEO_WP_APP_PASSWORD environment variable, never from the command line.
Only drafts with status: confirmed are published or packaged. Third-party platforms are only packaged: you paste, review and publish.`,
    noDir: (d) => `Drafts folder not found: ${d}`,
    noDrafts: (d) => `No .md drafts in ${d}`,
    unknownCmd: (c) => `Unknown command: ${c}`,
    need: (f) => `Missing ${f}`,
    badTo: '--to must be static, wordpress or http',
    badStatus: '--status must be draft or publish',
    noPass: 'Set GEO_WP_APP_PASSWORD first (WordPress admin → Users → Application Passwords)',
    noToken: (v) => `Environment variable ${v} is empty`,
    badHeader: (h) => `--header must look like "Name: value": ${h}`,
    blocked: (n) => `${n} error(s). Fix them before publishing; run geo-publish check for details.`,
    nothing: 'Nothing to publish: only drafts with status: confirmed whose platforms include the target are used.',
    skipped: (n) => `Skipped ${n} unconfirmed draft(s)`,
    checkHead: (n, e, w) => `Checked ${n} draft(s): ${e} error(s), ${w} warning(s)`,
    checkOk: 'Ready to publish:',
    wrote: (f) => `Wrote ${f}`,
    removed: (f) => `Removed page no longer published: ${f}`,
    noFactFile: (f) => `Fact card not found: ${f}`,
    sent: (slug, url, st) => `Published ${slug} → ${url} (${st})`,
    updated: (slug, url, st) => `Updated ${slug} → ${url} (${st})`,
    dry: (what) => `[dry run] ${what}`,
    httpFail: (code, msg) => `Request failed: HTTP ${code}${msg ? ' · ' + msg : ''}`,
    logged: (f) => `Logged to ${f}`,
    packed: (n, d) => `Packaged ${n} post(s) in ${d}. Publish them one by one using ${d}/README.md`,
    issues: {
      'no-frontmatter': 'Missing the --- front matter block (title, slug, question, status…)',
      missing: (f) => `Missing field ${f}`,
      'bad-slug': (s) => `Slug "${s}" may only use lowercase letters, digits and hyphens`,
      'dup-slug': (s, o) => `Slug "${s}" is also used by ${o}`,
      'bad-platform': (p) => `Unknown platform ${p}. Known: ${[...KNOWN].join(', ')}`,
      'bad-status': (s) => `Status "${s}" must be draft or confirmed`,
      placeholder: (m) => `Unfilled placeholder "${m}"`,
      'unknown-fact': (id) => `Fact ${id} is not in the fact card`,
      'unconfirmed-fact': (id, st) => `Fact ${id} has status "${st}"; only confirmed facts may be used`,
      'no-facts': 'No fact card IDs listed (facts field); check the claims before publishing',
      'no-fact-card': (f) => `Uses fact card IDs, but the fact card ${f} was not found, so they cannot be checked. Pass --facts <file>`,
      hype: (w) => `Claim needs proof: "${w}". Back it up or rewrite it`,
      review: 'Looks like a quoted review: make sure it is real and you may publish it. Never invent one',
      'near-dup': (o, p) => `${p}% similar to ${o}. Reworded copies are low-quality content: merge or rewrite`,
      short: (n) => `Body is only about ${n} characters; it may not answer the question`,
      'no-description': 'Missing description (used by search results and AI summaries)',
      draft: 'Status is still draft: set it to confirmed once reviewed to publish it',
    },
    pack: {
      title: (d) => `# Publishing checklist (generated ${d})`,
      intro: 'You publish these yourself: open the editor → paste → read it through and add images → publish. Then record the link for the re-test:',
      cols: '| Post | Platform | File | Editor | Notes |',
      general: 'Label AI-assisted content where the platform requires it, post from a real or company account, and disclose your relationship to the product. Never post the same content from several accounts.',
      notes: {
        zhihu: 'Paste the Markdown and check formatting; disclose who you are',
        wechat: 'Open the .html in a browser, select all, copy, paste into the editor',
        toutiao: 'Open the .html in a browser, select all, copy, paste into the editor',
        baijiahao: 'Open the .html in a browser, select all, copy, paste into the editor',
        sohu: 'Open the .html in a browser, select all, copy, paste into the editor',
        xiaohongshu: 'Needs images; check current title and length limits. AI rarely cites Xiaohongshu; it is mainly for reaching people',
        juejin: 'Paste into the Markdown editor',
        medium: 'Check the title and links after pasting',
        reddit: 'Read the subreddit rules first: many ban self-promotion. Keep the disclosure line',
      },
      disclosure: (b) => `Disclosure: I work on ${b}.`,
      original: (u) => `Originally published at ${u}`,
      tooLong: (what, n, max) => `${what} is about ${n} characters, over the suggested ${max}`,
      titleW: 'Title', bodyW: 'Body',
      noBrand: 'No brand name: pass --brand or add a brand field; the Reddit disclosure line needs it',
    },
  },
};

// ---------------------------------------------------------------- drafts

const unquote = (v) => {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
};

// Minimal front matter: `key: value`, `key: [a, b]`, and `key:` followed by `- item` lines.
// 极简 front matter：支持 key: value、key: [a, b] 和多行 - 列表。
export function parseDraft(text) {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = src.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { meta: null, body: src };
  const meta = {}; let listKey = null;
  for (const raw of m[1].split('\n')) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const item = raw.match(/^\s*-\s+(.*)$/);
    if (item && listKey) { meta[listKey].push(unquote(item[1])); continue; }
    const kv = raw.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === '') { meta[key] = []; listKey = key; continue; }
    listKey = null;
    meta[key] = /^\[.*\]$/.test(value.trim())
      ? value.trim().slice(1, -1).split(',').map(unquote).filter(Boolean)
      : unquote(value);
  }
  return { meta, body: src.slice(m[0].length) };
}

const list = (v) => (Array.isArray(v) ? v : v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

export function loadDrafts(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')
    .sort()
    .map((f) => {
      const { meta, body } = parseDraft(readFileSync(join(dir, f), 'utf8'));
      const m = meta || {};
      return {
        file: f, hasMeta: !!meta, meta: m, body,
        slug: m.slug || '', title: m.title || '', lang: m.lang || 'zh',
        platforms: list(m.platforms).length ? list(m.platforms) : [SITE],
        facts: list(m.facts), tags: list(m.tags),
        confirmed: CONFIRMED.has(String(m.status || '').toLowerCase()),
      };
    });
}

// The publishable body: no HTML comments, no internal fact-check table, no repeated H1 title.
// 可发布的正文：去掉 HTML 注释、内部核对表和重复的一级标题。
export function publicBody(d) {
  let b = d.body.replace(/<!--[\s\S]*?-->/g, '');
  const cut = b.search(INTERNAL);
  if (cut >= 0) b = b.slice(0, cut);
  b = b.replace(/^\s*#\s+(.+)\n/, (all, h) => (h.trim() === d.title.trim() ? '' : all));
  return b.trim() + '\n';
}

// Fact card: pairs of 编号/id and 状态/status lines. 事实卡：读取编号和状态。
export function parseFacts(text) {
  const facts = new Map(); let id = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const a = line.match(/^\s*-?\s*(?:编号|id)\s*:\s*["']?([\w-]+)["']?\s*(?:#.*)?$/i);
    if (a) { id = a[1]; facts.set(id, '未知'); continue; }
    const s = line.match(/^\s*(?:状态|status)\s*:\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/i);
    if (s && id) facts.set(id, s[1].trim());
  }
  return facts;
}

// ---------------------------------------------------------------- Markdown

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u) => (/^\s*(javascript|data|vbscript):/i.test(u.replace(/&amp;/g, '&')) ? '#' : u);

function inline(s, st) {
  const codes = [];
  let h = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  h = h
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => `<img src="${safeUrl(u)}" alt="${a}"${st('img')}>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${safeUrl(u)}"${st('a')}>${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, (_, t) => `<strong${st('strong')}>${t}</strong>`)
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, (_, p, t) => `${p}<em>${t}</em>`);
  return h.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code${st('code')}>${codes[n]}</code>`);
}

const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

// Small Markdown → HTML for articles: headings, paragraphs, lists, quotes, code, tables, links.
// Raw HTML in the draft is escaped, never passed through.
// 文章用的小型 Markdown 转换。草稿里的原始 HTML 会被转义，不会原样输出。
export function mdToHtml(md, style = {}) {
  const st = (tag) => (style[tag] ? ` style="${style[tag]}"` : '');
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = []; const para = []; let i = 0;
  const flush = () => { if (para.length) { out.push(`<p${st('p')}>${inline(para.join(' '), st)}</p>`); para.length = 0; } };
  const listBlock = (re, tag) => {
    const items = [];
    while (i < lines.length && (re.test(lines[i]) || (items.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])))) {
      if (re.test(lines[i])) items.push(lines[i].replace(re, ''));
      else items[items.length - 1] += ' ' + lines[i].trim();
      i++;
    }
    out.push(`<${tag}${st(tag)}>${items.map((x) => `<li${st('li')}>${inline(x, st)}</li>`).join('')}</${tag}>`);
  };
  while (i < lines.length) {
    const l = lines[i]; let m;
    if (/^\s*```/.test(l)) {
      flush(); const buf = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push(`<pre${st('pre')}><code>${esc(buf.join('\n'))}</code></pre>`); continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      flush(); const n = m[1].length; out.push(`<h${n}${st('h' + n)}>${inline(m[2], st)}</h${n}>`); i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push(`<hr${st('hr')}>`); i++; continue; }
    if (/^>\s?/.test(l)) {
      flush(); const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote${st('blockquote')}>${mdToHtml(buf.join('\n'), style)}</blockquote>`); continue;
    }
    if (/^\s*[-*+]\s+/.test(l)) { flush(); listBlock(/^\s*[-*+]\s+/, 'ul'); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { flush(); listBlock(/^\s*\d+[.)]\s+/, 'ol'); continue; }
    if (l.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flush(); const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<table${st('table')}><thead><tr>${head.map((c) => `<th${st('th')}>${inline(c, st)}</th>`).join('')}</tr></thead><tbody>`
        + rows.map((r) => `<tr>${r.map((c) => `<td${st('td')}>${inline(c, st)}</td>`).join('')}</tr>`).join('') + '</tbody></table>');
      continue;
    }
    para.push(l.trim()); i++;
  }
  flush();
  return out.join('\n');
}

// Plain text for platforms without Markdown (Xiaohongshu). Links keep their text only.
// 给不支持 Markdown 的平台（小红书）用的纯文本，链接只保留文字。
export function mdToText(md) {
  const out = [];
  let fence = false;
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(raw)) { fence = !fence; continue; }
    if (fence) { out.push(raw); continue; }
    if (TABLE_SEP.test(raw)) continue;
    let l = raw
      .replace(/^#{1,6}\s+(.*?)\s*#*\s*$/, '$1')
      .replace(/^>\s?/, '')
      .replace(/^\s*[-*+]\s+/, '• ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*\s][^*]*)\*/g, '$1').replace(/`([^`]+)`/g, '$1');
    if (/^\s*\|.*\|\s*$/.test(l)) l = cells(l).join(' | ');
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) l = '';
    out.push(l.trimEnd());
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const chars = (s) => Array.from(String(s).replace(/\s+/g, '')).length;

// ---------------------------------------------------------------- check

function shingles(text) {
  const s = mdToText(text).replace(/\s+/g, '').toLowerCase();
  const set = new Set();
  for (let i = 0; i + 4 <= s.length; i++) set.add(s.slice(i, i + 4));
  return set;
}
export function similarity(a, b) {
  const A = shingles(a); const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// A claim that is denied ("不保证排名", "no guarantee") is the honest wording, not hype.
// 被否定的说法（「不保证排名」）正是如实的写法，不算夸大。
const NEGATED = { zh: /(?:不(?![仅但断少错停])|没有|无法|并非|绝不|从不|未(?!来))[^，。；！？\n]{0,2}$/, en: /\b(?:not|no|never|without|n't)\s+(?:\w+\s+)?$/i };

function hypeHits(text, lang) {
  const hits = [];
  for (const w of [...HYPE.zh, ...(lang === 'en' ? HYPE.en : [])]) {
    const en = /^[a-z]/i.test(w);
    const re = new RegExp(en ? `\\b${w.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&')}\\b` : w.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&'), 'gi');
    for (const m of text.matchAll(re)) {
      if (!(en ? NEGATED.en : NEGATED.zh).test(text.slice(Math.max(0, m.index - 20), m.index))) { hits.push(w); break; }
    }
  }
  return hits;
}

// Returns [{ file, level: 'error'|'warn'|'info', code, msg }]. 返回问题列表。
export function checkDrafts(drafts, { facts = null, missingFactCard = null, lang = 'zh' } = {}) {
  const t = M[lang].issues; const issues = [];
  const add = (d, level, code, msg) => issues.push({ file: d.file, slug: d.slug, level, code, msg });
  const slugs = new Map();
  for (const d of drafts) {
    if (!d.hasMeta) { add(d, 'error', 'no-frontmatter', t['no-frontmatter']); continue; }
    for (const f of ['title', 'slug', 'question', 'status']) if (!d.meta[f] || (Array.isArray(d.meta[f]) && !d.meta[f].length)) add(d, 'error', 'missing', t.missing(f));
    if (d.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug)) add(d, 'error', 'bad-slug', t['bad-slug'](d.slug));
    if (d.slug && slugs.has(d.slug)) add(d, 'error', 'dup-slug', t['dup-slug'](d.slug, slugs.get(d.slug)));
    else if (d.slug) slugs.set(d.slug, d.file);
    for (const p of d.platforms) if (!KNOWN.has(p)) add(d, 'error', 'bad-platform', t['bad-platform'](p));
    const status = String(d.meta.status || '').toLowerCase();
    if (status && status !== 'draft' && !CONFIRMED.has(status)) add(d, 'error', 'bad-status', t['bad-status'](d.meta.status));
    const body = publicBody(d); const full = `${d.title}\n${d.meta.description || ''}\n${body}`;
    const ph = full.match(PLACEHOLDER); if (ph) add(d, 'error', 'placeholder', t.placeholder(ph[0]));
    if (facts) {
      for (const id of d.facts) {
        if (!facts.has(id)) add(d, 'error', 'unknown-fact', t['unknown-fact'](id));
        else if (!CONFIRMED.has(String(facts.get(id)).toLowerCase())) add(d, 'error', 'unconfirmed-fact', t['unconfirmed-fact'](id, facts.get(id)));
      }
    } else if (missingFactCard && d.facts.length) add(d, 'error', 'no-fact-card', t['no-fact-card'](missingFactCard));
    if (!d.facts.length) add(d, 'warn', 'no-facts', t['no-facts']);
    for (const w of hypeHits(full, d.lang)) add(d, 'warn', 'hype', t.hype(w));
    if (REVIEW.test(body)) add(d, 'warn', 'review', t.review);
    const n = chars(mdToText(body)); if (n < 150) add(d, 'warn', 'short', t.short(n));
    if (!d.meta.description) add(d, 'warn', 'no-description', t['no-description']);
    if (!d.confirmed && status === 'draft') add(d, 'info', 'draft', t.draft);
  }
  for (let i = 0; i < drafts.length; i++) {
    for (let j = i + 1; j < drafts.length; j++) {
      const s = similarity(publicBody(drafts[i]), publicBody(drafts[j]));
      if (s >= NEAR_DUP) add(drafts[j], 'warn', 'near-dup', t['near-dup'](drafts[i].file, Math.round(s * 100)));
    }
  }
  return issues;
}

export function formatIssues(drafts, issues, lang) {
  const t = M[lang]; const icon = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ' };
  const e = issues.filter((x) => x.level === 'error').length; const w = issues.filter((x) => x.level === 'warn').length;
  const out = [t.checkHead(drafts.length, e, w), ''];
  for (const d of drafts) {
    const mine = issues.filter((x) => x.file === d.file);
    out.push(`${mine.some((x) => x.level === 'error') ? '❌' : '✅'} ${d.file}${d.title ? ` · ${d.title}` : ''}`);
    for (const x of mine) out.push(`   ${icon[x.level]} ${x.msg}`);
  }
  const ready = drafts.filter((d) => d.confirmed && !issues.some((x) => x.file === d.file && x.level === 'error'));
  if (ready.length) out.push('', t.checkOk, ...ready.map((d) => `   ${d.slug} → ${d.platforms.join(', ')}`));
  return out.join('\n');
}

// ---------------------------------------------------------------- site

const today = () => new Date().toISOString().slice(0, 10);
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const joinUrl = (base, path) => base.replace(/\/+$/, '') + '/' + path;

export function articleHtml(d, { url = null } = {}) {
  const body = mdToHtml(publicBody(d));
  const date = d.meta.date || today();
  const desc = d.meta.description || '';
  const ld = { '@context': 'https://schema.org', '@type': 'Article', headline: d.title, inLanguage: d.lang, datePublished: date, dateModified: d.meta.updated || date };
  if (desc) ld.description = desc;
  if (url) ld.mainEntityOfPage = url;
  return `<!doctype html>
<html lang="${esc(d.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.title)}</title>
${desc ? `<meta name="description" content="${esc(desc)}">\n` : ''}${url ? `<link rel="canonical" href="${esc(url)}">\n` : ''}<script type="application/ld+json">${jsonLd(ld)}</script>
<style>body{max-width:720px;margin:40px auto;padding:0 16px;font:17px/1.75 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2328}table{border-collapse:collapse}th,td{border:1px solid #d0d7de;padding:6px 10px}time{color:#57606a;font-size:14px}</style>
</head>
<body>
<main>
<article>
<h1>${esc(d.title)}</h1>
<p><time datetime="${esc(date)}">${esc(date)}</time></p>
${body}
</article>
</main>
</body>
</html>
`;
}

function indexHtml(drafts, lang, baseUrl) {
  const title = lang === 'en' ? 'Articles' : '文章';
  const items = drafts.map((d) => `<li><a href="${esc(d.slug)}.html">${esc(d.title)}</a>${d.meta.description ? `<br><small>${esc(d.meta.description)}</small>` : ''}</li>`).join('\n');
  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${baseUrl ? `<link rel="canonical" href="${esc(joinUrl(baseUrl, ''))}">\n` : ''}<style>body{max-width:720px;margin:40px auto;padding:0 16px;font:17px/1.75 system-ui,sans-serif}li{margin:12px 0}</style>
</head>
<body>
<main>
<h1>${title}</h1>
<ul>
${items}
</ul>
</main>
</body>
</html>
`;
}

export function sitemapXml(drafts, baseUrl) {
  const urls = [joinUrl(baseUrl, ''), ...drafts.map((d) => joinUrl(baseUrl, `${d.slug}.html`))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

async function request(method, url, { headers = {}, body } = {}) {
  const res = await fetch(url, {
    method, headers: { 'user-agent': UA, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text(); let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, ok: res.ok, json, text };
}

const failMsg = (r) => (r.json && (r.json.message || r.json.error)) || r.text.slice(0, 200).trim();

async function toWordPress(d, o, t, log) {
  const api = joinUrl(o.site, 'wp-json/wp/v2/posts');
  const auth = 'Basic ' + Buffer.from(`${o.user}:${o.password}`).toString('base64');
  const payload = { title: d.title, content: mdToHtml(publicBody(d)), excerpt: d.meta.description || '', slug: d.slug, status: o.status };
  if (o.dryRun) { log(t.dry(`POST ${api} · ${d.slug} · ${o.status}`)); return null; }
  const found = await request('GET', `${api}?slug=${encodeURIComponent(d.slug)}&status=any&context=edit`, { headers: { authorization: auth } });
  if (!found.ok) throw new Error(t.httpFail(found.status, failMsg(found)));
  const existing = Array.isArray(found.json) && found.json[0];
  const r = await request('POST', existing ? `${api}/${existing.id}` : api, { headers: { authorization: auth }, body: payload });
  if (!r.ok) throw new Error(t.httpFail(r.status, failMsg(r)));
  const url = r.json?.link || ''; const st = r.json?.status || o.status;
  log(existing ? t.updated(d.slug, url, st) : t.sent(d.slug, url, st));
  return { url, status: st };
}

async function toHttp(d, o, t, log) {
  const payload = {
    title: d.title, slug: d.slug, description: d.meta.description || '', lang: d.lang, question: d.meta.question || '',
    tags: d.tags, date: d.meta.date || today(), markdown: publicBody(d), html: mdToHtml(publicBody(d)),
  };
  if (o.dryRun) { log(t.dry(`POST ${o.endpoint} · ${d.slug}`)); return null; }
  const r = await request('POST', o.endpoint, { headers: o.headers, body: payload });
  if (!r.ok) throw new Error(t.httpFail(r.status, failMsg(r)));
  const url = r.json?.url || r.json?.link || ''; const st = r.json?.status || 'sent';
  log(t.sent(d.slug, url || o.endpoint, st));
  return { url, status: st };
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const LOG_HEADER = 'date,slug,platform,url,status,title';
export function appendLog(file, row) {
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, '﻿' + LOG_HEADER + '\n');
  appendFileSync(file, [row.date || today(), row.slug, row.platform, row.url || '', row.status || '', row.title || ''].map(csvCell).join(',') + '\n');
}
export function readLog(file) {
  if (!existsSync(file)) return [];
  const rows = []; const lines = readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split(',');
  for (const line of lines) {
    const vals = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { vals.push(cur); cur = ''; } else cur += c;
    }
    vals.push(cur);
    rows.push(Object.fromEntries(head.map((h, i) => [h, vals[i] ?? ''])));
  }
  return rows;
}

// ---------------------------------------------------------------- pack

const WECHAT_STYLE = {
  h1: 'font-size:22px;font-weight:bold;margin:24px 0 12px', h2: 'font-size:19px;font-weight:bold;margin:24px 0 12px',
  h3: 'font-size:17px;font-weight:bold;margin:20px 0 10px', p: 'font-size:16px;line-height:1.8;margin:0 0 14px;color:#333',
  li: 'font-size:16px;line-height:1.8;color:#333', blockquote: 'border-left:3px solid #ddd;padding:4px 12px;margin:0 0 14px;color:#666',
  table: 'border-collapse:collapse;margin:0 0 14px', th: 'border:1px solid #ccc;padding:6px 10px;background:#f5f5f5', td: 'border:1px solid #ccc;padding:6px 10px',
  code: 'background:#f5f5f5;padding:1px 4px;border-radius:3px', pre: 'background:#f5f5f5;padding:10px;overflow:auto;font-size:14px', a: 'color:#576b95',
};

export function renderFor(platform, d, { url = '', brand = '', lang = 'zh' } = {}) {
  const t = M[lang].pack; const body = publicBody(d); const warnings = [];
  const note = url ? `\n\n${t.original(url)}\n` : '\n';
  let text;
  switch (platform) {
    case 'wechat': text = `<section>\n<h1 style="${WECHAT_STYLE.h1}">${esc(d.title)}</h1>\n${mdToHtml(body, WECHAT_STYLE)}\n${url ? `<p style="${WECHAT_STYLE.p}">${esc(t.original(url))}</p>\n` : ''}</section>\n`; break;
    case 'toutiao': case 'baijiahao': case 'sohu': text = `<h1>${esc(d.title)}</h1>\n${mdToHtml(body)}\n${url ? `<p>${esc(t.original(url))}</p>\n` : ''}`; break;
    case 'xiaohongshu': {
      const { titleMax, bodyMax } = PLATFORMS.xiaohongshu; const plain = mdToText(body);
      if (chars(d.title) > titleMax) warnings.push(t.tooLong(t.titleW, chars(d.title), titleMax));
      if (chars(plain) > bodyMax) warnings.push(t.tooLong(t.bodyW, chars(plain), bodyMax));
      const tags = d.tags.map((x) => `#${x.replace(/^#/, '')}`).join(' ');
      text = `${d.title}\n\n${plain}\n${tags ? `\n${tags}\n` : ''}`; break;
    }
    case 'reddit': {
      const b = brand || d.meta.brand || '';
      if (!b) warnings.push(t.noBrand);
      text = `# ${d.title}\n\n${t.disclosure(b || '[your product]')}\n\n${body.trim()}${note}`; break;
    }
    default: text = `# ${d.title}\n\n${body.trim()}${note}`;
  }
  return { text, warnings };
}

function packDrafts(drafts, o, t, lang, logRows) {
  const files = []; const rows = []; const warnings = [];
  for (const d of drafts) {
    const isPublic = (u) => /^https?:\/\//i.test(u || '');
    const url = (logRows.filter((r) => r.slug === d.slug && r.platform === SITE && isPublic(r.url)).pop() || {}).url || (isPublic(d.meta.url) ? d.meta.url : '');
    for (const p of d.platforms) {
      if (p === SITE || !PLATFORMS[p] || (o.platforms && !o.platforms.includes(p))) continue;
      const r = renderFor(p, d, { url, brand: o.brand, lang });
      const rel = `${p}/${d.slug}.${PLATFORMS[p].ext}`;
      files.push({ path: join(o.out, rel), text: r.text });
      rows.push({ d, p, rel, warnings: r.warnings });
      warnings.push(...r.warnings.map((w) => `${rel}: ${w}`));
    }
  }
  const pt = t.pack;
  const md = [pt.title(today()), '', pt.intro, '',
    '```bash', `npx -p github:Fangx-AI/geo-doctor geo-publish log --slug <slug> --platform <platform> --url <url>`, '```', '',
    pt.general, '', pt.cols, '| --- | --- | --- | --- | --- |',
    ...rows.map(({ d, p, rel, warnings: w }) => `| ${d.title.replace(/\|/g, '\\|')} (\`${d.slug}\`) | ${p} | [${rel}](${rel}) | [${new URL(PLATFORMS[p].editor).host}](${PLATFORMS[p].editor}) | ${[pt.notes[p], ...w].join('；').replace(/\|/g, '\\|')} |`),
    ''].join('\n');
  if (rows.length) files.push({ path: join(o.out, 'README.md'), text: md });
  return { files, count: rows.length, warnings };
}

// ---------------------------------------------------------------- CLI

function detectLang() {
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  const loc = env || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return /^zh/i.test(loc) ? 'zh' : 'en';
}

const VALUE_FLAGS = ['--to', '--out', '--base-url', '--site', '--user', '--status', '--endpoint', '--token-env', '--header',
  '--platforms', '--brand', '--facts', '--log', '--lang', '--slug', '--platform', '--url'];

export function parseArgs(argv) {
  const o = { cmd: null, dir: null, headers: [], json: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '--json') o.json = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (VALUE_FLAGS.includes(a)) {
      const v = argv[++i];
      if (v === undefined || !v.trim() || v.startsWith('--')) throw new Error(`${a} requires a value`);
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (a === '--header') o.headers.push(v); else o[key] = v;
    } else if (a.startsWith('-')) o.unknown = a;
    else if (!o.cmd) o.cmd = a;
    else if (!o.dir) o.dir = a;
    else o.unknown = a;
  }
  if (o.platforms) o.platforms = o.platforms.split(',').map((s) => s.trim()).filter(Boolean);
  return o;
}

export async function main(argv, { env = process.env, out = console.log, err = console.error } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { err(e.message); return 2; }
  const lang = o.lang === 'zh' || o.lang === 'en' ? o.lang : detectLang();
  const t = M[lang];
  if (o.version) { out(VERSION); return 0; }
  if (o.help || !o.cmd || o.unknown) { out(t.usage); return o.help ? 0 : 2; }
  if (!['check', 'site', 'pack', 'log'].includes(o.cmd)) { err(t.unknownCmd(o.cmd)); out(t.usage); return 2; }

  if (o.cmd === 'log') {
    for (const f of ['slug', 'platform', 'url']) if (!o[f]) { err(t.need('--' + f)); return 2; }
    const file = o.log || join(o.dir ? resolve(o.dir, '..') : 'geo', 'published.csv');
    appendLog(file, { slug: o.slug, platform: o.platform, url: o.url, status: 'published' });
    out(t.logged(file)); return 0;
  }

  if (!o.dir) { err(t.need('<drafts-dir>')); return 2; }
  const dir = resolve(o.dir);
  if (!existsSync(dir)) { err(t.noDir(o.dir)); return 2; }
  const drafts = loadDrafts(dir);
  if (!drafts.length) { err(t.noDrafts(o.dir)); return 2; }
  const factsFile = o.facts || join(dir, '..', 'fact-card.yaml');
  // An explicit --facts path must exist; a missing default card fails every draft that cites fact IDs.
  if (o.facts && !existsSync(factsFile)) { err(t.noFactFile(o.facts)); return 2; }
  const facts = existsSync(factsFile) ? parseFacts(readFileSync(factsFile, 'utf8')) : null;
  const logFile = o.log || join(dir, '..', 'published.csv');
  const issues = checkDrafts(drafts, { facts, missingFactCard: facts ? null : factsFile, lang });

  if (o.cmd === 'check') {
    if (o.json) out(JSON.stringify({ drafts: drafts.map((d) => ({ file: d.file, slug: d.slug, title: d.title, confirmed: d.confirmed, platforms: d.platforms })), issues, factCard: facts ? factsFile : null }, null, 2));
    else out(formatIssues(drafts, issues, lang));
    return issues.some((x) => x.level === 'error') ? 1 : 0;
  }

  // site and pack use confirmed drafts only, and refuse to run while any of them has errors.
  const target = o.cmd === 'site' ? SITE : null;
  const picked = drafts.filter((d) => d.confirmed && (target ? d.platforms.includes(SITE) : d.platforms.some((p) => p !== SITE)));
  const skipped = drafts.filter((d) => !d.confirmed).length;
  const errors = issues.filter((x) => x.level === 'error' && picked.some((d) => d.file === x.file));
  if (errors.length) { err(formatIssues(drafts, issues, lang)); err('\n' + t.blocked(errors.length)); return 1; }
  if (skipped) err(t.skipped(skipped));
  if (!picked.length) { err(t.nothing); return 1; }

  if (o.cmd === 'pack') {
    const outDir = o.out || join(dir, '..', 'outbox');
    const { files, count, warnings } = packDrafts(picked, { ...o, out: outDir }, t, lang, readLog(logFile));
    if (!count) { err(t.nothing); return 1; }
    for (const f of files) {
      if (o.dryRun) { out(t.dry(f.path)); continue; }
      mkdirSync(dirname(f.path), { recursive: true }); writeFileSync(f.path, f.text);
    }
    for (const w of warnings) err(`⚠️  ${w}`);
    if (!o.dryRun) out(t.packed(count, outDir));
    return 0;
  }

  // site
  if (!['static', 'wordpress', 'http'].includes(o.to)) { err(t.badTo); return 2; }
  if (o.to === 'static') {
    if (!o.out) { err(t.need('--out')); return 2; }
    const outDir = resolve(o.out);
    // The manifest lists pages earlier runs wrote, so pages no longer eligible are removed (and nothing else is).
    const manifest = join(outDir, '.geo-publish.json');
    let previous = [];
    try { previous = JSON.parse(readFileSync(manifest, 'utf8')).pages || []; } catch {}
    const current = picked.map((d) => `${d.slug}.html`);
    for (const f of previous) {
      if (current.includes(f) || !/^[a-z0-9-]+\.html$/.test(f) || f === 'index.html') continue;
      const file = join(outDir, f);
      if (!existsSync(file)) continue;
      if (o.dryRun) { out(t.dry(t.removed(file))); continue; }
      rmSync(file); out(t.removed(file));
    }
    for (const d of picked) {
      const url = o.baseUrl ? joinUrl(o.baseUrl, `${d.slug}.html`) : null;
      const file = join(outDir, `${d.slug}.html`);
      if (o.dryRun) { out(t.dry(file)); continue; }
      mkdirSync(outDir, { recursive: true }); writeFileSync(file, articleHtml(d, { url }));
      out(t.wrote(file));
      appendLog(logFile, { slug: d.slug, platform: SITE, url: url || '', status: 'static', title: d.title });
    }
    if (!o.dryRun) {
      const idx = join(outDir, 'index.html'); writeFileSync(idx, indexHtml(picked, lang, o.baseUrl)); out(t.wrote(idx));
      if (o.baseUrl) { const sm = join(outDir, 'sitemap.xml'); writeFileSync(sm, sitemapXml(picked, o.baseUrl)); out(t.wrote(sm)); }
      writeFileSync(manifest, JSON.stringify({ generator: 'geo-publish', pages: current }, null, 2) + '\n');
      out(t.logged(logFile));
    }
    return 0;
  }
  const status = o.status || 'draft';
  if (!['draft', 'publish'].includes(status)) { err(t.badStatus); return 2; }
  let ctx;
  if (o.to === 'wordpress') {
    if (!o.site) { err(t.need('--site')); return 2; }
    if (!o.user) { err(t.need('--user')); return 2; }
    const password = env.GEO_WP_APP_PASSWORD;
    if (!password && !o.dryRun) { err(t.noPass); return 2; }
    ctx = { site: o.site, user: o.user, password, status, dryRun: o.dryRun };
  } else {
    if (!o.endpoint) { err(t.need('--endpoint')); return 2; }
    const headers = {};
    for (const h of o.headers) {
      const m = h.match(/^([^:]+):\s*(.*)$/); if (!m) { err(t.badHeader(h)); return 2; }
      headers[m[1].trim().toLowerCase()] = m[2];
    }
    if (o.tokenEnv) {
      if (!env[o.tokenEnv] && !o.dryRun) { err(t.noToken(o.tokenEnv)); return 2; }
      headers.authorization = `Bearer ${env[o.tokenEnv] || ''}`;
    }
    ctx = { endpoint: o.endpoint, headers, dryRun: o.dryRun };
  }
  let failed = 0;
  for (const d of picked) {
    try {
      const r = o.to === 'wordpress' ? await toWordPress(d, ctx, t, out) : await toHttp(d, ctx, t, out);
      if (r) appendLog(logFile, { slug: d.slug, platform: SITE, url: r.url, status: r.status, title: d.title });
    } catch (e) { failed++; err(`❌ ${d.slug}: ${e.message}`); }
  }
  if (!o.dryRun && picked.length > failed) out(t.logged(logFile));
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href || /^geo-publish(\.mjs)?$/.test(basename(process.argv[1] || ''))) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 2; });
}
