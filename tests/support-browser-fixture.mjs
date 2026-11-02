import http from 'node:http';
import fs from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const assets = new Set(['support.html', 'support.css', 'support.js', 'support-info.js', 'activity-export.js', 'i18n.js', 'icons/icon-48.png']);
const fixture = String.raw`
(() => {
  const state = { uiLanguage: 'en', logs: [
    { at: 1793649600000, event: 'sent', message: 'SYNTHETIC-PRIVATE-DO-NOT-EXPORT', url: 'https://chatgpt.com/c/private-test' },
    null,
    { at: 1793649601000, event: 'unconfirmed', diagnostic: { code: 'execution-exception', durationMs: 123, raw: 'SYNTHETIC-PRIVATE-DO-NOT-EXPORT' } },
  ] };
  const reads = [], writes = [], listeners = [];
  const render = () => {
    let node = document.getElementById('fixture-receipt');
    if (!node) { node = document.createElement('pre'); node.id = 'fixture-receipt'; document.body.append(node); }
    node.textContent = 'ISOLATED PREVIEW: synthetic storage; no live extension or task.\n' + JSON.stringify({ reads, writes }, null, 2);
  };
  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: '2.1.0' }) },
    storage: {
      onChanged: { addListener: value => listeners.push(value) },
      local: {
        async get(keys) { reads.push([...keys]); render(); return Object.fromEntries(keys.map(key => [key, structuredClone(state[key])])); },
        async set(values) {
          writes.push(Object.keys(values)); Object.assign(state, structuredClone(values));
          for (const listener of listeners) listener(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'local');
          render();
        },
      },
    },
  };
  document.addEventListener('DOMContentLoaded', render);
})();
`;
const server = http.createServer(async (request, response) => {
  const target = new URL(request.url, 'http://127.0.0.1');
  const name = target.pathname.slice(1) || 'support.html';
  if (request.method !== 'GET' || target.search || (!assets.has(name) && name !== 'fixture.js')) { response.writeHead(404).end(); return; }
  try {
    let body = name === 'fixture.js' ? fixture : await fs.readFile(new URL(name, root));
    if (name === 'support.html') body = body.toString('utf8').replace('<head>', '<head><script src="/fixture.js"></script>');
    response.writeHead(200, {
      'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.png') ? 'image/png' : 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; object-src 'none'",
    });
    response.end(body);
  } catch { response.writeHead(500).end(); }
});
server.listen(0, '127.0.0.1', () => console.log('SupportFixtureURL=http://127.0.0.1:' + server.address().port + '/support.html'));
const stop = () => { server.closeAllConnections(); server.close(); process.stdin.pause(); };
const deadline = setTimeout(stop, 240000);
server.on('close', () => clearTimeout(deadline));
