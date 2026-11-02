import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTranslator, initializeLanguage, getLanguage, setLanguage} from '../i18n.js';
import html from '../i18n-html.js';
import popup from '../i18n-popup.js';
import runtime from '../i18n-runtime.js';
import fs from 'node:fs';

test('English is default without a stored preference, regardless of browser locale', async()=>{
  await initializeLanguage();
  assert.equal(getLanguage(),'en');
  assert.equal(createTranslator({'测试':'Test'})('测试'),'Test');
});
test('explicit language switch persists only UI preference and preserves interpolation', async()=>{
  const writes=[];
  globalThis.chrome={storage:{local:{async set(value){writes.push(value);}}}};
  const t=createTranslator({'字符 {0}':'Characters {0}'});
  const privateText='用户正文 {0} <script>';
  assert.equal(t`字符 ${privateText}`,'Characters '+privateText);
  await setLanguage('zh_CN');
  assert.equal(t`字符 ${privateText}`,'字符 '+privateText);
  await setLanguage('en');
  assert.deepEqual(writes,[{uiLanguage:'zh_CN'},{uiLanguage:'en'}]);
  await assert.rejects(setLanguage('other'),/Unsupported/);
});
test('English catalogs are complete translations, not Chinese passthroughs',()=>{
  for(const catalog of [html,popup,runtime]) for(const [key,value] of Object.entries(catalog)) {
    assert.equal(typeof value,'string');
    assert.equal(/[\u3400-\u9fff]/u.test(value),false,`English catalog contains Chinese: ${key}`);
    assert.deepEqual([...key.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),[...value.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),`Placeholder mismatch: ${key}`);
  }
});
test('public metadata stays English and within Chrome summary limits',()=>{
  for(const locale of ['en','zh_CN']) {
    const messages=JSON.parse(fs.readFileSync(new URL(`../_locales/${locale}/messages.json`,import.meta.url)));
    assert.ok(messages.extensionDescription.message.length<=132);
    for(const entry of Object.values(messages)) assert.equal(/[\u3400-\u9fff]/u.test(entry.message),false);
  }
});
