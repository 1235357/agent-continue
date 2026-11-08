import http from 'node:http';
import fs from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const assets = new Set(['devices.html', 'devices.js', 'devices.css', 'device-control.js', 'browser-wake.js', 'admin-browser.js', 'admin-control.js', 'i18n.js',
  'setup.html', 'setup.js', 'setup-model.js', 'setup.css', 'icons/icon-32.png',
  'native/bootstrap/install-plan.mjs', 'native/bootstrap/registration-status-view.mjs']);
const fixture = String.raw`
(() => {
  const data = {}, listeners = [], calls = [];
  let paused = false, revoked = false;
  const ownerId = 'fixture-owner';
  const operationId = 'ae900800-b673-4eee-abe5-e7267e0d46b1', digest = 'b'.repeat(64);
  const render = () => {
    let output = document.getElementById('fixture-calls');
    if (!output) {
      output = document.createElement('pre');
      output.id = 'fixture-calls';
      output.setAttribute('aria-label', 'Isolated fixture calls');
      document.body.append(output);
    }
    output.textContent = 'ISOLATED TEST: simulated native bridge; no operating-system action.\n' + JSON.stringify(calls, null, 2);
  };
  globalThis.chrome = {
    storage: {
      onChanged: { addListener: listener => listeners.push(listener) },
      local: {
        async get(keys) { return Object.fromEntries(keys.map(key => [key, structuredClone(data[key])])); },
        async set(values) {
          const changes = Object.fromEntries(Object.entries(values).map(([key, value]) =>
            [key, { oldValue: data[key], newValue: structuredClone(value) }]));
          Object.assign(data, structuredClone(values));
          for (const listener of listeners) listener(changes, 'local');
        },
      },
    },
    permissions: { contains: async () => true, request: async () => false },
    runtime: {
      id: 'jpioilmpbolfokedaefmbfbjeaahfdkl',
      async sendMessage(message) {
        const { request } = message;
        const { version, id, action } = request;
        if (message.type !== 'BROWSER_DEVICE_CONTROL_V1') return null;
        if (action === 'status' && message.ownerId === null) {
          calls.push({ action });
          render();
          return { ownerId, response: { version, id, action, ok: true, state: { paused, connection: 'unknown' } } };
        }
        if (message.ownerId !== ownerId || !['prepared-review', 'prepared-revoke'].includes(action)) return null;
        calls.push({ action });
        render();
        if (request.operationId !== operationId || request.sha256 !== digest) {
          return { ownerId, response: { version, id, action, ok: false } };
        }
        if (action === 'prepared-revoke') revoked = true;
        return { ownerId, response: { version, id, action, ok: true,
          status: revoked ? 'owner-revoked' : 'staged', expiresAt: Date.now() + 60000 } };
      },
      async sendNativeMessage(host, request) {
        calls.push({ action: request.action });
        render();
        if (request.action !== 'status') paused = request.action === 'disconnect-and-pause';
        return { ...request, ok: true, state: {
          paused, connection: paused ? 'disconnected' : 'ready',
          ...(request.action === 'status' ? {} : {
            operation: { id: request.id, action: request.action, status: 'settled' },
          }),
        } };
      },
    },
  };
  document.addEventListener('DOMContentLoaded', render);
})();
`;

const server = http.createServer(async (request, response) => {
  const target = new URL(request.url, 'http://127.0.0.1');
  const name = target.pathname.slice(1) || 'devices.html';
  const validQuery = !target.search || name === 'devices.html' && target.search === '?mode=browser-managed';
  if (request.method !== 'GET' || !validQuery || (!assets.has(name) && name !== 'fixture.js')) {
    response.writeHead(404).end();
    return;
  }
  try {
    let body = name === 'fixture.js' ? fixture : await fs.readFile(new URL(name, root), name.endsWith('.png') ? undefined : 'utf8');
    if (['devices.html', 'setup.html'].includes(name)) body = body.replace('<head>', '<head><script src="/fixture.js"></script>');
    if (name === 'devices.css') body += '\n#fixture-calls{white-space:pre-wrap;overflow-wrap:anywhere;}\n';
    response.writeHead(200, {
      'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' :
        name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.png') ? 'image/png' : 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; object-src 'none'",
    });
    response.end(body);
  } catch { response.writeHead(500).end(); }
});
server.listen(0, '127.0.0.1', () => {
  console.log('DeviceFixtureURL=http://127.0.0.1:' + server.address().port + '/devices.html');
});
const stop = () => { server.closeAllConnections(); server.close(); process.stdin.pause(); };
process.stdin.resume();
process.stdin.on('data', chunk => { if (chunk.toString('utf8').trim() === 'stop') stop(); });
const deadline = setTimeout(stop, 120000);
server.on('close', () => clearTimeout(deadline));
