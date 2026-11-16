# 🌍 海外 AI 信源地图：ChatGPT、Claude、Perplexity、Google、Copilot

> 核验日期 2026-10-14。目标 AI 在海外时，第 0、1、7 步必读；国内 AI 见 [ai-sources-cn.md](ai-sources-cn.md)。用户用英文交流时，把这里的内容用英文转述给用户。

**海外 AI 搜索大多建立在搜索引擎索引和各家自己的搜索爬虫上。** 所以海外 GEO 的地基是三件事：页面被 Google、必应收录；目标 AI 的搜索爬虫没有被 robots.txt、CDN 或防火墙挡住；正文在原始 HTML 里读得到。第 1 步体检脚本已经覆盖后两件。

标签：🟢 官方口径 · 📊 第三方研究（注明样本） · ❓ 常见说法，但未找到可靠出处

## 一张表看懂

| AI | 搜索靠什么 | 要放行的爬虫 | 能看到数据的地方 | 证据 |
| --- | --- | --- | --- | --- |
| **ChatGPT** | 查询可能被改写后交给第三方搜索合作方；排名使用多个因素，位置没有保证 | `OAI-SearchBot`（搜索）；`GPTBot` 只管训练 | 无官方站长报表，靠第 4 步采样 | 🟢 [ChatGPT 搜索帮助](https://help.openai.com/en/articles/9237897-searching-the-web-with-chatgpt) · 🟢 [OpenAI 爬虫说明](https://developers.openai.com/api/docs/bots) |
| **Claude** | 消费端可联网搜索，也可直接读用户给的链接 | `Claude-SearchBot`（搜索）、`Claude-User`（用户请求）；`ClaudeBot` 只管训练 | 无官方站长报表 | 🟢 [Anthropic 爬虫说明](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) · 🟢 [Claude 联网搜索](https://support.claude.com/en/articles/10684626-enable-and-use-web-search) |
| **Perplexity** | 自有搜索爬虫 | `PerplexityBot`（搜索）；`Perplexity-User` 是用户请求，通常不看 robots.txt | 无官方站长报表 | 🟢 [Perplexity 爬虫说明](https://docs.perplexity.ai/docs/resources/perplexity-crawlers) |
| **Google AI 概览 / AI Mode** | Google 搜索索引；页面要能被索引、能显示摘要 | `Googlebot`；不需要 llms.txt，也没有"AI 专用 schema" | Search Console 生成式 AI 报表；可在 Search Console 单独设置是否参与生成式功能 | 🟢 [Google 生成式搜索指南](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) · 🟢 [报表公告](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports) · 🟢 [生成式 AI 控制](https://support.google.com/webmasters/answer/16908024) |
| **Gemini** | 部分 grounding 用途受 `Google-Extended` 控制 | `Google-Extended` 是用途开关，不是独立爬虫；关掉不影响 Google 搜索收录 | — | 🟢 [Google 爬虫列表](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended) |
| **Copilot / 必应 AI 摘要** | 必应索引 | `Bingbot` | Bing Webmaster Tools 的 AI Performance（公开预览，看引用次数，不代表排名） | 🟢 [必应公告](https://blogs.bing.com/webmaster/2026/2/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview/) · 🟢 [IndexNow](https://www.indexnow.org/documentation) |

**三条结论**

1. **先确认收录，再谈内容。** 在 Google Search Console 和 Bing Webmaster Tools 里验证网站、提交 sitemap；页面更新后可用 IndexNow 通知必应等参与协议的引擎。收到回执不等于已收录，更不等于已被引用。
2. **搜索爬虫和训练爬虫分开管。** 用户不想让内容被拿去训练，可以挡 `GPTBot`、`ClaudeBot`、`Google-Extended`，但不要挡 `OAI-SearchBot`、`Claude-SearchBot`、`PerplexityBot`、`Bingbot`、`Googlebot`，否则就退出了对应的 AI 搜索。
3. **有报表就用报表。** Google 和必应已经能看到部分 AI 展示或引用数据，复查（第 8 步）时和采样结果一起看，标清各自口径。

## 本地商家：结构化数据比文章重要

| AI | 本地查询主要信源 | 证据 |
| --- | --- | --- |
| Google AI 概览 | **Google 商家资料（Google Business Profile）** 是本地查询第一信源（约 28.5%） | 📊 [BrightLocal，约 197 万条引用](https://www.brightlocal.com/resources/ai-directory-sources/) · 🟢 [Google 商家资料帮助](https://support.google.com/local-listings/answer/9851099?hl=en) |
| ChatGPT | **Yelp** 出现在约 80% 的本地回答里 | 📊 BrightLocal（同上） |

## 官方入口

| 入口 | 作用 |
| --- | --- |
| Google Search Console：https://search.google.com/search-console | 验证网站、提交 sitemap、看生成式 AI 报表 |
| Bing Webmaster Tools：https://www.bing.com/webmasters | 验证网站、提交 sitemap、看 AI Performance |
| IndexNow：https://www.indexnow.org | 页面新增、修改、删除后通知参与协议的搜索引擎 |
| Google 商家资料：https://business.google.com | 门店名称、地址、营业时间、类目 |
| Bing Places：https://www.bingplaces.com | 必应和 Copilot 的门店数据 |
| Yelp for Business：https://biz.yelp.com | 认领商家页，和事实卡保持一致 |

## 还没有可靠证据的说法

| 说法 | 怎么处理 |
| --- | --- |
| 「ChatGPT 最爱引用 Reddit / 维基百科 / G2」等 | ❓ 本仓库尚未核实，各研究的样本和品类差别很大。以第 4 步采样里**目标 AI 实际引用的站点**为准，再决定去哪里发 |
| 「加了 llms.txt 才能被 AI 读到」 | Google 官方明确 Google 搜索不使用 llms.txt；其他平台未见官方要求 |
| 「有专门给 AI 用的 schema」 | Google 官方称没有必需的特殊 schema，只在符合页面类型时加结构化数据 |
