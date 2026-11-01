# 🚧 中文网站 AI 爬虫封锁榜

> [GEO 实战手册](../README.md) › AI 爬虫封锁榜 · 扫描日期 2026-11-01 · 可复现：`node scripts/ai-crawler-scan.mjs`

**我们读取了 97 个知名中文网站公开的 robots.txt，看它们的首页允许哪些 AI 和搜索爬虫抓取。成功读取 93 个。**

| 发现 | 网站数 | 占比 |
| --- | ---: | ---: |
| 🚫 ChatGPT 搜索（OAI-SearchBot）抓不了首页 | 9 | 10% |
| 🚫 4 个 AI 搜索爬虫（ChatGPT 搜索、ChatGPT 用户访问、Perplexity、Claude 搜索）全部挡住 | 8 | 9% |
| 🎯 百度能抓，但 4 个 AI 搜索爬虫全部挡住 | 7 | 8% |
| 🚫 屏蔽 GPTBot（OpenAI 训练） | 17 | 18% |
| 🚫 屏蔽 Bytespider（字节跳动） | 9 | 10% |
| ✅ 对表中所有爬虫都不设限 | 76 | 82% |

### 重点发现

- **4 个 AI 搜索爬虫全部挡住的网站**：百度、知乎、小红书、微博、马蜂窝、贝壳找房、作业帮、中国知网。
- **其中百度仍能抓取的**：百度、知乎、小红书、微博、马蜂窝、贝壳找房、作业帮。
- 这些大多是内容平台。**如果你的 GEO 策略是"在知乎、小红书、微博上铺内容"，按 robots.txt 规则，ChatGPT 搜索、Perplexity、Claude 搜索都不应抓取这些页面**，它们更可能引用你自己官网或其他开放平台上的内容。国内 AI 产品各自怎么获取这些平台的内容，robots.txt 看不出来。

**怎么读这张表**：很多中文网站的 robots.txt 是"白名单"写法，只列出百度、谷歌等老牌爬虫，最后一句 `User-agent: *` + `Disallow: /` 把其他所有爬虫挡在门外。这样写的时候，AI 搜索爬虫往往不是被"故意屏蔽"，而是**根本没被想到**。结果是：用户在 ChatGPT、Perplexity、Claude 里问到相关问题时，这些网站的页面很难被抓取和引用。

屏蔽训练爬虫（GPTBot、ClaudeBot、Google-Extended、CCBot）是网站的正当选择，不影响搜索可见度；表里单独列出，只作参考。

> 想查自己的网站？一行命令：`npx github:Fangx-AI/geo-doctor https://你的网址`

## 搜索与门户

