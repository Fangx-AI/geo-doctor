// Tests for cli/geo-probe.mjs. Run: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCsv, loadQuestions, parseBrands, judgeBrand, analyse, summarize, main, ask, PROVIDERS, checkQuestions, QUESTION_SHAPES, buildMatrix } from '../cli/geo-probe.mjs';

const QUESTIONS = `id,类型,问题,判定标准,对应事实,优先级,来源类型,来源
Q01,A 不带品牌的推荐,有没有不用联网也能用的记账 App？,提到并推荐我们,F01,核心,用户原话,客服记录
Q02,B 品牌事实,小鹿记账高级版多少钱？,价格与事实卡一致,P01,核心,构造,
Q03,C 不适合场景,"多人实时共享账本用什么 App？",不推荐我们,F01,核心,构造,
Q04,A 不带品牌的推荐,（用户原话，不含你的品牌名）,,,,待填写,待填写
`;

const cleanup = [];
after(() => { for (const d of cleanup) rmSync(d, { recursive: true, force: true }); });
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'geo-probe-')); cleanup.push(dir);
  mkdirSync(join(dir, 'geo'));
  writeFileSync(join(dir, 'geo', 'questions.csv'), QUESTIONS);
  writeFileSync(join(dir, 'geo', 'fact-card.yaml'), '基本信息:\n  - 编号: F01\n    状态: 已确认\n');
  return join(dir, 'geo');
};
const run = async (argv, opts = {}) => {
  const out = []; const err = [];
  const code = await main([...argv, '--lang', 'zh'], { out: (s) => out.push(s), err: (s) => err.push(s), sleep: async () => {}, ...opts });
  return { code, out: out.join('\n'), err: err.join('\n') };
};

test('csv: quoted commas, quotes, newlines and BOM', () => {
  const rows = parseCsv('﻿a,b\n"x, y","say ""hi""\nthere"\r\n1,2\n');
  assert.deepEqual(rows, [{ a: 'x, y', b: 'say "hi"\nthere' }, { a: '1', b: '2' }]);
});

test('questions: template placeholders are skipped, class comes from the type', () => {
  const { asked, skipped } = loadQuestions(QUESTIONS);
  assert.deepEqual(asked.map((q) => [q.id, q.cls]), [['Q01', 'A'], ['Q02', 'B'], ['Q03', 'C']]);
  assert.deepEqual(skipped, ['Q04']);
});

test('brand verdicts: list items and recommending words count, negatives and passing mentions do not', () => {
  const b = parseBrands('小鹿记账/Fawn Budget')[0];
  assert.equal(judgeBrand('推荐这几款：\n1. **小鹿记账**：离线可用', b).verdict, '推荐');
  assert.equal(judgeBrand('I would recommend Fawn Budget for offline use.', b).verdict, '推荐');
  assert.equal(judgeBrand('小鹿记账不适合多人共享账本。', b).verdict, '仅提及');
  assert.equal(judgeBrand('有人提到过小鹿记账。', b).verdict, '仅提及');
  assert.equal(judgeBrand('Try fawn budgeting tips.', b).verdict, '否');
  // ASCII aliases match whole words only
  assert.equal(judgeBrand('Use Monarchy.', parseBrands('Monarch')[0]).verdict, '否');
});

test('analyse: a brand the question names is mentioned at most, never recommended', () => {
  const text = '| 维度 | **GEO 医生** | **GEOFlow** |\n1. **GEO 医生**：诊断\n2. **GEOFlow**：生产\n3. **Profound**：值得一试';
  const a = analyse(text, parseBrands('GEO 医生/geo-doctor'), parseBrands('GEOFlow,Profound'), 'GEO 医生和 GEOFlow 有什么区别？');
  assert.equal(a.mentioned, '是');
  assert.equal(a.recommended, '仅提及');
  assert.deepEqual(a.who, ['Profound']);
  assert.equal(analyse(text, parseBrands('GEO 医生'), [], '有哪些 GEO 工具？').recommended, '推荐');
});

test('analyse: position and who is recommended follow the order of appearance', () => {
  const a = analyse('1. 随手记：功能全\n2. 小鹿记账：离线可用\n\n鲨鱼记账不推荐，已停止更新。', parseBrands('小鹿记账'), parseBrands('随手记/Feidee,鲨鱼记账'));
  assert.equal(a.mentioned, '是');
  assert.equal(a.recommended, '推荐');
  assert.equal(a.position, '2');
  assert.deepEqual(a.who, ['随手记', '小鹿记账']);
  assert.deepEqual(a.mentionedBrands, ['随手记', '小鹿记账', '鲨鱼记账']);
});

