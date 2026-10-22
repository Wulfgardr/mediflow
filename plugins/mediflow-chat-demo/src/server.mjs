import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ReadResourceRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';

export const TOOL = 'mediflow_chat_demo_open';
export const URI = 'ui://mediflow-chat-demo/reader';
/** @returns {import('@modelcontextprotocol/sdk/types.js').CallToolResult} */
export const receipt = () => ({ content: [{ type: 'text', text: '{"status":"demo_view_ready"}' }] });
const denied = () => ({ isError: true, content: [{ type: 'text', text: 'Demo request rejected. Only empty arguments are accepted.' }] });

export async function createDemoServer({ endpoint, serviceId }) {
  const server = new McpServer({ name: 'mediflow-chat-demo', version: '0.1.0' });
  const extensions = new OpenAIExtensions(server);
  const template = await readFile(new URL('../dist/app.html', import.meta.url), 'utf8');
  const html = template.replace('"__DEMO_CONNECTION__"', JSON.stringify({ endpoint, serviceId }));
  const resource = () => ({ contents: [{ uri: URI, mimeType: RESOURCE_MIME_TYPE, text: html,
    _meta: { ui: { csp: { connectDomains: [endpoint], resourceDomains: [] } },
      'openai/ui': { preferredDisplayMode: 'inline', availableDisplayModes: ['inline'] } },
  }] });
  registerAppResource(server, 'demo-reader', URI, {}, resource);
  registerAppTool(server, TOOL, {
    title: 'MediFlow — ambiente dimostrativo',
    description: 'Open the inline read-only MediFlow demo with invented examples. No identifiers, patient access or clinical actions. Returns only a constant technical status.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: URI, visibility: ['model'] }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } },
  }, async () => receipt());
  server.server.setRequestHandler(CallToolRequestSchema, async request => {
    const args = request.params.arguments;
    return request.params.name === TOOL && (args === undefined || (args && Object.keys(args).length === 0))
      ? receipt() : denied();
  });
  server.server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== URI) throw new McpError(ErrorCode.InvalidParams, 'Demo resource unavailable.');
    return resource();
  });
  return { server, extensions };
}
