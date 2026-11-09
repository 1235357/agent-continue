import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { editorCommit } from '../editor-commit.js';

// Synthetic public EditorView/model facade, not real layout, ProseMirror, or
// trusted keyboard delivery. Selector routing deliberately covers only this
// candidate's DOM contract. All content, URLs, identities, and time are fake.
function fixture(options = {}) {
  let now = 100;
  const expectedUrl = options.dot
    ? 'https://fixture.invalid/dots/conversation'
    : 'https://fixture.invalid/c/conversation';
  const location = { href: expectedUrl };
  const metrics = { transactions: 0, clicks: 0, keys: [], events: [], sent: [], rawWrites: 0, focus: 0 };
  const attachments = [];
  const files = [];
  const stops = [];
  let identity = 'account~dot~message';
  let buttons = [];
  let editors = [];

  class Element {
    isConnected = true;
    disabled = false;
    readOnly = false;
    isContentEditable = false;
    parentElement = null;
    style = { display: 'block', visibility: 'visible', opacity: '1' };
    attributes = {};
    getAttribute(name) { return this.attributes[name] ?? null; }
    getClientRects() { return [{}]; }
    closest(selector) {
      if (selector.includes('[inert]') || selector.includes('[hidden]')) return this.inert ? this : null;
      if (selector === '[data-composer-body]') return composer;
      return null;
    }
    dispatchEvent(event) {
      metrics.events.push(event.type);
      if (event.type === 'keydown' || event.type === 'keyup') {
        metrics.keys.push(event);
        if (event.type === 'keydown') metrics.sent.push(logical(view.state.doc));
      }
      options.onEvent?.(event.type, state);
      return false; // Cancellation is not permission to try a second method.
    }
    focus() {
      metrics.focus++;
      document.activeElement = this;
      options.onFocus?.(state);
    }
  }
  const editor = new Element();
  editor.isContentEditable = true;
  editor.attributes.contenteditable = 'true';
  for (const property of ['innerHTML', 'innerText', 'textContent']) {
    Object.defineProperty(editor, property, {
      get: () => options.renderedText ?? options.draft ?? 'old unsent text',
      set() { metrics.rawWrites++; throw new Error('No direct editor DOM writes'); },
    });
  }
  const composer = new Element();
  editor.parentElement = composer;
  composer.contains = element => element === editor || buttons.includes(element) || stops.includes(element);
  composer.querySelectorAll = selector => {
    if (selector.includes('[data-file-id]')) return attachments;
    if (selector === 'input[type="file"]') return files;
    if (selector.includes('stop-button')) return stops;
    return buttons.filter(button => selector.split(',').some(part => {
      const match = part.trim().match(/^button\[(data-testid|aria-label|type)="([^"]+)"\]$/);
      return match && button.getAttribute(match[1]) === match[2];
    }));
  };
  function button(label = 'Send') {
    const node = new Element();
    node.parentElement = composer;
    node.attributes['aria-label'] = label;
    node.disabled = options.disabled === true;
    node.click = function () {
      assert.ok(buttons.includes(this));
      metrics.clicks++;
      metrics.sent.push(logical(view.state.doc));
      options.onClick?.(state);
    };
    return node;
  }
  buttons = options.noSend ? [] : [button()];
  editors = [editor];

  function model(lines) {
    return {
      lines,
      content: { size: lines.reduce((size, line) => size + line.length + 2, 0) },
      textBetween(from, to, separator, leafText) {
        assert.equal(from, 0);
        assert.equal(to, this.content.size);
        assert.equal(separator, '\n');
        assert.equal(leafText, '\n');
        return this.lines.join(separator);
      },
      check() { if (options.invalidDocument) throw new Error('Synthetic invalid document'); },
    };
  }
  const logical = doc => doc.lines.join('\n');
  const schema = {
    text: text => ({ text }),
    nodes: { paragraph: { create: (_attrs, text) => ({ text: text?.text ?? '' }) } },
  };
  function editorState(doc) {
    return {
      doc, schema,
      get tr() {
        return {
          doc,
          replaceWith(from, to, paragraphs) {
            assert.equal(from, 0);
            assert.equal(to, doc.content.size);
            this.doc = model(Array.from(paragraphs, paragraph => paragraph.text));
            options.onPrepare?.(state);
            return this;
          },
        };
      },
    };
  }
  const view = {
    dom: editor, editable: true, isDestroyed: false,
    state: editorState(model((options.draft ?? 'old unsent text').split('\n'))),
    dispatch(transaction) {
      assert.equal(this, view, 'dispatch must retain the EditorView receiver');
      metrics.transactions++;
      if (!options.ignoreTransaction) this.state = editorState(transaction.doc);
      if (!options.disabled) for (const send of buttons) send.disabled = false;
      options.onCommit?.(state);
    },
  };
  editor.editor = { view };
  const row = { getAttribute: name => name === 'data-message-id' ? identity : null };
  const document = {
    body: {}, documentElement: {}, activeElement: null, visibilityState: 'visible',
    querySelectorAll(selector) {
      if (selector === 'article.message-row, [data-message-author-role], article[data-testid^="conversation-turn-"]') return identity === null ? [] : [row];
      if (selector.startsWith('#prompt-textarea') || selector.includes('[data-composer-input]')) return editors;
      throw new Error('Unexpected document-wide selector: ' + selector);
    },
  };
  const state = {
    editor, composer, view, schema, metrics, buttons, attachments, stops, files, location, document,
    setTime(value) { now = value; },
    setIdentity(value) { identity = value; },
    replaceButton() {
      for (const send of buttons) send.isConnected = false;
      buttons = [button()];
      state.buttons = buttons;
    },
    addButton(label) { buttons.push(button(label)); },
    addEditor() { editors = [...editors, new Element()]; },
    addAttachment() { attachments.push(new Element()); },
    addStop() { stops.push(new Element()); },
    setText(text) { view.state = editorState(model(text.split('\n'))); },
    removeView() { delete editor.editor; },
    replaceEditor() { editor.isConnected = false; editors = [new Element()]; },
  };
  class SyntheticEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  }
  const globals = {
    document, location, URL, Date: { now: () => now },
    Event: SyntheticEvent, KeyboardEvent: SyntheticEvent,
    getComputedStyle: element => element.style,
    window: {},
  };
  for (const name of ['chrome', 'fetch', 'setTimeout', 'setInterval', 'queueMicrotask']) {
    Object.defineProperty(globals, name, { get() { throw new Error('Forbidden API: ' + name); } });
  }
  const context = vm.createContext(globals);
  vm.runInContext('globalThis.commit = (' + editorCommit.toString() + ');', context);
  const args = {
    expectedUrl, targetIdentity: options.dot ? 'account~dot' : null,
    prompt: 'configured first\n\nconfigured last\n', sendMethod: 'button', deadline: 1000,
  };
  return { state, args, run: overrides => context.commit({ ...args, ...overrides }) };
}

