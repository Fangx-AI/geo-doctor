// Tests for cli/geo-autopilot.mjs. Run: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findGaps, latestBatches, parseWriterOutput, draftText, factLines, workflowYaml, configTemplate, main } from '../cli/geo-autopilot.mjs';
import { loadDrafts, parseDraft } from '../cli/geo-publish.mjs';
import { parseFactCard, loadFacts } from '../cli/geo-site.mjs';

const QUESTIONS = `id,类型,问题,判定标准,对应事实,优先级,来源类型,来源
Q01,A 不带品牌的推荐,有没有不用联网也能用的记账 App？,提到并推荐我们,F01,核心,用户原话,
Q02,A 不带品牌的推荐,适合个人用的简单记账 App 有哪些？,提到并推荐我们,B03,一般,用户原话,
Q03,B 品牌事实,小鹿记账高级版多少钱？,价格与事实卡一致,P02,核心,构造,
`;

const CARD = `基本信息:
  - 编号: B01
    项目: 名称
    内容: "小鹿记账"
    状态: 已确认
  - 编号: B03
    项目: 一句话说明
    内容: "不联网也能用的个人记账 App"
    状态: 已确认
核心能力:
  - 编号: F01
    能力: "离线记账"
    限制: "换手机要手动导出"
    状态: 已确认
价格:
  - 编号: P02
    名称: "高级版"
    价格: "¥18/年"
    状态: 未知
`;

const CONFIG = { brand: '小鹿记账,小鹿', competitors: '随手记/Feidee,鲨鱼记账', ai: 'deepseek', times: 2, writer: 'deepseek', maxDrafts: 3, autoConfirm: true, lang: 'zh' };

const BODY = '能。小鹿记账是不联网也能用的个人记账 App [B03]，没有网络时也能正常记账 [F01]。\n\n## 换手机怎么办\n\n换手机时需要手动导出再导入数据 [F01]，目前不会自动同步。'
  + '\n\n## 适合谁\n\n适合只在一台手机上记个人开销、在意数据留在本机的人。需要多人共享账本的家庭不适合，因为数据只在一台手机里。'.repeat(2)
  + '\n\n## 核对表\n\n| 句子 | 编号 |\n| --- | --- |\n| 不联网也能用 | B03 |\n';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function project() {
  const d = mkdtempSync(join(tmpdir(), 'geo-autopilot-')); dirs.push(d);
  mkdirSync(join(d, 'geo'));
  writeFileSync(join(d, 'geo', 'questions.csv'), QUESTIONS);
  writeFileSync(join(d, 'geo', 'fact-card.yaml'), CARD);
  writeFileSync(join(d, 'geo', 'autopilot.json'), JSON.stringify(CONFIG));
  return d;
}

// A fake chat API: sampling questions get canned answers, writing prompts get a draft in the expected format.
function fakeApi({ answers, draft = `TITLE: 有没有不用联网也能用的记账 App？小鹿记账离线说明\nSLUG: offline-budget-app\nDESCRIPTION: 说明小鹿记账能否离线使用\nFACTS: B03, F01\n---\n${BODY}` }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); const content = body.messages[0].content; calls.push({ url, content, auth: init.headers.authorization });
    const text = /严格按下面的格式输出/.test(content) ? (typeof draft === 'function' ? draft(content) : draft) : (answers[content] ?? '我不清楚。');
    return { ok: true, status: 200, json: async () => ({ model: body.model, choices: [{ message: { content: text }, finish_reason: 'stop' }] }) };
  };
  return { fetchImpl, calls };
}

