import { spawn } from 'node:child_process';
import path from 'node:path';
import { referenceDirectory } from './reference-location.mjs';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';

await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
const children = [];
async function start(file, ready, name) {
  const log = createWriteStream(new URL(`../.local/${name}.log`, import.meta.url));
  const child = spawn(process.execPath, [file], { cwd: new URL('../', import.meta.url),
    env: { ...process.env, SERVERS: '["http://localhost:3017/mcp"]' }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.stdout.pipe(log); child.stderr.pipe(log);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name}: startup timeout`)), 15_000);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`${name}: exited ${code}; see .local/${name}.log`)); });
    child.once('error', reject);
    child.stdout.on('data', data => { if (data.toString().includes(ready)) { clearTimeout(timer); resolve(undefined); } });
  });
}
try {
  await start(path.join(referenceDirectory, 'serve.ts'), 'Sandbox server:', 'reference-host');
  await start('scripts/reference-server.mjs', 'Reference-only MCP endpoint:', 'reference-server');
  const child = spawn(process.execPath, [process.argv.includes('--falsify') ? 'scripts/falsify-performance.mjs' : 'scripts/reference-performance.mjs',
    ...process.argv.slice(2).filter(arg => arg !== '--falsify')], { cwd: new URL('../', import.meta.url), stdio: 'inherit' });
  children.push(child);
  const code = await new Promise(resolve => child.once('exit', resolve));
  if (code !== 0) process.exitCode = 1;
} finally {
  await Promise.all(children.filter(child => child.exitCode === null).map(child => new Promise(resolve => {
    child.once('exit', resolve); child.kill('SIGTERM');
  })));
}
