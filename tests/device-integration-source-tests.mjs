import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('device access is optional and does not expose a website-to-native API', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(manifest.optional_permissions.includes('nativeMessaging'));
  assert.equal(manifest.permissions.includes('nativeMessaging'), false);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*']);
  for (const script of ['content.js', 'background.js', 'adapter.js']) {
    assert.equal(/sendNativeMessage|connectNative/.test(read(script)), false, script);
  }
});

test('local device page is linked without changing the four scheduler panels', () => {
  const html = read('popup.html');
  assert.match(html, /<button[^>]+id="setupWindows"[^>]*>/);
  assert.match(html, /<button[^>]+id="manageDevices"[^>]*>/);
  const popup = read('popup.js');
  assert.match(popup, /\['setupWindows', 'setup\.html'\]/);
  assert.match(popup, /\['manageDevices', 'devices\.html\?mode=browser-managed'\]/);
  assert.match(popup, /openExtensionPage\(chrome\.runtime\.getURL\(resource\)\)/);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 4);
  assert.match(read('i18n-html.js'), /'设备管理': 'Manage devices'/);
  assert.equal(read('devices.html').includes('https://chatgpt.com/'), false);
});

test('candidate device resources are explicit packaging inputs, not a recursive code scan', () => {
  const packager = read('scripts/package.py');
  for (const name of ['devices.html', 'devices.css', 'devices.js', 'device-control.js']) {
    assert.ok(packager.includes(`"${name}"`), name);
    assert.ok(read(name).length > 0);
  }
  assert.equal(packager.includes('native-host.json'), false);
  assert.equal(packager.includes('device-native-install.json'), false);
});

test('setup handoff stays separate from permissions, scheduling and native control and is packaged explicitly', () => {
  const packager = read('scripts/package.py');
  for (const name of ['setup.html', 'setup.css', 'setup.js', 'setup-model.js']) {
    assert.ok(packager.includes(`"${name}"`), `Missing setup resource: ${name}`);
  }
  assert.match(read('devices.html'), /href="setup\.html"/);
  // Setup may use the shared decoder, but may only ask for a read-only status.
  const setup = read('setup.js');
  assert.match(setup, /import \{ controlDevice \} from '\.\/device-control\.js'/);
  assert.deepEqual([...setup.matchAll(/\bcontrolDevice\(([^\n]*)\)/g)].map(match => match[1]),
    ["runtime, 'status', undefined, 5000"]);
  assert.doesNotMatch(setup, /requestPermission|permissions\?*\.request|\b(?:sendNativeMessage|connectNative)\s*\(|chrome\.tabs|fetch\(|chrome\.downloads|window\.open/);
  const html = read('setup.html');
  assert.deepEqual([...html.matchAll(/<iframe\s+([^>]+)/g)].map(row => row[1]),
    ['id="localControlFrame" title="Agent Continue local transport" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" hidden']);
  assert.deepEqual([...html.matchAll(/<form\s+id="([^"]+)"/g)].map(row => row[1]), ['localControlForm']);
  assert.doesNotMatch(html, /rel="prefetch"|<form[^>]+action=|<input[^>]+name=/);
  assert.equal(JSON.parse(read('manifest.json')).permissions.includes('downloads'), false);
});
