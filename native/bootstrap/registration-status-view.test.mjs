import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  STATUS_FORMAT, BINDING_STATES, REGISTERED_STATES, buildStatusView,
  buildUnknownStatusView, resolveStatusView,
} from './registration-status-view.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const ROW_IDS = ['install-root', 'installed', 'binding', 'registered', 'host-startable'];
const CLAIMS = /隧道可用|隧道已就绪|已授权|授权成功|握手成功|连接成功|tunnel is (?:live|ready)|authorized|handshake succeeded/;

function status(overrides = {}) {
  return {
    format: STATUS_FORMAT, version: 1, root: 'C:\\AgentContinue', installed: true,
    binding: 'present', registered: 'registered', hostStartable: true,
    failed: 0, counts: { pass: 13, fail: 0, skip: 0 }, ...overrides,
  };
}

test('renders the five install facts from a valid status payload', () => {
  const view = buildStatusView(status());
  assert.equal(view.unknown, false);
  assert.equal(view.language, 'zh_CN');
  assert.deepEqual(view.rows.map(row => row.id), ROW_IDS);
  for (const row of view.rows) {
    assert.equal(typeof row.label, 'string');
    assert.ok(row.label.length > 0);
    assert.equal(typeof row.value, 'string');
    assert.ok(row.value.length > 0);
  }
  assert.equal(view.rows[0].value, 'C:\\AgentContinue');
  assert.match(view.rows[1].value, /^(是|否)$/);
  assert.match(view.rows[2].value, /^(存在|缺失|无效)$/);
  assert.match(view.rows[4].value, /^(是|否)$/);
  for (const line of ['安装根', '已安装', '绑定文件', '注册状态', '主机可启动']) {
    assert.ok(view.text.includes(line), `text carries the ${line} label`);
  }
  assert.match(view.note, /不代表|不证明/);
  assert.equal(view.counts.pass, 13);
  assert.equal(view.failed, 0);
});

test('renders a distinct and non-misleading line for each registered state', () => {
  const markers = {
    'not-registered': '没有任何注册表键',
    registered: '两个',
    drift: '不一致',
    error: '查询出错',
    unknown: '无法查询',
  };
  const seen = new Set();
  for (const registered of REGISTERED_STATES) {
    const view = buildStatusView(status({ registered }));
    const row = view.rows[3];
    assert.equal(row.id, 'registered');
    assert.ok(row.detail.includes(markers[registered]), `${registered} has its own wording`);
    assert.ok(!seen.has(row.detail), `${registered} wording is unique`);
    seen.add(row.detail);
    assert.doesNotMatch(view.text, CLAIMS);
    assert.match(view.text, /注册状态/);
  }
});

test('rejects missing fields, extra fields and mistyped fields', () => {
  assert.throws(() => buildStatusView({ ...status(), failed: undefined }), /invalid_status_input/);
  const extra = status();
  extra.execute = true;
  assert.throws(() => buildStatusView(extra), /invalid_status_input/);
  assert.throws(() => buildStatusView(status({ installed: 'yes' })), /invalid_status_input/);
  assert.throws(() => buildStatusView(status({ registered: 'REGISTERED' })), /invalid_status_input/);
  assert.throws(() => buildStatusView(status({ binding: 'ok' })), /invalid_status_input/);
  assert.throws(() => buildStatusView(status({ counts: [13, 0, 0] })), /invalid_status_input/);
  assert.throws(() => buildStatusView(status({ counts: { pass: 13, fail: 0, skip: 0, extra: 1 } })), /invalid_status_input/);
  assert.throws(() => buildStatusView(status({ version: 2 })), /invalid_status_input/);
  assert.throws(() => buildStatusView(null), /invalid_status_input/);
  assert.throws(() => buildStatusView(status({ registered: 'unknown' }), { language: 'fr' }), /invalid_status_input/);
});

test('shows the unknown state instead of clearing or faking success', async () => {
  const cases = [
    ['fetch-failed', async () => { throw new Error('bridge unavailable'); }],
    ['timeout', () => new Promise(() => {})],
    ['exit-nonzero', async () => ({ exitCode: 1, stdout: '' })],
    ['invalid-output', async () => ({ exitCode: 0, stdout: '{not json' })],
  ];
  for (const [expected, fetcher] of cases) {
    const view = await resolveStatusView(fetcher, { timeoutMs: 50 });
    assert.equal(view.unknown, true, `${expected} is unknown`);
    assert.equal(view.reason, expected);
    assert.equal(view.language, 'zh_CN');
    assert.deepEqual(view.rows.map(row => row.id), ROW_IDS);
    for (const row of view.rows) {
      assert.equal(row.value, '未知', `${expected} row ${row.id} is unknown`);
    }
    assert.match(view.text, /状态未知/, `${expected} says unknown`);
    assert.match(view.text, /安装根|已安装|绑定文件|注册状态|主机可启动/);
    assert.doesNotMatch(view.text, CLAIMS);
    assert.doesNotMatch(view.text, /已注册|已安装成功|可用/);
    assert.equal(view.counts.pass, 0);
    assert.equal(view.failed, 0);
  }
});

test('unknown view keeps a reason and never fabricates counts', () => {
  const view = buildUnknownStatusView('invalid-output');
  assert.equal(view.unknown, true);
  assert.equal(view.reason, 'invalid-output');
  assert.match(view.text, /状态未知/);
  const english = buildUnknownStatusView('timeout', { language: 'en' });
  assert.equal(english.language, 'en');
  assert.match(english.text, /unknown/i);
  assert.match(english.language === 'en' ? english.note : '', /not proof/i);
  assert.throws(() => buildUnknownStatusView('made-up'), /invalid_unknown_reason/);
});

test('resolves a valid envelope exactly once with read-only arguments', async () => {
  const calls = [];
  const view = await resolveStatusView(payload => {
    calls.push(payload);
    return { exitCode: 0, stdout: JSON.stringify(status()) + '\n' };
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]), ['timeoutMs']);
  assert.equal(view.unknown, false);
  assert.equal(view.rows[0].value, 'C:\\AgentContinue');
  const english = await resolveStatusView(() => ({ exitCode: 0, stdout: JSON.stringify(status()) }), { language: 'en' });
  assert.equal(english.rows[0].label, 'install root');
  assert.match(english.note, /not proof/i);
});

test('the page path stays write-free', async () => {
  const view = await fs.readFile(path.join(here, 'registration-status-view.mjs'), 'utf8');
  for (const forbidden of [/reg add/i, /execute\s*:\s*true/, /child_process/, /spawn\s*\(/, /exec\s*\(/]) {
    assert.doesNotMatch(view, forbidden);
  }
  const page = await fs.readFile(path.join(repo, 'setup.js'), 'utf8');
  for (const forbidden of [/reg add/i, /execute\s*:\s*true/, /child_process/, /spawn\s*\(/]) {
    assert.doesNotMatch(page, forbidden);
  }
  assert.match(page, /registration-status-view\.mjs/);
});
