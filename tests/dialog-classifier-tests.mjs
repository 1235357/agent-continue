import test from 'node:test';
import assert from 'node:assert/strict';

// Helper to simulate a browser-like DOM environment in Node.js
class FakeElement {
  constructor(tagName = 'div', attributes = {}, textContent = '') {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.children = [];
    this.parentElement = null;
    this.textContent = textContent;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name) {
    return Object.hasOwn(this.attributes, name);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.matches && curr.matches(selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  matches(selector) {
    if (selector.includes('[role="dialog"]') && this.getAttribute('role') === 'dialog') return true;
    if (selector.includes('[aria-modal="true"]') && this.getAttribute('aria-modal') === 'true') return true;
    if (selector.includes('article.message-row') && this.attributes.class?.includes('message-row')) return true;
    if (selector.includes('[data-message-author-role="assistant"]') && this.getAttribute('data-message-author-role') === 'assistant') return true;
    return false;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = node => {
      for (const child of node.children) {
        if (child.matches && child.matches(selector)) {
          results.push(child);
        } else if (selector.includes('a[href*="accounts.google.com"]') && child.tagName === 'A' && (child.getAttribute('href') || '').includes('accounts.google.com')) {
          results.push(child);
        } else if (selector.includes('data-href') && (child.getAttribute('data-href') || '').includes('accounts.google.com')) {
          results.push(child);
        } else if (!selector.includes('data-href') && (selector.includes('button') || selector.includes('[role="button"]')) && (child.tagName === 'BUTTON' || child.getAttribute('role') === 'button')) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }
}

class FakeDocument {
  constructor() {
    this.title = 'ChatGPT';
    this.body = new FakeElement('body');
    this.elementsById = new Map();
  }

  getElementById(id) {
    return this.elementsById.get(id) || null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = node => {
      for (const child of node.children) {
        if (selector.includes('[role="dialog"]') && child.getAttribute('role') === 'dialog') {
          results.push(child);
        } else if (selector.includes('[role="alertdialog"]') && child.getAttribute('role') === 'alertdialog') {
          results.push(child);
        } else if (selector.includes('[aria-modal="true"]') && child.getAttribute('aria-modal') === 'true') {
          results.push(child);
        } else if (selector.includes('[data-testid="login-button"]') && child.getAttribute('data-testid') === 'login-button') {
          results.push(child);
        } else if (selector.includes('form[action*="login"]') && child.tagName === 'FORM' && (child.getAttribute('action') || '').includes('login')) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this.body);
    return results;
  }
}

// Set up globals before importing dialog-classifier
const doc = new FakeDocument();
globalThis.document = doc;
globalThis.window = {
  location: {
    hostname: 'chatgpt.com',
    pathname: '/c/test-chat',
  },
};
globalThis.getComputedStyle = el => ({
  display: el.getAttribute('data-display') || 'block',
  visibility: el.getAttribute('data-visibility') || 'visible',
});

// Import the classifier script
await import('../dialog-classifier.js');
const classifyDialogContext = globalThis.__agentContinueClassifyDialog;

test('TC-01: Normal chat, no dialog -> safe: true, kind: none', () => {
  doc.title = 'ChatGPT';
  doc.body = new FakeElement('body');
  const textarea = new FakeElement('textarea', { id: 'prompt-textarea' });
  doc.body.appendChild(textarea);
  doc.elementsById.set('prompt-textarea', textarea);
  window.location.hostname = 'chatgpt.com';
  window.location.pathname = '/c/test-chat';

  const t0 = performance.now();
  const res = classifyDialogContext();
  const elapsed = performance.now() - t0;

  assert.equal(res.safe, true);
  assert.equal(res.kind, 'none');
  assert.ok(elapsed < 10, `Elapsed ${elapsed}ms should be fast`);
});

test('TC-02: Simple ChatGPT tool-use dialog -> safe: true, kind: none', () => {
  doc.title = 'ChatGPT';
  doc.body = new FakeElement('body');
  const textarea = new FakeElement('textarea', { id: 'prompt-textarea' });
  doc.body.appendChild(textarea);
  doc.elementsById.set('prompt-textarea', textarea);

  // Dialog inside assistant message row with Allow button
  const turn = new FakeElement('article', { class: 'message-row', 'data-message-author-role': 'assistant' });
  const dialog = new FakeElement('div', { role: 'dialog' }, 'Allow ChatGPT to search your messages in your room for "Smartsheet"?');
  const allowBtn = new FakeElement('button', {}, 'Allow');
  dialog.appendChild(allowBtn);
  turn.appendChild(dialog);
  doc.body.appendChild(turn);

  const res = classifyDialogContext();
  assert.equal(res.safe, true);
  assert.equal(res.kind, 'none');
});

test('TC-03: Session expired page -> safe: false, kind: session-expired', () => {
  doc.title = 'Sign in to ChatGPT — ChatGPT';
  doc.body = new FakeElement('body');
  doc.elementsById.clear(); // No prompt-textarea
  window.location.pathname = '/auth/login';

  const loginForm = new FakeElement('form', { action: '/auth/login' });
  doc.body.appendChild(loginForm);

  const res = classifyDialogContext();
  assert.equal(res.safe, false);
  assert.equal(res.kind, 'session-expired');
  assert.ok(res.confidence >= 0.9, 'Confidence should be >= 0.9 for 2+ signals');
  assert.ok(res.evidence.length >= 2);
});

test('TC-04: OAuth dialog — "Sign in with Google" -> safe: false, kind: oauth-popup', () => {
  doc.title = 'ChatGPT';
  doc.body = new FakeElement('body');
  const textarea = new FakeElement('textarea', { id: 'prompt-textarea' });
  doc.body.appendChild(textarea);
  doc.elementsById.set('prompt-textarea', textarea);
  window.location.pathname = '/c/test-chat';

  const dialog = new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }, 'Sign in with Google to connect your account');
  const googleBtn = new FakeElement('button', {}, 'Sign in with Google');
  dialog.appendChild(googleBtn);
  doc.body.appendChild(dialog);

  const res = classifyDialogContext();
  assert.equal(res.safe, false);
  assert.equal(res.kind, 'oauth-popup');
  assert.ok(res.confidence >= 0.8);
});

test('TC-04b: Mixed dialog with OAuth text and Allow button -> safe: false, kind: oauth-popup takes priority', () => {
  doc.title = 'ChatGPT';
  doc.body = new FakeElement('body');
  const textarea = new FakeElement('textarea', { id: 'prompt-textarea' });
  doc.body.appendChild(textarea);
  doc.elementsById.set('prompt-textarea', textarea);

  const dialog = new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }, 'Sign in with Google or Allow connection');
  const allowBtn = new FakeElement('button', {}, 'Allow');
  const googleBtn = new FakeElement('button', {}, 'Sign in with Google');
  dialog.appendChild(allowBtn);
  dialog.appendChild(googleBtn);
  doc.body.appendChild(dialog);

  const res = classifyDialogContext();
  assert.equal(res.safe, false);
  assert.equal(res.kind, 'oauth-popup');
});

test('TC-04c: Inline Dot assistant message card mentioning GitHub sign-in does not fire oauth-popup', () => {
  doc.title = 'Your dot';
  doc.body = new FakeElement('body');
  const turn = new FakeElement('article', { class: 'message-row', 'data-message-author-role': 'assistant' });
  const card = new FakeElement('div', { role: 'dialog' }, 'Sign-in request github.com Sign in with GitHub');
  turn.appendChild(card);
  doc.body.appendChild(turn);

  const res = classifyDialogContext();
  assert.equal(res.safe, true);
  assert.equal(res.kind, 'none');
});

test('TC-05: Unknown modal persisting over 5s -> safe: false, kind: unknown-modal', () => {
  doc.title = 'ChatGPT';
  doc.body = new FakeElement('body');
  const textarea = new FakeElement('textarea', { id: 'prompt-textarea' });
  doc.body.appendChild(textarea);
  doc.elementsById.set('prompt-textarea', textarea);

  const modal = new FakeElement('div', { role: 'dialog' }, 'Cookie notice: We use cookies. Learn more.');
  const okBtn = new FakeElement('button', {}, 'Got it');
  modal.appendChild(okBtn);
  doc.body.appendChild(modal);

  // First check records timestamp in WeakMap
  const res1 = classifyDialogContext();
  assert.equal(res1.safe, true, 'First seen should not trigger unknown-modal immediately');
  assert.equal(res1.recheckAfterMs, 5000, 'A stationary modal needs a delayed observation even without DOM mutation');

  // Advance first seen timestamp by 6000ms
  const firstSeenMap = globalThis.__agentContinueFirstSeenMap;
  firstSeenMap.set(modal, performance.now() - 6000);

  const res2 = classifyDialogContext();
  assert.equal(res2.safe, false);
  assert.equal(res2.kind, 'unknown-modal');
  assert.equal(res2.recheckAfterMs, undefined);
});

test('TC-08: Performance — 100 rapid calls average < 2ms', () => {
  doc.title = 'ChatGPT';
  doc.body = new FakeElement('body');
  const textarea = new FakeElement('textarea', { id: 'prompt-textarea' });
  doc.body.appendChild(textarea);
  doc.elementsById.set('prompt-textarea', textarea);

  // Populate 50 article message rows
  for (let i = 0; i < 50; i++) {
    const article = new FakeElement('article', { class: 'message-row' }, 'Sample message text '.repeat(30));
    doc.body.appendChild(article);
  }

  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    classifyDialogContext();
  }
  const total = performance.now() - start;
  const avg = total / 100;

  assert.ok(avg < 2, `Average time per call ${avg.toFixed(3)}ms should be < 2ms`);
});

