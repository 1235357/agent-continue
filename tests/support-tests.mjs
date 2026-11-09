import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

async function module(name) {
  const url = new URL('../' + name, import.meta.url);
  assert.ok(fs.existsSync(url), `Support implementation missing: ${name}`);
  return import(url);
}

test('developer contact has the exact owner-approved destinations and no upload URL', async () => {
  const { DEVELOPER_CONTACT } = await module('support-info.js');
  assert.deepEqual(DEVELOPER_CONTACT, {
    name: 'Zhentong Ye', email: 'zhentongye2028@u.northwestern.edu',
    emailUrl: 'mailto:zhentongye2028@u.northwestern.edu',
    repository: 'https://github.com/1235357/agent-continue',
    issues: 'https://github.com/1235357/agent-continue/issues/new/choose',
    linkedin: 'https://www.linkedin.com/in/tony-zhentong-ye/',
  });
  assert.equal(Object.isFrozen(DEVELOPER_CONTACT), true);
});

const now = Date.UTC(2026, 10, 2, 20);
const secret = 'SYNTHETIC-PRIVATE-PROMPT https://chatgpt.com/c/private-test C:\\private\\file.txt sk-test-secret';
async function build(logs, extra = {}) {
  const { buildActivityExport } = await module('activity-export.js');
  return buildActivityExport({ logs, extensionVersion: '2.1.0', now, ...extra });
}

test('support export contains version and bounded typed event metadata, not raw messages', async () => {
  const value = await build([{ at: now - 1000, event: 'unconfirmed', message: secret,
    diagnostic: { code: 'execution-exception', durationMs: 123, stack: secret }, prompt: secret, url: secret }]);
  assert.deepEqual(value, {
    format: 'agent-continue-activity', version: 4, extensionVersion: '2.1.0',
    timestampMode: 'relative-ms', excludedEntries: 0,
    logs: [{ elapsedMs: 0, event: 'unconfirmed', diagnostic: { code: 'execution-exception', durationMs: 123 } }],
  });
  assert.equal(JSON.stringify(value).includes(secret), false);
});

test('malformed or unexpected persisted entries are not forwarded as issue content', async () => {
  const value = await build([null, 'text', 3, [], { at: now, event: secret },
    { at: '2026-11-02', event: 'sent' }, { at: Infinity, event: 'sent' },
    { at: -1, event: 'sent' }, { at: 1.5, event: 'sent' },
    { at: now, event: ['sent'] }, { at: now, event: 'sent' }]);
  assert.deepEqual(value.logs, [{ elapsedMs: 0, event: 'sent' }]);
  assert.equal(value.excludedEntries, 10);
  assert.equal(JSON.stringify(value).includes(secret), false);
});

test('unknown diagnostics and all free-form diagnostic data are omitted', async () => {
  for (const diagnostic of [secret, [], null, { code: secret, durationMs: 3 }, { code: ['adapter-result'] }]) {
    const value = await build([{ at: now, event: 'unknown', diagnostic }]);
    assert.deepEqual(value.logs, [{ elapsedMs: 0, event: 'unknown' }]);
  }
});
test('known readiness and no-dispatch diagnostics export no prompt, exception or page data', async () => {
  for (const code of ['send-not-ready', 'commit-not-dispatched']) {
    const value = await build([{ at: now, event: 'busy', diagnostic: { code, durationMs: 150, reason: secret } }]);
    assert.deepEqual(value.logs[0].diagnostic, { code, durationMs: 150 });
    assert.equal(JSON.stringify(value).includes(secret), false);
  }
});

