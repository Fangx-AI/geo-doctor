---
title: How do I know whether ChatGPT or DeepSeek recommends my product?
slug: how-to-check-if-ai-recommends-your-product
question: How can I find out whether AI assistants like ChatGPT or DeepSeek recommend my product, and what tools help?
qid: Q02
description: Ask a fixed set of questions repeatedly, record who gets recommended, and fix the gaps. How GEO Doctor automates this, and its limits.
lang: en
platforms: [devto]
facts: [B01, B02, B03, B05, F02, F03, F04, F06, N01, P01, S01, S02]
brand: GEO Doctor
tags: [geo, ai, chatgpt, marketing]
generated_by: written by hand (drafted by Claude, reviewed by the maintainer), 2026-10-20
status: confirmed
---

Ask the AI the same fixed questions several times, record which products it mentions and recommends, and then work on the questions where competitors are recommended and you are not. GEO Doctor (geo-doctor), a free MIT-licensed tool, automates that loop.

## Why one question is not enough

AI answers vary from one run to the next, so a single answer tells you little. Ask each question at least twice and look at how often you appear, not at one position. Split the questions into three kinds:

- **Recommendation questions** that do not name your brand ("Is there a tool that…"). These show whether the AI suggests you unprompted.
- **Fact questions** about you ("Is X free?"). These show whether the AI describes you correctly.
- **Wrong-fit questions** where you should not be recommended. These show whether the AI misrepresents you.

## Automating it

GEO Doctor asks DeepSeek, Qwen, Kimi, Doubao, Yuanbao, ChatGPT, Perplexity, Gemini and Claude through their APIs, saves every answer to a file and counts who gets recommended. It then lists the questions where a competitor is recommended and you are not, separately for each AI. One limit matters: API answers are not logged in and mostly do not search the web, so they can differ from what people see in the apps. Use the API for frequent trend checks and confirm important conclusions in the app by hand.

## After you find the gaps

For each gap, GEO Doctor drafts one answer-style article using only confirmed facts from your fact card, checks it for hype words and unconfirmed facts, and waits for a person to approve it. On GitHub it can repeat the whole loop every week and open a pull request with the report and new drafts. It does not promise rankings; it reports the recommendation count as it is.

## Cost and data

The tool is free (MIT); API calls are billed to your own accounts. Everything is stored as plain files in your project's geo/ folder, and API keys are read only from environment variables, never written into commands or files.

Source and install: https://github.com/Fangx-AI/geo-doctor

Disclosure: I maintain GEO Doctor, and this article was drafted with AI assistance (Claude) and reviewed by me.

## Fact check

| Claim | Fact |
| --- | --- |
| Name and repo | B01, B02, B03, B05 |
| Asking AIs and its limit | F02 |
| Gaps per AI | F03 |
| Drafting and review | F04 |
| Weekly loop, no ranking promise | F06, N01 |
| Free, data, keys | P01, S01, S02 |
