<div align="center">

<img src="assets/hero-banner.jpg" alt="GEO Doctor: your site looks fine, but AI sees a blank page" width="88%">

# 🩺 GEO Doctor

**Get ChatGPT, Claude, Perplexity and Gemini to recommend your product.**

Free and open source · No server · One-sentence install · Chinese and English

[![test](https://github.com/Fangx-AI/geo-doctor/actions/workflows/test.yml/badge.svg)](https://github.com/Fangx-AI/geo-doctor/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Install](#install) · [What it does](#what) · [No skill needed](#quickstart) · [FAQ](#faq) · [中文](README.md)

</div>

People no longer type keywords; they ask AI. "What knowledge base works for a 20-person team?" "Is there an offline bookkeeping app for a small shop?"

**If the answer omits you, prices you wrong, or only names your competitors, you are losing customers quietly.** A GEO agency costs thousands and cannot show you the denominator. GEO Doctor puts the whole method inside the AI assistant you already use — you say **"run GEO for me"** and it takes it from there.

<a id="what"></a>

## What it does

<table>
<tr>
<td width="33%" valign="top"><b>🔍 Find the gap</b><br><sub>Who AI recommends, how often, which sites it read to decide, and exactly which question you are missing from</sub></td>
<td width="33%" valign="top"><b>✍️ Fill it</b><br><sub>One draft per gap, built only from facts you confirmed; your own site can publish automatically, third-party platforms are formatted for you to post</sub></td>
<td width="33%" valign="top"><b>📈 Measure it</b><br><sub>Ask the same questions before and after, compare recommendation counts instead of vibes</sub></td>
</tr>
</table>

<p align="center"><img src="assets/geo-doctor-demo-en.gif" alt="Demo: say run GEO for me; it audits the site (60/100, AI crawlers cannot read the body), proposes 10 sampling questions, then ranks competitors and writes a prioritised prescription" width="100%"></p>

<p align="center"><sub>The product in the demo is fictional and the competitor counts are sample data; the audit segment is real script output.</sub></p>

It does not promise rankings, buy traffic, write fake reviews, or log into platforms that have no publishing API — that is the "GEO poisoning" regulators are already acting on.

<a id="install"></a>

## Install

Open a new conversation in any assistant that supports skills (Claude Code, Codex, Kimi Code, WorkBuddy…) and send:

```text
Install this skill: https://github.com/Fangx-AI/geo-doctor/tree/master/skills
```

Then say **"run GEO for me"**. It asks a few questions first, then routes you to the step you actually need.

**One skill only** — point at a directory (e.g. `.../skills/ai-crawler-audit`) or use the CLI:

```bash
npx skills add Fangx-AI/geo-doctor -s ai-crawler-audit -g
```

<details>
<summary><b>Other ways</b> (CLI, manual copy, zip upload)</summary>

| Your tool | How |
| --- | --- |
| Any Agent Skills client | `npx skills add Fangx-AI/geo-doctor -g` for all six; add `--copy` where symlinks are unsupported |
| Claude Code | `/plugin marketplace add Fangx-AI/geo-doctor`, then `/plugin install geo-doctor@geo-doctor` |
| Codex | Ask `$skill-installer` for `skills/<name>` in this repo, or copy it to `~/.agents/skills/<name>/` |
| Kimi Code | Copy to `~/.kimi-code/skills/<name>/` |
| Clients that upload skill zips | Download `<name>.zip` or `geo-doctor-all.zip` from [Releases](https://github.com/Fangx-AI/geo-doctor/releases) |

Chat apps like ChatGPT, Doubao or DeepSeek cannot install skills — and they are exactly what you are optimising for. Diagnose in a skill-capable assistant, then sample the answers in the app itself.

</details>

<a id="skills"></a>

## Six skills, one job each

Install all six if you are starting from zero; install one if you already know where you are stuck.

| Skill | The question it answers |
| --- | --- |
| `geo-doctor` | Where do I start? The whole method, triage, and weekly re-checks |
| `ai-crawler-audit` | Can AI crawlers read my pages? What do I fix? |
| `ai-visibility` | Does AI mention me, who does it recommend, which questions am I missing from |
| `ai-content-writer` | What should I write? AI gets my facts wrong — what now? |
| `llms-txt` | How do I build llms.txt and a fact site AI can read? |
| `geo-publish` | Where do I publish, how, and how do I keep the record? |

<details>
<summary><b>The nine steps</b> (each one has a deliverable)</summary>

| Step | You say | You get | Skill |
| --- | --- | --- | --- |
| 0 Triage | run GEO for me | A chart: product, target AI, industry research | `geo-doctor` |
| 1 Audit | can AI read my site | A defect list with fixes | `ai-crawler-audit` |
| 2 Fact card | organise my product facts | One source of truth, with conflicts flagged | `ai-content-writer` |
| 3 Question set | what would users ask | A baseline: 12–18 frozen core questions | `ai-visibility` |
| 4 Sampling | what does AI say about me | Stored answers and a recommendation rate | `ai-visibility` |
| 5 Diagnosis | why not me | Competitor leaderboard, per-question gaps, prescription | `ai-visibility` |
| 6 Write | draft every gap | Articles, FAQ, comparison pages | `ai-content-writer` |
| 7 Publish | publish them | Live pages, platform-ready drafts, a publishing log | `geo-publish` |
| 8 Re-check | did it work | Before/after report; optional weekly autopilot | `ai-visibility` |

Software, apps, websites, mini-programs and online products are supported today. Prefer a local UI? Run `npx -p github:Fangx-AI/geo-doctor geo-studio` and open `http://127.0.0.1:4173`.

</details>

<a id="quickstart"></a>

## No skill needed

With [Node.js](https://nodejs.org) 18+, one command tells you whether AI can read a page:

```bash
npx github:Fangx-AI/geo-doctor https://your-site.com/important-page --phrase "a line of real body text"
```

It checks seven things and scores 0–100: reachability and redirects, robots.txt rules for nine AI and search crawlers, whether a firewall blocks AI, noindex, canonical, whether the body exists in the raw HTML, and sitemap plus structured data. Score 80+ gets you a badge snippet; `--card` renders a share image.

<p align="center"><img src="assets/geo-audit-terminal-en.png" alt="Real audit output: nine AI search crawlers are allowed, but the raw HTML has no body text, scoring 60/100" width="100%"></p>

<p align="center"><sub>Real output against a local test page: crawlers are allowed, but the raw HTML is an empty <code>&lt;div id="root"&gt;</code>, so crawlers that do not run JavaScript see nothing.</sub></p>

👉 [Quickstart](docs/quickstart.md) · [Run it in GitHub Actions](docs/handbook.md#ci) · [Badges and share cards](docs/badge.md)

<a id="faq"></a>

## FAQ

**Does it cost anything?** No. Code and skills are MIT; you only spend your own assistant quota.

**Will it guarantee that ChatGPT recommends me?** No one can. It finds and fixes what AI cannot read or states wrongly, then compares the same questions before and after. Anyone promising guaranteed rankings should show you a denominator and raw records.

**Is it safe?** The audit has zero dependencies and only fetches the URL you give it plus its robots.txt and sitemap.xml. It never uploads data or reads keys. It does impersonate AI crawlers to test firewall rules, so only audit sites you own.

**Can it write in bulk without turning into spam?** Bulk, yes: one draft per question AI did not recommend you for, every fact confirmed by you, and duplicate drafts get blocked. Third-party platforms are only formatted for you to post — bot posting gets accounts banned.

<a id="more"></a>

## More

- **[The GEO handbook](docs/handbook.md)** (Chinese): every claim carries an official source or study. Playbooks by project type: [website](docs/playbooks/website.md) · [mini-program](docs/playbooks/mini-program.md) · [SaaS / app](docs/playbooks/product.md) · [local business](docs/playbooks/local-business.md) · [e-commerce](docs/playbooks/ecommerce.md) · [B2B](docs/playbooks/b2b.md) · [creators](docs/playbooks/creator.md) · [multilingual](docs/playbooks/multilingual.en.md)
- **[AI crawler blocking in China](docs/ai-crawler-leaderboard.md)** (Chinese): 97 well-known Chinese sites, with Zhihu, Xiaohongshu, Weibo, Beike and Mafengwo shutting out ChatGPT search, Perplexity and Claude search
- **[Contributing](CONTRIBUTING.md)**: Chinese case studies with a public denominator, official docs, and failed experiments are all welcome

Project intro for AI: [llms.txt](llms.txt) · Facts verified 2026-10-14 · Structure inspired by [LLM Course](https://github.com/mlabonne/llm-course)

<sub>Code and skills [MIT](LICENSE); original prose, templates and diagrams [CC BY 4.0](LICENSE-docs.md). External articles, papers, code, trademarks and images keep their own rights.</sub>
