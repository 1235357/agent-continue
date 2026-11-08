import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { changeAdministratorOwnerIntent, checkAdministratorOwnerConnect } from '../native/desktop-commander/windows-admin-intent.mjs';

const encode = value => JSON.stringify(value) + '\n';
const state = paused => encode({ format: 'agent-continue-lifecycle', version: 1, paused });
const header = encode({ format: 'agent-continue-device-operations', version: 1 });
const entered = encode({ id: 'uncertain', action: 'reconnect', status: 'in-progress' });
const settled = encode({ id: 'uncertain', action: 'reconnect', status: 'settled' });

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ac-admin-intent-'));
  t.after(() => {
    assert.match(path.basename(directory), /^ac-admin-intent-[a-zA-Z0-9]{6}$/);
    assert.equal(fs.realpathSync(directory), directory);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const root = path.join(directory, 'b'.repeat(24) + '.state');
  const vault = path.join(directory, 'b'.repeat(24) + '.secrets');
  fs.mkdirSync(root); fs.mkdirSync(vault);
  const file = path.join(root, 'lifecycle.json');
  const journal = path.join(root, 'device-operations.jsonl');
  fs.writeFileSync(file, state(true));
  return { root, vault, file, journal };
}

test('only explicit Connect publishes running intent, and Pause persists without replaying anything', t => {
  const f = fixture(t);
  assert.throws(() => changeAdministratorOwnerIntent(f.root, f.vault, 'wake', () => true), /admin_intent/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), state(true));
  assert.equal(changeAdministratorOwnerIntent(f.root, f.vault, 'connect', () => true), 'running-intent-saved');
  assert.equal(fs.readFileSync(f.file, 'utf8'), state(false));
  const original = fs.statSync(f.file, { bigint: true });
  assert.equal(changeAdministratorOwnerIntent(f.root, f.vault, 'connect', () => true), 'already-running-intent');
  assert.equal(fs.statSync(f.file, { bigint: true }).ino, original.ino);
  assert.equal(changeAdministratorOwnerIntent(f.root, f.vault, 'pause'), 'paused-intent-saved');
  assert.equal(fs.readFileSync(f.file, 'utf8'), state(true));
  assert.equal(changeAdministratorOwnerIntent(f.root, f.vault, 'pause'), 'already-paused-intent');
});

test('Connect refuses unknown journal, live owner and revoked authorization; Pause does not overwrite the journal', t => {
  const f = fixture(t);
  fs.writeFileSync(f.journal, header + entered);
  assert.throws(() => changeAdministratorOwnerIntent(f.root, f.vault, 'connect', () => true), /admin_intent_unsettled/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), state(true));
  fs.writeFileSync(f.journal, header + entered + settled);
  fs.writeFileSync(path.join(f.vault, 'owner-job.lease'), 'still owned');
  assert.throws(() => changeAdministratorOwnerIntent(f.root, f.vault, 'connect', () => true), /admin_intent_unsettled/);
  fs.writeFileSync(f.file, state(false));
  assert.equal(changeAdministratorOwnerIntent(f.root, f.vault, 'pause'), 'paused-intent-saved');
  assert.equal(fs.readFileSync(f.journal, 'utf8'), header + entered + settled);
  assert.equal(fs.readFileSync(path.join(f.vault, 'owner-job.lease'), 'utf8'), 'still owned');
  fs.unlinkSync(path.join(f.vault, 'owner-job.lease'));
  assert.throws(() => changeAdministratorOwnerIntent(f.root, f.vault, 'connect', () => false), /admin_intent_unauthorized/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), state(true));
});

test('Connect accepts a settled journal and fails closed on corrupt or oversized journals; Pause still works', t => {
  const f = fixture(t);
  fs.writeFileSync(f.journal, header + entered + settled);
  assert.equal(changeAdministratorOwnerIntent(f.root, f.vault, 'connect', () => true), 'running-intent-saved');
  for (const bytes of [Buffer.from(header + '{"invalid":true}\n'), Buffer.alloc(2 * 1024 * 1024 + 1)]) {
    fs.writeFileSync(f.file, state(false));
    fs.writeFileSync(f.journal, bytes);
    assert.equal(changeAdministratorOwnerIntent(f.root, f.vault, 'pause'), 'paused-intent-saved');
    assert.throws(() => changeAdministratorOwnerIntent(f.root, f.vault, 'connect', () => true), /admin_intent_unsettled/);
    assert.equal(fs.readFileSync(f.file, 'utf8'), state(true));
    assert.deepEqual(fs.readFileSync(f.journal), bytes);
  }
});

test('Connect cannot commit after revocation or same-byte intent replacement during preflight', t => {
  const f = fixture(t);
  const revoke = path.join(f.vault, 'owner-revoked');
  let checks = 0;
  assert.throws(() => changeAdministratorOwnerIntent(f.root, f.vault, 'connect', () => {
    if (++checks === 2) fs.writeFileSync(revoke, '');
    return true;
  }), /admin_intent_unauthorized/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), state(true));
  fs.unlinkSync(revoke);
  checks = 0;
  assert.throws(() => changeAdministratorOwnerIntent(f.root, f.vault, 'connect', () => {
    if (++checks === 2) {
      const replacement = path.join(f.root, 'replacement');
      fs.writeFileSync(replacement, state(true));
      fs.renameSync(replacement, f.file);
    }
    return true;
  }), /admin_intent_changed/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), state(true));
  assert.deepEqual(fs.readdirSync(f.root), ['lifecycle.json']);
});

test('Connect and Pause refuse an aliased or noncanonical lifecycle file', t => {
  const f = fixture(t);
  const alias = path.join(f.root, 'alias');
  fs.linkSync(f.file, alias);
  assert.throws(() => changeAdministratorOwnerIntent(f.root, f.vault, 'pause'), /admin_intent_state/);
  fs.unlinkSync(alias);
  fs.writeFileSync(f.file, state(false).replace('false', ' true'));
  assert.throws(() => changeAdministratorOwnerIntent(f.root, f.vault, 'connect', () => true), /admin_intent_state/);
});

test('the sealed launch preflight checks authorization and the journal without granting running intent', t => {
  const f = fixture(t);
  assert.equal(checkAdministratorOwnerConnect(f.root, f.vault, () => true), true);
  assert.equal(fs.readFileSync(f.file, 'utf8'), state(true));
  assert.deepEqual(fs.readdirSync(f.root), ['lifecycle.json']);
  fs.writeFileSync(f.journal, header + entered);
  assert.throws(() => checkAdministratorOwnerConnect(f.root, f.vault, () => true), /admin_intent_unsettled/);
  assert.equal(fs.readFileSync(f.journal, 'utf8'), header + entered);
});
