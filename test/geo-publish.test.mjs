// Tests for cli/geo-publish.mjs. Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseDraft, loadDrafts, publicBody, parseFacts, mdToHtml, mdToText, checkDrafts, similarity,
  articleHtml, renderFor, readLog, appendLog, parseArgs, main, toDevto, devtoTags, devtoArticles, fillItems, fillJson, fillUserscript,
} from '../cli/geo-publish.mjs';
import { audit } from '../cli/geo-audit.mjs';

const FACTS = `基本信息:
  - 编号: B01
    项目: 名称
    内容: "小鹿记账"
    状态: 已确认
  - 编号: F01
    内容: "离线可用"
    状态: 已确认   # 帮助中心
  - 编号: P01
    内容: "高级版 30 元/年"
    状态: 未知
`;

const BODY = `# 不用联网也能记账吗？

**能。** 小鹿记账在没有网络时可以正常记账、查看账单和统计图表，联网后自动同步到云端（截至 2026 年 10 月）。

## 离线时能做什么

- 新增、修改、删除账目
- 查看本月和历史账单，
  包括按分类筛选
- 查看分类统计图

## 离线时不能做什么

| 功能 | 离线 | 说明 |
| --- | --- | --- |
| 多设备同步 | 不能 | 联网后自动补同步 |

适合经常在地铁、飞机上记账的人。不适合需要多人实时共享账本的家庭：共享账本要联网才能看到对方的记录，导入微信账单也要联网解析。更多说明见 [帮助中心](https://example.com/help)。

<!-- 内部备注：这段不发布 -->

## 核对表

| 句子 | 事实卡 |
| --- | --- |
| 离线可用 | F01 |
`;

const draft = (meta, body = BODY) => `---\n${Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}`;
const GOOD = {
  title: '不用联网也能记账吗？', slug: 'offline-budget-app', question: '有没有不用联网也能用的记账 App？',
  description: '小鹿记账离线模式能做什么、不能做什么。', lang: 'zh', platforms: '[site, zhihu, wechat, xiaohongshu, reddit]',
  facts: '[B01, F01]', tags: '[记账, 离线]', status: 'confirmed',
};

