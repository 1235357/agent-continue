import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function splitTokens(line) {
  const tokens = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && (/\s/.test(ch) || (tokens.length === 1 && ch === '=' && !current))) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    if (tokens.length === 0 && ch === '=' && !inSingle && !inDouble) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function parseSshConfig(text) {
  if (typeof text !== 'string' || !text) return [];
  const entries = [];
  let active = null;
  let ignoreBlock = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const cleaned = stripComment(rawLine).trim();
    if (!cleaned) continue;
    const tokens = splitTokens(cleaned);
    if (tokens.length < 2) continue;
    const keyword = tokens[0].toLowerCase();
    const values = tokens.slice(1);

    if (keyword === 'match') {
      active = null;
      ignoreBlock = true;
      continue;
    }
    if (keyword === 'host') {
      const concrete = values.filter(alias => alias && !/[*?]|^!/.test(alias));
      if (!concrete.length) {
        active = null;
        ignoreBlock = true;
        continue;
      }
      ignoreBlock = false;
      active = {
        aliases: concrete,
        hostName: null,
        port: 22,
        user: null,
        hasIdentityFile: false,
        proxyJump: null,
        hasProxyCommand: false,
      };
      entries.push(active);
      continue;
    }
    if (ignoreBlock || !active) continue;
    const value = values.join(' ');
    if (keyword === 'hostname') active.hostName = values[0];
    else if (keyword === 'port') {
      const parsed = Number(values[0]);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) active.port = parsed;
    } else if (keyword === 'user') active.user = values[0];
    else if (keyword === 'identityfile') active.hasIdentityFile = Boolean(value);
    else if (keyword === 'proxyjump') active.proxyJump = value.toLowerCase() === 'none' ? null : value;
    else if (keyword === 'proxycommand') active.hasProxyCommand = value.toLowerCase() !== 'none';
  }

  const hosts = [];
  const seenAliases = new Set();
  for (const group of entries) {
    for (const alias of group.aliases) {
      if (seenAliases.has(alias)) continue;
      seenAliases.add(alias);
      hosts.push({
        alias,
        hostName: group.hostName || alias,
        port: group.port,
        user: group.user,
        hasIdentityFile: group.hasIdentityFile,
        hasProxyJump: Boolean(group.proxyJump),
        proxyJump: group.proxyJump,
        hasProxyCommand: group.hasProxyCommand,
      });
    }
  }
  return hosts;
}

export function detectSshExecutable({
  platform = process.platform,
  env = process.env,
  existsSync = fs.existsSync,
  runSync = spawnSync,
} = {}) {
  if (platform === 'win32') {
    const systemRoot = env.SystemRoot || 'C:\\Windows';
    const defaultExe = path.win32.join(systemRoot, 'System32', 'OpenSSH', 'ssh.exe');
    if (existsSync(defaultExe)) return { available: true, path: defaultExe };
    const lookup = runSync('where.exe', ['ssh'], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 3000,
    });
    if (lookup?.status === 0 && typeof lookup.stdout === 'string') {
      const first = lookup.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean);
      if (first) return { available: true, path: first };
    }
    return { available: false, path: null };
  }

  const lookup = runSync('which', ['ssh'], {
    encoding: 'utf8',
    shell: false,
    timeout: 3000,
  });
  if (lookup?.status === 0 && typeof lookup.stdout === 'string') {
    const first = lookup.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean);
    if (first) return { available: true, path: first };
  }
  return { available: false, path: null };
}

