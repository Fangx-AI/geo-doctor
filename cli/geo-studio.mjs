#!/usr/bin/env node
// geo-studio · geo-doctor
// A local web console for the whole loop: see who the AIs recommend, the gaps, the fact card, the drafts,
// approve or send back each draft, and run sampling, drafting, reports and the fact site with one click.
// 本地网页工作台：看 AI 推荐谁、缺口、事实卡和草稿，逐篇审核，一键运行采样、写稿、报告和事实站。零依赖。
//
//   npx -p github:Fangx-AI/geo-doctor geo-studio            # opens on http://127.0.0.1:4173, data in ./geo
//   npx -p github:Fangx-AI/geo-doctor geo-studio --dir 项目目录 --port 8080
//
// Everything lives in the geo/ folder (plain files you can keep in git); there is no database.
// It listens on 127.0.0.1 only. To listen elsewhere, set GEO_STUDIO_TOKEN (at least 12 characters) first:
// every request then needs that token. API keys are read from environment variables and never shown.
// 数据就是 geo/ 文件夹里的普通文件，没有数据库。默认只监听本机；要对外监听，先设置环境变量
// GEO_STUDIO_TOKEN（至少 12 位），所有请求都要带这个口令。API Key 只从环境变量读取，页面上不显示。
// SPDX-License-Identifier: MIT

import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROVIDERS, parseCsv, loadQuestions, summarize, main as probeMain } from './geo-probe.mjs';
import { checkDrafts, loadDrafts, parseFacts, main as publishMain } from './geo-publish.mjs';
import { parseFactCard, loadFacts, main as siteMain } from './geo-site.mjs';
import { findGaps, loadSnapshots, configTemplate, main as autopilotMain } from './geo-autopilot.mjs';
import { applyCandidate, loadCandidates, saveCandidates, readSource, listSourceFiles, main as factsMain } from './geo-facts.mjs';

export const VERSION = '1.0.0';
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const MAX_BODY = 5 * 1024 * 1024;
const TEMPLATES = fileURLToPath(new URL('../skills/geo-doctor/assets/', import.meta.url));

const M = {
  zh: {
    usage: `geo-studio ${VERSION} · GEO 医生工作台（本地网页后台）

用法：
  geo-studio [--dir 项目目录] [--port 4173] [--host 127.0.0.1] [--lang zh|en]

  打开后在浏览器里看推荐率趋势和缺口、编辑事实卡和问题集、审核草稿，
  一键运行采样（geo-probe）、写稿和报告（geo-autopilot）、检查草稿（geo-publish）、生成事实站（geo-site）。
  数据都在 项目目录/geo/ 里，没有数据库。

  默认只监听本机。要监听其他地址（例如放在服务器上），先设置环境变量 GEO_STUDIO_TOKEN（至少 12 位），
  打开页面时输入这个口令。口令在 HTTP 上是明文传输，对外使用时请放在 HTTPS 反向代理后面。
  API Key 只从环境变量读取（例如 DEEPSEEK_API_KEY），在启动前设置好。`,
    started: (url) => `GEO 医生工作台已启动：${url}\n按 Ctrl+C 停止。`,
    needToken: '监听本机以外的地址时，请先设置环境变量 GEO_STUDIO_TOKEN（至少 12 位）。',
    plainHttp: '注意：工作台本身只提供 HTTP，口令和内容都是明文传输。请只通过 HTTPS 反向代理（例如 Caddy、Nginx）对外访问。',
    badPort: (p) => `端口不对：${p}`,
    noDir: (d) => `找不到目录：${d}`,
  },
  en: {
    usage: `geo-studio ${VERSION} · GEO Doctor Studio (local web console)

Usage:
  geo-studio [--dir project] [--port 4173] [--host 127.0.0.1] [--lang zh|en]

  In the browser: recommendation trend and gaps, edit the fact card and question set, review drafts,
  and run sampling (geo-probe), drafting and reports (geo-autopilot), draft checks (geo-publish)
  and the fact site (geo-site) with one click. Everything lives in project/geo/; there is no database.

  Listens on this machine only by default. To listen on another address (for example on a server),
  set GEO_STUDIO_TOKEN (12+ characters) first and enter it when the page asks. The token travels in
  plain text over HTTP, so put the studio behind an HTTPS reverse proxy when it is reachable from outside.
  API keys are read from environment variables (for example OPENAI_API_KEY); set them before starting.`,
    started: (url) => `GEO Doctor Studio is running: ${url}\nPress Ctrl+C to stop.`,
    needToken: 'Set GEO_STUDIO_TOKEN (12+ characters) before listening on an address other than this machine.',
    plainHttp: 'Note: the studio itself only speaks HTTP, so the token and your data travel in plain text. Reach it only through an HTTPS reverse proxy (for example Caddy or Nginx).',
    badPort: (p) => `Invalid port: ${p}`,
    noDir: (d) => `Directory not found: ${d}`,
  },
};

// ---------------------------------------------------------------- files

export function paths(dir) {
  const geo = join(dir, 'geo');
  return {
    geo, questions: join(geo, 'questions.csv'), facts: join(geo, 'fact-card.yaml'), config: join(geo, 'autopilot.json'),
    runs: join(geo, 'runs.csv'), drafts: join(geo, 'drafts'), reports: join(geo, 'reports'), site: join(dir, 'site'),
    sources: join(geo, 'sources'), candidates: join(geo, 'fact-candidates.json'),
  };
}
const read = (f) => readFileSync(f, 'utf8');
const text = (v) => (Array.isArray(v) ? v.join('、') : String(v ?? '').trim());
const first = (...vals) => text(vals.find((v) => (Array.isArray(v) ? v.length : v !== undefined && v !== null && String(v).trim() !== '')));
const DRAFT_FILE = /^[\w一-鿿][\w.一-鿿-]*\.md$/;
const REPORT_FILE = /^[\w.-]+\.md$/;
const SOURCE_FILE = /^[\w\u4e00-\u9fff][\w.\u4e00-\u9fff-]*\.(md|markdown|txt|html?)$/i;
// A readable file name for pasted or fetched material. 给粘贴或抓取的资料起个文件名。
export function sourceFileName(name, ext = 'txt') {
  const base = String(name || '').replace(/^https?:\/\//i, '').replace(/\.(md|markdown|txt|html?)$/i, '').replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'material';
  return `${base}.${ext}`;
}

// Sets one fact's status in the fact card text, keeping everything else as written. Returns null if the id is not there.
// 只改一条事实的状态，其余原样保留；找不到编号时返回 null。
export function setFactStatus(src, id, confirmed) {
  const lines = src.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const idRe = /^(\s*)(-\s+)?(编号|id)\s*:\s*["']?([\w-]+)["']?\s*(?:#.*)?$/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(idRe);
    if (!m || m[4] !== id) continue;
    const indent = m[1].length + (m[2] ? m[2].length : 0);
    const zh = m[3] === '编号';
    const value = confirmed ? (zh ? '已确认' : 'confirmed') : (zh ? '待确认' : 'pending');
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      const ind = l.match(/^ */)[0].length;
      if (ind < indent) break;
      if (ind === indent && /^(状态|status)\s*:/i.test(l.trim())) {
        lines[j] = l.replace(/^(\s*(?:状态|status)\s*:).*$/i, `$1 ${value}`);
        return lines.join('\n');
      }
    }
    lines.splice(i + 1, 0, `${' '.repeat(indent)}${zh ? '状态' : 'status'}: ${value}`);
    return lines.join('\n');
  }
  return null;
}