let root;
const setup = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'geo-pub-'));
  mkdirSync(join(dir, 'geo', 'drafts'), { recursive: true });
  writeFileSync(join(dir, 'geo', 'fact-card.yaml'), FACTS);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'geo', 'drafts', name), text);
  return join(dir, 'geo');
};
const run = async (argv, env = {}) => {
  const out = []; const err = [];
  const code = await main([...argv, '--lang', 'zh'], { env, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n') };
};
const cleanup = [];
after(() => { for (const d of cleanup) rmSync(d, { recursive: true, force: true }); });

test('front matter: inline lists, block lists, quotes, BOM and CRLF', () => {
  const { meta, body } = parseDraft('\uFEFF---\r\ntitle: "A: B"\r\nplatforms: [site, zhihu]\r\ntags:\r\n  - x\r\n  - \'y\'\r\n# comment\r\nstatus: draft\r\n---\r\nhello\r\n');
  assert.deepEqual(meta, { title: 'A: B', platforms: ['site', 'zhihu'], tags: ['x', 'y'], status: 'draft' });
  assert.equal(body, 'hello\n');
  assert.equal(parseDraft('no front matter').meta, null);
});

test('public body drops comments, the internal check table and a repeated H1', () => {
  const d = { title: '不用联网也能记账吗？', body: BODY };
  const b = publicBody(d);
  assert.ok(!b.includes('核对表'));
  assert.ok(!b.includes('内部备注'));
  assert.ok(!b.startsWith('# '));
  assert.ok(b.includes('## 离线时能做什么'));
  assert.ok(publicBody({ title: 'Other', body: '# Kept\n\ntext' }).startsWith('# Kept'));
});

test('fact card parser reads ids and statuses, ignoring trailing comments', () => {
  const f = parseFacts(FACTS);
  assert.equal(f.get('B01'), '已确认');
  assert.equal(f.get('F01'), '已确认');
  assert.equal(f.get('P01'), '未知');
});

test('Markdown to HTML: blocks, inline marks, escaping and unsafe links', () => {
  const h = mdToHtml('## T\n\npara *em* **b** `<x>` [l](https://a.example/?q=1&r=2)\n\n- a\n  more\n- b\n\n1. one\n\n> quote\n\n```\n<script>\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n<img src=x onerror=alert(1)> [x](javascript:alert(1))');
  assert.match(h, /<h2>T<\/h2>/);
  assert.match(h, /<em>em<\/em> <strong>b<\/strong> <code>&lt;x&gt;<\/code>/);
  assert.match(h, /href="https:\/\/a\.example\/\?q=1&amp;r=2"/);
  assert.match(h, /<ul><li>a more<\/li><li>b<\/li><\/ul>/);
  assert.match(h, /<ol><li>one<\/li><\/ol>/);
  assert.match(h, /<blockquote><p>quote<\/p><\/blockquote>/);
  assert.match(h, /<pre><code>&lt;script&gt;<\/code><\/pre>/);
  assert.match(h, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
  assert.ok(!h.includes('<img src=x'));
  assert.match(h, /href="#">x<\/a>/);
  assert.match(mdToHtml('p', { p: 'color:red' }), /<p style="color:red">p<\/p>/);
});

test('plain text keeps link text, list bullets and table cells', () => {
  const t = mdToText('# H\n\n- **a** [link](https://x)\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n![img](x.png)');
  assert.equal(t, 'H\n\n• a link\n\na | b\n1 | 2');
});

test('check: required fields, slugs, platforms, placeholders and fact status', () => {
  const geo = setup({
    'a.md': draft(GOOD),
    'b.md': draft({ title: 'X', slug: 'Bad Slug', question: 'q', status: 'confirmed', platforms: '[site, myspace]', facts: '[P01, Z99]' }, '小鹿记账[待确认]。'),
    'c.md': draft({ title: 'Y', slug: 'offline-budget-app', question: 'q', status: 'published' }),
    'd.md': 'no front matter',
  });
  cleanup.push(join(geo, '..'));
  const drafts = loadDrafts(join(geo, 'drafts'));
  const issues = checkDrafts(drafts, { facts: parseFacts(FACTS), lang: 'zh' });
  const codes = (file, level) => issues.filter((x) => x.file === file && (!level || x.level === level)).map((x) => x.code);
  assert.deepEqual(codes('a.md', 'error'), []);
  assert.deepEqual(codes('b.md', 'error').sort(), ['bad-platform', 'bad-slug', 'placeholder', 'unconfirmed-fact', 'unknown-fact'].sort());
  assert.ok(codes('c.md', 'error').includes('dup-slug'));
  assert.ok(codes('c.md', 'error').includes('bad-status'));
  assert.deepEqual(codes('d.md'), ['no-frontmatter']);
});

test('check: hype words, made-up reviews, short bodies and near duplicates are warnings', () => {
  const geo = setup({
    'a.md': draft(GOOD),
    'b.md': draft({ ...GOOD, slug: 'copy', title: '离线记账' }, BODY.replace('能。', '可以。')),
    'c.md': draft({ title: 'Z', slug: 'z', question: 'q', status: 'draft', lang: 'en' }, 'The best app, guaranteed. Customer review: love it. 网友评价：好用'),
  });
  cleanup.push(join(geo, '..'));
  const issues = checkDrafts(loadDrafts(join(geo, 'drafts')), { lang: 'zh' });
  const of = (f) => issues.filter((x) => x.file === f);
  assert.ok(of('b.md').some((x) => x.code === 'near-dup' && x.level === 'warn' && x.msg.includes('a.md')));
  const c = of('c.md');
  for (const code of ['hype', 'review', 'short', 'no-description', 'no-facts', 'draft']) assert.ok(c.some((x) => x.code === code), code);
  assert.ok(c.filter((x) => x.code === 'hype').length >= 2);
  assert.ok(c.every((x) => x.level !== 'error'));
  assert.ok(similarity('完全不同的一段文字内容在这里', 'Something else entirely here') < 0.1);
});

test('check: a denied claim ("不保证", "no guarantee") is not hype', () => {
  const geo = setup({
    'n.md': draft({ title: 'N', slug: 'n', question: 'q', status: 'draft', lang: 'en' }, '它不保证 AI 排名，也无法保证结果。We do not guarantee rankings, it doesn\'t guarantee clicks and offer no guarantee.'),
    'y.md': draft({ title: 'Y', slug: 'y', question: 'q', status: 'draft', lang: 'en' }, '不少用户首选它，我们保证效果。Results guaranteed. Not only the best, not just world-class.'),
  });
  cleanup.push(join(geo, '..'));
  const issues = checkDrafts(loadDrafts(join(geo, 'drafts')), { lang: 'zh' });
  const hype = (f) => issues.filter((x) => x.file === f && x.code === 'hype').map((x) => x.msg);
  assert.deepEqual(hype('n.md'), []);
  const y = hype('y.md').join(' ');
  for (const w of ['首选', '保证', 'guaranteed', 'the best', 'world-class']) assert.ok(y.includes(w), w);
});

test('CLI check exits 1 on errors and 0 when clean', async () => {
  const geo = setup({ 'a.md': draft(GOOD) });
  cleanup.push(join(geo, '..'));
  const ok = await run(['check', join(geo, 'drafts')]);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /可以发布的草稿/);
  writeFileSync(join(geo, 'drafts', 'b.md'), draft({ ...GOOD, slug: 'b', facts: '[P01]' }));
  const bad = await run(['check', join(geo, 'drafts'), '--json']);
  assert.equal(bad.code, 1);
  assert.ok(JSON.parse(bad.out).issues.some((x) => x.code === 'unconfirmed-fact'));
});

test('static site: confirmed drafts only, readable by AI crawlers, logged with URLs', async () => {
  const geo = setup({ 'a.md': draft(GOOD), 'w.md': draft({ title: 'W', slug: 'w', question: 'q', status: 'draft' }) });
  cleanup.push(join(geo, '..'));
  const out = join(geo, '..', 'site');
  const r = await run(['site', join(geo, 'drafts'), '--to', 'static', '--out', out, '--base-url', 'https://example.com/geo/']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /跳过 1 篇/);
  assert.ok(!existsSync(join(out, 'w.html')));
  const html = readFileSync(join(out, 'offline-budget-app.html'), 'utf8');
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.com\/geo\/offline-budget-app\.html">/);
  assert.match(html, /"@type":"Article"/);
  assert.ok(!html.includes('核对表'));
  assert.match(readFileSync(join(out, 'sitemap.xml'), 'utf8'), /<loc>https:\/\/example\.com\/geo\/offline-budget-app\.html<\/loc>/);
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /href="offline-budget-app\.html"/);
  const log = readLog(join(geo, 'published.csv'));
  assert.deepEqual([log[0].slug, log[0].platform, log[0].url], ['offline-budget-app', 'site', 'https://example.com/geo/offline-budget-app.html']);

  // The generated page should pass our own audit without problems.
  const srv = createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(200); return res.end('User-agent: *\nAllow: /\n'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html.replace(/https:\/\/example\.com\/geo\/offline-budget-app\.html/g, '/p'));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const a = await audit(`http://127.0.0.1:${srv.address().port}/p`, { lang: 'zh', probe: false });
    assert.equal(a.problems, 0);
    assert.ok(a.score >= 80, String(a.score));
  } finally { srv.close(); }
});

