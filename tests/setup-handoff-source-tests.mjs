import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSetupRequest, serializeSetupRequest, describeTarget } from '../setup-model.js';
import { resolveStatusView } from '../native/bootstrap/registration-status-view.mjs';
import { buildInstallPlan } from '../native/bootstrap/install-plan.mjs';

async function page() {
  const html = fs.readFileSync(new URL('../setup.html', import.meta.url), 'utf8');
  const nodes = new Map(), handlers = new Map(), localSteps = [{ hidden: false }, { hidden: false }];
  const effects = { writes: [], exports: [], permissionRequests: 0, nativeCalls: 0 };
  let language = 'en';
  const node = id => {
    if (id !== 'download') assert.ok(html.includes('id="' + id + '"'), 'Unknown setup element: ' + id);
    if (!nodes.has(id)) nodes.set(id, {
      value: '', checked: false, open: false, hidden: /Handoff(?:Link)?$/.test(id), textContent: '',
      addEventListener: (name, callback) => handlers.set(id + ':' + name, callback),
      close() { this.open = false; handlers.get(id + ':close')?.(); },
      showModal() { this.open = true; },
      click() { effects.exports.push({ name: this.download }); }, remove() {},
    });
    return nodes.get(id);
  };
  const source = fs.readFileSync(new URL('../setup.js', import.meta.url), 'utf8')
    .replace(/^import .+ from '.+';\r?$/gm, '');
  await vm.runInNewContext('(async () => {\n' + source + '\n})()', {
    buildSetupRequest, serializeSetupRequest, describeTarget, resolveStatusView, buildInstallPlan,
    createTranslator: catalog => text => language === 'en' ? catalog[text] ?? text : text,
    getLanguage: () => language, initializeLanguage: async () => language, subscribeLanguage() {},
    setLanguage: async value => { language = value; effects.writes.push({ uiLanguage: value }); },
    document: { getElementById: node, documentElement: {}, body: { append() {} },
      createElement: () => node('download'),
      querySelectorAll: selector => selector === '[data-local-bridge-step]' ? localSteps : [],
    },
    chrome: { runtime: { id: 'abcdefghijklmnopabcdefghijklmnop',
      sendNativeMessage() { effects.nativeCalls += 1; throw new Error('Forbidden native call'); } },
      permissions: { contains: async () => false, request() { effects.permissionRequests += 1; return false; } } },
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} }, Blob, TextEncoder,
    setTimeout: callback => callback(), addEventListener() {},
  });
  return { node, localSteps, effects, emit: (id, event, value = {}) => handlers.get(id + ':' + event)(value) };
}

test('default test:setup includes the setup handoff source and VM suite', () => {
  const metadata = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(metadata.scripts['test:setup'], /\bnode\s+--test\s+(?:[^&\r\n]+\s+)?tests\/setup-handoff-source-tests\.mjs\b/,
    'Default test:setup must execute the setup handoff source and VM suite');
});

test('remote Linux exposes its own source-plan handoff without a local bridge', async () => {
  const fixture = await page();
  fixture.node('target').value = 'linux-server';
  await fixture.emit('target', 'change');
  assert.equal(fixture.node('linuxHandoff').hidden, false);
  assert.equal(fixture.node('linuxHandoffLink').hidden, false);
  assert.equal(fixture.node('windowsHandoff').hidden, true);
  assert.equal(fixture.node('localControls').hidden, true);
  assert.ok(fixture.localSteps.every(step => step.hidden));
  assert.deepEqual(fixture.effects, { writes: [], exports: [], permissionRequests: 0, nativeCalls: 0 });
});

test('other targets never inherit remote-server handoff or consent', async () => {
  const fixture = await page();
  for (const target of ['', 'windows', 'macos', 'linux']) {
    fixture.node('target').value = target;
    await fixture.emit('target', 'change');
    assert.equal(fixture.node('linuxHandoff').hidden, true);
    assert.equal(fixture.node('linuxHandoffLink').hidden, true);
    assert.equal(fixture.node('downloadSetup').disabled, true);
    assert.equal(fixture.node('exportConsent').checked, false);
  }
});

test('Linux handoff keeps the closed request separate from device-local package inputs', async () => {
  const fixture = await page();
  fixture.node('target').value = 'linux-server';
  await fixture.emit('target', 'change');
  await fixture.emit('reviewSetup', 'click');
  const request = JSON.parse(fixture.node('request-preview').textContent);
  assert.deepEqual(request, buildSetupRequest('linux-server', 'abcdefghijklmnopabcdefghijklmnop'));
  assert.equal(request.nativeHost, null);
  assert.deepEqual(Object.keys(request), ['format', 'version', 'target', 'extensionId', 'nativeHost']);
  fixture.node('target').value = 'windows';
  await fixture.emit('target', 'change');
  assert.equal(fixture.node('setupReview').open, false);
  assert.equal(fixture.node('downloadSetup').disabled, true);
  assert.deepEqual(fixture.effects.exports, []);
});

