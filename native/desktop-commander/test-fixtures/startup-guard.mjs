// Test instrumentation only. This is not a sandbox for the full-account runtime.
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const report = process.env.AGENT_CONTINUE_TEST_GUARD_LOG;
function record(event) { fs.appendFileSync(report, event + '\n'); }
function denied() { record('network-attempt'); throw new Error('test_network_forbidden'); }
globalThis.fetch = denied;
net.Socket.prototype.connect = denied;
net.connect = net.createConnection = denied;
tls.connect = denied;
http.request = http.get = https.request = https.get = denied;
dns.lookup = dns.resolve = denied;
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) {
  const original = cp[name];
  cp[name] = function (...args) {
    if (/chrome|msedge|firefox|xdg-open|explorer|rundll32/i.test(String(args[0]))) {
      record('browser-attempt');
      throw new Error('test_browser_forbidden');
    }
    const options = args.find(arg => arg && typeof arg === 'object' && !Array.isArray(arg));
    if (process.platform === 'win32' && options?.windowsHide !== true) {
      record('visible-child-attempt');
      throw new Error('test_visible_child_forbidden');
    }
    record('hidden-child');
    return Reflect.apply(original, this, args);
  };
}
syncBuiltinESMExports();
record('guard-loaded');
process.once('exit', () => record('guard-exit'));
