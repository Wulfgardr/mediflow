/* @Codex */
import { McpServer } from '@modelcontextprotocol/server';
import {
  CAPABILITIES_TOOL_ID, CHECKUP_STATUS_TRANSITION_OPERATION_ID, FOLLOW_UP_PROPOSAL_OPERATION_ID,
  HEADLESS_STATUS_TOOL_ID, OPEN_LOOPS_OPERATION_ID,
  SEMANTIC_QUERY_OPERATION_ID, TERMINOLOGY_OPERATION_ID, capabilitiesOutputSchema, followUpProposalArgumentsSchema,
  followUpProposalOutputSchema, headlessStatusOutputSchema, openLoopsArgumentsSchema, openLoopsOutputSchema,
  semanticQueryArgumentsSchema, semanticQueryOutputSchema, systemArgumentsSchema, terminologyArgumentsSchema,
  terminologyOutputSchema,
  checkupStatusTransitionArgumentsSchema, checkupStatusTransitionOutputSchema,
} from './contracts.ts';
import { OperationClientError, createOperationClient } from './operation-client.ts';

const annotations = Object.freeze({
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
});
const proposalAnnotations = Object.freeze({ ...annotations, idempotentHint: false });
const toolError = (error: unknown) => {
  const code = error instanceof OperationClientError ? error.denialCode ?? error.code : 'operation_unavailable';
  const safe = /^(?:host_unbound|protocol_invalid|operation_denied|cancelled|timeout|service_failed)$/u.test(code)
    ? code : 'operation_unavailable';
  return { isError: true as const, content: [{ type: 'text' as const, text: `MediFlow operation denied: ${safe}.` }] };
};

