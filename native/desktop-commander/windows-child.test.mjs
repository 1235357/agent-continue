import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { promisify } from 'node:util';

const url = new URL('./windows-child.mjs', import.meta.url);
const api = fs.existsSync(url) ? await import(url) : null;
test('Windows child adapter exists', () => assert.ok(api));
for (const name of ['exec', 'execFile']) {
  test(name + ' preserves Node promise stdout/stderr and child contracts through the hidden wrapper', { skip: !api }, async () => {
    let observed;
    const child = { pid: 123 };
    const original = (...args) => { observed = args; queueMicrotask(() => args.at(-1)(null, 'fixture-out', 'fixture-err')); return child; };
    original[promisify.custom] = () => { throw new Error('must_not_bypass_wrapper'); };
    const target = { [name]: original };
    api.wrapWindowsChildren(target);
    const promise = promisify(target[name])(...(name === 'exec' ? ['echo fixture'] : ['fixture.exe', ['arg']]));
    assert.equal(promise.child, child);
    assert.deepEqual(await promise, { stdout: 'fixture-out', stderr: 'fixture-err' });
    assert.equal(observed.at(-2).windowsHide, true);
  });
}
test('spawn argument arrays and explicit options survive the wrapper', { skip: !api }, () => {
  let observed;
  const target = { spawn: (...args) => { observed = args; return {}; } };
  api.wrapWindowsChildren(target);
  const args = ['-Command', 'Write-Output fixture'];
  target.spawn('powershell.exe', args, { cwd: 'fixture-cwd', windowsHide: false });
  assert.deepEqual(args, ['-Command', 'Write-Output fixture']);
  assert.deepEqual(observed[1], ['-NoLogo', '-NoProfile', '-NonInteractive', ...args]);
  assert.equal(observed[2].cwd, 'fixture-cwd');
  assert.equal(observed[2].windowsHide, true);
});
