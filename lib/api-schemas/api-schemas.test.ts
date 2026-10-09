/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { z } from 'zod';
import { attachmentCreateSchema, attachmentOcrReplaySchema } from './attachments';
import { authSetupSchema } from './auth';
import { checkupCreateSchema, therapyUpdateSchema } from './clinical-writes';
import { conversationCreateSchema } from './conversations';
import { INVALID_API_PAYLOAD_ERROR, parseApiBody } from './parse';
import {
    patientAssignSchema,
    patientDuplicateSchema,
    patientMoveSchema,
    patientUnassignSchema,
} from './patient-bulk';
import { prostheticPrescriptionCreateSchema, servicePrescriptionCreateSchema, servicePrescriptionItemCreateSchema, servicePrescriptionItemUpdateSchema } from './prescriptions';
import { sissHandoffCreateSchema } from './siss-handoffs';

async function expectValid<T>(schema: z.ZodType<T>, payload: unknown): Promise<T> {
    const parsed = parseApiBody(schema, payload);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) throw new Error('expected valid payload');
    return parsed.data;
}

async function expectInvalid400<T>(schema: z.ZodType<T>, payload: unknown): Promise<void> {
    const parsed = parseApiBody(schema, payload);
    assert.equal(parsed.ok, false);
    if (parsed.ok) throw new Error('expected invalid payload');
    assert.equal(parsed.response.status, 400);
    assert.deepEqual(await parsed.response.json(), { error: INVALID_API_PAYLOAD_ERROR });
}

test('attachment schemas accept expected payloads and reject malformed payloads with 400', async () => {
    await expectValid(attachmentCreateSchema, {
        patientId: 'patient-1',
        name: 'referto.pdf',
        type: 'application/pdf',
        size: 1234,
        path: 'attachments/attachment-1-referto.pdf',
        data: 'QUJDRA==',
        summarySnapshot: 'ENC:iv:cipher',
        parseEvidenceArtifactSnapshot: null,
        ocrQueueState: 'pending',
        ocrQueueReason: 'text_layer_absent',
    });
    await expectInvalid400(attachmentCreateSchema, {
        patientId: 'patient-1',
        name: 'referto.pdf',
        type: 'application/pdf',
        size: '1234',
    });

    await expectValid(attachmentOcrReplaySchema, {
        ocrText: 'Testo OCR sintetico',
        documentSha256: 'abc123',
    });
    await expectInvalid400(attachmentOcrReplaySchema, {
        ocrText: null,
        documentSha256: 'abc123',
    });
});

test('conversation and auth schemas reject non-string persisted fields with 400', async () => {
    await expectValid(conversationCreateSchema, {
        id: 'conversation-1',
        title: 'Nuova conversazione',
    });
    await expectInvalid400(conversationCreateSchema, {
        title: '',
    });

    await expectValid(authSetupSchema, {
        username: 'admin',
        password: '1234',
        encryptedMasterKey: 'ENC:iv:cipher',
        salt: 'salt',
        displayName: 'Medico',
        ambulatoryName: null,
    });
    await expectInvalid400(authSetupSchema, {
        username: 'admin',
        password: '1234',
        encryptedMasterKey: ['bad'],
        salt: 'salt',
    });
});

test('legacy clinical write schemas validate dates and clinical strings before persistence', async () => {
    await expectValid(checkupCreateSchema, {
        patientId: 'patient-1',
        date: '2026-07-03T10:00:00.000Z',
        title: 'Controllo',
        notes: null,
        status: 'pending',
        source: 'manual',
    });
    await expectInvalid400(checkupCreateSchema, {
        patientId: 'patient-1',
        date: 'not-a-date',
        title: 'Controllo',
    });

    await expectValid(therapyUpdateSchema, {
        drugName: 'Metformina',
        dosage: '500 mg',
        startDate: '2026-07-03T10:00:00.000Z',
        endDate: '',
        diagnosisCode: null,
    });
    await expectInvalid400(therapyUpdateSchema, {
        dosage: 500,
    });
});

test('service prescription and SISS schemas validate enum/date boundaries with 400 failures', async () => {
    await expectValid(servicePrescriptionCreateSchema, {
        patientId: 'patient-1',
        prescribedAt: '2026-07-03T10:00:00.000Z',
        serviceName: 'Visita cardiologica',
        status: 'prescribed',
        category: 'visit',
        priority: 'B',
        source: 'manual',
    });
    await expectInvalid400(servicePrescriptionCreateSchema, {
        patientId: 'patient-1',
        prescribedAt: '2026-07-03T10:00:00.000Z',
        serviceName: 'Visita cardiologica',
        status: 'invalid',
    });

    await expectValid(sissHandoffCreateSchema, {
        patientId: 'patient-1',
        action: 'menu.open',
        outcome: 'started',
        startedAt: '2026-07-03T10:00:00.000Z',
        completedAt: null,
    });
    await expectInvalid400(sissHandoffCreateSchema, {
        patientId: 'patient-1',
        action: 'menu.open',
        completedAt: 'not-a-date',
    });
});

