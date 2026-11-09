import assert from 'node:assert/strict';
import { pageAction } from '../adapter.js';
import vm from 'node:vm';
import test from 'node:test';

const source = pageAction.toString();

test('send implementation has no content-change veto or refill-count abort', () => {
  assert.doesNotMatch(source, /changedDraft|composer-changed|填写后检测到内容变化|重新填写后检测到内容变化|refills === 2/);
});

// Deliberately small DOM contract: selectors are routed, not browser-parsed.
// Coverage excludes real layout, trusted events, ProseMirror/React integration,
// contenteditable serialization, stop controls, and cross-run retries.
// All URLs, messages, identities, authorization replies, and time are synthetic.
function fixture(options = {}) {
  let now = 0;
  let checks = 0;
  let clicks = 0;
  let keys = 0;
  let identity = 'fixture~conversation';
  let acceptedAt = Infinity;
  let attachment = null;
  const users = [...(options.messages ?? [])];
  const timers = [];
  const sentTexts = [];
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
  let button = new Element();
  const submit = () => {
    clicks++;
    sentTexts.push(editor.value);
    acceptedAt = now + (options.acceptDelay ?? 0);
    options.onSubmit?.(state);
  };
  button.click = submit;
  const composer = {
    querySelector: selector => selector.includes('send-button') ? button : null,
    querySelectorAll: selector => selector.includes('[data-file-id]') && attachment ? [attachment] : [],
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
    sentTexts,
    get checks() { return checks; },
    get clicks() { return clicks; },
    get keys() { return keys; },
    replaceSendButton() {
      button.isConnected = false;
      button = new Element();
      button.click = submit;
    },
    addAttachment() { attachment = new Element(); },
    loseIdentity() { identity = null; },
    schedule(at, callback) { timers.push({ at, callback }); },
  };
  const expectedUrl = options.dot ? 'https://fixture.invalid/dots/example' : 'https://fixture.invalid/c/example';
  let pageTimerCalls = 0;
  let extensionWaits = 0;
  const advanceClock = delay => {
    now += delay;
    for (const timer of [...timers]) {
      if (timer.at <= now) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
    }
    if (now >= acceptedAt && !users.length) {
      users.push({ innerText: sentTexts.at(-1), getAttribute: name => name === 'data-message-id' ? 'new-user' : null });
      editor.value = '';
    }
  };
  const context = vm.createContext({
    URL, HTMLInputElement: Element, HTMLTextAreaElement: Textarea,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    Event: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document, window: {}, location: { href: expectedUrl },
    Date: { now: () => now },
    setTimeout(callback, delay) {
      pageTimerCalls++;
      advanceClock(options.clampedPageTimers ? 60000 : delay);
      callback();
    },
  });
  vm.runInContext('globalThis.InputEvent = globalThis.PointerEvent = globalThis.MouseEvent = globalThis.KeyboardEvent = Event;', context);
  if (options.runtime !== false) {
    context.chrome = { runtime: { async sendMessage(message) {
      if (message.type === 'WAIT_RUN') {
        assert.ok([50, 60, 150, 180].includes(message.delayMs));
        extensionWaits++;
        if (options.denyWait || options.authorizeWait?.(state, message) === false) return { ok: true, allowed: false };
        advanceClock(message.delayMs);
        return { ok: true, allowed: true };
      }
      assert.equal(message.type, 'CHECK_RUN');
      checks++;
      return options.authorize ? options.authorize(state) : { ok: true, allowed: true };
    } } };
  }
  vm.runInContext('globalThis.run = (' + source + ');', context);
  return {
    state,
    clocks: () => ({ pageTimerCalls, extensionWaits }),
    run: () => context.run({
      expectedUrl, targetIdentity: options.dot ? 'fixture~conversation' : null,
      runId: 'synthetic-run', runDeadline: 20000, mode: 'send',
      prompt: 'continue fixture', sendMethod: 'button', ...options.args,
    }),
  };
}

test('extension clock bypasses severely clamped page timers and submits only once', async () => {
  const h = fixture({ clampedPageTimers: true, acceptDelay: 500,
    args: { extensionClock: true, extensionPriority: true } });
  assert.equal((await h.run()).status, 'sent');
  assert.equal(h.clocks().pageTimerCalls, 0);
  assert.ok(h.clocks().extensionWaits >= 1);
  assert.equal(h.state.clicks, 1);
});
test('extension clock cancellation before dispatch does not submit', async () => {
  const h = fixture({ denyWait: true, args: { extensionClock: true, extensionPriority: true } });
  assert.equal((await h.run()).status, 'error');
  assert.equal(h.state.clicks, 0);
  assert.equal(h.clocks().pageTimerCalls, 0);
});

