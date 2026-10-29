import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRuntimeReceipt } from './runtime-leases.mjs';
import { initializeWindowsSystemCommand } from './windows-system-command.mjs';

export async function recoverLocalRuntime(file) {
  const leaf = fs.lstatSync(file);
  if (!leaf.isFile() || leaf.isSymbolicLink()) throw new Error('Ricevuta non ammessa.');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let receipt;
  try {
    const stat = fs.fstatSync(fd);
    if (stat.dev !== leaf.dev || stat.ino !== leaf.ino || stat.nlink !== 1 || stat.size > 4096
      || process.getuid && stat.uid !== process.getuid()) throw new Error('Ricevuta non ammessa.');
    receipt = JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
  await verifyRuntimeReceipt(receipt);
  const endpoint = new URL('stop', receipt.choiceUrl);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') throw new Error('Indirizzo non locale.');
  const response = await fetch(endpoint, { method: 'POST', headers: {
    Origin: endpoint.origin, 'Content-Type': 'application/json',
  }, body: '{}', signal: AbortSignal.timeout(3000) });
  return { status: response.status, body: await response.text() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    initializeWindowsSystemCommand();
    if (process.argv.length !== 3) throw new Error('Indica il percorso di instance.json.');
    const result = await recoverLocalRuntime(process.argv[2]);
    console.log(result.status, result.body);
    if (result.status !== 200) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