// Sets `status:` in a draft's front matter. 改草稿 front matter 里的 status。
export function setDraftStatus(src, status) {
  const s = src.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = s.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return null;
  const head = /^status\s*:.*$/m.test(m[1]) ? m[1].replace(/^status\s*:.*$/m, `status: ${status}`) : `${m[1]}\nstatus: ${status}`;
  return `---\n${head}\n---\n${s.slice(m[0].length)}`;
}

// Everything the page shows, read fresh from geo/ on every request. 页面要显示的全部内容，每次都从 geo/ 现读。
export function readState(dir, { env = process.env, lang = 'zh' } = {}) {
  const p = paths(dir);
  const files = Object.fromEntries(['questions', 'facts', 'config', 'runs', 'drafts'].map((k) => [k, existsSync(p[k])]));
  const errors = {};

  let config = null;
  if (files.config) try { config = JSON.parse(read(p.config)); } catch (e) { errors.config = e.message; }

  let questions = []; let priority = new Map();
  if (files.questions) {
    try {
      const src = read(p.questions);
      questions = loadQuestions(src).asked;
      priority = new Map(parseCsv(src).map((r) => [(r.id || r.ID || '').trim(), r['优先级'] || r.priority || '']));
    } catch (e) { errors.questions = e.message; }
  }

  let facts = null;
  if (files.facts) {
    try {
      const f = loadFacts(parseFactCard(read(p.facts)));
      facts = {
        checkedBy: f.checkedBy, checkedOn: f.checkedOn,
        entries: f.entries.filter((e) => e.id).map((e) => ({
          id: e.id, section: e.section, confirmed: e.confirmed, status: text(e.status) || '',
          label: first(e.item, e.capability, e.name, e.audience, e.scenario, e.against, e.type),
          detail: first(e.value, e.limit, e.price, e.diff, e.includes, e.url, e.source),
          // Has content beyond labels (项目, 类型) and bookkeeping (来源, 状态). 除标签和来源外有实际内容。
          filled: Object.entries(e.raw).some(([k, v]) => !/^(编号|id|来源|source|状态|status|项目|item|field|类型|type)$/i.test(k) && text(v) !== ''),
        })),
      };
    } catch (e) { errors.facts = e.message; }
  }

  let drafts = [];
  if (files.drafts) {
    const list = loadDrafts(p.drafts);
    const issues = checkDrafts(list, { facts: files.facts ? parseFacts(read(p.facts)) : null, missingFactCard: files.facts ? null : p.facts, lang });
    drafts = list.map((d) => ({
      file: d.file, title: d.title, slug: d.slug, qid: d.meta.qid || '', question: d.meta.question || '', status: text(d.meta.status),
      confirmed: d.confirmed, facts: d.facts, generatedBy: d.meta.generated_by || '',
      issues: issues.filter((x) => x.file === d.file).map(({ level, code, msg }) => ({ level, code, msg })),
    }));
  }

  let trend = []; let gaps = []; let batches = [];
  if (files.runs) {
    const rows = parseCsv(read(p.runs)).filter((r) => r['批次']);
    const allBatches = [...new Set(rows.map((r) => r['批次']))];
    const snaps = loadSnapshots(join(p.geo, 'runs'), allBatches);
    const types = new Map(questions.map((q) => [q.id, q.cls]));
    const byBatch = new Map([...snaps].map(([b, m]) => [b, new Map([...m].map(([id, q]) => [id, q.cls]))]));
    const dates = new Map();
    for (const r of rows) { const d = r['日期'] || ''; if (!dates.has(r['批次']) || d > dates.get(r['批次'])) dates.set(r['批次'], d); }
    trend = summarize(rows, types, byBatch)
      .map((g) => ({ batch: g.batch, platform: g.platform, entry: g.entry, date: dates.get(g.batch) || '', planned: g.planned, valid: g.valid,
        recommend: g.recommend, mention: g.mention, board: g.board.slice(0, 3), sources: g.sources.slice(0, 5) }))
      .sort((a, b) => a.platform.localeCompare(b.platform) || a.date.localeCompare(b.date) || a.batch.localeCompare(b.batch));
    // Same rows as geo-autopilot (API samples), so the page and the weekly report agree. 和每周报告用同一批数据。
    const api = rows.filter((r) => r['入口'] === 'API');
    if (api.length && questions.length) {
      const draftList = files.drafts ? loadDrafts(p.drafts) : [];
      ({ gaps, batches } = findGaps({ rows: api, questions, drafts: draftList, priority, snapshots: snaps }));
    }
  }

  const reports = existsSync(p.reports) ? readdirSync(p.reports).filter((f) => REPORT_FILE.test(f)).sort().reverse() : [];
  const sources = listSourceFiles(p.sources).map((f) => {
    const head = read(f).slice(0, 300).match(/^(?:来源|source)\s*[:：]\s*(\S+)/i);
    return { file: basename(f), from: head ? head[1] : '' };
  });
  let candidates = [];
  try { candidates = loadCandidates(p.candidates).items; } catch (e) { errors.candidates = e.message; }
  const keys = Object.entries(PROVIDERS).filter(([, v]) => v.key).map(([id, v]) => ({ id, label: v.label, env: v.key, set: !!env[v.key], url: v.keyUrl || '' }));
  return {
    version: VERSION, dir: resolve(dir), lang, files, errors, config, keys,
    questions: questions.map((q) => ({ id: q.id, cls: q.cls, question: q.question, priority: priority.get(q.id) || '' })),
    facts, drafts, trend, gaps, batches, reports, sources, candidates,
    templates: existsSync(join(TEMPLATES, 'fact-card.yaml')),
  };
}

// ---------------------------------------------------------------- runs

