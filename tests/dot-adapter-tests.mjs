// Synthetic Dot DOM matching observed structural attributes. No real messages,
// user attachments, signed-in sessions, or live ChatGPT network calls are used.
import assert from 'node:assert/strict';
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
  const text = editor.innerText; fixture.sentTexts.push(text); editor.textContent = ''; send.disabled = true;
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
  await scenario('Dot home target is accepted while public/shared and non-HTTPS pages are rejected', async () => {
    assert.equal(validateTarget(expectedUrl), true);
    for (const url of ['https://chatgpt.com/', 'https://chatgpt.com/share/abc', 'https://example.invalid/dots/home', 'http://chatgpt.com/dots/home', 'https://chatgpt.com:8443/dots/home']) assert.equal(validateTarget(url), false, url);
  });
  await scenario('Dot self-check binds structural identity without filling or sending', async ({ page, args }) => {
    const outcome = await page.evaluate(pageAction, { ...args, mode: 'check', runId: null, targetIdentity: null });
    assert.equal(outcome.status, 'ready', JSON.stringify(outcome));
    assert.equal(outcome.identity, 'acct~dot');
    assert.equal(outcome.assistantToken, 'acct~dot~Msg~assistant-old');
    assert.equal(outcome.assistantCount, 1);
    assert.deepEqual(await page.evaluate(() => [fixture.inputs, fixture.sends, fixture.checks]), [0, 0, 0]);
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
  await scenario('A rejected beforeinput that restores a different draft is never treated as our insertion', async ({ page, args }) => {
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
    assert.equal(outcome.status, 'blocked', JSON.stringify(outcome));
    assert.equal(await page.getByRole('textbox', { name: 'Message' }).innerText(), restoredDraft);
    assert.equal(await page.evaluate(() => fixture.sends), 0);
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
  await scenario('Legacy recovery preserves an actual extra human blank line instead of collapsing it', async ({ page, args }) => {
    const configured = 'First synthetic line\n\nSecond synthetic line';
    const humanDraft = 'First synthetic line\n\n\nSecond synthetic line';
    const before = await page.evaluate(value => {
      const input = document.querySelector('[data-composer-markdown]'); input.focus();
      document.execCommand('insertText', false, value);
      return input.innerText;
    }, humanDraft);
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured });
    assert.equal(outcome.status, 'draft', JSON.stringify(outcome));
    assert.equal(await page.getByRole('textbox', { name: 'Message' }).innerText(), before);
    assert.equal(await page.evaluate(() => fixture.sends), 0);
  });
  await scenario('Legacy recovery preserves a missing human blank line even when innerText accidentally matches', async ({ page, args }) => {
    const configured = 'First synthetic line\n\n\nSecond synthetic line';
    const humanDraft = 'First synthetic line\n\nSecond synthetic line';
    const before = await page.evaluate(value => {
      const input = document.querySelector('[data-composer-markdown]'); input.focus();
      document.execCommand('insertText', false, value);
      return input.innerText;
    }, humanDraft);
    assert.equal(before, configured, 'The fixture must reproduce the innerText false positive');
    const outcome = await page.evaluate(pageAction, { ...args, prompt: configured });
    assert.equal(outcome.status, 'draft', JSON.stringify(outcome));
    assert.equal(await page.getByRole('textbox', { name: 'Message' }).innerText(), before);
    assert.equal(await page.evaluate(() => fixture.sends), 0);
  });
  await scenario('A matching prompt remains a protected draft in explicit wait mode', async ({ page, args }) => {
    const stuckPrompt = 'Synthetic configured prompt';
    await page.getByRole('textbox', { name: 'Message' }).fill(stuckPrompt);
    const outcome = await page.evaluate(pageAction, { ...args, prompt: stuckPrompt, waitForIdle: true });
    assert.equal(outcome.status, 'draft', JSON.stringify(outcome));
    assert.equal(await page.getByRole('textbox', { name: 'Message' }).innerText(), stuckPrompt);
    assert.equal(await page.evaluate(() => fixture.sends), 0);
  });
  await scenario('Force recovery never adopts whitespace-changed prompts or prompts with attachments', async ({ page, args }) => {
    const stuckPrompt = 'Synthetic configured prompt';
    const input = page.getByRole('textbox', { name: 'Message' });
    for (const changed of [' ' + stuckPrompt, stuckPrompt + ' ', stuckPrompt + '\n']) {
      await input.fill(changed);
      const before = await input.innerText();
      assert.notEqual(before, stuckPrompt, 'The fixture must retain the human whitespace edit');
      const outcome = await page.evaluate(pageAction, { ...args, prompt: stuckPrompt, waitForIdle: false });
      assert.equal(outcome.status, 'draft', JSON.stringify(outcome));
      assert.equal(await input.innerText(), before);
    }
    await input.fill(stuckPrompt);
    await page.evaluate(() => {
      const chip = document.createElement('button'); chip.setAttribute('aria-label', 'Remove file synthetic.txt'); chip.textContent = 'Remove';
      document.querySelector('#attachment-slot').append(chip); startWork();
    });
    const attached = await page.evaluate(pageAction, { ...args, prompt: stuckPrompt, waitForIdle: false });
    assert.equal(attached.status, 'draft', JSON.stringify(attached));
    assert.deepEqual(await page.evaluate(() => [fixture.stops, fixture.sends]), [0, 0]);
    assert.equal(await input.innerText(), stuckPrompt);
  });
  await scenario('A pre-send failure preserves a human edit made while waiting for Send', async ({ page, args }) => {
    await page.evaluate(() => {
      document.querySelector('button[aria-label="Send"]').remove();
      fixture.whitespaceAtCheck = 2;
    });
    const outcome = await page.evaluate(pageAction, args);
    assert.equal(outcome.status, 'blocked', JSON.stringify(outcome));
    assert.equal(await page.getByRole('textbox', { name: 'Message' }).innerText(), await page.evaluate(() => fixture.modifiedDraft));
    assert.ok((await page.getByRole('textbox', { name: 'Message' }).innerText()).trim().length > 0);
    assert.equal(await page.evaluate(() => fixture.sends), 0);
  });
  await scenario('Dot preserves text drafts and attachment-only drafts', async ({ page, args }) => {
    const editor = page.getByRole('textbox', { name: 'Message' });
    await editor.fill('My unsent synthetic draft');
    assert.equal((await page.evaluate(pageAction, args)).status, 'draft');
    assert.equal(await editor.innerText(), 'My unsent synthetic draft');
    await editor.fill('');
    await page.evaluate(() => { const chip = document.createElement('button'); chip.setAttribute('aria-label', 'Remove file local-test.txt'); chip.textContent = 'Remove'; document.querySelector('#attachment-slot').append(chip); });
    assert.equal((await page.evaluate(pageAction, args)).status, 'draft');
    assert.equal(await page.evaluate(() => fixture.sends), 0);
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
    assert.equal((await page.getByRole('textbox', { name: 'Message' }).innerText()).trim(), '');
  });
  await scenario('Human pause after insertion cancels the Dot click and removes only its own draft', async ({ page, args }) => {
    await page.evaluate(() => { fixture.cancelOnInput = true; });
    assert.equal((await page.evaluate(pageAction, args)).status, 'cancelled');
    assert.equal(await page.evaluate(() => fixture.sends), 0);
    assert.equal((await page.getByRole('textbox', { name: 'Message' }).innerText()).trim(), '');
  });
  await scenario('A whitespace-only human edit before final submission is preserved and not sent', async ({ page, args }) => {
    await page.evaluate(() => { fixture.whitespaceAtCheck = 3; });
    assert.equal((await page.evaluate(pageAction, args)).status, 'blocked');
    assert.equal(await page.evaluate(() => fixture.sends), 0);
    assert.equal(await page.getByRole('textbox', { name: 'Message' }).innerText(), await page.evaluate(() => fixture.modifiedDraft));
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
} finally { await browser.close(); }
console.log(`RESULT ${passed}/${passed + failed} Dot adapter scenarios passed`);
process.exitCode = failed ? 1 : 0;
