// Tests for cli/geo-audit.mjs. Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { audit, parseRobots, isAllowed, parseArgs, formatMarkdown, formatText, visibleText, badgeColor, badgeInfo, badgeSvg, BADGE_MIN, cardSvg, cropPngHeight, findBrowser, renderPng } from '../cli/geo-audit.mjs';
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BODY = '<p>' + '团队版每月 299 元，含 20 个席位，超出部分每席 20 元。'.repeat(12) + '</p>';
const page = (head, body = BODY, lang = ' lang="zh-CN"') =>
  `<!doctype html><html${lang}><head><title>价格</title><meta name="description" content="d">${head}</head><body><h1>价格</h1>${body}</body></html>`;

let server; let base;
let robots = 'User-agent: *\nAllow: /\nSitemap: http://example.invalid/sitemap.xml\n';
const routes = {
  '/good': () => [200, {}, page('<link rel="canonical" href="/good">')],
  '/short': () => [200, {}, page('<link rel="canonical" href="/short">', '<p>团队版每月 299 元，含 20 个席位。</p>')],
  '/loading': () => [200, {}, '<html lang="zh"><head><title>价格</title></head><body><div id="app">加载中…</div><noscript>请启用 JavaScript</noscript><script src="/app.js"></script></body></html>'],
  '/padded-shell': () => [200, {}, page('', '<nav>首页 产品介绍 价格方案 客户案例 帮助中心 关于我们 联系我们 加入我们</nav><div id="root">加载中…</div><footer>© 2026 某某科技有限公司 版权所有 京ICP备12345678号 京公网安备11010502012345号 地址：北京市海淀区某某路 1 号 联系电话 010-12345678</footer>')],
  '/ssr-app': () => [200, {}, page('', '<div id="app"><p>团队版每月 299 元，含 20 个席位，超出部分每席 20 元。适合 5 到 50 人的团队。</p></div>')],
  '/empty': () => [200, {}, '<html><head><title>价格</title></head><body><div id="app"></div></body></html>'],
  '/invalid-entity': () => [200, {}, page('', BODY + '<p>&#x110000; &#99999999;</p>')],
  '/href-first': () => [200, {}, page('<link href="/href-first" rel="canonical">')],
  '/canon-home': () => [200, {}, page('<link rel="canonical" href="/">')],
  '/noindex': () => [200, {}, page('<meta\n  name="robots"\n  content="noindex, follow">')],
  '/header-noindex': () => [200, { 'x-robots-tag': 'googlebot: noindex' }, page('')],
  '/shell': () => [200, {}, page('', '<div id="app"></div><script>render("团队版每月 299 元")</script>')],
  '/split': () => [200, {}, page('', BODY + '<p>高级版<b>每月 599 元</b></p>')],
  '/redirect': () => [301, { location: '/good' }, ''],
  '/missing': () => [404, {}, 'not found'],
  '/waf': (req) => (/bot/i.test(req.headers['user-agent']) && !/geo-doctor/.test(req.headers['user-agent'])
    ? [403, {}, 'blocked'] : [200, {}, page('')]),
  '/bad-canon': () => [200, {}, page('<link rel="canonical" href="http://[">')],
  '/meta-only': () => [200, {}, page('<meta property="og:description" content="旗舰版每月 999 元">')],
  '/jsonld': () => [200, {}, page('<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product"},{"@type":"Offer"}]}</script>')],
};

