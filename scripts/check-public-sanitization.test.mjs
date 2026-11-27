import assert from 'node:assert/strict';
import test from 'node:test';

import { scanTextForPublicSanitization } from './check-public-sanitization.mjs';

function decode(b64) {
    return Buffer.from(b64, 'base64').toString('utf8');
}

test('rejects real healthcare facility names and personal workplace tokens', () => {
    const hospital = decode('U2FuIFJhZmZhZWxl');
    const workplace = decode('RmF0ZWJlbmVmcmF0ZWxsaQ==');
    const lab = decode('U3lubGFi');
    const sample = `Header: Ospedale ${hospital}\nCalendar: ${workplace}\nLab: ${lab}`;
    const violations = scanTextForPublicSanitization(sample, 'synthetic-fixture.txt');
    assert.equal(violations.length, 3);
    assert.ok(violations.every((item) => item.rule === 'REAL_FACILITY_OR_ROLE'));
});

test('rejects real document-type fingerprints', () => {
    const fingerprint = decode('UmVmZXJ0b0NpdHRhZGlubw==');
    const violations = scanTextForPublicSanitization(`File: ${fingerprint}.pdf`, 'synthetic-fixture.txt');
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, 'REAL_DOCUMENT_FINGERPRINT');
});

test('rejects statements evidencing real document feeding while allowing explicit prohibition statements', () => {
    const bad = decode('Q29udHJvbGxvIGxvY2FsZTogc3VsbGUgMTMgcmljZXR0ZSBiaWFuY2hlIHJlYWxpIGlsIHBhcnNlciBwYXNzYS4=');
    const badViolations = scanTextForPublicSanitization(bad, 'pr-body.md');
    assert.ok(badViolations.length >= 1);
    assert.ok(badViolations.some((item) => item.rule === 'REAL_DOCUMENT_FEEDING_EVIDENCE'));

    const allowed = decode('Tm9uIHZlcmlmaWNhdG86IHByb21lbW9yaWEgcmVhbGkgZXNjbHVzaSBwZXIgdmluY29sbyBkaSByaXNlcnZhdGV6emEu');
    const allowedViolations = scanTextForPublicSanitization(allowed, 'pr-body.md');
    assert.equal(allowedViolations.length, 0);
});

test('allows generic synthetic healthcare text', () => {
    const clean = [
        'Struttura Sanitaria Sintetica',
        'RefertoSpecialistico.pdf - Ambulatorio di prova',
        'Controllo su dati sintetici isolati, nessun dato reale.',
    ].join('\n');
    assert.deepEqual(scanTextForPublicSanitization(clean, 'clean.txt'), []);
});
