import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RUNTIME_FILES, PACKAGE_FILES, PROVIDER } from './payload-layout.mjs';
import { verifyPayload } from './bootstrap.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
function regular(file) {
  const info = fs.lstatSync(file, { bigint: true });
  if (!info.isFile() || info.nlink !== 1n || info.ino === 0n || info.size > 4n * 1024n * 1024n) throw new Error('invalid_source');
  return fs.readFileSync(file);
}
function checked(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value) || value.startsWith('\\\\') || value.startsWith('//')) throw new Error('invalid_path');
  const resolved = path.resolve(value), parsed = path.parse(resolved);
  let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('redirected'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return resolved;
}

export function buildPackage(destination, options = {}) {
  try {
    destination = checked(destination);
    const runtime = checked(options.runtimeRoot || path.resolve(here, '../desktop-commander'));
    const snapshot = RUNTIME_FILES.map(name => ({ name, bytes: regular(path.join(runtime, name)) }));
    fs.mkdirSync(destination, { mode: 0o700 });
    fs.mkdirSync(path.join(destination, 'payload'), { mode: 0o700 });
    for (const name of PACKAGE_FILES) {
      let bytes = regular(path.join(here, name));
      if (name === 'package.json') {
        const meta = JSON.parse(bytes); delete meta.scripts;
        bytes = Buffer.from(JSON.stringify(meta, null, 2) + '\n');
      }
      fs.writeFileSync(path.join(destination, name), bytes, { flag: 'wx', mode: name === 'bin.mjs' ? 0o755 : 0o600 });
    }
    const manifest = { format: 'agent-continue-payload', version: 1, provider: { ...PROVIDER },
      files: snapshot.map(({ name, bytes }) => ({ path: name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') })) };
    for (const { name, bytes } of snapshot) fs.writeFileSync(path.join(destination, 'payload', name), bytes, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(destination, 'payload-manifest.json'), JSON.stringify(manifest) + '\n', { flag: 'wx', mode: 0o600 });
    verifyPayload(destination);
    return { built: true, files: RUNTIME_FILES.length };
  } catch { throw new Error('build_failed'); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--output') throw new Error('invalid_arguments');
    process.stdout.write(JSON.stringify({ ok: true, ...buildPackage(process.argv[3]) }) + '\n');
  } catch { process.exitCode = 1; process.stdout.write('{"ok":false,"error":"build_failed"}\n'); }
}