test('run: asks every question N times, saves originals, appends runs.csv, writes a summary', async () => {
  const geo = setup();
  const calls = [];
  let n = 0;
  const srv = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const j = JSON.parse(body); calls.push({ url: req.url, auth: req.headers.authorization, model: j.model, q: j.messages[0].content });
    n++;
    if (n === 1) { res.writeHead(429, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'slow down' } })); }
    const q = j.messages[0].content;
    const content = q.includes('不用联网') ? '推荐：\n1. 小鹿记账，离线可用\n2. 随手记' : q.includes('多少钱') ? '小鹿记账高级版 30 元/年。' : '推荐随手记，小鹿记账不适合多人共享。';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: 'mock-1', choices: [{ message: { content }, finish_reason: 'stop' }], citations: ['https://www.zhihu.com/question/1'] }));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const base = `http://127.0.0.1:${srv.address().port}/v1`;
    const r = await run(['run', join(geo, 'questions.csv'), '--ai', 'deepseek', '--brand', '小鹿记账', '--competitors', '随手记', '--times', '2', '--base-url', base],
      { env: { DEEPSEEK_API_KEY: 'sk-test' }, now: () => new Date(2026, 9, 16, 10, 0) });
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /跳过还没填写的模板题：Q04/);
    assert.equal(calls.length, 7); // 3 questions × 2 + one retry after 429
    assert.ok(calls.every((c) => c.url === '/v1/chat/completions' && c.auth === 'Bearer sk-test' && c.model === 'deepseek-chat'));

    const batch = '2026-10-16-deepseek-api-01';
    const dir = join(geo, 'runs', batch);
    assert.deepEqual(readdirSync(dir).sort(), ['Q01-1.md', 'Q01-2.md', 'Q02-1.md', 'Q02-2.md', 'Q03-1.md', 'Q03-2.md', 'batch.md', 'fact-card.yaml', 'questions.csv', 'summary.md']);
    const raw = readFileSync(join(dir, 'Q01-1.md'), 'utf8');
    assert.match(raw, /入口: API/);
    assert.match(raw, /1\. 小鹿记账，离线可用/);
    assert.match(raw, /https:\/\/www\.zhihu\.com\/question\/1/);

    const rows = parseCsv(readFileSync(join(geo, 'runs.csv'), 'utf8'));
    assert.equal(rows.length, 6);
    const q1 = rows.find((x) => x.run_id === `${batch}-Q01-1`);
    assert.equal(q1['入口'], 'API');
    assert.equal(q1['是否推荐我们'], '推荐');
    assert.equal(q1['推荐了谁'], '小鹿记账;随手记');
    assert.equal(q1['引用来源'], 'zhihu.com');
    assert.equal(q1['原文路径'], `runs/${batch}/Q01-1.md`);
    const q3 = rows.find((x) => x.run_id === `${batch}-Q03-1`);
    assert.equal(q3['是否推荐我们'], '仅提及');
    assert.equal(q3['排除是否正确'], '未知');

    const summary = readFileSync(join(dir, 'summary.md'), 'utf8');
    assert.match(summary, /\*\*推荐率（A 类）\*\* \| 2\/2/);
    assert.match(summary, /\| 随手记 \| 2\/2 \|/);
    assert.match(summary, /API 采样/);

    // A second run gets a new batch and keeps the old records.
    const again = await run(['run', join(geo, 'questions.csv'), '--ai', 'deepseek', '--brand', '小鹿记账', '--times', '1', '--only', 'A', '--base-url', base],
      { env: { DEEPSEEK_API_KEY: 'sk-test' }, now: () => new Date(2026, 9, 16, 11, 0) });
    assert.equal(again.code, 0, again.err);
    assert.ok(existsSync(join(geo, 'runs', '2026-10-16-deepseek-api-02', 'Q01-1.md')));
    assert.equal(parseCsv(readFileSync(join(geo, 'runs.csv'), 'utf8')).length, 7);

    // report reads the whole log, including the question types from the snapshot.
    const rep = await run(['report', join(geo, 'runs.csv'), '--batch', batch]);
    assert.equal(rep.code, 0, rep.err);
    assert.match(rep.out, /计划 6 次，有效回答 6 次/);
    assert.match(rep.out, /提及率（A 类） \| 2\/2/);
  } finally { srv.close(); }
});

