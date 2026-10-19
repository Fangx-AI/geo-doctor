#!/usr/bin/env node
// geo-autopilot · geo-doctor
// The weekly loop: ask the AIs again, find the questions where a competitor is recommended and you are not,
// draft one article per gap from the confirmed fact card, and write a progress report for a pull request.
// 每周自动复查：重新采样，找出"竞品被推荐、你没有"的题，按已确认的事实卡为每道缺口题写一篇草稿，
// 再写一份疗效报告，交给人在 PR 里审。零依赖。
//
//   npx -p github:Fangx-AI/geo-doctor geo-autopilot gaps                 # list the gaps from geo/runs.csv
//   npx -p github:Fangx-AI/geo-doctor geo-autopilot write --ai deepseek  # draft articles for them
//   npx -p github:Fangx-AI/geo-doctor geo-autopilot report               # trend report
//   npx -p github:Fangx-AI/geo-doctor geo-autopilot weekly               # all of the above, from geo/autopilot.json
//   npx -p github:Fangx-AI/geo-doctor geo-autopilot action               # GitHub Actions workflow that runs weekly
//
// Drafts are written by the model you choose and only from confirmed facts, then checked by geo-publish.
// A person reviews them before anything is published: nothing here posts anywhere.
// 草稿只用已确认的事实，写完自动检查；发布前由人审核，本工具不会发布到任何地方。
// SPDX-License-Identifier: MIT

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROVIDERS, ask, parseCsv, loadQuestions, summarize, main as probeMain } from './geo-probe.mjs';
import { checkDrafts, loadDrafts, parseFacts } from './geo-publish.mjs';
import { parseFactCard, loadFacts } from './geo-site.mjs';

export const VERSION = '1.0.0';
const VALID = new Set(['完整', '拒答']);
const pad = (n) => String(n).padStart(2, '0');
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const splitList = (s) => String(s || '').split(/[;；]/).map((x) => x.trim()).filter(Boolean);
// Counts, not percentages: samples are small (see step 8). 写次数不写百分比，样本小。
const ratio = (n, of) => (of ? `${n}/${of}` : 'NA');

