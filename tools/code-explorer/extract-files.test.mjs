import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildFileTopology, createPinnedResolver, extractDeclarations, fileFallbackHtml } from './extract-files.mjs';

const snapshot = JSON.parse(readFileSync(new URL('./snapshot.json', import.meta.url), 'utf8'));
const topology = buildFileTopology(snapshot);

test('AST separates declaration syntax, type use, comments and omitted constructs', () => {
  const source = `// import './false.ts';
const text = "export * from './also-false.ts'";
import type { X } from './types';
import { type Y, value } from './mixed';
import { type Z } from './only-types';
import './side-effect';
export type { Q } from './re-export';
export * from './values';
import legacy = require('./legacy');
const lazy = import('./dynamic');
const calculated = import(getTarget());
const runtime = require('./runtime');
type T = import('./type-expression').T;
`;
  const parsed = extractDeclarations(source, 'example.ts');
  assert.deepEqual(parsed.declarations.map(item => [item.syntax, item.typeUsage, item.specifier]), [
    ['import', 'type-only', './types'], ['import', 'mixed', './mixed'], ['import', 'type-only', './only-types'],
    ['import', 'side-effect', './side-effect'], ['re-export', 'type-only', './re-export'],
    ['re-export', 'value', './values'], ['import-equals', 'value', './legacy'],
  ]);
  assert.deepEqual(parsed.omitted.map(item => item.syntax), ['dynamic-import', 'dynamic-import', 'require-call', 'import-type-expression']);
  assert.equal(parsed.omitted[1].specifier, null);
  for (const item of [...parsed.declarations, ...parsed.omitted]) assert.ok(source.split('\n').slice(item.line - 1, item.endLine).join('\n').includes(item.anchor));
  assert.throws(() => extractDeclarations('import {', 'broken.ts'));
});

test('resolver uses only virtual pinned tree, aliases, explicit TS, JS substitution, indices and assets', () => {
  const content = { 'src/main.ts': '', 'lib/types.ts': '', 'lib/index.ts': '', 'styles/view.css': '', 'package.json': '{}', 'tsconfig.json': '{}' };
  const config = JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', paths: { '@/*': ['./*'] } } });
  const resolver = createPinnedResolver(Object.keys(content), path => { assert.ok(path in content); return content[path]; }, config);
  for (const specifier of ['../lib/types', '../lib/types.ts', '../lib/types.js', '@/lib/types']) assert.deepEqual(resolver('src/main.ts', specifier), { resolution: 'resolved', target: 'lib/types.ts' });
  assert.equal(resolver('src/main.ts', '../lib').target, 'lib/index.ts');
  for (const specifier of ['../styles/view.css', '@/styles/view.css']) assert.equal(resolver('src/main.ts', specifier).target, 'styles/view.css');
  assert.equal(resolver('src/main.ts', 'node:fs').resolution, 'builtin');
  assert.equal(resolver('src/main.ts', 'react').resolution, 'external-package');
  assert.equal(resolver('src/main.ts', '@/missing').resolution, 'unresolved');
  assert.equal(resolver('src/main.ts', '../../checkout-only.ts').resolution, 'unresolved');
  assert.throws(() => createPinnedResolver([], () => '', '{"extends":"../../local"}'));
});

test('historical topology covers node AND edge evidence, with truthful nonrecursive accounting', () => {
  assert.deepEqual(topology, JSON.parse(readFileSync(new URL('./file-topology.json', import.meta.url), 'utf8')));
  assert.equal(topology.sourceCommit, snapshot.sourceCommit);
  assert.equal(topology.provenance.executionVerified, false);
  assert.equal(topology.coverage.recursiveExpansion, false);
  const selected = new Set([...snapshot.nodes, ...snapshot.edges].flatMap(item => item.evidence.map(ref => ref.path)));
  assert.deepEqual(new Set(topology.files.map(file => file.path)), selected);
  assert.equal(Object.values(topology.coverage.counts).reduce((sum, value) => sum + value, 0), topology.declarations.length);
  assert.equal(topology.coverage.omittedConstructs, topology.omitted.length);
  const mini = topology.declarations.find(item => item.source === 'packages/mini/src/protocol.ts' && item.specifier.endsWith('/operation-client.ts'));
  assert.equal(mini.typeUsage, 'type-only');
  assert.equal(mini.resolution, 'included');
  const css = topology.declarations.filter(item => item.specifier.endsWith('.css'));
  assert.equal(css.length, 2); assert.ok(css.every(item => item.resolution === 'outside-selection'));
  for (const edge of topology.edges) {
    assert.ok(selected.has(edge.source) && selected.has(edge.target));
    assert.ok(edge.declarationIds.length > 0);
    for (const id of edge.declarationIds) {
      const declaration = topology.declarations.find(item => item.id === id);
      assert.equal(declaration.source, edge.source); assert.equal(declaration.target, edge.target);
    }
  }
  for (const file of topology.files) {
    const source = execFileSync('git', ['show', `${snapshot.sourceCommit}:${file.path}`], { cwd: new URL('../..', import.meta.url), encoding: 'utf8' });
    for (const declaration of topology.declarations.filter(item => item.source === file.id)) assert.ok(source.split('\n').slice(declaration.line - 1, declaration.endLine).join('\n').includes(declaration.anchor));
  }
});

test('file fallback keeps every file, declaration and excluded target source', () => {
  const html = fileFallbackHtml(topology);
  for (const file of topology.files) assert.ok(html.includes(file.url));
  for (const item of topology.declarations) { assert.ok(html.includes(item.url)); if (item.targetUrl) assert.ok(html.includes(item.targetUrl)); }
  for (const membership of topology.memberships) assert.ok(html.includes(membership.reference.url));
  assert.ok(html.includes('type-only')); assert.ok(html.includes('outside-selection'));
  assert.ok(!html.includes('<script'));
});
