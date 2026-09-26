/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describeLockedArtifacts, verifyValidatorCache } from './verify-fhir-validator-cache.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const makeLock = () => ({
  schemaVersion: 1, fhirVersion: '4.0.1', javaMajor: 17,
  validator: { version: '6.9.12', sha256: digest('synthetic-jar') },
  packages: [{ name: 'hl7.fhir.r4.core', version: '4.0.1', sha256: digest('synthetic-package') }],
  settings: { prohibitNetworkAccess: true, ignoreDefaultPackageServers: true, servers: [] },
  validation: { terminologyServer: 'n/a', terminologyCache: 'n/a' },
});
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mediflow-fhir-cache-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('matching bytes are not reported as executed validation or conformance', async t => {
  const dir = await fixture(t);
  await writeFile(path.join(dir, 'validator_cli.jar'), 'synthetic-jar');
  await writeFile(path.join(dir, 'hl7.fhir.r4.core#4.0.1.tgz'), 'synthetic-package');
  const result = await verifyValidatorCache(makeLock(), dir);
  assert.equal(result.state, 'ARTIFACT_BYTES_VERIFIED');
  assert.equal(result.resourceValidation, 'NOT_RUN');
  assert.equal(result.profileConformance, 'NOT_RUN');
  assert.equal(result.execution, 'none');
});

test('empty cache explicitly holds every missing artifact', async t => {
  const result = await verifyValidatorCache(makeLock(), await fixture(t));
  assert.equal(result.state, 'HOLD_MISSING_ARTIFACTS');
  assert.equal(result.files.length, 2);
  assert.ok(result.files.every(file => file.state === 'MISSING'));
});

test('mutated bytes are rejected even if the file name/version matches', async t => {
  const dir = await fixture(t);
  await writeFile(path.join(dir, 'validator_cli.jar'), 'modified-jar');
  const result = await verifyValidatorCache(makeLock(), dir);
  assert.equal(result.state, 'REJECTED_ARTIFACTS');
  assert.equal(result.files[0].state, 'HASH_MISMATCH');
});

test('symlinks are rejected rather than followed', async t => {
  const dir = await fixture(t);
  await writeFile(path.join(dir, 'other'), 'synthetic-jar');
  await symlink(path.join(dir, 'other'), path.join(dir, 'validator_cli.jar'));
  const result = await verifyValidatorCache(makeLock(), dir);
  assert.equal(result.files[0].state, 'INVALID_FILE');
});

test('path traversal, duplicate packages, mutable versions and network-enabled locks are rejected', () => {
  for (const mutate of [
    lock => { lock.packages[0].name = '../secret'; },
    lock => { lock.packages.push(lock.packages[0]); },
    lock => { lock.packages[0].version = 'latest'; },
    lock => { lock.settings.prohibitNetworkAccess = false; },
    lock => { lock.settings.servers = ['https://example.test']; },
    lock => { lock.validation.terminologyServer = 'https://example.test'; },
    lock => { lock.packages[0].name = 'another.package'; },
    lock => { lock.validator.sha256 = 'unverified'; },
  ]) {
    const lock = makeLock();
    mutate(lock);
    assert.throws(() => describeLockedArtifacts(lock));
  }
});
