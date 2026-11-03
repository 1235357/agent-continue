import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { verifyProviderStage } from './bootstrap.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MiB = 1024 * 1024;
const archiveLimit = 64 * MiB;
const release = 'v0.0.19';
const releasePath = 'https://github.com/openai/tunnel-client/releases/download/' + release + '/';
const platforms = Object.freeze({
  'win32-x64': 'windows-amd64', 'win32-arm64': 'windows-arm64',
  'linux-x64': 'linux-amd64', 'linux-arm64': 'linux-arm64',
  'darwin-x64': 'darwin-amd64', 'darwin-arm64': 'darwin-arm64',
});
const errors = new Set(['consent_required', 'client_input_invalid', 'unsupported_tunnel_platform',
  'provider_stage_invalid', 'client_exists', 'client_acquisition_failed', 'client_archive_invalid',
  'client_verification_failed', 'client_receipt_failed']);
const fail = code => { throw new Error(code); };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const extractionTask = 'agent-continue-client-extraction-v1';
const extractionErrors = new Set(['client_acquisition_failed', 'client_archive_invalid', 'client_verification_failed']);

function optionsRecord(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Reflect.ownKeys(value).every(key => keys.includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function closedRecord(value, keys) {
  return optionsRecord(value, keys) && Reflect.ownKeys(value).length === keys.length;
}

function localPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value) ||
      value.startsWith('\\\\') || value.startsWith('//')) fail('client_input_invalid');
  const result = path.resolve(value), root = path.parse(result).root;
  let current = root, existing = root;
  for (const part of result.slice(root.length).split(path.sep).filter(Boolean)) {
    if (process.platform === 'win32' && /[<>:"|?*]|[. ]$/.test(part)) fail('client_input_invalid');
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) fail('client_input_invalid');
      existing = current;
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return path.join(fs.realpathSync(existing), path.relative(existing, result));
}

function contains(parent, child) {
  const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const relative = path.relative(fold(parent), fold(child));
  if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) return true;
  let identity;
  try { identity = fs.lstatSync(parent, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  for (let current = child; ; current = path.dirname(current)) {
    try {
      const info = fs.lstatSync(current, { bigint: true });
      if (info.dev === identity.dev && info.ino === identity.ino) return true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) return false;
  }
}

function fileInfo(file, limit) {
  const info = fs.lstatSync(localPath(file));
  if (!info.isFile() || info.nlink !== 1 || info.ino === 0 || info.size > limit) fail('client_input_invalid');
  return info;
}

// Read-only preflight: the CLI can use this before the provider stage exists.
export function validateClientInput(options, trusted = {}) {
  try {
    if (options?.consent !== 'full-account') fail('consent_required');
    if (!optionsRecord(options, ['installDir', 'consent', 'offlineArchive', 'signal']) ||
        !optionsRecord(trusted, ['packageRoot', 'fetchImpl', 'platform']) ||
        (options.signal !== undefined && !(options.signal instanceof AbortSignal)) ||
        (trusted.fetchImpl !== undefined && typeof trusted.fetchImpl !== 'function')) fail('client_input_invalid');
    const installDir = localPath(options.installDir), packageRoot = localPath(trusted.packageRoot ?? here);
    if (contains(packageRoot, installDir) || contains(installDir, packageRoot) ||
        !fs.statSync(path.dirname(installDir)).isDirectory()) fail('client_input_invalid');
    let offlineArchive;
    if (options.offlineArchive !== undefined) {
      offlineArchive = localPath(options.offlineArchive);
      if (contains(path.join(installDir, 'client'), offlineArchive)) fail('client_input_invalid');
      fileInfo(offlineArchive, archiveLimit);
    }
    const platform = trusted.platform === undefined ? process.platform + '-' + process.arch : trusted.platform;
    if (typeof platform !== 'string' || !Object.hasOwn(platforms, platform)) fail('unsupported_tunnel_platform');
    let pin;
    try {
      const pinsFile = path.join(packageRoot, 'payload', 'tunnel-pins.json');
      fileInfo(pinsFile, MiB);
      const pins = JSON.parse(fs.readFileSync(pinsFile, 'utf8'));
      pin = pins.platforms?.[platform];
      if (pins.release !== release || pins.source !== 'https://github.com/openai/tunnel-client/releases/tag/' + release ||
          !pin || pin.asset !== 'tunnel-client-runtime-v0.0.19-' + platforms[platform] + '.zip' ||
          !['archiveSha256', 'executableSha256', 'spdxSha256'].every(key => typeof pin[key] === 'string' && /^[a-f0-9]{64}$/.test(pin[key]))) {
        fail('unsupported_tunnel_platform');
      }
    } catch { fail('unsupported_tunnel_platform'); }
    return { installDir, offlineArchive, platform, pin };
  } catch (error) {
    fail(['consent_required', 'unsupported_tunnel_platform'].includes(error?.message) ? error.message : 'client_input_invalid');
  }
}

function cancelled(signal) {
  if (signal.aborted) fail('client_acquisition_failed');
}

async function discard(response) {
  try { await response?.body?.cancel(); } catch { /* No response diagnostics leave the adapter. */ }
}

function allowedURL(value, initial) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
      (url.hostname === 'github.com' ? url.href !== initial :
        !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname))) fail('client_acquisition_failed');
  return url.href;
}