const M = {
  zh: {
    usage: `geo-autopilot ${VERSION} · GEO 医生的每周自动复查

用法：
  geo-autopilot gaps   [--runs geo/runs.csv] [--questions geo/questions.csv] [--drafts geo/drafts] [--json]
  geo-autopilot write  --ai deepseek[:模型] [--max 3] [--ready] [--facts geo/fact-card.yaml] [--brand 品牌]
  geo-autopilot report [--out geo/reports/日期.md]
  geo-autopilot weekly [--config geo/autopilot.json] [--pr-body 文件]
  geo-autopilot action [--file .github/workflows/geo-autopilot.yml]

  gaps     从最近一批采样里找缺口：A 类题里竞品被推荐的次数比你多。已经有草稿的题会标出来。
  write    给还没有草稿的缺口题各写一篇（默认最多 3 篇），只用事实卡里"已确认"的事实，
           存到 geo/drafts/，再用 geo-publish 的规则检查。加 --ready 时，检查没有错误的稿件
           标为 confirmed（用于 PR 审核：合并即同意发布）；否则都是 draft。
  report   推荐率趋势、这次和上次相比每道题的变化、还没补上的缺口。
  weekly   读 geo/autopilot.json，依次采样（geo-probe）、写稿、出报告；--pr-body 写一份 PR 说明。
  action   写一个每周一自动运行的 GitHub Actions 工作流，跑完开一个 PR 给你审，并生成 geo/autopilot.json 模板。

API Key 只从环境变量读取（例如 DEEPSEEK_API_KEY），不要写在命令或文件里。`,
    need: (x) => `缺少 ${x}`, noFile: (f) => `找不到文件：${f}`, unknownCmd: (c) => `未知命令：${c}`,
    badAi: (a) => `不认识的 AI：${a}。可选：${Object.keys(PROVIDERS).join('、')}`,
    needModel: (a) => `${a} 需要指定模型，例如 --ai ${a}:模型名`,
    noKey: (v) => `请先设置环境变量 ${v}`,
    noRuns: (f) => `${f} 里还没有 API 采样记录，先运行 geo-probe run`,
    noGaps: '没有缺口：最近一批采样里，没有哪道 A 类题是竞品被推荐得比你多。',
    gapsTitle: (n, batches) => `找到 ${n} 道缺口题（来自 ${batches.join('、')}）：`,
    gapLine: (g) => `- ${g.id} ${g.question}\n  你被推荐 ${g.ours}/${g.of} 次；${g.winners.map((w) => `${w.name} ${w.n} 次`).join('，')}${g.draft ? `\n  已有草稿：${g.draft}` : ''}`,
    noFacts: (f) => `找不到事实卡：${f}`,
    fewFacts: '事实卡里还没有"已确认"的事实，写不了稿。先完成第 2 步。',
    nothingToWrite: '所有缺口题都已经有草稿了。',
    writing: (id, q) => `✍️  ${id} ${q}`,
    wroteDraft: (f, ok) => `   ${ok ? '✅' : '⚠️ '} ${f}${ok ? '' : '（检查有错误，保持 draft，需修改）'}`,
    writeFailed: (id, msg) => `   ❌ ${id} 写稿失败：${msg}`,
    badOutput: '模型没有按格式返回（缺少标题或正文）',
    wrote: (f) => `已写入 ${f}`,
    noConfig: (f) => `找不到 ${f}。先运行 geo-autopilot action 生成模板，填好品牌、竞品和要问的 AI。`,
    badConfig: (f, m) => `${f} 不是有效的 JSON：${m}`,
    configNeed: (k) => `geo/autopilot.json 里缺少 ${k}`,
    actionDone: (f, c) => `✅ 已写入 ${f}${c ? `\n✅ 已写入 ${c}（请填好品牌、竞品和要问的 AI）` : ''}
下一步：
  1. 仓库 Settings → Secrets and variables → Actions，按 autopilot.json 里用到的 AI 添加 API Key，例如 DEEPSEEK_API_KEY
  2. Settings → Actions → General → Workflow permissions，勾选 "Allow GitHub Actions to create and approve pull requests"
  3. 在 Actions 页面手动运行一次 geo-autopilot，看看第一份 PR`,
    actionExists: (f) => `${f} 已存在，没有覆盖；要重写请先删除它。`,
    probeFailed: '采样失败，本周没有新数据。',
    report: {
      title: (d) => `GEO 医生每周复查 · ${d}`,
      note: '以下是 API 自动采样：不登录、多数不联网，和用户在 App 里看到的可能不同；"是否推荐"是关键词初判，需复核。重要结论请在 App 里人工确认。',
      trend: '推荐率趋势（A 类题）', trendHead: '| 平台 | 批次 | 日期 | 推荐率 | 提及率 | 推荐最多的竞品 |',
      changes: (p, a, b) => `${p}：${b} 对比 ${a}`, changesHead: '| 题 | 问题 | 上次被推荐 | 这次被推荐 |',
      noChange: '和上次相比，每道题的推荐次数都没有变化。', firstBatch: (p) => `${p}：这是第一批，下周开始能看到变化。`,
      gaps: '还没补上的缺口', gapsHead: '| 题 | 问题 | 你 | 推荐了谁 | 草稿 |', noGaps: '最近一批采样里没有缺口。',
      none: '—', pct: ratio,
    },
    pr: {
      title: (d) => `GEO 医生每周复查：${d}`,
      intro: '本周 GEO 医生重新问了一遍 AI，并为还没补上的缺口写了新稿。',
      drafts: '本周新写的稿', ok: '检查通过，合并后发布到事实站', bad: (n) => `有 ${n} 处错误，保持 draft，需要改完再发`,
      noDrafts: '本周没有新稿：缺口都已经有稿了，或者没有找到缺口。',
      review: '**合并前请逐篇读一遍。** 稿子由 AI 根据事实卡里已确认的事实写成，仍可能有说法不准、语气不对的地方，可以直接在这个 PR 里改。合并即表示你同意把标为 confirmed 的稿件发布到事实站；不想发的稿件，把 status 改成 draft 再合并。',
    },
    prompt: (o) => `你是严谨的产品文案，正在为"${o.brand}"写一篇能被 AI 搜索引用的问答文章。

用户在 AI 里问：「${o.question}」
最近一次采样里，AI 推荐了：${o.winners || '其他产品'}，没有推荐${o.brand}。${o.sources ? `\nAI 回答时引用的网站：${o.sources}` : ''}

只能使用下面这些已确认的事实（方括号里是编号）。事实里没有的数字、功能、客户、评价一律不写，不编造，不估算：
${o.facts}

写法：
- 第一句直接回答问题；如果${o.brand}并不适合提问的人，就如实说明，并说清它适合谁。
- 小标题用用户会问的原话；一段只讲一件事；写具体的数字、价格、平台和日期；能力后面紧跟限制；写清不适合谁。
- 可以客观提到推荐里出现的竞品，但只写可核实的差异，不贬低。
- 不用"最好、第一、领先、唯一、100%、全网"这类词，不写用户评价。
- 正文 400 到 900 字。正文最后加一节"## 核对表"，用表格列出每个关键句用到的事实编号。

严格按下面的格式输出，不要输出其他内容：
TITLE: 标题（带上用户的问题）
SLUG: 只用小写英文字母、数字和连字符的短网址
DESCRIPTION: 一句话说明这篇回答了什么（60 字以内）
FACTS: 用到的事实编号，逗号分隔
---
（Markdown 正文，不要再写一级标题）`,
  },
  en: {
    usage: `geo-autopilot ${VERSION} · GEO Doctor's weekly loop

Usage:
  geo-autopilot gaps   [--runs geo/runs.csv] [--questions geo/questions.csv] [--drafts geo/drafts] [--json]
  geo-autopilot write  --ai deepseek[:model] [--max 3] [--ready] [--facts geo/fact-card.yaml] [--brand name]
  geo-autopilot report [--out geo/reports/date.md]
  geo-autopilot weekly [--config geo/autopilot.json] [--pr-body file]
  geo-autopilot action [--file .github/workflows/geo-autopilot.yml]

  gaps     Finds the gaps in the latest sample: type-A questions where a competitor is recommended more often
           than you. Questions that already have a draft are marked.
  write    Drafts one article per gap without a draft (3 by default), using only confirmed facts, saves it in
           geo/drafts/ and checks it with geo-publish's rules. With --ready, drafts with no errors are marked
           confirmed (for review in a pull request: merging approves publishing); otherwise all stay draft.
  report   Recommendation-rate trend, per-question change since the previous batch, and open gaps.
  weekly   Reads geo/autopilot.json, then samples (geo-probe), drafts and reports; --pr-body writes a PR description.
  action   Writes a GitHub Actions workflow that runs every Monday and opens a pull request for you to review,
           plus a geo/autopilot.json template.

API keys are read only from environment variables (e.g. OPENAI_API_KEY); never put them in commands or files.`,
    need: (x) => `Missing ${x}`, noFile: (f) => `File not found: ${f}`, unknownCmd: (c) => `Unknown command: ${c}`,
    badAi: (a) => `Unknown AI: ${a}. Known: ${Object.keys(PROVIDERS).join(', ')}`,
    needModel: (a) => `${a} needs a model, e.g. --ai ${a}:model-id`,
    noKey: (v) => `Set the ${v} environment variable first`,
    noRuns: (f) => `No API samples in ${f} yet; run geo-probe run first`,
    noGaps: 'No gaps: in the latest sample no type-A question recommends a competitor more often than you.',
    gapsTitle: (n, batches) => `${n} gap questions (from ${batches.join(', ')}):`,
    gapLine: (g) => `- ${g.id} ${g.question}\n  You: ${g.ours}/${g.of}; ${g.winners.map((w) => `${w.name} ${w.n}`).join(', ')}${g.draft ? `\n  Draft: ${g.draft}` : ''}`,
    noFacts: (f) => `Fact card not found: ${f}`,
    fewFacts: 'The fact card has no confirmed facts yet, so nothing can be drafted. Finish step 2 first.',
    nothingToWrite: 'Every gap question already has a draft.',
    writing: (id, q) => `✍️  ${id} ${q}`,
    wroteDraft: (f, ok) => `   ${ok ? '✅' : '⚠️ '} ${f}${ok ? '' : ' (check errors; kept as draft, needs edits)'}`,
    writeFailed: (id, msg) => `   ❌ ${id} failed: ${msg}`,
    badOutput: 'The model did not follow the format (no title or body)',
    wrote: (f) => `Wrote ${f}`,
    noConfig: (f) => `${f} not found. Run geo-autopilot action to create a template, then fill in your brand, competitors and AIs.`,
    badConfig: (f, m) => `${f} is not valid JSON: ${m}`,
    configNeed: (k) => `geo/autopilot.json is missing ${k}`,
    actionDone: (f, c) => `✅ Wrote ${f}${c ? `\n✅ Wrote ${c} (fill in your brand, competitors and AIs)` : ''}
Next:
  1. Settings → Secrets and variables → Actions: add the API keys for the AIs in autopilot.json, e.g. OPENAI_API_KEY
  2. Settings → Actions → General → Workflow permissions: tick "Allow GitHub Actions to create and approve pull requests"
  3. Run geo-autopilot once from the Actions tab and look at the first pull request`,
    actionExists: (f) => `${f} already exists and was left alone; delete it to regenerate.`,
    probeFailed: 'Sampling failed; no new data this week.',
    report: {
      title: (d) => `GEO Doctor weekly check · ${d}`,
      note: 'These are automatic API samples: no login, usually no web search, so they may differ from what people see in the apps. "Recommended" is a keyword first pass; review it, and confirm important conclusions in the apps.',
      trend: 'Recommendation rate (type-A questions)', trendHead: '| AI | Batch | Date | Recommended | Mentioned | Most recommended rival |',
      changes: (p, a, b) => `${p}: ${b} vs ${a}`, changesHead: '| Q | Question | Last time | This time |',
      noChange: 'No question changed since last time.', firstBatch: (p) => `${p}: first batch; changes show from next week.`,
      gaps: 'Open gaps', gapsHead: '| Q | Question | You | Recommended instead | Draft |', noGaps: 'No gaps in the latest sample.',
      none: '—', pct: ratio,
    },
    pr: {
      title: (d) => `GEO Doctor weekly check: ${d}`,
      intro: 'GEO Doctor asked the AIs again this week and drafted articles for the gaps that are still open.',
      drafts: 'New drafts this week', ok: 'passed the checks; published to the fact site when merged', bad: (n) => `${n} errors; kept as draft until fixed`,
      noDrafts: 'No new drafts this week: every gap already has one, or there were no gaps.',
      review: '**Read every draft before merging.** They were written by AI from confirmed facts only, but can still be off in wording or tone; edit them right in this pull request. Merging means you approve publishing the drafts marked confirmed to the fact site; set status to draft for any you do not want published.',
    },
    prompt: (o) => `You are a careful product writer drafting a Q&A article about "${o.brand}" that AI search engines can quote.

A user asks an AI: "${o.question}"
In the latest sample the AI recommended ${o.winners || 'other products'}, not ${o.brand}.${o.sources ? `\nSites the AI cited: ${o.sources}` : ''}

Use only these confirmed facts (IDs in brackets). Do not write any number, feature, customer or review that is not here; never invent or estimate:
${o.facts}

How to write:
- Answer the question in the first sentence. If ${o.brand} is not a fit for the asker, say so honestly and say who it is for.
- Use the user's own questions as subheadings; one point per paragraph; concrete numbers, prices, platforms and dates; follow each capability with its limit; say who it is not for.
- You may mention the recommended competitors objectively, with verifiable differences only; never disparage them.
- No "best", "#1", "leading", "only", "100%"; no customer reviews.
- 300 to 700 words. End with a "## Fact check" section: a table listing the fact IDs behind each key sentence.

Output exactly this format and nothing else:
TITLE: a title that includes the user's question
SLUG: short URL slug, lowercase letters, digits and hyphens only
DESCRIPTION: one sentence on what the article answers (under 25 words)
FACTS: fact IDs used, comma-separated
---
(Markdown body without an H1)`,
  },
};

