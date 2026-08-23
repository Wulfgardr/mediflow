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

test('keeps every Fabric-to-canonical gap explicit and non-semantic', () => {
  const records = JSON.parse(readFileSync('docs/capability-mapping/conflicts/fabric-canonical-unmapped.v1.json', 'utf8')).records;
  assert.equal(records.length, 16);
  assert.ok(records.every((record) => record.terminalDisposition === 'unmapped' && record.decisionOwner === 'technical_worker'));
});

test('enumerates frozen Web routes and pages without inferred authority', () => {
  const records = JSON.parse(readFileSync('docs/capability-mapping/nodes/web-surfaces.v1.json', 'utf8')).records;
  assert.equal(records.length, 168);
  assert.ok(records.every((record) => record.authority === 'unresolved' && record.terminalDisposition === 'unmapped'));
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
  assert.throws(() => validateCapabilityMapping(manifest, incomplete), /semantic binding/);
});

test('rejects missing, duplicate, collapsed, or overclaimed coverage', () => {
  const missing = clone(coverage);
  missing.populationCoverage[0].observedCount -= 1;
  assert.throws(() => validateCapabilityMapping(manifest, basis, undefined, missing), /anchors is incomplete/);
  const duplicate = clone(coverage);
  duplicate.conflictCoverage.residualConflictIds[1] = duplicate.conflictCoverage.residualConflictIds[0];
  assert.throws(() => validateCapabilityMapping(manifest, basis, undefined, duplicate), /conflict coverage is incomplete or collapsed/);
  const overclaimed = clone(coverage);
  overclaimed.semanticBindingComplete = true;
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