test('run: failures are recorded as technical failures, never as "not mentioned"', async () => {
  const geo = setup();
  const srv = createServer((req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'bad key' } })); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const r = await run(['run', join(geo, 'questions.csv'), '--ai', 'kimi', '--brand', '小鹿记账', '--times', '1', '--base-url', `http://127.0.0.1:${srv.address().port}/v1`, '--batch', 'b1'],
      { env: { MOONSHOT_API_KEY: 'x' } });
    assert.equal(r.code, 1);
    assert.match(r.err, /HTTP 401 · bad key/);
    const rows = parseCsv(readFileSync(join(geo, 'runs.csv'), 'utf8'));
    assert.ok(rows.every((x) => x['回答状态'] === '技术失败' && x['是否提到我们'] === '未知' && x['是否推荐我们'] === '未知'));
    assert.match(readFileSync(join(geo, 'runs', 'b1', 'summary.md'), 'utf8'), /有效回答 0 次（技术失败 3）/);
  } finally { srv.close(); }
});

test('run: anthropic messages API and a truncated answer', async () => {
  const geo = setup();
  const seen = [];
  const srv = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    seen.push({ url: req.url, key: req.headers['x-api-key'], version: req.headers['anthropic-version'] });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: 'claude-test', stop_reason: 'max_tokens', content: [{ type: 'text', text: 'You could try 小鹿记账 and' }] }));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const r = await run(['run', join(geo, 'questions.csv'), '--ai', 'claude', '--only', 'A', '--times', '1', '--brand', '小鹿记账', '--base-url', `http://127.0.0.1:${srv.address().port}/v1`, '--batch', 'c1'],
      { env: { ANTHROPIC_API_KEY: 'ak' } });
    assert.equal(r.code, 1, 'no complete answers, so exit 1');
    assert.deepEqual(seen[0], { url: '/v1/messages', key: 'ak', version: '2023-06-01' });
    const [row] = parseCsv(readFileSync(join(geo, 'runs.csv'), 'utf8'));
    assert.equal(row['回答状态'], '不完整');
    assert.equal(row['是否推荐我们'], '推荐');
  } finally { srv.close(); }
});

test('run: keys come only from the environment; dry run needs none', async () => {
  const geo = setup();
  const r = await run(['run', join(geo, 'questions.csv'), '--ai', 'deepseek,qwen', '--brand', 'x'], { env: {} });
  assert.equal(r.code, 2);
  assert.match(r.err, /DEEPSEEK_API_KEY/);
  assert.match(r.err, /DASHSCOPE_API_KEY/);
  const d = await run(['run', join(geo, 'questions.csv'), '--ai', 'deepseek,qwen', '--brand', 'x', '--dry-run'], { env: {} });
  assert.equal(d.code, 0, d.err);
  assert.match(d.out, /DeepSeek（deepseek-chat）：3 题 × 2 次 = 6 次请求/);
  assert.ok(!existsSync(join(geo, 'runs')));
  const m = await run(['run', join(geo, 'questions.csv'), '--ai', 'doubao', '--brand', 'x', '--dry-run'], { env: {} });
  assert.equal(m.code, 2);
  assert.match(m.err, /doubao 需要指定模型/);
});

test('summarize: valid answers only, brands counted once per answer, NA for empty denominators', () => {
  const rows = [
    { '批次': 'b', '平台': 'p', '入口': 'App', '问题id': 'Q1', '回答状态': '完整', '是否推荐我们': '推荐', '是否提到我们': '是', '推荐了谁': '甲;我们;甲', '引用来源': 'zhihu.com;zhihu.com' },
    { '批次': 'b', '平台': 'p', '入口': 'App', '问题id': 'Q1', '回答状态': '技术失败', '是否推荐我们': '未知', '是否提到我们': '未知' },
    { '批次': 'b', '平台': 'p', '入口': 'App', '问题id': 'Q1', '回答状态': '拒答', '是否推荐我们': '否', '是否提到我们': '否' },
  ];
  const [g] = summarize(rows, new Map([['Q1', 'A']]));
  assert.equal(g.planned, 3); assert.equal(g.valid, 2);
  assert.deepEqual(g.recommend, { n: 1, of: 2 });
  assert.deepEqual(g.board, [{ name: '甲', n: 1, of: 2 }, { name: '我们', n: 1, of: 2 }]);
  assert.deepEqual(g.sources, [{ domain: 'zhihu.com', n: 1 }]);
  assert.equal(g.correct.of, 0);
});

