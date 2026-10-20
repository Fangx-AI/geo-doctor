#!/usr/bin/env node
// geo-facts · geo-doctor
// Turns product material (pages, docs, notes) into candidate facts for the fact card. A model reads the material,
// every candidate must quote the material word for word, and quotes that are not in the material are dropped.
// Nothing becomes usable until a person confirms it: applied candidates go into the fact card as 待确认 / pending.
// 把产品资料（网页、文档、笔记）变成事实卡的候选事实。模型读资料，每条候选都必须逐字引用原文，
// 原文里找不到的引用直接丢弃。写回事实卡时状态是"待确认"，人确认后才能用于写稿。零依赖。
//
//   npx -p github:Fangx-AI/geo-doctor geo-facts extract https://你的官网/pricing 产品说明.md --ai deepseek
//   npx -p github:Fangx-AI/geo-doctor geo-facts list
//   npx -p github:Fangx-AI/geo-doctor geo-facts apply c1,c3      # or: apply all
//
// API keys are read from environment variables only (for example DEEPSEEK_API_KEY).
// API Key 只从环境变量读取（例如 DEEPSEEK_API_KEY）。
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROVIDERS, ask } from './geo-probe.mjs';
import { parseFactCard } from './geo-site.mjs';
import { cleanHtml, visibleText } from './geo-audit.mjs';

export const VERSION = '1.0.0';
const ID_KEYS = new Set(['编号', 'id']);
const SOURCE_KEYS = new Set(['来源', 'source']);
const STATUS_KEYS = new Set(['状态', 'status']);
const CHUNK = 5000;

