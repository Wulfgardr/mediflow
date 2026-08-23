/* @Codex */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DECISION_PATH = '/Users/leonardopegollo/.codex/visualizations/2026/08/22/01a02a9c-3789-7032-8d93-1ed327390921/mediflow-0.8.5-fabric-product-crosswalk-decision-v1.json';
const DECISION_SHA256 = 'f64036aaa1abe2f54b748d03c4b561f1e38d22a047bcef342f680eb708b675dc';
const FABRIC_PATH = `${ROOT}/docs/capability-mapping/nodes/fabric-inventory.v1.json`;
const ANCHOR_PATH = `${ROOT}/docs/capability-mapping/nodes/web-mini-crosswalk.v1.json`;
const RELATION_PATH = `${ROOT}/docs/capability-mapping/relations/fabric-canonical-bindings.v1.json`;
const RECEIPT_PATH = `${ROOT}/docs/capability-mapping/fabric-product-crosswalk-receipt.v1.json`;
const CONFLICT_PATH = `${ROOT}/docs/capability-mapping/conflicts/fabric-canonical-unmapped.v1.json`;
const CATALOG_ID = 'web-65-registro-intelligence-fabric-16-capability-4-venue-osservate-e-p';

function fail(message) { throw new Error(`fabric product crosswalk: ${message}`); }
function json(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function write(path, value) { writeFileSync(path, `${JSON.stringify(value)}\n`); }
function verifyRef(ref) {
  const match = typeof ref === 'string' && ref.match(/^([0-9a-f]{40}):(.+)$/);
  if (!match) fail(`invalid frozen ref ${ref}`);
  execFileSync('git', ['cat-file', '-e', `${match[1]}:${match[2]}`], { cwd: ROOT, stdio: 'pipe' });
}
function evidenceKind(ref) {
  if (ref.endsWith('.json')) return 'manifest';
  if (ref.endsWith('.md')) return 'document';
  return 'code';
}
function relationEvidence(evidence) {
  return evidence.map(({ ref, locator }) => ({ evidenceKind: evidenceKind(ref), ref, locator, claim: 'approved product decision cites this independent frozen source' }));
}

const bytes = readFileSync(DECISION_PATH);
if (sha256(bytes) !== DECISION_SHA256) fail('decision SHA-256 drifted');
const decision = JSON.parse(bytes);
if (decision.schema !== 'mediflow.fabric-product-crosswalk-decision.v1' || decision.decisionId !== 'MF085-C1-FABRIC-CANONICAL-20260823' || decision.status !== 'approved_local_mapping_basis' || decision.applyPolicy !== 'none' || !Array.isArray(decision.globalEvidence) || !Array.isArray(decision.decisions)) fail('decision contract is invalid');
decision.globalEvidence.forEach(({ ref }) => verifyRef(ref));

const fabric = json(FABRIC_PATH);
const anchors = json(ANCHOR_PATH);
const fabricByIdentifier = new Map(fabric.records.map((record) => [record.sourceIdentity.identifier, record]));
const anchorsByIdentifier = new Map(anchors.records.map((record) => [record.sourceIdentity.identifier, record]));
if (decision.decisions.length !== 16 || new Set(decision.decisions.map(({ fabricId }) => fabricId)).size !== 16 || decision.decisions.length !== fabricByIdentifier.size) fail('decision roster is not one-to-one with Fabric inventory');
const catalog = anchorsByIdentifier.get(CATALOG_ID);
if (!catalog) fail('canonical web-65 catalog anchor is missing');

const records = [];
for (const entry of decision.decisions) {
  const fabricRecord = fabricByIdentifier.get(entry.fabricId);
  if (!fabricRecord || !['mapped', 'out_of_catalog'].includes(entry.terminalDisposition) || !Array.isArray(entry.functionalEdges) || !Array.isArray(entry.evidence) || entry.evidence.length === 0) fail(`decision for ${entry.fabricId} is invalid`);
  entry.evidence.forEach(({ ref }) => verifyRef(ref));
  fabricRecord.terminalDisposition = entry.terminalDisposition;
  for (const edge of entry.functionalEdges) {
    const anchor = anchorsByIdentifier.get(edge.canonicalId);
    if (!anchor || !['implements', 'supports', 'authority_boundary_for'].includes(edge.relationKind)) fail(`functional edge for ${entry.fabricId} is invalid`);
    records.push({ id: `relation:fabric-canonical:${entry.fabricId}:${edge.canonicalId}@v1`, from: fabricRecord.id, to: anchor.id, relationKind: edge.relationKind, authority: 'unresolved', stage: 'unresolved', decisionId: decision.decisionId, evidence: relationEvidence(entry.evidence) });
  }
  records.push({ id: `relation:fabric-registry:${entry.fabricId}:web-65@v1`, from: fabricRecord.id, to: catalog.id, relationKind: 'exposes', authority: 'unresolved', stage: 'unresolved', exposureScope: 'read_only_registry_roster', decisionId: decision.decisionId, evidence: relationEvidence(decision.globalEvidence) });
}
if (records.length !== 39 || new Set(records.map(({ id }) => id)).size !== records.length || records.filter(({ relationKind }) => relationKind === 'exposes').length !== 16) fail('derived relation roster is incomplete');

write(FABRIC_PATH, fabric);
write(RELATION_PATH, { schema: 'mediflow.capability-mapping.fabric-canonical-bindings.v1', status: 'candidate_not_integrated', applyPolicy: 'none', decisionId: decision.decisionId, decisionSha256: DECISION_SHA256, records });
write(RECEIPT_PATH, { schema: 'mediflow.capability-mapping.product-decision-receipt.v1', status: 'candidate_not_integrated', applyPolicy: 'none', decisionId: decision.decisionId, decisionSha256: DECISION_SHA256, decisionPath: DECISION_PATH, globalEvidence: decision.globalEvidence, decisionCount: decision.decisions.length, functionalRelationCount: records.length - 16, registryExposureCount: 16, outOfCatalogFabricIds: decision.decisions.filter(({ terminalDisposition }) => terminalDisposition === 'out_of_catalog').map(({ fabricId }) => fabricId) });
write(CONFLICT_PATH, { schema: 'mediflow.capability-mapping.conflict-register.v1', status: 'resolved_by_product_decision', applyPolicy: 'none', decisionId: decision.decisionId, decisionSha256: DECISION_SHA256, records: [] });
