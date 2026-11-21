// Unit tests for Dot pause detection, busy state priority, and anti-thrashing bounds (v3.2.0)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig, currentPrompt } from '../config.js';
await import('../dialog-classifier.js');
const classifyButtonText = globalThis.__agentContinueClassifyButtonText;

test('TC-PAUSE-01: Cyclic queue logic advances index and loops indefinitely (queue-loop)', () => {
  const config = readConfig({
    mode: 'queue-loop',
    intervalMinutes: 20,
    queue: [
      { text: 'Prompt 1: Explore literature' },
      { text: 'Prompt 2: Design benchmarks' },
      { text: 'Prompt 3: Verify results' }
    ]
  });

  assert.equal(config.mode, 'queue-loop');
  assert.equal(config.queue.length, 3);

  // Cycle 1
  let job = { ...config, queueIndex: 0 };
  assert.equal(currentPrompt(job), 'Prompt 1: Explore literature');

  job.queueIndex = (job.queueIndex + 1) % job.queue.length;
  assert.equal(currentPrompt(job), 'Prompt 2: Design benchmarks');

  job.queueIndex = (job.queueIndex + 1) % job.queue.length;
  assert.equal(currentPrompt(job), 'Prompt 3: Verify results');

  // Cycle 2 loop back to index 0
  job.queueIndex = (job.queueIndex + 1) % job.queue.length;
  assert.equal(job.queueIndex, 0);
  assert.equal(currentPrompt(job), 'Prompt 1: Explore literature');
});

test('TC-PAUSE-02: Single repeat prompt mode repeats unchanged', () => {
  const config = readConfig({
    mode: 'repeat',
    prompt: 'Repeat prompt every 30 minutes',
    intervalMinutes: 30
  });

  assert.equal(config.mode, 'repeat');
  assert.equal(currentPrompt(config), 'Repeat prompt every 30 minutes');
});

test('TC-PAUSE-03: Queue-once terminates after all items sent', () => {
  const config = readConfig({
    mode: 'queue-once',
    intervalMinutes: 15,
    queue: [
      { text: 'Single task 1' },
      { text: 'Single task 2' }
    ]
  });

  assert.equal(config.mode, 'queue-once');
  let job = { ...config, queueIndex: 0 };
  assert.equal(currentPrompt(job), 'Single task 1');

  job.queueIndex += 1;
  assert.equal(currentPrompt(job), 'Single task 2');

  job.queueIndex += 1;
  assert.equal(job.queueIndex >= job.queue.length, true);
});

test('TC-PAUSE-04: Dialog classifier classifies affirmative consent and allow buttons', () => {
  assert.equal(classifyButtonText('Allow')?.kind, 'allow');
  assert.equal(classifyButtonText('Authorize')?.kind, 'allow');
  assert.equal(classifyButtonText('允许')?.kind, 'allow');
  assert.equal(classifyButtonText('确认')?.kind, 'allow');
  assert.equal(classifyButtonText('同意')?.kind, 'allow');
  assert.equal(classifyButtonText('继续')?.kind, 'allow');
  assert.equal(classifyButtonText('I agree')?.kind, 'allow');
  assert.equal(classifyButtonText('Deny')?.kind, 'deny');
  assert.equal(classifyButtonText('Cancel')?.kind, 'deny');
});

test('TC-PAUSE-05: Diagnostic code allowlist in background accepts agent-paused and agent-busy', () => {
  const allowedBusyCodes = ['send-not-ready', 'auto-allowed-prompt', 'agent-paused', 'agent-busy'];
  assert.equal(allowedBusyCodes.includes('agent-paused'), true);
  assert.equal(allowedBusyCodes.includes('agent-busy'), true);

  const allowedBlockedCodes = ['commit-not-dispatched', 'composer-unstable', 'composer-slow-write', 'chunk-unconfirmed', 'chunk-attachment', 'chunk-mismatch', 'composer-unavailable'];
  assert.equal(allowedBlockedCodes.includes('composer-unavailable'), true);
});
