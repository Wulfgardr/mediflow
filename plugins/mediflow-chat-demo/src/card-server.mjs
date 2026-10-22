import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ReadResourceRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';

export const CARD_TOOL = 'mediflow_synthetic_card';
export const CARD_URI = 'ui://mediflow-synthetic-card/reader';
export const CARD_DENIED = 'Scheda non disponibile. Apri una nuova vista e riprova.';
/** @returns {import('@modelcontextprotocol/sdk/types.js').CallToolResult} */
const fixed = text => ({ content: [{ type: 'text', text }] });
const denied = () => ({ ...fixed(CARD_DENIED), isError: true });
const argsSchema = z.object({ operation: z.enum(['prepare', 'share', 'revoke']), view: z.string().uuid() }).strict();

export async function createCardServer(owner) {
  const server = new McpServer({ name: 'mediflow-synthetic-card', version: '0.1.0' });
  const extensions = new OpenAIExtensions(server);
  const html = await readFile(new URL('../dist/card.html', import.meta.url), 'utf8');
  const resource = () => ({ contents: [{ uri: CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: html,
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } },
      'openai/ui': { preferredDisplayMode: 'inline', availableDisplayModes: ['inline'] },
      'openai/widgetDescription': 'Scheda sintetica in sola lettura. La condivisione richiede un gesto nella vista.' } }] });
  registerAppResource(server, 'synthetic-card', CARD_URI, {}, resource);
  registerAppTool(server, CARD_TOOL, {
    title: 'MediFlow — scheda sintetica',
    description: 'Synthetic read-only card. Available only to the interactive view; never an approval command for the model.',
    inputSchema: argsSchema.partial(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: CARD_URI, visibility: ['app'] }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } },
  }, async () => denied());
  server.server.setRequestHandler(CallToolRequestSchema, async request => {
    if (request.params.name !== CARD_TOOL) return denied();
    const args = request.params.arguments;
    if (args === undefined || (args && Object.keys(args).length === 0)) {
      await owner.close();
      return fixed('Apri la vista per scegliere se condividere la scheda sintetica.');
    }
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) return denied();
    try {
      const { operation, view } = parsed.data;
      if (operation === 'prepare') { await owner.prepare(view); return fixed('Scheda sintetica pronta per la tua scelta.'); }
      if (operation === 'revoke') { await owner.revoke(view); return fixed('Condivisione terminata.'); }
      const payload = owner.share(view);
      return { ...fixed('Scheda sintetica condivisa nella vista.'), structuredContent: JSON.parse(payload) };
    } catch { return denied(); }
  });
  server.server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== CARD_URI) throw new McpError(ErrorCode.InvalidParams, CARD_DENIED);
    return resource();
  });
  return { server, extensions };
}

/** @param {import('@modelcontextprotocol/sdk/shared/transport.js').Transport} transport */
export function fixedCardErrors(transport) {
  const send = transport.send.bind(transport);
  transport.send = (message, options) => send('error' in message
    ? { jsonrpc: '2.0', id: message.id, error: { code: message.error.code, message: CARD_DENIED } } : message, options);
  return transport;
}
