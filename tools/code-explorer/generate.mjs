import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildFileTopology, fileFallbackHtml } from './extract-files.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(directory, '../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8e6 });
const digest = value => createHash('sha256').update(value).digest('hex');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function buildSnapshot(curated) {
  if (curated.schemaVersion !== 1 || curated.repository !== 'https://github.com/Wulfgardr/mediflow'
      || !/^[a-f0-9]{40}$/.test(curated.sourceCommit)) throw new Error('Invalid snapshot identity');
  const commit = git('rev-parse', `${curated.sourceCommit}^{commit}`).trim();
  if (commit !== curated.sourceCommit) throw new Error('Commit must be fully pinned');
  if (curated.nodes.length < 8 || curated.nodes.length > 15) throw new Error('Map must stay bounded');
  const ids = new Set();
  const groups = new Set(['surface', 'transport', 'host', 'policy', 'service', 'storage']);
  const kinds = new Set(['import', 'call', 'composition', 'contract', 'http']);
  const evidence = refs => {
    if (!Array.isArray(refs) || !refs.length) throw new Error('Evidence required');
    return refs.map(ref => {
      if (!/^(app|components|lib|packages|scripts)\//.test(ref.path) || ref.path.includes('..')
          || !ref.anchor?.trim()) throw new Error('Invalid source reference');
      const content = git('show', `${commit}:${ref.path}`);
      const start = content.indexOf(ref.anchor);
      if (start < 0) throw new Error(`Missing anchor: ${ref.path}: ${ref.anchor}`);
      const line = content.slice(0, start).split('\n').length;
      const endLine = line + ref.anchor.split('\n').length - 1;
      const blob = git('rev-parse', `${commit}:${ref.path}`).trim();
      return { ...ref, line, endLine, blob, sha256: digest(content),
        url: `${curated.repository}/blob/${commit}/${ref.path}#L${line}-L${endLine}` };
    });
  };
  const nodes = curated.nodes.map(node => {
    if (!/^[a-z][a-z0-9-]+$/.test(node.id) || ids.has(node.id)) throw new Error('Duplicate/invalid node');
    ids.add(node.id);
    if (!groups.has(node.group) || !node.label || !node.summary || !node.knownUnknown
        || ['data', 'authority', 'evidence'].some(key => !node.questions?.[key])
        || !Number.isFinite(node.x) || !Number.isFinite(node.y)
        || node.x < 90 || node.x > 890 || node.y < 50 || node.y > 640) throw new Error('Invalid node');
    return { ...node, evidence: evidence(node.evidence) };
  });
  const edgeIds = new Set();
  const edges = curated.edges.map(edge => {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target
        || !edge.label || !kinds.has(edge.kind) || edgeIds.has(edge.id)) throw new Error('Invalid edge');
    edgeIds.add(edge.id);
    return { ...edge, evidence: evidence(edge.evidence) };
  });
  if (!curated.scope || curated.limits.length < 3) throw new Error('Limits required');
  return { ...curated, nodes, edges, provenance: {
    generator: 'tools/code-explorer/generate.mjs', curatedSha256: digest(JSON.stringify(curated)),
    sourceTree: git('rev-parse', `${commit}^{tree}`).trim(),
    proofKind: 'curated_source_relationships', executionVerified: false,
  } };
}

export function fallbackHtml(snapshot) {
  return snapshot.nodes.map(node => `<details id="source-${node.id}"><summary>${escape(node.label)}</summary>
<p>${escape(node.summary)}</p><dl><dt>Dove passa il dato?</dt><dd>${escape(node.questions.data)}</dd>
<dt>Chi può modificarlo?</dt><dd>${escape(node.questions.authority)}</dd><dt>Quali prove abbiamo?</dt><dd>${escape(node.questions.evidence)}</dd></dl>
<p><strong>Limite:</strong> ${escape(node.knownUnknown)}</p><ul>${node.evidence.map(ref => `<li><a href="${escape(ref.url)}">${escape(ref.path)} · riga ${ref.line}</a></li>`).join('')}</ul>
<p>Relazioni documentate:</p><ul>${snapshot.edges.filter(edge => edge.source === node.id || edge.target === node.id).map(edge => `<li>${escape(snapshot.nodes.find(n => n.id === edge.source).label)} → ${escape(snapshot.nodes.find(n => n.id === edge.target).label)}: ${escape(edge.label)} (${edge.kind}) — ${edge.evidence.map(ref => `<a href="${escape(ref.url)}">${escape(ref.path)} · riga ${ref.line}</a>`).join(', ')}</li>`).join('')}</ul></details>`).join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const curated = JSON.parse(readFileSync(resolve(directory, 'curated-map.json'), 'utf8'));
  const snapshot = buildSnapshot(curated);
  const topology = buildFileTopology(snapshot);
  const html = readFileSync(resolve(directory, 'index.template.html'), 'utf8')
    .replace('<!-- SNAPSHOT -->', JSON.stringify(snapshot).replaceAll('<', '\\u003c'))
    .replace('<!-- FALLBACK -->', fallbackHtml(snapshot))
    .replace('<!-- FILE_TOPOLOGY -->', JSON.stringify(topology).replaceAll('<', '\\u003c'))
    .replace('<!-- FILE_FALLBACK -->', fileFallbackHtml(topology))
    .replace('<!-- FILE_COVERAGE -->', `${topology.coverage.selectedFiles} file citati come prova su ${topology.coverage.trackedFiles} file tracciati. ${topology.coverage.declarations} dichiarazioni statiche: ${topology.coverage.counts.included} interne alla selezione, ${topology.coverage.counts['outside-selection']} verso file fuori selezione, ${topology.coverage.counts.builtin} moduli Node, ${topology.coverage.counts['external-package']} pacchetti esterni, ${topology.coverage.counts.unresolved} non risolte. ${topology.coverage.omittedConstructs} costrutti esclusi rilevati. Nessuna espansione ricorsiva.`)
    .replaceAll('<!-- COMMIT -->', snapshot.sourceCommit);
  const outputs = { 'snapshot.json': `${JSON.stringify(snapshot, null, 2)}\n`,
    'file-topology.json': `${JSON.stringify(topology, null, 2)}\n`, 'index.html': html };
  if (process.argv.includes('--check')) {
    for (const [name, content] of Object.entries(outputs)) {
      if (readFileSync(resolve(directory, name), 'utf8') !== content) throw new Error(`Stale output: ${name}`);
    }
  } else {
    for (const [name, content] of Object.entries(outputs)) writeFileSync(resolve(directory, name), content);
  }
  console.log(`Verified ${snapshot.nodes.length} nodes / ${snapshot.edges.length} edges at ${snapshot.sourceCommit}`);
}