test('run: an existing --batch is refused, duplicate providers get distinct batches, CSV without final newline stays intact', async () => {
  const geo = setup();
  const srv = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: '推荐小鹿记账' }, finish_reason: 'stop' }] })); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    writeFileSync(join(geo, 'runs.csv'), 'run_id,问题id,回答状态,批次\nmanual-Q01-1,Q01,完整,manual');
    const args = ['run', join(geo, 'questions.csv'), '--only', 'A', '--times', '1', '--brand', '小鹿记账', '--base-url', `http://127.0.0.1:${srv.address().port}/v1`];
    const env = { DEEPSEEK_API_KEY: 'k' };
    assert.equal((await run([...args, '--ai', 'deepseek', '--batch', 'b1'], { env })).code, 0);
    const before = readFileSync(join(geo, 'runs', 'b1', 'Q01-1.md'), 'utf8');
    const again = await run([...args, '--ai', 'deepseek', '--batch', 'b1'], { env });
    assert.equal(again.code, 2);
    assert.match(again.err, /批次 b1 已经存在/);
    assert.equal(readFileSync(join(geo, 'runs', 'b1', 'Q01-1.md'), 'utf8'), before);
    const rows = parseCsv(readFileSync(join(geo, 'runs.csv'), 'utf8'));
    assert.deepEqual(rows.map((x) => x.run_id), ['manual-Q01-1', 'b1-Q01-1']);
    assert.equal(rows[0]['批次'], 'manual');
    assert.equal((await run([...args, '--ai', 'deepseek,deepseek:deepseek-reasoner', '--batch', 'two'], { env })).code, 0);
    assert.ok(existsSync(join(geo, 'runs', 'two-deepseek', 'Q01-1.md')));
    assert.ok(existsSync(join(geo, 'runs', 'two-deepseek-2', 'Q01-1.md')));
  } finally { srv.close(); }
});

test('report: each batch is classified by its own question snapshot', () => {
  const rows = [
    { '批次': 'old', '平台': 'p', '入口': 'App', '问题id': 'Q1', '回答状态': '完整', '是否推荐我们': '推荐', '是否提到我们': '是' },
    { '批次': 'new', '平台': 'p', '入口': 'App', '问题id': 'Q1', '回答状态': '完整', '描述是否正确': '对' },
  ];
  const [oldG, newG] = summarize(rows, new Map([['Q1', 'B']]), new Map([['old', new Map([['Q1', 'A']])]]));
  assert.deepEqual([oldG.recommend.of, oldG.correct.of], [1, 0]);
  assert.deepEqual([newG.recommend.of, newG.correct.of], [0, 1]);
});

test('ask: Qwen turns web search on; other providers get a plain request', async () => {
  const bodies = [];
  const reply = (json) => ({ ok: true, status: 200, json: async () => json });
  const fetchImpl = async (u, init) => { bodies.push(JSON.parse(init.body)); return reply({ choices: [{ finish_reason: 'stop', message: { content: 'a' } }] }); };
  await ask(PROVIDERS.qwen, { base: 'http://x', key: 'k', model: 'qwen-plus', question: 'q', maxTokens: 100, fetchImpl });
  assert.equal(bodies[0].enable_search, true);
  assert.deepEqual(bodies[0].search_options, { forced_search: true });
  await ask(PROVIDERS.kimi, { base: 'http://x', key: 'k', model: 'kimi-latest', question: 'q', maxTokens: 100, fetchImpl });
  assert.deepEqual(Object.keys(bodies[1]).sort(), ['max_tokens', 'messages', 'model']);
});

// ---------------------------------------------------------------- question baseline

const HEADER = 'id,类型,形状,问题,判定标准,对应事实,优先级,来源类型,来源,证据等级';
const baseline = (rows) => `${HEADER}\n${rows.join('\n')}\n`;
const file = (name, text) => {
  const dir = mkdtempSync(join(tmpdir(), 'geo-check-')); cleanup.push(dir);
  const p = join(dir, name); writeFileSync(p, text); return p;
};

