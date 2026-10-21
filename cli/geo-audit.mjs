#!/usr/bin/env node
// geo-audit · geo-doctor
// Can AI search engines actually read your page? One command, no dependencies.
// AI 搜索能不能读到你的页面？一条命令，零依赖。
//
//   npx github:Fangx-AI/geo-doctor https://example.com/pricing
//
// Only fetches public pages. Nothing is sent anywhere else.
// 只读取公开页面，不向任何第三方发送数据。
// SPDX-License-Identifier: MIT

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { useEnvProxy } from './proxy.mjs';
import { deflateSync, inflateSync } from 'node:zlib';

export const VERSION = '1.2.0';
const DOCS = 'https://github.com/Fangx-AI/geo-doctor/blob/master/';
const BADGE_LINK = { zh: 'https://github.com/Fangx-AI/geo-doctor#badge', en: 'https://github.com/Fangx-AI/geo-doctor/blob/master/README.en.md#badge' };
const BROWSER_UA = 'Mozilla/5.0 (compatible; geo-doctor-audit/1.0; +https://github.com/Fangx-AI/geo-doctor)';

// Crawlers that decide whether you can appear in AI / web search answers.
// 决定你能否出现在 AI 搜索 / 网页搜索回答里的爬虫。
export const SEARCH_BOTS = [
  'Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot',
  'Perplexity-User', 'Claude-SearchBot', 'Claude-User', 'Baiduspider',
];
// Training-only tokens: blocking them does not remove you from search. Reported as info.
// 训练用途：屏蔽它们不会让你从搜索里消失，只作提示。
export const TRAINING_BOTS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Bytespider'];
// User-agent strings used only to detect firewall / CDN rules that block by UA.
// 仅用于检测按 UA 拦截的防火墙 / CDN 规则。
const PROBE_UAS = {
  'OAI-SearchBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
  'PerplexityBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'Claude-SearchBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)',
};

// ---------------------------------------------------------------- messages

