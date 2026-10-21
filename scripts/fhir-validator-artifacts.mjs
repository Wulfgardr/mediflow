import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
export async function snapshotArtifacts(lock, sourceDirectory, runDirectory) {
  const expected = describeLockedArtifacts(lock);
  const directory = await mkdtemp(path.join(runDirectory, 'artifacts-'));
  const files = [];
  try {
    await chmod(directory, 0o700);
    for (const artifact of expected) {
      let source;
      let destination;
      try {
        source = await open(path.join(sourceDirectory, artifact.file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const info = await source.stat();
        if (!info.isFile() || info.size > 350 * 1024 * 1024) throw new Error('INVALID_ARTIFACT_FILE');
        destination = await open(path.join(directory, artifact.file), 'wx', 0o600);
        const hash = createHash('sha256');
        const buffer = Buffer.alloc(1024 * 1024);
        let bytes = 0;
        while (true) {
          const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          bytes += bytesRead;
          if (bytes > 350 * 1024 * 1024) throw new Error('ARTIFACT_TOO_LARGE');
          const chunk = buffer.subarray(0, bytesRead);
          let written = 0;
          while (written < chunk.length) {
            const result = await destination.write(chunk, written, chunk.length - written);
            if (!result.bytesWritten) throw new Error('ARTIFACT_WRITE_FAILED');
            written += result.bytesWritten;
          }
          hash.update(chunk);
        }
        const sha256 = hash.digest('hex');
        if (sha256 !== artifact.sha256) throw new Error('HASH_MISMATCH');
        await destination.chmod(0o400);
        files.push({ ...artifact, sha256, bytes, state: 'MATCH' });
      } catch (cause) {
        throw new Error(`ARTIFACT_INTEGRITY_REJECTED:${artifact.file}`, { cause });
      } finally {
        await destination?.close();
        await source?.close();
      }
    }
    return { directory, files, state: 'ARTIFACT_BYTES_VERIFIED' };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  await acquireArtifacts(JSON.parse(await readFile(lockPath, 'utf8')));
}