// What each button runs. Commands come only from this list; settings come from geo/autopilot.json.
// 每个按钮对应的命令只来自这张表，参数取自 geo/autopilot.json。
export function commandFor(cmd, dir, config, lang) {
  const p = paths(dir); const c = config || {};
  const need = (...ks) => { for (const k of ks) if (!c[k]) throw new Error(lang === 'en' ? `Set "${k}" in geo/autopilot.json first` : `请先在 geo/autopilot.json 里填写 "${k}"`); };
  switch (cmd) {
    case 'probe':
      need('brand', 'ai');
      return { run: probeMain, argv: ['run', p.questions, '--ai', String(c.ai), '--brand', String(c.brand), ...(c.competitors ? ['--competitors', String(c.competitors)] : []),
        '--times', String(c.times || 2), '--runs', p.runs, '--lang', lang] };
    case 'write': {
      need('brand', 'ai');
      const ai = String(c.writer || String(c.ai).split(',')[0]).trim();
      return { run: autopilotMain, argv: ['write', '--ai', ai, '--brand', String(c.brand), '--max', String(c.maxDrafts || 3), '--lang', lang], cwd: true };
    }
    case 'report': return { run: autopilotMain, argv: ['report', '--lang', lang], cwd: true };
    case 'weekly': need('brand', 'ai'); return { run: autopilotMain, argv: ['weekly', '--lang', lang], cwd: true };
    case 'check': return { run: publishMain, argv: ['check', p.drafts, '--lang', lang] };
    case 'facts': {
      const ai = String(c.writer || String(c.ai || '').split(',')[0]).trim();
      if (!ai) need('ai');
      return { run: factsMain, argv: ['extract', '--ai', ai, '--lang', lang], cwd: true };
    }
    case 'site':
      return { run: siteMain, argv: ['build', '--facts', p.facts, ...(existsSync(p.drafts) ? ['--drafts', p.drafts] : []), '--out', p.site,
        ...(c.baseUrl ? ['--base-url', String(c.baseUrl)] : [])] };
    default: return null;
  }
}

// ---------------------------------------------------------------- server

const sha = (s) => createHash('sha256').update(String(s)).digest();
const sameToken = (a, b) => timingSafeEqual(sha(a), sha(b));

function send(res, code, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    ...(type.startsWith('text/html') ? { 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } : {}) });
  res.end(data);
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { fail(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { fail(Object.assign(new Error('bad json'), { status: 400 })); }
    });
    req.on('error', fail);
  });
}

// Validates an edited file before it replaces the old one. 保存前先检查，格式不对就不写。
function validate(name, src) {
  if (name === 'config') { const c = JSON.parse(src); if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('JSON object expected'); }
  if (name === 'questions') { if (!loadQuestions(src).asked.length) throw new Error('no questions'); }
  if (name === 'facts') { if (!Object.keys(parseFactCard(src)).length) throw new Error('empty fact card'); }
}

export function createStudio({ dir = '.', lang = 'zh', env = process.env, token = null, loopback = true, fetchImpl = fetch, sleep } = {}) {
  dir = resolve(dir);
  const p = paths(dir);
  let busy = null; let last = null;

  async function runCmd(cmd) {
    const state = readState(dir, { env, lang });
    const spec = commandFor(cmd, dir, state.config, lang);
    if (!spec) return { status: 400, body: { error: 'unknown command' } };
    if (busy) return { status: 409, body: { error: busy } };
    busy = cmd; const out = []; const err = []; const cwd = process.cwd(); const started = new Date().toISOString();
    try {
      if (spec.cwd) process.chdir(dir);
      const code = await spec.run(spec.argv, { env, out: (s) => out.push(String(s)), err: (s) => err.push(String(s)), fetchImpl, ...(sleep ? { sleep } : {}) });
      last = { cmd, code, out: out.join('\n'), err: err.join('\n'), started, finished: new Date().toISOString() };
    } catch (e) {
      last = { cmd, code: 2, out: out.join('\n'), err: [...err, e.message].join('\n'), started, finished: new Date().toISOString() };
    } finally { if (spec.cwd) process.chdir(cwd); busy = null; }
    return { status: 200, body: last };
  }

  async function api(req, res, url) {
    const route = url.pathname.slice('/api/'.length).split('/').map(decodeURIComponent);
    const m = req.method;
    if (m !== 'GET') {
      // A custom header plus JSON means a page on another site cannot post here without a CORS preflight we never answer.
      if (req.headers['x-geo-studio'] !== '1' || !/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 403, { error: 'forbidden' });
    }
    if (m === 'GET' && route[0] === 'state') return send(res, 200, { ...readState(dir, { env, lang }), busy, last });

    if (route[0] === 'file' && ['questions', 'facts', 'config'].includes(route[1])) {
      const f = p[route[1]];
      if (m === 'GET') return send(res, 200, { name: route[1], text: existsSync(f) ? read(f) : '' });
      if (m === 'PUT') {
        const { text: src } = await readBody(req);
        if (typeof src !== 'string') return send(res, 400, { error: 'text expected' });
        try { validate(route[1], src); } catch (e) { return send(res, 422, { error: e.message }); }
        mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, src);
        return send(res, 200, { ok: true });
      }
    }

    if (route[0] === 'fact' && route[1] && m === 'POST') {
      if (!existsSync(p.facts)) return send(res, 404, { error: 'no fact card' });
      const { confirmed } = await readBody(req);
      // An empty entry cannot be confirmed: it would let drafts cite a fact that says nothing. 空条目不能确认。
      const entry = readState(dir, { env, lang }).facts?.entries.find((e) => e.id === route[1]);
      if (confirmed && entry && !entry.filled) return send(res, 422, { error: 'empty fact' });
      const next = setFactStatus(read(p.facts), route[1], !!confirmed);
      if (next === null) return send(res, 404, { error: 'fact not found' });
      writeFileSync(p.facts, next);
      return send(res, 200, { ok: true });
    }

    if (route[0] === 'draft' && route[1]) {
      const name = route[1];
      if (!DRAFT_FILE.test(name) || basename(name) !== name) return send(res, 400, { error: 'bad file name' });
      const f = join(p.drafts, name);
      if (!existsSync(f)) return send(res, 404, { error: 'not found' });
      if (m === 'GET' && !route[2]) return send(res, 200, { file: name, text: read(f) });
      if (m === 'PUT' && !route[2]) {
        const { text: src } = await readBody(req);
        if (typeof src !== 'string' || !src.trim()) return send(res, 400, { error: 'text expected' });
        writeFileSync(f, src); return send(res, 200, { ok: true });
      }
      if (m === 'POST' && route[2] === 'status') {
        const { status } = await readBody(req);
        if (!['confirmed', 'draft'].includes(status)) return send(res, 400, { error: 'status must be confirmed or draft' });
        if (status === 'confirmed') {
          // Approval follows the same rules as publishing: a draft with errors cannot be confirmed. 有错误的稿件不能通过。
          const d = readState(dir, { env, lang }).drafts.find((x) => x.file === name);
          const errs = (d?.issues || []).filter((x) => x.level === 'error' && x.code !== 'bad-status');
          if (errs.length) return send(res, 422, { error: errs.map((x) => x.msg).join('; '), issues: errs });
        }
        const next = setDraftStatus(read(f), status);
        if (next === null) return send(res, 422, { error: 'no front matter' });
        writeFileSync(f, next); return send(res, 200, { ok: true });
      }
    }

    if (route[0] === 'report' && route[1] && m === 'GET') {
      if (!REPORT_FILE.test(route[1])) return send(res, 400, { error: 'bad file name' });
      const f = join(p.reports, route[1]);
      return existsSync(f) ? send(res, 200, { file: route[1], text: read(f) }) : send(res, 404, { error: 'not found' });
    }

    if (route[0] === 'run' && m === 'POST') {
      const { cmd } = await readBody(req);
      const r = await runCmd(String(cmd || ''));
      return send(res, r.status, r.body);
    }

    if (route[0] === 'source' && m === 'POST') {
      // Pasted text, an uploaded file's text, or a page fetched here. 粘贴的文字、上传的文件，或在这里抓取的网页。
      const b = await readBody(req);
      let name; let body;
      if (typeof b.url === 'string' && /^https?:\/\//i.test(b.url)) {
        try { const s = await readSource(b.url, { fetchImpl }); name = sourceFileName(b.url); body = `来源: ${b.url}\n${s.text}\n`; } catch (e) { return send(res, 502, { error: e.message }); }
      } else if (typeof b.text === 'string' && b.text.trim()) {
        const ext = /\.html?$/i.test(String(b.name || '')) ? 'html' : /\.(md|markdown)$/i.test(String(b.name || '')) ? 'md' : 'txt';
        name = sourceFileName(b.name || b.text.slice(0, 20), ext); body = b.text;
      } else return send(res, 400, { error: 'url or text expected' });
      mkdirSync(p.sources, { recursive: true });
      let file = name; for (let i = 2; existsSync(join(p.sources, file)); i++) file = name.replace(/(\.\w+)$/, `-${i}$1`);
      writeFileSync(join(p.sources, file), body);
      return send(res, 200, { ok: true, file });
    }
    if (route[0] === 'source' && route[1] && m === 'DELETE') {
      if (!SOURCE_FILE.test(route[1]) || basename(route[1]) !== route[1]) return send(res, 400, { error: 'bad file name' });
      const f = join(p.sources, route[1]);
      if (!existsSync(f)) return send(res, 404, { error: 'not found' });
      rmSync(f); return send(res, 200, { ok: true });
    }

    if (route[0] === 'candidate' && route[1] && m === 'POST') {
      const { action } = await readBody(req);
      if (!['apply', 'ignore'].includes(action)) return send(res, 400, { error: 'action must be apply or ignore' });
      if (busy) return send(res, 409, { error: busy });
      const data = loadCandidates(p.candidates);
      const list = route[1] === 'all' ? data.items.filter((c) => c.status === 'new') : data.items.filter((c) => c.cid === route[1]);
      if (!list.length) return send(res, 404, { error: 'not found' });
      if (action === 'apply') {
        if (!existsSync(p.facts)) return send(res, 404, { error: 'no fact card' });
        let text = read(p.facts); const done = [];
        for (const c of list) {
          if (c.status === 'applied') continue;
          const r = applyCandidate(text, c);
          if (!r) continue;
          text = r.text; c.status = 'applied'; c.appliedAs = r.id; done.push(r.id);
        }
        writeFileSync(p.facts, text); saveCandidates(p.candidates, data);
        return send(res, 200, { ok: true, ids: done });
      }
      for (const c of list) c.status = 'ignored';
      saveCandidates(p.candidates, data);
      return send(res, 200, { ok: true });
    }

    if (route[0] === 'init' && m === 'POST') {
      // Starts a project from the bundled templates; never overwrites. 用模板开一个新项目，已有文件不覆盖。
      mkdirSync(p.geo, { recursive: true }); const wrote = [];
      for (const [k, tpl] of [['facts', 'fact-card.yaml'], ['questions', 'questions.csv']]) {
        if (!existsSync(p[k]) && existsSync(join(TEMPLATES, tpl))) { copyFileSync(join(TEMPLATES, tpl), p[k]); wrote.push(basename(p[k])); }
      }
      // Drafts written from the studio wait for approval on the Drafts page, so new projects never auto-confirm.
      // 工作台里由人逐篇通过，所以新项目默认不自动确认。
      if (!existsSync(p.config)) { writeFileSync(p.config, JSON.stringify({ ...JSON.parse(configTemplate(lang)), autoConfirm: false }, null, 2) + '\n'); wrote.push('autopilot.json'); }
      return send(res, 200, { ok: true, wrote });
    }

    return send(res, 404, { error: 'not found' });
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://studio.local');
      // Only answer to a loopback Host name, so a DNS-rebinding page cannot reach the API. 防 DNS 重绑定。
      const host = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      if (loopback && !LOOPBACK.has(host)) return send(res, 403, { error: 'forbidden host' });
      if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, page(lang), 'text/html; charset=utf-8');
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      if (token && !sameToken(req.headers['x-geo-token'] || '', token)) return send(res, 401, { error: 'token required' });
      await api(req, res, url);
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { error: e.message });
    }
  });
}