test('repeated text changes during final settling reassert the prompt without replaying submission', async () => {
  let changes = 0;
  const h = fixture({
    args: { extensionClock: true, extensionPriority: false },
    authorize: state => {
      if (state.checks === 3) state.editor.value = 'first intervening text';
      return { ok: true, allowed: true };
    },
    authorizeWait: (state, message) => {
      if (state.checks === 3 && message.delayMs === 180 && changes < 5) {
        state.editor.value = 'intervening text ' + ++changes;
      }
      return true;
    },
  });
  assert.equal((await h.run()).status, 'sent');
  assert.equal(changes, 5);
  assert.deepEqual(h.state.sentTexts, ['continue fixture']);
  assert.equal(h.state.clicks, 1);
});

test('a pause observed during replacement settling prevents the one dispatch', async () => {
  const h = fixture({
    args: { extensionClock: true, extensionPriority: false },
    authorize: state => {
      if (state.checks === 3) state.editor.value = 'intervening text';
      return { ok: true, allowed: true };
    },
    authorizeWait: state => state.checks !== 3,
  });
  assert.equal((await h.run()).status, 'error');
  assert.equal(h.state.clicks, 0);
  assert.equal(h.state.keys, 0);
  assert.equal(h.state.editor.value, '');
});

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

for (const sendMethod of ['auto', 'button']) {
  test(`ordinary ChatGPT uses the current composer button after a re-render (${sendMethod})`, async () => {
    const f = fixture({ args: { sendMethod }, authorize: state => {
      if (state.checks === 3) state.replaceSendButton();
      return { ok: true, allowed: true };
    } });
    assert.equal((await f.run()).status, 'sent');
    assert.deepEqual(f.state.sentTexts, ['continue fixture']);
    assert.equal(f.state.keys, 0);
  });
}

