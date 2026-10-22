import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
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
const argsSchema = z.object({ operation: z.enum(['prepare', 'share', 'revoke']), view: z.string().uuid(), nonce: z.string().regex(/^[a-f0-9]{64}$/).optional(), gestureProof: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();

export async function createCardServer(owner) {
  const server = new McpServer({ name: 'mediflow-synthetic-card', version: '0.1.0' });
  const extensions = new OpenAIExtensions(server);
  const html = await readFile(new URL('../dist/card.html', import.meta.url), 'utf8');
  const binding = { view: randomUUID(), gestureKey: randomBytes(32).toString('hex') };
  let issued = false;
  const resource = () => {
    if (issued) throw new McpError(ErrorCode.InvalidParams, CARD_DENIED);
    issued = true;
    const instanceHtml = html.replace('__CARD_VIEW__', binding.view).replace('__CARD_KEY__', binding.gestureKey);
    return { contents: [{ uri: CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: instanceHtml,
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } },
      'openai/ui': { preferredDisplayMode: 'inline', availableDisplayModes: ['inline'] },
      'openai/widgetDescription': 'Scheda sintetica in sola lettura. La condivisione richiede un gesto nella vista.' } }] };
  };
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
      const { operation, view, nonce, gestureProof } = parsed.data;
      if (!issued || view !== binding.view) return denied();
      if (operation === 'prepare') { const consentNonce = await owner.prepare(view); return { ...fixed('Scheda sintetica pronta per la tua scelta.'), _meta: { consentNonce } }; }
      if (operation === 'revoke') { await owner.revoke(view); return fixed('Condivisione terminata.'); }
      const expectedProof = createHmac('sha256', Buffer.from(binding.gestureKey, 'hex')).update(nonce ?? '').digest();
      if (!gestureProof || !timingSafeEqual(Buffer.from(gestureProof, 'hex'), expectedProof)) return denied();
      const payload = owner.share(view, nonce);
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
