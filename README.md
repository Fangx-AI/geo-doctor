<div align="center">

<img src="assets/hero-banner.jpg" alt="GEO 医生：你的官网很漂亮，AI 看到的却是一片空白" width="100%">

# 🩺 GEO 医生

### 让豆包、DeepSeek、ChatGPT、Claude 愿意推荐你的产品

国内的豆包、DeepSeek、元宝、千问、文心、Kimi，海外的 ChatGPT、Claude、Perplexity、Gemini、Copilot，<br>中文网站、英文网站都能看。

一句话装进你的 AI 助手。它会查出 AI 推荐了哪些竞品、为什么不是你、推荐别人时读的是哪些网站，<br>再帮你成批写出 AI 愿意引用的内容、发到 AI 会读的地方，最后用推荐率复查有没有涨。

<table>
<tr>
<td align="center" width="33%"><b>🔍 找到差距</b><br><sub>AI 推荐了谁、推荐几次、引用了哪些网站，你缺在哪一题，一张表看清</sub></td>
<td align="center" width="33%"><b>✍️ 批量写、批量发</b><br><sub>一道缺口一篇，只用你的真实事实；官网自动发，知乎、公众号等排好版由你点发布</sub></td>
<td align="center" width="33%"><b>📈 看推荐率涨没涨</b><br><sub>同一批问题改前改后各问一遍，你和竞品的推荐次数并排对比</sub></td>
</tr>
</table>

**免费开源** · **不用服务器** · **一句话安装** · **中英双语** · 已在 WorkBuddy 实测可用

