// Synthetic documents only. This test never searches for or opens user files.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const playwright = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href)
  : await import('playwright');
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const context = await browser.newContext();
const externalRequests = [];
const consoleMessages = [];
const page = await context.newPage();
page.on('console', message => consoleMessages.push(message.text()));
page.on('pageerror', error => consoleMessages.push(error.message));

await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== 'http://import.test') { externalRequests.push(url.href); return route.abort(); }
  if (url.pathname === '/') return route.fulfill({
    status: 200, contentType: 'text/html',
    headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; object-src 'none'" },
    body: '<!doctype html><meta charset="utf-8"><title>Local import test fixture</title>',
  });
  if (url.pathname === '/file-import.js' || /^\/vendor\/pdfjs\/[\w./-]+$/.test(url.pathname)) {
    const target = path.resolve(root, '.' + url.pathname);
    assert.ok(target.startsWith(root + path.sep));
    return route.fulfill({ status: 200, contentType: /\.m?js$/.test(target) ? 'text/javascript' : 'application/octet-stream', body: await fs.readFile(target) });
  }
  return route.fulfill({ status: 404, body: '' });
});
await page.goto('http://import.test/');
await page.evaluate(async () => { window.importer = await import('/file-import.js'); });

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); passed++; }
  catch (error) { console.error('FAIL ' + name + ': ' + error.message); failed++; }
}
const runImport = (name, bytes, options = {}) => page.evaluate(async ({ name, bytes, options }) => {
  try {
    const result = await window.importer.importPromptFile(new File([Uint8Array.from(bytes)], name), options);
    return { ok: true, ...result };
  } catch (error) { return { ok: false, code: error.code, message: error.message }; }
}, { name, bytes: [...Buffer.from(bytes)], options });

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function docx(xml, { stored = false, declaredSize, encrypted = false, badCrc = false } = {}) {
  const name = Buffer.from('word/document.xml');
  const source = Buffer.from(xml);
  const compressed = stored ? source : deflateRawSync(source);
  const crc = badCrc ? 0 : crc32(source);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt16LE(encrypted ? 1 : 0, 6); local.writeUInt16LE(stored ? 0 : 8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(declaredSize ?? source.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(encrypted ? 1 : 0, 8); central.writeUInt16LE(stored ? 0 : 8, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(declaredSize ?? source.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}
const wordXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">  First &amp; 第二行  </w:t><w:tab/><w:t>task</w:t><w:br/><w:t>Next</w:t></w:r></w:p><w:p/><w:del><w:r><w:t>Deleted</w:t></w:r></w:del></w:body></w:document>';
function pdf(text = 'Synthetic local PDF prompt', { blank = false, javascript = false } = {}) {
  const stream = blank ? '' : `BT /F1 12 Tf 30 80 Td (${text}) Tj ET`;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${javascript ? '/OpenAction << /S /JavaScript /JS (globalThis.privateImportExecuted = true) >>' : ''} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += String(offset).padStart(10, '0') + ' 00000 n \n';
  output += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
// One blank page generated with pypdf and a synthetic password. No user file.
const encryptedPdf = Buffer.from('JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDEzYmM2ZDExNTQ+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAxMDAgMTAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8NDIzMDM2ZWE4OTQwM2U5ZmFjZmUxNjYzMzhkNjMwYjRhMWViNWU4NzljNjZkMzkyZWExZjI4ZmVjYjI2MWQwOD4KL1UgPDcyZGQ2NjI1OGY2ODMyYThhYTU0Njc3ZTY3NjU0ZjE2MjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAwMDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDMwMzkzNTMzMzE2NjYzMzg2MTM3MzAzMTYzMzczMDYyMzc2MzM3MzIzMzMwMzAzNjM4MzUzNjMyMzYzODY0NjM+IDwzMDM5MzUzMzMxNjY2MzM4NjEzNzMwMzE2MzM3MzA2MjM3NjMzNzMyMzMzMDMwMzYzODM1MzYzMjM2Mzg2NDYzPiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK', 'base64');

try {
  await test('TXT preserves leading/trailing whitespace, CRLF and multilingual content', async () => {
    const text = '  Synthetic 私密测试\r\nSecond line\r\n\r\n';
    const result = await runImport('sample.TXT', Buffer.from(text));
    assert.equal(result.ok, true); assert.equal(result.text, text); assert.deepEqual(result.warnings, []);
  });
  await test('Markdown and structured text remain verbatim rather than being rendered or parsed', async () => {
    for (const suffix of ['md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'yaml', 'yml', 'xml', 'ini', 'conf', 'cfg', 'rst', 'tex', 'log']) {
      const text = '# literal <node>\n  key: value & text\n';
      const result = await runImport('sample.' + suffix, Buffer.from(text));
      assert.equal(result.text, text, suffix);
    }
  });
  await test('UTF-8 BOM is removed without trimming content', async () => {
    const result = await runImport('sample.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('  Test\n')]));
    assert.equal(result.text, '  Test\n');
  });
  await test('UTF-16 BOM endian detection and explicit GB18030 decode work', async () => {
    const text = '  中文 test\r\n';
    const little = Buffer.from(text, 'utf16le');
    const big = Buffer.from(little);
    for (let i = 0; i < big.length; i += 2) { const byte = big[i]; big[i] = big[i + 1]; big[i + 1] = byte; }
    assert.equal((await runImport('sample.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), little]))).text, text);
    assert.equal((await runImport('sample.txt', Buffer.concat([Buffer.from([0xfe, 0xff]), big]))).text, text);
    const gb = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
    assert.equal((await runImport('sample.txt', gb, { encoding: 'gb18030' })).text, '中文');
    const guessed = await runImport('sample.txt', gb);
    assert.equal(guessed.text, '中文'); assert.equal(guessed.warnings.length, 1);
  });
  await test('Empty, unsupported, binary and malformed-encoding files return content-free errors', async () => {
    assert.equal((await runImport('empty.txt', Buffer.alloc(0))).code, 'EMPTY_FILE');
    assert.equal((await runImport('empty.txt', Buffer.from(' \t\n'))).code, 'EMPTY_TEXT');
    assert.equal((await runImport('macro.docm', Buffer.from('private sentinel'))).code, 'FORMAT');
    assert.equal((await runImport('binary.txt', Buffer.from([0, 1, 2, 3]))).code, 'BINARY_TEXT');
    const result = await runImport('sample.txt', Buffer.from([0xff]), { encoding: 'utf-8' });
    assert.equal(result.code, 'ENCODING'); assert.equal(result.message.includes('sentinel'), false);
  });
  await test('File-byte and extracted-text caps are enforced', async () => {
    const metadataOnly = await page.evaluate(async () => {
      try { await window.importer.importPromptFile({ name: 'sample.txt', size: 6 * 1024 * 1024, arrayBuffer() { throw new Error('must not read'); } }); }
      catch (error) { return error.code; }
    });
    assert.equal(metadataOnly, 'FILE_TOO_LARGE');
    assert.equal((await runImport('large.txt', Buffer.from('x'.repeat(100001)))).code, 'TEXT_TOO_LARGE');
  });
  await test('HTML extracts text from an inert fragment without script execution or resource fetches', async () => {
    const html = '<html><head><style>hidden css</style></head><body><p>First &amp; line</p><p>Second<br>third</p><script>globalThis.privateImportExecuted=true</script><img src="https://do-not-request.invalid/private"><iframe src="https://do-not-request.invalid/frame"></iframe></body></html>';
    const result = await runImport('sample.html', Buffer.from(html));
    assert.equal(result.ok, true); assert.equal(result.text, 'First & line\nSecond\nthird\n');
    assert.equal(await page.evaluate(() => Boolean(window.privateImportExecuted)), false);
    assert.equal(externalRequests.length, 0);
  });
  await test('DOCX deflate and stored bodies preserve paragraphs, spaces, tab and break', async () => {
    for (const stored of [false, true]) {
      const result = await runImport('sample.docx', docx(wordXml, { stored }));
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.text, '  First & 第二行  \ttask\nNext\n\n');
      assert.equal(result.warnings.length, 1);
    }
  });
  await test('DOCX encryption, CRC corruption, truncation and missing document are rejected', async () => {
    assert.equal((await runImport('sample.docx', docx(wordXml, { encrypted: true }))).code, 'ENCRYPTED');
    assert.equal((await runImport('sample.docx', docx(wordXml, { badCrc: true }))).code, 'DOCX_INVALID');
    assert.equal((await runImport('sample.docx', docx(wordXml).subarray(0, 30))).code, 'DOCX_INVALID');
    assert.equal((await runImport('sample.docx', docx('<test>not Word</test>'))).code, 'DOCX_XML');
  });
  await test('DOCX checks declared and actual decompression sizes independently', async () => {
    assert.equal((await runImport('sample.docx', docx(wordXml, { declaredSize: 5 * 1024 * 1024 }))).code, 'DOCX_LIMIT');
    assert.equal((await runImport('sample.docx', docx(wordXml, { declaredSize: 10 }))).code, 'DOCX_LIMIT');
  });
  await test('DOCX external entities are rejected before XML parsing', async () => {
    const xml = '<!DOCTYPE document [<!ENTITY remote SYSTEM "https://do-not-request.invalid/entity">]>' + wordXml;
    assert.equal((await runImport('sample.docx', docx(xml))).code, 'DOCX_XML');
    assert.equal(externalRequests.length, 0);
  });
  await test('PDF extracts local text under a strict CSP with a real bundled Worker', async () => {
    const result = await runImport('sample.pdf', pdf());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.text, 'Synthetic local PDF prompt'); assert.equal(result.warnings.length, 1);
  });
  await test('PDF JavaScript actions are not executed', async () => {
    const result = await runImport('sample.pdf', pdf('Literal PDF text', { javascript: true }));
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.text, 'Literal PDF text');
    assert.equal(await page.evaluate(() => Boolean(window.privateImportExecuted)), false);
  });
  await test('Blank or malformed PDFs fail clearly without claiming OCR support', async () => {
    assert.equal((await runImport('scan.pdf', pdf('', { blank: true }))).code, 'PDF_NO_TEXT');
    assert.equal((await runImport('bad.pdf', Buffer.from('not a PDF with private sentinel'))).code, 'PDF_INVALID');
    assert.equal((await runImport('bad.pdf', Buffer.from('%PDF-1.4\nmalformed private sentinel'))).code, 'PDF_INVALID');
  });
  await test('Encrypted PDF is rejected promptly without storing or requesting a password', async () => {
    const started = Date.now();
    assert.equal((await runImport('locked.pdf', encryptedPdf)).code, 'ENCRYPTED');
    assert.ok(Date.now() - started < 3000, 'Encrypted import should settle without waiting for the timeout');
  });
  await test('Importing documents produces no external requests or document-bearing logs', async () => {
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(consoleMessages, []);
  });
} finally { await browser.close(); }
console.log(`RESULT ${passed}/${passed + failed} file-import scenarios passed`);
process.exitCode = failed ? 1 : 0;
