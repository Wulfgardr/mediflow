import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSyntheticServer } from './server.mjs';

try {
  const { server } = await createSyntheticServer();
  await server.connect(new StdioServerTransport());
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await server.close();
  }
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  process.stdin.once('end', close);
} catch {
  process.stderr.write('MediFlow synthetic prototype unavailable. Build the isolated package first.\n');
  process.exitCode = 1;
}
