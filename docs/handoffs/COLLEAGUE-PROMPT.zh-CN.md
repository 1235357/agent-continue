# 可直接复制给接手同事（v3.4.0 · 2026-11-26 更新）

请接手 **Agent Continue**（仓库：`https://github.com/1235357/agent-continue.git`，分支 `main`，当前版本 **`v3.4.0`**），先按顺序阅读：

1. [docs/DEVELOPMENT-SETUP.md](../DEVELOPMENT-SETUP.md)（开发环境一键安装、VS Code 配置、扩展热加载与全量测试矩阵）
2. [docs/handoffs/2026-11-26-v3.4.0-HANDOFF.md](./2026-11-26-v3.4.0-HANDOFF.md)（最新架构基线、日志增强、零打断修复与下一步路线）
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

1. **Dot 持续自主与全链路可观测性（v3.3.0 → v3.4.0）**：
   - 修复长期未知非认证弹窗导致 `ROUTINE_APPROVAL_OBSERVED` / `TAKEOVER_PROMPT_OBSERVED` 实时监听失效、被迫退回 60–120 秒轮询的问题；Dot `/dots/` 上的接管/登录请求弹窗不再误报为 `unknown-modal`；`unknown-modal` 去重改为跨 `sent` 保持并用 `suppressedCount` 统计。
   - 新增全生命周期结构化脱敏字段（`code`、`targetKind`、`runKind`、`trigger`、`surface`、`optionKind`、`evidence` 白名单标记、`sequence`、`domWrites`、`maxDomWriteMs` 等）及 `incidentLogs` / `incidentDeliveries` / `activityStats` 持久保留，长跑 20+ 轮后仍能完整回溯早期暂停与异常原因。
   - 安全不变量严禁破坏：`DEFAULT_CONFIG` 开关默认 `false`、未知提交不盲重放、真实人机验证 CAPTCHA 控件必暂停、`logEvent` 保持单键 `'logs'` 读写及 `timing-diagnostics` 无副作用约束、导出日志绝不含提示词正文与私密凭据、绝不提交 `native/dev/*.pem` 或 `private/`。
2. **下一阶段核心目标**：
   - 基于 `v3.4.0` 的 `incidents` / `summary` 真实日志定位并消除任何残余非预期暂停。
   - 推进 Windows Direct OpenAI Tunnel (`openai/tunnel-client`) + Desktop Commander + SSH 预检从扩展控制面板直接闭环，用本地 CLI/SSH 通道替代部分脆弱浏览器 DOM 操作。
   - 保持每次更新同步测试验证、推送 GitHub（`main` + tag）并维持完整同事交接文档。
