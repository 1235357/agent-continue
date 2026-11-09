// Real official ProseMirror modules with the documented Tiptap DOM owner shape,
// synthetic content, intercepted local-only
// routes, and a disposable browser. No extension/background, live service,
// authorization, or delivery acceptance is exercised by this candidate test.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { editorCommit } from '../editor-commit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.resolve(process.env.PROSEMIRROR_MODULE_ROOT || path.join(here, '..', 'node_modules'));
const playwright = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href)
  : await import('playwright');
const modules = new Map();
const imports = {};
for (const name of ['prosemirror-view', 'prosemirror-state', 'prosemirror-model', 'prosemirror-schema-basic',
  'prosemirror-keymap', 'prosemirror-transform', 'orderedmap', 'w3c-keyname']) {
  const packageRoot = path.join(moduleRoot, name);
  const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const route = '/__local_pm__/' + name + '.js';
  imports[name] = route;
  modules.set(route, await fs.readFile(path.join(packageRoot, metadata.module), 'utf8'));
}
const editorCss = await fs.readFile(path.join(moduleRoot, 'prosemirror-view/style/prosemirror.css'), 'utf8');
const prompt = '  CONFIGURED_FIRST\n\nCONFIGURED_LAST \n';
const tempRoot = path.resolve(os.tmpdir());
const profile = await fs.mkdtemp(path.join(tempRoot, 'agent-continue-editor-commit-'));
const pages = new Map();
let browserProcess;
let browser;
let context;
let passed = 0;
let serial = 0;

function fixture(options) {
  return `<!doctype html><meta charset="utf-8"><title>Editor commit local fixture</title>
  <style>${editorCss}body{font:16px sans-serif;padding:20px}.ProseMirror{min-height:80px;border:1px solid;padding:12px}</style>
  <input id="previous" value="untouched foreground selection">
  <main><article class="message-row" data-message-id="account~dot~old">Synthetic history</article></main>
  ${options.priorHiddenEditor ? '<section data-composer-body hidden><div data-composer-input id="priorMount"></div></section>' : ''}
  <section data-composer-body><div data-composer-input id="editorMount"></div>
  ${options.noSend ? '' : '<button id="send" type="button" aria-label="Send" disabled>Send</button>'}</section>
  <script type="importmap">${JSON.stringify({ imports })}</script>
  <script type="module">
  import {EditorView} from 'prosemirror-view';import {EditorState} from 'prosemirror-state';
  import {schema} from 'prosemirror-schema-basic';import {keymap} from 'prosemirror-keymap';
  const options=${JSON.stringify(options)};
  const stats=window.fixture={updates:0,hiddenUpdates:0,clicks:0,commands:0,submits:0,resets:0,
    inputs:0,mutations:0,events:[],keys:[],sentTexts:[],sentDOMTexts:[],lastKeyTrusted:null};
  const doc=text=>schema.node('doc',null,[schema.nodes.paragraph.create(null,schema.text(text))]);
  const text=view=>view.state.doc.textBetween(0,view.state.doc.content.size,'\\n','\\n');
  const domText=view=>Array.from(view.dom.children,node=>node.textContent).join('\\n');
  let button=document.querySelector('#send');
  const submit=()=>{stats.submits++;stats.sentTexts.push(text(pm));stats.sentDOMTexts.push(domText(pm));stats.events.push('submit')};
  const wireButton=()=>{if(button)button.addEventListener('click',()=>{stats.clicks++;submit()})};
  wireButton();
  if(options.unsupported){
    const editor=document.createElement('div');editor.className='ProseMirror';editor.contentEditable='true';
    editor.setAttribute('role','textbox');editor.setAttribute('data-composer-markdown','');editor.textContent='UNSUPPORTED_UNTOUCHED';
    document.querySelector('#editorMount').append(editor);
    new MutationObserver(records=>stats.mutations+=records.length).observe(editor,{subtree:true,childList:true,characterData:true,attributes:true});
    for(const type of ['focus','input','change','keydown','keyup'])editor.addEventListener(type,()=>stats.events.push(type));
  }else{
    if(options.priorHiddenEditor)window.prior=new EditorView(document.querySelector('#priorMount'),{
      state:EditorState.create({schema,doc:doc('HIDDEN_PRIOR_UNTOUCHED')}),
      attributes:{role:'textbox','aria-label':'Message','data-composer-markdown':''},
      dispatchTransaction(tr){prior.updateState(prior.state.apply(tr));stats.hiddenUpdates++}
    });
    window.pm=new EditorView(document.querySelector('#editorMount'),{
      state:EditorState.create({schema,doc:doc('PAGE_CONTROLLED_RESET'),plugins:[keymap({
        'Ctrl-Enter':()=>{stats.commands++;if(!options.rejectSynthetic||stats.lastKeyTrusted)submit();return true},
        'Enter':()=>{stats.commands++;if(!options.rejectSynthetic||stats.lastKeyTrusted)submit();return true}
      })]}),
      attributes:{role:'textbox','aria-label':'Message','data-composer-markdown':''},
      dispatchTransaction(tr){pm.updateState(pm.state.apply(tr));stats.updates++;if(button)button.disabled=!pm.state.doc.textContent.trim()}
    });
    if(!options.noOwner)pm.dom.editor={view:pm};
    const reset=()=>{
      pm.dispatch(pm.state.tr.replaceWith(0,pm.state.doc.content.size,doc('PAGE_CONTROLLED_RESET').content));
      pm.dom.innerHTML='<p>PAGE_CONTROLLED_RESET</p>';
      stats.resets++;stats.events.push('reset');
    };
    for(const type of ['input','change'])pm.dom.addEventListener(type,()=>{
      stats.events.push(type);if(type==='input')stats.inputs++;
      if(options.rewrite==='sync')reset();
      if(options.rewrite==='microtask'&&type==='input')queueMicrotask(reset);
      if(options.rewriteUrl&&type==='input')history.replaceState(null,'','/dots/rewritten/?view=1#composer');
      if(options.replaceSend&&type==='input'&&button){
        const fresh=button.cloneNode(true);fresh.disabled=false;button.replaceWith(fresh);button=fresh;wireButton();
      }
    });
    for(const type of ['keydown','keyup'])pm.dom.addEventListener(type,event=>{
      stats.lastKeyTrusted=event.isTrusted;
      stats.keys.push({type,key:event.key,ctrlKey:event.ctrlKey,trusted:event.isTrusted});
    },true);
  }
  window.fixtureReady=true;
  </script>`;
}