const M = {
  zh: {
    title: 'GEO 体检', score: '得分', sep: '：',
    pass: '通过', warn: '注意', fail: '问题', info: '提示',
    sections: { access: '① 访问与跳转', robots: '② robots.txt 与 AI 爬虫', firewall: '③ 防火墙 / CDN', index: '④ 索引控制', canonical: '⑤ 规范地址', content: '⑥ 正文与页面信息', discovery: '⑦ 发现与结构化数据' },
    status: (c) => `最终状态码 ${c}`,
    statusBad: (c) => `最终状态码 ${c}：4xx/5xx 时 AI 读不到正文`,
    noRedirect: '无跳转',
    redirects: (n, u) => `经过 ${n} 次跳转到 ${u}：站内链接和 sitemap 尽量直接用最终地址`,
    fetchFail: (e) => `请求失败：${e}（检查网络、证书或域名）`,
    robots404: '没有 robots.txt（404 表示不限制抓取）',
    robotsOther: (c) => `robots.txt 返回 ${c}：按 RFC 9309，读不到 robots.txt 时爬虫会当作整站禁止抓取，先修好它`,
    searchOk: (n) => `${n} 个搜索类爬虫都可以抓取这个页面`,
    searchBlocked: (b) => `${b} 被 robots.txt 禁止抓取这个页面：它对应的搜索产品可能无法引用你`,
    trainBlocked: (b) => `训练用途的 ${b} 被禁止：不影响搜索可见性，如果是有意为之可忽略`,
    probeOk: '用 AI 爬虫的 UA 访问，与浏览器结果一致',
    probeBlocked: (b, c) => `用 ${b} 的 UA 访问返回 ${c}，浏览器 UA 正常：防火墙或 CDN 可能在拦 AI 爬虫`,
    probeDiff: (b) => `用 ${b} 的 UA 访问，正文明显比浏览器少：可能被替换成验证页`,
    probeNote: '注：这里只模拟 UA，真实爬虫还要按官方 IP 核对服务器日志',
    headerNoindex: '响应头 X-Robots-Tag 含 noindex：页面不会进入搜索索引',
    headerOk: '响应头无 noindex',
    metaNoindex: 'robots meta 含 noindex：检查 CMS 的“阻止搜索引擎”开关',
    metaOk: 'HTML 无 noindex meta',
    noCanon: '没有 canonical：不是错误，但重要页面建议加上',
    canonSelf: (u) => `canonical 指向本页：${u}`,
    canonOther: (u) => `canonical 指向别处：${u}（产品页误指首页很常见）`,
    textOk: (n) => `原始 HTML 里有约 ${n} 字正文`,
    textEmpty: '原始 HTML 未提取到正文：检查页面是否为空、依赖 JavaScript 或需要登录',
    textThin: (n) => `原始 HTML 只有约 ${n} 字正文：很可能是 JS 渲染的空壳页（如只有"加载中"），多数 AI 爬虫读不到正文`,
    textShort: '正文较短：字数本身不决定是否可被读取或引用，建议用 --phrase 核对关键事实；提取到文字不代表内容充分',
    phraseOk: (p) => `原始 HTML 里找到指定正文「${p}」`,
    phraseSplit: (p) => `「${p}」被标签拆开了，去掉标签后才能找到：多数爬虫能读，但尽量写成连续文字`,
    phraseMissing: (p) => `原始 HTML 里找不到「${p}」：可能依赖 JavaScript 渲染`,
    phraseHidden: (p) => `「${p}」只出现在标签属性或 <head> 里（例如 meta description），正文里看不到`,
    canonInvalid: (h) => `canonical 地址无法解析：${h}`,
    phraseInScript: (p) => `「${p}」只出现在 <script> 里（例如 JSON 数据），要运行 JavaScript 才会显示：不执行 JS 的爬虫看不到`,
    titleOk: (t) => `标题：${t}`,
    titleMissing: '没有 <title>',
    descOk: '有 meta description',
    descMissing: '没有 meta description：搜索结果和部分 AI 摘要会自己截一段',
    h1Ok: (t) => `H1：${t}`,
    h1Missing: '没有 H1：给页面一个说清主题的主标题',
    langOk: (l) => `声明了语言 lang="${l}"`,
    langMissing: '<html> 没有 lang 属性：多语言站点尤其要加',
    sitemapOk: (u) => `找到 sitemap：${u}`,
    sitemapMissing: '没找到 sitemap（robots.txt 未声明，/sitemap.xml 也不存在）',
    jsonldOk: (t) => `结构化数据 JSON-LD：${t}`,
    jsonldBad: 'JSON-LD 存在但解析失败：检查 JSON 语法',
    jsonldNone: '没有 JSON-LD：不是必需项，官方没有“AI 专用 schema”，只在符合页面类型时添加',
    summary: (p, w, f) => `${p} 项通过 · ${w} 项注意 · ${f} 项问题`,
    next: '下一步：逐项修复后再跑一次。详细排查步骤见',
    remind: '提醒：能被读到 ≠ 已被收录或引用，后者要用固定题集观察。',
    badgeLabel: 'GEO 体检',
    badgeAlt: (s, d) => `GEO 体检 ${s}/100（${d}，AI 能否读到这个页面）`,
    badgeTip: '📛 分数不错，可以挂个徽章：把下面这行贴到 README（网页用 --report 里的 HTML 版）',
    badgeLocked: (n) => `📛 修到 ${n} 分以上，就能生成 GEO 体检徽章挂在你的 README 或官网上`,
    badgeSaved: (f, s) => `已生成徽章文件 ${f}（${s}/100），可以提交到仓库或放到网站上引用`,
    badgeMulti: '多个网址按最低分生成徽章',
    badgeTitle: '📛 体检徽章',
    cardTip: '📸 加 --card geo-card.png 生成一张分享图',
    cardHead: 'GEO 体检 · AI 能读到这个页面吗',
    cardWord: { pass: '通过', warn: '注意', fail: '问题' },
    cardCta: '免费体检你的网站：github.com/Fangx-AI/geo-doctor',
    cardNote: '只代表技术体检，不代表 AI 会推荐',
    cardSaved: (f, s) => `已生成分享图 ${f}（${s}/100），可以发朋友圈、群聊或社交平台`,
    cardSvgOnly: (f) => `没找到 Chrome 或 Edge，先生成了 SVG：${f}。用浏览器打开后截图，或装好 Chrome 后重跑；也可以用 CHROME_PATH 指定浏览器路径`,
    badgeNote: '徽章只代表这次技术体检（AI 爬虫能否读到页面）的分数和日期，不代表 AI 会推荐你。页面改动后请重新体检。',
    code: 'zh',
    usage: `用法：geo-audit <网址...> [选项]

选项：
  --phrase "文字"     检查这句正文是否在原始 HTML 里（建议填价格、型号等关键句）
  --json              输出 JSON
  --report 文件.md    另存一份 Markdown 报告
  --fail-under 分数   0–100；低于该值退出码为 1，参数无效为 2（用于 CI）
  --lang zh|en        输出语言（默认跟随系统）
  --no-probe          跳过“用 AI 爬虫 UA 访问”的防火墙检查
  --badge 文件.svg    生成体检分数徽章（SVG，多个网址按最低分）
  --card 文件.png     生成 1200×630 分享图（.png 需要本机有 Chrome 或 Edge，.svg 不需要；多个网址取最低分那个）
  -h, --help          显示帮助
  -v, --version       显示版本

例子：
  npx github:Fangx-AI/geo-doctor https://example.com/pricing --phrase "团队版每月 299 元"`,
  },
  en: {
    title: 'GEO audit', score: 'Score', sep: ': ',
    pass: 'pass', warn: 'warn', fail: 'fail', info: 'info',
    sections: { access: '① Access & redirects', robots: '② robots.txt & AI crawlers', firewall: '③ Firewall / CDN', index: '④ Indexing', canonical: '⑤ Canonical', content: '⑥ Content & page info', discovery: '⑦ Discovery & structured data' },
    status: (c) => `Final status ${c}`,
    statusBad: (c) => `Final status ${c}: on 4xx/5xx AI crawlers get no content`,
    noRedirect: 'No redirects',
    redirects: (n, u) => `${n} redirect(s) to ${u}: link to the final URL internally and in sitemaps`,
    fetchFail: (e) => `Request failed: ${e} (check network, TLS or DNS)`,
    robots404: 'No robots.txt (404 means no crawl restrictions)',
    robotsOther: (c) => `robots.txt returned ${c}: under RFC 9309 crawlers treat an unreachable robots.txt as "disallow everything"; fix it first`,
    searchOk: (n) => `All ${n} search crawlers may fetch this page`,
    searchBlocked: (b) => `${b} is disallowed from this page: its search product may not cite you`,
    trainBlocked: (b) => `Training token ${b} is disallowed: no effect on search visibility; ignore if intended`,
    probeOk: 'Requests with AI crawler user-agents look the same as a browser',
    probeBlocked: (b, c) => `With the ${b} user-agent the page returns ${c} while a browser gets 2xx: a firewall or CDN may be blocking AI crawlers`,
    probeDiff: (b) => `With the ${b} user-agent the page has far less text than for a browser: possibly a challenge page`,
    probeNote: 'Note: this only spoofs the user-agent; verify real crawlers by their published IPs in your logs',
    headerNoindex: 'X-Robots-Tag header contains noindex: the page will not be indexed',
    headerOk: 'No noindex header',
    metaNoindex: 'robots meta tag contains noindex: check your CMS "discourage search engines" setting',
    metaOk: 'No noindex meta tag',
    noCanon: 'No canonical link: not an error, but recommended on key pages',
    canonSelf: (u) => `Canonical points to this page: ${u}`,
    canonOther: (u) => `Canonical points elsewhere: ${u} (product pages pointing at the homepage is common)`,
    textOk: (n) => `About ${n} characters of text in the raw HTML`,
    textEmpty: 'No body text extracted from the raw HTML: check for an empty page, JavaScript rendering or a login requirement',
    textThin: (n) => `Only about ${n} characters of text in the raw HTML: very likely a JS-rendered shell (e.g. just "Loading…") that most AI crawlers cannot read`,
    textShort: 'Short body text: length alone does not determine readability or citations. Use --phrase to verify key facts; extracted text does not establish content completeness',
    phraseOk: (p) => `Found "${p}" in the raw HTML`,
    phraseSplit: (p) => `"${p}" is split across tags and only matches after stripping them; most crawlers cope, but keep key facts in one run of text`,
    phraseMissing: (p) => `"${p}" is not in the raw HTML: it probably depends on JavaScript`,
    phraseHidden: (p) => `"${p}" only appears in tag attributes or <head> (e.g. meta description), not in the visible body text`,
    canonInvalid: (h) => `Canonical URL can't be parsed: ${h}`,
    phraseInScript: (p) => `"${p}" only appears inside <script> (e.g. JSON data) and needs JavaScript to show up: crawlers that don't run JS won't see it`,
    titleOk: (t) => `Title: ${t}`,
    titleMissing: 'No <title>',
    descOk: 'Has a meta description',
    descMissing: 'No meta description: search results and some AI summaries will pick their own snippet',
    h1Ok: (t) => `H1: ${t}`,
    h1Missing: 'No H1: give the page one heading that states its topic',
    langOk: (l) => `Declares lang="${l}"`,
    langMissing: '<html> has no lang attribute: important for multilingual sites',
    sitemapOk: (u) => `Sitemap found: ${u}`,
    sitemapMissing: 'No sitemap found (none declared in robots.txt and /sitemap.xml is missing)',
    jsonldOk: (t) => `JSON-LD structured data: ${t}`,
    jsonldBad: 'JSON-LD present but fails to parse: check the JSON syntax',
    jsonldNone: 'No JSON-LD: optional; there is no special "AI schema", add it only where it fits the page type',
    summary: (p, w, f) => `${p} passed · ${w} ${w === 1 ? 'warning' : 'warnings'} · ${f} ${f === 1 ? 'problem' : 'problems'}`,
    next: 'Next: fix and run again. Step-by-step troubleshooting:',
    remind: 'Reminder: readable ≠ indexed or cited. Track that with a fixed question set.',
    badgeLabel: 'GEO audit',
    badgeAlt: (s, d) => `GEO audit ${s}/100 (${d}, can AI crawlers read this page)`,
    badgeTip: '📛 Nice score. Show it off: paste this line into your README (HTML version in the --report file)',
    badgeLocked: (n) => `📛 Reach ${n}+ to earn a GEO audit badge for your README or website`,
    badgeSaved: (f, s) => `Badge written to ${f} (${s}/100). Commit it to your repo or host it on your site`,
    badgeMulti: 'With several URLs the badge uses the lowest score',
    badgeTitle: '📛 Audit badge',
    cardTip: '📸 Add --card geo-card.png for a share image',
    cardHead: 'GEO audit · can AI read this page?',
    cardWord: { pass: 'pass', warn: 'check', fail: 'problem' },
    cardCta: 'Free GEO audit: github.com/Fangx-AI/geo-doctor',
    cardNote: 'Technical audit only, not an AI ranking',
    cardSaved: (f, s) => `Share image written to ${f} (${s}/100). Post it anywhere`,
    cardSvgOnly: (f) => `Chrome or Edge not found, so wrote an SVG instead: ${f}. Open it in a browser and screenshot it, install Chrome, or set CHROME_PATH`,
    badgeNote: 'The badge shows this technical audit (can AI crawlers read the page) and its date. It does not mean AI will recommend you. Re-run after you change the page.',
    code: 'en',
    usage: `Usage: geo-audit <url...> [options]

Options:
  --phrase "text"     check that this sentence is in the raw HTML (use a price, model, key fact)
  --json              print JSON
  --report file.md    also write a Markdown report
  --fail-under N      0–100; exit 1 below N, exit 2 for invalid options (for CI)
  --lang zh|en        output language (default: system locale)
  --no-probe          skip the "fetch with AI crawler user-agents" firewall check
  --badge file.svg    write a score badge (SVG; lowest score when auditing several URLs)
  --card file.png     write a 1200×630 share image (.png needs Chrome or Edge installed, .svg does not; lowest-scoring URL)
  -h, --help          show help
  -v, --version       show version

Example:
  npx github:Fangx-AI/geo-doctor https://example.com/pricing --phrase "Team plan $29/month"`,
  },
};

