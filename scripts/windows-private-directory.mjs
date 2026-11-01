import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initializeWindowsSystemCommand } from './windows-system-command.mjs';

const failure = () => new Error('DACL privata della cartella non verificabile. Nessun backup scritto.');
function run(name, args) {
  const directory = path.dirname(initializeWindowsSystemCommand());
  const command = path.join(directory, name);
  if (path.dirname(fs.realpathSync.native(command)).toLowerCase() !== directory.toLowerCase()
    || !fs.lstatSync(command).isFile() || fs.lstatSync(command).isSymbolicLink()) throw failure();
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0 || result.signal) throw failure();
  return result.stdout;
}
function currentSid() {
  const sids = run('whoami.exe', ['/user', '/fo', 'csv', '/nh']).match(/S-1-\d+(?:-\d+)+/gu);
  if (sids?.length !== 1) throw failure();
  return sids[0];
}
export function assertPrivateDacl(sddl, sid) {
  if (typeof sid !== 'string' || !/^S-1-\d+(?:-\d+)+$/u.test(sid)
    || typeof sddl !== 'string' || !/^D:P(?:AI)?\(/u.test(sddl)) throw failure();
  const aces = [...sddl.matchAll(/\(([^()]*)\)/gu)].map(match => match[1]);
  if (aces.length !== 2 || sddl !== sddl.slice(0, sddl.indexOf('(')) + aces.map(ace => `(${ace})`).join('')) throw failure();
  const trustees = aces.map(ace => {
    const parts = ace.split(';');
    if (parts.length !== 6 || parts[0] !== 'A' || parts[1] !== 'OICI'
      || !['FA', '0x1f01ff'].includes(parts[2]) || parts[3] || parts[4]) throw failure();
    return parts[5] === 'SY' ? 'S-1-5-18' : parts[5];
  }).sort();
  if (trustees.join('|') !== [sid, 'S-1-5-18'].sort().join('|')) throw failure();
}
export function assertPrivateDirectory(directory) {
  if (process.platform !== 'win32') return;
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw failure();
  const file = path.join(directory, `.dacl-${process.pid}-${Date.now()}`);
  if (fs.existsSync(file)) throw failure();
  try {
    run('icacls.exe', [directory, '/save', file, '/q']);
    const lines = fs.readFileSync(file).toString('utf16le').replace(/^\uFEFF/u, '').trim().split(/\r?\n/u);
    if (lines.length !== 2) throw failure();
    assertPrivateDacl(lines[1], currentSid());
  } finally { fs.rmSync(file, { force: true }); }
}
export function restrictNewPrivateDirectory(directory) {
  if (process.platform !== 'win32') return;
  if (fs.readdirSync(directory).length !== 0 || fs.lstatSync(directory).isSymbolicLink()) throw failure();
  const sid = currentSid();
  run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '/q']);
  assertPrivateDirectory(directory);
}
