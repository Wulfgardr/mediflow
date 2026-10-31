import fs from 'node:fs';
import { loadSystemDirectoryBinding } from './windows-launcher-bootstrap/index.mjs';
import { verifyChildOwner } from './runtime-leases.mjs';

const file = process.argv[2];
let job;
try {
  if (process.platform !== 'win32' || process.argv.length !== 3) throw new Error('Invalid Windows Job helper arguments.');
  const token = JSON.parse(fs.readFileSync(file, 'utf8'));
  const owner = { file, token };
  verifyChildOwner(owner, false);
  const frame = (type, extra = {}) => process.stdout.write(JSON.stringify({ type, nonce: token.nonce, ...extra }) + '\n');
  frame('bootstrap');
  const binding = loadSystemDirectoryBinding();
  frame('assigning');
  job = binding.createJobForProcess(token.pid, token.start);
  let command = '', stop = false, invalidCommand = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', bytes => {
    command += bytes;
    const end = command.indexOf('\n');
    if (end >= 0 || command.length > 128) {
      invalidCommand = end < 0 || command.slice(0, end) !== token.nonce;
      stop = true;
    }
  });
  process.stdin.once('end', () => { stop = true; });
  frame('ready');
  while (!stop && !job.ownerExited()) await new Promise(resolve => setTimeout(resolve, 40));
  if (invalidCommand) throw new Error('Windows Job command mismatch.');
  verifyChildOwner(owner, false);
  job.terminate();
  const deadline = performance.now() + 15000;
  while (job.active() !== 0) {
    if (performance.now() >= deadline) throw new Error('Windows Job drain timeout.');
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  frame('drained', { active: 0 });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  try { job?.close(); } catch (error) { console.error(error); process.exitCode = 1; }
  process.stdin.destroy();
}
