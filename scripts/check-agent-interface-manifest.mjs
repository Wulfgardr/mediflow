#!/usr/bin/env node
// @Codex: ADR 0093 source-classification drift gate.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const sourceKinds = ['openApi', 'paired', 'fabric'];

export function validateSourceCoverage(manifest, inventory) {
  const errors = [];
  for (const kind of sourceKinds) {
    const classified = manifest.flatMap((capability) => capability.sources?.[kind] ?? []);
    for (const identifier of inventory[kind]) if (!classified.includes(identifier)) errors.push(`${kind}: unclassified ${identifier}`);
    for (const identifier of classified) if (!inventory[kind].includes(identifier)) errors.push(`${kind}: stale ${identifier}`);
    for (const identifier of new Set(classified)) if (classified.filter((item) => item === identifier).length > 1) errors.push(`${kind}: duplicated ${identifier}`);
  }
  return errors;
}

function openApiOperations(source) {
  let currentPath = '';
  return source.split('\n').flatMap((line) => {
    const pathMatch = line.match(/^  (\/api\/v1[^:]*):$/);
    if (pathMatch) { currentPath = pathMatch[1]; return []; }
    const methodMatch = line.match(/^    (get|post|put|patch|delete):$/);
    return methodMatch && currentPath ? [`${methodMatch[1].toUpperCase()} ${currentPath}`] : [];
  });
}

async function inventories() {
  const pairedSource = readFileSync(path.join(ROOT, 'lib/network-contract.ts'), 'utf8');
  const deterministicSource = readFileSync(path.join(ROOT, 'lib/ai-providers/fabric/deterministic-catalog.ts'), 'utf8');
  const generativeSource = readFileSync(path.join(ROOT, 'lib/ai-providers/fabric/generative-catalog.ts'), 'utf8');
  return {
    openApi: openApiOperations(readFileSync(path.join(ROOT, 'docs/openapi/mediflow-v1.yaml'), 'utf8')),
    paired: [
      ...pairedSource.matchAll(/capability\(\s*'([^']+)'/g),
      ...pairedSource.matchAll(/const\s+NETWORK_[A-Z_]+CAPABILITY\s*=\s*'([^']+)'/g),
    ].map(([, key]) => key),
    fabric: [...deterministicSource.matchAll(/id:\s*'([^']+)'/g), ...generativeSource.matchAll(/descriptor\(\s*'([^']+)'/g)].map(([, id]) => id),
  };
}

async function main() {
  const [{ AGENT_INTERFACE_MANIFEST, validateAgentInterfaceManifest }, inventory] = await Promise.all([
    import(pathToFileURL(path.join(ROOT, 'lib/agent-interface/manifest.ts')).href), inventories(),
  ]);
  const errors = [...validateAgentInterfaceManifest(AGENT_INTERFACE_MANIFEST), ...validateSourceCoverage(AGENT_INTERFACE_MANIFEST, inventory)];
  if (errors.length) throw new Error(`Agent Interface manifest drift:\n${errors.join('\n')}`);
  console.log(`Agent Interface manifest OK: ${AGENT_INTERFACE_MANIFEST.length} explicit classifications.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