async function launchBrowser() {
  // Reuse the existing PM fixture's noDefaults CDP launch so evaluating a
  // background tab does not enable Playwright's focus emulation.
  browserProcess = spawn(process.env.FULL_CHROMIUM_PATH || playwright.chromium.executablePath(), [
    '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-extensions-with-background-pages', '--disable-default-apps', '--disable-extensions',
    '--disable-dev-shm-usage', '--window-size=1200,1000', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--headless=new', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Disposable browser startup timed out')), 15000);
    let stderr = '';
    browserProcess.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-8000);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    browserProcess.once('error', error => { clearTimeout(timeout); reject(error); });
    browserProcess.once('exit', code => { clearTimeout(timeout); reject(new Error(`Disposable browser exited (${code}) before connecting`)); });
  });
  browser = await playwright.chromium.connectOverCDP(endpoint, { noDefaults: true });
  context = browser.contexts()[0];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://editor-commit.invalid') return route.abort();
    if (modules.has(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: modules.get(url.pathname) });
    const pathname = url.pathname.replace(/\/+$/, '');
    if (pages.has(pathname)) return route.fulfill({ contentType: 'text/html', body: pages.get(pathname) });
    return route.abort();
  });
}

async function closeBrowser() {
  const child = browserProcess;
  if (!child?.pid) return;
  const exited = new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  if (browser?.isConnected()) {
    const session = await browser.newBrowserCDPSession();
    await session.send('Browser.close').catch(() => {});
    await browser.close().catch(() => {});
  } else if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await exited;
  clearTimeout(timeout);
}

const inspect = page => page.evaluate(() => ({ ...fixture,
  model: window.pm?.state.doc.textBetween(0,pm.state.doc.content.size,'\n','\n'),
  dom: window.pm?.dom.textContent,
  prior: window.prior?.state.doc.textContent,
  visibility: document.visibilityState,
}));
const commit = (page, args) => page.evaluate(({ source, args }) => (0, eval)('(' + source + ')')(args),
  { source: editorCommit.toString(), args });
async function scenario(name, options, check) {
  const pathname = `/${options.dot ? 'dots' : 'c'}/candidate-${++serial}`;
  pages.set(pathname, fixture(options));
  const page = await context.newPage();
  try {
    await page.goto('https://editor-commit.invalid' + pathname + '/?view=1#composer');
    await page.waitForFunction(() => window.fixtureReady);
    const args = { expectedUrl: 'https://editor-commit.invalid' + pathname,
      targetIdentity: options.dot ? 'account~dot' : null, prompt, sendMethod: 'button', deadline: Date.now() + 10000 };
    await check(page, args);
    passed++;
    console.log('PASS ' + name);
  } finally { await page.close(); }
}

function submittedOnce(observed, { keyboard = false } = {}) {
  assert.equal(observed.submits, 1);
  assert.equal(observed.clicks, keyboard ? 0 : 1);
  assert.equal(observed.commands, keyboard ? 1 : 0);
  assert.deepEqual(observed.sentTexts, [prompt]);
  assert.deepEqual(observed.sentDOMTexts, [prompt]);
}

