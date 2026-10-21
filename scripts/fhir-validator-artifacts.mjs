import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { describeLockedArtifacts, verifyValidatorCache } from './verify-fhir-validator-cache.mjs';

export const lockPath = new URL('../contracts/fhir/validator-lock.v1.json', import.meta.url);
export const artifactDirectory = path.join(homedir(), '.cache/mediflow-fhir-validator/artifacts');
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function acquireArtifacts(lock, directory = artifactDirectory) {
  const expected = describeLockedArtifacts(lock);
  await mkdir(directory, { recursive: true });
  const before = await verifyValidatorCache(lock, directory);
  if (before.files.some(file => !['MATCH', 'MISSING'].includes(file.state))) throw new Error('ARTIFACT_INTEGRITY_REJECTED');
  const urls = [lock.validator.url, ...lock.packages.map(item => item.url)];
  for (const [index, artifact] of expected.entries()) {
    if (before.files[index].state === 'MATCH') continue;
    if (!urls[index]?.startsWith('https://')) throw new Error('HTTPS_ARTIFACT_REQUIRED');
    const response = await fetch(urls[index], { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`DOWNLOAD_FAILED:${artifact.file}:${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 350 * 1024 * 1024 || digest(bytes) !== artifact.sha256) throw new Error(`DOWNLOAD_HASH_MISMATCH:${artifact.file}`);
    const destination = path.join(directory, artifact.file);
    const temporary = `${destination}.${process.pid}.partial`;
    try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, destination); }
    finally { await rm(temporary, { force: true }); }
    console.log(`Verified ${artifact.file}`);
  }
  const verified = await verifyValidatorCache(lock, directory);
  if (verified.state !== 'ARTIFACT_BYTES_VERIFIED') throw new Error('ARTIFACT_INTEGRITY_REJECTED');
  return verified;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  await acquireArtifacts(JSON.parse(await readFile(lockPath, 'utf8')));
}
