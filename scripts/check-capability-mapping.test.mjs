/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateCapabilityMapping } from './check-capability-mapping.mjs';

const manifest = JSON.parse(readFileSync('docs/capability-mapping/source-manifest.v1.json', 'utf8'));
const basis = JSON.parse(readFileSync('docs/capability-mapping/mapping-basis.v1.json', 'utf8'));
const coverage = JSON.parse(readFileSync('docs/capability-mapping/coverage-receipt.v1.json', 'utf8'));
const clone = (value) => structuredClone(value);

test('accepts the frozen M0 contracts', () => {
  assert.doesNotThrow(() => validateCapabilityMapping());
});

test('keeps all 66 Web/Mini rows lossless and authority-unresolved', () => {
  const records = JSON.parse(readFileSync('docs/capability-mapping/nodes/web-mini-crosswalk.v1.json', 'utf8')).records;
  assert.equal(records.length, 66);
  assert.ok(records.every((record) => record.authority === 'unresolved' && record.stage === 'unresolved'));
});

test('retains 109 source-local AIP identities without deduplication', () => {
  const records = JSON.parse(readFileSync('docs/capability-mapping/nodes/aip-inventory.v1.json', 'utf8')).records;
  assert.equal(records.length, 109);
  assert.equal(new Set(records.map((record) => `${record.sourceIdentity.sourceKind}:${record.sourceIdentity.identifier}`)).size, 109);
});

test('keeps every Fabric-to-canonical product decision explicit and non-identical', () => {
  const records = JSON.parse(readFileSync('docs/capability-mapping/relations/fabric-canonical-bindings.v1.json', 'utf8')).records;
  assert.equal(records.length, 39);
  assert.equal(records.filter((record) => record.relationKind === 'exposes').length, 16);
  assert.ok(records.every((record) => record.relationKind !== 'exact_identity' && record.authority === 'unresolved' && record.stage === 'unresolved'));
});

test('keeps the product decision reference portable and free of local paths', () => {
  const receipt = JSON.parse(readFileSync('docs/capability-mapping/fabric-product-crosswalk-receipt.v1.json', 'utf8'));
  assert.equal(receipt.decisionPath, 'external:mediflow-0.8.5-fabric-product-crosswalk-decision-v1.json');
});

test('keeps document identity resolution out of catalog until a non-test consumer exists', () => {
  const records = JSON.parse(readFileSync('docs/capability-mapping/nodes/fabric-inventory.v1.json', 'utf8')).records;
  assert.equal(records.find((record) => record.sourceIdentity.identifier === 'document_identity_resolution').terminalDisposition, 'out_of_catalog');
});

test('rejects descriptor-only Fabric entries presented as runtime implementations', () => {
  const bindings = JSON.parse(readFileSync('docs/capability-mapping/relations/fabric-canonical-bindings.v1.json', 'utf8')).records;
  const descriptor = bindings.find((record) => record.runtimeBinding === 'descriptor_entry_point_only');
  const tampered = clone(basis);
  tampered.relations.push({ ...descriptor, id: 'relation:hostile-descriptor-runtime@v1', relationKind: 'implements' });
  assert.throws(() => validateCapabilityMapping(manifest, tampered), /runtime binding/);
});

test('disposes frozen Web routes and pages outside the closed catalog without inferred authority', () => {
  const records = JSON.parse(readFileSync('docs/capability-mapping/nodes/web-surfaces.v1.json', 'utf8')).records;
  assert.equal(records.length, 166);
  assert.ok(records.every((record) => record.authority === 'unresolved' && record.terminalDisposition === 'out_of_catalog'));
});

test('rejects mockup or test-bench routes in the product-surface population', () => {
  const escaped = clone(basis);
  escaped.populations.surfaces.records.push({ id: 'surface:web:mockup@v1', sourceIdentity: { sourceKind: 'web_surface', identifier: 'app/mockups/scheda/page.tsx' }, description: 'synthetic hostile record', surface: 'web_page', stage: 'unresolved', authority: 'unresolved', input: 'unresolved', output: 'unresolved', provider: 'unresolved', venue: 'unresolved', egress: 'unresolved', evidence: [{ evidenceKind: 'code', ref: '93362ca505149f5d6c51502784395e65126921df:app/mockups/scheda/page.tsx' }], terminalDisposition: 'out_of_catalog' });
  assert.throws(() => validateCapabilityMapping(manifest, escaped), /evidence path escaped|web surface eligibility/);
});

test('rejects Web or Mini records outside the functional surface policy', () => {
  const escaped = clone(basis);
  escaped.populations.surfaces.records.push({ id: 'surface:web:asset@v1', sourceIdentity: { sourceKind: 'web_surface', identifier: 'public/icon.png' }, description: 'synthetic hostile record', surface: 'web_page', stage: 'unresolved', authority: 'unresolved', input: 'unresolved', output: 'unresolved', provider: 'unresolved', venue: 'unresolved', egress: 'unresolved', evidence: [{ evidenceKind: 'code', ref: '93362ca505149f5d6c51502784395e65126921df:app/page.tsx' }], terminalDisposition: 'unmapped' });
  assert.throws(() => validateCapabilityMapping(manifest, escaped), /web surface eligibility/);
});