// ---------------------------------------------------------------- page

const UI = {
  zh: {
    core: '核心', title: 'GEO 医生工作台', tabs: { overview: '总览', gaps: '缺口', drafts: '草稿', sources: '资料', facts: '事实卡', questions: '问题集', run: '运行', reports: '报告' },
    confirmedFacts: '已确认事实', questions: '问题', toReview: '待审草稿', approved: '已通过草稿', gaps: '缺口题',
    nextSteps: '下一步', trend: '推荐率趋势（A 类题，次数）', noRuns: '还没有采样记录。在「运行」里点「采样」，或按第 4 步手动采样后记到 geo/runs.csv。',
    platform: '平台', batch: '批次', date: '日期', recommend: '推荐你', mention: '提到你', top: '推荐最多的', sources: 'AI 引用的来源',
    noGaps: '最近一批采样里没有缺口。', writeGaps: '为缺口写稿', youOf: '你被推荐 {0}/{1} 次', draftExists: '已有草稿',
    noDraft: '还没有草稿', save: '保存', approve: '通过', sendBack: '退回草稿', saved: '已保存', approvedMsg: '已通过', backMsg: '已退回为草稿',
    status: '状态', issues: '检查结果', noIssues: '检查没有问题', pick: '从左边选一篇', qid: '题', from: '写稿模型',
    emptyFact: '这条还没有内容，先填写再确认', confirm: '确认', unconfirm: '取消确认', editRaw: '直接编辑文件', section: '分区', fact: '内容', id: '编号',
    cls: '类型', priority: '优先级', question: '问题',
    src: { add: '放入资料', intro: '把官网、价格页、帮助文档、产品说明放进来。AI 只摘资料里明确写着的事实，每条都附原文；原文里找不到的直接丢弃。写进事实卡后是"待确认"，你确认了才会被用来写稿。',
      url: '网页地址', fetch: '抓取网页', name: '名称（可选）', paste: '或者粘贴文字', save: '保存资料', file: '或者选一个 .md / .txt / .html 文件',
      list: '已有资料', none: '还没有资料。', extract: '让 AI 抽事实', cands: '候选事实', noCands: '没有待处理的候选。', fill: '填入', addTo: '新增到', quote: '原文',
      conflict: '和事实卡不同：', apply: '写入事实卡', ignore: '忽略', applyAll: '全部写入', applied: '已写入事实卡，请到「事实卡」页确认', del: '删除', added: '已保存' },
    runs: { facts: ['抽事实', '从 geo/sources/ 的资料里摘候选事实，每条附原文'], probe: ['采样', '用 API 把问题集问一遍，结果追加到 geo/runs.csv'], write: ['写稿', '给还没有草稿的缺口题写稿，只用已确认事实'],
      report: ['出报告', '写本周的疗效报告到 geo/reports/'], weekly: ['每周全流程', '采样、写稿、出报告一起跑'],
      check: ['检查草稿', '按发布规则检查所有草稿'], site: ['生成事实站', '用已确认事实和已通过文章生成 site/'] },
    running: '正在运行：{0}，采样可能要几分钟…', busy: '有任务在运行，请稍候', output: '输出',
    keys: 'API Key（只从环境变量读取，启动工作台前设置）', keySet: '已设置', keyUnset: '未设置', getKey: '去申请',
    config: '自动驾驶设置 geo/autopilot.json', noReports: '还没有报告。',
    setup: { sources: '在「资料」页放入官网或产品资料，让 AI 帮你填事实卡', cands: '有 {0} 条候选事实等你看', init: '还没有 geo/ 文件夹，点这里用模板开始', initBtn: '用模板开始', config: '填写 geo/autopilot.json：品牌、竞品、要问的 AI',
      facts: '在「事实卡」里核对并确认事实（至少名称 B01 和一句话说明 B03）', questions: '在「问题集」里写用户真实会问的问题',
      keys: '设置环境变量 {0} 后重启工作台', runs: '在「运行」里点「采样」', review: '有 {0} 篇草稿等你审核' },
    token: '请输入工作台口令（GEO_STUDIO_TOKEN）', enter: '进入', error: '出错了：', disclaimer: 'API 采样不登录、多数不联网，和用户在 App 里看到的可能不同；"是否推荐"是关键词初判，重要结论请在 App 里人工确认。',
  },
  en: {
    core: 'core', title: 'GEO Doctor Studio', tabs: { overview: 'Overview', gaps: 'Gaps', drafts: 'Drafts', sources: 'Material', facts: 'Fact card', questions: 'Questions', run: 'Run', reports: 'Reports' },
    confirmedFacts: 'Confirmed facts', questions: 'Questions', toReview: 'Drafts to review', approved: 'Approved drafts', gaps: 'Gap questions',
    nextSteps: 'Next steps', trend: 'Recommendation trend (type A questions, counts)', noRuns: 'No samples yet. Click "Sample" under Run, or log manual samples in geo/runs.csv (step 4).',
    platform: 'Platform', batch: 'Batch', date: 'Date', recommend: 'Recommended you', mention: 'Mentioned you', top: 'Most recommended', sources: 'Sources the AI cited',
    noGaps: 'No gaps in the latest samples.', writeGaps: 'Draft for the gaps', youOf: 'you recommended {0}/{1}', draftExists: 'Draft',
    noDraft: 'No drafts yet', save: 'Save', approve: 'Approve', sendBack: 'Back to draft', saved: 'Saved', approvedMsg: 'Approved', backMsg: 'Set back to draft',
    status: 'Status', issues: 'Checks', noIssues: 'No issues', pick: 'Pick a draft on the left', qid: 'Question', from: 'Written by',
    emptyFact: 'This entry has no content yet; fill it in first', confirm: 'Confirm', unconfirm: 'Unconfirm', editRaw: 'Edit the file directly', section: 'Section', fact: 'Content', id: 'ID',
    cls: 'Type', priority: 'Priority', question: 'Question',
    src: { add: 'Add material', intro: 'Add your website, pricing page, help docs or product notes. The AI only picks facts the material states, each with its quote; quotes not found in the material are dropped. They enter the fact card as pending and are used for drafting only after you confirm them.',
      url: 'Page URL', fetch: 'Fetch page', name: 'Name (optional)', paste: 'Or paste text', save: 'Save material', file: 'Or pick a .md / .txt / .html file',
      list: 'Material', none: 'No material yet.', extract: 'Extract facts with AI', cands: 'Candidate facts', noCands: 'No candidates waiting.', fill: 'Fill', addTo: 'Add to', quote: 'Quote',
      conflict: 'Differs from the fact card: ', apply: 'Write to fact card', ignore: 'Ignore', applyAll: 'Write all', applied: 'Written to the fact card; confirm them on the Fact card page', del: 'Delete', added: 'Saved' },
    runs: { facts: ['Extract facts', 'Pick candidate facts from geo/sources/, each with its quote'], probe: ['Sample', 'Ask the question set through the APIs; appends to geo/runs.csv'], write: ['Draft', 'Draft the gap questions that have no draft, from confirmed facts only'],
      report: ['Report', 'Write this week\'s report to geo/reports/'], weekly: ['Weekly loop', 'Sample, draft and report in one go'],
      check: ['Check drafts', 'Check every draft against the publishing rules'], site: ['Build fact site', 'Build site/ from confirmed facts and approved articles'] },
    running: 'Running {0}; sampling can take a few minutes…', busy: 'A task is running, please wait', output: 'Output',
    keys: 'API keys (read from environment variables only; set them before starting)', keySet: 'set', keyUnset: 'not set', getKey: 'Get one',
    config: 'Autopilot settings geo/autopilot.json', noReports: 'No reports yet.',
    setup: { sources: 'Add your website or product material on the Material page and let the AI fill the fact card', cands: '{0} candidate fact(s) waiting', init: 'There is no geo/ folder yet. Start from the templates', initBtn: 'Start from templates', config: 'Fill in geo/autopilot.json: brand, competitors, AIs to ask',
      facts: 'Check and confirm facts under Fact card (at least the name B01 and one-liner B03)', questions: 'Write the questions real users ask under Questions',
      keys: 'Set {0} and restart the studio', runs: 'Click "Sample" under Run', review: '{0} draft(s) waiting for your review' },
    token: 'Enter the studio token (GEO_STUDIO_TOKEN)', enter: 'Enter', error: 'Error: ', disclaimer: 'API samples are not signed in and mostly offline, so they can differ from what users see in the apps; "recommended" is a keyword guess. Confirm important findings in the apps.',
  },
};