// ---------------------------------------------------------------- gaps

const loadRuns = (file) => parseCsv(readFileSync(file, 'utf8')).filter((r) => r['入口'] === 'API' && r['批次']);

// The most recent batch per platform, by date then name. 每个平台最近的一批。
export function latestBatches(rows) {
  const best = new Map();
  for (const r of rows) {
    const key = r['平台']; const cur = best.get(key); const cand = [r['日期'] || '', r['批次']];
    if (!cur || cand[0] > cur[0] || (cand[0] === cur[0] && cand[1] > cur[1])) best.set(key, cand);
  }
  return [...best.values()].map((x) => x[1]);
}

// Per question: how often we and each competitor were recommended in the given batches (type A, valid answers only).
export function questionStats(rows, batches, classOf) {
  const keep = new Set(batches); const stats = new Map();
  for (const r of rows) {
    if (!keep.has(r['批次']) || !VALID.has(r['回答状态']) || classOf(r) !== 'A') continue;
    const id = r['问题id'];
    if (!stats.has(id)) stats.set(id, { id, ours: 0, of: 0, winners: new Map(), sources: new Map() });
    const s = stats.get(id); s.of++;
    if (r['是否推荐我们'] === '推荐') s.ours++;
    for (const w of new Set(splitList(r['推荐了谁']))) s.winners.set(w, (s.winners.get(w) || 0) + 1);
    for (const d of new Set(splitList(r['引用来源']))) s.sources.set(d, (s.sources.get(d) || 0) + 1);
  }
  return stats;
}

