import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

function exitAfter(child) {
  if (child.exitCode !== null || child.signalCode !== null) process.exit(0);
  else child.once('exit', () => process.exit(0));
}

if (process.argv[2] === 'leaf') {
  setInterval(() => {}, 1000);
} else if (process.argv[2] === 'descendant') {
  const leaf = spawn(process.execPath, [process.argv[1], 'leaf'], { stdio: 'ignore' });
  process.once('SIGTERM', () => exitAfter(leaf));
  process.send([process.pid, leaf.pid]);
  setInterval(() => {}, 1000);
} else {
  const child = spawn(process.execPath, [process.argv[1], 'descendant'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  process.once('SIGTERM', () => exitAfter(child));
  const pids = await new Promise(resolve => child.once('message', resolve));
  const payload = 'synthetic-redacted-payload';
  let prepared = false;
  for await (const line of createInterface({ input: process.stdin })) {
    const { command } = JSON.parse(line);
    if (command === 'prepare' && !prepared) { prepared = true; process.stdout.write(JSON.stringify({ payload, payloadSha256: 'a'.repeat(64), nativeSource: { pids: [process.pid, ...pids] } }) + '\n'); }
    else if (command === 'consume') process.stdout.write(JSON.stringify({ payload }) + '\n');
  }
}
