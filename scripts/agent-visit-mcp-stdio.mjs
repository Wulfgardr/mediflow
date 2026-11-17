import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createAgentVisitMcpServer } from '../packages/agent-client/src/mcp.ts';

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--credenziali' || !args[1])) throw new Error('AGENT_INPUT_INVALID');
const server = createAgentVisitMcpServer(args[1]);
const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65_536 });
const handle = serveStdio(() => server, { legacy: 'reject', transport, onerror: () => process.stderr.write('AGENT_MCP_UNAVAILABLE\n') });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void handle.close(); });
process.stdin.once('end', () => { void handle.close(); });
