#!/usr/bin/env node
// geo-studio · geo-doctor
// A local web console for the whole loop: see who the AIs recommend, the gaps, the fact card, the drafts,
// approve or send back each draft, run sampling, drafting, reports and the fact site with one click, and distribute
// every approved article to every channel from one table.
// 本地网页工作台：看 AI 推荐谁、缺口、事实卡和草稿，逐篇审核，一键运行采样、写稿、报告和事实站，在分发中心把文章发到各渠道。零依赖。
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
import { AUTO, FILL, PLATFORMS, SITE, appendLog, checkDrafts, fillItems, fillJson, fillUserscript, loadDrafts, parseFacts, readLog, renderFor, main as publishMain } from './geo-publish.mjs';
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
    sources: join(geo, 'sources'), candidates: join(geo, 'fact-candidates.json'), published: join(geo, 'published.csv'),
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
      confirmed: d.confirmed, facts: d.facts, generatedBy: d.meta.generated_by || '', platforms: d.platforms, lang: d.lang || '',
      built: existsSync(join(p.site, 'articles', `${d.slug}.html`)),
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
        recommend: g.recommend, mention: g.mention, board: g.board.slice(0, 8), sources: g.sources.slice(0, 10) }))
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
  // Where each article went, newest last (geo/published.csv, shared with geo-publish). 发布记录。
  const published = readLog(p.published).filter((r) => r.slug && r.platform);
  const wp = config && typeof config.wordpress === 'object' ? config.wordpress : {};
  const channels = {
    devto: { key: AUTO.devto.keyEnv, set: !!env[AUTO.devto.keyEnv], url: AUTO.devto.keyPage },
    wordpress: { site: wp.site || '', user: wp.user || '', set: !!env.GEO_WP_APP_PASSWORD, key: 'GEO_WP_APP_PASSWORD' },
    editors: Object.fromEntries(Object.entries(PLATFORMS).map(([k, v]) => [k, v.editor])),
    fill: Object.keys(FILL),
  };
  const keys = Object.entries(PROVIDERS).filter(([, v]) => v.key).map(([id, v]) => ({ id, label: v.label, env: v.key, set: !!env[v.key], url: v.keyUrl || '' }));
  return {
    version: VERSION, dir: resolve(dir), lang, files, errors, config, keys,
    questions: questions.map((q) => ({ id: q.id, cls: q.cls, question: q.question, priority: priority.get(q.id) || '' })),
    facts, drafts, trend, gaps, batches, reports, sources, candidates, published, channels,
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
    case 'devto':
      return { run: publishMain, argv: ['post', p.drafts, '--to', 'devto', '--status', c.devtoStatus === 'draft' ? 'draft' : 'publish', '--log', p.published, '--lang', lang] };
    case 'wordpress': {
      const wp = c.wordpress || {};
      if (!wp.site || !wp.user) throw new Error(lang === 'en' ? 'Set "wordpress": { "site", "user" } in geo/autopilot.json first' : '请先在 geo/autopilot.json 里填写 "wordpress": { "site", "user" }');
      return { run: publishMain, argv: ['site', p.drafts, '--to', 'wordpress', '--site', String(wp.site), '--user', String(wp.user),
        '--status', wp.status === 'publish' ? 'publish' : 'draft', '--log', p.published, '--lang', lang] };
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
    if (m === 'GET' && route[0] === 'state') return send(res, 200, { ...readState(dir, { env, lang }), busy, last, helper: !token, siteBuilt: existsSync(join(p.site, 'index.html')) });

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

    if (route[0] === 'render' && route[1] && route[2] && m === 'GET') {
      // One article laid out for one platform (the same text geo-publish pack writes), to copy into its editor.
      // 按平台排好版的文章，复制到对应后台粘贴即可。
      const platform = route[1];
      if (!PLATFORMS[platform]) return send(res, 400, { error: 'unknown platform' });
      const d = publishable(route[2]);
      if (!d) return send(res, 404, { error: 'not found' });
      const { text: out } = renderFor(platform, d, { url: articleUrl(d), brand: brandName(), lang: d.lang === 'en' ? 'en' : lang });
      return send(res, 200, { platform, file: d.file, format: PLATFORMS[platform].ext, text: out, editor: PLATFORMS[platform].editor });
    }

    if (route[0] === 'published' && m === 'POST') {
      // Records a link the person published by hand, so the board and the re-test know about it. 手动发布后记下链接。
      const { slug, platform, url: link } = await readBody(req);
      if (typeof link !== 'string' || !/^https?:\/\/\S+$/i.test(link.trim())) return send(res, 400, { error: 'url must start with http(s)://' });
      if (![SITE, ...Object.keys(PLATFORMS), ...Object.keys(AUTO)].includes(platform)) return send(res, 400, { error: 'unknown platform' });
      const d = existsSync(p.drafts) ? loadDrafts(p.drafts).find((x) => x.slug === slug) : null;
      if (!d) return send(res, 404, { error: 'not found' });
      appendLog(p.published, { slug: d.slug, platform, url: link.trim(), status: 'published', title: d.title });
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

  const config = () => { try { return JSON.parse(read(p.config)); } catch { return {}; } };
  const brandName = () => String(config().brand || '').split(',')[0].trim();
  // The original link: where the site log says the article went (static site or WordPress), else the built fact-site
  // page under baseUrl. Nothing until the article actually has a page. 原文链接只用已经存在的页面。
  function articleUrl(d) {
    const logged = readLog(p.published).filter((r) => r.slug === d.slug && r.platform === SITE && r.status !== 'draft' && /^https?:\/\//.test(r.url)).pop();
    if (logged) return logged.url;
    const b = config().baseUrl;
    return b && d.platforms.includes(SITE) && existsSync(join(p.site, 'articles', `${d.slug}.html`)) ? String(b).replace(/\/?$/, '/') + `articles/${d.slug}.html` : '';
  }
  // Approved drafts that pass the publishing checks: the only ones handed to editors. 只交出已通过且检查无错的稿件。
  function publishable(file) {
    const state = readState(dir, { env, lang });
    const ok = state.drafts.filter((x) => x.confirmed && !x.issues.some((i) => i.level === 'error')).map((x) => x.file);
    const list = existsSync(p.drafts) ? loadDrafts(p.drafts).filter((x) => ok.includes(x.file)) : [];
    return file === undefined ? list : list.find((x) => x.file === file) || null;
  }

  // The fill helper for Zhihu/Juejin reads the article list from here. Only without a token: a userscript cannot send one.
  // 知乎、掘金填稿助手从这里读文章列表；设了口令时不提供（油猴脚本带不了口令）。
  function helper(req, res, path) {
    if (token) return send(res, 404, { error: 'not available with a token' });
    const origin = `http://${req.headers.host}`;
    if (path === '/fill.json') return send(res, 200, fillJson(fillItems(publishable(), { urlFor: articleUrl })));
    return send(res, 200, fillUserscript({ manifestUrl: `${origin}/fill.json`, name: lang === 'en' ? 'local studio' : '本地工作台' }), 'text/javascript; charset=utf-8');
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://studio.local');
      // Only answer to a loopback Host name, so a DNS-rebinding page cannot reach the API. 防 DNS 重绑定。
      const host = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      if (loopback && !LOOPBACK.has(host)) return send(res, 403, { error: 'forbidden host' });
      // distribute.html is the same page; the fill helper treats that address as its board. 分发中心也是这个页面。
      if (['/', '/index.html', '/distribute.html'].includes(url.pathname)) return send(res, 200, page(lang), 'text/html; charset=utf-8');
      if (url.pathname === '/fill.json' || url.pathname === '/geo-fill.user.js') return helper(req, res, url.pathname);
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
    core: '核心', title: 'GEO 医生工作台', product: 'GEO 医生', tagline: '一站式 GEO 平台',
    groups: [['总览', [['home', '工作台', 'home']]],
      ['监测', [['monitor', 'AI 可见度', 'eye'], ['questions', '问题库', 'list'], ['gaps', '选题（缺口）', 'target']]],
      ['内容', [['sources', '资料', 'book'], ['facts', '事实卡', 'shield'], ['review', '写稿与审核', 'check']]],
      ['分发', [['distribute', '分发中心', 'send'], ['channels', '渠道与账号', 'plug'], ['log', '发布记录', 'clock']]],
      ['数据与设置', [['reports', '疗效报告', 'chart'], ['run', '自动任务', 'play'], ['settings', '设置', 'gear']]]],
    pages: {
      home: ['工作台', '一眼看清：AI 推不推荐你、事实准备得怎样、文章发到了哪里。'],
      monitor: ['AI 可见度', '真实用户会问的问题，逐个问各家 AI，记下有没有推荐你、推荐了谁、引用了哪些网页。'],
      questions: ['问题库', '用户真实会问 AI 的问题。每周复测都问这一批。'],
      gaps: ['选题（缺口）', 'AI 推荐了别人、没推荐你的问题。每个缺口写一篇只用已确认事实的文章。'],
      sources: ['资料', '官网、价格页、帮助文档放进来，AI 帮你摘事实，每条附原文。'],
      facts: ['事实卡', '所有文章只能引用这里已确认的事实。确认前先核对来源。'],
      review: ['写稿与审核', 'AI 写的每句关键说法都要对上一张已确认的事实卡。对不上的不让通过。'],
      distribute: ['分发中心', '一篇文章，分发到所有渠道。有官方接口的自动发；不允许程序代发的平台，由助手在你自己的浏览器里填好，你点发布。'],
      channels: ['渠道与账号', '每个渠道怎么发、连上没有。平台不保存任何第三方密码或 Cookie。'],
      log: ['发布记录', '每篇文章发到了哪里。记在 geo/published.csv，复测时用来对照。'],
      reports: ['疗效报告', '每周复测后的报告：推荐率变了没有，哪些文章起了作用。'],
      run: ['自动任务', '每个按钮跑一个命令，参数来自 geo/autopilot.json。'],
      settings: ['设置', 'API Key 只从环境变量读取，页面上不显示。'],
    },
    actions: { retest: '立即复测', write: '为缺口写稿' },
    kpi: { rate: 'AI 推荐率', rateNote: '{0} · {1}/{2} · {3}', noRate: '还没有采样', facts: '已确认事实', factsNote: '共 {0} 条', published: '已发布', publishedNote: '篇次，覆盖 {0} 个渠道',
      todo: '待分发', todoNote: '篇次等你发', review: '待审', reviewNote: '篇草稿', mention: '提及率', questions: '问题数', questionsNote: '{0} 题是缺口', cited: '被引用的网站', citedNote: 'AI 回答里引用的不同网站' },
    loop: '闭环进度', loopSteps: [['facts', '事实卡', '已确认 {0} 条'], ['questions', '问题库', '{0} 个问题'], ['monitor', 'AI 采样', '{0} 次采样'],
      ['gaps', '缺口选题', '{0} 个缺口'], ['review', '写稿审核', '通过 {0}/{1} 篇'], ['distribute', '分发', '已发 {0}/{1} 篇次']],
    todoList: '待办', allDone: '没有待办，等下次复测。', recent: '最近动态', noRecent: '还没有动态。', channelState: '渠道状态', openAll: '查看全部',
    trendChart: '推荐率趋势（%）', engines: '各家 AI', inUse: '在用', notInUse: '未启用', competitors: 'AI 最常推荐的', citedSites: 'AI 引用的来源', times: '{0} 次',
    confirmedFacts: '已确认事实', questions: '问题', toReview: '待审草稿', approved: '已通过草稿', gaps: '缺口题',
    nextSteps: '下一步', trend: '每次采样明细（A 类题，次数）', noRuns: '还没有采样记录。点右上角「立即复测」，或在「自动任务」里点「采样」。',
    platform: '平台', batch: '批次', date: '日期', recommend: '推荐你', mention: '提到你', top: '推荐最多的', sources: 'AI 引用的来源',
    noGaps: '最近一批采样里没有缺口。', writeGaps: '为缺口写稿', youOf: '你被推荐 {0}/{1} 次', draftExists: '已有草稿',
    noDraft: '还没有草稿', save: '保存', approve: '通过并进入分发', sendBack: '退回草稿', saved: '已保存', approvedMsg: '已通过，可以去分发了', backMsg: '已退回为草稿',
    status: '状态', issues: '规则检查', noIssues: '检查没有问题', pick: '从左边选一篇', qid: '题', from: '写稿模型',
    factCheck: '事实核对', citedFact: '引用的事实卡', factOk: '已确认', factNo: '未确认', factMissing: '事实卡里没有', noFacts: '这篇没有引用事实卡。',
    waiting: '待审', passed: '已通过', errorsN: '{0} 个问题',
    emptyFact: '这条还没有内容，先填写再确认', confirm: '确认', unconfirm: '取消确认', editRaw: '直接编辑文件', section: '分区', fact: '内容', id: '编号',
    cls: '类型', priority: '优先级', question: '问题', body: '正文（Markdown）',
    dist: { article: '文章', stats: [['文章', 'articles'], ['已发布', 'done'], ['待发布', 'todo'], ['未连接 / 不适用', 'na']], matrix: '文章 × 渠道', legendDone: '已发布', legendTodo: '待发布', legendNa: '未选此渠道',
      none: '还没有通过审核的文章。先到「写稿与审核」通过一篇。', done: '已发布', built: '已生成', draftMade: '草稿已建', todo: '待发布', na: '—', blocked: '检查没通过',
      fill: '填好并打开', fillAll: '一键打开全部 {0}', copy: '复制排版', copied: '已复制，去后台粘贴即可', open: '打开后台', record: '记录链接', publish: '发布', build: '生成', wp: '发到 WordPress', noKey: '未连接',
      recordTitle: '记录发布链接', recordHint: '粘贴这篇文章发布后的链接，复测时用来对照。', recorded: '已记下', cancel: '取消',
      install: '知乎、掘金的填稿助手还没装好。一次设置：① 装浏览器扩展 Tampermonkey；② 点「安装助手」并确认；③ Chrome 里在扩展详情打开「允许用户脚本」。装好后刷新本页。', installBtn: '安装助手',
      ready: '填稿助手已就绪：点「填好并打开」，助手在编辑器里填好标题和正文，你检查后点发布，链接会自动记到这里。',
      noHelper: '设了访问口令时填稿助手不可用，知乎、掘金请用「复制排版」。', synced: '助手记下了 {0} 条发布链接' },
    ch: { site: ['官网 / 事实站', '已确认事实和已通过文章生成静态站，可放 GitHub Pages 或你的服务器'], wordpress: ['WordPress 官网', 'REST 接口 + 应用密码，自动发到你的官网'],
      devto: ['dev.to', '官方接口，用你自己的 API Key 发布；同标题只更新不重发'], helper: ['浏览器助手填稿', '在你自己的浏览器里打开编辑器、填好标题正文，你检查后点发布'],
      paste: ['排版好的稿件', '一键复制按平台排好版的 HTML 或文字，到后台粘贴发布'],
      connected: '已连接', notConnected: '未连接', ready: '已就绪', notInstalled: '未安装', manual: '手动粘贴', built: '已生成', notBuilt: '还没生成',
      siteHint: '在设置里填 baseUrl 后，文章会带上原文链接', wpHint: '在 geo/autopilot.json 填 "wordpress": { "site", "user" }，并设置环境变量 GEO_WP_APP_PASSWORD', keyHint: '设置环境变量 {0} 后重启工作台',
      getKey: '申请 Key', openSite: '打开', go: '去分发', safety: '账号安全：平台不保存任何第三方平台的密码或 Cookie，也不模拟登录。官方接口用你自己的 Key；知乎、掘金等由你本人在自己的浏览器里点「发布」。' },
    logCols: ['日期', '文章', '渠道', '链接', '状态'], noLog: '还没有发布记录。',
    platforms: { site: '官网', devto: 'dev.to', zhihu: '知乎', juejin: '掘金', wechat: '公众号', toutiao: '头条号', baijiahao: '百家号', sohu: '搜狐号', xiaohongshu: '小红书', medium: 'Medium', reddit: 'Reddit' },
    src: { add: '放入资料', intro: '把官网、价格页、帮助文档、产品说明放进来。AI 只摘资料里明确写着的事实，每条都附原文；原文里找不到的直接丢弃。写进事实卡后是"待确认"，你确认了才会被用来写稿。',
      url: '网页地址', fetch: '抓取网页', name: '名称（可选）', paste: '或者粘贴文字', save: '保存资料', file: '或者选一个 .md / .txt / .html 文件',
      list: '已有资料', none: '还没有资料。', extract: '让 AI 抽事实', cands: '候选事实', noCands: '没有待处理的候选。', fill: '填入', addTo: '新增到', quote: '原文',
      conflict: '和事实卡不同：', apply: '写入事实卡', ignore: '忽略', applyAll: '全部写入', applied: '已写入事实卡，请到「事实卡」页确认', del: '删除', added: '已保存' },
    runs: { facts: ['抽事实', '从 geo/sources/ 的资料里摘候选事实，每条附原文'], probe: ['采样', '用 API 把问题集问一遍，结果追加到 geo/runs.csv'], write: ['写稿', '给还没有草稿的缺口题写稿，只用已确认事实'],
      report: ['出报告', '写本周的疗效报告到 geo/reports/'], weekly: ['每周全流程', '采样、写稿、出报告一起跑'],
      check: ['检查草稿', '按发布规则检查所有草稿'], site: ['生成事实站', '用已确认事实和已通过文章生成 site/'],
      devto: ['发到 dev.to', '把已通过、选了 dev.to 的文章发出去，需要 DEVTO_API_KEY'], wordpress: ['发到 WordPress', '把已通过、选了官网的文章发到 WordPress'] },
    running: '正在运行：{0}，采样可能要几分钟…', busy: '有任务在运行，请稍候', output: '输出',
    keys: 'API Key（只从环境变量读取，启动工作台前设置）', keySet: '已设置', keyUnset: '未设置', getKey: '去申请',
    config: '自动驾驶设置 geo/autopilot.json', noReports: '还没有报告。',
    setup: { sources: '在「资料」页放入官网或产品资料，让 AI 帮你填事实卡', cands: '有 {0} 条候选事实等你看', init: '还没有 geo/ 文件夹，点这里用模板开始', initBtn: '用模板开始', config: '在「设置」里填写 geo/autopilot.json：品牌、竞品、要问的 AI',
      facts: '在「事实卡」里核对并确认事实（至少名称 B01 和一句话说明 B03）', questions: '在「问题库」里写用户真实会问的问题',
      keys: '设置环境变量 {0} 后重启工作台', runs: '点右上角「立即复测」做第一次采样', review: '有 {0} 篇草稿等你审核', distribute: '有 {0} 篇次文章等你分发' },
    token: '请输入工作台口令（GEO_STUDIO_TOKEN）', enter: '进入', error: '出错了：', disclaimer: 'API 采样不登录，和用户在 App 里看到的可能不同；"是否推荐"是关键词初判，重要结论请在 App 里人工确认。',
    board: { lDone: '已发 ✓', lFilled: '已填好 {d}，待你点发布', lTodo: '待发布', lNone: '这个平台的文章都已经发过了。' },
  },
  en: {
    core: 'core', title: 'GEO Doctor Studio', product: 'GEO Doctor', tagline: 'All-in-one GEO platform',
    groups: [['Overview', [['home', 'Dashboard', 'home']]],
      ['Monitor', [['monitor', 'AI visibility', 'eye'], ['questions', 'Questions', 'list'], ['gaps', 'Gaps', 'target']]],
      ['Content', [['sources', 'Material', 'book'], ['facts', 'Fact card', 'shield'], ['review', 'Drafts & review', 'check']]],
      ['Distribute', [['distribute', 'Distribution', 'send'], ['channels', 'Channels', 'plug'], ['log', 'Publishing log', 'clock']]],
      ['Data & settings', [['reports', 'Reports', 'chart'], ['run', 'Tasks', 'play'], ['settings', 'Settings', 'gear']]]],
    pages: {
      home: ['Dashboard', 'At a glance: whether the AIs recommend you, how ready your facts are, and where your articles went.'],
      monitor: ['AI visibility', 'The questions real users ask, put to each AI: whether it recommends you, who it recommends, and which pages it cites.'],
      questions: ['Questions', 'What users really ask the AIs. Every weekly re-test asks this set.'],
      gaps: ['Gaps', 'Questions where the AIs recommend others but not you. Each gap gets an article built only from confirmed facts.'],
      sources: ['Material', 'Add your website, pricing page and help docs; the AI picks facts, each with its quote.'],
      facts: ['Fact card', 'Articles may only cite facts confirmed here. Check the source before confirming.'],
      review: ['Drafts & review', 'Every key claim must match a confirmed fact. Drafts that do not cannot be approved.'],
      distribute: ['Distribution', 'One article to every channel. Channels with an official API are posted automatically; for platforms that do not allow programmatic posting, the helper fills the editor in your own browser and you click publish.'],
      channels: ['Channels', 'How each channel publishes and whether it is connected. No third-party passwords or cookies are stored.'],
      log: ['Publishing log', 'Where each article went. Kept in geo/published.csv for the re-test.'],
      reports: ['Reports', 'The report after each weekly re-test: did the recommendation rate move, and which articles helped.'],
      run: ['Tasks', 'Each button runs one command, with settings from geo/autopilot.json.'],
      settings: ['Settings', 'API keys are read from environment variables only and never shown.'],
    },
    actions: { retest: 'Re-test now', write: 'Draft for the gaps' },
    kpi: { rate: 'AI recommendation rate', rateNote: '{0} · {1}/{2} · {3}', noRate: 'No samples yet', facts: 'Confirmed facts', factsNote: '{0} in total', published: 'Published', publishedNote: 'placements on {0} channel(s)',
      todo: 'To distribute', todoNote: 'placements waiting', review: 'To review', reviewNote: 'draft(s)', mention: 'Mention rate', questions: 'Questions', questionsNote: '{0} are gaps', cited: 'Cited sites', citedNote: 'distinct sites the AIs cited' },
    loop: 'The loop', loopSteps: [['facts', 'Fact card', '{0} confirmed'], ['questions', 'Questions', '{0} questions'], ['monitor', 'AI sampling', '{0} sample run(s)'],
      ['gaps', 'Gaps', '{0} gap(s)'], ['review', 'Review', '{0}/{1} approved'], ['distribute', 'Distribute', '{0}/{1} published']],
    todoList: 'To do', allDone: 'Nothing to do until the next re-test.', recent: 'Recent activity', noRecent: 'Nothing yet.', channelState: 'Channels', openAll: 'See all',
    trendChart: 'Recommendation rate (%)', engines: 'AIs', inUse: 'in use', notInUse: 'not enabled', competitors: 'Most recommended by the AIs', citedSites: 'Sources the AIs cited', times: '{0}×',
    confirmedFacts: 'Confirmed facts', questions: 'Questions', toReview: 'Drafts to review', approved: 'Approved drafts', gaps: 'Gap questions',
    nextSteps: 'Next steps', trend: 'Each sample run (type A questions, counts)', noRuns: 'No samples yet. Click "Re-test now" at the top right, or "Sample" under Tasks.',
    platform: 'Platform', batch: 'Batch', date: 'Date', recommend: 'Recommended you', mention: 'Mentioned you', top: 'Most recommended', sources: 'Sources the AI cited',
    noGaps: 'No gaps in the latest samples.', writeGaps: 'Draft for the gaps', youOf: 'you recommended {0}/{1}', draftExists: 'Draft',
    noDraft: 'No drafts yet', save: 'Save', approve: 'Approve for distribution', sendBack: 'Back to draft', saved: 'Saved', approvedMsg: 'Approved; ready to distribute', backMsg: 'Set back to draft',
    status: 'Status', issues: 'Rule checks', noIssues: 'No issues', pick: 'Pick a draft on the left', qid: 'Question', from: 'Written by',
    factCheck: 'Fact check', citedFact: 'Facts cited', factOk: 'confirmed', factNo: 'not confirmed', factMissing: 'not on the fact card', noFacts: 'This draft cites no facts.',
    waiting: 'to review', passed: 'approved', errorsN: '{0} issue(s)',
    emptyFact: 'This entry has no content yet; fill it in first', confirm: 'Confirm', unconfirm: 'Unconfirm', editRaw: 'Edit the file directly', section: 'Section', fact: 'Content', id: 'ID',
    cls: 'Type', priority: 'Priority', question: 'Question', body: 'Body (Markdown)',
    dist: { article: 'Article', stats: [['Articles', 'articles'], ['Published', 'done'], ['Waiting', 'todo'], ['Not connected / n.a.', 'na']], matrix: 'Articles × channels', legendDone: 'Published', legendTodo: 'Waiting', legendNa: 'Channel not chosen',
      none: 'No approved articles yet. Approve one under Drafts & review first.', done: 'Published', built: 'Built', draftMade: 'Draft created', todo: 'Waiting', na: '—', blocked: 'Fails checks',
      fill: 'Fill and open', fillAll: 'Open all {0}', copy: 'Copy formatted', copied: 'Copied; paste it in the editor', open: 'Open editor', record: 'Record link', publish: 'Publish', build: 'Build', wp: 'Post to WordPress', noKey: 'Not connected',
      recordTitle: 'Record the published link', recordHint: 'Paste the article\'s link after publishing; the re-test uses it.', recorded: 'Recorded', cancel: 'Cancel',
      install: 'The Zhihu/Juejin fill helper is not installed yet. One-time setup: 1) install the Tampermonkey extension; 2) click "Install helper" and confirm; 3) in Chrome, turn on "Allow user scripts" in the extension details. Then reload this page.', installBtn: 'Install helper',
      ready: 'Fill helper ready: click "Fill and open" and it fills the title and body in the editor; you check and click publish, and the link is recorded here.',
      noHelper: 'With an access token the fill helper is unavailable; use "Copy formatted" for Zhihu and Juejin.', synced: 'The helper recorded {0} published link(s)' },
    ch: { site: ['Website / fact site', 'A static site from confirmed facts and approved articles, for GitHub Pages or your own server'], wordpress: ['WordPress site', 'REST API with an application password, posted to your site'],
      devto: ['dev.to', 'Official API with your own key; the same title is updated, never posted twice'], helper: ['Browser fill helper', 'Opens the editor in your own browser and fills title and body; you check and click publish'],
      paste: ['Formatted copy', 'Copy the article formatted for the platform and paste it in its editor'],
      connected: 'Connected', notConnected: 'Not connected', ready: 'Ready', notInstalled: 'Not installed', manual: 'Paste by hand', built: 'Built', notBuilt: 'Not built yet',
      siteHint: 'Set baseUrl in Settings so articles carry their original link', wpHint: 'Set "wordpress": { "site", "user" } in geo/autopilot.json and the GEO_WP_APP_PASSWORD environment variable', keyHint: 'Set {0} and restart the studio',
      getKey: 'Get a key', openSite: 'Open', go: 'Distribute', safety: 'Account safety: no third-party passwords or cookies are stored and no logins are simulated. Official APIs use your own keys; on Zhihu, Juejin and similar platforms you click publish yourself in your own browser.' },
    logCols: ['Date', 'Article', 'Channel', 'Link', 'Status'], noLog: 'Nothing published yet.',
    platforms: { site: 'Website', devto: 'dev.to', zhihu: 'Zhihu', juejin: 'Juejin', wechat: 'WeChat', toutiao: 'Toutiao', baijiahao: 'Baijiahao', sohu: 'Sohu', xiaohongshu: 'Xiaohongshu', medium: 'Medium', reddit: 'Reddit' },
    src: { add: 'Add material', intro: 'Add your website, pricing page, help docs or product notes. The AI only picks facts the material states, each with its quote; quotes not found in the material are dropped. They enter the fact card as pending and are used for drafting only after you confirm them.',
      url: 'Page URL', fetch: 'Fetch page', name: 'Name (optional)', paste: 'Or paste text', save: 'Save material', file: 'Or pick a .md / .txt / .html file',
      list: 'Material', none: 'No material yet.', extract: 'Extract facts with AI', cands: 'Candidate facts', noCands: 'No candidates waiting.', fill: 'Fill', addTo: 'Add to', quote: 'Quote',
      conflict: 'Differs from the fact card: ', apply: 'Write to fact card', ignore: 'Ignore', applyAll: 'Write all', applied: 'Written to the fact card; confirm them on the Fact card page', del: 'Delete', added: 'Saved' },
    runs: { facts: ['Extract facts', 'Pick candidate facts from geo/sources/, each with its quote'], probe: ['Sample', 'Ask the question set through the APIs; appends to geo/runs.csv'], write: ['Draft', 'Draft the gap questions that have no draft, from confirmed facts only'],
      report: ['Report', 'Write this week\'s report to geo/reports/'], weekly: ['Weekly loop', 'Sample, draft and report in one go'],
      check: ['Check drafts', 'Check every draft against the publishing rules'], site: ['Build fact site', 'Build site/ from confirmed facts and approved articles'],
      devto: ['Post to dev.to', 'Post approved articles that chose dev.to; needs DEVTO_API_KEY'], wordpress: ['Post to WordPress', 'Post approved articles that chose the website to WordPress'] },
    running: 'Running {0}; sampling can take a few minutes…', busy: 'A task is running, please wait', output: 'Output',
    keys: 'API keys (read from environment variables only; set them before starting)', keySet: 'set', keyUnset: 'not set', getKey: 'Get one',
    config: 'Autopilot settings geo/autopilot.json', noReports: 'No reports yet.',
    setup: { sources: 'Add your website or product material on the Material page and let the AI fill the fact card', cands: '{0} candidate fact(s) waiting', init: 'There is no geo/ folder yet. Start from the templates', initBtn: 'Start from templates', config: 'Fill in geo/autopilot.json under Settings: brand, competitors, AIs to ask',
      facts: 'Check and confirm facts under Fact card (at least the name B01 and one-liner B03)', questions: 'Write the questions real users ask under Questions',
      keys: 'Set {0} and restart the studio', runs: 'Click "Re-test now" at the top right for the first samples', review: '{0} draft(s) waiting for your review', distribute: '{0} placement(s) waiting to be distributed' },
    token: 'Enter the studio token (GEO_STUDIO_TOKEN)', enter: 'Enter', error: 'Error: ', disclaimer: 'API samples are not signed in, so they can differ from what users see in the apps; "recommended" is a keyword guess. Confirm important findings in the apps.',
    board: { lDone: 'Published ✓', lFilled: 'Filled {d}, waiting for you to publish', lTodo: 'Waiting', lNone: 'Every article for this platform is already published.' },
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
:root { --bg:#f4f6f8; --panel:#fff; --soft:#f8fafb; --text:#0f172a; --body:#334155; --muted:#5b6472; --line:#e3e7eb; --line2:#eef1f3; --accent:#0f766e; --accent-ink:#fff; --accent-soft:#e6f4f1; --accent-line:#b7dcd4;
  --warn:#b45309; --warn-soft:#fef3c7; --bad:#b91c1c; --bad-soft:#fef2f2; --na:#94a3b8; --c2:#2563eb; --c3:#b45309; --c4:#7c3aed; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1417; --panel:#161d21; --soft:#1b2328; --text:#e6ebee; --body:#c4ccd2; --muted:#94a0a8; --line:#29333a; --line2:#222b31; --accent:#3fb8a4; --accent-ink:#06201c; --accent-soft:#163a35; --accent-line:#24564f;
  --warn:#f0b35a; --warn-soft:#3a2c14; --bad:#f08a80; --bad-soft:#3d2220; --na:#64748b; --c2:#7aa7ff; --c3:#f0b35a; --c4:#b49cff; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.55 Inter, -apple-system, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif; }
a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
.app { display:flex; min-height:100vh; }
.side { flex:0 0 236px; background:var(--panel); border-right:1px solid var(--line); padding:20px 14px; display:flex; flex-direction:column; gap:18px; position:sticky; top:0; height:100vh; overflow-y:auto; }
.logo { display:flex; align-items:center; gap:10px; padding:0 8px; }
.logo .mark { width:32px; height:32px; border-radius:8px; background:var(--accent); color:var(--accent-ink); display:flex; align-items:center; justify-content:center; }
.logo b { display:block; font-size:15px; } .logo span { display:block; font-size:12px; color:var(--muted); }
#nav { display:flex; flex-direction:column; gap:14px; }
.navgroup { display:flex; flex-direction:column; gap:2px; }
.navgroup > span { font-size:12px; color:var(--muted); padding:0 10px 4px; letter-spacing:.04em; }
.navgroup a { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:8px; color:var(--body); min-height:36px; }
.navgroup a:hover { background:var(--soft); text-decoration:none; }
.navgroup a.on { background:var(--accent-soft); color:var(--accent); font-weight:600; }
.navgroup a .count { margin-left:auto; font-size:12px; background:var(--warn-soft); color:var(--warn); border-radius:99px; padding:0 7px; font-weight:600; }
.main { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; }
.top { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; padding:12px 28px; background:var(--panel); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:2; }
.top .dir { color:var(--muted); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1 1 200px; }
.top .acts { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
.busy { font-size:13px; color:var(--warn); }
main { padding:28px; display:flex; flex-direction:column; gap:20px; max-width:1280px; width:100%; }
.head h1 { margin:0; font-size:24px; } .head p { margin:4px 0 0; color:var(--muted); max-width:860px; }
.head { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:flex-end; gap:12px; }
.cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:14px; }
.card, section { background:var(--panel); border:1px solid var(--line); border-radius:12px; }
section { padding:18px 20px; } section.flush { padding:0; } section.flush > .sh { padding:16px 20px; }
.card { padding:16px 18px; display:flex; flex-direction:column; gap:4px; }
.card .l { color:var(--muted); font-size:13px; } .card .n { font-size:28px; font-weight:700; font-variant-numeric:tabular-nums; line-height:1.2; } .card .s { font-size:12px; color:var(--muted); }
.card.hl { border-color:var(--accent-line); background:linear-gradient(180deg, var(--accent-soft), var(--panel) 70%); } .card.hl .n { color:var(--accent); }
.sh { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:10px; margin-bottom:12px; } section.flush > .sh { margin:0; }
h2 { font-size:16px; margin:0; } h3 { font-size:14px; margin:0 0 8px; }
.grid2 { display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:14px; }
.grid3 { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:14px; }
table { width:100%; border-collapse:collapse; font-size:14px; }
th, td { text-align:left; padding:10px 12px; border-top:1px solid var(--line2); vertical-align:top; }
thead th { background:var(--soft); color:var(--muted); font-weight:500; font-size:13px; border-top:0; }
th:first-child, td:first-child { padding-left:20px; }
section:not(.flush) th:first-child, section:not(.flush) td:first-child { padding-left:8px; }
.scroll { overflow-x:auto; }
.muted { color:var(--muted); font-size:13px; }
.pill { display:inline-flex; align-items:center; gap:6px; padding:2px 9px; border-radius:99px; font-size:12px; font-weight:600; background:var(--line2); color:var(--muted); white-space:nowrap; }
.pill.ok { background:var(--accent-soft); color:var(--accent); } .pill.warn { background:var(--warn-soft); color:var(--warn); } .pill.error { background:var(--bad-soft); color:var(--bad); }
.dot { width:8px; height:8px; border-radius:50%; display:inline-block; background:var(--na); flex:none; } .dot.ok { background:var(--accent); } .dot.warn { background:#d97706; } .dot.error { background:#dc2626; }
.st { display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:600; } .st.ok { color:var(--accent); } .st.warn { color:var(--warn); } .st.na { color:var(--na); font-weight:400; } .st.error { color:var(--bad); }
button.btn, a.btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; border:1px solid var(--line); background:var(--panel); color:var(--text); padding:0 14px; min-height:36px; border-radius:8px; cursor:pointer; font:inherit; text-decoration:none; white-space:nowrap; }
button.btn.primary, a.btn.primary { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); font-weight:600; }
button.btn.sm, a.btn.sm { min-height:30px; padding:0 10px; font-size:13px; border-radius:6px; }
button.btn.ghost, a.btn.ghost { border-color:var(--accent-line); color:var(--accent); font-weight:600; }
button.btn.link { border:0; background:none; color:var(--muted); padding:0 4px; min-height:30px; font-size:13px; }
button.btn:disabled { opacity:.5; cursor:default; }
textarea { width:100%; min-height:420px; resize:vertical; font:13px/1.6 ui-monospace, Menlo, Consolas, monospace; border:1px solid var(--line); border-radius:8px; padding:12px; background:var(--soft); color:var(--text); }
textarea.short { min-height:160px; }
pre { white-space:pre-wrap; word-break:break-word; background:var(--soft); border:1px solid var(--line); border-radius:8px; padding:12px; font:13px/1.55 ui-monospace, Menlo, Consolas, monospace; max-height:560px; overflow:auto; margin:0; }
.split { display:grid; grid-template-columns:300px minmax(0, 1fr); gap:14px; align-items:start; }
.list { display:flex; flex-direction:column; padding:0; overflow:hidden; }
.list button { display:flex; flex-direction:column; gap:4px; text-align:left; border:0; border-bottom:1px solid var(--line2); border-left:3px solid transparent; background:var(--panel); color:var(--text); padding:12px 16px; cursor:pointer; font:inherit; }
.list button.on { background:var(--accent-soft); border-left-color:var(--accent); } .list button .t { font-weight:600; }
.row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.stack { display:flex; flex-direction:column; gap:10px; }
.runs { display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:14px; }
.toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:var(--text); color:var(--bg); padding:10px 18px; border-radius:8px; font-size:14px; z-index:5; max-width:90vw; }
ul.steps { margin:0; padding-left:20px; display:flex; flex-direction:column; gap:6px; }
input.field { padding:0 12px; min-height:36px; font:inherit; border:1px solid var(--line); border-radius:8px; background:var(--soft); color:var(--text); min-width:0; flex:1 1 260px; }
.cand { border-top:1px solid var(--line2); padding:12px 0; }
details summary { cursor:pointer; color:var(--muted); }
.loop { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px; }
.loop a { display:flex; flex-direction:column; gap:6px; padding:12px 14px; border:1px solid var(--line); border-radius:10px; color:var(--text); background:var(--soft); }
.loop a:hover { text-decoration:none; border-color:var(--accent-line); }
.loop .k { display:flex; align-items:center; gap:8px; font-weight:600; } .loop .num { width:22px; height:22px; border-radius:50%; background:var(--line); color:var(--muted); font-size:12px; display:inline-flex; align-items:center; justify-content:center; }
.loop .done .num { background:var(--accent); color:var(--accent-ink); }
.feed { display:flex; flex-direction:column; } .feed > div { display:flex; gap:10px; align-items:flex-start; padding:9px 0; border-top:1px solid var(--line2); } .feed > div:first-child { border-top:0; }
.chan { display:flex; flex-direction:column; gap:10px; padding:16px 18px; }
.chan .tt { display:flex; justify-content:space-between; align-items:center; gap:8px; } .chan .tt b { font-size:15px; }
.matrix td { min-width:128px; } .matrix th[scope=row] { min-width:240px; font-weight:500; }
.cell { display:flex; flex-direction:column; gap:6px; align-items:flex-start; }
.note { display:flex; gap:12px; align-items:flex-start; background:var(--accent-soft); border:1px solid var(--accent-line); border-radius:12px; padding:14px 18px; color:var(--text); }
.note.warn { background:var(--warn-soft); border-color:transparent; }
.helper-on, html[data-geo-fill] .helper-off { display:none !important; } html[data-geo-fill] .helper-on { display:flex !important; }
html[data-geo-fill] span.helper-on, html[data-geo-fill] a.helper-on { display:inline-flex !important; }
.chart text { font-size:11px; fill:var(--muted); } .chart .grid { stroke:var(--line2); }
.legend { display:flex; flex-wrap:wrap; gap:14px; font-size:13px; color:var(--muted); } .legend span { display:inline-flex; align-items:center; gap:6px; }
.bars div { display:flex; align-items:center; gap:10px; padding:6px 0; font-size:13px; } .bars .nm { flex:0 0 40%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.bars .tr { flex:1; height:8px; background:var(--line2); border-radius:4px; overflow:hidden; } .bars .tr i { display:block; height:100%; background:var(--accent); border-radius:4px; }
.bars .mine .nm { font-weight:700; color:var(--accent); }
dialog { border:1px solid var(--line); border-radius:12px; padding:20px; background:var(--panel); color:var(--text); width:min(480px, 92vw); }
dialog::backdrop { background:rgba(15, 23, 42, .35); }
.track { display:inline-block; width:80px; height:8px; background:var(--line2); border-radius:4px; vertical-align:middle; margin-right:6px; overflow:hidden; } .track .bar { display:block; height:100%; background:var(--accent); }
@media (max-width:900px) {
  .app { flex-direction:column; } .side { position:static; height:auto; flex:none; border-right:0; border-bottom:1px solid var(--line); padding:12px 16px; gap:10px; }
  #nav { flex-direction:row; gap:4px; overflow-x:auto; } .cards { grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); } .navgroup { flex-direction:row; } .navgroup > span { display:none; } .navgroup a { white-space:nowrap; }
  .top { padding:10px 16px; position:static; } main { padding:16px; } .split { grid-template-columns:1fr; } .grid2 { grid-template-columns:1fr; }
}
</style>
</head>
<body>
<div class="app"><aside class="side"><div class="logo"><span class="mark" id="logo"></span><span><b>${t.product}</b><span>${t.tagline}</span></span></div><nav id="nav" aria-label="menu"></nav></aside>
<div class="main"><div class="top"><span class="dir" id="dir"></span><div class="acts" id="acts"></div></div><main id="main"></main></div></div>
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
const ALIAS = { overview: 'home', drafts: 'review' };
let S = null; let sel = null; let token = sessionStorage.getItem('geo-token') || '';
let tab = location.hash.slice(1) || (location.pathname.endsWith('/distribute.html') ? 'distribute' : 'home'); tab = ALIAS[tab] || tab;
// The fill helper treats /distribute.html as its board, so the whole app lives at that address. 填稿助手认这个地址。
if (!location.pathname.endsWith('/distribute.html')) history.replaceState(null, '', '/distribute.html#' + tab);
Object.assign(document.body.dataset, T.board);
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
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); for (const k of kids.flat()) if (k) e.append(k instanceof Node ? k : document.createTextNode(String(k))); return e; }
const I = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5', shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  check: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4', clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6', play: 'M6 4l14 8-14 8z', plus: 'M12 5v14M5 12h14',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
};
const icon = (k, size = 18) => s('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, s('path', { d: I[k] }));
async function call(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, { method, headers: { 'x-geo-studio': '1', 'content-type': 'application/json', ...(token ? { 'x-geo-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { askToken(); throw new Error('token'); }
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { data });
  return data;
}
function toast(msg) { const e = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(e); setTimeout(() => e.remove(), 3000); }
function fail(e) { if (e.message !== 'token') toast(T.error + e.message); }
const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); await load(); } catch (e) { fail(e); } };
function askToken() {
  const input = h('input', { type: 'password', class: 'field' });
  $('main').replaceChildren(h('section', {}, h('h2', {}, T.token), h('div', { class: 'row', style: 'margin-top:12px' }, input,
    h('button', { class: 'btn primary', onclick: () => { token = input.value; sessionStorage.setItem('geo-token', token); load(); } }, T.enter))));
}
async function load() { try { S = await call('state'); render(); } catch (e) { fail(e); } }
function go(t) { tab = t; location.hash = t; render(); scrollTo(0, 0); }
const link = (t, label) => h('a', { href: '#' + t, onclick: (e) => { e.preventDefault(); go(t); } }, label);
const pill = (level, txt) => h('span', { class: 'pill ' + level }, txt);
const stt = (level, txt) => h('span', { class: 'st ' + level }, h('span', { class: 'dot ' + level }), txt);
const meter = (n, of) => h('span', {}, h('span', { class: 'track' }, h('span', { class: 'bar', style: 'width:' + (of ? Math.round(100 * n / of) : 0) + '%' })), of ? n + '/' + of : 'NA');
const pct = (n, of) => (of ? Math.round(100 * n / of) + '%' : '—');
function table(head, rows, cls) { return h('div', { class: 'scroll' }, h('table', { class: cls || null }, h('thead', {}, h('tr', {}, head.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))))); }
const card = (label, value, note, hl) => h('div', { class: 'card' + (hl ? ' hl' : '') }, h('span', { class: 'l' }, label), h('span', { class: 'n' }, value), note ? h('span', { class: 's' }, note) : null);
const head = (key, ...acts) => h('div', { class: 'head' }, h('div', {}, h('h1', {}, T.pages[key][0]), h('p', {}, T.pages[key][1])), acts.length ? h('div', { class: 'row' }, acts) : null);
const pname = (p) => T.platforms[p] || p;

// ------------------------------------------------ derived numbers
// Latest sample run per AI, so the rate reflects where things stand now. 每家 AI 取最近一次采样。
function latest() {
  const by = {};
  for (const g of S.trend) { const k = g.platform + ' · ' + g.entry; if (!by[k] || (g.date + g.batch) >= (by[k].date + by[k].batch)) by[k] = g; }
  return Object.values(by);
}
function rate() {
  const l = latest(); if (!l.length) return null;
  const n = l.reduce((a, g) => a + g.recommend.n, 0); const of = l.reduce((a, g) => a + g.recommend.of, 0);
  const m = l.reduce((a, g) => a + g.mention.n, 0); const mof = l.reduce((a, g) => a + g.mention.of, 0);
  return { n, of, m, mof, who: l.map((g) => g.platform).join('、'), date: l.map((g) => g.date).sort().pop() || '' };
}
const approvedDrafts = () => S.drafts.filter((d) => d.confirmed);
const blocked = (d) => d.issues.some((i) => i.level === 'error');
function columns() {
  const cols = ['site', 'devto', ...S.channels.fill];
  for (const d of approvedDrafts()) for (const p of d.platforms) if (!cols.includes(p) && (S.channels.editors[p] || p === 'devto')) cols.push(p);
  return cols;
}
// State of one article on one channel: done / filled / todo / na / blocked. 一篇文章在一个渠道的状态。
function cellOf(d, p) {
  const rows = S.published.filter((r) => r.slug === d.slug && r.platform === p); const r = rows[rows.length - 1];
  if (r && r.status !== 'draft') return { state: 'done', url: r.url, date: r.date };
  if (p === 'site' && d.platforms.includes('site') && d.built) return { state: 'done', url: S.config && S.config.baseUrl ? String(S.config.baseUrl).replace(/\/?$/, '/') + 'articles/' + d.slug + '.html' : '', built: true };
  if (!d.platforms.includes(p)) return { state: 'na' };
  if (blocked(d)) return { state: 'blocked' };
  if (r) return { state: 'filled', url: r.url };
  return { state: 'todo' };
}
function tally() {
  const t = { articles: approvedDrafts().length, done: 0, todo: 0, na: 0, channels: new Set() };
  for (const d of approvedDrafts()) for (const p of columns()) { const c = cellOf(d, p); if (c.state === 'done') { t.done++; t.channels.add(p); } else if (c.state === 'na') t.na++; else t.todo++; }
  return t;
}

function steps() {
  const st = []; const f = S.files;
  if (!f.questions && !f.facts && !f.config) {
    st.push(h('li', {}, T.setup.init + ' ', S.templates ? h('button', { class: 'btn sm primary', onclick: () => act(() => call('init', 'POST', {})) }, T.setup.initBtn) : null));
    return st;
  }
  const c = S.config || {};
  if (!c.brand || !c.ai || /你的品牌|Your product/.test(c.brand)) st.push(h('li', {}, link('settings', T.setup.config)));
  if (!S.sources.length && (!S.facts || S.facts.entries.filter((e) => e.confirmed).length < 5)) st.push(h('li', {}, link('sources', T.setup.sources)));
  const cand = S.candidates.filter((x) => x.status === 'new').length;
  if (cand) st.push(h('li', {}, link('sources', fmt(T.setup.cands, cand))));
  if (!S.facts || !S.facts.entries.some((e) => /^B0?1$/i.test(e.id) && e.confirmed)) st.push(h('li', {}, link('facts', T.setup.facts)));
  if (!S.questions.length) st.push(h('li', {}, link('questions', T.setup.questions)));
  for (const a of String(c.ai || '').split(',').map((x) => x.split(':')[0].trim()).filter(Boolean)) {
    const k = S.keys.find((x) => x.id === a); if (k && !k.set) st.push(h('li', {}, link('settings', fmt(T.setup.keys, k.env))));
  }
  if (!S.trend.length) st.push(h('li', {}, T.setup.runs));
  const waiting = S.drafts.filter((d) => !d.confirmed).length;
  if (waiting) st.push(h('li', {}, link('review', fmt(T.setup.review, waiting))));
  const todo = tally().todo;
  if (todo) st.push(h('li', {}, link('distribute', fmt(T.setup.distribute, todo))));
  return st;
}

// ------------------------------------------------ chart
const COLORS = ['var(--accent)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];
function trendChart() {
  const series = {};
  for (const g of S.trend) (series[g.platform + ' · ' + g.entry] ||= []).push(g);
  const xs = [...new Set(S.trend.map((g) => g.date || g.batch))].sort();
  const W = 560; const H = 220; const L = 40; const R = 16; const Tp = 14; const B = 30;
  const x = (v) => (xs.length < 2 ? (L + W - R) / 2 : L + (W - L - R) * xs.indexOf(v) / (xs.length - 1));
  const y = (p) => Tp + (H - Tp - B) * (1 - p / 100);
  const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', class: 'chart', role: 'img', 'aria-label': T.trendChart });
  for (const p of [0, 25, 50, 75, 100]) { svg.append(s('line', { x1: L, x2: W - R, y1: y(p), y2: y(p), class: 'grid' }), s('text', { x: 4, y: y(p) + 4 }, p + '%')); }
  const step = Math.max(1, Math.ceil(xs.length / 6));
  xs.forEach((v, i) => { if (i % step === 0 || i === xs.length - 1) svg.append(s('text', { x: x(v), y: H - 8, 'text-anchor': 'middle' }, String(v).slice(5) || v)); });
  Object.entries(series).forEach(([name, list], i) => {
    const pts = list.map((g) => [x(g.date || g.batch), y(g.recommend.of ? 100 * g.recommend.n / g.recommend.of : 0), g]);
    const col = COLORS[i % COLORS.length];
    if (pts.length > 1) svg.append(s('polyline', { points: pts.map((p) => p[0] + ',' + p[1]).join(' '), fill: 'none', stroke: col, 'stroke-width': 2 }));
    for (const [px, py, g] of pts) svg.append(s('circle', { cx: px, cy: py, r: 4, fill: col }, s('title', {}, name + ' ' + (g.date || g.batch) + ' ' + g.recommend.n + '/' + g.recommend.of)));
  });
  const legend = h('div', { class: 'legend' }, Object.keys(series).map((name, i) => h('span', {}, h('span', { class: 'dot', style: 'background:' + COLORS[i % COLORS.length] }), name)));
  return [svg, legend];
}
function bars(list, mine) {
  const max = Math.max(1, ...list.map((x) => x.n));
  return h('div', { class: 'bars' }, list.map((x) => h('div', { class: mine && mine(x.name) ? 'mine' : '' }, h('span', { class: 'nm', title: x.name }, x.name), h('span', { class: 'tr' }, h('i', { style: 'width:' + Math.round(100 * x.n / max) + '%' })), h('span', { class: 'muted' }, fmt(T.times, x.n)))));
}

// ------------------------------------------------ distribution actions
async function copyFor(p, d) {
  try {
    const r = await call('render/' + p + '/' + encodeURIComponent(d.file));
    if (r.format === 'html' && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([r.text], { type: 'text/html' }), 'text/plain': new Blob([r.text], { type: 'text/plain' }) })]);
    else await navigator.clipboard.writeText(r.text);
    toast(T.dist.copied);
  } catch (e) { fail(e); }
}
function record(d, p) {
  const input = h('input', { type: 'url', class: 'field', placeholder: 'https://', required: true });
  const dlg = h('dialog', {}, h('h2', {}, T.dist.recordTitle), h('p', { class: 'muted' }, d.title + ' · ' + pname(p)), h('p', { class: 'muted' }, T.dist.recordHint), input,
    h('div', { class: 'row', style: 'margin-top:14px;justify-content:flex-end' }, h('button', { class: 'btn', onclick: () => dlg.close() }, T.dist.cancel),
      h('button', { class: 'btn primary', onclick: () => { if (!/^https?:\/\//.test(input.value.trim())) return input.focus(); dlg.close(); act(() => call('published', 'POST', { slug: d.slug, platform: p, url: input.value.trim() }), T.dist.recorded); } }, T.dist.record)));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); input.focus();
}
// Links the helper recorded after the person published (it writes them into [data-st] cells) go into geo/published.csv.
// 填稿助手记下的发布链接，写进 geo/published.csv。
const syncing = new Set();
function syncHelper() {
  if (!S) return;
  const found = [];
  document.querySelectorAll('[data-st][data-state="done"]').forEach((el) => {
    const a = el.querySelector('a[href]'); const key = el.getAttribute('data-st'); if (!a || syncing.has(key)) return;
    const [p, slug] = key.split('/');
    if (S.published.some((r) => r.slug === slug && r.platform === p && r.status !== 'draft')) return;
    syncing.add(key); found.push({ slug, platform: p, url: a.href });
  });
  if (!found.length) return;
  Promise.all(found.map((x) => call('published', 'POST', x))).then(() => { toast(fmt(T.dist.synced, found.length)); load(); }, fail);
}
new MutationObserver(syncHelper).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
const repaint = () => setTimeout(() => window.dispatchEvent(new Event('focus')), 0);

function cell(d, p) {
  const c = cellOf(d, p); const ch = S.channels;
  if (c.state === 'na') return h('span', { class: 'st na' }, T.dist.na);
  if (c.state === 'blocked') return h('div', { class: 'cell' }, stt('error', T.dist.blocked), link('review', T.pages.review[0]));
  if (c.state === 'done') return h('div', { class: 'cell' }, c.url ? h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, stt('ok', c.built ? T.dist.built : T.dist.done)) : stt('ok', c.built ? T.dist.built : T.dist.done), c.date ? h('span', { class: 'muted' }, c.date) : null);
  const kids = [stt('warn', c.state === 'filled' ? T.dist.draftMade : T.dist.todo)];
  if (p === 'site') {
    kids.push(h('button', { class: 'btn sm ghost', disabled: S.busy ? true : null, onclick: () => run('site') }, T.dist.build));
    if (ch.wordpress.site && ch.wordpress.user && ch.wordpress.set) kids.push(h('button', { class: 'btn sm ghost', onclick: () => run('wordpress') }, T.dist.wp));
  } else if (p === 'devto') {
    kids.push(ch.devto.set ? h('button', { class: 'btn sm ghost', disabled: S.busy ? true : null, onclick: () => run('devto') }, T.dist.publish) : link('channels', T.dist.noKey));
  } else if (ch.fill.includes(p) && S.helper) {
    const key = p + '/' + d.slug;
    kids.length = 0;
    kids.push(h('span', { class: 'st warn', 'data-st': key }, T.dist.todo));
    kids.push(h('a', { class: 'go btn sm ghost helper-on', 'data-key': key, 'data-platform': p, href: ch.editors[p] + '#geo-fill=' + encodeURIComponent(key), target: '_blank', rel: 'noopener' }, T.dist.fill));
    kids.push(h('button', { class: 'btn sm ghost helper-off', onclick: () => copyFor(p, d) }, T.dist.copy));
  } else {
    kids.push(h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', onclick: () => copyFor(p, d) }, T.dist.copy),
      ch.editors[p] ? h('a', { class: 'btn sm', href: ch.editors[p], target: '_blank', rel: 'noopener noreferrer' }, T.dist.open) : null));
  }
  if (p !== 'site' && p !== 'devto') kids.push(h('button', { class: 'btn link', onclick: () => record(d, p) }, T.dist.record));
  return h('div', { class: 'cell' }, kids);
}

const views = {
  home() {
    const r = rate(); const facts = S.facts ? S.facts.entries : []; const ok = facts.filter((e) => e.confirmed).length;
    const t = tally(); const st = steps();
    const loopVals = { facts: [ok], questions: [S.questions.length], monitor: [new Set(S.trend.map((g) => g.batch)).size], gaps: [S.gaps.length], review: [approvedDrafts().length, S.drafts.length], distribute: [t.done, t.done + t.todo] };
    const doneStep = { facts: ok > 0, questions: S.questions.length > 0, monitor: S.trend.length > 0, gaps: S.trend.length > 0, review: S.drafts.length > 0 && approvedDrafts().length === S.drafts.length, distribute: t.done > 0 && t.todo === 0 };
    const feed = [...S.published].reverse().slice(0, 6).map((x) => h('div', {}, h('span', { class: 'dot ok', style: 'margin-top:7px' }), h('span', {}, h('b', {}, pname(x.platform)), ' · ', x.url ? h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.title || x.slug) : (x.title || x.slug), h('div', { class: 'muted' }, x.date))));
    if (S.last) feed.unshift(h('div', {}, h('span', { class: 'dot ' + (S.last.code ? 'error' : 'ok'), style: 'margin-top:7px' }), h('span', {}, h('b', {}, (T.runs[S.last.cmd] || [S.last.cmd])[0]), ' · exit ' + S.last.code, h('div', { class: 'muted' }, S.last.finished.replace('T', ' ').slice(0, 16)))));
    return [
      head('home'),
      h('div', { class: 'cards' },
        card(T.kpi.rate, r ? pct(r.n, r.of) : '—', r ? fmt(T.kpi.rateNote, r.who, r.n, r.of, r.date) : T.kpi.noRate, true),
        card(T.kpi.facts, ok, fmt(T.kpi.factsNote, facts.length)),
        card(T.kpi.published, t.done, fmt(T.kpi.publishedNote, t.channels.size)),
        card(T.kpi.todo, t.todo, T.kpi.todoNote),
        card(T.kpi.review, S.drafts.filter((d) => !d.confirmed).length, T.kpi.reviewNote)),
      h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.loop)),
        h('div', { class: 'loop' }, T.loopSteps.map(([k, name, note], i) => h('a', { href: '#' + k, class: doneStep[k] ? 'done' : '', onclick: (e) => { e.preventDefault(); go(k); } },
          h('span', { class: 'k' }, h('span', { class: 'num' }, i + 1), name), h('span', { class: 'muted' }, fmt(note, ...loopVals[k])))))),
      h('div', { class: 'grid2' },
        h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.todoList)), st.length ? h('ul', { class: 'steps' }, st) : h('p', { class: 'muted' }, T.allDone)),
        h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.recent), link('log', T.openAll)), feed.length ? h('div', { class: 'feed' }, feed) : h('p', { class: 'muted' }, T.noRecent))),
      h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.channelState), link('channels', T.openAll)), h('div', { class: 'row', style: 'gap:18px' }, channelList().map((c) => h('span', { class: 'row', style: 'gap:8px' }, h('b', {}, c.name), pill(c.level, c.state))))),
    ];
  },
  monitor() {
    const r = rate(); const l = latest();
    const board = {}; const cited = {};
    for (const g of l) { for (const b of g.board) board[b.name] = (board[b.name] || 0) + b.n; for (const x of g.sources) cited[x.domain] = (cited[x.domain] || 0) + x.n; }
    const brand = String((S.config || {}).brand || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    const mine = (n) => brand.some((b) => n.toLowerCase().includes(b));
    const ai = String((S.config || {}).ai || '').split(',').map((x) => x.split(':')[0].trim());
    const byPlatform = {};
    for (const g of S.trend) (byPlatform[g.platform + ' · ' + g.entry] ||= []).push(g);
    const sorted = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, n }));
    return [
      head('monitor'),
      h('div', { class: 'cards' },
        card(T.kpi.rate, r ? pct(r.n, r.of) : '—', r ? fmt(T.kpi.rateNote, r.who, r.n, r.of, r.date) : T.kpi.noRate, true),
        card(T.kpi.mention, r ? pct(r.m, r.mof) : '—', r ? r.m + '/' + r.mof : T.kpi.noRate),
        card(T.kpi.questions, S.questions.length, fmt(T.kpi.questionsNote, S.gaps.length)),
        card(T.kpi.cited, Object.keys(cited).length, T.kpi.citedNote)),
      h('div', { class: 'grid2' },
        h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.trendChart)), S.trend.length ? trendChart() : h('p', { class: 'muted' }, T.noRuns)),
        h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.engines), link('settings', T.pages.settings[0])),
          table(['AI', '', ''], S.keys.map((k) => [h('b', {}, k.label), pill(k.set ? 'ok' : '', k.set ? T.keySet : T.keyUnset), ai.includes(k.id) ? pill('ok', T.inUse) : h('span', { class: 'muted' }, T.notInUse)])))),
      S.trend.length ? h('div', { class: 'grid2' },
        h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.competitors)), Object.keys(board).length ? bars(sorted(board), mine) : h('p', { class: 'muted' }, '—')),
        h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.citedSites)), Object.keys(cited).length ? bars(sorted(cited)) : h('p', { class: 'muted' }, '—'))) : null,
      S.trend.length ? h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.trend)),
        Object.entries(byPlatform).map(([name, list]) => h('div', { style: 'margin-bottom:14px' }, h('h3', {}, name),
          table([T.date, T.batch, T.recommend, T.mention, T.top], list.map((g) => [g.date, h('span', { class: 'muted' }, g.batch), meter(g.recommend.n, g.recommend.of), meter(g.mention.n, g.mention.of),
            g.board.slice(0, 3).map((b) => b.name + ' ' + b.n + '/' + b.of).join('，')])))),
        h('p', { class: 'muted' }, T.disclaimer)) : null,
    ];
  },
  gaps() {
    const body = !S.gaps.length ? [h('section', {}, h('p', {}, S.trend.length ? T.noGaps : T.noRuns))]
      : S.gaps.map((g) => h('section', {}, h('div', { class: 'sh' }, h('h2', {}, g.id + ' ' + g.question, g.core ? ' ' : '', g.core ? pill('warn', T.core) : null),
          g.draft ? h('button', { class: 'btn sm', onclick: () => { sel = g.draft; go('review'); } }, T.draftExists + '：' + g.draft) : pill('', T.noDraft)),
        h('div', { class: 'stack' }, g.platforms.map((p) => h('div', {}, h('b', {}, p.platform), '：', fmt(T.youOf, p.ours, p.of), '；', p.winners.map((w) => w.name + ' ' + w.n).join('，'))),
          g.sources.length ? h('div', { class: 'muted' }, T.sources + '：' + g.sources.join('，')) : null)));
    return [head('gaps', S.gaps.length ? h('button', { class: 'btn primary', disabled: S.busy ? true : null, onclick: () => run('write') }, T.writeGaps) : null), S.batches.length ? h('span', { class: 'muted' }, S.batches.join('，')) : null, ...body];
  },
  review() {
    if (!S.drafts.length) return [head('review', S.gaps.length ? h('button', { class: 'btn primary', onclick: () => run('write') }, T.writeGaps) : null), h('section', {}, h('p', {}, T.noDraft))];
    if (!sel || !S.drafts.some((d) => d.file === sel)) sel = (S.drafts.find((d) => !d.confirmed) || S.drafts[0]).file;
    const d = S.drafts.find((x) => x.file === sel);
    const ta = h('textarea', { 'aria-label': T.body });
    call('draft/' + encodeURIComponent(d.file)).then((r) => { ta.value = r.text; }, fail);
    const errs = d.issues.filter((x) => x.level === 'error');
    const facts = new Map((S.facts ? S.facts.entries : []).map((e) => [e.id, e]));
    return [head('review'),
      h('div', { class: 'split' },
        h('section', { class: 'list' }, S.drafts.map((x) => h('button', { class: x.file === sel ? 'on' : '', onclick: () => { sel = x.file; render(); } },
          h('span', { class: 't' }, x.title || x.file), h('span', { class: 'row' }, pill(x.confirmed ? 'ok' : 'warn', x.confirmed ? T.passed : T.waiting),
            blocked(x) ? pill('error', fmt(T.errorsN, x.issues.filter((i) => i.level === 'error').length)) : null, x.qid ? h('span', { class: 'muted' }, x.qid) : null)))),
        h('div', { class: 'stack' },
          h('section', {}, h('div', { class: 'sh' }, h('div', {}, h('h2', {}, d.title || d.file),
              h('div', { class: 'muted' }, [d.qid && T.qid + '：' + d.qid + ' ' + d.question, d.generatedBy && T.from + '：' + d.generatedBy, d.platforms.length && d.platforms.map(pname).join('、')].filter(Boolean).join(' · '))),
            h('div', { class: 'row' },
              h('button', { class: 'btn', disabled: d.confirmed ? null : true, onclick: () => act(() => call('draft/' + encodeURIComponent(d.file) + '/status', 'POST', { status: 'draft' }), T.backMsg) }, T.sendBack),
              h('button', { class: 'btn primary', disabled: d.confirmed || errs.length ? true : null, onclick: () => act(() => call('draft/' + encodeURIComponent(d.file) + '/status', 'POST', { status: 'confirmed' }), T.approvedMsg) }, T.approve))),
            h('div', { class: 'grid2' },
              h('div', {}, h('h3', {}, T.factCheck + ' · ' + T.citedFact), d.facts.length ? h('div', { class: 'stack' }, d.facts.map((id) => {
                const e = facts.get(id); const level = !e ? 'error' : e.confirmed ? 'ok' : 'error';
                return h('div', { class: 'row', style: 'align-items:flex-start;flex-wrap:nowrap' }, pill(level, id), h('span', {}, e ? [e.label ? h('b', {}, e.label + ' ') : null, e.detail] : '', h('div', { class: 'muted' }, !e ? T.factMissing : e.confirmed ? T.factOk : T.factNo)));
              })) : h('p', { class: 'muted' }, T.noFacts)),
              h('div', {}, h('h3', {}, T.issues), d.issues.length ? h('div', { class: 'stack' }, d.issues.map((i) => h('div', { class: 'row', style: 'align-items:flex-start;flex-wrap:nowrap' }, pill(i.level === 'info' ? '' : i.level, i.level), h('span', {}, i.msg)))) : h('p', { class: 'muted' }, T.noIssues)))),
          h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.body), h('button', { class: 'btn', onclick: () => act(() => call('draft/' + encodeURIComponent(d.file), 'PUT', { text: ta.value }), T.saved) }, T.save)), ta)))];
  },
  distribute() {
    const cols = columns(); const list = approvedDrafts(); const t = tally();
    const fillCount = (p) => list.filter((d) => cellOf(d, p).state === 'todo').length;
    const out = [head('distribute', h('button', { class: 'btn', onclick: () => go('log') }, T.pages.log[0])),
      h('div', { class: 'cards' }, T.dist.stats.map(([label, k]) => card(label, k === 'articles' ? t.articles : t[k]))),
      S.helper ? h('div', { class: 'note warn helper-off' }, h('span', {}, T.dist.install), h('a', { class: 'btn primary', href: '/geo-fill.user.js', target: '_blank', rel: 'noopener' }, T.dist.installBtn)) : h('div', { class: 'note warn' }, T.dist.noHelper),
      S.helper ? h('div', { class: 'note helper-on' }, h('span', { style: 'flex:1' }, T.dist.ready), S.channels.fill.map((p) => fillCount(p) ? h('button', { class: 'btn sm primary', 'data-all': p }, pname(p) + ' · ' + fmt(T.dist.fillAll, fillCount(p))) : null)) : null];
    if (!list.length) return [...out, h('section', {}, h('p', { class: 'muted' }, T.dist.none))];
    out.push(h('section', { class: 'flush' }, h('div', { class: 'sh' }, h('h2', {}, T.dist.matrix),
        h('div', { class: 'legend' }, h('span', {}, h('span', { class: 'dot ok' }), T.dist.legendDone), h('span', {}, h('span', { class: 'dot warn' }), T.dist.legendTodo), h('span', {}, h('span', { class: 'dot' }), T.dist.legendNa))),
      h('div', { class: 'scroll' }, h('table', { class: 'matrix' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, T.dist.article), cols.map((p) => h('th', { scope: 'col' }, pname(p))))),
        h('tbody', {}, list.map((d) => h('tr', {}, h('th', { scope: 'row' }, d.title || d.file, h('div', { class: 'muted' }, [d.qid, d.question !== d.title ? d.question : ''].filter(Boolean).join(' · '))), cols.map((p) => h('td', {}, cell(d, p))))))))));
    repaint();
    return out;
  },
  channels() { return [head('channels'), h('div', { class: 'grid3' }, channelList().map(channelCard)), h('div', { class: 'note' }, icon('shield'), h('span', {}, T.ch.safety))]; },
  log() {
    const rows = [...S.published].reverse().map((r) => [r.date, r.title || r.slug, pname(r.platform), r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.url.replace(/^https?:\/\//, '').slice(0, 60)) : '—', r.status]);
    return [head('log'), h('section', { class: 'flush' }, rows.length ? table(T.logCols, rows) : h('p', { class: 'muted', style: 'padding:16px 20px' }, T.noLog))];
  },
  facts() {
    const rows = (S.facts ? S.facts.entries : []).map((e) => [e.id, h('span', { class: 'muted' }, e.section), e.label ? h('span', {}, h('b', {}, e.label), ' ', e.detail) : e.detail,
      pill(e.confirmed ? 'ok' : 'warn', e.status || '—'),
      h('button', { class: 'btn sm', disabled: !e.confirmed && !e.filled ? true : null, title: !e.confirmed && !e.filled ? T.emptyFact : null, onclick: () => act(() => call('fact/' + encodeURIComponent(e.id), 'POST', { confirmed: !e.confirmed })) }, e.confirmed ? T.unconfirm : T.confirm)]);
    return [head('facts'), h('section', { class: 'flush' }, rows.length ? table([T.id, T.section, T.fact, T.status, ''], rows) : h('p', { class: 'muted', style: 'padding:16px 20px' }, S.errors.facts || '—')), editor('facts')];
  },
  questions() {
    const gap = new Set(S.gaps.map((g) => g.id));
    const rows = S.questions.map((q) => [q.id, q.cls, q.question, q.priority, gap.has(q.id) ? pill('warn', T.gaps) : '']);
    return [head('questions'), h('section', { class: 'flush' }, rows.length ? table([T.id, T.cls, T.question, T.priority, ''], rows) : h('p', { class: 'muted', style: 'padding:16px 20px' }, S.errors.questions || '—')), editor('questions')];
  },
  run() {
    return [head('run'),
      h('div', { class: 'runs' }, Object.entries(T.runs).map(([k, [name, desc]]) => h('div', { class: 'card' }, h('b', {}, name), h('span', { class: 'muted', style: 'flex:1' }, desc),
        h('div', {}, h('button', { class: 'btn primary sm', disabled: S.busy ? true : null, onclick: () => run(k) }, name))))),
      S.busy ? h('p', { class: 'busy' }, fmt(T.running, S.busy)) : null,
      S.last ? h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.output + ' · ' + S.last.cmd + ' · exit ' + S.last.code)), h('pre', {}, [S.last.out, S.last.err].filter(Boolean).join('\n'))) : null];
  },
  settings() {
    return [head('settings'),
      h('section', { class: 'flush' }, h('div', { class: 'sh' }, h('h2', {}, T.keys)), table(['AI', '', ''], S.keys.map((k) => [k.label + ' · ' + k.env, pill(k.set ? 'ok' : '', k.set ? T.keySet : T.keyUnset),
        k.url ? h('a', { href: k.url, target: '_blank', rel: 'noopener noreferrer' }, T.getKey) : '']))),
      editor('config', T.config)];
  },
  sources() {
    const url = h('input', { type: 'url', placeholder: 'https://', class: 'field' });
    const name = h('input', { type: 'text', placeholder: T.src.name, class: 'field' });
    const paste = h('textarea', { class: 'short' });
    const file = h('input', { type: 'file', accept: '.md,.markdown,.txt,.html,.htm' });
    file.addEventListener('change', () => { const f = file.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => act(() => call('source', 'POST', { name: f.name, text: String(r.result) }), T.src.added); r.readAsText(f); });
    const cands = S.candidates.filter((c) => c.status === 'new');
    return [head('sources'),
      h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.src.add)), h('div', { class: 'stack' }, h('p', { class: 'muted', style: 'margin:0' }, T.src.intro),
        h('div', { class: 'row' }, url, h('button', { class: 'btn', onclick: () => url.value && act(() => call('source', 'POST', { url: url.value }), T.src.added) }, T.src.fetch)),
        h('div', { class: 'muted' }, T.src.paste), h('div', { class: 'row' }, name), paste,
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => paste.value.trim() && act(() => call('source', 'POST', { name: name.value, text: paste.value }), T.src.added) }, T.src.save)),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, T.src.file), file))),
      h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.src.list), S.sources.length ? h('button', { class: 'btn primary', disabled: S.busy ? true : null, onclick: () => run('facts') }, T.src.extract) : null),
        S.sources.length ? table(['', ''], S.sources.map((x) => [h('span', {}, x.file, x.from ? h('div', { class: 'muted' }, x.from) : null),
          h('button', { class: 'btn sm', onclick: () => act(() => call('source/' + encodeURIComponent(x.file), 'DELETE', {})) }, T.src.del)])) : h('p', { class: 'muted' }, T.src.none)),
      h('section', {}, h('div', { class: 'sh' }, h('h2', {}, T.src.cands + (cands.length ? ' · ' + cands.length : '')),
          cands.length ? h('button', { class: 'btn', onclick: () => act(() => call('candidate/all', 'POST', { action: 'apply' }), T.src.applied) }, T.src.applyAll) : null),
        cands.length ? null : h('p', { class: 'muted' }, T.src.noCands),
        cands.map((c) => h('div', { class: 'cand' },
          h('div', {}, h('b', {}, c.id ? T.src.fill + ' ' + c.id : T.src.addTo + ' ' + c.section), ' ', Object.entries(c.fields).map(([k, v]) => k + '：' + v).join('；')),
          h('div', { class: 'muted' }, T.src.quote + '：「' + c.quote + '」 · ' + c.source),
          c.conflict.length ? h('div', {}, pill('warn', T.src.conflict + c.conflict.map((x) => x.field + '「' + x.current + '」').join('；'))) : null,
          h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn sm primary', onclick: () => act(() => call('candidate/' + c.cid, 'POST', { action: 'apply' }), T.src.applied) }, T.src.apply),
            h('button', { class: 'btn sm', onclick: () => act(() => call('candidate/' + c.cid, 'POST', { action: 'ignore' })) }, T.src.ignore)))))];
  },
  reports() {
    if (!S.reports.length) return [head('reports'), h('section', {}, h('p', { class: 'muted' }, T.noReports))];
    const pre = h('pre', {});
    const show = (f) => call('report/' + encodeURIComponent(f)).then((r) => { pre.textContent = r.text; }, fail);
    show(S.reports[0]);
    return [head('reports', h('button', { class: 'btn', disabled: S.busy ? true : null, onclick: () => run('report') }, T.runs.report[0])),
      h('div', { class: 'split' }, h('section', { class: 'list' }, S.reports.map((f) => h('button', { onclick: () => show(f) }, h('span', { class: 't' }, f)))), h('section', {}, pre))];
  },
};

