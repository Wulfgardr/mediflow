import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createLocalUiMcpServer, sanitizeLocalUiMessage } from '../packages/mcp/src/local-ui-server.ts';

const runtime = createLocalUiMcpServer();
const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65_536 });
const send = transport.send.bind(transport);
transport.send = message => send(sanitizeLocalUiMessage(message));
const handle = serveStdio(() => runtime.server, { transport, legacy: 'serve',
  onerror: () => process.stderr.write('MediFlow navigation unavailable.\n') });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  runtime.close(); await handle.close();
}
process.once('SIGINT', close); process.once('SIGTERM', close); process.stdin.once('end', close);
