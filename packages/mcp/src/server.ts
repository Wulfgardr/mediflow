/* @Codex */
import { McpServer } from '@modelcontextprotocol/server';
import {
  CAPABILITIES_TOOL_ID, HEADLESS_STATUS_TOOL_ID, OPEN_LOOPS_OPERATION_ID, TERMINOLOGY_OPERATION_ID,
  capabilitiesOutputSchema, headlessStatusOutputSchema, openLoopsArgumentsSchema, openLoopsOutputSchema,
  systemArgumentsSchema, terminologyArgumentsSchema, terminologyOutputSchema,
} from './contracts.ts';
import { OperationClientError, createOperationClient } from './operation-client.ts';

const annotations = Object.freeze({
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
});
const toolError = (error: unknown) => {
  const code = error instanceof OperationClientError ? error.denialCode ?? error.code : 'operation_unavailable';
  const safe = /^(?:host_unbound|protocol_invalid|operation_denied|cancelled|timeout|service_failed)$/u.test(code)
    ? code : 'operation_unavailable';
  return { isError: true as const, content: [{ type: 'text' as const, text: `MediFlow operation denied: ${safe}.` }] };
};

export async function createUsefulMcpServer() {
  const server = new McpServer({ name: 'mediflow-intelligent-host', version: '0.8.5' });
  let client: ReturnType<typeof createOperationClient> | null = null;
  let catalog: Awaited<ReturnType<ReturnType<typeof createOperationClient>['catalog']>> = [];
  try { client = createOperationClient(); catalog = await client.catalog(); }
  catch { client?.close(); client = null; }
  const has = (operationId: string) => catalog.some((operation) => operation.operationId === operationId);
  if (client) {
    const bound = client;
    server.registerTool(HEADLESS_STATUS_TOOL_ID, {
      title: 'MediFlow headless status',
      description: 'Returns bounded non-PHI status after checking the inherited host RPC binding.',
      inputSchema: systemArgumentsSchema, outputSchema: headlessStatusOutputSchema, annotations,
      _meta: { 'mediflow/maximumStage': 'read_only', 'mediflow/surfaceKind': 'rpc_status' },
    }, async (_args, context) => {
      try {
        const output = await bound.status(context.mcpReq.signal);
        return { content: [{ type: 'text', text: 'MediFlow 0.8.5 MCP status: non-PHI, writes 0, apply none.' }],
          structuredContent: output };
      } catch (error) { return toolError(error); }
    });
    server.registerTool(CAPABILITIES_TOOL_ID, {
      title: 'List governed capabilities',
      description: 'Lists the exact read-only operations bound by the trusted host RPC catalog.',
      inputSchema: systemArgumentsSchema, outputSchema: capabilitiesOutputSchema, annotations,
      _meta: { 'mediflow/maximumStage': 'read_only', 'mediflow/surfaceKind': 'rpc_catalog' },
    }, async (_args, context) => {
      try {
        const output = await bound.publicCatalog(context.mcpReq.signal);
        return { content: [{ type: 'text', text: `MediFlow exposes ${output.operations.length} operation(s).` }],
          structuredContent: output };
      } catch (error) { return toolError(error); }
    });
  }
  if (client && has(TERMINOLOGY_OPERATION_ID)) {
    const bound = client;
    server.registerTool(TERMINOLOGY_OPERATION_ID, {
      title: 'Search local terminology',
      description: 'Searches the bounded local LOINC or UCUM catalog. No patient context or writes.',
      inputSchema: terminologyArgumentsSchema, outputSchema: terminologyOutputSchema, annotations,
      _meta: { 'mediflow/capabilityId': TERMINOLOGY_OPERATION_ID, 'mediflow/maximumStage': 'read_only' },
    }, async (args, context) => {
      try {
        const output = await bound.searchTerminology(args, context.mcpReq.signal);
        return { content: [{ type: 'text', text: `Terminology search returned ${output.items.length} item(s).` }],
          structuredContent: output };
      } catch (error) { return toolError(error); }
    });
  }
  if (client && has(OPEN_LOOPS_OPERATION_ID)) {
    const bound = client;
    server.registerTool(OPEN_LOOPS_OPERATION_ID, {
      title: 'Read selected patient open loops',
      description: 'Reads minimized open-loop references for the patient selected by the trusted host.',
      inputSchema: openLoopsArgumentsSchema, outputSchema: openLoopsOutputSchema, annotations,
      _meta: { 'mediflow/capabilityId': OPEN_LOOPS_OPERATION_ID, 'mediflow/maximumStage': 'read_only' },
    }, async (_args, context) => {
      try {
        const output = await bound.readOpenLoops(context.mcpReq.signal);
        return { content: [{ type: 'text', text: `Open-loops read returned ${output.items.length} item(s).` }],
          structuredContent: output };
      } catch (error) { return toolError(error); }
    });
  }
  return Object.freeze({ server, close: () => client?.close() });
}
