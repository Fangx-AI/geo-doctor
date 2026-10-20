// Tests for cli/geo-facts.mjs. Run: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cardShape, quoteFound, checkCandidate, applyCandidate, parseCandidates, splitChunks, setEntryField, readSource, extractPrompt, main } from '../cli/geo-facts.mjs';
import { parseFactCard, loadFacts } from '../cli/geo-site.mjs';

const TEMPLATE = readFileSync(new URL('../skills/geo-doctor/assets/fact-card.yaml', import.meta.url), 'utf8');
const MATERIAL = `小鹿记账是一款不联网也能用的个人记账 App，数据只存在你的手机里。

高级版每年 18 元，包含多账本和导出 Excel。支持 iOS 和 Android。

小鹿记账不支持多人共享账本。`;

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const facts = (text) => loadFacts(parseFactCard(text)).entries;

test('cardShape reads sections, prefixes and fields from the card itself', () => {
  const shape = cardShape(TEMPLATE);
  const f = shape.find((s) => s.prefix === 'F');
  assert.equal(f.name, '核心能力');
  assert.deepEqual(f.fields, ['能力', '限制']);
  assert.ok(f.zh);
  assert.deepEqual(shape.find((s) => s.prefix === 'B').entries[0], { id: 'B01', fields: { 项目: '名称', 内容: '' }, status: '未知' });
  assert.ok(!shape.some((s) => s.name === '维护'), 'maps are not fact sections');
  const en = cardShape('basics:\n  - id: B01\n    item: Name\n    value: ""\n    status: unknown\n');
  assert.deepEqual([en[0].prefix, en[0].zh, en[0].fields], ['B', false, ['item', 'value']]);
});

test('quoteFound ignores spacing, punctuation and full-width forms but not invented words', () => {
  assert.ok(quoteFound('高级版每年18元,包含多账本', MATERIAL));
  assert.ok(quoteFound('支持 ＩＯＳ 和 Android', MATERIAL));
  assert.ok(!quoteFound('高级版每年 12 元', MATERIAL));
  assert.ok(!quoteFound('小鹿', MATERIAL), 'too short to prove anything');
  assert.ok(!quoteFound('', MATERIAL));
});

test('checkCandidate keeps quoted facts and drops invented, malformed and duplicate ones', () => {
  const shape = cardShape(TEMPLATE);
  const ok = checkCandidate({ id: 'B01', section: '基本信息', fields: { 项目: '名称', 内容: '小鹿记账' }, quote: '小鹿记账是一款不联网也能用的个人记账 App' }, shape, MATERIAL);
  assert.deepEqual(ok.candidate, { id: 'B01', section: '基本信息', fields: { 项目: '名称', 内容: '小鹿记账' }, quote: '小鹿记账是一款不联网也能用的个人记账 App', conflict: [] });
  assert.equal(checkCandidate({ id: 'NEW', section: '核心能力', fields: { 能力: '云同步' }, quote: '支持云同步' }, shape, MATERIAL).drop, 'noQuote');
  assert.equal(checkCandidate({ id: 'NEW', section: '不存在', fields: { 内容: 'x' }, quote: '不支持多人共享账本' }, shape, MATERIAL).drop, 'invalid');
  assert.equal(checkCandidate({ id: 'NEW', section: '明确不支持', fields: { 价格: 'x' }, quote: '不支持多人共享账本' }, shape, MATERIAL).drop, 'invalid', 'fields must belong to the section');
  assert.equal(checkCandidate({ id: 'B01', section: '基本信息', fields: { 项目: '名称' }, quote: '小鹿记账是一款不联网也能用的个人记账 App' }, shape, MATERIAL).drop, 'same', 'a label alone fills nothing');
  assert.equal(checkCandidate('junk', shape, MATERIAL).drop, 'invalid');
  // The section can come from the id when the model names it wrongly.
  assert.equal(checkCandidate({ id: 'X01', section: '其他', fields: { 内容: '多人共享账本' }, quote: '不支持多人共享账本' }, shape, MATERIAL).candidate.section, '明确不支持');
  const filled = applyCandidate(TEMPLATE, { ...ok.candidate, source: 'a.md' }).text;
  const conflict = checkCandidate({ id: 'B01', section: '基本信息', fields: { 内容: '小鹿记账 Pro' }, quote: '小鹿记账是一款不联网也能用的个人记账 App' }, cardShape(filled), MATERIAL);
  assert.deepEqual(conflict.candidate.conflict, [{ field: '内容', current: '小鹿记账' }]);
});