const M = {
  zh: {
    usage: `geo-facts ${VERSION} · 从资料里抽事实（GEO 医生）

用法：
  geo-facts extract [文件或网址 ...] --ai deepseek[:模型] [--facts geo/fact-card.yaml] [--force]
  geo-facts list    [--all]
  geo-facts apply   c1,c3 | all
  geo-facts ignore  c2 | all

  extract  读资料（.md / .txt / .html 文件或网址；不写时读 geo/sources/ 里的全部文件），
           让模型摘出资料里明确写着的事实，存到 geo/fact-candidates.json。
           每条都要逐字引用原文，原文里找不到的直接丢弃。没改过的资料不会重复抽取，--force 强制重抽。
  list     列出还没处理的候选（--all 包括已写入和已忽略的）。
  apply    把候选写进事实卡：填已有的空条目或新增一条，来源写资料名和原文，状态是"待确认"。
           确认仍然要你自己做（工作台「事实卡」页或直接改文件）。
  ignore   忽略候选。

API Key 只从环境变量读取（例如 DEEPSEEK_API_KEY），不要写在命令或文件里。`,
    need: (x) => `缺少 ${x}`, noFile: (f) => `找不到：${f}`, unknownCmd: (c) => `未知命令：${c}`,
    badAi: (a) => `不认识的 AI：${a}。可选：${Object.keys(PROVIDERS).filter((k) => k !== 'custom').join('、')}`,
    needModel: (a) => `${a} 需要指定模型，例如 --ai ${a}:模型名`, noKey: (v) => `请先设置环境变量 ${v}`,
    noSources: '没有资料：给出文件或网址，或把资料放进 geo/sources/。',
    fetchFailed: (u, m) => `抓取失败：${u}（${m}）`,
    skipped: (n) => `${n} 份资料没改过，跳过（--force 强制重抽）`,
    reading: (name, n) => `读取 ${name}，分 ${n} 段`,
    chunkFailed: (name, i, m) => `${name} 第 ${i} 段失败：${m}`,
    result: (r) => `新候选 ${r.added} 条；丢弃：原文里找不到 ${r.dropped.noQuote} 条，内容和原文对不上 ${r.dropped.unsupported} 条，格式不对 ${r.dropped.invalid} 条，和事实卡重复 ${r.dropped.same} 条。`,
    next: '在工作台「资料」页逐条看，或运行 geo-facts list / apply。',
    none: '没有待处理的候选。',
    line: (c) => `${c.cid}  ${c.id || '新增'}  ${c.section}  ${fieldText(c.fields)}\n    原文：「${c.quote}」（${c.source}）${c.conflict.length ? `\n    和事实卡不同：${c.conflict.map((x) => `${x.field} 现在是「${x.current}」`).join('；')}` : ''}${c.status !== 'new' ? `  [${c.status === 'applied' ? '已写入' : '已忽略'}]` : ''}`,
    applied: (ids) => `已写入事实卡：${ids.join('、')}。状态是"待确认"，确认后才能用于写稿。`,
    ignored: (ids) => `已忽略：${ids.join('、')}`,
    notFound: (ids) => `找不到候选：${ids.join('、')}`,
    noCard: (f) => `找不到事实卡：${f}。先用 GEO 医生第 2 步建一张，或在工作台里用模板开始。`,
  },
  en: {
    usage: `geo-facts ${VERSION} · facts from your material (GEO Doctor)

Usage:
  geo-facts extract [file or URL ...] --ai openai[:model] [--facts geo/fact-card.yaml] [--force]
  geo-facts list    [--all]
  geo-facts apply   c1,c3 | all
  geo-facts ignore  c2 | all

  extract  Reads material (.md / .txt / .html files or URLs; with none given, every file in geo/sources/),
           asks the model for the facts it states explicitly and saves them to geo/fact-candidates.json.
           Each must quote the material word for word; quotes not found in it are dropped.
           Unchanged material is not extracted twice; --force extracts again.
  list     Lists unhandled candidates (--all includes applied and ignored ones).
  apply    Writes candidates into the fact card: fills an empty entry or adds one, with the material name and
           quote as the source and status pending. Confirming is still yours (Studio's Fact card page or the file).
  ignore   Ignores candidates.

API keys are read from environment variables only (for example OPENAI_API_KEY).`,
    need: (x) => `Missing ${x}`, noFile: (f) => `Not found: ${f}`, unknownCmd: (c) => `Unknown command: ${c}`,
    badAi: (a) => `Unknown AI: ${a}. Choose from: ${Object.keys(PROVIDERS).filter((k) => k !== 'custom').join(', ')}`,
    needModel: (a) => `${a} needs a model, for example --ai ${a}:model-name`, noKey: (v) => `Set the ${v} environment variable first`,
    noSources: 'No material: give files or URLs, or put files in geo/sources/.',
    fetchFailed: (u, m) => `Could not fetch ${u} (${m})`,
    skipped: (n) => `${n} unchanged source(s) skipped (--force to extract again)`,
    reading: (name, n) => `Reading ${name} in ${n} part(s)`,
    chunkFailed: (name, i, m) => `${name} part ${i} failed: ${m}`,
    result: (r) => `${r.added} new candidate(s); dropped: ${r.dropped.noQuote} not found in the material, ${r.dropped.unsupported} not supported by their quote, ${r.dropped.invalid} malformed, ${r.dropped.same} already in the fact card.`,
    next: 'Review them on Studio\'s Material page, or run geo-facts list / apply.',
    none: 'No candidates waiting.',
    line: (c) => `${c.cid}  ${c.id || 'new'}  ${c.section}  ${fieldText(c.fields)}\n    Quote: "${c.quote}" (${c.source})${c.conflict.length ? `\n    Differs from the fact card: ${c.conflict.map((x) => `${x.field} is now "${x.current}"`).join('; ')}` : ''}${c.status !== 'new' ? `  [${c.status}]` : ''}`,
    applied: (ids) => `Written to the fact card: ${ids.join(', ')}. Status is pending; confirm before drafting with them.`,
    ignored: (ids) => `Ignored: ${ids.join(', ')}`,
    notFound: (ids) => `No such candidate: ${ids.join(', ')}`,
    noCard: (f) => `Fact card not found: ${f}. Build one first (GEO Doctor step 2) or start from the template in Studio.`,
  },
};

const fieldText = (fields) => Object.entries(fields).map(([k, v]) => `${k}=${v}`).join('；');
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const str = (v) => (Array.isArray(v) ? v.join('、') : v === null || v === undefined ? '' : String(v)).trim();

// ---------------------------------------------------------------- fact card shape

