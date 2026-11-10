import { createTranslator, initializeLanguage } from './i18n.js';
import runtimeCatalog from './i18n-runtime.js';

const t = createTranslator(runtimeCatalog);

import { DEFAULT_CONFIG, DELIVERY_BEHAVIOR_VERSION, normalizeUrl, validateTarget, readConfig, currentPrompt, inQuietHours } from './config.js';
import { pageAction, pageInvocationState, translatePageResult } from './adapter.js';
import { editorCommit } from './editor-commit.js';
import { BUNDLED_PROMPT } from './preset.js';
import { bindBrowserWake, BROWSER_DEVICE_MESSAGE } from './browser-wake.js';
import { bindAdministratorBrowser, ADMIN_BROWSER_MESSAGE, ADMIN_BROWSER_PAUSE, ADMIN_BROWSER_PAUSE_RECONCILE,
  ADMIN_BROWSER_PAUSE_STATUS, ADMIN_BROWSER_RESTORE } from './admin-browser.js';
import { bindAdministratorControls, ADMIN_CONTROL_MESSAGES } from './admin-control.js';
import { bindInstallationPause } from './admin-installation-pause.js';
import { bindSetupInstallation, SETUP_MESSAGES } from './setup-controller.js';
import { bindCurrentAccountSetup } from './current-account-setup.js';

let setupInstallation, currentAccountSetup;
const browserWake = bindBrowserWake(chrome, {
  onPauseIntent: () => {
    currentAccountSetup?.cancelPendingStartup();
    setupInstallation?.cancelAll();
  },
});
const administratorControls = bindAdministratorControls(chrome, {
  prepareObserver: admit => administratorBrowser?.prepareSetupObserver(admit) ?? false,
});
const installationPause = bindInstallationPause(chrome);
const administratorBrowser = bindAdministratorBrowser(chrome, {
  installationPause,
  onPauseIntent: () => {
    administratorControls?.cancelPendingStartup();
    currentAccountSetup?.cancelPendingStartup();
    setupInstallation?.cancelAll();
  },
});
currentAccountSetup = bindCurrentAccountSetup(chrome, {
  wake: browserWake,
  captureGlobalPermit: () => administratorControls?.captureStartupPermit() ?? (() => false),
});
setupInstallation = bindSetupInstallation(chrome, {
  controls: administratorControls,
  currentAccount: currentAccountSetup,
  checkStopSupport: digest => installationPause?.available(digest) ?? false,
  prepareObserver: admit => administratorBrowser?.prepareSetupObserver(admit) ?? false,
});

const ALARM_NAME = 'agent-continue-heartbeat';
const RETRY_MS = 60_000;
// Finite MAIN-command admission permits; never a total send-wait deadline.
const EXECUTION_MS = 20_000;
const RESULT_STATUSES = new Set(['ready', 'sent', 'busy', 'draft', 'done', 'blocked', 'cancelled', 'unknown', 'error']);
const pendingPageResults = new Map();
let stateQueue = Promise.resolve();
let intentVersion = 0;
let pendingActivationVersion = null;

function transact(callback) {
  const work = stateQueue.then(callback, callback);
  stateQueue = work.catch(() => undefined);
  return work;
}
const token = () => crypto.randomUUID();
// Exceptions may contain browser/page data. Only our fixed messages enter logs.
const errorMessage = error => error?.safeMessage || t('操作未完成，请检查目标页面和扩展权限后再试。');
function fail(message) { const error = new Error(message); error.safeMessage = message; return error; }

// Older builds stored rendered status text, sometimes without a diagnostic code.
const retiredDraftNotice = message => typeof message === 'string' && [
  'Content changed after filling; the draft was preserved',
  'Content changed after refilling; the draft was preserved',
  'The composer content changed and was preserved.',
  'The composer changed before interruption; its content was preserved.',
  'The composer contains a draft or attachments; skipping this cycle.',
  'A new draft or attachments were detected; skipping this cycle.',
  'Another draft or attachments were detected after interruption and preserved.',
  '填写后检测到内容变化，已保留草稿',
  '重新填写后检测到内容变化，已保留草稿',
  '输入框内容发生变化，已保留当前内容。',
  '打断前输入框发生变化，已保留当前内容。',
  '输入框已有草稿或附件，本次跳过。',
  '检测到新草稿或附件，本次跳过。',
  '打断后检测到其他草稿或附件，已保留。',
].some(prefix => message.startsWith(prefix));