test('a missing fact card fails drafts that cite fact IDs', async () => {
  const geo = setup({ 'a.md': draft({ ...GOOD, facts: '[DOES-NOT-EXIST]' }) });
  cleanup.push(join(geo, '..'));
  rmSync(join(geo, 'fact-card.yaml'));
  const r = await run(['check', join(geo, 'drafts'), '--json']);
  assert.equal(r.code, 1);
  assert.ok(JSON.parse(r.out).issues.some((x) => x.code === 'no-fact-card'));
  const s = await run(['site', join(geo, 'drafts'), '--to', 'static', '--out', join(geo, '..', 'site')]);
  assert.equal(s.code, 1);
  assert.ok(!existsSync(join(geo, '..', 'site')));
  const typo = await run(['check', join(geo, 'drafts'), '--facts', join(geo, 'nope.yaml')]);
  assert.equal(typo.code, 2);
  assert.match(typo.err, /找不到事实卡/);
});

test('static site without --base-url logs no local path and pack adds no fake link', async () => {
  const geo = setup({ 'a.md': draft(GOOD) });
  cleanup.push(join(geo, '..'));
  const r = await run(['site', join(geo, 'drafts'), '--to', 'static', '--out', join(geo, '..', 'site')]);
  assert.equal(r.code, 0, r.err);
  assert.equal(readLog(join(geo, 'published.csv'))[0].url, '');
  const p = await run(['pack', join(geo, 'drafts'), '--platforms', 'zhihu']);
  assert.equal(p.code, 0, p.err);
  const md = readFileSync(join(geo, 'outbox', 'zhihu', 'offline-budget-app.md'), 'utf8');
  assert.ok(!md.includes('原文：'), md.slice(-200));
  assert.ok(!md.includes(geo));
});

