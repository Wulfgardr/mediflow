import fs from 'node:fs';
import { loadSystemDirectoryBinding } from './windows-launcher-bootstrap/index.mjs';

const messages = {
  existing: 'La cartella preesistente non ha permessi privati per questo utente. Scegli una nuova cartella locale: i backup esistenti non vengono spostati né modificati.',
  filesystem: 'Il filesystem non supporta le autorizzazioni richieste. Scegli una nuova cartella su un volume NTFS con DACL compatibile.',
  blocked: 'Il controllo nativo dei permessi non è disponibile o è bloccato. Contatta l’amministratore per verificare accesso e policy, senza disabilitarle. Nessun backup scritto.',
};
export class WindowsPrivateDirectoryError extends Error {
  constructor(reason = 'blocked') {
    super(messages[reason]);
    this.reason = reason;
    this.code = `backup_directory_${reason}`;
    this.userMessage = messages[reason];
  }
}
function security(directory, restrict) {
  try {
    const binding = loadSystemDirectoryBinding();
    assertPrivateDacl(restrict ? binding.restrictDirectorySecurity(directory) : binding.getDirectorySecurity(directory));
  } catch (error) {
    if (error instanceof WindowsPrivateDirectoryError) throw error;
    throw new WindowsPrivateDirectoryError(error?.code === 'MEDIFLOW_WINDOWS_DACL_FILESYSTEM' ? 'filesystem'
      : error?.code === 'MEDIFLOW_WINDOWS_DACL_REJECTED' ? 'existing' : 'blocked');
  }
}
export function assertPrivateDacl(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) throw new WindowsPrivateDirectoryError('existing');
  const { sid, protected: protectedDacl, rules } = observation;
  if (typeof sid !== 'string' || !/^S-1-\d+(?:-\d+)+$/u.test(sid)
    || protectedDacl !== true || !Array.isArray(rules) || rules.length !== 2) throw new WindowsPrivateDirectoryError('existing');
  const trustees = rules.map(rule => {
    if (rule.type !== 0 || rule.rights !== 0x1f01ff || rule.inheritance !== 3
      || rule.propagation !== 0 || rule.inherited !== false || typeof rule.sid !== 'string') throw new WindowsPrivateDirectoryError('existing');
    return rule.sid;
  }).sort();
  if (trustees.join('|') !== [sid, 'S-1-5-18'].sort().join('|')) throw new WindowsPrivateDirectoryError('existing');
}
export function assertPrivateDirectory(directory) {
  if (process.platform !== 'win32') return;
  try {
    if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error('Not a physical directory');
  } catch { throw new WindowsPrivateDirectoryError('existing'); }
  security(directory, false);
}
export function restrictNewPrivateDirectory(directory) {
  if (process.platform !== 'win32') return;
  try {
    if (fs.readdirSync(directory).length !== 0 || fs.lstatSync(directory).isSymbolicLink()) throw new Error('Not an empty directory');
  } catch { throw new WindowsPrivateDirectoryError('existing'); }
  security(directory, true);
}