test('timing diagnostics export only bounded numbers, fixed enums and actual booleans', async () => {
  const value = await build([{ at: now, event: 'timing-diagnostics', message: secret,
    diagnostic: { code: 'timing-probe', kind: 'page-timers', status: 'result', durationMs: 1992.4,
      firstMs: 991.2, hidden: true, ok: false, allowed: false, stack: secret, url: secret } }]);
  assert.deepEqual(value.logs[0], { elapsedMs: 0, event: 'timing-diagnostics', diagnostic: {
    code: 'timing-probe', durationMs: 1992, kind: 'page-timers', status: 'result', firstMs: 991,
    hidden: true, ok: false, allowed: false,
  } });
  assert.equal(JSON.stringify(value).includes(secret), false);
  for (const bad of [secret, true, null, {}, [], NaN, Infinity]) {
    const malformed = await build([{ at: now, event: 'timing-diagnostics', diagnostic: {
      code: 'timing-probe', kind: bad, status: bad, firstMs: bad, hidden: bad, ok: bad, allowed: bad,
    } }]);
    const expected = typeof bad === 'boolean' ? { code: 'timing-probe', hidden: true, ok: true, allowed: true }
      : { code: 'timing-probe' };
    assert.deepEqual(malformed.logs[0].diagnostic, expected);
  }
  const ordinary = await build([{ at: now, event: 'unconfirmed', diagnostic: {
    code: 'execution-timeout', durationMs: 20002, kind: 'page-timers', hidden: true,
  } }]);
  assert.deepEqual(ordinary.logs[0].diagnostic, { code: 'execution-timeout', durationMs: 20002 });
});

test('duration is finite numeric only and bounded without string coercion', async () => {
  for (const durationMs of ['100', true, null, {}, [], NaN, Infinity, -Infinity]) {
    const value = await build([{ at: now, event: 'unconfirmed', diagnostic: { code: 'adapter-result', durationMs } }]);
    assert.deepEqual(value.logs[0].diagnostic, { code: 'adapter-result' });
  }
  for (const [durationMs, expected] of [[-4, 0], [2.6, 3], [250000, 120000]]) {
    const value = await build([{ at: now, event: 'unconfirmed', diagnostic: { code: 'no-valid-result', durationMs } }]);
    assert.equal(value.logs[0].diagnostic.durationMs, expected);
  }
});

test('exports cap processing at the latest 200 local entries and do not mutate storage inputs', async () => {
  const input = Array.from({ length: 250 }, (_, n) => ({ at: now + n, event: 'sent', message: secret }));
  const before = structuredClone(input);
  const value = await build(input);
  assert.equal(value.logs.length, 200);
  assert.equal(value.logs[0].elapsedMs, 0);
  assert.equal(value.logs[199].elapsedMs, 199);
  assert.equal(value.excludedEntries, 50);
  assert.deepEqual(input, before);
});

test('bad log container is empty; version text cannot carry private data', async () => {
  for (const logs of [null, {}, 'logs', 123]) assert.deepEqual((await build(logs)).logs, []);
  for (const extensionVersion of [secret, {}, null, ['2.1.0'], '2.1.0\n', '2.1.0-private']) {
    assert.equal((await build([], { extensionVersion })).extensionVersion, 'unknown');
  }
  for (const version of ['2.1.1', '2.2.0', '10.11.12.13']) {
    assert.equal((await build([], { extensionVersion: version })).extensionVersion, version);
  }
});

test('invalid export clock rejects instead of leaking string input', async () => {
  for (const bad of [NaN, Infinity, -1, secret, {}, null]) {
    await assert.rejects(build([], { now: bad }), /clock/i);
  }
});

test('absolute timestamps require explicit opt-in and relative output has no wall-clock fields', async () => {
  const logs = [{ at: now - 1200, event: 'replaced' }, { at: now, event: 'scheduler-error' }];
  const relative = await build(logs);
  assert.deepEqual(relative.logs, [{ elapsedMs: 0, event: 'replaced' }, { elapsedMs: 1200, event: 'scheduler-error' }]);
  assert.equal(Object.hasOwn(relative, 'exportedAt'), false);
  assert.equal(JSON.stringify(relative).includes(String(now)), false);
  const absolute = await build(logs, { includeTimestamps: true });
  assert.equal(absolute.timestampMode, 'unix-ms');
  assert.equal(absolute.exportedAt, new Date(now).toISOString());
  assert.deepEqual(absolute.logs, logs);
  for (const option of ['true', 1, {}, null]) await assert.rejects(build([], { includeTimestamps: option }), /timestamp/i);
});

