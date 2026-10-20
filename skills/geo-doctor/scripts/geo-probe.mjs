#!/usr/bin/env node
// geo-probe · geo-doctor
// Ask AI models your question set through their APIs, record every answer, and count who gets recommended.
// 用 API 自动向各家 AI 提问你的问题集，存下每条回答，统计谁被推荐。零依赖。
//
//   DEEPSEEK_API_KEY=... npx -p github:Fangx-AI/geo-doctor geo-probe run geo/questions.csv --ai deepseek --brand "小鹿记账"
//
// API answers are not what people see in the apps (no login, often no web search, different system prompts),
// so every record is labelled 入口=API and kept in its own batch. Use it to track trends cheaply and often;
// confirm important conclusions with a manual sample in the app.
// API 回答和用户在 App 里看到的不一样（不登录、多数不联网、系统提示不同），所以每条记录都标"入口=API"，单独成批。
// 适合低成本、高频地看趋势；重要结论仍要在 App 里人工采样确认。
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERSION = '1.0.0';

// OpenAI-compatible chat endpoints unless kind is set. Models change often: override with --ai name:model.
// 默认都是 OpenAI 兼容接口。模型更新很快，可以用 --ai 名称:模型 指定。
export const PROVIDERS = {
  deepseek: { label: 'DeepSeek', base: 'https://api.deepseek.com/v1', key: 'DEEPSEEK_API_KEY', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  qwen: { label: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', key: 'DASHSCOPE_API_KEY', model: 'qwen-plus', search: true, extra: { enable_search: true, search_options: { forced_search: true } }, keyUrl: 'https://bailian.console.aliyun.com/' },
  kimi: { label: 'Kimi', base: 'https://api.moonshot.cn/v1', key: 'MOONSHOT_API_KEY', model: 'kimi-latest', search: true, builtinSearch: '$web_search', keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
  doubao: { label: '豆包', base: 'https://ark.cn-beijing.volces.com/api/v3', key: 'ARK_API_KEY', model: null, keyUrl: 'https://console.volcengine.com/ark' },
  hunyuan: { label: '腾讯混元（元宝）', base: 'https://api.hunyuan.cloud.tencent.com/v1', key: 'HUNYUAN_API_KEY', model: 'hunyuan-turbos-latest', keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', key: 'OPENAI_API_KEY', model: 'gpt-5-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  perplexity: { label: 'Perplexity', base: 'https://api.perplexity.ai', key: 'PERPLEXITY_API_KEY', model: 'sonar', search: true, keyUrl: 'https://www.perplexity.ai/settings/api' },
  gemini: { label: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'GEMINI_API_KEY', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey' },
  claude: { label: 'Claude', kind: 'anthropic', base: 'https://api.anthropic.com/v1', key: 'ANTHROPIC_API_KEY', model: 'claude-haiku-5-5', keyUrl: 'https://console.anthropic.com/settings/keys' },
  custom: { label: 'Custom', base: null, key: null, model: null },
};

export const RUNS_HEADER = ['run_id', '问题id', '轮次', '平台', '入口', '日期', '联网搜索', '登录', '地区', '是否提到我们', '位置', '描述是否正确',
  '错误内容', '引用来源', '备注', '批次', '问题集版本', '事实卡版本', '回答状态', '排除是否正确', '原文路径', '来源状态', '是否推荐我们', '推荐了谁'];
const VALID = new Set(['完整', '拒答']);

const M = {
  zh: {
    usage: `geo-probe ${VERSION} · GEO 医生的自动采样工具

用法：
  geo-probe run <questions.csv> --ai deepseek,qwen --brand "品牌,别名" [--competitors "竞品甲,竞品乙"]
  geo-probe report [runs.csv] [--batch 批次] [--questions questions.csv] [--out 文件]

run 选项：
  --ai 列表            要问的 AI，逗号分隔，可写 名称:模型。可选：${Object.keys(PROVIDERS).join('、')}
  --brand 名称          你的品牌名和别名，逗号分隔（必填）
  --competitors 名称    竞品名，逗号分隔；同一品牌的别名用 / 连接，例如 "随手记/Feidee,鲨鱼记账"
  --times N             每题问几次（默认 2）
  --only A,B            只问这些类型的题（默认全部）
  --batch 名称          批次名（默认 日期-平台-api-序号）
  --runs 文件           采样索引（默认 questions.csv 同目录的 runs.csv）
  --base-url 网址       改用这个接口地址（custom 必填，也可用于代理）
  --key-env 变量名      从这个环境变量读 API Key（custom 必填）
  --max-tokens N        每条回答最多多少 token（默认 1500）
  --concurrency N       同时发几个请求（默认 3）
  --dry-run             只显示计划，不发请求
  --json                输出 JSON
  --lang zh|en          输出语言（默认跟随系统）

API Key 只从环境变量读取，例如 DEEPSEEK_API_KEY、DASHSCOPE_API_KEY，不要写在命令里。
API 回答不等于用户在 App 里看到的回答：记录都标"入口=API"，单独成批，用来看趋势；重要结论请在 App 里人工采样确认。
"是否推荐我们""推荐了谁"是按关键词初判，只认得你列出的品牌，需要复核。`,
    unknownCmd: (c) => `不认识的命令：${c}`,
    need: (f) => `缺少 ${f}`,
    noFile: (f) => `找不到文件：${f}`,
    badAi: (a) => `不认识的 AI：${a}。可选：${Object.keys(PROVIDERS).join('、')}`,
    needModel: (a) => `${a} 需要指定模型，例如 --ai ${a}:模型名（豆包填方舟控制台里的模型 ID 或接入点 ID）`,
    noKey: (v, url) => `请先设置环境变量 ${v}${url ? `（在 ${url} 创建）` : ''}`,
    noQuestions: '问题集里没有可以问的题（模板占位题会被跳过）',
    skippedQ: (ids) => `跳过还没填写的模板题：${ids.join('、')}`,
    plan: (label, model, q, n, total) => `${label}（${model}）：${q} 题 × ${n} 次 = ${total} 次请求`,
    asking: (label, i, total) => `${label}：已完成 ${i}/${total}`,
    failed: (id, msg) => `第 ${id} 次失败：${msg}`,
    wrote: (f) => `已写入 ${f}`,
    apiNote: 'API 采样：不登录、多数不联网，结果和 App 内可能不同；推荐判定为关键词初判，需复核。',
    noRuns: (f) => `${f} 里还没有采样记录`,
    batchExists: (b) => `批次 ${b} 已经存在，换一个 --batch 名称（已有批次的原文不会被覆盖）`,
  },
  en: {
    usage: `geo-probe ${VERSION} · GEO Doctor's automatic sampler

Usage:
  geo-probe run <questions.csv> --ai deepseek,openai --brand "Brand,alias" [--competitors "Rival A,Rival B"]
  geo-probe report [runs.csv] [--batch name] [--questions questions.csv] [--out file]

run options:
  --ai list             AIs to ask, comma-separated, optionally name:model. Known: ${Object.keys(PROVIDERS).join(', ')}
  --brand names         your brand name and aliases, comma-separated (required)
  --competitors names   competitors, comma-separated; join aliases with /, e.g. "YNAB/You Need A Budget,Monarch"
  --times N             how many times to ask each question (default 2)
  --only A,B            only ask these question types (default: all)
  --batch name          batch name (default: date-platform-api-NN)
  --runs file           sampling log (default: runs.csv next to questions.csv)
  --base-url URL        use this endpoint instead (required for custom; also works for proxies)
  --key-env NAME        read the API key from this environment variable (required for custom)
  --max-tokens N        max tokens per answer (default 1500)
  --concurrency N       parallel requests (default 3)
  --dry-run             show the plan, send nothing
  --json                JSON output
  --lang zh|en          output language (default: system locale)

API keys are read only from environment variables such as OPENAI_API_KEY; never put them on the command line.
API answers are not what people see in the apps: records are labelled 入口=API and kept in their own batch to track trends.
Confirm important conclusions with a manual sample in the app. Recommendation flags are a keyword first pass that only
knows the brands you listed; review them.`,
    unknownCmd: (c) => `Unknown command: ${c}`,
    need: (f) => `Missing ${f}`,
    noFile: (f) => `File not found: ${f}`,
    badAi: (a) => `Unknown AI: ${a}. Known: ${Object.keys(PROVIDERS).join(', ')}`,
    needModel: (a) => `${a} needs a model, e.g. --ai ${a}:model-id`,
    noKey: (v, url) => `Set the ${v} environment variable first${url ? ` (create one at ${url})` : ''}`,
    noQuestions: 'No questions to ask (template placeholders are skipped)',
    skippedQ: (ids) => `Skipped unfilled template questions: ${ids.join(', ')}`,
    plan: (label, model, q, n, total) => `${label} (${model}): ${q} questions × ${n} = ${total} requests`,
    asking: (label, i, total) => `${label}: ${i}/${total} done`,
    failed: (id, msg) => `Run ${id} failed: ${msg}`,
    wrote: (f) => `Wrote ${f}`,
    apiNote: 'API sample: no login, usually no web search, may differ from the apps; recommendation flags are a keyword first pass, review them.',
    noRuns: (f) => `No sampling records in ${f} yet`,
    batchExists: (b) => `Batch ${b} already exists. Pick another --batch name (existing answers are never overwritten)`,
  },
};

// ---------------------------------------------------------------- CSV

export function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur); if (row.some((v) => v !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const csvCell = (v) => (/[",\r\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
export const csvLine = (vals) => vals.map(csvCell).join(',');

// Questions: id,类型,问题 (or id,type,question). Template placeholders like （用户原话…） are skipped.
export function loadQuestions(text) {
  const asked = []; const skipped = [];
  for (const r of parseCsv(text)) {
    const id = (r.id || r.ID || '').trim(); const question = (r['问题'] || r.question || '').trim();
    const type = (r['类型'] || r.type || '').trim();
    if (!id) continue;
    if (!question || /^[（(].*[）)]$/.test(question) || /待填写|TODO/.test(question)) { skipped.push(id); continue; }
    asked.push({ id, type, cls: (type.match(/^[A-Za-z]/) || [''])[0].toUpperCase(), question });
  }
  return { asked, skipped };
}

// ---------------------------------------------------------------- brand detection

// "随手记/Feidee,鲨鱼记账" → [{ name: '随手记', aliases: ['随手记', 'Feidee'] }, …]
export function parseBrands(s) {
  return String(s || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const aliases = x.split('/').map((a) => a.trim()).filter(Boolean);
    return { name: aliases[0], aliases };
  });
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const aliasRe = (a) => (/^[\x00-\x7F]+$/.test(a) ? new RegExp(`(?<![A-Za-z0-9])${esc(a)}(?![A-Za-z0-9])`, 'gi') : new RegExp(esc(a), 'g'));

const NEGATIVE = /不推荐|不建议|不适合|不太适合|不支持|不能满足|无法满足|缺点|已停(止|更)|停止(运营|维护|更新)|下架|避免|慎用|not recommend|wouldn'?t recommend|avoid|not (a )?(good )?fit|doesn'?t support|does not support|lacks?|discontinued|shut down/i;
const POSITIVE = /推荐|建议|可以(试试|考虑|选)|值得|首选|适合|不错|好用|recommend|suggest|consider|try|worth|great|good (choice|option|fit)|best for|go with/i;
const STRUCT = /^\s*(?:[-*•+]|\d+[.、)）]|#{1,6}\s|\|)/;

// One brand's verdict in one answer: 推荐 | 仅提及 | 否, plus where it first appears.
// A mention counts as a recommendation when one of its lines is a list item, heading, table row, bold, or uses
// recommending words, and that line has no negative cue. This is a first pass for a person or the skill to review.
export function judgeBrand(text, brand) {
  const lines = String(text).split(/\r?\n/);
  let first = -1; let offset = 0; let recommended = false; let mentioned = false;
  for (const line of lines) {
    for (const a of brand.aliases) {
      const re = aliasRe(a); const m = re.exec(line);
      if (!m) continue;
      mentioned = true;
      if (first < 0 || offset + m.index < first) first = offset + m.index;
      const bold = new RegExp(`\\*\\*[^*]*${esc(a)}[^*]*\\*\\*`, 'i').test(line);
      if (!NEGATIVE.test(line) && (STRUCT.test(line) || bold || POSITIVE.test(line))) recommended = true;
    }
    offset += line.length + 1;
  }
  return { verdict: recommended ? '推荐' : mentioned ? '仅提及' : '否', first };
}

// A brand the question already names ("X 和 Y 有什么区别？") is echoed in the answer's headings and tables, so it
// counts as mentioned at most, never as recommended.
export function analyse(text, ours, competitors, question = '') {
  const all = [...ours.length ? [{ name: ours[0].name, aliases: ours.flatMap((b) => b.aliases), self: true }] : [], ...competitors];
  const named = (b) => b.aliases.some((a) => aliasRe(a).test(question));
  const seen = all.map((b) => { const j = judgeBrand(text, b); return { ...b, ...j, verdict: j.verdict === '推荐' && named(b) ? '仅提及' : j.verdict }; })
    .filter((b) => b.first >= 0).sort((a, b) => a.first - b.first);
  const me = seen.find((b) => b.self);
  const recommended = seen.filter((b) => b.verdict === '推荐').map((b) => b.name);
  return {
    mentioned: me ? '是' : '否',
    recommended: me ? (me.verdict === '推荐' ? '推荐' : '仅提及') : '否',
    position: me ? String(seen.indexOf(me) + 1) : '',
    who: recommended,
    mentionedBrands: seen.map((b) => b.name),
  };
}

// ---------------------------------------------------------------- API calls

export async function ask(provider, { base, key, model, question, maxTokens, timeoutMs = 90000, fetchImpl = fetch }) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let res; let data;
    if (provider.kind === 'anthropic') {
      res = await fetchImpl(`${base.replace(/\/$/, '')}/messages`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: question }] }),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw httpError(res.status, data);
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const sources = (data.content || []).flatMap((b) => (b.citations || []).map((c) => c.url)).filter(Boolean);
      return { text, sources, truncated: data.stop_reason === 'max_tokens', model: data.model || model };
    }
    // Kimi searches through a built-in tool: the model asks for $web_search, we hand its arguments back unchanged
    // and Moonshot runs the search. Qwen searches with enable_search. Other providers get a plain chat request.
    const messages = [{ role: 'user', content: question }];
    const tools = provider.builtinSearch ? [{ type: 'builtin_function', function: { name: provider.builtinSearch } }] : undefined;
    let choice; let msg;
    for (let round = 0; ; round++) {
      res = await fetchImpl(`${base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages, ...(tools ? { tools } : {}), ...(provider.extra || {}) }),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw httpError(res.status, data);
      choice = (data.choices || [])[0] || {};
      msg = choice.message || {};
      const calls = (msg.tool_calls || []).filter((c) => c.function?.name === provider.builtinSearch);
      if (!tools || choice.finish_reason !== 'tool_calls' || !calls.length || round >= 4) break;
      messages.push(msg);
      for (const c of calls) messages.push({ role: 'tool', tool_call_id: c.id, name: c.function.name, content: c.function.arguments || '{}' });
    }
    const text = typeof msg.content === 'string' ? msg.content : (msg.content || []).map((p) => p.text || '').join('');
    const sources = [
      ...(data.citations || []),
      ...(data.search_results || []).map((r) => r.url),
      ...(msg.annotations || []).map((a) => a.url_citation?.url || a.url),
    ].filter((u) => typeof u === 'string' && u);
    return { text, sources: [...new Set(sources)], truncated: choice.finish_reason === 'length', model: data.model || model };
  } catch (e) {
    if (e.name === 'AbortError') { const x = new Error(`timeout after ${Math.round(timeoutMs / 1000)}s`); x.retry = true; throw x; }
    if (e.status === undefined && !e.retry) e.retry = true; // network errors
    throw e;
  } finally { clearTimeout(timer); }
}
function httpError(status, data) {
  const msg = data?.error?.message || data?.message || (typeof data?.error === 'string' ? data.error : '');
  const e = new Error(`HTTP ${status}${msg ? ' · ' + String(msg).slice(0, 200) : ''}`);
  e.status = status; e.retry = status === 429 || status >= 500; return e;
}

async function askWithRetry(provider, args, sleep) {
  const waits = [2000, 6000];
  for (let i = 0; ; i++) {
    try { return await ask(provider, args); } catch (e) {
      if (!e.retry || i >= waits.length) throw e;
      await sleep(waits[i]);
    }
  }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

// ---------------------------------------------------------------- report

const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u).trim(); } };
const splitList = (s) => String(s || '').split(/[;；]/).map((x) => x.trim()).filter(Boolean);
const ratio = (a, b) => (b ? `${a}/${b}` : 'NA');

// The five numbers from step 5, per batch × platform × entry. 第 5 步的五个数，按批次 × 平台 × 入口分组。
// types: question id → class; byBatch: batch → its own snapshot's map, which wins for that batch's rows.
export function summarize(rows, types = new Map(), byBatch = new Map()) {
  const groups = new Map();
  for (const r of rows) {
    const k = [r['批次'] || '未知', r['平台'] || '未知', r['入口'] || '未知'].join('\u0000');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()].map(([k, list]) => {
    const [batch, platform, entry] = k.split('\u0000');
    const own = byBatch.get(batch);
    const cls = (r) => ((own && own.get(r['问题id'])) || types.get(r['问题id']) || '').toUpperCase();
    const valid = list.filter((r) => VALID.has(r['回答状态']));
    const status = {};
    for (const r of list) { const s = r['回答状态'] || '未知'; status[s] = (status[s] || 0) + 1; }
    const A = valid.filter((r) => cls(r) === 'A'); const B = valid.filter((r) => cls(r) === 'B'); const C = valid.filter((r) => cls(r) === 'C');
    const board = new Map();
    for (const r of A) for (const b of new Set(splitList(r['推荐了谁']))) board.set(b, (board.get(b) || 0) + 1);
    const sources = new Map();
    for (const r of valid) for (const d of new Set(splitList(r['引用来源']).map(domainOf))) sources.set(d, (sources.get(d) || 0) + 1);
    return {
      batch, platform, entry, planned: list.length, valid: valid.length, status,
      untyped: valid.filter((r) => !cls(r)).length,
      recommend: { n: A.filter((r) => r['是否推荐我们'] === '推荐').length, of: A.length },
      mention: { n: A.filter((r) => r['是否提到我们'] === '是').length, of: A.length },
      correct: { n: B.filter((r) => r['描述是否正确'] === '对').length, of: B.length, unknown: B.filter((r) => !r['描述是否正确'] || r['描述是否正确'] === '未知').length },
      exclude: { n: C.filter((r) => r['排除是否正确'] === '对').length, of: C.length, unknown: C.filter((r) => !r['排除是否正确'] || r['排除是否正确'] === '未知').length },
      board: [...board.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n, of: A.length })),
      sources: [...sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([domain, n]) => ({ domain, n })),
    };
  });
}

export function formatSummary(groups, lang = 'zh') {
  const zh = lang === 'zh'; const out = [];
  for (const g of groups) {
    out.push(`## ${g.batch} · ${g.platform} · ${zh ? '入口' : 'entry'} ${g.entry}`, '');
    if (g.entry === 'API') out.push(`> ${M[lang].apiNote}`, '');
    const st = Object.entries(g.status).map(([k, v]) => `${k} ${v}`).join(zh ? '，' : ', ');
    out.push(zh ? `计划 ${g.planned} 次，有效回答 ${g.valid} 次（${st}）。` : `Planned ${g.planned}, valid ${g.valid} (${st}).`, '');
    out.push(zh ? '| 指标 | 结果 |' : '| Metric | Result |', '| --- | --- |',
      `| ${zh ? '**推荐率（A 类）**' : '**Recommended (A)**'} | ${ratio(g.recommend.n, g.recommend.of)} |`,
      `| ${zh ? '提及率（A 类）' : 'Mentioned (A)'} | ${ratio(g.mention.n, g.mention.of)} |`,
      `| ${zh ? '正确率（B 类）' : 'Correct (B)'} | ${ratio(g.correct.n, g.correct.of)}${g.correct.unknown ? (zh ? `，${g.correct.unknown} 次待核对` : `, ${g.correct.unknown} to review`) : ''} |`,
      `| ${zh ? '排除正确率（C 类）' : 'Correctly excluded (C)'} | ${ratio(g.exclude.n, g.exclude.of)}${g.exclude.unknown ? (zh ? `，${g.exclude.unknown} 次待核对` : `, ${g.exclude.unknown} to review`) : ''} |`, '');
    if (g.untyped) out.push(zh ? `另有 ${g.untyped} 次有效回答找不到题目类型，没有计入上表。` : `${g.untyped} valid answers have no question type and are not counted above.`, '');
    if (g.board.length) {
      out.push(zh ? '**竞品推荐榜（A 类）**' : '**Who gets recommended (A)**', '', zh ? '| 品牌 | 被推荐次数 |' : '| Brand | Times recommended |', '| --- | --- |',
        ...g.board.map((b) => `| ${b.name} | ${b.n}/${b.of} |`), '');
    }
    if (g.sources.length) out.push(zh ? '**引用来源（按回答去重）**' : '**Cited sources (per answer)**', '', ...g.sources.map((s) => `- ${s.domain}: ${s.n}`), '');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- CLI

function detectLang() {
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  const loc = env || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return /^zh/i.test(loc) ? 'zh' : 'en';
}
const VALUE_FLAGS = ['--ai', '--brand', '--competitors', '--times', '--only', '--batch', '--runs', '--base-url', '--key-env', '--max-tokens',
  '--concurrency', '--lang', '--questions', '--out', '--timeout'];
export function parseArgs(argv) {
  const o = { cmd: null, file: null, json: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '--json') o.json = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (VALUE_FLAGS.includes(a.split('=')[0])) {
      const [k, inline] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, argv[++i]];
      o[k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = inline;
    } else if (a.startsWith('-')) o.unknown = a;
    else if (!o.cmd) o.cmd = a;
    else if (!o.file) o.file = a;
  }
  return o;
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  const off = -d.getTimezoneOffset(); const sign = off >= 0 ? '+' : '-';
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, tz: `UTC${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}` };
}
const shortHash = (text) => createHash('sha1').update(text).digest('hex').slice(0, 8);

function rawFile(q, round, ctx, r, a) {
  const L = ['---', `run_id: ${ctx.batch}-${q.id}-${round}`, `平台: ${ctx.label}`, `模型: ${r?.model || ctx.model}`, '入口: API',
    `日期: ${ctx.when.date} ${ctx.when.time} ${ctx.when.tz}`, `联网搜索: ${ctx.search ? '是（接口自带搜索）' : '否'}`, '登录: 不适用（API 调用）', '地区: 未提供',
    '---', '', `# ${q.id} · 第 ${round} 次`, '', '## 问题', '', q.question, '', '## 回答', ''];
  if (r) L.push(r.text || '（空回答）'); else L.push(`（技术失败：${a.error}）`);
  L.push('', '## 来源', '');
  if (r?.sources.length) L.push(...r.sources.map((u) => `- ${u}`)); else L.push('（接口没有返回来源）');
  L.push('', '## 自动初判（需复核）', '', `- 是否提到我们：${a.mentioned}`, `- 是否推荐我们：${a.recommended}`, `- 位置：${a.position || '—'}`,
    `- 推荐了谁：${a.who.join('；') || '—'}`, `- 提到的已知品牌：${a.mentionedBrands.join('；') || '—'}`,
    '- 只认得 --brand 和 --competitors 里的品牌；回答里其他品牌请复核时补进 runs.csv 的“推荐了谁”。', '');
  return L.join('\n');
}

function nextBatch(runsDir, base) {
  for (let i = 1; ; i++) { const name = `${base}-${pad(i)}`; if (!existsSync(join(runsDir, name))) return name; }
}

export async function main(argv, { env = process.env, out = console.log, err = console.error, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => new Date() } = {}) {
  const o = parseArgs(argv);
  const lang = o.lang === 'en' || o.lang === 'zh' ? o.lang : detectLang();
  const t = M[lang];
  if (o.version) { out(VERSION); return 0; }
  if (o.help || !o.cmd || o.unknown) { out(t.usage); return o.help ? 0 : 2; }
  if (!['run', 'report'].includes(o.cmd)) { err(t.unknownCmd(o.cmd)); out(t.usage); return 2; }

  if (o.cmd === 'report') {
    const runsFile = resolve(o.file || join('geo', 'runs.csv'));
    if (!existsSync(runsFile)) { err(t.noFile(runsFile)); return 2; }
    let rows = parseCsv(readFileSync(runsFile, 'utf8'));
    if (o.batch) rows = rows.filter((r) => r['批次'] === o.batch);
    if (!rows.length) { err(t.noRuns(runsFile)); return 1; }
    const types = new Map(); const byBatch = new Map();
    const qFile = resolve(o.questions || join(dirname(runsFile), 'questions.csv'));
    if (existsSync(qFile)) for (const q of loadQuestions(readFileSync(qFile, 'utf8')).asked) types.set(q.id, q.cls);
    for (const b of new Set(rows.map((r) => r['批次']))) {
      const snap = join(dirname(runsFile), 'runs', b, 'questions.csv');
      if (b && existsSync(snap)) byBatch.set(b, new Map(loadQuestions(readFileSync(snap, 'utf8')).asked.map((q) => [q.id, q.cls])));
    }
    const groups = summarize(rows, types, byBatch);
    const md = formatSummary(groups, lang);
    if (o.out) { writeFileSync(o.out, md); out(t.wrote(o.out)); }
    out(o.json ? JSON.stringify(groups, null, 2) : md);
    return 0;
  }

  // run
  if (!o.file) { err(t.need('<questions.csv>')); return 2; }
  const qFile = resolve(o.file);
  if (!existsSync(qFile)) { err(t.noFile(o.file)); return 2; }
  if (!o.ai) { err(t.need('--ai')); return 2; }
  if (!o.brand) { err(t.need('--brand')); return 2; }
  const qText = readFileSync(qFile, 'utf8');
  const { asked, skipped } = loadQuestions(qText);
  const only = o.only ? new Set(o.only.toUpperCase().split(/[,，]/).map((x) => x.trim())) : null;
  const questions = only ? asked.filter((q) => only.has(q.cls)) : asked;
  if (skipped.length) err(t.skippedQ(skipped));
  if (!questions.length) { err(t.noQuestions); return 2; }
  const ours = parseBrands(o.brand); const competitors = parseBrands(o.competitors);
  const times = Math.max(1, parseInt(o.times || '2', 10) || 2);
  const maxTokens = parseInt(o.maxTokens || '1500', 10) || 1500;
  const concurrency = Math.max(1, parseInt(o.concurrency || '3', 10) || 3);
  const timeoutMs = (parseInt(o.timeout || '90', 10) || 90) * 1000;

  const targets = [];
  for (const spec of o.ai.split(/[,，]/).map((x) => x.trim()).filter(Boolean)) {
    const [name, ...rest] = spec.split(':'); const p = PROVIDERS[name.toLowerCase()];
    if (!p) { err(t.badAi(name)); return 2; }
    const model = rest.join(':') || p.model;
    const base = o.baseUrl || p.base;
    const keyVar = o.keyEnv || p.key;
    if (!model) { err(t.needModel(name)); return 2; }
    if (!base) { err(t.need('--base-url')); return 2; }
    if (!keyVar) { err(t.need('--key-env')); return 2; }
    targets.push({ name: name.toLowerCase(), p, model, base, keyVar });
  }
  const missing = targets.filter((x) => !env[x.keyVar]);
  if (missing.length && !o.dryRun) { for (const x of missing) err(t.noKey(x.keyVar, x.p.keyUrl)); return 2; }

  const geoDir = dirname(qFile);
  const runsFile = resolve(o.runs || join(geoDir, 'runs.csv'));
  const runsDir = join(dirname(runsFile), 'runs');
  const factFile = join(geoDir, 'fact-card.yaml');
  const qVersion = `questions@${shortHash(qText)}`;
  const fVersion = existsSync(factFile) ? `fact-card@${shortHash(readFileSync(factFile, 'utf8'))}` : '未知';
  const when = stamp(now());
  const results = [];

  // An explicit --batch never reuses an existing folder, so archived answers are never overwritten.
  if (o.batch) {
    const seen = new Map();
    for (const x of targets) {
      let name = targets.length > 1 ? `${o.batch}-${x.name}` : o.batch;
      const n = (seen.get(name) || 0) + 1; seen.set(name, n);
      if (n > 1) name += `-${n}`;
      x.batch = name;
    }
    const taken = targets.filter((x) => existsSync(join(runsDir, x.batch)));
    if (taken.length) { for (const x of taken) err(t.batchExists(x.batch)); return 2; }
  }

  for (const x of targets) {
    const total = questions.length * times;
    out(t.plan(x.p.label === 'Custom' ? x.model : x.p.label, x.model, questions.length, times, total));
    if (o.dryRun) continue;
    const batch = x.batch || nextBatch(runsDir, `${when.date}-${x.name}-api`);
    const dir = join(runsDir, batch);
    mkdirSync(dir, { recursive: true });
    copyFileSync(qFile, join(dir, 'questions.csv'));
    if (existsSync(factFile)) copyFileSync(factFile, join(dir, 'fact-card.yaml'));
    const label = x.p.label === 'Custom' ? x.model : x.p.label;
    writeFileSync(join(dir, 'batch.md'), [`# ${batch}`, '', `- 平台：${label}`, `- 模型：${x.model}`, '- 入口：API（geo-probe 自动采样）', `- 接口：${x.base}`,
      `- 日期：${when.date} ${when.time} ${when.tz}`, `- 联网搜索：${x.p.search ? '是（接口自带搜索）' : '否'}`, `- 计划：${questions.length} 题 × ${times} 次 = ${total} 次`,
      `- 问题集版本：${qVersion}`, `- 事实卡版本：${fVersion}`, `- 我们：${ours.map((b) => b.aliases.join('/')).join('，')}`,
      `- 竞品：${competitors.map((b) => b.aliases.join('/')).join('，') || '未提供'}`, '', `> ${M.zh.apiNote}`, ''].join('\n'));

    const jobs = questions.flatMap((q) => Array.from({ length: times }, (_, i) => ({ q, round: i + 1 })));
    const rows = new Array(jobs.length); let done = 0;
    const ctx = { batch, label, model: x.model, search: !!x.p.search, when };
    await pool(jobs, concurrency, async ({ q, round }, k) => {
      let r = null; let error = '';
      try { r = await askWithRetry(x.p, { base: x.base, key: env[x.keyVar] || '', model: x.model, question: q.question, maxTokens, timeoutMs, fetchImpl }, sleep); } catch (e) { error = e.message; err(t.failed(`${q.id}-${round}`, error)); }
      const a = r && r.text ? analyse(r.text, ours, competitors, q.question) : { mentioned: '未知', recommended: '未知', position: '', who: [], mentionedBrands: [] };
      const status = !r ? '技术失败' : !r.text ? '不完整' : r.truncated ? '不完整' : '完整';
      const rel = join('runs', batch, `${q.id}-${round}.md`);
      writeFileSync(join(dirname(runsFile), rel), rawFile(q, round, ctx, r, { ...a, error }));
      const row = {
        run_id: `${batch}-${q.id}-${round}`, '问题id': q.id, '轮次': round, '平台': label, '入口': 'API', '日期': when.date,
        '联网搜索': x.p.search ? '是' : '否', '登录': '不适用', '地区': '未提供', '是否提到我们': a.mentioned, '位置': a.position || (a.mentioned === '是' ? '正文提及' : ''),
        '描述是否正确': q.cls === 'B' ? '未知' : (a.mentioned === '是' ? '未知' : '未涉及'), '错误内容': '', '引用来源': (r?.sources || []).map(domainOf).join(';'),
        '备注': `geo-probe 自动采样，模型 ${r?.model || x.model}；推荐判定为关键词初判，需复核${error ? `；${error}` : ''}`,
        '批次': batch, '问题集版本': qVersion, '事实卡版本': fVersion, '回答状态': status, '排除是否正确': q.cls === 'C' ? '未知' : '不适用',
        '原文路径': rel.split('\\').join('/'), '来源状态': r?.sources.length ? '已提供' : (r ? '界面无来源' : '未知'),
        '是否推荐我们': a.recommended, '推荐了谁': a.who.join(';'),
      };
      rows[k] = row;
      done++; if (done % 5 === 0 || done === jobs.length) err(t.asking(label, done, jobs.length));
    });

    mkdirSync(dirname(runsFile), { recursive: true });
    const existing = existsSync(runsFile) ? readFileSync(runsFile, 'utf8') : '';
    if (!existing.trim()) writeFileSync(runsFile, '\uFEFF' + csvLine(RUNS_HEADER) + '\n');
    else if (!/\n$/.test(existing)) appendFileSync(runsFile, '\n');
    appendFileSync(runsFile, rows.map((r) => csvLine(RUNS_HEADER.map((h) => r[h])) + '\n').join(''));
    const types = new Map(questions.map((q) => [q.id, q.cls]));
    const [g] = summarize(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))), types);
    const md = `# ${batch}\n\n${formatSummary([g], lang)}`;
    writeFileSync(join(dir, 'summary.md'), md);
    results.push({ batch, dir, summary: g });
    if (!o.json) { out(''); out(formatSummary([g], lang)); out(t.wrote(join(dir, 'summary.md'))); out(t.wrote(runsFile)); }
  }
  if (o.json) out(JSON.stringify(o.dryRun ? targets.map((x) => ({ ai: x.name, model: x.model, requests: questions.length * times, keyEnv: x.keyVar, keySet: !!env[x.keyVar] })) : results, null, 2));
  return results.some((r) => r.summary.valid === 0) ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href || /^geo-probe(\.mjs)?$/.test(basename(process.argv[1] || ''))) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 2; });
}
