import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tools = new Set(['read_file', 'write_file', 'agent_continue_start_process_exact', 'agent_continue_start_prepared_process']);
const denied = () => ({ isError: true, content: [{ type: 'text', text: 'The local acceptance plan did not admit this operation.' }] });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function canonical(value, depth = 0) {
  if (depth > 8) throw new Error('invalid_acceptance_plan');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => canonical(item, depth + 1)).join(',') + ']';
  if (!record(value)) throw new Error('invalid_acceptance_plan');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
}

export function createHostedAcceptanceAdmission(steps, receiptDir) {
  if (!path.isAbsolute(receiptDir) || !Array.isArray(steps) || steps.length < 1 || steps.length > 12) throw new Error('invalid_acceptance_plan');
  const plan = steps.map(step => {
    if (!record(step) || Object.keys(step).length !== 3 || !/^[a-f0-9]{32}$/.test(step.id) ||
        !tools.has(step.name) || !record(step.arguments)) throw new Error('invalid_acceptance_plan');
    const args = canonical(step.arguments);
    if (Buffer.byteLength(args) > 16384) throw new Error('invalid_acceptance_plan');
    return { id: step.id, name: step.name, args };
  });
  if (new Set(plan.map(step => step.id)).size !== plan.length ||
      new Set(plan.map(step => step.name + '\0' + step.args)).size !== plan.length) throw new Error('invalid_acceptance_plan');

  // An abandoned or previously used test scope is not resumed automatically.
  fs.mkdirSync(receiptDir, { mode: 0o700 });
  const names = new Set(plan.map(step => step.name));
  let next = 0, inFlight = false, uncertain = false;
  function persist(step, suffix) {
    fs.writeFileSync(path.join(receiptDir, step.id + '.' + suffix), '', { flag: 'wx', mode: 0o600, flush: true });
  }
  function list(listed) {
    return listed.filter(tool => names.has(tool.name));
  }
  async function call(request, forward) {
    const step = plan[next];
    if (uncertain || inFlight || !step || !record(request) || step.name !== request.name || !record(request.arguments)) return denied();
    let args;
    try { args = canonical(request.arguments); } catch { return denied(); }
    if (args !== step.args) return denied();
    inFlight = true;
    try {
      persist(step, 'admitted');
      const result = await forward({ name: step.name, arguments: JSON.parse(step.args) });
      if (!record(result) || result.isError === true || !Array.isArray(result.content)) {
        uncertain = true;
        return denied();
      }
      persist(step, 'provider-replied');
      next++;
      return result;
    } catch {
      uncertain = true;
      return denied();
    } finally { inFlight = false; }
  }
  return Object.freeze({ list, call });
}

// The protected launcher supplies the exact bundle, state and plan. This is a
// test-only MCP endpoint, not an alternate remote transport or production role.
export async function runHostedAcceptanceStdio({ bundle, stateRoot, steps, receiptDir, planFile }) {
  const app = path.join(bundle, 'app');
  if (!path.isAbsolute(bundle) || !path.isAbsolute(stateRoot) ||
      path.dirname(receiptDir) !== stateRoot || process.env.AC_ADMIN_BOOT_APP_ROOT !== app) throw new Error('invalid_acceptance_environment');
  const inherited = { ...process.env };
  if (planFile !== undefined) {
    if (steps !== undefined || path.dirname(planFile) !== path.join(stateRoot, 'work') ||
        !/^acceptance-[a-f0-9]{32}\.plan\.json$/.test(path.basename(planFile))) throw new Error('invalid_acceptance_plan');
    const stat = fs.lstatSync(planFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536) throw new Error('invalid_acceptance_plan');
    steps = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(planFile)));
  }
  const admission = createHostedAcceptanceAdmission(steps, receiptDir);
  const loader = pathToFileURL(path.join(stateRoot, 'startup-imports.mjs')).href;
  await import(loader);
  const sdk = name => import(pathToFileURL(path.join(app, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', name)).href);
  const [{ Client }, { StdioClientTransport }, { Server }, { StdioServerTransport }, protocol] = await Promise.all([
    sdk('client/index.js'), sdk('client/stdio.js'), sdk('server/index.js'), sdk('server/stdio.js'), sdk('types.js'),
  ]);
  const upstream = new Client({ name: 'agent-continue-acceptance-admission', version: '1.0.0' });
  const core = new StdioClientTransport({ command: process.execPath, args: ['--no-global-search-paths', '--import', loader,
    path.join(app, 'host.mjs'), '--state-dir', stateRoot], cwd: path.join(stateRoot, 'work'), env: inherited, stderr: 'ignore' });
  const front = new Server({ name: 'agent-continue-windows-acceptance', version: '1.0.0' }, { capabilities: { tools: {} } });
  let closing;
  const close = () => closing ??= Promise.resolve().then(async () => {
    await upstream.close().catch(() => {});
    await front.close().catch(() => {});
    process.stdin.pause();
  });
  process.stdin.once('end', () => { void close(); });
  front.onclose = () => { void close(); };
  upstream.onclose = () => { void close(); };
  process.once('SIGTERM', () => { void close(); });
  process.once('SIGINT', () => { void close(); });
  try {
    await upstream.connect(core, { timeout: 10000 });
    front.setRequestHandler(protocol.ListToolsRequestSchema, async () => ({ tools: admission.list((await upstream.listTools()).tools) }));
    front.setRequestHandler(protocol.CallToolRequestSchema, request => admission.call(request.params,
      params => upstream.callTool(params, undefined, { timeout: 20000 })));
    await front.connect(new StdioServerTransport());
  } catch {
    await close();
    throw new Error('acceptance_stdio_unconfirmed');
  }
}