test('support page stays local until an explicit fixed external link or manual export', async () => {
  const htmlPath = new URL('../support.html', import.meta.url);
  assert.ok(fs.existsSync(htmlPath), 'Support page missing');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /zhentongye2028@u\.northwestern\.edu/);
  assert.match(html, /lang="en"/);
  for (const id of ['developer-email', 'project-link', 'issue-link', 'linkedin-link', 'export-diagnostics', 'language']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const js = fs.readFileSync(new URL('../support.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|sendNativeMessage|requestKeepAwake|\.tabs\.|clipboard|runtime\.sendMessage/);
  assert.match(js, /local\.get\(\['logs'\]\)/);
  assert.match(js, /buildActivityExport/);
  assert.doesNotMatch(html, /<form|<iframe|https?:\/\/[^" ]+\.(?:js|css)/);
});

test('the console uses the same safe export builder and has an obvious support entry', () => {
  const popup = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
  assert.match(popup, /import\s*\{\s*buildActivityExport\s*\}\s*from\s*'\.\/activity-export\.js'/);
  assert.doesNotMatch(popup, /logs\.map\(\(\{\s*at,\s*event,\s*message/);
  assert.match(html, /href="support\.html"/);
  assert.match(html, /mailto:zhentongye2028@u\.northwestern\.edu/);
});

test('console rendering tolerates malformed and inherited event keys without stale refresh', () => {
  const source = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
  const renderer = source.slice(source.indexOf('function renderLogs() {'), source.indexOf('function renderCountdown() {'));
  const nodes = new Map();
  const element = () => ({
    children: [], classList: { add() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    set textContent(value) { this.text = String(value); },
    get textContent() { return this.text; },
  });
  const t = (value, ...parts) => Array.isArray(value) ? String.raw({ raw: value }, ...parts) : value;
  const context = vm.createContext({
    logs: [null, [], 'invalid', ...[null, {}, { toString: null }, 'constructor', '__proto__', 'toString', 'sent']
      .map(event => ({ at: 1700000000000, event, message: 'synthetic' }))],
    $: id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    document: { createElement: element }, t,
    eventLabels: () => ({ sent: 'Sent' }), getLanguage: () => 'en',
  });
  vm.runInContext(renderer + '\nrenderLogs();', context);
  const titles = nodes.get('logList').children.map(row => row.children[1].textContent);
  assert.deepEqual(titles, ['Sent', ...Array(6).fill('运行状态')]);
  assert.equal(nodes.get('logCount').textContent, '7 条记录');
});

test('GitHub support discovery uses an explicit support document and web contact cards', () => {
  const document = new URL('../.github/SUPPORT.md', import.meta.url);
  assert.ok(fs.existsSync(document), 'Explicit GitHub support document missing');
  const text = fs.readFileSync(document, 'utf8');
  assert.match(text, /zhentongye2028@u\.northwestern\.edu/);
  assert.match(text, /https:\/\/github\.com\/1235357\/agent-continue\/issues\/new\/choose/);
  assert.match(text, /https:\/\/www\.linkedin\.com\/in\/tony-zhentong-ye\//);
  const config = fs.readFileSync(new URL('../.github/ISSUE_TEMPLATE/config.yml', import.meta.url), 'utf8');
  const urls = [...config.matchAll(/^\s+url:\s+(.+)$/gm)].map(match => match[1]);
  assert.equal(urls.length, 3);
  assert.ok(urls.every(url => url.startsWith('https://')), 'GitHub contact cards must use web URLs');
  assert.match(config, /name:.*zhentongye2028@u\.northwestern\.edu/);
});

async function supportPage() {
  const nodes = new Map();
  const handlers = new Map();
  const state = { logs: [{ at: now, event: 'sent' }], failRead: false, failWrite: false, failDownload: false,
    downloads: 0, languageWrites: [], languageBarrier: null };
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', value: '', checked: false, hidden: id === 'export-preview' || id === 'language-status', open: false,
      addEventListener(name, handler) { handlers.set(id + ':' + name, handler); },
      click() { if (state.failDownload) throw new Error('Synthetic download failure'); state.downloads += 1; },
      remove() {},
    });
    return nodes.get(id);
  };
  let language = 'en';
  const subscribers = [];
  const source = fs.readFileSync(new URL('../support.js', import.meta.url), 'utf8')
    .replace(/^import .+ from '.+';\r?$/gm, '');
  const { DEVELOPER_CONTACT } = await module('support-info.js');
  const { buildActivityExport } = await module('activity-export.js');
  await vm.runInNewContext('(async () => {\n' + source + '\n})()', {
    DEVELOPER_CONTACT, buildActivityExport,
    getLanguage: () => language,
    subscribeLanguage: callback => subscribers.push(callback),
    initializeLanguage: async () => language,
    setLanguage: async value => {
      state.languageWrites.push(value);
      if (state.languageBarrier) await state.languageBarrier;
      if (state.failWrite) throw new Error('Synthetic preference failure');
      language = value;
      for (const callback of subscribers) callback();
    },
    document: { getElementById: node, querySelectorAll: () => [], documentElement: {},
      createElement: () => node('download'), body: { append() {} } },
    chrome: { runtime: { getManifest: () => ({ version: '2.1.0' }) }, storage: { local: {
      get: async () => { if (state.failRead) throw new Error('Synthetic storage failure'); return { logs: state.logs }; },
    } } },
    URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} }, Blob,
    setTimeout: callback => callback(),
  });
  return { state, node, emit: (id, name, event = {}) => handlers.get(id + ':' + name)(event) };
}

test('failed re-export hides and clears the previous diagnostic preview', async () => {
  const page = await supportPage();
  await page.emit('export-diagnostics', 'click');
  assert.equal(page.node('export-preview').hidden, false);
  assert.equal(JSON.parse(page.node('diagnostic-preview').textContent).logs[0].event, 'sent');
  page.state.logs = [{ at: now + 1000, event: 'error' }];
  page.state.failRead = true;
  await page.emit('export-diagnostics', 'click');
  assert.equal(page.state.downloads, 1);
  assert.equal(page.node('export-preview').hidden, true);
  assert.equal(page.node('export-preview').open, false);
  assert.equal(page.node('diagnostic-preview').textContent, '');
  assert.match(page.node('export-status').textContent, /could not be exported/);
  assert.equal(page.node('export-diagnostics').disabled, false);
});

test('a download exception does not leave a preview presented as the current exported file', async () => {
  const page = await supportPage();
  page.state.failDownload = true;
  await page.emit('export-diagnostics', 'click');
  assert.equal(page.state.downloads, 0);
  assert.equal(page.node('export-preview').hidden, true);
  assert.equal(page.node('diagnostic-preview').textContent, '');
  assert.match(page.node('export-status').textContent, /could not be exported/);
});

test('language-save failure and recovery do not replace diagnostic status', async () => {
  const page = await supportPage();
  await page.emit('export-diagnostics', 'click');
  const exportStatus = page.node('export-status').textContent;
  page.state.failWrite = true;
  await page.emit('language', 'change', { target: { value: 'zh_CN' } });
  assert.equal(page.node('language-status').hidden, false);
  assert.match(page.node('language-status').textContent, /could not be saved/);
  assert.equal(page.node('export-status').textContent, exportStatus);
  page.state.failWrite = false;
  await page.emit('language', 'change', { target: { value: 'zh_CN' } });
  assert.equal(page.node('language-status').hidden, true);
  assert.equal(page.node('language-status').textContent, '');
  assert.match(page.node('export-status').textContent, /已请求下载诊断文件/);
});

test('issue forms accept interface-only bugs and suggestions without fabricated conversation data', () => {
  const bug = fs.readFileSync(new URL('../.github/ISSUE_TEMPLATE/bug_report.yml', import.meta.url), 'utf8');
  assert.match(bug, /Not applicable \/ extension interface/);
  const suggestionPath = new URL('../.github/ISSUE_TEMPLATE/suggestion.yml', import.meta.url);
  assert.ok(fs.existsSync(suggestionPath), 'Suggestion form missing');
  const suggestion = fs.readFileSync(suggestionPath, 'utf8');
  assert.match(suggestion, /name: Suggestion/);
  assert.match(suggestion, /public/i);
  assert.match(suggestion, /private prompts/);
  assert.doesNotMatch(suggestion, /id: (?:reproduction|browser|operating_system|target)/);
});

test('language saves cannot overlap or be re-enabled by a concurrent export render', async () => {
  const page = await supportPage();
  let release;
  page.state.languageBarrier = new Promise(resolve => { release = resolve; });
  const saving = page.emit('language', 'change', { target: { value: 'zh_CN' } });
  assert.equal(page.node('language').disabled, true);
  await page.emit('export-diagnostics', 'click');
  assert.equal(page.node('language').disabled, true);
  await page.emit('language', 'change', { target: { value: 'en' } });
  assert.deepEqual(page.state.languageWrites, ['zh_CN']);
  release();
  await saving;
  assert.equal(page.node('language').disabled, false);
  assert.equal(page.node('language').value, 'zh_CN');
  assert.equal(page.node('language-status').hidden, true);
});

test('store Description is concise and avoids the rejected file-format keyword list', () => {
  const text = fs.readFileSync(new URL('../docs/STORE-LISTING.en.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const description = text.split('## Description\n')[1]?.split('\n## Single Purpose')[0];
  assert.ok(description);
  assert.ok(description.trim().length <= 4000, 'Keep Store copy separate from detailed review notes');
  assert.doesNotMatch(description, /local text, Markdown, structured text, HTML, DOCX, or text-based PDF/i);
  assert.doesNotMatch(description, /\b(?:DOCX|PDF|HTML|Markdown)\b/);
  for (const boundary of ['not a sandbox', 'Pause', 'Revoke', 'OpenAI', 'not guaranteed', 'separate local runtime',
    'may not stop detached programs', 'Revoke OpenAI conversation access and runtime keys separately']) {
    assert.ok(description.includes(boundary), `Missing concise disclosure: ${boundary}`);
  }
});

test('store Description includes the approved plain-text support contacts', () => {
  const text = fs.readFileSync(new URL('../docs/STORE-LISTING.en.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const description = text.split('## Description\n')[1]?.split('\n## Single Purpose')[0];
  assert.ok(description, 'Store description section missing');
  for (const contact of [
    'Email: zhentongye2028@u.northwestern.edu',
    'Open-source project: https://github.com/1235357/agent-continue',
    'Bug reports and suggestions: https://github.com/1235357/agent-continue/issues/new/choose',
    "Author's LinkedIn: https://www.linkedin.com/in/tony-zhentong-ye/",
  ]) assert.ok(description.includes(contact), `Missing plain-text description contact: ${contact}`);
  const version = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')).version;
  assert.ok(text.includes('**' + version + '**'));
  assert.match(text, /Actual availability and submission state require separate platform receipts/);
  assert.match(text, /Historical v2\.2\.1 is a separate scheduler-only release/);
  assert.match(text, /does not change a saved Store listing, submit a package, publish a release/);
});