test('applyCandidate fills empty entries, uses blank template slots, adds ids, and keeps both sides of a conflict', () => {
  let text = TEMPLATE;
  const apply = (c) => { const r = applyCandidate(text, { source: '说明.md', conflict: [], ...c }); text = r.text; return r.id; };
  assert.equal(apply({ id: 'B01', section: '基本信息', fields: { 项目: '名称', 内容: '小鹿记账' }, quote: '小鹿记账是一款' }), 'B01');
  assert.match(text, /    项目: 名称              # 对外统一使用的准确名称\n    内容: "小鹿记账"\n    来源: "说明\.md：「小鹿记账是一款」"\n    状态: 待确认/, 'unchanged fields and comments stay as written');
  assert.equal(apply({ id: null, section: '核心能力', fields: { 能力: '离线记账' }, quote: '不联网也能用' }), 'F01', 'the blank F01 slot is used first');
  assert.equal(apply({ id: null, section: '核心能力', fields: { 能力: '导出 Excel', 限制: '仅高级版' }, quote: '包含多账本和导出 Excel' }), 'F02');
  assert.equal(apply({ id: 'C01', section: '使用条件', fields: { 内容: 'iOS、Android' }, quote: '支持 iOS 和 Android' }), 'C01');
  assert.equal(apply({ id: 'B01', section: '基本信息', fields: { 内容: '小鹿记账 Pro' }, quote: 'x', conflict: [{ field: '内容', current: '小鹿记账' }] }), 'B01');
  const e = facts(text);
  const get = (id) => e.find((x) => x.id === id);
  assert.equal(get('F01').capability, '离线记账');
  assert.deepEqual([get('F02').capability, get('F02').limit, get('F02').status], ['导出 Excel', '仅高级版', '待确认']);
  assert.equal(get('C01').value, 'iOS、Android', 'the old block list value [] is replaced');
  assert.deepEqual([get('B01').value, get('B01').status], ['小鹿记账 Pro（另一说法：小鹿记账）', '来源冲突']);
  assert.ok(!e.some((x) => x.confirmed), 'nothing is confirmed without a person');
  assert.equal(text.indexOf('- 编号: F02') < text.indexOf('价格:'), true, 'new entries stay inside their section');
});

test('setEntryField drops an indented block list and keeps quotes safe', () => {
  const src = 'a:\n  - 编号: C01\n    内容:\n      - iOS\n      - 安卓\n    状态: 未知\nb:\n  - 编号: D01\n';
  assert.equal(setEntryField(src, 'C01', '内容', '"iOS"'), 'a:\n  - 编号: C01\n    内容: "iOS"\n    状态: 未知\nb:\n  - 编号: D01\n');
  assert.equal(setEntryField(src, 'Z9', '内容', 'x'), null);
  const r = applyCandidate('能力:\n  - 编号: F01\n    能力: "a"\n    状态: 已确认\n', { id: null, section: '能力', fields: { 能力: '他说"好"\n用' }, quote: 'q', source: 's', conflict: [] });
  assert.equal(facts(r.text).find((x) => x.id === 'F02').capability, '他说”好” 用');
});

test('parseCandidates, splitChunks and the prompt', () => {
  assert.deepEqual(parseCandidates('```json\n[{"id":"NEW"}]\n```'), [{ id: 'NEW' }]);
  assert.deepEqual(parseCandidates('好的：[]'), []);
  assert.equal(parseCandidates('抱歉'), null);
  assert.equal(parseCandidates('[{oops}]'), null);
  const long = ('一句话。'.repeat(3000));
  const chunks = splitChunks(long, 5000);
  assert.ok(chunks.length >= 3 && chunks.every((c) => c.length <= 5000 && c.endsWith('。')));
  assert.equal(chunks.join(''), long);
  const p = extractPrompt({ shape: cardShape(TEMPLATE), source: 'a.md', chunk: 'X', lang: 'zh' });
  assert.match(p, /核心能力（F）：能力、限制/);
  assert.match(p, /B01 项目=名称 内容=（空）/);
  assert.match(p, /逐字照抄/);
});

test('readSource: files, a 来源 header, and fetched HTML', async () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-facts-')); dirs.push(d);
  writeFileSync(join(d, 'a.txt'), '来源: https://x.example/pricing\n价格正文');
  assert.deepEqual(await readSource(join(d, 'a.txt')), { name: 'https://x.example/pricing', text: '价格正文' });
  writeFileSync(join(d, 'b.html'), '<html><body><script>var a</script><p>你好 <b>世界</b></p></body></html>');
  assert.equal((await readSource(join(d, 'b.html'))).text, '你好 世界');
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => '<body><h1>定价</h1><p>每年 18 元</p></body>' });
  assert.deepEqual(await readSource('https://x.example/', { fetchImpl }), { name: 'https://x.example/', text: '定价 每年 18 元' });
  await assert.rejects(readSource('https://x.example/', { fetchImpl: async () => ({ ok: false, status: 404 }) }), /404/);
});

