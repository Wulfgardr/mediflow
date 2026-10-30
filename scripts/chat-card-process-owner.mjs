import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { stopOwnedChild } from './mediflow.mjs';

export async function superviseNativeCard(command, args) {
  const child = spawn(command, args, { detached: true, stdio: ['pipe', 'pipe', 'ignore'], env: process.env });
  child.stdin.on('error', () => {});
  child.stdout.pipe(process.stdout, { end: false });
  process.stdin.pipe(child.stdin, { end: false });
  let stopping;
  const stop = () => stopping ??= stopOwnedChild(child, 3000).finally(() => {
    process.stdin.unpipe(child.stdin);
    process.stdin.pause();
    child.stdin.destroy();
    child.stdout.destroy();
    child.unref();
  });
  await new Promise((resolve, reject) => {
    const finish = () => { stop().then(resolve, reject); };
    process.stdin.once('end', finish);
    process.stdin.once('error', finish);
    child.once('exit', finish);
    child.once('error', reject);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.versions.node !== '24.18.0' || process.argv.length !== 4) throw new Error('synthetic_card_denied');
    await superviseNativeCard(process.execPath, process.argv.slice(2));
  } catch { process.exitCode = 1; }
}
