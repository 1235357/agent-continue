import assert from 'node:assert/strict';
import { pageAction } from '../adapter.js';
import vm from 'node:vm';
import test from 'node:test';

const source = pageAction.toString();

// Deliberately small DOM contract: selectors are routed, not browser-parsed.
// Coverage excludes real layout, trusted events, ProseMirror/React integration,
// contenteditable serialization, attachments, stop controls, and cross-run retries.
// All URLs, messages, identities, authorization replies, and time are synthetic.
function fixture(options = {}) {
  let now = 0;
  let checks = 0;
  let clicks = 0;
  let keys = 0;
  let identity = 'fixture~conversation';
  let acceptedAt = Infinity;
  const users = [];
  const timers = [];
  class Element {
    isConnected = true;
    disabled = false;
    readOnly = false;
    nodeType = 1;
    tagName = 'TEXTAREA';
    childNodes = [];
    parentElement = null;
    getAttribute() { return null; }
    getClientRects() { return [{}]; }
    closest(selector) { return selector === 'form' ? composer : null; }
    focus() { document.activeElement = this; }
    setSelectionRange() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent(event) {
      if (event.type === 'keydown') keys++;
      return true;
    }
  }
  class Textarea extends Element {
    get value() { return this.text ?? ''; }
    set value(value) { this.text = value; }
  }
  const editor = new Textarea();
  editor.value = options.draft ?? '';
  const button = new Element();
  button.click = () => { clicks++; acceptedAt = now + (options.acceptDelay ?? 0); };
  const composer = {
    querySelector: selector => selector.includes('send-button') ? button : null,
    querySelectorAll: () => [],
    contains: element => element === button || element === editor,
  };
  const row = {
    querySelector: () => null,
    getAttribute: name => name === 'data-message-id' ? identity && `${identity}~last` : null,
  };
  const document = {
    activeElement: null,
    visibilityState: 'visible',
    body: {},
    querySelectorAll(selector) {
      if (selector.startsWith('article.message-row,')) return identity ? [row] : [];
      if (selector.includes('data-composer-input') || selector.startsWith('#prompt-textarea')) return [editor];
      if (selector.startsWith('[data-message-author-role="user"]')) return users;
      return [];
    },
  };
  const state = {
    editor,
    get checks() { return checks; },
    get clicks() { return clicks; },
    get keys() { return keys; },
    loseIdentity() { identity = null; },
    schedule(at, callback) { timers.push({ at, callback }); },
  };
  const expectedUrl = options.dot ? 'https://fixture.invalid/dots/example' : 'https://fixture.invalid/c/example';
  const context = vm.createContext({
    URL, HTMLInputElement: Element, HTMLTextAreaElement: Textarea,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    Event: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document, window: {}, location: { href: expectedUrl },
    Date: { now: () => now },
    setTimeout(callback, delay) {
      now += delay;
      for (const timer of [...timers]) {
        if (timer.at <= now) {
          timers.splice(timers.indexOf(timer), 1);
          timer.callback();
        }
      }
      if (now >= acceptedAt && !users.length) {
        users.push({ innerText: 'continue fixture', getAttribute: name => name === 'data-message-id' ? 'new-user' : null });
        editor.value = '';
      }
      callback();
    },
  });
  vm.runInContext('globalThis.InputEvent = globalThis.PointerEvent = globalThis.MouseEvent = globalThis.KeyboardEvent = Event;', context);
  if (options.runtime !== false) {
    context.chrome = { runtime: { async sendMessage(message) {
      assert.equal(message.type, 'CHECK_RUN');
      checks++;
      return options.authorize ? options.authorize(state) : { ok: true, allowed: true };
    } } };
  }
  vm.runInContext('globalThis.run = (' + source + ');', context);
  return {
    state,
    run: () => context.run({
      expectedUrl, targetIdentity: options.dot ? 'fixture~conversation' : null,
      runId: 'synthetic-run', runDeadline: 20000, mode: 'send',
      prompt: 'continue fixture', sendMethod: 'button', ...options.args,
    }),
  };
}

