# 本机文档导入与隐私边界

文件导入用于把本机文档中的文字设为运行提示词。**导入本身没有上传操作**：扩展在浏览器内读取所选文件，提取文字，再由任务发送到用户绑定的聊天页面。发送到 ChatGPT / dot 后，目标服务当然会收到这些文字；这正是自动发送功能的目的。

开发者不需要获得用户文档。导入器没有分析服务、遥测、远程转换 API 或 CDN；源码、错误信息和诊断日志不包含用户的文件名或正文。测试使用程序生成的文档，与真实用户文件分开。界面应默认隐藏导入正文，只在用户主动要求查看时显示。

“隐藏正文”是界面隐私功能，不是加密。扩展必须在本机取得原文才能自动发送；本机浏览器的扩展存储、用户主动导出的配置以及发送目标各自有其访问边界。不要将已经填入真实提示词的私人安装包提交到公共仓库或发布为通用 Release。

## 支持的格式

| 格式 | 导入方式 | 保真程度与限制 |
|---|---|---|
| `.txt`、`.md`、`.markdown` | 读取为纯文本 | 保留首尾空格、制表符和原始换行；仅移除编码 BOM。Markdown 不渲染、不改写。需要逐字使用提示词时优先选择这类格式。 |
| `.csv`、`.tsv`、`.json`、`.jsonl`、`.yaml`、`.yml`、`.xml`、`.log`、`.ini`、`.cfg`、`.conf`、`.rst`、`.tex` | 原文读取 | 不解析或重排键值、列、标记，也不执行文件内容。 |
| `.html`、`.htm` | 从未加入页面的 inert `template` 提取静态文字 | 保留常见段落、换行和表格单元格分隔；删除脚本、样式、嵌入内容。不会执行脚本或加载页面资源。版式不会保留。 |
| `.docx` | 校验 ZIP 后，只解压 `word/document.xml`；读取 Word 正文 XML | 支持正文段落、空段落、制表符、手动换行和表格文字；忽略已删除修订、图片、页眉页脚、脚注、批注和字段指令。支持标准与 Strict WordprocessingML 命名空间。 |
| `.pdf` | 使用随扩展打包的 Mozilla PDF.js 在独立本地 Worker 提取文本层 | 支持具有可提取文字的 PDF。多栏、表格、特殊字体和阅读顺序可能与视觉排版不同。**不做 OCR**；扫描件、加密 PDF 或损坏文件会给出明确错误。 |

不支持 `.doc`、`.docm`、`.xls` / `.xlsx`、`.ppt` / `.pptx`、图片及任意 ZIP。需要这些文档时，请先在本机导出为 TXT、Markdown、DOCX 或带文本层的 PDF；扩展不会把文档交给在线转换服务。

## 编码

默认自动识别 UTF-8 / UTF-16 BOM。无 BOM 时先严格尝试 UTF-8；失败后尝试 GB18030，并提示用户核对编码。也可明确指定 `utf-8`、`gb18030`、`utf-16le` 或 `utf-16be`。自动识别不是任意编码探测器：乱码时应选择正确编码，或另存为 UTF-8。

模块返回的 TXT / Markdown 原文不会被 `.trim()` 修改。最终网页编辑器可能规范化 CRLF 等换行表现；发送层应仅在比较时做兼容性规范化，不能对待发原文擅自追加、删减或替换。

## 处理限额

- 每个输入文件最多 **5 MiB**。
- 提取结果最多 **100,000 个 JavaScript 字符单元**；超出会拒绝导入，绝不静默截断。
- DOCX 正文 XML 解压后最多 **4 MiB**；同时检查声明大小与实际流式输出大小，校验 CRC，并拒绝加密、ZIP64、多卷 ZIP、重复正文、损坏结构和 XML 实体声明。
- PDF 最多 **100 页**，解析最多 **20 秒**。超时终止 Worker；清理等待也有上限。
- 空文件、无有效文字或包含二进制控制字符的“文本文件”会被拒绝。

## 集成接口

```js
import { importPromptFile, SUPPORTED_ACCEPT } from './file-import.js';

fileInput.accept = SUPPORTED_ACCEPT;
const { text, format, warnings } = await importPromptFile(file, {
  encoding: 'auto',
});
// Store `text` locally as the runtime prompt. Do not log or auto-reveal it.
```

