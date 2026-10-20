// Tests for cli/geo-studio.mjs. Run: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudio, setFactStatus, setDraftStatus, readState, commandFor, main } from '../cli/geo-studio.mjs';
import { parseFactCard, loadFacts } from '../cli/geo-site.mjs';

const QUESTIONS = `id,类型,问题,判定标准,对应事实,优先级,来源类型,来源
Q01,A 不带品牌的推荐,有没有不用联网也能用的记账 App？,提到并推荐我们,F01,核心,用户原话,
Q02,A 不带品牌的推荐,适合个人用的简单记账 App 有哪些？,提到并推荐我们,B03,一般,用户原话,
`;

const CARD = `基本信息:
  - 编号: B01
    项目: 名称
    内容: "小鹿记账"
    状态: 已确认
  - 编号: B03
    项目: 一句话说明   # 做什么、给谁用
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
  - 编号: P03
    名称: "家庭版"
    价格: "¥30/年"
`;

const BODY = '能。小鹿记账是不联网也能用的个人记账 App [B03]，没有网络时也能正常记账 [F01]。\n\n## 换手机怎么办\n\n换手机时需要手动导出再导入数据 [F01]，目前不会自动同步。'
  + '\n\n## 适合谁\n\n适合只在一台手机上记个人开销、在意数据留在本机的人。需要多人共享账本的家庭不适合，因为数据只在一台手机里。'.repeat(2);
const DRAFT = `TITLE: 小鹿记账离线说明\nSLUG: offline-budget-app\nDESCRIPTION: 说明小鹿记账能否离线使用\nFACTS: B03, F01\n---\n${BODY}`;
const ANSWERS = {
  '有没有不用联网也能用的记账 App？': '推荐这几款：\n1. **随手记**：功能全\n2. **鲨鱼记账**：免费',
  '适合个人用的简单记账 App 有哪些？': '可以试试：\n- 小鹿记账：离线可用\n- 随手记',
};
function fakeFetch() {
  return async (url, init) => {
    const body = JSON.parse(init.body); const content = body.messages[0].content;
    const text = /严格按下面的格式输出/.test(content) ? DRAFT : (ANSWERS[content] ?? '我不清楚。');
    return { ok: true, status: 200, json: async () => ({ model: body.model, choices: [{ message: { content: text }, finish_reason: 'stop' }] }) };
  };
}

const dirs = []; const servers = [];
after(() => { for (const s of servers) s.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function project({ config = { brand: '小鹿记账,小鹿', competitors: '随手记,鲨鱼记账', ai: 'deepseek', times: 2, maxDrafts: 3, autoConfirm: false, lang: 'zh' } } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'geo-studio-')); dirs.push(d);
  mkdirSync(join(d, 'geo'));
  writeFileSync(join(d, 'geo', 'questions.csv'), QUESTIONS);
  writeFileSync(join(d, 'geo', 'fact-card.yaml'), CARD);
  if (config) writeFileSync(join(d, 'geo', 'autopilot.json'), JSON.stringify(config));
  return d;
}