async function run(dir, argv, opts = {}) {
  const out = []; const err = []; const cwd = process.cwd();
  process.chdir(dir);
  try {
    const code = await main([...argv, '--lang', 'zh'], { env: { DEEPSEEK_API_KEY: 'sk-test' }, out: (s) => out.push(s), err: (s) => err.push(s), sleep: async () => {}, ...opts });
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally { process.chdir(cwd); }
}

const ROUND1 = {
  '有没有不用联网也能用的记账 App？': '推荐这几款：\n1. **随手记**：功能全\n2. **鲨鱼记账**：免费',
  '适合个人用的简单记账 App 有哪些？': '可以试试：\n- 小鹿记账：离线可用\n- 随手记',
  '小鹿记账高级版多少钱？': '小鹿记账高级版每年 18 元。',
};
const ROUND2 = { ...ROUND1, '有没有不用联网也能用的记账 App？': '推荐：\n1. **小鹿记账**：完全离线\n2. 随手记' };

test('findGaps: a competitor recommended more often than us is a gap; drafts are matched by qid or question', () => {
  const row = (batch, id, ours, who, date = '2026-10-19') => ({ '批次': batch, '平台': 'DeepSeek', '入口': 'API', '日期': date, '问题id': id, '回答状态': '完整', '是否推荐我们': ours, '推荐了谁': who, '引用来源': 'zhihu.com' });
  const rows = [
    row('old', 'Q01', '否', '随手记', '2026-10-12'),
    row('new', 'Q01', '否', '随手记;鲨鱼记账'), row('new', 'Q01', '推荐', '小鹿记账;随手记'),
    row('new', 'Q02', '推荐', '小鹿记账'), row('new', 'Q02', '推荐', '小鹿记账;随手记'),
  ];
  assert.deepEqual(latestBatches(rows), ['new']);
  const questions = [{ id: 'Q01', cls: 'A', question: '离线记账？' }, { id: 'Q02', cls: 'A', question: '个人记账？' }];
  const { gaps } = findGaps({ rows, questions });
  assert.deepEqual(gaps.map((g) => [g.id, g.ours, g.of, g.winners[0]]), [['Q01', 1, 2, { name: '随手记', n: 2 }]]);
  assert.deepEqual(gaps[0].sources, ['zhihu.com']);
  const drafts = [{ file: 'a.md', meta: { question: '离线记账？' } }];
  assert.equal(findGaps({ rows, questions, drafts }).gaps[0].draft, 'a.md');
});

test('findGaps judges each AI on its own batch: wins on one AI never hide a gap on another', () => {
  const row = (batch, platform, ours, who) => ({ '批次': batch, '平台': platform, '入口': 'API', '日期': '2026-10-19', '问题id': 'Q01', '回答状态': '完整', '是否推荐我们': ours, '推荐了谁': who, '引用来源': '' });
  const rows = [
    row('ds', 'DeepSeek', '否', '随手记'), row('ds', 'DeepSeek', '否', '随手记'),
    row('km', 'Kimi', '推荐', '小鹿记账'), row('km', 'Kimi', '推荐', '小鹿记账'), row('km', 'Kimi', '推荐', '小鹿记账;随手记'),
  ];
  const questions = [{ id: 'Q01', cls: 'A', question: '离线记账？' }];
  const { gaps } = findGaps({ rows, questions });
  assert.equal(gaps.length, 1, 'pooled, 3 vs 3 would hide the DeepSeek gap');
  assert.deepEqual(gaps[0].platforms.map((p) => [p.platform, p.ours, p.of]), [['DeepSeek', 0, 2]]);
});

test('findGaps classifies each batch by the question set it was asked with', () => {
  const rows = [{ '批次': 'b1', '平台': 'DeepSeek', '入口': 'API', '日期': '2026-10-19', '问题id': 'Q09', '回答状态': '完整', '是否推荐我们': '否', '推荐了谁': '随手记', '引用来源': '' }];
  const questions = [{ id: 'Q09', cls: 'B', question: '后来改成品牌题' }];
  assert.equal(findGaps({ rows, questions }).gaps.length, 0);
  const snapshots = new Map([['b1', new Map([['Q09', { id: 'Q09', cls: 'A', question: '当时的推荐题' }]])]]);
  assert.equal(findGaps({ rows, questions, snapshots }).gaps.length, 1);
});

test('parseWriterOutput reads the header, strips a fence and a repeated H1, and rejects junk', () => {
  const p = parseWriterOutput('```markdown\nTITLE: 标题\nSLUG: a-b\nDESCRIPTION: 说明\nFACTS: [B01]，F01\n---\n# 标题\n\n正文\n```');
  assert.deepEqual(p, { title: '标题', slug: 'a-b', description: '说明', facts: ['B01', 'F01'], body: '正文' });
  assert.equal(parseWriterOutput('just some text'), null);
  assert.equal(parseWriterOutput('TITLE: x\n---\n'), null);
});

test('draftText round-trips through geo-publish, including titles with colons and quotes', () => {
  const text = draftText({ title: '"离线"记账：怎么选', slug: 'x', description: '说明', facts: ['B01'], body: '正文' },
    { question: '有没有：离线的？', qid: 'Q01', lang: 'zh', brand: '小鹿记账', status: 'draft', by: 'deepseek:deepseek-chat', date: '2026-10-19' });
  const { meta } = parseDraft(text);
  assert.equal(meta.title, '"离线"记账：怎么选');
  assert.equal(meta.question, '有没有：离线的？');
  assert.equal(meta.qid, 'Q01');
  assert.deepEqual(meta.facts, ['B01']);
});

test('factLines lists confirmed facts only, without sources or status', () => {
  const lines = factLines(loadFacts(parseFactCard(CARD)));
  assert.match(lines, /^\[B01\] 项目: 名称；内容: 小鹿记账$/m);
  assert.match(lines, /\[F01\] 能力: 离线记账；限制: 换手机要手动导出/);
  assert.doesNotMatch(lines, /P02|18/);
});

test('weekly: samples, drafts the gap, writes a report and a PR body', async () => {
  const d = project(); const api = fakeApi({ answers: ROUND1 });
  const r = await run(d, ['weekly', '--pr-body', join(d, 'pr.md')], { fetchImpl: api.fetchImpl, now: () => new Date('2026-10-19T09:00:00') });
  assert.equal(r.code, 0, r.err);
  assert.ok(api.calls.every((c) => c.auth === 'Bearer sk-test'));
  const drafts = loadDrafts(join(d, 'geo', 'drafts'));
  assert.deepEqual(drafts.map((x) => [x.slug, x.meta.qid, x.meta.status]), [['offline-budget-app', 'Q01', 'confirmed']]);
  assert.deepEqual(drafts[0].facts, ['B03', 'F01']);
  assert.match(drafts[0].meta.generated_by, /deepseek:deepseek-chat, 2026-10-19/);
  const writePrompt = api.calls.find((c) => /严格按下面的格式输出/.test(c.content)).content;
  assert.match(writePrompt, /有没有不用联网也能用的记账 App？/);
  assert.match(writePrompt, /随手记、鲨鱼记账/);
  assert.doesNotMatch(writePrompt, /¥18/, 'unconfirmed facts never reach the writer');
  const report = readFileSync(join(d, 'geo', 'reports', '2026-10-19.md'), 'utf8');
  assert.match(report, /\| DeepSeek \| 2026-10-19-deepseek-api-01 \| 2026-10-19 \| 2\/4 \|/);
  assert.match(report, /DeepSeek：这是第一批/);
  assert.match(report, /\| Q01 \| 有没有不用联网也能用的记账 App？ \| DeepSeek \| 0\/2 \| 随手记 2，鲨鱼记账 2 \| offline-budget-app\.md \|/);
  const pr = readFileSync(join(d, 'pr.md'), 'utf8');
  assert.match(pr, /geo\/drafts\/offline-budget-app\.md/);
  assert.match(pr, /合并前请逐篇读一遍/);

  // Next week Q01 improves: the report shows the change and the existing draft is not rewritten.
  const api2 = fakeApi({ answers: ROUND2 });
  const r2 = await run(d, ['weekly', '--pr-body', join(d, 'pr2.md')], { fetchImpl: api2.fetchImpl, now: () => new Date('2026-10-26T09:00:00') });
  assert.equal(r2.code, 0, r2.err);
  assert.ok(!api2.calls.some((c) => /严格按下面的格式输出/.test(c.content)), 'no gap left to draft');
  const report2 = readFileSync(join(d, 'geo', 'reports', '2026-10-26.md'), 'utf8');
  assert.match(report2, /### DeepSeek：2026-10-26-deepseek-api-01 对比 2026-10-19-deepseek-api-01/);
  assert.match(report2, /\| Q01 \| 有没有不用联网也能用的记账 App？ \| 0\/2 \| 2\/2 ⬆️ \|/);
  assert.match(report2, /最近一批采样里没有缺口/);
  assert.match(readFileSync(join(d, 'pr2.md'), 'utf8'), /本周没有新稿/);
});

test('write: a draft citing an unconfirmed fact stays draft; without --ready everything stays draft', async () => {
  const d = project();
  await run(d, ['weekly'], { fetchImpl: fakeApi({ answers: ROUND1, draft: `TITLE: 高级版多少钱\nSLUG: price\nDESCRIPTION: 价格\nFACTS: P02\n---\n${BODY}` }).fetchImpl, now: () => new Date('2026-10-19T09:00:00') });
  const [draft] = loadDrafts(join(d, 'geo', 'drafts'));
  assert.equal(draft.meta.status, 'draft', 'P02 is 未知, so the check fails and the draft is not confirmed');

  const d2 = project();
  await run(d2, ['weekly'], { fetchImpl: fakeApi({ answers: ROUND1 }).fetchImpl, now: () => new Date('2026-10-19T09:00:00') });
  rmSync(join(d2, 'geo', 'drafts'), { recursive: true });
  const r = await run(d2, ['write', '--ai', 'deepseek'], { fetchImpl: fakeApi({ answers: ROUND1 }).fetchImpl });
  assert.equal(r.code, 0, r.err);
  assert.equal(loadDrafts(join(d2, 'geo', 'drafts'))[0].meta.status, 'draft');
});

test('write: junk from the model is reported and nothing is written', async () => {
  const d = project();
  await run(d, ['weekly'], { fetchImpl: fakeApi({ answers: ROUND1, draft: '抱歉，我无法完成。' }).fetchImpl, now: () => new Date('2026-10-19T09:00:00') });
  assert.ok(!existsSync(join(d, 'geo', 'drafts')) || !readdirSync(join(d, 'geo', 'drafts')).length);
  const r = await run(d, ['write', '--ai', 'deepseek'], { fetchImpl: fakeApi({ answers: ROUND1, draft: '抱歉' }).fetchImpl });
  assert.equal(r.code, 1);
  assert.match(r.err, /Q01 写稿失败：模型没有按格式返回/);
});

test('gaps and errors: missing key, missing config, unknown AI', async () => {
  const d = project();
  await run(d, ['weekly'], { fetchImpl: fakeApi({ answers: ROUND1 }).fetchImpl, now: () => new Date('2026-10-19T09:00:00') });
  const g = await run(d, ['gaps']);
  assert.equal(g.code, 0);
  assert.match(g.out, /Q01 有没有不用联网也能用的记账 App？\n  DeepSeek：你被推荐 0\/2 次；随手记 2 次，鲨鱼记账 2 次\n  已有草稿：offline-budget-app\.md/);
  assert.equal((await run(d, ['write', '--ai', 'deepseek'], { env: {} })).code, 2);
  assert.equal((await run(d, ['write', '--ai', 'nope'])).code, 2);
  rmSync(join(d, 'geo', 'autopilot.json'));
  const w = await run(d, ['weekly']);
  assert.equal(w.code, 2);
  assert.match(w.err, /geo-autopilot action/);
});

test('weekly stops when the probe gets no valid answers, so stale data never becomes a report', async () => {
  const d = project();
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' });
  const r = await run(d, ['weekly'], { fetchImpl, now: () => new Date('2026-10-19T09:00:00') });
  assert.notEqual(r.code, 0);
  assert.ok(!existsSync(join(d, 'geo', 'reports')));
  assert.ok(!existsSync(join(d, 'geo', 'drafts')));
});

test('action writes the workflow and a config template once', async () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-autopilot-')); dirs.push(d);
  const r = await run(d, ['action']);
  assert.equal(r.code, 0);
  const yml = readFileSync(join(d, '.github', 'workflows', 'geo-autopilot.yml'), 'utf8');
  assert.equal(yml, workflowYaml());
  assert.match(yml, /cron: '0 1 \* \* 1'/);
  assert.match(yml, /DEEPSEEK_API_KEY: \$\{\{ secrets\.DEEPSEEK_API_KEY \}\}/);
  assert.match(yml, /gh pr create/);
  assert.deepEqual(JSON.parse(readFileSync(join(d, 'geo', 'autopilot.json'), 'utf8')), JSON.parse(configTemplate('zh')));
  assert.equal((await run(d, ['action'])).code, 1, 'never overwrites');
});
