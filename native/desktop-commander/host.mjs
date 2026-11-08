import process from 'node:process';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const operationField = 'agent_continue_operation_id';
const operationPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const operationId = new RegExp(operationPattern);
const validOperationId = value => typeof value === 'string' && value.length === 36 && operationId.test(value);
const operationStatusTool = 'agent_continue_operation_status';
const exactProcessTool = 'agent_continue_start_process_exact';
const preparedProcessTool = 'agent_continue_start_prepared_process';
const processDigestField = 'agent_continue_process_sha256';
const processDigestPattern = '^[0-9a-f]{64}$';
const processDigest = new RegExp(processDigestPattern);
const exactProcessFields = ['command', 'shell', 'timeout_ms', operationField, processDigestField];
const mutationTools = new Set(['write_file', 'write_pdf', 'create_directory', 'move_file', 'edit_block',
  'start_process', 'interact_with_process', 'force_terminate', 'kill_process', 'set_config_value',
  'give_feedback_to_desktop_commander']);

function exactProcessArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).length !== exactProcessFields.length ||
      !exactProcessFields.every(key => Object.hasOwn(args, key))) return null;
  const { command, shell, timeout_ms, [operationField]: operation, [processDigestField]: expected } = args;
  if (typeof command !== 'string' || !command.trim() || command.includes('\0') ||
      typeof shell !== 'string' || shell !== shell.trim() || shell.includes('\0') ||
      !(process.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(shell) : path.isAbsolute(shell)) ||
      !Number.isSafeInteger(timeout_ms) || timeout_ms < 1 ||
      !validOperationId(operation) || typeof expected !== 'string' || expected.length !== 64 ||
      !processDigest.test(expected)) return null;
  return { arguments: { command, shell, timeout_ms, [operationField]: operation },
    matches: createHash('sha256').update(JSON.stringify([command, shell, timeout_ms]), 'utf8').digest('hex') === expected };
}

function describeExactProcessTool() {
  return {
    name: exactProcessTool, title: 'Start Process (Exact Arguments)',
    description: 'Start a process under the authorized device account only if command, absolute shell path, and timeout match a caller-supplied SHA-256. Use an independently generated digest; do not regenerate it after changing the request. A mismatch does not start a process.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: { type: 'object', properties: {
      command: { type: 'string', minLength: 1 },
      shell: { type: 'string', description: 'Absolute path to the shell on this device.' },
      timeout_ms: { type: 'integer', minimum: 1 },
      [operationField]: { type: 'string', pattern: operationPattern },
      [processDigestField]: { type: 'string', pattern: processDigestPattern,
        description: 'Lowercase SHA-256 of UTF-8 JSON.stringify([command, shell, timeout_ms]); do not normalize the strings.' },
    }, required: exactProcessFields, additionalProperties: false },
  };
}

function describePreparedProcessTool() {
  return {
    name: preparedProcessTool, title: 'Start Prepared Process',
    description: 'Start the command already prepared on this device for the supplied operation ID and SHA-256. This starts a real process under the device account. Do not supply command text or repeat the operation with a new ID.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: { type: 'object', properties: {
      [operationField]: { type: 'string', pattern: operationPattern },
      [processDigestField]: { type: 'string', pattern: processDigestPattern },
    }, required: [operationField, processDigestField], additionalProperties: false },
  };
}

const localControlCode = -32075;
const localControlMessage = 'The device owner paused or revoked administrator access. This request did not execute.';

