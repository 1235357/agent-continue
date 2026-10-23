#!/usr/bin/env node
// Reproduce the reviewed offline PDF.js assets after `npm ci --ignore-scripts`.
// This script reads only our checked-in manifest and the fixed npm package.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = path.join(root, 'vendor', 'pdfjs');
const dependencyRoot = path.join(root, 'node_modules', 'pdfjs-dist');
const REVIEWED_VERSION = '6.4.299';
const REVIEWED_INTEGRITY = 'sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==';
const REVIEWED_FILE_COUNT = 188;

async function json(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function main() {
  const source = await json(path.join(vendorRoot, 'SOURCE.json'));
  let dependency;
  try { dependency = await json(path.join(dependencyRoot, 'package.json')); }
  catch { throw new Error('Missing node_modules/pdfjs-dist. Run npm ci --ignore-scripts first.'); }
  if (dependency.name !== 'pdfjs-dist' || dependency.version !== REVIEWED_VERSION) {
    throw new Error(`PDF.js ${dependency.version || 'unknown'} has not been reviewed. Expected ${REVIEWED_VERSION}; review the upgrade and update the source manifest, assets and tests together.`);
  }
  if (source.package !== dependency.name || source.version !== REVIEWED_VERSION || source.integrity !== REVIEWED_INTEGRITY || source.license !== 'Apache-2.0') {
    throw new Error('The PDF.js source manifest does not match the reviewed dependency. Review the upgrade before generating assets.');
  }
  if (!Array.isArray(source.files) || source.files.length !== REVIEWED_FILE_COUNT) {
    throw new Error('The PDF.js asset manifest is incomplete or has unreviewed changes.');
  }

  const names = new Set();
  const verified = [];
  for (const entry of source.files) {
    if (!entry || typeof entry.path !== 'string' || names.has(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 1 || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')) {
      throw new Error('Invalid or duplicate entry in the reviewed PDF.js asset manifest.');
    }
    const approved = /^(?:pdf(?:\.worker)?\.mjs|LICENSE|cmaps\/(?:LICENSE|[A-Za-z0-9_-]+\.bcmap)|standard_fonts\/(?:LICENSE_(?:FOXIT|LIBERATION)|[A-Za-z0-9_-]+\.(?:pfb|ttf)))$/;
    if (!approved.test(entry.path)) throw new Error('An unapproved path appears in the PDF.js asset manifest.');
    names.add(entry.path);
    const dependencyPath = entry.path === 'pdf.mjs' || entry.path === 'pdf.worker.mjs' ? 'legacy/build/' + entry.path : entry.path;
    const from = path.join(dependencyRoot, dependencyPath);
    const stat = await fs.lstat(from);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size) throw new Error(`Unexpected PDF.js asset type or size: ${entry.path}`);
    const bytes = await fs.readFile(from);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`PDF.js asset integrity mismatch: ${entry.path}`);
    verified.push({ path: entry.path, bytes });
  }
  for (const required of ['pdf.mjs', 'pdf.worker.mjs', 'LICENSE', 'cmaps/LICENSE', 'standard_fonts/LICENSE_FOXIT', 'standard_fonts/LICENSE_LIBERATION']) {
    if (!names.has(required)) throw new Error(`Missing required PDF.js asset: ${required}`);
  }

  // Validate every source before writing any destination. Do not delete the
  // vendor directory: it contains tracked metadata and third-party licenses.
  for (const entry of verified) {
    const to = path.join(vendorRoot, entry.path);
    await fs.mkdir(path.dirname(to), { recursive: true });
    const existing = await fs.lstat(to).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new Error(`Refusing to overwrite a non-file PDF.js asset: ${entry.path}`);
    await fs.writeFile(to, entry.bytes);
  }
  console.log(`Vendored PDF.js ${REVIEWED_VERSION}: ${verified.length} verified files, ${verified.reduce((total, entry) => total + entry.bytes.length, 0)} bytes. Offline assets are ready.`);
}

main().catch(error => {
  console.error(`PDF.js vendor generation failed: ${error.message}`);
  process.exitCode = 1;
});
