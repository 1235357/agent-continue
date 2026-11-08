import crypto from 'node:crypto';
import http from 'node:http';
import { pinLocalManager } from './device-setup.mjs';

const lifetime = 15 * 60;
const maxBody = 512;
const actions = new Set(['status', 'disconnect-and-pause', 'reconnect']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const connections = new Set(['ready', 'disconnected', 'unknown']);
const operationStatuses = new Set(['in-progress', 'unknown-running', 'settled', 'not-executed', 'unknown']);

const script = `const form = document.querySelector('form');
const code = document.querySelector('#code');
const state = document.querySelector('#state');
const details = document.querySelector('#details');
const buttons = [...form.querySelectorAll('button')];
const encode = value => new TextEncoder().encode(JSON.stringify(value));
let previous = null, unresolved = false, busy = false, expired = false, expiryTimer;
const updateButtons = () => { for (const button of buttons) button.disabled = expired || busy || (unresolved && button.value !== 'status'); };
form.addEventListener('submit', async event => {
  event.preventDefault();
  const action = event.submitter?.value;
  if (!action || expired || busy || (unresolved && action !== 'status')) return;
  const pasted = code.value.trim();
  const ticket = /^ACPAIR1:([1-9][0-9]{3,4}):([A-Za-z0-9_-]{43})$/.exec(pasted);
  const secret = ticket && ticket[1] === location.port ? ticket[2] : pasted;
  if (secret.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    state.textContent = 'Pairing code rejected';
    return;
  }
  const id = action === 'status' && previous ? previous : crypto.randomUUID();
  const mutation = action !== 'status';
  busy = true;
  updateButtons();
  state.textContent = 'Checking';
  details.textContent = '';
  try {
    const nonce = crypto.randomUUID();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']);
    const tag = await crypto.subtle.sign('HMAC',key,encode(['ac-request-v1',location.origin,nonce,id,action]));
    const mac = Array.from(new Uint8Array(tag), b=>b.toString(16).padStart(2,'0')).join('');
    const response = await fetch('/v1/signed-control', { method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce, id, action, mac }) });
    const envelope = await response.json();
    if (!mutation && response.status === 403) {
      state.textContent = 'Pairing code rejected';
      if (unresolved) details.textContent = 'Request: ' + previous;
      return;
    }
    if (typeof envelope?.payload !== 'string' || typeof envelope.mac !== 'string' || envelope.mac.length !== 64 || !/^[0-9a-f]{64}$/.test(envelope.mac) ||
        !await crypto.subtle.verify('HMAC',key,Uint8Array.from(envelope.mac.match(/../g),b=>parseInt(b,16)),
          encode(['ac-reply-v1',location.origin,nonce,id,action,envelope.payload]))) throw new Error();
    const result = JSON.parse(envelope.payload);
    const remaining = result.expiresAt - Date.now();
    if (result.id !== id || !Number.isSafeInteger(remaining) || remaining < 1 || remaining > 900000) throw new Error();
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => { expired = true; code.value = ''; state.textContent = 'Session expired'; updateButtons(); }, remaining);
    if (!response.ok || !result.ok) {
      if (mutation && ![400,403,404,409,413].includes(response.status)) { previous = id; unresolved = true; }
      state.textContent = response.status === 403 ? 'Pairing code rejected' : response.status === 409 ? 'Control busy' : 'Result unconfirmed';
      if (unresolved) details.textContent = 'Request: ' + previous;
      return;
    }
    if (mutation) previous = id;
    if (previous === id) unresolved = !['settled','not-executed'].includes(result.operationStatus);
    state.textContent = result.paused === true ? (result.connection === 'disconnected' ? 'Paused' : 'Pause requested; stop unconfirmed') :
      ({ ready: 'Ready', disconnected: 'Disconnected', unknown: 'Unknown' })[result.connection];
    if (result.operationStatus || unresolved) details.textContent = (result.operationStatus || 'unconfirmed') + ' | ' + id;
  } catch {
    if (mutation) { previous = id; unresolved = true; }
    state.textContent = 'Session unavailable';
    details.textContent = 'Request: ' + id;
  } finally { busy = false; updateButtons(); }
});`;
const style = `:root{color-scheme:light dark;font:16px system-ui;color:#192523;background:#f5f7f6}
body{margin:0}main{max-width:36rem;margin:auto;padding:2rem 1rem}h1{font-size:1.5rem;margin:0 0 1.25rem}h2{font-size:1.125rem;margin:0}
section{border-block:1px solid #92a49f;padding:.875rem 0;margin-bottom:1.125rem}#details{min-height:1.25rem;margin:.25rem 0 0;overflow-wrap:anywhere;font-size:.875rem}
label{display:block;font-size:.875rem;font-weight:600}input{box-sizing:border-box;display:block;width:100%;margin:.4rem 0 1rem}
input,button{font:inherit;border:1px solid #6a8279;border-radius:6px;padding:.6rem .75rem;background:Canvas;color:CanvasText}
.actions{display:flex;flex-wrap:wrap;gap:.5rem}button{cursor:pointer;min-height:2.75rem}button[value=reconnect]{background:#165949;border-color:#165949;color:#fff}button:disabled{cursor:wait;opacity:.65}
@media(prefers-color-scheme:dark){:root{background:#1a2220;color:#e1ece8}}`;
const renderPage = clientScript => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Continue | Local device</title><style>${style}</style><main><h1>Agent Continue</h1><section aria-live="polite">
<h2 id="state">Not checked</h2><p id="details"></p></section><form autocomplete="off"><label for="code">Local pairing ticket or code</label>
<input id="code" type="password" required autocomplete="off" spellcheck="false">
<div class="actions"><button value="status">Check status</button><button value="disconnect-and-pause">Disconnect and pause</button>
<button value="reconnect">Reconnect</button></div></form></main><script>${clientScript}</script></html>`;
const cspHash = data => "'sha256-" + crypto.createHash('sha256').update(data).digest('base64') + "'";
const pagePolicy = (clientScript, ancestors) => `default-src 'none'; script-src ${cspHash(clientScript)}; style-src ${cspHash(style)}; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors ${ancestors}`;
const page = renderPage(script);
const policy = pagePolicy(script, "'none'");

function respond(res, status, value, embedPolicy) {
  if (res.destroyed) return;
  const html = typeof value === 'string';
  res.writeHead(status, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Content-Security-Policy': embedPolicy ?? policy, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    ...(embedPolicy ? {} : { 'Cross-Origin-Resource-Policy': 'same-origin' }), 'X-Content-Type-Options': 'nosniff', 'Connection': 'close' });
  res.end(html ? value : JSON.stringify(value));
}

export async function openBrowserManager(installDir, expectedExtensionId) {
  const owner = await pinLocalManager(installDir);
  if (expectedExtensionId !== undefined && owner.extensionOrigin !== 'chrome-extension://' + expectedExtensionId) {
    throw new Error('setup_identity_mismatch');
  }
  const current = await owner.request(undefined, 'status');
  if (!current?.ok) throw new Error('local_browser_unavailable');
  return openBrowserControl(({ id, action }) => owner.request(id, action), owner);
}

export async function openBrowserControl(control, { extensionOrigin } = {}) {
  if (extensionOrigin !== undefined && (typeof extensionOrigin !== 'string' || extensionOrigin.length !== 51 ||
      !/^chrome-extension:\/\/[a-p]{32}$/.test(extensionOrigin))) throw new Error('invalid_extension_origin');
  const embedScript = extensionOrigin && `let connected = false;
addEventListener('message', event => {
  if (connected || event.source !== parent || event.origin !== ${JSON.stringify(extensionOrigin)} ||
      event.data !== 'agent-continue-local-control' || event.ports.length !== 1) return;
  connected = true;
  const port = event.ports[0];
  port.onmessage = async ({data}) => {
    try {
      if (typeof data !== 'string' || data.length > 512) throw new Error();
      const response = await fetch('/v1/signed-control', {method:'POST', cache:'no-store', credentials:'omit', redirect:'error',
        headers:{'Content-Type':'application/json'}, body:data});
      const reply = await response.text();
      port.postMessage(reply.length <= 1024 ? reply : null);
    } catch { port.postMessage(null); }
  };
});`;
  const embedPage = embedScript && `<!doctype html><meta charset="utf-8"><title>Local control transport</title><script>${embedScript}</script>`;
  const embedPolicy = embedScript && pagePolicy(embedScript, extensionOrigin);
  const code = crypto.randomBytes(32).toString('base64url');
  const bearer = Buffer.from('Bearer ' + code);
  const sign = text => crypto.createHmac('sha256', code).update(text).digest('hex');
  const expiresAt = Date.now() + lifetime * 1000;
  const usedNonces = new Set();
  let origin, host, expiry, closed = false, pending = false, closing;
  function close() {
    if (closing) return closing;
    closed = true;
    clearTimeout(expiry);
    const force = setTimeout(() => server.closeAllConnections(), 35000).unref();
    closing = new Promise(resolve => server.close(() => { clearTimeout(force); resolve(); }));
    server.closeIdleConnections();
    return closing;
  }

  async function handle(req, res) {
    if (closed || req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== host) return respond(res, 403, { ok: false });
    if (req.method === 'GET' && req.url === '/') return respond(res, 200, page);
    if (req.method === 'GET' && req.url === '/embed' && embedPage) return respond(res, 200, embedPage, embedPolicy);
    const signed = req.url === '/v1/signed-control';
    if (req.method !== 'POST' || (req.url !== '/v1/control' && !signed)) return respond(res, 404, { ok: false });
    const auth = Buffer.from(req.headers.authorization || '');
    if (req.headers.origin !== origin || req.headers['sec-fetch-site'] !== 'same-origin' ||
        req.headers['content-type'] !== 'application/json' || (!signed && (auth.length !== bearer.length ||
        !crypto.timingSafeEqual(auth, bearer)))) return respond(res, 403, { ok: false });
    const length = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(length) || length < 1 || length > maxBody || req.headers['transfer-encoding']) {
      return respond(res, 413, { ok: false });
    }
    const chunks = [];
    let bytes = 0, value;
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > maxBody) return respond(res, 413, { ok: false });
        chunks.push(chunk);
      }
      if (bytes !== length || closed) return respond(res, 400, { ok: false });
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch { return respond(res, 400, { ok: false }); }
    if (!value || Object.keys(value).length !== (signed ? 4 : 2) || !Object.hasOwn(value, 'id') || !Object.hasOwn(value, 'action') ||
        typeof value.id !== 'string' || value.id.length !== 36 || !uuid.test(value.id) || !actions.has(value.action)) return respond(res, 400, { ok: false });
    const { id, action } = value;
    const nonce = value.nonce;
    if (signed && (typeof nonce !== 'string' || nonce.length !== 36 || !uuid.test(nonce) ||
        typeof value.mac !== 'string' || value.mac.length !== 64 || !/^[0-9a-f]{64}$/.test(value.mac) ||
        !crypto.timingSafeEqual(Buffer.from(value.mac, 'hex'), Buffer.from(sign(JSON.stringify(['ac-request-v1', origin, nonce, id, action])), 'hex')))) {
      return respond(res, 403, { ok: false });
    }
    const reply = (status, result) => {
      if (!signed) return respond(res, status, result);
      const payload = JSON.stringify({ ...result, expiresAt });
      return respond(res, status, { payload, mac: sign(JSON.stringify(['ac-reply-v1', origin, nonce, id, action, payload])) });
    };
    if (signed) {
      if (usedNonces.has(nonce)) return reply(409, { ok: false, id, error: 'local_control_replay' });
      if (usedNonces.size >= 4096) return reply(429, { ok: false, id, error: 'local_control_limit' });
      usedNonces.add(nonce);
    }
    if (pending) return reply(409, { ok: false, id, error: 'local_control_busy' });
    pending = true;
    try {
      const result = await control({ id, action });
      const state = result?.state;
      if (result?.ok === true && result.id === id && connections.has(state?.connection) &&
          (state.paused === null || typeof state.paused === 'boolean')) {
        return reply(200, { ok: true, id, connection: state.connection, paused: state.paused,
          operationStatus: operationStatuses.has(state.operation?.status) ? state.operation.status : null });
      }
    } catch { /* Report an unknown outcome; never resubmit a control action. */ }
    finally { pending = false; }
    reply(502, { ok: false, id, error: 'manager_control_unconfirmed' });
  }

  const server = http.createServer({ maxHeaderSize: 4096, requestTimeout: 5000, headersTimeout: 4000 }, (req, res) => {
    void handle(req, res).catch(() => res.destroy());
  });
  const stopped = new Promise(resolve => server.once('close', resolve));
  server.maxConnections = 16;
  server.setTimeout(35000, socket => socket.destroy());
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch { throw new Error('local_browser_unavailable'); }
  const port = server.address().port;
  host = '127.0.0.1:' + port;
  origin = 'http://' + host;
  server.on('error', () => { void close(); });
  expiry = setTimeout(() => { void close(); }, lifetime * 1000);
  expiry.unref();
  return Object.freeze({ origin, code, pairingTicket: `ACPAIR1:${port}:${code}`, expiresInSeconds: lifetime, close, stopped });
}
