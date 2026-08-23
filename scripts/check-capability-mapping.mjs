/* @Codex */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST_PATH = `${ROOT}/docs/capability-mapping/source-manifest.v1.json`;
const BASIS_PATH = `${ROOT}/docs/capability-mapping/mapping-basis.v1.json`;
const RELATION_KINDS = new Set(['exact_identity', 'implements', 'exposes', 'supports', 'authority_boundary_for']);
const TERMINAL_DISPOSITIONS = new Set(['mapped', 'infrastructure_only', 'out_of_catalog', 'unmapped', 'conflicted']);
const CLAIM_CEILING = 'mapping candidate locale verificato su exact head indipendenti; non integrato, non release-ready, non released';

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
function sourceRecords(set, source) {
  const records = tree(source.commit);
  if (Array.isArray(set.paths)) return set.paths.map((expected) => {
    const actual = records.find((record) => record.path === expected.path);
    if (!actual || actual.gitBlob !== expected.gitBlob || actual.byteLength !== expected.byteLength) fail(`${set.sourceSetId}: source drift at ${expected.path}`);
    return actual;
  }).sort((a, b) => a.path.localeCompare(b.path));
  if (typeof set.pathMatcher !== 'string') fail(`${set.sourceSetId}: missing closed path selector`);
  const matcher = new RegExp(set.pathMatcher, set.pathMatcherFlags ?? '');
  return records.filter((record) => matcher.test(record.path)).sort((a, b) => a.path.localeCompare(b.path));
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
function validateNode(node) {
  const fields = ['id', 'sourceIdentity', 'description', 'surface', 'stage', 'authority', 'input', 'output', 'provider', 'venue', 'egress', 'evidence', 'terminalDisposition'];
  if (!node || typeof node !== 'object' || fields.some((field) => !(field in node))) fail('node is incomplete');
  if (!TERMINAL_DISPOSITIONS.has(node.terminalDisposition)) fail(`node ${node.id}: terminal disposition is invalid`);
  if (!Array.isArray(node.evidence) || node.evidence.length === 0) fail(`node ${node.id}: evidence is required`);
}
function validateBasis(basis, manifestBytes) {
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
    records.forEach(validateNode);
    if (records.length > expected) fail(`${population} has too many records`);
    if (population === 'anchors') validateWebMiniCrosswalk(basis, records);
  }
  for (const population of ['fabric', 'surfaces']) {
    const records = basis.populations?.[population] && populationRecords(basis.populations[population]);
    if (!Array.isArray(records)) fail(`${population} population contract is invalid`);
    records.forEach(validateNode);
  }
  const relations = relationRecords(basis);
  if (!relations.every((relation) => relation && RELATION_KINDS.has(relation.relationKind) && Array.isArray(relation.evidence) && relation.evidence.length > 0)) fail('relation contract is invalid');
  const conflicts = conflictRecords(basis);
  if (!conflicts.every((conflict) => conflict && TERMINAL_DISPOSITIONS.has(conflict.terminalDisposition) && ['technical_worker', 'chief', 'product_owner', 'compliance_owner'].includes(conflict.decisionOwner) && Array.isArray(conflict.alternatives) && Array.isArray(conflict.consequences))) fail('conflict contract is invalid');
  const nodes = Object.values(basis.populations).flatMap(populationRecords);
  const terminal = [...nodes, ...conflicts];
  if (basis.ledgerComplete && terminal.some((value) => !TERMINAL_DISPOSITIONS.has(value.terminalDisposition))) fail('complete ledger has an undisposed record');
  if (basis.semanticBindingComplete && terminal.some((value) => ['unmapped', 'conflicted'].includes(value.terminalDisposition))) fail('semantic binding cannot be complete with unresolved records');
}

export function validateCapabilityMapping(manifest = json(MANIFEST_PATH), basis = json(BASIS_PATH), manifestBytes = readFileSync(MANIFEST_PATH)) {
  if (manifest.schema !== 'mediflow.capability-mapping.source-manifest.v1' || manifest.mappingVersion !== 1 || manifest.status !== 'candidate' || manifest.integrationStatus !== 'not_integrated' || manifest.applyPolicy !== 'none') fail('source manifest contract is invalid');
  const sources = new Map(manifest.sources?.map((source) => [source.sourceId, source]));
  if (sources.size !== 9 || [...sources.values()].some((source) => !/^[0-9a-f]{40}$/.test(source.commit) || !source.status.endsWith('not_integrated'))) fail('source roster is invalid');
  const setIds = new Set();
  for (const set of manifest.sourceSets ?? []) {
    if (setIds.has(set.sourceSetId)) fail(`duplicate source set ${set.sourceSetId}`);
    setIds.add(set.sourceSetId);
    const source = sources.get(set.sourceId);
    if (!source) fail(`${set.sourceSetId}: unknown source`);
    git('cat-file', '-e', `${source.commit}^{commit}`);
    const records = sourceRecords(set, source);
    if (records.length !== set.recordCount || digest(records) !== set.sourceSetSha256) fail(`${set.sourceSetId}: source drift`);
  }
  if (setIds.size !== 10) fail('source manifest is incomplete');
  validateBasis(basis, manifestBytes);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) validateCapabilityMapping();
