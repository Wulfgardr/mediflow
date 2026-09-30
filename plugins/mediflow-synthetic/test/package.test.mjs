import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import Ajv2020 from 'ajv/dist/2020.js';
import { proposalFixture } from '../src/fixture.mjs';

const root = new URL('../', import.meta.url);
const json = async (file) => JSON.parse(await readFile(new URL(file, root), 'utf8'));
test('official portable schemas and legacy representation agree, with existing local components only', async () => {
  const ajv = new Ajv2020({ strict: false });
  const portable = await json('plugin.json'), legacy = await json('.codex-plugin/plugin.json');
  const mcp = await json('mcp.json'), legacyMcp = await json('.mcp.json');
  for (const [name, value] of [['plugin', portable], ['mcp', mcp]]) {
    const validate = ajv.compile(await json(`schemas/${name}.schema.json`));
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
  }
  for (const field of ['name', 'version', 'description']) assert.equal(portable[field], legacy[field]);
  assert.deepEqual(portable.author, legacy.author);
  assert.match(legacy.version, /^\d+\.\d+\.\d+$/u);
  assert.ok(legacy.author.name);
  for (const field of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category']) {
    assert.ok(legacy.interface[field].trim());
  }
  assert.ok(legacy.interface.defaultPrompt.length <= 3);
  assert.ok(legacy.interface.defaultPrompt.every((value) => value.trim() && value.length <= 128));
  assert.equal(portable.name, root.pathname.split('/').filter(Boolean).at(-1));
  assert.deepEqual(portable.extensions['com.openai'], { interface: legacy.interface });
  const { type, ...server } = mcp.mcpServers[portable.name];
  assert.equal(type, 'stdio'); assert.deepEqual(server, legacyMcp.mcpServers[portable.name]);
  assert.equal(legacy.mcpServers, './.mcp.json'); assert.equal(legacy.skills, './skills/');
  assert.equal('apps' in legacy, false); assert.equal('hooks' in legacy, false);
  await readFile(new URL('src/stdio.mjs', root));
  await readFile(new URL('skills/synthetic-review/SKILL.md', root));
});

test('invented proposal fixture satisfies the existing production output contract without importing runtime', async () => {
  const result = await build({ entryPoints: [new URL('../../packages/mcp/src/contracts.ts', root).pathname],
    bundle: true, write: false, platform: 'node', format: 'esm',
    nodePaths: [new URL('node_modules/', root).pathname] });
  const contract = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  assert.equal(contract.followUpProposalOutputSchema.safeParse(proposalFixture).success, true);
  assert.equal(contract.followUpProposalOutputSchema.safeParse({ ...proposalFixture, writesPerformed: 1 }).success, false);
});

test('prototype runtime import graph has no clinical runtime or network adapter', async () => {
  const files = (await readdir(new URL('src/', root))).filter((name) => name.endsWith('.mjs'));
  const allowed = new Set(['node:fs/promises', 'zod', '@modelcontextprotocol/sdk/server/mcp.js',
    '@modelcontextprotocol/sdk/server/stdio.js', '@modelcontextprotocol/ext-apps',
    '@modelcontextprotocol/ext-apps/server', '@openai/mcp-extensions/app', '@openai/mcp-extensions/server',
    './fixture.mjs', './server.mjs', './review-controller.mjs']);
  for (const file of files) {
    const source = await readFile(new URL(`src/${file}`, root), 'utf8');
    for (const match of source.matchAll(/\bfrom ['"]([^'"]+)['"]/gu)) assert.equal(allowed.has(match[1]), true, `${file}: ${match[1]}`);
    assert.equal(/\b(?:fetch|process\.env|sqlite|exec|spawn)\s*(?:\(|\.)/u.test(source), false, file);
  }
});