test('static rebuild removes pages that are no longer published, and only those', async () => {
  const b = { ...GOOD, slug: 'second-page', title: '第二篇' };
  const geo = setup({ 'a.md': draft(GOOD), 'b.md': draft(b, BODY.replace('不用联网也能记账吗', '第二篇：离线记账')) });
  cleanup.push(join(geo, '..'));
  const out = join(geo, '..', 'site');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'about.html'), 'mine');
  assert.equal((await run(['site', join(geo, 'drafts'), '--to', 'static', '--out', out])).code, 0);
  assert.ok(existsSync(join(out, 'second-page.html')));
  writeFileSync(join(geo, 'drafts', 'b.md'), draft({ ...b, status: 'draft' }));
  const r = await run(['site', join(geo, 'drafts'), '--to', 'static', '--out', out]);
  assert.equal(r.code, 0, r.err);
  assert.ok(!existsSync(join(out, 'second-page.html')));
  assert.ok(existsSync(join(out, 'offline-budget-app.html')));
  assert.equal(readFileSync(join(out, 'about.html'), 'utf8'), 'mine');
  assert.doesNotMatch(readFileSync(join(out, 'index.html'), 'utf8'), /second-page/);
});

test('publishing refuses while a confirmed draft has errors', async () => {
  const geo = setup({ 'a.md': draft({ ...GOOD, facts: '[P01]' }) });
  cleanup.push(join(geo, '..'));
  const r = await run(['site', join(geo, 'drafts'), '--to', 'static', '--out', join(geo, '..', 'site')]);
  assert.equal(r.code, 1);
  assert.match(r.err, /先修好再发布/);
  assert.ok(!existsSync(join(geo, '..', 'site')));
});

let wp; let wpBase; const wpCalls = []; const posts = [];
before(async () => {
  wp = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    wpCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
    const send = (st, obj) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/hook' && req.method === 'POST') return send(200, { url: 'https://cms.example/p/1', status: 'queued' });
    if (req.headers.authorization !== 'Basic ' + Buffer.from('editor:app pass').toString('base64')) return send(401, { code: 'rest_not_logged_in', message: 'Sorry, you are not allowed to do that.' });
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/wp-json/wp/v2/posts' && req.method === 'GET') return send(200, posts.filter((p) => p.slug === u.searchParams.get('slug')));
    if (u.pathname === '/wp-json/wp/v2/posts' && req.method === 'POST') {
      const p = { id: posts.length + 1, ...JSON.parse(body) }; p.link = `https://blog.example/${p.slug}/`; posts.push(p); return send(201, p);
    }
    const m = u.pathname.match(/^\/wp-json\/wp\/v2\/posts\/(\d+)$/);
    if (m && req.method === 'POST') { const p = posts.find((x) => x.id === +m[1]); Object.assign(p, JSON.parse(body)); return send(200, p); }
    send(404, { message: 'nope' });
  });
  await new Promise((ok) => wp.listen(0, '127.0.0.1', ok));
  wpBase = `http://127.0.0.1:${wp.address().port}`;
});
after(() => wp.close());

test('WordPress: creates a draft, then updates the same slug instead of duplicating', async () => {
  const geo = setup({ 'a.md': draft(GOOD) });
  cleanup.push(join(geo, '..'));
  const args = ['site', join(geo, 'drafts'), '--to', 'wordpress', '--site', wpBase + '/', '--user', 'editor'];
  const noPass = await run(args);
  assert.equal(noPass.code, 2);
  assert.match(noPass.err, /GEO_WP_APP_PASSWORD/);
  const first = await run(args, { GEO_WP_APP_PASSWORD: 'app pass' });
  assert.equal(first.code, 0, first.err);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].status, 'draft');
  assert.equal(posts[0].title, GOOD.title);
  assert.ok(posts[0].content.includes('<h2>离线时能做什么</h2>'));
  assert.ok(!posts[0].content.includes('核对表'));
  const second = await run([...args, '--status', 'publish'], { GEO_WP_APP_PASSWORD: 'app pass' });
  assert.equal(second.code, 0, second.err);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].status, 'publish');
  assert.match(second.out, /已更新/);
  const wrong = await run(args, { GEO_WP_APP_PASSWORD: 'wrong' });
  assert.equal(wrong.code, 1);
  assert.match(wrong.err, /HTTP 401 · Sorry/);
  const log = readLog(join(geo, 'published.csv'));
  assert.equal(log.length, 2);
  assert.equal(log[1].url, 'https://blog.example/offline-budget-app/');
});

