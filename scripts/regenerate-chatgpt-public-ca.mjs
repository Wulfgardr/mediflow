/* Offline extraction of the exact qualified Node public roots, never runtime trust. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const PUBLIC_CA_SOURCE = Object.freeze({
  release: 'Node v24.21.0',
  url: 'https://raw.githubusercontent.com/nodejs/node/v24.21.0/src/node_root_certs.h',
  sha256: '3cc4e524e51a7bb85223de9239688de4b22e8d32fc04e7d0bfca785172cc6a74',
  certificates: 121, bytes: 181304,
  pemSha256: '8403bc9ed3ae3e71b4af96a4d37c23999d7ba8c2fc9411fc6d6feb5e7ee8c4f7',
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function regeneratePublicCa(source = readFileSync(new URL('./fixtures/node-public-ca/node-v24.21.0-root-certs.h', import.meta.url))) {
  if (sha256(source) !== PUBLIC_CA_SOURCE.sha256) throw new Error('public_ca_source_mismatch');
  const groups = source.toString('utf8').match(/(?:"[^"\n]*"\s*)+/gu) ?? [];
  const certificates = groups.map(group => [...group.matchAll(/"[^"\n]*"/gu)].map(([literal]) => JSON.parse(literal)).join(''))
    .filter(value => value.startsWith('-----BEGIN CERTIFICATE-----'));
  const pem = Buffer.from(certificates.join('\n'));
  if (certificates.length !== PUBLIC_CA_SOURCE.certificates || pem.length !== PUBLIC_CA_SOURCE.bytes
      || sha256(pem) !== PUBLIC_CA_SOURCE.pemSha256) throw new Error('public_ca_output_mismatch');
  return pem;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pem = regeneratePublicCa();
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/regenerate-chatgpt-public-ca.mjs <output.pem>');
  writeFileSync(process.argv[2], pem, { flag: 'wx' });
}