export async function createUsefulMcpServer() {
  const server = new McpServer({ name: 'mediflow-intelligent-host', version: '0.8.5' });
  let client: ReturnType<typeof createOperationClient> | null = null;
  try { client = createOperationClient(); } catch { client = null; }
  const bound = () => {
    if (!client) throw new OperationClientError('host_unbound');
    return client;
  };
  server.registerTool(HEADLESS_STATUS_TOOL_ID, {
    title: 'MediFlow headless status',
    description: 'Returns bounded non-PHI status after checking the inherited host RPC binding.',
    inputSchema: systemArgumentsSchema, outputSchema: headlessStatusOutputSchema, annotations,
    _meta: { 'mediflow/maximumStage': 'read_only', 'mediflow/surfaceKind': 'rpc_status' },
  }, async (_args, context) => {
    try {
      const output = await bound().status(context.mcpReq.signal);
      return { content: [{ type: 'text', text: 'MediFlow 0.8.5 MCP status: non-PHI, writes 0, apply none.' }],
        structuredContent: output };
    } catch (error) { return toolError(error); }
  });
  server.registerTool(CAPABILITIES_TOOL_ID, {
    title: 'List governed capabilities',
    description: 'Lists the exact bounded operations bound by the trusted host RPC catalog.',
    inputSchema: systemArgumentsSchema, outputSchema: capabilitiesOutputSchema, annotations,
    _meta: { 'mediflow/maximumStage': 'read_only', 'mediflow/surfaceKind': 'rpc_catalog' },
  }, async (_args, context) => {
    try {
      const output = await bound().publicCatalog(context.mcpReq.signal);
      return { content: [{ type: 'text', text: `MediFlow exposes ${output.operations.length} operation(s).` }],
        structuredContent: output };
    } catch (error) { return toolError(error); }
  });
  server.registerTool(TERMINOLOGY_OPERATION_ID, {
    title: 'Search local terminology',
    description: 'Searches the bounded local LOINC or UCUM catalog. No patient context or writes.',
    inputSchema: terminologyArgumentsSchema, outputSchema: terminologyOutputSchema, annotations,
    _meta: { 'mediflow/capabilityId': TERMINOLOGY_OPERATION_ID, 'mediflow/maximumStage': 'read_only' },
  }, async (args, context) => {
    try {
      const output = await bound().searchTerminology(args, context.mcpReq.signal);
      return { content: [{ type: 'text', text: `Terminology search returned ${output.items.length} item(s).` }],
        structuredContent: output };
    } catch (error) { return toolError(error); }
  });
  server.registerTool(OPEN_LOOPS_OPERATION_ID, {
    title: 'Read selected patient open loops',
    description: 'Reads minimized open-loop references for the patient selected by the trusted host.',
    inputSchema: openLoopsArgumentsSchema, outputSchema: openLoopsOutputSchema, annotations,
    _meta: { 'mediflow/capabilityId': OPEN_LOOPS_OPERATION_ID, 'mediflow/maximumStage': 'read_only' },
  }, async (_args, context) => {
    try {
      const output = await bound().readOpenLoops(context.mcpReq.signal);
      return { content: [{ type: 'text', text: `Open-loops read returned ${output.items.length} item(s).` }],
        structuredContent: output };
    } catch (error) { return toolError(error); }
  });
  server.registerTool(FOLLOW_UP_PROPOSAL_OPERATION_ID, {
    title: 'Propose selected patient follow-up reviews',
    description: 'Maps trusted-host Open Loops to bounded review actions. Proposal only; no apply or clinical writes.',
    inputSchema: followUpProposalArgumentsSchema, outputSchema: followUpProposalOutputSchema,
    annotations: proposalAnnotations,
    _meta: { 'mediflow/capabilityId': FOLLOW_UP_PROPOSAL_OPERATION_ID,
      'mediflow/maximumStage': 'proposal_only' },
  }, async (args, context) => {
    try {
      const output = await bound().proposeOpenLoopsFollowUp(args, context.mcpReq.signal);
      return { content: [{ type: 'text',
        text: `Follow-up proposal returned ${output.items.length} review item(s); apply none.` }],
      structuredContent: output };
    } catch (error) { return toolError(error); }
  });
  server.registerTool(SEMANTIC_QUERY_OPERATION_ID, {
    title: 'Execute bounded semantic query',
    description: 'Runs one strict read-only plan over two allowlisted local operations. No writes.',
    inputSchema: semanticQueryArgumentsSchema, outputSchema: semanticQueryOutputSchema, annotations,
    _meta: { 'mediflow/capabilityId': SEMANTIC_QUERY_OPERATION_ID,
      'mediflow/maximumStage': 'read_only', 'mediflow/surfaceKind': 'bounded_orchestration' },
  }, async (args, context) => {
    try {
      const output = await bound().executeSemanticQuery(args, context.mcpReq.signal);
      return { content: [{ type: 'text',
        text: `Semantic query completed ${output.steps.length} read step(s); writes 0, apply none.` }],
      structuredContent: output };
    } catch (error) { return toolError(error); }
  });
  server.registerTool(CHECKUP_STATUS_TRANSITION_OPERATION_ID, {
    title: 'Preview a selected checkup status transition',
    description: 'Creates a bounded preview only. A physician must confirm separately in trusted MediFlow UI.',
    inputSchema: checkupStatusTransitionArgumentsSchema, outputSchema: checkupStatusTransitionOutputSchema,
    annotations: proposalAnnotations,
    _meta: { 'mediflow/capabilityId': CHECKUP_STATUS_TRANSITION_OPERATION_ID,
      'mediflow/maximumStage': 'proposal_only', 'mediflow/surfaceKind': 'trusted_ui_confirmation_required' },
  }, async (args, context) => {
    try {
      const output = await bound().previewCheckupStatusTransition(args, context.mcpReq.signal);
      const text = output.outcome === 'proposed'
        ? 'Checkup transition preview created; trusted MediFlow UI confirmation is required.'
        : `Checkup transition preview denied: ${output.denialCode}.`;
      return { content: [{ type: 'text', text }], structuredContent: output };
    } catch (error) { return toolError(error); }
  });
  return Object.freeze({ server, close: () => client?.close() });
}
