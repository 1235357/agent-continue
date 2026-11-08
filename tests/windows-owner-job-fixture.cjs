const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [directory, role] = process.argv.slice(2);
const roles = ['root', 'child', 'grandchild', 'outside'];
if (!roles.includes(role) || process.env.AC_OWNER_JOB_FIXTURE !== 'exact value') process.exit(3);
fs.writeFileSync(path.join(directory, role + '.pid'), String(process.pid), { flag: 'wx' });
if (role === 'root' || role === 'child') {
  const descendant = spawn(process.execPath, [__filename, directory, roles[roles.indexOf(role) + 1]],
    { stdio: 'ignore', windowsHide: true, detached: true });
  descendant.on('error', () => process.exit(4));
  descendant.unref();
}
setInterval(() => {
  if (role === 'root' && fs.existsSync(path.join(directory, 'exit-root'))) process.exit(17);
}, 40);