function page(lang) {
  const t = UI[lang] || UI.zh;
  const copy = JSON.stringify(t).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<style>
:root { --bg:#f7f7f5; --panel:#fff; --text:#1d1d1b; --muted:#6b6b66; --line:#e3e2dc; --accent:#1f6f5c; --accent-soft:#e3f1ec; --warn:#a15c00; --warn-soft:#fbf0dc; --bad:#b3261e; --bad-soft:#fbe5e3; --bar:#1f6f5c; }
@media (prefers-color-scheme: dark) { :root { --bg:#151514; --panel:#1f1f1d; --text:#ecebe6; --muted:#a3a29b; --line:#34332f; --accent:#6cc4a8; --accent-soft:#1d3a32; --warn:#e7b25e; --warn-soft:#3a2f1c; --bad:#f08a80; --bad-soft:#3d2220; --bar:#6cc4a8; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.55 -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif; }
header { display:flex; align-items:center; gap:16px; padding:14px 20px; border-bottom:1px solid var(--line); background:var(--panel); position:sticky; top:0; z-index:2; flex-wrap:wrap; }
header h1 { font-size:17px; margin:0; }
header .dir { color:var(--muted); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:40vw; }
nav { display:flex; gap:4px; flex-wrap:wrap; }
nav button { border:0; background:transparent; color:var(--muted); padding:6px 12px; border-radius:6px; cursor:pointer; font:inherit; }
nav button.on { background:var(--accent-soft); color:var(--accent); font-weight:600; }
main { max-width:1100px; margin:0 auto; padding:20px 16px 60px; }
.cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:20px; }
.card, section { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
section { margin-bottom:16px; }
.card .n { font-size:26px; font-weight:650; }
.card .l { color:var(--muted); font-size:13px; }
h2 { font-size:15px; margin:0 0 10px; }
table { width:100%; border-collapse:collapse; font-size:14px; }
th, td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:500; font-size:13px; }
.bar { display:inline-block; height:8px; background:var(--bar); border-radius:4px; vertical-align:middle; margin-right:6px; }
.track { display:inline-block; width:80px; height:8px; background:var(--line); border-radius:4px; vertical-align:middle; margin-right:6px; overflow:hidden; }
.track .bar { display:block; height:100%; margin:0; }
.scroll { overflow-x:auto; }
.muted { color:var(--muted); font-size:13px; }
.pill { display:inline-block; padding:1px 8px; border-radius:99px; font-size:12px; background:var(--line); color:var(--muted); }
.pill.ok { background:var(--accent-soft); color:var(--accent); }
.pill.warn { background:var(--warn-soft); color:var(--warn); }
.pill.error { background:var(--bad-soft); color:var(--bad); }
button.btn { border:1px solid var(--line); background:var(--panel); color:var(--text); padding:6px 14px; border-radius:7px; cursor:pointer; font:inherit; }
button.btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
button.btn:disabled { opacity:.5; cursor:default; }
textarea { width:100%; min-height:380px; resize:vertical; font:13px/1.5 ui-monospace, Menlo, Consolas, monospace; border:1px solid var(--line); border-radius:8px; padding:10px; background:var(--bg); color:var(--text); }
textarea.short { min-height:160px; }
a { color:var(--accent); }
pre { white-space:pre-wrap; word-break:break-word; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px; font:13px/1.5 ui-monospace, Menlo, Consolas, monospace; max-height:520px; overflow:auto; }
.split { display:grid; grid-template-columns:280px 1fr; gap:16px; }
.list button { display:block; width:100%; text-align:left; border:1px solid var(--line); background:var(--panel); color:var(--text); border-radius:8px; padding:8px 10px; margin-bottom:8px; cursor:pointer; font:inherit; }
.list button.on { border-color:var(--accent); }
.row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:10px 0; }
.runs { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:10px; }
.runs .card button { margin-top:8px; }
.toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:var(--text); color:var(--bg); padding:8px 16px; border-radius:8px; font-size:14px; z-index:5; }
ul.steps { margin:0; padding-left:20px; }
input.field { padding:6px 10px; font:inherit; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--text); min-width:0; flex:1 1 260px; }
.cand { border-top:1px solid var(--line); padding:10px 0; }
details summary { cursor:pointer; color:var(--muted); margin-top:10px; }
@media (max-width:760px) { .split { grid-template-columns:1fr; } header .dir { max-width:90vw; } }
</style>
</head>
<body>
<header><h1>${t.title}</h1><nav id="nav"></nav><span class="dir" id="dir"></span></header>
<main id="main"></main>
<script>
const T = ${copy};
${CLIENT}
</script>
</body>
</html>`;
}

// The page script: plain DOM, every value set through textContent so file contents can never become markup.
// 页面脚本：只用 textContent 写入内容，文件里的文字不会被当成 HTML。
const CLIENT = String.raw`
let S = null; let tab = (location.hash || '#overview').slice(1); let sel = null; let token = sessionStorage.getItem('geo-token') || '';
const $ = (id) => document.getElementById(id);
const fmt = (s, ...a) => s.replace(/\{(\d)\}/g, (_, i) => a[i]);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
async function call(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, { method, headers: { 'x-geo-studio': '1', 'content-type': 'application/json', ...(token ? { 'x-geo-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { askToken(); throw new Error('token'); }
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { data });
  return data;
}
function toast(msg) { const e = h('div', { class: 'toast' }, msg); document.body.append(e); setTimeout(() => e.remove(), 2600); }
function fail(e) { if (e.message !== 'token') toast(T.error + e.message); }
function askToken() {
  const input = h('input', { type: 'password', style: 'padding:6px 10px;font:inherit;border:1px solid var(--line);border-radius:6px;min-width:260px' });
  $('main').replaceChildren(h('section', {}, h('h2', {}, T.token), h('div', { class: 'row' }, input,
    h('button', { class: 'btn primary', onclick: () => { token = input.value; sessionStorage.setItem('geo-token', token); load(); } }, T.enter))));
}
async function load() { try { S = await call('state'); render(); } catch (e) { fail(e); } }
function go(t) { tab = t; location.hash = t; render(); }
function nav() {
  $('nav').replaceChildren(...Object.entries(T.tabs).map(([k, v]) => h('button', { class: k === tab ? 'on' : '', onclick: () => go(k) }, v)));
  $('dir').textContent = S ? S.dir : '';
}
const pill = (level, txt) => h('span', { class: 'pill ' + level }, txt);
const meter = (n, of) => h('span', {}, h('span', { class: 'track' }, h('span', { class: 'bar', style: 'width:' + (of ? Math.round(100 * n / of) : 0) + '%' })), of ? n + '/' + of : 'NA');
function table(head, rows) { return h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))))); }

