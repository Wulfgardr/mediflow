#!/usr/bin/env node
/* @Codex */
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const PROTOCOL_VERSION = '2026-07-28';
const TOOL_NAME = 'mediflow.system.headless_status.v1';
const STATUS = Object.freeze({
    schemaVersion: 'mediflow.system.headless-status.v1',
    candidateVersion: '0.8.5',
    protocolVersion: PROTOCOL_VERSION,
    dataScope: 'non_phi_system_status',
    canonicalHeadlessAnchors: 66,
    generalOperationsGrantable: 0,
    soapMcpBinding: 'unavailable',
    writes: 0,
    apply: 'none',
    claim: 'MCP_PROTOCOL_SLICE_ONLY',
});
const outputSchema = z.object({
    schemaVersion: z.literal(STATUS.schemaVersion),
    candidateVersion: z.literal(STATUS.candidateVersion),
    protocolVersion: z.literal(STATUS.protocolVersion),
    dataScope: z.literal(STATUS.dataScope),
    canonicalHeadlessAnchors: z.literal(STATUS.canonicalHeadlessAnchors),
    generalOperationsGrantable: z.literal(STATUS.generalOperationsGrantable),
    soapMcpBinding: z.literal(STATUS.soapMcpBinding),
    writes: z.literal(STATUS.writes),
    apply: z.literal(STATUS.apply),
    claim: z.literal(STATUS.claim),
}).strict();

function createServer() {
    const server = new McpServer({ name: 'mediflow-intelligent-host', version: '0.8.5' });
    server.registerTool(TOOL_NAME, {
        title: 'MediFlow headless status',
        description: 'Returns bounded non-PHI status for the local MCP protocol slice.',
        inputSchema: z.object({}).strict(),
        outputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async () => ({
        content: [{ type: 'text', text: 'MediFlow 0.8.5 MCP status: non-PHI, writes 0, apply none.' }],
        structuredContent: STATUS,
    }));
    return server;
}

const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65_536 });
const handle = serveStdio(createServer, {
    legacy: 'reject',
    transport,
    onerror: () => process.stderr.write('MCP stdio transport error\n'),
});
let closing = false;
async function close() {
    if (closing) return;
    closing = true;
    await handle.close();
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