/* @Codex */
test('patient bulk schemas normalize IDs and reject malformed payloads', async () => {
    assert.deepEqual(await expectValid(patientAssignSchema, {
        patientIds: [' patient-1 ', 'patient-1', 'patient-2'],
        targetAmbulatoryId: ' ambulatory-1 ',
    }), {
        patientIds: ['patient-1', 'patient-2'],
        targetAmbulatoryId: 'ambulatory-1',
    });
    await expectValid(patientDuplicateSchema, {
        patientIds: ['patient-1'],
        targetAmbulatoryId: 'ambulatory-2',
    });
    await expectValid(patientUnassignSchema, {
        patientIds: ['patient-1'],
        ambulatoryId: 'ambulatory-1',
    });
    await expectInvalid400(patientAssignSchema, {
        patientIds: [],
        targetAmbulatoryId: 'ambulatory-1',
    });
    await expectInvalid400(patientUnassignSchema, {
        patientIds: ['patient-1'],
        ambulatoryId: 42,
    });
});

/* @Codex */
test('patient move requires one positive expected version per requested patient', async () => {
    assert.deepEqual(await expectValid(patientMoveSchema, {
        patientIds: [' patient-1 ', 'patient-2'],
        targetAmbulatoryId: ' ambulatory-2 ',
        sourceAmbulatoryId: null,
        patientVersions: { 'patient-1': 3, 'patient-2': 7 },
    }), {
        patientIds: ['patient-1', 'patient-2'],
        targetAmbulatoryId: 'ambulatory-2',
        sourceAmbulatoryId: undefined,
        patientVersions: { 'patient-1': 3, 'patient-2': 7 },
    });
    await expectInvalid400(patientMoveSchema, {
        patientIds: ['patient-1', 'patient-2'],
        targetAmbulatoryId: 'ambulatory-2',
        patientVersions: { 'patient-1': 3 },
    });
    await expectInvalid400(patientMoveSchema, {
        patientIds: ['patient-1'],
        targetAmbulatoryId: 'ambulatory-2',
        patientVersions: { 'patient-1': 0 },
    });
    await expectInvalid400(patientMoveSchema, {
        patientIds: ['patient-1'],
        targetAmbulatoryId: 'ambulatory-2',
        patientVersions: { 'patient-1': 3, 'patient-2': 7 },
    });
    await expectInvalid400(patientMoveSchema, {
        patientIds: ['constructor'],
        targetAmbulatoryId: 'ambulatory-2',
        patientVersions: {},
    });
});


test('prescription create IDs reject empty supplied identities and preserve opaque IDs', async () => {
    const payload = { patientId: 'synthetic-patient', prescriptionId: 'synthetic-parent', prescribedAt: '2026-01-01', description: 'Synthetic', serviceName: 'Synthetic' };
    const schemas: z.ZodType[] = [prostheticPrescriptionCreateSchema, servicePrescriptionCreateSchema, servicePrescriptionItemCreateSchema];
    for (const schema of schemas) {
        await expectValid(schema, payload);
        await expectValid(schema, { ...payload, id: ' opaque-id ' });
        for (const id of ['', '  ', null, 12, [], {}]) await expectInvalid400(schema, { ...payload, id });
    }
});
test('service item ordinal accepts exact safe integers and decimal strings without truncation', async () => {
    for (const [ordinal, expected] of [[0, 0], [-1, -1], [12, 12], [' 12 ', 12], ['01', 1], ['+1', 1], ['-1', -1], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]] as const) {
        const result = await expectValid(servicePrescriptionItemUpdateSchema, { version: 1, ordinal });
        assert.equal(result.ordinal, expected);
    }
    for (const ordinal of [1.5, '12garbage', '1.5', '1e2', '0x10', '', ' ', null, true, [], {}, Number.MAX_SAFE_INTEGER + 1, '9007199254740992']) {
        await expectInvalid400(servicePrescriptionItemUpdateSchema, { version: 1, ordinal });
    }
    assert.equal((await expectValid(servicePrescriptionItemCreateSchema, { prescriptionId: 'synthetic-parent', serviceName: 'Synthetic' })).ordinal, undefined);
    assert.equal((await expectValid(servicePrescriptionItemUpdateSchema, { version: 1 })).ordinal, undefined);
});