[![test](https://github.com/Fangx-AI/geo-doctor/actions/workflows/test.yml/badge.svg)](https://github.com/Fangx-AI/geo-doctor/actions/workflows/test.yml)
[![资料核验](https://img.shields.io/badge/资料核验-2026--10--14-2ea44f)](docs/handbook.md#evidence)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[🎬 看演示](#demo) · [📦 安装](#install) · [🩺 它会做什么](#what) · [❓ 常见问题](#faq) · [🧰 不装也能用](#quickstart) · [📚 GEO 实战手册](docs/handbook.md) · [English](README.en.md)

</div>

---

用户越来越多地直接问 AI："20 人团队用什么知识库？""有没有不用联网的记账 App？""best CRM for a 10-person startup?"

**AI 的回答里没有你，或者把你的价格、功能说错了，你就在悄悄失去用户。** 找 GEO 服务商要花几千到几万，效果还说不清。GEO 医生把整套方法装进你已经在用的 AI 助手里，你只要说一句"帮我做 GEO"。

<a id="demo"></a>

## 🎬 30 秒看它怎么工作

<p align="center"><img src="assets/geo-doctor-demo.gif" alt="演示：在 AI 助手里说「帮我做 GEO」，GEO 医生先体检官网（60 分，AI 爬虫读不到正文），再给出 10 道采样题；贴回 20 条豆包回答后，列出竞品推荐榜（竞品甲 13/20，小鹿记账 1/20）、豆包常引用的来源和按优先级排好的处方" width="100%"></p>
<p align="center"><sub>演示用的小鹿记账是虚构产品，竞品和推荐次数是示例数据；体检那一段是脚本对本地测试页的真实输出。</sub></p>

<a id="install"></a>

## 📦 安装：复制一句话发给你的 AI

在 Claude Code、Codex、Kimi Code、WorkBuddy 等能安装技能的 AI 助手里，新开一个对话，发送：

```text
帮我安装这个 skill：https://github.com/Fangx-AI/geo-doctor/tree/master/skills/geo-doctor
```

装好后说一句 **"帮我做 GEO"**，它会先问你几个问题，再开始体检。

> 豆包、DeepSeek 这类普通聊天 App 目前装不了技能（2026-10-14 在豆包 App 实测），但它们正是 GEO 医生要优化的对象：在能装技能的助手里诊断，采样时再去豆包里问。
>
> 已实测：**WorkBuddy（Windows 桌面端）一句话即可装好并进入问诊**。其他平台还在逐一实测，结果会更新在[安装指南](docs/install.md)。AI 说"装不了"或打不开链接时，可以用下面的方式，或[提 issue](https://github.com/Fangx-AI/geo-doctor/issues/new/choose) 告诉我们是哪个平台。

<details>
<summary markdown="span"><b>其他安装方式</b>（命令行、手动复制、上传压缩包）</summary>

| 你用的工具 | 怎么装 |
| --- | --- |
| **Claude Code** | 输入 `/plugin marketplace add Fangx-AI/geo-doctor`，再输入 `/plugin install geo-doctor@geo-doctor` |
| **Codex** | 请 `$skill-installer` 安装本仓库的 `skills/geo-doctor`，或把完整文件夹放到 `~/.agents/skills/geo-doctor/` |
| **Kimi Code** | 把完整文件夹放到 `~/.kimi-code/skills/geo-doctor/`（设置了 `KIMI_CODE_HOME` 时放到 `$KIMI_CODE_HOME/skills/geo-doctor/`），新开会话后使用 |
| **支持上传技能包的客户端** | 在 [Releases](https://github.com/Fangx-AI/geo-doctor/releases) 下载 `geo-doctor.zip`，在技能页面上传 |

</details>

<a id="what"></a>

## 🩺 它会做什么

像看病一样，八步走完，每一步都有交付物：

| 步 | 你说 | GEO 医生做什么 | 你拿到 |
| --- | --- | --- | --- |
| 0 问诊 | "帮我做 GEO" | 问清产品、想被哪个 AI 推荐（国内还是海外），联网调研你的行业 | 病历 |
| 1 体检 | "AI 能读到我的网站吗" | 查 robots、AI 爬虫、noindex、正文能不能被读到 | 问题清单和修法 |
| 2 事实卡 | "帮我整理产品资料" | 从官网、价格页、文档里整理事实，找出各渠道说法不一致的地方 | 唯一事实源 |
| 3 问题集 | "用户会怎么问 AI" | 用真实用户的原话，写 20 到 30 道题，挑 10 道核心题 | 问题清单 |
| 4 采样 | "AI 现在怎么说我" | 告诉你去目标 AI 里问哪 10 道题，你把回答贴回来；有 API Key 时也可以自动问 DeepSeek、千问、Kimi、豆包、ChatGPT 等，每条回答都存档 | 回答存档和推荐率 |
| 5 诊断 | "为什么不推荐我" | 算推荐率，排出竞品推荐榜，逐题列出"竞品被推荐、你没有"的缺口和 AI 读的网站 | 竞品缺口清单和处方 |
| 6 批量写 | "缺口都帮我写了" | 一道缺口题一篇，只用事实卡里的事实，脚本自动查占位符、夸大词、未确认事实和重复稿 | 一批文章、FAQ、对比页 |
| 7 批量发 | "帮我发出去" | 按"你想被哪个 AI 推荐"选平台。官网自动发（静态站、WordPress、任意接口）；没有官网或官网 AI 读不懂时，用事实卡一键生成事实站，免费放到 GitHub Pages；知乎、公众号、头条等打包成可直接粘贴的稿件，由你本人点发布 | 已发布的官网页面、事实站、各平台稿件和发布清单 |
| 8 复查 | "两周了，有用吗" | 同一批题再测，前后对比，写明样本数；自动采样可以每周跑一次看趋势 | 复查报告 |

目前支持**软件、App、网站、小程序和线上产品**。本地门店版本在路上。

> 第 4 步可以用命令行自动问：`DEEPSEEK_API_KEY=… npx -p github:Fangx-AI/geo-doctor geo-probe run geo/questions.csv --ai deepseek,qwen --brand "你的品牌" --competitors "竞品甲,竞品乙"`，每题问 2 次，存下全部原文，算出推荐率和竞品推荐榜。用法见 [第 4 步说明](skills/geo-doctor/references/04-sampling.md#自动采样用-api-批量问可选)。
>
> 第 6、7 步也可以单独用命令行跑：`npx -p github:Fangx-AI/geo-doctor geo-publish check geo/drafts` 检查一批草稿，`… site … --to wordpress` 发到官网，`… pack …` 打包第三方平台稿件。完整用法见 [第 7 步说明](skills/geo-doctor/references/07-publishing.md#第三步批量发布自己的官网自动发第三方平台由人发)。
>
> 没有能被 AI 读懂的官网？`npx -p github:Fangx-AI/geo-doctor geo-site build --facts geo/fact-card.yaml --out site --base-url https://你的网址/` 用事实卡里已确认的事实生成事实页、常见问题页、`llms.txt` 和结构化数据，体检 100 分；`geo-site action` 再写一个工作流，自动发布到 GitHub Pages。

> 为什么还要你自己去 App 里问？因为你在 App 里看到的回答，才是你的用户看到的；API 回答不登录、多数不联网，和 App 里可能不一样。自动采样适合高频看趋势，重要结论用 App 里的人工采样确认。AI 每次回答都不一样，所以每题问 2 次，看出现率而不是单次排名。只想提高豆包，就只问豆包，一轮 15 到 20 分钟。

<a id="faq"></a>

## ❓ 常见问题

**要花钱吗？** 不要。skill 和体检脚本都是开源的（MIT），只消耗你自己 AI 助手的额度。

**安全吗？** 体检脚本零依赖，只访问你给的网址和它的 robots.txt、sitemap.xml，不向第三方上传数据，不读密钥。它会模拟 AI 爬虫的身份访问页面，用来检查防火墙有没有拦 AI，所以请只体检自己的网站。

**能保证豆包推荐我吗？** 不能，谁都不能。GEO 医生做的是把 AI 读不到、说不对的地方找出来修好，再用同一批问题前后对比，用数据说明有没有变化。承诺"保证上推荐"的服务，先问他要分母和原始记录。

**能批量写、批量发吗？会不会变成刷软文？** 能批量，但一篇对应一道 AI 没推荐你的真实问题，每个事实都要你确认过，同一内容换个说法重复发会被脚本拦下。官网可以自动发；知乎、公众号这些第三方平台只帮你排好版，由你本人用真实账号发，因为机器批量发帖容易封号，也是监管在整治的"GEO 投毒"。编造用户评价、刷量这类做法，skill 里明确拒绝，高风险行业另有红线（见 [合规说明](skills/geo-doctor/references/compliance.md)）。

**支持英文和海外 AI 吗？** 支持。你用英文跟它说话，它就全程用英文，写出的内容也是英文。目标是 ChatGPT、Claude、Perplexity、Gemini、Copilot 时，体检会重点看这些 AI 的搜索爬虫有没有被挡，发布指导改用必应、Google 的收录入口和海外商家平台。

**豆包、DeepSeek 里能直接用吗？** 普通聊天 App 目前装不了技能。在 WorkBuddy、Claude Code、Codex、Kimi Code 这类能装技能的助手里做诊断，采样时再去豆包、DeepSeek 里问。

<a id="quickstart"></a>

## 🧰 不装 skill 也能用

装了 [Node.js](https://nodejs.org/zh-cn)（18 以上）的话，一行命令检查 AI 能不能读到你的网页：

```bash
npx github:Fangx-AI/geo-doctor https://你的网站/重要页面 --phrase "页面里的一句关键正文"
```

<p align="center"><img src="assets/geo-audit-terminal.png" alt="体检脚本的真实输出：9 个 AI 搜索爬虫都放行，但原始 HTML 里没有正文，得分 60/100" width="100%"></p>
<p align="center"><sub>体检这一步的真实输出（对一个本地测试页运行，未加修饰）：爬虫都放行了，但原始 HTML 只有一个空的 <code>&lt;div id="root"&gt;</code>，不执行 JavaScript 的 AI 爬虫读不到正文。</sub></p>

检查 7 类问题并打 0–100 分：访问与跳转、robots.txt 对 9 个 AI / 搜索爬虫的规则、防火墙是否拦 AI、noindex、canonical、正文是否在原始 HTML 里、sitemap 与结构化数据。

- 第一次用？跟着 [15 分钟上手](docs/quickstart.md)：问 AI、跑体检、改一段文案
- 想在每次上线后自动体检？用 [GitHub Action](docs/handbook.md#ci)
- 没装 Node.js？用 [bash](toolkit/geo-audit.sh) / [PowerShell](toolkit/geo-audit.ps1) 版

<a id="badge"></a>

## 📛 体检徽章

体检到 **80 分以上**，命令行最后会多给你一行徽章代码，贴到 README 或官网页脚，告诉访客"AI 爬虫能读到这个网站"。加 `--badge geo-badge.svg` 可以生成不依赖外部服务的 SVG。颜色、每周自动更新和官网 HTML 版见 [徽章说明](docs/badge.md)。

**想晒一下？** 加 `--card geo-card.png`，生成一张 1200×630 的分享图，发朋友圈、群聊、即刻、小红书都行（本机有 Chrome 或 Edge 就能出 PNG，没有就给 SVG）。任何分数都能生成，改前改后各一张最有说服力。

<p align="center"><img src="assets/geo-card-demo.png" alt="分享图示例：shop.example/pricing 体检 72 分，robots.txt 与 AI 爬虫一项有问题，规范地址和正文两项需要注意" width="70%"></p>
<p align="center"><sub>示例网址，分数为演示数据。</sub></p>

> 徽章和分享图只代表那次技术体检的结果，**不代表** AI 一定会推荐这个网站。
>
> **你是点了别人网站上的徽章过来的？** 想测测自己的网站，复制上面那行命令；想让豆包、DeepSeek、ChatGPT 推荐你，[一句话装上 GEO 医生](#install)。

> 🚧 **[中文网站 AI 爬虫封锁榜](docs/ai-crawler-leaderboard.md)**：我们读取了 97 个知名中文网站的 robots.txt。**知乎、小红书、微博、贝壳、马蜂窝都把 ChatGPT 搜索、Perplexity、Claude 搜索挡在门外**，微博还点名屏蔽了 DeepSeek、Kimi、豆包。[看完整榜单和方法 →](docs/ai-crawler-leaderboard.md)

<a id="handbook"></a>

## 📚 GEO 实战手册

GEO 医生背后的方法都写成了公开手册，每条结论附官方原文或研究出处，不装 skill 也能照着做：[打开手册 →](docs/handbook.md)

按项目选路线：[网站](docs/playbooks/website.md) · [小程序](docs/playbooks/mini-program.md) · [SaaS / App](docs/playbooks/product.md) · [本地商家](docs/playbooks/local-business.md) · [电商](docs/playbooks/ecommerce.md) · [B2B 服务](docs/playbooks/b2b.md) · [创作者](docs/playbooks/creator.md) · [出海多语言](docs/playbooks/multilingual.md)

先读这两篇：[GEO 5 分钟入门](docs/basics.md) · [12 个流行的 GEO 误区](docs/myths.md)

## 🤝 参与贡献

欢迎补充：**能公开分母和页面改动的中文平台案例**、新的官方文档、验证过的提示词、失败实验（没效果的实验同样有价值）。规则见 [CONTRIBUTING.md](CONTRIBUTING.md)，不熟悉 Git 可以直接 [提 Issue](https://github.com/Fangx-AI/geo-doctor/issues/new/choose)。

**如果 GEO 医生或这份手册帮到了你，点个 ⭐ Star 是对我们最大的支持，也能让更多人看到它。**

[![Star History Chart](https://api.star-history.com/svg?repos=Fangx-AI/geo-doctor&type=Date)](https://star-history.com/#Fangx-AI/geo-doctor&Date)

---

<sub>geo-doctor（GEO 医生，原 GEO-Playbook）· GEO 实战手册 · AI 搜索优化 / GEO 优化中文指南。结构参考 [Maxime Labonne 的 LLM Course](https://github.com/mlabonne/llm-course)。代码和 skill 采用 [MIT](LICENSE)；原创文字、模板与图解采用 [CC BY 4.0](LICENSE-docs.md)。外部文章、论文、代码、商标和图片保留各自权利。图片说明见 [assets/README.md](assets/README.md)。给 AI 读的项目简介：[llms.txt](llms.txt)。</sub>