function steps() {
  const s = []; const f = S.files;
  if (!f.questions && !f.facts && !f.config) {
    s.push(h('li', {}, T.setup.init + ' ', S.templates ? h('button', { class: 'btn primary', onclick: async () => { try { await call('init', 'POST', {}); await load(); } catch (e) { fail(e); } } }, T.setup.initBtn) : null));
    return s;
  }
  const c = S.config || {};
  if (!c.brand || !c.ai || /你的品牌|Your product/.test(c.brand)) s.push(h('li', {}, T.setup.config));
  if (!S.sources.length && (!S.facts || S.facts.entries.filter((e) => e.confirmed).length < 5)) s.push(h('li', {}, h('a', { href: '#sources', onclick: (e) => { e.preventDefault(); go('sources'); } }, T.setup.sources)));
  const cand = S.candidates.filter((c) => c.status === 'new').length;
  if (cand) s.push(h('li', {}, h('a', { href: '#sources', onclick: (e) => { e.preventDefault(); go('sources'); } }, fmt(T.setup.cands, cand))));
  if (!S.facts || !S.facts.entries.some((e) => /^B0?1$/i.test(e.id) && e.confirmed)) s.push(h('li', {}, T.setup.facts));
  if (!S.questions.length) s.push(h('li', {}, T.setup.questions));
  for (const a of String(c.ai || '').split(',').map((x) => x.split(':')[0].trim()).filter(Boolean)) {
    const k = S.keys.find((x) => x.id === a); if (k && !k.set) s.push(h('li', {}, fmt(T.setup.keys, k.env)));
  }
  if (!S.trend.length) s.push(h('li', {}, T.setup.runs));
  const waiting = S.drafts.filter((d) => !d.confirmed).length;
  if (waiting) s.push(h('li', {}, h('a', { href: '#drafts', onclick: (e) => { e.preventDefault(); go('drafts'); } }, fmt(T.setup.review, waiting))));
  return s;
}

