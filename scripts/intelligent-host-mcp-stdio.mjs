#!/usr/bin/env node
/* @Codex */
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createUsefulMcpServer } from '../packages/mcp/src/server.ts';

const runtime = await createUsefulMcpServer();
const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65_536 });
const handle = serveStdio(() => runtime.server, {
    legacy: 'reject',
    transport,
    onerror: () => process.stderr.write('MCP stdio transport error\n'),
});
let closing = false;
async function close() {
    if (closing) return;
    closing = true;
    await handle.close();
    runtime.close();
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
process.stdin.once('end', close);