// Every channel with how it publishes and whether it is ready. 每个渠道怎么发、准备好没有。
function channelList() {
  const ch = S.channels; const c = S.config || {};
  const list = [
    { key: 'site', name: T.ch.site[0], how: T.ch.site[1], level: S.siteBuilt ? 'ok' : '', state: S.siteBuilt ? T.ch.built : T.ch.notBuilt, detail: c.baseUrl || T.ch.siteHint,
      acts: [h('button', { class: 'btn sm', disabled: S.busy ? true : null, onclick: () => run('site') }, T.runs.site[0]), c.baseUrl ? h('a', { class: 'btn sm', href: c.baseUrl, target: '_blank', rel: 'noopener noreferrer' }, T.ch.openSite) : null] },
    { key: 'wordpress', name: T.ch.wordpress[0], how: T.ch.wordpress[1], level: ch.wordpress.site && ch.wordpress.user && ch.wordpress.set ? 'ok' : '', state: ch.wordpress.site && ch.wordpress.user && ch.wordpress.set ? T.ch.connected : T.ch.notConnected,
      detail: ch.wordpress.site ? ch.wordpress.site + ' · ' + ch.wordpress.user + (ch.wordpress.set ? '' : ' · ' + fmt(T.ch.keyHint, ch.wordpress.key)) : T.ch.wpHint,
      acts: [ch.wordpress.site && ch.wordpress.user && ch.wordpress.set ? h('button', { class: 'btn sm', disabled: S.busy ? true : null, onclick: () => run('wordpress') }, T.runs.wordpress[0]) : h('button', { class: 'btn sm', onclick: () => go('settings') }, T.pages.settings[0])] },
    { key: 'devto', name: T.ch.devto[0], how: T.ch.devto[1], level: ch.devto.set ? 'ok' : '', state: ch.devto.set ? T.ch.connected : T.ch.notConnected, detail: ch.devto.set ? 'DEVTO_API_KEY' : fmt(T.ch.keyHint, ch.devto.key),
      acts: [ch.devto.set ? h('button', { class: 'btn sm', disabled: S.busy ? true : null, onclick: () => run('devto') }, T.runs.devto[0]) : h('a', { class: 'btn sm', href: ch.devto.url, target: '_blank', rel: 'noopener noreferrer' }, T.ch.getKey)] },
    ...ch.fill.map((p) => ({ key: p, name: pname(p), how: T.ch.helper[1], level: 'warn', state: T.ch.helper[0], helper: true, detail: ch.editors[p],
      acts: [S.helper ? h('a', { class: 'btn sm helper-off', href: '/geo-fill.user.js', target: '_blank', rel: 'noopener' }, T.dist.installBtn) : null, h('button', { class: 'btn sm', onclick: () => go('distribute') }, T.ch.go)] })),
    ...Object.keys(ch.editors).filter((p) => !ch.fill.includes(p)).map((p) => ({ key: p, name: pname(p), how: T.ch.paste[1], level: '', state: T.ch.manual, detail: ch.editors[p],
      acts: [h('a', { class: 'btn sm', href: ch.editors[p], target: '_blank', rel: 'noopener noreferrer' }, T.dist.open), h('button', { class: 'btn sm', onclick: () => go('distribute') }, T.ch.go)] })),
  ];
  return list;
}
function channelCard(c) {
  const badge = c.helper && S.helper ? [h('span', { class: 'pill ok helper-on' }, T.ch.ready), h('span', { class: 'pill warn helper-off' }, T.ch.notInstalled)] : pill(c.level, c.state);
  return h('div', { class: 'card chan' }, h('div', { class: 'tt' }, h('b', {}, c.name), badge), h('span', {}, c.how), h('span', { class: 'muted', style: 'word-break:break-all' }, c.detail), h('div', { class: 'row' }, c.acts));
}

