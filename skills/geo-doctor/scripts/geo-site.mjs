#!/usr/bin/env node
// geo-site · geo-doctor
// Turn a confirmed fact card (and confirmed articles) into a small static site that AI can read:
// fact sheet, FAQ, articles, JSON-LD, llms.txt, facts.json, sitemap and robots.txt. No dependencies.
// 把已确认的事实卡（和已确认的文章）生成一个 AI 读得懂的静态事实站：事实页、常见问题、文章、
// 结构化数据、llms.txt、facts.json、sitemap 和 robots.txt。零依赖。
//
//   npx -p github:Fangx-AI/geo-doctor geo-site build --facts geo/fact-card.yaml --out site --base-url https://example.com/facts/
//   npx -p github:Fangx-AI/geo-doctor geo-site action      # write a GitHub Pages workflow that rebuilds the site
//
// Only facts marked 已确认 / confirmed are published; nothing is invented or filled in.
// 只发布状态为"已确认"的事实，不补写、不猜测。
// SPDX-License-Identifier: MIT

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { articleHtml, checkDrafts, FILL, fillItems, fillJson, fillUserscript, loadDrafts, parseFacts, PLATFORMS, SITE } from './geo-publish.mjs';

export const VERSION = '1.0.0';
const CONFIRMED = new Set(['已确认', 'confirmed', 'ok']);

// ---------------------------------------------------------------- fact card

