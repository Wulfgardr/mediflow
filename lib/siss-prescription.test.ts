/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { SISS_PORTAL_URLS } from './siss-adapter';
import { SissPrescriptionError, createSissPrescriptionHandoff } from './siss-prescription';

test('createSissPrescriptionHandoff rejects patients without tax code', async () => {
    await assert.rejects(
        createSissPrescriptionHandoff({
            patientId: 'patient-1',
            patientTaxCode: '',
        }),
        (error: unknown) => {
            if (!(error instanceof SissPrescriptionError)) {
                return false;
            }
            assert.equal(error.code, 'SISS_PATIENT_NOT_READY');
            assert.equal(error.status, 400);
            assert.equal(error.correlationId, null);
            return true;
        },
    );
});

test('createSissPrescriptionHandoff returns structured handoff payload', async () => {
    const result = await createSissPrescriptionHandoff({
        patientId: 'patient-2',
        patientTaxCode: 'RSSMRA85T10A562S',
    });

    assert.equal(result.status, 'handoff');
    assert.equal(result.mode, 'portal-handoff');
    assert.equal(result.handoffUrl, SISS_PORTAL_URLS['prescription.create']);
    assert.equal(result.clipboardText, 'RSSMRA85T10A562S');
    assert.match(result.correlationId, /^siss-/);
});

test('createSissPrescriptionHandoff maps adapter errors to API-safe failures', async () => {
    await assert.rejects(
        createSissPrescriptionHandoff(
            {
                patientId: 'patient-3',
                patientTaxCode: 'RSSMRA85T10A562S',
            },
            {
                transport: async () => ({
                    ok: false,
                    status: 401,
                }),
            },
        ),
        (error: unknown) => {
            if (!(error instanceof SissPrescriptionError)) {
                return false;
            }
            assert.equal(error.code, 'SISS_HANDOFF_FAILED');
            assert.equal(error.status, 401);
            assert.match(error.correlationId ?? '', /^siss-/);
            return true;
        },
    );
});
