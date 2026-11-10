import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyStaticTranslations, createTranslator, initializeLanguage, getLanguage, setLanguage} from '../i18n.js';
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
for(const [label, chinese, english] of [
  ['composer priority notice',
    '定时发送会替换未发送文字，并在发送配置的提示词前移除待发送附件。',
    'Scheduled sends replace unsent text and remove pending attachments before sending the configured prompt.'],
  ['idle setting helper',
    '默认关闭：到点后打断正在进行的回复并发送提示词。开启后才等待 Agent 空闲；发送前会替换未发送文字并移除待发送附件。',
    'Off by default: interrupt the current reply and send when due. Enable to wait for the agent to become idle; unsent text is replaced and pending attachments are removed before sending.'],
  ['waiting help',
    '默认到点打断并发送；只有开启“等待 Agent 空闲”才因 Agent 忙碌等待。发送前会替换未发送文字并移除待发送附件。输入框重绘、重新挂载或发送按钮暂不可用时，任务会在原绑定会话中持续重试，不会改向其他会话发送；无法确认原会话时不发送。手动暂停优先，但无法撤回已提交的操作。无法确认发送结果时会记录“未知”，不保证服务端已接受；可先暂停并核对会话。',
    'By default, interrupt and send when due; wait for a busy agent only when waiting for idle is enabled. Unsent text is replaced and pending attachments are removed before sending. After a composer redraw or remount, or while the send button is unavailable, the task keeps retrying in the original bound conversation. It never sends to another conversation and does not send if the original conversation cannot be verified. Manual Pause takes precedence but cannot retract an already dispatched action. An unconfirmed result is recorded as unknown; server acceptance is not guaranteed. Pause and check the conversation as needed.'],
  ['restart help',
    '浏览器和电脑必须运行，并保持目标会话已登录。浏览器重启后的恢复取决于原目标页可用性，且不会覆盖手动暂停。',
    'The browser and computer must remain running, and the target conversation must stay signed in. Recovery after a browser restart depends on the original target page being available and does not override manual Pause.'],
]) {
  test(`scheduled-send ${label} renders English without Chinese fallback and preserves Chinese`, async()=>{
    const source=fs.readFileSync(new URL('../popup.html',import.meta.url),'utf8');
    assert.ok(source.includes('>'+chinese+'<'),`Exact popup copy missing: ${label}`);
    const node={textContent:chinese,isConnected:true,parentElement:{closest:()=>null}};
    const nodes=[node].values();
    const root={
      ownerDocument:{createTreeWalker:()=>({nextNode:()=>nodes.next().value??null})},
      querySelectorAll:()=>[],getAttribute:()=>null,
    };
    const previousChrome=globalThis.chrome;
    const previousLanguage=getLanguage();
    globalThis.chrome={storage:{local:{async set(){}}}};
    try {
      await setLanguage('en');
      const render=applyStaticTranslations(root,html);
      assert.doesNotMatch(node.textContent,/[\u3400-\u9fff]/u,`Visible Chinese fallback: ${label}`);
      assert.equal(node.textContent,english);
      await setLanguage('zh_CN');
      render();
      assert.equal(node.textContent,chinese);
      await setLanguage('en');
      render();
      assert.equal(node.textContent,english);
    } finally {
      await setLanguage(previousLanguage);
      globalThis.chrome=previousChrome;
    }
  });
}

test('public metadata stays English and within Chrome summary limits',()=>{
  for(const locale of ['en','zh_CN']) {
    const messages=JSON.parse(fs.readFileSync(new URL(`../_locales/${locale}/messages.json`,import.meta.url)));
    assert.ok(messages.extensionDescription.message.length<=132);
    for(const entry of Object.values(messages)) assert.equal(/[\u3400-\u9fff]/u.test(entry.message),false);
  }
});
