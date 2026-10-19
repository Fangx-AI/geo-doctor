// Tests for cli/geo-site.mjs. Run: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { parseFactCard, loadFacts, siteModel, faqItems, structuredData, buildSite, llmsTxt, workflowYaml, parseArgs, main } from '../cli/geo-site.mjs';
import { audit } from '../cli/geo-audit.mjs';

const CARD = `# 事实卡
基本信息:
  - 编号: B01
    项目: 名称
    内容: "小鹿记账"
    来源: "官网首页"
    状态: 已确认
  - 编号: B02
    项目: 别名
    内容: ["Fawn Budget", "小鹿"]
    状态: 已确认
  - 编号: B03
    项目: 一句话说明
    内容: "不联网也能用的个人记账 App"   # 注释
    状态: 已确认
  - 编号: B04
    项目: 类型
    内容: "App"
    状态: 已确认
  - 编号: B06
    项目: 主体公司
    内容: "小鹿科技 <b>"
    状态: 已确认
  - 编号: B07
    项目: 上线时间
    内容: "2020 年"
    状态: 未知
核心能力:
  - 编号: F01
    能力: "离线记账"
    限制: "换手机要手动导出"
    来源: "帮助中心 #2"
    状态: 已确认
  - 编号: F02
    能力: "AI 自动分类"
    状态: 来源冲突
价格:
  - 编号: P02
    项目: 套餐
    名称: "高级版"
    价格: "¥18/年"
    包含:
      - 多账本
      - 导出 Excel
    状态: 已确认
使用条件:
  - 编号: C01
    项目: 支持平台
    内容: [iOS, Android]
    状态: 已确认
和同类产品的区别:
  - 编号: D01
    对比对象: "随手记"
    区别: "不需要注册账号"
    状态: 已确认
公开证据:
  - 编号: E01
    类型: 应用商店
    地址: "https://apps.example.com/fawn"
    状态: 已确认
维护:
  确认人: "张三"
  确认日期: "2026-10-18"
`;

const EN_CARD = `basics:
  - id: B01
    item: name
    content: "Fawn Budget"
    status: confirmed
  - id: B03
    item: summary
    content: "An offline budgeting app"
    status: confirmed
pricing:
  - id: P02
    name: "Pro"
    price: "$4.99/year"
    status: confirmed
not for:
  - id: N01
    content: "Families sharing one ledger"
    status: confirmed
`;

const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'geo-site-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const quiet = () => { const lines = []; const push = (s) => lines.push(String(s)); return { lines, out: push, err: push }; };

test('parseFactCard reads sections, inline and block lists, comments and the maintenance map', () => {
  const s = parseFactCard(CARD);
  assert.equal(s['基本信息'][0]['内容'], '小鹿记账');
  assert.deepEqual(s['基本信息'][1]['内容'], ['Fawn Budget', '小鹿']);
  assert.equal(s['基本信息'][2]['内容'], '不联网也能用的个人记账 App');
  assert.equal(s['核心能力'][0]['来源'], '帮助中心 #2', 'a # inside quotes is not a comment');
  assert.deepEqual(s['价格'][0]['包含'], ['多账本', '导出 Excel']);
  assert.deepEqual(s['使用条件'][0]['内容'], ['iOS', 'Android']);
  assert.equal(s['维护']['确认日期'], '2026-10-18');
});

test('the bundled fact-card template parses, and nothing in it is confirmed', () => {
  const facts = loadFacts(parseFactCard(readFileSync('skills/geo-doctor/assets/fact-card.yaml', 'utf8')));
  assert.ok(facts.entries.length > 20);
  assert.equal(facts.confirmed.length, 0);
});

test('only confirmed facts reach the model, FAQ and pages', () => {
  const facts = loadFacts(parseFactCard(CARD));
  const m = siteModel(facts);
  assert.equal(m.name, '小鹿记账');
  assert.equal(m.launched, '', 'B07 is 未知');
  const html = buildSite(facts).map((f) => f.text).join('\n');
  assert.doesNotMatch(html, /2020 年|AI 自动分类/);
  assert.match(html, /离线记账（限制：换手机要手动导出）/);
  assert.match(html, /小鹿科技 &lt;b&gt;/, 'HTML is escaped');
});

