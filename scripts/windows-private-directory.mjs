import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initializeWindowsSystemCommand } from './windows-system-command.mjs';

const failure = () => new Error('DACL privata della cartella non verificabile. Nessun backup scritto.');
const powershell = path.join('WindowsPowerShell', 'v1.0', 'powershell.exe');
const query = String.raw`
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
try {
  Import-Module ($PSHOME + '\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
  $directory = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))
  $acl = [IO.Directory]::GetAccessControl($directory, [Security.AccessControl.AccessControlSections]::Access)
  $rules = @(foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    @{ sid = $rule.IdentityReference.Value; type = [int]$rule.AccessControlType; rights = [int]$rule.FileSystemRights;
       inheritance = [int]$rule.InheritanceFlags; propagation = [int]$rule.PropagationFlags; inherited = $rule.IsInherited }
  })
  $result = @{ sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; protected = $acl.AreAccessRulesProtected; rules = $rules }
  Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $result -Depth 4 -Compress
} catch { exit 1 }
`;
function run(name, args, input) {
  const directory = path.dirname(initializeWindowsSystemCommand());
  const command = path.join(directory, name);
  if (fs.realpathSync.native(command).toLowerCase() !== command.toLowerCase()
    || !fs.lstatSync(command).isFile() || fs.lstatSync(command).isSymbolicLink()) throw failure();
  const env = name === powershell ? { SystemRoot: path.dirname(directory), windir: path.dirname(directory),
    PATH: directory, PSModulePath: path.join(directory, 'WindowsPowerShell', 'v1.0', 'Modules') } : undefined;
  const result = spawnSync(command, args, { input, env, cwd: directory, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0 || result.signal) throw failure();
  return result.stdout;
}
function currentSid() {
  const sids = run('whoami.exe', ['/user', '/fo', 'csv', '/nh']).match(/S-1-\d+(?:-\d+)+/gu);
  if (sids?.length !== 1) throw failure();
  return sids[0];
}
export function assertPrivateDacl(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) throw failure();
  const { sid, protected: protectedDacl, rules } = observation;
  if (typeof sid !== 'string' || !/^S-1-\d+(?:-\d+)+$/u.test(sid)
    || protectedDacl !== true || !Array.isArray(rules) || rules.length !== 2) throw failure();
  const trustees = rules.map(rule => {
    if (rule.type !== 0 || rule.rights !== 0x1f01ff || rule.inheritance !== 3
      || rule.propagation !== 0 || rule.inherited !== false || typeof rule.sid !== 'string') throw failure();
    return rule.sid;
  }).sort();
  if (trustees.join('|') !== [sid, 'S-1-5-18'].sort().join('|')) throw failure();
}
export function assertPrivateDirectory(directory) {
  if (process.platform !== 'win32') return;
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw failure();
  const result = run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(query, 'utf16le').toString('base64')],
    Buffer.from(directory, 'utf8').toString('base64'));
  try { assertPrivateDacl(JSON.parse(result)); } catch { throw failure(); }
}
export function restrictNewPrivateDirectory(directory) {
  if (process.platform !== 'win32') return;
  if (fs.readdirSync(directory).length !== 0 || fs.lstatSync(directory).isSymbolicLink()) throw failure();
  const sid = currentSid();
  run('icacls.exe', [directory, '/reset', '/q']);
  run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '/q']);
  assertPrivateDirectory(directory);
}