function noDispatch(h) {
  assert.equal(h.state.metrics.clicks, 0);
  assert.equal(h.state.metrics.keys.length, 0);
  assert.equal(h.state.metrics.rawWrites, 0);
}

test('serialized helper synchronously transacts the configured logical lines, then clicks once', async () => {
  const h = fixture({ renderedText: 'stale DOM rendering', onCommit(state) {
    queueMicrotask(() => state.setText('later page rewrite'));
  } });
  const result = h.run();
  assert.equal(result.supported, true);
  assert.equal(result.dispatched, true);
  assert.equal(typeof result.then, 'undefined');
  assert.equal(h.state.metrics.transactions, 1);
  assert.equal(h.state.metrics.clicks, 1);
  assert.deepEqual(h.state.metrics.sent, [h.args.prompt]);
  assert.deepEqual(h.state.metrics.events, ['input', 'change']);
  assert.equal(h.state.metrics.rawWrites, 0);
  await Promise.resolve();
  assert.deepEqual(h.state.view.state.doc.lines, ['later page rewrite']);
});

test('logical text preserves whitespace and blank/trailing lines, normalizing only CRLF/CR', () => {
  const h = fixture();
  assert.equal(h.run({ prompt: '  first\r\n\r\nlast \r\n' }).dispatched, true);
  assert.deepEqual(h.state.metrics.sent, ['  first\n\nlast \n']);
});

test('post-event Send lookup clicks the replacement, not the stale control', () => {
  const h = fixture({ onEvent(type, state) { if (type === 'change') state.replaceButton(); } });
  const old = h.state.buttons[0];
  old.click = () => assert.fail('stale Send was clicked');
  assert.equal(h.run().dispatched, true);
  assert.equal(old.isConnected, false);
  assert.equal(h.state.metrics.clicks, 1);
});

