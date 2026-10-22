import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFixtureService } from './fixture-service.mjs';
import { createDemoServer } from './server.mjs';

const local = new URL('../.local/', import.meta.url);
let fixture;
let server;
try {
  mkdirSync(local, { recursive: true, mode: 0o700 });
  fixture = await createFixtureService({
    allowedOrigins: () => {
      const data = JSON.parse(readFileSync(new URL('allowed-origins.json', local), 'utf8'));
      return Array.isArray(data) && data.every(item => typeof item === 'string') ? data : [];
    },
    observe: event => writeFileSync(new URL('last-request.json', local), JSON.stringify(event) + '\n', { mode: 0o600 }),
  });
  ({ server } = await createDemoServer(fixture));
  await server.connect(new StdioServerTransport());
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await server.close(); await fixture.close();
  }
  process.once('SIGINT', close); process.once('SIGTERM', close); process.stdin.once('end', close);
} catch {
  await server?.close(); await fixture?.close();
  process.stderr.write('MediFlow chat demo unavailable. Build the isolated package first.\n');
  process.exitCode = 1;
}