async function download(pin, fetchImpl, signal) {
  const initial = releasePath + pin.asset;
  let url = initial;
  for (let redirects = 0; ; redirects++) {
    cancelled(signal);
    // Fetch must settle its abort-aware transport before the adapter can return.
    const response = await fetchImpl(url, {
      redirect: 'manual', credentials: 'omit', cache: 'no-store', signal,
    });
    try {
      cancelled(signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= 3) fail('client_acquisition_failed');
        const location = response.headers.get('location');
        if (!location) fail('client_acquisition_failed');
        url = allowedURL(new URL(location, url).href, initial);
      } else {
        if (response.status !== 200 || response.redirected || !response.body) fail('client_acquisition_failed');
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > archiveLimit)) fail('client_acquisition_failed');
        return response;
      }
    } catch (error) { await discard(response); throw error; }
    await discard(response);
  }
}

async function copyStream(source, target, limit, signal, declared, onChunk) {
  let bytes = 0, sizeError = false;
  const hash = crypto.createHash('sha256');
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      if (onChunk) { onChunk(); onChunk = undefined; }
      bytes += chunk.length;
      if (bytes > limit || (declared !== undefined && bytes > declared)) {
        sizeError = true;
        callback(new Error('client_verification_failed'));
      } else { hash.update(chunk); callback(null, chunk); }
    },
  });
  let output;
  try {
    cancelled(signal);
    output = fs.createWriteStream(target, { flags: 'wx', mode: 0o600 });
    await pipeline(source, counter, output, { signal });
  } catch {
    // pipeline settles its owned streams, including asynchronous reader cancellation.
    if (!output) {
      const closing = [finished(source, { cleanup: true }), finished(counter, { cleanup: true })];
      source.destroy(); counter.destroy();
      await Promise.allSettled(closing);
    }
    cancelled(signal);
    fail(sizeError && declared !== undefined ? 'client_verification_failed' : 'client_acquisition_failed');
  }
  cancelled(signal);
  if (declared !== undefined && bytes !== declared) fail('client_verification_failed');
  return { bytes, sha256: hash.digest('hex') };
}

function stagedUnzipper(installDir) {
  try {
    const app = path.join(installDir, 'app'), root = localPath(path.join(app, 'node_modules', 'unzipper'));
    const metaFile = path.join(root, 'package.json');
    fileInfo(metaFile, MiB);
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const require = createRequire(path.join(app, 'package.json'));
    if (meta.name !== 'unzipper' || meta.version !== '0.10.14' ||
        path.resolve(require.resolve('unzipper/package.json')) !== metaFile) fail('client_acquisition_failed');
    const entry = localPath(require.resolve('unzipper'));
    if (!contains(root, entry)) fail('client_acquisition_failed');
    fileInfo(entry, 4 * MiB);
    return require(entry);
  } catch { fail('client_acquisition_failed'); }
}