export function inspectEasyConnectVnic({
  platform = process.platform,
  env = process.env,
  runSync = spawnSync,
} = {}) {
  if (platform !== 'win32') {
    return { platform, inspectionAvailable: false, anyConnected: false, adapters: [] };
  }
  const systemRoot = env.SystemRoot || 'C:\\Windows';
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = '$items = @(Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.Name -like "*Sangfor*" -or $_.NetConnectionID -like "*EasyConnect*" } | Select-Object Name,NetConnectionID,NetConnectionStatus); $items | ConvertTo-Json -Compress';
  const res = runSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 5000,
  });
  if (res?.error || res?.status !== 0 || typeof res?.stdout !== 'string') {
    return { platform: 'win32', inspectionAvailable: false, anyConnected: false, adapters: [] };
  }
  const raw = res.stdout.trim();
  if (!raw) {
    return { platform: 'win32', inspectionAvailable: true, anyConnected: false, adapters: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const adapters = list.filter(Boolean).map(item => {
      const code = Number.isInteger(item.NetConnectionStatus) ? item.NetConnectionStatus : null;
      return {
        name: typeof item.Name === 'string' ? item.Name : null,
        netConnectionId: typeof item.NetConnectionID === 'string' ? item.NetConnectionID : null,
        netConnectionStatus: code,
        // WMI Win32_NetworkAdapter uses integer 2 for Connected (not string "Connected").
        connected: code === 2,
      };
    });
    return {
      platform: 'win32',
      inspectionAvailable: true,
      anyConnected: adapters.some(adapter => adapter.connected),
      adapters,
    };
  } catch {
    return { platform: 'win32', inspectionAvailable: false, anyConnected: false, adapters: [] };
  }
}

export function probeTcpPort(host, port, { timeoutMs = 1500, connect = net.createConnection } = {}) {
  if (typeof host !== 'string' || !host.trim() || /\s|[\x00-\x1f]/.test(host)
      || !Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve({ host: String(host ?? ''), port, reachable: false, latencyMs: null, reason: 'invalid_target' });
  }
  const started = Date.now();
  return new Promise(resolve => {
    let settled = false;
    let socket;
    const finish = (reachable, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.destroy(); } catch {}
      resolve({ host, port, reachable, latencyMs: Date.now() - started, reason });
    };
    const timer = setTimeout(() => finish(false, 'timeout'), timeoutMs);
    try {
      socket = connect({ host, port });
      socket.once('connect', () => finish(true, 'connected'));
      socket.once('error', error => {
        const code = error?.code === 'ECONNREFUSED' ? 'refused' : error?.code === 'ENOTFOUND' ? 'dns_not_found' : 'error';
        finish(false, code);
      });
    } catch {
      finish(false, 'error');
    }
  });
}

