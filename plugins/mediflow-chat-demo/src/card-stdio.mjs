import { readFileSync } from 'node:fs';
let owner, server;
try {
  await import('../../../scripts/register-strip-types-loader.mjs');
  const { createCardServer, fixedCardErrors } = await import('./card-server.mjs');
  const { createCardOwner } = await import('./card-owner.mjs');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const installation = JSON.parse(readFileSync(new URL('../.local/card-installation.json', import.meta.url), 'utf8'));
  owner = createCardOwner(installation);
  ({ server } = await createCardServer(owner));
  await server.connect(fixedCardErrors(new StdioServerTransport()));
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await owner.close(); await server.close();
  }
  process.once('SIGINT', () => { void close().catch(() => {}); });
  process.once('SIGTERM', () => { void close().catch(() => {}); });
  process.stdin.once('end', () => { void close().catch(() => {}); });
} catch {
  await Promise.allSettled([owner?.close(), server?.close()]);
  process.stderr.write('Scheda non disponibile. Apri una nuova vista e riprova.\n');
  process.exitCode = 1;
}
