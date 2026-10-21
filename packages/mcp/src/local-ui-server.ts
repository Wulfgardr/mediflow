import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createLocalUiClient } from './local-ui-client.ts';
import { LOCAL_UI_CONTENT, LOCAL_UI_ERROR, LOCAL_UI_RESULT, LOCAL_UI_TOOL_ID, localUiArgumentsSchema } from './local-ui-contract.ts';

export function createLocalUiMcpServer() {
  const server = new McpServer({ name: 'mediflow-local-ui', version: '0.1.0' });
  let client: ReturnType<typeof createLocalUiClient> | null = null;
  try { client = createLocalUiClient(); } catch { /* calls fail closed */ }
  server.registerTool(LOCAL_UI_TOOL_ID, {
    title: 'Continue in local MediFlow',
    description: 'Requests local MediFlow navigation. Login, patient search (including tax code), selection, identity, history and prescription review stay in the separate trusted UI. No patient data is returned. Continue there; this receipt does not confirm display or any clinical action.',
    inputSchema: localUiArgumentsSchema,
    outputSchema: z.object({ status: z.literal('continue_in_mediflow') }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input, context) => {
    try {
      if (!client) throw new Error('navigation_unavailable');
      await client.navigate(input, context.mcpReq.signal);
      return { content: [{ type: 'text', text: LOCAL_UI_CONTENT }], structuredContent: LOCAL_UI_RESULT };
    } catch { return { isError: true, content: [{ type: 'text', text: LOCAL_UI_ERROR }] }; }
  });
  return Object.freeze({ server, close: () => client?.close() });
}

export function sanitizeLocalUiMessage(message: unknown): unknown {
  if (!message || typeof message !== 'object') return message;
  const frame = message as Record<string, unknown>;
  if ('error' in frame) return { jsonrpc: '2.0', id: frame.id ?? null,
    error: { code: -32602, message: LOCAL_UI_ERROR } };
  const result = frame.result as Record<string, unknown> | undefined;
  if (result && 'content' in result) return { jsonrpc: '2.0', id: frame.id,
    result: result.isError ? { isError: true, content: [{ type: 'text', text: LOCAL_UI_ERROR }] }
      : { content: [{ type: 'text', text: LOCAL_UI_CONTENT }], structuredContent: LOCAL_UI_RESULT } };
  return message;
}