export function fenceToolReplays(transport, root, prepared, validateProcessReference, receiptStore,
  canAdmit, server, cancellationSchema) {
  const pending = new Map();
  let flushing = 0;
  const { createOperationReceipts, providerResult, providerError } = receiptStore;
  const receipts = createOperationReceipts(root);
  const send = transport.send.bind(transport);
  const start = transport.start.bind(transport);
  const reject = (id, code, message) => {
    void send({ jsonrpc: '2.0', id, error: { code, message } }).catch(() => {});
  };
  const rejectRevoked = id => reject(id, -32074, 'The device owner revoked this operation before admission. This request did not execute.');
  const rejectLocalControl = id => reject(id, localControlCode, localControlMessage);
  const settleBlocked = receipt => {
    if (!receipt) return;
    try { receipts.recordBlocked(receipt); }
    catch { /* A failed write leaves the reservation unconfirmed and non-replayable. */ }
  };
  let requestControllers;
  if (server !== undefined) {
    // The pinned SDK queues its registered handler after transport dispatch.
    // Wrap that handler without replacing the provider's validation or routing.
    const handlers = server._requestHandlers;
    const callTool = handlers instanceof Map && handlers.get('tools/call');
    requestControllers = server._requestHandlerAbortControllers;
    if (typeof callTool !== 'function' || !(requestControllers instanceof Map) ||
        typeof cancellationSchema?.safeParse !== 'function') throw new Error('sdk_tool_handler_unavailable');
    handlers.set('tools/call', (request, extra) => {
      const entry = pending.get(request.id);
      if (entry?.request !== request || entry.handlerStarted || extra?.requestId !== request.id || extra.signal?.aborted) {
        throw Object.assign(new Error('Tool request has no matching local admission.'), { code: -32071 });
      }
      if (canAdmit && !canAdmit()) {
        const { receipt } = entry;
        // The outgoing SDK error must not be mistaken for a provider result.
        entry.receipt = undefined;
        settleBlocked(receipt);
        throw Object.assign(new Error(localControlMessage), { code: localControlCode });
      }
      entry.handlerStarted = true;
      return callTool(request, extra);
    });
  }

  transport.send = async (message, ...options) => {
    let entry;
    if (!Object.hasOwn(message, 'method') && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))) {
      entry = pending.get(message.id);
      if (entry) entry.sending = true;
      if (entry?.receipt) {
        const status = message.error || message.result?.isError === true ? providerError :
          Array.isArray(message.result?.content) ? providerResult : null;
        if (status) {
          try { receipts.recordResponse(entry.receipt, status); }
          catch { /* Deliver the actual response; the receipt may remain unconfirmed. */ }
        }
      }
      if (entry?.method === 'tools/list' && Array.isArray(message.result?.tools)) {
        const tools = message.result.tools.map(tool => !mutationTools.has(tool.name) || tool.inputSchema?.type !== 'object' ? tool : {
          ...tool, inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties,
            [operationField]: { type: 'string', pattern: operationPattern,
              description: 'Optional fresh lowercase UUIDv4 for this operation. Reuse it only when checking or resending the same operation. If it was admitted, verify its effects instead of retrying with a new ID.' },
          } },
        });
        if (tools.some(tool => tool.name === 'start_process') &&
            !tools.some(tool => tool.name === exactProcessTool)) tools.push(describeExactProcessTool());
        if (tools.some(tool => tool.name === 'start_process') &&
            !tools.some(tool => tool.name === preparedProcessTool)) tools.push(describePreparedProcessTool());
        if (!tools.some(tool => tool.name === operationStatusTool)) tools.push({
          name: operationStatusTool, title: 'Check Operation Receipt',
          description: 'Read the local receipt for a previously supplied AgentContinue operation ID. A recorded result or error does not prove the final effect. A missing or unconfirmed receipt is not permission to retry with a new ID.',
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          inputSchema: { type: 'object', properties: { [operationField]: { type: 'string', pattern: operationPattern } },
            required: [operationField], additionalProperties: false },
        });
        message = { ...message, result: { ...message.result, tools } };
      }
    }
    if (!entry) return send(message, ...options);
    flushing++;
    try {
      let delivery;
      try { delivery = send(message, ...options); }
      finally {
        // Stdio enqueues synchronously. Its drain promise is stream-wide,
        // so it cannot keep a completed wire ID reserved.
        if (pending.get(message.id) === entry) pending.delete(message.id);
      }
      return await delivery;
    } finally { flushing--; }
  };
  transport.start = () => {
    // The SDK installs onmessage in connect(), immediately before start().
    const dispatch = transport.onmessage.bind(transport);
    transport.onmessage = (message, ...extra) => {
      if (!Object.hasOwn(message, 'method') || !Object.hasOwn(message, 'id')) {
        if (canAdmit && message.method === 'tools/call') return;
        if (requestControllers && message.method === 'notifications/cancelled') {
          const cancellation = cancellationSchema.safeParse(message);
          if (!cancellation.success) return;
          const { requestId, reason } = cancellation.data.params;
          const entry = pending.get(requestId);
          const controller = requestControllers.get(requestId);
          // Match and abort now: an SDK-queued cancellation could target a
          // different request that has reused the same wire ID.
          if (!entry || entry.sending || entry.method === 'initialize' || !(controller instanceof AbortController)) return;
          controller.abort(reason);
          if (controller.signal.aborted && pending.get(requestId) === entry) pending.delete(requestId);
          return;
        }
        return dispatch(message, ...extra);
      }
      const { id } = message;
      // Shared stdio may see ID reuse after settlement from a different logical
      // caller. Only suppress overlapping RPC IDs; durable identity is explicit.
      if (pending.has(id)) return;
      if (message.method === 'tools/call' && canAdmit && !canAdmit()) {
        rejectLocalControl(id);
        return;
      }
      if (pending.size + flushing >= 4096) {
        reject(id, -32071, 'Too many pending requests: this request did not execute.');
        return;
      }
      let args = message.params?.arguments;
      let kind;
      if (message.method === 'tools/call' && message.params?.name === preparedProcessTool) {
        if (!validateProcessReference(args)) {
          reject(id, -32602, 'A prepared process requires only its operation ID and digest. This request did not execute.');
          return;
        }
        if (receipts.lookup(args[operationField]).status === 'owner-revoked') {
          rejectRevoked(id);
          return;
        }
        try { args = prepared.lookup(args); }
        catch {
          reject(id, -32073, 'The prepared process is missing, expired, or does not match. This request did not execute.');
          return;
        }
        kind = 'prepared-process';
        message = { ...message, params: { ...message.params, name: 'start_process', arguments: args } };
      } else if (message.method === 'tools/call' && message.params?.name === exactProcessTool) {
        const exact = exactProcessArguments(args);
        if (!exact) {
          reject(id, -32602, 'Exact process arguments are invalid or incomplete. This request did not execute.');
          return;
        }
        if (!exact.matches) {
          reject(id, -32072, 'Exact process arguments do not match the supplied digest. This request did not execute.');
          return;
        }
        // Enter the same durable admission path as the normal provider call.
        kind = 'exact-process';
        args = exact.arguments;
        message = { ...message, params: { ...message.params, name: 'start_process', arguments: args } };
      } else if (message.method === 'tools/call' && args && typeof args === 'object' &&
          Object.hasOwn(args, processDigestField)) {
        reject(id, -32602, 'A process digest requires an exact or prepared process tool. This request did not execute.');
        return;
      }
      if (message.method === 'tools/call' && message.params?.name === operationStatusTool) {
        if (!args || typeof args !== 'object' || Object.keys(args).length !== 1 ||
            !Object.hasOwn(args, operationField) || !validOperationId(args[operationField])) {
          reject(id, -32602, 'A single lowercase UUIDv4 operation ID is required.');
          return;
        }
        const result = receipts.lookup(args[operationField]);
        pending.set(id, { method: message.method, sending: false });
        void transport.send({ jsonrpc: '2.0', id, result: {
          structuredContent: result, content: [{ type: 'text', text: result.status }],
        } }).catch(() => {});
        return;
      }
      let receipt;
      if (message.method === 'tools/call' && mutationTools.has(message.params?.name) &&
          args && typeof args === 'object' && Object.hasOwn(args, operationField)) {
        const { [operationField]: operation, ...upstream } = args;
        if (!validOperationId(operation)) {
          reject(id, -32602, 'Operation ID must be a lowercase UUIDv4. This request did not execute.');
          return;
        }
        try { receipt = receipts.reserve(operation, kind); }
        catch {
          reject(id, -32071, 'Operation reservation unavailable: this delivery did not execute. Inspect device state before retrying.');
          return;
        }
        if (!receipt) {
          if (receipts.lookup(operation).status === 'owner-revoked') rejectRevoked(id);
          else reject(id, -32070, 'Operation already reserved: this delivery did not execute. Check agent_continue_operation_status with the same ID and verify the original effect before retrying.');
          return;
        }
        message = { ...message, params: { ...message.params, arguments: upstream } };
      }
      // Disk reservation and prepared-command lookup can overlap a local
      // Pause or Revoke in another process. Recheck before provider dispatch.
      if (message.method === 'tools/call' && canAdmit && !canAdmit()) {
        settleBlocked(receipt);
        rejectLocalControl(id);
        return;
      }
      pending.set(id, { method: message.method, sending: false, receipt,
        ...(server && message.method === 'tools/call' ? { request: message } : {}) });
      return dispatch(message, ...extra);
    };
    return start();
  };
}