const DOC_LINKS = {
  access: 'docs/playbooks/website.md', robots: 'toolkit/robots-ai-bots.txt', firewall: 'docs/playbooks/website.md',
  index: 'docs/playbooks/website.md', canonical: 'docs/playbooks/website.md', content: 'docs/content-rewrite.md',
  discovery: 'docs/myths.md',
};

// ---------------------------------------------------------------- robots.txt (RFC 9309)

export function parseRobots(text) {
  const groups = []; const sitemaps = [];
  let cur = null; let lastWasUa = false;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n|\r/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasUa) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastWasUa = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasUa = false;
      if (cur) cur.rules.push({ allow: key === 'allow', path: val });
    } else if (key === 'sitemap') {
      sitemaps.push(val);
    } else {
      lastWasUa = false;
    }
  }
  return { groups, sitemaps };
}

// RFC 9309 §2.2.2: compare paths in one encoding. Non-ASCII is percent-encoded,
// escapes of unreserved characters are decoded, other escapes are upper-cased.
export function normPath(s) {
  return s.replace(/[^\x00-\x7f]+/gu, (m) => { try { return encodeURIComponent(m); } catch { return m; } })
    .replace(/%[0-9a-f]{2}/gi, (m) => {
      const c = String.fromCharCode(parseInt(m.slice(1), 16));
      return /[A-Za-z0-9\-._~]/.test(c) ? c : m.toUpperCase();
    });
}