const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));

// A gap: some competitor was recommended more often than we were. 缺口：有竞品比你被推荐得多。
export function findGaps({ rows, questions, drafts = [], batches = latestBatches(rows), priority = new Map() }) {
  const text = new Map(questions.map((q) => [q.id, q]));
  const classOf = (r) => text.get(r['问题id'])?.cls || '';
  const draftFor = (id, question) => drafts.find((d) => d.meta.qid === id || (question && d.meta.question === question));
  const gaps = [];
  for (const s of questionStats(rows, batches, classOf).values()) {
    const winners = sorted(s.winners);
    if (!winners.length || winners[0].n <= s.ours) continue;
    const q = text.get(s.id);
    gaps.push({ id: s.id, question: q?.question || s.id, ours: s.ours, of: s.of, winners, sources: sorted(s.sources).slice(0, 5).map((x) => x.name),
      draft: draftFor(s.id, q?.question)?.file || null, core: /核心|core|high/i.test(priority.get(s.id) || '') });
  }
  return { batches, gaps: gaps.sort((a, b) => (b.core - a.core) || ((b.winners[0].n - b.ours) - (a.winners[0].n - a.ours)) || a.id.localeCompare(b.id)) };
}

// ---------------------------------------------------------------- drafting

export function factLines(facts) {
  return facts.confirmed.map((e) => {
    const parts = Object.entries(e.raw).filter(([k, v]) => !/^(编号|id|状态|status|来源|source)$/i.test(k) && (Array.isArray(v) ? v.length : String(v ?? '').trim()))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('、') : v}`);
    return parts.length ? `[${e.id}] ${parts.join('；')}` : '';
  }).filter(Boolean).join('\n');
}

export function parseWriterOutput(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/, '$1');
  const cut = src.search(/^---\s*$/m);
  if (cut < 0) return null;
  const head = src.slice(0, cut); const body = src.slice(cut).replace(/^---\s*\n/, '').trim();
  const get = (k) => (head.match(new RegExp(`^\\s*${k}\\s*[:：]\\s*(.+)$`, 'mi')) || [])[1]?.trim() || '';
  const title = get('TITLE').replace(/^["“]|["”]$/g, '');
  if (!title || !body) return null;
  return { title, slug: get('SLUG').toLowerCase(), description: get('DESCRIPTION'),
    facts: get('FACTS').split(/[,，、\s]+/).map((x) => x.replace(/[[\]]/g, '').trim()).filter(Boolean), body: body.replace(/^#\s+.*\n+/, '') };
}

// Front matter is read by geo-publish's parser: one line per key, outer quotes stripped, no escapes.
const yamlStr = (s) => { s = String(s).replace(/\s*\n\s*/g, ' ').trim(); return /^["'[{]/.test(s) ? `"${s}"` : s; };

export function draftText(p, { question, qid, lang, brand, status, by, date }) {
  return `---
title: ${yamlStr(p.title)}
slug: ${p.slug}
question: ${yamlStr(question)}
qid: ${qid}
description: ${yamlStr(p.description || '')}
lang: ${lang}
platforms: [site]
facts: [${p.facts.join(', ')}]
brand: ${yamlStr(brand)}
status: ${status}
generated_by: ${yamlStr(`geo-autopilot ${by}, ${date}`)}
---

${p.body.trim()}
`;
}

function resolveWriter(spec, env, t) {
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

export async function writeDrafts({ gaps, facts, factsRaw, draftsDir, writer, brand, lang, max = 3, ready = false, out, err, fetchImpl = fetch, sleep, date }) {
  const t = M[lang]; const todo = gaps.filter((g) => !g.draft).slice(0, max); const results = [];
  if (!todo.length) { out(t.nothingToWrite); return results; }
  mkdirSync(draftsDir, { recursive: true });
  const taken = new Set(loadDrafts(draftsDir).map((d) => d.slug));
  const factMap = parseFacts(factsRaw);
  for (const g of todo) {
    out(t.writing(g.id, g.question));
    try {
      const prompt = t.prompt({ brand, question: g.question, winners: g.winners.map((w) => w.name).join(lang === 'zh' ? '、' : ', '), sources: g.sources.join(', '), facts: factLines(facts) });
      const r = await askRetry(writer.p, { base: writer.p.base, key: writer.key, model: writer.model, question: prompt, maxTokens: 3000, timeoutMs: 180000, fetchImpl }, sleep);
      const p = parseWriterOutput(r.text);
      if (!p) throw new Error(t.badOutput);
      let slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) ? p.slug : `${g.id.toLowerCase()}-answer`;
      for (let i = 2; taken.has(slug); i++) slug = `${slug.replace(/-\d+$/, '')}-${i}`;
      taken.add(slug); p.slug = slug;
      p.facts = [...new Set(p.facts)];
      const file = join(draftsDir, `${slug}.md`);
      const write = (status) => writeFileSync(file, draftText(p, { question: g.question, qid: g.id, lang, brand, status, by: `${writer.name}:${r.model || writer.model}`, date }));
      write('draft');
      const [d] = loadDrafts(draftsDir).filter((x) => x.file === `${slug}.md`);
      const errors = checkDrafts([d], { facts: factMap, lang }).filter((x) => x.level === 'error');
      if (ready && !errors.length) write('confirmed');
      out(t.wroteDraft(file, !errors.length));
      results.push({ id: g.id, question: g.question, file, slug, title: p.title, errors: errors.map((x) => x.msg), status: ready && !errors.length ? 'confirmed' : 'draft' });
    } catch (e) { err(t.writeFailed(g.id, e.message)); results.push({ id: g.id, question: g.question, failed: e.message }); }
  }
  return results;
}

// ---------------------------------------------------------------- report

export function buildReport({ rows, questions, drafts = [], lang = 'zh', date = today() }) {
  const t = M[lang].report; const L = [`# ${t.title(date)}`, '', `> ${t.note}`, ''];
  const cls = new Map(questions.map((q) => [q.id, q.cls]));
  const text = new Map(questions.map((q) => [q.id, q.question]));
  const groups = summarize(rows, cls).sort((a, b) => a.platform.localeCompare(b.platform) || a.batch.localeCompare(b.batch));
  const dateOf = new Map(rows.map((r) => [r['批次'], r['日期']]));
  L.push(`## ${t.trend}`, '', t.trendHead, '| --- | --- | --- | --- | --- | --- |');
  for (const g of groups) L.push(`| ${g.platform} | ${g.batch} | ${dateOf.get(g.batch) || ''} | ${t.pct(g.recommend.n, g.recommend.of)} | ${t.pct(g.mention.n, g.mention.of)} | ${g.board[0] ? `${g.board[0].name} ${g.board[0].n}/${g.board[0].of}` : t.none} |`);
  L.push('');
  const classOf = (r) => cls.get(r['问题id']) || '';
  const byPlatform = new Map();
  for (const g of groups) { if (!byPlatform.has(g.platform)) byPlatform.set(g.platform, []); byPlatform.get(g.platform).push(g.batch); }
  for (const [platform, list] of byPlatform) {
    const ordered = list.sort((a, b) => (dateOf.get(a) || '').localeCompare(dateOf.get(b) || '') || a.localeCompare(b));
    if (ordered.length < 2) { L.push(t.firstBatch(platform), ''); continue; }
    const [prev, cur] = ordered.slice(-2);
    const a = questionStats(rows, [prev], classOf); const b = questionStats(rows, [cur], classOf);
    const ids = [...new Set([...a.keys(), ...b.keys()])].sort();
    const changed = ids.filter((id) => (a.get(id)?.ours ?? 0) !== (b.get(id)?.ours ?? 0));
    L.push(`### ${t.changes(platform, prev, cur)}`, '');
    if (!changed.length) { L.push(t.noChange, ''); continue; }
    L.push(t.changesHead, '| --- | --- | --- | --- |');
    for (const id of changed) {
      const x = a.get(id); const y = b.get(id);
      L.push(`| ${id} | ${text.get(id) || ''} | ${x ? `${x.ours}/${x.of}` : t.none} | ${y ? `${y.ours}/${y.of}` : t.none}${(y?.ours ?? 0) > (x?.ours ?? 0) ? ' ⬆️' : ' ⬇️'} |`);
    }
    L.push('');
  }
  const { gaps } = findGaps({ rows, questions, drafts });
  L.push(`## ${t.gaps}`, '');
  if (!gaps.length) L.push(t.noGaps, '');
  else {
    L.push(t.gapsHead, '| --- | --- | --- | --- | --- |');
    for (const g of gaps) L.push(`| ${g.id} | ${g.question} | ${g.ours}/${g.of} | ${g.winners.map((w) => `${w.name} ${w.n}`).join(lang === 'zh' ? '，' : ', ')} | ${g.draft || t.none} |`);
    L.push('');
  }
  return L.join('\n');
}

export function prBody({ report, written, lang = 'zh' }) {
  const t = M[lang].pr; const L = [t.intro, '', `### ${t.drafts}`, ''];
  const ok = written.filter((w) => !w.failed);
  if (!ok.length) L.push(t.noDrafts);
  for (const w of ok) L.push(`- \`${w.file.split(/[\\/]/).slice(-3).join('/')}\` · ${w.id} · ${w.title}：${w.errors.length ? t.bad(w.errors.length) : w.status === 'confirmed' ? t.ok : 'draft'}`);
  for (const w of written.filter((x) => x.failed)) L.push(`- ${w.id} ❌ ${w.failed}`);
  L.push('', t.review, '', '---', '', report.replace(/^# .*\n/, ''));
  return L.join('\n');
}

// ---------------------------------------------------------------- GitHub Actions

const KEY_VARS = [...new Set(Object.values(PROVIDERS).map((p) => p.key).filter(Boolean))];

export function workflowYaml() {
  return `name: geo-autopilot
# GEO Doctor's weekly check: asks the AIs in geo/autopilot.json again, drafts articles for the open gaps from
# the confirmed fact card, writes a progress report, and opens a pull request for a person to review.
# Merging the pull request publishes the drafts marked confirmed (via the geo-site workflow, if you set it up).
# GEO 医生每周复查：按 geo/autopilot.json 重新采样，按已确认的事实卡给缺口写稿，写疗效报告，开 PR 给人审。
# 合并 PR 即同意发布标为 confirmed 的稿件（配合 geo-site 工作流自动上线事实站）。
on:
  schedule:
    - cron: '0 1 * * 1'   # every Monday 01:00 UTC / 每周一北京时间 09:00
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
jobs:
  weekly:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Sample, draft and report
        env:
${KEY_VARS.map((k) => `          ${k}: \${{ secrets.${k} }}`).join('\n')}
        run: npx -y -p github:Fangx-AI/geo-doctor geo-autopilot weekly --pr-body "$RUNNER_TEMP/pr.md"
      - name: Open a pull request
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          if [ -z "$(git status --porcelain -- geo)" ]; then echo "Nothing changed."; exit 0; fi
          DAY=$(date -u +%Y-%m-%d)
          BRANCH="geo-autopilot/$DAY-\${{ github.run_number }}"
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git checkout -b "$BRANCH"
          git add geo
          git commit -m "GEO weekly check $DAY"
          git push -u origin "$BRANCH"
          gh pr create --title "GEO 医生每周复查 / GEO weekly check: $DAY" --body-file "$RUNNER_TEMP/pr.md"
`;
}

export function configTemplate(lang = 'zh') {
  return JSON.stringify(lang === 'en'
    ? { brand: 'Your product, alias', competitors: 'Rival A/alias, Rival B', ai: 'openai,perplexity', times: 2, writer: 'openai', maxDrafts: 3, autoConfirm: true, lang: 'en' }
    : { brand: '你的品牌,别名', competitors: '竞品甲/别名,竞品乙', ai: 'deepseek,qwen', times: 2, writer: 'deepseek', maxDrafts: 3, autoConfirm: true, lang: 'zh' }, null, 2) + '\n';
}

// ---------------------------------------------------------------- CLI

const VALUE_FLAGS = ['--runs', '--questions', '--drafts', '--facts', '--ai', '--max', '--brand', '--out', '--config', '--pr-body', '--file', '--lang'];
export function parseArgs(argv) {
  const o = { cmd: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--json') o.json = true;
    else if (a === '--ready') o.ready = true;
    else if (VALUE_FLAGS.includes(a)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`);
      o[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
    } else if (a.startsWith('-')) o.unknown = a;
    else if (!o.cmd) o.cmd = a;
    else o.unknown = a;
  }
  return o;
}

function detectLang() {
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  return /^zh/i.test(env || Intl.DateTimeFormat().resolvedOptions().locale || '') ? 'zh' : 'en';
}

export async function main(argv, { env = process.env, out = console.log, err = console.error, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => new Date() } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { err(e.message); return 2; }
  let lang = o.lang === 'en' || o.lang === 'zh' ? o.lang : detectLang();
  let t = M[lang];
  if (o.version) { out(VERSION); return 0; }
  if (o.help || !o.cmd || o.unknown) { out(t.usage); return o.help ? 0 : 2; }
  if (!['gaps', 'write', 'report', 'weekly', 'action'].includes(o.cmd)) { err(t.unknownCmd(o.cmd)); out(t.usage); return 2; }

  if (o.cmd === 'action') {
    const file = o.file || join('.github', 'workflows', 'geo-autopilot.yml');
    if (existsSync(file)) { err(t.actionExists(file)); return 1; }
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, workflowYaml());
    const cfg = o.config || join('geo', 'autopilot.json'); let wroteCfg = null;
    if (!existsSync(cfg)) { mkdirSync(dirname(cfg), { recursive: true }); writeFileSync(cfg, configTemplate(lang)); wroteCfg = cfg; }
    out(t.actionDone(file, wroteCfg)); return 0;
  }

  let cfg = {};
  if (o.cmd === 'weekly') {
    const f = o.config || join('geo', 'autopilot.json');
    if (!existsSync(f)) { err(t.noConfig(f)); return 2; }
    try { cfg = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { err(t.badConfig(f, e.message)); return 2; }
    if (cfg.lang === 'zh' || cfg.lang === 'en') { lang = o.lang === 'en' || o.lang === 'zh' ? o.lang : cfg.lang; t = M[lang]; }
    for (const k of ['brand', 'ai']) if (!cfg[k]) { err(t.configNeed(k)); return 2; }
  }

  const geo = 'geo';
  const runsFile = o.runs || join(geo, 'runs.csv');
  const qFile = o.questions || join(geo, 'questions.csv');
  const draftsDir = o.drafts || join(geo, 'drafts');
  const factsFile = o.facts || join(geo, 'fact-card.yaml');
  const date = today(now());

  if (o.cmd === 'weekly') {
    const code = await probeMain(['run', qFile, '--ai', String(cfg.ai), '--brand', String(cfg.brand), ...(cfg.competitors ? ['--competitors', String(cfg.competitors)] : []),
      '--times', String(cfg.times || 2), '--runs', runsFile, '--lang', lang], { env, out, err, fetchImpl, sleep, now });
    if (code === 2) { err(t.probeFailed); return 2; }
  }

  if (!existsSync(runsFile)) { err(t.noRuns(runsFile)); return o.cmd === 'gaps' || o.cmd === 'report' ? 1 : 2; }
  if (!existsSync(qFile)) { err(t.noFile(qFile)); return 2; }
  const rows = loadRuns(runsFile);
  if (!rows.length) { err(t.noRuns(runsFile)); return 1; }
  const qRows = parseCsv(readFileSync(qFile, 'utf8'));
  const questions = loadQuestions(readFileSync(qFile, 'utf8')).asked;
  const priority = new Map(qRows.map((r) => [(r.id || r.ID || '').trim(), r['优先级'] || r.priority || '']));
  const drafts = existsSync(draftsDir) ? loadDrafts(resolve(draftsDir)) : [];

  if (o.cmd === 'gaps') {
    const { batches, gaps } = findGaps({ rows, questions, drafts, priority });
    if (o.json) { out(JSON.stringify({ batches, gaps }, null, 2)); return 0; }
    if (!gaps.length) { out(t.noGaps); return 0; }
    out(t.gapsTitle(gaps.length, batches)); for (const g of gaps) out(t.gapLine(g));
    return 0;
  }

  let written = [];
  if (o.cmd === 'write' || o.cmd === 'weekly') {
    if (!existsSync(factsFile)) { err(t.noFacts(factsFile)); return 2; }
    const factsRaw = readFileSync(factsFile, 'utf8');
    const facts = loadFacts(parseFactCard(factsRaw));
    if (!facts.confirmed.length) { err(t.fewFacts); return 2; }
    const brand = (o.brand || String(cfg.brand || '') || facts.confirmed.find((e) => e.id.toUpperCase() === 'B01')?.value || '').split(/[,，]/)[0].trim();
    if (!brand) { err(t.need('--brand')); return 2; }
    const spec = o.ai && o.cmd === 'write' ? o.ai : cfg.writer || String(cfg.ai || '').split(',')[0];
    if (!spec) { err(t.need('--ai')); return 2; }
    let writer;
    try { writer = resolveWriter(spec.trim(), env, t); } catch (e) { err(e.message); return 2; }
    const { gaps } = findGaps({ rows, questions, drafts, priority });
    if (!gaps.length) out(t.noGaps);
    else written = await writeDrafts({ gaps, facts, factsRaw, draftsDir, writer, brand, lang, max: parseInt(o.max || cfg.maxDrafts || '3', 10) || 3,
      ready: o.cmd === 'weekly' ? cfg.autoConfirm !== false : !!o.ready, out, err, fetchImpl, sleep, date });
    if (o.cmd === 'write') { if (o.json) out(JSON.stringify(written, null, 2)); return written.some((w) => w.failed) ? 1 : 0; }
  }

  // report (and the end of weekly)
  const after = existsSync(draftsDir) ? loadDrafts(resolve(draftsDir)) : [];
  const report = buildReport({ rows: loadRuns(runsFile), questions, drafts: after, lang, date });
  const outFile = o.out || join(geo, 'reports', `${date}.md`);
  mkdirSync(dirname(outFile), { recursive: true }); writeFileSync(outFile, report); out(t.wrote(outFile));
  if (o.prBody) { writeFileSync(o.prBody, prBody({ report, written, lang })); out(t.wrote(o.prBody)); }
  if (o.cmd === 'report' && !o.out) out('\n' + report);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href || /^geo-autopilot(\.mjs)?$/.test(basename(process.argv[1] || ''))) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 2; });
}