export async function closeHostResources(server, administratorAdmission) {
  let witness;
  try { witness = Promise.resolve(administratorAdmission?.close()); }
  catch (error) { witness = Promise.reject(error); }
  const results = await Promise.allSettled([witness, Promise.resolve().then(() => server.close())]);
  if (results[0].status === 'rejected') throw results[0].reason;
}

async function main() {
  // All fallible local imports belong inside the sanitized launch boundary.
  const { buildHostLaunch, readState, validateConfig, verifyUpstream } = await import('./runtime.mjs');
  const { wrapWindowsChildren } = await import('./windows-child.mjs');
  const { openPreparedProcesses, validateProcessReference } = await import('./prepared-process.mjs');
  const receiptStore = await import('./operation-receipts.mjs');
  const administratorOwner = process.argv.length === 5 && process.argv[4] === '--administrator-owner';
  if ((!administratorOwner && process.argv.length !== 4) || process.argv[2] !== '--state-dir') throw new Error('invalid_arguments');
  const root = process.argv[3];
  const administratorAdmission = administratorOwner ?
    await (await import('./windows-admin-owner.mjs')).openWindowsAdministratorAdmission(root) : null;
  const canAdmit = administratorAdmission?.canAdmit ?? null;
  try {
    const launch = buildHostLaunch(root);
    for (const key of Object.keys(process.env)) if (!(key in launch.env)) delete process.env[key];
    Object.assign(process.env, launch.env);
    process.chdir(launch.cwd);
    verifyUpstream();
    if (process.platform === 'win32') { wrapWindowsChildren(childProcess); syncBuiltinESMExports(); }
    globalThis.disableOnboarding = true;
    const upstream = new URL('./node_modules/@wonderwhy-er/desktop-commander/dist/', import.meta.url);
    const { FilteredStdioServerTransport } = await import(new URL('custom-stdio.js', upstream));
    const transport = new FilteredStdioServerTransport();
    globalThis.mcpTransport = transport;
    // Load the server root first: upstream config/capture modules form an ESM cycle.
    const { server, flushDeferredMessages } = await import(new URL('server.js', upstream));
    const { configManager } = await import(new URL('config-manager.js', upstream));
    await configManager.loadConfig();
    validateConfig(await configManager.getConfig());
    const stateRoot = readState(root).root;
    const { CancelledNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
    fenceToolReplays(transport, stateRoot, openPreparedProcesses(stateRoot), validateProcessReference,
      receiptStore, canAdmit, server, CancelledNotificationSchema);
    server.oninitialized = () => { transport.enableNotifications(); flushDeferredMessages(); };
    let closing = false;
    async function close(code) {
      if (closing) return;
      closing = true;
      // Allow the native witness's 3s graceful + 3s exact-process settlement;
      // exhausting this outer bound is unconfirmed, never a successful exit.
      const timer = setTimeout(() => process.exit(1), 9000);
      timer.unref();
      try { await closeHostResources(server, administratorAdmission); }
      catch { process.exit(1); }
      clearTimeout(timer);
      process.exit(code);
    }
    process.stdin.once('end', () => void close(0));
    process.once('SIGINT', () => void close(0));
    process.once('SIGTERM', () => void close(0));
    if (administratorAdmission?.finished) void administratorAdmission.finished.then(() => close(0));
    await server.connect(transport);
  } catch (error) {
    await administratorAdmission?.close();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Never print paths, environment, raw upstream errors or stacks at the launch boundary.
    process.stderr.write('agent_continue_native_start_failed\n');
    process.exit(1);
  });
}
