# 🧭 国内 AI 信源地图：每个 AI 从哪里拿信息

> 核验日期 2026-10-14。第 2 步（事实卡要同步到哪些平台）和第 7 步（分发）必读。

**做 GEO 的第一步，是知道你的目标 AI 读哪些平台。** 各家 AI 主要引用自家生态的内容，本地门店数据则来自地图和本地生活平台，而不是网页。这张表是所有执行卡的地基，只写查得到出处的结论。

标签：🟢 官方口径 · 📊 第三方研究（注明样本） · 🟡 媒体报道或服务商自述 · ❓ 常见说法，但未找到可靠出处

## 一张表看懂

| AI | 内容主要来自 | 门店 / 地图数据 | 证据 |
| --- | --- | --- | --- |
| **豆包** | 今日头条图文、抖音（含抖音百科）、公开网页 | 导航用百度地图数据；团购、门店、订单走**抖音生活服务** | 🟢 [火山方舟联网插件文档](https://docs.volcengine.com/docs/ark/online-content-plugin-guide?lang=zh) · 📊 [新榜](https://geo.newrank.cn/news/8386) · 🟡 [虎嗅](https://www.huxiu.com/article/4894374.html)、[虎嗅](https://www.huxiu.com/article/4873332.html) |
| **腾讯元宝** | 微信搜一搜、搜狗；**公众号、视频号**等腾讯生态 | 与美团 AI 助手「小美」灰度对接；地图来源 ❓ | 🟢 [新京报](https://m.bjnews.com.cn/detail/1717043325129809.html)、[腾讯新闻](https://news.qq.com/rain/a/20250704A05NAB00) · 📊 [新榜](https://geo.newrank.cn/news/8386)：公众号约占 10% · 🟡 [华尔街见闻](https://wallstreetcn.com/articles/3776996) |
| **千问 / 夸克** | 全网；阿里生态（淘宝、闪购、飞猪、支付宝） | **高德**：2 亿+ POI，生成餐厅、酒店、景点推荐卡片 | 🟢 [扬子晚报](https://www.yzwb.net/news/ch/202512/t20251218_301603.html)、[科技日报](https://www.stdaily.com/web/gdxw/2026-01/15/content_461939.html) · 📊 QuestMobile：旅游目的地类引用**大众点评 35.8%** [36氪](https://www.36kr.com/p/3825497154196353) |
| **百度 / 文心** | 百度系（百家号、百科、知道、文库） | 百度地图；「榜中榜」展示点评评分、携程口碑，团购跳美团 | 🟢 [科技日报](https://www.stdaily.com/web/gdxw/2025-07/02/content_364278.html) · 📊 QuestMobile：面霜类引用百度系 81.7% [36氪](https://www.36kr.com/p/3855204672574728) · 🟡 [北京商报](https://www.bbtnews.com.cn/2025/1010/571892.shtml) |
| **DeepSeek** | 官方未公开搜索供应商；研究显示偏好搜狐、百度百科、网易 | 未见地图卡片 | ❓ · 📊 [新榜](https://geo.newrank.cn/news/8386) |
| **Kimi** | 官方称优先政府、权威媒体、学术、财报等「100+ 可信来源」 | 未见 | 🟢 [Kimi 帮助页](https://www.kimi.com/zh-cn/help/features/search) |
| ChatGPT | 与微软等搜索提供商合作；须允许 OAI-SearchBot 抓取 | 第三方提供商；本地查询中 **Yelp** 出现在 80% 的回答里 | 🟢 [OpenAI](https://help.openai.com/en/articles/9237897-chatgpt-search) · 📊 [BrightLocal，约 197 万条引用](https://www.brightlocal.com/resources/ai-directory-sources/) |
| Google AI 概览 | Google 索引 | **Google Business Profile** 是本地查询第一信源（约 28.5%） | 🟢 [Google](https://support.google.com/local-listings/answer/9851099?hl=en) · 📊 BrightLocal（同上） |

**三条结论**

1. **你的目标 AI 决定你上哪个平台。** 想被豆包推荐，抖音和头条是主场；想被元宝推荐，公众号和视频号是主场；想被千问推荐，高德是主场；想被文心推荐，百度地图和百家号是主场。
2. **门店类问题，结构化的门店数据比文章重要。** 能出卡片的 AI（千问、豆包、百度）调的是地图和本地生活平台的门店数据。
3. **信源会变。** BrightLocal 2024 年的研究里 ChatGPT 还几乎不引用 Yelp，2026 年 Yelp 已出现在 80% 的本地回答里。所以每张执行卡都要求定期复测，而不是做一次就结束。

## 官方商家入口

| 平台 | 对应 AI | 入口 |
| --- | --- | --- |
| 高德地图标注中心（免费标注） | 千问 | https://g.amap.com/ |
| 百度地图商户标注 | 文心、豆包导航 | 百度地图 App 搜索「商户中心」或「认领我的店铺」；[帮助页](https://help.baidu.com/question?class=0&id=1885&prod_id=4) |
| 腾讯地图商户标注（免费，48 小时审核） | 微信、元宝 | [说明](https://lbs.qq.com/FAQ/merchant_label_faq.html)，或公众号「腾讯位置服务」→ 我是地主 |
| 抖音来客 | 豆包 | https://life.douyin.com/ |
| 抖音创作者中心 | 豆包 | https://creator.douyin.com/ |
| 头条号 | 豆包 | https://mp.toutiao.com |
| 微信公众平台 / 视频号助手 | 元宝 | https://mp.weixin.qq.com · https://channels.weixin.qq.com |
| 微信搜一搜品牌官方区 | 元宝、微信搜索 | [说明](https://kf.qq.com/faq/1803217VzIRr180321YzeQJV.html) |
| 美团开店宝 / 商家入驻 | 元宝（小美）、百度榜中榜 | https://ecom.meituan.com/meishi · https://kd.meituan.com/home |
| 大众点评商户认证 | 千问、百度榜中榜 | https://www.dianping.com/business/vshop/ |
| 百家号 | 文心 | https://baijiahao.baidu.com/builder/author/info/manual |
| 小红书专业号 / 千帆 | 研究显示 AI 引用很少（见下） | https://pro.xiaohongshu.com/qualification · https://ark.xiaohongshu.com/ |

> 小红书提醒：QuestMobile 发现小红书在旅游目的地类问题中**不在任何 AI 的引用 TOP10** [36氪](https://eu.36kr.com/zh/p/3826839508210560)；而我们的 [AI 爬虫封锁榜](https://github.com/Fangx-AI/geo-doctor/blob/master/docs/ai-crawler-leaderboard.md) 显示，小红书的 robots.txt 挡住了 ChatGPT、Perplexity、Claude 的搜索爬虫。小红书对种草和成交有用，但不要把它当成 GEO 的主阵地。

## 常见但没有证据的说法

| 说法 | 实际情况 |
| --- | --- |
| 「元宝的门店推荐用腾讯地图」 | ❓ 没找到证据 |
| 「豆包门店推荐用高德」 | 不准确：媒体报道称导航数据由百度提供，驾车才跳转高德 🟡 |
| 「DeepSeek 用百度搜索」 | ❓ 官方未公开 |
| 「豆包六成以上引用来自字节系」等百分比 | 🟡 来自服务商软文，方法未公开，只能当方向参考 |

## 还没人回答的问题

公开的大样本研究（新榜、QuestMobile）测的都是通用话题、汽车、旅游、美妆，**没有覆盖餐厅、洗车、宠物店这类门店查询**。我们会用固定问题集自测，结果会公开在这个仓库里。
