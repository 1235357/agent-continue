import assert from 'node:assert/strict';

export const catalogAuditFile = 'acceptance-catalog.events';
const events = ['initialize', 'list-request', 'list-exact', 'list-legacy-only',
  'list-missing-process', 'list-error', 'list-send-failed', 'list-canary', 'canary-response', 'canary-denied',
  'list-prepared', 'shell-exact-forwarded', 'shell-prepared-forwarded', 'shell-request-denied', 'shell-other-tool', 'shell-argument-shape',
  'shell-owner-revoked', 'append-write-forwarded', 'append-write-result', 'append-read-forwarded', 'append-denied',
  'process-start', 'process-identified', 'process-list-before', 'process-listed', 'process-stop', 'process-exited',
  'process-list-after', 'process-empty', 'process-denied',
  'shell-mismatch-command', 'shell-mismatch-shell', 'shell-mismatch-timeout_ms',
  'shell-mismatch-agent_continue_operation_id', 'shell-mismatch-agent_continue_process_sha256'];

function spliceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, 'reviewed host anchor must appear exactly once');
  return source.replace(before, () => after);
}

// Only a disposable acceptance install receives this instrumentation.
export function instrumentCatalogHost(source, { shellRequest, prepared = false, append, managedProcess } = {}) {
  assert.ok(!managedProcess || (!append && !shellRequest && !prepared));
  source = spliceOnce(source, "import process from 'node:process';",
    "import process from 'node:process';\nimport acAuditFs from 'node:fs';");
  if (managedProcess) {
    source = spliceOnce(source, "import acAuditFs from 'node:fs';",
      "import acAuditFs from 'node:fs';\nimport { createManagedProcessGate } from " +
        JSON.stringify(new URL('./hosted-managed-process.mjs', import.meta.url).href) + ';');
    source = spliceOnce(source, '    transport.onmessage = (message, ...extra) => {',
      '    transport.onmessage = async (message, ...extra) => {');
    source = spliceOnce(source, '      let args = message.params?.arguments;',
      `      if (message.method === 'tools/call' && !await acProcessGate.admit(message)) {
        reject(id, -32079, 'The disposable acceptance host did not execute this request.');
        return;
      }
      let args = message.params?.arguments;`);
  }
  const referenceFields = ['agent_continue_operation_id', 'agent_continue_process_sha256'];
  const fields = prepared ? referenceFields : ['command', 'shell', 'timeout_ms', ...referenceFields];
  const toolSymbol = prepared ? 'preparedProcessTool' : 'exactProcessTool';
  const forwarded = prepared ? 'shell-prepared-forwarded' : 'shell-exact-forwarded';
  assert.ok(shellRequest === undefined || shellRequest && Object.keys(shellRequest).length === fields.length &&
    fields.every(key => Object.hasOwn(shellRequest, key)));
  assert.ok(!append || (!shellRequest && !prepared && typeof append.write?.path === 'string' &&
    append.read?.path === append.write.path && append.write.mode === 'append' && append.read.length === 10));
  const gate = append ? `
      if (message.method === 'tools/call') {
        const actual = message.params?.arguments;
        const equal = expected => actual && typeof actual === 'object' && !Array.isArray(actual) &&
          Object.keys(actual).length === Object.keys(expected).length &&
          Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && actual[key] === value);
        if (message.params?.name === 'write_file' && !appendRequested && equal(${JSON.stringify(append.write)})) {
          appendRequested = true;
          appendRpc = id;
          catalog('append-write-forwarded');
        } else if (message.params?.name === 'read_file' && appendSucceeded && !appendRead && equal(${JSON.stringify(append.read)})) {
          appendRead = true;
          catalog('append-read-forwarded');
        } else {
          catalog('append-denied');
          reject(id, -32079, 'The disposable acceptance host did not execute this request.');
          return;
        }
      }` : shellRequest === undefined ? '' : `
      if (message.method === 'tools/call') {
        const expected = ${JSON.stringify(shellRequest)};
        const received = message.params?.arguments;
        const mismatch = [];
        if (message.params?.name !== ${toolSymbol}) mismatch.push('shell-other-tool');
        if (!received || typeof received !== 'object' || Array.isArray(received) ||
            Object.keys(received).length !== Object.keys(expected).length ||
            !Object.keys(expected).every(key => Object.hasOwn(received, key))) mismatch.push('shell-argument-shape');
        if (!mismatch.length) for (const [key, value] of Object.entries(expected)) {
          if (received[key] !== value) mismatch.push('shell-mismatch-' + key);
        }
        if (mismatch.length) {
          catalog('shell-request-denied');
          for (const reason of mismatch) catalog(reason);
          reject(id, -32079, 'The disposable acceptance host did not execute this request.');
          return;
        }
        catalog('${forwarded}');
      }`;
  source = spliceOnce(source, '  const receipts = createOperationReceipts(root);',
    `  const receipts = createOperationReceipts(root);
  ${append ? 'let appendRequested = false, appendSucceeded = false, appendRead = false, appendRpc;' : ''}
  let auditCount = 0;
  const catalog = event => {
    if (++auditCount > 64) return;
    try { acAuditFs.appendFileSync(path.join(root, '${catalogAuditFile}'), event + '\\n', { flag: 'a', mode: 0o600 }); }
    catch { /* Observation never changes the actual MCP response. */ }
  };
  ${managedProcess ? `const acProcessGate = createManagedProcessGate(${JSON.stringify(managedProcess)}, root, catalog);` : ''}`);
  source = spliceOnce(source, '    try { return await send(message, ...options); }',
    `    try {
      ${append ? `if (entry?.receipt && message.id === appendRpc && !message.error && message.result?.isError !== true &&
          Array.isArray(message.result?.content)) { appendSucceeded = true; catalog('append-write-result'); }` : ''}
      ${managedProcess ? `if (entry?.method === 'tools/call') await acProcessGate.observeReply(message, Boolean(entry.receipt));` : ''}
      const result = await send(message, ...options);
      if (entry?.method === 'tools/list') {
        const tools = message.result?.tools;
        catalog(!Array.isArray(tools) ? 'list-error' :
          tools.some(tool => tool.name === exactProcessTool) ? 'list-exact' :
          tools.some(tool => tool.name === 'start_process') ? 'list-legacy-only' : 'list-missing-process');
        if (Array.isArray(tools) && tools.some(tool => tool.name === 'agent_continue_start_prepared_process')) catalog('list-prepared');
      }
      return result;
    } catch (error) {
      if (entry?.method === 'tools/list') catalog('list-send-failed');
      throw error;
    }`);
  if (prepared) source = spliceOnce(source, '  const rejectRevoked = id => reject(id, -32074,',
    "  const rejectRevoked = id => (catalog('shell-owner-revoked'), reject(id, -32074,");
  if (prepared) source = spliceOnce(source, "This request did not execute.');\n\n  transport.send",
    "This request did not execute.'));\n\n  transport.send");
  return spliceOnce(source, '      const { id } = message;',
    `      if (message.method === 'initialize') catalog('initialize');
      if (message.method === 'tools/list') catalog('list-request');
      const { id } = message;${gate}`);
}

export function summarizeCatalogAudit(content) {
  assert.ok(content.length <= 4096, 'catalog audit exceeds fixture limit');
  const counts = Object.fromEntries(events.map(name => [name, 0]));
  for (const name of content.split('\n').filter(Boolean)) {
    assert.ok(Object.hasOwn(counts, name), 'unexpected catalog audit event');
    counts[name]++;
  }
  return counts;
}

export function hostedCanaryGate(mode, evidence, expectedDigest, observedDigest) {
  if (evidence.initialize < 1 || evidence['list-error'] !== 0 || evidence['list-send-failed'] !== 0 ||
      evidence['canary-denied'] !== 0) return false;
  if (mode === 'discovery') return evidence['list-request'] > 0 &&
    evidence['list-request'] === evidence['list-canary'];
  return mode === 'invocation' && evidence['canary-response'] === 1 &&
    typeof expectedDigest === 'string' && /^[a-f0-9]{64}$/.test(expectedDigest) && expectedDigest === observedDigest;
}
