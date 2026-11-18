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
import { useEnvProxy } from './proxy.mjs';

export const VERSION = '1.8.0';

// OpenAI-compatible chat endpoints unless kind is set. Models change often: override with --ai name:model.
// 默认都是 OpenAI 兼容接口。模型更新很快，可以用 --ai 名称:模型 指定。
export const PROVIDERS = {
  deepseek: { label: 'DeepSeek', base: 'https://api.deepseek.com/v1', key: 'DEEPSEEK_API_KEY', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  qwen: { label: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', key: 'DASHSCOPE_API_KEY', model: 'qwen-plus', search: true, extra: { enable_search: true, search_options: { forced_search: true } }, keyUrl: 'https://bailian.console.aliyun.com/' },
  kimi: { label: 'Kimi', base: 'https://api.moonshot.cn/v1', key: 'MOONSHOT_API_KEY', model: 'kimi-latest', keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
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
  geo-probe check <questions.csv> [--brand "品牌,别名"]
  geo-probe matrix <questions.csv>
  geo-probe keywords <keywords.csv> [--questions questions.csv] [--brand "品牌,别名"]

check 检查问题基线本身：题量、类型配比、核心题、重复、诱导、A 类题里的品牌名、缺限定条件、证据来源。
有 fail 时退出码 1；warn 不影响退出码，但要写清为什么保留。

matrix 把题目排成「场景 × 旅程」矩阵（探索/选型/对比/口碑），空格就是下一步该写的地方。

keywords 检查关键词表：意图是不是四类标准意图、场景有没有选型词和口碑词、聚类有没有跨段、
有没有落地页、证据等级；加上 --questions 还能反查「哪些词一题都没有」。词是题的上一层。

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
  geo-probe check <questions.csv> [--brand "Brand,alias"]
  geo-probe matrix <questions.csv>
  geo-probe keywords <keywords.csv> [--questions questions.csv] [--brand "Brand,alias"]

check audits the question set itself: size, type mix, gauge questions, duplicates, leading wording, brand names in discovery questions,
missing constraints, and where each question came from. Exit 1 when something must be fixed; warnings keep exit 0 but need a reason.

matrix lays the set out as scenario × journey (探索/选型/对比/口碑); the empty cells are what to write next.

keywords audits the table one layer above the questions: the four standard intents, whether each scenario has a
commercial and a brand word, clusters that span stages, missing landing pages, grades; with --questions it also
reports which words never became a question.

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

// ---------------------------------------------------------------- question baseline

// Shapes are how the question is asked, independent of industry. Two questions can share a type
// (both A) and still test different things, because a comparison question and a discovery question
// make the engine behave differently.
export const QUESTION_SHAPES = ['认知定义', '品类发现', '选型推荐', '直接对比', '找替代', '预算约束', '实施集成', '排错', '合规风险', '本地时效'];

// Journeys are the stage of the decision a question sits in. A set that only covers one stage
// measures one stage, and averaging across stages hides both the strength and the hole: a store can
// win every 口碑 question and appear in none of the 选型 ones that actually bring the customer.
export const JOURNEYS = ['探索', '选型', '对比', '口碑'];
const LEADING = /请(帮我)?推荐|推荐一下|最好的|最强的|最值得|哪家最好|排名第一|一定要选/i;
const QUALIFIER = /[\d一二三四五六七八九十]+\s*(人|元|块|万|千|个|天|小时|月|年|万)|预算|以内|以下|左右|不超过|便宜|低价|性价比|省钱|不花钱|小团队|初创|中小企业|大企业|个人|家用|免费|开源|离线|不用联网|断网|私有化|合规|等保|跨境|出海|微信|小程序|iOS|Android|Windows|macOS|远程|上门|线下|附近|本地|北京|上海|广州|深圳|杭州|成都|武汉|南京|西安|重庆|苏州|天津|豆包|元宝|DeepSeek|ChatGPT|GPT|Kimi|通义|千问|文心|Perplexity|Gemini|Claude|Copilot|AI 搜索|AI 助手|[\u4e00-\u9fa5]{2,8}(区|县|镇|商圈|大学城|路|街|地铁站)/i;
const CORE = /核心|仪表|gauge/i;
const TARGET = { A: 0.4, B: 0.3, C: 0.2, D: 0.1 };

const normQ = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const bigrams = (s) => {
  const t = normQ(s); const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
};
const overlap = (a, b) => {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
};
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

// What each stage can tell you once you have sampled it. This is why the stages are kept apart:
// a 探索 answer that cites your page and a 选型 answer that ranks you third are different evidence,
// and averaging them produces a number nobody can act on.
export const JOURNEY_MEANING = {
  探索: { says: '你的内容有没有被引用', empty: 'AI 讲品类时很难提到你' },
  选型: { says: '进不进名单、排第几', empty: '客户真正在挑的时候看不到你' },
  对比: { says: '对位胜率', empty: '分不清被顺带一提还是被正面对比' },
  口碑: { says: '情感倾向与负面拦截', empty: '不知道 AI 怎么描述你，负面也没人拦' },
};

// The scenario × journey grid. Two questions in the same cell test the same thing; two questions in
// different cells test different things, which is why a flat count hides where the set is empty.
export function buildMatrix(text) {
  const rows = [];
  parseCsv(text).forEach((r, i) => {
    const question = (r['问题'] || r.question || '').trim();
    if (!question || /^[（(].*[）)]$/.test(question) || /待填写|TODO/.test(question)) return;
    rows.push({
      id: (r.id || r.ID || '').trim() || `#${i + 1}`,
      scenario: (r['场景'] || r.scenario || '').trim(),
      journey: (r['旅程'] || r.journey || '').trim(),
      question,
    });
  });
  const scenarios = []; const cells = {}; const loose = [];
  for (const q of rows) {
    if (!q.scenario) { if (q.journey) loose.push(q); continue; }
    if (!JOURNEYS.includes(q.journey)) { loose.push(q); continue; }
    if (!scenarios.includes(q.scenario)) scenarios.push(q.scenario);
    cells[q.scenario] ||= Object.fromEntries(JOURNEYS.map((j) => [j, []]));
    cells[q.scenario][q.journey].push(q.id);
  }
  const gaps = []; let filled = 0; let total = 0;
  for (const s of scenarios) {
    for (const j of JOURNEYS) {
      total++;
      if ((cells[s][j] || []).length) filled++;
      else gaps.push({ scenario: s, journey: j });
    }
  }
  return { rows, scenarios, cells, gaps, loose, filled, total };
}

// Audit a question set before it is sampled. Everything here is mechanical on purpose: a question
// you cannot check is a question you cannot defend in a report.
export function checkQuestions(text, { brands = [], lang = 'zh' } = {}) {
  const zh = lang !== 'en';
  const names = brands.filter(Boolean);
  const rows = []; const templates = [];
  parseCsv(text).forEach((r, i) => {
    const q = {
      line: i + 2,
      id: (r.id || r.ID || '').trim() || `#${i + 1}`,
      type: ((r['类型'] || r.type || '').trim().match(/^[A-Za-z]/) || [''])[0].toUpperCase(),
      shape: (r['形状'] || r.shape || '').trim(),
      question: (r['问题'] || r.question || '').trim(),
      criteria: (r['判定标准'] || r.criteria || '').trim(),
      facts: (r['对应事实'] || r.facts || '').trim(),
      priority: (r['优先级'] || r.priority || '').trim(),
      sourceKind: (r['来源类型'] || r.sourceKind || r.source_kind || '').trim(),
      source: (r['来源'] || r.source || '').trim(),
      evidence: (r['证据等级'] || r.evidence || '').trim(),
      scenario: (r['场景'] || r.scenario || '').trim(),
      journey: (r['旅程'] || r.journey || '').trim(),
    };
    if (!q.question) return;
    if (/^[（(].*[）)]$/.test(q.question) || /待填写|TODO/.test(q.question)) { templates.push(q.id); return; }
    rows.push(q);
  });

  const fails = []; const warns = []; let passed = 0;
  const F = (id, msg) => fails.push({ id, msg });
  const W = (id, msg) => warns.push({ id, msg });
  const total = rows.length;
  const byType = { A: 0, B: 0, C: 0, D: 0 };
  for (const q of rows) if (q.type in byType) byType[q.type]++;
  const core = rows.filter((q) => CORE.test(q.priority));

  if (!total) {
    F('', zh ? '没有问题：模板占位题会被跳过，至少写 12 道真问题' : 'No questions. Template placeholders are skipped; write at least 12 real ones');
    return { rows, templates, byType, core: 0, fails, warns, passed };
  }
  if (total < 12) F('', zh ? `只有 ${total} 道题。少于 12 道时，一次回答的波动就能改变结论` : `Only ${total} questions. Below 12, one answer can flip the conclusion`);
  else if (total > 40) W('', zh ? `${total} 道题偏多：先确认你能真的问完（题量 × 平台 × 次数）` : `${total} questions is a lot. Check you can actually run them (questions × platforms × repeats)`);
  else passed++;

  for (const q of rows) {
    if (!(q.type in byType)) F(q.id, zh ? `类型「${q.type || '空'}」不认识，只能是 A/B/C/D` : `Unknown type "${q.type || 'empty'}"; use A/B/C/D`);
    else passed++;
  }

  // Quota: a set that only contains questions you can win measures your optimism, not your visibility.
  for (const [k, target] of Object.entries(TARGET)) {
    const share = total ? byType[k] / total : 0;
    const diff = Math.round((share - target) * 100) / 100;
    if (Math.abs(diff) <= 0.1) { passed++; continue; }
    const line = zh
      ? `${k} 类占 ${pct(byType[k], total)}%，目标约 ${Math.round(target * 100)}%（±10 个百分点）`
      : `${k} is ${pct(byType[k], total)}% of the set; target about ${Math.round(target * 100)}% (±10 points)`;
    if (k === 'C' && share < 0.15) F('', line);
    else W('', line);
  }
  if (!byType.C) F('', zh ? '一道 C 类题都没有：全是“你能赢”的题集，测出来的数字没有意义' : 'No C questions: a set of only winnable questions produces a meaningless number');

  // Gauge questions: the only ones a trend may be reported on.
  if (!core.length) W('', zh ? '没有标出核心题（优先级=核心）：复查时只能换题，前后就没法比' : 'No gauge questions marked (priority=核心); retests would not be comparable');
  else if (core.length < 12) W('', zh ? `核心题 ${core.length} 道，建议 12–18 道：太少时单题波动会盖过真实变化` : `${core.length} gauge questions; 12–18 is steadier, one question can swing a small set`);
  else if (core.length > 20) W('', zh ? `核心题 ${core.length} 道偏多，复查成本高，建议压到 18 道左右` : `${core.length} gauge questions is expensive to rerun; about 18 is a good ceiling`);
  else passed++;

  // Every question needs a verdict rule, otherwise the answer cannot be scored the same way twice.
  for (const q of rows) {
    if (q.criteria) { passed++; continue; }
    W(q.id, zh ? '没有判定标准：什么算提到、什么算推荐，两次采样会判得不一样' : 'No verdict rule: what counts as mentioned or recommended will be judged differently next time');
  }

  // Provenance: a question with no source cannot be defended as "users really ask this".
  for (const q of rows) {
    if (q.source) { passed++; continue; }
    W(q.id, zh ? '没有来源：无法证明这是用户真会问的问题' : 'No source: nothing shows a real user would ask this');
  }
  const madeUp = rows.filter((q) => q.evidence === '5' || /构造/.test(q.sourceKind));
  if (madeUp.length && madeUp.length / total > 0.4) {
    W('', zh ? `${madeUp.length}/${total} 道题是构造的（超过 40%）：报告里必须写明这是假设题集，不能当用户需求分布` : `${madeUp.length}/${total} questions are constructed (>40%); label the set as hypothetical, not a picture of real demand`);
  }
  for (const q of rows) {
    if (!q.evidence) continue;
    if (!/^[1-5]$/.test(q.evidence)) F(q.id, zh ? `证据等级「${q.evidence}」无效，只能是 1–5` : `Evidence level "${q.evidence}" must be 1–5`);
    else passed++;
  }
  const coreWeak = core.filter((q) => q.evidence === '5' || /构造/.test(q.sourceKind));
  if (core.length && coreWeak.length / core.length > 0.5) {
    W('', zh ? `核心题里 ${coreWeak.length}/${core.length} 道是构造的：仪表题最好至少一半来自真实语料或平台追问` : `${coreWeak.length}/${core.length} gauge questions are constructed; at least half should come from real material or engine follow-ups`);
  }

  // Discovery questions (A) must not name the brand: that turns it into a "does it recognise the word" test.
  for (const q of rows) {
    if (q.type !== 'A' || !names.length) continue;
    const hit = names.find((n) => normQ(q.question).includes(normQ(n)));
    if (hit) F(q.id, zh ? `A 类题里出现了自己的品牌名「${hit}」：A 类测的是“没听过你时会不会被推荐”，带品牌名就变成认词测试` : `Discovery question names your brand "${hit}"; it then tests word recognition, not recommendation`);
    else passed++;
  }

  // Leading wording: "the best X" or "please recommend X" tells the engine the answer.
  for (const q of rows) {
    if (LEADING.test(q.question)) W(q.id, zh ? '带有诱导措辞（最好的/请推荐…）：AI 会直接给榜单，测不出自然浮现' : 'Leading wording (the best / please recommend): the engine just returns a list, so organic appearance is untested');
    else passed++;
  }

  // Constraints: without a budget, size, region or platform, every set collapses into the same generic list.
  // How-to questions are exempt: breadth is the point there — "how do I stop screws backing out" is
  // not asked by a smaller company or a larger one, it is asked by anyone with that problem.
  const LIST_SEEKING = new Set(['品类发现', '选型推荐', '找替代', '直接对比']);
  for (const q of rows) {
    if (q.type !== 'A') continue;
    if (q.shape && !LIST_SEEKING.has(q.shape)) { passed++; continue; }
    if (QUALIFIER.test(q.question)) { passed++; continue; }
    W(q.id, zh ? 'A 类题没有限定条件（预算/规模/地区/平台）：无限定的问题通常得到泛榜答案，对你的品牌没有区分度' : 'Discovery question has no constraint (budget, size, region, platform); unconstrained questions return the same generic list for everyone');
  }

  // Duplicates: the same intent asked twice is one data point, not two.
  const seen = new Map();
  for (const q of rows) {
    const key = normQ(q.question);
    if (!key) continue;
    if (seen.has(key)) F(q.id, zh ? `与 ${seen.get(key)} 完全重复（去掉标点和空格后相同）：同一道题问两次不是两个数据点` : `Duplicate of ${seen.get(key)} after stripping punctuation: the same question twice is still one data point`);
    else seen.set(key, q.id);
  }
  const grams = rows.map((q) => ({ q, g: bigrams(q.question) }));
  for (let i = 0; i < grams.length; i++) {
    for (let j = i + 1; j < grams.length; j++) {
      if (normQ(grams[i].q.question) === normQ(grams[j].q.question)) continue;
      const sim = overlap(grams[i].g, grams[j].g);
      if (sim >= 0.85) W(grams[j].q.id, zh ? `与 ${grams[i].q.id} 高度相似（${Math.round(sim * 100)}%）：同一意图换措辞算一道题，不算两道` : `Nearly the same as ${grams[i].q.id} (${Math.round(sim * 100)}%); rephrasings of one intent are one question`);
    }
  }

  // Shape coverage: how the question is asked decides whether the engine searches at all.
  const shaped = core.length ? core : rows;
  const shapes = new Set(shaped.map((q) => q.shape).filter(Boolean));
  if (!shapes.size) W('', zh ? '没有填「形状」列：无法检查问法覆盖（可以补上，见 references/question-shapes.md）' : 'No shape column: question coverage cannot be checked (see references/question-shapes.md)');
  else if (shapes.size < 5) W('', zh ? `只用了 ${shapes.size} 种问法：建议至少 5 种，因为不同问法测到的机制不同` : `Only ${shapes.size} shapes; at least 5 is safer because different shapes exercise different machinery`);
  else passed++;

  // Coverage: a set can pass every check above and still be blind to half the decision. Counts are
  // per scenario × journey cell, so the holes are visible before sampling, not after.
  const matrix = buildMatrix(text);
  for (const q of rows) {
    if (q.journey && !q.scenario) W(q.id, zh ? '填了旅程但没有场景：落不进矩阵，看不出它替哪个格子挡缺口' : 'Journey without a scenario: it fits no cell, so it is unclear which gap it covers');
    else if (q.scenario && !q.journey) W(q.id, zh ? '填了场景但没有旅程：落不进矩阵，看不出它在决策的哪一段' : 'Scenario without a journey: it fits no cell, so the decision stage is unclear');
    else if (q.journey && !JOURNEYS.includes(q.journey)) W(q.id, zh ? `旅程「${q.journey}」不认识，只能是 ${JOURNEYS.join(' / ')}` : `Unknown journey "${q.journey}"; use ${JOURNEYS.join(' / ')}`);
    else if (q.scenario) passed++;
  }
  if (!matrix.scenarios.length) {
    W('', zh ? '没有填「场景」「旅程」两列：只能检查题量，看不出哪个格子是空的（做法见 references/scenario-matrix.md）' : 'No scenario/journey columns: only the count can be checked, not which cell is empty (see references/scenario-matrix.md)');
  } else {
    const seen = new Set();
    for (const s of matrix.scenarios) {
      const row = matrix.cells[s];
      for (const j of JOURNEYS) if (row[j].length) seen.add(j);
      // A scenario that only ever gets compared or reviewed is a legitimate shape: those questions
      // are asked about a brand, not about a product line, so they do not need a 选型 stage. Only a
      // scenario that opens at 探索 has to carry the customer through to 选型.
      if (row['探索'].length && !row['选型'].length) {
        W(s, zh ? `场景「${s}」没有选型题：客户真正在挑的时候看不到你，前面几格写得再好也接不住` : `Scenario "${s}" has no selection question: nothing catches the customer while they are choosing`);
      }
    }
    for (const j of JOURNEYS) {
      if (seen.has(j)) continue;
      W('', zh ? `整个题集没有${j}题：${JOURNEY_MEANING[j].empty}` : `No ${j} questions at all: ${JOURNEY_MEANING[j].empty}`);
    }
    const ratio = matrix.total ? matrix.filled / matrix.total : 0;
    if (ratio < 0.4) {
      W('', zh ? `矩阵只覆盖 ${matrix.filled}/${matrix.total} 格（${Math.round(ratio * 100)}%）：先补选型那一列，再补对比` : `The matrix covers ${matrix.filled}/${matrix.total} cells (${Math.round(ratio * 100)}%); fill the selection column first, then comparison`);
    } else passed++;
  }

  return { rows, templates, byType, core: core.length, shapes: [...shapes], matrix, fails, warns, passed };
}

export function renderCheck(result, file, lang = 'zh') {
  const zh = lang !== 'en';
  const { rows, byType, core, shapes = [], fails, warns, passed, templates } = result;
  const total = rows.length;
  const L = [];
  L.push(zh ? `问题基线体检 · ${file}` : `Question baseline audit · ${file}`, '');
  L.push(zh ? `- 题量：${total} 道（核心 ${core} 道）` : `- Questions: ${total} (gauge ${core})`);
  L.push(zh
    ? `- 类型：A ${byType.A}（${pct(byType.A, total)}%）· B ${byType.B}（${pct(byType.B, total)}%）· C ${byType.C}（${pct(byType.C, total)}%）· D ${byType.D}（${pct(byType.D, total)}%）`
    : `- Types: A ${byType.A} (${pct(byType.A, total)}%) · B ${byType.B} (${pct(byType.B, total)}%) · C ${byType.C} (${pct(byType.C, total)}%) · D ${byType.D} (${pct(byType.D, total)}%)`);
  if (shapes.length) L.push(zh ? `- 问法：${shapes.join(' / ')}` : `- Shapes: ${shapes.join(' / ')}`);
  if (result.matrix && result.matrix.scenarios.length) {
    const m = result.matrix;
    L.push(zh ? `- 矩阵：${m.scenarios.length} 个场景 × ${JOURNEYS.length} 段，覆盖 ${m.filled}/${m.total} 格` : `- Matrix: ${m.scenarios.length} scenarios × ${JOURNEYS.length} stages, ${m.filled}/${m.total} cells filled`);
    if (m.gaps.length) {
      const head = m.gaps.slice(0, 6).map((g) => `${g.scenario}·${g.journey}`).join('、');
      L.push(zh ? `- 空格：${head}${m.gaps.length > 6 ? ` 等 ${m.gaps.length} 处（geo-probe matrix 看全表）` : ''}` : `- Empty cells: ${head}${m.gaps.length > 6 ? ` and ${m.gaps.length - 6} more (run geo-probe matrix)` : ''}`);
    }
  }
  if (templates.length) L.push(zh ? `- 跳过未填写的模板题：${templates.join('、')}` : `- Skipped unfilled template rows: ${templates.join(', ')}`);
  L.push('');
  if (fails.length) {
    L.push(zh ? '**fail（先改这些，现在采样出来的数不能用）**' : '**fail (fix these first; sampling now would produce unusable numbers)**', '');
    for (const f of fails) L.push(`- ${f.id ? `[${f.id}] ` : ''}${f.msg}`);
    L.push('');
  }
  if (warns.length) {
    L.push(zh ? '**warn（可以保留，但要在报告里写清为什么）**' : '**warn (allowed, but say why in the report)**', '');
    for (const w of warns) L.push(`- ${w.id ? `[${w.id}] ` : ''}${w.msg}`);
    L.push('');
  }
  L.push(fails.length
    ? (zh ? `结果：${fails.length} 项必须改，${warns.length} 项提醒。改完再跑一次。` : `${fails.length} must fix, ${warns.length} to review. Run again after fixing.`)
    : (zh ? `结果：没有必须改的问题，${warns.length} 项提醒。可以开始采样。` : `No blockers, ${warns.length} to review. Ready to sample.`));
  if (passed) L.push(zh ? `（另有 ${passed} 项通过）` : `(${passed} checks passed)`);
  return L.join('\n');
}

// The grid on its own, for deciding what to write next. Empty cells are the work order; they are
// not errors, because a scenario may legitimately have nothing to say in a stage.
export function renderMatrix(matrix, lang = 'zh') {
  const zh = lang !== 'en';
  const L = [];
  if (!matrix.scenarios.length) {
    L.push(zh ? '没有可排的矩阵：题集里没有同时填了「场景」和「旅程」的题。' : 'Nothing to lay out: no question has both a scenario and a journey.');
    if (matrix.loose.length) L.push(zh ? `有 ${matrix.loose.length} 道题缺其中一列：${matrix.loose.map((q) => q.id).join('、')}` : `${matrix.loose.length} questions are missing one of the two: ${matrix.loose.map((q) => q.id).join(', ')}`);
    return L.join('\n');
  }
  L.push(zh ? `问题矩阵 · ${matrix.scenarios.length} 个场景 × ${JOURNEYS.length} 段旅程 · 覆盖 ${matrix.filled}/${matrix.total} 格` : `Question matrix · ${matrix.scenarios.length} scenarios × ${JOURNEYS.length} stages · ${matrix.filled}/${matrix.total} cells`, '');
  L.push(`| ${zh ? '场景' : 'Scenario'} | ${JOURNEYS.join(' | ')} |`);
  L.push(`|${'---|'.repeat(JOURNEYS.length + 1)}`);
  for (const s of matrix.scenarios) {
    const row = matrix.cells[s];
    L.push(`| ${s} | ${JOURNEYS.map((j) => (row[j].length ? row[j].join(' ') : '—')).join(' | ')} |`);
  }
  L.push('');
  L.push(zh ? '**每段能读出什么**' : '**What each stage can tell you**');
  for (const j of JOURNEYS) {
    const mine = matrix.scenarios.reduce((n, s) => n + matrix.cells[s][j].length, 0);
    L.push(zh ? `- ${j}（${mine} 道）：看${JOURNEY_MEANING[j].says}${mine ? '' : `；现在一条都没有，${JOURNEY_MEANING[j].empty}`}` : `- ${j} (${mine}): ${JOURNEY_MEANING[j].says}${mine ? '' : `; empty now, so ${JOURNEY_MEANING[j].empty}`}`);
  }
  L.push('');
  if (matrix.gaps.length) {
    const selection = matrix.gaps.filter((g) => g.journey === '选型');
    const comparison = matrix.gaps.filter((g) => g.journey === '对比');
    L.push(zh ? '**先补这些**' : '**Fill these first**');
    for (const g of selection) L.push(zh ? `- ${g.scenario} · 选型：${JOURNEY_MEANING['选型'].empty}` : `- ${g.scenario} · selection: ${JOURNEY_MEANING['选型'].empty}`);
    for (const g of comparison) L.push(zh ? `- ${g.scenario} · 对比：${JOURNEY_MEANING['对比'].empty}` : `- ${g.scenario} · comparison: ${JOURNEY_MEANING['对比'].empty}`);
    const rest = matrix.gaps.filter((g) => g.journey !== '选型' && g.journey !== '对比');
    if (rest.length) L.push(zh ? `- 其余 ${rest.length} 格：${rest.map((g) => `${g.scenario} · ${g.journey}`).join('、')}` : `- ${rest.length} more: ${rest.map((g) => `${g.scenario} / ${g.journey}`).join(', ')}`);
    L.push('');
  }
  if (matrix.loose.length) L.push(zh ? `落不进矩阵的题：${matrix.loose.map((q) => q.id).join('、')}（缺场景或旅程，或旅程写错）` : `Outside the matrix: ${matrix.loose.map((q) => q.id).join(', ')} (missing or invalid scenario/journey)`);
  return L.join('\n');
}

// ---------------------------------------------------------------- keyword layer

// The four intents are the taxonomy every search tool already uses (informational, navigational,
// commercial investigation, transactional), so a keyword table can move between tools without
// re-translation. Chinese labels are what the report prints; the aliases let an exported file keep
// the English names it came with.
export const KEYWORD_INTENTS = ['信息型', '商业调研型', '交易型', '导航型'];
export const INTENT_ALIASES = new Map([
  ['information', '信息型'], ['informational', '信息型'], ['信息', '信息型'],
  ['commercial', '商业调研型'], ['commercial investigation', '商业调研型'], ['commercial-investigation', '商业调研型'], ['调研', '商业调研型'],
  ['transactional', '交易型'], ['transaction', '交易型'], ['交易', '交易型'],
  ['navigational', '导航型'], ['navigation', '导航型'], ['branded', '导航型'], ['品牌', '导航型'],
]);
const INTENT_JOURNEYS = { 信息型: ['探索'], 商业调研型: ['选型', '对比'], 交易型: ['选型', '对比'], 导航型: ['口碑'] };
const intentOf = (s) => INTENT_ALIASES.get(String(s || '').trim().toLowerCase()) || (KEYWORD_INTENTS.includes(String(s || '').trim()) ? String(s).trim() : '');

// Keywords are the layer above questions: a question is a sentence built on one of these words. The
// table is checked on its own (does every scenario have a word a buyer would type when choosing?)
// and against questions.csv (does every word actually get asked?).
export function checkKeywords(text, { brands = [], questions = '', lang = 'zh' } = {}) {
  const zh = lang !== 'en';
  const rows = parseCsv(text).filter((r) => (r['关键词'] || r.keyword || r['词'] || '').trim());
  const fails = []; const warns = []; let passed = 0;
  const fail = (id, msg) => fails.push({ id, msg });
  const warn = (id, msg) => warns.push({ id, msg });
  const seen = new Map();
  const byScenario = new Map(); const byIntent = { 信息型: 0, 商业调研型: 0, 交易型: 0, 导航型: 0 };
  const clusters = new Map();
  const noPage = [];
  const list = [];
  const brandNames = brands.map((b) => b.name).filter(Boolean);

  for (const r of rows) {
    const word = (r['关键词'] || r.keyword || r['词'] || '').trim();
    const id = (r.id || r.ID || word).trim();
    const scenario = (r['场景'] || r.scenario || '').trim();
    const intent = intentOf(r['意图'] || r.intent);
    const journey = (r['旅程'] || r.journey || '').trim();
    const cluster = (r['聚类'] || r.cluster || '').trim();
    const page = (r['落地页'] || r.landing || r.page || '').trim();
    const source = (r['来源'] || r.source || '').trim();
    const grade = (r['证据等级'] || r.grade || '').trim();
    list.push({ id, word, scenario, intent, journey, cluster, page });

    const key = normQ(word);
    if (seen.has(key)) fail(id, zh ? `关键词「${word}」重复（与 ${seen.get(key)} 相同）` : `Duplicate keyword "${word}" (same as ${seen.get(key)})`);
    else seen.set(key, id);

    if (!scenario) warn(id, zh ? `「${word}」没填场景：不知道它属于哪条业务线，覆盖率就算不出来` : `"${word}" has no scenario`);
    else byScenario.set(scenario, (byScenario.get(scenario) || 0) + 1);

    if (!intent) fail(id, zh ? `意图「${r['意图'] || r.intent || ''}」不是四类之一：信息型 / 商业调研型 / 交易型 / 导航型` : `Intent must be one of the four standard types`);
    else byIntent[intent] += 1;

    const allowed = intent ? INTENT_JOURNEYS[intent] : null;
    if (journey && !JOURNEYS.includes(journey)) warn(id, zh ? `旅程「${journey}」不是 探索 / 选型 / 对比 / 口碑` : `Unknown journey "${journey}"`);
    if (journey && allowed && !allowed.includes(journey)) warn(id, zh ? `「${word}」是${intent}词，却标成${journey}段：${intent}词一般落在 ${allowed.join(' / ')}` : `Intent ${intent} usually belongs to ${allowed.join(' / ')}`);

    if (!cluster) warn(id, zh ? `「${word}」没填聚类：同一批搜索结果（SERP 重叠）才算一组，不分组会把同一个需求数成好几个` : `"${word}" has no cluster`);
    else {
      if (!clusters.has(cluster)) clusters.set(cluster, []);
      clusters.get(cluster).push({ id, journey });
    }

    if (!page) noPage.push(word);
    else if (/^(缺|无|none|todo)$/i.test(page)) noPage.push(word);
    if (!source) warn(id, zh ? `「${word}」没填来源：分不清是客户原话还是自己编的` : `"${word}" has no source`);
    if (grade && !/^[1-5]$/.test(grade)) fail(id, zh ? `证据等级「${grade}」必须是 1–5` : `Grade "${grade}" must be 1–5`);
    if (!grade) warn(id, zh ? `「${word}」没填证据等级（1 客户原话 / 2 社区原话 / 3 平台追问 / 4 公开数据 / 5 构造）` : `"${word}" has no grade`);

    if (brandNames.length && intent === '信息型' && brandNames.some((b) => word.includes(b))) fail(id, zh ? `「${word}」是信息型词却带品牌名：信息型要求买家还不知道你` : `Informational keyword "${word}" contains the brand`);
    if (intent === '导航型' && brandNames.length && !brandNames.some((b) => word.includes(b))) warn(id, zh ? `「${word}」标成导航型却没有品牌名：导航型是直接找某个牌子` : `Navigational keyword "${word}" has no brand name`);
    if (!fails.some((f) => f.id === id) && !warns.some((w) => w.id === id)) passed += 1;
  }

  if (!rows.length) {
    fail('—', zh ? '关键词表是空的：先有关键词，才有问题' : 'Keyword table is empty: keywords come before questions');
  }

  // One cluster is one need. A cluster whose words sit in different stages means the grouping is
  // wrong, because those words would be answered by different pages.
  for (const [name, items] of clusters) {
    const stages = new Set(items.map((i) => i.journey).filter(Boolean));
    if (stages.size > 1) warn(name, zh ? `聚类「${name}」里跨了 ${[...stages].join(' / ')}：同一组词应该落在同一段` : `Cluster "${name}" spans ${[...stages].join(' / ')}`);
  }

  // Every scenario needs at least one word a buyer types when choosing; otherwise the scenario is
  // only being explored, never converted. Brand words are exempt: they sit above the scenarios.
  const scenarios = [...new Set(rows.map((r) => (r['场景'] || r.scenario || '').trim()).filter(Boolean))];
  for (const s of scenarios) {
    const words = list.filter((k) => k.scenario === s);
    const business = words.filter((k) => k.intent !== '导航型');
    const choosing = business.filter((k) => k.intent === '商业调研型' || k.intent === '交易型');
    if (business.length && !choosing.length) warn(s, zh ? `场景「${s}」没有商业调研型或交易型词：只探索不选型，客户真在挑的时候看不到你` : `Scenario "${s}" has no commercial or transactional keyword`);
  }
  if (!list.some((k) => k.intent === '导航型')) warn('—', zh ? '整表没有导航型词：AI 被问「这牌子怎么样」时没有词可挂' : 'No navigational keyword: nothing to attach "is this brand any good" to');
  if (noPage.length) {
    const head = noPage.slice(0, 8).join('、');
    warn('—', zh
      ? `${noPage.length} 个词没有落地页：${head}${noPage.length > 8 ? ' 等' : ''}——AI 要引用的时候没有页面可引，这是内容任务清单`
      : `${noPage.length} keywords have no landing page: ${head}${noPage.length > 8 ? ' …' : ''}`);
  }

  // Cross-file coverage, both directions.
  const gaps = []; const orphans = [];
  if (questions) {
    const asked = loadQuestions(questions).asked;
    const qRows = parseCsv(questions).filter((r) => (r['问题'] || r.question || '').trim());
    const textOf = qRows.map((r) => `${r['关键词'] || r.keyword || ''}\u0000${r['问题'] || r.question || ''}`).join('\n');
    for (const k of list) {
      const key = normQ(k.word);
      const hit = textOf.split('\n').some((line) => {
        const [kw, q] = line.split('\u0000');
        return normQ(kw) === key || (q || '').includes(k.word);
      });
      if (!hit) gaps.push(k.word);
    }
    const declared = new Set(list.map((k) => normQ(k.word)));
    for (const r of qRows) {
      const kw = (r['关键词'] || r.keyword || '').trim();
      if (kw && !declared.has(normQ(kw))) orphans.push(`${r.id || ''}·${kw}`);
    }
    if (gaps.length) warn('—', zh ? `这些词一题都没有：${gaps.join('、')}` : `Keywords with no question: ${gaps.join(', ')}`);
    if (orphans.length) warn('—', zh ? `这些题挂的词不在词表里：${orphans.join('、')}` : `Questions carrying undeclared keywords: ${orphans.join(', ')}`);
    if (!asked.length) warn('—', zh ? '题集里没有已填写的题，覆盖率无法核对' : 'No filled questions to check coverage against');
    if (!qRows.some((r) => (r['关键词'] || r.keyword || '').trim())) warn('—', zh ? '题集没有「关键词」列：只能按整句包含来判断覆盖，容易漏' : 'No 关键词 column in the questions file');
  }

  return { rows: list, scenarios, clusters: [...clusters.keys()], byIntent, fails, warns, passed, gaps, orphans, matched: Boolean(questions) };
}

export function renderKeywords(result, file, lang = 'zh') {
  const zh = lang !== 'en';
  const { rows, scenarios, clusters, byIntent, fails, warns, passed, gaps } = result;
  const L = [];
  L.push(zh ? `关键词表体检 · ${file}` : `Keyword table audit · ${file}`, '');
  L.push(zh ? `- 词量：${rows.length} 个（${scenarios.length} 个场景、${clusters.length} 个聚类）` : `- Keywords: ${rows.length} (${scenarios.length} scenarios, ${clusters.length} clusters)`);
  L.push(zh
    ? `- 意图：信息型 ${byIntent['信息型']} · 商业调研型 ${byIntent['商业调研型']} · 交易型 ${byIntent['交易型']} · 导航型 ${byIntent['导航型']}`
    : `- Intents: informational ${byIntent['信息型']} · commercial ${byIntent['商业调研型']} · transactional ${byIntent['交易型']} · navigational ${byIntent['导航型']}`);
  if (result.matched) L.push(zh ? `- 与题集对齐：${gaps.length ? `${gaps.length} 个词没有题` : '每个词都有题'}` : `- Against questions: ${gaps.length ? `${gaps.length} keywords unasked` : 'every keyword is asked'}`);
  L.push('');
  if (fails.length) {
    L.push(zh ? '**fail（先改这些，词表错了后面全错）**' : '**fail (fix first; a wrong table poisons everything after)**', '');
    for (const f of fails) L.push(`- ${f.id && f.id !== '—' ? `[${f.id}] ` : ''}${f.msg}`);
    L.push('');
  }
  if (warns.length) {
    L.push(zh ? '**warn（可以保留，但要在报告里写清为什么）**' : '**warn (allowed, but say why in the report)**', '');
    for (const w of warns) L.push(`- ${w.id && w.id !== '—' ? `[${w.id}] ` : ''}${w.msg}`);
    L.push('');
  }
  L.push(fails.length
    ? (zh ? `结果：${fails.length} 项必须改，${warns.length} 项提醒。改完再跑一次。` : `${fails.length} must fix, ${warns.length} to review.`)
    : (zh ? `结果：没有必须改的问题，${warns.length} 项提醒。可以把词写成题了。` : `No blockers, ${warns.length} to review. Ready to write questions.`));
  if (passed) L.push(zh ? `（另有 ${passed} 项通过）` : `(${passed} checks passed)`);
  return L.join('\n');
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
    // Qwen searches the web through enable_search (extra); other providers get a plain chat request.
    res = await fetchImpl(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: question }], ...(provider.extra || {}) }),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(res.status, data);
    const choice = (data.choices || [])[0] || {};
    const msg = choice.message || {};
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
  if (!['run', 'report', 'check', 'matrix', 'keywords'].includes(o.cmd)) { err(t.unknownCmd(o.cmd)); out(t.usage); return 2; }

  if (o.cmd === 'keywords') {
    if (!o.file) { err(t.need('<keywords.csv>')); return 2; }
    const file = resolve(o.file);
    if (!existsSync(file)) { err(t.noFile(o.file)); return 2; }
    const qFile = o.questions ? resolve(o.questions) : '';
    if (qFile && !existsSync(qFile)) { err(t.noFile(o.questions)); return 2; }
    const brands = (o.brand || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean).map((n) => ({ name: n, aliases: [n] }));
    const result = checkKeywords(readFileSync(file, 'utf8'), { brands, questions: qFile ? readFileSync(qFile, 'utf8') : '', lang });
    if (o.json) { out(JSON.stringify({ ...result, rows: result.rows.length }, null, 2)); return result.fails.length ? 1 : 0; }
    out(renderKeywords(result, o.file, lang));
    return result.fails.length ? 1 : 0;
  }

  if (o.cmd === 'matrix') {
    if (!o.file) { err(t.need('<questions.csv>')); return 2; }
    const file = resolve(o.file);
    if (!existsSync(file)) { err(t.noFile(o.file)); return 2; }
    const matrix = buildMatrix(readFileSync(file, 'utf8'));
    if (o.json) { out(JSON.stringify(matrix, null, 2)); return 0; }
    out(renderMatrix(matrix, lang));
    return 0;
  }

  if (o.cmd === 'check') {
    if (!o.file) { err(t.need('<questions.csv>')); return 2; }
    const file = resolve(o.file);
    if (!existsSync(file)) { err(t.noFile(o.file)); return 2; }
    const brands = (o.brand || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    const result = checkQuestions(readFileSync(file, 'utf8'), { brands, lang });
    if (o.json) { out(JSON.stringify({ ...result, rows: result.rows.length }, null, 2)); return result.fails.length ? 1 : 0; }
    out(renderCheck(result, o.file, lang));
    return result.fails.length ? 1 : 0;
  }

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
  useEnvProxy();
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 2; });
}
