import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createHostProviderLifecycleService } from './ai-providers/fabric/provider-lifecycle-service.ts';
import { getProviderLifecycleStorePaths } from './ai-providers/fabric/provider-lifecycle-store.ts';
import { buildFabricStatusSnapshot } from './ai-providers/fabric/status.ts';
import { FUNCTION_PREFERENCES_KEY, resolveFunctionModelDispatch } from './ai-providers/fabric/function-model-preferences.ts';
import { AiFunctionUnavailableError, TREATMENT_REASONING_UNAVAILABLE_CODE } from './ai-function-availability.ts';
import { createTreatmentReasoningOrdinaryTaskProfile } from './chatgpt-execution/ordinary-task-profile.ts';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-retired-bootstrap-'));
process.env.MEDIFLOW_DATA_DIR = directory;
process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN = 'legacy ignored invalid executable';
const disk = new Database(path.join(directory, 'medical.db'));
for (const file of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
    disk.exec(fs.readFileSync(path.join('drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
const defaults = Object.fromEntries(['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'].map(id => [id,
    id === 'treatment_reasoning' ? { modelOptionId: `model_option_${'a'.repeat(32)}`, catalogRevision: `sha256_${'b'.repeat(64)}` } : null]));
for (const [key, value] of Object.entries({ aiProvider: 'athena_mlx', aiModel: 'ATHENA-R1-Qwen3-8B',
    aiTreatmentReasoningKillSwitch: 'enabled', 'network.mode': 'local-only',
    [FUNCTION_PREFERENCES_KEY]: JSON.stringify({ schemaVersion: 'mediflow.function-preferences-store.v1', defaults, lastCommand: null }) })) {
    disk.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(key, value);
}
createHostProviderLifecycleService({ appDataDir: directory, provider: 'athena_mlx' }).control.admit({ expectedVersion: 0,
    onboarding: { schemaVersion: 'mediflow.ai.provider-onboarding.v1', provider: 'athena_mlx', credentialClass: 'local_model',
        step: 'enabled', attestation: 'available_unqualified' } });
const legacyPath = getProviderLifecycleStorePaths(directory, 'athena_mlx').recordPath;
const { functionModelPreferencesService: service, readProductionFunctionModelSources } = await import('./ai-providers/fabric/function-model-preferences-production.ts');
test.after(() => { disk.close(); fs.rmSync(directory, { recursive: true, force: true }); });
const denied = (error: unknown) => error instanceof AiFunctionUnavailableError && error.code === TREATMENT_REASONING_UNAVAILABLE_CODE;

test('synthetic archive boots with enabled legacy settings, opaque saved choice and valid or corrupt retired lifecycle without rewriting data', () => {
    const before = disk.prepare("SELECT key,value FROM settings WHERE key NOT LIKE 'territorial.%' ORDER BY key").all();
    for (const contents of [fs.readFileSync(legacyPath, 'utf8'), '{corrupt legacy lifecycle']) {
        fs.writeFileSync(legacyPath, contents);
        for (const version of ['v1', 'v2'] as const) {
            const view = service.read(version);
            assert.equal(view.functions.length, 4);
            const treatment = view.functions.find(row => row.id === 'treatment_reasoning')!;
            assert.deepEqual(treatment.options, []);
            assert.equal(treatment.enabled, false);
            assert.equal(treatment.defaultModelOptionId, null);
            assert.equal(treatment.bindingState, 'unsupported');
            assert.doesNotMatch(JSON.stringify(view), /athena|mlx/iu);
        }
        assert.throws(() => resolveFunctionModelDispatch(readProductionFunctionModelSources(), 'treatment_reasoning'), denied);
        assert.equal(fs.readFileSync(legacyPath, 'utf8'), contents);
    }
    assert.deepEqual(disk.prepare("SELECT key,value FROM settings WHERE key NOT LIKE 'territorial.%' ORDER BY key").all(), before);
});

test('Fabric v1 preserves all sixteen identities and terminal unavailability; no model runtime can be reintroduced silently', () => {
    const snapshot = buildFabricStatusSnapshot();
    assert.equal(snapshot.contractVersion, 'mediflow.ai.fabric.v1');
    assert.deepEqual(snapshot.capabilities.map(row => row.id), [
        'aifa_drug_search', 'document_classification', 'document_identity_resolution', 'document_synthesis', 'evidence_absorption',
        'fhir_export', 'fse_document_validation', 'icd_lookup', 'observation_range_classification', 'ocr', 'patient_insight',
        'patient_open_loops', 'pii_redaction_layer1', 'service_prescription_matching', 'smart_import', 'treatment_reasoning',
    ]);
    const treatment = snapshot.capabilities.find(row => row.id === 'treatment_reasoning')!;
    assert.equal(treatment.availabilityDisposition, 'unavailable');
    assert.deepEqual(treatment.venues, []);
    assert.doesNotMatch(JSON.stringify(snapshot), /athena|mlx/iu);
    assert.throws(() => createTreatmentReasoningOrdinaryTaskProfile({} as never), denied);
    for (const file of ['lib/athena-mlx-runtime.ts', 'lib/athena-mlx-launcher-config.ts',
        'lib/ai-providers/fabric/treatment-reasoning-production-root.ts', 'lib/ai-providers/fabric/treatment-reasoning-portable-runtime.ts',
        'scripts/treatment-reasoning-portable-worker.py', 'scripts/start-mlx.sh', 'app/api/system/mlx/route.ts',
        'app/api/system/treatment-reasoning/athena-mlx/route.ts']) assert.equal(fs.existsSync(file), false, file);
});