async function extract(archive, client, platform, pin, installDir, signal) {
  const unzipper = stagedUnzipper(installDir);
  let directory;
  try { directory = await unzipper.Open.buffer(archive); }
  catch { cancelled(signal); fail('client_archive_invalid'); }
  cancelled(signal);
  const base = pin.asset.slice(0, -4);
  const executable = platform.startsWith('win32-') ? 'tunnel-client-runtime.exe' : 'tunnel-client-runtime';
  const names = [executable, 'LICENSE', 'NOTICE', base + '-licenses.txt', base + '.spdx.json'];
  const seen = new Set();
  if (directory.diskNumber !== 0 || directory.diskStart !== 0 || directory.files?.length !== names.length ||
      directory.numberOfRecords !== names.length || directory.numberOfRecordsOnDisk !== names.length) fail('client_archive_invalid');
  for (const entry of directory.files) {
    const type = (entry.externalFileAttributes >>> 16) & 0o170000;
    const limit = entry.path === executable ? 128 * MiB : 2 * MiB;
    if (!names.includes(entry.path) || seen.has(entry.path) || entry.type !== 'File' ||
        !Buffer.isBuffer(entry.pathBuffer) || !entry.pathBuffer.equals(Buffer.from(entry.path, 'ascii')) ||
        entry.signature !== 0x02014b50 || (entry.flags & 1) !== 0 || ![0, 8].includes(entry.compressionMethod) ||
        entry.diskNumber !== 0 || (type !== 0 && type !== 0o100000) || (entry.externalFileAttributes & 0x50) !== 0 ||
        !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize <= 0 || entry.uncompressedSize > limit ||
        !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize <= 0 || entry.compressedSize > archive.length ||
        !Number.isSafeInteger(entry.offsetToLocalFileHeader) || entry.offsetToLocalFileHeader < 0 || entry.offsetToLocalFileHeader >= archive.length) {
      fail('client_archive_invalid');
    }
    seen.add(entry.path);
  }
  // Destinations come only from our fixed inventory, never from a generic ZIP extract API.
  let announced = false;
  for (const name of names) {
    cancelled(signal);
    const entry = directory.files.find(file => file.path === name);
    const target = path.join(client, name);
    const result = await copyStream(entry.stream(), target, name === executable ? 128 * MiB : 2 * MiB,
      signal, entry.uncompressedSize, entry.compressionMethod === 8 && !announced ? () => {
        announced = true;
        parentPort.postMessage({ phase: 'extracting' });
      } : undefined);
    if ((name === executable && result.sha256 !== pin.executableSha256) ||
        (name === base + '.spdx.json' && result.sha256 !== pin.spdxSha256)) fail('client_verification_failed');
  }
  cancelled(signal);
  if (process.platform !== 'win32') fs.chmodSync(path.join(client, executable), 0o700);
}

function validExtractionTask(data) {
  return closedRecord(data, ['task', 'archive', 'client', 'platform', 'pin', 'installDir']) &&
    data.task === extractionTask && data.archive instanceof ArrayBuffer && data.archive.byteLength <= archiveLimit &&
    typeof data.client === 'string' && path.isAbsolute(data.client) &&
    typeof data.installDir === 'string' && path.isAbsolute(data.installDir) &&
    typeof data.platform === 'string' && Object.hasOwn(platforms, data.platform) &&
    closedRecord(data.pin, ['asset', 'archiveSha256', 'executableSha256', 'spdxSha256']) &&
    data.pin.asset === 'tunnel-client-runtime-v0.0.19-' + platforms[data.platform] + '.zip' &&
    ['archiveSha256', 'executableSha256', 'spdxSha256'].every(key =>
      typeof data.pin[key] === 'string' && /^[a-f0-9]{64}$/.test(data.pin[key]));
}

