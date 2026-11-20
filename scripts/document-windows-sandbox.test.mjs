import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { documentChildLaunch } from './document-child-launcher.mjs';

function observeProfiles(profiles, remove = false) {
  const names = profiles.map(name => {
    assert.match(name, /^MediFlow\.Document\.[a-f0-9]{32}$/u);
    return "'" + name + "'";
  }).join(', ');
  const program = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DocumentProfile {
  [DllImport("userenv.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  public static extern int CreateAppContainerProfile(string name, string title, string description,
    IntPtr capabilities, uint count, out IntPtr sid);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  public static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll")]
  public static extern IntPtr FreeSid(IntPtr sid);
}
'@
foreach ($name in @(${names})) {
  if ($${remove}) {
    if ([DocumentProfile]::DeleteAppContainerProfile($name) -ne 0) { throw 'Synthetic profile cleanup failed' }
    continue
  }
  $sid = [IntPtr]::Zero
  $status = [DocumentProfile]::CreateAppContainerProfile($name, 'MediFlow lifecycle check',
    'Synthetic document profile lifecycle proof', [IntPtr]::Zero, 0, [ref]$sid)
  if ($status -eq -2147024713) { 'present'; continue }
  if ($status -ne 0) { throw ('CreateAppContainerProfile: 0x{0:X8}' -f $status) }
  [void][DocumentProfile]::FreeSid($sid)
  if ([DocumentProfile]::DeleteAppContainerProfile($name) -ne 0) { throw 'Synthetic probe profile cleanup failed' }
  'absent'
}
`;
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(program, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split(/\r?\n/u);
}

test('Windows removes profiles after completion and cancellation without removing a concurrent profile', {
  skip: process.platform !== 'win32' || process.arch !== 'x64',
  timeout: 90_000,
}, async t => {
  const fixture = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-document-lifecycle-')));
  const jobs = [];
  const terminate = ({ child }) => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };
  t.signal.addEventListener('abort', () => jobs.forEach(terminate), { once: true });
  try {
    for (const file of ['scripts/document-child-network-guard.mjs', 'scripts/document-windows-sandbox/launcher-x64.exe']) {
      const destination = path.join(fixture, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(new URL('../' + file, import.meta.url), destination);
    }

    async function start() {
      const launch = documentChildLaunch(fixture, '-e', {
        args: ["process.stdout.write('ready\\n'); process.stdin.resume();"],
      });
      const child = spawn(launch.command, launch.args, { env: launch.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child.stdin.on('error', () => {});
      let diagnostic = '';
      child.stderr.setEncoding('utf8').on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-2048); });
      const closed = once(child, 'close');
      closed.catch(() => {});
      const job = { launch, child, closed, profile: launch.args[0] };
      jobs.push(job);
      const lines = createInterface({ input: child.stdout });
      await Promise.race([
        once(lines, 'line').then(([line]) => assert.equal(line, 'ready')),
        closed.then(([exit, signal]) => assert.fail(`Worker finished before readiness (${exit}, ${signal}): ${diagnostic}`)),
      ]);
      return job;
    }

    function verifyCleanup(job) {
      assert.equal(job.launch.cleanup(), true);
      assert.equal(job.launch.cleanup(), true);
      assert.equal(fs.existsSync(job.launch.args[1]), false);
    }

    const concurrent = await start();
    const completed = await start();
    assert.notEqual(completed.profile, concurrent.profile);
    assert.deepEqual(observeProfiles([completed.profile, concurrent.profile]), ['present', 'present']);
    completed.child.stdin.end();
    assert.deepEqual(await completed.closed, [0, null]);
    verifyCleanup(completed);
    assert.deepEqual(observeProfiles([completed.profile, concurrent.profile]), ['absent', 'present']);
    t.diagnostic('Completed worker profile absent, concurrent profile present.');

    const cancelled = await start();
    assert.notEqual(cancelled.profile, concurrent.profile);
    assert.notEqual(cancelled.profile, completed.profile);
    assert.deepEqual(observeProfiles([cancelled.profile, concurrent.profile]), ['present', 'present']);
    assert.equal(cancelled.child.kill('SIGKILL'), true);
    assert.deepEqual(await cancelled.closed, [null, 'SIGKILL']);
    const [beforeCleanup, otherProfile] = observeProfiles([cancelled.profile, concurrent.profile]);
    assert.equal(otherProfile, 'present');
    t.diagnostic(`Cancelled worker profile before parent cleanup: ${beforeCleanup}.`);
    verifyCleanup(cancelled);
    assert.deepEqual(observeProfiles([cancelled.profile, concurrent.profile]), ['absent', 'present']);
    t.diagnostic('Cancelled worker profile removed after bootstrap termination, concurrent profile present.');

    concurrent.child.stdin.end();
    assert.deepEqual(await concurrent.closed, [0, null]);
    verifyCleanup(concurrent);
    assert.deepEqual(observeProfiles([concurrent.profile]), ['absent']);
  } finally {
    for (const job of jobs) {
      terminate(job);
      await job.closed.catch(() => {});
      job.launch.cleanup();
    }
    try { if (jobs.length) observeProfiles(jobs.map(job => job.profile), true); }
    finally { fs.rmSync(fixture, { recursive: true, force: true }); }
  }
});
