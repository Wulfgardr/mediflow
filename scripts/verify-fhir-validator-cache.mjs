/* @Codex */
// Offline research tooling. Byte identity is not resource/profile conformance.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultLock = new URL('../contracts/fhir/validator-lock.v1.json', import.meta.url);
const shaPattern = /^[a-f0-9]{64}$/u;
const versionPattern = /^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)*$/u;
const packagePattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const maxArtifactBytes = 350 * 1024 * 1024;

export function describeLockedArtifacts(lock) {
  if (lock?.schemaVersion !== 1 || lock.fhirVersion !== '4.0.1' || lock.javaMajor !== 17
      || !versionPattern.test(lock.validator?.version ?? '')
      || !shaPattern.test(lock.validator?.sha256 ?? '')
      || !Array.isArray(lock.packages) || lock.packages.length < 1 || lock.packages.length > 64
      || lock.settings?.prohibitNetworkAccess !== true
      || lock.settings?.ignoreDefaultPackageServers !== true
      || !Array.isArray(lock.settings?.servers) || lock.settings.servers.length !== 0
      || lock.validation?.terminologyServer !== 'n/a'
      || lock.validation?.terminologyCache !== 'n/a') throw new Error('INVALID_OFFLINE_VALIDATOR_LOCK');
  const artifacts = [{ file: 'validator_cli.jar', sha256: lock.validator.sha256 }];
  const ids = new Set();
  for (const item of lock.packages) {
    if (!packagePattern.test(item?.name ?? '') || !versionPattern.test(item?.version ?? '')
        || !shaPattern.test(item?.sha256 ?? '')) throw new Error('INVALID_PACKAGE_LOCK');
    const id = item.name + '#' + item.version;
    if (ids.has(id)) throw new Error('DUPLICATE_PACKAGE_LOCK');
    ids.add(id);
    artifacts.push({ file: id + '.tgz', sha256: item.sha256 });
  }
  if (!ids.has('hl7.fhir.r4.core#4.0.1')) throw new Error('R4_CORE_LOCK_REQUIRED');
  return artifacts;
}

export async function verifyValidatorCache(lock, artifactsDirectory) {
  const expected = describeLockedArtifacts(lock);
  if (typeof artifactsDirectory !== 'string' || !artifactsDirectory.trim()) {
    throw new Error('EXPLICIT_ARTIFACT_DIRECTORY_REQUIRED');
  }
  const root = await realpath(artifactsDirectory);
  if (!(await lstat(root)).isDirectory()) throw new Error('ARTIFACT_DIRECTORY_REQUIRED');
  const files = [];
  for (const artifact of expected) {
    const file = path.join(root, artifact.file);
    let info;
    try { info = await lstat(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('ARTIFACT_UNREADABLE');
      files.push({ file: artifact.file, state: 'MISSING' });
      continue;
    }
    // Refuse symlink indirection or non-files; never resolve an arbitrary local data source.
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxArtifactBytes) {
      files.push({ file: artifact.file, state: 'INVALID_FILE' });
      continue;
    }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const actual = hash.digest('hex');
    files.push({ file: artifact.file, state: actual === artifact.sha256 ? 'MATCH' : 'HASH_MISMATCH',
      bytes: info.size, sha256: actual });
  }
  const invalid = files.some(file => !['MATCH', 'MISSING'].includes(file.state));
  const missing = files.some(file => file.state === 'MISSING');
  return {
    schemaVersion: 'mediflow.fhir-validator-cache-check.v1',
    state: invalid ? 'REJECTED_ARTIFACTS' : missing ? 'HOLD_MISSING_ARTIFACTS' : 'ARTIFACT_BYTES_VERIFIED',
    fhirVersion: lock.fhirVersion, validatorVersion: lock.validator.version, files,
    execution: 'none', network: 'none', resourceValidation: 'NOT_RUN',
    profileConformance: 'NOT_RUN', institutionalAccess: 'NOT_ASSESSED',
    claim: 'Only local artifact bytes were checked against the supplied lock; no validator was executed.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--artifacts-dir' || !args[1]
        || args[1].startsWith('--')) throw new Error('USAGE: --artifacts-dir <local-directory>');
    const lockBytes = await readFile(defaultLock);
    const result = await verifyValidatorCache(JSON.parse(lockBytes), args[1]);
    result.lockSha256 = createHash('sha256').update(lockBytes).digest('hex');
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.state === 'ARTIFACT_BYTES_VERIFIED' ? 0
      : result.state === 'HOLD_MISSING_ARTIFACTS' ? 2 : 1;
  } catch (error) {
    console.error(JSON.stringify({ state: 'ERROR', code: error.message, resourceValidation: 'NOT_RUN' }));
    process.exitCode = 1;
  }
}
