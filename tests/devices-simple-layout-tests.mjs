import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import './devices-account-surface-tests.mjs';

const html = fs.readFileSync(new URL('../devices.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(new URL('../devices.css', import.meta.url), 'utf8');

// Source-only ancestry checks for this authored page; no browser or native runtime.
const elements = [], stack = [];
const voidTags = new Set(['meta', 'link', 'input', 'br']);
for (const match of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)) {
  const [, closing, tag, attributes] = match;
  if (closing) {
    assert.equal(stack.pop()?.tag, tag, `balanced closing tag: ${tag}`);
    continue;
  }
  const attrs = Object.fromEntries([...attributes.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)]
    .map(([, name, value]) => [name, value ?? '']));
  const element = { tag, attrs, parents: [...stack] };
  elements.push(element);
  if (!voidTags.has(tag)) stack.push(element);
}
assert.equal(stack.length, 0, 'all authored containers are closed');
const byId = id => {
  const matches = elements.filter(element => element.attrs.id === id);
  assert.equal(matches.length, 1, `one authored element: ${id}`);
  return matches[0];
};
const inside = (element, id) => element.parents.some(parent => parent.attrs.id === id);
const primary = element => {
  assert.equal(element.parents.some(parent => parent.tag === 'details' || parent.tag === 'dialog'), false,
    `${element.attrs.id ?? element.attrs['data-action']} stays outside collapsed content and dialogs`);
  for (const node of [...element.parents, element]) {
    if (node.attrs.id !== 'administrator-controls') {
      assert.equal(Object.hasOwn(node.attrs, 'hidden'), false,
        `${element.attrs.id ?? element.attrs['data-action']} has no extra hidden ancestor`);
    }
  }
};
const originalIds = [
  'language', 'local-title', 'standard-mode', 'browser-mode',
  'selected-target', 'permission', 'registration-label', 'registration',
  'connection-label', 'connection', 'pause-label', 'pause',
  'operation', 'operation-id', 'observed', 'feedback',
  'lockNotice', 'administrator-controls', 'administrator-title', 'administrator-status',
  'administrator-check', 'administrator-pause', 'administrator-pause-reconcile', 'administrator-pause-request-feedback',
  'administrator-pause-reconcile-feedback', 'administrator-control-panel', 'administrator-control-support-check', 'administrator-connect',
  'administrator-reconnect', 'administrator-revoke', 'administrator-connect-support', 'administrator-reconnect-support',
  'administrator-revoke-support', 'administrator-control-feedback', 'administrator-control-operation', 'administrator-control-reference-fields',
  'administrator-control-reference-bundle', 'administrator-control-reference-id', 'administrator-control-reference-action', 'administrator-control-reference-feedback',
  'administrator-control-details', 'administrator-control-id', 'administrator-control-bundle', 'administrator-control-action',
  'administrator-control-target', 'administrator-control-elapsed', 'administrator-control-outcome', 'administrator-control-state',
  'administrator-control-receipt', 'administrator-control-progress', 'administrator-control-journal-check', 'administrator-control-receipt-check',
  'administrator-control-recover', 'administrator-control-fence', 'administrator-restore', 'administrator-boundary',
  'administrator-pause-receipt', 'administrator-pause-id', 'administrator-pause-check', 'administrator-pause-feedback',
  'prepared-controls', 'prepared-title', 'prepared-form', 'prepared-id',
  'prepared-digest', 'prepared-check', 'prepared-revoke', 'prepared-feedback',
  'access-title', 'permissionRisk', 'riskConsent', 'permission-feedback',
  'grantPermission', 'permission-check', 'native-host', 'install-guide',
  'setup-title', 'extension-id', 'scope-title', 'operationDialog',
  'dialog-title', 'dialog-risk', 'cancelOperation', 'confirmOperation',
  'administrator-control-dialog', 'administrator-control-title', 'administrator-control-risk', 'administrator-control-reference',
  'administrator-control-review-reference', 'administrator-control-confirm', 'administrator-pause-dialog', 'administrator-pause-title',
  'administrator-pause-risk', 'administrator-pause-unresolved', 'administrator-pause-confirm', 'administrator-pause-reconcile-dialog',
  'administrator-pause-reconcile-title', 'administrator-pause-reconcile-target', 'administrator-pause-reconcile-risk', 'administrator-pause-reconcile-confirm',
  'prepared-dialog', 'prepared-dialog-title', 'prepared-reference', 'prepared-risk',
  'prepared-confirm',
];