async function start(dir, opts = {}) {
  const s = createStudio({ dir, lang: 'zh', env: { DEEPSEEK_API_KEY: 'sk-test' }, fetchImpl: fakeFetch(), sleep: async () => {}, ...opts });
  servers.push(s);
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${s.address().port}`;
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const r = await fetch(base + path, { method, headers: { ...(method === 'GET' ? {} : { 'x-geo-studio': '1', 'content-type': 'application/json' }), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, data: type.includes('json') ? await r.json() : await r.text() };
  };
  return { base, call, port: s.address().port };
}

test('setFactStatus changes one entry, inserts a missing status, and leaves the rest as written', () => {
  const next = setFactStatus(CARD, 'P02', true);
  const facts = loadFacts(parseFactCard(next));
  assert.ok(facts.entries.find((e) => e.id === 'P02').confirmed);
  assert.equal(next.split('\n').filter((l, i) => l !== CARD.split('\n')[i]).length, 1, 'only one line changes');
  assert.match(next, /项目: 一句话说明   # 做什么、给谁用/);
  const inserted = setFactStatus(CARD, 'P03', true);
  assert.match(inserted, /- 编号: P03\n    状态: 已确认\n    名称: "家庭版"/);
  assert.ok(loadFacts(parseFactCard(inserted)).entries.find((e) => e.id === 'P03').confirmed);
  assert.equal(loadFacts(parseFactCard(setFactStatus(CARD, 'B01', false))).entries.find((e) => e.id === 'B01').status, '待确认');
  assert.equal(setFactStatus(CARD, 'Z99', true), null);
  assert.match(setFactStatus('basics:\n  - id: B01\n    value: "X"\n    status: unknown\n', 'B01', true), /status: confirmed/);
});

test('setDraftStatus edits or adds the front-matter status only', () => {
  assert.equal(setDraftStatus('---\ntitle: A\nstatus: draft\n---\nbody status: draft\n', 'confirmed'), '---\ntitle: A\nstatus: confirmed\n---\nbody status: draft\n');
  assert.equal(setDraftStatus('---\ntitle: A\n---\nbody', 'draft'), '---\ntitle: A\nstatus: draft\n---\nbody');
  assert.equal(setDraftStatus('no front matter', 'draft'), null);
});

test('commandFor builds argv from geo/autopilot.json and refuses without a brand', () => {
  const d = project();
  const probe = commandFor('probe', d, { brand: 'X', ai: 'deepseek', competitors: 'Y' }, 'zh');
  assert.deepEqual(probe.argv.slice(0, 1), ['run']);
  assert.ok(probe.argv.includes('--competitors'));
  assert.throws(() => commandFor('weekly', d, {}, 'zh'), /brand/);
  assert.equal(commandFor('rm -rf', d, {}, 'zh'), null);
});

test('studio: page, state, the weekly loop, review and fact confirmation end to end', async () => {
  const d = project(); const { call } = await start(d);
  const home = await call('/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(home.data, /GEO 医生工作台/);
  assert.doesNotMatch(home.data, /eval\(/);

  let s = (await call('/api/state')).data;
  assert.equal(s.questions.length, 2);
  assert.equal(s.facts.entries.filter((e) => e.confirmed).length, 3);
  assert.deepEqual(s.keys.find((k) => k.id === 'deepseek'), { id: 'deepseek', label: 'DeepSeek', env: 'DEEPSEEK_API_KEY', set: true, url: 'https://platform.deepseek.com/api_keys' });
  assert.ok(!JSON.stringify(s).includes('sk-test'), 'key values never leave the server');
  assert.equal(s.trend.length, 0);

  const r = await call('/api/run', { method: 'POST', body: { cmd: 'weekly' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.code, 0, r.data.err);
  s = (await call('/api/state')).data;
  assert.equal(s.trend.length, 1);
  assert.deepEqual(s.trend[0].recommend, { n: 2, of: 4 });
  assert.deepEqual(s.gaps.map((g) => [g.id, g.draft]), [['Q01', 'offline-budget-app.md']]);
  assert.equal(s.drafts.length, 1);
  assert.equal(s.drafts[0].confirmed, false, 'autoConfirm is off');
  assert.equal(s.reports.length, 1);
  assert.match((await call(`/api/report/${s.reports[0]}`)).data.text, /GEO 医生每周复查/);
  assert.equal(s.last.cmd, 'weekly');

  const approve = await call('/api/draft/offline-budget-app.md/status', { method: 'POST', body: { status: 'confirmed' } });
  assert.equal(approve.status, 200, JSON.stringify(approve.data));
  assert.match(readFileSync(join(d, 'geo', 'drafts', 'offline-budget-app.md'), 'utf8'), /^status: confirmed$/m);
  assert.equal((await call('/api/draft/offline-budget-app.md/status', { method: 'POST', body: { status: 'draft' } })).status, 200);

  // A draft that cites an unconfirmed fact cannot be approved until the fact is confirmed.
  const draft = (await call('/api/draft/offline-budget-app.md')).data.text.replace(/facts: \[[^\]]*\]|facts:\n(?:\s+- .*\n)+/, 'facts: [P02]\n');
  assert.equal((await call('/api/draft/offline-budget-app.md', { method: 'PUT', body: { text: draft } })).status, 200);
  const refused = await call('/api/draft/offline-budget-app.md/status', { method: 'POST', body: { status: 'confirmed' } });
  assert.equal(refused.status, 422);
  assert.match(refused.data.error, /P02/);
  assert.equal((await call('/api/fact/P02', { method: 'POST', body: { confirmed: true } })).status, 200);
  assert.equal((await call('/api/draft/offline-budget-app.md/status', { method: 'POST', body: { status: 'confirmed' } })).status, 200);
  assert.equal((await call('/api/fact/Z99', { method: 'POST', body: { confirmed: true } })).status, 404);

  const site = await call('/api/run', { method: 'POST', body: { cmd: 'site' } });
  assert.equal(site.data.code, 0, site.data.err);
  assert.ok(existsSync(join(d, 'site', 'articles')));
});

test('studio: edits are validated before they replace a file', async () => {
  const d = project(); const { call } = await start(d);
  assert.equal((await call('/api/file/config', { method: 'PUT', body: { text: '{oops' } })).status, 422);
  assert.equal((await call('/api/file/config', { method: 'PUT', body: { text: '[1]' } })).status, 422);
  assert.equal((await call('/api/file/questions', { method: 'PUT', body: { text: 'id,类型,问题\n' } })).status, 422);
  assert.equal(readFileSync(join(d, 'geo', 'questions.csv'), 'utf8'), QUESTIONS, 'a rejected edit leaves the file alone');
  const q2 = QUESTIONS + 'Q03,A 不带品牌的推荐,记账 App 推荐,提到并推荐我们,B03,一般,用户原话,\n';
  assert.equal((await call('/api/file/questions', { method: 'PUT', body: { text: q2 } })).status, 200);
  assert.equal((await call('/api/state')).data.questions.length, 3);
  assert.equal((await call('/api/file/secrets', { method: 'PUT', body: { text: 'x' } })).status, 404);
});

test('studio: refuses cross-site posts, foreign Host names, odd file names and unknown commands', async () => {
  const d = project(); const { call, port } = await start(d);
  assert.equal((await call('/api/run', { method: 'POST', body: { cmd: 'report' }, headers: { 'x-geo-studio': '' } })).status, 403);
  const form = await fetch(`http://127.0.0.1:${port}/api/fact/P02`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-geo-studio': '1' }, body: 'confirmed=1' });
  assert.equal(form.status, 403);
  const rebinding = await new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/state', headers: { host: 'evil.example:' + port } }, (res) => { res.resume(); ok(res.statusCode); });
    req.on('error', fail); req.end();
  });
  assert.equal(rebinding, 403);
  assert.equal((await call('/api/draft/..%2Fquestions.md')).status, 400);
  assert.equal((await call('/api/report/..%2F..%2Fx.md')).status, 400);
  assert.equal((await call('/api/run', { method: 'POST', body: { cmd: 'rm' } })).status, 400);
});

