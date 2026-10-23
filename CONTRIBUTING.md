# 开发、维护与发布

Agent Continue 的项目代码采用 MIT 许可证。离线 PDF.js、字体和 CMap 保留各自许可证；项目 MIT 不会替换第三方许可。

提交改动时，请说明具体问题、用户可见行为、验证结果和仍未覆盖的环境。复现使用合成提示词，不需要用户提供真实保密内容。

## 从源码运行

需要 **Node.js 22.13.0+、npm、Python 3**。

```bash
git clone https://github.com/1235357/agent-continue.git
cd agent-continue
npm ci --ignore-scripts
npm run vendor
npx playwright install --with-deps chromium
npm test
python3 scripts/package.py
```

源码根目录在生成 PDF 资源后即可用浏览器开发者模式加载。Release ZIP 已包含离线资源；其安装用户无需 npm。

`npm run vendor` 从锁定的 `pdfjs-dist` 生成主模块、Worker、字体和 CMap。生成器检查批准的版本、包完整性值、固定文件清单、大小与逐文件 SHA-256；全部源文件通过后才复制。不要手动从 CDN 拷贝版本不一致的 Worker。

已验证测试类型、环境变量与单套件命令见 [tests/README.md](tests/README.md)。MV3 集成必须使用完整 Chromium，普通 DOM / UI 测试可以使用 headless shell。

## 代码职责

| 文件 | 职责 |
| --- | --- |
| `config.js` | 默认值、配置验证、支持的目标路径、调度辅助逻辑 |
| `background.js` | 任务状态、令牌、定时、并发、绑定、恢复、日志与保持活动 |
| `adapter.js` | 隔离世界中的页面结构识别、草稿保护、填写、点击与新消息确认 |
| `file-import.js` | 本机文档解析、限额、固定错误与资源清理 |
| `popup.html` / `popup.css` / `popup.js` | 弹窗、完整控制台、本地导入与隐私界面 |
| `scripts/vendor-pdfjs.mjs` | 可复现的离线 PDF 资源生成与校验 |
| `scripts/package.py` | 按明确范围生成安装 / 源码 ZIP |
| `tests/` | 合成页面、文档、状态、UI 与实际 MV3 回归 |

## 更改发送逻辑

后台操作必须保持以下行为可观察且可验证：

- 只有用户选择的精确目标可以接收消息；恢复不信任历史 tab ID，多个匹配目标不随意选择。
- 不激活目标标签、不调用 `window.focus()`、不通过系统剪贴板搬运提示词。
- 暂停、替换任务和过期令牌能撤销尚未提交的执行；旧结果不能修改新任务。
- 不覆盖用户草稿、已识别附件或用户在检查间隙进行的修改，包括只改了空白字符的内容。
- 已确认次数只由新用户消息证据增加。未知结果不立即重试，后续按正常周期处理；不要把未知回执当作服务端绝对失败。
- 默认无限单条重复不会因为普通完成措辞或暂时页面错误自行结束。次数上限、停止标记和单遍队列是用户明确配置的条件。

为具体剩余风险补充回归即可，无需重复实现逻辑的无效测试。更改调度状态时优先覆盖相应竞态；更改 DOM 适配时用实际结构的脱敏合成样本，并确认真实 MV3 注入流程仍通过。

## 网页结构变化

收到自检失败或错误发送报告时，先收集浏览器版本、目标路径类型、扩展版本、是否存在草稿 / 附件以及脱敏状态信息。避免要求会话全文或实际提示词。

在用户授权的页面中只读核对编辑器、发送按钮、忙碌标记、消息标记与身份属性。让新选择器限制在对应输入区域内；不能因为找不到正确按钮，就退回到整个页面任意同名按钮。将必要结构转写为合成 fixture，再测试多目标、缺失 / 重复元素、页面变化和用户操作竞争。

真实站点验证与合成测试分别记录。若需要实际提交，使用明确获准的测试会话与测试文字；不要将用户的保密运行配置当开发测试样本。

