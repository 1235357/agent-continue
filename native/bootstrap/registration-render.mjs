const fail = code => { throw new Error(code); };
const hostName = 'com.agentcontinue.device_control';
const keyRoot = '\\Software\\Google\\Chrome\\NativeMessagingHosts\\';
const dryRunKeys = ['mode', 'hostName', 'hive', 'view', 'keyPath', 'regSzValue', 'command'];
const commandKeys = ['executable', 'args'];
const windowsPath = /^(?:[A-Za-z]:\\|\\\\)/;

function record(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Reflect.ownKeys(value).length === keys.length &&
    Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value') &&
      Object.getOwnPropertyDescriptor(value, key).enumerable);
}

// Display only: this turns an already-approved dry-run result into text. It never
// executes reg.exe and never reads or writes the registry.
export function renderRegistrationDisplay(dryRun) {
  if (!record(dryRun, dryRunKeys) || dryRun.mode !== 'dry-run') fail('invalid_dry_run');
  if (dryRun.hostName !== hostName) fail('invalid_dry_run');
  if (dryRun.hive !== 'HKCU' && dryRun.hive !== 'HKLM') fail('invalid_dry_run');
  if (dryRun.view !== '32' && dryRun.view !== '64') fail('invalid_dry_run');
  if (typeof dryRun.keyPath !== 'string') fail('invalid_dry_run');
  const value = dryRun.regSzValue;
  if (typeof value !== 'string' || value.length === 0 || value.length > 32767
    || /[\x00-\x1f\x7f]/.test(value) || value.trim() !== value
    || !windowsPath.test(value)) fail('invalid_dry_run');
  const command = dryRun.command;
  if (!record(command, commandKeys) || command.executable !== 'reg.exe') fail('invalid_dry_run');
  if (!Array.isArray(command.args) || command.args.length !== 9
    || !command.args.every(arg => typeof arg === 'string')) fail('invalid_dry_run');
  if (dryRun.keyPath !== dryRun.hive + keyRoot + hostName) fail('invalid_dry_run_binding');
  const expected = ['add', dryRun.keyPath, '/ve', '/t', 'REG_SZ', '/d', value, '/f',
    '/reg:' + dryRun.view];
  for (let index = 0; index < expected.length; index += 1) {
    if (command.args[index] !== expected[index]) fail('invalid_dry_run_binding');
  }
  const text = [
    'Registration preview only - no registry write has been performed.',
    'Host: ' + hostName,
    'Hive: ' + dryRun.hive,
    'View: ' + dryRun.view + '-bit',
    'Key: ' + dryRun.keyPath,
    'REG_SZ: ' + value,
    'Command: ' + command.executable + ' ' + command.args.join(' '),
  ].join('\n') + '\n';
  return Object.freeze({
    format: 'agent-continue-registration-display',
    version: 1,
    mode: 'dry-run',
    hostName,
    hive: dryRun.hive,
    view: dryRun.view,
    keyPath: dryRun.keyPath,
    regSzValue: value,
    command: Object.freeze({ executable: 'reg.exe', args: Object.freeze([...command.args]) }),
    text,
  });
}