function editor(name, title) {
  const ta = h('textarea', { class: name === 'config' ? 'short' : null, 'aria-label': title || name });
  const save = h('button', { class: 'btn', onclick: () => act(() => call('file/' + name, 'PUT', { text: ta.value }), T.saved) }, T.save);
  call('file/' + name).then((r) => { ta.value = r.text; }, fail);
  if (title) return h('section', {}, h('div', { class: 'sh' }, h('h2', {}, title), save), ta);
  return h('details', {}, h('summary', {}, T.editRaw), h('section', { style: 'margin-top:10px' }, h('div', { class: 'stack' }, ta, h('div', {}, save))));
}

async function run(cmd) {
  if (S.busy) return toast(T.busy);
  S.busy = T.runs[cmd][0]; render();
  try { const r = await call('run', 'POST', { cmd }); toast((T.runs[cmd] || [cmd])[0] + ' · exit ' + r.code); } catch (e) { fail(e); }
  await load();
}

function nav() {
  const badge = { review: S.drafts.filter((d) => !d.confirmed).length, distribute: tally().todo, gaps: S.gaps.filter((g) => !g.draft).length };
  $('nav').replaceChildren(...T.groups.map(([name, items]) => h('div', { class: 'navgroup' }, h('span', {}, name),
    items.map(([k, label, ic]) => h('a', { href: '#' + k, class: k === tab ? 'on' : '', 'aria-current': k === tab ? 'page' : null, onclick: (e) => { e.preventDefault(); go(k); } }, icon(ic), label, badge[k] ? h('span', { class: 'count' }, badge[k]) : null)))));
  $('dir').textContent = S.dir;
  $('acts').replaceChildren(...[S.busy ? h('span', { class: 'busy' }, fmt(T.running, S.busy)) : null,
    h('button', { class: 'btn', disabled: S.busy || !S.gaps.length ? true : null, onclick: () => run('write') }, T.actions.write),
    h('button', { class: 'btn primary', disabled: S.busy ? true : null, onclick: () => run('probe') }, T.actions.retest)].filter(Boolean));
}

function render() {
  if (!S) return;
  if (!views[tab]) tab = 'home';
  nav();
  $('main').replaceChildren(...views[tab]().filter(Boolean));
}
$('logo').append(icon('plus'));
window.addEventListener('hashchange', () => { let t = location.hash.slice(1); t = ALIAS[t] || t; if (t !== tab && views[t]) { tab = t; render(); } });
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
