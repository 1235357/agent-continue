import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'vendor', 'pdfjs');
const source = JSON.parse(await fs.readFile(path.join(vendor, 'SOURCE.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('PDF source metadata explicitly selects the reviewed modern build', () => {
  assert.equal(source.build, 'modern');
});

for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
  test(`${name} is the exact unmodified upstream modern asset`, async () => {
    const [actual, upstream] = await Promise.all([
      fs.readFile(path.join(vendor, name)),
      fs.readFile(path.join(root, 'node_modules', 'pdfjs-dist', 'build', name)),
    ]);
    assert.equal(sha256(actual), sha256(upstream));
    const entry = source.files.find(file => file.path === name);
    assert.equal(entry.size, actual.length);
    assert.equal(entry.sha256, sha256(actual));
  });

  test(`${name} excludes the legacy executable-string compatibility layer`, async () => {
    const code = await fs.readFile(path.join(vendor, name), 'utf8');
    for (const marker of ['NullProtoObjectViaActiveX', 'NullProtoObjectViaIFrame',
      "var JS = 'java' + SCRIPT + ':'", "Function('return this')"])
      assert.equal(code.includes(marker), false, `Legacy compatibility marker: ${marker}`);
  });
}
