import assert from 'node:assert/strict';
import test from 'node:test';
import { checkFreshness } from './check-release-usage.mjs';
test('old release snapshot fails', () => {
  assert.throws(() => checkFreshness('2026-09-27', '2026-10-15T12:00:00Z'), /two days/);
});
test('fresh release snapshot and exact two-day boundary pass', () => {
  for (const date of ['2026-10-15','2026-10-14','2026-10-13']) assert.doesNotThrow(() => checkFreshness(date, '2026-10-15T23:59:59Z'));
  assert.throws(() => checkFreshness('2026-10-12', '2026-10-15T00:00:00Z'), /two days/);
});
test('invalid dates fail closed', () => {
  for (const date of ['', '2026-02-30', '/Users/private']) assert.throws(() => checkFreshness(date, '2026-02-28T00:00:00Z'), /Invalid/);
  assert.throws(() => checkFreshness('2026-10-15', 'invalid'));
});

test('CLI checks the actual tag commit through a temporary-directory alias', async t => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-release-usage-cli-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'docs/data'),{recursive:true});
  fs.copyFileSync(new URL('./check-release-usage.mjs',import.meta.url),path.join(root,'scripts/check-release-usage.mjs'));
  const env={...process.env,GIT_AUTHOR_DATE:'2026-11-06T12:00:00Z',GIT_COMMITTER_DATE:'2026-11-06T12:00:00Z',MEDIFLOW_RELEASE_TAG:'v-fixture'};
  const git=(...args)=>assert.equal(spawnSync('git',args,{cwd:root,env}).status,0);
  git('init');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','synthetic');git('tag','v-fixture');
  for(const [date,status] of [['2026-09-27',1],['2026-11-06',0]]) {
    fs.writeFileSync(path.join(root,'docs/data/development-usage.json'),JSON.stringify({snapshotDate:date}));
    const result=spawnSync(process.execPath,[path.join(root,'scripts/check-release-usage.mjs')],{cwd:root,env,encoding:'utf8'});
    assert.equal(result.status,status,result.stderr);
    if(status)assert.match(result.stderr,/two days older/);else assert.match(result.stdout,/snapshot is fresh/);
  }
});
