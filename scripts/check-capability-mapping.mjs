/* @Codex */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST_PATH = `${ROOT}/docs/capability-mapping/source-manifest.v1.json`;
const BASIS_PATH = `${ROOT}/docs/capability-mapping/mapping-basis.v1.json`;
const COVERAGE_PATH = `${ROOT}/docs/capability-mapping/coverage-receipt.v1.json`;
const REPORT_PATH = `${ROOT}/docs/capability-mapping/mediflow-0.8.5-crosswalk.md`;
const RELATION_KINDS = new Set(['exact_identity', 'implements', 'exposes', 'supports', 'authority_boundary_for']);
const TERMINAL_DISPOSITIONS = new Set(['mapped', 'infrastructure_only', 'out_of_catalog', 'unmapped', 'conflicted']);
const EVIDENCE_KINDS = new Set(['code', 'manifest', 'document', 'test']);
const CLAIM_CEILING = 'ledger semantico locale su exact head; C1 non prova runtime composition o integration; non integrato, non release-ready, non released';
const FROZEN_REF_CACHE = new Set();

function fail(message) { throw new Error(`capability mapping: ${message}`); }
function json(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function git(...args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }); }
function tree(ref) {
  return git('ls-tree', '-rl', ref).trim().split('\n').filter(Boolean).map((line) => {
    const match = line.match(/^(\d+) (\w+) ([0-9a-f]+)\s+(\d+)\t(.+)$/);
    if (!match || match[2] !== 'blob') fail(`cannot parse tree entry for ${ref}`);
    return { gitBlob: match[3], byteLength: Number(match[4]), path: match[5] };
  });
}
function digest(records) {
  return sha256(records.map(({ path, gitBlob, byteLength }) => `${path}\0${gitBlob}\0${byteLength}\n`).join(''));
}
function rosterDigest(records) {
  return sha256(records.map(({ path, gitBlob, byteLength, sha256: contentSha256 }) => `${path}\0${gitBlob}\0${byteLength}\0${contentSha256}\n`).join(''));
}
function sourceRecords(set, source) {
  const records = tree(source.commit);
  const selected = Array.isArray(set.paths) ? set.paths.map((expected) => {
    const actual = records.find((record) => record.path === expected.path);
    if (!actual || actual.gitBlob !== expected.gitBlob || actual.byteLength !== expected.byteLength) fail(`${set.sourceSetId}: source drift at ${expected.path}`);
    return actual;
  }).sort((a, b) => a.path.localeCompare(b.path)) : (() => {
    if (typeof set.pathMatcher !== 'string') fail(`${set.sourceSetId}: missing closed path selector`);
    const matcher = new RegExp(set.pathMatcher, set.pathMatcherFlags ?? '');
    return records.filter((record) => matcher.test(record.path)).sort((a, b) => a.path.localeCompare(b.path));
  })();
  const roster = relativeJson(set.rosterFile, `${set.sourceSetId}: source roster`);
  if (roster.schema !== 'mediflow.capability-mapping.source-roster.v1' || roster.sourceSetId !== set.sourceSetId || roster.sourceId !== set.sourceId || roster.sourceRef !== source.commit || !Array.isArray(roster.records)) fail(`${set.sourceSetId}: source roster contract is invalid`);
  if (roster.records.some((record) => !record || !/^[0-9a-f]{64}$/.test(record.sha256)) || rosterDigest(roster.records) !== set.rosterSha256) fail(`${set.sourceSetId}: source roster digest drift`);
  const triples = (values) => values.map(({ path, gitBlob, byteLength }) => `${path}\0${gitBlob}\0${byteLength}`);
  if (JSON.stringify(triples(roster.records)) !== JSON.stringify(triples(selected))) fail(`${set.sourceSetId}: source roster path drift`);
  return roster.records;
}
function requireExactArray(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) fail(`${label} is invalid`);
}
function relativeJson(path, label) {
  if (typeof path !== 'string' || !path.startsWith('docs/capability-mapping/') || path.includes('..')) fail(`${label} is invalid`);
  return json(`${ROOT}/${path}`);
}
function populationRecords(population) {
  const records = [...population.records];
  if (population.recordFile) {
    const external = relativeJson(population.recordFile, 'population record file');
    if (!Array.isArray(external.records)) fail('population record file has no records');
    records.push(...external.records);
  }
  for (const file of population.recordFiles ?? []) {
    const external = relativeJson(file, 'population record file');
    if (!Array.isArray(external.records)) fail('population record file has no records');
    records.push(...external.records);
  }
  return records;
}
function relationRecords(basis) {
  const records = [...basis.relations];
  for (const file of basis.relationFiles ?? []) {
    const external = relativeJson(file, 'relation file');
    if (!Array.isArray(external.records)) fail('relation file has no records');
    records.push(...external.records);
  }
  return records;
}
function conflictRecords(basis) {
  const records = [...basis.conflicts];
  for (const file of basis.conflictFiles ?? []) {
    const external = relativeJson(file, 'conflict file');
    if (!Array.isArray(external.records)) fail('conflict file has no records');
    records.push(...external.records);
  }
  return records;
}
function validateWebMiniSurfaceEligibility(basis) {
  const policy = relativeJson(basis.surfaceEligibilityFile, 'surface eligibility file');
  if (policy.schema !== 'mediflow.capability-mapping.surface-eligibility.v1' || policy.mappingVersion !== 1 || policy.applyPolicy !== 'none' || !Array.isArray(policy.rules) || !Array.isArray(policy.excludedFromSurfacePopulation)) fail('surface eligibility contract is invalid');
  const records = populationRecords(basis.populations.surfaces);
  const web = records.filter((record) => record.sourceIdentity?.sourceKind === 'web_surface');
  const webRoutes = relativeJson('docs/capability-mapping/sources/web-http-routes.v1.json', 'web route roster').records.map((record) => record.path);
  const webPages = relativeJson('docs/capability-mapping/sources/web-product-pages.v1.json', 'web page roster').records.map((record) => record.path);
  const bySurface = (surface) => web.filter((record) => record.surface === surface).map((record) => record.sourceIdentity.identifier).sort();
  if (JSON.stringify(bySurface('web_http_route')) !== JSON.stringify(webRoutes) || JSON.stringify(bySurface('web_page')) !== JSON.stringify(webPages) || web.some((record) => !['web_http_route', 'web_page'].includes(record.surface) || record.sourceIdentity.identifier.startsWith('app/mockups/'))) fail('web surface eligibility drifted');
  const mini = records.filter((record) => record.sourceIdentity?.sourceKind === 'mini_command');
  const source = JSON.parse(git('show', '1e35733c0218eae67a1d6e158085aab7340bc26b:packages/mini/contracts/mini-parity.json'));
  const expectedMini = source.capabilities.flatMap((capability, index) => (capability.miniCommands ?? []).map((_, commandIndex) => `${capability.webCapabilityId}:${commandIndex + 1}:${index + 1}`)).sort();
  const actualMini = mini.map((record) => `${record.sourceIdentity.identifier}:${record.sourceIdentity.sourceRow}`).sort();
  if (mini.some((record) => record.surface !== 'mini_command') || JSON.stringify(actualMini) !== JSON.stringify(expectedMini)) fail('Mini command surface eligibility drifted');
}
function validateEvidenceArtifacts(basis, sourcePaths) {
  const files = basis.evidenceFiles ?? [];
  if (!Array.isArray(files) || files.length !== 3) fail('evidence artifact roster is invalid');
  for (const file of files.slice(0, 2)) {
    const artifact = relativeJson(file, 'document evidence file');
    if (artifact.schema !== 'mediflow.capability-mapping.document-evidence.v1' || artifact.applyPolicy !== 'none' || !Array.isArray(artifact.records) || artifact.records.some((record) => record.evidenceKind !== 'document' || !sourcePaths.has(record.ref))) fail('document evidence artifact is invalid');
  }
  const keyboard = relativeJson(files[2], 'keyboard boundary file');
  if (keyboard.schema !== 'mediflow.capability-mapping.keyboard-boundary.v1' || keyboard.applyPolicy !== 'none' || keyboard.terminalDisposition !== 'out_of_catalog' || JSON.stringify(keyboard.coveredSourceSetIds) !== JSON.stringify(['keyboard-http-routes', 'keyboard-product-pages', 'keyboard-command-evidence']) || keyboard.evidence?.some((evidence) => evidence.evidenceKind !== 'test' || !sourcePaths.has(evidence.ref))) fail('keyboard boundary artifact is invalid');
}
function validateFrozenRef(ref, label) {
  const match = typeof ref === 'string' && ref.match(/^([0-9a-f]{40}):(.+)$/);
  if (!match) fail(`${label}: invalid frozen ref`);
  if (FROZEN_REF_CACHE.has(ref)) return;
  try { git('cat-file', '-e', `${match[1]}:${match[2]}`); } catch { fail(`${label}: frozen ref does not resolve`); }
  FROZEN_REF_CACHE.add(ref);
}
function validateProductDecision(basis, relations, fabric) {
  const receipt = relativeJson(basis.productDecisionReceiptFile, 'product decision receipt');
  if (receipt.schema !== 'mediflow.capability-mapping.product-decision-receipt.v1' || receipt.status !== 'candidate_not_integrated' || receipt.applyPolicy !== 'none' || receipt.decisionId !== 'MF085-C1-FABRIC-CANONICAL-20260823' || receipt.decisionSha256 !== 'c6ca0769ceb84b60f43cd6f9f8ebf310570e243709b3a6056ff88da1b72fe851' || receipt.decisionPath !== 'external:mediflow-0.8.5-fabric-product-crosswalk-decision-v1.json' || receipt.claimCeiling !== 'local product-approved semantic mapping basis; not integrated, not release-ready, not released' || !receipt.bindingRule.includes('does not assert that the Fabric resolver dispatches that runtime') || receipt.decisionCount !== 16 || receipt.functionalRelationCount !== 23 || receipt.registryExposureCount !== 16 || JSON.stringify(receipt.outOfCatalogFabricIds) !== JSON.stringify(['document_identity_resolution'])) fail('product decision receipt is invalid');
  receipt.globalEvidence.forEach((evidence) => validateFrozenRef(evidence.ref, 'product decision evidence'));
  const decided = relations.filter((relation) => relation.decisionId === receipt.decisionId);
  const catalog = 'anchor:web:web-65-registro-intelligence-fabric-16-capability-4-venue-osservate-e-p@1e35733c0218';
  const exposures = decided.filter((relation) => relation.relationKind === 'exposes');
  const functional = decided.filter((relation) => relation.relationKind !== 'exposes');
  if (decided.length !== 39 || exposures.length !== 16 || new Set(exposures.map((relation) => relation.from)).size !== 16 || exposures.some((relation) => relation.to !== catalog || relation.exposureScope !== 'read_only_registry_roster' || relation.runtimeBinding !== 'governance_exposure_only') || functional.some((relation) => relation.runtimeBinding?.startsWith('descriptor_entry_point_only') && relation.relationKind !== 'supports') || functional.some((relation) => relation.relationKind === 'implements' && relation.runtimeBinding !== 'runtime_bound_by_ai-summary-fabric') || decided.some((relation) => relation.relationKind === 'exact_identity' || relation.authority !== 'unresolved' || relation.stage !== 'unresolved')) fail('product decision relations collapse identity, authority, stage, or runtime binding');
  const identity = fabric.find((record) => record.sourceIdentity.identifier === 'document_identity_resolution');
  if (!identity || identity.terminalDisposition !== 'out_of_catalog' || decided.some((relation) => relation.from === identity.id && relation.relationKind !== 'exposes')) fail('document identity resolution has an unproven consumer');
}
function validateSurfaceDispositions(basis, relations, sourcePaths) {
  const receipt = relativeJson(basis.surfaceDispositionReceiptFile, 'surface disposition receipt');
  const expectedCounts = { webOutOfCatalog: 166, miniMapped: 6, iosIpadosOutOfCatalog: 1, macosOutOfCatalog: 4 };
  if (receipt.schema !== 'mediflow.capability-mapping.surface-terminal-dispositions.v1' || receipt.status !== 'candidate_not_integrated' || receipt.applyPolicy !== 'none' || JSON.stringify(receipt.populationCounts) !== JSON.stringify(expectedCounts) || receipt.authorityRule !== 'terminal disposition does not grant or union authority or stage' || !sourcePaths.has(receipt.closedCatalogEvidence?.ref)) fail('surface disposition receipt is invalid');
  const surfaces = populationRecords(basis.populations.surfaces);
  const mini = surfaces.filter((record) => record.sourceIdentity.sourceKind === 'mini_command');
  const nonMini = surfaces.filter((record) => record.sourceIdentity.sourceKind !== 'mini_command');
  const miniBindings = relations.filter((relation) => relation.from.startsWith('surface:mini:command:'));
  if (mini.length !== 6 || nonMini.length !== 171 || mini.some((record) => record.terminalDisposition !== 'mapped') || nonMini.some((record) => record.terminalDisposition !== 'out_of_catalog') || miniBindings.length !== mini.length || new Set(miniBindings.map((relation) => relation.from)).size !== mini.length || miniBindings.some((relation) => relation.relationKind !== 'supports' || relation.authority !== 'unresolved' || relation.stage !== 'unresolved')) fail('surface terminal dispositions are not positive and source-bound');
}
function validateMockupBoundary(basis) {
  const boundary = relativeJson(basis.mockupBoundaryFile, 'mockup boundary file');
  if (boundary.schema !== 'mediflow.capability-mapping.mockup-boundary.v1' || boundary.status !== 'candidate_not_integrated' || boundary.applyPolicy !== 'none' || boundary.terminalDisposition !== 'out_of_catalog' || boundary.excludedPathPrefix !== 'app/mockups/' || !Array.isArray(boundary.evidence) || boundary.evidence.length !== 2) fail('mockup boundary artifact is invalid');
  boundary.evidence.forEach((evidence) => validateFrozenRef(evidence.ref, 'mockup boundary evidence'));
}
function dispositionCounts(records) {
  return Object.fromEntries([...TERMINAL_DISPOSITIONS].map((disposition) => [disposition, records.filter((record) => record.terminalDisposition === disposition).length]));
}
function requireUnique(records, key, label) {
  const values = records.map(key);
  if (values.some((value) => typeof value !== 'string') || new Set(values).size !== values.length) fail(`${label} has duplicate or invalid identities`);
}
function validateCoverage(basis, coverage) {
  if (coverage.schema !== 'mediflow.capability-mapping.coverage-receipt.v1' || coverage.mappingVersion !== 1 || coverage.status !== 'candidate_not_integrated' || coverage.applyPolicy !== 'none') fail('coverage receipt contract is invalid');
  if (coverage.sourceManifestSha256 !== basis.sourceManifestSha256 || coverage.claimCeiling !== basis.claimCeiling) fail('coverage receipt provenance or claim ceiling drifted');
  const expected = new Map([['anchors', 66], ['aip', 109], ['fabric', 16], ['surfaces', 177]]);
  const declared = new Map((coverage.populationCoverage ?? []).map((entry) => [entry.populationId, entry]));
  if (declared.size !== expected.size) fail('coverage receipt population roster is invalid');
  for (const [populationId, expectedCount] of expected) {
    const records = populationRecords(basis.populations[populationId]);
    const entry = declared.get(populationId);
    if (!entry || entry.expectedCount !== expectedCount || entry.observedCount !== records.length || records.length !== expectedCount || JSON.stringify(entry.terminalDispositionCounts) !== JSON.stringify(dispositionCounts(records))) fail(`coverage receipt ${populationId} is incomplete or drifted`);
    requireUnique(records, (record) => record.id, `${populationId} population`);
    requireUnique(records, (record) => JSON.stringify(record.sourceIdentity), `${populationId} source identity`);
  }
  const relations = relationRecords(basis);
  const expectedRelations = populationRecords(basis.populations.anchors).length + populationRecords(basis.populations.fabric).length + 39 + populationRecords(basis.populations.surfaces).filter((record) => record.sourceIdentity.sourceKind === 'mini_command').length;
  if (coverage.relationCoverage?.expectedCount !== expectedRelations || coverage.relationCoverage.observedCount !== relations.length || relations.length !== expectedRelations) fail('coverage receipt relation coverage is incomplete or drifted');
  requireUnique(relations, (relation) => relation.id, 'relations');
  const conflicts = conflictRecords(basis);
  const residual = conflicts.filter((conflict) => ['unmapped', 'conflicted'].includes(conflict.terminalDisposition));
  if (coverage.conflictCoverage?.observedCount !== conflicts.length || coverage.conflictCoverage.residualCount !== residual.length || JSON.stringify(coverage.conflictCoverage.residualConflictIds) !== JSON.stringify(residual.map((conflict) => conflict.conflictId))) fail('coverage receipt conflict coverage is incomplete or collapsed');
  requireUnique(conflicts, (conflict) => conflict.conflictId, 'conflicts');
  requireUnique(conflicts, (conflict) => conflict.subjectId, 'conflict subjects');
  if (coverage.ledgerComplete !== basis.ledgerComplete || coverage.semanticBindingComplete !== basis.semanticBindingComplete) fail('coverage receipt completion flags drifted');
  if (basis.ledgerComplete && [...expected.keys()].some((populationId) => populationRecords(basis.populations[populationId]).some((record) => !TERMINAL_DISPOSITIONS.has(record.terminalDisposition)))) fail('complete ledger has an undisposed record');
}
function validateHumanReport(coverage, report) {
  if (!report.includes(`> ${coverage.claimCeiling}`)) fail('human report claim ceiling drifted');
  if (!report.includes(`\`ledgerComplete=${coverage.ledgerComplete}\``) || !report.includes(`\`semanticBindingComplete=${coverage.semanticBindingComplete}\``)) fail('human report completion claim drifted');
}
function validateWebMiniCrosswalk(basis, anchorRecords) {
  const population = basis.populations.anchors;
  if (!population.recordFile) return;
  const source = JSON.parse(git('show', '1e35733c0218eae67a1d6e158085aab7340bc26b:packages/mini/contracts/mini-parity.json'));
  if (anchorRecords.length !== 66 || source.capabilities?.length !== 66) fail('web-mini crosswalk coverage drift');
  anchorRecords.forEach((record, index) => {
    if (record.sourceIdentity?.sourceRow !== index + 1 || record.authority !== 'unresolved' || record.stage !== 'unresolved' || record.terminalDisposition !== 'mapped') fail('web-mini crosswalk derives authority or stage');
    if (JSON.stringify(record.sourceRecord) !== JSON.stringify(source.capabilities[index])) fail(`web-mini crosswalk lost source record ${index + 1}`);
  });
}
function validateNode(node, sourcePaths) {
  const fields = ['id', 'sourceIdentity', 'description', 'surface', 'stage', 'authority', 'input', 'output', 'provider', 'venue', 'egress', 'evidence', 'terminalDisposition'];
  if (!node || typeof node !== 'object' || fields.some((field) => !(field in node))) fail('node is incomplete');
  if (!TERMINAL_DISPOSITIONS.has(node.terminalDisposition)) fail(`node ${node.id}: terminal disposition is invalid`);
  if (!Array.isArray(node.evidence) || node.evidence.length === 0) fail(`node ${node.id}: evidence is required`);
  if (node.evidence.some((evidence) => !evidence || typeof evidence !== 'object' || !EVIDENCE_KINDS.has(evidence.evidenceKind) || typeof evidence.ref !== 'string' || !sourcePaths.has(evidence.ref))) fail(`node ${node.id}: evidence path escaped the source freeze`);
  if (typeof node.authority !== 'string' || typeof node.stage !== 'string') fail(`node ${node.id}: authority or stage is unioned`);
}
function validateBasis(basis, manifestBytes, sourcePaths) {
  if (basis.schema !== 'mediflow.capability-mapping.basis.v1' || basis.mappingVersion !== 1) fail('mapping basis schema is invalid');
  if (basis.sourceManifestSha256 !== sha256(manifestBytes)) fail('mapping basis source manifest digest drifted');
  if (basis.applyPolicy !== 'none') fail('applyPolicy must be none');
  requireExactArray(basis.relationKinds, [...RELATION_KINDS], 'relation kind vocabulary');
  requireExactArray(basis.terminalDispositions, [...TERMINAL_DISPOSITIONS], 'terminal disposition vocabulary');
  if (basis.claimCeiling !== CLAIM_CEILING) fail('claim ceiling is invalid');
  for (const [population, expected] of [['anchors', 66], ['aip', 109]]) {
    const value = basis.populations?.[population];
    if (!value || value.expectedCount !== expected || !Array.isArray(value.records)) fail(`${population} population contract is invalid`);
    const records = populationRecords(value);
    records.forEach((record) => validateNode(record, sourcePaths));
    if (records.length > expected) fail(`${population} has too many records`);
    if (population === 'anchors') validateWebMiniCrosswalk(basis, records);
  }
  for (const population of ['fabric', 'surfaces']) {
    const records = basis.populations?.[population] && populationRecords(basis.populations[population]);
    if (!Array.isArray(records)) fail(`${population} population contract is invalid`);
    records.forEach((record) => validateNode(record, sourcePaths));
  }
  validateWebMiniSurfaceEligibility(basis);
  validateEvidenceArtifacts(basis, sourcePaths);
  const relations = relationRecords(basis);
  if (!relations.every((relation) => relation && typeof relation.id === 'string' && typeof relation.from === 'string' && typeof relation.to === 'string' && RELATION_KINDS.has(relation.relationKind) && Array.isArray(relation.evidence) && relation.evidence.length > 0 && relation.evidence.every((evidence) => evidence && EVIDENCE_KINDS.has(evidence.evidenceKind) && typeof evidence.locator === 'string' && (validateFrozenRef(evidence.ref, `relation ${relation.id}`), true)) && (![relation.authority, relation.stage].some((value) => value !== undefined && typeof value !== 'string')))) fail('relation contract is invalid');
  validateProductDecision(basis, relations, populationRecords(basis.populations.fabric));
  validateSurfaceDispositions(basis, relations, sourcePaths);
  validateMockupBoundary(basis);
  const conflicts = conflictRecords(basis);
  const conflictFields = ['conflictId', 'subjectId', 'observedFact', 'ambiguity', 'decisionOwner', 'requiredEvidence', 'status', 'terminalDisposition', 'evidence'];
  if (!conflicts.every((conflict) => conflict && conflictFields.every((field) => field in conflict) && TERMINAL_DISPOSITIONS.has(conflict.terminalDisposition) && ['technical_worker', 'chief', 'product_owner', 'compliance_owner'].includes(conflict.decisionOwner) && Array.isArray(conflict.alternatives) && conflict.alternatives.length >= 2 && Array.isArray(conflict.consequences) && conflict.consequences.length === conflict.alternatives.length && Array.isArray(conflict.evidence) && conflict.evidence.length > 0)) fail('conflict contract is invalid');
  requireUnique(conflicts, (conflict) => conflict.conflictId, 'conflicts');
  requireUnique(conflicts, (conflict) => conflict.subjectId, 'conflict subjects');
  const nodes = Object.values(basis.populations).flatMap(populationRecords);
  const terminal = [...nodes, ...conflicts];
  if (basis.ledgerComplete && terminal.some((value) => !TERMINAL_DISPOSITIONS.has(value.terminalDisposition))) fail('complete ledger has an undisposed record');
  if (basis.semanticBindingComplete && terminal.some((value) => ['unmapped', 'conflicted'].includes(value.terminalDisposition))) fail('semantic binding cannot be complete with unresolved records');
  if (basis.semanticBindingComplete && populationRecords(basis.populations.surfaces).some((record) => !['mapped', 'infrastructure_only', 'out_of_catalog'].includes(record.terminalDisposition))) fail('semantic binding has a surface without a positive disposition');
}
function validateSourceSetConsumption(manifest, basis, sourcePaths) {
  const refs = new Set(Object.values(basis.populations).flatMap(populationRecords).flatMap((record) => record.evidence.map((evidence) => evidence.ref)).concat(relationRecords(basis).flatMap((record) => record.evidence.map((evidence) => evidence.ref)), basis.evidenceFiles.flatMap((file) => relativeJson(file, 'evidence artifact').records?.flatMap((record) => record.evidence?.map((evidence) => evidence.ref) ?? [record.ref]) ?? [])));
  const keyboard = relativeJson(basis.evidenceFiles[2], 'keyboard boundary file');
  keyboard.evidence.forEach((evidence) => refs.add(evidence.ref));
  for (const set of manifest.sourceSets) {
    const source = manifest.sources.find((value) => value.sourceId === set.sourceId);
    const roster = relativeJson(set.rosterFile, 'source roster');
    if (!roster.records.some((record) => refs.has(`${source.commit}:${record.path}`)) && !keyboard.coveredSourceSetIds.includes(set.sourceSetId)) fail(`${set.sourceSetId}: source set is unconsumed`);
  }
  if (refs.size === 0 || ![...refs].every((ref) => sourcePaths.has(ref) || /^[0-9a-f]{40}:.+$/.test(ref))) fail('evidence ref contract is invalid');
}

