<div align="center">

<img src="assets/hero-banner.jpg" alt="GEO 医生：你的官网很漂亮，AI 看到的却是一片空白" width="88%">

# 🩺 GEO 医生

**让豆包、DeepSeek、ChatGPT、Claude 在回答「用什么」的时候提到你。**

免费开源 · 不用服务器 · 一句话安装 · 中英双语

[![test](https://github.com/Fangx-AI/geo-doctor/actions/workflows/test.yml/badge.svg)](https://github.com/Fangx-AI/geo-doctor/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[装](#install) · [做什么](#what) · [不装也能用](#quickstart) · [常见问题](#faq) · [English](README.en.md)

</div>

用户不再只搜关键词，而是直接问 AI：「20 人团队用什么知识库？」「有没有不用联网的记账 App？」

**AI 的回答里没有你、把你的价格说错，或者只提竞品，你就在悄悄丢客户。** 找 GEO 服务商要花几千到几万，效果还说不清。GEO 医生把整套方法装进你已经在用的 AI 助手，你只要说一句 **「帮我做 GEO」**。

<a id="what"></a>

## 它会做什么

<table>
<tr>
<td width="33%" valign="top"><b>🔍 找到差距</b><br><sub>AI 推荐了谁、推荐几次、推荐别人时读了哪些网站，你缺在哪一题</sub></td>
<td width="33%" valign="top"><b>✍️ 补内容</b><br><sub>一道缺口一篇稿，只用你确认过的事实；官网自动发，第三方平台排好版由你点发布</sub></td>
<td width="33%" valign="top"><b>📈 看结果</b><br><sub>同一批问题改前改后各问一遍，用推荐次数对比，不靠感觉</sub></td>
</tr>
</table>

<p align="center"><img src="assets/geo-doctor-demo.gif" alt="演示：说「帮我做 GEO」，先体检官网（60 分，AI 爬虫读不到正文），再给出 10 道采样题；贴回 20 条回答后列出竞品推荐榜和按优先级排好的处方" width="100%"></p>

<p align="center"><sub>演示用的小鹿记账是虚构产品，竞品和推荐次数是示例数据；体检那段是脚本的真实输出。</sub></p>

它不承诺 AI 排名，不刷量，不写虚假评价，也不替你用账号去没有开放接口的平台发帖 —— 这些事本身就是监管在整治的「GEO 投毒」。

<a id="install"></a>

## 安装

在 Claude Code、Codex、Kimi Code、WorkBuddy 等能装技能的 AI 助手里新开一个对话，发送：

```text
帮我安装这个 skill：https://github.com/Fangx-AI/geo-doctor/tree/master/skills
```

装好后说一句 **「帮我做 GEO」**，它会先问几个问题，再分诊到该做的那一步。

**只装一个**：把链接换成目录（如 `.../skills/ai-crawler-audit`），或用命令行：

```bash
npx skills add Fangx-AI/geo-doctor -s ai-crawler-audit -g
```

<details>
<summary><b>其他安装方式</b>（不进对话、手动放目录、上传压缩包）</summary>

| 你用的工具 | 怎么装 |
| --- | --- |
| 任意支持 Agent Skills 的客户端 | `npx skills add Fangx-AI/geo-doctor -g`（六个一起）；符号链接装不上时加 `--copy` |
| Claude Code | `/plugin marketplace add Fangx-AI/geo-doctor`，再 `/plugin install geo-doctor@geo-doctor` |
| Codex | 请 `$skill-installer` 安装本仓库的 `skills/<名字>`，或放进 `~/.agents/skills/<名字>/` |
| Kimi Code | 放进 `~/.kimi-code/skills/<名字>/` |
| 支持上传技能包的客户端 | 从 [Releases](https://github.com/Fangx-AI/geo-doctor/releases) 下载 `<名字>.zip` 或 `geo-doctor-all.zip` 上传 |

豆包、DeepSeek 这类聊天 App 装不了技能（2026-10-14 实测），但它们正是要优化的对象：在能装技能的助手里诊断，采样时再去豆包里问。其他平台的实测结果记在[安装指南](docs/install.md)。

</details>

<a id="skills"></a>

## 六个技能

每个只做一件事。**装整套**适合从零开始，**只装一个**适合你知道卡在哪一步。

| 技能 | 它回答的问题 |
| --- | --- |
| `geo-doctor` | 不确定从哪一步开始？全流程总纲、分诊、每周自动复查 |
| `ai-crawler-audit` | AI 爬虫能不能读到我的页面？读不到该改哪 |
| `ai-visibility` | AI 到底提不提我、推荐的是谁、我缺哪几道题 |
| `ai-content-writer` | 该写什么？AI 把我的信息说错了怎么办 |
| `llms-txt` | llms.txt 和给 AI 读的事实站怎么做 |
| `geo-publish` | 发到哪、怎么发、发完怎么记账 |

<details>
<summary><b>九步完整流程</b>（每步都有交付物）</summary>

| 步 | 你说 | 你拿到 | 技能 |
| --- | --- | --- | --- |
| 0 问诊 | 帮我做 GEO | 病历：产品、目标 AI、行业调研 | `geo-doctor` |
| 1 体检 | AI 能读到我的网站吗 | 问题清单和修法 | `ai-crawler-audit` |
| 2 事实卡 | 帮我整理产品资料 | 唯一事实源，标出各渠道说法不一致处 | `ai-content-writer` |
| 3 问题集 | 用户会怎么问 AI | 问题基线：12–18 道冻结核心题 | `ai-visibility` |
| 4 采样 | AI 现在怎么说我 | 回答存档和推荐率 | `ai-visibility` |
| 5 诊断 | 为什么不推荐我 | 竞品推荐榜 + 逐题缺口 + 处方 | `ai-visibility` |
| 6 批量写 | 缺口都帮我写了 | 一批文章、FAQ、对比页 | `ai-content-writer` |
| 7 批量发 | 帮我发出去 | 已发布页面、各平台稿件、发布清单 | `geo-publish` |
| 8 复查 | 两周了，有用吗 | 前后对比报告；可开每周自动驾驶 | `ai-visibility` |

目前支持软件、App、网站、小程序和线上产品。想在本机看着操作，跑 `npx -p github:Fangx-AI/geo-doctor geo-studio`，浏览器打开 `http://127.0.0.1:4173`。

</details>

<a id="quickstart"></a>

## 不装 skill 也能用

装了 [Node.js](https://nodejs.org/zh-cn)（18 以上），一行命令检查 AI 能不能读到你的网页：

```bash
npx github:Fangx-AI/geo-doctor https://你的网站/重要页面 --phrase "页面里的一句关键正文"
```

检查 7 类问题并打 0–100 分：访问与跳转、robots.txt 对 9 个 AI 与搜索爬虫的规则、防火墙是否拦 AI、noindex、canonical、正文是否在原始 HTML 里、sitemap 与结构化数据。满分 80 以上会给你一行徽章代码，`--card` 还能出一张分享图。

<p align="center"><img src="assets/geo-audit-terminal.png" alt="体检脚本的真实输出：9 个 AI 搜索爬虫都放行，但原始 HTML 里没有正文，得分 60/100" width="100%"></p>

<p align="center"><sub>真实输出（对一个本地测试页运行）：爬虫都放行了，但原始 HTML 只有一个空的 <code>&lt;div id="root"&gt;</code>，不执行 JavaScript 的 AI 爬虫读不到正文。</sub></p>

👉 [15 分钟上手](docs/quickstart.md) · [GitHub Action 自动体检](docs/handbook.md#ci) · [徽章与分享图](docs/badge.md)

<a id="faq"></a>

## 常见问题

**要花钱吗？** 不要。代码和技能都是 MIT 开源，只消耗你自己 AI 助手的额度。

**能保证豆包推荐我吗？** 不能，谁都不能。它做的是把 AI 读不到、说不对的地方找出来修好，再用同一批问题前后对比。承诺「保证上推荐」的，先问他要分母和原始记录。

**安全吗？** 体检脚本零依赖，只访问你给的网址和它的 robots.txt、sitemap.xml，不上传数据、不读密钥。它会模拟 AI 爬虫的身份访问页面（用来检查防火墙有没有拦 AI），所以只体检自己的网站。

**能批量写吗？会不会变成刷软文？** 能批量，但一篇对应一道 AI 没推荐你的真实问题，事实要你确认，重复稿会被脚本拦下。第三方平台只排版、由你本人发 —— 机器批量发帖容易封号。

<a id="more"></a>

## 更多

- **[GEO 实战手册](docs/handbook.md)**：每条结论附原文或研究出处，不装 skill 也能照着做。按项目选路线：[网站](docs/playbooks/website.md) · [小程序](docs/playbooks/mini-program.md) · [SaaS / App](docs/playbooks/product.md) · [本地商家](docs/playbooks/local-business.md) · [电商](docs/playbooks/ecommerce.md) · [B2B](docs/playbooks/b2b.md) · [创作者](docs/playbooks/creator.md) · [出海多语言](docs/playbooks/multilingual.md)
- **[中文网站 AI 爬虫封锁榜](docs/ai-crawler-leaderboard.md)**：97 个知名中文站的 robots.txt，知乎、小红书、微博、贝壳、马蜂窝都把 ChatGPT 搜索、Perplexity、Claude 搜索挡在门外
- **[参与贡献](CONTRIBUTING.md)**：欢迎能公开分母的中文案例、官方文档、失败实验；不熟悉 Git 直接[提 Issue](https://github.com/Fangx-AI/geo-doctor/issues/new/choose)

给 AI 读的项目简介：[llms.txt](llms.txt) · 资料核验 2026-10-14 · 结构参考 [LLM Course](https://github.com/mlabonne/llm-course)

<sub>代码与技能 [MIT](LICENSE)，原创文字、模板与图解 [CC BY 4.0](LICENSE-docs.md)。外部文章、论文、代码、商标和图片保留各自权利。图片说明见 [assets/README.md](assets/README.md)。</sub>
