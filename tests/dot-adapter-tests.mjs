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
window.fixture = { checks: 0, sends: 0, inputs: 0, allowed: true, cancelOnInput: false, idPlacement: 'both', acknowledgement: 'new', switchIdentityAtCheck: null, whitespaceAtCheck: null, cancelWithWhitespace: false, modifiedDraft: null, clipboardCalls: 0, focusCalls: 0, sentTexts: [] };
const editor = document.querySelector('[data-composer-markdown]');
const send = document.querySelector('button[aria-label="Send"]');
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
editor.addEventListener('input', () => {
  fixture.inputs++;
  if (fixture.cancelOnInput) fixture.allowed = false;
  send.disabled = !editor.innerText.trim();
});
send.addEventListener('click', () => {
  fixture.sends++;
  const text = editor.innerText; fixture.sentTexts.push(text); editor.textContent = ''; send.disabled = true;
  if (fixture.acknowledgement === 'new') appendMessage(text, 'acct~dot~Msg~new-' + fixture.sends);
  if (fixture.acknowledgement === 'clone-old') {
    const old = document.querySelector('article.message-row.self');
    const clone = old.cloneNode(true); old.remove(); document.querySelector('#conversation').append(clone);
  }
});
</script></body></html>`;

let passed = 0;
let failed = 0;
async function scenario(name, callback) {
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  const page = await context.newPage();
  await page.goto(expectedUrl);
  const args = { mode: 'send', expectedUrl, targetIdentity: 'acct~dot', prompt, runId: 'synthetic-dot-run', runDeadline: Date.now() + 12_000, stopMarkers: [], waitForIdle: true };
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
    assert.equal((await page.evaluate(pageAction, args)).status, 'busy');
    assert.equal(await page.evaluate(() => fixture.inputs), 0);
    await page.evaluate(() => { document.querySelector('.typing-indicator').hidden = true; });
    assert.equal((await page.evaluate(pageAction, args)).status, 'sent');
    await page.evaluate(() => { document.querySelector('.typing-indicator').hidden = false; });
    assert.equal((await page.evaluate(pageAction, { ...args, waitForIdle: false })).status, 'sent');
    assert.equal(await page.evaluate(() => fixture.sends), 2);
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
