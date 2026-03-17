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
