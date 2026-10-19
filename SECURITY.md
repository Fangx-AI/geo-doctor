# 安全说明 · Security Policy

## 报告漏洞 · Reporting a vulnerability

请不要在公开 issue 里报告安全问题。到仓库的 [Security → Report a vulnerability](https://github.com/Fangx-AI/geo-doctor/security/advisories/new) 私下提交，写清楚受影响的命令、版本和复现步骤。我们会尽快确认，修好后在发布说明里致谢（如果你愿意）。

Please do not open public issues for security problems. Report privately via [Security → Report a vulnerability](https://github.com/Fangx-AI/geo-doctor/security/advisories/new) with the affected command, version and steps to reproduce.

## 支持的版本 · Supported versions

只维护最新发布版本（见 [Releases](https://github.com/Fangx-AI/geo-doctor/releases)）。Only the latest release is supported.

## 密钥和密码 · Credentials

- `geo-probe` 只从环境变量读 API Key（如 `DEEPSEEK_API_KEY`），`geo-publish` 只从 `GEO_WP_APP_PASSWORD` 读 WordPress 应用密码。它们不会写进任何文件、日志或采样记录。
- 不要把密钥写进 `geo/` 目录、提交到仓库，或贴进 issue。
- 发现工具把密钥写到了磁盘或输出里，请按上面的方式私下报告。

`geo-probe` reads API keys only from environment variables and `geo-publish` reads the WordPress application password only from `GEO_WP_APP_PASSWORD`; neither writes them to files, logs or run records. If you find a case where a secret leaks to disk or output, report it privately.