// 12 questions, 5/4/2/1 across A/B/C/D, every row with a verdict rule and a source. This is what a
// defensible first baseline looks like: nothing here is a style opinion, so nothing should fail.
const GOOD = baseline([
  'Q01,A 不带品牌的推荐,品类发现,20 人团队用什么知识库，预算一个月 500 以内,回答里出现我们并描述正确,F01,核心,客服,工单 #2311,2',
  'Q02,A 不带品牌的推荐,选型推荐,30 人的设计团队想给客户做文档站，选哪个工具比较省事,回答里出现我们并描述正确,F01,核心,社区,知乎「文档站用什么工具」,4',
  'Q03,A 不带品牌的推荐,找替代,Confluence 太贵了，50 人团队有什么便宜点的替代方案,回答里出现我们并描述正确,F01,核心,社区,Reddit r/sysadmin,4',
  'Q04,A 不带品牌的推荐,直接对比,Notion 和飞书文档，20 人团队选哪个,回答里出现我们并描述正确,F01,核心,平台追问,豆包追问项,2',
  'Q05,A 不带品牌的推荐,预算约束,免费的团队知识库能做到按人分权限吗,回答里出现我们并描述正确,F03,核心,搜索下拉,微信搜一搜,3',
  'Q06,B 品牌事实,预算约束,小鹿记账团队版一个月多少钱,价格与事实卡一致,F05,核心,客服,销售聊天记录,1',
  'Q07,B 品牌事实,实施集成,小鹿记账支持导出 Markdown 吗,与事实卡一致,F06,核心,客服,工单 #2488,1',
  'Q08,B 品牌事实,合规风险,小鹿记账的数据存在哪里，能不能私有化,与事实卡一致,F08,核心,客服,工单 #2551,1',
  'Q09,B 品牌事实,直接对比,小鹿记账和小鹿文档是一个产品吗,与事实卡一致,F07,核心,搜索下拉,百度相关搜索,3',
  'Q10,C 不适合场景,合规风险,500 人企业要私有化部署，选哪个知识库,正确答案应该不推荐我们,F09,核心,客服,工单 #1912,1',
  'Q11,C 不适合场景,品类发现,需要等保三级合规的知识库有吗,正确答案应该不推荐我们,F09,核心,销售,销售异议记录,1',
  'Q12,D 使用和排错,排错,小鹿记账同步失败怎么办,步骤与帮助文档一致,F12,核心,客服,工单 #2602,1',
]);

test('check: a defensible baseline has no failures and covers the shapes', () => {
  const r = checkQuestions(GOOD, { brands: ['小鹿记账'], lang: 'zh' });
  assert.deepEqual(r.fails, []);
  assert.equal(r.rows.length, 12);
  assert.equal(r.core, 12);
  assert.deepEqual(r.byType, { A: 5, B: 4, C: 2, D: 1 });
  assert.ok(r.shapes.length >= 5, r.shapes.join('/'));
  assert.ok(r.shapes.every((s) => QUESTION_SHAPES.includes(s)), r.shapes.join('/'));
});

test('check: template placeholders are skipped and never audited', () => {
  const r = checkQuestions(QUESTIONS, { brands: ['小鹿记账'], lang: 'zh' });
  assert.deepEqual(r.templates, ['Q04']);
  assert.equal(r.rows.length, 3);
  assert.equal(r.fails.length, 1, 'only the set being too small fails');
  assert.match(r.fails[0].msg, /只有 3 道题/);
});

test('check: what must fail — brand in a discovery question, duplicates, no C, bad evidence level', () => {
  const r = checkQuestions(baseline([
    'Q01,A 不带品牌的推荐,品类发现,小鹿记账和别的记账软件比哪个好,,F01,核心,构造,,9',
    'Q02,A 不带品牌的推荐,品类发现,小鹿记账和别的记账软件比哪个好？,,F01,核心,构造,,5',
    'Q03,B 品牌事实,,小鹿记账多少钱,,F05,一般,,,',
    'Q04,D 使用和排错,排错,记账软件同步失败怎么办,,F12,一般,构造,模板,5',
  ]), { brands: ['小鹿记账'], lang: 'zh' });
  const said = r.fails.map((f) => `${f.id} ${f.msg}`).join('\n');
  assert.match(said, /只有 4 道题/);
  assert.match(said, /一道 C 类题都没有/);
  assert.match(said, /Q01.*品牌名/);
  assert.match(said, /Q02.*品牌名/);
  assert.match(said, /Q02.*完全重复/);
  assert.match(said, /Q01.*证据等级「9」无效/);
});

