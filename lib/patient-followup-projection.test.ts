import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFollowupSuggestions } from './patient-followup-projection';

// Fixture minima: costruiamo oggetti compatibili con DocumentInsight senza tirare
// dentro Dexie (il modulo importa DocumentInsight solo come tipo, erasabile).
function insight(id: string, documentDate: string, fileName: string, facts: unknown[]): any {
    return {
        id,
        date: new Date(documentDate),
        fileName,
        rawMarkdown: '',
        summary: '',
        evidencePack: {
            schemaVersion: 'mediflow.document_evidence_pack.v2',
            source: { documentInsightId: id, fileName, documentDate },
            facts,
        },
    };
}

function fact(id: string, kind: string, label: string, extra: Record<string, unknown> = {}): any {
    return {
        id,
        kind,
        label,
        excerpt: `excerpt ${label}`,
        sourceId: 'src',
        temporality: 'planned',
        status: 'planned',
        origin: 'documented',
        ...extra,
    };
}

test('projects only planned followup facts, not other kinds/statuses', () => {
    const insights = [
        insight('i1', '2026-06-01', 'dimissione.pdf', [
            fact('f1', 'followup', 'Controllo cardiologico a 3 mesi'),
            fact('f2', 'followup', 'Visita gia risolta', { temporality: 'historical', status: 'resolved' }),
            fact('f3', 'problem', 'Ipertensione'),
            fact('f4', 'medication', 'Ramipril'),
        ]),
    ];
    const out = projectFollowupSuggestions(insights);
    assert.equal(out.length, 1);
    assert.equal(out[0].label, 'Controllo cardiologico a 3 mesi');
    assert.equal(out[0].citation.fileName, 'dimissione.pdf');
    assert.equal(out[0].citation.documentInsightId, 'i1');
    assert.equal(out[0].id, 'i1:f1');
});

test('accepts a followup planned only via status (temporality other)', () => {
    const insights = [insight('i1', '2026-06-01', 'd.pdf', [
        fact('f1', 'followup', 'Ecodoppler', { temporality: 'unknown', status: 'planned' }),
    ])];
    assert.equal(projectFollowupSuggestions(insights).length, 1);
});

test('dedupes by normalized label, most recent document first', () => {
    const insights = [
        insight('old', '2026-01-01', 'vecchio.pdf', [fact('a', 'followup', 'Controllo  Cardiologico')]),
        insight('new', '2026-06-01', 'nuovo.pdf', [fact('b', 'followup', 'controllo cardiologico')]),
    ];
    const out = projectFollowupSuggestions(insights);
    assert.equal(out.length, 1);
    // il piu recente vince
    assert.equal(out[0].citation.fileName, 'nuovo.pdf');
});

test('caps the number of suggestions', () => {
    const facts = Array.from({ length: 10 }, (_, i) => fact(`f${i}`, 'followup', `Controllo ${i}`));
    const out = projectFollowupSuggestions([insight('i1', '2026-06-01', 'd.pdf', facts)], { max: 3 });
    assert.equal(out.length, 3);
});

test('returns empty for legacy insights without evidencePack or empty input', () => {
    assert.deepEqual(projectFollowupSuggestions([]), []);
    assert.deepEqual(projectFollowupSuggestions(undefined), []);
    const legacy: any = { id: 'x', date: new Date('2026-01-01'), fileName: 'l.pdf', rawMarkdown: '', summary: '' };
    assert.deepEqual(projectFollowupSuggestions([legacy]), []);
});
