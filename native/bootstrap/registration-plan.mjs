import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const fail = code => { throw new Error(code); };
const nativeHostName = 'com.agentcontinue.device_control';
const nativeHostKey = '\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + nativeHostName;

export function registrationPlan(options) {
  const value = options || {};
  if (value.name !== nativeHostName) fail('invalid_native_host_name');
  if (value.hive !== 'HKCU' && value.hive !== 'HKLM') fail('invalid_registry_hive');
  if (value.view !== '32' && value.view !== '64') fail('invalid_registry_view');
  if (typeof value.manifestPath !== 'string' || !path.isAbsolute(value.manifestPath)) fail('invalid_manifest_path');
  let manifest;
  try { manifest = fs.statSync(value.manifestPath); } catch { fail('invalid_manifest_path'); }
  if (!manifest.isFile() || manifest.size > 16384) fail('invalid_manifest_path');
  const manifestSha256 = crypto.createHash('sha256').update(fs.readFileSync(value.manifestPath)).digest('hex');
  if (typeof value.origin !== 'string' || !/^chrome-extension:\/\/[a-p]{32}\/$/.test(value.origin)) fail('invalid_origin');
  const keyPath = value.hive + nativeHostKey;
  const view = '/reg:' + value.view;
  return Object.freeze({
    name: nativeHostName, hive: value.hive, view: value.view, keyPath,
    origin: value.origin, regSzValue: value.manifestPath, manifestSha256,
    addArgs: Object.freeze(['add', keyPath, '/ve', '/t', 'REG_SZ', '/d', value.manifestPath, '/f', view]),
    queryArgs: Object.freeze(['query', keyPath, '/ve', view]),
  });
}
