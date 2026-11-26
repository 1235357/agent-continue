import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  parseSshConfig,
  detectSshExecutable,
  inspectEasyConnectVnic,
  probeTcpPort,
  runSshPreflight,
} from './ssh-preflight.mjs';
import { main } from './bin.mjs';

test('parseSshConfig extracts concrete hosts, skips wildcards, and flags ProxyJump targets', () => {
  const sample = `
# Global defaults
Host *
  ServerAliveInterval 60

Host bastion-gw
  HostName 10.1.2.3
  Port 2222
  User alice
  IdentityFile ~/.ssh/id_ed25519

Host gpu-worker # comment
  HostName 192.168.51.18
  User bob
  ProxyJump bastion-gw
`;
  const hosts = parseSshConfig(sample);
  assert.equal(hosts.length, 2);
  assert.deepEqual(hosts[0], {
    alias: 'bastion-gw',
    hostName: '10.1.2.3',
    port: 2222,
    user: 'alice',
    hasIdentityFile: true,
    hasProxyJump: false,
    proxyJump: null,
    hasProxyCommand: false,
  });
  assert.deepEqual(hosts[1], {
    alias: 'gpu-worker',
    hostName: '192.168.51.18',
    port: 22,
    user: 'bob',
    hasIdentityFile: false,
    hasProxyJump: true,
    proxyJump: 'bastion-gw',
    hasProxyCommand: false,
  });
});

test('inspectEasyConnectVnic uses numeric WMI NetConnectionStatus === 2', () => {
  const disconnected = inspectEasyConnectVnic({
    platform: 'win32',
    runSync: () => ({
      status: 0,
      stdout: JSON.stringify({
        Name: 'Sangfor SSL VNIC',
        NetConnectionID: 'Ethernet 6',
        NetConnectionStatus: 7,
      }),
    }),
  });
  assert.equal(disconnected.inspectionAvailable, true);
  assert.equal(disconnected.anyConnected, false);
  assert.equal(disconnected.adapters[0].connected, false);
  assert.equal(disconnected.adapters[0].netConnectionStatus, 7);

  const connected = inspectEasyConnectVnic({
    platform: 'win32',
    runSync: () => ({
      status: 0,
      stdout: JSON.stringify([
        { Name: 'Sangfor SSL VNIC', NetConnectionID: 'Ethernet 6', NetConnectionStatus: 2 },
      ]),
    }),
  });
  assert.equal(connected.anyConnected, true);
  assert.equal(connected.adapters[0].connected, true);
});

test('probeTcpPort succeeds against a real ephemeral loopback listener and fails cleanly when closed', async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const up = await probeTcpPort('127.0.0.1', port, { timeoutMs: 1000 });
    assert.equal(up.reachable, true);
    assert.equal(up.reason, 'connected');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const down = await probeTcpPort('127.0.0.1', port, { timeoutMs: 500 });
  assert.equal(down.reachable, false);
  assert.notEqual(down.reason, 'connected');
});

test('runSshPreflight skips ProxyJump targets from direct TCP probes and reports disconnected EasyConnect VNIC blockers', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-ssh-preflight-'));
  const sshCfg = path.join(tempDir, 'config');
  fs.writeFileSync(sshCfg, `
Host bastion
  HostName 10.33.112.141
  User zye
  IdentityFile ~/.ssh/id_ed25519

Host cluster-node
  HostName 192.168.51.18
  ProxyJump bastion
`);
  const probed = [];
  try {
    const report = await runSshPreflight({
      platform: 'win32',
      sshConfigPath: sshCfg,
      timeoutMs: 800,
      checkSsh: () => ({ available: true, path: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' }),
      checkVnic: () => ({
        platform: 'win32',
        inspectionAvailable: true,
        anyConnected: false,
        adapters: [{ name: 'Sangfor SSL VNIC', netConnectionId: 'Ethernet 6', netConnectionStatus: 7, connected: false }],
      }),
      probeTcp: async (host, port) => {
        probed.push(`${host}:${port}`);
        return { host, port, reachable: false, latencyMs: 800, reason: 'timeout' };
      },
    });
    assert.deepEqual(probed, ['10.33.112.141:22']);
    assert.equal(report.skippedHosts.length, 1);
    assert.equal(report.skippedHosts[0].reason, 'uses-proxy-jump');
    assert.equal(report.summary.readyForDirectSsh, false);
    assert.ok(report.summary.blockers.includes('easyconnect_vnic_disconnected'));
    assert.ok(report.summary.blockers.includes('target_tcp_unreachable'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('bin main rejects invalid ssh-preflight arguments', async () => {
  await assert.rejects(main(['ssh-preflight', '--timeout-ms', '50']), /invalid_arguments/);
  await assert.rejects(main(['ssh-preflight', '--port', '22']), /invalid_arguments/);
  await assert.rejects(main(['ssh-preflight', '--unknown', 'x']), /invalid_arguments/);
  const help = await main(['help']);
  assert.ok(help.commands.includes('ssh-preflight'));
});

test('detectSshExecutable handles POSIX and Windows cleanly', () => {
  const win = detectSshExecutable({
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
    existsSync: target => target === 'C:\\Windows\\System32\\OpenSSH\\ssh.exe',
  });
  assert.deepEqual(win, { available: true, path: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' });
});
