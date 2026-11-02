import path from 'node:path';
import { promisify } from 'node:util';

export function wrapWindowsChildren(target) {
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    const wrapped = function (...args) {
      const optionIndex = name.startsWith('execFile') || name.startsWith('spawn')
        ? (Array.isArray(args[1]) ? 2 : 1) : 1;
      const current = args[optionIndex];
      if (typeof current === 'function') args.splice(optionIndex, 0, { windowsHide: true });
      else args[optionIndex] = { ...(typeof current === 'string' ? { encoding: current } : current), windowsHide: true };
      if (Array.isArray(args[1])) {
        const program = path.win32.basename(String(args[0])).toLowerCase();
        // Default tool shells must not run interactive profile/AutoRun startup code.
        // An explicitly requested command may still load a profile; this is not a sandbox.
        if (program === 'powershell.exe' || program === 'pwsh.exe') args[1] = ['-NoLogo', '-NoProfile', '-NonInteractive', ...args[1]];
        if (program === 'cmd.exe') args[1] = ['/d', ...args[1]];
      }
      return Reflect.apply(original, this, args);
    };
    if (name === 'exec' || name === 'execFile') {
      // Node's generic promisifier drops stderr and .child. Do not copy a custom
      // promisifier that closes over the unwrapped original and bypasses windowsHide.
      wrapped[promisify.custom] = (...args) => {
        let child;
        const result = new Promise((resolve, reject) => {
          child = wrapped(...args, (error, stdout, stderr) => {
            if (error) { Object.assign(error, { stdout, stderr }); reject(error); }
            else resolve({ stdout, stderr });
          });
        });
        result.child = child;
        return result;
      };
    }
    target[name] = wrapped;
  }
}
