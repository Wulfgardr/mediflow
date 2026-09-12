#!/usr/bin/env node
/* @Codex */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST_PATH = 'docs/capability-mapping/fabric-generative-runtime-crosswalk.v1.json';
const EXPECTED_IDS = Object.freeze([
  'patient_insight',
  'smart_import',
  'document_synthesis',
  'ocr',
  'treatment_reasoning',
]);
const CLAIM_CEILING = 'local source runtime crosswalk for four review-only proposals; OCR unavailable; not release-ready, released, deployed, or authorized for clinical apply';
const HISTORICAL_SHA256 = '92586d894827a8e920995fa7cf0e1ce771b636bce3ed77f564015e61606832fa';
const TOP_LEVEL_KEYS = Object.freeze([
  'schema',
  'release',
  'integrationStatus',
  'applyPolicy',
  'claimCeiling',
  'catalogPath',
  'historicalArtifacts',
  'capabilities',
  'functionModelChoice',
]);
const CAPABILITY_KEYS = Object.freeze([
  'id',
  'disposition',
  'descriptorEntryPoint',
  'productionRoot',
  'productionRootLiterals',
  'requestPath',
  'wireEvidence',
  'uiEvidence',
]);

function fail(message) {
  throw new Error(`fabric generative runtime crosswalk: ${message}`);
}

function safePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)
    || value.split('/').includes('..') || value.includes('\\')) fail(`${label} non valido`);
  return value;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} non valido`);
  const keys = Object.keys(value).sort();
  const contract = [...expected].sort();
  if (JSON.stringify(keys) !== JSON.stringify(contract)) fail(`${label}: campi inattesi o mancanti`);
}

function sourceAccess(overrides = {}) {
  const exists = overrides.exists ?? ((relativePath) => existsSync(path.join(ROOT, relativePath)));
  const read = overrides.read ?? ((relativePath) => readFileSync(path.join(ROOT, relativePath)));
  return Object.freeze({
    exists(relativePath) {
      safePath(relativePath, 'source path');
      try { return exists(relativePath) === true; } catch { return false; }
    },
    bytes(relativePath) {
      safePath(relativePath, 'source path');
      let value;
      try { value = read(relativePath); } catch { fail(`source illeggibile: ${relativePath}`); }
      if (typeof value === 'string') return Buffer.from(value, 'utf8');
      if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
      fail(`source non testuale: ${relativePath}`);
    },
    text(relativePath) {
      return this.bytes(relativePath).toString('utf8');
    },
    json(relativePath, label) {
      try { return JSON.parse(this.text(relativePath)); } catch { return fail(`${label} non è JSON valido`); }
    },
  });
}

function ensureFile(sources, relativePath, label) {
  safePath(relativePath, label);
  if (!sources.exists(relativePath)) fail(`${label} mancante: ${relativePath}`);
  return sources.text(relativePath);
}

function requireLiteral(source, literal, label) {
  if (typeof literal !== 'string' || literal.length === 0 || !source.includes(literal)) fail(`${label}: letterale mancante ${JSON.stringify(literal)}`);
}

function requireLiteralList(source, literals, label, minimum = 1) {
  if (!Array.isArray(literals) || literals.length < minimum || new Set(literals).size !== literals.length) fail(`${label}: lista letterali non valida`);
  for (const literal of literals) requireLiteral(source, literal, label);
}

function capabilityBlock(catalog, id, nextId) {
  const marker = new RegExp(`\\n\\s*${id}\\s*:`, 'u');
  const found = marker.exec(catalog);
  if (!found) fail(`${id}: descriptor assente dal catalogo`);
  const start = found.index;
  if (!nextId) return catalog.slice(start);
  const next = new RegExp(`\\n\\s*${nextId}\\s*:`, 'u').exec(catalog.slice(start + found[0].length));
  if (!next) fail(`${id}: confine descriptor non risolvibile`);
  return catalog.slice(start, start + found[0].length + next.index);
}

function routeFile(requestRoute) {
  if (typeof requestRoute !== 'string' || !/^\/api\/ai\/[a-z0-9/-]+$/u.test(requestRoute)) fail(`request route non valida: ${requestRoute}`);
  return `app${requestRoute}/route.ts`;
}

function validateHistoricalArtifacts(manifest, sources) {
  if (!Array.isArray(manifest.historicalArtifacts) || manifest.historicalArtifacts.length !== 1) fail('roster artefatti storici non valido');
  const artifact = manifest.historicalArtifacts[0];
  exactKeys(artifact, ['path', 'sha256', 'requiredSchema', 'requiredStatus', 'requiredApplyPolicy'], 'artefatto storico');
  if (artifact.path !== 'docs/capability-mapping/fabric-product-crosswalk-receipt.v1.json'
    || artifact.sha256 !== HISTORICAL_SHA256
    || artifact.requiredSchema !== 'mediflow.capability-mapping.product-decision-receipt.v1'
    || artifact.requiredStatus !== 'candidate_not_integrated'
    || artifact.requiredApplyPolicy !== 'none') fail('artefatto storico: dichiarazione drift');
  const bytes = sources.bytes(artifact.path);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== artifact.sha256) fail(`artefatto storico ${artifact.path}: contenuto drift o relabel`);
  let receipt;
  try { receipt = JSON.parse(bytes.toString('utf8')); } catch { fail(`artefatto storico ${artifact.path}: JSON non valido`); }
  if (receipt.schema !== artifact.requiredSchema || receipt.status !== artifact.requiredStatus
    || receipt.applyPolicy !== artifact.requiredApplyPolicy) fail(`artefatto storico ${artifact.path}: stato relabeled`);
}

function validateRepositoryWiring(sources) {
  const packageJson = sources.json('package.json', 'package.json');
  const packageLock = sources.json('package-lock.json', 'package-lock.json');
  if (packageJson.version !== '0.8.6' || packageLock.version !== '0.8.6'
    || packageLock.packages?.['']?.version !== '0.8.6') fail('package version deve essere 0.8.6 in manifest e lockfile');
  if (packageJson.scripts?.['check:fabric-generative-runtime-crosswalk'] !== 'node scripts/check-fabric-generative-runtime-crosswalk.mjs'
    || packageJson.scripts?.['test:fabric-generative-runtime-crosswalk'] !== 'node --test scripts/check-fabric-generative-runtime-crosswalk.test.mjs') fail('package scripts del crosswalk non cablati');
  const workflow = ensureFile(sources, '.github/workflows/openapi-contract-guard.yml', 'workflow guard');
  requireLiteral(workflow, 'npm run check:fabric-generative-runtime-crosswalk', 'workflow guard');
  requireLiteral(workflow, 'npm run test:fabric-generative-runtime-crosswalk', 'workflow guard');
}

function validateAvailableCapability(row, catalogBlock, sources) {
  if (row.disposition !== 'proposal_only') fail(`${row.id}: disposition deve essere proposal_only`);
  const descriptorEntryPoint = safePath(row.descriptorEntryPoint, `${row.id}: descriptor entryPoint`);
  const productionRoot = safePath(row.productionRoot, `${row.id}: production root`);
  if (!catalogBlock.includes("'proposal_only'") || !catalogBlock.includes(`'${descriptorEntryPoint}'`)) {
    fail(`${row.id}: descriptor entryPoint o disposition in drift nel catalogo live`);
  }

  const production = ensureFile(sources, productionRoot, `${row.id}: production root`);
  requireLiteralList(production, row.productionRootLiterals, `${row.id}: production root`, 2);

  exactKeys(row.requestPath, ['caller', 'routes'], `${row.id}: request path`);
  const callerPath = safePath(row.requestPath.caller, `${row.id}: request caller`);
  const caller = ensureFile(sources, callerPath, `${row.id}: request caller`);
  if (!Array.isArray(row.requestPath.routes) || row.requestPath.routes.length === 0
    || new Set(row.requestPath.routes).size !== row.requestPath.routes.length) fail(`${row.id}: request path routes non valide`);
  const descriptorRoute = descriptorEntryPoint.replace(/^app/u, '').replace(/\/route\.ts$/u, '');
  if (!row.requestPath.routes.includes(descriptorRoute)) fail(`${row.id}: descriptor entryPoint non appartiene al request path`);
  for (const requestRoute of row.requestPath.routes) {
    const file = routeFile(requestRoute);
    if (!sources.exists(file)) fail(`${row.id}: route mancante ${file}`);
    requireLiteral(caller, requestRoute, `${row.id}: request path`);
  }

  const entrySource = ensureFile(sources, descriptorEntryPoint, `${row.id}: descriptor route`);
  requireLiteral(entrySource, `withFunctionModelDispatch('${row.id}',`, `${row.id}: sealed model dispatch`);
  const rootImport = `@/${productionRoot.replace(/\.ts$/u, '')}`;
  requireLiteral(entrySource, rootImport, `${row.id}: descriptor route -> production root`);

  exactKeys(row.wireEvidence, ['path', 'requiredLiterals'], `${row.id}: wire evidence`);
  const wireSource = ensureFile(sources, row.wireEvidence.path, `${row.id}: wire evidence`);
  requireLiteralList(wireSource, row.wireEvidence.requiredLiterals, `${row.id}: wire receipt/provenance`, 2);

  exactKeys(row.uiEvidence, ['path', 'requestBindingLiteral', 'requiredLiterals'], `${row.id}: UI evidence`);
  const uiSource = ensureFile(sources, row.uiEvidence.path, `${row.id}: UI evidence`);
  requireLiteral(uiSource, row.uiEvidence.requestBindingLiteral, `${row.id}: UI -> caller`);
  try {
    requireLiteralList(uiSource, row.uiEvidence.requiredLiterals, `${row.id}: UI receipt/provenance`, 3);
  } catch {
    fail(`${row.id}: UI receipt/provenance non visibili`);
  }
}

function validateOcr(row, catalogBlock, sources) {
  if (row.disposition !== 'unavailable') fail('OCR deve restare unavailable');
  if (row.descriptorEntryPoint !== null) fail('OCR richiede entryPoint null');
  if (row.productionRoot !== null) fail('OCR richiede production root null');
  if (row.productionRootLiterals !== null || row.requestPath !== null || row.wireEvidence !== null || row.uiEvidence !== null) {
    fail('OCR non può dichiarare runtime, request path o evidence di esecuzione');
  }
  if (!catalogBlock.includes("availabilityDisposition: 'unavailable'") || !catalogBlock.includes('entryPoint: null')) {
    fail('OCR descriptor live non è terminalmente unavailable');
  }
  if (sources.exists('app/api/ai/ocr/route.ts')) fail('OCR espone una route runtime vietata');
}

export function loadFabricGenerativeRuntimeCrosswalk() {
  try { return JSON.parse(readFileSync(path.join(ROOT, MANIFEST_PATH), 'utf8')); }
  catch { return fail(`manifest illeggibile: ${MANIFEST_PATH}`); }
}

export function validateFabricGenerativeRuntimeCrosswalk(manifest = loadFabricGenerativeRuntimeCrosswalk(), overrides = {}) {
  const sources = sourceAccess(overrides);
  exactKeys(manifest, TOP_LEVEL_KEYS, 'manifest');
  if (manifest.schema !== 'mediflow.ai.fabric-generative-runtime-crosswalk.v1'
    || manifest.release !== '0.8.6'
    || manifest.integrationStatus !== 'local_source_integrated'
    || manifest.applyPolicy !== 'none'
    || manifest.claimCeiling !== CLAIM_CEILING
    || manifest.catalogPath !== 'lib/ai-providers/fabric/generative-catalog.ts') fail('header manifest o claim ceiling non valido');
  validateHistoricalArtifacts(manifest, sources);
  validateRepositoryWiring(sources);

  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length !== EXPECTED_IDS.length
    || JSON.stringify(manifest.capabilities.map(({ id }) => id)) !== JSON.stringify(EXPECTED_IDS)) fail('roster capability deve contenere esattamente le cinque identità 0.8.6');
  for (const row of manifest.capabilities) exactKeys(row, CAPABILITY_KEYS, `capability ${row?.id ?? '<unknown>'}`);
  if (manifest.capabilities.filter(({ disposition }) => disposition === 'proposal_only').length !== 4) fail('quattro capability devono essere proposal_only');

  const roots = manifest.capabilities.filter(({ disposition }) => disposition === 'proposal_only').map(({ productionRoot }) => productionRoot);
  if (roots.some((root) => typeof root !== 'string') || new Set(roots).size !== roots.length) fail('production root duplicata o non valida');

  const choice = manifest.functionModelChoice;
  exactKeys(choice, ['contract', 'owner', 'mode', 'requestHeader', 'requiredFields', 'providerAdmission', 'apply'], 'function model choice');
  if (choice.contract !== 'docs/adr/0129-function-model-catalog-preferences.md' || choice.owner !== 'FunctionModelDispatch'
    || choice.mode !== 'sealed_catalog_option_only' || choice.requestHeader !== 'x-mediflow-function-model'
    || JSON.stringify(choice.requiredFields) !== JSON.stringify(['modelOptionId', 'expectedCatalogRevision'])
    || choice.providerAdmission !== 'host_cli_only' || choice.apply !== 'denied') fail('function model choice broadens authority');
  ensureFile(sources, choice.contract, 'function model contract');
  const catalog = ensureFile(sources, manifest.catalogPath, 'catalogo generativo');
  manifest.capabilities.forEach((row, index) => {
    const block = capabilityBlock(catalog, row.id, manifest.capabilities[index + 1]?.id);
    if (row.id === 'ocr') validateOcr(row, block, sources);
    else validateAvailableCapability(row, block, sources);
  });
  return Object.freeze({ capabilities: 5, proposalOnly: 4, unavailable: 1, release: '0.8.6' });
}

/** Capability-local proposal. The accepted generic v1 manifest is not widened. */
export const TREATMENT_PORTABLE_RUNTIME_CROSSWALK = Object.freeze({
  "schema": "mediflow.ai.treatment-reasoning-runtime-crosswalk.v2",
  "integrationStatus": "proposed_not_integrated",
  "capability": "treatment_reasoning",
  "provider": "athena_transformers",
  "model": "mims-harvard/ATHENA-R1-Qwen3-8B",
  "modelRevision": "acacc6b08e341aaf03c9639097255013ac65ebf2",
  "decision": "proposals/TREATMENT-PORTABLE-ADR.md",
  "legacyCrosswalk": {
    "path": "docs/capability-mapping/fabric-generative-runtime-crosswalk.v1.json",
    "sha256": "8f1defc83566b83fb18b09e780f1466d5e3fb0144659bb1e1f4721dcd7ad4034"
  },
  "preferenceSchema": "mediflow.function-preferences.v2",
  "preferenceHeader": "x-mediflow-function-preferences",
  "statusSchema": "mediflow.ai.fabric-status.v2",
  "statusHeader": "x-mediflow-fabric-status",
  "engineReceiptSchema": "mediflow.ai.treatment-reasoning-engine-receipt.v2",
  "workerRequestSchema": "mediflow.treatment-portable-worker-request.v2",
  "workerResultSchema": "mediflow.treatment-portable-worker-result.v1",
  "outputSchema": "mediflow.treatment_reasoning.v1",
  "applyPolicy": "none",
  "runtimeQualification": "not_observed"
});
const PORTABLE_SOURCE_REQUIREMENTS = Object.freeze({
  "lib/ai-providers/fabric/treatment-reasoning-production-root.ts": [
    "createTreatmentReasoningPortableRuntime",
    "captureTreatmentReasoningDispatch",
    "generateWithAthenaMlx",
    "createTreatmentReasoningPortableProductionService"
  ],
  "lib/ai-providers/fabric/treatment-reasoning-production-operation.ts": [
    "mediflow.ai.treatment-reasoning-engine-receipt.v2"
  ],
  "lib/ai-providers/fabric/treatment-reasoning-portable-runtime.ts": [
    "mediflow.treatment-portable-worker-request.v2",
    "NODE_ENV: 'production'",
    "verifySelected",
    "shell: false"
  ],
  "lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.ts": [
    "inventoryOffline",
    "verifyPortablePublishedMetadata",
    "assessPortableHardware",
    "acacc6b08e341aaf03c9639097255013ac65ebf2",
    "const minimumHostMemoryBytes = processMemoryLimitBytes + 4 * GIB"
  ],
  "lib/ai-providers/fabric/treatment-reasoning-portable-disclosure.ts": [
    "mediflow.ai.treatment-reasoning-disclosure.v2",
    "runtimeObservation: 'not_observed'",
    "athena_transformers"
  ],
  "lib/ai-providers/fabric/function-model-preferences.ts": [
    "mediflow.function-preferences.v1",
    "mediflow.function-preferences.v2",
    "version === 'v1'",
    "LegacyFunctionModelOption"
  ],
  "lib/ai-providers/fabric/function-model-preferences-http.ts": [
    "FUNCTION_PREFERENCES_VERSION_HEADER",
    "requested !== '1'",
    "parseFunctionModelCommand",
    "Vary: FUNCTION_PREFERENCES_VERSION_HEADER"
  ],
  "lib/function-models/browser.ts": [
    "mediflow.function-preferences.v2",
    "x-mediflow-function-preferences",
    "portableVersion",
    "exactKeys"
  ],
  "app/api/ai/fabric/status/route.ts": [
    "buildPortableFabricStatusSnapshot",
    "FABRIC_STATUS_VERSION_HEADER",
    "requested === '2'"
  ],
  "app/settings/ai/fabric/page.tsx": [
    "parsePortableFabricStatusEnvelope",
    "FABRIC_STATUS_VERSION_HEADER",
    "PortableTreatmentSection",
    "parseFabricSnapshotPair"
  ],
  "next.config.ts": [
    "./scripts/treatment-reasoning-portable-worker.py",
    "./scripts/treatment-reasoning-portable-setup.mjs",
    "./lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.ts",
    "./**/*.safetensors"
  ],
  "scripts/check-standalone-runtime-bundle.mjs": [
    "bundledTreatmentPortableFailure(standaloneDir, root)",
    "treatmentPortablePrivateArtifact"
  ],
  "scripts/treatment-reasoning-portable-setup.mjs": [
    "TREATMENT_PORTABLE_SOURCE_CLOSURE",
    "bundledTreatmentPortableFailure",
    "assertNodeRuntime",
    "inventory"
  ],
  "scripts/treatment-reasoning-portable-worker.py": [
    "mediflow.treatment-portable-worker-request.v2",
    "local_files_only=True",
    "trust_remote_code=False",
    "targetPlatform"
  ],
  "proposals/TREATMENT-PORTABLE-ADR.md": [
    "PROPOSED",
    "mediflow.function-preferences.v2"
  ]
});
export function validateTreatmentReasoningPortableCrosswalk(mapping = TREATMENT_PORTABLE_RUNTIME_CROSSWALK, overrides = {}) {
  exactKeys(mapping, Object.keys(TREATMENT_PORTABLE_RUNTIME_CROSSWALK), 'portable v2 map');
  for (const key of Object.keys(TREATMENT_PORTABLE_RUNTIME_CROSSWALK)) {
    if (JSON.stringify(mapping[key]) !== JSON.stringify(TREATMENT_PORTABLE_RUNTIME_CROSSWALK[key])) fail(`portable v2 map drift: ${key}`);
  }
  const sources = sourceAccess(overrides);
  if (createHash('sha256').update(sources.bytes(mapping.legacyCrosswalk.path)).digest('hex') !== mapping.legacyCrosswalk.sha256) fail('portable v2 legacy crosswalk drift');
  for (const [relative, literals] of Object.entries(PORTABLE_SOURCE_REQUIREMENTS)) {
    const source = ensureFile(sources, relative, 'portable v2 source');
    for (const literal of literals) if (!source.includes(literal)) fail(`portable v2 wiring missing: ${relative}: ${literal}`);
  }
  // New engine identity must never enter the generic provider/receipt v1 union.
  for (const relative of ['lib/ai-providers/fabric/contract.ts', 'lib/ai-providers/fabric/resolver.ts']) {
    if (ensureFile(sources, relative, 'generic v1 source').includes('athena_transformers')) fail('portable engine widened generic v1');
  }
  return Object.freeze({ schema: mapping.schema, provider: mapping.provider, applyPolicy: 'none', runtimeQualification: 'not_observed' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = validateFabricGenerativeRuntimeCrosswalk();
  const portable = validateTreatmentReasoningPortableCrosswalk();
  console.log(`Treatment portable v2: ${portable.provider}; runtime qualification ${portable.runtimeQualification}; apply ${portable.applyPolicy}.`);
  console.log(`Fabric generative runtime crosswalk OK: ${result.proposalOnly} proposal-only, ${result.unavailable} unavailable, release ${result.release}.`);
}