const unquote = (s) => {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
};
const stripComment = (s) => {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
};
const scalar = (v) => {
  v = v.trim();
  if (/^\[.*\]$/.test(v)) return splitInline(v.slice(1, -1)).map(unquote).filter(Boolean);
  return unquote(v);
};
function splitInline(s) {
  const out = []; let cur = ''; let q = null;
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === ',' || c === '，') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Reads the fact-card subset of YAML: top-level sections holding either a list of entries or a map.
// 读事实卡用到的 YAML 子集：顶层分区，下面是条目列表或键值。
export function parseFactCard(text) {
  const sections = {}; let section = null; let entry = null; let listKey = null; let listIndent = -1;
  for (const raw of text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = stripComment(raw).replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indent = line.match(/^ */)[0].length;
    const body = line.trim();
    if (indent === 0) {
      const m = body.match(/^([^:]+):\s*(.*)$/);
      if (!m) continue;
      section = m[1].trim(); entry = null; listKey = null;
      sections[section] = m[2] ? scalar(m[2]) : null;
      continue;
    }
    if (!section) continue;
    if (listKey && indent > listIndent && body.startsWith('- ') && !/^-\s+(?!["'])[^:]+:\s/.test(body)) {
      entry[listKey].push(unquote(body.slice(2))); continue;
    }
    listKey = null;
    const item = body.match(/^-\s+(.*)$/);
    if (item) {
      if (!Array.isArray(sections[section])) sections[section] = [];
      entry = {}; sections[section].push(entry);
      const kv = item[1].match(/^([^:]+):\s*(.*)$/);
      if (kv) entry[kv[1].trim()] = scalar(kv[2]);
      continue;
    }
    const kv = body.match(/^([^:]+):\s*(.*)$/);
    if (!kv) continue;
    const target = entry || (sections[section] && !Array.isArray(sections[section]) && typeof sections[section] === 'object'
      ? sections[section] : (sections[section] = {}));
    const key = kv[1].trim();
    if (kv[2] === '') { target[key] = []; listKey = key; listIndent = indent; entry = target; continue; }
    target[key] = scalar(kv[2]);
  }
  return sections;
}

// Field names in Chinese and English templates. 中英文模板的字段名。
const FIELDS = {
  id: ['编号', 'id'], item: ['项目', 'item', 'field'], value: ['内容', 'content', 'value'], source: ['来源', 'source'],
  status: ['状态', 'status'], audience: ['人群', 'audience', 'who'], scenario: ['场景', 'scenario', 'use case'],
  capability: ['能力', 'capability', 'feature'], limit: ['限制', 'limit', 'limitation', 'limits'],
  name: ['名称', 'name', 'plan'], price: ['价格', 'price'], includes: ['包含', 'includes'],
  effective: ['生效日期', 'effective', 'effective date'], against: ['对比对象', 'compared with', 'compared_with', 'versus', 'vs'],
  diff: ['区别', 'difference', 'differences'], type: ['类型', 'type'], url: ['地址', 'url', 'link'], date: ['日期', 'date'],
};
const pick = (o, names) => {
  for (const n of names) for (const k of Object.keys(o)) if (k.toLowerCase() === n) return o[k];
  return undefined;
};
const present = (v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== '');
const text = (v) => (Array.isArray(v) ? v.join('、') : String(v ?? '').trim());

export function loadFacts(sections) {
  const entries = []; let maintenance = {};
  for (const [name, value] of Object.entries(sections)) {
    if (Array.isArray(value)) {
      for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const e = { section: name, raw };
        for (const [k, names] of Object.entries(FIELDS)) e[k] = pick(raw, names);
        e.id = String(e.id || '').trim();
        e.prefix = (e.id.match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
        e.confirmed = CONFIRMED.has(String(e.status || '').trim().toLowerCase());
        entries.push(e);
      }
    } else if (value && typeof value === 'object' && /维护|maintenance/i.test(name)) maintenance = value;
  }
  return {
    entries, confirmed: entries.filter((e) => e.confirmed && e.id),
    checkedBy: text(pick(maintenance, ['确认人', 'confirmed by', 'owner'])),
    checkedOn: text(pick(maintenance, ['确认日期', 'confirmed on', 'date'])),
  };
}

// ---------------------------------------------------------------- copy

const M = {
  zh: {
    basics: '基本信息', fit: '适合谁', notFit: '不适合谁', features: '核心能力', pricing: '价格', requirements: '使用条件',
    unsupported: '明确不支持', data: '数据与安全', compare: '和同类产品的区别', evidence: '公开证据',
    labels: { B02: '别名', B04: '类型', B05: '官网', B06: '主体公司', B07: '上线时间', B08: '当前版本' },
    limit: '限制', includes: '包含', effective: '生效日期', source: '来源', faq: '常见问题', articles: '文章', facts: '事实页',
    checked: (d, who) => `以上事实${who ? `由 ${who} ` : ''}确认于 ${d}。`,
    note: '本页只列出已确认的事实，由 GEO 医生根据事实卡生成。',
    q: {
      what: (n) => `${n}是什么？`, fit: (n) => `${n}适合谁？`, notFit: (n) => `${n}不适合谁？`, price: (n) => `${n}多少钱？`,
      req: (n) => `${n}支持哪些平台，有什么使用条件？`, unsupported: (n) => `${n}不支持什么？`, data: (n) => `${n}的数据安全吗，存在哪里？`,
      compare: (n, x) => `${n}和${x}有什么区别？`,
    },
    by: (c) => `由 ${c} 推出。`, kind: (k) => `类型：${k}。`, sep: '；', colon: '：', paren: (s) => `（${s}）`, space: '', end: (s) => (/[。！？.!?]$/.test(s) ? s : s + '。'),
    usage: `geo-site ${VERSION} · 生成 AI 读得懂的静态事实站

用法：
  geo-site build --facts geo/fact-card.yaml --out <目录> [--drafts geo/drafts] [--base-url <网址>]
  geo-site action [--facts geo/fact-card.yaml] [--drafts geo/drafts] [--file .github/workflows/geo-site.yml]

  build    只用状态为"已确认"的事实，生成 index.html（事实页）、faq.html、articles/、llms.txt、
           facts.json、robots.txt；给了 --base-url 才会写 sitemap 和 canonical。
  action   写一个 GitHub Actions 工作流：geo/ 有改动就重新生成并发布到 GitHub Pages，再体检一次。

选项：
  --facts <文件>     事实卡，默认 geo/fact-card.yaml
  --drafts <目录>    文章目录（geo-publish 的草稿格式），只收已确认、发布到 site 且检查无错误的
  --out <目录>       输出目录
  --base-url <网址>  站点上线后的地址，例如 https://you.github.io/brand/
  --lang zh|en       页面语言，默认按事实卡判断
  --dry-run          只列出要写的文件
  --version / --help`,
    need: (x) => `缺少 ${x}`, noFacts: (f) => `找不到事实卡：${f}`, noDrafts: (d) => `找不到文章目录：${d}`,
    missingCore: (ids) => `事实卡里 ${ids.join('、')} 还没有"已确认"，事实站至少需要名称（B01）和一句话说明（B03）。`,
    wrote: (f) => `✅ 已写入 ${f}`, removed: (f) => `🗑  已删除上次生成、这次不再发布的 ${f}`, dry: (f) => `（试运行）将写入 ${f}`,
    skippedFacts: (n) => `ℹ️  ${n} 条事实还不是"已确认"，没有放进事实站。`,
    skippedDrafts: (list) => `⚠️  这些文章没有放进事实站（未确认或检查有错误）：${list.join('、')}`,
    noBase: 'ℹ️  没给 --base-url：不写 sitemap.xml 和 canonical，上线后用真实地址重新生成一次。',
    done: (dir, n, a) => `\n🩺 事实站已生成：${dir}（${n} 条事实，${a} 篇文章）。上线后可以用 geo-audit 体检。`,
    actionDone: (f) => `✅ 已写入 ${f}\n下一步：仓库 Settings → Pages → Source 选 "GitHub Actions"，再推送一次 geo/ 的改动即可上线。`,
    actionExists: (f) => `${f} 已存在，没有覆盖；要重写请先删除它。`,
    unknownCmd: (c) => `未知命令：${c}`,
  },
  en: {
    basics: 'Basics', fit: 'Who it is for', notFit: 'Who it is not for', features: 'Key capabilities', pricing: 'Pricing',
    requirements: 'Requirements', unsupported: 'Not supported', data: 'Data and security', compare: 'Compared with alternatives',
    evidence: 'Public evidence',
    labels: { B02: 'Also known as', B04: 'Type', B05: 'Website', B06: 'Company', B07: 'Launched', B08: 'Current version' },
    limit: 'Limit', includes: 'Includes', effective: 'Effective', source: 'Source', faq: 'FAQ', articles: 'Articles', facts: 'Facts',
    checked: (d, who) => `These facts were confirmed${who ? ` by ${who}` : ''} on ${d}.`,
    note: 'This page lists confirmed facts only. Generated by GEO Doctor from the fact card.',
    q: {
      what: (n) => `What is ${n}?`, fit: (n) => `Who is ${n} for?`, notFit: (n) => `Who is ${n} not for?`, price: (n) => `How much does ${n} cost?`,
      req: (n) => `Which platforms does ${n} support?`, unsupported: (n) => `What does ${n} not support?`,
      data: (n) => `Where does ${n} store data, and is it secure?`, compare: (n, x) => `How is ${n} different from ${x}?`,
    },
    by: (c) => `Made by ${c}.`, kind: (k) => `Type: ${k}.`, sep: '; ', colon: ': ', paren: (s) => ` (${s})`, space: ' ', end: (s) => (/[.!?]$/.test(s) ? s : s + '.'),
    usage: `geo-site ${VERSION} · build a static fact site AI can read

Usage:
  geo-site build --facts geo/fact-card.yaml --out <dir> [--drafts geo/drafts] [--base-url <url>]
  geo-site action [--facts geo/fact-card.yaml] [--drafts geo/drafts] [--file .github/workflows/geo-site.yml]

  build    Uses confirmed facts only. Writes index.html (fact sheet), faq.html, articles/, llms.txt,
           facts.json and robots.txt; sitemap.xml and canonical links need --base-url.
  action   Writes a GitHub Actions workflow that rebuilds the site whenever geo/ changes, deploys it
           to GitHub Pages and audits it.

Options:
  --facts <file>     Fact card (default geo/fact-card.yaml)
  --drafts <dir>     Articles in geo-publish draft format; only confirmed, site-bound drafts with no errors
  --out <dir>        Output directory
  --base-url <url>   Where the site will live, e.g. https://you.github.io/brand/
  --lang zh|en       Page language (default: guessed from the fact card)
  --dry-run          List the files without writing them
  --version / --help`,
    need: (x) => `Missing ${x}`, noFacts: (f) => `Fact card not found: ${f}`, noDrafts: (d) => `Drafts directory not found: ${d}`,
    missingCore: (ids) => `${ids.join(', ')} not confirmed in the fact card. The site needs at least the name (B01) and one-line summary (B03).`,
    wrote: (f) => `✅ Wrote ${f}`, removed: (f) => `🗑  Removed ${f} (generated last time, not published any more)`, dry: (f) => `(dry run) would write ${f}`,
    skippedFacts: (n) => `ℹ️  ${n} facts are not confirmed yet and were left out.`,
    skippedDrafts: (list) => `⚠️  Left out (not confirmed, or check errors): ${list.join(', ')}`,
    noBase: 'ℹ️  No --base-url: sitemap.xml and canonical links are skipped. Rebuild with the real URL once it is live.',
    done: (dir, n, a) => `\n🩺 Fact site built in ${dir} (${n} facts, ${a} articles). Audit it with geo-audit once it is live.`,
    actionDone: (f) => `✅ Wrote ${f}\nNext: Settings → Pages → Source: "GitHub Actions", then push a change under geo/.`,
    actionExists: (f) => `${f} already exists and was left alone; delete it to regenerate.`,
    unknownCmd: (c) => `Unknown command: ${c}`,
  },
};

// ---------------------------------------------------------------- model

const byPrefix = (facts, p) => facts.confirmed.filter((e) => e.prefix === p);
const one = (facts, id) => facts.confirmed.find((e) => e.id.toUpperCase() === id);
const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());

export function siteModel(facts) {
  const v = (id) => text(one(facts, id)?.value);
  return {
    name: v('B01'), aliases: [].concat(one(facts, 'B02')?.value || []).filter(Boolean), summary: v('B03'),
    kind: v('B04'), website: v('B05'), company: v('B06'), launched: v('B07'), version: v('B08'),
  };
}

// One line per confirmed entry, in the words of the fact card. 每条已确认事实一行，用事实卡原话。
function lineFor(e, t) {
  switch (e.prefix) {
    case 'U': return [text(e.audience), text(e.scenario), text(e.value)].filter(Boolean).join(t.sep);
    case 'F': return text(e.capability || e.value) + (present(e.limit) ? t.paren(`${t.limit}${t.colon}${text(e.limit)}`) : '');
    case 'P': {
      if (present(e.name) || present(e.price)) {
        let s = [text(e.name), text(e.price)].filter(Boolean).join(t.colon);
        if (present(e.includes)) s += `${t.sep}${t.includes}${t.colon}${text(e.includes)}`;
        if (present(e.effective)) s += `${t.sep}${t.effective}${t.colon}${text(e.effective)}`;
        return (present(e.item) ? `${text(e.item)}${t.colon}` : '') + s;
      }
      return (present(e.item) ? `${text(e.item)}${t.colon}` : '') + text(e.value);
    }
    case 'D': return [text(e.against), text(e.diff || e.value)].filter(Boolean).join(t.colon);
    case 'E': return [text(e.type), text(e.url || e.value), text(e.date)].filter(Boolean).join(' · ');
    default: return (present(e.item) && e.prefix !== 'N' && e.prefix !== 'X' ? `${text(e.item)}${t.colon}` : '') + text(e.value);
  }
}
const hasContent = (e) => ['value', 'audience', 'scenario', 'capability', 'name', 'price', 'diff', 'url'].some((k) => present(e[k]));

export function faqItems(facts, lang = 'zh') {
  const t = M[lang]; const m = siteModel(facts); const n = m.name; const items = [];
  const join = (list) => list.map((e) => lineFor(e, t)).filter(Boolean).join(t.sep);
  const sec = (p) => byPrefix(facts, p).filter(hasContent);
  items.push({ q: t.q.what(n), a: [t.end(m.summary), m.kind && t.kind(m.kind), m.company && t.by(m.company)].filter(Boolean).join(t.space) });
  if (sec('U').length) items.push({ q: t.q.fit(n), a: join(sec('U')) });
  if (sec('N').length) items.push({ q: t.q.notFit(n), a: join(sec('N')) });
  if (sec('P').length) items.push({ q: t.q.price(n), a: join(sec('P')) });
  if (sec('C').length) items.push({ q: t.q.req(n), a: join(sec('C')) });
  if (sec('X').length) items.push({ q: t.q.unsupported(n), a: join(sec('X')) });
  if (sec('S').length) items.push({ q: t.q.data(n), a: join(sec('S')) });
  for (const e of sec('D')) if (present(e.against) && present(e.diff || e.value)) items.push({ q: t.q.compare(n, text(e.against)), a: text(e.diff || e.value) });
  return items;
}

// ---------------------------------------------------------------- HTML

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const joinUrl = (base, path) => base.replace(/\/+$/, '') + '/' + path;
const linkify = (s) => (isUrl(s) ? `<a href="${esc(s.trim())}">${esc(s.trim())}</a>` : esc(s));
const STYLE = 'body{max-width:760px;margin:40px auto;padding:0 16px;font:17px/1.75 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2328}nav a{margin-right:16px}h2{margin-top:32px;border-bottom:1px solid #d0d7de;padding-bottom:4px}dt{font-weight:600}dd{margin:0 0 8px}small,footer{color:#57606a}li{margin:6px 0}';

function page({ lang, title, desc, canonical, ld, nav, body }) {
  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${desc ? `<meta name="description" content="${esc(desc)}">\n` : ''}${canonical ? `<link rel="canonical" href="${esc(canonical)}">\n` : ''}${ld ? `<script type="application/ld+json">${jsonLd(ld)}</script>\n` : ''}<style>${STYLE}</style>
</head>
<body>
<nav>${nav}</nav>
<main>
${body}
</main>
</body>
</html>
`;
}

const PRICE = /^\s*(?:(¥|￥|\$|€|£)\s*)?(\d+(?:\.\d+)?)\s*(元|CNY|RMB|USD|EUR|GBP)?/i;
function offers(facts) {
  const out = [];
  for (const e of byPrefix(facts, 'P')) {
    const raw = text(e.price || ''); const m = raw.match(PRICE);
    if (!present(e.name) || !m || (!m[1] && !m[3])) continue;
    const sym = (m[1] || m[3]).toUpperCase();
    const currency = { '¥': 'CNY', '￥': 'CNY', 元: 'CNY', RMB: 'CNY', CNY: 'CNY', $: 'USD', USD: 'USD', '€': 'EUR', EUR: 'EUR', '£': 'GBP', GBP: 'GBP' }[sym];
    out.push({ '@type': 'Offer', name: text(e.name), price: m[2], priceCurrency: currency, description: raw });
  }
  return out;
}

const IDENTITY = /应用商店|应用市场|app ?store|google play|官方(账号|帐号|主页)|official (account|profile|page)|百科|wikipedia|wikidata/i;

export function structuredData(facts, { url = null } = {}) {
  const m = siteModel(facts);
  const software = /软件|app|应用|网站|小程序|saas|software|web|plugin|插件|extension/i.test(m.kind);
  const thing = { '@context': 'https://schema.org', '@type': software ? 'SoftwareApplication' : 'Product', name: m.name, description: m.summary };
  if (m.aliases.length) thing.alternateName = m.aliases;
  if (isUrl(m.website)) thing.url = m.website.trim();
  if (software) {
    thing.applicationCategory = m.kind;
    const platforms = byPrefix(facts, 'C').filter((e) => e.id.toUpperCase() === 'C01').flatMap((e) => [].concat(e.value || [])).filter(Boolean);
    if (platforms.length) thing.operatingSystem = platforms.join(', ');
    if (m.version) thing.softwareVersion = m.version;
  }
  if (m.company) thing[software ? 'publisher' : 'brand'] = { '@type': 'Organization', name: m.company };
  const o = offers(facts); if (o.length) thing.offers = o;
  // sameAs is for listings that identify the product (store pages, official accounts), not supporting evidence.
  const sameAs = byPrefix(facts, 'E').filter((e) => IDENTITY.test(text(e.type))).map((e) => text(e.url || e.value)).filter(isUrl);
  if (sameAs.length) thing.sameAs = sameAs;
  if (url) thing.mainEntityOfPage = url;
  return thing;
}

function navHtml(t, prefix, articleCount) {
  return [`<a href="${prefix}index.html">${t.facts}</a>`, `<a href="${prefix}faq.html">${t.faq}</a>`,
    articleCount ? `<a href="${prefix}articles/index.html">${t.articles}</a>` : ''].filter(Boolean).join('');
}

export function factsHtml(facts, { lang = 'zh', baseUrl = null, articles = [] } = {}) {
  const t = M[lang]; const m = siteModel(facts); const url = baseUrl ? joinUrl(baseUrl, '') : null;
  const sections = [['U', t.fit], ['N', t.notFit], ['F', t.features], ['P', t.pricing], ['C', t.requirements], ['X', t.unsupported], ['S', t.data], ['D', t.compare], ['E', t.evidence]];
  const basics = Object.entries(t.labels).map(([id, label]) => {
    const e = one(facts, id); if (!e || !present(e.value)) return '';
    return `<dt>${esc(label)}</dt><dd>${linkify(text(e.value))}</dd>`;
  }).filter(Boolean).join('\n');
  let body = `<h1>${esc(m.name)}</h1>\n<p>${esc(m.summary)}</p>\n`;
  if (basics) body += `<h2>${t.basics}</h2>\n<dl>\n${basics}\n</dl>\n`;
  for (const [p, title] of sections) {
    const list = byPrefix(facts, p).filter(hasContent);
    if (!list.length) continue;
    body += `<h2>${esc(title)}</h2>\n<ul>\n${list.map((e) => {
      const line = lineFor(e, t);
      const src = present(e.source) && !/^(未知|unknown)$/i.test(text(e.source)) ? ` <small>${t.source}${t.colon}${linkify(text(e.source))}</small>` : '';
      return `<li id="${esc(e.id)}">${p === 'E' ? linkify(text(e.url || e.value)) + (present(e.type) || present(e.date) ? ` <small>${esc([text(e.type), text(e.date)].filter(Boolean).join(' · '))}</small>` : '') : esc(line)}${src}</li>`;
    }).join('\n')}\n</ul>\n`;
  }
  if (articles.length) body += `<h2>${t.articles}</h2>\n<ul>\n${articles.map((d) => `<li><a href="articles/${esc(d.slug)}.html">${esc(d.title)}</a></li>`).join('\n')}\n</ul>\n`;
  body += `<footer><p>${facts.checkedOn ? esc(t.checked(facts.checkedOn, facts.checkedBy)) + ' ' : ''}${esc(t.note)}</p></footer>`;
  return page({ lang, title: m.name, desc: m.summary, canonical: url, ld: structuredData(facts, { url }), nav: navHtml(t, '', articles.length), body });
}

export function faqHtml(facts, { lang = 'zh', baseUrl = null, articles = [] } = {}) {
  const t = M[lang]; const m = siteModel(facts); const items = faqItems(facts, lang);
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) };
  const body = `<h1>${esc(m.name)} · ${t.faq}</h1>\n${items.map((x) => `<h2>${esc(x.q)}</h2>\n<p>${esc(x.a)}</p>`).join('\n')}`;
  return page({ lang, title: `${m.name} · ${t.faq}`, desc: items[0]?.a, canonical: baseUrl ? joinUrl(baseUrl, 'faq.html') : null, ld, nav: navHtml(t, '', articles.length), body });
}

function articlesIndexHtml(facts, articles, { lang, baseUrl }) {
  const t = M[lang]; const m = siteModel(facts);
  const body = `<h1>${esc(m.name)} · ${t.articles}</h1>\n<ul>\n${articles.map((d) => `<li><a href="${esc(d.slug)}.html">${esc(d.title)}</a>${d.meta.description ? `<br><small>${esc(d.meta.description)}</small>` : ''}</li>`).join('\n')}\n</ul>`;
  return page({ lang, title: `${m.name} · ${t.articles}`, canonical: baseUrl ? joinUrl(baseUrl, 'articles/index.html') : null, nav: navHtml(t, '../', articles.length), body });
}

export function llmsTxt(facts, { lang = 'zh', baseUrl = null, articles = [] } = {}) {
  const t = M[lang]; const m = siteModel(facts); const link = (p) => (baseUrl ? joinUrl(baseUrl, p) : p);
  const lines = [`# ${m.name}`, '', `> ${m.summary}`, ''];
  const keyFacts = facts.confirmed.filter(hasContent).filter((e) => !['B01', 'B03'].includes(e.id.toUpperCase()));
  for (const e of keyFacts) {
    const label = e.prefix === 'B' && t.labels[e.id.toUpperCase()];
    lines.push(`- ${label ? `${label}${t.colon}${text(e.value)}` : lineFor(e, t)}`);
  }
  if (keyFacts.length) lines.push('');
  lines.push(`## ${lang === 'en' ? 'Pages' : '页面'}`, '', `- [${t.facts}](${link('index.html')})`, `- [${t.faq}](${link('faq.html')})`, `- [facts.json](${link('facts.json')})`);
  if (articles.length) {
    lines.push('', `## ${t.articles}`, '');
    for (const d of articles) lines.push(`- [${d.title}](${link(`articles/${d.slug}.html`)})${d.meta.description ? `: ${d.meta.description}` : ''}`);
  }
  if (facts.checkedOn) lines.push('', t.checked(facts.checkedOn, facts.checkedBy));
  return lines.join('\n') + '\n';
}

export function factsJson(facts) {
  const m = siteModel(facts);
  return JSON.stringify({
    name: m.name, summary: m.summary, confirmedOn: facts.checkedOn || null,
    facts: facts.confirmed.filter(hasContent).map((e) => {
      const o = { id: e.id, section: e.section };
      for (const k of Object.keys(FIELDS)) if (!['id', 'status'].includes(k) && present(e[k])) o[k] = e[k];
      return o;
    }),
  }, null, 2) + '\n';
}

export function robotsTxt(baseUrl) {
  return `User-agent: *\nAllow: /\n${baseUrl ? `\nSitemap: ${joinUrl(baseUrl, 'sitemap.xml')}\n` : ''}`;
}

export function sitemapXml(baseUrl, articles, date) {
  const urls = ['', 'faq.html', ...(articles.length ? ['articles/index.html'] : []), ...articles.map((d) => `articles/${d.slug}.html`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(joinUrl(baseUrl, u))}</loc>${date ? `<lastmod>${esc(date)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
}

// Every file of the site, as { path, text }. 生成整站文件列表。
export function buildSite(facts, { lang = 'zh', baseUrl = null, articles = [], fill = [] } = {}) {
  const o = { lang, baseUrl, articles };
  const files = [
    { path: 'index.html', text: factsHtml(facts, o) },
    { path: 'faq.html', text: faqHtml(facts, o) },
    { path: 'llms.txt', text: llmsTxt(facts, o) },
    { path: 'facts.json', text: factsJson(facts) },
    { path: 'robots.txt', text: robotsTxt(baseUrl) },
    { path: '.nojekyll', text: '' },
  ];
  if (articles.length) {
    files.push({ path: 'articles/index.html', text: articlesIndexHtml(facts, articles, o) });
    for (const d of articles) files.push({ path: `articles/${d.slug}.html`, text: articleHtml(d, { url: baseUrl ? joinUrl(baseUrl, `articles/${d.slug}.html`) : null }) });
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(facts.checkedOn) ? facts.checkedOn : null;
  if (baseUrl) files.push({ path: 'sitemap.xml', text: sitemapXml(baseUrl, articles, date) });
  // Browser fill helper for Zhihu/Juejin: the article list plus a userscript that reads it from this site.
  if (baseUrl && fill.length) {
    const items = fillItems(fill, { urlFor: (d) => (articles.includes(d) ? joinUrl(baseUrl, `articles/${d.slug}.html`) : '') });
    if (items.length) {
      files.push({ path: 'fill.json', text: fillJson(items) });
      files.push({ path: 'geo-fill.user.js', text: fillUserscript({ manifestUrl: joinUrl(baseUrl, 'fill.json'), name: siteModel(facts).name }) });
      files.push({ path: 'distribute.html', text: distributeHtml(facts, [...new Set([...articles, ...fill])], items, { baseUrl, lang }) });
    }
  }
  return files;
}

const BOARD = {
  zh: {
    names: { zhihu: '知乎', juejin: '掘金' }, todo: '待发', done: '已发 ✓', filled: '已填好 {d}，待你点发布', none: '这个平台的文章都已经发过了。', go: '分发', edit: '改', editTip: '手动填写或清除已发链接',
    title: '分发台', article: '文章', site: '官网', all: (p) => `一键分发所有待发的${p}文章`,
    intro: '官网和有官方接口的平台（如 dev.to）由工作流自动发布。知乎、掘金这类平台不允许程序代发：点「分发」会打开编辑器并自动填好标题和正文，你检查后自己点「发布」，发布后的链接会自动记回这里。',
    install: (u) => `<b>还没检测到填稿助手。</b>只需装一次：
<ol><li>在 Chrome 或 Edge 安装浏览器扩展 <a href="https://www.tampermonkey.net/">Tampermonkey</a>。</li>
<li>打开 <a href="${u}">填稿助手</a>，点「安装」。</li>
<li>Chrome 用户：打开 <code>chrome://extensions</code>，在 Tampermonkey 的「详细信息」里打开「允许用户脚本」（没有这个开关就打开右上角「开发者模式」）。</li>
<li>刷新本页，这个黄框消失就装好了。</li></ol>
没装助手时，「分发」也能打开编辑器，只是要自己粘贴。`,
    foot: '「已发」记录保存在你这台电脑的浏览器里。换电脑后可以点「改」手动补上链接。请先登录知乎、掘金再点分发。',
  },
  en: {
    names: { zhihu: 'Zhihu', juejin: 'Juejin' }, todo: 'To post', done: 'Posted ✓', filled: 'Filled {d}, waiting for you to publish', none: 'Every article for this platform is already posted.', go: 'Open', edit: 'edit', editTip: 'Set or clear the posted link by hand',
    title: 'Distribution board', article: 'Article', site: 'Site', all: (p) => `Open every unposted ${p} article`,
    intro: 'Your site and platforms with an official API (such as dev.to) are published by the workflow. Zhihu and Juejin do not allow automated posting: "Open" starts the editor with the title and body filled in, you review it and click publish yourself, and the link is recorded here.',
    install: (u) => `<b>The fill helper is not installed yet.</b> One-time setup:
<ol><li>Install the <a href="https://www.tampermonkey.net/">Tampermonkey</a> extension in Chrome or Edge.</li>
<li>Open the <a href="${u}">fill helper</a> and click Install.</li>
<li>Chrome: open <code>chrome://extensions</code>, open Tampermonkey's details and turn on "Allow user scripts" (or turn on Developer mode).</li>
<li>Reload this page; when this box disappears you are set.</li></ol>
Without the helper, "Open" still opens the editor; you paste the article yourself.`,
    foot: 'Posted links are kept in this browser only. On another computer, use "edit" to add them. Sign in to Zhihu and Juejin before opening editors.',
  },
};

// The distribution board: every article and where it stands on each platform. Not for search engines.
// The fill helper (geo-fill.user.js) runs on this page too: it shows what was filled and published, and opens editors.
export function distributeHtml(facts, drafts, items, { baseUrl, lang = 'zh' }) {
  const t = BOARD[lang === 'en' ? 'en' : 'zh'];
  const plats = Object.keys(FILL).filter((p) => items.some((i) => i.platform === p));
  const cell = (d, p) => {
    const key = `${p}/${d.slug}`;
    if (!items.some((i) => i.key === key)) return '<td class="na">—</td>';
    const href = `${PLATFORMS[p].editor}#geo-fill=${encodeURIComponent(key)}`;
    return `<td><span class="st" data-st="${esc(key)}">${t.todo}</span><br><a class="go" data-key="${esc(key)}" data-platform="${p}" href="${esc(href)}" target="_blank" rel="noopener">${t.go}</a> <button class="mark helper" data-mark="${esc(key)}" title="${t.editTip}">${t.edit}</button></td>`;
  };
  const rows = drafts.map((d) => {
    const site = d.platforms.includes(SITE) ? `<td><a href="${esc(joinUrl(baseUrl, `articles/${d.slug}.html`))}">${t.done}</a></td>` : '<td class="na">—</td>';
    return `<tr><th scope="row">${esc(d.title)}</th>${site}${plats.map((p) => cell(d, p)).join('')}</tr>`;
  }).join('\n');
  const name = siteModel(facts).name;
  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(name)} · ${t.title}</title>
<style>${STYLE}body{max-width:1000px}table{border-collapse:collapse;width:100%;font-size:15px}th,td{border:1px solid #d0d7de;padding:8px 10px;text-align:left;vertical-align:top}thead th{background:#f6f8fa}td.na{color:#aaa}
.st{font-size:13px;color:#9a6700}.st[data-state=done]{color:#1a7f37}.st[data-state=filled]{color:#0969da}
.go,.bar button{display:inline-block;margin-top:4px;padding:2px 12px;border-radius:6px;background:#1772f6;color:#fff;text-decoration:none;border:0;font:inherit;font-size:14px;cursor:pointer}
.mark{background:none;border:0;color:#57606a;cursor:pointer;font-size:12px}.helper{display:none}html[data-geo-fill] .helper{display:inline-block}
.install{border:1px solid #d4a72c;background:#fff8c5;border-radius:8px;padding:12px 16px;margin:16px 0}html[data-geo-fill] .install{display:none}.bar{margin:16px 0}</style>
</head>
<body data-l-todo="${esc(t.todo)}" data-l-done="${esc(t.done)}" data-l-filled="${esc(t.filled)}" data-l-none="${esc(t.none)}">
<h1>${esc(name)} · ${t.title}</h1>
<p>${t.intro}</p>
<div class="install">${t.install(esc(joinUrl(baseUrl, 'geo-fill.user.js')))}</div>
<div class="bar helper">${plats.map((p) => `<button data-all="${p}">${t.all(t.names[p] || p)}</button>`).join(' ')}</div>
<table>
<thead><tr><th>${t.article}</th><th>${t.site}</th>${plats.map((p) => `<th>${t.names[p] || p}</th>`).join('')}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p><small>${t.foot}</small></p>
</body>
</html>
`;
}

// ---------------------------------------------------------------- GitHub Pages workflow

export function workflowYaml({ facts = 'geo/fact-card.yaml', drafts = 'geo/drafts' } = {}) {
  return `name: geo-site
# Rebuilds the AI-readable fact site from ${facts} whenever geo/ changes, deploys it to GitHub Pages
# and audits the live page. Enable it once: Settings → Pages → Source: "GitHub Actions".
# 事实卡或文章有改动时重新生成事实站，发布到 GitHub Pages，再体检一次。
# 只需设置一次：Settings → Pages → Source 选 "GitHub Actions"。
on:
  push:
    paths: ['geo/**', '.github/workflows/geo-site.yml']
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  deploy:
    # Publish from the default branch only, whatever it is called; other branches (such as review PRs) never go live.
    if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - id: pages
        uses: actions/configure-pages@v5
      - name: Build fact site
        run: |
          DRAFTS=""
          if [ -d "${drafts}" ]; then DRAFTS="--drafts ${drafts}"; fi
          npx -y -p github:Fangx-AI/geo-doctor geo-site build --facts "${facts}" $DRAFTS --out _site --base-url "\${{ steps.pages.outputs.base_url }}/"
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site
      - id: deployment
        uses: actions/deploy-pages@v4
      - name: Audit the live site
        continue-on-error: true
        run: |
          sleep 20
          URL="\${{ steps.deployment.outputs.page_url }}"
          npx -y -p github:Fangx-AI/geo-doctor geo-audit "$URL" "\${URL}faq.html" --report audit.md
          cat audit.md >> "$GITHUB_STEP_SUMMARY"
`;
}

// ---------------------------------------------------------------- CLI

const VALUE_FLAGS = ['--facts', '--drafts', '--out', '--base-url', '--lang', '--file'];
export function parseArgs(argv) {
  const o = { cmd: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (VALUE_FLAGS.includes(a)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`);
      o[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
    } else if (a.startsWith('-')) o.unknown = a;
    else if (!o.cmd) o.cmd = a;
    else o.unknown = a;
  }
  return o;
}

const detectLang = (text) => (/编号\s*:/.test(text) ? 'zh' : /\bid\s*:/i.test(text) ? 'en' : 'zh');

export async function main(argv, { out = console.log, err = console.error } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { err(e.message); return 2; }
  const env = process.env.LANG || process.env.LC_ALL || '';
  let t = M[o.lang === 'en' || o.lang === 'zh' ? o.lang : /^zh/i.test(env) ? 'zh' : 'en'];
  if (o.version) { out(VERSION); return 0; }
  if (o.help || !o.cmd || o.unknown) { out(t.usage); return o.help ? 0 : 2; }
  const factsFile = o.facts || join('geo', 'fact-card.yaml');

  if (o.cmd === 'action') {
    const file = o.file || join('.github', 'workflows', 'geo-site.yml');
    if (existsSync(file)) { err(t.actionExists(file)); return 1; }
    if (o.dryRun) { out(t.dry(file)); return 0; }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, workflowYaml({ facts: o.facts || 'geo/fact-card.yaml', drafts: o.drafts || 'geo/drafts' }));
    out(t.actionDone(file)); return 0;
  }
  if (o.cmd !== 'build') { err(t.unknownCmd(o.cmd)); out(t.usage); return 2; }
  if (!o.out) { err(t.need('--out')); return 2; }
  if (!existsSync(factsFile)) { err(t.noFacts(factsFile)); return 2; }

  const raw = readFileSync(factsFile, 'utf8');
  const lang = o.lang === 'en' || o.lang === 'zh' ? o.lang : detectLang(raw);
  t = M[lang];
  const facts = loadFacts(parseFactCard(raw));
  const missing = ['B01', 'B03'].filter((id) => !one(facts, id) || !present(one(facts, id).value));
  if (missing.length) { err(t.missingCore(missing)); return 1; }
  const unconfirmed = facts.entries.filter((e) => !e.confirmed && hasContent(e)).length;
  if (unconfirmed) err(t.skippedFacts(unconfirmed));

  let articles = []; let fill = [];
  if (o.drafts && !existsSync(o.drafts)) { err(t.noDrafts(o.drafts)); return 2; }
  if (o.drafts) {
    const drafts = loadDrafts(resolve(o.drafts));
    const issues = checkDrafts(drafts, { facts: parseFacts(raw), lang });
    const bad = new Set(issues.filter((x) => x.level === 'error').map((x) => x.file));
    articles = drafts.filter((d) => d.confirmed && d.platforms.includes(SITE) && !bad.has(d.file));
    fill = drafts.filter((d) => d.confirmed && d.platforms.some((p) => FILL[p]) && !bad.has(d.file));
    const left = drafts.filter((d) => !articles.includes(d)).map((d) => d.file);
    if (left.length) err(t.skippedDrafts(left));
  }
  const baseUrl = o.baseUrl ? o.baseUrl.replace(/\/*$/, '/') : null;
  if (!baseUrl) err(t.noBase);

  const outDir = resolve(o.out);
  const files = buildSite(facts, { lang, baseUrl, articles, fill });
  // The manifest lists files earlier runs wrote, so stale ones are removed (and nothing else is).
  const manifest = join(outDir, '.geo-site.json');
  let previous = [];
  try { previous = JSON.parse(readFileSync(manifest, 'utf8')).files || []; } catch {}
  const current = files.map((f) => f.path);
  for (const p of previous) {
    if (current.includes(p) || !/^[\w.-]+(\/[\w.-]+)?$/.test(p) || p.includes('..')) continue;
    const file = join(outDir, p);
    if (!existsSync(file)) continue;
    if (o.dryRun) { out(t.dry(t.removed(file))); continue; }
    rmSync(file); out(t.removed(file));
  }
  for (const f of files) {
    const file = join(outDir, f.path);
    if (o.dryRun) { out(t.dry(file)); continue; }
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, f.text); out(t.wrote(file));
  }
  if (!o.dryRun) writeFileSync(manifest, JSON.stringify({ generator: 'geo-site', files: current }, null, 2) + '\n');
  out(t.done(o.out, facts.confirmed.filter(hasContent).length, articles.length));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href || /^geo-site(\.mjs)?$/.test(basename(process.argv[1] || ''))) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 2; });
}
