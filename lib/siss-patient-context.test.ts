/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import test from 'node:test';
/* @Codex */
import { SISS_PORTAL_URLS } from './siss-adapter';
/* @Codex */
import {
    createSissPatientContextHandoff,
    SissPatientContextError,
} from './siss-patient-context';
/* @Codex */
import {
    buildSissPatientContextSummary,
    resolveSissPatientContextAction,
} from './siss-patient-context-shared';

test('resolveSissPatientContextAction accepts supported contextual actions only', () => {
    assert.equal(resolveSissPatientContextAction('fse.lookup'), 'fse.lookup');
    assert.equal(resolveSissPatientContextAction('registry.lookup'), 'registry.lookup');
    assert.equal(resolveSissPatientContextAction('menu.open'), 'menu.open');
    assert.equal(resolveSissPatientContextAction('prosthetics.open'), 'prosthetics.open');
    assert.equal(resolveSissPatientContextAction('unknown.action'), null);
});

test('buildSissPatientContextSummary keeps menu available without a valid fiscal code', () => {
    const summary = buildSissPatientContextSummary({
        patientTaxCode: 'TEST-001',
    });

    const menu = summary.actionStates.find((item) => item.action === 'menu.open');
    const fse = summary.actionStates.find((item) => item.action === 'fse.lookup');

    assert.equal(summary.transportMode, 'portal-handoff');
    assert.equal(summary.browserSessionRequired, true);
    assert.equal(summary.patientFiscalCodeReady, false);
    assert.equal(menu?.available, true);
    assert.equal(fse?.available, false);
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
    assert.equal(result.clipboardText, 'RSSMRA85T10A562S');
    assert.equal(result.message, 'Flusso FSE pronto. Il codice fiscale verra copiato in locale prima dell\'apertura del portale.');
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
    assert.equal(result.clipboardText, 'RSSMRA85T10A562S');
    assert.equal(result.message, 'Flusso anagrafe SISS pronto. Il codice fiscale verra copiato in locale prima dell\'apertura del portale.');
});

test('createSissPatientContextHandoff returns structured payload for Protesica-RL', async () => {
    const result = await createSissPatientContextHandoff({
        patientId: 'patient-ctx-prosthetics',
        patientTaxCode: 'RSSMRA85T10A562S',
        action: 'prosthetics.open',
    });

    assert.equal(result.action, 'prosthetics.open');
    assert.equal(result.title, 'Protesica-RL');
    assert.equal(result.handoffUrl, SISS_PORTAL_URLS['prosthetics.open']);
    assert.equal(result.clipboardText, 'RSSMRA85T10A562S');
    assert.equal(result.message, 'Modulo Protesica-RL pronto. Il codice fiscale verra copiato in locale prima dell\'apertura della sessione regionale.');
});

test('createSissPatientContextHandoff opens menu even without fiscal code', async () => {
    const result = await createSissPatientContextHandoff({
        patientId: 'patient-ctx-menu',
        patientTaxCode: '',
        action: 'menu.open',
    });

    assert.equal(result.action, 'menu.open');
    assert.equal(result.title, 'Menu SISS');
    assert.equal(result.handoffUrl, SISS_PORTAL_URLS['menu.open']);
    assert.equal(result.clipboardText, null);
});

test('createSissPatientContextHandoff opens menu even with an invalid fiscal code', async () => {
    const result = await createSissPatientContextHandoff({
        patientId: 'patient-ctx-menu-invalid',
        patientTaxCode: 'TEST-001',
        action: 'menu.open',
    });

    assert.equal(result.action, 'menu.open');
    assert.equal(result.handoffUrl, SISS_PORTAL_URLS['menu.open']);
    assert.equal(result.clipboardText, null);
});

test('createSissPatientContextHandoff rejects patients without tax code', async () => {
    await assert.rejects(
        createSissPatientContextHandoff({
            patientId: 'patient-ctx-3',
            patientTaxCode: '',
            action: 'fse.lookup',
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
