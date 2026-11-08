import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildActivityExport } from '../activity-export.js';
import { PACKAGE_FILES } from '../native/bootstrap/payload-layout.mjs';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const disclosureFiles = ['PRIVACY.md', 'README.md', 'README.zh-CN.md', 'docs/STORE-LISTING.en.md'];
const packageSource = read('scripts/package.py');
const packageFiles = JSON.parse(read('package.json')).files;

function literalTuple(name) {
  const body = packageSource.match(new RegExp(`^${name} = \\(([\\s\\S]*?)^\\)`, 'm'))?.[1];
  assert.ok(body, `Missing package tuple: ${name}`);
  return [...body.matchAll(/"([^"\n]+)"/g)].map(match => match[1]);
}

const extensionFiles = new Set([...literalTuple('RUNTIME_FILES'), ...literalTuple('PUBLIC_DOCS')]);
const bootstrapFiles = new Set(PACKAGE_FILES.map(name => 'native/bootstrap/' + name));
const npmContains = name => ['package.json', 'README.md', 'LICENSE'].includes(name) ||
  packageFiles.some(entry => entry.endsWith('/') ? name.startsWith(entry) : name === entry);

for (const name of disclosureFiles) {
  test(`${name} describes schema 4 without rewriting historical schema 3`, () => {
    const text = read(name);
    assert.ok(/schema 4/i.test(text), `${name} must describe the current schema 4`);
    for (const line of text.split(/\r?\n/)) {
      if (/schema 3|version: 3/i.test(line)) {
        assert.match(line, /v2\.2\.[01]|historical/i, 'Schema 3 must be explicitly historical');
      }
    }
  });
}

test('privacy disclosure names the actual default and opt-in report fields', () => {
  const policy = read('PRIVACY.md');
  for (const includeTimestamps of [false, true]) {
    const report = buildActivityExport({ logs: [{ at: 100, event: 'sent' }],
      extensionVersion: '3.0.0', now: 200, includeTimestamps });
    assert.equal(report.version, 4);
    for (const key of [...Object.keys(report), ...Object.keys(report.logs[0])]) {
      assert.ok(policy.includes('`' + key + '`') || policy.includes('`logs[].' + key + '`'),
        `Undisclosed report field: ${key}`);
    }
    assert.ok(policy.includes(report.format));
    assert.ok(policy.includes(report.timestampMode));
  }
  assert.match(policy, /relative.*(?:identify|activity)/i);
  assert.match(policy, /not.*guarantee anonymity/i);
});

test('privacy and listing disclose actual timing-probe fields and enums', () => {
  const policy = read('PRIVACY.md');
  const listing = read('docs/STORE-LISTING.en.md').split('## Detailed Review Reference (Not Store Copy)')[1].split('## Permission Justifications')[0];
  for (const kind of ['authorization', 'page-timers']) {
    for (const status of ['result', 'invalid-result', 'api-rejected', 'watchdog-expired']) {
      const report = buildActivityExport({ now: 200, extensionVersion: '3.0.0', logs: [{ at: 100,
        event: 'timing-diagnostics', diagnostic: { code: 'timing-probe', kind, status,
          durationMs: 120001, firstMs: -1, hidden: true, ok: false, allowed: false } }] });
      const detail = report.logs[0].diagnostic;
      assert.equal(detail.durationMs, 120000);
      assert.equal(detail.firstMs, 0);
      for (const key of Object.keys(detail)) {
        assert.ok(policy.includes('`' + key + '`'), `Undisclosed timing field: ${key}`);
        assert.ok(listing.includes(key), `Missing Store timing field: ${key}`);
      }
      for (const value of [detail.code, detail.kind, detail.status]) {
        assert.ok(policy.includes('`' + value + '`'), `Undisclosed timing enum: ${value}`);
      }
    }
  }
  for (const name of ['README.md', 'README.zh-CN.md']) {
    const text = read(name);
    for (const field of ['timing-probe', 'kind', 'status', 'durationMs', 'firstMs', 'hidden', 'ok', 'allowed']) {
      assert.ok(text.includes(field), `${name} omits timing metadata: ${field}`);
    }
  }
});

const contexts = [
  ['README.md', 'extension ZIP', name => extensionFiles.has(name)],
  ['README.md', 'root npm package', npmContains],
  ['README.zh-CN.md', 'extension ZIP', name => extensionFiles.has(name)],
  ['PRIVACY.md', 'extension ZIP', name => extensionFiles.has(name)],
  ['docs/STORE-LISTING.en.md', 'extension ZIP', name => extensionFiles.has(name)],
  ['native/bootstrap/README.md', 'bootstrap source package', name => bootstrapFiles.has(name)],
];

for (const [name, context, contains] of contexts) {
  test(`${name} has no missing relative file links in the ${context}`, () => {
    const text = read(name);
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const destination = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(destination)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), destination.split(/[?#]/)[0]));
      const line = text.slice(0, match.index).split('\n').length;
      assert.ok(contains(target), `${name}:${line}: ${target} is absent from the ${context}; use a public repository URL`);
    }
  });
}

test('bootstrap documentation makes command-only setup primary and retires custom launchers', () => {
  const text = read('native/bootstrap/README.md');
  const overview = text.slice(0, text.indexOf('Build a reviewable package directory'));
  assert.ok(/\[Windows command installation\]\(#windows-command-installation\)/.test(overview),
    'The overview must link directly to Windows command installation');
  assert.ok(/command-only/i.test(overview), 'The overview must identify command-only delivery');
  const retired = text.split('## Retired Custom Launcher Source')[1];
  assert.ok(retired, 'Legacy launcher sources need a clearly retired section');
  assert.match(retired, /not.*(?:supported|installation route)/i);
  assert.doesNotMatch(text, /Add `-PrepareNative`|add \*\*both\*\* `-PrepareNative -RegisterNative`/);
  assert.doesNotMatch(text, /The package also includes `Build-NativeLauncher\.ps1`/);
});
