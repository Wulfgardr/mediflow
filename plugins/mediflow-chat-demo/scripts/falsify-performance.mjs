import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const file = new URL('../dist/app.html', import.meta.url);
const original = await readFile(file, 'utf8');
const mutations = [
  { name: 'resize', before: 'height: var(--view-height, 720px);', after: 'height: auto;', expected: 'resize-follow conversation scroll' },
  { name: 'bundle', before: '</html>', after: `<!--${randomBytes(300_000).toString('base64')}--></html>`, expected: 'bundle gzip budget' },
  { name: 'paint', before: '<title>', after: '<script>const until=performance.now()+400;while(performance.now()<until){}</script><title>', expected: 'tool-to-card FCP budget' },
  { name: 'interaction', before: '</body>', after: '<script>document.addEventListener("click",()=>{const until=performance.now()+100;while(performance.now()<until){}},true)</script></body>', expected: 'interaction presentation upper bound' },
  { name: 'animation', before: 'animation: reveal 120ms', after: 'animation: reveal 400ms', expected: 'animation duration budget' },
  { name: 'jank', before: '</body>', after: '<script>document.addEventListener("animationstart",()=>setTimeout(()=>{const until=performance.now()+100;while(performance.now()<until){}},50))</script></body>', expected: 'animation frame gap budget' },
];
try {
  for (const mutation of mutations) {
    assert.equal(original.split(mutation.before).length, 2, `${mutation.name}: one mutation target`);
    await writeFile(file, original.replace(mutation.before, mutation.after));
    const result = spawnSync(process.execPath, ['scripts/reference-performance.mjs', '--runs=1', `--label=negative-${mutation.name}`], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 45_000 });
    await writeFile(new URL(`../.local/performance-negative-${mutation.name}.log`, import.meta.url), result.stdout + result.stderr);
    assert.equal(result.status, 1, `${mutation.name}: mutation must fail`);
    assert.ok(result.stderr.includes(mutation.expected), `${mutation.name}: must fail the targeted budget`);
    console.log(`PASS negative control: ${mutation.name}`);
  }
} finally { await writeFile(file, original); }
