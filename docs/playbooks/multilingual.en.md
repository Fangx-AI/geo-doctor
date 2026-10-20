# 🌏 Multilingual and Going-Global GEO

> [GEO Playbook](../handbook.md) › By Project › Multilingual

**Across different countries: what can be translated, and what must be rewritten per market?**

| ⏱ Time | 👤 Who it's for | 📦 What you end up with |
| --- | --- | --- |
| 1 day+ | Going-global teams, multilingual sites | Per-market fact cards · Real question sets per market · Two-way `hreflang` checks |

**Three things to remember first**

1. One fact card per market: language, region, currency, deliverable languages, exclusions.
2. Collect real phrasings per market separately, then align intent — never compare results across two different question sets.
3. `hreflang` must be reciprocal; it only describes the relationship between versions and never replaces local facts.

---

**1. Separate market facts from the translation.** Write one fact card per market for the same service, recording language, service region, currency, time window, deliverable languages and exclusions. In the [B2B playbook](b2b.md), the podcast editing example can be split into two rows — `zh-CN / Mainland China / Mandarin transcript` and `en-SG / Singapore / English transcript`; if English review-listening is not offered, write that it is not offered, and do not let the translation invent new capabilities.

**2. Find the questions first, align intent second.** For each market, collect five real enquiries verbatim and note the source; put "播客后期" (podcast post-production) and "podcast editing" in the same intent family while keeping the user's original wording. If you have no real enquiries, use hand-written practice questions and label them as such. Have someone familiar with local usage review terminology, units and service boundaries, then test each market separately; do not compare citation rates across two different question sets and call it a language effect.

**3. Check reciprocity when separate language pages exist.** Google's `hreflang` guidance requires each version to list itself and the other versions, using full URLs, with reciprocal links. The example below is written for this project; both versions put the same set of links in `<head>`, and it should only be used when the pages really exist and are genuine equivalents of each other. [Google guide to localized versions](https://developers.google.com/search/docs/specialty/international/localized-versions)

```html
<link rel="alternate" hreflang="zh-CN" href="https://example.com/zh-cn/podcast-editing">
<link rel="alternate" hreflang="en-SG" href="https://example.com/en-sg/podcast-editing">
```

When reviewing, check the language switcher, the actual page content, the return markers and local availability at the same time. `hreflang` describes the relationship between versions; it does not replace local facts, and it does not imply that every AI platform uses it when choosing citations.

---

<div align="center">

← [Creator playbook](creator.md) · [🏠 Contents](../handbook.md) · [International platform rules](../platforms/international.md) →

<sub>If this helped, go back to the [home page](../../README.md) and give it a ⭐ Star; if you spot an error or outdated information, feel free to [open an issue](https://github.com/Fangx-AI/geo-doctor/issues/new/choose).</sub>

</div>
