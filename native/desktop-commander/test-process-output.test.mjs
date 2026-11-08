import test from 'node:test';
import assert from 'node:assert/strict';
import { observeTestProcessOutput } from './test-process-output.mjs';

const result = text => ({ content: [{ type: 'text', text }] });
const initial = result('Process started with PID 42 (shell: test)\nInitial output:\n');

test('initial output is sufficient without another tool call', async () => {
  let reads = 0;
  const text = await observeTestProcessOutput(result('Process started with PID 42\nEXPECTED'), 'EXPECTED',
    async () => { reads++; throw new Error('unexpected_read'); });
  assert.match(text, /EXPECTED/);
  assert.equal(reads, 0);
});

test('a delayed marker reads only the PID returned by this start and never starts again', async () => {
  const calls = [];
  const chunks = [result('still running'), result('EXPE'), result('CTED')];
  const text = await observeTestProcessOutput(initial, 'EXPECTED', async request => {
    calls.push(request);
    return chunks.shift();
  });
  assert.match(text, /EXPECTED/);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.name, 'read_process_output');
    assert.equal(call.arguments.pid, 42);
    assert.ok(call.arguments.timeout_ms > 0 && call.arguments.timeout_ms <= 1000);
  }
});

test('missing or ambiguous start PID cannot authorize process observation', async () => {
  for (const text of ['no PID', 'Process started with PID 0',
    'Process started with PID 42\nProcess started with PID 43']) {
    await assert.rejects(observeTestProcessOutput(result(text), 'EXPECTED', async () => {
      throw new Error('must_not_read');
    }), /test_process_pid/);
  }
});

test('provider error and malformed content do not become a successful process', async () => {
  await assert.rejects(observeTestProcessOutput(initial, 'EXPECTED', async () => ({
    ...result('EXPECTED'), isError: true,
  })), /test_process_result/);
  await assert.rejects(observeTestProcessOutput({ content: 'EXPECTED' }, 'EXPECTED', async () => initial),
    /test_process_result/);
});

test('missing marker has a bounded read count', async () => {
  let reads = 0;
  await assert.rejects(observeTestProcessOutput(initial, 'EXPECTED', async () => {
    reads++; return result('still running');
  }, { maxReads: 2 }), /test_process_output_unconfirmed/);
  assert.equal(reads, 2);
});

test('deadline stops observation without another mutation or read', async () => {
  let clock = 0, reads = 0;
  await assert.rejects(observeTestProcessOutput(initial, 'EXPECTED', async () => {
    reads++; clock = 200; return result('waiting');
  }, { now: () => clock, budgetMs: 100 }), /test_process_output_unconfirmed/);
  assert.equal(reads, 1);
});

test('oversized accumulated output fails without retaining unbounded text', async () => {
  await assert.rejects(observeTestProcessOutput(initial, 'EXPECTED', async () => result('x'.repeat(65537))),
    /test_process_output_limit/);
});

test('a marker prefix does not confirm until the whole typed marker arrives', async () => {
  const chunks = [result('AC_PROOF_'), result('a'.repeat(32))];
  const text = await observeTestProcessOutput(initial, /\bAC_PROOF_[a-f0-9]{32}\b/,
    async () => chunks.shift());
  assert.match(text, /AC_PROOF_[a-f0-9]{32}/);
  assert.equal(chunks.length, 0);
});

test('a result arriving after the observation deadline is not success', async () => {
  let clock = 0;
  await assert.rejects(observeTestProcessOutput(initial, 'EXPECTED', async () => {
    clock = 200; return result('EXPECTED');
  }, { now: () => clock, budgetMs: 100 }), /test_process_output_unconfirmed/);
});

test('an unresponsive read remains bounded', async () => {
  await assert.rejects(observeTestProcessOutput(initial, 'EXPECTED', () => new Promise(() => {}),
    { budgetMs: 20 }), /test_process_output_unconfirmed/);
});
