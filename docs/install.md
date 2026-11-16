# GEO 医生跨平台安装指南（草稿）

文档核对日期：2026-10-15。以下是官方文档支持的安装方式、待验证路径和记录模板。实测进度：WorkBuddy（Windows 桌面端）对话安装成功、同会话可用；豆包普通对话不能安装；其余平台待实测，详见文末实测记录。手机普通聊天、桌面工作模式和编程工具需分开记录，不能互相代替。

## 先拿到完整技能

需要整个 [`skills/geo-doctor`](../skills/geo-doctor) 文件夹，包括 `SKILL.md`、`LICENSE`、`references/`、`assets/`、`scripts/`。只复制 SKILL.md 会丢失各步骤的规则和模板。

- 优先在 [Releases](https://github.com/Fangx-AI/geo-doctor/releases) 的附件中找 `geo-doctor.zip`。核对版本；若没有这个附件，不能把 GitHub 自动生成的整个仓库源码包当成同一种安装包。
- 附件缺失时，可以下载仓库源码、解压后取出 `skills/geo-doctor/`。复制完整文件夹到支持的技能目录即可；支持 zip 导入的客户端可尝试压缩该文件夹，具体根目录要求仍需在该客户端验证。
- 维护者本地打包方式（在仓库根目录）：`mkdir -p dist && cd skills && zip -qr ../dist/geo-doctor.zip geo-doctor`。zip 内第一层为 `geo-doctor/`。
- 手动复制或导入不会自动保证更新。记录 tag 或 commit；更新前检查已有同名技能，保留用户自己的改动，不直接覆盖。

## 通过对话安装

支持安装技能的 Agent 可先发送以下内容；如果当前产品只能读取网页或附件，它可能只能在本次会话使用这些材料。

README 给用户的是最短的一句：

```text
帮我安装这个 skill：https://github.com/Fangx-AI/geo-doctor/tree/master/skills/geo-doctor
```

实测时用下面的完整版，方便记录安装结果：

```text
请安装 GEO 医生：
https://github.com/Fangx-AI/geo-doctor/tree/master/skills/geo-doctor

请使用完整技能目录，保留 references、assets 和 scripts。
完成后告诉我实际安装位置或技能列表中的名称，以及是否需要在新任务中重新启用。
如果当前环境只能读取内容、不能持久安装，请直接说明。
```

链接打不开时可提供完整文件夹或包，不必为读取这个公开仓库反复登录 GitHub。报错时保留原文，不将“已理解技能内容”记为“已安装”。

## 各平台步骤

### Claude Code

在 Claude Code 对话中依次输入：

```text
/plugin marketplace add Fangx-AI/geo-doctor
/plugin install geo-doctor@geo-doctor
```

检查插件已启用，再新开会话测试。仓库已有 marketplace 和 plugin 清单；命令形式符合[官方安装文档](https://code.claude.com/docs/en/plugins/install)，本项目实际加载仍待验证。若自动触发失败，记录插件/技能列表和报错，再通过列表显式选择 GEO 医生。

### Codex（CLI / IDE）

在对话中发送：

```text
$skill-installer 请从 Fangx-AI/geo-doctor 安装 skills/geo-doctor，保留完整目录。
```

也可手动把完整文件夹复制到 `~/.agents/skills/geo-doctor/`；仓库内使用可放在 `.agents/skills/geo-doctor/`。`~` 是运行 Codex 的环境的用户主目录，Windows 原生环境和 WSL 的目录分别记录。未识别时重启会话，在 `/skills` 中查看，显式触发可用 `$geo-doctor`。依据：[官方技能文档](https://learn.chatgpt.com/docs/build-skills)。这里的文件路径不代表手机 ChatGPT 的安装路径。

### Kimi Code

将完整文件夹复制到 `~/.kimi-code/skills/geo-doctor/`；配置过 `KIMI_CODE_HOME` 时使用该目录下的 `skills/geo-doctor/`。官方也支持共享目录 `~/.agents/skills/`，选择一种位置即可，避免同名副本混淆。新开会话后先测试自动触发，失败再尝试 `/skill:geo-doctor` 并记录两种结果。依据：[官方 Agent Skills 文档](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html)。

### WorkBuddy

先尝试上面的对话安装提示词，记录实际动作。桌面端也可用“技能 → 添加技能 → 上传技能”导入本地技能包并启用，依据：[官方技能说明](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market)。官方说明存在导入能力，但本项目 zip 的目录结构和脚本执行仍待实测。

**实测 2026-10-14～15（WorkBuddy Windows 桌面端）**：在对话里发送 README 的一句话安装提示后，WorkBuddy 自动把完整目录装到 `C:\Users\<用户名>\.workbuddy\skills\geo-doctor`（用户级），SKILL.md、LICENSE、references/、assets/、scripts/ 齐全；它还自行做了安全检查，并运行 `geo-audit.mjs --version` 冒烟通过。随后在同一会话发送"帮我做 GEO"，它加载 geo-doctor，按第 0 步问诊提问（第一问为诊断对象类型：软件/App、网站、小程序、实体产品、其他），没有编造产品资料。注意：刚装好时技能列表尚未刷新，它是直接读取磁盘上的 SKILL.md；新会话下的自动触发、references/assets 读取仍待补测。结论：对话安装成功，同会话可用。

手机/小程序单独记录：[官方移动端说明](https://www.codebuddy.cn/docs/workbuddymini/features/Attachments-and-Skills)介绍了将 SkillHub 安装指令粘贴到对话的方式；这不代表本项目已上架 SkillHub，也不能推断任意 GitHub 链接都能安装。

### 豆包

记录具体是手机 App、网页、桌面端还是“豆包工作”及当前模式。先尝试对话安装，保存回复和实际安装证据。官方[自动任务模式说明](https://www.doubao.com/work/docs/zh-cn/articles/340417925583-auto-tasks)介绍了技能选择和本地工作环境能力；本项目在手机普通对话中是否能安装、跨会话保留或执行脚本，仍待实测。

**实测 2026-10-14（豆包普通对话，具体客户端待补）**：发送 README 的一句话安装提示后，豆包回复"这个 skill 不是豆包平台的 skill，不能直接在豆包对话里安装运行"，并给出 Claude Code 的手动安装、`npx skills add` 和对话安装三种方式。回复里描述的功能（llms.txt 校验、E-E-A-T 诊断、P0/P1/P2 清单）本 skill 并没有，说明它很可能没有真正读取仓库内容。结论：豆包普通对话不能安装；"豆包工作"等模式仍待实测。

若只能读附件，将结果记为“会话内使用”；继续按运行能力测试资料读取和内容生成，不虚构技能菜单，也不直接判整个豆包产品不支持技能。

### 扣子

区分“扣子”和“扣子编程”。[官方使用技能文档](https://docs.coze.cn/guides_using_skill)说明：扣子可在对话中查找、安装和调用商店技能；扣子编程支持在项目对话框的“技能 → 创建技能 → 本地上传”导入，再添加到任务中，新任务需要重新添加。

本项目未确认已上架商店，也未确认现有 zip 符合扣子的技能包要求。记录是否接受包及完整报错；不要仅改扩展名就宣称兼容。先通过对话安装或实际提供的导入入口验证。

## 统一实测流程（待设备操作）

1. **记录环境**：日期、设备系统、客户端版本、入口/模式、技能 tag 或 commit、安装方式。保存实际安装路径、列表截图或日志。
2. **测试自动触发**：新开对话，只发送“帮我做 GEO”。符合流程的表现是询问产品名/网址、目标 AI、目标用户，最多 3 个问题，不编造产品资料。记录是否确实加载本技能；问了类似问题本身不是加载证据。
3. **测试显式触发**：自动触发失败时用该平台的技能选择方式或“使用 GEO 医生”。分别记录，不用显式成功替代自动触发结果。
4. **测试资源读取**：要求实际打开 `references/04-sampling.md` 和 `assets/runs.csv`，提供读取路径、前者小节标题和后者完整表头。将输出与本次安装版本的文件逐项对照，不仅看模型自报“能读取”。
5. **测试输出与能力限制**：不提供真实产品资料时，应等待补充。无写文件能力应提供带文件名的待保存内容；无命令执行能力不能伪造网站评分。脚本可用时可运行 `node <技能绝对路径>/scripts/geo-audit.mjs --help`，只验证可执行，不把它当网站体检结果。
6. **测试新会话可用性**：新开任务检查是否仍能选择技能。官方要求每任务重新添加的平台按要求添加，并记录其作用范围；这与一次上传附件只能在当前对话读取不同。

## 实测记录

所有“待实测”表示尚无真实设备执行结果，不是失败。一次安装在一个客户端成功，不外推到同名产品的其他客户端。

| 平台 | 安装步骤 | 安装结果 | “帮我做 GEO”触发 | references / assets | 卡点 |
| --- | --- | --- | --- | --- | --- |
| Claude Code | marketplace 添加 → plugin 安装 | 待实测 | 待实测 | 待实测 / 待实测 | 未操作 |
| Codex | 对话安装或复制完整目录 | 待实测 | 待实测 | 待实测 / 待实测 | 未操作 |
| Kimi Code | 复制目录 → 新会话 | 待实测 | 待实测 | 待实测 / 待实测 | 未操作 |
| Cursor | 待确认（技能目录位置待实测） | 待实测 | 待实测 | 待实测 / 待实测 | 未操作 |
| TRAE | 待确认（技能目录位置待实测） | 待实测 | 待实测 | 待实测 / 待实测 | 未操作 |
| 豆包 | 先确认客户端/模式 → 对话安装 | 待实测 | 待实测 | 待实测 / 待实测 | 手机安装能力和资源访问待验证 |
| WorkBuddy（Windows 桌面端） | 对话发送一句话安装提示 | 成功（2026-10-14） | 同会话触发，进入问诊；新会话待测 | 待实测 / 待实测 | 装好后技能列表未立即刷新；新会话是否刷新待测 |
| 扣子 | 区分扣子/扣子编程 → 对话或导入 | 待实测 | 待实测 | 待实测 / 待实测 | 包格式与任务启用范围待验证 |

每次实测追加一份记录，不把原表里的待实测直接改成无证据的成功：

```text
日期 / 测试者：
平台 / 系统 / 客户端版本 / 模式：
技能版本 / commit：
实际安装步骤及原始回复：
安装证据（路径 / 列表 / 日志）：
自动触发 / 显式触发：
references 读取证据 / assets 表头核对：
脚本执行 / 写文件能力：
新对话是否可用 / 是否需重新添加：
失败原文与复现步骤：
结论（安装成功 / 部分可用 / 会话内使用 / 失败 / 未知）：
```

## SKILL.md 已调整及待验证项

- 已调整：把“帮我做 GEO”写入描述前部，明确问诊起点和不保证推荐。
- 已调整：以技能所在目录解析资源路径，缺文件明确告知，不能假装已读取。
- 已调整：按实际工具能力决定执行方式；不能写文件提供待保存内容，不能联网/执行时标未验证。
- 已调整：将采样批次和索引写入产出表，避免复查覆盖旧原文。
- 待实测后决定：是否需要某个平台专用路径、打包结构或显式触发说明。现阶段不增加未经验证的平台特有字段。