## 隐私变更

提示词必须在本机供发送逻辑使用，但不进入开发者端点、诊断日志、Issue 附件或常规截图。正文隐藏时应从 DOM / textarea value 移除，不只是遮挡。保持日志为受控、无正文的状态信息。

文档解析器不得执行文档脚本或抓取远程资源。新增格式需要大小、解压、时间和错误内容边界。导出应默认排除提示词，只有用户显式选择才包含正文。

清空配置或停止异步导入时，确认迟到结果不会重新写回已清除内容。个人预配置包、个人原文件、浏览器 profile 与凭据不得提交到公共仓库或公开 Release。完整说明见 [PRIVACY.md](PRIVACY.md)。

## 更新依赖

Dependabot 每周检查 npm 与 GitHub Actions，并提出 PR。维护者审查后再合并；没有“自动持续修复所有问题”的承诺。

PDF.js 升级不能只修改 `package.json`：需一起审查主模块和 Worker、许可证、资源路径、`vendor/pdfjs/SOURCE.json`、生成器中的批准版本 / 完整性值 / 文件数，以及文件解析和真实扩展 CSP 测试。生成资源不直接提交到 Git；来源清单、许可证和生成脚本需要提交。详见 [FILE_FORMATS.md](docs/FILE_FORMATS.md)。

## CI

`.github/workflows/test.yml` 配置：

- 每次 push、PR、手动触发和每周计划运行。
- 安装锁定依赖，生成已校验的 PDF 资源，安装 Chromium。
- 执行语法检查与全部测试，随后生成安装 ZIP 并上传 CI artifact。
- 只对合成页面测试，不登录真实 ChatGPT，也不向用户会话定时发送。

远程成功状态以 [Actions 记录](https://github.com/1235357/agent-continue/actions) 为准。定时 CI 能发现已覆盖的逻辑 / 资源回归，不能独立发现所有线上网页改版。

## 发布版本

1. 将 `manifest.json`、`package.json`、`package-lock.json` 顶层及根包版本统一为 `MAJOR.MINOR.PATCH`。
2. 在 [CHANGELOG.md](CHANGELOG.md) 增加 `## [版本号]` 小节；说明行为变化、升级方式和实际验证边界。
3. 从干净依赖状态运行 `npm ci --ignore-scripts`、`npm run vendor`、`npm test` 和 `python3 scripts/package.py`。
4. 检查安装 ZIP 根目录是 `AgentContinue/`，入口文件、离线 PDF 资源、版本和第三方许可证齐全；不含任何个人配置或预置文件。
5. 提交经过审查的变更，创建并推送 `vMAJOR.MINOR.PATCH` 标签。
6. 查看 Release 工作流结果及附件：`agent-continue-MAJOR.MINOR.PATCH.zip` 和 `SHA256SUMS`。

标签工作流先验证版本与变更记录，再安装依赖、生成离线资源、运行全部测试、打包并校验 ZIP，最后用仓库自带的 `GITHUB_TOKEN` 创建或更新 Release。无需个人 PAT。若前置步骤失败，工作流不会发布新的安装附件；重跑会更新该标签的生成附件。

不要在没有证据时把“合成 Chromium 已通过”写成“真实 Windows / Edge 和线上私人会话全部通过”。安装包发布后，可在可控环境补充真实浏览器与长期运行记录，并更新 [VALIDATION.md](VALIDATION.md)。

## Issue / PR 建议内容

报告问题时提供：版本、浏览器及系统、普通会话或 dot、预期与实际行为、复现步骤、脱敏状态日志；能用合成文字复现最好。PR 描述应说明为何需要修改、改动后的行为和对应验证。

不要附上原始保密提示词、实际会话全文、Cookie、账号凭据或私人安装包。支持范围之外的能力可先参照 [ROADMAP.md](docs/ROADMAP.md) 确定验收标准。