test('generic HTTP: token comes from an environment variable, payload has Markdown and HTML', async () => {
  const geo = setup({ 'a.md': draft(GOOD) });
  cleanup.push(join(geo, '..'));
  const args = ['site', join(geo, 'drafts'), '--to', 'http', '--endpoint', wpBase + '/hook', '--token-env', 'CMS_TOKEN', '--header', 'X-Site: main'];
  assert.equal((await run(args)).code, 2);
  wpCalls.length = 0;
  const r = await run(args, { CMS_TOKEN: 's3cret' });
  assert.equal(r.code, 0, r.err);
  const call = wpCalls.find((c) => c.url === '/hook');
  assert.equal(call.auth, 'Bearer s3cret');
  assert.equal(call.body.slug, 'offline-budget-app');
  assert.ok(call.body.markdown.includes('## 离线时能做什么'));
  assert.ok(call.body.html.includes('<h2>'));
  assert.ok(!call.body.markdown.includes('核对表'));
  assert.equal(readLog(join(geo, 'published.csv'))[0].url, 'https://cms.example/p/1');
  const dry = await run([...args, '--dry-run']);
  assert.match(dry.out, /\[演练\] POST/);
});

test('pack: one file per third-party platform, checklist, original link from the log', async () => {
  const geo = setup({ 'a.md': draft(GOOD) });
  cleanup.push(join(geo, '..'));
  appendLog(join(geo, 'published.csv'), { slug: 'offline-budget-app', platform: 'site', url: 'https://example.com/geo/offline-budget-app.html', status: 'publish' });
  const r = await run(['pack', join(geo, 'drafts'), '--brand', '小鹿记账']);
  assert.equal(r.code, 0, r.err);
  const box = join(geo, 'outbox');
  for (const f of ['zhihu/offline-budget-app.md', 'wechat/offline-budget-app.html', 'xiaohongshu/offline-budget-app.txt', 'reddit/offline-budget-app.md', 'README.md']) assert.ok(existsSync(join(box, f)), f);
  assert.ok(!existsSync(join(box, 'site')));
  assert.match(readFileSync(join(box, 'zhihu/offline-budget-app.md'), 'utf8'), /原文：https:\/\/example\.com\/geo\/offline-budget-app\.html/);
  assert.match(readFileSync(join(box, 'wechat/offline-budget-app.html'), 'utf8'), /<p style="font-size:16px/);
  assert.match(readFileSync(join(box, 'reddit/offline-budget-app.md'), 'utf8'), /利益相关：我是小鹿记账团队成员/);
  const xhs = readFileSync(join(box, 'xiaohongshu/offline-budget-app.txt'), 'utf8');
  assert.ok(!xhs.includes('**') && !xhs.includes('https://'));
  assert.match(xhs, /#记账 #离线/);
  const list = readFileSync(join(box, 'README.md'), 'utf8');
  assert.match(list, /本人发布/);
  assert.match(list, /geo-publish log/);
  const only = await run(['pack', join(geo, 'drafts'), '--platforms', 'zhihu', '--out', join(geo, 'box2')]);
  assert.equal(only.code, 0);
  assert.ok(existsSync(join(geo, 'box2', 'zhihu')) && !existsSync(join(geo, 'box2', 'wechat')));
});

test('pack warns about Xiaohongshu limits and a missing brand for Reddit', () => {
  const d = { title: '一'.repeat(25), body: '字'.repeat(1200), meta: {}, tags: [], slug: 's', platforms: ['xiaohongshu'] };
  assert.equal(renderFor('xiaohongshu', d).warnings.length, 2);
  const r = renderFor('reddit', { ...d, title: 'T', body: 'b' }, { lang: 'en' });
  assert.match(r.text, /Disclosure: I work on \[your product\]\./);
  assert.equal(r.warnings.length, 1);
});

test('log command appends a published link; args need values', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'geo-log-')); cleanup.push(dir);
  const file = join(dir, 'p.csv');
  const r = await run(['log', '--slug', 'a', '--platform', 'zhihu', '--url', 'https://zhuanlan.zhihu.com/p/1', '--log', file]);
  assert.equal(r.code, 0);
  assert.deepEqual(readLog(file).map((x) => [x.slug, x.platform, x.url]), [['a', 'zhihu', 'https://zhuanlan.zhihu.com/p/1']]);
  assert.throws(() => parseArgs(['site', 'd', '--to']), /--to requires a value/);
  assert.equal((await run(['publish', 'x'])).code, 2);
  assert.equal((await run(['log', '--slug', 'a'])).code, 2);
});