async function extractInWorker(archive, client, platform, pin, installDir, signal) {
  cancelled(signal);
  const bytes = Uint8Array.from(archive);
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { task: extractionTask, archive: bytes.buffer, client, platform, installDir,
      pin: { asset: pin.asset, archiveSha256: pin.archiveSha256,
        executableSha256: pin.executableSha256, spdxSha256: pin.spdxSha256 } },
    transferList: [bytes.buffer], env: {}, execArgv: [], stdout: true, stderr: true, trackUnmanagedFds: true,
  });
  let abort, message, error, exit;
  try {
    worker.stdout.resume(); worker.stderr.resume();
    await new Promise((resolve, reject) => {
      abort = () => reject(new Error('client_acquisition_failed'));
      error = abort;
      exit = abort;
      message = value => {
        if (closedRecord(value, ['phase']) && value.phase === 'extracting') return;
        if (closedRecord(value, ['done']) && value.done === true) resolve();
        else reject(new Error(closedRecord(value, ['error']) && extractionErrors.has(value.error)
          ? value.error : 'client_acquisition_failed'));
      };
      worker.on('message', message); worker.on('error', error); worker.on('exit', exit);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    // The worker owns unzipper's hidden buffers, inflater and extraction descriptors.
    await worker.terminate();
    if (message) worker.off('message', message);
    if (error) worker.off('error', error);
    if (exit) worker.off('exit', exit);
  }
}

export async function acquireClient(options, trusted = {}) {
  const started = performance.now();
  let pending, timer, controller, callerAbort;
  try {
    const { installDir, offlineArchive, platform, pin } = validateClientInput(options, trusted);
    const packageRoot = localPath(trusted.packageRoot ?? here);
    controller = new AbortController();
    const signal = controller.signal;
    callerAbort = () => controller.abort();
    options.signal?.addEventListener('abort', callerAbort, { once: true });
    if (options.signal?.aborted) controller.abort();
    timer = setTimeout(callerAbort, Math.max(0, 60000 - (performance.now() - started)));
    cancelled(signal);
    await verifyProviderStage(installDir, packageRoot);
    cancelled(signal);
    const client = path.join(installDir, 'client');
    try { fs.mkdirSync(client, { mode: 0o700 }); }
    catch (error) { fail(error.code === 'EEXIST' ? 'client_exists' : 'client_acquisition_failed'); }
    const archiveFile = path.join(client, 'release.zip');
    let result;
    if (offlineArchive !== undefined) {
      const info = fileInfo(offlineArchive, archiveLimit);
      result = await copyStream(fs.createReadStream(offlineArchive), archiveFile, archiveLimit, signal, info.size);
    } else {
      const response = await download(pin, trusted.fetchImpl ?? globalThis.fetch, signal);
      result = await copyStream(Readable.fromWeb(response.body), archiveFile, archiveLimit, signal);
    }
    if (result.sha256 !== pin.archiveSha256) fail('client_verification_failed');
    cancelled(signal);
    fileInfo(archiveFile, archiveLimit);
    const archive = fs.readFileSync(archiveFile);
    if (archive.length > archiveLimit || digest(archive) !== pin.archiveSha256) fail('client_verification_failed');
    await extractInWorker(archive, client, platform, pin, installDir, signal);
    cancelled(signal);
    await verifyProviderStage(installDir, packageRoot);
    cancelled(signal);
    const receipt = { format: 'agent-continue-device-acquisition', version: 1, status: 'acquired',
      providerVersion: '0.3.1', tunnelRelease: release, platform, executableSha256: pin.executableSha256,
      configured: false, activated: false, protectedInstallationVerified: false, nativeDependenciesVerified: false };
    pending = path.join(client, 'receipt.pending.' + crypto.randomUUID());
    try { fs.writeFileSync(pending, JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch { fail('client_receipt_failed'); }
    cancelled(signal);
    // Synchronous create-only link is the commit point. No fallible work follows it.
    try { fs.linkSync(pending, path.join(client, 'receipt.json')); }
    catch { fail('client_receipt_failed'); }
    return receipt;
  } catch (error) { fail(errors.has(error?.message) ? error.message : 'client_acquisition_failed'); }
  finally {
    clearTimeout(timer);
    if (callerAbort) {
      try { options.signal?.removeEventListener('abort', callerAbort); }
      catch { /* Caller listener cleanup cannot change the acquisition result. */ }
    }
    if (pending) { try { fs.unlinkSync(pending); } catch { /* Cleanup never changes commitment. */ } }
  }
}

if (!isMainThread && parentPort && validExtractionTask(workerData)) {
  try {
    await extract(Buffer.from(workerData.archive), workerData.client, workerData.platform,
      workerData.pin, workerData.installDir, new AbortController().signal);
    parentPort.postMessage({ done: true });
  } catch (error) {
    parentPort.postMessage({ error: extractionErrors.has(error?.message) ? error.message : 'client_acquisition_failed' });
  }
}