// Sections, their id prefix and fields, read from the card itself so any language or custom section works.
// 从事实卡本身读出分区、编号前缀和字段，所以中英文模板和自定义分区都适用。
export function cardShape(cardText) {
  const sections = [];
  for (const [name, value] of Object.entries(parseFactCard(cardText))) {
    if (!Array.isArray(value)) continue;
    const entries = []; const fields = [];
    for (const raw of value) {
      if (!raw || typeof raw !== 'object') continue;
      const idKey = Object.keys(raw).find((k) => ID_KEYS.has(k.toLowerCase()));
      const id = str(idKey ? raw[idKey] : '');
      if (!id) continue;
      const own = {};
      for (const [k, v] of Object.entries(raw)) {
        const l = k.toLowerCase();
        if (ID_KEYS.has(l) || SOURCE_KEYS.has(l) || STATUS_KEYS.has(l)) continue;
        own[k] = str(v); if (!fields.includes(k)) fields.push(k);
      }
      const statusKey = Object.keys(raw).find((k) => STATUS_KEYS.has(k.toLowerCase()));
      entries.push({ id, fields: own, status: str(statusKey ? raw[statusKey] : '') });
    }
    if (!entries.length) continue;
    const prefix = (entries[0].id.match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
    const zh = Object.keys(value[0] || {}).some((k) => k === '编号');
    sections.push({ name, prefix, fields, entries, zh });
  }
  return sections;
}

// ---------------------------------------------------------------- material

export function htmlToText(html) { return visibleText(cleanHtml(html)); }

export function splitChunks(text, size = CHUNK) {
  const t = text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (t.length <= size) return t ? [t] : [];
  const out = []; let rest = t;
  while (rest.length > size) {
    const window = rest.slice(0, size);
    const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('。'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
    const at = cut > size / 2 ? cut + 1 : size;
    out.push(rest.slice(0, at).trim()); rest = rest.slice(at);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

// Quotes are compared without spaces, sentence punctuation, quote marks, brackets or width differences, so line
// wrapping and full-width marks do not cause false rejections. Symbols that can change a fact stay: currency signs,
// %, /, +, - and a decimal point between digits, so $19.9 and $199 never match.
// 比较时忽略空格、句读、引号、括号和全半角；货币符号、%、/、+、- 和数字间的小数点保留，$19.9 和 $199 不会被当成一样。
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase()
  .replace(/(\d),(?=\d{3}\b)/g, '$1')
  .replace(/(?<!\d)\.|\.(?!\d)/g, '')
  .replace(/[\s,;:!?'"`~()[\]{}<>，。、；：？！“”‘’「」『』（）【】《》〈〉…—–·]/g, '');
export function quoteFound(quote, text) {
  const q = norm(quote);
  return q.length >= 4 && norm(text).includes(q);
}

// A value must come from its quote: every number in it appears in the quote, and at least a third of its
// two-character pieces (or words) do too. A paraphrase that shares nothing with the quote is dropped.
// 值必须出自引用的原文：数字都要在原文里，至少三分之一的字词也要在原文里；和原文毫不相干的改写会被丢弃。
const LATIN = /[a-z0-9$¥€£%/+.-]+/g;
const pieces = (s) => String(s || '').normalize('NFKC').toLowerCase().split(/[\s,;:!?'"`~()[\]{}<>，。、；：？！“”‘’「」『』（）【】《》〈〉…—–·]+/)
  .map(norm).filter(Boolean).flatMap((seg) => [
    ...(seg.match(LATIN) || []),
    ...seg.replace(LATIN, ' ').split(' ').filter(Boolean).flatMap((w) => (w.length < 2 ? [w] : Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2)))),
  ]);
export function valueSupported(value, quote) {
  const q = norm(quote);
  for (const n of norm(value).match(/\d+(?:\.\d+)?/g) || []) if (!q.includes(n)) return false;
  const p = pieces(value);
  if (!p.length) return false;
  return p.filter((x) => q.includes(x)).length / p.length >= 0.3;
}

// ---------------------------------------------------------------- the model

export function extractPrompt({ shape, source, chunk, lang = 'zh' }) {
  const sec = shape.map((s) => `- ${s.name}（${s.prefix}）：${s.fields.join('、')}`).join('\n');
  const short = (v) => (v.length > 40 ? `${v.slice(0, 40)}…` : v);
  const ent = shape.flatMap((s) => s.entries.map((e) => `- ${e.id} ${Object.entries(e.fields).map(([k, v]) => `${k}=${v ? short(v) : '（空）'}`).join(' ')}`)).join('\n');
  if (lang === 'en') {
    return `You are helping fill in a product's fact card. Below is some product material. Extract only facts the material states explicitly. Do not infer, generalize or add common knowledge.

Fact card sections (id prefix): fields
${sec}

Current entries (empty ones can be filled):
${ent}

Output a JSON array. Each element: {"id": "an existing id to fill, or NEW", "section": "section name", "fields": {"field": "value"}, "quote": "one sentence from the material that states this fact, copied word for word"}
Use the field names above. Keep values short and factual, in the material's own words; numbers exactly as written. If there is nothing to extract, output []. Output JSON only.

Material (from ${source}):
<<<
${chunk}
>>>`;
  }
  return `你在帮一个产品填事实卡。下面是一段产品资料。只摘出资料里明确写着的事实，不要推测、不要概括、不要补充常识。

事实卡的分区（编号前缀）：字段
${sec}

事实卡里现有的条目（空的可以填）：
${ent}

输出一个 JSON 数组，每个元素：{"id": "要填的已有编号，新条目写 NEW", "section": "分区名", "fields": {"字段": "值"}, "quote": "资料里写着这条事实的那一句，逐字照抄"}
字段名用上面列出的。值要短、只写事实，尽量用资料里的原话，数字照抄。没有可摘的就输出 []。只输出 JSON。

资料（来自 ${source}）：
<<<
${chunk}
>>>`;
}

export function parseCandidates(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('['); const b = s.lastIndexOf(']');
  if (a < 0 || b < a) return null;
  try { const v = JSON.parse(s.slice(a, b + 1)); return Array.isArray(v) ? v : null; } catch { return null; }
}

// Checks one model suggestion against the card and the material. Returns {candidate} or {drop: reason}.
// 用事实卡和原文核对一条建议：返回候选，或丢弃原因。
export function checkCandidate(raw, shape, material) {
  if (!raw || typeof raw !== 'object' || !raw.fields || typeof raw.fields !== 'object') return { drop: 'invalid' };
  const quote = str(raw.quote);
  if (!quoteFound(quote, material)) return { drop: 'noQuote' };
  const wanted = str(raw.id).toUpperCase();
  let section = null; let entry = null;
  if (wanted && wanted !== 'NEW') {
    for (const s of shape) { const e = s.entries.find((x) => x.id.toUpperCase() === wanted); if (e) { section = s; entry = e; break; } }
  }
  if (!section) section = shape.find((s) => s.name === str(raw.section)) || shape.find((s) => wanted && s.prefix === (wanted.match(/^[A-Z]+/) || [''])[0]);
  if (!section) return { drop: 'invalid' };
  const allowed = new Set([...section.fields, ...(entry ? Object.keys(entry.fields) : [])]);
  const fields = {};
  for (const [k, v] of Object.entries(raw.fields)) { const val = str(v); if (allowed.has(k) && val) fields[k] = val.replace(/\s+/g, ' '); }
  if (!Object.keys(fields).length) return { drop: 'invalid' };
  // Label-like fields (项目, 类型…) only name an existing slot; filling needs a real value. 只有标签没有内容不算。
  // Only values the quote supports count; a label already in the card (项目: 名称) needs no support.
  for (const [k, v] of Object.entries(fields)) {
    if (entry && norm(entry.fields[k] || '') === norm(v)) continue;
    if (!valueSupported(v, quote)) return { drop: 'unsupported' };
  }
  const conflict = [];
  if (entry) {
    let news = 0;
    for (const [k, v] of Object.entries(fields)) {
      const cur = entry.fields[k] || '';
      if (!cur) news++;
      else if (norm(cur) !== norm(v)) { news++; conflict.push({ field: k, current: cur }); }
    }
    if (!news) return { drop: 'same' };
  } else {
    const key = norm(Object.values(fields).join(''));
    if (section.entries.some((e) => norm(Object.values(e.fields).join('')) === key)) return { drop: 'same' };
  }
  return { candidate: { id: entry ? entry.id : null, section: section.name, fields, quote, conflict } };
}

function resolveAi(spec, env, t) {
  const [name, ...rest] = String(spec).split(':'); const p = PROVIDERS[name.toLowerCase()];
  if (!p || name.toLowerCase() === 'custom') throw new Error(t.badAi(name));
  const model = rest.join(':') || p.model;
  if (!model) throw new Error(t.needModel(name));
  if (!env[p.key]) throw new Error(t.noKey(p.key));
  return { name: name.toLowerCase(), p, model, key: env[p.key] };
}

async function askRetry(p, args, sleep) {
  for (let i = 0; ; i++) {
    try { return await ask(p, args); } catch (e) { if (!e.retry || i >= 2) throw e; await sleep([2000, 6000][i]); }
  }
}

// Runs every chunk of every source through the model and keeps the candidates that pass checkCandidate.
// 每份资料分段交给模型，只留下通过核对的候选。
export async function extractFacts({ sources, cardText, ai, lang = 'zh', fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), out = () => {}, err = () => {} }) {
  const t = M[lang];
  const shape = cardShape(cardText);
  const found = []; const dropped = { noQuote: 0, unsupported: 0, invalid: 0, same: 0 }; let failed = 0;
  for (const src of sources) {
    const chunks = splitChunks(src.text);
    out(t.reading(src.name, chunks.length));
    for (let i = 0; i < chunks.length; i++) {
      let res;
      try {
        res = await askRetry(ai.p, { base: ai.p.base, key: ai.key, model: ai.model, question: extractPrompt({ shape, source: src.name, chunk: chunks[i], lang }), maxTokens: 3000, fetchImpl }, sleep);
      } catch (e) { failed++; err(t.chunkFailed(src.name, i + 1, e.message)); continue; }
      const list = parseCandidates(res.text);
      if (!list) { dropped.invalid++; continue; }
      for (const raw of list) {
        const r = checkCandidate(raw, shape, src.text);
        if (r.drop) { dropped[r.drop]++; continue; }
        const dup = found.some((c) => c.id === r.candidate.id && c.section === r.candidate.section && norm(fieldText(c.fields)) === norm(fieldText(r.candidate.fields)));
        if (dup) { dropped.same++; continue; }
        found.push({ ...r.candidate, source: src.name });
      }
    }
  }
  return { found, dropped, failed };
}

// ---------------------------------------------------------------- candidates file

export function loadCandidates(file) {
  if (!existsSync(file)) return { done: {}, items: [] };
  const v = JSON.parse(readFileSync(file, 'utf8'));
  return { done: v.done || {}, items: Array.isArray(v.items) ? v.items : [] };
}
export function saveCandidates(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
export function addCandidates(data, found, date) {
  let n = data.items.reduce((m, c) => Math.max(m, parseInt(String(c.cid).slice(1), 10) || 0), 0);
  const key = (c) => [c.id || '', c.section, norm(fieldText(c.fields))].join('\u0000');
  const seen = new Set(data.items.filter((c) => c.status !== 'ignored').map(key));
  let added = 0;
  for (const c of found) {
    if (seen.has(key(c))) continue;
    seen.add(key(c)); data.items.push({ cid: `c${++n}`, status: 'new', date, ...c }); added++;
  }
  return added;
}

// ---------------------------------------------------------------- writing the card

const yq = (v) => `"${String(v).replace(/\\/g, '/').replace(/"/g, '”').replace(/\s+/g, ' ').trim()}"`;

// Sets (or adds) one field of one entry, leaving every other line as written. Returns null if the id is missing.
// 改（或补）一条事实的一个字段，其余行原样保留；找不到编号时返回 null。
export function setEntryField(src, id, key, value) {
  const lines = src.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const idRe = /^(\s*)(-\s+)?(编号|id)\s*:\s*["']?([\w-]+)["']?\s*(?:#.*)?$/i;
  const keyRe = new RegExp(`^(\\s*)(${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*:`, 'i');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(idRe);
    if (!m || m[4] !== id) continue;
    const indent = m[1].length + (m[2] ? m[2].length : 0);
    let last = i;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      const ind = l.match(/^ */)[0].length;
      if (ind < indent) break;
      last = j;
      if (ind === indent && keyRe.test(l)) {
        // An empty key followed by a block list (内容:\n  - a\n  - b) loses the list; a trailing comment stays.
        let k = j + 1;
        if (/^[^:]+:\s*(#.*)?$/.test(l.trim())) while (k < lines.length && lines[k].match(/^ */)[0].length > indent && /^\s*-\s/.test(lines[k])) k++;
        const comment = (l.match(/\s+#[^"']*$/) || [''])[0];
        lines.splice(j, k - j, `${' '.repeat(indent)}${l.trim().match(/^[^:]+/)[0].trim()}: ${value}${comment}`);
        return lines.join('\n');
      }
    }
    lines.splice(last + 1, 0, `${' '.repeat(indent)}${key}: ${value}`);
    return lines.join('\n');
  }
  return null;
}

// Adds a new entry at the end of its section with the next free id. 在分区末尾新增一条，编号顺延。
export function addEntry(src, section, fields, { sourceText, zh = true } = {}) {
  const lines = src.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const head = lines.findIndex((l) => new RegExp(`^${section.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(l));
  if (head < 0) return null;
  let end = lines.length; let dash = 2;
  for (let j = head + 1; j < lines.length; j++) {
    const l = lines[j];
    if (/^\S/.test(l) && !/^#/.test(l)) { end = j; break; }
    const d = l.match(/^(\s*)-\s/); if (d && dash === 2) dash = d[1].length;
  }
  while (end > head + 1 && !lines[end - 1].trim()) end--;
  const nums = section.entries.map((e) => parseInt(e.id.slice(section.prefix.length), 10)).filter(Number.isFinite);
  const id = `${section.prefix}${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0')}`;
  const pad = ' '.repeat(dash + 2);
  const block = [`${' '.repeat(dash)}- ${zh ? '编号' : 'id'}: ${id}`, ...Object.entries(fields).map(([k, v]) => `${pad}${k}: ${yq(v)}`),
    `${pad}${zh ? '来源' : 'source'}: ${yq(sourceText)}`, `${pad}${zh ? '状态' : 'status'}: ${zh ? '待确认' : 'pending'}`];
  lines.splice(end, 0, ...block);
  return { text: lines.join('\n'), id };
}

// Writes one candidate into the card text. 把一条候选写进事实卡。
export function applyCandidate(src, c) {
  const shape = cardShape(src);
  const section = shape.find((s) => s.name === c.section);
  if (!section) return null;
  const zh = section.zh;
  const sourceText = zh ? `${c.source}：「${c.quote}」` : `${c.source}: "${c.quote}"`;
  // A new fact goes into the section's first blank template entry (F01 with every field empty) before a new id is added.
  // 新事实先填分区里完全空白的模板条目，没有空白条目才新增编号。
  const blank = !c.id && section.entries.find((e) => Object.values(e.fields).every((v) => !v));
  if (!c.id && !blank) return addEntry(src, section, c.fields, { sourceText, zh });
  const id = c.id || blank.id;
  const current = section.entries.find((e) => e.id === id)?.fields || {};
  let text = src; let disagree = false;
  for (const [k, v] of Object.entries(c.fields)) {
    const cur = current[k] || '';
    if (norm(cur) === norm(v)) continue;
    if (cur) disagree = true;
    // Both sayings stay in the card until a person picks one. 两种说法都留着，由人来选。
    const value = cur ? (zh ? `${v}（另一说法：${cur}）` : `${v} (other source: ${cur})`) : v;
    text = setEntryField(text, id, k, yq(value)); if (text === null) return null;
  }
  text = setEntryField(text, id, zh ? '来源' : 'source', yq(sourceText));
  // Judged against the card as it is now, not as it was at extraction. 按写入时的事实卡判断冲突。
  const status = disagree ? (zh ? '来源冲突' : 'conflict') : (zh ? '待确认' : 'pending');
  text = setEntryField(text, id, zh ? '状态' : 'status', status);
  return { text, id };
}

// ---------------------------------------------------------------- sources

export async function readSource(spec, { fetchImpl = fetch } = {}) {
  if (/^https?:\/\//i.test(spec)) {
    const res = await fetchImpl(spec, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; geo-doctor geo-facts)' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    const type = res.headers?.get?.('content-type') || '';
    return { name: spec, text: /html/i.test(type) || /<html|<body/i.test(body) ? htmlToText(body) : body };
  }
  let body = readFileSync(spec, 'utf8').replace(/^\uFEFF/, '');
  // A first line "来源: <url>" (written by the studio for fetched pages) names where the text came from.
  const head = body.match(/^(?:来源|source)\s*[:：]\s*(\S+)[ \t]*\r?\n/i);
  if (head) body = body.slice(head[0].length);
  return { name: head ? head[1] : basename(spec), text: /\.html?$/i.test(extname(spec)) ? htmlToText(body) : body };
}

export function listSourceFiles(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => /\.(md|markdown|txt|html?)$/i.test(f) && !f.startsWith('.')).sort().map((f) => join(dir, f)) : [];
}

// ---------------------------------------------------------------- CLI

const VALUE_FLAGS = ['--ai', '--facts', '--candidates', '--sources', '--lang'];
export function parseArgs(argv) {
  const o = { cmd: null, args: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '--force') o.force = true;
    else if (a === '--all') o.all = true;
    else if (VALUE_FLAGS.includes(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      o[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) o.unknown = a;
    else if (!o.cmd) o.cmd = a;
    else o.args.push(a);
  }
  return o;
}

function detectLang() {
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  return /^zh/i.test(env || Intl.DateTimeFormat().resolvedOptions().locale || '') ? 'zh' : 'en';
}

const pad2 = (n) => String(n).padStart(2, '0');
const today = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export async function main(argv, { env = process.env, out = console.log, err = console.error, fetchImpl = fetch, sleep, now = () => new Date() } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { err(e.message); return 2; }
  const lang = o.lang === 'en' || o.lang === 'zh' ? o.lang : detectLang();
  const t = M[lang];
  if (o.version) { out(VERSION); return 0; }
  if (o.help || !o.cmd || o.unknown) { out(t.usage); return o.help ? 0 : 2; }
  if (!['extract', 'list', 'apply', 'ignore'].includes(o.cmd)) { err(t.unknownCmd(o.cmd)); out(t.usage); return 2; }
  const factsFile = o.facts || join('geo', 'fact-card.yaml');
  const candFile = o.candidates || join('geo', 'fact-candidates.json');
  let data;
  try { data = loadCandidates(candFile); } catch (e) { err(`${candFile}: ${e.message}`); return 2; }

  if (o.cmd === 'list') {
    const items = data.items.filter((c) => o.all || c.status === 'new');
    out(items.length ? items.map(t.line).join('\n') : t.none);
    return 0;
  }

  if (!existsSync(factsFile)) { err(t.noCard(factsFile)); return 2; }
  const cardText = readFileSync(factsFile, 'utf8');

  if (o.cmd === 'apply' || o.cmd === 'ignore') {
    const want = o.args.join(',').split(',').map((s) => s.trim()).filter(Boolean);
    if (!want.length) { err(t.need('c1,c2 | all')); return 2; }
    const pick = want.includes('all') ? data.items.filter((c) => c.status === 'new') : want.map((id) => data.items.find((c) => c.cid === id)).filter(Boolean);
    const missing = want.includes('all') ? [] : want.filter((id) => !data.items.some((c) => c.cid === id));
    if (missing.length) { err(t.notFound(missing)); return 1; }
    if (o.cmd === 'ignore') {
      for (const c of pick) c.status = 'ignored';
      saveCandidates(candFile, data); out(t.ignored(pick.map((c) => c.cid))); return 0;
    }
    let text = cardText; const done = [];
    for (const c of pick) {
      if (c.status === 'applied') continue;
      const r = applyCandidate(text, c);
      if (!r) { err(t.notFound([c.cid])); continue; }
      text = r.text; c.status = 'applied'; c.appliedAs = r.id; done.push(`${c.cid}→${r.id}`);
    }
    writeFileSync(factsFile, text); saveCandidates(candFile, data);
    out(t.applied(done)); return 0;
  }

  // extract
  if (!o.ai) { err(t.need('--ai')); return 2; }
  let ai;
  try { ai = resolveAi(o.ai, env, t); } catch (e) { err(e.message); return 2; }
  const specs = o.args.length ? o.args : listSourceFiles(o.sources || join('geo', 'sources'));
  if (!specs.length) { err(t.noSources); return 2; }
  const sources = []; let skipped = 0;
  for (const spec of specs) {
    if (!/^https?:\/\//i.test(spec) && !existsSync(spec)) { err(t.noFile(spec)); return 2; }
    try {
      const s = await readSource(spec, { fetchImpl });
      const h = sha(s.text);
      if (!o.force && data.done[s.name] === h) { skipped++; continue; }
      sources.push({ ...s, hash: h });
    } catch (e) { err(t.fetchFailed(spec, e.message)); return 1; }
  }
  if (skipped) out(t.skipped(skipped));
  if (!sources.length) return 0;
  const r = await extractFacts({ sources, cardText, ai, lang, fetchImpl, ...(sleep ? { sleep } : {}), out, err });
  const added = addCandidates(data, r.found, today(now()));
  if (!r.failed) for (const s of sources) data.done[s.name] = s.hash;
  saveCandidates(candFile, data);
  out(t.result({ added, dropped: r.dropped }));
  if (added) out(t.next);
  return r.failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href || /^geo-facts(\.mjs)?$/.test(basename(process.argv[1] || ''))) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 2; });
}