before(async () => {
  server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/robots.txt') {
      const [st, txt] = typeof robots === 'number' ? [robots, ''] : [200, robots];
      res.writeHead(st, { 'content-type': 'text/plain' }); return res.end(txt);
    }
    const r = routes[path];
    if (!r) { res.writeHead(404); return res.end(); }
    const [status, headers, body] = r(req);
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
    res.end(body);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const find = (r, section, status) => r.checks.filter((c) => c.section === section && c.status === status);

test('robots: longest match wins, Allow wins ties, named group overrides *', () => {
  const r = parseRobots(`User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nUser-agent: OAI-SearchBot\nDisallow: /private/\nAllow: /private/public\n\nSitemap: https://x/s.xml`);
  assert.equal(isAllowed(r, 'Googlebot', '/a'), false);
  assert.equal(isAllowed(r, 'OAI-SearchBot', '/a'), true);
  assert.equal(isAllowed(r, 'GPTBot', '/private/x'), false);
  assert.equal(isAllowed(r, 'GPTBot', '/private/public/y'), true);
  assert.deepEqual(r.sitemaps, ['https://x/s.xml']);
});

test('robots: wildcards and $', () => {
  const r = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /search?\n');
  assert.equal(isAllowed(r, 'Bingbot', '/a.pdf'), false);
  assert.equal(isAllowed(r, 'Bingbot', '/a.pdf?x=1'), true);
  assert.equal(isAllowed(r, 'Bingbot', '/search?q=1'), false);
  assert.equal(isAllowed(r, 'Bingbot', '/searching'), true);
});

test('robots: non-ASCII and percent-encoded paths compare in one encoding (RFC 9309)', () => {
  const r = parseRobots('User-agent: *\nDisallow: /私有/\nDisallow: /%7Euser/\n');
  assert.equal(isAllowed(r, 'Googlebot', new URL('https://x/私有/a').pathname), false);
  assert.equal(isAllowed(r, 'Googlebot', '/~user/page'), false);
  assert.equal(isAllowed(r, 'Googlebot', '/公开/a'), true);
});

test('healthy page scores 100', async () => {
  const r = await audit(base + '/good', { lang: 'en', phrase: '团队版每月 299 元' });
  assert.equal(r.problems, 0, JSON.stringify(r.checks, null, 1));
  assert.equal(r.score, 100);
});

test('short readable pages are not penalized solely for character count', async () => {
  for (const lang of ['en', 'zh']) {
    const r = await audit(base + '/short', { lang, probe: false, phrase: '团队版每月 299 元' });
    assert.equal(find(r, 'content', 'fail').length, 0);
    assert.equal(r.score, 100);
    assert.ok(find(r, 'content', 'info').length > 0, 'short text gets a verification reminder');
  }
});

test('empty bodies still trigger a critical content failure', async () => {
  const r = await audit(base + '/empty', { probe: false });
  assert.ok(find(r, 'content', 'fail').some((c) => c.critical));
  assert.ok(r.score <= 60);
});

test('a JS shell with only a loading message is still a critical failure', async () => {
  const r = await audit(base + '/loading', { lang: 'zh', probe: false });
  const fail = find(r, 'content', 'fail');
  assert.ok(fail.some((c) => c.critical && /空壳页/.test(c.msg)));
  assert.ok(r.score <= 60);
});

test('an empty SPA mount point padded with nav/footer text is still a shell', async () => {
  const r = await audit(base + '/padded-shell', { lang: 'zh', probe: false });
  assert.ok(find(r, 'content', 'fail').some((c) => c.critical && /空壳页/.test(c.msg)));
  const ok = await audit(base + '/ssr-app', { lang: 'zh', probe: false });
  assert.equal(find(ok, 'content', 'fail').length, 0, 'server-rendered content inside #app is fine');
});

test('invalid numeric HTML references cannot crash text extraction or an audit', async () => {
  assert.equal(visibleText('<p>&#x110000; &#99999999; &#0; &#xD800;</p>'), '� � � �');
  assert.equal(visibleText('<p>&#65; &#x1F600; &amp;</p>'), 'A 😀 &');
  const r = await audit(base + '/invalid-entity');
  assert.equal(find(r, 'access', 'fail').length, 0);
  assert.ok(find(r, 'content', 'pass').length > 0);
});

test('canonical: attribute order and relative URLs', async () => {
  for (const p of ['/good', '/href-first']) {
    const r = await audit(base + p, { lang: 'en', probe: false });
    assert.equal(find(r, 'canonical', 'pass').length, 1, p);
  }
  const r = await audit(base + '/canon-home', { lang: 'en', probe: false });
  assert.match(find(r, 'canonical', 'warn')[0].msg, /points elsewhere/);
});

test('noindex in multi-line meta and in header', async () => {
  const a = await audit(base + '/noindex', { lang: 'en', probe: false });
  assert.match(find(a, 'index', 'fail')[0].msg, /robots meta/);
  assert.ok(a.score <= 60, 'a critical failure caps the score');
  const b = await audit(base + '/header-noindex', { lang: 'en', probe: false });
  assert.match(find(b, 'index', 'fail')[0].msg, /X-Robots-Tag/);
});

test('JS shell: thin text and phrase only inside a script', async () => {
  const r = await audit(base + '/shell', { lang: 'en', probe: false, phrase: '团队版每月 299 元' });
  const fails = find(r, 'content', 'fail').map((c) => c.msg).join('\n');
  assert.match(fails, /JS-rendered shell/);
  assert.match(fails, /only appears inside <script>/);
});

test('phrase split across tags is a warning', async () => {
  const r = await audit(base + '/split', { lang: 'en', probe: false, phrase: '高级版每月 599 元' });
  assert.match(find(r, 'content', 'warn').map((c) => c.msg).join(), /split across tags/);
});

test('redirects are counted and followed', async () => {
  const r = await audit(base + '/redirect', { lang: 'en', probe: false });
  assert.equal(r.finalUrl, base + '/good');
  assert.match(find(r, 'access', 'warn')[0].msg, /1 redirect/);
});

test('404 page fails', async () => {
  const r = await audit(base + '/missing', { lang: 'en', probe: false });
  assert.match(find(r, 'access', 'fail')[0].msg, /404/);
  assert.ok(r.score < 70);
});

test('robots blocking a search bot fails, training bot is info only', async () => {
  robots = 'User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /\n';
  try {
    const r = await audit(base + '/good', { lang: 'en', probe: false });
    assert.match(find(r, 'robots', 'fail')[0].msg, /OAI-SearchBot/);
    assert.match(find(r, 'robots', 'info')[0].msg, /GPTBot/);
    assert.equal(find(r, 'robots', 'fail').length, 1);
  } finally {
    robots = 'User-agent: *\nAllow: /\n';
  }
});

test('unreachable robots.txt (5xx) is a critical failure, not a pass', async () => {
  robots = 503;
  try {
    const r = await audit(base + '/good', { lang: 'en', probe: false });
    assert.match(find(r, 'robots', 'fail')[0].msg, /503/);
    assert.equal(find(r, 'robots', 'pass').length, 0);
    assert.ok(r.score <= 60);
  } finally {
    robots = 'User-agent: *\nAllow: /\n';
  }
});

test('malformed canonical is a warning, not a crash', async () => {
  const r = await audit(base + '/bad-canon', { lang: 'en', probe: false });
  assert.match(find(r, 'canonical', 'warn')[0].msg, /can't be parsed/);
});

test('phrase only in a head attribute does not count as visible', async () => {
  const r = await audit(base + '/meta-only', { lang: 'en', probe: false, phrase: '旗舰版每月 999 元' });
  assert.match(find(r, 'content', 'fail')[0].msg, /attributes or <head>/);
});

test('firewall probe detects UA-based blocking', async () => {
  const r = await audit(base + '/waf', { lang: 'en' });
  assert.match(find(r, 'firewall', 'fail')[0].msg, /403/);
});

test('JSON-LD types are listed', async () => {
  const r = await audit(base + '/jsonld', { lang: 'en', probe: false });
  assert.match(find(r, 'discovery', 'pass').map((c) => c.msg).join(), /Product, Offer/);
});

test('Chinese output and Markdown report', async () => {
  const r = await audit(base + '/good', { lang: 'zh', probe: false });
  assert.match(r.checks[0].msg, /最终状态码 200/);
  const md = formatMarkdown([r], 'zh');
  assert.match(md, /\| \*\*\d+\*\* \|/);
});

test('argument parsing', () => {
  const o = parseArgs(['a.com', 'https://b.com,c.com', '--phrase', 'x y', '--fail-under', '80', '--no-probe']);
  assert.deepEqual(o.urls, ['a.com', 'https://b.com', 'c.com']);
  assert.equal(o.phrase, 'x y');
  assert.equal(o.failUnder, 80);
  assert.equal(o.probe, false);
});

test('invalid CLI option values are rejected rather than silently ignored', () => {
  for (const flag of ['--phrase', '--report', '--lang', '--fail-under', '--badge']) {
    assert.throws(() => parseArgs(['a.com', flag]), /requires a value/);
    assert.throws(() => parseArgs(['a.com', flag, '--json']), /requires a value/);
  }
  for (const value of ['eighty', 'NaN', 'Infinity', '-1', '101', '', ' ']) {
    assert.throws(() => parseArgs(['a.com', '--fail-under', value]), /--fail-under/);
  }
  assert.throws(() => parseArgs(['a.com', '--lang', 'fr']), /--lang/);
  assert.throws(() => parseArgs(['a.com', '--report', '']), /--report/);
  for (const value of ['0', '80.5', '100']) {
    assert.equal(parseArgs(['a.com', '--fail-under', value]).failUnder, Number(value));
  }
});

test('CLI exits 2 with a useful error for an invalid CI threshold', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await assert.rejects(
    promisify(execFile)(process.execPath, [new URL('../cli/geo-audit.mjs', import.meta.url).pathname,
      base + '/good', '--no-probe', '--fail-under', 'eighty'], { timeout: 5000 }),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /--fail-under/);
      assert.equal(error.stdout, '', 'invalid options must not start an audit');
      return true;
    },
  );
});