async function getJob() { return (await chrome.storage.session.get('job')).job || null; }
async function getConfig() {
  try { return readConfig((await chrome.storage.local.get('config')).config, { allowEmpty: true }); }
  catch { return { ...DEFAULT_CONFIG }; }
}
async function setJob(job) {
  if (job) {
    // Session state is the cancellation authority. Persistent state is only a
    // recovery plan; tab IDs from a previous browser session are never trusted.
    await chrome.storage.session.set({ job });
    try { await chrome.storage.local.set({ resumeJob: job }); }
    catch (error) {
      if (job.enabled) throw error;
      // If a paused snapshot cannot be saved, discard stale running recovery.
      // The complete paused task remains available in this browser session.
      await chrome.storage.local.remove('resumeJob');
      if ((await chrome.storage.local.get('resumeJob')).resumeJob) throw error;
    }
  } else {
    await chrome.storage.session.remove('job');
    await chrome.storage.local.remove('resumeJob');
  }
}
async function logEvent(event, message, diagnostic = null) {
  const stored = (await chrome.storage.local.get('logs')).logs;
  const logs = Array.isArray(stored) ? stored.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry)
    && Number.isFinite(entry.at) && typeof entry.event === 'string' && entry.event.length > 0 && typeof entry.message === 'string') : [];
  const codes = ['adapter-result', 'execution-exception', 'execution-timeout', 'no-valid-result', 'existing-draft', 'composer-changed', 'timing-probe', 'send-not-ready', 'commit-not-dispatched'];
  const detail = diagnostic && codes.includes(diagnostic.code)
    ? { diagnostic: { code: diagnostic.code, ...(Number.isFinite(diagnostic.durationMs)
      ? { durationMs: Math.max(0, Math.min(120000, diagnostic.durationMs)) } : {}) } } : {};
  if (detail.diagnostic) {
    if (['page', 'prepare', 'readiness', 'dispatch', 'receipt'].includes(diagnostic.stage)) detail.diagnostic.stage = diagnostic.stage;
    if (['none', 'execute-script', 'extension-message', 'page-readback'].includes(diagnostic.resultChannel)) detail.diagnostic.resultChannel = diagnostic.resultChannel;
    if (Number.isSafeInteger(diagnostic.leaseRenewals) && diagnostic.leaseRenewals >= 0) detail.diagnostic.leaseRenewals = Math.min(1000000, diagnostic.leaseRenewals);
  }
  if (detail.diagnostic?.code === 'timing-probe') {
    if (['authorization', 'page-timers'].includes(diagnostic.kind)) detail.diagnostic.kind = diagnostic.kind;
    if (['result', 'invalid-result', 'api-rejected', 'watchdog-expired'].includes(diagnostic.status)) detail.diagnostic.status = diagnostic.status;
    if (typeof diagnostic.firstMs === 'number' && Number.isFinite(diagnostic.firstMs)) {
      detail.diagnostic.firstMs = Math.max(0, Math.min(120000, diagnostic.firstMs));
    }
    for (const key of ['hidden', 'ok', 'allowed']) {
      if (typeof diagnostic[key] === 'boolean') detail.diagnostic[key] = diagnostic[key];
    }
  }
  await chrome.storage.local.set({ logs: [...logs.slice(-199), { at: Date.now(), event, message, ...detail }] });
}
async function updateBadge(job) {
  try {
    await chrome.action.setBadgeText({ text: !job ? '' : !job.enabled ? 'Ⅱ' : job.phase === 'sending' ? '…' : job.needsAttention ? '!' : 'ON' });
    await chrome.action.setBadgeBackgroundColor({ color: !job?.enabled ? '#64748B' : job.needsAttention ? '#B45F2A' : '#156C52' });
    await chrome.action.setTitle({ title: job ? `Agent Continue — ${job.statusText}` : t('Agent Continue — 选择 dot 或会话后开始') });
  } catch { /* Badge errors cannot authorize a send. */ }
}
async function syncAlarm(job) {
  if (!job?.enabled) { await chrome.alarms.clear(ALARM_NAME); return; }
  const periodic = alarm => Number.isFinite(alarm?.periodInMinutes) && alarm.periodInMinutes > 0;
  if (!periodic(await chrome.alarms.get(ALARM_NAME))) {
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: 1 });
    if (!periodic(await chrome.alarms.get(ALARM_NAME))) throw fail(t('无法创建后台计时器。'));
  }
}
async function syncPower(job) {
  if (!chrome.power) return false;
  try {
    if (job?.enabled && job.keepAwake && await chrome.permissions.contains({ permissions: ['power'] })) {
      chrome.power.requestKeepAwake('system');
      return true;
    }
    chrome.power.releaseKeepAwake();
  } catch { /* Optional permission may be revoked during a task. */ }
  return false;
}
async function protectFromDiscard(tab, enabled) {
  const original = typeof tab.autoDiscardable === 'boolean' ? tab.autoDiscardable : null;
  if (!enabled || original !== true) return { originalAutoDiscardable: original, autoDiscardableChanged: false, discardProtection: !enabled ? 'off' : original === false ? 'active' : 'unavailable' };
  try {
    const updated = await chrome.tabs.update(tab.id, { autoDiscardable: false });
    return { originalAutoDiscardable: original, autoDiscardableChanged: true, discardProtection: updated?.autoDiscardable === false ? 'active' : 'unavailable' };
  } catch { return { originalAutoDiscardable: original, autoDiscardableChanged: false, discardProtection: 'unavailable' }; }
}
async function restoreDiscard(job) {
  if (!job?.autoDiscardableChanged || typeof job.originalAutoDiscardable !== 'boolean') return true;
  try {
    const tab = await chrome.tabs.update(job.tabId, { autoDiscardable: job.originalAutoDiscardable });
    return tab?.autoDiscardable === job.originalAutoDiscardable;
  } catch { return false; }
}
async function pauseLocked(job, message, event = 'paused') {
  if (!job) { await syncAlarm(null); await syncPower(null); await updateBadge(null); return null; }
  const paused = { ...job, enabled: false, runId: token(), runDeadline: null, phase: 'idle', nextAt: null, statusText: message, discardProtection: 'paused', systemAwake: false, needsAttention: false };
  await setJob(paused); // revoke before housekeeping
  for (const pending of pendingPageResults.values()) {
    if (pending.runId !== job.runId) continue;
    let timeout;
    let revoked = false;
    try {
      const reply = await Promise.race([
        chrome.tabs.sendMessage(pending.tabId, { type: 'CANCEL_RUN', runId: pending.runId, resultToken: pending.resultToken },
          pending.documentId ? { documentId: pending.documentId } : { frameId: 0 }),
        new Promise(resolve => { timeout = setTimeout(() => resolve(null), 3000); }),
      ]);
      revoked = reply?.revoked === true && reply.runId === pending.runId && reply.resultToken === pending.resultToken;
    } catch { /* No acknowledgement is not proof of cancellation in the page. */ }
    finally { clearTimeout(timeout); }
    if (!revoked) {
      paused.submissionFenceUntil = job.runDeadline;
      const storedFence = (await chrome.storage.session.get('submissionFenceUntil')).submissionFenceUntil;
      await chrome.storage.session.set({ submissionFenceUntil: Math.max(Number.isFinite(storedFence) ? storedFence : 0, job.runDeadline) });
      paused.statusText = t('已暂停后续发送；正在进行的页面提交尚未确认停止。');
      await setJob(paused);
    }
    pending.resolve({ status: 'cancelled' });
  }
  try { await syncAlarm(paused); } catch { /* A stale alarm cannot authorize a paused task. */ }
  await syncPower(paused);
  if (await restoreDiscard(job) && paused.autoDiscardableChanged) {
    paused.autoDiscardableChanged = false;
    await setJob(paused);
  }
  try { await logEvent(event, message); } catch { /* Diagnostics cannot prevent Pause. */ }
  await updateBadge(paused);
  return paused;
}
async function pause(message = t('已手动暂停；后续定时发送已停止。')) {
  return transact(async () => ({ ok: true, job: await pauseLocked(await getJob(), message) }));
}
function assertIntent(version) { if (version !== intentVersion) throw fail(t('此操作已被较新的开始或暂停操作取消。')); }
function assertSupportedTab(tab, expectedUrl = null) {
  if (!tab || !Number.isInteger(tab.id) || !validateTarget(tab.url)) throw fail(t('请选择 chatgpt.com 的 Your dot 页面或已有会话；首页与共享页面不支持。'));
  if (expectedUrl && normalizeUrl(tab.url) !== expectedUrl) throw fail(t('目标标签页已切换到其他会话；原任务会等待原地址重新打开。'));
}
async function executePage(args, tabId, deadline = Date.now() + EXECUTION_MS) {
  let timer;
  let recoveryTimer;
  let watchdogExpired = false;
  let missingResult = false;
  let rejectedResult = false;
  let settled = false;
  let waitingReported = false;
  let resultChannel = 'none';
  let pending;
  const resultToken = args.mode === 'send' ? token() : null;
  let redundantResult;
  if (resultToken) {
    args = { ...args, resultToken };
    redundantResult = new Promise(resolve => {
      pending = { runId: args.runId, resultToken, tabId, url: args.expectedUrl, stage: 'page', leaseRenewals: 0,
        resolve: value => { if (!settled && resultChannel === 'none') resultChannel = 'extension-message'; resolve(value); } };
      pendingPageResults.set(resultToken, pending);
    });
  }
  const executionDiagnostic = () => pending ? { stage: pending.stage, resultChannel, leaseRenewals: pending.leaseRenewals } : {};
  try {
    const executionTarget = () => ({ tabId, ...(pending?.documentId ? { documentIds: [pending.documentId] } : {}) });
    const runScript = async (world) => {
      const res = await chrome.scripting.executeScript({
        target: executionTarget(),
        world,
        func: pageAction,
        args: [args]
      });
      return res?.find(frame => frame.frameId === 0)?.result ?? res?.[0]?.result;
    };

    const acceptExecutionResult = value => {
      if (resultToken && (!value || !RESULT_STATUSES.has(value.status))) {
        missingResult = true;
        return false;
      }
      if (resultChannel === 'none') resultChannel = 'execute-script';
      return true;
    };
    const runner = async () => {
      // Keep run authorization in the extension context; never replay a send in another world.
      let value;
      try { value = await runScript('ISOLATED'); }
      catch (error) {
        if (!resultToken) throw error;
        rejectedResult = true;
        return redundantResult;
      }
      if (!acceptExecutionResult(value)) {
        // A lost injection return must not discard the same invocation's receipt.
        return redundantResult;
      }
      return value;
    };

    if (pending) {
      let admissionOutstanding = false;
      const recoverAdmission = async () => {
        try {
          const current = await transact(getJob);
          if (settled || !current?.enabled || current.phase !== 'sending' || current.runId !== args.runId
            || current.tabId !== tabId || current.url !== args.expectedUrl) return;
          // Diagnose replacement using the current top frame, read-only. Every
          // actual page admission and MAIN mutation stays on its pinned document.
          const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED',
            func: pageInvocationState, args: [{ runId: args.runId, resultToken }] });
          const frame = frames?.find(item => item.frameId === 0);
          if (settled || !frame || !['absent', 'running', 'settled'].includes(frame.result?.state)) return;
          const latest = await transact(getJob);
          if (settled || !latest?.enabled || latest.phase !== 'sending' || latest.runId !== args.runId
            || latest.tabId !== tabId || latest.url !== args.expectedUrl) return;
          if (pending.documentId && frame.documentId && pending.documentId !== frame.documentId) {
            const beforeDispatch = ['page', 'prepare', 'readiness'].includes(pending.stage);
            pending.resolve(beforeDispatch
              ? { status: 'blocked', message: t('\u9875\u9762\u5df2\u53d8\u5316\u3002'), diagnosticCode: 'commit-not-dispatched' }
              : { status: 'unknown', message: t('\u9875\u9762\u672a\u8fd4\u56de\u53ef\u786e\u8ba4\u7684\u7ed3\u679c\u3002') });
            return;
          }
          pending.documentId ??= frame.documentId;
          if (frame.result.state === 'settled' && RESULT_STATUSES.has(frame.result.result?.status)) {
            if (resultChannel === 'none') resultChannel = 'page-readback';
            pending.resolve(frame.result.result);
          } else if (frame.result.state === 'absent' && !admissionOutstanding) {
            // The same token is atomically deduplicated inside pageAction. Even
            // an original queued request arriving later can only join it.
            admissionOutstanding = true;
            runScript('ISOLATED').then(value => {
              if (!settled && acceptExecutionResult(value)) pending.resolve(value);
            }, () => { rejectedResult = true; }).finally(() => { admissionOutstanding = false; });
          }
        } catch { /* Reobserve the same invocation when the renderer is reachable. */ }
        finally {
          if (!settled) recoveryTimer = setTimeout(recoverAdmission, 2000);
        }
      };
      recoveryTimer = setTimeout(recoverAdmission, 2000);
    }

    const result = await Promise.race([
      runner(),
      ...(redundantResult ? [redundantResult] : []),
      new Promise((_, reject) => {
        const inspectLease = async () => {
          if (resultToken) {
            const job = await transact(async () => {
              const current = await getJob();
              if (!current?.enabled || current.phase !== 'sending' || current.runId !== args.runId
                || current.tabId !== tabId || current.url !== args.expectedUrl) return null;
              // Waiting owns this same live invocation, not another submit. A
              // delayed renderer/result transport is not a send time limit.
              const renewed = { ...current, runDeadline: Date.now() + EXECUTION_MS };
              if (!waitingReported) {
                renewed.statusText = t('仍在等待目标页面或发送回执；无固定等待时限，可随时暂停。');
                await logEvent('busy', t('仍在等待目标页面或发送回执；无固定等待时限，可随时暂停。'),
                  { code: rejectedResult ? 'execution-exception' : missingResult ? 'no-valid-result' : 'send-not-ready',
                    durationMs: Date.now() - current.lastRunAt, ...executionDiagnostic() });
                waitingReported = true;
              }
              await setJob(renewed);
              pending.leaseRenewals++;
              return renewed;
            });
            if (settled) return;
            if (job?.enabled && job.phase === 'sending' && job.runId === args.runId
              && job.tabId === tabId && job.url === args.expectedUrl && job.runDeadline > Date.now()) {
              timer = setTimeout(() => { inspectLease().catch(reject); }, job.runDeadline - Date.now());
              return;
            }
          }
          watchdogExpired = true;
          reject(fail(t('页面操作超时，本周期结果未确认。')));
        };
        timer = setTimeout(() => { inspectLease().catch(reject); }, Math.max(1, deadline - Date.now()));
      }),
    ]);
    const value = translatePageResult(result);
    if (!value || !RESULT_STATUSES.has(value.status)
      || (['draft', 'blocked'].includes(value.status) && (value.diagnosticCode === 'composer-changed' || retiredDraftNotice(value.message)))) {
      return { status: 'unknown', message: t('页面未返回可确认的结果。'), diagnosticCode: 'no-valid-result', executionDiagnostic: executionDiagnostic() };
    }
    // Return only bounded adapter status fields.
    const diagnosticCode = (value.status === 'draft' && value.diagnosticCode === 'existing-draft')
      || (value.status === 'busy' && value.diagnosticCode === 'send-not-ready')
      || (value.status === 'blocked' && value.diagnosticCode === 'commit-not-dispatched') ? value.diagnosticCode : null;
    return { status: value.status, message: String(value.message || '').slice(0, 300), identity: typeof value.identity === 'string' ? value.identity.slice(0, 500) : null, assistantToken: typeof value.assistantToken === 'string' ? value.assistantToken.slice(0, 500) : null, assistantCount: Number(value.assistantCount) || 0, diagnosticCode, executionDiagnostic: executionDiagnostic() };
  } catch (error) {
    if (watchdogExpired) return { status: 'unknown', message: t('页面操作超时，本周期结果未确认。'), diagnosticCode: rejectedResult ? 'execution-exception' : missingResult ? 'no-valid-result' : 'execution-timeout', executionDiagnostic: executionDiagnostic() };
    throw error;
  } finally { settled = true; clearTimeout(timer); clearTimeout(recoveryTimer); if (resultToken) pendingPageResults.delete(resultToken); }
}
async function receivePageResult(message, sender) {
  const pending = pendingPageResults.get(message.resultToken);
  if (!pending || message.runId !== pending.runId || sender.id !== chrome.runtime.id
    || sender.tab?.id !== pending.tabId || sender.frameId !== 0
    || (pending.documentId && sender.documentId !== pending.documentId)
    || normalizeUrl(sender.url || sender.tab?.url) !== pending.url
    || !message.result || !RESULT_STATUSES.has(message.result.status)) return { ok: false };
  return transact(async () => {
    const job = await getJob();
    if (!job?.enabled || job.phase !== 'sending' || job.runId !== pending.runId
      || job.tabId !== pending.tabId || job.url !== pending.url) return { ok: false };
    pending.resolve(message.result);
    return { ok: true };
  });
}
async function probe(tab, config, targetIdentity = null) {
  assertSupportedTab(tab);
  if (tab.discarded || tab.frozen) return { status: 'busy', message: t('目标标签页已休眠或冻结，等待页面恢复。') };
  return executePage({ mode: 'check', expectedUrl: normalizeUrl(tab.url), prompt: '', runId: null, stopMarkers: config.stopMarkers ?? [], waitForIdle: config.waitForIdle ?? false, sendMethod: config.sendMethod ?? 'auto', targetIdentity }, tab.id);
}
async function currentTab(tabId) {
  if (Number.isInteger(tabId)) return chrome.tabs.get(tabId);
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}
async function availableTargets() {
  try { return (await chrome.tabs.query({ url: 'https://chatgpt.com/*' })).filter(tab => validateTarget(tab.url)).map(tab => ({ id: tab.id, title: tab.title || 'ChatGPT / dot', url: tab.url })); }
  catch { return []; }
}
async function checkPage(tabId) {
  const tab = await currentTab(tabId);
  return { ok: true, result: await probe(tab, await getConfig()) };
}
async function timingDiagnostics() {
  const job = await transact(getJob);
  if (!job || job.enabled) throw fail(t('请先暂停已绑定的任务，再运行不发送诊断。'));
  let tab;
  if (Number.isInteger(job.tabId)) {
    try { tab = await chrome.tabs.get(job.tabId); } catch { /* Resolve the saved URL below. */ }
  }
  if (!tab || normalizeUrl(tab.url) !== job.url) {
    const matches = (await chrome.tabs.query({ url: 'https://chatgpt.com/*' }))
      .filter(item => normalizeUrl(item.url) === job.url);
    if (matches.length !== 1) throw fail(t('请只打开一个原绑定页面副本，再运行诊断。'));
    [tab] = matches;
  }
  assertSupportedTab(tab, job.url);
  const observations = [];
  for (const kind of ['authorization', 'page-timers']) {
    let timer;
    let watchdogExpired = false;
    try {
      const frames = await Promise.race([
        chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', args: [kind],
          func: async kind => {
            const started = Date.now();
            if (kind === 'authorization') {
              const reply = await chrome.runtime.sendMessage({ type: 'CHECK_RUN', runId: 'readonly-timing-probe' });
              return { elapsedMs: Date.now() - started, ok: reply?.ok === true, allowed: reply?.allowed === true };
            }
            await new Promise(resolve => setTimeout(resolve, 60));
            const firstMs = Date.now() - started;
            await new Promise(resolve => setTimeout(resolve, 180));
            return { firstMs, elapsedMs: Date.now() - started, hidden: document.visibilityState === 'hidden' };
          } }),
        new Promise((_, reject) => { timer = setTimeout(() => {
          watchdogExpired = true;
          reject(new Error('diagnostic-timeout'));
        }, 4000); }),
      ]);
      const value = frames?.find(frame => frame.frameId === 0)?.result;
      if (!value || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0) {
        observations.push({ kind, status: 'invalid-result' });
      } else if (kind === 'authorization') {
        observations.push({ kind, status: 'result', elapsedMs: Math.min(120000, Math.round(value.elapsedMs)),
          ok: value.ok === true, allowed: value.allowed === true });
      } else if (Number.isFinite(value.firstMs) && value.firstMs >= 0) {
        observations.push({ kind, status: 'result', firstMs: Math.min(120000, Math.round(value.firstMs)),
          elapsedMs: Math.min(120000, Math.round(value.elapsedMs)), hidden: value.hidden === true });
      } else observations.push({ kind, status: 'invalid-result' });
    } catch {
      observations.push({ kind, status: watchdogExpired ? 'watchdog-expired' : 'api-rejected' });
    } finally { clearTimeout(timer); }
  }
  await transact(async () => {
    for (const item of observations) {
      await logEvent('timing-diagnostics', t('只读发送计时诊断已完成。'), {
        code: 'timing-probe', kind: item.kind, status: item.status,
        durationMs: item.elapsedMs, firstMs: item.firstMs,
        hidden: item.hidden, ok: item.ok, allowed: item.allowed,
      });
    }
  });
  return { ok: true, observations };
}
function validatedConfig(input) {
  try { return readConfig(input); } catch (error) { throw fail(error.message); }
}
async function assertSubmissionReleased(job) {
  const storedFence = (await chrome.storage.session.get('submissionFenceUntil')).submissionFenceUntil;
  if ([storedFence, job?.submissionFenceUntil].some(value => Number.isFinite(value) && Date.now() < value)) {
    throw fail(t('页面提交停止尚未确认；等待当前提交许可到期后再继续。'));
  }
}
async function start(configInput, version, tabId) {
  const config = validatedConfig(configInput || await getConfig());
  await transact(async () => {
    assertIntent(version);
    const old = await getJob();
    await assertSubmissionReleased(old);
    if (old?.enabled) await assertSubmissionReleased(await pauseLocked(old, t('正在绑定新的目标，原任务已替换。'), 'replaced'));
  });
  const tab = await currentTab(tabId);
  assertSupportedTab(tab);
  const result = await probe(tab, config);
  if (!['ready', 'busy', 'draft'].includes(result.status)) throw fail(result.message || t('页面暂时无法启用自动发送。'));
  if (new URL(tab.url).pathname.startsWith('/dots/') && !result.identity) throw fail(t('请先打开 dot 页面并等待会话历史加载，再绑定任务。'));
  const response = await transact(async () => {
    assertIntent(version);
    const latestTab = await chrome.tabs.get(tab.id);
    assertSupportedTab(latestTab, normalizeUrl(tab.url));
    const protection = await protectFromDiscard(latestTab, config.preventDiscard);
    const now = Date.now();
    const job = { ...config, id: token(), runId: token(), enabled: true, tabId: latestTab.id, url: normalizeUrl(latestTab.url), title: latestTab.title || 'ChatGPT / dot', targetIdentity: result.identity, sentCount: 0, unknownCount: 0, queueIndex: 0, nextAt: now + (config.startImmediately ? 0 : config.intervalMinutes * 60_000), lastRunAt: null, runDeadline: null, phase: 'idle', awaitingReply: false, assistantToken: null, assistantCount: 0, needsAttention: false, statusText: config.startImmediately ? t('已开始，即将进行首次后台检查。') : t`持续运行中；约 ${config.intervalMinutes} 分钟后首次检查。`, ...protection };
    job.systemAwake = await syncPower(job);
    await chrome.storage.local.set({ config });
    await setJob(job);
    try { await syncAlarm(job); } catch { await pauseLocked(job, t('后台计时器不可用，未启动任务。'), 'scheduler-error'); throw fail(t('无法创建后台计时器。')); }
    await logEvent('started', t`开始任务，间隔 ${config.intervalMinutes} 分钟，${config.maxSends ? t`上限 ${config.maxSends} 次` : t('不限次数')}。`);
    await updateBadge(job);
    return { ok: true, job };
  });
  if (config.startImmediately) return runRound(true, response.job.id);
  return response;
}
async function resume(version) {
  return transact(async () => {
    assertIntent(version);
    const current = await getJob();
    if (!current) throw fail(t('请先绑定 dot 或会话。'));
    await assertSubmissionReleased(current);
    if (current.maxSends > 0 && current.sentCount >= current.maxSends) throw fail(t('已达到所设上限；请开始新任务。'));
    if (current.mode === 'queue-once' && current.queueIndex >= current.queue.length) throw fail(t('队列已完成；请开始新任务。'));
    if (current.enabled) {
      // Repair the heartbeat without invalidating an in-flight page operation.
      try { await syncAlarm(current); await setJob(current); }
      catch {
        await pauseLocked(current, t('后台计时器不可用，未启动任务。'), 'scheduler-error');
        throw fail(t('无法创建后台计时器。'));
      }
      return { ok: true, job: current };
    }
    let protection = {};
    try {
      const tab = await chrome.tabs.get(current.tabId);
      if (normalizeUrl(tab.url) === current.url) {
        protection = await protectFromDiscard(tab, current.preventDiscard);
        if (current.autoDiscardableChanged && protection.originalAutoDiscardable === false) {
          protection.originalAutoDiscardable = current.originalAutoDiscardable;
          protection.autoDiscardableChanged = true;
        }
      }
    } catch { /* Wait for original page. */ }
    const job = { ...current, ...protection, enabled: true, runId: token(), runDeadline: null, phase: 'idle', nextAt: Date.now() + current.intervalMinutes * 60_000, needsAttention: false, statusText: t`已继续原任务；约 ${current.intervalMinutes} 分钟后检查。` };
    job.systemAwake = await syncPower(job);
    try { await setJob(job); await syncAlarm(job); }
    catch {
      await pauseLocked(job, t('后台计时器不可用，未启动任务。'), 'scheduler-error');
      throw fail(t('无法创建后台计时器。'));
    }
    await logEvent('resumed', t('已使用原提示词与原设置继续任务。'));
    await updateBadge(job);
    return { ok: true, job };
  });
}
async function checkRun(runId, sender, renew = true) {
  return transact(async () => {
    const job = await getJob();
    const now = Date.now();
    const pending = [...pendingPageResults.values()].find(item => item.runId === runId);
    const allowed = Boolean(job?.enabled && job.phase === 'sending' && job.runId === runId
      && (now < job.runDeadline || pending) && sender.tab?.id === job.tabId
      && sender.frameId === 0 && normalizeUrl(sender.url || sender.tab?.url) === job.url);
    if (!allowed) return { ok: true, allowed: false };
    if (pending?.documentId && sender.documentId !== pending.documentId) return { ok: true, allowed: false };
    if (pending && sender.documentId) pending.documentId ??= sender.documentId;
    if ((renew || (pending && now >= job.runDeadline)) && job.runDeadline - now <= EXECUTION_MS / 2) {
      job.runDeadline = now + EXECUTION_MS;
      await setJob(job);
      if (pending) pending.leaseRenewals++;
    }
    return { ok: true, allowed: true, runDeadline: job.runDeadline };
  });
}
async function waitRun(message, sender) {
  if (![50, 60, 150, 180].includes(message.delayMs)) return { ok: false, allowed: false };
  const before = await checkRun(message.runId, sender, message.renew !== false);
  if (!before.allowed) return before;
  // Never retain the state queue while sleeping: Pause and replacement win.
  await new Promise(resolve => setTimeout(resolve, message.delayMs));
  return checkRun(message.runId, sender, message.renew !== false);
}
async function commitRun(message, sender) {
  if (typeof message.receiptBoundaryToken !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(message.receiptBoundaryToken)) {
    return { ok: false, dispatched: false, code: 'not-dispatched', reason: 'commit-unavailable' };
  }
  if (!(await checkRun(message.runId, sender)).allowed) return { ok: false, code: 'cancelled' };
  const permit = await transact(async () => {
    const job = await getJob();
    if (!job?.enabled || job.phase !== 'sending' || job.runKind === 'reply-check'
      || job.runId !== message.runId || Date.now() >= job.runDeadline
      || sender.tab?.id !== job.tabId || sender.frameId !== 0
      || normalizeUrl(sender.url || sender.tab?.url) !== job.url) return null;
    if (job.editorCommitRunId === job.runId) return { duplicate: true };
    const version = intentVersion;
    // Persist before crossing worlds. An uncertain invocation is never replayed.
    await setJob({ ...job, editorCommitRunId: job.runId });
    return { tabId: job.tabId, documentId: sender.documentId, version, args: {
      expectedUrl: job.url, targetIdentity: job.targetIdentity,
      prompt: currentPrompt(job), sendMethod: job.sendMethod ?? 'auto', deadline: job.runDeadline,
      receiptBoundaryToken: message.receiptBoundaryToken,
    } };
  });
  if (!permit) return { ok: false, code: 'cancelled' };
  if (permit.duplicate) return { ok: false, code: 'unknown' };
  if (permit.version !== intentVersion) return { ok: false, code: 'cancelled' };
  try {
    const allowed = async () => {
      const checked = await checkRun(message.runId, sender);
      if (checked.allowed) permit.args.deadline = checked.runDeadline;
      return checked.allowed && permit.version === intentVersion;
    };
    let requireButton = false;
    let absentSendObserved = false;
    const invoke = async phase => {
      const pending = [...pendingPageResults.values()].find(item => item.runId === message.runId);
      if (pending) pending.stage = phase === 'observe' ? 'readiness' : phase === 'commit' ? 'dispatch' : 'prepare';
      const target = { tabId: permit.tabId, ...(permit.documentId ? { documentIds: [permit.documentId] } : {}) };
      while (await allowed()) {
        if (phase === 'commit' && pending) {
          let granted = false;
          try {
            const reply = await chrome.tabs.sendMessage(pending.tabId,
              { type: 'GRANT_RUN', runId: pending.runId, resultToken: pending.resultToken, runDeadline: permit.args.deadline },
              pending.documentId ? { documentId: pending.documentId } : { frameId: 0 });
            granted = reply?.granted === true && reply.runId === pending.runId
              && reply.resultToken === pending.resultToken && reply.runDeadline === permit.args.deadline;
          } catch { /* No MAIN submission was admitted; only this handshake may retry. */ }
          if (!granted) { await new Promise(resolve => setTimeout(resolve, 150)); continue; }
          if (!await allowed()) return { supported: true, dispatched: false, code: 'cancelled' };
        }
        let value;
        try {
          const frames = await chrome.scripting.executeScript({ target,
            world: 'MAIN', func: editorCommit, args: [{ ...permit.args, phase, requireButton }] });
          value = frames?.find(frame => frame.frameId === 0)?.result;
        } catch (error) {
          // Prepare/observe cannot submit. Losing their transport may retry the
          // same reservation; an uncertain commit must never be replayed.
          if (phase === 'commit') throw error;
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }
        if (value == null && phase !== 'commit') {
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }
        if (!(value?.dispatched === false && value.code === 'expired')) return value;
        // The finite IPC permit expired before execution, with explicit proof
        // that no submission occurred. Keep the same reservation and wait.
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      return { supported: true, dispatched: false, code: 'cancelled' };
    };
    const notDispatched = value => ({ ok: false, dispatched: false, code: 'not-dispatched',
      reason: ['waiting-send', 'send-unavailable', 'send-ambiguous', 'attachments', 'busy'].includes(value?.code)
        ? value.code : 'commit-unavailable' });
    if (!await allowed()) return { ok: false, code: 'cancelled' };
    const prepared = await invoke('prepare');
    if (!await allowed()) return { ok: false, code: 'cancelled' };
    // Only an explicit, non-mutating unsupported view permits the legacy path.
    if (prepared?.supported === false && prepared.dispatched === false && prepared.code === 'unsupported-view') {
      const pending = [...pendingPageResults.values()].find(item => item.runId === message.runId);
      if (pending) pending.stage = 'dispatch';
      return { ok: true, supported: false, dispatched: false };
    }
    if (prepared?.dispatched !== false) return { ok: false, code: 'unknown' };
    if (!prepared.supported || prepared.code !== 'prepared') return notDispatched(prepared);
    requireButton = prepared.hasSend === true;
    // The extension worker, not a throttled hidden-page timer, owns settling.
    // Waiting is read-only; the durable reservation still permits only one send.
    while (await allowed()) {
      const observation = await invoke('observe');
      if (!await allowed()) return { ok: false, code: 'cancelled' };
      if (observation?.dispatched !== false) return { ok: false, code: 'unknown' };
      requireButton ||= observation.hasSend === true;
      if (observation.supported && observation.code === 'ready') {
        // Give an initially absent Auto control one worker-owned render turn.
        // Once seen, its temporary removal must never enable keyboard fallback.
        if (permit.args.sendMethod === 'auto' && observation.hasSend === false
          && !requireButton && !absentSendObserved) {
          absentSendObserved = true;
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }
        const value = await invoke('commit');
        if (value?.supported === true && value.dispatched === true) {
          const pending = [...pendingPageResults.values()].find(item => item.runId === message.runId);
          if (pending) pending.stage = 'receipt';
          return { ok: true, supported: true, dispatched: true };
        }
        if (value?.dispatched !== false) return { ok: false, code: 'unknown' };
        // A final model correction may itself schedule a new framework render.
        // Only a proven no-dispatch wait may continue inside this reservation.
        if (value.code !== 'waiting-send') return notDispatched(value);
        requireButton = true;
      } else if (!observation.supported || observation.code !== 'waiting-send') {
        return notDispatched(observation);
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return { ok: false, dispatched: false, code: 'not-dispatched', reason: 'waiting-send' };
  } catch { return { ok: false, code: 'unknown' }; }
}
async function runStillCurrent(snapshot) {
  return transact(async () => { const job = await getJob(); return Boolean(job?.enabled && job.phase === 'sending' && job.id === snapshot.id && job.runId === snapshot.runId); });
}
async function resolveTarget(snapshot) {
  let tab;
  try { tab = await chrome.tabs.get(snapshot.tabId); } catch { /* Re-resolve by exact URL below. */ }
  const isDot = snapshot.url.includes('/dots/');
  if (!tab || normalizeUrl(tab.url) !== snapshot.url) {
    const allTabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    let matches = allTabs.filter(item => normalizeUrl(item.url) === snapshot.url);
    if (matches.length !== 1) return { status: 'busy', message: matches.length ? t('找到多个相同目标页，等待只保留一个或重新绑定。') : t('等待原目标页面重新打开；任务仍保持启用。') };
    tab = matches[0];
  }
  const nextUrl = normalizeUrl(tab.url);
  if (snapshot.tabId !== tab.id || (isDot && snapshot.url !== nextUrl)) {
    const changed = await transact(async () => {
      const current = await getJob();
      if (!current?.enabled || current.runId !== snapshot.runId) return false;
      await restoreDiscard(current);
      const protection = await protectFromDiscard(tab, current.preventDiscard);
      Object.assign(snapshot, protection, { tabId: tab.id, url: nextUrl });
      await setJob({ ...current, ...protection, tabId: tab.id, url: nextUrl });
      return true;
    });
    if (!changed) return { status: 'cancelled', message: t('本次检查已取消。') };
  }
  return { tab };
}
async function finishRound(snapshot, result) {
  return transact(async () => {
    const current = await getJob();
    if (!current || current.id !== snapshot.id || current.runId !== snapshot.runId || !current.enabled || current.phase !== 'sending') return { ok: true, job: current };
    const now = Date.now();
    const job = { ...current, phase: 'idle', runKind: null, runDeadline: null, needsAttention: false };
    if (result.identity && !job.targetIdentity) job.targetIdentity = result.identity;
    if (result.status === 'sent') {
      job.sentCount += 1;
      if (job.mode !== 'repeat') job.queueIndex += 1;
      if (job.maxSends > 0 && job.sentCount >= job.maxSends) return { ok: true, job: await pauseLocked(job, t`已确认发送 ${job.sentCount} 次，达到你设置的上限。`, 'limit-reached') };
      if (job.mode === 'queue-once' && job.queueIndex >= job.queue.length) return { ok: true, job: await pauseLocked(job, t('队列已全部发送，按单次队列设置结束。'), 'queue-complete') };
      if (job.mode === 'queue-loop') job.queueIndex %= job.queue.length;
      job.awaitingReply = job.scheduleMode === 'after-reply';
      job.assistantToken = result.assistantToken;
      job.assistantCount = result.assistantCount;
      job.nextAt = now + (job.awaitingReply ? RETRY_MS : job.intervalMinutes * 60_000);
      job.statusText = job.awaitingReply ? t('已确认发送，等待 Agent 回复完成后开始下一间隔。') : t`已确认发送 ${job.sentCount} 次；约 ${job.intervalMinutes} 分钟后继续。`;
      await logEvent('sent', t('已在目标会话确认新消息。'));
    } else if (result.status === 'reply-complete') {
      job.awaitingReply = false;
      job.nextAt = now + job.intervalMinutes * 60_000;
      job.statusText = t`检测到新的回复已结束；约 ${job.intervalMinutes} 分钟后发送下一条。`;
      await logEvent('reply-complete', t('新的回复已结束，开始下一发送间隔。'));
    } else if (['busy', 'draft', 'blocked', 'error'].includes(result.status)) {
      job.nextAt = now + RETRY_MS;
      job.needsAttention = ['blocked', 'error'].includes(result.status);
      job.statusText = (result.message || t('页面暂不可用。')) + t(' 一分钟后再检查，任务仍保持启用。');
      if (current.lastResult !== result.status || (current.lastDiagnosticCode ?? null) !== (result.diagnosticCode ?? null)) {
        await logEvent(result.status, result.status === 'draft' ? t('保留附件，等待附件移除后再检查。') : result.status === 'busy' ? t('目标暂忙或未就绪，延后检查。') : t('页面暂不可用，保持启用并等待恢复。'),
          result.diagnosticCode ? { code: result.diagnosticCode, durationMs: now - snapshot.lastRunAt, ...result.executionDiagnostic } : null);
      }
    } else if (result.status === 'done') {
      return { ok: true, job: await pauseLocked(job, t('检测到你设置的停止标记，按设置暂停。'), 'marker-reached') };
    } else {
      // A missed/uncertain cycle is never replayed immediately. In repeat mode
      // the next scheduled cycle remains enabled, as explicitly requested.
      job.unknownCount = (job.unknownCount || 0) + 1;
      job.nextAt = now + job.intervalMinutes * 60_000;
      job.awaitingReply = false;
      job.needsAttention = true;
      job.statusText = t('本周期提交结果未确认；本周期不重试，完整间隔后继续。请检查页面记录。');
      await logEvent('unconfirmed', t('本周期结果未知；未立即重试，将在下一正常周期继续。'), { code: result.diagnosticCode || 'adapter-result', durationMs: now - snapshot.lastRunAt, ...result.executionDiagnostic });
    }
    job.lastResult = result.status;
    job.lastDiagnosticCode = result.diagnosticCode ?? null;
    await setJob(job);
    await syncAlarm(job);
    await updateBadge(job);
    return { ok: true, job };
  });
}
async function runRound(force = false, expectedJobId = null) {
  const claim = await transact(async () => {
    const job = await getJob();
    if (expectedJobId && job?.id !== expectedJobId) return { job, claimed: false };
    if (!job?.enabled) { await syncAlarm(job); if (force) throw fail(t('请先开始或继续任务。')); return { job, claimed: false }; }
    if (job.phase !== 'idle') { if (force) throw fail(t('本次检查尚未结束。')); return { job, claimed: false }; }
    if (!force && Date.now() < job.nextAt) return { job, claimed: false };
    if (inQuietHours(job)) {
      const waiting = { ...job, nextAt: Date.now() + RETRY_MS, statusText: t('处于你设置的静默时段；任务保持启用，时段结束后继续。') };
      await setJob(waiting); await updateBadge(waiting); return { job: waiting, claimed: false };
    }
    if (job.maxSends > 0 && job.sentCount >= job.maxSends) return { job: await pauseLocked(job, t('已达到你设置的发送上限。'), 'limit-reached'), claimed: false };
    const snapshot = { ...job, phase: 'sending', runKind: job.awaitingReply && !force ? 'reply-check' : 'send', runId: token(), runDeadline: Date.now() + EXECUTION_MS, lastRunAt: Date.now(), statusText: t('正在后台检查目标页面…') };
    await setJob(snapshot); await updateBadge(snapshot); return { job: snapshot, claimed: true };
  });
  if (!claim.claimed) return { ok: true, job: claim.job };
  const snapshot = claim.job;
  let result;
  try {
    const resolved = await resolveTarget(snapshot);
    if (!resolved.tab) result = resolved;
    else if (!await runStillCurrent(snapshot)) result = { status: 'cancelled' };
    else if (resolved.tab.frozen || resolved.tab.discarded) {
      try {
        await chrome.tabs.reload(resolved.tab.id);
        result = { status: 'busy', message: t('目标标签已休眠，正在自动唤醒刷新，一分钟后再检查。') };
      } catch {
        result = { status: 'busy', message: t('目标标签已冻结或休眠，请设置网站始终保持活动。') };
      }
    }
    else if (snapshot.awaitingReply && !force) {
      result = await probe(resolved.tab, { ...snapshot, waitForIdle: true }, snapshot.targetIdentity);
      if (['unknown', 'cancelled'].includes(result.status)) result = { status: 'error', message: t('回复检查暂不可用，继续等待新回复。') };
      const changed = result.assistantToken ? result.assistantToken !== snapshot.assistantToken : result.assistantCount > snapshot.assistantCount;
      if (result.status === 'ready') result = changed ? { status: 'reply-complete' } : { status: 'busy', message: t('等待新的 Agent 回复完成。') };
    } else {
      result = await executePage({ mode: 'send', expectedUrl: snapshot.url, prompt: currentPrompt(snapshot), runId: snapshot.runId, runDeadline: snapshot.runDeadline, stopMarkers: snapshot.stopMarkers ?? [], waitForIdle: snapshot.waitForIdle ?? false, extensionPriority: true, extensionClock: true, modelCommit: true, unlimitedReadiness: true, sendMethod: snapshot.sendMethod ?? 'auto', targetIdentity: snapshot.targetIdentity }, snapshot.tabId, snapshot.runDeadline);
    }
  } catch { result = snapshot.runKind === 'reply-check' ? { status: 'error', message: t('回复检查暂不可用，继续等待新回复。') } : { status: 'unknown', message: t('后台页面操作未确认。'), diagnosticCode: 'execution-exception' }; }
  return finishRound(snapshot, result);
}
async function initializePrivatePreset() {
  if (!BUNDLED_PROMPT) return;
  const imported = (await chrome.storage.local.get('privatePresetImported')).privatePresetImported;
  if (imported) return;
  try {
    const response = await fetch(chrome.runtime.getURL('private/prompt.txt'));
    if (!response.ok) return;
    const bytes = await response.arrayBuffer();
    let text;
    const view = new Uint8Array(bytes);
    if (view[0] === 0xff && view[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
    else if (view[0] === 0xfe && view[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
    else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('gb18030', { fatal: true }).decode(bytes); } }
    if (!text.trim()) return;
    // No telemetry, hashing, console output, preview or automatic submission.
    await chrome.storage.local.set({ config: { ...DEFAULT_CONFIG, prompt: text, promptSource: 'private-file' }, privatePresetImported: true });
  } catch { /* User can still import through the local file picker. */ }
}
async function initialize() {
  await initializeLanguage();
  try { await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }); } catch { /* Old browser. */ }
  await initializePrivatePreset();
  return transact(async () => {
    // Apply the requested interrupt default once to each legacy record. A
    // record-local version survives partial storage writes and never resets a
    // waiting preference explicitly selected in this or a later release.
    const migrateDelivery = value => value && value.deliveryBehaviorVersion !== DELIVERY_BEHAVIOR_VERSION
      ? { ...value, waitForIdle: false, deliveryBehaviorVersion: DELIVERY_BEHAVIOR_VERSION } : value;
    const retireDraftNotice = job => retiredDraftNotice(job?.statusText)
      ? { ...job, statusText: job.enabled ? t('任务仍在运行；下次发送使用配置的提示词。') : t('已手动暂停；后续定时发送已停止。') } : job;
    const storedConfig = (await chrome.storage.local.get('config')).config;
    const saved = (await chrome.storage.local.get('resumeJob')).resumeJob;
    const config = migrateDelivery(storedConfig);
    const recovery = retireDraftNotice(migrateDelivery(saved));
    const updates = {};
    if (config !== storedConfig) updates.config = config;
    if (recovery !== saved) updates.resumeJob = recovery;
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    let job = retireDraftNotice(migrateDelivery(await getJob()));
    if (!job) {
      if (recovery) {
        // Rebind only to an exact URL; additionally require the dot conversation
        // identity captured from visible message elements, when available.
        job = { ...recovery, tabId: null, runId: token(), runDeadline: null, autoDiscardableChanged: false, discardProtection: 'pending' };
        if (job.enabled && (!job.nextAt || job.nextAt <= Date.now())) {
          job.nextAt = Date.now() + 3000;
          job.statusText = t('已从重启中恢复；正在连接目标页面并继续推进…');
        }
        await logEvent('browser-restored', t('已恢复任务设置；等待唯一匹配的原目标页面。'));
      }
    }
    if (job?.phase === 'sending') {
      const readOnly = job.runKind === 'reply-check';
      job = { ...job, phase: 'idle', runKind: null, runId: token(), runDeadline: null, awaitingReply: readOnly ? job.awaitingReply : false, unknownCount: (job.unknownCount || 0) + (readOnly ? 0 : 1), nextAt: Date.now() + (readOnly ? RETRY_MS : job.intervalMinutes * 60_000), statusText: readOnly ? t('回复检查被中断；恢复后继续等待新回复。') : t('上周期执行被中断；完整间隔后继续，未立即重发。'), needsAttention: !readOnly };
      await logEvent('interrupted', readOnly ? t('只读回复检查被中断；仍等待新回复。') : t('后台执行被中断；延后到下一完整周期。'));
    }
    if (job) { job.systemAwake = await syncPower(job); await setJob(job); }
    else await syncPower(null);
    try { await syncAlarm(job); }
    catch {
      await pauseLocked(job, t('后台计时器不可用，未启动任务。'), 'scheduler-error');
      return;
    }
    await updateBadge(job);
  });
}
const initialized = initialize();
async function dispatch(message, sender, version) {
  if (SETUP_MESSAGES.includes(message?.type)) return setupInstallation?.handleMessage(message, sender) ?? null;
  if (message?.type === BROWSER_DEVICE_MESSAGE) return browserWake?.handleMessage(message, sender) ?? null;
  if (ADMIN_CONTROL_MESSAGES.includes(message?.type)) return administratorControls?.handleMessage(message, sender) ?? null;
  if (message?.type === ADMIN_BROWSER_MESSAGE || message?.type === ADMIN_BROWSER_PAUSE ||
      message?.type === ADMIN_BROWSER_PAUSE_STATUS || message?.type === ADMIN_BROWSER_PAUSE_RECONCILE) {
    return administratorBrowser?.handleMessage(message, sender) ?? null;
  }
  await initialized;
  if (!message || typeof message.type !== 'string') throw fail(t('无效请求。'));
  const ownExtensionPage = chrome.runtime.id && sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
  if (!['CHECK_RUN', 'WAIT_RUN', 'COMMIT_RUN', 'PAGE_RESULT'].includes(message.type) && sender.tab && !ownExtensionPage) throw fail(t('此操作只能从扩展控制面板发起。'));
  switch (message.type) {
    case 'GET_STATE': return transact(async () => ({ ok: true, job: await getJob(), config: await getConfig(), logs: (await chrome.storage.local.get('logs')).logs || [], availableTargets: await availableTargets() }));
    case 'CHECK_PAGE': return checkPage(message.tabId);
    case 'CHECK_TIMING': return timingDiagnostics();
    case 'CHECK_RUN': return checkRun(message.runId, sender);
    case 'WAIT_RUN': return waitRun(message, sender);
    case 'COMMIT_RUN': return commitRun(message, sender);
    case 'PAGE_RESULT': return receivePageResult(message, sender);
    case 'START': return start(message.config, version, message.tabId);
    case 'PAUSE': return pause();
    case 'RESUME': return resume(version);
    case 'SEND_NOW': return runRound(true);
    case 'CLEAR_LOGS': return transact(async () => { await chrome.storage.local.remove('logs'); return { ok: true }; });
    case 'CLEAR_DATA': return transact(async () => {
      await pauseLocked(await getJob(), t('已停止任务并清除本地数据。'));
      await setJob(null);
      // Administrator operation journals survive Clear Data; uncertainty is never cleared into permission to replay.
      for (const key of ['config', 'logs', 'templates', 'uiTheme', ADMIN_BROWSER_RESTORE]) await chrome.storage.local.remove(key);
      // Do not silently reimport a personal bundle after an explicit clear.
      if (BUNDLED_PROMPT) await chrome.storage.local.set({ privatePresetImported: true });
      return { ok: true };
    });
    default: throw fail(t('不支持的操作。'));
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let version = intentVersion;
  if (['START', 'PAUSE', 'RESUME', 'CLEAR_DATA'].includes(message?.type)) { version = ++intentVersion; pendingActivationVersion = ['START', 'RESUME'].includes(message.type) ? version : null; }
  dispatch(message, sender, version).then(sendResponse).catch(error => sendResponse({ ok: false, error: errorMessage(error) })).finally(() => {
    if (pendingActivationVersion === version && ['START', 'RESUME'].includes(message?.type)) pendingActivationVersion = null;
  });
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== ALARM_NAME) return;
  initialized.then(() => runRound(false)).catch(() => undefined);
});
chrome.tabs.onRemoved.addListener(tabId => {
  initialized.then(() => transact(async () => {
    const job = await getJob();
    if (job?.tabId !== tabId) return;
    const interrupted = job.phase === 'sending' && job.runKind !== 'reply-check';
    const waiting = { ...job, tabId: null, runId: token(), runDeadline: null, phase: 'idle', runKind: null, awaitingReply: interrupted ? false : job.awaitingReply, unknownCount: (job.unknownCount || 0) + (interrupted ? 1 : 0), nextAt: job.enabled ? Math.max(job.nextAt || 0, Date.now() + (interrupted ? job.intervalMinutes * 60_000 : RETRY_MS)) : null, autoDiscardableChanged: false, discardProtection: 'pending', statusText: interrupted ? t('发送期间目标关闭，结果未确认；完整间隔后检查原页面。') : t('目标标签已关闭；任务保持原启用状态，等待原页面重新打开。') };
    if (interrupted) await logEvent('interrupted', t('发送期间目标关闭，等待下一完整周期。'));
    await setJob(waiting); await updateBadge(waiting);
  })).catch(() => undefined);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  initialized.then(() => transact(async () => {
    const job = await getJob();
    if (!job?.enabled || job.tabId !== tabId) return;
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch { return; }
    if (normalizeUrl(tab.url) === job.url) return;
    const isDot = job.url.includes('/dots/');
    if (isDot && tab.url && tab.url.includes('/dots/')) {
      const updatedUrl = normalizeUrl(tab.url);
      await setJob({ ...job, url: updatedUrl });
      return;
    }
    await restoreDiscard(job);
    const interrupted = job.phase === 'sending' && job.runKind !== 'reply-check';
    const waiting = { ...job, tabId: null, runId: token(), runDeadline: null, phase: 'idle', runKind: null, awaitingReply: interrupted ? false : job.awaitingReply, unknownCount: (job.unknownCount || 0) + (interrupted ? 1 : 0), nextAt: Math.max(job.nextAt || 0, Date.now() + (interrupted ? job.intervalMinutes * 60_000 : RETRY_MS)), autoDiscardableChanged: false, discardProtection: 'pending', statusText: interrupted ? t('发送期间页面改变，结果未确认；完整间隔后检查原地址。') : t('原目标页面已离开；等待原地址重新打开，不会给其他会话发送。') };
    if (interrupted) await logEvent('interrupted', t('发送期间目标改变，等待下一完整周期。'));
    await setJob(waiting); await updateBadge(waiting);
  })).catch(() => undefined);
});
chrome.runtime.onStartup?.addListener?.(() => {
  initialized.then(async () => {
    const job = await getJob();
    if (job?.enabled) {
      await syncAlarm(job);
      await updateBadge(job);
      setTimeout(() => runRound(false).catch(() => undefined), 2500);
    }
  }).catch(() => undefined);
});
chrome.commands.onCommand.addListener(command => {
  if (command !== 'toggle-running') return;
  const activationWasPending = pendingActivationVersion === intentVersion;
  const version = ++intentVersion;
  pendingActivationVersion = null;
  (async () => {
    await initialized;
    const job = await transact(getJob);
    if (activationWasPending || job?.enabled) await pause();
    else if (job) { pendingActivationVersion = version; await resume(version); }
  })().catch(() => undefined).finally(() => { if (pendingActivationVersion === version) pendingActivationVersion = null; });
});

chrome.runtime.onConnect?.addListener?.(port => {
  if (port.name === 'agent-continue-keepalive') {
    port.onMessage.addListener(() => {});
  }
});