| 网站 | 百度 | Google | Bing / Copilot | ChatGPT 搜索 | ChatGPT 用户访问 | Perplexity | Claude 搜索 | GPTBot（训练） | ClaudeBot（训练） | Google-Extended（训练） | Bytespider（字节） | CCBot（训练） |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [百度](https://www.baidu.com/robots.txt) | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| [搜狐](https://www.sohu.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [网易](https://www.163.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [新浪](https://www.sina.com.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [腾讯网](https://www.qq.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [凤凰网](https://www.ifeng.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 资讯媒体

| 网站 | 百度 | Google | Bing / Copilot | ChatGPT 搜索 | ChatGPT 用户访问 | Perplexity | Claude 搜索 | GPTBot（训练） | ClaudeBot（训练） | Google-Extended（训练） | Bytespider（字节） | CCBot（训练） |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [今日头条](https://www.toutiao.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [澎湃新闻](https://www.thepaper.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [人民网](https://www.people.com.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [新华网](https://www.xinhuanet.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [财新](https://www.caixin.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 | ✅ | ✅ | ✅ | 🚫 |
| [36氪](https://www.36kr.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [虎嗅](https://www.huxiu.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [IT之家](https://www.ithome.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [界面新闻](https://www.jiemian.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [第一财经](https://www.yicai.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [观察者网](https://www.guancha.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 社区内容

| 网站 | 百度 | Google | Bing / Copilot | ChatGPT 搜索 | ChatGPT 用户访问 | Perplexity | Claude 搜索 | GPTBot（训练） | ClaudeBot（训练） | Google-Extended（训练） | Bytespider（字节） | CCBot（训练） |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [知乎](https://www.zhihu.com/robots.txt) | ✅ | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| [豆瓣](https://www.douban.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [小红书](https://www.xiaohongshu.com/robots.txt) | ✅ | 🚫 | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| [哔哩哔哩](https://www.bilibili.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [微博](https://weibo.com/robots.txt) | ✅ | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| [百度贴吧](https://tieba.baidu.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [简书](https://www.jianshu.com/robots.txt) ¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [少数派](https://sspai.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [抖音](https://www.douyin.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [快手](https://www.kuaishou.com/robots.txt) | — | — | — | — | — | — | — | — | — | — | — | — |

## 开发者

| 网站 | 百度 | Google | Bing / Copilot | ChatGPT 搜索 | ChatGPT 用户访问 | Perplexity | Claude 搜索 | GPTBot（训练） | ClaudeBot（训练） | Google-Extended（训练） | Bytespider（字节） | CCBot（训练） |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [CSDN](https://www.csdn.net/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [稀土掘金](https://juejin.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [博客园](https://www.cnblogs.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [思否](https://segmentfault.com/robots.txt) ¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [开源中国](https://www.oschina.net/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [Gitee](https://gitee.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [V2EX](https://www.v2ex.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [InfoQ 中文](https://www.infoq.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [菜鸟教程](https://www.runoob.com/robots.txt) | 🚫 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |

## 电商

| 网站 | 百度 | Google | Bing / Copilot | ChatGPT 搜索 | ChatGPT 用户访问 | Perplexity | Claude 搜索 | GPTBot（训练） | ClaudeBot（训练） | Google-Extended（训练） | Bytespider（字节） | CCBot（训练） |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [淘宝](https://www.taobao.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [天猫](https://www.tmall.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [京东](https://www.jd.com/robots.txt) ¹ ² | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [拼多多](https://www.pinduoduo.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [唯品会](https://www.vip.com/robots.txt) | ✅ | ✅ | ✅ | 🚫 | 🚫 | 🚫 | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| [苏宁易购](https://www.suning.com/robots.txt) | — | — | — | — | — | — | — | — | — | — | — | — |
| [什么值得买](https://www.smzdm.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [当当](https://www.dangdang.com/robots.txt) ¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 本地生活

| 网站 | 百度 | Google | Bing / Copilot | ChatGPT 搜索 | ChatGPT 用户访问 | Perplexity | Claude 搜索 | GPTBot（训练） | ClaudeBot（训练） | Google-Extended（训练） | Bytespider（字节） | CCBot（训练） |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [美团](https://www.meituan.com/robots.txt) ¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [大众点评](https://www.dianping.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 | ✅ | ✅ | 🚫 | ✅ |
| [饿了么](https://www.ele.me/robots.txt) | — | — | — | — | — | — | — | — | — | — | — | — |
| [携程](https://www.ctrip.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [去哪儿](https://www.qunar.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [马蜂窝](https://www.mafengwo.cn/robots.txt) | ✅ | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | ✅ | 🚫 |
| [同程旅行](https://www.ly.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 | 🚫 | ✅ | ✅ | 🚫 |
| [58同城](https://www.58.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [贝壳找房](https://www.ke.com/robots.txt) | ✅ | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |

## 垂直内容

| 网站 | 百度 | Google | Bing / Copilot | ChatGPT 搜索 | ChatGPT 用户访问 | Perplexity | Claude 搜索 | GPTBot（训练） | ClaudeBot（训练） | Google-Extended（训练） | Bytespider（字节） | CCBot（训练） |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [汽车之家](https://www.autohome.com.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [懂车帝](https://www.dongchedi.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [中关村在线](https://www.zol.com.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [丁香园](https://www.dxy.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [好大夫在线](https://www.haodf.com/robots.txt) ¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [下厨房](https://www.xiachufang.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 财经

| 网站 | 百度 | Google | Bing / Copilot | ChatGPT 搜索 | ChatGPT 用户访问 | Perplexity | Claude 搜索 | GPTBot（训练） | ClaudeBot（训练） | Google-Extended（训练） | Bytespider（字节） | CCBot（训练） |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [东方财富](https://www.eastmoney.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [雪球](https://xueqiu.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | 🚫 | 🚫 | ✅ | 🚫 | 🚫 | 🚫 | ✅ | 🚫 |
| [和讯](https://www.hexun.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [同花顺](https://www.10jqka.com.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 招聘

| 网站 | 百度 | Google | Bing / Copilot | ChatGPT 搜索 | ChatGPT 用户访问 | Perplexity | Claude 搜索 | GPTBot（训练） | ClaudeBot（训练） | Google-Extended（训练） | Bytespider（字节） | CCBot（训练） |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [BOSS直聘](https://www.zhipin.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [智联招聘](https://www.zhaopin.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [猎聘](https://www.liepin.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 品牌官网

| 网站 | 百度 | Google | Bing / Copilot | ChatGPT 搜索 | ChatGPT 用户访问 | Perplexity | Claude 搜索 | GPTBot（训练） | ClaudeBot（训练） | Google-Extended（训练） | Bytespider（字节） | CCBot（训练） |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [小米](https://www.mi.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [华为](https://www.huawei.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [联想](https://www.lenovo.com.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [比亚迪](https://www.byd.com/robots.txt) ¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [蔚来](https://www.nio.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [理想汽车](https://www.lixiang.com/robots.txt) ¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [小鹏汽车](https://www.xiaopeng.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [OPPO](https://www.oppo.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [vivo](https://www.vivo.com.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [大疆](https://www.dji.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [海尔](https://www.haier.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 云与 SaaS

| 网站 | 百度 | Google | Bing / Copilot | ChatGPT 搜索 | ChatGPT 用户访问 | Perplexity | Claude 搜索 | GPTBot（训练） | ClaudeBot（训练） | Google-Extended（训练） | Bytespider（字节） | CCBot（训练） |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [阿里云](https://www.aliyun.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [腾讯云](https://cloud.tencent.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [华为云](https://www.huaweicloud.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [火山引擎](https://www.volcengine.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [飞书](https://www.feishu.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [钉钉](https://www.dingtalk.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [金山文档](https://www.kdocs.cn/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [语雀](https://www.yuque.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [有赞](https://www.youzan.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [明道云](https://www.mingdao.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 视频音乐

| 网站 | 百度 | Google | Bing / Copilot | ChatGPT 搜索 | ChatGPT 用户访问 | Perplexity | Claude 搜索 | GPTBot（训练） | ClaudeBot（训练） | Google-Extended（训练） | Bytespider（字节） | CCBot（训练） |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [爱奇艺](https://www.iqiyi.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | 🚫 | 🚫 | ✅ | 🚫 | 🚫 | ✅ | ✅ | ✅ |
| [腾讯视频](https://v.qq.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | 🚫 | 🚫 | ✅ | 🚫 | 🚫 | ✅ | ✅ | ✅ |
| [优酷](https://www.youku.com/robots.txt) ¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [网易云音乐](https://music.163.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 | 🚫 | 🚫 | ✅ | 🚫 |
| [喜马拉雅](https://www.ximalaya.com/robots.txt) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 教育

| 网站 | 百度 | Google | Bing / Copilot | ChatGPT 搜索 | ChatGPT 用户访问 | Perplexity | Claude 搜索 | GPTBot（训练） | ClaudeBot（训练） | Google-Extended（训练） | Bytespider（字节） | CCBot（训练） |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [学堂在线](https://www.xuetangx.com/robots.txt) ¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [中国大学MOOC](https://www.icourse163.org/robots.txt) ¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [作业帮](https://www.zuoyebang.com/robots.txt) | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | ✅ | 🚫 |
| [网易有道](https://www.youdao.com/robots.txt) | — | — | — | — | — | — | — | — | — | — | — | — |
| [中国知网](https://www.cnki.net/robots.txt) ² | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |

## 方法与局限

- **扫描什么**：每个网站请求 1 次 `https://域名/robots.txt`（跟随最多 5 次跳转），按 [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309) 的最长匹配规则判断各爬虫能否抓取首页 `/`。判断逻辑与 [geo-audit](../cli/geo-audit.mjs) 相同，有单元测试。
- **扫描地点**：GitHub Actions（美国机房）。部分网站对境外请求有不同响应，结果以网站当时返回的内容为准。
- **只看 robots.txt**：防火墙 / CDN 按 UA 或 IP 拦截、页面 `noindex`、正文靠 JavaScript 渲染等问题不在这张表里，这些要用 geo-audit 逐页检查。真实爬虫是否来访，要以网站日志为准。
- **只看首页**：有的网站首页放行、内页屏蔽，或反过来。
- ¹ 没有 robots.txt（返回 4xx 或 HTML 页面），按规范视为不限制。
- ² robots.txt 跳转到了别的域名（例如境外请求被导向海外站），表中是跳转后那份规则。
- **用户触发的访问**：ChatGPT-User、Perplexity-User 这类"用户让 AI 打开某个网页"的请求，平台文档说明不一定遵守 robots.txt；表里按规则字面判断。
- — 扫描时读取失败（超时、5xx 或连接被拒，共 4 个），不计入占比的分母。
- **名单**：[data/sites-cn.txt](../data/sites-cn.txt)，原始数据：[data/ai-crawler-scan.json](../data/ai-crawler-scan.json)。漏了谁、判断错了，欢迎提 [issue](https://github.com/Fangx-AI/geo-doctor/issues/new/choose) 或 PR。
- robots.txt 随时会改，本表只代表扫描当天的状态。