test('--report creates missing folders', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const dir = mkdtempSync(join(tmpdir(), 'geo-'));
  try {
    // Async so this process can keep serving the fixture page while the CLI fetches it.
    await promisify(execFile)(process.execPath, [new URL('../cli/geo-audit.mjs', import.meta.url).pathname, base + '/good', '--no-probe', '--lang', 'zh', '--report', 'geo/audit.md'], { cwd: dir });
    assert.match(readFileSync(join(dir, 'geo/audit.md'), 'utf8'), /最终状态码 200/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('badge colour follows the score; a critical failure (capped at 60) is red', () => {
  assert.equal(badgeColor(100).name, 'brightgreen');
  assert.equal(badgeColor(90).name, 'brightgreen');
  assert.equal(badgeColor(89).name, 'green');
  assert.equal(badgeColor(80).name, 'green');
  assert.equal(badgeColor(79).name, 'yellow');
  assert.equal(badgeColor(61).name, 'yellow');
  assert.equal(badgeColor(60).name, 'red');
  assert.equal(badgeColor(0).name, 'red');
});

test('badge links explain the score and escape shields.io paths', () => {
  const b = badgeInfo(85, 'zh', '2026-10-16');
  assert.equal(b.image, 'https://img.shields.io/badge/GEO%20%E4%BD%93%E6%A3%80-85%2F100-green');
  assert.equal(b.link, 'https://github.com/Fangx-AI/geo-doctor#badge');
  assert.match(b.alt, /2026-10-16/);
  assert.equal(b.markdown, `[![${b.alt}](${b.image})](${b.link})`);
  assert.match(b.html, /^<a href="https:\/\/github\.com\/Fangx-AI\/geo-doctor#badge"><img src="https:\/\/img\.shields\.io\/badge\/[^"]+" alt="[^"]+"><\/a>$/);
  const en = badgeInfo(42, 'en');
  assert.match(en.image, /\/GEO%20audit-42%2F100-red$/);
  assert.equal(en.link, 'https://github.com/Fangx-AI/geo-doctor/blob/master/README.en.md#badge');
});

test('badge SVG is self-contained, sized to its text and escaped', () => {
  const svg = badgeSvg(95, 'zh', '2026-10-16');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="20"/);
  assert.match(svg, /<title>GEO 体检 95\/100（2026-10-16/);
  assert.match(svg, /fill="#4c1"/);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg), 'no external resources');
  const wide = Number(badgeSvg(100, 'en').match(/width="(\d+)"/)[1]);
  const narrow = Number(badgeSvg(5, 'en').match(/width="(\d+)"/)[1]);
  assert.ok(wide > narrow);
});