test('article HTML escapes the title and keeps JSON-LD safe', () => {
  const h = articleHtml({ title: 'A </script><b>', lang: 'en', body: 'x', meta: { date: '2026-01-02' } });
  assert.ok(h.includes('<title>A &lt;/script&gt;&lt;b&gt;</title>'));
  assert.ok(!/<\/script><b>/.test(h));
  assert.ok(h.includes('\\u003c/script>'));
});

test('post --to devto: only confirmed drafts that list devto, key from the environment', async () => {
  const geo = setup({
    'a.md': draft({ ...GOOD, platforms: '[site, devto]' }),
    'b.md': draft({ ...GOOD, slug: 'zh-only', title: '只发知乎', platforms: '[zhihu]' }, BODY.replace('能。', '可以。')),
  });
  cleanup.push(join(geo, '..'));
  const noKey = await run(['post', join(geo, 'drafts'), '--to', 'devto']);
  assert.equal(noKey.code, 2);
  assert.match(noKey.err, /DEVTO_API_KEY/);
  assert.equal((await run(['post', join(geo, 'drafts'), '--to', 'zhihu'])).code, 2);
  const dry = await run(['post', join(geo, 'drafts'), '--to', 'devto', '--dry-run']);
  assert.equal(dry.code, 0);
  assert.match(dry.out, /offline-budget-app/);
  assert.doesNotMatch(dry.out, /zh-only/);
  const c = checkDrafts(loadDrafts(join(geo, 'drafts')), { lang: 'zh' });
  assert.ok(!c.some((x) => x.code === 'bad-platform'));
});

test('toDevto creates once, then updates the same title and never unpublishes', async () => {
  const d = loadDrafts(join(setup({ 'a.md': draft({ ...GOOD, platforms: '[devto]', tags: '[GEO, AI Search, open-source, 记账, extra]' }) }), 'drafts'))[0];
  const calls = []; let stored = [];
  const req = async (method, url, { headers, body } = {}) => {
    calls.push({ method, url, key: headers['api-key'], body });
    if (method === 'GET') return { ok: true, status: 200, json: stored };
    const a = { id: 7, title: body.article.title, published: body.article.published, url: 'https://dev.to/me/post-7' };
    stored = [a];
    return { ok: true, status: 200, json: a };
  };
  const t = { dry: (s) => s, httpFail: (c, m) => `${c} ${m}`, posted: (s, u, st) => `new ${u} ${st}`, repost: (s, u, st) => `upd ${u} ${st}` };
  const log = [];
  const first = await toDevto(d, { key: 'k', status: 'publish' }, t, (x) => log.push(x), req);
  assert.deepEqual(first, { url: 'https://dev.to/me/post-7', status: 'publish' });
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].key, 'k');
  assert.deepEqual(calls[1].body.article.tags, ['geo', 'aisearch', 'opensource', 'extra']);
  assert.doesNotMatch(calls[1].body.article.body_markdown, /核对表|内部备注/);
  const second = await toDevto(d, { key: 'k', status: 'draft' }, t, (x) => log.push(x), req);
  assert.equal(calls[3].method, 'PUT');
  assert.match(calls[3].url, /articles\/7$/);
  assert.equal(second.status, 'publish');
  assert.deepEqual(devtoTags(['A-b', 'a b', '中文']), ['ab']);
});

