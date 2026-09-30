import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { viewModel } from './fixture.mjs';

export async function createSyntheticServer() {
  const server = new McpServer({ name: 'mediflow-synthetic', version: '0.1.0' });
  const extensions = new OpenAIExtensions(server);
  const html = await readFile(new URL('../dist/app.html', import.meta.url), 'utf8');
  const uri = 'ui://mediflow-synthetic/review';
  registerAppResource(server, 'synthetic-review', uri, {}, async () => ({ contents: [{
    uri, mimeType: RESOURCE_MIME_TYPE, text: html,
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } },
      'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] } },
  }] }));
  for (const [name, title, type, view] of [
    ['mediflow.synthetic.examples', 'MediFlow — esempi inventati', 'global', 'examples'],
    ['mediflow.synthetic.review', 'Da revisionare — esempi inventati', 'thread', 'review'],
  ]) {
    registerAppTool(server, name, {
      title, description: 'Opens fixed invented review examples. No patient access, clinical actions or writes.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: uri, visibility: ['model', 'app'] },
        'openai/ui': { entrypoints: [{ type }] } },
    }, async (args) => {
      if (Object.keys(args).length) return { isError: true, content: [{ type: 'text', text: 'Only empty arguments are accepted.' }] };
      const data = viewModel(view);
      return { content: [{ type: 'text', text: 'Only invented examples. No clinical data or writes.\n'
        + data.examples.map((example) => `${example.title}: ${example.excerpt}`).join('\n') }],
      structuredContent: data };
    });
  }
  return { server, extensions };
}