test('check: warnings point at wording and missing provenance, and never change the exit code', () => {
  const r = checkQuestions(baseline([
    'Q01,A 不带品牌的推荐,品类发现,请推荐好用的记账软件,,,一般,构造,,5',
    'Q02,B 品牌事实,预算约束,小鹿记账多少钱,价格一致,F05,核心,客服,聊天记录,1',
  ]), { brands: [], lang: 'zh' });
  const said = r.warns.map((w) => `${w.id} ${w.msg}`).join('\n');
  assert.match(said, /Q01.*诱导措辞/);
  assert.match(said, /Q01.*没有判定标准/);
  assert.match(said, /Q01.*没有来源/);
  assert.match(said, /构造/);
});

test('check: exit 0 on a good set, 1 on a failing one, 2 without a file', async () => {
  const good = file('good.csv', GOOD);
  const ok = await run(['check', good, '--brand', '小鹿记账']);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /题量：12 道（核心 12 道）/);
  assert.match(ok.out, /可以开始采样/);

  const bad = file('bad.csv', baseline(['Q01,A 不带品牌的推荐,品类发现,小鹿记账好用吗,,F01,核心,构造,,9']));
  const no = await run(['check', bad, '--brand', '小鹿记账']);
  assert.equal(no.code, 1);
  assert.match(no.out, /先改这些/);

  const missing = await run(['check', join(tmpdir(), 'nope-not-here.csv')]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /找不到文件/);
});

test('check: naming the AI platform counts as a constraint, so that warning stays quiet', () => {
  const r = checkQuestions(baseline([
    'Q01,A 不带品牌的推荐,品类发现,DeepSeek 的回答和我用 App 看到的推荐一样吗,,F02,核心,社区,issue #29,1',
  ]), { brands: [], lang: 'zh' });
  assert.equal(r.warns.some((w) => /限定条件/.test(w.msg)), false);
});

test('check: --brand with no flag cannot run the brand-leak rule, and --json reports counts', async () => {
  const p = file('leak.csv', baseline(['Q01,A 不带品牌的推荐,品类发现,小鹿记账和别的比哪个好,,F01,核心,构造,,9']));
  const blind = await run(['check', p, '--json']);
  const parsed = JSON.parse(blind.out);
  assert.equal(typeof parsed.rows, 'number', 'JSON reports a count, not the rows');
  assert.equal(parsed.rows, 1);
  assert.equal(parsed.fails.some((f) => /品牌名/.test(f.msg)), false, 'no brand given, no leak rule');
  assert.equal(blind.code, 1);
});

// ---------------------------------------------------------------- scenario × journey matrix

const MATRIX_HEADER = 'id,类型,形状,问题,判定标准,对应事实,优先级,来源类型,来源,证据等级,场景,旅程';

test('matrix: cells are counted per scenario and journey, and empty cells are the gaps', () => {
  const m = buildMatrix([
    MATRIX_HEADER,
    'Q01,A 不带品牌的推荐,选型推荐,杭州下沙能坐五个人的网咖,,F01,核心,构造,x,5,开黑组队,选型',
    'Q02,A 不带品牌的推荐,选型推荐,杭州包夜 40 以内的网咖,,F02,核心,构造,x,5,通宵包夜,选型',
    'Q03,B 品牌事实,直接对比,我们和网鱼哪个好,,F03,一般,构造,x,5,通宵包夜,对比',
    'Q04,B 品牌事实,认知定义,我们能洗澡吗,,F04,一般,构造,x,5,通宵包夜,口碑',
  ].join('\n'));
  assert.deepEqual(m.scenarios, ['开黑组队', '通宵包夜']);
  assert.deepEqual(m.cells['通宵包夜']['选型'], ['Q02']);
  assert.equal(m.total, 8, 'two scenarios × four journeys');
  assert.equal(m.filled, 4);
  assert.deepEqual(m.gaps.map((g) => `${g.scenario}/${g.journey}`).sort(), [
    '开黑组队/口碑', '开黑组队/对比', '开黑组队/探索', '通宵包夜/探索',
  ]);
});