for (const [name, alter] of [
  ['missing view', state => state.removeView()],
  ['wrong view DOM', state => { state.view.dom = {}; }],
  ['destroyed view', state => { state.view.isDestroyed = true; }],
  ['missing dispatch', state => { state.view.dispatch = null; }],
  ['missing paragraph schema', state => { delete state.schema.nodes.paragraph; }],
  ['unsupported transaction', state => { Object.defineProperty(state.view.state, 'tr', { value: {} }); }],
  ['invalid schema document', () => {}],
]) {
  test(`unsupported ${name} never mutates or dispatches`, () => {
    const h = fixture({ invalidDocument: name === 'invalid schema document' });
    alter(h.state);
    const result = h.run();
    assert.equal(result.supported, false);
    assert.equal(result.dispatched, false);
    assert.equal(h.state.metrics.transactions, 0);
    assert.equal(h.state.metrics.focus, 0);
    assert.deepEqual(h.state.metrics.events, []);
    noDispatch(h);
  });
}

for (const [name, alter, args] of [
  ['expired permission', () => {}, { deadline: 100 }],
  ['missing permission deadline', () => {}, { deadline: undefined }],
  ['nonfinite permission deadline', () => {}, { deadline: Infinity }],
  ['invalid method', () => {}, { sendMethod: 'enter' }],
  ['nonstring prompt', () => {}, { prompt: 42 }],
  ['empty prompt', () => {}, { prompt: ' \n' }],
  ['different origin', state => { state.location.href = 'https://other.invalid/dots/conversation'; }],
  ['outside Dot surface', state => { state.location.href = 'https://fixture.invalid/c/conversation'; }],
  ['target mismatch', state => state.setIdentity('account~other~message')],
  ['missing Dot identity', state => state.setIdentity(null)],
  ['unmatched raw Dot identity', state => state.setIdentity('different-raw-message-id')],
  ['attachments', state => state.addAttachment()],
  ['hidden selected file', state => state.files.push({ files: [{}] })],
  ['scoped Stop', state => state.addStop()],
  ['multiple editors', state => state.addEditor()],
  ['hidden editor', state => { state.editor.style.display = 'none'; }],
  ['readonly editor', state => { state.editor.isContentEditable = false; }],
  ['noneditable view', state => { state.view.editable = false; }],
  ['unbound body composer', state => { state.document.body = state.composer; }],
]) {
  test(`initial ${name} blocks before mutation`, () => {
    const h = fixture({ dot: true });
    alter(h.state);
    assert.equal(h.run(args).dispatched, false);
    assert.equal(h.state.metrics.transactions, 0);
    noDispatch(h);
  });
}

test('Dot identity can be stored only on the visible message body', () => {
  const h = fixture({ dot: true });
  const row = h.state.document.querySelectorAll('article.message-row, [data-message-author-role], article[data-testid^="conversation-turn-"]')[0];
  row.getAttribute = () => null;
  row.querySelector = () => ({ getAttribute: name => name === 'data-message-id' ? 'account~dot~message' : null });
  assert.equal(h.run().dispatched, true);
  assert.equal(h.state.metrics.clicks, 1);
});

test('last precommit guard catches changes during detached transaction construction', () => {
  const h = fixture({ onPrepare: state => state.addAttachment() });
  assert.equal(h.run().dispatched, false);
  assert.equal(h.state.metrics.transactions, 0);
  noDispatch(h);
});

for (const stage of ['commit', 'focus', 'input', 'change']) {
  for (const [name, change] of [
    ['page', state => { state.location.href = 'https://other.invalid/dots/conversation'; }],
    ['target', state => state.setIdentity('other~dot~message')],
    ['attachment', state => state.addAttachment()],
    ['Stop', state => state.addStop()],
    ['expiry', state => state.setTime(1000)],
    ['editor', state => state.replaceEditor()],
    ['public view', state => state.removeView()],
    ['editability', state => { state.view.editable = false; }],
  ]) {
    test(`${name} change at ${stage} prevents submission without retry`, () => {
      const h = fixture({ dot: true,
        onCommit: stage === 'commit' ? change : undefined,
        onFocus: stage === 'focus' ? change : undefined,
        onEvent(type, state) { if (type === stage) change(state); },
      });
      assert.equal(h.run().dispatched, false);
      assert.equal(h.state.metrics.transactions, 1);
      noDispatch(h);
    });
  }
}

test('ordinary URL comparison ignores query, hash, and trailing slashes', () => {
  const h = fixture();
  h.state.location.href += '/?composer=1#active';
  assert.equal(h.run().dispatched, true);
  const other = fixture();
  other.state.location.href += '/other';
  assert.equal(other.run().dispatched, false);
  noDispatch(other);
});

