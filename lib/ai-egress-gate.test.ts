/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    evaluateEgress,
    isEgressGateOpen,
    isValidItalianTaxCodeChecksum,
    rehydrate,
} from './ai-egress-gate';

test('redacts a checksum-valid codice fiscale and conservatively redacts an invalid candidate', () => {
    const valid = 'RSSMRA85T10A562S';
    const invalid = 'RSSMRA85T10A562A';
    const result = evaluateEgress({ text: `${valid} ${invalid}`, lane: 'clinical' });

    assert.equal(isValidItalianTaxCodeChecksum(valid), true);
    assert.equal(isValidItalianTaxCodeChecksum(invalid), false);
    assert.equal(result.redactedText, '{{CF_1}} {{CF_CANDIDATO_1}}');
    assert.deepEqual(result.entityCounts, { codice_fiscale: 1, codice_fiscale_candidate: 1 });
});

test('redacts multiple email addresses including PEC addresses', () => {
    const result = evaluateEgress({
        text: 'Scrivere a mario.rossi@example.it e segreteria@pec.example.it.',
        lane: 'clinical',
    });

    assert.equal(result.redactedText, 'Scrivere a {{EMAIL_1}} e {{EMAIL_2}}.');
    assert.equal(result.entityCounts.email, 2);
});

test('redacts Italian phone numbers with country prefixes', () => {
    const result = evaluateEgress({ text: 'Cellulare +39 347 123 4567, studio 02-1234-5678.', lane: 'clinical' });

    assert.equal(result.redactedText, 'Cellulare {{TELEFONO_1}}, studio {{TELEFONO_2}}.');
    assert.equal(result.entityCounts.phone, 2);
});

test('redacts NREs with a valid regional prefix and Italian TEAM identifiers', () => {
    const result = evaluateEgress({
        text: 'NRE 030A01234567890, TEAM 80380030000000000000.',
        lane: 'clinical',
    });

    assert.equal(result.redactedText, 'NRE {{NRE_1}}, TEAM {{TEAM_1}}.');
    assert.deepEqual(result.entityCounts, { team: 1, nre: 1 });
});

test('redacts known patient names case-insensitively at word boundaries', () => {
    const result = evaluateEgress({
        text: 'Mario Rossi riferisce benessere; mariorossi@example.it non e un nome separato.',
        lane: 'clinical',
        knownIdentifiers: { names: ['Mario Rossi'] },
    });

    assert.equal(result.redactedText, '{{PERSONA_1}} riferisce benessere; {{EMAIL_1}} non e un nome separato.');
    assert.equal(result.entityCounts.known_name, 1);
});

test('keeps clean text unchanged while the gate remains fail-closed', () => {
    const result = evaluateEgress({ text: 'Nessuna entita identificativa nel testo.', lane: 'clinical' });

    assert.equal(isEgressGateOpen(), false);
    assert.equal(result.status, 'closed_pending_redaction_lane');
    assert.equal(result.redactedText, 'Nessuna entita identificativa nel testo.');
    assert.deepEqual(result.entityCounts, {});
});

test('stays closed_pending_redaction_lane for every clinical lane until Layer 2 is promoted', () => {
    for (const lane of ['clinical', 'patient_insight', 'document_synthesis']) {
        assert.equal(
            evaluateEgress({ text: 'Contesto clinico sintetico.', lane }).status,
            'closed_pending_redaction_lane',
        );
    }
});

test('redacts labeled nosologico numbers and leaves bare digit runs alone', () => {
    const result = evaluateEgress({
        text: 'Ricovero N. nosologico: 12345678 in reparto; pratica 87654321 non etichettata.',
        lane: 'clinical',
    });

    assert.equal(
        result.redactedText,
        'Ricovero {{NOSOLOGICO_1}} in reparto; pratica 87654321 non etichettata.',
    );
    assert.equal(result.entityCounts.nosologico, 1);
});

test('handles adversarial email-shaped input in linear time without matching', () => {
    const adversarial = `a@${'a.'.repeat(150_000)}1`;
    const start = process.hrtime.bigint();
    const result = evaluateEgress({ text: adversarial, lane: 'clinical' });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    assert.ok(elapsedMs < 2000, `evaluateEgress ha impiegato ${Math.round(elapsedMs)}ms su input avversariale`);
    assert.equal(result.entityCounts.email ?? 0, 0);
    assert.equal(result.status, 'closed_pending_redaction_lane');
});

test('rehydrates the exact local payload after deterministic tokenization', () => {
    const text = 'Mario Rossi, nato il 01/02/1980, email mario@example.it.';
    const result = evaluateEgress({
        text,
        lane: 'clinical',
        knownIdentifiers: { names: ['Mario Rossi'] },
    });

    assert.ok(result.redactedText);
    assert.ok(result.rehydrationMap);
    assert.equal(rehydrate(result.redactedText, result.rehydrationMap), text);
});
