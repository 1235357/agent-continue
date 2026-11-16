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
    '发送会覆盖草稿并移除待发送附件；CR/CRLF 会规范为 LF。可能错发或重复发送。继续前请检查会话；继续可能重发。',
    'Sending replaces drafts and removes pending attachments; CR/CRLF become LF. Wrong or duplicate sends are possible. Check the conversation before Resume; Resume may resend.'],
  ['send limit helper',
    '0 表示不限制发送次数；任务也可能自动暂停。未知回执不计入已确认次数。队列仅执行一遍、次数上限和停止标记均是可选条件。',
    '0 means no send limit; the task may also pause automatically. Unconfirmed results do not count as confirmed sends. Running the queue once, send limits, and stop markers are optional conditions.'],
  ['idle setting helper',
    '默认关闭：到点后打断正在进行的回复并发送提示词。开启后才等待 Agent 空闲；发送前会替换未发送文字并移除待发送附件。',
    'Off by default: interrupt the current reply and send when due. Enable to wait for the agent to become idle; unsent text is replaced and pending attachments are removed before sending.'],
  ['waiting help',
    '默认到点打断并发送；只有开启“等待 Agent 空闲”才因 Agent 忙碌等待。发送前会替换未发送文字并移除待发送附件。输入框重绘、重新挂载或发送按钮暂不可用时，任务可在原绑定会话中继续准备和检查；仅在明确未提交时自动重试发送，不会改向其他会话发送；无法确认原会话时不发送。手动暂停优先，但无法撤回已提交的操作。发送轮终态未知时，任务会自动暂停，无论是否记录到提交；未知不代表服务端未接受。回复检查结果未知时会继续等待，不属于发送轮未知。请先检查目标会话，再决定是否继续原任务；继续可能重发并造成重复。',
    'By default, interrupt and send when due; wait for a busy agent only when waiting for idle is enabled. Unsent text is replaced and pending attachments are removed before sending. After a composer redraw or remount, or while the send button is unavailable, the task can continue preparation and checks in the original bound conversation; it automatically retries sending only when the submission is explicitly known not to have been dispatched. It never sends to another conversation and does not send if the original conversation cannot be verified. Manual Pause takes precedence but cannot retract an already dispatched action. When a send round ends with an unknown result, the task pauses automatically, whether or not a dispatch was recorded; unknown does not mean the server rejected it. An unknown reply-check result continues waiting and is not an unknown send round. Check the target conversation before deciding whether to Resume; Resume may resend and cause duplicates.'],
  ['in-flight MAIN fence help',
    '暂停时，在途 MAIN 页面提交可能保留许可截止时间作为栅栏，暂时阻止开始或继续任务；清空数据后也可能保留。截止时间到期不证明消息未发送，也无法撤回已发出的操作；请先检查会话。',
    'On Pause, an in-flight MAIN page submission may retain its permit deadline as a fence that temporarily blocks starting or resuming a task; it may remain after clearing data. Expiry does not prove the message was not sent or retract an already issued operation; check the conversation first.'],
  ['clear data warning',
    '这会暂停任务，并删除本扩展保存的提示词、模板、设置和日志。未确认提交的许可截止时间可能保留；到期不证明消息未发送。不会删除聊天网站中的消息。',
    'This pauses the task and deletes prompts, templates, settings, and logs saved by this extension. An unconfirmed submission permit deadline may remain; its expiry does not prove the message was not sent. Messages on chat websites are not deleted.'],
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
