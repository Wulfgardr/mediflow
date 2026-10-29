import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { archiveBrowserPort } from './local-ui-runtime.mjs';
import { localUiArchiveLock } from './launcher-state.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-port-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { home: root, env: {}, platform: process.platform };
  const archive = name => {
    const data = path.join(root, name); fs.mkdirSync(data);
    const file = path.join(path.dirname(localUiArchiveLock(data, options)), 'browser-port.json');
    return { data, file };
  };
  return { options, archive };
}
async function listener(t) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server;
}
function fresh(data, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e',
      `import {archiveBrowserPort} from ${JSON.stringify(new URL('./local-ui-runtime.mjs', import.meta.url).href)}; console.log(await archiveBrowserPort(process.argv[1], JSON.parse(process.argv[2])));`, data, JSON.stringify(options)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; child.stdout.on('data', bytes => out += bytes); child.stderr.on('data', bytes => err += bytes);
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve(Number(out.trim())) : reject(new Error(err)));
  });
}
test('two stopped archives with the same preferred port receive exclusive persistent reservations', async t => {
  const f = fixture(t), a = f.archive('a'), b = f.archive('b');
  const probe = await listener(t), preferred = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  for (const archive of [a, b]) fs.writeFileSync(archive.file, JSON.stringify({ port: preferred }));
  const first = await fresh(a.data, f.options);
  const second = await fresh(b.data, f.options);
  assert.equal(first, preferred);
  assert.notEqual(second, first, 'A stopped archive still owns its port');
  assert.equal(await fresh(a.data, f.options), first);
  assert.equal(await fresh(b.data, f.options), second);
});
test('concurrent processes cannot reserve the same preferred port', async t => {
  const f = fixture(t), archives = ['a', 'b', 'c', 'd'].map(f.archive);
  const probe = await listener(t), preferred = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  for (const archive of archives) fs.writeFileSync(archive.file, JSON.stringify({ port: preferred }));
  const ports = await Promise.all(archives.map(a => fresh(a.data, f.options)));
  assert.equal(new Set(ports).size, archives.length);
});
test('foreign listener survives fallback; original draft origin returns after it leaves', async t => {
  const f = fixture(t), a = f.archive('a');
  const original = await archiveBrowserPort(a.data, f.options);
  const blocker = net.createServer();
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(original, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  const fallback = await fresh(a.data, f.options);
  assert.notEqual(fallback, original);
  assert.equal(blocker.listening, true);
  assert.equal(await fresh(a.data, f.options), fallback);
  const b = f.archive('b'); fs.writeFileSync(b.file, JSON.stringify({ port: original }));
  assert.notEqual(await fresh(b.data, f.options), original);
  await new Promise(resolve => blocker.close(resolve));
  assert.equal(await fresh(a.data, f.options), original, 'Browser draft remains at the original origin');
});
test('first concurrent calls for one archive converge on the published port without leaking reservations', async t => {
  const f = fixture(t), a = f.archive('same');
  const ports = await Promise.all([archiveBrowserPort(a.data, f.options), archiveBrowserPort(a.data, f.options)]);
  const published = JSON.parse(fs.readFileSync(a.file, 'utf8')).port;
  assert.deepEqual(ports, [published, published]);
  const registry = path.join(path.dirname(path.dirname(a.file)), 'browser-ports');
  assert.deepEqual(fs.readdirSync(registry), [String(published)]);
});

test('first concurrent processes for the same archive use one published origin', async t => {
  const f = fixture(t);
  for (let run = 0; run < 10; run++) {
    const a = f.archive(`same-process-${run}`);
    const ports = await Promise.all([fresh(a.data, f.options), fresh(a.data, f.options)]);
    const published = JSON.parse(fs.readFileSync(a.file, 'utf8')).port;
    assert.deepEqual(ports, [published, published]);
  }
});
