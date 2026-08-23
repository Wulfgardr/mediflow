/* @Codex */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FABRIC = `${ROOT}/docs/capability-mapping/fabric-plane-inventory.v1.json`;
const HEADLESS = `${ROOT}/docs/capability-mapping/headless-plane-inventory.v1.json`;
const ADR = '54b56c2bb4a9eb1bd76f198fc58457ebd7623e5b:docs/adr/0100-fabric-vs-headless-semantic-plane.md';
const C1 = 'b25ace437fda8d89b402c63cba2adb38295f188c';
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const fail = (message) => { throw new Error(`plane inventories: ${message}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function exact(value, keys, label) {
  if (!value || !same(Object.keys(value).sort(), [...keys].sort())) fail(`${label} has an unexpected contract`);
}
function frozen(entry, expectedRef, label) {
  exact(entry, ['ref', 'gitBlob', 'expectedCount', 'observedCount'], label);
  if (entry.ref !== expectedRef || !/^[0-9a-f]{40}$/.test(entry.gitBlob)) fail(`${label} frozen ref drifted`);
  if (git('rev-parse', entry.ref) !== entry.gitBlob) fail(`${label} blob drifted`);
}
function records(ref, label) {
  try { return JSON.parse(git('show', ref)).records; } catch { fail(`${label} does not resolve`); }
}
function common(inventory, plane, ceiling) {
  exact(inventory, plane === 'fabric'
    ? ['schema', 'plane', 'inventoryVersion', 'status', 'applyPolicy', 'claimCeiling', 'adr', 'source', 'relations', 'rowPolicy']
    : ['schema', 'plane', 'inventoryVersion', 'status', 'applyPolicy', 'claimCeiling', 'adr', 'semanticSource', 'nonSemanticEvidence', 'rowPolicy'], plane);
  if (inventory.schema !== 'mediflow.capability-mapping.plane-inventory.v1' || inventory.plane !== plane || inventory.inventoryVersion !== 1 || inventory.status !== 'candidate_not_integrated' || inventory.applyPolicy !== 'none' || inventory.claimCeiling !== ceiling) fail(`${plane} metadata is invalid`);
  exact(inventory.adr, ['ref', 'gitBlob'], `${plane} ADR`);
  if (inventory.adr.ref !== ADR || git('rev-parse', ADR) !== inventory.adr.gitBlob) fail(`${plane} ADR ref or blob drifted`);
}
function unique(values, label) {
  if (values.some((value) => typeof value !== 'string') || new Set(values).size !== values.length) fail(`${label} has duplicate identities`);
}
function validateFabric(fabric) {
  common(fabric, 'fabric', 'P1 referential Fabric roster; not runtime, integration, release, or Headless authority evidence');
  frozen(fabric.source, `${C1}:docs/capability-mapping/nodes/fabric-inventory.v1.json`, 'Fabric source');
  frozen(fabric.relations, `${C1}:docs/capability-mapping/relations/fabric-canonical-bindings.v1.json`, 'Fabric relations');
  exact(fabric.rowPolicy, ['authority', 'stage', 'applyPolicy'], 'Fabric row policy');
  if (!same(fabric.rowPolicy, { authority: 'fabric_only_not_headless', stage: 'inherited_unresolved', applyPolicy: 'none' })) fail('Fabric row policy grants Headless authority');
  const source = records(fabric.source.ref, 'Fabric source');
  const relations = records(fabric.relations.ref, 'Fabric relations');
  if (source.length !== 16 || fabric.source.expectedCount !== 16 || fabric.source.observedCount !== source.length) fail('Fabric 16-row coverage drifted');
  unique(source.map((row) => row.id), 'Fabric rows');
  if (source.some((row) => row.sourceIdentity?.sourceKind !== 'fabric_capability' || row.authority !== 'clinical_application')) fail('Fabric source authority drifted');
  if (relations.length !== 39 || fabric.relations.expectedCount !== 39 || fabric.relations.observedCount !== relations.length) fail('Fabric relations coverage drifted');
  if (relations.some((row) => !source.some((entry) => entry.id === row.from) || !row.to.startsWith('anchor:web:') || row.relationKind === 'exact_identity' || row.authority !== 'unresolved' || row.stage !== 'unresolved')) fail('Fabric relations collapse the accepted explicit binding');
  if (source.some((row) => !relations.some((relation) => relation.from === row.id))) fail('Fabric relation coverage is incomplete');
  return relations;
}
function validateHeadless(headless) {
  common(headless, 'headless', 'P1 referential Headless semantic roster; manual-only and not grantable; not runtime, integration, release, or transport authority evidence');
  frozen(headless.semanticSource, `${C1}:docs/capability-mapping/nodes/web-mini-crosswalk.v1.json`, 'Headless semantic source');
  if (!Array.isArray(headless.nonSemanticEvidence) || headless.nonSemanticEvidence.length !== 2) fail('Headless evidence populations are invalid');
  const evidence = headless.nonSemanticEvidence;
  const expected = [
    ['aip_transport_only', `${C1}:docs/capability-mapping/nodes/aip-inventory.v1.json`, 109],
    ['surface_evidence_only', `${C1}:docs/capability-mapping/coverage-receipt.v1.json`, 177],
  ];
  for (let index = 0; index < expected.length; index += 1) {
    const [population, ref, count] = expected[index];
    exact(evidence[index], ['population', 'ref', 'gitBlob', 'expectedCount'], 'Headless evidence');
    if (evidence[index].population !== population || evidence[index].ref !== ref || evidence[index].expectedCount !== count || git('rev-parse', ref) !== evidence[index].gitBlob) fail('Headless evidence drifted');
  }
  exact(headless.rowPolicy, ['identityKind', 'authority', 'manualDisposition', 'stage', 'applyPolicy', 'transport', 'provider', 'venue', 'fallback'], 'Headless row policy');
  const closed = { identityKind: 'canonical_application_function', authority: 'not_grantable', manualDisposition: 'manual_only', stage: 'unresolved', applyPolicy: 'none', transport: 'not_selected', provider: 'not_selected', venue: 'not_selected', fallback: 'denied' };
  if (!same(headless.rowPolicy, closed)) fail('Headless semantic identity or closed row policy is invalid');
  const anchors = records(headless.semanticSource.ref, 'Headless semantic source');
  if (anchors.length !== 66 || headless.semanticSource.expectedCount !== 66 || headless.semanticSource.observedCount !== anchors.length) fail('Headless 66-row coverage drifted');
  unique(anchors.map((row) => row.id), 'Headless rows');
  if (anchors.some((row) => !row.id.startsWith('anchor:web:') || row.sourceIdentity?.sourceKind !== 'mini_parity' || row.authority !== 'unresolved' || row.stage !== 'unresolved')) fail('Headless semantic source is not canonical application-function evidence');
  const aip = records(evidence[0].ref, 'AIP evidence');
  if (aip.length !== 109 || new Set(aip.map((row) => row.id)).size !== 109) fail('AIP transport evidence drifted');
  const coverage = JSON.parse(git('show', evidence[1].ref));
  if (coverage.populationCoverage?.find((row) => row.populationId === 'surfaces')?.observedCount !== 177) fail('surface evidence drifted');
  return anchors;
}

export function validatePlaneInventories(fabric = json(FABRIC), headless = json(HEADLESS)) {
  const relations = validateFabric(fabric);
  const anchors = validateHeadless(headless);
  if (relations.some((relation) => !anchors.some((anchor) => anchor.id === relation.to))) fail('Fabric relation target is outside canonical Headless roster');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) validatePlaneInventories();
