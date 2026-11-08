import { appendFileSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';

const name = 'agent_continue_catalog_canary';

async function main() {
  const root = process.argv[3];
  if (process.argv.length !== 4 || process.argv[2] !== '--state-dir' || !path.isAbsolute(root)) throw new Error();
  const markerFile = path.join(root, 'acceptance-catalog.marker');
  const info = lstatSync(markerFile);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== 43) throw new Error();
  const marker = readFileSync(markerFile, 'utf8');
  if (!/^AC_CANARY_[a-f0-9]{32}\n$/.test(marker)) throw new Error();
  let count = 0;
  const audit = event => {
    if (++count > 64) return;
    try { appendFileSync(path.join(root, 'acceptance-catalog.events'), event + '\n', { mode: 0o600 }); }
    catch { /* Audit failure does not affect discovery. */ }
  };
  const server = new Server({ name: 'agent-continue-catalog-canary', version: '1.0.0' },
    { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [{
    name, description: 'Return one test marker. This acceptance tool never reads user data or runs commands.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }] }));
  server.setRequestHandler(CallToolRequestSchema, ({ params }) => {
    if (params.name !== name || Object.keys(params.arguments ?? {}).length) {
      audit('canary-denied');
      throw new McpError(ErrorCode.InvalidParams, 'Canary expects its exact tool name and no arguments.');
    }
    return { content: [{ type: 'text', text: marker.trimEnd() }] };
  });
  const transport = new StdioServerTransport();
  const start = transport.start.bind(transport), send = transport.send.bind(transport);
  const pending = new Map();
  transport.start = () => {
    const dispatch = transport.onmessage;
    transport.onmessage = message => {
      if (message.method === 'initialize') audit('initialize');
      if (message.method === 'tools/list') audit('list-request');
      if (Object.hasOwn(message, 'id') && ['tools/list', 'tools/call'].includes(message.method) && pending.size < 64) {
        pending.set(message.id, message.method);
      }
      return dispatch(message);
    };
    return start();
  };
  transport.send = async (message, options) => {
    const method = pending.get(message.id);
    try {
      await send(message, options);
      if (method === 'tools/list') audit(message.error ? 'list-error' : 'list-canary');
      if (method === 'tools/call' && !message.error) audit('canary-response');
    } catch (error) {
      if (method === 'tools/list') audit('list-send-failed');
      throw error;
    } finally { if (method) pending.delete(message.id); }
  };
  await server.connect(transport);
}

main().catch(() => {
  process.stderr.write('agent_continue_catalog_canary_start_failed\n');
  process.exitCode = 1;
});