test('FAQ questions follow the confirmed sections', () => {
  const qs = faqItems(loadFacts(parseFactCard(CARD)), 'zh').map((x) => x.q);
  assert.deepEqual(qs, ['小鹿记账是什么？', '小鹿记账多少钱？', '小鹿记账支持哪些平台，有什么使用条件？', '小鹿记账和随手记有什么区别？']);
});

test('structured data: SoftwareApplication with offers, platforms and sameAs', () => {
  const ld = structuredData(loadFacts(parseFactCard(CARD)), { url: 'https://x.example/' });
  assert.equal(ld['@type'], 'SoftwareApplication');
  assert.deepEqual(ld.alternateName, ['Fawn Budget', '小鹿']);
  assert.equal(ld.operatingSystem, 'iOS, Android');
  assert.deepEqual(ld.offers[0], { '@type': 'Offer', name: '高级版', price: '18', priceCurrency: 'CNY', description: '¥18/年' });
  assert.deepEqual(ld.sameAs, ['https://apps.example.com/fawn']);
});

test('pages carry JSON-LD that parses, and FAQPage lists every question', () => {
  const files = buildSite(loadFacts(parseFactCard(CARD)), { baseUrl: 'https://x.example/brand/' });
  const faq = files.find((f) => f.path === 'faq.html').text;
  const ld = JSON.parse(faq.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  assert.equal(ld['@type'], 'FAQPage');
  assert.equal(ld.mainEntity.length, 4);
  assert.match(files.find((f) => f.path === 'index.html').text, /<link rel="canonical" href="https:\/\/x.example\/brand\/">/);
  assert.match(files.find((f) => f.path === 'robots.txt').text, /Sitemap: https:\/\/x.example\/brand\/sitemap.xml/);
  assert.match(files.find((f) => f.path === 'sitemap.xml').text, /<lastmod>2026-10-18<\/lastmod>/);
  const json = JSON.parse(files.find((f) => f.path === 'facts.json').text);
  assert.equal(json.facts.length, 10);
});

test('without a base URL there is no sitemap and no canonical', () => {
  const files = buildSite(loadFacts(parseFactCard(CARD)));
  assert.ok(!files.some((f) => f.path === 'sitemap.xml'));
  assert.doesNotMatch(files.find((f) => f.path === 'index.html').text, /canonical/);
  assert.equal(files.find((f) => f.path === 'robots.txt').text, 'User-agent: *\nAllow: /\n');
});

test('English fact cards work and produce English pages', () => {
  const facts = loadFacts(parseFactCard(EN_CARD));
  assert.deepEqual(faqItems(facts, 'en').map((x) => x.q), ['What is Fawn Budget?', 'Who is Fawn Budget not for?', 'How much does Fawn Budget cost?']);
  assert.equal(structuredData(facts)['@type'], 'Product');
  assert.equal(structuredData(facts).offers[0].priceCurrency, 'USD');
  assert.match(llmsTxt(facts, { lang: 'en' }), /^# Fawn Budget\n\n> An offline budgeting app\n/);
});

test('build: confirmed, clean drafts become articles; others are left out; stale files are removed', async () => {
  const d = tmp();
  mkdirSync(join(d, 'geo', 'drafts'), { recursive: true });
  writeFileSync(join(d, 'geo', 'fact-card.yaml'), CARD);
  const draft = (slug, status, extra = '') => `---\ntitle: ${slug} 标题\nslug: ${slug}\nquestion: 有没有不联网的记账 App？\nstatus: ${status}\nfacts: [B03]\ndescription: 说明\n${extra}---\n小鹿记账是不联网也能用的个人记账 App [B03]。${'正文'.repeat(200)}\n`;
  writeFileSync(join(d, 'geo', 'drafts', 'a.md'), draft('offline', 'confirmed'));
  writeFileSync(join(d, 'geo', 'drafts', 'b.md'), draft('pending', 'draft'));
  writeFileSync(join(d, 'geo', 'drafts', 'c.md'), draft('broken', 'confirmed', 'platforms: [zhihu]\n'));
  const out = join(d, 'site');
  const q = quiet();
  assert.equal(await main(['build', '--facts', join(d, 'geo', 'fact-card.yaml'), '--drafts', join(d, 'geo', 'drafts'), '--out', out, '--base-url', 'https://x.example'], q), 0);
  assert.ok(existsSync(join(out, 'articles', 'offline.html')));
  assert.ok(!existsSync(join(out, 'articles', 'pending.html')));
  assert.ok(!existsSync(join(out, 'articles', 'broken.html')));
  assert.match(readFileSync(join(out, 'llms.txt'), 'utf8'), /\[offline 标题\]\(https:\/\/x.example\/articles\/offline.html\)/);
  assert.ok(q.lines.some((l) => /b\.md/.test(l) && /c\.md/.test(l)));

  writeFileSync(join(out, 'keep.html'), 'mine');
  writeFileSync(join(d, 'geo', 'drafts', 'a.md'), draft('offline', 'draft'));
  assert.equal(await main(['build', '--facts', join(d, 'geo', 'fact-card.yaml'), '--drafts', join(d, 'geo', 'drafts'), '--out', out], quiet()), 0);
  assert.ok(!existsSync(join(out, 'articles', 'offline.html')), 'unpublished article removed');
  assert.ok(!existsSync(join(out, 'sitemap.xml')), 'sitemap from the earlier run removed');
  assert.ok(existsSync(join(out, 'keep.html')), 'files geo-site did not write are kept');
});

test('build refuses a card without a confirmed name and summary', async () => {
  const d = tmp();
  writeFileSync(join(d, 'card.yaml'), readFileSync('skills/geo-doctor/assets/fact-card.yaml', 'utf8'));
  const q = quiet();
  assert.equal(await main(['build', '--facts', join(d, 'card.yaml'), '--out', join(d, 'site'), '--lang', 'zh'], q), 1);
  assert.match(q.lines.join('\n'), /B01、B03/);
  assert.ok(!existsSync(join(d, 'site')));
});

test('argument errors exit 2', async () => {
  assert.equal(await main(['build', '--facts', 'nope.yaml', '--out', 'x'], quiet()), 2);
  assert.equal(await main(['build', '--facts', 'nope.yaml'], quiet()), 2);
  assert.equal(await main(['publish'], quiet()), 2);
  assert.throws(() => parseArgs(['build', '--out']));
});

test('action writes a GitHub Pages workflow once and never overwrites it', async () => {
  const d = tmp(); const file = join(d, 'wf', 'geo-site.yml');
  assert.equal(await main(['action', '--file', file], quiet()), 0);
  const yml = readFileSync(file, 'utf8');
  assert.equal(yml, workflowYaml());
  assert.match(yml, /actions\/deploy-pages@v4/);
  assert.match(yml, /geo-site build --facts "geo\/fact-card.yaml"/);
  assert.match(yml, /geo-audit/);
  assert.equal(await main(['action', '--file', file], quiet()), 1);
});

test('the generated site scores 100 in geo-audit', async () => {
  const d = tmp(); const out = join(d, 'site');
  writeFileSync(join(d, 'card.yaml'), CARD);
  const types = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain', '.xml': 'application/xml', '.json': 'application/json' };
  const server = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const file = join(out, p);
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  try {
    assert.equal(await main(['build', '--facts', join(d, 'card.yaml'), '--out', out, '--base-url', base], quiet()), 0);
    for (const page of ['', 'faq.html']) {
      const r = await audit(base + page);
      assert.equal(r.score, 100, `${page || 'index'}: ${JSON.stringify(r.checks?.filter((c) => c.level !== 'ok'))}`);
    }
  } finally { server.close(); }
});