test('toDevto waits and retries when dev.to rate-limits, and reuses one article listing', async () => {
  const d = loadDrafts(join(setup({ 'a.md': draft({ ...GOOD, platforms: '[devto]' }) }), 'drafts'))[0];
  const calls = []; const slept = []; let posts = 0;
  const req = async (method, url) => {
    calls.push(method);
    if (method === 'GET') return { ok: true, status: 200, json: [] };
    posts++;
    if (posts < 3) return { ok: false, status: 429, json: { error: 'Rate limit reached' }, text: '', retryAfter: posts === 1 ? 5 : 0 };
    return { ok: true, status: 201, json: { id: 1, title: d.title, published: false, url: 'https://dev.to/x' } };
  };
  const t = { dry: (s) => s, httpFail: (c, m) => `${c} ${m}`, posted: () => 'new', repost: () => 'upd' };
  const existing = await devtoArticles('k', t, req);
  const r = await toDevto(d, { key: 'k', status: 'draft', existing }, t, () => {}, req, async (ms) => slept.push(ms));
  assert.equal(r.status, 'draft');
  assert.deepEqual(slept, [5000, 30000]);
  assert.deepEqual(calls, ['GET', 'POST', 'POST', 'POST']);
  assert.equal(existing.length, 1);
  const again = await toDevto(d, { key: 'k', status: 'draft', existing }, t, () => {}, async (m, u) => { calls.push(m); return { ok: true, status: 200, json: { url: 'https://dev.to/x', published: false } }; });
  assert.equal(again.url, 'https://dev.to/x');
  assert.equal(calls.at(-1), 'PUT');
});

test('toDevto reads the published state from published_at when dev.to omits published', async () => {
  const d = loadDrafts(join(setup({ 'a.md': draft({ ...GOOD, platforms: '[devto]' }) }), 'drafts'))[0];
  const t = { dry: (s) => s, httpFail: (c, m) => `${c} ${m}`, posted: () => 'new', repost: () => 'upd' };
  const reply = (json) => async (m) => (m === 'GET' ? { ok: true, status: 200, json: [] } : { ok: true, status: 201, json });
  const live = await toDevto(d, { key: 'k', status: 'publish', existing: [] }, t, () => {}, reply({ id: 1, url: 'https://dev.to/x', published_at: '2026-10-20T05:14:00Z' }));
  assert.equal(live.status, 'publish');
  const quiet = await toDevto(d, { key: 'k', status: 'draft', existing: [] }, t, () => {}, reply({ id: 2, url: 'https://dev.to/y', published_at: null }));
  assert.equal(quiet.status, 'draft');
});

test('fill helper: items for Zhihu (HTML) and Juejin (Markdown), and a userscript that only fills', () => {
  const d = loadDrafts(join(setup({ 'a.md': draft({ ...GOOD, platforms: '[site, zhihu, juejin, wechat]' }) }), 'drafts'))[0];
  const items = fillItems([d], { urlFor: () => 'https://x.example/articles/offline-budget-app.html' });
  assert.deepEqual(items.map((i) => `${i.key}:${i.format}`), ['zhihu/offline-budget-app:html', 'juejin/offline-budget-app:md']);
  const [zh, jj] = items;
  assert.equal(zh.title, GOOD.title);
  assert.match(zh.body, /^<p>/);
  assert.doesNotMatch(zh.body, /核对表|内部备注/);
  assert.match(zh.body, /原文：https:\/\/x\.example\/articles\/offline-budget-app\.html/);
  assert.doesNotMatch(jj.body, /^# /);
  assert.deepEqual(jj.tags, ['记账', '离线']);
  assert.equal(JSON.parse(fillJson(items)).items.length, 2);
  const js = fillUserscript({ manifestUrl: 'https://x.example/brand/fill.json', name: '小鹿记账' });
  assert.match(js, /^\/\/ ==UserScript==/);
  assert.match(js, /@match\s+https:\/\/zhuanlan\.zhihu\.com\/write\*/);
  assert.match(js, /@connect\s+x\.example/);
  assert.match(js, /@updateURL\s+https:\/\/x\.example\/brand\/geo-fill\.user\.js/);
  assert.match(js, /"manifest":"https:\/\/x\.example\/brand\/fill\.json"/);
  // It fills fields and stops: nothing that submits, publishes or touches login state.
  assert.doesNotMatch(js, /\.submit\(|document\.cookie|发布'\)\.click|publish.*click/i);
  new Function(js); // parses
});
