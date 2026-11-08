import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('canary has one fixed output and rejects commands, file reads, and extra arguments', { timeout: 10000 }, async () => {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'ac-catalog-canary-'));
  const marker = 'AC_CANARY_' + randomBytes(16).toString('hex');
  const client = new Client({ name: 'catalog-canary-test', version: '1.0.0' });
  try {
    await fs.writeFile(path.join(root, 'acceptance-catalog.marker'), marker + '\n', { flag: 'wx' });
    const entry = fileURLToPath(new URL('./test-fixtures/hosted-catalog-canary.mjs', import.meta.url));
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry, '--state-dir', root],
      cwd: root, stderr: 'ignore' }));
    const { tools } = await client.listTools();
    const name = 'agent_continue_catalog_canary';
    assert.deepEqual(tools.map(tool => tool.name), [name]);
    assert.equal(tools[0].annotations.readOnlyHint, true);
    assert.equal(tools[0].inputSchema.additionalProperties, false);
    for (const request of [{ name: 'start_process', arguments: { command: 'unexpected' } },
      { name: 'read_file', arguments: { path: 'unexpected' } }, { name, arguments: { extra: true } }]) {
      await assert.rejects(client.callTool(request), { code: -32602 });
    }
    assert.deepEqual((await client.callTool({ name, arguments: {} })).content, [{ type: 'text', text: marker }]);
    const events = (await fs.readFile(path.join(root, 'acceptance-catalog.events'), 'utf8')).trim().split('\n');
    assert.deepEqual(events, ['initialize', 'list-request', 'list-canary',
      'canary-denied', 'canary-denied', 'canary-denied', 'canary-response']);
  } finally {
    await client.close();
    assert.equal(path.dirname(root), parent);
    assert.match(path.basename(root), /^ac-catalog-canary-/);
    await fs.rm(root, { recursive: true, force: true });
  }
});