test('same-origin Dot route rewrites require the captured identity, even when targetIdentity is omitted', () => {
  for (const targetIdentity of ['account~dot', undefined]) {
    const h = fixture({ dot: true, onEvent(type, state) {
      if (type === 'input') state.location.href = 'https://fixture.invalid/dots/rewritten/?q=1#active';
    } });
    assert.equal(h.run({ targetIdentity }).dispatched, true);
    assert.deepEqual(h.state.metrics.sent, [h.args.prompt]);
    const mismatch = fixture({ dot: true, onEvent(type, state) {
      if (type === 'input') {
        state.location.href = 'https://fixture.invalid/dots/rewritten';
        state.setIdentity('account~other~message');
      }
    } });
    assert.equal(mismatch.run({ targetIdentity }).dispatched, false);
    noDispatch(mismatch);
  }
});

for (const stage of ['commit', 'focus', 'input', 'change']) {
  test(`content rewrite at ${stage} reasserts configured text instead of vetoing the send`, () => {
    const rewrite = state => state.setText('intervening page-controlled content');
    const h = fixture({
      onCommit(state) { if (stage === 'commit' && state.metrics.transactions === 1) rewrite(state); },
      onFocus: stage === 'focus' ? rewrite : undefined,
      onEvent(type, state) { if (type === stage) rewrite(state); },
    });
    assert.equal(h.run().dispatched, true);
    assert.equal(h.state.metrics.transactions, 2);
    assert.equal(h.state.metrics.clicks, 1);
    assert.deepEqual(h.state.metrics.sent, [h.args.prompt]);
    assert.deepEqual(h.state.metrics.events, ['input', 'change']);
  });
}

test('DOM-only success without synchronous EditorView state update exhausts one correction, never submits', () => {
  const h = fixture({ ignoreTransaction: true });
  assert.equal(h.run().dispatched, false);
  assert.equal(h.state.metrics.transactions, 2);
  noDispatch(h);
});

for (const [dot, sendMethod, ctrl, clicks] of [
  [false, 'auto', false, 0], [true, 'auto', true, 0],
  [false, 'ctrl-enter', true, 0], [true, 'ctrl-enter', true, 0],
  [true, 'button', null, 0],
]) {
  test(`no scoped Send: ${dot ? 'Dot' : 'ordinary'} ${sendMethod} keeps explicit fallback semantics`, () => {
    const h = fixture({ dot, noSend: true });
    const result = h.run({ sendMethod });
    assert.equal(result.dispatched, ctrl !== null);
    assert.equal(h.state.metrics.clicks, clicks);
    assert.deepEqual(h.state.metrics.keys.map(event => event.type), ctrl === null ? [] : ['keydown', 'keyup']);
    for (const event of h.state.metrics.keys) {
      assert.equal(event.ctrlKey, ctrl);
      assert.equal(event.key, 'Enter');
      assert.equal(event.code, 'Enter');
      assert.equal(event.keyCode, 13);
      assert.equal(event.which, 13);
      assert.equal(event.bubbles, true);
      assert.equal(event.composed, true);
      assert.equal(event.metaKey || event.altKey || event.shiftKey, false);
    }
  });
}

test('auto prefers scoped Send; ctrl-enter never clicks an available Send', () => {
  const auto = fixture({ dot: true });
  assert.equal(auto.run({ sendMethod: 'auto' }).dispatched, true);
  assert.equal(auto.state.metrics.clicks, 1);
  assert.deepEqual(auto.state.metrics.keys, []);
  const keyboard = fixture();
  assert.equal(keyboard.run({ sendMethod: 'ctrl-enter' }).dispatched, true);
  assert.equal(keyboard.state.metrics.clicks, 0);
  assert.equal(keyboard.state.metrics.keys.length, 2);
});

