#!/usr/bin/env node
// @Codex
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, 'docs/apple-wide-qa-manifest.json');
const parityMatrixPath = path.join(rootDir, 'docs/apple-parity-matrix.json');
const runtimeContractPath = path.join(rootDir, 'lib/network-contract.ts');
const typeContractPath = path.join(rootDir, 'lib/api/v1/types.ts');
const openApiContractPath = path.join(rootDir, 'docs/openapi/mediflow-v1.yaml');
const allowedStatuses = new Set(['covered', 'gap', 'blocked']);
const allowedEvidenceTypes = new Set(['command', 'runbook', 'adr', 'issue', 'pr', 'manual']);
const allowedParityGaps = new Set(['full-parity', 'partial', 'missing-both', 'host-only']);
const expectedParitySummary = {
  total: 64,
  fullParity: 30,
  partial: 13,
  missing: 0,
  hostOnly: 21,
  openNonHost: 13,
};
const expectedManifestGaps = new Map([
  ['mobile-offline-cache-reconciliation', 'WUL-403'],
  ['apple-wide-click-map', 'WUL-481'],
]);
const requiredCapabilities = [
  'macos-packaged-home-base-runtime',
  'shared-apple-core-contracts',
  'mobile-paired-bootstrap-read',
  'paired-ambulatory-write',
  'paired-account-pin-rotation',
  'paired-profile-write',
  'paired-diary-write',
  'paired-therapy-write',
  'paired-checkup-write',
  'paired-observation-write',
  'paired-patient-lifecycle-boundary',
  'paired-catalog-read',
  'paired-cross-patient-agenda-read',
  'paired-cross-patient-diary-read',
  'paired-service-prescriptions-boundary',
  'paired-prosthetic-prescriptions-boundary',
  'paired-network-discovery-dual-auth',
  'paired-network-revision-boundary',
  'paired-fse-validation-boundary',
  'paired-document-domain-boundary',
  'paired-visit-draft-and-ai-runtime-status',
  'mobile-core-crud-ui',
  'mobile-offline-cache-reconciliation',
  'apple-wide-click-map'
];

function fail(message) {
  console.error(`check:apple-wide-qa failed: ${message}`);
  process.exitCode = 1;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function pathExists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function uniqueStrings(value, label) {
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    fail(`${label} must be an array of non-empty strings.`);
    return [];
  }

  if (new Set(value).size !== value.length) {
    fail(`${label} must not contain duplicate keys.`);
  }

  return value;
}

