import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareState, buildHostLaunch } from './runtime.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
test('missing/malformed pins and dependencies fail only through the sanitized startup boundary', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-boundary-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  for (const mode of ['missing-pin', 'malformed-pin', 'missing-runtime', 'missing-upstream']) {
    const copy = path.join(scratch, mode); fs.mkdirSync(copy);
    for (const file of ['host.mjs', 'runtime.mjs', 'windows-child.mjs']) {
      if (file === 'runtime.mjs' && mode === 'missing-runtime') continue;
      if (fs.existsSync(path.join(here, file))) fs.copyFileSync(path.join(here, file), path.join(copy, file));
    }
    if (mode === 'malformed-pin') fs.writeFileSync(path.join(copy, 'upstream-pin.json'), '{');
    if (mode === 'missing-upstream') fs.copyFileSync(path.join(here, 'upstream-pin.json'), path.join(copy, 'upstream-pin.json'));
    const state = path.join(copy, 'state'); prepareState(state, { consent: 'full-account' });
    const launch = buildHostLaunch(state, {});
    const result = spawnSync(process.execPath, [path.join(copy, 'host.mjs'), '--state-dir', state],
      { cwd: copy, env: launch.env, windowsHide: true, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1, mode);
    assert.equal(result.stdout, '', mode);
    assert.equal(result.stderr, 'agent_continue_native_start_failed\n', mode);
  }
});
