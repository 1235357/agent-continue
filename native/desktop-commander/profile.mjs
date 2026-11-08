import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readState, buildHostLaunch, verifyUpstream } from './runtime.mjs';

const pins = JSON.parse(fs.readFileSync(new URL('./tunnel-pins.json', import.meta.url), 'utf8'));
const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const serialize = value => JSON.stringify(value, null, 2) + '\n';
const fail = code => { throw new Error(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function localPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value) ||
      value.startsWith('\\\\') || value.startsWith('//')) fail('invalid_profile_input');
  const resolved = path.resolve(value), parsed = path.parse(resolved);
  let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    if (process.platform === 'win32' && part.includes(':')) fail('invalid_profile_input');
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('redirected_profile_input');
  }
  return resolved;
}

function profileInputs(options) {
  if ((!exact(options, ['tunnelId', 'runtimeKeyFile']) && !exact(options, ['tunnelId', 'runtimeKeyFile', 'privateRuntime'])) ||
      (Object.hasOwn(options,'privateRuntime') && typeof options.privateRuntime!=='boolean') ||
      (options.privateRuntime===true && process.platform!=='win32') || typeof options.tunnelId !== 'string' ||
      !/^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/.test(options.tunnelId)) fail('invalid_profile_input');
  return { tunnelId: options.tunnelId, runtimeKeyFile: localPath(options.runtimeKeyFile),
    ...(options.privateRuntime===true ? {privateRuntime:true} : {}) };
}

