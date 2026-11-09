// Local Node fixtures only: no browser, account, scheduler, or user files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(fileURLToPath(new URL('../config.js', import.meta.url))));
const { readConfig } = await import(pathToFileURL(path.join(root, 'config.js')));
const { importPromptFile, SUPPORTED_ACCEPT, MAX_FILE_BYTES } = await import(pathToFileURL(path.join(root, 'file-import.js')));
const popup = readFileSync(path.join(root, 'popup.js'), 'utf8');
const html = readFileSync(path.join(root, 'popup.html'), 'utf8');
const longText = '  \t' + 'literal \u4e2d\u6587\ud83d\ude80\r\n'.repeat(12000) + '\r\n\t  ';
const file = (name, bytes) => ({ name, size: bytes.byteLength,
  async arrayBuffer() { return Uint8Array.from(bytes).buffer; } });

test('repeat prompts above 100000 characters retain every code unit through JSON round trips', () => {
  assert.ok(longText.length > 100000);
  const input = { prompt: longText };
  assert.equal(readConfig(input).prompt, longText);
  assert.equal(readConfig(JSON.parse(JSON.stringify(readConfig(input)))).prompt, longText);
  assert.deepEqual(input, { prompt: longText });
});

test('queued prompts above both the per-item and 600000 aggregate caps remain exact', () => {
  const queue = Array.from({ length: 5 }, (_, index) => ({ name: 'Item ' + index, text: longText + index }));
  assert.ok(queue.reduce((size, item) => size + item.text.length, 0) > 600000);
  for (const mode of ['queue-once', 'queue-loop']) {
    const config = readConfig({ mode, queue });
    assert.deepEqual(config.queue, queue);
    assert.deepEqual(readConfig(JSON.parse(JSON.stringify(config))).queue, queue);
  }
});

test('prompt validation still rejects wrong types and empty active payloads without trimming', () => {
  for (const prompt of [null, false, 42, {}, []]) assert.throws(() => readConfig({ prompt }));
  assert.throws(() => readConfig({ prompt: ' \t\r\n' }));
  assert.equal(readConfig({ prompt: ' \t\r\n' }, { allowEmpty: true }).prompt, ' \t\r\n');
  for (const text of [null, false, 42, {}, [], '', ' \t\n']) {
    assert.throws(() => readConfig({ mode: 'queue-once', queue: [{ text }] }));
  }
});

test('interval, send-count, queue-count and stop-marker bounds are unchanged', () => {
  for (const intervalMinutes of [0, 10081, Infinity]) assert.throws(() => readConfig({ prompt: 'x', intervalMinutes }));
  for (const maxSends of [-1, 1000001, 1.5]) assert.throws(() => readConfig({ prompt: 'x', maxSends }));
  assert.throws(() => readConfig({ mode: 'queue-once', queue: Array.from({ length: 51 }, () => ({ text: 'x' })) }));
  assert.throws(() => readConfig({ prompt: 'x', stopMarkers: ['x'.repeat(101)] }));
  assert.equal(readConfig({ prompt: 'x', intervalMinutes: 10080, maxSends: 1000000 }).maxSends, 1000000);
});

test('plain and structured text imports above 100000 characters are verbatim', async () => {
  for (const suffix of ['txt', 'md', 'json', 'csv', 'xml']) {
    assert.equal((await importPromptFile(file('literal.' + suffix, Buffer.from(longText)))).text, longText);
  }
});

test('text file bytes above 5 MiB are not a prompt limit', async () => {
  const text = ' \t' + 'x'.repeat(MAX_FILE_BYTES + 1) + '\r\n  ';
  assert.equal((await importPromptFile(file('large.txt', Buffer.from(text)))).text, text);
});

test('binary document resource guards still reject oversized DOCX/PDF before reading', async () => {
  for (const suffix of ['docx', 'pdf']) {
    let reads = 0;
    await assert.rejects(importPromptFile({ name: 'large.' + suffix, size: MAX_FILE_BYTES + 1,
      arrayBuffer() { reads++; throw new Error('Must not read'); } }), { code: 'FILE_TOO_LARGE' });
    assert.equal(reads, 0);
  }
});

