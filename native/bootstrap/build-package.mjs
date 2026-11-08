import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RUNTIME_FILES, PACKAGE_FILES, PROVIDER } from './payload-layout.mjs';
import { verifyPayload } from './bootstrap.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publisherPolicyFile = path.join(here, 'native-publishers.json');
const publisherPolicySha256 = '436a531b201c7dc4efb26591417d6f59a81d7d2303239d2b9ae363b8b17d76a8';
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

// Snapshot only declared release assets. Signature verification belongs to the
// Windows preparer; packaging hashes do not establish publisher trust.
export function readNativeReleaseAssets(sourceRoot, manifestBytes, policyFile=publisherPolicyFile) {
  try {
    sourceRoot=checked(sourceRoot);
    const publisherBytes=regular(checked(policyFile));
    const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
    if(publisherBytes.length>4096 || (path.resolve(policyFile)===publisherPolicyFile &&
      digest(publisherBytes)!==publisherPolicySha256)) throw new Error();
    const publishers=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(publisherBytes));
    if(!publishers || typeof publishers!=='object' || Array.isArray(publishers) ||
      Object.keys(publishers).join(',')!=='format,version,thumbprints' ||
      publishers.format!=='agent-continue-windows-native-publishers' || publishers.version!==1 ||
      !Array.isArray(publishers.thumbprints) || publishers.thumbprints.length>16 ||
      publishers.thumbprints.some(value=>typeof value!=='string' || !/^[a-fA-F0-9]{40}$/.test(value)) ||
      new Set(publishers.thumbprints.map(value=>value.toLowerCase())).size!==publishers.thumbprints.length ||
      !publisherBytes.equals(Buffer.from(JSON.stringify(publishers)+'\n'))) throw new Error();
    let rootInfo;
    try {rootInfo=fs.lstatSync(sourceRoot);} catch(error) {if(error.code==='ENOENT') return [];throw error;}
    if(!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error();
    const arches=fs.readdirSync(sourceRoot).sort(), files=[];
    if(!arches.length || arches.some(arch=>!['x64','arm64'].includes(arch))) throw new Error();
    const keys=['format','version','releaseVersion','arch','nodeVersion','nodeSha256',
      'launcherSha256','signerThumbprint','payloadManifestSha256'];
    for(const arch of arches) {
      const folder=checked(path.join(sourceRoot,arch));
      if(!fs.lstatSync(folder).isDirectory() ||
        JSON.stringify(fs.readdirSync(folder).sort())!==JSON.stringify(['native-launcher.exe','release.json'])) throw new Error();
      const policyBytes=regular(path.join(folder,'release.json'));
      if(!policyBytes.length || policyBytes.length>16384) throw new Error();
      const policy=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(policyBytes));
      if(!policy || typeof policy!=='object' || Array.isArray(policy) ||
        Object.keys(policy).length!==keys.length || keys.some(key=>!Object.hasOwn(policy,key)) ||
        !policyBytes.equals(Buffer.from(JSON.stringify(Object.fromEntries(keys.map(key=>[key,policy[key]])))+'\n')) ||
        policy.format!=='agent-continue-windows-native-release' || policy.version!==1 || policy.arch!==arch ||
        typeof policy.releaseVersion!=='string' || !/^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/.test(policy.releaseVersion) ||
        policy.nodeVersion!=='22.23.4' || !/^[a-fA-F0-9]{40}$/.test(policy.signerThumbprint) ||
        !publishers.thumbprints.some(value=>value.toLowerCase()===policy.signerThumbprint.toLowerCase()) ||
        ['nodeSha256','launcherSha256','payloadManifestSha256'].some(key=>
          typeof policy[key]!=='string' || !/^[a-f0-9]{64}$/.test(policy[key])) ||
        policy.payloadManifestSha256!==digest(manifestBytes)) throw new Error();
      const launcher=regular(path.join(folder,'native-launcher.exe'));
      if(!launcher.length || digest(launcher)!==policy.launcherSha256) throw new Error();
      files.push({name:`native-release/${arch}/release.json`,bytes:policyBytes},
        {name:`native-release/${arch}/native-launcher.exe`,bytes:launcher});
    }
    return files;
  } catch {throw new Error('invalid_native_release_assets');}
}

export function buildPackage(destination, options = {}) {
  try {
    destination = checked(destination);
    const runtime = checked(options.runtimeRoot || path.resolve(here, '../desktop-commander'));
    const snapshot = RUNTIME_FILES.map(name => ({ name, bytes: regular(path.join(runtime, name)) }));
    const manifest = { format: 'agent-continue-payload', version: 1, provider: { ...PROVIDER },
      files: snapshot.map(({ name, bytes }) => ({ path: name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') })) };
    const manifestBytes=Buffer.from(JSON.stringify(manifest)+'\n');
    // Normal npm/ZIP delivery is command-only, even if an experimental release tree exists.
    const releases=options.releaseRoot ? readNativeReleaseAssets(options.releaseRoot,manifestBytes) : [];
    fs.mkdirSync(destination, { mode: 0o700 });
    fs.mkdirSync(path.join(destination, 'payload'), { mode: 0o700 });
    for (const name of PACKAGE_FILES) {
      let bytes = regular(path.join(here, name));
      // npm's bin-links performs this same rewrite during install; do it before packing.
      if (name === 'bin.mjs') bytes = Buffer.from(bytes.toString('utf8').replace(/^(#![^\n]+)\r\n/, '$1\n'));
      if (name === 'package.json') {
        const meta = JSON.parse(bytes); delete meta.scripts;
        bytes = Buffer.from(JSON.stringify(meta, null, 2) + '\n');
      }
      fs.writeFileSync(path.join(destination, name), bytes, { flag: 'wx', mode: name === 'bin.mjs' ? 0o755 : 0o600 });
    }
    for (const { name, bytes } of snapshot) fs.writeFileSync(path.join(destination, 'payload', name), bytes, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(destination, 'payload-manifest.json'), manifestBytes, { flag: 'wx', mode: 0o600 });
    for(const file of releases) {
      const target=path.join(destination,file.name);
      fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
      fs.writeFileSync(target,file.bytes,{flag:'wx',mode:0o600});
    }
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
