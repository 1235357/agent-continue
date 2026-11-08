const FORMAT = 'agent-continue-device-setup';
const HOST = 'com.agentcontinue.device_control';
const TARGETS = Object.freeze(Object.fromEntries([
  ['windows', 'source-candidate', true],
  ['macos', 'not-implemented', true],
  ['linux', 'source-kit', true],
  ['linux-server', 'source-kit', false],
].map(([target, availability, usesBrowserNativeBridge]) => [target, Object.freeze({
  target, availability, usesBrowserNativeBridge,
  installerReleased: false, installationVerified: false, chatAuthorizationVerified: false,
})])));

export function describeTarget(target) {
  if (typeof target !== 'string' || !Object.hasOwn(TARGETS, target)) throw new Error('Invalid setup target.');
  return TARGETS[target];
}

export function buildSetupRequest(target, extensionId) {
  const descriptor = describeTarget(target);
  if (typeof extensionId !== 'string' || extensionId.length !== 32 || !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error('A valid installed extension identity is required.');
  }
  return Object.freeze({ format: FORMAT, version: 1, target, extensionId,
    nativeHost: descriptor.usesBrowserNativeBridge ? HOST : null });
}

export function serializeSetupRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid setup request.');
  const expected = buildSetupRequest(request.target, request.extensionId);
  const keys = Object.keys(expected);
  if (Object.keys(request).length !== keys.length || keys.some(key => !Object.hasOwn(request, key) || request[key] !== expected[key])) {
    throw new Error('Invalid setup request.');
  }
  return JSON.stringify(expected, null, 2) + '\n';
}

export function buildLocalControlFrameUrl(value) {
  const match = typeof value === 'string' && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})\/?$/.exec(value.trim());
  if (!match || Number(match[1]) < 1024 || Number(match[1]) > 65535) throw new Error('Invalid local control address.');
  return `http://127.0.0.1:${match[1]}/embed`;
}

export function parseLocalPairingTicket(value) {
  const match = typeof value === 'string' && [56, 57].includes(value.length) &&
    /^ACPAIR1:([1-9][0-9]{3,4}):([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match || match[0] !== value || Number(match[1]) < 1024 || Number(match[1]) > 65535) {
    throw new Error('Invalid local pairing ticket.');
  }
  return { destination: buildLocalControlFrameUrl(`http://127.0.0.1:${match[1]}`), code: match[2] };
}