test('TC-09: Classifier outputs structured flags and ignores benign Dot handover modal on /dots/', () => {
  doc.title = 'Your dot';
  doc.body = new FakeElement('body');
  const textarea = new FakeElement('textarea', { id: 'prompt-textarea' });
  doc.body.appendChild(textarea);
  doc.elementsById.set('prompt-textarea', textarea);
  window.location.pathname = '/dots/home';

  const handoverDlg = new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }, 'Sign-in request github.com');
  handoverDlg.appendChild(new FakeElement('button', {}, 'Take over'));
  doc.body.appendChild(handoverDlg);
  globalThis.__agentContinueFirstSeenMap.set(handoverDlg, performance.now() - 8000);

  const dotSafe = classifyDialogContext();
  assert.equal(dotSafe.safe, true);
  assert.equal(dotSafe.kind, 'none');

  const otherDlg = new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }, 'Unrecognized notice');
  otherDlg.appendChild(new FakeElement('button', {}, 'Got it'));
  doc.body.appendChild(otherDlg);
  globalThis.__agentContinueFirstSeenMap.set(otherDlg, performance.now() - 8000);

  const flagged = classifyDialogContext();
  assert.equal(flagged.safe, false);
  assert.equal(flagged.kind, 'unknown-modal');
  assert.equal(flagged.surface, 'modal');
  assert.equal(flagged.composerPresent, true);
  assert.deepEqual(flagged.evidenceFlags, ['role-dialog', 'aria-modal', 'composer-present']);
});

test('TC-10: Citation/quote-reply dialog containing a composer is ignored by detectUnknownModal', () => {
  doc.title = 'Your dot';
  doc.body = new FakeElement('body');
  window.location.pathname = '/dots/home';

  const citationDlg = new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }, 'Quoted thread reply');
  const citationEditor = new FakeElement('div', { 'data-composer-markdown': '', role: 'textbox', contenteditable: 'true' });
  citationDlg.querySelector = sel => sel.includes('[data-composer-markdown]') ? citationEditor : null;
  citationDlg.appendChild(citationEditor);
  doc.body.appendChild(citationDlg);
  globalThis.__agentContinueFirstSeenMap.set(citationDlg, performance.now() - 8000);

  const res = classifyDialogContext();
  assert.equal(res.safe, true);
  assert.equal(res.kind, 'none');
});
