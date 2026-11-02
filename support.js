import { initializeLanguage, getLanguage, setLanguage, subscribeLanguage } from './i18n.js';
import { DEVELOPER_CONTACT } from './support-info.js';
import { buildActivityExport } from './activity-export.js';

const copy = {
  en: {
    language: 'Language', project: 'FREE & OPEN SOURCE', title: 'Developer & support',
    repository: 'GitHub repository', issue: 'Report an issue', diagnostics: 'Activity diagnostics',
    report: 'Bug reports and suggestions are welcome on GitHub. Include the extension version, browser and OS, steps to reproduce, and an exported diagnostic file when useful.',
    privacy: 'GitHub Issues are public. Review the JSON before attaching it. Never include credentials, cookies, private prompts, conversation URLs, screenshots of private chats, or documents.',
    export: 'Export diagnostics', timestamps: 'Include exact timestamps (off by default)', local: 'Nothing is uploaded automatically. Exported files stay on this device until you share them.',
    preview: 'Review exported JSON', independent: 'An independent personal project. A university email address does not imply university endorsement or support.',
    saved: 'Diagnostic download requested. Review the JSON before sharing; export does not create a GitHub issue.',
    failed: 'Diagnostics could not be exported. No file was uploaded.', languageFailed: 'The language preference could not be saved.',
  },
  zh_CN: {
    language: '语言', project: '免费开源', title: '开发者与支持', repository: 'GitHub 项目仓库', issue: '提交问题', diagnostics: '运行诊断',
    report: '欢迎在 GitHub 提交问题与建议。请提供扩展版本、浏览器与操作系统、复现步骤，并按需附上导出的诊断文件。',
    privacy: 'GitHub Issue 是公开的。附加文件前请先检查 JSON。不要包含凭据、Cookie、私人提示词、会话地址、私人聊天截图或文档。',
    export: '导出诊断日志', timestamps: '包含精确时间（默认关闭）', local: '不会自动上传任何内容。导出的文件保留在本机，是否分享由你决定。',
    preview: '检查导出的 JSON', independent: '这是独立的个人项目。大学邮箱不代表大学的认可或技术支持。',
    saved: '已请求下载诊断文件。分享前请检查 JSON；导出不会自动创建 GitHub Issue。',
    failed: '未能导出诊断文件。没有上传文件。', languageFailed: '未能保存语言偏好。',
  },
};
const $ = id => document.getElementById(id);
let statusKey = 'local';
let exporting = false;
let languageSaveFailed = false;
let languageSaving = false;
function render() {
  const language = getLanguage();
  document.documentElement.lang = language === 'zh_CN' ? 'zh-CN' : 'en';
  document.title = 'Agent Continue - ' + copy[language].title;
  for (const node of document.querySelectorAll('[data-copy]')) node.textContent = copy[language][node.dataset.copy];
  $('export-status').textContent = copy[language][statusKey];
  $('language-status').textContent = languageSaveFailed ? copy[language].languageFailed : '';
  $('language-status').hidden = !languageSaveFailed;
  $('language').value = language;
  $('language').disabled = languageSaving;
}
function clearPreview() {
  $('export-preview').hidden = true;
  $('export-preview').open = false;
  $('diagnostic-preview').textContent = '';
}
$('developer-email').href = DEVELOPER_CONTACT.emailUrl;
$('developer-email').textContent = DEVELOPER_CONTACT.email;
for (const [id, key] of [['project-link', 'repository'], ['issue-link', 'issues'], ['linkedin-link', 'linkedin']]) {
  $(id).href = DEVELOPER_CONTACT[key];
}
let extensionVersion = 'unknown';
try { extensionVersion = chrome.runtime.getManifest().version; } catch { /* Preview contexts have no extension manifest. */ }
$('version').textContent = extensionVersion === 'unknown' ? '' : 'v' + extensionVersion;
$('language').addEventListener('change', async event => {
  if (languageSaving) return;
  languageSaving = true;
  $('language').disabled = true;
  try { await setLanguage(event.target.value); languageSaveFailed = false; }
  catch { languageSaveFailed = true; }
  finally { languageSaving = false; render(); }
});
$('export-diagnostics').addEventListener('click', async () => {
  if (exporting) return;
  exporting = true;
  $('export-diagnostics').disabled = true;
  clearPreview();
  try {
    const { logs } = await chrome.storage.local.get(['logs']);
    const report = buildActivityExport({ logs, extensionVersion, includeTimestamps: $('include-timestamps').checked });
    const text = JSON.stringify(report, null, 2);
    $('diagnostic-preview').textContent = text;
    $('export-preview').hidden = false;
    $('export-preview').open = true;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'agent-continue-activity.json';
    document.body.append(link);
    try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    statusKey = 'saved';
  } catch { clearPreview(); statusKey = 'failed'; }
  finally { exporting = false; $('export-diagnostics').disabled = false; render(); }
});
subscribeLanguage(render);
await initializeLanguage();
render();