test('model preparation and read-only readiness wait for delayed Send before one commit', () => {
  const h = fixture({ dot: true, disabled: true });
  const prepared = h.run({ phase: 'prepare', sendMethod: 'auto' });
  assert.equal(prepared.code, 'prepared');
  assert.equal(prepared.supported, true);
  assert.equal(prepared.dispatched, false);
  noDispatch(h);
  const before = structuredClone(h.state.metrics);
  const waiting = h.run({ phase: 'observe', sendMethod: 'auto' });
  assert.equal(waiting.code, 'waiting-send');
  assert.equal(waiting.dispatched, false);
  assert.deepEqual(h.state.metrics, before, 'readiness cannot modify the model, focus or events');
  h.state.buttons[0].disabled = false;
  assert.equal(h.run({ phase: 'observe', sendMethod: 'auto' }).code, 'ready');
  h.state.setText('PAGE_CHANGED_WHILE_WAITING');
  assert.equal(h.run({ phase: 'commit', sendMethod: 'auto' }).dispatched, true);
  assert.equal(h.state.metrics.clicks, 1);
  assert.deepEqual(h.state.metrics.keys, []);
  assert.deepEqual(h.state.metrics.sent, [h.args.prompt]);
  assert.deepEqual(h.state.metrics.events, before.events, 'Final model correction cannot repeat the input/restore cycle');
});

test('observation preserves explicit keyboard choice without changing a disabled model', () => {
  const h = fixture({ disabled: true });
  const before = structuredClone(h.state.metrics);
  assert.equal(h.run({ phase: 'observe', sendMethod: 'ctrl-enter' }).code, 'ready');
  assert.deepEqual(h.state.metrics, before);
  assert.equal(h.run({ phase: 'invalid' }).code, 'invalid-phase');
  noDispatch(h);
});
test('a previously observed Send can disappear temporarily without triggering keyboard fallback', () => {
  const h = fixture({ dot: true, disabled: true });
  assert.equal(h.run({ phase: 'prepare', sendMethod: 'auto' }).hasSend, true);
  for (const send of h.state.buttons) send.isConnected = false;
  assert.equal(h.run({ phase: 'observe', sendMethod: 'auto', requireButton: true }).code, 'waiting-send');
  assert.equal(h.run({ phase: 'commit', sendMethod: 'auto', requireButton: true }).dispatched, false);
  noDispatch(h);
  h.state.replaceButton();
  h.state.buttons[0].disabled = false;
  assert.equal(h.run({ phase: 'commit', sendMethod: 'auto', requireButton: true }).method, 'button');
  assert.equal(h.state.metrics.clicks, 1);
  assert.deepEqual(h.state.metrics.keys, []);
});
test('Send present at final commit entry remains required if the corrective transaction unmounts it', () => {
  const h = fixture({ dot: true, disabled: true, onCommit(state) {
    for (const send of state.buttons) send.isConnected = false;
  } });
  assert.equal(h.run({ phase: 'commit', sendMethod: 'auto', requireButton: false }).code, 'waiting-send');
  assert.equal(h.state.metrics.transactions, 1);
  assert.deepEqual(h.state.view.state.doc.lines.join('\n'), h.args.prompt);
  noDispatch(h);
});

test('disabled Send blocks button-only but does not block keyboard-only', () => {
  const h = fixture({ disabled: true });
  assert.equal(h.run().dispatched, false);
  noDispatch(h);
  const keyboard = fixture({ disabled: true });
  assert.equal(keyboard.run({ sendMethod: 'ctrl-enter' }).dispatched, true);
  assert.equal(keyboard.state.metrics.keys.length, 2);
});

test('missing user-scoped Send never borrows a document-wide or unrelated control', () => {
  const h = fixture({ noSend: true });
  h.state.addButton('Send feedback');
  assert.equal(h.run().dispatched, false);
  noDispatch(h);
});

test('ambiguous enabled scoped Send controls fail closed instead of picking one', () => {
  const h = fixture();
  h.state.addButton('Send message');
  assert.equal(h.run({ sendMethod: 'auto' }).dispatched, false);
  noDispatch(h);
});

test('throwing submission is marked attempted and never followed by keyboard fallback', () => {
  const h = fixture({ onClick() { throw new Error('secret prompt/body in exception'); } });
  const result = h.run({ sendMethod: 'auto' });
  assert.equal(result.dispatched, true);
  assert.equal(h.state.metrics.clicks, 1);
  assert.deepEqual(h.state.metrics.keys, []);
  assert.doesNotMatch(JSON.stringify(result), /secret|prompt|body|configured|fixture\.invalid/);
});

test('outcome is content-free attempt evidence, not a send receipt', () => {
  const h = fixture();
  const result = h.run();
  assert.deepEqual(Object.keys(result).sort(), ['code', 'dispatched', 'method', 'supported']);
  assert.equal(result.code, 'dispatched');
  assert.equal(result.method, 'button');
  assert.doesNotMatch(JSON.stringify(result), /configured|old unsent|fixture\.invalid|sent|confirmed/);
});