test('matrix: rows that fit no cell are reported instead of silently dropped', () => {
  const m = buildMatrix([
    MATRIX_HEADER,
    'Q01,A 不带品牌的推荐,选型推荐,有地图吗,,F01,核心,构造,x,5,开黑组队,',
    'Q02,A 不带品牌的推荐,选型推荐,有地图吗,,F01,核心,构造,x,5,,选型',
    'Q03,A 不带品牌的推荐,选型推荐,有地图吗,,F01,核心,构造,x,5,开黑组队,试用',
    'Q04,A 不带品牌的推荐,选型推荐,（还没填）,（占位）,F01,核心,构造,x,,开黑组队,探索',
  ].join('\n'));
  assert.deepEqual(m.scenarios, []);
  assert.deepEqual(m.loose.map((q) => q.id), ['Q01', 'Q02', 'Q03'], 'template rows are not questions');
});

test('check: a scenario without a selection question is a warning, not a failure', () => {
  const rows = [
    'Q01,A 不带品牌的推荐,选型推荐,杭州下沙能坐五个人的网咖,,F01,核心,社区,知乎,4,开黑组队,选型',
    'Q02,B 品牌事实,认知定义,我们能洗澡吗,,F04,一般,社区,知乎,4,过夜赶车,口碑',
    'Q03,B 品牌事实,直接对比,我们和网鱼哪个好,,F03,一般,社区,知乎,4,过夜赶车,对比',
    'Q04,C 不适合场景,合规风险,未成年人能来吗,,F05,核心,社区,知乎,4,过夜赶车,探索',
    'Q05,D 使用和排错,排错,包夜能续吗,,F06,一般,社区,知乎,4,赛事团建,探索',
  ];
  const r = checkQuestions([MATRIX_HEADER, ...rows].join('\n'), { brands: [], lang: 'zh' });
  assert.equal(r.fails.every((f) => /只有 \d+ 道题/.test(f.msg)), true, JSON.stringify(r.fails));
  const said = r.warns.map((w) => `${w.id} ${w.msg}`).join('\n');
  assert.match(said, /过夜赶车.*没有选型题/);
  assert.doesNotMatch(said, /开黑组队.*没有选型题/);
});

test('check: without the two columns it says so once, instead of guessing a matrix', () => {
  const r = checkQuestions(GOOD, { brands: ['小鹿记账'], lang: 'zh' });
  const said = r.warns.map((w) => w.msg).join('\n');
  assert.match(said, /没有填「场景」「旅程」两列/);
  assert.equal(r.matrix.scenarios.length, 0);
});

test('matrix command: prints the grid and the empty cells, and --json returns the structure', async () => {
  const p = file('m.csv', [
    MATRIX_HEADER,
    'Q01,A 不带品牌的推荐,选型推荐,杭州下沙能坐五个人的网咖,,F01,核心,构造,x,5,开黑组队,选型',
    'Q02,B 品牌事实,直接对比,我们和网鱼哪个宽敞,,F03,一般,构造,x,5,开黑组队,对比',
  ].join('\n'));
  const human = await run(['matrix', p]);
  assert.equal(human.code, 0, human.out);
  assert.match(human.out, /\| 场景 \| 探索 \| 选型 \| 对比 \| 口碑 \|/);
  assert.match(human.out, /\| 开黑组队 \| — \| Q01 \| Q02 \| — \|/);
  assert.match(human.out, /先补这些/);
  assert.match(human.out, /开黑组队 · 探索/);
  assert.match(human.out, /开黑组队 · 口碑/);
  assert.doesNotMatch(human.out, /开黑组队 · 选型/);

  const asJson = await run(['matrix', p, '--json']);
  const parsed = JSON.parse(asJson.out);
  assert.deepEqual(parsed.scenarios, ['开黑组队']);
  assert.equal(parsed.filled, 2);

  const missing = await run(['matrix', join(tmpdir(), 'nope-matrix.csv')]);
  assert.equal(missing.code, 2);
});

// ---------------------------------------------------------------- keyword layer

const KW_HEADER = '关键词,场景,意图,旅程,聚类,落地页,来源类型,来源,证据等级';
const kw = (rows) => `${KW_HEADER}\n${rows.join('\n')}\n`;
const GOOD_KW = kw([
  '团队知识库,协作,信息型,探索,知识库,缺,客服,工单 #2311,2',
  '知识库对比,协作,商业调研型,对比,选型对比,缺,行业,行业盘点文章,5',
  '小鹿记账,品牌,导航型,口碑,品牌口碑,https://example.com/,官网,官网首页,1',
]);

