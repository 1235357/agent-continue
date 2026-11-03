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
