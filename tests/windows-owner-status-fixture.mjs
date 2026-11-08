import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { observeWindowsAdministratorOwner } from '../native/desktop-commander/windows-admin-owner.mjs';

const [bundle, directory, witness] = process.argv.slice(2);
const generation = process.env.AC_ADMIN_OWNER_GENERATION;
const statusFile = path.join(directory, 'owner-status.json');
const publish = observeWindowsAdministratorOwner(bundle, generation, async () => true);
const deadline = performance.now() + 11000;
let revoked = false;
while (performance.now() < deadline) {
  if (!revoked) await publish();
  let status;
  try { status = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch { /* Supervisor not ready. */ }
  if (status?.generation === generation && status.rootPid === process.pid) {
    if (!revoked && status.state === 'ready') {
      fs.writeFileSync(path.join(bundle + '.secrets', 'owner-revoked'), '', { flag: 'wx' });
      revoked = true;
    } else if (revoked && status.state === 'unobserved') {
      fs.writeFileSync(witness, generation, { flag: 'wx' });
      process.exit(0);
    }
  }
  await delay(125);
}
process.exitCode = 5;
