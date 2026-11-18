import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('the Codex marketplace ships the Ambulatorio skill and its local MCP server', () => {
    const marketplace = JSON.parse(fs.readFileSync('.agents/plugins/marketplace.json', 'utf8'));
    const plugin = marketplace.plugins.find((entry: { name: string }) => entry.name === 'mediflow-ambulatorio');
    assert.ok(plugin);
    const root = plugin.source.path;
    assert.match(fs.readFileSync(root + '/skills/ambulatorio-visita/SKILL.md', 'utf8'), /mediflow_deposita_visita/);
    const manifest = JSON.parse(fs.readFileSync(root + '/.codex-plugin/plugin.json', 'utf8'));
    const definition = JSON.parse(fs.readFileSync(root + '/' + manifest.mcpServers, 'utf8'));
    assert.equal(definition.mcpServers['mediflow-visit-agent'].command, 'node');
    assert.ok(fs.existsSync(root + '/start.mjs'));
});

test('Ambulatorio refuses physical aliases of synchronized destinations before writing', {
    skip: process.platform === 'win32',
}, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-ambulatorio-cloud-test-'));
    try {
        const cloud = path.join(home, 'synthetic-cloud');
        const downloads = path.join(home, 'synthetic-intake');
        fs.mkdirSync(cloud, { mode: 0o700 });
        fs.mkdirSync(downloads, { mode: 0o700 });
        fs.symlinkSync(cloud, path.join(home, 'Documents'));
        fs.symlinkSync(cloud, path.join(home, 'alias'));
        for (const entry of ['Documents', 'alias']) {
            const destination = path.join(home, entry, 'ambulatorio');
            const result = spawnSync(process.execPath, ['plugins/mediflow-ambulatorio/start.mjs', 'configura',
                'http://127.0.0.1:65534', downloads], { env: { ...process.env, HOME: home, MEDIFLOW_AMBULATORIO_HOME: destination } });
            assert.equal(result.status, 1, `cloud destination admitted through ${entry}`);
            assert.deepEqual(fs.readdirSync(cloud), []);
        }
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
});