// A fake model: one real fact, one invented quote, one duplicate of the card.
function fakeModel(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body.messages[0].content);
    return { ok: true, status: 200, json: async () => ({ model: body.model, choices: [{ message: { content: typeof reply === 'function' ? reply(body.messages[0].content) : reply }, finish_reason: 'stop' }] }) };
  };
  return { fetchImpl, calls };
}
const REPLY = JSON.stringify([
  { id: 'B01', section: '基本信息', fields: { 项目: '名称', 内容: '小鹿记账' }, quote: '小鹿记账是一款不联网也能用的个人记账 App' },
  { id: 'NEW', section: '明确不支持', fields: { 内容: '多人共享账本' }, quote: '小鹿记账不支持多人共享账本。' },
  { id: 'NEW', section: '核心能力', fields: { 能力: '云同步' }, quote: '支持实时云同步' },
  { id: 'B03', section: '基本信息', fields: { 项目: '一句话说明' }, quote: '小鹿记账是一款不联网也能用的个人记账 App' },
]);

async function run(dir, argv, opts = {}) {
  const out = []; const err = []; const cwd = process.cwd();
  process.chdir(dir);
  try {
    const code = await main([...argv, '--lang', 'zh'], { env: { DEEPSEEK_API_KEY: 'sk-test' }, out: (s) => out.push(s), err: (s) => err.push(s), sleep: async () => {}, now: () => new Date('2026-10-20T09:00:00'), ...opts });
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally { process.chdir(cwd); }
}

test('CLI: extract keeps only quoted facts, skips unchanged material, then apply and ignore', async () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-facts-')); dirs.push(d);
  mkdirSync(join(d, 'geo', 'sources'), { recursive: true });
  writeFileSync(join(d, 'geo', 'fact-card.yaml'), TEMPLATE);
  writeFileSync(join(d, 'geo', 'sources', '产品说明.md'), MATERIAL);
  const m = fakeModel(REPLY);
  const r = await run(d, ['extract', '--ai', 'deepseek'], { fetchImpl: m.fetchImpl });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /新候选 2 条；丢弃：原文里找不到 1 条，格式不对 0 条，和事实卡重复 1 条/);
  assert.equal(m.calls.length, 1);
  assert.match(m.calls[0], /资料（来自 产品说明\.md）/);
  const saved = JSON.parse(readFileSync(join(d, 'geo', 'fact-candidates.json'), 'utf8'));
  assert.deepEqual(saved.items.map((c) => [c.cid, c.id, c.status, c.source]), [['c1', 'B01', 'new', '产品说明.md'], ['c2', null, 'new', '产品说明.md']]);

  const again = await run(d, ['extract', '--ai', 'deepseek'], { fetchImpl: m.fetchImpl });
  assert.match(again.out, /1 份资料没改过，跳过/);
  assert.equal(m.calls.length, 1, 'unchanged material is not sent again');
  const forced = await run(d, ['extract', '--ai', 'deepseek', '--force'], { fetchImpl: m.fetchImpl });
  assert.match(forced.out, /新候选 0 条/, 'the same candidates are not added twice');

  assert.match((await run(d, ['list'])).out, /c1  B01  基本信息  项目=名称；内容=小鹿记账\n    原文：「小鹿记账是一款不联网也能用的个人记账 App」（产品说明\.md）/);
  const a = await run(d, ['apply', 'c1']);
  assert.match(a.out, /c1→B01/);
  assert.equal(facts(readFileSync(join(d, 'geo', 'fact-card.yaml'), 'utf8')).find((e) => e.id === 'B01').value, '小鹿记账');
  assert.equal((await run(d, ['ignore', 'c2'])).code, 0);
  assert.equal((await run(d, ['list'])).out, '没有待处理的候选。');
  assert.match((await run(d, ['list', '--all'])).out, /\[已忽略\]/);
  assert.equal((await run(d, ['apply', 'c9'])).code, 1);
});

test('CLI: errors for a missing key, card, material, and a failed request', async () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-facts-')); dirs.push(d);
  mkdirSync(join(d, 'geo'));
  assert.match((await run(d, ['extract', '--ai', 'deepseek'])).err, /找不到事实卡/);
  writeFileSync(join(d, 'geo', 'fact-card.yaml'), TEMPLATE);
  assert.equal((await run(d, ['extract'])).code, 2);
  assert.match((await run(d, ['extract', '--ai', 'deepseek'], { env: {} })).err, /DEEPSEEK_API_KEY/);
  assert.match((await run(d, ['extract', '--ai', 'deepseek'])).err, /没有资料/);
  writeFileSync(join(d, 'm.md'), MATERIAL);
  const failing = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) });
  const r = await run(d, ['extract', 'm.md', '--ai', 'deepseek'], { fetchImpl: failing });
  assert.equal(r.code, 1);
  assert.match(r.err, /m\.md 第 1 段失败/);
  assert.ok(!JSON.parse(readFileSync(join(d, 'geo', 'fact-candidates.json'), 'utf8')).done['m.md'], 'a failed source is tried again next time');
  assert.equal((await run(d, ['nope'])).code, 2);
  assert.ok(!existsSync(join(d, 'geo', 'sources')));
});
