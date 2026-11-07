import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from './db';
import { patientAllergiesSchema, patientAllergiesForHeader } from './patient-allergies';
import { PatientEditSession } from './patient-edit-session';
import { decryptData } from './security/security';
import golden from '../native/contracts/crypto-golden-vectors.v1.json' with { type: 'json' };

test('allergy labels come only from structured substances; unreadable data stays unavailable', () => {
    assert.deepEqual(patientAllergiesForHeader([{ substance: 'Amoxicillina', reaction: 'Orticaria', severity: 'moderate' }]), { allergies: ['Amoxicillina'] });
    for (const value of [null, undefined, []]) assert.deepEqual(patientAllergiesForHeader(value), { allergies: [] });
    for (const value of ['ENC:opaque:opaque', '[Dati bloccati]', 'Allergia nelle note', [{}], [{ substance: 'A', unexpected: true }]]) {
        assert.deepEqual(patientAllergiesForHeader(value), { allergiesUnavailable: true });
    }
    assert.equal(patientAllergiesSchema.safeParse([{ substance: '' }]).success, false);
    assert.equal(patientAllergiesSchema.safeParse([{ substance: 'A', severity: 'unknown' }]).success, false);
    assert.equal(patientAllergiesSchema.safeParse(Array.from({ length: 101 }, () => ({ substance: 'A' }))).success, false);
    assert.throws(() => new PatientEditSession({ id: 'synthetic', version: 1, checkups: [], allergies: '[Dati bloccati]' as never }));
});

test('allergies roundtrip through real facade encryption and failed decrypt cannot become an empty list', async t => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const allergies = [{ substance: 'Amoxicillina sintetica' }];
    const priorFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = priorFetch; db.setKey(null); });
    db.setKey(key);
    const payload = await db.patients.prepareWritePayload({ allergies }, true);
    const sealed: unknown = Reflect.get(payload, 'allergies');
    assert.equal(typeof sealed, 'string');
    assert.match(sealed as string, /^ENC:/);
    globalThis.fetch = async () => Response.json({ id: 'synthetic-allergy', ...payload });
    assert.deepEqual((await db.patients.get('synthetic-allergy'))?.allergies, allergies);
    db.setKey(await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']));
    const unreadable = await db.patients.get('synthetic-allergy');
    assert.deepEqual(patientAllergiesForHeader(unreadable?.allergies), { allergiesUnavailable: true });
    db.setKey(null);
    await assert.rejects(db.patients.prepareWritePayload({ allergies }, true), /Encryption key unavailable/);
});

test('native allergy golden decrypts with the frozen reference key', async () => {
    const vector = golden.vectors.fields.find(field => field.name === 'patient.allergies');
    assert.ok(vector);
    const key = await crypto.subtle.importKey('raw', Buffer.from(golden.inputs.rawMasterKeyHex, 'hex'), 'AES-GCM', false, ['decrypt']);
    assert.deepEqual(await decryptData(vector.dataB64, vector.ivB64, key), vector.value);
    assert.equal(patientAllergiesSchema.safeParse(vector.value).success, true);
});