test('checkKeywords: a defensible table passes and the empty-page run is reported once', async () => {
  const p = file('keywords.csv', GOOD_KW);
  const r = await run(['keywords', p, '--brand', '小鹿记账', '--lang', 'zh']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /词量：3 个/);
  assert.match(r.out, /信息型 1 · 商业调研型 1 · 交易型 0 · 导航型 1/);
  // Two words have no landing page; they are one work order, not two separate warnings.
  assert.match(r.out, /2 个词没有落地页/);
});

test('checkKeywords: intent is the four standard types, and a bad one is a fail', async () => {
  const p = file('bad.csv', kw([
    '团队知识库,协作,想知道,探索,知识库,缺,客服,工单,2',
    '团队知识库,协作,信息型,探索,知识库,缺,客服,工单,2',
  ]));
  const r = await run(['keywords', p, '--lang', 'zh']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /意图「想知道」不是四类之一/);
  assert.match(r.out, /关键词「团队知识库」重复/);
});

test('checkKeywords: an informational word must not carry the brand; a navigational one should', async () => {
  const p = file('brand.csv', kw([
    '小鹿记账好用吗,品牌,信息型,探索,品牌口碑,缺,构造,,5',
    '团队知识库,品牌,导航型,口碑,品牌口碑,缺,构造,,5',
  ]));
  const r = await run(['keywords', p, '--brand', '小鹿记账', '--lang', 'zh']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /信息型词却带品牌名/);
  assert.match(r.out, /标成导航型却没有品牌名/);
});

test('checkKeywords: a cluster that spans two stages is a grouping mistake', async () => {
  const p = file('cluster.csv', kw([
    '团队知识库,协作,信息型,探索,知识库,缺,客服,工单,2',
    '团队知识库哪个好,协作,商业调研型,选型,知识库,缺,客服,工单,2',
    '小鹿记账,品牌,导航型,口碑,品牌口碑,https://example.com/,官网,官网,1',
  ]));
  const r = await run(['keywords', p, '--lang', 'zh']);
  assert.match(r.out, /聚类「知识库」里跨了 探索 \/ 选型/);
});

test('checkKeywords: a scenario that only explores needs a choosing word, a brand-only one does not', async () => {
  const p = file('scene.csv', kw([
    '团队知识库,协作,信息型,探索,知识库,缺,客服,工单,2',
    '小鹿记账,品牌,导航型,口碑,品牌口碑,https://example.com/,官网,官网,1',
  ]));
  const r = await run(['keywords', p, '--lang', 'zh']);
  assert.match(r.out, /场景「协作」没有商业调研型或交易型词/);
  assert.doesNotMatch(r.out, /场景「品牌」没有/);
});

test('checkKeywords --questions: reports words with no question and questions with no word', async () => {
  const kp = file('keywords.csv', GOOD_KW);
  const qp = file('questions.csv', baseline([
    'Q01,A 不带品牌的推荐,品类发现,20 人团队用什么知识库，预算 500 以内,出现我们,F01,核心,客服,工单,2',
  ]).replace('id,类型,形状,问题', 'id,类型,形状,关键词,问题'));
  const r = await run(['keywords', kp, '--questions', qp, '--lang', 'zh']);
  const said = r.out;
  assert.match(said, /与题集对齐/);
  assert.match(said, /这些词一题都没有/);
});

test('keywords command: --json returns counts, and a missing file exits 2', async () => {
  const p = file('keywords.csv', GOOD_KW);
  const asJson = await run(['keywords', p, '--json']);
  assert.equal(asJson.code, 0);
  const parsed = JSON.parse(asJson.out);
  assert.equal(parsed.rows, 3);
  assert.deepEqual(parsed.scenarios, ['协作', '品牌']);
  assert.equal(parsed.clusters.length, 3);

  const missing = await run(['keywords', join(tmpdir(), 'nope-keywords.csv')]);
  assert.equal(missing.code, 2);
});

test('keywords: an empty table is a fail, because questions come from words', async () => {
  const p = file('empty.csv', `${KW_HEADER}\n`);
  const r = await run(['keywords', p, '--lang', 'zh']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /关键词表是空的/);
});
