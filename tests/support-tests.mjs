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
    format: 'agent-continue-activity', version: 3, extensionVersion: '2.1.0',
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