导入器只返回结果，不修改扩展配置，也不主动发送聊天。错误提供固定 `code` 与不含文档内容的中文 `message`。例如 `FILE_TOO_LARGE`、`TEXT_TOO_LARGE`、`ENCODING`、`ENCRYPTED`、`PDF_NO_TEXT`、`PDF_TIMEOUT`。调用方应显示这种受控错误，不展示底层解析器异常或堆栈。

`file-import.js` 必须从扩展页面调用，而不是注入到聊天页面。TXT 等纯文本路径不加载 PDF.js；只有导入 PDF 时动态加载本地模块。PDF.js 的主模块、Worker 和字体/CMap 资源全部来自扩展自身目录。

## 依赖来源与维护

PDF.js 固定为 **`pdfjs-dist@6.4.299`**，于 2026-10-23 从 Mozilla 指定的官方 npm 分发渠道取得。使用 legacy 构建以覆盖较旧的 Chromium JavaScript 功能；主模块与 Worker 版本一致。下载包通过 npm 元数据提供的 SHA-512 完整性值校验，详细来源、版本、文件清单和逐文件 SHA-256 见 [`vendor/pdfjs/SOURCE.json`](../vendor/pdfjs/SOURCE.json)。

### 从公开源码复现离线资源

GitHub 源码只跟踪生成脚本、来源清单和许可证，不提交生成的 PDF.js 主模块、Worker、字体或 CMap 二进制。构建或本地加载源码之前运行：

```bash
npm ci --ignore-scripts
node scripts/vendor-pdfjs.mjs
```

脚本从 `node_modules/pdfjs-dist` 复制经过核验的精确 188 个文件，映射 `legacy/build/pdf.mjs` 和 `legacy/build/pdf.worker.mjs` 到扩展资源目录，并逐一验证大小与 SHA-256。它拒绝不同版本、缺失/重复/不批准的路径或校验值变化；全部源文件验证完毕后才开始复制。**Release 安装 ZIP 包含完整离线资源，安装用户无需 npm，也无需再联网下载 PDF 解析器。**

源码需跟踪这些小型来源/许可文件：

- `vendor/pdfjs/SOURCE.json`
- `vendor/pdfjs/LICENSE`
- `vendor/pdfjs/cmaps/LICENSE`
- `vendor/pdfjs/standard_fonts/LICENSE_FOXIT`
- `vendor/pdfjs/standard_fonts/LICENSE_LIBERATION`
- `scripts/vendor-pdfjs.mjs`

CI 应在 `npm ci --ignore-scripts` 后、测试和打包前执行生成脚本。升级 `pdfjs-dist` 开发依赖时，脚本会主动失败，要求同时审查并更新固定版本、包完整性值、逐文件清单与哈希、许可证和回归测试，不能仅修改 npm 版本号。

- [Mozilla PDF.js 项目与 npm 分发说明](https://github.com/mozilla/pdf.js)
- [PDF.js 6.4.299 Release](https://github.com/mozilla/pdf.js/releases/tag/v6.4.299)
- [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
- [旧版本 eval 漏洞公告](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq)
- [Chrome Compression Streams API](https://developer.chrome.com/blog/compression-streams-api/)
- [Compression Standard](https://compression.spec.whatwg.org/)

PDF.js 采用 Apache-2.0，许可证保留在 [`vendor/pdfjs/LICENSE`](../vendor/pdfjs/LICENSE)；字体与 CMap 的各自许可证保留在对应目录。项目自己的 MIT 许可证不会替换第三方许可证。升级依赖时应同时更新主模块、Worker、资源、来源清单和回归测试。

PDF 仅请求文本提取，不运行文档 JavaScript、XFA 或渲染任务；关闭 Wasm 和系统字体使用，并传入本地字体与 CMap 地址。使用显式同源 module Worker，避免扩展 CSP 不允许的 blob Worker 包装；没有 `unsafe-eval` 要求。

## 验证范围

`tests/file-import-tests.mjs` 用合成文本、HTML、DOCX、PDF 和加密 PDF 验证：原文保留、编码、错误脱敏、大小边界、DOCX 解压与 CRC、拒绝外部实体、惰性 HTML、PDF 本地 Worker/CSP、拒绝加密与扫描件，以及无外部请求、无文档内容日志。它不会扫描或读取用户附件目录。

这些测试验证导入器的行为，不能保证所有第三方文档排版或 PDF 字体均能完整还原。对需要逐字发送的提示词，TXT 或 Markdown 是最直接可靠的输入格式。
