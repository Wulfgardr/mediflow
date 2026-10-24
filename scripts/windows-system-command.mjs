import fs from 'node:fs';
import path from 'node:path';
import { loadSystemDirectoryBinding } from './windows-launcher-bootstrap/index.mjs';

let bootstrap;
const unconfirmed = cause => Object.assign(new Error('Arresto del processo posseduto non verificato.', { cause }),
  { code: 'MEDIFLOW_OWNED_STOP_UNCONFIRMED' });
const local = value => {
  if (typeof value !== 'string' || !/^[A-Za-z]:\\/u.test(value) || /[\x00-\x1f<>"|?*]/u.test(value)
    || value.slice(2).includes(':') || value.includes('/')) throw new Error('Invalid Windows system path.');
  return path.win32.normalize(value);
};

export function initializeWindowsSystemCommand() {
  if (process.platform !== 'win32') return null;
  if (bootstrap) return bootstrap.taskkill;
  try {
    const binding = loadSystemDirectoryBinding();
    const directory = local(binding.getSystemDirectory());
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid Windows system directory.');
    const canonicalDirectory = local(fs.realpathSync.native(directory));
    const candidate = path.win32.join(directory, 'taskkill.exe');
    const file = fs.lstatSync(candidate);
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('Invalid Windows system executable.');
    const canonical = local(fs.realpathSync.native(candidate));
    if (path.win32.basename(canonical).toLowerCase() !== 'taskkill.exe'
      || path.win32.dirname(canonical).toLowerCase() !== canonicalDirectory.toLowerCase()) throw new Error('Windows system executable escapes its directory.');
    bootstrap = { binding, taskkill: canonical };
    return bootstrap.taskkill;
  } catch (cause) { throw unconfirmed(cause); }
}

export function windowsTaskkillCommand() {
  if (!bootstrap) throw unconfirmed(new Error('Windows system command bootstrap not completed.'));
  return bootstrap.taskkill;
}

export function windowsProcessCreationTimeTicks(pid) {
  if (!bootstrap) throw new Error('Windows process identity bootstrap not completed.');
  if (!Number.isInteger(pid) || pid < 1 || pid > 0xffffffff) throw new Error('Invalid Windows process identifier.');
  const ticks = bootstrap.binding.getProcessCreationTimeTicks(pid);
  if (typeof ticks !== 'string' || !/^[1-9][0-9]{0,18}$/u.test(ticks) || BigInt(ticks) > 3155378975999999999n) {
    throw new Error('Invalid Windows process creation time.');
  }
  return ticks;
}