try {
  await launchBrowser();
  await scenario('recurring per-input microtask resets cannot replace the single submitted configured model/DOM',
    { rewrite: 'microtask' }, async (page, args) => {
      for (let i = 0; i < 3; i++) await page.evaluate(() => pm.dom.dispatchEvent(new Event('input', { bubbles: true })));
      assert.equal((await inspect(page)).resets, 3, 'The reset must recur on every priming input');
      const result = await commit(page, args);
      assert.equal(result.dispatched, true, result.code);
      const observed = await inspect(page);
      submittedOnce(observed);
      assert.equal(observed.inputs, 4);
      assert.equal(observed.resets, 4);
      assert.equal(observed.model, 'PAGE_CONTROLLED_RESET');
      assert.equal(observed.dom, 'PAGE_CONTROLLED_RESET');
      assert.deepEqual(observed.events.slice(-4), ['input', 'change', 'submit', 'reset']);
    });
  await scenario('prior hidden real editor is untouched while same-identity Dot URL rewrites still submit once',
    { dot: true, priorHiddenEditor: true, rewrite: 'microtask', rewriteUrl: true }, async (page, args) => {
      assert.equal((await commit(page, args)).dispatched, true);
      const observed = await inspect(page);
      submittedOnce(observed);
      assert.equal(observed.prior, 'HIDDEN_PRIOR_UNTOUCHED');
      assert.equal(observed.hiddenUpdates, 0);
      assert.match(page.url(), /\/dots\/rewritten\//);
    });
  for (const dot of [false, true]) await scenario(`${dot ? 'Dot Ctrl+Enter' : 'ordinary Enter'} auto fallback uses one official keymap command without scoped Send`,
    { dot, noSend: true, rewrite: 'microtask' }, async (page, args) => {
      const result = await commit(page, { ...args, sendMethod: 'auto' });
      assert.equal(result.dispatched, true, result.code);
      submittedOnce(await inspect(page), { keyboard: true });
    });
  await scenario('synchronous input/change model and DOM rewrites get one bounded final correction, not a content veto',
    { rewrite: 'sync' }, async (page, args) => {
      const result = await commit(page, args);
      assert.equal(result.dispatched, true, result.code);
      const observed = await inspect(page);
      submittedOnce(observed);
      assert.equal(observed.inputs, 1);
      assert.equal(observed.resets, 2);
      assert.equal(observed.updates, 4, 'Initial transaction, two fixture resets, one final correction');
    });
  await scenario('post-input replacement Send is freshly scoped and clicked once',
    { replaceSend: true }, async (page, args) => {
      assert.equal((await commit(page, args)).dispatched, true);
      submittedOnce(await inspect(page));
    });
  await scenario('unsupported view returns before mutation, focus, input, keys, or clicks',
    { unsupported: true }, async (page, args) => {
      await page.locator('#previous').focus();
      const before = await page.locator('.ProseMirror').evaluate(element => element.innerHTML);
      const result = await commit(page, args);
      assert.equal(result.supported, false);
      assert.equal(result.dispatched, false);
      const observed = await inspect(page);
      assert.deepEqual([observed.updates, observed.mutations, observed.clicks, observed.commands, observed.submits], [0, 0, 0, 0, 0]);
      assert.deepEqual(observed.events, []);
      assert.equal(await page.locator('.ProseMirror').evaluate(element => element.innerHTML), before);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'previous');
    });
  await scenario('ignored synthetic Ctrl+Enter is only an attempt, never a second Send click',
    { dot: true, rejectSynthetic: true }, async (page, args) => {
      const result = await commit(page, { ...args, sendMethod: 'ctrl-enter' });
      assert.equal(result.dispatched, true);
      const observed = await inspect(page);
      assert.deepEqual([observed.commands, observed.clicks, observed.submits], [1, 0, 0]);
    });
  await scenario('actually hidden browser tab sends once without changing foreground text or selection',
    { dot: true }, async (page, args) => {
      pages.set('/foreground', '<!doctype html><input id="work" value="UNRELATED_FOREGROUND_TEXT">');
      const foreground = await context.newPage();
      try {
        await foreground.goto('https://editor-commit.invalid/foreground');
        await foreground.bringToFront();
        await foreground.locator('#work').focus();
        await foreground.locator('#work').evaluate(input => input.setSelectionRange(2, 7));
        const snapshot = () => foreground.evaluate(() => {
          const input = document.querySelector('#work');
          return { text: input.value, start: input.selectionStart, end: input.selectionEnd,
            active: document.activeElement.id, focused: document.hasFocus(), visibility: document.visibilityState };
        });
        const before = await snapshot();
        await page.waitForFunction(() => document.visibilityState === 'hidden', null, { timeout: 3000, polling: 50 });
        assert.equal((await commit(page, { ...args, sendMethod: 'ctrl-enter' })).dispatched, true);
        const observed = await inspect(page);
        submittedOnce(observed, { keyboard: true });
        assert.equal(observed.visibility, 'hidden');
        assert.deepEqual(await snapshot(), before);
      } finally { await foreground.close(); }
    });
  console.log(`RESULT ${passed}/${passed} local official ProseMirror candidate scenarios passed`);
} finally {
  await closeBrowser();
  // Verify the resolved target is exactly the generated direct temp child
  // before recursive cleanup; never delete a supplied or repository path.
  assert.equal(path.dirname(path.resolve(profile)), tempRoot);
  assert.ok(path.basename(profile).startsWith('agent-continue-editor-commit-'));
  await fs.rm(profile, { recursive: true, force: true });
}
