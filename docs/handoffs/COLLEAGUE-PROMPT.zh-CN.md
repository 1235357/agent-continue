# 可直接复制给接手同事（v3.3.5 · 2026-11-26 更新）

请接手 **Agent Continue**（仓库：`https://github.com/1235357/agent-continue.git`，分支 `main`，当前版本 **`v3.3.5`**），先按顺序阅读：

1. [docs/DEVELOPMENT-SETUP.md](../DEVELOPMENT-SETUP.md)（开发环境一键安装、VS Code 配置、扩展热加载与全量测试矩阵）
2. [docs/handoffs/2026-11-26-v3.3.5-HANDOFF.md](./2026-11-26-v3.3.5-HANDOFF.md)（最新架构基线、已解决的 Dot 问题与未完成方向）
3. [docs/prompts/FULL-DELEGATION-DOT-PROMPT.md](../prompts/FULL-DELEGATION-DOT-PROMPT.md)（全权代理 / 分身事前放权与 `/elephant-goldfish` 提示词模板）
4. [CONTRIBUTING.md](../../CONTRIBUTING.md) 与 [CHANGELOG.md](../../CHANGELOG.md)

## 一键配置本地开发环境

- **Windows（PowerShell）**：
  ```powershell
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-dev.ps1
  ```
- **macOS / Linux**：
  ```bash
  bash scripts/bootstrap-dev.sh
  ```
完成后打开 `chrome://extensions` 开启开发者模式，点击 **加载已解压的扩展程序** 选择仓库根目录即可实测（VS Code 任务已配置在 `.vscode/tasks.json`）。

## 当前重点与安全边界

1. **Dot 全自动持续推进（v3.3.0 → v3.3.5）**：
   - 支持重启自动重绑唯一会话、长 Markdown（含 `<hr>` 与链接）分段平滑写入（不卡顿主线程）、内联 `Always allow / Allow this tool for this conversation / Deny` 自动允许、内联 OAuth 登录与 Dot 保守请示（“请确认我可以…”）自动以 `/elephant-goldfish` 全权分身放权回复。
   - 安全不变量严禁破坏：`DEFAULT_CONFIG` 开关默认 `false`、未知提交不盲重放、真实人机验证 CAPTCHA 控件必暂停、导出日志绝不含提示词正文与私密凭据、绝不提交 `native/dev/*.pem` 或 `private/`。
2. **下一阶段核心目标**：
   - 继续在 Windows 上打通基于官方 OpenAI Tunnel (`openai/tunnel-client`) / Desktop Commander 一键知情授权引导的浏览器插件控制中台，经本地 Windows 直连操控 Linux 科研服务器并在重启/断线后恢复。
   - 保持 GitHub Release 先行持续迭代，Chrome Web Store 在审核通过后滞后跟进发布。
   - 每次更新代码、环境脚本、文档或修复问题，均同步测试证据并推送 GitHub，确保同事随时可零障碍接手。