function entryExists(file) {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function rejectReservedKeyLocation(root, file) {
  const canonical = value => {
    const resolved = fs.existsSync(value) ? fs.realpathSync(value) : path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const key = canonical(file);
  for (const reserved of [root, sourceRoot]) {
    const relative = path.relative(canonical(reserved), key);
    if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
      fail('overlapping_profile_inputs');
    }
  }
}

function rejectClientOverlap(key, executable) {
  const a = fs.lstatSync(key, { bigint: true }), b = fs.lstatSync(localPath(executable), { bigint: true });
  if (a.ino === 0n || b.ino === 0n || (a.dev === b.dev && a.ino === b.ino)) fail('overlapping_profile_inputs');
}

function quote(value) {
  if (/["\r\n\0]/.test(value)) fail('invalid_profile_input');
  // tunnel-client parses argv directly, not through a shell. Its double-quote
  // parser accepts forward slashes on Windows without consuming path separators.
  return '"' + (process.platform === 'win32' ? value.replaceAll('\\', '/') : value.replaceAll('\\', '\\\\')) + '"';
}

function profileDocument(root, { tunnelId, runtimeKeyFile }, argv) {
  return {
    config_version: 1,
    control_plane: { base_url: 'https://api.openai.com', tunnel_id: tunnelId, api_key: 'file:' + runtimeKeyFile },
    health: { listen_addr: '127.0.0.1:0', url_file: path.join(root, 'health.url') },
    admin_ui: { open_browser: false },
    log: { level: 'warn', format: 'json', file: path.join(root, 'native-tunnel.log'), http_raw_unsafe: false },
    mcp: { commands: [{ channel: 'main', command: argv.map(quote).join(' ') }], stdio_failure_policy: 'exit' },
  };
}

// Rendering alone grants no authority. The elevated owner must verify the sealed
// bundle and state, protect the key, and supply the stager's clean environment.
export function createSealedWindowsProfileDocument(options) {
  if (process.platform !== 'win32' || !exact(options, ['bundleRoot', 'tunnelId']) ||
      typeof options.bundleRoot !== 'string' || !/^[A-Za-z]:\\[^\\]/.test(options.bundleRoot) ||
      /[<>:"|?*/]/.test(options.bundleRoot.slice(2)) ||
      options.bundleRoot !== path.resolve(options.bundleRoot)) fail('invalid_profile_input');
  const bundle = localPath(options.bundleRoot);
  const root = localPath(bundle + '.state');
  const key = path.join(bundle + '.secrets', 'runtime.key');
  const input = profileInputs({ tunnelId: options.tunnelId, runtimeKeyFile: key });
  const node = localPath(path.join(bundle, 'runtime', 'node.exe'));
  const loader = pathToFileURL(localPath(path.join(root, 'startup-imports.mjs'))).href;
  const host = localPath(path.join(bundle, 'app', 'host.mjs'));
  return profileDocument(root, input, [node, '--no-global-search-paths', '--import', loader, host, '--state-dir', root]);
}

export function createProfileDocument(root, options) {
  root = localPath(root);
  const input = profileInputs(options);
  rejectReservedKeyLocation(root, input.runtimeKeyFile);
  root = readState(root).root;
  const launch = buildHostLaunch(root, {});
  let interpreter=launch.command;
  if(input.privateRuntime===true) {
    const install=path.dirname(root);
    if(path.basename(root)!=='state' || launch.args[0]!==path.join(install,'app','host.mjs')) fail('invalid_profile_input');
    // This fixed Windows install-relative target can be prepared before its
    // create-only copy. Configuration is not executable/readiness acceptance.
    interpreter=localPath(path.join(install,'runtime','node.exe'));
  }
  return profileDocument(root, input, [interpreter, ...launch.args]);
}

function checkKeyReference(file) {
  file = localPath(file);
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > 65536) fail('invalid_key_reference');
  if (process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) fail('invalid_key_reference');
  // Deliberately no readFile: the official client reads this file on activation.
}

export function verifyTunnelExecutable(value) {
  const file = localPath(value), pin = pins.platforms[process.platform + '-' + process.arch];
  if (!pin || pins.release !== 'v0.0.19') fail('unsupported_tunnel_platform');
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 128 * 1024 * 1024 ||
      (process.platform !== 'win32' && (info.mode & 0o111) === 0)) fail('tunnel_pin_mismatch');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (digest !== pin.executableSha256 && !pin.compatibleExecutableSha256?.includes(digest)) fail('tunnel_pin_mismatch');
  return { file, release: pins.release };
}

function readRecord(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16384) fail('binding_changed');
  const bytes = fs.readFileSync(file, 'utf8'), value = JSON.parse(bytes);
  if (serialize(value) !== bytes) fail('binding_changed');
  return { bytes, value };
}

function bindingPaths(root) {
  return { profile: path.join(root, 'tunnel.yaml'), receipt: path.join(root, 'binding.json') };
}

export function writeTunnelProfile(root, options) {
  root = localPath(root);
  if (!exact(options, ['tunnelId', 'runtimeKeyFile', 'tunnelExecutable']) &&
      !exact(options, ['tunnelId', 'runtimeKeyFile', 'tunnelExecutable','privateRuntime'])) fail('invalid_profile_input');
  const names = bindingPaths(root);
  if (entryExists(names.profile) || entryExists(names.receipt)) fail('binding_exists');
  const input = profileInputs({ tunnelId: options.tunnelId, runtimeKeyFile: options.runtimeKeyFile,
    ...(Object.hasOwn(options,'privateRuntime') ? {privateRuntime:options.privateRuntime} : {}) });
  rejectReservedKeyLocation(root, input.runtimeKeyFile);
  checkKeyReference(input.runtimeKeyFile);
  rejectClientOverlap(input.runtimeKeyFile, options.tunnelExecutable);
  root = readState(root).root;
  const client = verifyTunnelExecutable(options.tunnelExecutable);
  verifyUpstream();
  const profile = createProfileDocument(root, input);
  const receipt = { format: 'agent-continue-tunnel-binding', version: input.privateRuntime===true ? 2 : 1,
    tunnelId: input.tunnelId, runtimeKeyFile: input.runtimeKeyFile, tunnelExecutable: client.file,
    ...(input.privateRuntime===true ? {hostRuntime:'install-private'} : {}) };
  fs.writeFileSync(names.profile, serialize(profile), { flag: 'wx', mode: 0o600 });
  // A partial write remains visibly incomplete. Never infer consent or repair it.
  fs.writeFileSync(names.receipt, serialize(receipt), { flag: 'wx', mode: 0o600 });
  return { configured: true, activated: false, authenticationVerified: false };
}

function loadBinding(root) {
  root = readState(root).root;
  const names = bindingPaths(root), profileExists = entryExists(names.profile), receiptExists = entryExists(names.receipt);
  if (!profileExists && !receiptExists) return null;
  if (!profileExists || !receiptExists) fail('binding_incomplete');
  const { value: receipt } = readRecord(names.receipt);
  const privateRuntime=receipt?.version===2;
  if (!exact(receipt, ['format', 'version', 'tunnelId', 'runtimeKeyFile', 'tunnelExecutable',
      ...(privateRuntime ? ['hostRuntime'] : [])]) || receipt.format !== 'agent-continue-tunnel-binding' ||
      ![1,2].includes(receipt.version) || (privateRuntime && receipt.hostRuntime!=='install-private')) fail('binding_changed');
  const input = profileInputs({ tunnelId: receipt.tunnelId, runtimeKeyFile: receipt.runtimeKeyFile,
    ...(privateRuntime ? {privateRuntime:true} : {}) });
  rejectReservedKeyLocation(root, input.runtimeKeyFile);
  checkKeyReference(input.runtimeKeyFile);
  rejectClientOverlap(input.runtimeKeyFile, receipt.tunnelExecutable);
  const client = verifyTunnelExecutable(receipt.tunnelExecutable);
  verifyUpstream();
  if (readRecord(names.profile).bytes !== serialize(createProfileDocument(root, input))) fail('binding_changed');
  return { root, profileFile: names.profile, executable: client.file };
}

export function inspectTunnelProfile(root) {
  return { configured: Boolean(loadBinding(root)), activation: 'not-observed', authenticationVerified: false };
}

export function profileEnvironment(root, parent = process.env) {
  const env = buildHostLaunch(root, parent).env;
  for (const key of Object.keys(env)) {
    if (/^(?:CONTROL_PLANE_.*|TUNNEL_CLIENT_.*|MCP_.*|HARPOON_.*|HEALTH_.*|ADMIN_UI_.*|CLOUDFLARED_.*|TRACING_.*|LOG_.*|FORWARD_REQUEST_ID|ALLOW_REMOTE_UI|OPEN_WEB_UI|PID_FILE|CA_BUNDLE|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|PROXY_CHECK_INTERVAL)$/i.test(key)) delete env[key];
  }
  return env;
}

export function buildTunnelLaunch(root, parent = process.env) {
  const binding = loadBinding(root);
  if (!binding) fail('binding_missing');
  return { command: binding.executable, args: ['run', '--profile-file', binding.profileFile],
    cwd: path.join(binding.root, 'work'), env: profileEnvironment(binding.root, parent), windowsHide: true };
}
