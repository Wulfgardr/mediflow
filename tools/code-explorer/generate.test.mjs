import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildSnapshot, fallbackHtml } from './generate.mjs';

const curated = JSON.parse(readFileSync(new URL('./curated-map.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(curated);

test('snapshot is pinned, reproducible, and contains only source evidence', () => {
  const snapshot = buildSnapshot(curated);
  assert.deepEqual(snapshot, JSON.parse(readFileSync(new URL('./snapshot.json', import.meta.url), 'utf8')));
  assert.equal(snapshot.provenance.executionVerified, false);
  const root = new URL('../..', import.meta.url);
  for (const item of [...snapshot.nodes, ...snapshot.edges]) {
    for (const ref of item.evidence) {
      assert.ok(ref.url.includes(`/blob/${snapshot.sourceCommit}/${ref.path}#L${ref.line}-L${ref.endLine}`));
      const source = execFileSync('git', ['show', `${snapshot.sourceCommit}:${ref.path}`], { cwd: root, encoding: 'utf8' });
      assert.ok(source.split('\n').slice(ref.line - 1, ref.endLine).join('\n').includes(ref.anchor));
    }
  }
});

test('rejects floating ref, missing file, stale anchor, unknown target and relation', () => {
  for (const change of [
    data => { data.sourceCommit = 'main'; },
    data => { data.nodes[0].evidence[0].path = 'packages/no-such-source.ts'; },
    data => { data.nodes[0].evidence[0].anchor = 'no_such_anchor_20261003'; },
    data => { data.edges[0].target = 'no-such-node'; },
    data => { data.edges[0].kind = 'live_traffic'; },
    data => { data.nodes[0].knownUnknown = ''; },
    data => { data.nodes[0].id = data.nodes[1].id; },
  ]) {
    const data = fresh(); change(data); assert.throws(() => buildSnapshot(data));
  }
});

test('non-JavaScript fallback retains all nodes, questions and edge sources', () => {
  const snapshot = buildSnapshot(curated), html = fallbackHtml(snapshot);
  for (const node of snapshot.nodes) assert.ok(html.includes(`id="source-${node.id}"`));
  for (const item of [...snapshot.nodes, ...snapshot.edges]) for (const ref of item.evidence) assert.ok(html.includes(ref.url));
  assert.equal((html.match(/Dove passa il dato\?/g) || []).length, snapshot.nodes.length);
  assert.ok(!html.includes('<script'));
});