test('audit results carry a badge; text output only offers it at a good score', async () => {
  const good = await audit(base + '/good', { lang: 'zh', probe: false });
  assert.ok(good.score >= BADGE_MIN);
  assert.equal(good.badge.message, `${good.score}/100`);
  assert.match(formatText(good, 'zh'), /徽章[\s\S]*img\.shields\.io/);
  const shell = await audit(base + '/empty', { lang: 'zh', probe: false });
  assert.ok(shell.score < BADGE_MIN);
  const text = formatText(shell, 'zh');
  assert.ok(!text.includes('img.shields.io'));
  assert.match(text, new RegExp(`修到 ${BADGE_MIN} 分以上`));
});

test('Markdown report offers a badge only when the lowest score reaches BADGE_MIN', async () => {
  const good = await audit(base + '/good', { lang: 'en', probe: false });
  const good2 = await audit(base + '/good', { lang: 'en', probe: false });
  const md = formatMarkdown([good, good2], 'en');
  assert.match(md, /## 📛 Audit badge/);
  assert.ok(md.includes(good.badge.markdown));
  assert.ok(md.includes(good.badge.html));
  assert.match(md, /lowest score/);
  const shell = await audit(base + '/empty', { lang: 'en', probe: false });
  const mixed = formatMarkdown([good, shell], 'en');
  assert.ok(!mixed.includes('img.shields.io'));
  assert.ok(!mixed.includes('## 📛'));
  assert.match(mixed, new RegExp(`Reach ${BADGE_MIN}\\+`));
});

test('--badge writes an SVG with the lowest score', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const dir = mkdtempSync(join(tmpdir(), 'geo-'));
  try {
    const { stderr } = await promisify(execFile)(process.execPath, [new URL('../cli/geo-audit.mjs', import.meta.url).pathname,
      base + '/good', base + '/empty', '--no-probe', '--lang', 'en', '--badge', 'badges/geo.svg'], { cwd: dir });
    const svg = readFileSync(join(dir, 'badges/geo.svg'), 'utf8');
    const shell = await audit(base + '/empty', { lang: 'en', probe: false });
    assert.match(svg, new RegExp(`>${shell.score}/100<`));
    assert.match(stderr, /Badge written to badges\/geo\.svg/);
    assert.equal(parseArgs(['a.com', '--badge', 'x.svg']).badge, 'x.svg');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const SAMPLE = { url: 'https://shop.example/pricing', finalUrl: 'https://shop.example/pricing', score: 72, passed: 12, warnings: 3, problems: 1, checks: [
  { section: 'access', status: 'pass' }, { section: 'robots', status: 'pass' }, { section: 'robots', status: 'fail' },
  { section: 'content', status: 'warn' }, { section: 'discovery', status: 'info' }] };

test('share card: score, host, worst status per section, honest footer', () => {
  const svg = cardSvg(SAMPLE, 'zh', '2026-10-16');
  assert.match(svg, /^<svg[^>]+width="1200" height="630"/);
  assert.match(svg, />72</);
  assert.match(svg, />shop\.example\/pricing</);
  assert.match(svg, /robots\.txt 与 AI 爬虫<\/text><text[^>]+fill="#ef4444"[^>]*>问题</);
  assert.match(svg, /正文与页面信息<\/text><text[^>]+>注意</);
  assert.ok(!svg.includes('发现与结构化数据'), 'info-only sections are left out');
  assert.match(svg, /不代表 AI 会推荐/);
  assert.match(svg, /github\.com\/Fangx-AI\/geo-doctor/);
  assert.match(cardSvg({ ...SAMPLE, url: 'not a url <x>', finalUrl: undefined }, 'en'), /&lt;x&gt;/);
  const long = cardSvg({ ...SAMPLE, finalUrl: 'https://example.com/' + 'a'.repeat(200) }, 'en');
  assert.match(long, /a…<\/text>/);
});

test('share card: PNG crop keeps the top rows and stays a valid PNG', () => {
  // Build a 2×4 RGB PNG whose rows are red, green, blue, white, then keep 2 rows.
  const rows = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]].map((c) => Buffer.from([0, ...c, ...c]));
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const o = Buffer.alloc(12 + data.length); o.writeUInt32BE(data.length, 0); o.write(type, 4, 'latin1'); data.copy(o, 8); o.writeUInt32BE(crc(o.subarray(4, 8 + data.length)), 8 + data.length); return o; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
  const out = cropPngHeight(png, 2);
  assert.equal(out.readUInt32BE(16), 2, 'width');
  assert.equal(out.readUInt32BE(20), 2, 'height');
  const len = out.readUInt32BE(33);
  assert.equal(out.toString('latin1', 37, 41), 'IDAT');
  assert.deepEqual(inflateSync(out.subarray(41, 41 + len)), Buffer.concat(rows.slice(0, 2)));
  assert.equal(out.readUInt32BE(41 + len), crc(out.subarray(37, 41 + len)), 'IDAT crc');
  assert.equal(cropPngHeight(png, 10), png, 'shorter images are returned as is');
});

test('share card: browser lookup uses CHROME_PATH, then the usual install paths', () => {
  // The simulated platform decides the separators: join() follows the host, so a
  // Windows checkout must not compare against POSIX paths.
  // findBrowser joins with the host's path.join, so the expectation must too:
  // a Windows checkout yields backslashes even when 'linux' is simulated.
  assert.equal(findBrowser({ CHROME_PATH: '/x/chrome' }, 'linux', (p) => p === '/x/chrome'), '/x/chrome');
  assert.equal(findBrowser({ PATH: '/usr/bin:/opt/bin' }, 'linux', (p) => p === join('/opt/bin', 'chromium')), join('/opt/bin', 'chromium'));
  assert.equal(findBrowser({}, 'darwin', (p) => p.includes('Microsoft Edge')), '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  assert.match(findBrowser({ PROGRAMFILES: 'C:/PF' }, 'win32', (p) => p.endsWith('chrome.exe')), /Google.Chrome.Application.chrome\.exe$/);
  assert.equal(findBrowser({ PATH: '/usr/bin' }, 'linux', () => false), null);
  assert.equal(renderPng('<svg/>', '/nowhere.png', null), false);
});

test('share card: renders a 1200×630 PNG when a browser is available', { skip: !findBrowser() && 'no Chrome/Edge (set CHROME_PATH to run)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'geo-card-test-'));
  try {
    const file = join(dir, 'card.png');
    assert.equal(renderPng(cardSvg(SAMPLE, 'en'), file), true);
    const png = readFileSync(file);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('parseArgs reads --card', () => {
  assert.equal(parseArgs(['https://a.example', '--card', 'out/card.png']).card, 'out/card.png');
});
