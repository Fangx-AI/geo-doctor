<div align="center">

# 🩺 GEO Doctor

### Get ChatGPT, Claude, Perplexity and Gemini to recommend your product

Works for English and Chinese sites: ChatGPT, Claude, Perplexity, Gemini, Google AI Overviews and Copilot,<br>plus Doubao, DeepSeek, Yuanbao, Qwen, ERNIE and Kimi in China.

Install it into your AI assistant with one sentence. It finds out which competitors AI recommends, why not you, and which sites AI reads when it recommends them,<br>then writes content AI wants to cite in batches, publishes it where AI reads, and re-tests your recommendation rate.

<table>
<tr>
<td align="center" width="33%"><b>🔍 Finds the gap</b><br><sub>Who AI recommends, how often, which sites it cites, and the exact questions you're missing from</sub></td>
<td align="center" width="33%"><b>✍️ Writes and publishes in batches</b><br><sub>One article per gap, only from your real facts. Auto-publishes to your site, packages posts for other platforms</sub></td>
<td align="center" width="33%"><b>📈 Tracks your recommendation rate</b><br><sub>Asks the same questions before and after, and compares your recommendations with competitors'</sub></td>
</tr>
</table>

**Free and open source** · **No server** · **One-sentence install** · **English and Chinese**

