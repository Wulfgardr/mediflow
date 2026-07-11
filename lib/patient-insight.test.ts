import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizePatientInsight, splitInsightDiagnostics } from './patient-insight';

const sourceRefs = [
    { id: 'S1', label: 'Diagnosi: ICD J44.9 BPCO' },
];

test('finalizePatientInsight preserves valid citations and flags unsupported claims', () => {
    const output = finalizePatientInsight({
        content: [
            '**Quadro attuale:** BPCO codificata e stabile [S1]',
            '',
            '**Prossimi passi:**',
            '- Monitoraggio clinico',
        ].join('\n'),
        sourceRefs,
        limitations: ['Contesto locale sintetico.'],
        patientName: {
            firstName: 'Giulia',
            lastName: 'Bianchi',
        },
    });

    const diagnostics = splitInsightDiagnostics(output);

    assert.match(output, /\[S1\]/);
    assert.match(output, /\[DATI-INCOMPLETI\]/);
    assert.match(diagnostics.sourcesMarkdown, /Diagnosi: ICD J44\.9 BPCO/);
    assert.match(diagnostics.sourcesMarkdown, /Claim senza supporto diretto sufficiente/);
    assert.match(diagnostics.limitsMarkdown, /Contesto locale sintetico/);
});

test('finalizePatientInsight keeps partially supported insight instead of generic fallback', () => {
    const output = finalizePatientInsight({
        content: [
            '**Quadro attuale:** BPCO codificata e stabile [S1]',
            '',
            '**Attenzioni:**',
            '- Rivalutare saturazione se peggiora la dispnea',
            '',
            '**Prossimi passi:**',
            '- Confermare follow-up pneumologico',
        ].join('\n'),
        sourceRefs,
        patientName: {
            firstName: 'Giulia',
            lastName: 'Bianchi',
        },
    });

    const diagnostics = splitInsightDiagnostics(output);

    assert.doesNotMatch(output, /Insight AI declassato/);
    assert.match(output, /\[S1\]/);
    assert.match(output, /\[DATI-INCOMPLETI\]/);
    assert.match(diagnostics.limitsMarkdown, /claim non hanno supporto diretto sufficiente/i);
});

test('patient insight fallback removes uppercase think artifacts', () => {
    const output = finalizePatientInsight({
        content: [
            '<THINK>Ragionamento interno da non mostrare</THINK>',
            '**Quadro attuale:** BPCO codificata e stabile [S1]',
        ].join('\n'),
        sourceRefs,
    });

    assert.doesNotMatch(output, /think|ragionamento interno/i);
    assert.match(output, /BPCO codificata e stabile/);
});

test('finalizePatientInsight falls back when no claim has direct support', () => {
    const output = finalizePatientInsight({
        content: [
            '**Quadro attuale:** Quadro clinico da verificare',
            '',
            '**Attenzioni:**',
            '- Rivalutare con documentazione aggiornata',
            '',
            '**Prossimi passi:**',
            '- Recuperare referti recenti',
        ].join('\n'),
        sourceRefs,
        patientName: {
            firstName: 'Giulia',
            lastName: 'Bianchi',
        },
    });

    assert.match(output, /Insight AI declassato/);
    assert.match(output, /Claim senza supporto diretto sufficiente/);
});

test('finalizePatientInsight falls back when suspicious third-party names appear', () => {
    const output = finalizePatientInsight({
        content: '**Quadro attuale:** Mario Rossi riferisce dispnea persistente [S1]',
        sourceRefs,
        patientName: {
            firstName: 'Giulia',
            lastName: 'Bianchi',
        },
    });

    assert.match(output, /Insight AI declassato/);
    assert.match(output, /riferimenti nominali non coerenti/i);
    assert.match(output, /DATI-INCOMPLETI/);
});

test('finalizePatientInsight accepts two-token patient mentions when one side has compound names', () => {
    const output = finalizePatientInsight({
        content: '**Quadro attuale:** Isabella Garolla e stata dimessa dopo ricovero ortopedico [S1]',
        sourceRefs,
        patientName: {
            firstName: 'Garolla',
            lastName: 'Isabella Ester Maria',
        },
    });

    assert.doesNotMatch(output, /Insight AI declassato/);
    assert.doesNotMatch(output, /riferimenti nominali non coerenti/i);
    assert.match(output, /\[S1\]/);
});