test('Dot identity disappearing during authorization fails closed', async () => {
  const f = fixture({ dot: true, authorize: state => {
    if (state.checks === 2) state.loseIdentity();
    return { ok: true, allowed: true };
  } });
  assert.equal((await f.run()).status, 'cancelled');
  assert.equal(f.state.clicks, 0);
  assert.equal(f.state.editor.value, 'continue fixture', 'Lost target identity forbids cleanup edits too');
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

for (const dot of [false, true]) {
  for (const extensionPriority of [false, true]) {
    for (const initialKey of [null, 'old-user']) {
      test(`known history cannot confirm after its key changes (dot=${dot}, priority=${extensionPriority}, keyed=${!!initialKey})`, async () => {
        let key = initialKey;
        const history = {
          innerText: 'continue fixture',
          getAttribute: name => name === 'data-message-id' ? key : null,
          closest: () => null,
        };
        const f = fixture({
          dot, messages: [history], acceptDelay: Infinity,
          args: { extensionPriority },
          onSubmit: () => { key = 'hydrated-user'; },
        });
        assert.equal((await f.run()).status, 'unknown');
        assert.deepEqual(f.state.sentTexts, ['continue fixture']);
        assert.equal(f.state.clicks, 1);
        assert.equal(f.state.keys, 0);
      });
    }
  }
}

test('a recycled known message node remains uncertain even with new submitted text and ID', async () => {
  let key = 'old-user';
  const history = {
    innerText: 'earlier fixture message',
    getAttribute: name => name === 'data-message-id' ? key : null,
    closest: () => null,
  };
  const f = fixture({
    messages: [history], acceptDelay: Infinity,
    onSubmit: () => { history.innerText = 'continue fixture'; key = 'new-user'; },
  });
  assert.equal((await f.run()).status, 'unknown');
  assert.equal(f.state.clicks, 1);
  assert.equal(f.state.keys, 0);
});

test('scheduled send replaces preexisting text with the configured prompt', async () => {
  const draft = '  human draft\n\n';
  const f = fixture({ draft });
  assert.equal((await f.run()).status, 'sent');
  assert.deepEqual(f.state.sentTexts, ['continue fixture']);
  assert.equal(f.state.clicks, 1);
});

for (const legacyPriority of [undefined, false]) {
  test(`mandatory priority replaces changes after fill with legacy priority=${legacyPriority}`, async () => {
    const f = fixture({ args: { extensionPriority: legacyPriority } });
    f.state.schedule(60, () => { f.state.editor.value = 'changed during settling'; });
    assert.equal((await f.run()).status, 'sent');
    assert.deepEqual(f.state.sentTexts, ['continue fixture']);
    assert.equal(f.state.clicks, 1);
  });
}

test('mandatory priority does not abort for repeated edits during authorization', async () => {
  const f = fixture({ args: { extensionPriority: false }, authorize: state => {
    if (state.checks >= 3) state.editor.value = `revision ${state.checks}`;
    return { ok: true, allowed: true };
  } });
  assert.equal((await f.run()).status, 'sent');
  assert.deepEqual(f.state.sentTexts, ['continue fixture']);
  assert.equal(f.state.clicks, 1);
  assert.equal(f.state.keys, 0);
});

test('text changes during post-fill settling do not veto scheduled sending', async () => {
  const f = fixture();
  f.state.schedule(60, () => { f.state.editor.value = 'human revision  '; });
  assert.equal((await f.run()).status, 'sent');
  assert.deepEqual(f.state.sentTexts, ['continue fixture']);
  assert.equal(f.state.clicks, 1);
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

test('text changes during final authorization are replaced before submission', async () => {
  const f = fixture({ authorize: state => {
    if (state.checks === 3) state.editor.value += ' ';
    return { ok: true, allowed: true };
  } });
  assert.equal((await f.run()).status, 'sent');
  assert.deepEqual(f.state.sentTexts, ['continue fixture']);
  assert.equal(f.state.clicks, 1);
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
    return { ok: true, allowed: state.checks < 3 };
  } });
  assert.equal((await f.run()).status, 'cancelled');
  assert.equal(f.state.clicks, 0);
  assert.equal(f.state.keys, 0);
  assert.equal(f.state.editor.value, 'another message');
});

for (const [status, acceptDelay] of [['sent', 0], ['unknown', 10000]]) {
  test(`priority recovers a text change during reauthorization with one click (${status})`, async () => {
    const f = fixture({ acceptDelay, args: { extensionPriority: true }, authorize: state => {
      if (state.checks === 3) state.editor.value = 'first change';
      if (state.checks === 4) state.editor.value = 'second change';
      return { ok: true, allowed: true };
    } });
    const outcome = await f.run();
    assert.deepEqual({ status: outcome.status, sentTexts: f.state.sentTexts },
      { status, sentTexts: ['continue fixture'] });
    assert.equal(f.state.checks, 3);
    assert.equal(f.state.clicks, 1);
    assert.equal(f.state.keys, 0);
  });
}

test('priority replaces repeated text changes once without an authorization refill loop', async () => {
  const f = fixture({ args: { extensionPriority: true }, authorize: state => {
    if (state.checks >= 3) state.editor.value = `revision ${state.checks}`;
    return { ok: true, allowed: true };
  } });
  assert.equal((await f.run()).status, 'sent');
  assert.equal(f.state.checks, 3);
  assert.deepEqual(f.state.sentTexts, ['continue fixture']);
  assert.equal(f.state.clicks, 1);
  assert.equal(f.state.keys, 0);
});

for (const [guard, status] of [['pause', 'cancelled'], ['attachment', 'draft'], ['identity loss', 'cancelled']]) {
  for (const check of [2, 3]) {
    test(`priority respects ${guard} at authorization check ${check}`, async () => {
      const f = fixture({ dot: true, args: { extensionPriority: true }, authorize: state => {
        if (state.checks >= 2) state.editor.value = `revision ${state.checks}`;
        if (state.checks === check) {
          if (guard === 'pause') return { ok: true, allowed: false };
          if (guard === 'attachment') state.addAttachment();
          if (guard === 'identity loss') state.loseIdentity();
        }
        return { ok: true, allowed: true };
      } });
      assert.equal((await f.run()).status, status);
      assert.equal(f.state.checks, check);
      assert.equal(f.state.editor.value, `revision ${check}`);
      assert.equal(f.state.clicks, 0);
      assert.equal(f.state.keys, 0);
    });
  }
}

test('priority cleanup does not edit a composer whose bound identity was lost', async () => {
  const f = fixture({ dot: true, args: { extensionPriority: true }, authorize: state => {
    if (state.checks === 3) state.editor.value = 'first change';
    if (state.checks === 3) state.loseIdentity();
    return { ok: true, allowed: true };
  } });
  assert.equal((await f.run()).status, 'cancelled');
  assert.equal(f.state.checks, 3);
  assert.equal(f.state.editor.value, 'first change');
  assert.equal(f.state.clicks, 0);
  assert.equal(f.state.keys, 0);
});