test('existing IDs and unique authored controls survive the layout change', () => {
  const ids = elements.filter(element => element.attrs.id).map(element => element.attrs.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate IDs');
  for (const id of originalIds) byId(id);
  for (const action of ['status', 'disconnect-and-pause', 'reconnect']) {
    const matches = elements.filter(element => element.attrs['data-action'] === action);
    assert.equal(matches.length, 1, `one standard ${action} control`);
    primary(matches[0]);
    assert.ok(Object.hasOwn(matches[0].attrs, 'disabled'), 'JS determines initial eligibility');
  }
});

test('advanced setup and diagnostics use one native details disclosure closed by default', () => {
  const details = elements.filter(element => element.tag === 'details');
  assert.equal(details.length, 1);
  assert.equal(details[0], byId('device-advanced'));
  assert.equal(Object.hasOwn(details[0].attrs, 'open'), false);
  assert.equal(Object.hasOwn(details[0].attrs, 'hidden'), false);
  const summary = elements.find(element => element.tag === 'summary' && inside(element, 'device-advanced'));
  assert.ok(summary, 'native disclosure has its own visible summary');
  assert.equal(summary.parents.at(-1), details[0]);
  assert.match(html, /<summary[^>]*>Advanced setup and diagnostics<\/summary>/);
});

test('account selection uses an accessible native radio group without navigation or commands', () => {
  const selector = byId('account-selector');
  assert.equal(selector.tag, 'fieldset');
  assert.ok(Object.hasOwn(selector.attrs, 'hidden'), 'only browser-managed initialization reveals the selector');
  assert.ok(elements.some(element => element.tag === 'legend' && inside(element, 'account-selector')));
  for (const account of ['current', 'administrator']) {
    const radio = byId('account-' + account);
    assert.equal(radio.tag, 'input');
    assert.equal(radio.attrs.type, 'radio');
    assert.equal(radio.attrs.name, 'device-account');
    assert.equal(radio.attrs.value, account);
    assert.equal(radio.attrs['data-action'], undefined);
    assert.ok(elements.some(element => element.tag === 'label' && element.attrs.for === radio.attrs.id));
    for (const id of radio.attrs['aria-controls'].split(' ')) byId(id);
  }
  assert.equal(byId('account-current-label').attrs['data-i18n'], '当前账户');
  assert.equal(byId('account-administrator-label').attrs['data-i18n'], '管理员');
  assert.equal(Object.hasOwn(byId('account-current').attrs, 'checked'), true);
  assert.equal(Object.hasOwn(byId('account-administrator').attrs, 'checked'), false);
  assert.equal(byId('browser-mode').attrs.href, 'devices.html?mode=browser-managed', 'links keep the exact canonical sender route');
});

test('only account-owned status and actions are grouped for visibility; permission and setup are shared', () => {
  for (const id of ['registration', 'connection', 'pause', 'feedback', 'lockNotice']) {
    assert.ok(inside(byId(id), 'standard-controls'), `${id} belongs to the current account`);
  }
  for (const element of elements.filter(element => element.attrs['data-action'])) assert.ok(inside(element, 'standard-controls'));
  assert.ok(inside(byId('operation'), 'device-diagnostics'));
  assert.ok(inside(byId('prepared-controls'), 'prepared-account-scope'));
  for (const id of ['permission', 'riskConsent', 'permission-feedback', 'grantPermission', 'permission-check', 'setup-entry', 'install-guide']) {
    for (const scope of ['standard-controls', 'administrator-controls', 'device-diagnostics', 'administrator-control-panel', 'prepared-account-scope']) {
      assert.equal(inside(byId(id), scope), false, `${id} is shared, not owned by ${scope}`);
    }
  }
});

test('administrator guided connect, status, pause, revoke and live feedback stay primary', () => {
  for (const id of ['administrator-guided-connect', 'administrator-check', 'administrator-pause',
    'administrator-pause-request-feedback', 'administrator-guided-feedback', 'administrator-status',
    'administrator-control-feedback', 'administrator-control-progress', 'administrator-revoke']) {
    const element = byId(id);
    assert.ok(inside(element, 'administrator-controls'), `${id} stays in the administrator scope`);
    if (id !== 'administrator-pause-request-feedback') primary(element);
  }
  for (const id of ['administrator-guided-connect', 'administrator-check', 'administrator-pause', 'administrator-revoke']) {
    assert.equal(byId(id).tag, 'button');
    assert.ok(Object.hasOwn(byId(id).attrs, 'disabled'), `${id} starts disabled`);
  }
  const connect = byId('administrator-guided-connect');
  assert.equal(connect.attrs.type, 'button');
  assert.equal(connect.attrs['data-i18n'], '连接管理员运行端');
  const feedback = byId('administrator-guided-feedback');
  assert.equal(feedback.attrs.role, 'status');
  assert.equal(feedback.attrs['aria-live'], 'polite');
  assert.equal(Object.hasOwn(feedback.attrs, 'hidden'), false);
});

test('receipts, manual administrator controls and command setup are advanced only', () => {
  for (const id of ['operation', 'operation-id', 'observed', 'administrator-control-panel',
    'administrator-control-support-check', 'administrator-connect', 'administrator-reconnect',
    'administrator-connect-support', 'administrator-reconnect-support', 'administrator-revoke-support',
    'administrator-control-operation', 'administrator-control-reference-fields', 'administrator-control-details',
    'administrator-control-journal-check', 'administrator-control-receipt-check',
    'administrator-control-recover', 'administrator-control-fence', 'administrator-pause-receipt',
    'administrator-pause-feedback', 'administrator-pause-reconcile', 'administrator-pause-reconcile-feedback', 'prepared-controls', 'prepared-id', 'prepared-digest',
    'permission-check', 'native-host', 'install-guide', 'extension-id', 'scope-title']) {
    assert.ok(inside(byId(id), 'device-advanced'), `${id} belongs in Advanced`);
  }
  for (const element of elements.filter(element => element.attrs.href?.startsWith('setup.html'))) {
    if (element.attrs.id === 'setup-entry') {
      primary(element);
      assert.equal(element.attrs.href, 'setup.html', 'primary setup entry opens the guided setup, not a manual command section');
      continue;
    }
    assert.ok(inside(element, 'device-advanced'), 'manual setup links stay in Advanced');
  }
});

test('permission consent and standard and administrator state remain separate and truthful', () => {
  for (const id of ['permission', 'registration', 'connection', 'pause', 'feedback', 'lockNotice',
    'permissionRisk', 'riskConsent', 'permission-feedback', 'grantPermission']) {
    const element = byId(id);
    if (id !== 'lockNotice') primary(element);
    assert.equal(inside(element, 'administrator-controls'), false, `${id} is not administrator readiness`);
  }
  assert.equal(byId('riskConsent').attrs.type, 'checkbox');
  assert.equal(byId('riskConsent').attrs['aria-describedby'], 'permissionRisk');
  assert.equal(Object.hasOwn(byId('riskConsent').attrs, 'checked'), false);
  assert.match(html, /id="permission"[^>]*>Unknown<\/dd>/);
  assert.match(html, /id="connection"[^>]*>Not checked<\/dd>/);
  assert.match(html, /id="pause"[^>]*>Unknown<\/dd>/);
  assert.match(html, /Standard connection controls do not affect the administrator connection\./);
  assert.doesNotMatch(html, /one[- ]click|automatically ready|connected and ready/i);
});

test('the existing informed-consent dialog is unchanged and remains outside Advanced', () => {
  const dialog = html.match(/  <dialog id="administrator-control-dialog"[\s\S]*?  <\/dialog>/)?.[0];
  assert.equal(dialog, "  <dialog id=\"administrator-control-dialog\" aria-labelledby=\"administrator-control-title\" aria-describedby=\"administrator-control-risk administrator-control-reference\">\n    <h2 id=\"administrator-control-title\"></h2>\n    <p id=\"administrator-control-risk\"></p>\n    <p id=\"administrator-control-reference\" class=\"host-identity\"><code id=\"administrator-control-review-reference\" dir=\"ltr\"></code></p>\n    <form method=\"dialog\" class=\"actions\">\n      <button value=\"cancel\" data-i18n=\"取消\" autofocus>Cancel</button>\n      <button id=\"administrator-control-confirm\" type=\"button\" data-i18n=\"确认管理员操作\">Confirm administrator action</button>\n    </form>\n  </dialog>");
  assert.equal(inside(byId('administrator-control-dialog'), 'device-advanced'), false);
  assert.equal(byId('administrator-control-confirm').attrs.type, 'button');
  assert.ok(elements.some(element => element.tag === 'script' && element.attrs.src === 'devices.js' &&
    element.attrs.type === 'module'), 'existing JS entrypoint is retained');
});

test('all original consent and safety dialogs retain their exact authored markup', () => {
  const originalDialogs = [
  ["operationDialog", "  <dialog id=\"operationDialog\" aria-labelledby=\"dialog-title\" aria-describedby=\"dialog-risk\">\n    <h2 id=\"dialog-title\"></h2>\n    <p id=\"dialog-risk\"></p>\n    <div class=\"actions\">\n      <button id=\"cancelOperation\" type=\"button\" data-i18n=\"取消\" autofocus>Cancel</button>\n      <button id=\"confirmOperation\" type=\"button\" data-i18n=\"确认操作\">Confirm action</button>\n    </div>\n  </dialog>"],
  ["administrator-control-dialog", "  <dialog id=\"administrator-control-dialog\" aria-labelledby=\"administrator-control-title\" aria-describedby=\"administrator-control-risk administrator-control-reference\">\n    <h2 id=\"administrator-control-title\"></h2>\n    <p id=\"administrator-control-risk\"></p>\n    <p id=\"administrator-control-reference\" class=\"host-identity\"><code id=\"administrator-control-review-reference\" dir=\"ltr\"></code></p>\n    <form method=\"dialog\" class=\"actions\">\n      <button value=\"cancel\" data-i18n=\"取消\" autofocus>Cancel</button>\n      <button id=\"administrator-control-confirm\" type=\"button\" data-i18n=\"确认管理员操作\">Confirm administrator action</button>\n    </form>\n  </dialog>"],
  ["administrator-pause-dialog", "  <dialog id=\"administrator-pause-dialog\" aria-labelledby=\"administrator-pause-title\" aria-describedby=\"administrator-pause-risk administrator-pause-unresolved\">\n    <h2 id=\"administrator-pause-title\" data-i18n=\"暂停管理员连接\">Pause administrator connection</h2>\n    <p id=\"administrator-pause-risk\" data-i18n=\"若发出新请求，确认后本机 Windows 会提示授权。此操作仅影响管理员 MCP，不会更改普通权限连接或提示词调度。\">If a new request is sent, a local Windows authorization prompt follows confirmation. This affects only the administrator MCP and does not change the standard connection or prompt schedules.</p>\n    <p id=\"administrator-pause-unresolved\" data-i18n=\"如果上次暂停仍未解决，则不会发出新请求。请查询上次操作的回执。\">If a previous Pause is unresolved, no new request is sent. Check the receipt for the previous operation.</p>\n    <form method=\"dialog\" class=\"actions\">\n      <button value=\"cancel\" data-i18n=\"取消\" autofocus>Cancel</button>\n      <button id=\"administrator-pause-confirm\" type=\"button\" data-i18n=\"确认暂停\">Confirm pause</button>\n    </form>\n  </dialog>"],
  ["administrator-pause-reconcile-dialog", "  <dialog id=\"administrator-pause-reconcile-dialog\" aria-labelledby=\"administrator-pause-reconcile-title\" aria-describedby=\"administrator-pause-reconcile-target administrator-pause-reconcile-risk\">\n    <h2 id=\"administrator-pause-reconcile-title\" data-i18n=\"核对上次暂停并防止重放\">Reconcile last Pause</h2>\n    <p><span data-i18n=\"管理员暂停操作编号\">Administrator pause operation ID</span>: <code id=\"administrator-pause-reconcile-target\" dir=\"ltr\"></code></p>\n    <p id=\"administrator-pause-reconcile-risk\" data-i18n=\"此请求需要本机 Windows 授权。防重放仅阻止此编号再次被接收，不会重新连接或更改当前连接，也不能证明上次请求从未执行。\">This request requires local Windows authorization. A fence only prevents this ID from being admitted again. It does not reconnect or change the current connection, and it does not prove the earlier request never ran.</p>\n    <form method=\"dialog\" class=\"actions\">\n      <button value=\"cancel\" data-i18n=\"取消\" autofocus>Cancel</button>\n      <button id=\"administrator-pause-reconcile-confirm\" type=\"button\" data-i18n=\"请求防重放\">Request fence</button>\n    </form>\n  </dialog>"],
  ["prepared-dialog", "  <dialog id=\"prepared-dialog\" aria-labelledby=\"prepared-dialog-title\" aria-describedby=\"prepared-risk prepared-reference\">\n    <h2 id=\"prepared-dialog-title\" data-i18n=\"撤销待执行命令\">Revoke pending command</h2>\n    <p><code id=\"prepared-reference\"></code></p>\n    <p id=\"prepared-risk\" data-i18n=\"撤销会阻止此引用的后续执行，但不会停止已被接收的命令，也不会更改任何对话权限。\">Revocation blocks future execution of this reference. It does not stop a command that has already been admitted or change any chat grants.</p>\n    <form method=\"dialog\" class=\"actions\">\n      <button value=\"cancel\" data-i18n=\"取消\" autofocus>Cancel</button>\n      <button id=\"prepared-confirm\" type=\"button\" data-i18n=\"确认撤销\">Confirm revocation</button>\n    </form>\n  </dialog>"],
  ];
  for (const [id, expected] of originalDialogs) {
    const actual = html.match(new RegExp(`  <dialog id="${id}"[\\s\\S]*?  <\\/dialog>`))?.[0];
    assert.equal(actual, expected, `${id} is unchanged`);
    assert.equal(inside(byId(id), 'device-advanced'), false, `${id} stays outside Advanced`);
  }
});

test('the disclosure and primary actions retain restrained responsive focus styling', () => {
  assert.match(css, /summary[^{}]*\{[^}]*cursor:\s*pointer/s);
  assert.match(css, /summary[^{}]*:focus-visible|:is\([^)]*summary[^)]*\):focus-visible/);
  assert.match(css, /#administrator-guided-connect/);
  assert.match(css, /#administrator-revoke/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
  assert.match(css, /\.actions\s*>\s*button\s*\{[^}]*flex:\s*1 1 100%/);
  assert.doesNotMatch(css, /letter-spacing:\s*-|font-size:\s*[^;{}]*vw/);
});