function lookupWindowsRouteAlias(ipv4, runSync = spawnSync) {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $routes = @(Find-NetRoute -RemoteIPAddress '${ipv4}' | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_NetRoute' }); if ($routes.Count -eq 1) { $routes[0].InterfaceAlias | ConvertTo-Json -Compress }`;
  try {
    const result = runSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', shell: false, windowsHide: true, timeout: 5000,
    });
    if (result?.error || result?.status !== 0 || typeof result.stdout !== 'string') return null;
    const alias = JSON.parse(result.stdout.trim());
    return typeof alias === 'string' && alias.trim() ? alias.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function runSshPreflight(options = {}) {
  const platform = options.platform ?? process.platform;
  const requireEasyConnect = options.requireEasyConnect === true;
  if (requireEasyConnect && (platform !== 'win32' || !net.isIPv4(options.targetHost))) {
    throw new Error('invalid_arguments');
  }
  const timeoutMs = options.timeoutMs ?? 1500;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 200 || timeoutMs > 10000) {
    throw new Error('invalid_arguments');
  }
  const sshConfigPath = options.sshConfigPath ?? path.join(os.homedir(), '.ssh', 'config');
  if (options.targetHost !== undefined) {
    if (typeof options.targetHost !== 'string' || !options.targetHost.trim() || /\s|[\x00-\x1f]/.test(options.targetHost)) {
      throw new Error('invalid_arguments');
    }
  }
  const targetPort = options.targetPort ?? 22;
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    throw new Error('invalid_arguments');
  }

  const checkSsh = options.checkSsh ?? detectSshExecutable;
  const checkVnic = options.checkVnic ?? inspectEasyConnectVnic;
  const probeFn = options.probeTcp ?? probeTcpPort;
  const readConfigFile = options.readFileSync ?? fs.readFileSync;
  const configExists = options.existsSync ?? fs.existsSync;

  const sshExecutable = checkSsh({ platform });
  const easyConnectVnic = checkVnic({ platform });

  let configPresent = false;
  let hosts = [];
  if (sshConfigPath && configExists(sshConfigPath)) {
    configPresent = true;
    try {
      hosts = parseSshConfig(readConfigFile(sshConfigPath, 'utf8'));
    } catch {
      hosts = [];
    }
  }

  const directEndpoints = [];
  const skippedHosts = [];
  const seenEndpoints = new Set();

  if (options.targetHost) {
    const key = `${options.targetHost}:${targetPort}`;
    seenEndpoints.add(key);
    directEndpoints.push({ alias: options.targetHost, host: options.targetHost, port: targetPort });
  } else {
    for (const item of hosts) {
      if (item.hasProxyJump || item.hasProxyCommand) {
        skippedHosts.push({
          alias: item.alias,
          host: item.hostName,
          port: item.port,
          reason: item.hasProxyJump ? 'uses-proxy-jump' : 'uses-proxy-command',
          ...(item.proxyJump ? { proxyJump: item.proxyJump } : {}),
        });
        continue;
      }
      const key = `${item.hostName}:${item.port}`;
      if (seenEndpoints.has(key)) continue;
      seenEndpoints.add(key);
      directEndpoints.push({ alias: item.alias, host: item.hostName, port: item.port });
    }
  }

  let routeBlocker;
  if (requireEasyConnect) {
    if (!easyConnectVnic.inspectionAvailable) {
      routeBlocker = 'easyconnect_route_unverified';
    } else if (!easyConnectVnic.anyConnected) {
      routeBlocker = 'easyconnect_vnic_disconnected';
    } else {
      const alias = lookupWindowsRouteAlias(options.targetHost, options.runRouteCommand);
      if (alias === null) {
        routeBlocker = 'easyconnect_route_unverified';
      } else if (!easyConnectVnic.adapters.some(adapter =>
        adapter.connected && adapter.netConnectionId?.trim().toLowerCase() === alias)) {
        routeBlocker = 'easyconnect_route_mismatch';
      }
    }
  }

  const probes = routeBlocker ? [] : await Promise.all(
    directEndpoints.map(async endpoint => {
      const outcome = await probeFn(endpoint.host, endpoint.port, { timeoutMs });
      return { alias: endpoint.alias, ...outcome };
    }),
  );

  const blockers = [];
  const recommendations = [];
  if (!sshExecutable.available) {
    blockers.push('ssh_executable_missing');
    recommendations.push('Install or enable the OpenSSH Client on Windows before running SSH commands.');
  }
  if (routeBlocker === 'easyconnect_vnic_disconnected' ||
      (easyConnectVnic.adapters.length > 0 && !easyConnectVnic.anyConnected)) {
    blockers.push('easyconnect_vnic_disconnected');
    recommendations.push('Complete interactive EasyConnect sign-in so the Sangfor/EasyConnect VNIC reports NetConnectionStatus === 2 before connecting to private LAN targets.');
  }
  if (routeBlocker && routeBlocker !== 'easyconnect_vnic_disconnected') {
    blockers.push(routeBlocker);
    recommendations.push('Confirm that Windows selects the connected EasyConnect adapter for this target before retrying; no TCP probe was sent.');
  }
  if (directEndpoints.length === 0) {
    if (skippedHosts.length > 0) {
      blockers.push('no_direct_ssh_targets');
      recommendations.push('This preflight does not test SSH proxy or jump routes. Verify these targets through their configured SSH route.');
    } else {
      blockers.push('no_ssh_targets_configured');
      recommendations.push('Add at least one Host stanza to ~/.ssh/config or pass --host and --port.');
    }
  }
  const unreachable = probes.filter(probe => !probe.reachable);
  if (unreachable.length > 0) {
    blockers.push('target_tcp_unreachable');
    recommendations.push(`Check EasyConnect VPN or network route for unreachable target(s): ${unreachable.map(p => `${p.host}:${p.port}`).join(', ')}.`);
  }

  return {
    ok: true,
    command: 'ssh-preflight',
    platform,
    sshExecutable,
    sshConfig: {
      present: configPresent,
      hostCount: hosts.length,
      hosts,
    },
    easyConnectVnic,
    probes,
    skippedHosts,
    summary: {
      readyForDirectSsh: blockers.length === 0 && probes.some(probe => probe.reachable === true),
      hostIdentityVerified: false,
      authenticationVerified: false,
      blockers,
      recommendations,
    },
  };
}
