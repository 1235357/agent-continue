import path from 'node:path';
import { fileURLToPath } from 'node:url';

const matchesOrigin = (args, origin) => args[0] === origin &&
  (args.length === 1 || process.platform === 'win32' && args.length === 2 && /^--parent-window=\d{1,20}$/.test(args[1]));

const preparedActions = new Set(['prepared-review', 'prepared-revoke']);
const exact = (value,keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key=>Object.hasOwn(value,key));

export function createPreparedControl(binding, { openPreparedProcesses, operationField, processDigestField }) {
  return frame => {
    if (!frame || !preparedActions.has(frame.action) || frame.version !== 1 ||
        typeof frame.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(frame.id)) throw new Error('invalid_prepared_control');
    const header = { version: 1, id: frame.id, action: frame.action };
    try {
      if (Object.keys(frame).length !== 5 || !Object.hasOwn(frame, 'operationId') ||
          !Object.hasOwn(frame, 'sha256')) throw new Error('invalid_prepared_control');
      binding.assertCurrent();
      const store = openPreparedProcesses(binding.root);
      const reference = { [operationField]: frame.operationId, [processDigestField]: frame.sha256 };
      const { status, expiresAt } = store.inspect(reference);
      let observed = status;
      if (frame.action === 'prepared-revoke') {
        if (status === 'expired') return { ...header, ok: false };
        if (status === 'staged') {
          binding.assertCurrent();
          observed = store.revoke(reference).status;
        }
      }
      binding.assertCurrent();
      return { ...header, ok: true, status: observed, expiresAt };
    } catch { return { ...header, ok: false }; }
  };
}

export async function serveBrowserWake({ input, output, origin, args, startOwner, handlePrepared, binding }) {
  if (!matchesOrigin(args, origin)) throw new Error('invalid_browser_wake');
  const { readFrame, writeFrame, sendExistingBrowserControl } = await import('./device-owner.mjs');
  const { validateDeviceRequest, readCurrentAccountSetupReceipt, dispatchCurrentAccountSetup } = await import('./device-operations.mjs');
  const request = await readFrame(input);
  if (request?.action === 'current-account-setup-status') {
    if (!exact(request,['version','id','action','scope','extensionId','setupId']) || request.version !== 1 ||
        typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.id) ||
        request.scope !== 'current-account' || !binding || binding.origin !== origin ||
        request.extensionId !== binding.extensionId || typeof request.setupId !== 'string' ||
        request.setupId.length !== 32 || !/^[a-f0-9]{32}$/.test(request.setupId)) throw new Error('invalid_current_account_setup');
    const receipt=readCurrentAccountSetupReceipt(binding,request.setupId);
    await writeFrame(output,{...request,state:receipt.state,bindingSha256:receipt.bindingSha256});
    return;
  }
  if (request?.version === 2 || request?.action === 'attach-control') {
    try {
      if (!request || Array.isArray(request) || Object.keys(request).length !== 4 ||
          request.version !== 2 || request.action !== 'attach-control' ||
          !binding || binding.origin !== origin) throw new Error('invalid_browser_control');
      const response = await sendExistingBrowserControl(binding, request.ownerId, request.request, { timeoutMs: 5000 });
      await writeFrame(output, { version: 2, action: 'attach-control', ownerId: request.ownerId, response });
      return;
    } catch { throw new Error('device_bridge_unavailable'); }
  }
  if (!request || Object.keys(request).length !== 3 || request.version !== 1 ||
      request.action !== 'wake' || typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.id)) {
    throw new Error('invalid_browser_wake');
  }
  const lifetime = new AbortController();
  let owner, finish;
  const disconnected = new Promise(resolve => { finish = resolve; });
  const stop = () => { lifetime.abort(); owner?.beginQuiesce?.(); finish(); };
  const inputEvents = ['end', 'close', 'error', 'data'];
  const outputEvents = ['close', 'error'];
  for (const event of inputEvents) input.on(event, stop);
  for (const event of outputEvents) output.on(event, stop);
  input.resume();
  try {
    if (input.readableEnded || input.destroyed || output.destroyed) stop();
    if (lifetime.signal.aborted) return;
    owner = await startOwner(lifetime.signal, request.id);
    if (lifetime.signal.aborted) owner?.beginQuiesce?.();
    if (!lifetime.signal.aborted) {
      if (typeof owner.request === 'function') {
        input.pause();
        input.off('data', stop);
      }
      // Acknowledges ownership, not upstream connectivity or chat authorization.
      await writeFrame(output, { version: 1, id: request.id, action: 'wake', ok: true });
      if (typeof owner.request !== 'function') await disconnected;
      else while (!lifetime.signal.aborted) {
        let frame;
        try { frame = await readFrame(input, null, lifetime.signal); }
        catch (error) {
          if (lifetime.signal.aborted || input.readableEnded || input.destroyed) break;
          throw error;
        }
        if (lifetime.signal.aborted) break;
        let response;
        if (frame?.action === 'current-account-setup-connect') {
          if (!binding || binding.origin !== origin) throw new Error('invalid_current_account_setup');
          response=await dispatchCurrentAccountSetup(binding,frame,value=>{
            if (lifetime.signal.aborted) return {...value,ok:false};
            binding.assertCurrent();
            return owner.request(value);
          });
        } else response = handlePrepared && preparedActions.has(frame?.action)
          ? handlePrepared(frame) : await owner.request(validateDeviceRequest(frame));
        if (lifetime.signal.aborted || output.destroyed || output.writableEnded) break;
        try { await writeFrame(output, response); }
        catch { break; } // The receipt is already durable; a lost reply is not replayed.
      }
    }
  } finally {
    stop();
    input.pause();
    try { await owner?.close(); }
    finally {
      for (const event of inputEvents) input.off(event, stop);
      for (const event of outputEvents) output.off(event, stop);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // Local imports and configuration errors stay inside this sanitized boundary.
    const { readNativeBinding, readFrame, writeFrame, sendDeviceRequest, startDeviceOwner } = await import('./device-owner.mjs');
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const bindingFile = path.join(directory, 'device-native-binding.json');
    const binding = readNativeBinding(bindingFile);
    const args = process.argv.slice(2);
    // Only a separately installed local wrapper may select the browser-owned mode.
    if (process.platform === 'win32' && args[0] === '--browser-wake') {
      const prepared = await import('./prepared-process.mjs');
      await serveBrowserWake({ input: process.stdin, output: process.stdout, origin: binding.origin, binding,
        args: args.slice(1), handlePrepared: createPreparedControl(binding, prepared), startOwner(signal, browserOwnerId) {
          binding.assertCurrent();
          return startDeviceOwner(bindingFile, { signal, expectedOrigin: binding.origin, browserOwnerId });
        } });
    } else {
      if (!matchesOrigin(args, binding.origin)) throw new Error('invalid_device_origin');
      const request = await readFrame(process.stdin);
      const response = request?.version === 2
        ? await (await import('./device-ssh.mjs')).routeDeviceRequest(binding, request,
          path.join(directory, 'device-ssh-targets.json'))
        : await sendDeviceRequest(binding, request);
      binding.assertCurrent();
      await writeFrame(process.stdout, response);
    }
  } catch {
    process.exitCode = 1;
    process.stderr.write('device_bridge_unavailable\n');
  } finally { process.stdin.destroy(); }
}
