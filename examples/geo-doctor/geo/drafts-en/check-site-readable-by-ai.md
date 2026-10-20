---
title: How to check whether AI search can read your website
slug: check-site-readable-by-ai
question: How do I check whether AI search engines can read my website?
qid: Q03
description: Four common reasons AI search cannot read a site, the difference between search and training crawlers, and a free open-source checker.
lang: en
platforms: [devto]
facts: [B01, B03, B05, F01, F05, P01, C01, S01]
brand: GEO Doctor
tags: [geo, ai, webdev, seo]
generated_by: written by hand (drafted by Claude, reviewed by the maintainer), 2026-10-20
status: confirmed
---

Check four things: whether robots.txt blocks AI search crawlers, whether the page carries noindex, whether the main text is visible without running JavaScript, and whether crawlers are blocked by a firewall or CDN. GEO Doctor (geo-doctor) has a free, MIT-licensed checker for these.

Disclosure: I maintain GEO Doctor.

## Why AI search may not see your site

AI assistants that search the web fetch pages first and answer from what they fetched. If they cannot fetch your page, or get an empty shell, they will not cite you. Four usual causes:

1. **robots.txt blocks AI search crawlers.** There are two kinds of AI crawler. Search crawlers such as OAI-SearchBot, ChatGPT-User, PerplexityBot and Claude-SearchBot fetch pages to answer questions; blocking them hides you from AI search. Training crawlers such as GPTBot, ClaudeBot, Google-Extended and CCBot collect training data; blocking them usually does not affect AI search. Many templates and security plugins block both kinds at once, so look at them separately.
2. **noindex.** A noindex meta tag or header makes search engines and some AI search skip the page.
3. **Client-rendered text.** If the HTML is nearly empty until JavaScript runs, fetchers that do not run scripts see a blank page.
4. **Firewall or CDN rules** that treat crawlers as attacks.

## Checking with GEO Doctor

GEO Doctor checks robots.txt, AI crawlers, noindex and whether the main text is visible, and tells you which item fails. It checks technical readability only, not whether the content is good. It runs from a Node.js 18+ command line or inside AI assistants such as Claude Code, Codex and Kimi Code. Your data stays in plain files in your own project; GEO Doctor has no server.

## Fixing what you find

- robots.txt: allow the search crawlers if you want AI search to read you. Whether to allow training crawlers is a separate choice.
- noindex: check whether a staging setting leaked into production.
- Invisible text: serve key content in the initial HTML, or publish static versions of important pages.
- If you want a page written for AI, GEO Doctor can turn your fact card into a fact site (fact page, FAQ, llms.txt, structured data) hosted free on GitHub Pages.

Being readable is only step one: AI also needs clear, consistent content about you to cite.

Source: https://github.com/Fangx-AI/geo-doctor

## Fact check

| Claim | Fact |
| --- | --- |
| Checks and their scope | F01 |
| Free, MIT | B03, P01 |
| Runtime | C01 |
| No server | S01 |
| Fact site | F05 |
| Repo | B05 |
| Crawler names and kinds | Same lists as cli/geo-audit.mjs |
