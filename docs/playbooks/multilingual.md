# 🌏 多语言与出海 GEO

> [GEO 实战手册](../handbook.md) › 按项目实战 › 多语言
>
> **English:** [Multilingual and Going-Global GEO](multilingual.en.md)

**面向不同国家：哪些能翻译，哪些必须按市场重写？**

| ⏱ 用时 | 👤 适合谁 | 📦 做完你手里有 |
| --- | --- | --- |
| 1 天起 | 出海团队、多语言站点 | 分市场事实卡 · 各市场真实问题集 · 双向 hreflang 检查 |

**先记住这 3 条**

1. 每个市场单独一张事实卡：语言、地域、币种、可交付语言、排除项。
2. 各市场各自收集真实问法，再对齐意图，不拿两组不同题目直接比较效果。
3. `hreflang` 要双向互指；它只说明版本关系，不替代本地事实。

---

**1. 把市场事实从译文里拆出来。** 给同一条服务各写一张事实卡，分别记录语言、服务地域、币种、时间区间、可交付语言与排除项。[B2B 路线](b2b.md)里的播客教学例子可做 `zh-CN / 中国大陆 / 普通话逐字稿` 与 `en-SG / 新加坡 / 英文逐字稿` 两行；英文审听如果并未提供，就写不提供，不让翻译补出新能力。

**2. 各自找问题，再对齐意图。** 每个市场先收集 5 条真实咨询原话，标明来源；将“播客后期”和“podcast editing”放进同一个意图家族，但保留用户原始措辞。没有真实咨询时，用人工构造题练习并标明性质。请熟悉当地用法的人复核术语、单位与服务边界，再分别测试；不要拿两组不同题目的引用率直接比较语言效果。

**3. 有独立语言网页时检查双向对应。** Google 的 `hreflang` 指南要求列出自身与其他版本、使用完整 URL，并提供返回关系。下面是本项目自写示例，两个版本的 `<head>` 都放同一组链接；仅在页面确实存在、内容互为对应版本时使用。[Google 多语言版本指南](https://developers.google.com/search/docs/specialty/international/localized-versions)

```html
<link rel="alternate" hreflang="zh-CN" href="https://example.com/zh-cn/podcast-editing">
<link rel="alternate" hreflang="en-SG" href="https://example.com/en-sg/podcast-editing">
```

验收时同时检查语言切换、实际页面内容、返回标记和当地可用条件。`hreflang` 说明版本关系，不替代本地事实，也不能推出所有 AI 平台都按它选择引用。

---

<div align="center">

← [创作者实战](creator.md) · [🏠 目录](../handbook.md) · [国际平台规则](../platforms/international.md) →

<sub>有帮助的话，回 [首页](../../README.md) 点个 ⭐ Star；发现错误或过时信息，欢迎 [提 Issue](https://github.com/Fangx-AI/geo-doctor/issues/new/choose)。</sub>

</div>
