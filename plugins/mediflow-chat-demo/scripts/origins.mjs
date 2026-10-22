import { readFile, writeFile } from 'node:fs/promises';
import { exactOrigin } from '../src/fixture-service.mjs';

const local = new URL('../.local/', import.meta.url);
try {
  const observation = JSON.parse(await readFile(new URL('last-request.json', local), 'utf8'));
  const origin = exactOrigin(observation.origin);
  if (process.argv[2] === 'allow-observed' && origin && process.argv[3] === origin) {
    await writeFile(new URL('allowed-origins.json', local), JSON.stringify([origin]) + '\n', { mode: 0o600 });
    console.log('One observed origin allowed. Recheck the service in the same frame.');
  } else if (process.argv[2] === 'inspect') {
    console.log(JSON.stringify(observation));
  } else throw new Error('Invalid operation');
} catch {
  console.error('No matching non-opaque observed origin. Use inspect, then allow-observed with the exact frame origin.');
  process.exitCode = 1;
}
