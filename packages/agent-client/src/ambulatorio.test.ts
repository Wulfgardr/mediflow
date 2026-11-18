import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('the Codex marketplace ships the Ambulatorio skill and its local MCP server', () => {
    const marketplace = JSON.parse(fs.readFileSync('.agents/plugins/marketplace.json', 'utf8'));
    const plugin = marketplace.plugins.find((entry: { name: string }) => entry.name === 'mediflow-ambulatorio');
    assert.ok(plugin);
    const root = plugin.source.path;
    assert.match(fs.readFileSync(root + '/skills/ambulatorio-visita/SKILL.md', 'utf8'), /mediflow_deposita_visita/);
    const definition = JSON.parse(fs.readFileSync(root + '/.mcp.json', 'utf8'));
    assert.equal(definition.mcpServers['mediflow-visit-agent'].command, 'node');
    assert.ok(fs.existsSync(root + '/start.mjs'));
});