test('handoff documents a read-only consumer, not an installer or an executable download', () => {
  const html = fs.readFileSync(new URL('../setup.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="linuxHandoff"'), 'Missing remote Linux handoff section');
  for (const term of ['setup_plan.py', '--request-file', '--package-root', '--manifest-sha256', 'readyToApply=false']) {
    assert.ok(html.includes(term), 'Missing bounded handoff detail: ' + term);
  }
  assert.doesNotMatch(html, /curl.+\|.+(?:bash|sh)|Invoke-Expression|powershell\.exe.*-EncodedCommand/i);
  const css = fs.readFileSync(new URL('../setup.css', import.meta.url), 'utf8');
  const rule = css.match(/\.handoff-command\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(rule, /white-space:\s*pre-wrap/, 'Wrap the example command on narrow screens');
  assert.match(rule, /overflow-wrap:\s*anywhere/, 'Long example paths must not overflow');
});

test('optional remote management is target-scoped without native calls or new request fields', async () => {
  const fixture = await page();
  for (const target of ['linux-server', '', 'windows', 'macos', 'linux', 'linux-server']) {
    fixture.node('target').value = target;
    await fixture.emit('target', 'change');
    assert.equal(fixture.node('remoteManagement').hidden, target !== 'linux-server');
  }
  await fixture.emit('reviewSetup', 'click');
  assert.deepEqual(Object.keys(JSON.parse(fixture.node('request-preview').textContent)),
    ['format', 'version', 'target', 'extensionId', 'nativeHost']);
  assert.deepEqual(fixture.effects, { writes: [], exports: [], permissionRequests: 0, nativeCalls: 0 });
});

test('remote boundary separates direct server traffic from optional local bridge and SSH in both languages', async () => {
  const fixture = await page();
  fixture.node('target').value = 'linux-server';
  await fixture.emit('target', 'change');
  assert.match(fixture.node('target-boundary').textContent, /directly on the server.*without a Windows relay.*optional.*local bridge.*SSH/i);
  await fixture.emit('language', 'change', { target: { value: 'zh_CN' } });
  assert.match(fixture.node('target-boundary').textContent, /工具数据不用桥接.*可选生命周期管理另需本机桥接和SSH/);
});

test('remote management documents trusted source enrollment and a selection-only device link', () => {
  const html = fs.readFileSync(new URL('../setup.html', import.meta.url), 'utf8');
  const section = html.match(/<section id="remoteManagement"[^>]*>[\s\S]*?<\/section>/)?.[0];
  assert.ok(section, 'Missing optional remote management guidance');
  assert.match(section, / hidden/);
  assert.match(section, /aria-labelledby="remote-management-title"/);
  for (const term of ['Optional remote management', 'directly to official OpenAI', 'pause and reconnect',
    'installed local native manager', 'nativeMessaging', 'independently verified SSH host keys', 'OS agent',
    'node /reviewed-bootstrap/bin.mjs enroll-ssh', '--install-dir', '--consent full-account',
    '--ssh-executable', '--host', '--port', '--user', '--remote-node', '--remote-install-dir',
    '--known-hosts', '--known-hosts-sha256', 'trusted local entry', 'not added to the browser request',
    'deviceUrl', 'selection only', 'not connected, authenticated or authorized',
    'no released installer or runnable public npx command', 'devices.html#access-title']) {
    assert.ok(section.includes(term), 'Missing remote-management boundary: ' + term);
  }
  assert.doesNotMatch(section, /<(?:input|textarea|button|iframe)\b|\bnpx\s+(?:--yes|@|agent-continue)/i);
});

test('remote management describes a distinct local manager setup without asking for a local runtime key', () => {
  const html = fs.readFileSync(new URL('../setup.html', import.meta.url), 'utf8');
  const section = html.match(/<section id="remoteManagement"[^>]*>[\s\S]*?<\/section>/)?.[0];
  for (const term of ['setup-manager', '--setup-request', 'local-platform request', 'not the linux-server request',
    'no local OpenAI runtime key', 'does not download a tunnel client', 'native registration remains separate']) {
    assert.ok(section.includes(term), 'Missing manager-only onboarding boundary: ' + term);
  }
  const script = fs.readFileSync(new URL('../setup.js', import.meta.url), 'utf8');
  assert.ok(script.includes('本机平台请求')); assert.ok(script.includes('不需要本机 OpenAI 运行密钥'));
  assert.doesNotMatch(section, /--runtime-key-file|--tunnel-id|<(?:input|textarea|button|iframe)\b/);
});

test('onboarding explains full account access and the separate upstream privacy boundary', () => {
  const html = fs.readFileSync(new URL('../setup.html', import.meta.url), 'utf8');
  for (const term of ['id="access-scope-title"', 'selected operating-system account',
    'administrator or root', 'does not grant', 'telemetry is enabled by default',
    'https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/PRIVACY.md']) {
    assert.ok(html.includes(term), 'Missing informed-onboarding detail: ' + term);
  }
});
