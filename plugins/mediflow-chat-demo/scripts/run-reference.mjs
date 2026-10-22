import { spawn } from 'node:child_process';
import path from 'node:path';
import { referenceDirectory } from './reference-location.mjs';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';

await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
const children = [];
const card = process.argv.includes('--card');
async function start(file, ready, name) {
  const log = createWriteStream(new URL(`../.local/${name}.log`, import.meta.url));
  const child = spawn(process.execPath, [...(file.includes('card-reference') ? ['--import', new URL('../../../scripts/register-strip-types-loader.mjs', import.meta.url).pathname] : []), file], { cwd: new URL('../', import.meta.url),
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
  if (card) {
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, ['scripts/prepare-card-reference.mjs'], { cwd: new URL('../', import.meta.url), stdio: 'inherit' });
  }
  await start(path.join(referenceDirectory, 'serve.ts'), 'Sandbox server:', 'reference-host');
  await start(card ? 'test/card-reference-server.mjs' : 'scripts/reference-server.mjs', 'Reference-only MCP endpoint:', 'reference-server');
  const child = spawn(process.execPath, [card ? 'test/card-reference.mjs' : process.argv.includes('--falsify') ? 'scripts/falsify-performance.mjs' : 'scripts/reference-performance.mjs',
    ...process.argv.slice(2).filter(arg => arg !== '--falsify' && arg !== '--card')], { cwd: new URL('../', import.meta.url), stdio: 'inherit' });
  children.push(child);
  const code = await new Promise(resolve => child.once('exit', resolve));
  if (code !== 0) process.exitCode = 1;
} finally {
  await Promise.all(children.filter(child => child.exitCode === null).map(child => new Promise(resolve => {
    child.once('exit', resolve); child.kill('SIGTERM');
  })));
}