[![test](https://github.com/Fangx-AI/geo-doctor/actions/workflows/test.yml/badge.svg)](https://github.com/Fangx-AI/geo-doctor/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[🎬 Demo](#demo) · [📦 Install](#install) · [🩺 What it does](#what) · [❓ FAQ](#faq) · [🧰 No-install audit](#quickstart) · [📛 Badge](#badge) · [📚 Handbook](#handbook) · [中文](README.md)

</div>

---

People now ask AI directly: "best CRM for a 10-person startup?", "an expense app that works offline?"

**If the answer leaves you out, or gets your pricing and features wrong, you are losing customers without noticing.** GEO Doctor puts a complete, evidence-based method into the AI assistant you already use. You just say "help me with GEO".

<a id="demo"></a>

## 🎬 See it work in 30 seconds

<p align="center"><img src="assets/geo-doctor-demo-en.gif" alt="Demo: say 'help me with GEO' in an AI assistant. GEO Doctor audits the site (60/100, AI crawlers can't read the body text), gives 10 sampling questions, then after 20 ChatGPT answers are pasted back it shows who AI recommends (Competitor A 13/20, Fawn Budget 1/20), the sources ChatGPT cites and a prioritized prescription" width="100%"></p>
<p align="center"><sub>Fawn Budget is a fictional product and the competitors and counts are sample data. The audit snippet is real output of the script against a local test page.</sub></p>

<a id="install"></a>

## 📦 Install: send one sentence to your AI

In Claude Code, Codex, Kimi Code, WorkBuddy or any assistant that can install skills, open a new chat and send:

```text
Install this skill: https://github.com/Fangx-AI/geo-doctor/tree/master/skills/geo-doctor
```

Then say **"help me with GEO"**. It asks a few questions first, then starts the audit, and answers in your language.

| Tool | Other ways to install |
| --- | --- |
| **Claude Code** | `/plugin marketplace add Fangx-AI/geo-doctor`, then `/plugin install geo-doctor@geo-doctor` |
| **Codex** | Ask `$skill-installer` to install `skills/geo-doctor` from this repo, or copy the folder to `~/.agents/skills/geo-doctor/` |
| **Apps that accept skill uploads** | Download `geo-doctor.zip` from [Releases](https://github.com/Fangx-AI/geo-doctor/releases) and upload it on the skills page |

<a id="what"></a>

## 🩺 What it does

Like a doctor's visit, in eight steps, each with a file you keep:

| Step | You say | GEO Doctor | You get |
| --- | --- | --- | --- |
| 0 Intake | "help me with GEO" | Asks about your product, your market and which AI matters most, then researches your industry | Case notes |
| 1 Audit | "can AI read my site?" | Checks robots.txt, AI crawlers, firewalls, noindex, and whether your copy is in the raw HTML | Issue list with fixes |
| 2 Fact card | "organize my product facts" | Collects facts from your site, pricing and docs, and flags channels that disagree | One source of truth |
| 3 Questions | "how do people ask AI?" | Writes 20–30 questions in your users' own words and picks 10 core ones | Question set |
| 4 Sampling | "what does AI say about me now?" | Tells you which 10 questions to ask in your target AI; you paste the answers back. With API keys it can also ask ChatGPT, Claude, Perplexity, Gemini, DeepSeek and others automatically, archiving every answer | Answer archive and recommendation rate |
| 5 Diagnosis | "why doesn't it recommend me?" | Computes your recommendation rate, ranks competitors, and lists each question where a competitor is recommended and you aren't, with the sites AI read | Competitor gap list and prescription |
| 6 Batch writing | "write them all" | One article per gap question, only from the fact card; a script checks placeholders, hype, unconfirmed facts and near-duplicates | A batch of pages, FAQs, comparisons |
| 7 Batch publishing | "publish them" | Picks platforms by target AI. Publishes to your own site automatically (static HTML, WordPress, any HTTP API); packages ready-to-paste posts for Medium, Reddit, Zhihu, WeChat and more that you publish yourself | Live site pages, platform-ready posts and a checklist |
| 8 Re-test | "two weeks later, did it work?" | Asks the same questions again and compares, with sample sizes; automatic sampling can run weekly to track the trend | Re-test report |

Supports **software, apps, websites, mini programs and online products**. A local-business version is in progress.

> Step 4 can run automatically: `OPENAI_API_KEY=… npx -p github:Fangx-AI/geo-doctor geo-probe run geo/questions.csv --ai openai,perplexity --brand "Your brand" --competitors "Rival A,Rival B"` asks each question twice, archives every answer and counts who gets recommended. API answers can differ from the apps (no login, often no web search), so confirm important conclusions by asking in the app.
>
> Steps 6 and 7 also run from the command line: `npx -p github:Fangx-AI/geo-doctor geo-publish check geo/drafts` checks a batch, `… site … --to wordpress` publishes to your site, `… pack …` packages posts for other platforms. Run `geo-publish --help` for the full usage.

<a id="faq"></a>

## ❓ FAQ

**Does it cost anything?** No. The skill and the audit script are open source (MIT). It only uses your own AI assistant's quota.

**Is it safe?** The audit script has zero dependencies. It only fetches the URL you give it plus its robots.txt and sitemap.xml, uploads nothing to third parties and reads no keys. It fetches pages with AI crawler user-agents to check whether your firewall blocks them, so only audit sites you own.

**Can it guarantee ChatGPT will recommend me?** No, and nobody can. GEO Doctor finds what AI can't read or gets wrong, helps you fix it, and re-asks the same questions to show what changed. If someone guarantees placement, ask them for the denominator and the raw records.

**Can it write and publish in bulk without becoming spam?** Yes. Each article answers a different real question where AI left you out, every fact must be one you confirmed, and reworded copies of the same article are flagged. Your own site can be published automatically; third-party platforms are only packaged, and you post them from your real account, because automated mass posting gets accounts banned. Fake reviews and inflated numbers are refused in the skill itself.

**Can I use it inside ChatGPT or Doubao?** Plain chat apps can't install skills yet. Run the diagnosis in an assistant that can, then ask your questions in ChatGPT, Claude or Doubao when sampling, because what users see in the app is what counts.

<a id="quickstart"></a>

## 🧰 No skill? Run the audit directly

No install, works on Windows / macOS / Linux with Node.js 18+:

```bash
npx github:Fangx-AI/geo-doctor https://your-site.com/pricing --phrase "a key sentence from the page"
```

<p align="center"><img src="assets/geo-audit-terminal-en.png" alt="Real output of the audit script: all 9 AI search crawlers are allowed, but the raw HTML has no body text. Score 60/100" width="100%"></p>
<p align="center"><sub>Real, unedited output of the audit step, run against a local test page: crawlers are allowed, but the raw HTML is an empty <code>&lt;div id="root"&gt;</code>, so AI crawlers that don't run JavaScript can't read the text.</sub></p>

Seven groups of checks and a 0–100 score: status and redirects, robots.txt rules for 9 AI and search crawlers (RFC 9309 longest-match, wildcards), whether a firewall/CDN blocks AI crawler user-agents, `noindex` in headers and meta, canonical, whether your copy is in the raw HTML (not only rendered by JavaScript), sitemap and JSON-LD. Add `--json` for machine output, `--report report.md` for a Markdown report, `--fail-under 80` to fail CI, `--badge geo-badge.svg` for a [score badge](#badge).

**GitHub Action**: catch a staging `noindex` or `Disallow: /` before it reaches production.

```yaml
- uses: Fangx-AI/geo-doctor@master
  with:
    urls: |
      https://example.com/
      https://example.com/pricing
    fail-under: 80
```

No Node? Use [`toolkit/geo-audit.sh`](toolkit/geo-audit.sh) (macOS / Linux) or [`toolkit/geo-audit.ps1`](toolkit/geo-audit.ps1) (Windows) with fewer checks.

<a id="badge"></a>

## 📛 Audit badge

Score **80 or higher** and the audit prints one extra line of badge code. Paste it into your README or website footer to show visitors that AI crawlers can read your site:

[![GEO audit 96/100](https://img.shields.io/badge/GEO%20audit-96%2F100-brightgreen)](#badge)
[![GEO audit 85/100](https://img.shields.io/badge/GEO%20audit-85%2F100-green)](#badge)

**Want to share it?** Add `--card geo-card.png` for a 1200×630 image you can post anywhere (PNG needs Chrome or Edge installed; otherwise you get an SVG). It works at any score, and a before/after pair is the most convincing.

<p align="center"><img src="assets/geo-card-demo-en.png" alt="Share image example: fawn-budget.example scores 94/100; every check passes except content, which needs a look" width="70%"></p>
<p align="center"><sub>Example site and score.</sub></p>

Add `--report audit.md` for an HTML version, or `--badge geo-badge.svg` for a self-hosted SVG. Colours: 90+ bright green, 80–89 green, 61–79 yellow, 60 or below red.

<details>
<summary markdown="span"><b>Keep it current every week</b> (GitHub Actions)</summary>

```yaml
name: GEO badge
on:
  schedule: [{ cron: "0 2 * * 1" }]
  workflow_dispatch:
permissions:
  contents: write
jobs:
  badge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Fangx-AI/geo-doctor@master
        with:
          urls: https://your-site.com/
          badge: .github/geo-badge.svg
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add .github/geo-badge.svg
          git diff --cached --quiet || (git commit -m "Update GEO audit badge" && git push)
```

Then use `[![GEO audit](.github/geo-badge.svg)](https://github.com/Fangx-AI/geo-doctor#badge)` in your README.

</details>

> The badge reflects one technical audit, not whether AI will recommend the site. **Came here from a badge on someone's site?** Test your own with the command above, or [install GEO Doctor](#install) to get ChatGPT, Claude and others to recommend you.

<a id="handbook"></a>

## 📚 The GEO handbook (Chinese)

The skill is built on a field guide written in Chinese. Every claim links to an official doc or a published study.

| Part | What you get |
| --- | --- |
| [GEO in 5 minutes](docs/basics.md) | The 6 stages behind an AI answer (crawl → index → retrieve → generate → cite → act) and how to tell where you're stuck |
| [12 GEO myths](docs/myths.md) | e.g. *Google Search does not use llms.txt*; *blocking GPTBot does not remove you from ChatGPT search*. Each one cites the source |
| 8 playbooks | [Website](docs/playbooks/website.md) · [WeChat Mini Program](docs/playbooks/mini-program.md) · [SaaS/App](docs/playbooks/product.md) · [Local business](docs/playbooks/local-business.md) · [E-commerce](docs/playbooks/ecommerce.md) · [B2B services](docs/playbooks/b2b.md) · [Creators](docs/playbooks/creator.md) · [Multilingual](docs/playbooks/multilingual.md) |
| Platform rules | [Google, Bing/Copilot, ChatGPT, Perplexity, Claude](docs/platforms/international.md) · [Doubao, DeepSeek, Baidu, Yuanbao, Kimi, Qwen](docs/platforms/china.md) |
| [Measurement](docs/measurement.md) | Mention → citation → supported citation → visit → conversion, with a 16-row worked example and a local script |
| [Case teardowns](docs/cases.md) · [Studies](docs/studies.md) · [Papers](docs/research.md) | What the numbers actually mean: denominators, controls, percentage points vs percent |

## Other tools

- [`toolkit/robots-ai-bots.txt`](toolkit/robots-ai-bots.txt): robots template grouped by *search / training / user-triggered* crawlers.
- [`toolkit/prompts.md`](toolkit/prompts.md): 10 prompts (Chinese) for question mining, fact cards, rewriting, fact-checking AI citations, and diagnosing wrong answers.

All sources verified on 2026-10-14. Contributions (especially cases with disclosed denominators) are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

If this helps you, a ⭐ star helps others find it.

<sub>geo-doctor (GEO 医生, formerly GEO-Playbook) · Generative Engine Optimization playbook. Code and skill: [MIT](LICENSE). Text, templates and diagrams: [CC BY 4.0](LICENSE-docs.md). Project summary for AI: [llms.txt](llms.txt).</sub>