export function validateCapabilityMapping(manifest = json(MANIFEST_PATH), basis = json(BASIS_PATH), manifestBytes = readFileSync(MANIFEST_PATH), coverage = json(COVERAGE_PATH), report = readFileSync(REPORT_PATH, 'utf8')) {
  if (manifest.schema !== 'mediflow.capability-mapping.source-manifest.v1' || manifest.mappingVersion !== 1 || manifest.status !== 'candidate' || manifest.integrationStatus !== 'not_integrated' || manifest.applyPolicy !== 'none') fail('source manifest contract is invalid');
  const sources = new Map(manifest.sources?.map((source) => [source.sourceId, source]));
  if (sources.size !== 9 || [...sources.values()].some((source) => !/^[0-9a-f]{40}$/.test(source.commit) || !source.status.endsWith('not_integrated'))) fail('source roster is invalid');
  const setIds = new Set();
  const sourcePaths = new Set();
  for (const set of manifest.sourceSets ?? []) {
    if (setIds.has(set.sourceSetId)) fail(`duplicate source set ${set.sourceSetId}`);
    setIds.add(set.sourceSetId);
    const source = sources.get(set.sourceId);
    if (!source) fail(`${set.sourceSetId}: unknown source`);
    git('cat-file', '-e', `${source.commit}^{commit}`);
    const records = sourceRecords(set, source);
    if (records.length !== set.recordCount || digest(records) !== set.sourceSetSha256) fail(`${set.sourceSetId}: source drift`);
    records.forEach((record) => sourcePaths.add(`${source.commit}:${record.path}`));
  }
  if (setIds.size !== 11) fail('source manifest is incomplete');
  validateBasis(basis, manifestBytes, sourcePaths);
  validateSourceSetConsumption(manifest, basis, sourcePaths);
  validateCoverage(basis, coverage);
  validateHumanReport(coverage, report);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) validateCapabilityMapping();
