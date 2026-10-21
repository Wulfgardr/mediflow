import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBaseProfiles, readOutcomes, assessIssues } from './fhir-r4-outcomes.mjs';
import { isNetworkDenial } from './fhir-validator-offline.mjs';
import { assertJavaVersion, preparePackages, validatorArguments, runIsolatedValidator, withRunHome, createOutputDirectory, runGate } from './validate-fhir-r4.mjs';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, stat, readdir, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { snapshotArtifacts, digest } from './fhir-validator-artifacts.mjs';
import { runValidatorProcess } from './fhir-validator-offline.mjs';

const artifacts = [{ id: 'synthetic', file: 'synthetic.json' }];
const issue = { severity: 'warning', identifier: 'UNKNOWN_EXTENSION', path: 'Bundle.entry[0].resource.extension[0]', message: 'Unknown synthetic extension' };
const baseline = { entries: [{ artifact: 'synthetic', ...issue, count: 1, reason: 'Synthetic test of reviewed exception' }] };
const results = issues => new Map([['synthetic.json', issues]]);
const outcome = { resourceType: 'Bundle', entry: [{ resource: {
  resourceType: 'OperationOutcome', extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/operationoutcome-file', valueString: '/synthetic/synthetic.json' }],
  issue: [{ severity: 'warning', code: 'invalid', details: { text: issue.message }, expression: [issue.path], extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/operationoutcome-message-id', valueCode: issue.identifier }] }],
} }] };

test('OperationOutcome issues, rather than process exit code, drive the result', () => {
  assert.deepEqual(readOutcomes(outcome, artifacts).get('synthetic.json'), [issue]);
  assert.equal(assessIssues(artifacts, results([issue]), { entries: [] }).passed, false);
  assert.equal(assessIssues(artifacts, results([{ ...issue, severity: 'error' }]), baseline).passed, false);
});
test('baseline is exact for artifact, severity, identifier, path, message and occurrence count', () => {
  assert.equal(assessIssues(artifacts, results([issue]), baseline).passed, true);
  for (const change of [{ severity: 'fatal' }, { path: 'Bundle.entry[1]' }, { message: 'Different warning' }, { identifier: 'OTHER' }]) {
    assert.equal(assessIssues(artifacts, results([{ ...issue, ...change }]), baseline).passed, false);
  }
  const duplicate = assessIssues(artifacts, results([issue, issue]), baseline);
  assert.equal(duplicate.new[0].count, 1);
  const stale = assessIssues(artifacts, results([]), baseline);
  assert.equal(stale.stale[0].action, 'REMOVE_FROM_BASELINE');
  assert.equal(stale.passed, false);
  assert.throws(() => assessIssues(artifacts, results([]), { entries: [{ ...baseline.entries[0], reason: '' }] }), /INVALID_REVIEWED_BASELINE/);
});
test('missing, duplicate or malformed outcomes are tool failures', () => {
  assert.throws(() => readOutcomes({ resourceType: 'OperationOutcome', issue: [] }, artifacts), /TOOL_OUTCOME_BUNDLE_REQUIRED/);
  assert.throws(() => readOutcomes({ resourceType: 'Bundle', entry: [] }, artifacts), /TOOL_MISSING_OUTCOME/);
  assert.throws(() => readOutcomes({ ...outcome, entry: [...outcome.entry, ...outcome.entry] }, artifacts), /TOOL_OUTCOME_SOURCE_MISMATCH/);
  const malformed = structuredClone(outcome); malformed.entry[0].resource.issue[0].severity = 'maybe';
  assert.throws(() => readOutcomes(malformed, artifacts), /TOOL_INVALID_ISSUE/);
  const foreign = structuredClone(outcome); foreign.entry[0].resource.extension[0].valueString = '/unexpected.json';
  assert.throws(() => readOutcomes(foreign, artifacts), /TOOL_OUTCOME_SOURCE_MISMATCH/);
});
test('unsupported profile claims, including IPS on a collection, are refused before validation', () => {
  assertBaseProfiles({ resourceType: 'Bundle', type: 'collection' });
  assertBaseProfiles({ resourceType: 'Patient', meta: { profile: ['http://hl7.org/fhir/StructureDefinition/Patient'] } });
  assert.throws(() => assertBaseProfiles({ resourceType: 'Bundle', type: 'collection', meta: { profile: ['http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips'] } }), /UNLOCKED_PROFILE_CLAIM/);
  assert.throws(() => assertBaseProfiles({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', meta: { profile: ['http://synthetic.invalid/profile'] } } }] }), /UNLOCKED_PROFILE_CLAIM/);
});
test('Java must match the lock; local explicit override is never honored in CI', () => {
  assert.equal(assertJavaVersion('openjdk version "17.0.1"', { javaMajor: 17 }, {}).mismatchOverride, false);
  assert.throws(() => assertJavaVersion('openjdk version "25.0.2"', { javaMajor: 17 }, {}), /JAVA_LOCK_MISMATCH/);
  assert.equal(assertJavaVersion('openjdk version "25.0.2"', { javaMajor: 17 }, { MEDIFLOW_FHIR_ALLOW_JAVA_MISMATCH: '1' }).mismatchOverride, true);
  assert.throws(() => assertJavaVersion('openjdk version "25.0.2"', { javaMajor: 17 }, { CI: 'true', MEDIFLOW_FHIR_ALLOW_JAVA_MISMATCH: '1' }), /JAVA_LOCK_MISMATCH/);
});

test('network probes reject ambiguous failure and accept absent IPv6 only in a Linux namespace', () => {
  for (const platform of ['linux', 'darwin']) {
    for (const code of ['TIMEOUT', 'CONNECTED', 'ECONNREFUSED', 'ENOTFOUND']) assert.equal(isNetworkDenial(code, '::1', platform), false);
    assert.equal(isNetworkDenial('EPERM', '1.1.1.1', platform), true);
  }
  assert.equal(isNetworkDenial('EADDRNOTAVAIL', '::1', 'linux'), true);
  assert.equal(isNetworkDenial('EADDRNOTAVAIL', '1.1.1.1', 'linux'), false);
  assert.equal(isNetworkDenial('EADDRNOTAVAIL', '::1', 'darwin'), false);
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'fhir-gate-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function syntheticCache(directory) {
  const cache = path.join(directory, 'cache');
  const source = path.join(directory, 'source/package');
  await mkdir(cache);
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'hl7.fhir.r4.core', version: '4.0.1', license: 'verified-synthetic-package' }));
  const archive = path.join(cache, 'hl7.fhir.r4.core#4.0.1.tgz');
  const tar = spawnSync('tar', ['-czf', archive, '-C', path.dirname(source), 'package']);
  assert.equal(tar.status, 0);
  await writeFile(path.join(cache, 'validator_cli.jar'), 'verified synthetic JAR; never executable');
  const lock = {
    schemaVersion: 1, fhirVersion: '4.0.1', javaMajor: 17,
    validator: { version: '6.9.12', sha256: digest(await readFile(path.join(cache, 'validator_cli.jar'))) },
    packages: [{ name: 'hl7.fhir.r4.core', version: '4.0.1', sha256: digest(await readFile(archive)) }],
    settings: { prohibitNetworkAccess: true, ignoreDefaultPackageServers: true, servers: [] },
    validation: { terminologyServer: 'n/a', terminologyCache: 'n/a' },
  };
  return { cache, lock };
}

test('private snapshot binds tar and JVM input to verified bytes after atomic cache replacement', async t => {
  const directory = await temporary(t);
  const { cache, lock } = await syntheticCache(directory);
  await withRunHome(async home => {
    const snapshot = await snapshotArtifacts(lock, cache, home);
    assert.equal((await stat(snapshot.directory)).mode & 0o777, 0o700);
    for (const file of snapshot.files) {
      const original = await stat(path.join(cache, file.file));
      const copied = await stat(path.join(snapshot.directory, file.file));
      assert.notEqual(copied.ino, original.ino);
      assert.equal(copied.nlink, 1);
      assert.equal(copied.mode & 0o777, 0o400);
      const replacement = path.join(cache, `${file.file}.replacement`);
      await writeFile(replacement, 'replaced after verification');
      await rename(replacement, path.join(cache, file.file));
    }
    const metadata = await preparePackages(lock, home, snapshot.directory);
    assert.equal(metadata[0].license, 'verified-synthetic-package');
    const args = validatorArguments(lock, home, snapshot.directory, [], directory, 'settings', 'outcomes');
    const configFile = path.join(home, 'invocation.json');
    const log = path.join(directory, 'synthetic-jvm.log');
    const shim = "const fs = require('node:fs'); const crypto = require('node:crypto'); const file = process.argv[process.argv.indexOf('-jar') + 1]; console.log(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));";
    await writeFile(configFile, JSON.stringify({ javaExecutable: process.execPath, javaArgs: ['-e', shim, '--', ...args], environment: process.env, networkEvidence: path.join(directory, 'network.json') }));
    const result = await runIsolatedValidator(configFile, home, process.env, log);
    assert.equal(result.status, 0, await readFile(log, 'utf8'));
    assert.equal((await readFile(log, 'utf8')).trim(), lock.validator.sha256);
  }, directory);
});

test('snapshot refuses symlink and changed bytes and removes partial copies', async t => {
  const directory = await temporary(t);
  const { cache, lock } = await syntheticCache(directory);
  const jar = path.join(cache, 'validator_cli.jar');
  await rename(jar, `${jar}.original`);
  await symlink(`${jar}.original`, jar);
  await assert.rejects(snapshotArtifacts(lock, cache, directory), /ARTIFACT_INTEGRITY_REJECTED:validator_cli.jar/);
  await rm(jar);
  await writeFile(jar, 'changed');
  await assert.rejects(snapshotArtifacts(lock, cache, directory), /ARTIFACT_INTEGRITY_REJECTED:validator_cli.jar/);
  assert.equal((await readdir(directory)).some(name => name.startsWith('artifacts-')), false);
});

function assertGone(pid) {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}
async function timeoutFixture(directory) {
  const pids = path.join(directory, 'pids.json');
  const marker = path.join(directory, 'late-marker');
  const descendant = `const fs = require('node:fs'); process.send('ready'); setTimeout(() => fs.writeFileSync(${JSON.stringify(marker)}, 'escaped'), 1800); setInterval(() => {}, 1000);`;
  const parent = `const { spawn } = require('node:child_process'); const fs = require('node:fs'); const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); child.once('message', () => fs.writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.pid, child.pid]))); process.on('SIGTERM', () => { if (child.exitCode !== null || child.signalCode !== null) process.exit(0); else child.once('exit', () => process.exit(0)); }); setInterval(() => {}, 1000);`;
  const cleanup = async () => {
    try {
      for (const pid of JSON.parse(await readFile(pids, 'utf8'))) {
        try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  return { pids, marker, cleanup, config: { javaExecutable: process.execPath, javaArgs: ['-e', parent], environment: process.env, timeoutMs: 800, graceMs: 500, networkEvidence: path.join(directory, 'network.json') } };
}

test('real network sandbox timeout reaps validator and descendant before run-home cleanup', async t => {
  const directory = await temporary(t);
  const fixture = await timeoutFixture(directory);
  try {
    let ownedHome;
    await withRunHome(async home => {
      ownedHome = home;
      const configFile = path.join(home, 'invocation.json');
      const log = path.join(directory, 'validator.log');
      await writeFile(configFile, JSON.stringify(fixture.config));
      const result = await runIsolatedValidator(configFile, home, process.env, log);
      assert.equal(result.status, 2);
      const pids = JSON.parse(await readFile(fixture.pids, 'utf8'));
      for (const pid of pids) assertGone(pid);
      assert.match(await readFile(log, 'utf8'), /VALIDATOR_TERMINATED:SIGTERM/);
      assert.equal((await stat(home)).isDirectory(), true);
    }, directory);
    await assert.rejects(stat(ownedHome), { code: 'ENOENT' });
    await sleep(1900);
    await assert.rejects(stat(fixture.marker), { code: 'ENOENT' });
  } finally { await fixture.cleanup(); }
});

test('validator group escalates to SIGKILL after grace and awaits actual exit', async t => {
  const directory = await temporary(t);
  const marker = path.join(directory, 'marker');
  const pidFile = path.join(directory, 'pid');
  const code = `const fs = require('node:fs'); process.on('SIGTERM', () => {}); fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => fs.writeFileSync(${JSON.stringify(marker)}, 'escaped'), 1500); setInterval(() => {}, 1000);`;
  const result = await runValidatorProcess({ javaExecutable: process.execPath, javaArgs: ['-e', code], environment: process.env, timeoutMs: 500, graceMs: 100 });
  assert.equal(result.escalated, true);
  assert.equal(result.signal, 'SIGKILL');
  assertGone(Number(await readFile(pidFile, 'utf8')));
  await sleep(1600);
  await assert.rejects(stat(marker), { code: 'ENOENT' });
});

test('cancellation terminates validator group and descendants', async t => {
  const directory = await temporary(t);
  const fixture = await timeoutFixture(directory);
  try {
    const controller = new AbortController();
    const completion = runValidatorProcess({ ...fixture.config, timeoutMs: 5000 }, controller.signal);
    try {
      const deadline = Date.now() + 5000;
      while (true) {
        try { await stat(fixture.pids); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; assert.ok(Date.now() < deadline, 'synthetic child must become ready'); await sleep(10); }
      }
    } finally { controller.abort(); }
    assert.equal((await completion).terminated, true);
    for (const pid of JSON.parse(await readFile(fixture.pids, 'utf8'))) assertGone(pid);
  } finally { await fixture.cleanup(); }
});

test('each output directory is unique; explicit output cannot reuse an older run', async t => {
  const directory = await temporary(t);
  const explicit = await createOutputDirectory(path.join(directory, 'report'));
  assert.equal(explicit, path.join(directory, 'report'));
  await assert.rejects(createOutputDirectory(explicit), { code: 'EEXIST' });
  const first = await createOutputDirectory();
  const second = await createOutputDirectory();
  t.after(() => Promise.all([first, second].map(file => rm(file, { recursive: true, force: true }))));
  assert.notEqual(first, second);
  assert.equal(path.dirname(first), tmpdir());
});

test('failure writing reports still cleans the private home', async t => {
  const directory = await temporary(t);
  const outputDirectory = await createOutputDirectory(path.join(directory, 'reports'));
  await mkdir(path.join(outputDirectory, 'report.json'));
  const runRoot = path.join(directory, 'runs');
  const javaDirectory = path.join(directory, 'bin');
  await mkdir(javaDirectory);
  await writeFile(path.join(javaDirectory, 'java'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${javaDirectory}:${originalPath}`;
  try { await assert.rejects(runGate({ outputDirectory, runRoot }), { code: 'EISDIR' }); }
  finally { process.env.PATH = originalPath; }
  assert.deepEqual(await readdir(runRoot), []);
});
