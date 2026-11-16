# 第 7 步 · 开方·发布指导：发到哪、怎么发、多久发

**目的：** 把内容发到**目标 AI 实际会读的平台**上，并且按平台规则发对。

**第 5 步的目标来源清单优先。** AI 推荐你的竞品时读的是哪些网站，你就先去那里：能自己发的（知乎问题下回答、自己的专栏），直接按第二步的写法发；不能自己发的（第三方测评、媒体、榜单），按本页“第三方内容”一节真实地争取。清单为空或样本太少时，再按下面的信源地图选。

先读信源地图：国内 AI 看 [ai-sources-cn.md](ai-sources-cn.md)，海外 AI 看 [ai-sources-global.md](ai-sources-global.md)。它们说明了每个 AI 从哪里取信息、证据有多强。再结合第 5 步采样里**你的目标 AI 实际引用了哪些平台**。两者冲突时，以用户自己的采样结果为准。

## 第一步：按目标 AI 选 2 到 3 个平台

不要一上来铺满所有平台。先选 2 到 3 个，做出效果再加。

| 目标 AI | 优先平台 | 依据 |
| --- | --- | --- |
| 豆包 | 头条号、抖音、官网 | 🟢 火山方舟联网插件列出头条图文、抖音百科；📊 新榜：豆包 TOP5 信源有 3 个字节系 |
| 元宝 | 公众号、视频号、官网 | 🟢 官方口径：联网搜索公众号、视频号等腾讯生态信源 |
| 文心 / 百度 | 百家号、官网（提交百度搜索资源平台）、百度百科 | 📊 QuestMobile：部分品类百度系来源超过八成 |
| 千问 | 官网、头条号、B 站；实物产品加淘宝/天猫详情页 | 📊 QuestMobile：不同品类分别以头条、B 站等为主；🟢 千问接入淘宝 |
| DeepSeek | 官网、搜狐号、知乎；争取进入百度百科 | 📊 新榜：偏好搜狐、百度百科、网易 |
| Kimi | 官网、公众号、权威媒体报道 | 🟢 Kimi 称优先政府、权威媒体、学术、财报类来源 |
| ChatGPT、Claude、Perplexity | 官网（放行各家搜索爬虫）、Google 和必应收录；其余平台按采样里实际引用的站点选 | 🟢 各家爬虫说明，见 [ai-sources-global.md](ai-sources-global.md) |
| Google AI 概览、Gemini | 官网（提交 Google Search Console）；门店加 Google 商家资料 | 🟢 Google 生成式搜索指南；📊 BrightLocal：本地查询第一信源是 Google 商家资料 |
| Copilot | 官网（提交 Bing Webmaster Tools，用 IndexNow 通知更新）；门店加 Bing Places | 🟢 必应 AI Performance 公告 |

**所有 AI 都适用：官网是根。** 先把官网和帮助中心的内容改好、统一，再去别的平台发。

## 第二步：按平台的规则发

入口地址和认证要求以平台当前页面为准，平台会改版。

