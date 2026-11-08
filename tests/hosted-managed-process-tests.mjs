import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createManagedProcessGate } from './hosted-managed-process.mjs';

const id = 'agent_continue_operation_id';
const start = { [id]: 'a2e8df68-dd1f-4c83-97d9-2353c43bc534', agent_continue_process_sha256: 'a'.repeat(64) };
const stopId = '3871bed9-0cf0-49ca-9b92-9d3e6ff8fec7';
const nonce = '8'.repeat(32), marker = 'AC_MANAGED_' + nonce;
const executable = process.execPath, pid = 12345, lifetime = 60000;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-managed-gate-'));
  t.after(() => fs.rmSync(root, {recursive: true}));
  const witness = 'ac-managed-' + nonce + '.pid';
  fs.mkdirSync(path.join(root, 'work'));
  fs.writeFileSync(path.join(root, 'work', witness), String(pid), {flag: 'wx'});
  const events = [], f = { clock: 0, birth: '1', exited: true };
  f.gate = createManagedProcessGate({ start, stopId, witness, marker, executable, lifetime }, root, event => events.push(event), {
    now: () => f.clock,
    observe: async (parent, child, image) => {
      assert.deepEqual([parent, child, image], [process.pid, pid, executable]);
      return { pid, startTime: f.birth, executable };
    },
    exited: async value => { assert.equal(value.pid, pid); return f.exited; },
  });
  return Object.assign(f, {events});
}
const calls = {
  start: {id: 1, params: {name: 'agent_continue_start_prepared_process', arguments: start}},
  list: {id: 2, params: {name: 'list_sessions', arguments: {}}},
  stop: {id: 3, params: {name: 'force_terminate', arguments: {pid, [id]: stopId}}},
  last: {id: 4, params: {name: 'list_sessions'}},
};
const reply = (id, text) => ({id, result: {content: [{type: 'text', text}]}});
async function listRunning(gate) {
  assert.equal(await gate.admit(calls.start), true);
  await gate.observeReply(reply(1, 'Process started with PID ' + pid + '\n' + marker), true);
  assert.equal(await gate.admit(calls.list), true);
  await gate.observeReply(reply(2, 'PID: ' + pid + ', Blocked: false, Runtime: 1s'), false);
}

test('managed fixture admits the exact owned generation, one stop and one subsequent empty list', async t => {
  const {gate, events} = fixture(t);
  assert.equal(await gate.admit(calls.stop), false);
  await listRunning(gate);
  assert.equal(await gate.admit({...calls.stop, params: {...calls.stop.params, arguments: {pid: pid + 1, [id]: stopId}}}), false);
  assert.equal(await gate.admit({...calls.stop, params: {...calls.stop.params, arguments: {pid, [id]: start[id]}}}), false);
  assert.equal(await gate.admit(calls.stop), true);
  assert.equal(await gate.admit(calls.stop), false);
  await gate.observeReply(reply(3, 'Successfully initiated termination of session ' + pid), true);
  assert.equal(await gate.admit(calls.last), true);
  await gate.observeReply(reply(4, 'No active sessions'), false);
  assert.deepEqual(events.filter(event => event !== 'process-denied'),
    ['start', 'identified', 'list-before', 'listed', 'stop', 'exited', 'list-after', 'empty'].map(name => 'process-' + name));
});

for (const failure of ['reused PID', 'near natural expiry', 'not confirmed exited']) {
  test('managed fixture refuses to prove success for ' + failure, async t => {
    const f = fixture(t);
    await listRunning(f.gate);
    if (failure === 'reused PID') f.birth = '2';
    else if (failure === 'near natural expiry') f.clock = lifetime - 9000;
    else {
      assert.equal(await f.gate.admit(calls.stop), true);
      f.exited = false;
      await f.gate.observeReply(reply(3, 'Successfully initiated termination of session ' + pid), true);
      assert.equal(await f.gate.admit(calls.last), false);
      return;
    }
    assert.equal(await f.gate.admit(calls.stop), false);
    assert.equal(f.events.includes('process-stop'), false);
  });
}