for (const [name, options] of [
  ['missing runtime', { runtime: false }],
  ['explicit denial', { authorize: () => ({ ok: true, allowed: false }) }],
  ['missing reply', { authorize: () => undefined }],
  ['non-boolean permission', { authorize: () => ({ ok: true, allowed: 'true' }) }],
  ['runtime rejection', { authorize: () => { throw new Error('fixture failure'); } }],
]) {
  test(`no authorization means no submission: ${name}`, async () => {
    const f = fixture(options);
    assert.equal((await f.run()).status, 'cancelled');
    assert.equal(f.state.clicks, 0);
    assert.equal(f.state.keys, 0);
    assert.equal(f.state.editor.value, '');
  });
}

test('revocation at final authorization clears only the inserted draft', async () => {
  const f = fixture({ authorize: state => ({ ok: true, allowed: state.checks < 3 }) });
  assert.equal((await f.run()).status, 'cancelled');
  assert.equal(f.state.checks, 3);
  assert.equal(f.state.clicks, 0);
  assert.equal(f.state.editor.value, '');
});

test('Dot identity disappearing during authorization fails closed', async () => {
  const f = fixture({ dot: true, authorize: state => {
    if (state.checks === 2) state.loseIdentity();
    return { ok: true, allowed: true };
  } });
  assert.equal((await f.run()).status, 'cancelled');
  assert.equal(f.state.clicks, 0);
  assert.equal(f.state.editor.value, '');
});

test('delayed acceptance is confirmed with exactly one click', async () => {
  const f = fixture({ acceptDelay: 2400 });
  assert.equal((await f.run()).status, 'sent');
  assert.equal(f.state.clicks, 1);
  assert.equal(f.state.keys, 0);
});

test('acceptance beyond confirmation window remains unknown without retry or cleanup', async () => {
  const f = fixture({ acceptDelay: 10000 });
  assert.equal((await f.run()).status, 'unknown');
  assert.equal(f.state.clicks, 1);
  assert.equal(f.state.keys, 0);
  assert.equal(f.state.editor.value, 'continue fixture');
});

test('preexisting human draft is preserved before authorization', async () => {
  const draft = '  human draft\n\n';
  const f = fixture({ draft });
  assert.equal((await f.run()).status, 'draft');
  assert.equal(f.state.editor.value, draft);
  assert.equal(f.state.checks, 0);
  assert.equal(f.state.clicks, 0);
});

test('human edit during post-fill settling is preserved', async () => {
  const f = fixture();
  f.state.schedule(60, () => { f.state.editor.value = 'human revision  '; });
  assert.equal((await f.run()).status, 'draft');
  assert.equal(f.state.editor.value, 'human revision  ');
  assert.equal(f.state.clicks, 0);
});

test('human edit concurrent with revocation is not cleared', async () => {
  const f = fixture({ authorize: state => {
    if (state.checks === 2) state.editor.value = 'human concurrent revision\n';
    return { ok: true, allowed: state.checks < 2 };
  } });
  assert.equal((await f.run()).status, 'cancelled');
  assert.equal(f.state.editor.value, 'human concurrent revision\n');
  assert.equal(f.state.clicks, 0);
});

test('human edit during final authorization prevents submission', async () => {
  // Safety regression assertion, not an expectation of the current defect:
  // textarea childNodes do not track value, so plainDraft can mask value edits.
  const f = fixture({ authorize: state => {
    if (state.checks === 3) state.editor.value += ' ';
    return { ok: true, allowed: true };
  } });
  assert.equal((await f.run()).status, 'blocked');
  assert.equal(f.state.editor.value, 'continue fixture ');
  assert.equal(f.state.clicks, 0);
});

test('priority mode reasserts the configured text in an ordinary ChatGPT composer', async () => {
  const f = fixture({ draft: 'old draft', args: { extensionPriority: true }, authorize: state => {
    if (state.checks === 3) state.editor.value = 'do not submit this text';
    if (state.checks === 4) assert.equal(state.editor.value, 'continue fixture');
    return { ok: true, allowed: true };
  } });
  assert.equal((await f.run()).status, 'sent');
  assert.equal(f.state.clicks, 1);
  assert.equal(f.state.keys, 0);
});

test('pause during priority reassertion still wins before dispatch', async () => {
  const f = fixture({ args: { extensionPriority: true }, authorize: state => {
    if (state.checks === 3) state.editor.value = 'another message';
    return { ok: true, allowed: state.checks < 4 };
  } });
  assert.equal((await f.run()).status, 'cancelled');
  assert.equal(f.state.clicks, 0);
  assert.equal(f.state.keys, 0);
  assert.equal(f.state.editor.value, '');
});
