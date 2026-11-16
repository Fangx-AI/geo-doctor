# 让站点对 AI 可读：llms.txt、facts.json 与事实站

## 先说清楚可信度

- **`llms.txt` 不是官方标准**，是一份公开提案（2024 年 9 月提出）：站点根目录放一个 Markdown 文件，用标题、摘要和链接清单告诉模型"这里有哪些内容值得读"。它成本极低、人也能读，但**没有公开证据表明主流 AI 抓取器已经普遍读取它**。所以：该写，但不要把它当成"写了就会被引用"的开关。
- **`facts.json` 是本项目自己的约定**，不是行业标准。它的作用是给自家页面、事实站和脚本一个统一的机器可读事实源，方便交叉核对。
- 真正决定 AI 能不能读懂的是三件更基础的事：**页面正文在原始 HTML 里**（不靠 JS 渲染）、**robots 不挡爬虫**、**结构化、带出处、可摘录**。这三件在 `ai-crawler-audit` 里查。

## 站点根目录该有哪些文件

| 文件 | 作用 | 注意 |
| --- | --- | --- |
| `llms.txt` | 给模型的入口：站点是什么、有哪些页面值得读 | 纯 Markdown；别塞营销话术；链接要是绝对或根相对路径 |
| `facts.json` | 机器可读的事实清单（价格、规格、能力、边界） | 只放**已确认**事实；带来源与日期 |
| `robots.txt` | 放行 AI 爬虫，声明 sitemap | 放行不等于被收录；挡了要在报告里说清 |
| `sitemap.xml` | 让爬虫发现页面 | 需要真实域名才能生成绝对 URL |
| `index.html` / `faq.html` | 给人看、也给机器摘的事实页 | 正文必须在 HTML 里，不要只在 JS 里 |
| `articles/` | 从草稿生成的文章页 | 每篇对应一个问题 |

## 用 `geo-site` 从事实卡生成

`scripts/geo-site.mjs` 是零依赖脚本，**只用事实卡里"已确认"的条目**建站。

```bash
# 先看会生成什么
node scripts/geo-site.mjs build --facts geo/fact-card.yaml --out dist --dry-run

# 生成事实站（有真实域名时加 --base-url，才会写 sitemap.xml 和 canonical）
node scripts/geo-site.mjs build --facts geo/fact-card.yaml --out dist --base-url https://you.github.io/brand/

# 生成一个 GitHub Actions 工作流：geo/ 变化就重建、部署 Pages、顺手体检
node scripts/geo-site.mjs action
```

- 事实卡里有未确认条目时，`build` **会拒绝生成并列出是哪几条**。这不是 bug，是设计：宁可建不出来，也不要把待确认的东西发布成事实。
- 不加 `--base-url` 时不会写 `sitemap.xml`，页面也没有 canonical。本地预览可以这样，正式部署必须加。
- `--drafts <目录>` 把文章一起生成，只有**状态为 confirmed、绑定到站点且无错误**的草稿会被收进去。
- `--lang zh|en` 决定页面语言，默认从事实卡猜。

## 部署之后

1. 用 `ai-crawler-audit` 体检生成出来的站点，确认正文在 HTML 里、robots 放行、`llms.txt` 能取到。
2. 把站点 URL 填进事实卡的"地址"字段，作为对外唯一事实入口。
3. 首页要给**人**也能看懂：一句话说清这是什么、给谁用、能解决什么问题、明确不支持什么。只写给机器看的事实页，人进来会立刻离开。

## 常见错误

- `llms.txt` 里堆关键词或复制整篇官网——它是目录，不是内容仓库。
- `facts.json` 塞待确认数据，或没有来源和日期。
- 事实站写"业内领先""备受好评"这类没有出处的形容词：AI 引用时最容易被判为营销话术而跳过。
- 只生成站点、不体检、不提交 sitemap，然后假设"已经对 AI 友好了"。
- 把 `llms.txt` 当成排名手段对外承诺效果——没有证据支持这个说法。