test('studio: with a token every API call needs it', async () => {
  const d = project(); const { call } = await start(d, { token: 'correct-horse-battery' });
  assert.equal((await call('/')).status, 200, 'the page itself loads and asks for the token');
  assert.equal((await call('/api/state')).status, 401);
  assert.equal((await call('/api/state', { headers: { 'x-geo-token': 'wrong' } })).status, 401);
  assert.equal((await call('/api/state', { headers: { 'x-geo-token': 'correct-horse-battery' } })).status, 200);
});

test('studio: init starts an empty folder from the templates and never overwrites', async () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-studio-')); dirs.push(d);
  const { call } = await start(d);
  const s0 = (await call('/api/state')).data;
  assert.deepEqual([s0.files.questions, s0.files.facts, s0.templates], [false, false, true]);
  const r = await call('/api/init', { method: 'POST', body: {} });
  assert.deepEqual(r.data.wrote.sort(), ['autopilot.json', 'fact-card.yaml', 'questions.csv']);
  assert.equal(JSON.parse(readFileSync(join(d, 'geo', 'autopilot.json'), 'utf8')).autoConfirm, false, 'studio drafts wait for approval');
  writeFileSync(join(d, 'geo', 'autopilot.json'), '{"brand":"mine"}');
  assert.deepEqual((await call('/api/init', { method: 'POST', body: {} })).data.wrote, []);
  assert.equal(readFileSync(join(d, 'geo', 'autopilot.json'), 'utf8'), '{"brand":"mine"}');
  assert.ok((await call('/api/state')).data.facts.entries.length > 10);
});

test('readState copes with a broken config and missing files', () => {
  const d = project({ config: null });
  writeFileSync(join(d, 'geo', 'autopilot.json'), '{nope');
  const s = readState(d, { env: {} });
  assert.equal(s.config, null);
  assert.ok(s.errors.config);
  assert.equal(s.drafts.length, 0);
  assert.ok(s.keys.every((k) => !k.set));
});

test('CLI: listening beyond this machine needs a long GEO_STUDIO_TOKEN', async () => {
  const err = []; const out = [];
  assert.equal(await main(['--host', '0.0.0.0', '--lang', 'zh'], { env: {}, err: (s) => err.push(s), out: (s) => out.push(s), listen: false }), 2);
  assert.match(err.join('\n'), /GEO_STUDIO_TOKEN/);
  assert.equal(await main(['--host', '0.0.0.0', '--lang', 'zh'], { env: { GEO_STUDIO_TOKEN: 'short' }, err: () => {}, out: () => {}, listen: false }), 2);
  const warn = [];
  assert.equal(await main(['--host', '0.0.0.0', '--lang', 'zh'], { env: { GEO_STUDIO_TOKEN: 'long-enough-token' }, err: (x) => warn.push(x), out: () => {}, listen: false }), 0);
  assert.match(warn.join('\n'), /HTTPS 反向代理/);
  assert.equal(await main(['--port', 'abc', '--lang', 'zh'], { env: {}, err: () => {}, out: () => {}, listen: false }), 2);
  assert.equal(await main(['--help', '--lang', 'en'], { env: {}, err: () => {}, out: (s) => out.push(s), listen: false }), 0);
  assert.match(out.join('\n'), /GEO Doctor Studio/);
});
