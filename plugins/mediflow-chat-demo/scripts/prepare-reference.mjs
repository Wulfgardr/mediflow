import { execFileSync } from 'node:child_process';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const revision = '92f46a574568a3ddac7600343b7d3c4c4ed7b588';
const destination = new URL('../../../tmp-chat-reference/', import.meta.url);
await mkdir(destination, { recursive: true });
const archive = await fetch(`https://codeload.github.com/modelcontextprotocol/ext-apps/tar.gz/${revision}`);
if (!archive.ok) throw new Error(`Reference source unavailable: ${archive.status}`);
execFileSync('tar', ['-xz', '--strip-components=3', '-C', fileURLToPath(destination),
  `ext-apps-${revision}/examples/basic-host`], { input: Buffer.from(await archive.arrayBuffer()) });
for (const file of ['package.json', 'package-lock.json']) {
  await copyFile(new URL(`../test/reference-host/${file}`, import.meta.url), new URL(file, destination));
}
execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: destination, stdio: 'inherit' });
execFileSync('npm', ['run', 'build'], { cwd: destination, stdio: 'inherit' });
console.log(`Unmodified ext-apps basic-host source: ${revision}`);
