const fail = code => { throw new Error(code); };
const hostName = 'com.agentcontinue.device_control';
const keyRoot = '\\Software\\Google\\Chrome\\NativeMessagingHosts\\';
const placeholder = '<absolute manifest path supplied by the reviewed installer>';
const statusLabel = 'Registration status: not registered. Nothing has been written.';
const displayKeys = ['format', 'version', 'mode', 'hostName', 'hive', 'view', 'keyPath',
  'regSzValue', 'command', 'text'];
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

function scope(hive, view) {
  if (hive !== 'HKCU' && hive !== 'HKLM') fail('invalid_guidance_input');
  if (view !== '32' && view !== '64') fail('invalid_guidance_input');
}

const expectedArgs = (keyPath, value, view) => ['add', keyPath, '/ve', '/t', 'REG_SZ',
  '/d', value, '/f', '/reg:' + view];

function text(lines) { return lines.join('\n') + '\n'; }

function buildScreen(valueKind, hive, view, regSzValue) {
  const keyPath = hive + keyRoot + hostName;
  const args = expectedArgs(keyPath, regSzValue, view);
  return Object.freeze({
    format: 'agent-continue-first-install-guidance',
    version: 1,
    valueKind,
    status: 'not-registered',
    statusLabel,
    hostName,
    hive,
    view,
    keyPath,
    regSzValue,
    command: Object.freeze({ executable: 'reg.exe', args: Object.freeze(args) }),
    text: text([
      'First-install registration preview (read only)',
      'Status: not registered - nothing has been written to the registry.',
      'Host: ' + hostName,
      'Hive: ' + hive,
      'View: ' + view + '-bit',
      'Key: ' + keyPath,
      'REG_SZ: ' + regSzValue,
      'Command: reg.exe ' + args.join(' '),
    ]),
  });
}

// Read-only display model. It never executes reg.exe, imports no execution or
// writer module and touches no registry; it only formats what a reviewed plan
// already established.
export function buildPendingFirstInstallGuidance(options) {
  if (!record(options, ['hive', 'view'])) fail('invalid_guidance_input');
  scope(options.hive, options.view);
  return buildScreen('placeholder', options.hive, options.view, placeholder);
}

export function buildFirstInstallGuidance(options) {
  if (!record(options, ['display', 'registrationStatus'])) fail('invalid_guidance_input');
  if (options.registrationStatus !== 'not-registered') fail('invalid_guidance_input');
  const display = options.display;
  if (!record(display, displayKeys) || display.mode !== 'dry-run'
    || display.format !== 'agent-continue-registration-display' || display.version !== 1
    || display.hostName !== hostName) fail('invalid_guidance_input');
  scope(display.hive, display.view);
  if (typeof display.keyPath !== 'string' || typeof display.regSzValue !== 'string'
    || display.regSzValue.length === 0 || display.regSzValue.length > 32767
    || /[\x00-\x1f\x7f]/.test(display.regSzValue) || display.regSzValue.trim() !== display.regSzValue
    || !windowsPath.test(display.regSzValue)) fail('invalid_guidance_input');
  if (!record(display.command, commandKeys) || display.command.executable !== 'reg.exe'
    || !Array.isArray(display.command.args) || display.command.args.length !== 9
    || !display.command.args.every(arg => typeof arg === 'string')) fail('invalid_guidance_input');
  const keyPath = display.hive + keyRoot + hostName;
  if (display.keyPath !== keyPath) fail('invalid_guidance_input');
  const args = expectedArgs(keyPath, display.regSzValue, display.view);
  for (let index = 0; index < args.length; index += 1) {
    if (display.command.args[index] !== args[index]) fail('invalid_guidance_input');
  }
  const expectedText = text([
    'Registration preview only - no registry write has been performed.',
    'Host: ' + hostName,
    'Hive: ' + display.hive,
    'View: ' + display.view + '-bit',
    'Key: ' + keyPath,
    'REG_SZ: ' + display.regSzValue,
    'Command: reg.exe ' + args.join(' '),
  ]);
  if (typeof display.text !== 'string' || display.text !== expectedText) fail('invalid_guidance_input');
  return buildScreen('exact', display.hive, display.view, display.regSzValue);
}