| 平台 | 入口 | 发之前准备 | 怎么发 |
| --- | --- | --- | --- |
| 官网 / 帮助中心 | 自己的网站 | 体检通过 | 每个问题一个页面或一个小节，标题用用户原话；写更新日期；更新后提交百度搜索资源平台、Bing Webmaster 和 Google Search Console |
| 公众号 | mp.weixin.qq.com | 完成企业认证，名称和事实卡一致 | 标题直接写问题或结论；正文按第 6 步写法；文末放官网链接；开通"微信搜一搜品牌官方区"（[说明](https://kf.qq.com/faq/1803217VzIRr180321YzeQJV.html)） |
| 视频号 | channels.weixin.qq.com | 和公众号绑定同一主体 | 口播第一句说出产品名和解决什么问题；简介写关键事实 |
| 头条号 | mp.toutiao.com | 企业认证 | 问答型文章，一篇只回答一个问题 |
| 抖音 | creator.douyin.com | 企业号认证 | 演示视频，口播和标题说出产品名、价格、适合谁 |
| 百家号 | baijiahao.baidu.com | 企业认证 | 同头条号写法 |
| 知乎 | zhihu.com | 实名或机构号，写明身份 | 回答已有的高关注问题，先给结论再说理由，主动写不适合的情况；**以品牌身份回答要表明身份** |
| 搜狐号 | mp.sohu.com | 企业认证 | 同头条号写法 |
| CSDN / 掘金 | csdn.net / juejin.cn | 个人或企业账号 | 只适合开发者工具：教程、对比、排错 |
| B 站 | bilibili.com | 企业号 | 教程和测评视频，简介写关键事实和官网 |
| 百度百科 | baike.baidu.com | 🟡 需要第三方权威来源（媒体报道等）作为参考资料 | 只写可核实的客观信息，不写宣传语；没有第三方报道就先别建 |
| 应用商店 | 各商店开发者后台 | — | 名称、价格、功能描述和事实卡统一 |

> 小红书：对用户种草和转化有帮助，但研究显示 AI 很少引用（📊 QuestMobile 旅游类：不在任何平台引用 TOP10），而且它的 robots.txt 挡住了多数海外 AI 爬虫。不要把它当成 GEO 主阵地。

## 第三步：批量发布（自己的官网自动发，第三方平台由人发）

第 6 步的草稿里，`status: confirmed` 的才会被处理。能运行命令时用 `scripts/geo-publish.mjs`（也可以 `npx -p github:Fangx-AI/geo-doctor geo-publish …`）；脚本会先跑一遍检查，有错误就不发。

**自己的官网：自动发布。** `platforms` 里有 `site` 的稿件，按用户网站的情况选一种：

| 网站类型 | 命令 | 说明 |
| --- | --- | --- |
| 静态网站、GitHub Pages、任何能放 HTML 的空间 | `geo-publish site geo/drafts --to static --out <网站目录>/geo --base-url https://网址/geo` | 每篇生成一个页面，加上 index.html 和 sitemap.xml。页面自带标题、描述、canonical、Article 结构化数据，正文写在 HTML 里，体检能过 |
| WordPress | `geo-publish site geo/drafts --to wordpress --site https://网址 --user 用户名` | 用 WordPress 的"应用密码"，请用户自己设置环境变量 `GEO_WP_APP_PASSWORD`，**不要让用户把密码发给你，也不要写进文件**。默认存为草稿，用户在后台看过再发布；用户明确要直接上线时加 `--status publish`。同一个 slug 再发会更新原文，不会重复 |
| 其他 CMS 或自建后台 | `geo-publish site geo/drafts --to http --endpoint https://接口地址 --token-env 变量名` | 向接口 POST 一份 JSON（标题、slug、描述、Markdown、HTML 等），令牌从环境变量读 |

先加 `--dry-run` 演练一遍，确认会发哪些再正式发。发完链接自动记到 `geo/published.csv`，然后照第二步提交收录（百度搜索资源平台、Google Search Console、Bing Webmaster）。

**没有官网，或官网是 JS 空壳、体检分数低：先建一个事实站。** 用 `scripts/geo-site.mjs`（或 `npx -p github:Fangx-AI/geo-doctor geo-site …`）把 `geo/fact-card.yaml` 里**已确认**的事实和已确认的文章生成一个静态站，AI 一读就懂：

```bash
geo-site build --facts geo/fact-card.yaml --drafts geo/drafts --out site --base-url https://网址/
```

它会生成事实页（index.html，带 SoftwareApplication 或 Product 结构化数据）、常见问题页（faq.html，带 FAQPage 结构化数据，问题按事实卡自动生成，例如"X 多少钱""X 和 Y 有什么区别"）、文章页、`llms.txt`、`facts.json`、`robots.txt` 和 `sitemap.xml`。只用状态为"已确认"的事实，未知和来源冲突的条目不会出现；名称（B01）和一句话说明（B03）没确认时拒绝生成。

放在哪：

- **GitHub Pages（免费，推荐给没有官网的用户）**：在用户的仓库里运行 `geo-site action`，它写一个工作流 `.github/workflows/geo-site.yml`；用户在 Settings → Pages 把 Source 设为 "GitHub Actions" 后，每次改动 `geo/` 都会自动重新生成、上线并体检一次。
- **已有官网**：把 `--out` 指向官网的一个子目录（例如 `/facts/`），`--base-url` 写这个子目录的真实地址，再从官网首页和页脚链接过去。
- 上线后用 `geo-audit` 体检事实页和常见问题页，目标是 100 分。

事实站不是站群：一个产品只建一个，内容只来自事实卡和人审过的文章，不要为了"多占位置"复制多个站。

**有官方发布接口的平台：用用户自己的 Key 自动发。** 目前支持 dev.to（海外开发者社区，ChatGPT、Perplexity 常引用）。草稿的 `platforms` 里写上 `devto`，Key 放在环境变量 `DEVTO_API_KEY`（在 https://dev.to/settings/extensions 生成）：

```bash
geo-publish post geo/drafts --to devto --dry-run        # 先演练
geo-publish post geo/drafts --to devto --status publish # 默认 draft，只存成 dev.to 草稿
```

只发已确认、写了 `devto` 的草稿；dev.to 上已有同标题文章就更新，不会重复发，已发布的不会被改回草稿。结尾的核对表不会发出去。放在 GitHub 上时可以写一个工作流：文章合并进默认分支后自动运行这条命令。

**没有官方接口的平台：打包好，由用户本人发。** 知乎、公众号、头条号、百家号、搜狐号、小红书、掘金、Medium、Reddit 都不自动发：这些平台没有给个人开放的发布接口，自动化只能模拟登录，违反平台规则，容易封号，也正是"GEO 投毒"的做法。

```bash
geo-publish pack geo/drafts --brand 品牌名
```

它会在 `geo/outbox/` 里按平台生成可以直接粘贴的稿件（知乎、掘金、Medium、Reddit 用 Markdown；公众号、头条号、百家号、搜狐号用带排版的 HTML；小红书用纯文本加话题），附一份 `geo/outbox/README.md` 发布清单：每篇发哪、编辑器链接、注意事项。官网已经发布的，稿件末尾会带上原文链接；Reddit 稿件开头带利益披露。

告诉用户按清单逐个打开编辑器、粘贴、通读、配图、点发布，并按平台要求标注 AI 辅助创作。每发一篇，把链接记下来（用户给你链接时由你来记）：

```bash
geo-publish log --slug offline-budget-app --platform zhihu --url https://zhuanlan.zhihu.com/p/…
```

**知乎、掘金：分发台 + 浏览器填稿助手，一个页面集中分发。** 用 `geo-site build --base-url …` 生成事实站时，草稿 `platforms` 里写了 `zhihu` 或 `juejin` 的，会多生成三个文件：`distribute.html`（分发台，不进搜索引擎）、`fill.json`（文章列表）和 `geo-fill.user.js`（油猴脚本）。用户只需装一次 [Tampermonkey](https://www.tampermonkey.net/) 或 Violentmonkey，再打开 `<事实站网址>/geo-fill.user.js` 点安装（Chrome 还要在扩展详情里打开「允许用户脚本」）。之后打开 `<事实站网址>/distribute.html`：每篇文章在官网、知乎、掘金的状态一目了然；点「分发」或「一键分发所有待发的知乎文章」，浏览器会打开编辑器并自动填好标题和正文，用户检查排版后自己点「发布」，发布后的文章链接自动记回分发台。正文填不进去时会自动复制到剪贴板，按 Ctrl+V 即可。它不登录、不读 Cookie、不点发布；「已发」记录存在用户自己的浏览器里，换电脑可以在分发台手动补链接。

**在工作台里一站式分发。** 本地工作台（`geo-studio`）的「分发中心」把上面这些放在一个页面：文章 × 渠道一张表，每格显示已发布、待发布或未选此渠道。官网点「生成」（事实站）或「发到 WordPress」；dev.to 设好 `DEVTO_API_KEY` 后点「发布」；知乎、掘金用同一个填稿助手，在工作台点「安装助手」装一次即可（这份助手从本机工作台读文章，不用先部署事实站），点「填好并打开」或「一键打开全部」，发布后链接自动写进 `geo/published.csv`；公众号、头条号、百家号等点「复制排版」，到后台粘贴发布，再点「记录链接」。WordPress 在 `geo/autopilot.json` 里写 `"wordpress": { "site": "https://…", "user": "…", "status": "draft" }`，应用密码只从环境变量 `GEO_WP_APP_PASSWORD` 读取。设了访问口令（`GEO_STUDIO_TOKEN`）时不提供填稿助手，用「复制排版」。

不能运行命令时，按同样的分工手动做：官网的页面内容给用户或网站管理员，第三方平台的稿件按平台整理好给用户复制。

## 第三方内容：真实地争取，不能自己编

AI 更信第三方的说法（📊 Muck Rack：AI 引用中 82% 到 89% 是媒体报道等"赢得的内容"，样本以海外模型为主）。可以做的：

- 给行业媒体、测评博主提供真实信息和试用账号，**由对方独立决定写什么**
- 邀请真实用户写使用体验，不提供写作模板、不给好评返现
- 参加行业评测、榜单，提交真实材料

不能做的：自己写好"测评"让别人署名、批量发同质化软文、编造用户体验。这些违反《网络反不正当竞争暂行规定》，也正是网信办在整治的"GEO 投毒"。

## 节奏建议

以下是经验建议，没有研究证明哪种节奏最好：

- 第 1 周：改官网、统一各渠道的旧说法
- 第 2 到 3 周：在选定的 2 到 3 个平台各发 1 到 2 篇，针对处方里的题目
- 之后：每两周按复查结果补 1 到 2 篇，不追求数量

## 完成标准

`geo/publish-plan.md` 是一张表：

| 处方 | 内容（草稿文件） | 平台 | 计划日期 | 状态 | 发布链接 |
| --- | --- | --- | --- | --- | --- |

用了脚本时，官网的发布链接和用户发完第三方平台后记下的链接都在 `geo/published.csv`，表里的"发布链接"照它填。再告诉用户：先发哪篇、发在哪、发完把链接告诉你，**两周后找我复查**。