function extractRuntimeKeys(source) {
  const fseCapability = source.match(/const NETWORK_FSE_VALIDATE_CAPABILITY = '([^']+)'/)?.[1];
  return [...source.matchAll(/capability\(\s*(?:'([^']+)'|NETWORK_FSE_VALIDATE_CAPABILITY)/g)]
    .map((match) => match[1] ?? fseCapability)
    .filter(Boolean);
}

function extractTypeKeys(source) {
  const block = source.match(/export type NetworkCapabilityKey =[\s\S]*?;/)?.[0] ?? '';
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function extractOpenApiKeys(source) {
  const block = source.match(/    NetworkCapability:\n[\s\S]*?(?=    NetworkCapabilitiesResponse:)/)?.[0] ?? '';
  return [...block.matchAll(/^            - ((?:network|local)\.[\w.-]+)$/gm)].map((match) => match[1]);
}

function sameKeySet(actual, expected, label) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !actualSet.has(key));
  const unexpected = actual.filter((key) => !expectedSet.has(key));
  if (missing.length > 0 || unexpected.length > 0 || actual.length !== actualSet.size) {
    fail(`${label} must match the manifest network capability contract; missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}.`);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const parityMatrix = JSON.parse(fs.readFileSync(parityMatrixPath, 'utf8'));
const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
const ids = new Set();
const networkCapabilityContract = manifest.networkCapabilityContract;

if (manifest.issue !== 'WUL-479' || manifest.originIssue !== 'WUL-194') {
  fail('manifest must identify WUL-479 as closeout issue and WUL-194 as origin issue.');
}

const parityRows = Array.isArray(parityMatrix.rows) ? parityMatrix.rows : [];
const parityRowIds = new Set();
const parityCounts = { total: parityRows.length, fullParity: 0, partial: 0, missing: 0, hostOnly: 0 };

for (const row of parityRows) {
  const rowId = `${row.area}::${row.feature}`;
  if (!isNonEmptyString(row.area) || !isNonEmptyString(row.feature)) {
    fail('parity rows require non-empty area and feature.');
  }
  if (parityRowIds.has(rowId)) fail(`duplicate parity row ${rowId}.`);
  parityRowIds.add(rowId);
  if (!allowedParityGaps.has(row.gap)) fail(`${rowId}: invalid parity gap ${row.gap}.`);
  if (!isNonEmptyString(row.evidence)) fail(`${rowId}: evidence is required.`);

  if (row.gap === 'full-parity') parityCounts.fullParity += 1;
  if (row.gap === 'partial') parityCounts.partial += 1;
  if (row.gap === 'missing-both') parityCounts.missing += 1;
  if (row.gap === 'host-only') parityCounts.hostOnly += 1;
}

parityCounts.openNonHost = parityCounts.partial + parityCounts.missing;
for (const [key, expected] of Object.entries(expectedParitySummary)) {
  if (parityCounts[key] !== expected || parityMatrix.summary?.[key] !== expected) {
    fail(`parity summary ${key} must be ${expected}.`);
  }
}
if (!Array.isArray(parityMatrix.critique_residua) || parityMatrix.critique_residua.length !== 0) {
  fail('parity matrix must not retain unresolved critique items.');
}
if (JSON.stringify(parityMatrix).includes('mediflow_private')) {
  fail('parity matrix must reference only the public operational repository.');
}
if (JSON.stringify(manifest).includes('mediflow_private')) {
  fail('QA manifest must reference only the public operational repository.');
}

if (!networkCapabilityContract || typeof networkCapabilityContract !== 'object') {
  fail('manifest.networkCapabilityContract is required.');
} else {
  const activeNetworkKeys = uniqueStrings(networkCapabilityContract.activeNetworkKeys, 'networkCapabilityContract.activeNetworkKeys');
  const plannedNetworkKeys = uniqueStrings(networkCapabilityContract.plannedNetworkKeys, 'networkCapabilityContract.plannedNetworkKeys');
  const localOnlyKeys = uniqueStrings(networkCapabilityContract.localOnlyKeys, 'networkCapabilityContract.localOnlyKeys');
  const expectedKeys = [...activeNetworkKeys, ...plannedNetworkKeys, ...localOnlyKeys];

  if (activeNetworkKeys.length !== 25 || plannedNetworkKeys.length !== 2 || localOnlyKeys.length !== 2) {
    fail('networkCapabilityContract must contain 25 active network keys, 2 planned network keys, and 2 local-only keys.');
  }
  if (new Set(expectedKeys).size !== expectedKeys.length) {
    fail('networkCapabilityContract key categories must not overlap.');
  }
  if (!isNonEmptyString(networkCapabilityContract.note)) {
    fail('networkCapabilityContract.note is required.');
  }

  sameKeySet(extractRuntimeKeys(fs.readFileSync(runtimeContractPath, 'utf8')), expectedKeys, 'lib/network-contract.ts');
  sameKeySet(extractTypeKeys(fs.readFileSync(typeContractPath, 'utf8')), expectedKeys, 'lib/api/v1/types.ts');
  sameKeySet(extractOpenApiKeys(fs.readFileSync(openApiContractPath, 'utf8')), expectedKeys, 'docs/openapi/mediflow-v1.yaml');
}

for (const requiredId of requiredCapabilities) {
  if (!capabilities.some((capability) => capability.id === requiredId)) {
    fail(`missing required capability ${requiredId}.`);
  }
}

if (capabilities.length !== 24) {
  fail('manifest.capabilities must contain 24 QA acceptance records.');
}

for (const capability of capabilities) {
  if (!isNonEmptyString(capability.id)) fail('capability id is required.');
  if (ids.has(capability.id)) fail(`duplicate capability id ${capability.id}.`);
  ids.add(capability.id);

  if (!isNonEmptyString(capability.title)) fail(`${capability.id}: title is required.`);
  if (!Array.isArray(capability.surfaces) || capability.surfaces.length === 0) {
    fail(`${capability.id}: at least one surface is required.`);
  }
  if (!allowedStatuses.has(capability.status)) {
    fail(`${capability.id}: invalid status ${capability.status}.`);
  }
  if (!isNonEmptyString(capability.acceptance)) {
    fail(`${capability.id}: acceptance is required.`);
  }
  if (!Array.isArray(capability.evidence) || capability.evidence.length === 0) {
    fail(`${capability.id}: evidence is required.`);
  }

  if (capability.status === 'covered') {
    const hasRepeatableEvidence = capability.evidence.some((item) => item.type === 'command' || item.type === 'runbook');
    if (!hasRepeatableEvidence) {
      fail(`${capability.id}: covered capability requires command or runbook evidence.`);
    }
  }

  if ((capability.status === 'gap' || capability.status === 'blocked') && !isNonEmptyString(capability.gapIssue)) {
    fail(`${capability.id}: ${capability.status} capability requires gapIssue.`);
  }

  for (const item of capability.evidence) {
    if (!allowedEvidenceTypes.has(item.type)) {
      fail(`${capability.id}: invalid evidence type ${item.type}.`);
    }
    if (!isNonEmptyString(item.value)) {
      fail(`${capability.id}: evidence value is required.`);
    }
    if ((item.type === 'runbook' || item.type === 'adr') && !pathExists(item.value)) {
      fail(`${capability.id}: evidence path does not exist: ${item.value}.`);
    }
  }
}

const actualManifestGaps = capabilities.filter((capability) => capability.status !== 'covered');
if (actualManifestGaps.length !== expectedManifestGaps.size) {
  fail(`manifest must contain exactly ${expectedManifestGaps.size} non-covered capabilities.`);
}
for (const [capabilityId, gapIssue] of expectedManifestGaps) {
  const capability = capabilities.find((candidate) => candidate.id === capabilityId);
  if (!capability || capability.status !== 'gap' || capability.gapIssue !== gapIssue) {
    fail(`${capabilityId} must be the gap owned by ${gapIssue}.`);
  }
}
for (const capability of actualManifestGaps) {
  if (!expectedManifestGaps.has(capability.id)) {
    fail(`${capability.id}: unexpected non-covered capability.`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`check:apple-wide-qa passed (${capabilities.length} capabilities).`);