test('file validation retains empty, binary, unsupported and byte-mismatch failures', async () => {
  await assert.rejects(importPromptFile(file('empty.txt', Buffer.alloc(0))), { code: 'EMPTY_FILE' });
  await assert.rejects(importPromptFile(file('blank.txt', Buffer.from(' \t\n'))), { code: 'EMPTY_TEXT' });
  await assert.rejects(importPromptFile(file('binary.txt', Buffer.from([0, 1]))), { code: 'BINARY_TEXT' });
  await assert.rejects(importPromptFile(file('archive.zip', Buffer.from('x'))), { code: 'FORMAT' });
  await assert.rejects(importPromptFile({ ...file('bad.txt', Buffer.from('x')), size: 2 }), { code: 'FILE_SIZE' });
});

function listener(id, context) {
  const match = popup.match(new RegExp("\\$\\('" + id + "'\\)\\.addEventListener\\('[^']+', ([\\s\\S]*?)\\r?\\n\\}\\);"));
  assert.ok(match, 'Production listener must be found: ' + id);
  return vm.runInNewContext('(' + match[1] + '\n})', context);
}

function popupContext() {
  const nodes = new Map();
  const messages = [];
  const context = {
    $: id => { if (!nodes.has(id)) nodes.set(id, { value: '', accept: '', removeAttribute() {} }); return nodes.get(id); },
    clone: structuredClone, readConfig, canEdit: () => true, queueEditing: 0,
    draftConfig: readConfig({ prompt: 'original', queue: [{ name: 'Item', text: 'original' }] }),
    contentEpoch: 0, latestJob: null, SUPPORTED_ACCEPT,
    importing: false, queueSignature: '',
    t: key => key, tell: (message, error) => messages.push({ message, error }),
    safeFailure: error => error.message, closeQueueEditor() {}, hidePrompt() {},
    saveDraft() {}, paint() {}, async persistDraftNow() {},
  };
  return { context, nodes, messages };
}

test('popup HTML and initialization impose no prompt/queue textarea maxlength', () => {
  for (const id of ['prompt', 'queueText']) {
    const tag = html.match(new RegExp('<textarea\\b[^>]*\\bid="' + id + '"[^>]*>'))?.[0];
    assert.ok(tag, id);
    assert.doesNotMatch(tag, /maxlength/i);
  }
  const { context, nodes } = popupContext();
  const start = popup.indexOf("$('promptFile').accept");
  const end = popup.indexOf('function setMessage', start);
  vm.runInNewContext(popup.slice(start, end), context);
  for (const id of ['prompt', 'queueText']) assert.equal(nodes.get(id)?.maxLength, undefined);
});

test('localized import notice distinguishes prompt capacity from document parser bounds', async () => {
  const { default: catalog } = await import(pathToFileURL(path.join(root, 'i18n-html.js')));
  const notice = Object.keys(catalog).find(key => html.includes(key) && catalog[key].includes('application-set prompt character limit'));
  assert.ok(notice, 'The active HTML notice must have an English translation');
  assert.match(catalog[notice], /browser storage, memory, and the target platform/);
  assert.match(catalog[notice], /DOCX\/PDF files are limited to 5 MiB/);
  assert.doesNotMatch(catalog[notice], /100,000 characters/);
});

test('queue edit saves long text exactly and still rejects whitespace-only text', () => {
  const { context, messages } = popupContext();
  context.$('queueText').value = longText;
  context.$('queueName').value = 'Item';
  listener('saveQueueItem', context)();
  assert.equal(context.draftConfig.queue[0].text, longText);
  assert.ok(messages.every(message => !message.error));
  context.$('queueText').value = ' \t\r\n';
  listener('saveQueueItem', context)();
  assert.equal(context.draftConfig.queue[0].text, longText);
  assert.equal(messages.at(-1).error, true);
});

test('config import above 10 MiB accepts full prompt text and reports storage failure honestly', async () => {
  const { context, messages } = popupContext();
  const checked = popup.match(/function checkedImport\(value\) \{[\s\S]*?\r?\n\}/)?.[0];
  assert.ok(checked);
  context.checkedImport = vm.runInNewContext('(' + checked + ')', context);
  const text = ' \t' + 'x'.repeat(10 * 1024 * 1024 + 1) + '\r\n  ';
  const json = JSON.stringify({ prompt: text });
  const event = { target: { files: [{ size: Buffer.byteLength(json), async text() { return json; } }] } };
  const handle = listener('configFile', context);
  await handle(event);
  assert.equal(context.draftConfig.prompt, text);
  assert.ok(messages.every(message => !message.error));
  context.persistDraftNow = async () => { throw new Error('Synthetic storage quota'); };
  await handle(event);
  assert.equal(messages.at(-1).error, true);
  assert.equal(context.draftConfig.prompt, text);
});
