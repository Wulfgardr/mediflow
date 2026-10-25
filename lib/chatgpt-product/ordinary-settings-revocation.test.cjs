/* Real native owner, source capture, ordinary flow and settings writers.
 * Synthetic in-memory rows and an explicit product-attempt seam: these tests
 * qualify revocation orchestration, not redaction, consent, provider or egress. */
'use strict';
const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const { randomUUID } = require('node:crypto');
const f = require('../security/native-ordinary-host.test-support.cjs');
const { ProductError } = require('./product-contract.ts');
let session, stageHook, sends, publications, attempt;
f.db.dbServer.insert = table => {
    assert.equal(table, f.schema.settings, 'no clinical writer');
    return { values(row) { return { onConflictDoUpdate() { return { run() { f.setSetting(row.key, row.value); } }; } }; } };
};
f.replace('lib/chatgpt-execution/ordinary-governance.ts', {
    async readOrdinaryGovernance() { return { configuration: { syntheticOnly: true } }; },
});
f.replace('lib/chatgpt-execution/execution-mac-product.ts', {
    createSharedMacProductPlatform() { return { syntheticOnly: true }; }, reportMacProductPreparationDiagnostic() {},
});
f.replace('lib/chatgpt-execution/ordinary-product-attempt.ts', {
    async createOrdinaryProductAttempt(activeSession, _platform, current) {
        assert.equal(activeSession, session);
        let phase = 'empty', result;
        const guard = () => { if (phase === 'closed' || !current()) throw new ProductError('revoked'); };
        attempt = { current, snapshot() { guard(); return { state: phase, expiresAt: session.expiresAt }; },
            async prepare() { guard(); phase = 'needs_consent'; return { revision: 'synthetic-disclosure' }; },
            async consent() { guard(); phase = 'ready'; },
            async generate() {
                guard(); assert.equal(phase, 'ready');
                await stageHook?.('before-send'); guard(); sends++;
                await stageHook?.('provider'); guard();
                result = { functionId: 'patient_insight', syntheticOnly: true }; return result;
            },
            isCurrent(value) { return phase !== 'closed' && current() && value === result; },
            async dispose() { phase = 'closed'; await stageHook?.('cleanup'); return { cleanupConfirmed: true }; },
        };
        return attempt;
    },
});
const flow = require('./ordinary-flow.ts');
const { parseOrdinaryStoredSettings, readOrdinaryCloudSettings, writeOrdinaryCloudSettings } = require('./ordinary-settings.ts');
const { nativeSessionProjectionOwnerRegistry: registry } = require('../security/native-session-projection-owner-production.ts');
const source = require('../security/server-session-clinical-context-native-sources.ts');
const { profiles } = require('../chatgpt-execution/ordinary-content.test-support.ts');
const { writeSettingWithFunctionModelGeneration } = require('../ai-providers/fabric/function-model-settings-write.ts');
const { functionModelPreferencesService } = require('../ai-providers/fabric/function-model-preferences-production.ts');
const { FUNCTION_SWITCH_KEYS } = require('../ai-providers/fabric/function-model-preferences.ts');
beforeEach(() => {
    f.reset(); stageHook = undefined; sends = 0; publications = 0; attempt = undefined;
    for (const key of Object.values(FUNCTION_SWITCH_KEYS)) f.setSetting(key, 'enabled');
    f.setSetting('ai.fabric.chatgptOrdinary', JSON.stringify({ ...parseOrdinaryStoredSettings(), enabled: true }));
    f.pair({ clientPlatform: 'ios' }); session = f.issue({}, { clientPlatform: 'ios' });
});
afterEach(async () => { stageHook = undefined; flow.cancelOrdinaryGeneration(); await attempt?.dispose(); f.reset(); });
async function prepare() {
    const owner = registry.acquire(session);
    const selection = owner.issueSelection({ expectedEpoch: owner.snapshotSelectionEpoch(session), patientId: 'synthetic-patient', ambulatoryId: 'synthetic-ambulatory' });
    const capture = source.captureNativeOrdinaryHostSources(session, owner, f.preparation(), selection);
    const response = await flow.beginOrdinaryFunction(new Request('http://localhost/api/v1/network/ai/chatgpt/ordinary/prepare', { method: 'POST' }), 'patient_insight', session, async () => {
        flow.bindNativeOrdinaryHostSources(capture);
        await flow.bindOrdinaryApplicationContext('patient_insight', owner, session);
        await flow.executeOwnedOrdinaryProfile('patient_insight', profiles()[0], () => source.nativeOrdinaryHostSourcesAreCurrent(capture));
        await stageHook?.('publication');
        if (!flow.ordinaryApplicationIsCurrent('patient_insight')) throw new ProductError('revoked');
        publications++;
        return Response.json({ syntheticOrchestrationOnly: true });
    });
    assert.equal(response.status, 202); return response.json();
}
const signal = () => new AbortController().signal;
const command = (operation, state) => flow.ordinaryFunctionCommand(session, operation, { attemptId: state.attemptId,
    expectedDisclosureRevision: state.disclosure.revision, modelOptionId: 'synthetic-option', expectedCatalogRevision: 'synthetic-catalog' }, signal());
function aba(writer) {
    for (const enabled of [false, true]) {
        if (writer === 'generic') writeSettingWithFunctionModelGeneration('aiPatientInsightKillSwitch', enabled ? 'enabled' : 'disabled');
        else {
            const view = functionModelPreferencesService.read('v2');
            functionModelPreferencesService.apply({ schemaVersion: 'mediflow.function-preferences-command.v2', commandId: randomUUID(),
                expectedRevision: view.revision, expectedCatalogRevision: view.catalogRevision, action: 'set_activation', functionId: 'patient_insight', enabled });
        }
    }
}
test('unchanged native attempt reaches the synthetic publication seam', async () => {
    const state = await prepare(); await command('consent', state);
    assert.equal((await command('generate', state)).status, 200);
    assert.equal(sends, 1); assert.equal(publications, 1);
});
test('saving a default for future attempts preserves the existing explicit choice', async () => {
    const state = await prepare(); await command('consent', state);
    const before = await readOrdinaryCloudSettings();
    await writeOrdinaryCloudSettings(f.web(), before.revision, { preference: { functionId: 'patient_insight',
        value: { use: 'chatgpt_subscription', model: 'synthetic-future-model', effort: 'medium' } } });
    assert.notEqual((await readOrdinaryCloudSettings()).revision, before.revision);
    assert.equal((await command('generate', state)).status, 200); assert.equal(sends, 1); assert.equal(publications, 1);
});
for (const writer of ['generic', 'dedicated']) for (const stage of ['before-consent', 'before-generate', 'before-send', 'provider', 'publication', 'cleanup']) {
    test(`R4 ${writer} ABA at ${stage} terminally retires the original native ordinary attempt`, async () => {
        const state = await prepare();
        if (stage === 'before-consent') aba(writer);
        else await command('consent', state);
        if (stage === 'before-generate') aba(writer);
        stageHook = at => { if (at === stage) { stageHook = undefined; aba(writer); } };
        await assert.rejects(command(stage === 'before-consent' ? 'consent' : 'generate', state), { code: 'revoked' });
        assert.equal(sends, ['before-consent', 'before-generate', 'before-send'].includes(stage) ? 0 : 1);
        assert.equal(publications, stage === 'cleanup' ? 1 : 0);
        assert.equal(attempt.current(), false, 'returning to enabled never restores authority');
        await assert.rejects(command('generate', state));
    });
}
