import { testInstallation } from './card-runtime.mjs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const { createCardOwner } = await import('../src/card-owner.mjs');
const { createCardServer, fixedCardErrors } = await import('../src/card-server.mjs');
const owner = createCardOwner(testInstallation());
const clock = Date.now;
let offset = 0;
if (process.argv.includes('--expired')) Date.now = () => clock() + offset;
const adapterOwner = { ...owner, async prepare(view) { await owner.prepare(view); if (process.argv.includes('--expired')) offset = 120_000; } };
const { server } = await createCardServer(adapterOwner);
await server.connect(fixedCardErrors(new StdioServerTransport()));
let closing = false;
async function close() { if (closing) return; closing = true; await owner.close(); await server.close(); }
process.stdin.once('end', close); process.once('SIGTERM', close); process.once('SIGINT', close);