const views = {
  overview() {
    const facts = S.facts ? S.facts.entries.filter((e) => e.confirmed).length : 0;
    const cards = [[facts, T.confirmedFacts], [S.questions.length, T.questions], [S.gaps.length, T.gaps],
      [S.drafts.filter((d) => !d.confirmed).length, T.toReview], [S.drafts.filter((d) => d.confirmed).length, T.approved]];
    const st = steps();
    const byPlatform = {};
    for (const g of S.trend) (byPlatform[g.platform + ' · ' + g.entry] ||= []).push(g);
    return [
      h('div', { class: 'cards' }, cards.map(([n, l]) => h('div', { class: 'card' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l)))),
      st.length ? h('section', {}, h('h2', {}, T.nextSteps), h('ul', { class: 'steps' }, st)) : null,
      h('section', {}, h('h2', {}, T.trend),
        S.trend.length ? Object.entries(byPlatform).map(([name, list]) => h('div', { style: 'margin-bottom:14px' }, h('div', { style: 'font-weight:600;margin:6px 0' }, name),
          table([T.date, T.batch, T.recommend, T.mention, T.top], list.map((g) => [g.date, h('span', { class: 'muted' }, g.batch), meter(g.recommend.n, g.recommend.of), meter(g.mention.n, g.mention.of),
            g.board.map((b) => b.name + ' ' + b.n + '/' + b.of).join('，')])))) : h('p', { class: 'muted' }, T.noRuns),
        S.trend.length ? h('p', { class: 'muted' }, T.disclaimer) : null),
    ];
  },
  gaps() {
    if (!S.gaps.length) return [h('section', {}, h('p', {}, S.trend.length ? T.noGaps : T.noRuns))];
    return [h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => run('write') }, T.writeGaps), h('span', { class: 'muted' }, S.batches.join('，'))),
      ...S.gaps.map((g) => h('section', {}, h('h2', {}, g.id + ' ' + g.question, g.core ? ' ' : '', g.core ? pill('warn', T.core) : null),
        g.platforms.map((p) => h('div', {}, h('b', {}, p.platform), '：', fmt(T.youOf, p.ours, p.of), '；', p.winners.map((w) => w.name + ' ' + w.n).join('，'))),
        g.sources.length ? h('div', { class: 'muted' }, T.sources + '：' + g.sources.join('，')) : null,
        h('div', { class: 'row' }, g.draft ? h('button', { class: 'btn', onclick: () => { sel = g.draft; go('drafts'); } }, T.draftExists + '：' + g.draft) : h('span', { class: 'muted' }, T.noDraft))))];
  },
  drafts() {
    if (!S.drafts.length) return [h('section', {}, h('p', {}, T.noDraft))];
    if (!sel || !S.drafts.some((d) => d.file === sel)) sel = (S.drafts.find((d) => !d.confirmed) || S.drafts[0]).file;
    const d = S.drafts.find((x) => x.file === sel);
    const ta = h('textarea', {});
    call('draft/' + encodeURIComponent(d.file)).then((r) => { ta.value = r.text; }, fail);
    const errs = d.issues.filter((x) => x.level === 'error');
    const act = async (fn, msg) => { try { await fn(); toast(msg); await load(); } catch (e) { fail(e); } };
    return [h('div', { class: 'split' },
      h('div', { class: 'list' }, S.drafts.map((x) => h('button', { class: x.file === sel ? 'on' : '', onclick: () => { sel = x.file; render(); } },
        h('div', {}, x.title || x.file), h('div', { class: 'row', style: 'margin:4px 0 0' }, pill(x.confirmed ? 'ok' : 'warn', x.status || 'draft'),
          x.issues.some((i) => i.level === 'error') ? pill('error', '✕ ' + x.issues.filter((i) => i.level === 'error').length) : null)))),
      h('div', {},
        h('section', {}, h('h2', {}, d.title || d.file),
          h('div', { class: 'muted' }, [d.qid && T.qid + '：' + d.qid + ' ' + d.question, d.generatedBy && T.from + '：' + d.generatedBy].filter(Boolean).join(' · ')),
          h('h2', { style: 'margin-top:12px' }, T.issues),
          d.issues.length ? h('ul', { class: 'steps' }, d.issues.map((i) => h('li', {}, pill(i.level === 'info' ? '' : i.level, i.level), ' ', i.msg))) : h('p', { class: 'muted' }, T.noIssues),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', disabled: d.confirmed || errs.length ? true : null, onclick: () => act(() => call('draft/' + encodeURIComponent(d.file) + '/status', 'POST', { status: 'confirmed' }), T.approvedMsg) }, T.approve),
            h('button', { class: 'btn', disabled: d.confirmed ? null : true, onclick: () => act(() => call('draft/' + encodeURIComponent(d.file) + '/status', 'POST', { status: 'draft' }), T.backMsg) }, T.sendBack))),
        h('section', {}, ta, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => act(() => call('draft/' + encodeURIComponent(d.file), 'PUT', { text: ta.value }), T.saved) }, T.save)))))];
  },
  facts() {
    const rows = (S.facts ? S.facts.entries : []).map((e) => [e.id, h('span', { class: 'muted' }, e.section), e.label ? h('span', {}, h('b', {}, e.label), ' ', e.detail) : e.detail,
      pill(e.confirmed ? 'ok' : 'warn', e.status || '—'),
      h('button', { class: 'btn', disabled: !e.confirmed && !e.filled ? true : null, title: !e.confirmed && !e.filled ? T.emptyFact : null, onclick: async () => { try { await call('fact/' + encodeURIComponent(e.id), 'POST', { confirmed: !e.confirmed }); await load(); } catch (x) { fail(x); } } }, e.confirmed ? T.unconfirm : T.confirm)]);
    return [h('section', {}, rows.length ? table([T.id, T.section, T.fact, T.status, ''], rows) : h('p', { class: 'muted' }, S.errors.facts || '—')), editor('facts')];
  },
  questions() {
    const rows = S.questions.map((q) => [q.id, q.cls, q.question, q.priority]);
    return [h('section', {}, rows.length ? table([T.id, T.cls, T.question, T.priority], rows) : h('p', { class: 'muted' }, S.errors.questions || '—')), editor('questions')];
  },
  run() {
    return [
      h('div', { class: 'runs' }, Object.entries(T.runs).map(([k, [name, desc]]) => h('div', { class: 'card' }, h('div', { style: 'font-weight:600' }, name), h('div', { class: 'muted' }, desc),
        h('button', { class: 'btn primary', disabled: S.busy ? true : null, onclick: () => run(k) }, name)))),
      S.busy ? h('p', {}, fmt(T.running, S.busy)) : null,
      S.last ? h('section', { style: 'margin-top:16px' }, h('h2', {}, T.output + ' · ' + S.last.cmd + ' · exit ' + S.last.code), h('pre', {}, [S.last.out, S.last.err].filter(Boolean).join('\n'))) : null,
      h('section', { style: 'margin-top:16px' }, h('h2', {}, T.keys), table(['AI', '', ''], S.keys.map((k) => [k.label + ' · ' + k.env, pill(k.set ? 'ok' : '', k.set ? T.keySet : T.keyUnset),
        k.url ? h('a', { href: k.url, target: '_blank', rel: 'noopener noreferrer' }, T.getKey) : '']))),
      editor('config', T.config),
    ];
  },
  sources() {
    const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); await load(); } catch (e) { fail(e); } };
    const url = h('input', { type: 'url', placeholder: 'https://', class: 'field' });
    const name = h('input', { type: 'text', placeholder: T.src.name, class: 'field' });
    const paste = h('textarea', { class: 'short' });
    const file = h('input', { type: 'file', accept: '.md,.markdown,.txt,.html,.htm' });
    file.addEventListener('change', () => { const f = file.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => act(() => call('source', 'POST', { name: f.name, text: String(r.result) }), T.src.added); r.readAsText(f); });
    const cands = S.candidates.filter((c) => c.status === 'new');
    return [
      h('section', {}, h('h2', {}, T.src.add), h('p', { class: 'muted' }, T.src.intro),
        h('div', { class: 'row' }, url, h('button', { class: 'btn', onclick: () => url.value && act(() => call('source', 'POST', { url: url.value }), T.src.added) }, T.src.fetch)),
        h('div', { class: 'muted' }, T.src.paste), h('div', { class: 'row' }, name), paste,
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => paste.value.trim() && act(() => call('source', 'POST', { name: name.value, text: paste.value }), T.src.added) }, T.src.save)),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, T.src.file), file)),
      h('section', {}, h('h2', {}, T.src.list),
        S.sources.length ? table(['', ''], S.sources.map((x) => [h('span', {}, x.file, x.from ? h('div', { class: 'muted' }, x.from) : null),
          h('button', { class: 'btn', onclick: () => act(() => call('source/' + encodeURIComponent(x.file), 'DELETE', {})) }, T.src.del)])) : h('p', { class: 'muted' }, T.src.none),
        S.sources.length ? h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: S.busy ? true : null, onclick: () => run('facts') }, T.src.extract)) : null),
      h('section', {}, h('h2', {}, T.src.cands + (cands.length ? ' · ' + cands.length : '')),
        cands.length ? h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => act(() => call('candidate/all', 'POST', { action: 'apply' }), T.src.applied) }, T.src.applyAll)) : h('p', { class: 'muted' }, T.src.noCands),
        cands.map((c) => h('div', { class: 'cand' },
          h('div', {}, h('b', {}, c.id ? T.src.fill + ' ' + c.id : T.src.addTo + ' ' + c.section), ' ', Object.entries(c.fields).map(([k, v]) => k + '：' + v).join('；')),
          h('div', { class: 'muted' }, T.src.quote + '：「' + c.quote + '」 · ' + c.source),
          c.conflict.length ? h('div', {}, pill('warn', T.src.conflict + c.conflict.map((x) => x.field + '「' + x.current + '」').join('；'))) : null,
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => act(() => call('candidate/' + c.cid, 'POST', { action: 'apply' }), T.src.applied) }, T.src.apply),
            h('button', { class: 'btn', onclick: () => act(() => call('candidate/' + c.cid, 'POST', { action: 'ignore' })) }, T.src.ignore))))),
    ];
  },
  reports() {
    if (!S.reports.length) return [h('section', {}, h('p', { class: 'muted' }, T.noReports))];
    const pre = h('pre', {});
    const show = (f) => call('report/' + encodeURIComponent(f)).then((r) => { pre.textContent = r.text; }, fail);
    show(S.reports[0]);
    return [h('div', { class: 'split' }, h('div', { class: 'list' }, S.reports.map((f) => h('button', { onclick: () => show(f) }, f))), h('section', {}, pre))];
  },
};

