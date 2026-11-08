import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const url = new URL('../setup-model.js', import.meta.url);
const api = fs.existsSync(url) ? await import(url.href) : null;
const check = (name, run) => test(name, { skip: !api }, run);
const extensionId = 'jpioilmpbolfokedaefmbfbjeaahfdkl';
check('embedded controls accept only an explicit canonical IPv4 loopback origin', () => {
  assert.equal(api.buildLocalControlFrameUrl(' http://127.0.0.1:52817/ '), 'http://127.0.0.1:52817/embed');
  for (const input of ['https://127.0.0.1:52817', 'http://localhost:52817', 'http://127.1:52817', 'http://[::1]:52817',
    'http://127.0.0.1:80', 'http://127.0.0.1:65536', 'http://127.0.0.1:052817', 'http://u@127.0.0.1:52817',
    'http://127.0.0.1:52817/?key=x', 'http://127.0.0.1:52817/#token', 'http://127.0.0.1:52817//', 'https://attacker.invalid', null]) {
    assert.throws(() => api.buildLocalControlFrameUrl(input));
  }
});
check('pairing ticket binds only a canonical port and keeps its code out of the destination', () => {
  const code = 'A'.repeat(43);
  const ticket = port => `ACPAIR1:${port}:${code}`;
  for (const port of [1024, 52817, 65535]) {
    assert.deepEqual(api.parseLocalPairingTicket(ticket(port)), { destination: `http://127.0.0.1:${port}/embed`, code });
  }
  for (const invalid of [null, ticket(1023), ticket(65536), ticket('052817'), ticket('host.invalid:52817'),
    ticket('127.0.0.1:52817'), ticket('0x1234'), ticket(52817) + '?extra=1', ticket(52817) + '\n',
    ' ' + ticket(52817), ticket(52817).slice(0, -1), ticket(52817) + 'B', ticket(52817).replace('ACPAIR1', 'ACPAIR2')]) {
    assert.throws(() => api.parseLocalPairingTicket(invalid), /Invalid local pairing ticket/);
  }
});
test('setup handoff implementation exists', () => assert.ok(api));
check('an explicit valid target and actual extension ID produce only closed metadata', () => {
  for (const target of ['windows', 'macos', 'linux', 'linux-server']) {
    const request = api.buildSetupRequest(target, extensionId);
    assert.deepEqual(request, {
      format: 'agent-continue-device-setup', version: 1, target, extensionId,
      nativeHost: target === 'linux-server' ? null : 'com.agentcontinue.device_control',
    });
    assert.equal(Object.isFrozen(request), true);
    assert.deepEqual(JSON.parse(JSON.stringify(request)), request);
  }
});
check('missing or invented targets and noncanonical extension identities refuse export', () => {
  for (const target of [null, '', 'auto', 'win32', 'https://chatgpt.com/', '../windows', 'Windows']) {
    assert.throws(() => api.buildSetupRequest(target, extensionId));
  }
  for (const id of [undefined, null, '', 'a'.repeat(31), 'A'.repeat(32), 'q'.repeat(32), extensionId + '\n', ['a'.repeat(32)]]) {
    assert.throws(() => api.buildSetupRequest('windows', id));
  }
});
check('formatting is deterministic, content-free and contains no execution or authorization flags', () => {
  const request = api.buildSetupRequest('windows', extensionId);
  const one = api.serializeSetupRequest(request);
  assert.equal(one, JSON.stringify(request, null, 2) + '\n');
  assert.equal(api.serializeSetupRequest(request), one);
  assert.doesNotMatch(one, /api.key|password|runtime.key|script|command|powershell|administrator|approved|consent|userSid|hostname|timestamp|path|token/i);
  for (const changed of [{...request, approved: true}, {...request, version: '1'}, {...request, nativeHost: '*'},
    {...request, target: 'linux-server'}, {...request, extensionId: extensionId.toUpperCase()}, [request], null]) {
    assert.throws(() => api.serializeSetupRequest(changed));
  }
});
check('target availability is honest and remote Linux has no local native-control route', () => {
  assert.equal(api.describeTarget('windows').availability, 'source-candidate');
  assert.equal(api.describeTarget('linux').availability, 'source-kit');
  assert.equal(api.describeTarget('linux-server').availability, 'source-kit');
  assert.equal(api.describeTarget('macos').availability, 'not-implemented');
  for (const target of ['windows', 'macos', 'linux', 'linux-server']) {
    const descriptor = api.describeTarget(target);
    assert.equal(descriptor.installerReleased, false);
    assert.equal(descriptor.installationVerified, false);
    assert.equal(descriptor.chatAuthorizationVerified, false);
  }
  assert.equal(api.describeTarget('linux-server').usesBrowserNativeBridge, false);
  assert.throws(() => api.describeTarget('unknown'));
});
check('handoff helpers perform no extension, browser, network, storage or shell operations', () => {
  const source = fs.readFileSync(url, 'utf8');
  assert.doesNotMatch(source, /chrome\.|navigator\.|localStorage|fetch\(|XMLHttpRequest|sendNativeMessage|connectNative|child_process|Date\.|process\./);
  assert.doesNotMatch(source, /https?:\/\/(?!127\.0\.0\.1:)/);
});
