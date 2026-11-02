import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleURL = new URL('./runtime.mjs', import.meta.url);
const api = fs.existsSync(moduleURL) ? await import(moduleURL) : null;
test('native runtime preparation exists', () => assert.ok(api));
const check = (name, run) => test(name, { skip: !api }, run);
function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-provider-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'state');
}
check('full-account consent is explicit and refusal has no filesystem effect', t => {
  const root = scratch(t);
  for (const options of [undefined, {}, { consent: true }, { consent: 'yes' }]) {
    assert.throws(() => api.prepareState(root, options), /consent_required/);
    assert.equal(fs.existsSync(root), false);
  }
});
check('preparation creates private isolated state, not an active tunnel or credential', t => {
  const root = scratch(t);
  const result = api.prepareState(root, { consent: 'full-account' });
  assert.equal(result.prepared, true);
  assert.equal(result.activated, false);
  assert.equal(result.protectedInstallationVerified, false);
  const state = api.readState(root);
  assert.equal(state.config.telemetryEnabled, false);
  assert.deepEqual(state.config.allowedDirectories, []);
  assert.deepEqual(state.config.blockedCommands, []);
  assert.equal(state.config.welcomeOnboardingEligible, false);
  assert.equal(state.config.pendingWelcomeOnboarding, false);
  assert.equal(fs.existsSync(path.join(root, 'runtime.key')), false);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(root).mode & 0o777, 0o700);
    assert.equal(fs.statSync(state.configFile).mode & 0o777, 0o600);
  }
});
check('existing state, redirected state and altered consent reject without repairs', t => {
  const root = scratch(t);
  api.prepareState(root, { consent: 'full-account' });
  const before = fs.readFileSync(path.join(root, 'consent.json'));
  assert.throws(() => api.prepareState(root, { consent: 'full-account' }), /state_exists/);
  assert.deepEqual(fs.readFileSync(path.join(root, 'consent.json')), before);
  fs.writeFileSync(path.join(root, 'consent.json'), JSON.stringify({ approved: true }));
  assert.throws(() => api.readState(root), /invalid_consent/);
});
check('missing or changed telemetry/access policy refuses launch instead of falling back', t => {
  for (const changed of [{ telemetryEnabled: true }, { blockedCommands: ['echo'] }, { allowedDirectories: ['/tmp'] }]) {
    const root = scratch(t);
    api.prepareState(root, { consent: 'full-account' });
    const state = api.readState(root);
    fs.writeFileSync(state.configFile, JSON.stringify({ ...state.config, ...changed }));
    assert.throws(() => api.buildHostLaunch(root, {}), /configuration_changed/);
  }
});
check('fixed stdio launch isolates home and strips Node injections and tunnel keys', t => {
  const root = scratch(t);
  api.prepareState(root, { consent: 'full-account' });
  const parent = { PATH: 'retained-path', HOME: 'not-the-state', USERPROFILE: 'not-the-state',
    NODE_OPTIONS: '--import private.mjs', NODE_PATH: '/untrusted',
    DESKTOP_COMMANDER_DISABLE_TELEMETRY: '0', CONTROL_PLANE_API_KEY: 'synthetic-secret', OPENAI_ADMIN_KEY: 'synthetic-admin' };
  const launch = api.buildHostLaunch(root, parent);
  assert.equal(launch.command, process.execPath);
  assert.equal(launch.windowsHide, true);
  assert.equal(launch.env.HOME, path.join(root, 'home'));
  assert.equal(launch.env.USERPROFILE, path.join(root, 'home'));
  assert.equal(launch.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY, '1');
  for (const name of ['NODE_OPTIONS','NODE_PATH','CONTROL_PLANE_API_KEY','OPENAI_ADMIN_KEY']) assert.equal(name in launch.env, false);
  assert.deepEqual(launch.args.slice(1), ['--state-dir', root]);
  assert.match(launch.args[0], /host\.mjs$/);
  assert.equal(launch.cwd, path.join(root, 'work'));
  assert.equal(parent.NODE_OPTIONS, '--import private.mjs');
});
check('upstream pin and fixed entry exclude mutable launcher and remote mode', () => {
  const verified = api.verifyUpstream();
  assert.equal(verified.version, '0.3.1');
  assert.ok(verified.verifiedFiles > 0);
  const source = fs.readFileSync(new URL('./host.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('globalThis.disableOnboarding = true'));
  assert.doesNotMatch(source, /dist\/index\.js|runRemote\(|ensureChromeAvailable\(|featureFlagManager\.initialize/);
});
check('state paths normalize platform separators before generating launch arguments', t => {
  const root = scratch(t);
  api.prepareState(root, { consent: 'full-account' });
  const input = root.split(path.sep).join('/');
  assert.equal(api.readState(input).root, root);
  assert.equal(api.buildHostLaunch(input, {}).args.at(-1), root);
});
check('redirected state ancestors are rejected before preparation', t => {
  const base = path.dirname(scratch(t));
  const target = path.join(base, 'target'); fs.mkdirSync(target);
  const link = path.join(base, 'link');
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => api.prepareState(path.join(link, 'state'), { consent: 'full-account' }), /redirected_state/);
  assert.deepEqual(fs.readdirSync(target), []);
});
check('case-variant environment overrides cannot survive as a second Windows identity path', t => {
  const root = scratch(t); api.prepareState(root, { consent: 'full-account' });
  const launch = api.buildHostLaunch(root, { home: 'outside', UserProfile: 'outside', AppData: 'outside',
    node_options: '--import outside', control_plane_api_key: 'synthetic' });
  for (const key of ['home', 'UserProfile', 'AppData', 'node_options', 'control_plane_api_key']) assert.equal(key in launch.env, false);
  assert.equal(launch.env.HOME, path.join(root, 'home'));
});
check('altered installed package bytes reject in a disposable copy', async t => {
  const root = path.dirname(scratch(t));
  const copy = path.join(root, 'provider'); fs.mkdirSync(copy);
  fs.copyFileSync(new URL('./runtime.mjs', import.meta.url), path.join(copy, 'runtime.mjs'));
  fs.copyFileSync(new URL('./upstream-pin.json', import.meta.url), path.join(copy, 'upstream-pin.json'));
  const installed = new URL('./node_modules/@wonderwhy-er/desktop-commander/', import.meta.url);
  const packageRoot = path.join(copy, 'node_modules', '@wonderwhy-er', 'desktop-commander');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.copyFileSync(new URL('package.json', installed), path.join(packageRoot, 'package.json'));
  fs.cpSync(new URL('dist/', installed), path.join(packageRoot, 'dist'), { recursive: true });
  const isolated = await import(pathToFileURL(path.join(copy, 'runtime.mjs')).href);
  assert.equal(isolated.verifyUpstream().verifiedFiles, 274);
  fs.appendFileSync(path.join(packageRoot, 'dist', 'version.js'), '\n// altered fixture\n');
  assert.throws(() => isolated.verifyUpstream(), /upstream_pin_mismatch/);
});
