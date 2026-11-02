import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pin = JSON.parse(fs.readFileSync(new URL('./upstream-pin.json', import.meta.url), 'utf8'));
const consentBytes = JSON.stringify({
  format: 'agent-continue-native-consent', version: 1,
  provider: pin.name, providerVersion: pin.version, scope: 'full-account',
  protectedInstallationVerified: false, activated: false,
}) + '\n';
const policy = Object.freeze({
  telemetryEnabled: false, allowedDirectories: [], blockedCommands: [],
  welcomeOnboardingEligible: false, pendingWelcomeOnboarding: false,
});

function fail(code) { throw new Error(code); }

// This is a current-user development helper, not a privileged no-race installer.
function checkedPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') ||
      value.startsWith('\\\\') || value.startsWith('//')) fail('invalid_state_path');
  value = path.resolve(value);
  const parsed = path.parse(value);
  let current = parsed.root;
  for (const part of value.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('redirected_state');
  }
  return value;
}

function readSmall(file, code) {
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) fail(code);
    return fs.readFileSync(file, 'utf8');
  } catch { fail(code); }
}

export function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('configuration_changed');
  for (const [name, expected] of Object.entries(policy)) {
    const value = config[name];
    if (Array.isArray(expected) ? !Array.isArray(value) || value.length !== 0 : value !== expected) {
      fail('configuration_changed');
    }
  }
}

export function prepareState(root, options) {
  if (options?.consent !== 'full-account') fail('consent_required');
  root = checkedPath(root);
  if (fs.existsSync(root)) fail('state_exists');
  fs.mkdirSync(root, { mode: 0o700 });
  for (const dir of ['home', 'work', 'temp', 'home/.claude-server-commander',
    'home/AppData', 'home/AppData/Roaming', 'home/AppData/Local']) {
    fs.mkdirSync(path.join(root, dir), { mode: 0o700 });
  }
  fs.writeFileSync(path.join(root, 'home', '.claude-server-commander', 'config.json'),
    JSON.stringify({ ...policy, fileReadLineLimit: 1000, fileWriteLineLimit: 50 }) + '\n',
    { flag: 'wx', mode: 0o600 });
  // Publish the consent receipt last. Partial preparation is not silently repaired.
  fs.writeFileSync(path.join(root, 'consent.json'), consentBytes, { flag: 'wx', mode: 0o600 });
  return { prepared: true, activated: false, protectedInstallationVerified: false };
}

export function readState(root) {
  root = checkedPath(root);
  if (readSmall(path.join(root, 'consent.json'), 'invalid_consent') !== consentBytes) fail('invalid_consent');
  for (const dir of ['home', 'work', 'temp', 'home/.claude-server-commander',
    'home/AppData/Roaming', 'home/AppData/Local']) {
    const name = checkedPath(path.join(root, dir));
    if (!fs.statSync(name).isDirectory()) fail('invalid_state');
  }
  const configFile = path.join(root, 'home', '.claude-server-commander', 'config.json');
  let config;
  try { config = JSON.parse(readSmall(configFile, 'configuration_changed')); }
  catch { fail('configuration_changed'); }
  validateConfig(config);
  return { root, config, configFile };
}

export function buildHostLaunch(root, parentEnv = process.env) {
  root = readState(root).root;
  const env = {};
  // The tool process gets the device environment, but not tunnel/admin keys or Node preloads.
  for (const [key, value] of Object.entries(parentEnv)) {
    if (/^(NODE_OPTIONS|NODE_PATH|NODE_REPL_EXTERNAL_MODULE|CONTROL_PLANE_.*|TUNNEL_.*|OPENAI_.*|DC_.*|DESKTOP_COMMANDER_.*)$/i.test(key)) continue;
    if (/^(HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|UV_THREADPOOL_SIZE)$/i.test(key)) continue;
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, {
    HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'),
    APPDATA: path.join(root, 'home', 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(root, 'home', 'AppData', 'Local'),
    TEMP: path.join(root, 'temp'), TMP: path.join(root, 'temp'), TMPDIR: path.join(root, 'temp'),
    DESKTOP_COMMANDER_DISABLE_TELEMETRY: '1', UV_THREADPOOL_SIZE: '16',
  });
  return { command: process.execPath, args: [path.join(here, 'host.mjs'), '--state-dir', root],
    cwd: path.join(root, 'work'), env, windowsHide: true };
}

export function verifyUpstream() {
  const root = path.join(here, 'node_modules', '@wonderwhy-er', 'desktop-commander');
  const names = ['package.json'];
  function scan(relative) {
    const dir = path.join(root, relative);
    if (fs.lstatSync(dir).isSymbolicLink()) fail('upstream_pin_mismatch');
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = relative + '/' + entry.name;
      if (entry.isDirectory()) scan(name);
      else if (entry.isFile()) names.push(name);
      else fail('upstream_pin_mismatch');
    }
  }
  try {
    scan('dist');
    const records = names.sort().map(name => {
      const file = path.join(root, name);
      if (fs.lstatSync(file).isSymbolicLink()) fail('upstream_pin_mismatch');
      const bytes = fs.readFileSync(file);
      return [name, bytes.length, crypto.createHash('sha256').update(bytes).digest('hex')];
    });
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const tree = crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex');
    if (meta.name !== pin.name || meta.version !== pin.version || records.length !== pin.files || tree !== pin.treeSha256) {
      fail('upstream_pin_mismatch');
    }
    return { version: meta.version, verifiedFiles: records.length };
  } catch { fail('upstream_pin_mismatch'); }
}
