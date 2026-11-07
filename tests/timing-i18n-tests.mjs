import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTranslator, initializeLanguage, getLanguage, setLanguage} from '../i18n.js';
import html from '../i18n-html.js';
import popup from '../i18n-popup.js';
import runtime from '../i18n-runtime.js';

const timingCatalogs = [
  {name: 'html', catalog: html, entries: {
    '诊断发送计时（不发送）': 'Diagnose send timing (no send)',
  }},
  {name: 'popup', catalog: popup, entries: {
    '正在测量授权与页面计时；不会填写或发送消息。': 'Measuring authorization and page timers; no message will be filled or sent.',
    '诊断暂不可用。': 'Diagnostics unavailable.',
    '授权消息': 'Authorization',
    '页面计时': 'Page timers',
    '已收到结果': 'Result',
    '看门狗超时': 'Watchdog expired',
    'API 调用被拒绝': 'API rejected',
    '返回结果无效': 'Invalid result',
    '只读计时诊断': 'Read-only timing diagnostics',
  }},
  {name: 'runtime', catalog: runtime, entries: {
    '请先暂停已绑定的任务，再运行不发送诊断。': 'Pause a bound task before running no-send diagnostics.',
    '请只打开一个原绑定页面副本，再运行诊断。': 'Open exactly one copy of the original bound page before diagnostics.',
    '只读发送计时诊断已完成。': 'Read-only send timing diagnostics completed.',
  }},
];

async function withLanguage(language, verify) {
  const originalChrome = globalThis.chrome;
  const originalLanguage = getLanguage();
  const writes = [];
  globalThis.chrome = {storage: {local: {async set(value) { writes.push(value); }}}};
  try {
    await setLanguage(language);
    await verify(writes);
  } finally {
    try { await setLanguage(originalLanguage); }
    finally {
      if (originalChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = originalChrome;
    }
  }
}

test('timing catalogs contain every exact source-to-English mapping', () => {
  for (const {name, catalog, entries} of timingCatalogs) {
    for (const [source, english] of Object.entries(entries)) {
      assert.ok(Object.hasOwn(catalog, source), `${name}: missing ${source}`);
      assert.equal(catalog[source], english, `${name}: ${source}`);
    }
  }
});

test('timing translators default to English without a stored preference', async () => {
  await initializeLanguage();
  assert.equal(getLanguage(), 'en');
  for (const {catalog, entries} of timingCatalogs) {
    const t = createTranslator(catalog);
    for (const [source, english] of Object.entries(entries)) assert.equal(t(source), english);
  }
});

test('explicit Chinese selection returns timing source keys and persists only the UI preference', async () => {
  const translators = timingCatalogs.map(({catalog}) => createTranslator(catalog));
  await withLanguage('zh_CN', async writes => {
    assert.equal(getLanguage(), 'zh_CN');
    for (const [index, {entries}] of timingCatalogs.entries()) {
      for (const source of Object.keys(entries)) assert.equal(translators[index](source), source);
    }
    assert.deepEqual(writes, [{uiLanguage: 'zh_CN'}]);
  });
  for (const [index, {entries}] of timingCatalogs.entries()) {
    for (const [source, english] of Object.entries(entries)) assert.equal(translators[index](source), english);
  }
});

test('timing labels preserve exact numeric measurements and boolean results in both languages', async () => {
  const t = createTranslator(popup);
  const observations = [
    {firstMs: 0, elapsedMs: 0, ok: false, allowed: true, hidden: false},
    {firstMs: 60, elapsedMs: 73, ok: true, allowed: false, hidden: true},
    {firstMs: 0.125, elapsedMs: 120000, ok: false, allowed: false, hidden: false},
    {firstMs: 4000, elapsedMs: Number.MAX_SAFE_INTEGER, ok: true, allowed: true, hidden: true},
  ];
  const original = structuredClone(observations);
  for (const language of ['en', 'zh_CN']) await withLanguage(language, () => {
    const authorization = language === 'en' ? 'Authorization' : '授权消息';
    const pageTimers = language === 'en' ? 'Page timers' : '页面计时';
    for (const {firstMs, elapsedMs, ok, allowed, hidden} of observations) {
      assert.equal(t`${t('授权消息')}: ${elapsedMs} ms; ok=${ok}; allowed=${allowed}`,
        `${authorization}: ${elapsedMs} ms; ok=${ok}; allowed=${allowed}`);
      assert.equal(t`${t('页面计时')}: ${firstMs} / ${elapsedMs} ms; hidden=${hidden}`,
        `${pageTimers}: ${firstMs} / ${elapsedMs} ms; hidden=${hidden}`);
    }
  });
  assert.deepEqual(observations, original);
});

test('timing catalogs never recursively translate or rewrite interpolated user text', async () => {
  const t = createTranslator(popup);
  const privateTexts = ['诊断暂不可用。', '授权消息',
    '  用户正文\r\n只读计时诊断 {0} {1} <script> $& 00060 1.2500\t'];
  for (const language of ['en', 'zh_CN']) await withLanguage(language, () => {
    for (const text of privateTexts) {
      assert.equal(t`${text}`, text);
      assert.equal(t`队列 ${1} 条 · ${text}`,
        language === 'en' ? `Queue: 1 items · ${text}` : `队列 1 条 · ${text}`);
    }
  });
});
