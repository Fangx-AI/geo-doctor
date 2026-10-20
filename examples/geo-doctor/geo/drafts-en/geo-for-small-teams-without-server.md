---
title: GEO for small teams with no server
slug: geo-for-small-teams-without-server
question: How can a small team with no server do generative engine optimization?
qid: Q05
description: Five steps to generative engine optimization without a server or a paid SaaS, using free open-source tools.
lang: en
platforms: [devto]
facts: [B01, B03, B05, U01, U02, F01, F02, F03, F04, F05, F06, F07, P01, C01, S01, S02, N01]
brand: GEO Doctor
tags: [geo, ai, startup, indiehackers]
generated_by: written by hand (drafted by Claude, reviewed by the maintainer), 2026-10-20
status: confirmed
---

A small team can do GEO (generative engine optimization) without a server: run the work from an AI assistant or the command line on your own machine, host the fact site on free GitHub Pages, and let GitHub Actions run the weekly re-check. The free, open-source GEO Doctor (geo-doctor) is built that way: no server, no database.

Disclosure: I maintain GEO Doctor, and this article was drafted with AI assistance (Claude) and reviewed by me.

## 1. List the questions people ask AI

Write about ten questions in your users' words, in three kinds: recommendation questions that do not name you ("Is there a budgeting app that works offline?"), fact questions about you ("Is that app free?"), and cases you do not fit, to see whether AI wrongly suggests you.

## 2. Build a fact card

Write down your name, what the product does, price, who it is and is not for, and how it differs from alternatives, with a source for each line, and confirm each one. Everything you publish afterwards uses only these facts, so AI sees one consistent story.

## 3. Ask the AIs and find gaps

GEO Doctor asks DeepSeek, Qwen, Kimi, Doubao, Yuanbao, ChatGPT, Perplexity, Gemini and Claude through their APIs, saves every answer, and lists the questions where a competitor is recommended and you are not, per AI. API answers can differ from the apps, so confirm important findings by hand.

## 4. Write for the gaps and put it where AI can read it

- One answer-style article per gap, using only confirmed facts. GEO Doctor checks drafts for placeholders, hype, unconfirmed facts and duplicates, and a person approves each one.
- A fact site built from the fact card (fact page, FAQ, llms.txt, structured data) on free GitHub Pages.
- A quick readability check of your own site: robots.txt, AI crawlers, noindex, visible text.

## 5. Re-check every week

With the project on GitHub and an API key set, GEO Doctor samples weekly, drafts for new gaps, writes a report and opens a pull request for you to review. It does not promise rankings; it reports the count as it is.

## Cost and data

Free and MIT-licensed; only the AI API calls cost money, on your own account. Works with Claude Code, Codex, Kimi Code, AI clients that accept skill packages, and Node.js 18+, plus a local web console with a button for each step. Data is plain files in geo/; API keys come only from environment variables.

Source: https://github.com/Fangx-AI/geo-doctor

## Fact check

| Claim | Fact |
| --- | --- |
| No server, small teams | U02, U01 |
| Name, summary, repo | B01, B03, B05 |
| Asking, gaps | F02, F03 |
| Drafting, site, check | F04, F05, F01 |
| Weekly, no ranking promise | F06, N01 |
| Free, platforms, console | P01, C01, F07 |
| Data and keys | S01, S02 |
