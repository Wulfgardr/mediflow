import fs from 'node:fs';
import path from 'node:path';
import { loadSystemDirectoryBinding } from './windows-launcher-bootstrap/index.mjs';

let taskkill;
const unconfirmed = cause => Object.assign(new Error('Arresto del processo posseduto non verificato.', { cause }),
  { code: 'MEDIFLOW_OWNED_STOP_UNCONFIRMED' });
const local = value => {
  if (typeof value !== 'string' || !/^[A-Za-z]:\\/u.test(value) || /[\x00-\x1f<>"|?*]/u.test(value)
    || value.slice(2).includes(':') || value.includes('/')) throw new Error('Invalid Windows system path.');
  return path.win32.normalize(value);
};

export function initializeWindowsSystemCommand() {
  if (process.platform !== 'win32') return null;
  if (taskkill) return taskkill;
  try {
    const directory = local(loadSystemDirectoryBinding().getSystemDirectory());
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid Windows system directory.');
    const canonicalDirectory = local(fs.realpathSync.native(directory));
    const candidate = path.win32.join(directory, 'taskkill.exe');
    const file = fs.lstatSync(candidate);
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('Invalid Windows system executable.');
    const canonical = local(fs.realpathSync.native(candidate));
    if (path.win32.basename(canonical).toLowerCase() !== 'taskkill.exe'
      || path.win32.dirname(canonical).toLowerCase() !== canonicalDirectory.toLowerCase()) throw new Error('Windows system executable escapes its directory.');
    taskkill = canonical;
    return taskkill;
  } catch (cause) { throw unconfirmed(cause); }
}

export function windowsTaskkillCommand() {
  if (!taskkill) throw unconfirmed(new Error('Windows system command bootstrap not completed.'));
  return taskkill;
}
