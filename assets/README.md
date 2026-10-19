# 图片与来源

以下是本项目的教学图，不是平台后台截图，也不代表本项目已有客户增长结果。

| 文件 | 用途 | 依据 |
| --- | --- | --- |
| `hero-banner.jpg` | 中文首页顶部横幅 | 2026-10-15 由项目方用 AI 图像工具生成的宣传图，画面是示意，不是真实软件界面；"AI 视角"一侧对应体检能查出的 JS 空壳页问题 |
| `geo-audit-terminal.png` / `-en.png`（及 `.html`） | 首页配图：体检脚本的真实输出（中文 / 英文） | 2026-10-15 用 `cli/geo-audit.mjs` 对本地测试页运行的原样输出，未删改（含末尾的徽章提示）；测试页首页只有空的 `<div id="root">`，标题、描述、canonical、robots、sitemap 齐全；HTML 只是把输出排成终端样式，再用浏览器截图生成 PNG |
| `geo-doctor-demo.gif` / `-en.gif`（及 `.html`） | 首页"30 秒看它怎么工作"演示动图（中文 / 英文） | 2026-10-16 制作。**对话是示意**：小鹿记账（Fawn Budget）是虚构产品，竞品甲乙丙、采样题、推荐次数、引用来源和处方都是示例数据，图上和首页图注均已标明；其中体检那一段是 `cli/geo-audit.mjs` 对本地 JS 空壳测试页的真实输出（节选第 ⑥ 类和总分）。HTML 为源文件，每一帧用浏览器截图后合成 GIF |
| `geo-badge-demo.png` / `.html` | [徽章说明](../docs/badge.md)：修好后 100 分拿到徽章 | 2026-10-16 对同一本地测试页修复后的版本（正文写进 HTML、加 H1 和 JSON-LD）运行的输出，只省略了中间 7 类检查，已在图中注明；下方徽章是脚本 `--badge` 生成的 SVG 原样渲染 |
| `geo-cheatsheet.png` / `.html` | 首页速查卡：6 关、技术坑、内容原则、测量五层 | 本项目各章要点；HTML 为源文件，用浏览器截图生成 PNG |
| `learning-map.png` / `.svg` | 三阶段学习路线 | 本项目课程结构 |
| `public-evidence.png` / `.svg` | 不同项目可维护的公开资料与三项检查 | README 基础课与四类项目实践章节 |
| `mini-program-path.png` / `.svg` | 公开资料与小程序转化的两条链 | 本项目流程设计；每条发现路径仍需现场验证 |
| `content-before-after.png` / `.svg` | 事实约束下的文案改造 | README 中虚构的拾页知识库资料卡 |
| `measurement.png` / `.svg` | 分母、引用与准确支持 | `examples/observation-demo.csv` 的合成教学数据 |
| `webflow-results.png` / `.svg` | 原始变化与对照校正的区别 | [Graphite 案例](https://graphite.io/five-percent/case-studies/webflow-llm-signups)；原文数值重绘，不是其历史截图 |

以上静态图均直接绘制，提供 PNG 及 SVG / HTML 源文件；使用白底、深色文字和少量强调色。关键内容也写在 README 正文，不依赖读图才能完成课程。

## 配图标准

- 一张图回答一个具体问题：先做什么、资料放哪里、怎样改、数字怎样算。
- 用箭头时说明关系。操作顺序、用户可能经过的路径和已验证的因果关系必须区分。
- 数据图注明来源、样本、分母与图例；模拟数据和作者自报结果明确标注。
- 真实截图保留必要上下文、来源和日期；示意图不能冒充实际界面或客户结果。
- 不添加与理解无关的山水、机器人、光效或装饰图标。缩到 README 正文宽度后仍须可读。

此前的 AI 生成概念插画已退出当前版本，可在 Git 历史中追溯。除首页横幅 `hero-banner.jpg` 是标明来源的 AI 生成宣传图外，其余各图均为图形与文字直接排版。

项目自制教学图按 [LICENSE-docs.md](../LICENSE-docs.md) 的 CC BY 4.0 声明提供。第三方案例链接中的原图及商标不属于本项目资产，也未被重新许可。