function ruleMatches(pattern, path) {
  if (pattern === '') return false;
  let re = '';
  for (const ch of pattern) {
    if (ch === '*') re += '.*';
    else if (ch === '$') re += '$';
    else re += ch.replace(/[.+?^{}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re).test(path);
}

// Returns true when `bot` may fetch `path` (path includes the query string).
export function isAllowed(robots, bot, path) {
  const token = bot.toLowerCase();
  let rules = [];
  const named = robots.groups.filter((g) => g.agents.includes(token));
  if (named.length) rules = named.flatMap((g) => g.rules);
  else rules = robots.groups.filter((g) => g.agents.includes('*')).flatMap((g) => g.rules);
  const target = normPath(path);
  let best = null;
  for (const r of rules) {
    const pattern = normPath(r.path);
    if (!ruleMatches(pattern, target)) continue;
    const len = pattern.length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------- HTML helpers

export function cleanHtml(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, ' ');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      // HTML numeric-reference error recovery: replace invalid Unicode values.
      // https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state
      if (!Number.isFinite(cp) || cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '\uFFFD';
      return String.fromCodePoint(cp);
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function visibleText(cleaned) {
  const body = (cleaned.match(/<body\b[\s\S]*$/i) || [cleaned])[0];
  return decode(body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tags(html, name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
}
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null;
}
function inner(html, name) {
  const m = html.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decode(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : null;
}
function hasToken(value, token) {
  return (value || '').toLowerCase().split(/[\s,]+/).some((t) => t === token);
}

// ---------------------------------------------------------------- fetching

async function get(url, ua, { follow = true, timeout = 20000 } = {}) {
  let current = url; const chain = [];
  for (let i = 0; i <= 10; i++) {
    const res = await fetch(current, {
      redirect: 'manual', signal: AbortSignal.timeout(timeout),
      headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    });
    const loc = res.headers.get('location');
    if (follow && res.status >= 300 && res.status < 400 && loc) {
      chain.push(current); current = new URL(loc, current).href;
      await res.body?.cancel();
      continue;
    }
    const body = await res.text();
    return { status: res.status, headers: res.headers, body, url: current, redirects: chain.length };
  }
  throw new Error('too many redirects');
}

// ---------------------------------------------------------------- audit

const WEIGHT = { fail: 0, warn: 0.5, pass: 1 };

export async function audit(url, opts = {}) {
  const lang = opts.lang || 'en';
  const t = M[lang];
  const checks = [];
  // critical = a failure here alone can keep the page out of AI answers; it caps the score at 60.
  const add = (section, status, msg, weight = 1, critical = false) => checks.push({ section, status, msg, weight, critical });

  let page;
  try {
    page = await get(url, BROWSER_UA);
  } catch (e) {
    add('access', 'fail', t.fetchFail(e.cause?.code || e.message), 10, true);
    return finish(url, url, checks, t);
  }
  const final = page.url;
  const origin = new URL(final).origin;
  const ok = page.status >= 200 && page.status < 300;
  add('access', ok ? 'pass' : 'fail', ok ? t.status(page.status) : t.statusBad(page.status), 3, true);
  add('access', page.redirects ? 'warn' : 'pass', page.redirects ? t.redirects(page.redirects, final) : t.noRedirect, 0.5);

  // robots.txt
  let robots = { groups: [], sitemaps: [] };
  let robotsReadable = true;
  try {
    const r = await get(origin + '/robots.txt', BROWSER_UA);
    if (r.status >= 200 && r.status < 300) robots = parseRobots(r.body);
    else if (r.status >= 400 && r.status < 500) add('robots', 'pass', t.robots404, 0.5);
    else { robotsReadable = false; add('robots', 'fail', t.robotsOther(r.status), 3, true); }
  } catch (e) {
    robotsReadable = false;
    add('robots', 'fail', t.robotsOther(e.cause?.code || e.message), 3, true);
  }
  if (robotsReadable) {
    const u = new URL(final); const path = u.pathname + u.search;
    const blockedSearch = SEARCH_BOTS.filter((b) => !isAllowed(robots, b, path));
    for (const b of blockedSearch) add('robots', 'fail', t.searchBlocked(b), 1.5, true);
    if (!blockedSearch.length) add('robots', 'pass', t.searchOk(SEARCH_BOTS.length), 3);
    for (const b of TRAINING_BOTS.filter((x) => !isAllowed(robots, x, path))) add('robots', 'info', t.trainBlocked(b), 0);
  }

  // firewall / CDN probe
  if (opts.probe !== false && ok) {
    const baseLen = visibleText(cleanHtml(page.body)).length;
    let problem = false;
    for (const [bot, ua] of Object.entries(PROBE_UAS)) {
      try {
        const p = await get(final, ua);
        if (p.status >= 400) { add('firewall', 'fail', t.probeBlocked(bot, p.status), 2, true); problem = true; break; }
        const len = visibleText(cleanHtml(p.body)).length;
        if (baseLen > 500 && len < baseLen * 0.3) { add('firewall', 'warn', t.probeDiff(bot), 2); problem = true; break; }
      } catch (e) {
        add('firewall', 'fail', t.probeBlocked(bot, e.cause?.code || e.message), 2); problem = true; break;
      }
    }
    if (!problem) add('firewall', 'pass', t.probeOk, 2);
    add('firewall', 'info', t.probeNote, 0);
  }

  const html = page.body; const clean = cleanHtml(html);

  // indexing
  const xrt = page.headers.get('x-robots-tag') || '';
  const headerNoindex = xrt.split(',').some((part) => /(^|:|\s)(noindex|none)\b/i.test(part.trim()));
  add('index', headerNoindex ? 'fail' : 'pass', headerNoindex ? t.headerNoindex : t.headerOk, 2, true);
  const metaNoindex = tags(clean, 'meta').some((m) => /^(robots|googlebot|bingbot)$/i.test(attr(m, 'name') || '')
    && (hasToken(attr(m, 'content'), 'noindex') || hasToken(attr(m, 'content'), 'none')));
  add('index', metaNoindex ? 'fail' : 'pass', metaNoindex ? t.metaNoindex : t.metaOk, 2, true);

  // canonical
  const canonTag = tags(clean, 'link').find((l) => hasToken(attr(l, 'rel'), 'canonical'));
  const canonHref = canonTag ? attr(canonTag, 'href') : null;
  if (!canonHref) add('canonical', 'warn', t.noCanon, 0.5);
  else {
    let abs = null;
    try { abs = new URL(canonHref, final).href; } catch { add('canonical', 'warn', t.canonInvalid(canonHref), 1.5); }
    if (abs) {
      const norm = (x) => x.replace(/#.*$/, '').replace(/\/$/, '');
      const self = norm(abs) === norm(final);
      add('canonical', self ? 'pass' : 'warn', self ? t.canonSelf(abs) : t.canonOther(abs), 1.5);
    }
  }

  // content
  const text = visibleText(clean);
  const chars = [...text].length;
  // Two shell signals: very little text overall ("加载中…"), or an SPA mount point (#app, #root,
  // #__next, #__nuxt) that is empty or holds only a loading message while nav/footer text pads
  // the page. Either is the failure that matters most for AI crawlers. Short but real pages only
  // get a reminder; finding the requested --phrase in the visible text proves it is not a shell.
  const SHELL_CHARS = 50;
  const phraseVisible = Boolean(opts.phrase) && text.replace(/\s+/g, '').includes(opts.phrase.replace(/\s+/g, ''));
  const emptyMount = /<(div|main|section)\b[^>]*\bid\s*=\s*["']?(?:app|root|__next|__nuxt)["'\s>][^>]*>?[^<]{0,20}<\/\1>/i.test(clean);
  const shell = !phraseVisible && (chars < SHELL_CHARS || (emptyMount && chars < 500));
  if (chars === 0) add('content', 'fail', t.textEmpty, 3, true);
  else if (shell) add('content', 'fail', t.textThin(chars), 3, true);
  else add('content', 'pass', t.textOk(chars), 3, true);
  if (!shell && chars > 0 && chars < 200) add('content', 'info', t.textShort, 0);
  if (opts.phrase) {
    const squash = (s) => s.replace(/\s+/g, '');
    if (text.includes(opts.phrase)) add('content', 'pass', t.phraseOk(opts.phrase), 2);
    else if (squash(text).includes(squash(opts.phrase))) add('content', 'warn', t.phraseSplit(opts.phrase), 2);
    else if (clean.includes(opts.phrase) || decode(clean).includes(opts.phrase)) add('content', 'fail', t.phraseHidden(opts.phrase), 2);
    else if (html.includes(opts.phrase) || decode(html).includes(opts.phrase)) add('content', 'fail', t.phraseInScript(opts.phrase), 2);
    else add('content', 'fail', t.phraseMissing(opts.phrase), 2);
  }
  const title = inner(clean, 'title');
  add('content', title ? 'pass' : 'warn', title ? t.titleOk(title) : t.titleMissing, 1);
  const desc = tags(clean, 'meta').find((m) => (attr(m, 'name') || '').toLowerCase() === 'description');
  add('content', desc && attr(desc, 'content') ? 'pass' : 'warn', desc && attr(desc, 'content') ? t.descOk : t.descMissing, 0.5);
  const h1 = inner(clean, 'h1');
  add('content', h1 ? 'pass' : 'warn', h1 ? t.h1Ok(h1) : t.h1Missing, 0.5);
  const htmlTag = tags(html, 'html')[0];
  const langAttr = htmlTag ? attr(htmlTag, 'lang') : null;
  add('content', langAttr ? 'pass' : 'warn', langAttr ? t.langOk(langAttr) : t.langMissing, 0.5);

  // discovery
  let sitemap = robots.sitemaps[0] || null;
  if (!sitemap) {
    try {
      const s = await get(origin + '/sitemap.xml', BROWSER_UA);
      if (s.status >= 200 && s.status < 300 && /<(urlset|sitemapindex)\b/i.test(s.body)) sitemap = origin + '/sitemap.xml';
    } catch { /* treated as missing */ }
  }
  add('discovery', sitemap ? 'pass' : 'warn', sitemap ? t.sitemapOk(sitemap) : t.sitemapMissing, 1);
  const blocks = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (!blocks.length) add('discovery', 'info', t.jsonldNone, 0);
  else {
    const types = []; let bad = false;
    for (const b of blocks) {
      try {
        const walk = (n) => {
          if (Array.isArray(n)) return n.forEach(walk);
          if (n && typeof n === 'object') {
            if (n['@type']) types.push([].concat(n['@type']).join('/'));
            if (n['@graph']) walk(n['@graph']);
          }
        };
        walk(JSON.parse(b));
      } catch { bad = true; }
    }
    if (bad) add('discovery', 'warn', t.jsonldBad, 0.5);
    else add('discovery', 'pass', t.jsonldOk([...new Set(types)].join(', ') || '—'), 0);
  }

  return finish(url, final, checks, t);
}

function finish(url, final, checks, t) {
  const scored = checks.filter((c) => c.weight > 0 && c.status !== 'info');
  const total = scored.reduce((s, c) => s + c.weight, 0);
  const got = scored.reduce((s, c) => s + c.weight * WEIGHT[c.status], 0);
  let score = total ? Math.round((got / total) * 100) : 0;
  if (checks.some((c) => c.critical && c.status === 'fail')) score = Math.min(score, 60);
  const count = (s) => checks.filter((c) => c.status === s).length;
  return { url, finalUrl: final, score, passed: count('pass'), warnings: count('warn'), problems: count('fail'), checks, badge: badgeInfo(score, t.code) };
}

// ---------------------------------------------------------------- badge

// Score shown as a badge people can put on their README or website. The link
// explains what the score means, so the badge never claims more than the audit.
// 体检分数徽章：可以贴在 README 或官网上；链接指向说明，徽章不夸大体检的含义。
export const BADGE_MIN = 80;
const BADGE_COLORS = [[90, 'brightgreen', '#4c1'], [80, 'green', '#97ca00'], [61, 'yellow', '#dfb317'], [0, 'red', '#e05d44']];
const today = () => new Date().toISOString().slice(0, 10);

export function badgeColor(score) {
  const [, name, hex] = BADGE_COLORS.find(([min]) => score >= min);
  return { name, hex };
}

// shields.io static badge path: "-" → "--", "_" → "__", then percent-encode.
const shieldsPart = (s) => encodeURIComponent(String(s).replace(/-/g, '--').replace(/_/g, '__'));
const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

export function badgeInfo(score, lang = 'en', date = today()) {
  const t = M[lang] || M.en; const { name } = badgeColor(score); const link = BADGE_LINK[t.code];
  const label = t.badgeLabel; const message = `${score}/100`;
  const image = `https://img.shields.io/badge/${shieldsPart(label)}-${shieldsPart(message)}-${name}`;
  const alt = t.badgeAlt(score, date);
  return {
    score, label, message, color: name, date, image, link, alt,
    markdown: `[![${alt.replace(/[[\]]/g, '')}](${image})](${link})`,
    html: `<a href="${link}"><img src="${image}" alt="${escapeXml(alt)}"></a>`,
  };
}

// Rough text width for an 11px sans-serif badge: CJK and full-width ≈ 11px, others ≈ 6.5px.
const textWidth = (s) => [...s].reduce((w, ch) => w + (/[⺀-鿿가-힯＀-￯]/.test(ch) ? 11 : /[0-9]/.test(ch) ? 7 : 6.5), 0);

// Self-contained flat badge, so it also works where img.shields.io is slow or blocked.
// 自带的扁平徽章 SVG：不依赖 img.shields.io，国内网络下也能显示。
export function badgeSvg(score, lang = 'en', date = today()) {
  const b = badgeInfo(score, lang, date); const { hex } = badgeColor(score);
  const lw = Math.round(textWidth(b.label) + 14); const mw = Math.round(textWidth(b.message) + 14); const w = lw + mw;
  const font = 'Verdana,Geneva,"DejaVu Sans","PingFang SC","Microsoft YaHei",sans-serif';
  const text = (x, s) => `<text x="${x}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(s)}</text><text x="${x}" y="14">${escapeXml(s)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${escapeXml(b.alt)}">`
    + `<title>${escapeXml(b.alt)}</title>`
    + `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`
    + `<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>`
    + `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="${hex}"/><rect width="${w}" height="20" fill="url(#s)"/></g>`
    + `<g fill="#fff" text-anchor="middle" font-family='${font}' font-size="11">${text(lw / 2, b.label)}${text(lw + mw / 2, b.message)}</g>`
    + `</svg>\n`;
}

// ---------------------------------------------------------------- share card

// A 1200×630 image people can post: score, host, one line per check section, and where to run it themselves.
// 分享图：分数、网址、每类检查一行，以及去哪里免费体检。只说技术体检的结果，不暗示 AI 会推荐。
const CARD_COLORS = { pass: '#22c55e', warn: '#eab308', fail: '#ef4444' };
const RANK = { pass: 0, warn: 1, fail: 2 };
const clip = (s, px, size) => {
  let out = ''; for (const ch of String(s)) { if (textWidth(out + ch) * size / 11 > px) return out + '…'; out += ch; }
  return out;
};

export function cardSvg(r, lang = 'en', date = today()) {
  const t = M[lang] || M.en; const { hex } = badgeColor(r.score);
  const font = `font-family='"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",Inter,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'`;
  let host = r.url; try { const u = new URL(r.finalUrl || r.url); host = u.host + (u.pathname === '/' ? '' : u.pathname); } catch {}
  const sections = [];
  for (const c of r.checks) {
    if (c.status === 'info') continue;
    let s = sections.find((x) => x.key === c.section);
    if (!s) sections.push(s = { key: c.section, status: c.status });
    else if (RANK[c.status] > RANK[s.status]) s.status = c.status;
  }
  const rows = sections.map((s, i) => {
    const y = 236 + i * 44; const name = t.sections[s.key].replace(/^[①-⑩]\s*/, '');
    return `<circle cx="78" cy="${y - 8}" r="8" fill="${CARD_COLORS[s.status]}"/>`
      + `<text x="100" y="${y}" font-size="24" fill="#e2e8f0">${escapeXml(name)}</text>`
      + `<text x="600" y="${y}" font-size="22" fill="${CARD_COLORS[s.status]}" text-anchor="end">${escapeXml(t.cardWord[s.status])}</text>`;
  }).join('');
  const R = 128; const C = 2 * Math.PI * R; const dash = (C * Math.max(0, Math.min(100, r.score))) / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeXml(`${t.title} ${r.score}/100 · ${host}`)}">`
    + `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#16233f"/></linearGradient></defs>`
    + `<rect width="1200" height="630" fill="url(#bg)"/>`
    + `<g ${font}>`
    + `<text x="64" y="86" font-size="26" fill="#94a3b8">${escapeXml(t.cardHead)}</text>`
    + `<text x="64" y="156" font-size="50" font-weight="700" fill="#ffffff">${escapeXml(clip(host, 1000 - 64 - 330, 50))}</text>`
    + rows
    + `<circle cx="940" cy="300" r="${R}" fill="none" stroke="#1e2b47" stroke-width="22"/>`
    + `<circle cx="940" cy="300" r="${R}" fill="none" stroke="${hex}" stroke-width="22" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 940 300)"/>`
    + `<text x="940" y="330" font-size="104" font-weight="800" fill="#ffffff" text-anchor="middle">${r.score}</text>`
    + `<text x="940" y="372" font-size="26" fill="#94a3b8" text-anchor="middle">/ 100</text>`
    + `<text x="940" y="482" font-size="22" fill="#cbd5e1" text-anchor="middle">${escapeXml(t.summary(r.passed, r.warnings, r.problems))}</text>`
    + `<rect y="548" width="1200" height="82" fill="#0a1020"/>`
    + `<text x="64" y="598" font-size="26" font-weight="600" fill="#ffffff">${escapeXml(t.cardCta)}</text>`
    + `<text x="1136" y="586" font-size="17" fill="#64748b" text-anchor="end">${escapeXml(t.cardNote)}</text>`
    + `<text x="1136" y="610" font-size="17" fill="#64748b" text-anchor="end">${escapeXml(date)}</text>`
    + `</g></svg>\n`;
}

// Find a local Chrome or Edge for the PNG; nothing is downloaded. 找本机的 Chrome 或 Edge，不下载任何东西。
export function findBrowser(env = process.env, platform = process.platform, exists = existsSync) {
  if (env.CHROME_PATH && exists(env.CHROME_PATH)) return env.CHROME_PATH;
  const pf = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
  const list = platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : platform === 'win32'
      ? pf.flatMap((d) => [join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe')])
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
        .flatMap((n) => (env.PATH || '').split(':').filter(Boolean).map((d) => join(d, n)));
  return list.find((p) => exists(p)) || null;
}

// Headless Chrome's viewport can be shorter than --window-size, so shoot a taller window and keep the top 630 rows.
// 无头 Chrome 的可视区可能比窗口矮，所以截一张更高的图，再裁出上面 630 行。
export function renderPng(svg, file, browser = findBrowser()) {
  if (!browser) return false;
  const dir = mkdtempSync(join(tmpdir(), 'geo-card-'));
  try {
    const html = join(dir, 'card.html'); const shot = join(dir, 'shot.png');
    writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#0b1220}svg{display:block}</style>${svg}`);
    execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${join(dir, 'profile')}`, '--force-device-scale-factor=1', '--window-size=1200,1000',
      `--screenshot=${shot}`, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), pathToFileURL(html).href], { stdio: 'ignore', timeout: 60000 });
    if (!existsSync(shot)) return false;
    writeFileSync(file, cropPngHeight(readFileSync(shot), 630));
    return true;
  } catch { return false; } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Keep the first `height` rows of a non-interlaced PNG. Scanlines only depend on rows above them, so no re-filtering.
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out;
};
export function cropPngHeight(png, height) {
  let pos = 8; let ihdr; const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos); const type = png.toString('latin1', pos + 4, pos + 8); const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = Buffer.from(data); else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const width = ihdr.readUInt32BE(0); const rows = ihdr.readUInt32BE(4);
  if (rows <= height) return png;
  if (ihdr[12] !== 0) throw new Error('interlaced PNG');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr[9]]; const stride = 1 + Math.ceil((width * channels * ihdr[8]) / 8);
  const raw = inflateSync(Buffer.concat(idat)).subarray(0, stride * height);
  ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- output

const ICON = { pass: '✅', warn: '⚠️ ', fail: '❌', info: 'ℹ️ ' };
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const color = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);

export function formatText(r, lang) {
  const t = M[lang]; const out = [];
  out.push(color('1', `🩺 ${t.title}${t.sep}${r.url}`));
  let section = null;
  for (const c of r.checks) {
    if (c.section !== section) { section = c.section; out.push('', color('1', t.sections[section])); }
    out.push(`  ${ICON[c.status]} ${c.msg}`);
  }
  const sc = r.score >= 90 ? '32' : r.score >= 70 ? '33' : '31';
  out.push('', color('1', `${t.score}${t.sep}`) + color(`1;${sc}`, `${r.score}/100`) + `  ·  ${t.summary(r.passed, r.warnings, r.problems)}`);
  if (r.problems || r.warnings) out.push(`${t.next} ${DOCS}docs/playbooks/website.md`);
  out.push(color('2', t.remind));
  if (r.badge && r.score >= BADGE_MIN) out.push('', t.badgeTip, r.badge.markdown);
  else if (r.badge) out.push('', color('2', t.badgeLocked(BADGE_MIN)));
  out.push(color('2', t.cardTip));
  return out.join('\n');
}

export function formatMarkdown(results, lang) {
  const t = M[lang]; const out = [`# 🩺 ${t.title}`, ''];
  out.push(`| URL | ${t.score} | ✅ | ⚠️ | ❌ |`, '| --- | --- | --- | --- | --- |');
  for (const r of results) out.push(`| ${r.url} | **${r.score}** | ${r.passed} | ${r.warnings} | ${r.problems} |`);
  for (const r of results) {
    out.push('', `## ${r.url}`, '');
    let section = null;
    for (const c of r.checks) {
      if (c.section !== section) { section = c.section; out.push('', `**${t.sections[section]}** · [docs](${DOCS}${DOC_LINKS[section]})`, ''); }
      out.push(`- ${ICON[c.status].trim()} ${c.msg}`);
    }
  }
  const low = results.reduce((a, b) => (b.score < a.score ? b : a), results[0]);
  if (low?.badge && low.score >= BADGE_MIN) {
    out.push('', `## ${t.badgeTitle}`, '', low.badge.markdown, '');
    if (results.length > 1) out.push(`${t.badgeMulti}.`, '');
    out.push('```markdown', low.badge.markdown, '```', '', '```html', low.badge.html, '```', '', `> ${t.badgeNote}`);
  } else if (low?.badge) out.push('', `> ${t.badgeLocked(BADGE_MIN)}`);
  out.push('', `<sub>${t.remind} · [geo-doctor](https://github.com/Fangx-AI/geo-doctor)</sub>`, '');
  return out.join('\n');
}

// ---------------------------------------------------------------- CLI

export function parseArgs(argv) {
  const o = { urls: [], json: false, probe: true };
  const valueFor = (flag, value) => {
    if (value === undefined || !value.trim() || value.startsWith('--') || ['-h', '-v'].includes(value)) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--phrase') o.phrase = valueFor(a, argv[++i]);
    else if (a === '--json') o.json = true;
    else if (a === '--report') o.report = valueFor(a, argv[++i]);
    else if (a === '--badge') o.badge = valueFor(a, argv[++i]);
    else if (a === '--card') o.card = valueFor(a, argv[++i]);
    else if (a === '--fail-under') {
      o.failUnder = Number(valueFor(a, argv[++i]));
      if (!Number.isFinite(o.failUnder) || o.failUnder < 0 || o.failUnder > 100) {
        throw new Error('--fail-under must be a finite number between 0 and 100');
      }
    }
    else if (a === '--lang') {
      o.lang = valueFor(a, argv[++i]);
      if (!['zh', 'en'].includes(o.lang)) throw new Error('--lang must be zh or en');
    }
    else if (a === '--no-probe') o.probe = false;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a.startsWith('-')) o.unknown = a;
    else o.urls.push(...a.split(/[\s,]+/).filter(Boolean));
  }
  return o;
}

function detectLang() {
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  const loc = env || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return /^zh/i.test(loc) ? 'zh' : 'en';
}

export async function main(argv) {
  let o;
  try { o = parseArgs(argv); }
  catch (e) { console.error(e.message); return 2; }
  const lang = o.lang === 'zh' || o.lang === 'en' ? o.lang : detectLang();
  if (o.version) { console.log(VERSION); return 0; }
  if (o.help || !o.urls.length || o.unknown) { console.log(M[lang].usage); return o.help ? 0 : 2; }
  const results = [];
  for (let url of o.urls) {
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const r = await audit(url, { phrase: o.phrase, probe: o.probe, lang });
    results.push(r);
    if (!o.json) console.log(formatText(r, lang) + (o.urls.length > 1 ? '\n' : ''));
  }
  if (o.json) console.log(JSON.stringify(o.urls.length === 1 ? results[0] : results, null, 2));
  if (o.report) {
    mkdirSync(dirname(o.report), { recursive: true });
    writeFileSync(o.report, formatMarkdown(results, lang));
  }
  const min = Math.min(...results.map((r) => r.score));
  if (o.badge) {
    mkdirSync(dirname(o.badge), { recursive: true });
    writeFileSync(o.badge, badgeSvg(min, lang));
    if (!o.json) console.error(M[lang].badgeSaved(o.badge, min));
  }
  if (o.card) {
    const low = results.reduce((a, b) => (b.score < a.score ? b : a), results[0]);
    const svg = cardSvg(low, lang);
    mkdirSync(dirname(resolve(o.card)), { recursive: true });
    if (/\.png$/i.test(o.card)) {
      if (renderPng(svg, o.card)) console.error(M[lang].cardSaved(o.card, low.score));
      else { const f = o.card.replace(/\.png$/i, '.svg'); writeFileSync(f, svg); console.error(M[lang].cardSvgOnly(f)); }
    } else { writeFileSync(o.card, svg); console.error(M[lang].cardSaved(o.card, low.score)); }
  }
  return Number.isFinite(o.failUnder) && min < o.failUnder ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href || /^(geo-audit|geo-doctor)$/.test(basename(process.argv[1] || ''))) {
  useEnvProxy();
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 2; });
}