test('rejects source drift and apply', () => {
  const drift = clone(manifest);
  drift.sourceSets[0].recordCount += 1;
  assert.throws(() => validateCapabilityMapping(drift, basis), /source drift/);
  const unsafe = clone(basis);
  unsafe.applyPolicy = 'apply';
  assert.throws(() => validateCapabilityMapping(manifest, unsafe), /applyPolicy/);
});

test('rejects unknown mapping vocabulary and unjustified completion', () => {
  const unknown = clone(basis);
  unknown.relationKinds[0] = 'similar_to';
  assert.throws(() => validateCapabilityMapping(manifest, unknown), /relation kind vocabulary/);
  const incomplete = clone(basis);
  incomplete.populations.surfaces.records.push({ id: 'surface.v1', sourceIdentity: 'synthetic', description: 'synthetic hostile record', surface: 'test', stage: 'none', authority: 'unresolved', input: 'unresolved', output: 'unresolved', provider: 'unresolved', venue: 'unresolved', egress: 'unresolved', evidence: [{ evidenceKind: 'code', ref: '28a1a36b162f160e872ce5153cad03f38eacfd22:lib/ai-providers/fabric/contract.ts' }], terminalDisposition: 'unmapped' });
  incomplete.semanticBindingComplete = true;
  assert.throws(() => validateCapabilityMapping(manifest, incomplete), /surface terminal dispositions|semantic binding/);
});

test('rejects missing, duplicate, collapsed, or overclaimed coverage', () => {
  const missing = clone(coverage);
  missing.populationCoverage[0].observedCount -= 1;
  assert.throws(() => validateCapabilityMapping(manifest, basis, undefined, missing), /anchors is incomplete/);
  const duplicate = clone(coverage);
  duplicate.relationCoverage.observedCount += 1;
  assert.throws(() => validateCapabilityMapping(manifest, basis, undefined, duplicate), /relation coverage is incomplete or drifted/);
  const overclaimed = clone(coverage);
  overclaimed.semanticBindingComplete = false;
  assert.throws(() => validateCapabilityMapping(manifest, basis, undefined, overclaimed), /completion flags drifted/);
});

test('rejects source digest drift and authority or stage unions', () => {
  const digestDrift = clone(manifest);
  digestDrift.sourceSets[0].sourceSetSha256 = '0'.repeat(64);
  assert.throws(() => validateCapabilityMapping(digestDrift, basis), /source drift/);
  const unioned = clone(basis);
  unioned.populations.surfaces.records.push({ id: 'surface:hostile@v1', sourceIdentity: 'hostile', description: 'synthetic hostile record', surface: 'test', stage: ['source', 'derived'], authority: ['source', 'derived'], input: 'unresolved', output: 'unresolved', provider: 'unresolved', venue: 'unresolved', egress: 'unresolved', evidence: [{ evidenceKind: 'code', ref: '28a1a36b162f160e872ce5153cad03f38eacfd22:lib/ai-providers/fabric/contract.ts' }], terminalDisposition: 'unmapped' });
  assert.throws(() => validateCapabilityMapping(manifest, unioned), /authority or stage is unioned/);
});

test('rejects incomplete conflicts and a stronger human report', () => {
  const incompleteConflict = clone(basis);
  incompleteConflict.conflicts.push({ conflictId: 'conflict:hostile@v1', subjectId: 'hostile', terminalDisposition: 'unmapped' });
  assert.throws(() => validateCapabilityMapping(manifest, incompleteConflict), /conflict contract/);
  assert.throws(() => validateCapabilityMapping(manifest, basis, undefined, coverage, 'semanticBindingComplete=true'), /human report claim ceiling/);
});

test('rejects roster selector, digest, and node-path escape', () => {
  const selectorDrift = clone(manifest);
  selectorDrift.sourceSets.find((set) => set.sourceSetId === 'web-product-pages').pathMatcher = '^app/.+/page\\.tsx$';
  assert.throws(() => validateCapabilityMapping(selectorDrift, basis), /source roster path drift/);
  const rosterDigestDrift = clone(manifest);
  rosterDigestDrift.sourceSets[0].rosterSha256 = '0'.repeat(64);
  assert.throws(() => validateCapabilityMapping(rosterDigestDrift, basis), /source roster digest drift/);
  const escaped = clone(basis);
  escaped.populations.surfaces.records.push({ id: 'surface:escape@v1', sourceIdentity: 'escape', description: 'synthetic hostile record', surface: 'test', stage: 'unresolved', authority: 'unresolved', input: 'unresolved', output: 'unresolved', provider: 'unresolved', venue: 'unresolved', egress: 'unresolved', evidence: [{ evidenceKind: 'code', ref: '28a1a36b162f160e872ce5153cad03f38eacfd22:outside/freeze.ts' }], terminalDisposition: 'unmapped' });
  assert.throws(() => validateCapabilityMapping(manifest, escaped), /evidence path escaped/);
});
