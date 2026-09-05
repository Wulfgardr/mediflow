/* @Codex */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadFabricGenerativeRuntimeCrosswalk,
  validateFabricGenerativeRuntimeCrosswalk,
} from './check-fabric-generative-runtime-crosswalk.mjs';

const MANIFEST_PATH = 'docs/capability-mapping/fabric-generative-runtime-crosswalk.v1.json';
const clone = (value) => structuredClone(value);

function repositorySources(overrides = {}) {
  return {
    exists: (relativePath) => overrides[relativePath] === null ? false : existsSync(relativePath),
    read: (relativePath) => {
      const overridden = overrides[relativePath];
      if (typeof overridden === 'string' || Buffer.isBuffer(overridden)) return overridden;
      return readFileSync(relativePath);
    },
  };
}

test('accepts the integrated local 0.8.5 runtime crosswalk', () => {
  const manifest = loadFabricGenerativeRuntimeCrosswalk();
  assert.doesNotThrow(() => validateFabricGenerativeRuntimeCrosswalk(manifest));
  assert.deepEqual(manifest.capabilities.map(({ id }) => id), [
    'patient_insight',
    'smart_import',
    'document_synthesis',
    'ocr',
    'treatment_reasoning',
  ]);
  assert.equal(manifest.capabilities.filter(({ disposition }) => disposition === 'proposal_only').length, 4);
});

test('rejects duplicate production roots and an OCR execution path', () => {
  const manifest = loadFabricGenerativeRuntimeCrosswalk();
  const duplicate = clone(manifest);
  duplicate.capabilities[1].productionRoot = duplicate.capabilities[0].productionRoot;
  assert.throws(() => validateFabricGenerativeRuntimeCrosswalk(duplicate), /production root.*duplicat/u);

  const ocr = clone(manifest);
  const row = ocr.capabilities.find(({ id }) => id === 'ocr');
  row.descriptorEntryPoint = 'app/api/ai/ocr/route.ts';
  assert.throws(() => validateFabricGenerativeRuntimeCrosswalk(ocr), /OCR.*entryPoint.*null/u);
});

test('rejects descriptor entryPoint drift in the live catalog', () => {
  const manifest = loadFabricGenerativeRuntimeCrosswalk();
  const catalogPath = manifest.catalogPath;
  const catalog = readFileSync(catalogPath, 'utf8').replace(
    manifest.capabilities[0].descriptorEntryPoint,
    'lib/ai-summary-service.ts',
  );
  assert.throws(
    () => validateFabricGenerativeRuntimeCrosswalk(manifest, repositorySources({ [catalogPath]: catalog })),
    /patient_insight.*descriptor entryPoint/u,
  );
});

test('rejects a missing route or caller request literal', () => {
  const manifest = loadFabricGenerativeRuntimeCrosswalk();
  const smart = manifest.capabilities.find(({ id }) => id === 'smart_import');
  const missingRoute = `app${smart.requestPath.routes[0]}/route.ts`;
  assert.throws(
    () => validateFabricGenerativeRuntimeCrosswalk(manifest, repositorySources({ [missingRoute]: null })),
    /smart_import.*route mancante/u,
  );

  const caller = readFileSync(smart.requestPath.caller, 'utf8').replace(smart.requestPath.routes[0], '/api/ai/drift');
  assert.throws(
    () => validateFabricGenerativeRuntimeCrosswalk(manifest, repositorySources({ [smart.requestPath.caller]: caller })),
    /smart_import.*request path/u,
  );
});

test('rejects hidden receipt or provenance metadata in the live UI', () => {
  const manifest = loadFabricGenerativeRuntimeCrosswalk();
  const patient = manifest.capabilities.find(({ id }) => id === 'patient_insight');
  const ui = readFileSync(patient.uiEvidence.path, 'utf8').replaceAll(patient.uiEvidence.requiredLiterals[0], 'metadata.hidden');
  assert.throws(
    () => validateFabricGenerativeRuntimeCrosswalk(manifest, repositorySources({ [patient.uiEvidence.path]: ui })),
    /patient_insight.*UI.*receipt/u,
  );
});

test('pins the historical semantic receipt without relabeling it', () => {
  const manifest = loadFabricGenerativeRuntimeCrosswalk();
  const historical = manifest.historicalArtifacts[0];
  const relabeled = readFileSync(historical.path, 'utf8').replace('candidate_not_integrated', 'integrated');
  assert.throws(
    () => validateFabricGenerativeRuntimeCrosswalk(manifest, repositorySources({ [historical.path]: relabeled })),
    /artefatto storico.*drift/u,
  );
});

test('pins package release identity to 0.8.5', () => {
  const manifest = loadFabricGenerativeRuntimeCrosswalk();
  const stalePackage = readFileSync('package.json', 'utf8').replace('"version": "0.8.5"', '"version": "0.8.4"');
  assert.throws(
    () => validateFabricGenerativeRuntimeCrosswalk(manifest, repositorySources({ 'package.json': stalePackage })),
    /package version/u,
  );
});

test('manifest remains a new runtime artifact, separate from the historical receipt', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.schema, 'mediflow.ai.fabric-generative-runtime-crosswalk.v1');
  assert.equal(manifest.release, '0.8.5');
  assert.equal(manifest.integrationStatus, 'local_source_integrated');
  assert.equal(manifest.applyPolicy, 'none');
  assert.notEqual(MANIFEST_PATH, manifest.historicalArtifacts[0].path);
});