function editor(name, title) {
  const ta = h('textarea', { class: name === 'config' ? 'short' : null });
  const box = h('details', { open: title ? true : null }, h('summary', {}, title || T.editRaw), h('section', { style: 'margin-top:8px' }, ta,
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => { try { await call('file/' + name, 'PUT', { text: ta.value }); toast(T.saved); await load(); } catch (e) { fail(e); } } }, T.save))));
  call('file/' + name).then((r) => { ta.value = r.text; }, fail);
  return box;
}

async function run(cmd) {
  if (S.busy) return toast(T.busy);
  S.busy = T.runs[cmd][0]; if (tab !== 'run') tab = 'run', location.hash = 'run'; render();
  try { await call('run', 'POST', { cmd }); } catch (e) { fail(e); }
  await load();
}

function render() {
  if (!S) return;
  if (!views[tab]) tab = 'overview';
  nav();
  $('main').replaceChildren(...views[tab]().filter(Boolean));
}
window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t !== tab && views[t]) { tab = t; render(); } });
load();
`;

// ---------------------------------------------------------------- CLI

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (['--dir', '--port', '--host', '--lang'].includes(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      o[a.slice(2)] = argv[++i];
    } else o.unknown = a;
  }
  return o;
}

function detectLang() {
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  return /^zh/i.test(env || Intl.DateTimeFormat().resolvedOptions().locale || '') ? 'zh' : 'en';
}

export async function main(argv, { env = process.env, out = console.log, err = console.error, listen = true } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { err(e.message); return 2; }
  const lang = o.lang === 'en' || o.lang === 'zh' ? o.lang : detectLang();
  const t = M[lang];
  if (o.version) { out(VERSION); return 0; }
  if (o.help || o.unknown) { out(t.usage); return o.help ? 0 : 2; }
  const dir = resolve(o.dir || '.');
  if (!existsSync(dir)) { err(t.noDir(dir)); return 2; }
  const port = o.port === undefined ? 4173 : Number(o.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) { err(t.badPort(o.port)); return 2; }
  const host = o.host || '127.0.0.1';
  const loopback = LOOPBACK.has(host);
  const token = env.GEO_STUDIO_TOKEN || null;
  if (!loopback && (!token || token.length < 12)) { err(t.needToken); return 2; }
  if (!loopback) err(t.plainHttp);
  if (!listen) return 0;
  const server = createStudio({ dir, lang, env, token, loopback });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, host, ok); });
  const shown = host.includes(':') ? `[${host}]` : host;
  out(t.started(`http://${shown}:${server.address().port}/`));
  return new Promise(() => {});
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href || /^geo-studio(\.mjs)?$/.test(basename(process.argv[1] || ''))) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 2; });
}
