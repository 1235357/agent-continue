// Synthetic Dot DOM matching observed structural attributes. No real messages,
// user attachments, signed-in sessions, or live ChatGPT network calls are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const { pageAction } = await import(pathToFileURL(path.join(root, 'adapter.js')));
const { validateTarget } = await import(pathToFileURL(path.join(root, 'config.js')));
const playwright = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href)
  : await import('playwright');
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const expectedUrl = 'https://chatgpt.com/dots/home';
const prompt = '  Synthetic dot continuation\n继续推进独立测试任务。\n  ';
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body { font: 16px sans-serif; padding: 20px; } [contenteditable] { min-height: 100px; white-space: pre-wrap; border: 1px solid gray; } [hidden] { display: none !important; }
</style></head><body>
<main id="conversation">
<article class="message-row self" data-message-id="acct~dot~Msg~user-old"><div class="message-body" data-message-id="acct~dot~Msg~user-old">Earlier synthetic request</div></article>
<article class="message-row" data-message-id="acct~dot~Msg~assistant-old"><div class="message-body" data-message-id="acct~dot~Msg~assistant-old">Earlier synthetic response</div></article>
</main>
<div data-composer-root><div data-composer-body><div data-composer-input><div data-composer-markdown contenteditable="true" role="textbox" aria-label="Message"></div></div><div id="attachment-slot"></div><button type="button" aria-label="Send" disabled>Send</button></div></div>
<script>
window.fixture = { checks: 0, sends: 0, stops: 0, inputs: 0, beforeInputs: 0, requiresBeforeInput: false, beforeInputAccepted: false, frameworkReplacements: 0, actions: [], remounts: 0, allowed: true, cancelOnInput: false, cancelOnStop: false, idPlacement: 'both', acknowledgement: 'new', switchIdentityAtCheck: null, whitespaceAtCheck: null, cancelWithWhitespace: false, modifiedDraft: null, clipboardCalls: 0, focusCalls: 0, sentTexts: [] };
let editor = document.querySelector('[data-composer-markdown]');
let send = document.querySelector('button[aria-label="Send"]');
const logicalText = root => {
  const blocks = new Set(['DIV', 'P']);
  const read = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.data;
    if (node.nodeName === 'BR') return '\\n';
    const children = [...node.childNodes];
    if (children.length === 1 && children[0].nodeName === 'BR' && (node === root || blocks.has(node.nodeName))) return '';
    return children.reduce((text, child, index) => {
      const boundary = index > 0 && (blocks.has(child.nodeName) || blocks.has(children[index - 1].nodeName));
      return text + (boundary ? '\\n' : '') + read(child);
    }, '');
  };
  return read(root);
};
window.setIdentity = prefix => {
  for (const node of document.querySelectorAll('[data-message-id]')) {
    const parts = node.getAttribute('data-message-id').split('~');
    node.setAttribute('data-message-id', prefix + '~' + parts.slice(2).join('~'));
  }
};
window.appendMessage = (text, key, self = true) => {
  const row = document.createElement('article'); row.className = 'message-row' + (self ? ' self' : '');
  const body = document.createElement('div'); body.className = 'message-body'; body.innerText = text;
  if (fixture.idPlacement !== 'body') row.setAttribute('data-message-id', key);
  if (fixture.idPlacement !== 'row') body.setAttribute('data-message-id', key);
  row.append(body); document.querySelector('#conversation').append(row); return body;
};
Object.defineProperty(navigator, 'clipboard', { value: { readText() { fixture.clipboardCalls++; return ''; }, writeText() { fixture.clipboardCalls++; } }, configurable: true });
window.focus = () => { fixture.focusCalls++; };
window.chrome = { runtime: { sendMessage: async message => {
  if (message.type !== 'CHECK_RUN') throw new Error('Unexpected fixture request');
  fixture.checks++;
  if (fixture.switchIdentityAtCheck === fixture.checks) setIdentity('other-account~other-dot');
  if (fixture.whitespaceAtCheck === fixture.checks) {
    editor.textContent = editor.innerText + ' ';
    fixture.modifiedDraft = editor.innerText;
    if (fixture.cancelWithWhitespace) fixture.allowed = false;
  }
  return { ok: true, allowed: fixture.allowed };
} } };
const onInput = () => {
  fixture.inputs++;
  if (fixture.cancelOnInput) fixture.allowed = false;
  if (send) send.disabled = !editor.innerText.trim() || (fixture.requiresBeforeInput && !fixture.beforeInputAccepted);
};
const onSend = () => {
  fixture.sends++;
  fixture.actions.push('send');
  const text = logicalText(editor); fixture.sentTexts.push(text); editor.textContent = ''; send.disabled = true;
  if (fixture.acknowledgement === 'new') appendMessage(text, 'acct~dot~Msg~new-' + fixture.sends);
  if (fixture.acknowledgement === 'clone-old') {
    const old = document.querySelector('article.message-row.self');
    const clone = old.cloneNode(true); old.remove(); document.querySelector('#conversation').append(clone);
  }
};
window.bindComposer = () => {
  editor = document.querySelector('[data-composer-markdown]');
  send = document.querySelector('button[aria-label="Send"]');
  editor.removeEventListener('input', onInput);
  editor.addEventListener('input', onInput);
  if (send) { send.removeEventListener('click', onSend); send.addEventListener('click', onSend); }
};
bindComposer();
// This models an explicit stop-to-send transition. It is a synthetic regression
// fixture, not a claim that the current Dot UI exposes this particular control.
window.startWork = ({ replaceSend = true, remount = false, delay = 80 } = {}) => {
  if (replaceSend) send.hidden = true;
  const stop = document.createElement('button');
  stop.type = 'button'; stop.setAttribute('aria-label', 'Stop generating'); stop.textContent = 'Stop';
  stop.addEventListener('click', () => {
    fixture.stops++; fixture.actions.push('stop');
    stop.disabled = true;
    if (fixture.cancelOnStop) fixture.allowed = false;
    setTimeout(() => {
      if (remount) {
        const old = document.querySelector('[data-composer-root]');
        const replacement = old.cloneNode(true);
        replacement.querySelector('button[aria-label="Stop generating"]').remove();
        replacement.querySelector('button[aria-label="Send"]').hidden = false;
        old.replaceWith(replacement); fixture.remounts++; bindComposer();
      } else { stop.remove(); send.hidden = false; }
      send.disabled = !editor.innerText.trim();
    }, delay);
  });
  document.querySelector('[data-composer-body]').append(stop);
};
</script></body></html>`;

let passed = 0;
let failed = 0;
async function scenario(name, callback) {
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  const page = await context.newPage();
  await page.goto(expectedUrl);
  // Omitting waitForIdle exercises the force-by-default contract. Waiting tests
  // opt in explicitly so a future default change cannot silently weaken them.
  // These historical regressions exercise the explicit button strategy. Dot's
  // default Ctrl+Enter path is covered in dot-keyboard-tests and real MV3 tests.
  const args = { mode: 'send', expectedUrl, targetIdentity: 'acct~dot', prompt, sendMethod: 'button', runId: 'synthetic-dot-run', runDeadline: Date.now() + 12_000, stopMarkers: [] };
  try { await callback({ context, page, args }); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
  finally { await context.close(); }
}

try {
  for (const change of ['route with stale history', 'new identity at the same URL']) await scenario('Dot blocks ' + change, async ({ page, args }) => {
    await page.evaluate(change => {
      if (change === 'route with stale history') history.replaceState(null, '', '/dots/synthetic-other');
      else appendMessage('Synthetic different conversation', 'acct~other~Msg~new');
    }, change);
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'blocked');
    assert.deepEqual(await page.evaluate(() => [fixture.inputs, fixture.sends]), [0, 0]);
  });
  for (const [name, html, editorSelector, buttonSelector, receiptSelector] of [
    ['Dot', fixture, '[data-composer-markdown]', 'button[aria-label="Send"]', 'article.message-row.self:last-child .message-body'],
    ['ChatGPT', await fs.readFile(path.join(here, 'fixture.html'), 'utf8'), '#prompt-textarea', '[data-testid="send-button"]', '#history [data-message-author-role="user"]:last-child'],
  ]) {
    await scenario(name + ' fixture sends logical text rather than rendered newline artifacts', async ({ page }) => {
      await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
      await page.goto(expectedUrl);
      for (const [markup, text] of [
        ['<p>First line</p><p>Second line</p>', 'First line\nSecond line'],
        ['<p>First line</p><p><br></p><p>Second line</p>', 'First line\n\nSecond line'],
        ['<p>First line</p><p><br></p>', 'First line\n'],
      ]) {
        const state = await page.evaluate(({ markup, editorSelector, buttonSelector, receiptSelector }) => {
          const editor = document.querySelector(editorSelector);
          editor.innerHTML = markup;
          const rendered = editor.innerText;
          editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
          document.querySelector(buttonSelector).click();
          return { rendered, sent: fixture.sentTexts.at(-1), receipt: document.querySelector(receiptSelector)?.innerText };
        }, { markup, editorSelector, buttonSelector, receiptSelector });
        assert.notEqual(state.rendered, text);
        assert.equal(state.sent, text);
        assert.equal(state.receipt, text);
      }
    });
  }
  await scenario('Equivalent paragraph rendering after fill submits the unchanged draft exactly once', async ({ page, args }) => {
    await page.evaluate(() => {
      const editor = document.querySelector('[data-composer-markdown]');
      editor.addEventListener('input', () => {
        editor.innerHTML = '<div>Alpha</div><div>Beta</div>';
        const before = editor.innerText;
        setTimeout(() => {
          editor.innerHTML = '<p>Alpha</p><p>Beta</p>';
          fixture.presentationChanged = editor.innerText !== before;
        }, 15);
      }, { once: true });
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: 'Alpha\nBeta' });
    const state = await page.evaluate(() => ({ sends: fixture.sends, presentationChanged: fixture.presentationChanged }));
    assert.equal(state.presentationChanged, true);
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.equal(state.sends, 1);
    assert.equal(await page.evaluate(() => fixture.sentTexts[0]), 'Alpha\nBeta');
  });

  await scenario('Explicit extension priority replaces existing and later text, and Auto uses one usable Dot button', async ({ page, args }) => {
    const editor = page.getByRole('textbox', { name: 'Message' });
    await editor.fill('Existing draft not intended to be sent');
    await page.evaluate(() => {
      const editor = document.querySelector('[data-composer-markdown]');
      editor.addEventListener('input', () => {
        setTimeout(() => { editor.textContent = 'Different text after the extension filled'; }, 15);
      }, { once: true });
    });
    const configured = 'Configured continuation only';
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured, sendMethod: 'auto', extensionPriority: true });
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    const state = await page.evaluate(() => ({ sends: fixture.sends, texts: fixture.sentTexts }));
    assert.equal(state.sends, 1);
    assert.equal(state.texts[0].replace(/\u00a0/g, ' '), configured);
  });

  await scenario('A disabled duplicate does not mask the usable Send button in the same composer', async ({ page, args }) => {
    await page.evaluate(() => {
      const stale = document.createElement('button');
      stale.setAttribute('data-testid', 'send-button');
      stale.disabled = true;
      stale.textContent = 'Stale Send';
      document.querySelector('[data-composer-body]').prepend(stale);
    });
    const outcome = await page.evaluate(pageAction, { ...args, extensionPriority: true, sendMethod: 'auto' });
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });

  await scenario('A slow continually restored composer never dispatches the wrong draft', async ({ page, args }) => {
    await page.evaluate(() => {
      let measured = 0;
      Object.defineProperty(performance, 'now', { configurable: true, value: () => measured });
      const editor = document.querySelector('[data-composer-markdown]');
      editor.addEventListener('input', () => {
        measured += 3000;
        editor.textContent = 'SYNTHETIC_PAGE_RESTORE';
      });
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: 'SYNTHETIC_SLOW_WRITE' });
    const observed = await page.evaluate(() => ({ inputs: fixture.inputs, sends: fixture.sends, text: document.querySelector('[data-composer-markdown]').textContent }));
    assert.equal(outcome.status, 'blocked');
    assert.equal(outcome.diagnosticCode, 'composer-slow-write');
    assert.equal(outcome.diagnosticProgress.counters.domWrites, 2);
    assert.equal(outcome.diagnosticProgress.counters.dispatchAttempts, 0);
    assert.equal(outcome.diagnosticProgress.timings.maxDomWriteMs, 3000);
    assert.deepEqual(observed, { inputs: 2, sends: 0, text: 'SYNTHETIC_PAGE_RESTORE' });
  });

  await scenario('A slow matching insertion still sends once when the composer remains ready', async ({ page, args }) => {
    await page.evaluate(() => {
      let measured = 0;
      Object.defineProperty(performance, 'now', { configurable: true, value: () => measured });
      document.querySelector('[data-composer-markdown]').addEventListener('input', () => { measured += 3000; });
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: 'SYNTHETIC_SLOW_READY' });
    const observed = await page.evaluate(() => ({ inputs: fixture.inputs, sends: fixture.sends, texts: fixture.sentTexts }));
    assert.equal(outcome.status, 'sent');
    assert.equal(outcome.diagnosticProgress.counters.domWrites, 1);
    assert.equal(outcome.diagnosticProgress.counters.dispatchAttempts, 1);
    assert.deepEqual(observed, { inputs: 1, sends: 1, texts: ['SYNTHETIC_SLOW_READY'] });
  });

  await scenario('A slow write followed by a busy page records a retryable pre-submit result', async ({ page, args }) => {
    await page.evaluate(() => {
      let measured = 0;
      Object.defineProperty(performance, 'now', { configurable: true, value: () => measured });
      const editor = document.querySelector('[data-composer-markdown]');
      editor.addEventListener('input', () => {
        measured += 3000;
        const indicator = document.createElement('span');
        indicator.className = 'typing-indicator';
        indicator.textContent = 'Synthetic busy';
        document.body.append(indicator);
      });
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: 'SYNTHETIC_SLOW_BUSY',
      waitForIdle: true, persistentDelivery: true });
    const observed = await page.evaluate(() => ({ inputs: fixture.inputs, sends: fixture.sends }));
    assert.equal(outcome.status, 'busy');
    assert.equal(outcome.retryable, true);
    assert.equal(outcome.diagnosticProgress.counters.domWrites, 1);
    assert.equal(outcome.diagnosticProgress.counters.dispatchAttempts, 0);
    assert.deepEqual(observed, { inputs: 1, sends: 0 });
  });

  await scenario('A slow matching composer without a Send control never dispatches before cancellation', async ({ page, args }) => {
    await page.evaluate(() => {
      let measured = 0;
      Object.defineProperty(performance, 'now', { configurable: true, value: () => measured });
      const editor = document.querySelector('[data-composer-markdown]');
      editor.addEventListener('input', () => {
        measured += 3000;
        document.querySelector('button[aria-label="Send"]').remove();
      });
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: 'SYNTHETIC_SLOW_NO_SEND',
      sendMethod: 'button', persistentDelivery: true, runDeadline: Date.now() + 1800 });
    const observed = await page.evaluate(() => ({ inputs: fixture.inputs, sends: fixture.sends }));
    assert.equal(outcome.status, 'cancelled');
    assert.notEqual(outcome.retryable, true);
    assert.equal(outcome.diagnosticProgress.counters.domWrites, 1);
    assert.equal(outcome.diagnosticProgress.counters.dispatchAttempts, 0);
    assert.deepEqual(observed, { inputs: 1, sends: 0 });
  });

  await scenario('A slow write followed by revoked wait is not classified as an error', async ({ page, args }) => {
    await page.evaluate(() => {
      let measured = 0;
      Object.defineProperty(performance, 'now', { configurable: true, value: () => measured });
      const editor = document.querySelector('[data-composer-markdown]');
      editor.addEventListener('input', () => { measured += 3000; });
      chrome.runtime.sendMessage = async message => message.type === 'WAIT_RUN'
        ? { ok: true, allowed: false } : { ok: true, allowed: true };
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: 'SYNTHETIC_SLOW_REVOKED',
      extensionClock: true, persistentDelivery: true });
    const observed = await page.evaluate(() => ({ inputs: fixture.inputs, sends: fixture.sends }));
    assert.equal(outcome.status, 'cancelled');
    assert.notEqual(outcome.retryable, true);
    assert.equal(outcome.diagnosticProgress.counters.domWrites, 1);
    assert.equal(outcome.diagnosticProgress.counters.dispatchAttempts, 0);
    assert.deepEqual(observed, { inputs: 1, sends: 0 });
  });

  for (const sendMethod of ['button', 'ctrl-enter']) {
    await scenario('Persistent text restoration is bounded and a later run can send via ' + sendMethod, async ({ page, args }) => {
      const configured = 'Send this configured text only';
      await page.evaluate(() => {
        const editor = document.querySelector('[data-composer-markdown]');
        fixture.restores = 0;
        fixture.restorationActive = true;
        fixture.keyDispatches = 0;
        editor.addEventListener('input', () => {
          setTimeout(() => {
            if (!fixture.restorationActive) return;
            fixture.restores++;
            editor.textContent = 'Composer state restored by the page';
          }, 10);
        });
        editor.addEventListener('keydown', event => {
          if (event.key !== 'Enter' || !event.ctrlKey) return;
          fixture.keyDispatches++;
          document.querySelector('button[aria-label="Send"]').click();
        });
      });
      const outcome = await page.evaluate(pageAction, {
        ...args, prompt: configured, sendMethod, runDeadline: Date.now() + 1800,
      });
      await page.waitForTimeout(60);
      const state = await page.evaluate(() => {
        fixture.restorationActive = false;
        return { restores: fixture.restores, inputs: fixture.inputs, sends: fixture.sends, keys: fixture.keyDispatches, texts: [...fixture.sentTexts] };
      });
      const next = await page.evaluate(pageAction, {
        ...args, prompt: configured, sendMethod, runId: 'synthetic-recovered-round', runDeadline: Date.now() + 12_000,
      });
      const recovered = await page.evaluate(() => ({ sends: fixture.sends, keys: fixture.keyDispatches, texts: fixture.sentTexts }));
      const counters = outcome.diagnosticProgress.counters;
      assert.ok(state.restores > 0, 'the page must repeatedly restore different text');
      assert.equal(counters.dispatchAttempts, 0, JSON.stringify({ outcome, state }));
      assert.deepEqual([state.sends, state.keys, state.texts], [0, 0, []], JSON.stringify({ outcome, state }));
      assert.notEqual(outcome.status, 'sent', JSON.stringify(outcome));
      assert.equal(next.status, 'sent', JSON.stringify({ next, recovered }));
      assert.deepEqual(recovered.texts, [configured]);
      assert.equal(recovered.sends, 1);
      assert.equal(recovered.keys, sendMethod === 'ctrl-enter' ? 1 : 0);
      assert.ok(state.inputs <= 2 && counters.domWrites + counters.modelWrites <= 2, JSON.stringify({ outcome, state }));
    });
  }

  await scenario('Extension priority cannot submit an attachment-only draft', async ({ page, args }) => {
    await page.evaluate(() => {
      const file = document.createElement('button');
      file.setAttribute('aria-label', 'Remove attachment');
      file.textContent = 'Synthetic attachment';
      document.querySelector('#attachment-slot').append(file);
    });
    const outcome = await page.evaluate(pageAction, { ...args, extensionPriority: true });
    assert.equal(outcome.status, 'draft');
    assert.equal(await page.evaluate(() => fixture.sends), 0);
    assert.equal(await page.getByRole('button', { name: 'Remove attachment' }).count(), 1);
  });

  await scenario('Dot home target is accepted while public/shared and non-HTTPS pages are rejected', async () => {
    assert.equal(validateTarget(expectedUrl), true);
    for (const url of ['https://chatgpt.com/', 'https://chatgpt.com/share/abc', 'https://example.invalid/dots/home', 'http://chatgpt.com/dots/home', 'https://chatgpt.com:8443/dots/home']) assert.equal(validateTarget(url), false, url);
  });
  await scenario('Dot self-check binds structural identity without filling or sending', async ({ page, args }) => {
    await page.evaluate(() => { document.querySelector('[data-composer-markdown]').textContent = 'Unsent text stays during self-check'; });
    const outcome = await page.evaluate(pageAction, { ...args, mode: 'check', runId: null, targetIdentity: null });
    assert.equal(outcome.status, 'ready', JSON.stringify(outcome));
    assert.equal(outcome.identity, 'acct~dot');
    assert.equal(outcome.assistantToken, 'acct~dot~Msg~assistant-old');
    assert.equal(outcome.assistantCount, 1);
    assert.deepEqual(await page.evaluate(() => [fixture.inputs, fixture.sends, fixture.checks]), [0, 0, 0]);
    assert.equal(await page.getByRole('textbox', { name: 'Message' }).innerText(), 'Unsent text stays during self-check');
  });
  await scenario('Dot sends through its Message editor and Send button and returns pre-send assistant state', async ({ page, args }) => {
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.equal(outcome.identity, 'acct~dot');
    assert.equal(outcome.assistantToken, 'acct~dot~Msg~assistant-old');
    assert.equal(outcome.assistantCount, 1);
    const state = await page.evaluate(() => ({ ...fixture }));
    assert.equal(state.sends, 1); assert.equal(state.clipboardCalls, 0); assert.equal(state.focusCalls, 0);
    // A native rich-text editor may use a double newline for a paragraph;
    // preserve the supplied content while normalizing only the comparison.
    assert.equal(state.sentTexts[0].replace(/\n{2,}/g, '\n').trim(), prompt.trim());
  });
  for (const placement of ['row', 'body']) {
    await scenario('Dot identity and receipt support IDs placed on ' + placement, async ({ page, args }) => {
      await page.evaluate(placement => {
        fixture.idPlacement = placement;
        for (const node of document.querySelectorAll(placement === 'row' ? '.message-body' : 'article.message-row')) node.removeAttribute('data-message-id');
      }, placement);
      const outcome = await page.evaluate(pageAction, args);
      assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
      assert.equal(outcome.identity, 'acct~dot');
      assert.equal(await page.evaluate(() => fixture.sends), 1);
    });
  }
  await scenario('Visible Dot typing indicator waits; hidden indicator and explicit override allow sending', async ({ page, args }) => {
    await page.evaluate(() => { const typing = document.createElement('div'); typing.className = 'typing-indicator'; typing.setAttribute('role', 'status'); typing.textContent = 'Thinking'; document.body.append(typing); });
    assert.equal((await page.evaluate(pageAction, { ...args, waitForIdle: true })).status, 'busy');
    assert.equal(await page.evaluate(() => fixture.inputs), 0);
    await page.evaluate(() => { document.querySelector('.typing-indicator').hidden = true; });
    assert.equal((await page.evaluate(pageAction, { ...args, waitForIdle: true })).status, 'sent');
    await page.evaluate(() => { document.querySelector('.typing-indicator').hidden = false; });
    assert.equal((await page.evaluate(pageAction, { ...args, waitForIdle: false })).status, 'sent');
    assert.equal(await page.evaluate(() => fixture.sends), 2);
  });
  await scenario('Default force mode sends while Dot is working and exposes a usable Send action', async ({ page, args }) => {
    await page.evaluate(() => {
      const typing = document.createElement('div'); typing.className = 'typing-indicator';
      typing.textContent = 'Synthetic work in progress'; document.body.append(typing);
    });
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.deepEqual(await page.evaluate(() => fixture.actions), ['send']);
    assert.equal(await page.evaluate(() => fixture.stops), 0);
  });
  await scenario('An editor remount during Stop authorization does not skip the same composer', async ({ page, args }) => {
    await page.evaluate(() => {
      startWork();
      const authorize = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async message => {
        const reply = await authorize(message);
        if (fixture.checks === 2) {
          const original = document.querySelector('[data-composer-markdown]');
          original.replaceWith(original.cloneNode(false));
          bindComposer();
        }
        return reply;
      };
    });
    const configured = 'Continue after the editor remount';
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured });
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.deepEqual(await page.evaluate(() => fixture.actions), ['stop', 'send']);
    assert.deepEqual(await page.evaluate(() => fixture.sentTexts), [configured]);
  });
  // Controlled-editor fixtures exercise browser event contracts. They do not
  // claim knowledge of Dot's private framework implementation.
  await scenario('A controlled editor receives cancelable beforeinput before native insertion', async ({ page, args }) => {
    await page.evaluate(() => {
      fixture.requiresBeforeInput = true;
      document.querySelector('[data-composer-markdown]').addEventListener('beforeinput', event => {
        if (event.inputType !== 'insertText') return;
        fixture.beforeInputs++;
        fixture.beforeInputAccepted = event.cancelable && typeof event.data === 'string' && event.data.length > 0;
      });
    });
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.beforeInputAccepted), true);
    assert.equal(await page.evaluate(() => fixture.beforeInputs), 1);
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
  await scenario('Moving the selection during beforeinput does not append the initial replacement', async ({ page, args }) => {
    const configured = 'Configured selection replacement';
    await page.evaluate(() => {
      const input = document.querySelector('[data-composer-markdown]');
      input.textContent = 'Existing draft';
      fixture.selectionMoves = 0;
      fixture.inputValues = [];
      input.addEventListener('beforeinput', event => {
        if (event.inputType !== 'insertText') return;
        const range = document.createRange();
        range.selectNodeContents(input); range.collapse(false);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        fixture.selectionMoves++;
      });
      input.addEventListener('input', () => fixture.inputValues.push(input.innerText));
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured });
    const state = await page.evaluate(() => ({ moves: fixture.selectionMoves, values: fixture.inputValues, texts: fixture.sentTexts }));
    assert.ok(state.moves > 0, 'the beforeinput handler must move the selection');
    assert.equal(state.values[0], configured, JSON.stringify({ outcome, state }));
    assert.deepEqual(state.texts, [configured]);
  });
  await scenario('A framework-handled beforeinput replacement is submitted once without a second insertion', async ({ page, args }) => {
    await page.evaluate(() => {
      fixture.requiresBeforeInput = true;
      const input = document.querySelector('[data-composer-markdown]');
      input.addEventListener('beforeinput', event => {
        if (event.inputType !== 'insertText') return;
        fixture.beforeInputs++; event.preventDefault();
        fixture.beforeInputAccepted = event.cancelable;
        fixture.frameworkReplacements++;
        input.textContent = event.data;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: event.data }));
      });
    });
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.deepEqual(await page.evaluate(() => [fixture.beforeInputs, fixture.frameworkReplacements, fixture.inputs, fixture.sends]), [1, 1, 1, 1]);
    assert.equal(await page.evaluate(() => fixture.sentTexts[0]), prompt);
  });
  await scenario('Final replacement respects a handled beforeinput without inserting twice', async ({ page, args }) => {
    const configured = 'Exactly one configured continuation';
    await page.evaluate(() => {
      const input = document.querySelector('[data-composer-markdown]');
      input.addEventListener('beforeinput', event => {
        if (event.inputType !== 'insertText') return;
        event.preventDefault();
        input.textContent = event.data;
        const range = document.createRange();
        range.selectNodeContents(input); range.collapse(false);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: event.data }));
      });
      const authorize = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async message => {
        const reply = await authorize(message);
        if (fixture.checks === 3) input.textContent = 'Intervening unsent text';
        return reply;
      };
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured, extensionPriority: false });
    assert.deepEqual(await page.evaluate(() => fixture.sentTexts), [configured]);
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
  });

  await scenario('A trusted manual send of opaque editor content prevents further injection', async ({ page, args }) => {
    const configured = 'Synthetic opaque manual submission';
    await page.evaluate(() => {
      const input = document.querySelector('[data-composer-markdown]');
      fixture.opaqueWrites = 0;
      fixture.manualSent = false;
      fixture.trustedManualClick = false;
      fixture.writesAfterManualSend = 0;
      fixture.manualGateWaiting = false;
      let releaseManualGate;
      const authorize = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async message => {
        const reply = await authorize(message);
        if (fixture.opaqueWrites > 0 && !fixture.manualSent && !fixture.manualGateWaiting) {
          fixture.manualGateWaiting = true;
          await new Promise(resolve => { releaseManualGate = resolve; });
        }
        return reply;
      };
      input.addEventListener('beforeinput', () => {
        if (fixture.manualSent) fixture.writesAfterManualSend++;
      });
      input.addEventListener('input', () => {
        const opaque = document.createElement('section');
        opaque.textContent = input.innerText;
        input.replaceChildren(opaque);
        fixture.opaqueWrites++;
      });
      document.querySelector('button[aria-label="Send"]').addEventListener('click', event => {
        fixture.trustedManualClick = event.isTrusted;
        fixture.manualSent = true;
        releaseManualGate();
      }, { capture: true, once: true });
    });
    const pending = page.evaluate(pageAction, { ...args, prompt: configured, runDeadline: Date.now() + 5000 });
    await page.waitForFunction(() => fixture.manualGateWaiting && !document.querySelector('button[aria-label="Send"]').disabled, null, { polling: 10 });
    await page.getByRole('button', { name: 'Send' }).click();
    const outcome = await pending;
    const state = await page.evaluate(() => ({ trusted: fixture.trustedManualClick, sends: fixture.sends, texts: fixture.sentTexts, writesAfterManualSend: fixture.writesAfterManualSend, draft: document.querySelector('[data-composer-markdown]').innerText }));
    assert.equal(state.trusted, true, 'the send must be a trusted user click');
    assert.deepEqual(state.texts, [configured]);
    assert.equal(state.writesAfterManualSend, 0, JSON.stringify({ outcome, state }));
    assert.equal(state.sends, 1);
    assert.equal(state.draft, '');
    assert.equal(outcome.diagnosticProgress.counters.dispatchAttempts, 0, 'a trusted manual send owns the attempt');
    assert.equal(outcome.diagnosticProgress.counters.manualIntents, 1);
    assert.equal(outcome.diagnosticProgress.counters.fillCalls, 1, 'manual takeover must not reinject the prompt');
  });

  await scenario('A trusted manual submission of different text returns unknown without reinjection or false confirmation', async ({ page, args }) => {
    const configured = 'Synthetic configured continuation';
    const humanText = 'A different message submitted by the human';
    await page.evaluate(() => {
      const input = document.querySelector('[data-composer-markdown]');
      fixture.manualSent = false;
      fixture.manualTrusted = false;
      fixture.manualGateWaiting = false;
      fixture.writesAfterManualSend = 0;
      fixture.extensionClicks = 0;
      fixture.extensionKeys = 0;
      let releaseManualGate;
      const authorize = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'MANUAL_SUBMISSION') return { ok: true };
        const reply = await authorize(message);
        if (fixture.inputs > 0 && !fixture.manualGateWaiting) {
          fixture.manualGateWaiting = true;
          await new Promise(resolve => { releaseManualGate = resolve; });
        }
        return reply;
      };
      for (const type of ['beforeinput', 'input']) {
        input.addEventListener(type, () => { if (fixture.manualSent) fixture.writesAfterManualSend++; });
      }
      input.addEventListener('keydown', event => {
        if (fixture.manualSent && event.key === 'Enter' && !event.isTrusted) fixture.extensionKeys++;
      });
      document.querySelector('button[aria-label="Send"]').addEventListener('click', event => {
        if (!event.isTrusted) fixture.extensionClicks++;
        else {
          fixture.manualTrusted = true;
          fixture.manualSent = true;
          releaseManualGate();
        }
      }, { capture: true });
    });
    const pending = page.evaluate(pageAction, {
      ...args, prompt: configured, persistentDelivery: true, unlimitedReadiness: true, runDeadline: Date.now() + 30_000,
    });
    await page.waitForFunction(() => fixture.manualGateWaiting && !document.querySelector('button[aria-label="Send"]').disabled, null, { polling: 10, timeout: 5000 });
    const editor = page.getByRole('textbox', { name: 'Message' });
    assert.equal(await editor.innerText(), configured);
    await editor.fill(humanText);
    await page.getByRole('button', { name: 'Send' }).click();
    let watchdog;
    const outcome = await Promise.race([
      pending,
      new Promise(resolve => { watchdog = setTimeout(() => resolve({ status: 'test-timeout' }), 8000); }),
    ]);
    clearTimeout(watchdog);
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => ({
      trusted: fixture.manualTrusted, sends: fixture.sends, texts: fixture.sentTexts,
      writes: fixture.writesAfterManualSend, clicks: fixture.extensionClicks, keys: fixture.extensionKeys,
      draft: document.querySelector('[data-composer-markdown]').innerText,
      receipt: document.querySelector('article.message-row.self:last-child .message-body')?.innerText,
    }));
    assert.equal(state.trusted, true, 'the manual send must be a trusted user click');
    assert.deepEqual(state.texts, [humanText]);
    assert.equal(state.receipt, humanText);
    assert.deepEqual([state.sends, state.writes, state.clicks, state.keys, state.draft], [1, 0, 0, 0, ''], JSON.stringify({ outcome, state }));
    assert.equal(outcome.status, 'unknown', JSON.stringify({ outcome, state }));
    assert.equal(outcome.diagnosticProgress.counters.dispatchAttempts, 0, JSON.stringify(outcome));
  });

  await scenario('A trusted Send feedback click is not a manual submission', async ({ page, args }) => {
    const configured = 'Synthetic feedback click regression';
    await page.evaluate(() => {
      fixture.feedbackTrusted = false;
      fixture.feedbackClicks = 0;
      fixture.manualNotifications = 0;
      fixture.feedbackGateWaiting = false;
      let releaseFeedbackGate;
      const authorize = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'MANUAL_SUBMISSION') {
          fixture.manualNotifications++;
          return { ok: true };
        }
        const reply = await authorize(message);
        if (fixture.inputs > 0 && !fixture.feedbackGateWaiting) {
          fixture.feedbackGateWaiting = true;
          await new Promise(resolve => { releaseFeedbackGate = resolve; });
        }
        return reply;
      };
      const feedback = document.createElement('button');
      feedback.type = 'button';
      feedback.setAttribute('aria-label', 'Send feedback');
      feedback.innerHTML = '<span>Feedback</span>';
      feedback.addEventListener('click', event => {
        fixture.feedbackTrusted = event.isTrusted;
        fixture.feedbackClicks++;
      });
      document.querySelector('[data-composer-body]').append(feedback);
      window.releaseFeedbackGate = () => releaseFeedbackGate();
    });
    const pending = page.evaluate(pageAction, { ...args, prompt: configured, runDeadline: Date.now() + 5000 });
    await page.waitForFunction(() => fixture.feedbackGateWaiting, null, { polling: 10 });
    await page.getByRole('button', { name: 'Send feedback' }).click();
    await page.evaluate(() => window.releaseFeedbackGate());
    const outcome = await pending;
    const state = await page.evaluate(() => ({ trusted: fixture.feedbackTrusted, clicks: fixture.feedbackClicks, notifications: fixture.manualNotifications, sends: fixture.sends, texts: fixture.sentTexts }));
    assert.equal(state.trusted, true, 'the feedback click must be trusted');
    assert.equal(state.clicks, 1);
    assert.equal(state.notifications, 0, JSON.stringify({ outcome, state }));
    assert.equal(outcome.status, 'sent', JSON.stringify({ outcome, state }));
    assert.equal(state.sends, 1);
    assert.deepEqual(state.texts, [configured]);
  });

  for (const sendMethod of ['button', 'ctrl-enter']) {
    await scenario('Opaque markup with readable text permits one fallback attempt via ' + sendMethod, async ({ page, args }) => {
      const configured = 'Synthetic opaque editor content';
      await page.evaluate(() => {
        const input = document.querySelector('[data-composer-markdown]');
        fixture.opaqueWrites = 0;
        fixture.keyDispatches = 0;
        input.addEventListener('input', () => {
          const opaque = document.createElement('section');
          opaque.textContent = input.innerText;
          input.replaceChildren(opaque);
          fixture.opaqueWrites++;
        });
        input.addEventListener('keydown', event => {
          if (event.key === 'Enter' && event.ctrlKey) fixture.keyDispatches++;
        });
      });
      const outcome = await page.evaluate(pageAction, { ...args, prompt: configured, sendMethod, runDeadline: Date.now() + 1800 });
      const state = await page.evaluate(() => ({ opaqueWrites: fixture.opaqueWrites, sends: fixture.sends,
        keyDispatches: fixture.keyDispatches, texts: fixture.sentTexts, draft: document.querySelector('[data-composer-markdown]').innerText }));
      const counters = outcome.diagnosticProgress.counters;
      assert.equal(state.opaqueWrites, 1, 'readable unsupported markup must not cause repeated insertion');
      assert.deepEqual([counters.domWrites, counters.fillCalls, counters.dispatchAttempts], [1, 1, 1], JSON.stringify({ outcome, state }));
      assert.notEqual(outcome.retryable, true);
      if (sendMethod === 'button') {
        assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
        assert.deepEqual([state.sends, state.keyDispatches, state.texts, state.draft], [1, 0, [configured], '']);
      } else {
        // This fixture observes Ctrl+Enter but has no handler that submits it.
        assert.equal(outcome.status, 'unknown', JSON.stringify(outcome));
        assert.deepEqual([state.sends, state.keyDispatches, state.texts, state.draft], [0, 1, [], configured]);
      }
    });

    await scenario('Text changed during the final correction must not dispatch via ' + sendMethod, async ({ page, args }) => {
      const configured = 'Synthetic final correction';
      await page.evaluate(() => {
        const input = document.querySelector('[data-composer-markdown]');
        fixture.finalChanges = 0;
        fixture.finalAuthorizationTriggered = false;
        fixture.keyDispatches = 0;
        const authorize = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = async message => {
          const reply = await authorize(message);
          if (fixture.checks === 4) {
            fixture.finalAuthorizationTriggered = true;
            input.textContent = 'Intervening text before final correction';
          }
          return reply;
        };
        input.addEventListener('input', () => {
          if (fixture.checks !== 4) return;
          input.textContent = 'Changed by the page during final correction';
          fixture.finalChanges++;
        });
        input.addEventListener('keydown', event => {
          if (event.key === 'Enter' && event.ctrlKey) fixture.keyDispatches++;
        });
      });
      const outcome = await page.evaluate(pageAction, { ...args, prompt: configured, sendMethod, runDeadline: Date.now() + 1800 });
      const state = await page.evaluate(() => ({ triggered: fixture.finalAuthorizationTriggered, finalChanges: fixture.finalChanges, sends: fixture.sends, keyDispatches: fixture.keyDispatches }));
      assert.equal(state.triggered, true, 'the fixture must alter text during authorization');
      assert.equal(state.finalChanges, 1, 'the page must alter the final correction');
      assert.equal(outcome.diagnosticProgress.counters.dispatchAttempts, 0, JSON.stringify({ outcome, state }));
      assert.deepEqual([state.sends, state.keyDispatches], [0, 0]);
      assert.notEqual(outcome.status, 'sent');
    });
  }

  await scenario('Final replacement commits deferred controlled-input state before submitting', async ({ page, args }) => {
    const configured = 'Configured controlled-model continuation';
    await page.evaluate(() => {
      const input = document.querySelector('[data-composer-markdown]');
      fixture.controlledText = '';
      input.addEventListener('input', () => {
        const value = input.innerText;
        setTimeout(() => { fixture.controlledText = value; }, 100);
      });
      const authorize = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async message => {
        const reply = await authorize(message);
        if (fixture.checks === 3) {
          input.textContent = 'Intervening unsent controlled text';
          fixture.controlledText = input.innerText;
        }
        return reply;
      };
      document.querySelector('button[aria-label="Send"]').addEventListener('click', event => {
        event.stopImmediatePropagation();
        fixture.sends++; fixture.sentTexts.push(fixture.controlledText);
        appendMessage(fixture.controlledText, 'acct~dot~Msg~controlled-new');
        input.textContent = '';
      }, { capture: true });
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured, extensionPriority: false });
    assert.deepEqual(await page.evaluate(() => fixture.sentTexts), [configured]);
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
  });

  await scenario('Matching DOM still allows a deferred input model to commit before submitting', async ({ page, args }) => {
    const configured = 'Configured asynchronous model without any restoration';
    await page.evaluate(() => {
      const input = document.querySelector('[data-composer-markdown]');
      fixture.controlledText = 'Old controlled-model value';
      input.addEventListener('input', () => {
        const value = input.innerText;
        setTimeout(() => { fixture.controlledText = value; }, 100);
      });
      document.querySelector('button[aria-label="Send"]').addEventListener('click', event => {
        event.stopImmediatePropagation();
        fixture.sends++; fixture.sentTexts.push(fixture.controlledText);
        appendMessage(fixture.controlledText, 'acct~dot~Msg~no-restore-' + fixture.sends);
        input.textContent = '';
      }, { capture: true });
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured });
    assert.deepEqual(await page.evaluate(() => fixture.sentTexts), [configured]);
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
  });

  await scenario('A 500ms private model dispatches stale text once and remains receipt-mismatch, not successful delivery', async ({ page, args }) => {
    const configured = 'SYNTHETIC_CONFIGURED_MODEL';
    await page.evaluate(() => {
      const input = document.querySelector('[data-composer-markdown]');
      fixture.controlledText = 'SYNTHETIC_STALE_MODEL';
      input.addEventListener('input', () => {
        const value = input.innerText;
        fixture.modelCommit = new Promise(resolve => setTimeout(() => {
          fixture.controlledText = value;
          resolve();
        }, 500));
      });
      document.querySelector('button[aria-label="Send"]').addEventListener('click', event => {
        event.stopImmediatePropagation();
        fixture.publicTextAtSubmit = input.innerText;
        fixture.sends++; fixture.sentTexts.push(fixture.controlledText);
        appendMessage(fixture.controlledText, 'acct~dot~Msg~stale-model');
        input.textContent = '';
      }, { capture: true });
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured });
    await page.evaluate(() => fixture.modelCommit);
    const observed = await page.evaluate(() => ({ inputs: fixture.inputs, sends: fixture.sends,
      texts: fixture.sentTexts, publicText: fixture.publicTextAtSubmit, eventualModel: fixture.controlledText }));
    assert.deepEqual(observed, { inputs: 1, sends: 1, texts: ['SYNTHETIC_STALE_MODEL'], publicText: configured, eventualModel: configured });
    assert.equal(outcome.status, 'unknown', JSON.stringify(outcome));
    assert.equal(outcome.diagnosticCode, 'receipt-mismatch');
    assert.notEqual(outcome.retryable, true);
    assert.deepEqual([outcome.diagnosticProgress.counters.domWrites, outcome.diagnosticProgress.counters.fillCalls,
      outcome.diagnosticProgress.counters.dispatchAttempts], [1, 1, 1]);
  });

  await scenario('A new unrelated receipt after dispatch pauses without replaying an unknown model', async ({ page, args }) => {
    const configured = 'SYNTHETIC_EXPECTED_MESSAGE';
    await page.evaluate(() => {
      document.querySelector('button[aria-label="Send"]').addEventListener('click', event => {
        event.stopImmediatePropagation();
        fixture.sends++;
        fixture.sentTexts.push('SYNTHETIC_STALE_MODEL');
        appendMessage('SYNTHETIC_STALE_MODEL', 'acct~dot~Msg~mismatch');
      }, { capture: true });
    });
    const outcome = await Promise.race([
      page.evaluate(pageAction, { ...args, prompt: configured, unlimitedReadiness: true }),
      new Promise(resolve => setTimeout(() => resolve({ status: 'still-waiting' }), 1500)),
    ]);
    assert.equal(outcome.status, 'unknown', JSON.stringify(outcome));
    assert.equal(outcome.diagnosticCode, 'receipt-mismatch');
    assert.notEqual(outcome.retryable, true);
    assert.equal(outcome.diagnosticProgress.counters.dispatchAttempts, 1);
    assert.deepEqual(await page.evaluate(() => fixture.sentTexts), ['SYNTHETIC_STALE_MODEL']);
  });

  for (const sendMethod of ['button', 'ctrl-enter']) {
    await scenario('Final correction must not submit a stale asynchronous model via ' + sendMethod, async ({ page, args }) => {
      const configured = 'Configured final asynchronous correction';
      const stale = 'Old controlled-model text';
      await page.evaluate(stale => {
        const input = document.querySelector('[data-composer-markdown]');
        fixture.controlledText = '';
        fixture.finalCorrections = 0;
        fixture.finalAuthorizationTriggered = false;
        input.addEventListener('input', () => {
          const value = input.innerText;
          if (fixture.checks === 4) fixture.finalCorrections++;
          setTimeout(() => { fixture.controlledText = value; }, 100);
        });
        const authorize = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = async message => {
          const reply = await authorize(message);
          if (fixture.checks === 4) {
            fixture.finalAuthorizationTriggered = true;
            input.textContent = stale;
            fixture.controlledText = stale;
          }
          return reply;
        };
        const submitModel = event => {
          if (event.type === 'keydown' && (event.key !== 'Enter' || !event.ctrlKey)) return;
          event.stopImmediatePropagation();
          event.preventDefault();
          fixture.sends++;
          fixture.sentTexts.push(fixture.controlledText);
          appendMessage(fixture.controlledText, 'acct~dot~Msg~final-model-' + fixture.sends);
          input.textContent = '';
        };
        document.querySelector('button[aria-label="Send"]').addEventListener('click', submitModel, { capture: true });
        input.addEventListener('keydown', submitModel, { capture: true });
      }, stale);
      const outcome = await page.evaluate(pageAction, { ...args, prompt: configured, sendMethod, runDeadline: Date.now() + 1800 });
      const state = await page.evaluate(() => ({ triggered: fixture.finalAuthorizationTriggered, corrections: fixture.finalCorrections, texts: fixture.sentTexts }));
      assert.equal(state.triggered, true, 'the fixture must alter the model during authorization');
      assert.equal(state.corrections, 1, 'the final correction must emit an input event');
      assert.ok(state.texts.length === 0 || (state.texts.length === 1 && state.texts[0] === configured), JSON.stringify({ outcome, state }));
      if (state.texts.length === 0) assert.notEqual(outcome.status, 'sent', JSON.stringify(outcome));
    });
  }

  await scenario('Delayed-input restorations after model settlement and at authorization are adopted once without reinjection', async ({ page, args }) => {
    const configured = 'Configured delayed-input model continuation';
    await page.evaluate(() => {
      const input = document.querySelector('[data-composer-markdown]');
      fixture.controlledText = '';
      fixture.restorationPhase = 'waiting-input';
      fixture.restorationPhases = [];
      input.addEventListener('input', () => {
        const value = input.innerText;
        setTimeout(() => {
          fixture.controlledText = value;
          fixture.restorationPhase = 'model-committed';
          fixture.restorationPhases.push('model-committed');
        }, 100);
      });
      const authorize = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN') {
          await new Promise(resolve => setTimeout(resolve, message.delayMs));
          return { ok: true, allowed: fixture.allowed };
        }
        const reply = await authorize(message);
        if (fixture.restorationPhase === 'model-committed') {
          input.textContent = 'Settling-restored delayed-input controlled text';
          fixture.controlledText = input.innerText;
          fixture.restorationPhase = 'settling-restored';
          fixture.restorationPhases.push('settling-restored');
        } else if (fixture.restorationPhase === 'settling-restored') {
          input.textContent = 'Authorization-restored delayed-input controlled text';
          fixture.controlledText = input.innerText;
          fixture.restorationPhase = 'authorization-restored';
          fixture.restorationPhases.push('authorization-restored');
        }
        return reply;
      };
      document.querySelector('button[aria-label="Send"]').addEventListener('click', event => {
        event.stopImmediatePropagation();
        fixture.publicTextAtSubmit = input.innerText;
        fixture.restorationPhases.push('submit');
        fixture.sends++; fixture.sentTexts.push(fixture.controlledText);
        appendMessage(fixture.controlledText, 'acct~dot~Msg~delayed-input-' + fixture.sends);
        input.textContent = '';
      }, { capture: true });
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured, extensionClock: true, persistentDelivery: true, unlimitedReadiness: true, extensionPriority: false, runDeadline: Date.now() + 45_000 });
    const state = await page.evaluate(() => ({ phases: fixture.restorationPhases, inputs: fixture.inputs,
      publicText: fixture.publicTextAtSubmit, sends: fixture.sends, texts: fixture.sentTexts,
      draft: document.querySelector('[data-composer-markdown]').innerText }));
    assert.deepEqual(state.phases, ['model-committed', 'settling-restored', 'authorization-restored', 'submit']);
    assert.deepEqual(state.texts, ['Authorization-restored delayed-input controlled text']);
    assert.equal(state.publicText, state.texts[0], 'the adopted DOM and submission model must agree');
    assert.notEqual(state.texts[0], configured, 'confirmation is for adopted prepared text, not exact configured delivery');
    assert.equal(state.inputs, 1);
    assert.equal(state.draft, '');
    assert.equal(state.sends, 1);
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.deepEqual([outcome.diagnosticProgress.counters.domWrites, outcome.diagnosticProgress.counters.fillCalls,
      outcome.diagnosticProgress.counters.dispatchAttempts], [1, 1, 1]);
  });

  await scenario('Priority overwrites a framework-restored different draft before the one send', async ({ page, args }) => {
    const restoredDraft = 'Restored synthetic human draft';
    await page.evaluate(restoredDraft => {
      const input = document.querySelector('[data-composer-markdown]');
      input.addEventListener('beforeinput', event => {
        if (event.inputType !== 'insertText') return;
        event.preventDefault(); fixture.beforeInputs++;
        input.textContent = restoredDraft;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: restoredDraft }));
      });
    }, restoredDraft);
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.sentTexts[0].replace(/\n+/g, '\n').trim()), prompt.trim());
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });

  await scenario('Native NBSP and inline formatting do not cause a replacement loop', async ({ page, args }) => {
    await page.evaluate(() => {
      const input = document.querySelector('[data-composer-markdown]');
      input.style.whiteSpace = 'normal';
      input.addEventListener('input', () => {
        const mark = document.createElement('strong');
        mark.textContent = input.textContent;
        input.replaceChildren(mark);
      });
    });
    const configured = 'Keep the trailing space ';
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured, extensionPriority: false });
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    const state = await page.evaluate(() => ({ inputs: fixture.inputs, texts: fixture.sentTexts }));
    assert.equal(state.inputs, 1);
    assert.deepEqual(state.texts.map(value => value.replace(/\u00a0/g, ' ')), [configured]);
  });
  await scenario('FONT wrapping of unchanged text does not trigger repeated DOM writes', async ({ page, args }) => {
    await page.evaluate(() => {
      const input = document.querySelector('[data-composer-markdown]');
      fixture.fontWraps = 0;
      input.addEventListener('input', () => {
        const font = document.createElement('font');
        font.textContent = input.textContent;
        input.replaceChildren(font);
        fixture.fontWraps++;
      });
    });
    const configured = 'Same synthetic FONT text';
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured });
    const state = await page.evaluate(() => ({ inputs: fixture.inputs, fontWraps: fixture.fontWraps, sends: fixture.sends, texts: fixture.sentTexts }));
    const { domWrites, fillCalls, dispatchAttempts } = outcome.diagnosticProgress.counters;
    console.log('FONT counts ' + JSON.stringify({ domWrites, fillCalls, dispatchAttempts, ...state }));
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.equal(state.sends, 1);
    assert.deepEqual(state.texts, [configured]);
    assert.equal(domWrites, 1, 'unchanged FONT-wrapped text must not be rewritten');
    assert.equal(fillCalls, 1);
    assert.equal(state.inputs, 1);
    assert.equal(state.fontWraps, 1);
    assert.equal(dispatchAttempts, 1);
  });
  await scenario('A cancelled beforeinput may commit asynchronously before the one allowed send', async ({ page, args }) => {
    await page.evaluate(() => {
      fixture.requiresBeforeInput = true;
      const input = document.querySelector('[data-composer-markdown]');
      input.addEventListener('beforeinput', event => {
        if (event.inputType !== 'insertText') return;
        fixture.beforeInputs++; event.preventDefault();
        const value = event.data;
        setTimeout(() => {
          fixture.beforeInputAccepted = true; fixture.frameworkReplacements++;
          input.textContent = value;
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        }, 25);
      });
    });
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.deepEqual(await page.evaluate(() => [fixture.beforeInputs, fixture.frameworkReplacements, fixture.inputs, fixture.sends]), [1, 1, 1, 1]);
    assert.equal(await page.evaluate(() => fixture.sentTexts[0]), prompt);
  });
  await scenario('Cancelled-beforeinput restorations after model settlement and at authorization are adopted once without reinjection', async ({ page, args }) => {
    const configured = 'Configured delayed-beforeinput model continuation';
    await page.evaluate(() => {
      const input = document.querySelector('[data-composer-markdown]');
      fixture.controlledText = '';
      fixture.restorationPhase = 'waiting-input';
      fixture.restorationPhases = [];
      input.addEventListener('beforeinput', event => {
        if (event.inputType !== 'insertText') return;
        event.preventDefault(); fixture.beforeInputs++;
        const value = event.data;
        setTimeout(() => {
          fixture.frameworkReplacements++;
          fixture.controlledText = value;
          input.textContent = value;
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
          fixture.restorationPhase = 'model-committed';
          fixture.restorationPhases.push('model-committed');
        }, 25);
      });
      const authorize = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN') {
          await new Promise(resolve => setTimeout(resolve, message.delayMs));
          return { ok: true, allowed: fixture.allowed };
        }
        const reply = await authorize(message);
        if (fixture.restorationPhase === 'model-committed') {
          input.textContent = 'Settling-restored delayed-beforeinput controlled text';
          fixture.controlledText = input.innerText;
          fixture.restorationPhase = 'settling-restored';
          fixture.restorationPhases.push('settling-restored');
        } else if (fixture.restorationPhase === 'settling-restored') {
          input.textContent = 'Authorization-restored delayed-beforeinput controlled text';
          fixture.controlledText = input.innerText;
          fixture.restorationPhase = 'authorization-restored';
          fixture.restorationPhases.push('authorization-restored');
        }
        return reply;
      };
      document.querySelector('button[aria-label="Send"]').addEventListener('click', event => {
        event.stopImmediatePropagation();
        fixture.publicTextAtSubmit = input.innerText;
        fixture.restorationPhases.push('submit');
        fixture.sends++; fixture.sentTexts.push(fixture.controlledText);
        appendMessage(fixture.controlledText, 'acct~dot~Msg~delayed-beforeinput-' + fixture.sends);
        input.textContent = '';
      }, { capture: true });
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured, extensionClock: true, persistentDelivery: true, unlimitedReadiness: true, extensionPriority: false, runDeadline: Date.now() + 45_000 });
    const state = await page.evaluate(() => ({ phases: fixture.restorationPhases, inputs: fixture.inputs,
      beforeInputs: fixture.beforeInputs, replacements: fixture.frameworkReplacements, publicText: fixture.publicTextAtSubmit,
      sends: fixture.sends, texts: fixture.sentTexts, draft: document.querySelector('[data-composer-markdown]').innerText }));
    assert.deepEqual(state.phases, ['model-committed', 'settling-restored', 'authorization-restored', 'submit']);
    assert.deepEqual(state.texts, ['Authorization-restored delayed-beforeinput controlled text']);
    assert.equal(state.publicText, state.texts[0], 'the adopted DOM and submission model must agree');
    assert.notEqual(state.texts[0], configured, 'confirmation is for adopted prepared text, not exact configured delivery');
    assert.deepEqual([state.inputs, state.beforeInputs, state.replacements], [1, 1, 1]);
    assert.equal(state.draft, '');
    assert.equal(state.sends, 1);
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.deepEqual([outcome.diagnosticProgress.counters.domWrites, outcome.diagnosticProgress.counters.fillCalls,
      outcome.diagnosticProgress.counters.dispatchAttempts], [0, 1, 1]);
  });
  for (const model of ['input', 'beforeinput']) {
    await scenario('Finite mode must not submit a restored delayed-' + model + ' model', async ({ page, args }) => {
      const configured = 'Finite delayed-' + model + ' model continuation';
      await page.evaluate(model => {
        const input = document.querySelector('[data-composer-markdown]');
        fixture.controlledText = '';
        fixture.settlingRestores = 0;
        fixture.interveningTriggered = false;
        if (model === 'input') {
          input.addEventListener('input', () => {
            const value = input.innerText;
            setTimeout(() => { fixture.controlledText = value; }, 100);
          });
        } else {
          input.addEventListener('beforeinput', event => {
            if (event.inputType !== 'insertText') return;
            event.preventDefault();
            const value = event.data;
            setTimeout(() => {
              fixture.controlledText = value;
              input.textContent = value;
              input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
            }, 25);
          });
        }
        const authorize = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = async message => {
          if (message.type === 'WAIT_RUN') {
            await new Promise(resolve => setTimeout(resolve, message.delayMs));
            if (message.delayMs === 180 && fixture.interveningTriggered && !fixture.sends && fixture.settlingRestores < 2) {
              input.textContent = 'Restored finite controlled model';
              fixture.controlledText = input.innerText;
              fixture.settlingRestores++;
            }
            return { ok: true, allowed: fixture.allowed };
          }
          const reply = await authorize(message);
          if (fixture.checks === 3 && !fixture.interveningTriggered) {
            fixture.interveningTriggered = true;
            input.textContent = 'Intervening finite controlled model';
            fixture.controlledText = input.innerText;
          }
          return reply;
        };
        document.querySelector('button[aria-label="Send"]').addEventListener('click', event => {
          event.stopImmediatePropagation();
          fixture.sends++;
          fixture.sentTexts.push(fixture.controlledText);
          appendMessage(fixture.controlledText, 'acct~dot~Msg~finite-model-' + fixture.sends);
          input.textContent = '';
        }, { capture: true });
      }, model);
      const outcome = await page.evaluate(pageAction, { ...args, prompt: configured, extensionClock: true, persistentDelivery: false, unlimitedReadiness: false, extensionPriority: false });
      const state = await page.evaluate(() => ({ triggered: fixture.interveningTriggered, restores: fixture.settlingRestores, sends: fixture.sends, texts: fixture.sentTexts }));
      assert.equal(state.triggered, true, 'the fixture must alter the model during authorization');
      assert.ok(state.restores > 0, 'the fixture must restore the controlled model during settling');
      assert.ok(state.sends <= 1, JSON.stringify({ outcome, state }));
      assert.ok(state.texts.length === 0 || (state.texts.length === 1 && state.texts[0] === configured), JSON.stringify({ outcome, state }));
      if (state.sends === 0) assert.notEqual(outcome.status, 'sent', JSON.stringify({ outcome, state }));
    });
  }
  await scenario('Force mode clicks an explicit Stop once before submitting when Stop replaces Send', async ({ page, args }) => {
    await page.evaluate(() => startWork());
    const outcome = await page.evaluate(pageAction, { ...args, waitForIdle: false });
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.deepEqual(await page.evaluate(() => fixture.actions), ['stop', 'send']);
    assert.equal(await page.evaluate(() => fixture.stops), 1);
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
  await scenario('Force mode prioritizes a scoped explicit Stop even when Send is also available', async ({ page, args }) => {
    await page.evaluate(() => {
      startWork({ replaceSend: false });
      document.querySelector('button[aria-label="Send"]').disabled = false;
      fixture.unrelatedStops = 0;
      const other = document.createElement('button'); other.setAttribute('aria-label', 'Stop generating'); other.textContent = 'Stop unrelated work';
      other.addEventListener('click', () => { fixture.unrelatedStops++; }); document.body.append(other);
    });
    const outcome = await page.evaluate(pageAction, { ...args, waitForIdle: false });
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.deepEqual(await page.evaluate(() => fixture.actions), ['stop', 'send']);
    assert.equal(await page.evaluate(() => fixture.unrelatedStops), 0);
  });
  await scenario('Force mode finds the replacement composer after interrupting', async ({ page, args }) => {
    await page.evaluate(() => startWork({ remount: true }));
    const outcome = await page.evaluate(pageAction, { ...args, waitForIdle: false });
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.remounts), 1);
    assert.deepEqual(await page.evaluate(() => fixture.actions), ['stop', 'send']);
    assert.equal(await page.evaluate(() => fixture.sentTexts[0].replace(/\n{2,}/g, '\n').trim()), prompt.trim());
  });
  await scenario('A read-only check, explicit wait mode, and a paused run never interrupt', async ({ page, args }) => {
    await page.evaluate(() => startWork());
    const check = await page.evaluate(pageAction, { ...args, mode: 'check', runId: null, waitForIdle: false });
    assert.ok(['ready', 'busy'].includes(check.status), JSON.stringify(check));
    assert.equal((await page.evaluate(pageAction, { ...args, waitForIdle: true })).status, 'busy');
    await page.evaluate(() => { fixture.allowed = false; });
    assert.equal((await page.evaluate(pageAction, { ...args, waitForIdle: false })).status, 'cancelled');
    assert.deepEqual(await page.evaluate(() => [fixture.stops, fixture.sends, fixture.inputs]), [0, 0, 0]);
  });
  await scenario('Pause during interruption prevents the subsequent fill and send', async ({ page, args }) => {
    await page.evaluate(() => { fixture.cancelOnStop = true; startWork(); });
    const outcome = await page.evaluate(pageAction, { ...args, waitForIdle: false });
    assert.equal(outcome.status, 'cancelled', JSON.stringify(outcome));
    assert.deepEqual(await page.evaluate(() => fixture.actions), ['stop']);
    assert.equal(await page.evaluate(() => fixture.sends), 0);
    assert.equal((await page.getByRole('textbox', { name: 'Message' }).innerText()).trim(), '');
  });
  await scenario('Missing Send cleans the unchanged inserted draft so a later round can succeed', async ({ page, args }) => {
    await page.evaluate(() => {
      window.savedSend = document.querySelector('button[aria-label="Send"]');
      savedSend.remove();
    });
    const first = await page.evaluate(pageAction, args);
    assert.equal(first.status, 'blocked', JSON.stringify(first));
    assert.equal((await page.getByRole('textbox', { name: 'Message' }).innerText()).trim(), '', 'An unsubmitted own draft must not lock later rounds');
    assert.equal(await page.evaluate(() => fixture.sends), 0);
    await page.evaluate(() => { document.querySelector('[data-composer-body]').append(savedSend); bindComposer(); });
    const next = await page.evaluate(pageAction, { ...args, runId: 'synthetic-next-round', runDeadline: Date.now() + 12_000 });
    assert.equal(next.status, 'sent', JSON.stringify(next));
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
  await scenario('Force mode submits an exact configured prompt already stuck in the editor', async ({ page, args }) => {
    const stuckPrompt = 'Recover this exact synthetic continuation';
    await page.getByRole('textbox', { name: 'Message' }).fill(stuckPrompt);
    const outcome = await page.evaluate(pageAction, { ...args, prompt: stuckPrompt });
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.sends), 1);
    assert.deepEqual(await page.evaluate(() => fixture.sentTexts), [stuckPrompt]);
  });
  for (const [name, legacyPrompt] of [
    ['CRLF', '  First synthetic line\r\nSecond synthetic line\r\n  '],
    ['blank line', 'First synthetic line\n\nSecond synthetic line'],
    ['trailing newline', 'First synthetic line\n'],
  ]) {
    await scenario('Force recovers a legacy native insertion containing ' + name, async ({ page, args }) => {
      // This is the old adapter's native insertion path, not a serializer-shaped
      // fixture. Chromium creates DIV/BR nodes and innerText newline artifacts.
      const before = await page.evaluate(value => {
        const input = document.querySelector('[data-composer-markdown]'); input.focus();
        document.execCommand('insertText', false, value);
        return input.innerText;
      }, legacyPrompt);
      assert.notEqual(before, legacyPrompt, 'The fixture must reproduce the legacy innerText mismatch');
      const outcome = await page.evaluate(pageAction, { ...args, prompt: legacyPrompt });
      assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
      assert.equal(await page.evaluate(() => fixture.sends), 1);
      assert.equal(await page.getByRole('textbox', { name: 'Message' }).innerText(), '');
    });
  }
  await scenario('Legacy extra blank lines are replaced with the configured prompt', async ({ page, args }) => {
    const configured = 'First synthetic line\n\nSecond synthetic line';
    const humanDraft = 'First synthetic line\n\n\nSecond synthetic line';
    const before = await page.evaluate(value => {
      const input = document.querySelector('[data-composer-markdown]'); input.focus();
      document.execCommand('insertText', false, value);
      return input.innerText;
    }, humanDraft);
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured });
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.sentTexts[0]), configured);
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
  await scenario('Legacy missing blank lines do not veto configured-prompt submission', async ({ page, args }) => {
    const configured = 'First synthetic line\n\n\nSecond synthetic line';
    const humanDraft = 'First synthetic line\n\nSecond synthetic line';
    const before = await page.evaluate(value => {
      const input = document.querySelector('[data-composer-markdown]'); input.focus();
      document.execCommand('insertText', false, value);
      return input.innerText;
    }, humanDraft);
    assert.equal(before, configured, 'The fixture must reproduce the innerText false positive');
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured });
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.sentTexts[0]), configured);
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
  await scenario('Wait-for-idle controls Agent activity, not ownership of composer text', async ({ page, args }) => {
    const stuckPrompt = 'Synthetic configured prompt';
    await page.getByRole('textbox', { name: 'Message' }).fill(stuckPrompt);
    const outcome = await page.evaluate(pageAction, { ...args, prompt: stuckPrompt, waitForIdle: true });
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.sentTexts[0]), stuckPrompt);
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
  await scenario('Priority replaces whitespace-changed text but still refuses attachments', async ({ page, args }) => {
    const stuckPrompt = 'Synthetic configured prompt';
    const input = page.getByRole('textbox', { name: 'Message' });
    for (const changed of [' ' + stuckPrompt, stuckPrompt + ' ', stuckPrompt + '\n']) {
      await input.fill(changed);
      const before = await input.innerText();
      assert.notEqual(before, stuckPrompt, 'The fixture must retain the human whitespace edit');
      const outcome = await page.evaluate(pageAction, { ...args, prompt: stuckPrompt, waitForIdle: false });
      assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
      assert.equal(await page.evaluate(() => fixture.sentTexts.at(-1)), stuckPrompt);
    }
    await input.fill(stuckPrompt);
    await page.evaluate(() => {
      const chip = document.createElement('button'); chip.setAttribute('aria-label', 'Remove file synthetic.txt'); chip.textContent = 'Remove';
      document.querySelector('#attachment-slot').append(chip); startWork();
    });
    const attached = await page.evaluate(pageAction, { ...args, prompt: stuckPrompt, waitForIdle: false });
    assert.equal(attached.status, 'draft', JSON.stringify(attached));
    assert.deepEqual(await page.evaluate(() => [fixture.stops, fixture.sends]), [0, 3]);
    assert.equal(await input.innerText(), stuckPrompt);
  });
  await scenario('An unavailable Send is a control failure, not a text-change veto', async ({ page, args }) => {
    await page.evaluate(() => {
      document.querySelector('button[aria-label="Send"]').remove();
      fixture.whitespaceAtCheck = 2;
    });
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'blocked', JSON.stringify(outcome));
    assert.equal((await page.getByRole('textbox', { name: 'Message' }).innerText()).trim(), '');
    assert.equal(await page.evaluate(() => fixture.sends), 0);
  });
  await scenario('Dot replaces text-only drafts and preserves attachment-only drafts', async ({ page, args }) => {
    const editor = page.getByRole('textbox', { name: 'Message' });
    await editor.fill('My unsent synthetic draft');
    assert.equal((await page.evaluate(pageAction, args)).status, 'sent');
    assert.equal(await page.evaluate(() => fixture.sentTexts[0].replace(/\n+/g, '\n').trim()), prompt.trim());
    await editor.fill('');
    await page.evaluate(() => { const chip = document.createElement('button'); chip.setAttribute('aria-label', 'Remove file local-test.txt'); chip.textContent = 'Remove'; document.querySelector('#attachment-slot').append(chip); });
    assert.equal((await page.evaluate(pageAction, args)).status, 'draft');
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
  await scenario('Dot requires a unique editor and a loaded target identity', async ({ page, args }) => {
    await page.evaluate(() => { const duplicate = document.querySelector('[data-composer-markdown]').cloneNode(); document.querySelector('[data-composer-input]').append(duplicate); });
    assert.equal((await page.evaluate(pageAction, args)).status, 'blocked');
    await page.evaluate(() => { document.querySelectorAll('[data-composer-markdown]')[1].remove(); document.querySelector('#conversation').replaceChildren(); });
    assert.equal((await page.evaluate(pageAction, { ...args, targetIdentity: null })).status, 'blocked');
    assert.equal(await page.evaluate(() => fixture.inputs), 0);
  });
  await scenario('Dot footer-scoped Send ignores a second unrelated Send elsewhere on the page', async ({ page, args }) => {
    await page.evaluate(() => {
      const root = document.querySelector('[data-composer-root]');
      root.removeAttribute('data-composer-root');
      const footer = document.querySelector('[data-composer-body]');
      footer.removeAttribute('data-composer-body'); footer.setAttribute('data-composer-footer-responsive', '');
      fixture.unrelatedSends = 0;
      const unrelated = document.createElement('button'); unrelated.setAttribute('aria-label', 'Send'); unrelated.textContent = 'Unrelated Send';
      unrelated.addEventListener('click', () => { fixture.unrelatedSends++; }); document.body.append(unrelated);
    });
    assert.equal((await page.evaluate(pageAction, args)).status, 'sent');
    assert.equal(await page.evaluate(() => fixture.unrelatedSends), 0);
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
  await scenario('A missing composer Send never falls back to an unrelated page Send', async ({ page, args }) => {
    await page.evaluate(() => {
      document.querySelector('button[aria-label="Send"]').remove();
      fixture.unrelatedSends = 0;
      const unrelated = document.createElement('button'); unrelated.setAttribute('aria-label', 'Send'); unrelated.textContent = 'Unrelated Send';
      unrelated.addEventListener('click', () => { fixture.unrelatedSends++; }); document.body.append(unrelated);
    });
    assert.equal((await page.evaluate(pageAction, args)).status, 'blocked');
    assert.equal(await page.evaluate(() => fixture.unrelatedSends), 0);
    assert.equal(await page.evaluate(() => fixture.sends), 0);
  });
  await scenario('Same Dot URL cannot silently switch to a different account or dot', async ({ page, args }) => {
    await page.evaluate(() => setIdentity('other-account~other-dot'));
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'blocked');
    assert.equal(await page.evaluate(() => fixture.inputs), 0);
    assert.equal(await page.evaluate(() => fixture.sends), 0);
  });
  await scenario('Target identity change during final permission check prevents clicking Send', async ({ page, args }) => {
    await page.evaluate(() => { fixture.switchIdentityAtCheck = 3; });
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'cancelled', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.sends), 0);
    assert.equal((await page.getByRole('textbox', { name: 'Message' }).innerText()).trim(), prompt.trim());
  });
  await scenario('Human pause after insertion cancels the Dot click and removes only its own draft', async ({ page, args }) => {
    await page.evaluate(() => { fixture.cancelOnInput = true; });
    assert.equal((await page.evaluate(pageAction, args)).status, 'cancelled');
    assert.equal(await page.evaluate(() => fixture.sends), 0);
    assert.equal((await page.getByRole('textbox', { name: 'Message' }).innerText()).trim(), '');
  });
  await scenario('A whitespace-only edit before final submission is overwritten and sent once', async ({ page, args }) => {
    await page.evaluate(() => { fixture.whitespaceAtCheck = 3; });
    assert.equal((await page.evaluate(pageAction, args)).status, 'sent');
    assert.equal(await page.evaluate(() => fixture.sends), 1);
    assert.equal(await page.evaluate(() => fixture.sentTexts[0].replace(/\n+/g, '\n').trim()), prompt.trim());
  });
  await scenario('Pause cannot clear a draft that a human changed only by whitespace', async ({ page, args }) => {
    await page.evaluate(() => { fixture.whitespaceAtCheck = 2; fixture.cancelWithWhitespace = true; });
    assert.equal((await page.evaluate(pageAction, args)).status, 'cancelled');
    assert.equal(await page.evaluate(() => fixture.sends), 0);
    const current = await page.getByRole('textbox', { name: 'Message' }).innerText();
    assert.equal(current, await page.evaluate(() => fixture.modifiedDraft));
    assert.ok(current.trim().length > 0);
  });
  await scenario('A cloned old identical user message is not a new delivery receipt', async ({ page, args }) => {
    await page.evaluate(prompt => {
      document.querySelector('article.message-row.self .message-body').innerText = prompt;
      fixture.acknowledgement = 'clone-old';
    }, prompt);
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'unknown', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
  for (const [configured, receipt] of [
    ['First line\n\nSecond line', 'First line\nSecond line'],
    ['First line\nSecond line', 'First line\n\nSecond line']
  ]) {
    await scenario('A new user receipt with different blank lines cannot confirm a send', async ({ page, args }) => {
      assert.notEqual(configured, receipt);
      assert.equal(configured.replace(/\n{2,}/g, '\n'), receipt.replace(/\n{2,}/g, '\n'));
      await page.evaluate(receipt => {
        fixture.acknowledgement = 'none';
        document.querySelector('button[aria-label="Send"]').addEventListener('click', () => {
          appendMessage(receipt, 'acct~dot~Msg~different-blank-lines');
        }, { once: true });
      }, receipt);
      const outcome = await page.evaluate(pageAction, { ...args, prompt: configured, runDeadline: Date.now() + 3000 });
      const state = await page.evaluate(() => ({ sends: fixture.sends, receipt: document.querySelector('article.message-row.self:last-child .message-body')?.innerText }));
      assert.equal(state.sends, 1);
      assert.equal(state.receipt, receipt);
      assert.equal(outcome.status, 'unknown', JSON.stringify(outcome));
    });
  }
  for (const initiallyKeyed of [false, true]) {
    await scenario(`An existing matching row cannot confirm after key hydration (keyed=${initiallyKeyed})`, async ({ page, args }) => {
      await page.evaluate(({ prompt, initiallyKeyed }) => {
        const row = document.querySelector('article.message-row.self');
        const body = row.querySelector('.message-body');
        body.innerText = prompt;
        if (!initiallyKeyed) {
          row.removeAttribute('data-message-id');
          body.removeAttribute('data-message-id');
        }
        fixture.acknowledgement = 'none';
        document.querySelector('button[aria-label="Send"]').addEventListener('click', () => {
          row.setAttribute('data-message-id', 'acct~dot~Msg~hydrated-old');
          body.setAttribute('data-message-id', 'acct~dot~Msg~hydrated-old');
        }, { once: true });
      }, { prompt: args.prompt, initiallyKeyed });
      const outcome = await page.evaluate(pageAction, args);
      assert.equal(outcome.status, 'unknown', JSON.stringify(outcome));
      assert.equal(await page.evaluate(() => fixture.sends), 1);
    });
  }
  await scenario('An old matching row restored as the last message cannot confirm a send', async ({ page, args }) => {
    await page.evaluate(prompt => {
      const old = document.querySelector('article.message-row.self');
      old.querySelector('.message-body').innerText = prompt;
      fixture.acknowledgement = 'none';
      const editor = document.querySelector('[contenteditable="true"]');
      editor.addEventListener('input', () => old.remove(), { once:true });
      document.querySelector('button[aria-label="Send"]').addEventListener('click', () => {
        document.querySelector('#conversation').append(old.cloneNode(true));
      }, { once:true });
    }, args.prompt);
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'unknown', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
  await scenario('A matching message followed by unrelated activity is ambiguous', async ({ page, args }) => {
    await page.evaluate(() => {
      document.querySelector('button[aria-label="Send"]').addEventListener('click', () => {
        appendMessage('Unrelated later message', 'acct~dot~Msg~other-new');
      }, { once: true });
    });
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'unknown', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
  await scenario('An unrelated matching message never confirms a missed dispatch', async ({ page, args }) => {
    await page.evaluate(prompt => {
      fixture.acknowledgement = 'none';
      document.querySelector('button[aria-label="Send"]').addEventListener('click', () => {
        appendMessage(prompt, 'acct~dot~Msg~other-matching');
        appendMessage('Unrelated later message', 'acct~dot~Msg~other-new');
      }, { once: true });
    }, args.prompt);
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'unknown', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
  await scenario('Older history inserted above the baseline is not a receipt', async ({ page, args }) => {
    await page.evaluate(prompt => {
      fixture.acknowledgement = 'none';
      document.querySelector('button[aria-label="Send"]').addEventListener('click', () => {
        const older = appendMessage(prompt, 'acct~dot~Msg~older-history').closest('article');
        document.querySelector('#conversation').prepend(older);
        appendMessage('Unrelated later message', 'acct~dot~Msg~other-new');
      }, { once: true });
    }, args.prompt);
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'unknown', JSON.stringify(outcome));
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
  await scenario('Dot assistant stop markers are optional and compared without returning marker content', async ({ page, args }) => {
    await page.evaluate(() => { document.querySelector('article.message-row:not(.self) .message-body').innerText = 'Synthetic result\n[STOP_PRIVATE_SYNTHETIC]'; });
    const stopped = await page.evaluate(pageAction, { ...args, stopMarkers: ['[STOP_PRIVATE_SYNTHETIC]'] });
    assert.equal(stopped.status, 'done'); assert.equal(stopped.message.includes('[STOP_PRIVATE_SYNTHETIC]'), false);
    assert.equal((await page.evaluate(pageAction, args)).status, 'sent');
  });
  await scenario('Dot background send leaves another tab value, caret and focus untouched', async ({ context, page, args }) => {
    const foreground = await context.newPage();
    await foreground.goto('https://synthetic-foreground.invalid/work');
    await foreground.setContent('<label>Normal work<input id="work" value="Unrelated local work"></label>');
    await foreground.bringToFront();
    await foreground.locator('#work').focus();
    await foreground.locator('#work').evaluate(input => input.setSelectionRange(5, 5));
    const snapshot = () => foreground.evaluate(() => ({ active: document.activeElement.id, value: document.querySelector('#work').value, start: document.querySelector('#work').selectionStart, end: document.querySelector('#work').selectionEnd, focused: document.hasFocus() }));
    const before = await snapshot();
    assert.equal((await page.evaluate(pageAction, args)).status, 'sent');
    assert.deepEqual(await snapshot(), before);
  });
  await scenario('Dot prefers structured tilde IDs over optimistic unhydrated trailing turn IDs', async ({ page, args }) => {
    const before = await page.evaluate(() => fixture.sends);
    await page.evaluate(text => {
      fixture.acknowledgement = 'none';
      document.querySelector('button[aria-label="Send"]').addEventListener('click', () => {
        appendMessage(text, 'optimistic-temp-1', true);
      }, { once: true });
    }, prompt);
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'sent');
    assert.equal(outcome.identity, 'acct~dot');
    assert.equal(outcome.diagnosticProgress.counters.documentChanges, 0);
    assert.equal(await page.evaluate(() => fixture.sends), before + 1);
  });
  await scenario('Dot still blocks structured different conversation IDs alongside optimistic rows', async ({ page, args }) => {
    await page.evaluate(() => {
      appendMessage('Other conversation structured row', 'acct~other~Msg~99', true);
      appendMessage('Optimistic trailing row', 'optimistic-temp-2', false);
    });
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'blocked');
    assert.deepEqual(await page.evaluate(() => [fixture.inputs, fixture.sends]), [0, 0]);
  });
  await scenario('Long Dot WYSIWYG markdown prompts with HR rules and links chunk without stalling', async ({ page, args }) => {
    const longMarkdownPrompt = Array.from({ length: 14 }, (_, i) =>
      `Paragraph ${i + 1}: Inspect [repo ${i + 1}](https://example.invalid/${i + 1}) carefully.\n----`
    ).join('\n');
    assert.ok(longMarkdownPrompt.length > 1000);
    await page.evaluate(() => {
      fixture.acknowledgement = 'new';
      const input = document.querySelector('[data-composer-markdown]');
      const send = document.querySelector('button[aria-label="Send"]');
      input.addEventListener('beforeinput', event => {
        if (event.inputType !== 'insertText' || !event.data) return;
        event.preventDefault();
        const lines = event.data.split(/\r?\n/);
        for (const line of lines) {
          if (/^----+$/.test(line.trim())) {
            input.append(document.createElement('hr'));
          } else {
            const p = document.createElement('p');
            const m = line.match(/^(.*)\[([^\]]+)\]\((https?:\/\/[^)]+)\)(.*)$/);
            if (m) {
              if (m[1]) p.append(document.createTextNode(m[1]));
              const a = document.createElement('a');
              a.href = m[3];
              a.textContent = m[2];
              p.append(a);
              if (m[4]) p.append(document.createTextNode(m[4]));
            } else if (line) {
              p.textContent = line;
            } else {
              p.append(document.createElement('br'));
            }
            input.append(p);
          }
        }
        send.disabled = false;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: event.data }));
      });
    });
    const outcome = await page.evaluate(pageAction, { ...args, prompt: longMarkdownPrompt });
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.ok(outcome.diagnosticProgress.counters.textChunks > 1, JSON.stringify(outcome.diagnosticProgress));
    assert.equal(outcome.diagnosticProgress.counters.chunkUnserializableChecks, 0, JSON.stringify(outcome.diagnosticProgress));
    assert.equal(await page.evaluate(() => fixture.sends), 1);
  });
} finally { await browser.close(); }
console.log(`RESULT ${passed}/${passed + failed} Dot adapter scenarios passed`);
process.exitCode = failed ? 1 : 0;
