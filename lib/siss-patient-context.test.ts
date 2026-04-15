/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import test from 'node:test';
/* @Codex */
import { SISS_PORTAL_URLS } from './siss-adapter';
/* @Codex */
import {
    createSissPatientContextHandoff,
    resolveSissPatientContextAction,
    SissPatientContextError,
} from './siss-patient-context';

test('resolveSissPatientContextAction accepts supported contextual actions only', () => {
    assert.equal(resolveSissPatientContextAction('fse.lookup'), 'fse.lookup');
    assert.equal(resolveSissPatientContextAction('registry.lookup'), 'registry.lookup');
    assert.equal(resolveSissPatientContextAction('menu.open'), 'menu.open');
    assert.equal(resolveSissPatientContextAction('unknown.action'), null);
});

test('createSissPatientContextHandoff returns structured payload for FSE lookup', async () => {
    const result = await createSissPatientContextHandoff({
        patientId: 'patient-ctx-1',
        patientTaxCode: 'RSSMRA85T10A562S',
        action: 'fse.lookup',
    });

    assert.equal(result.status, 'handoff');
    assert.equal(result.action, 'fse.lookup');
    assert.equal(result.title, 'FSE');
    assert.equal(result.mode, 'portal-handoff');
    assert.equal(result.handoffUrl, SISS_PORTAL_URLS['fse.lookup']);
    assert.match(result.correlationId, /^siss-/);
});

test('createSissPatientContextHandoff returns structured payload for registry lookup', async () => {
    const result = await createSissPatientContextHandoff({
        patientId: 'patient-ctx-2',
        patientTaxCode: 'RSSMRA85T10A562S',
        action: 'registry.lookup',
    });

    assert.equal(result.action, 'registry.lookup');
    assert.equal(result.title, 'Anagrafe');
    assert.equal(result.handoffUrl, SISS_PORTAL_URLS['registry.lookup']);
});

test('createSissPatientContextHandoff rejects patients without tax code', async () => {
    await assert.rejects(
        createSissPatientContextHandoff({
            patientId: 'patient-ctx-3',
            patientTaxCode: '',
            action: 'menu.open',
        }),
        (error: unknown) => {
            if (!(error instanceof SissPatientContextError)) {
                return false;
            }
            assert.equal(error.code, 'SISS_PATIENT_NOT_READY');
            assert.equal(error.status, 400);
            return true;
        },
    );
});
