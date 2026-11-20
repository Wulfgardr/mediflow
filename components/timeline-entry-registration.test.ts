import assert from 'node:assert/strict';
import test from 'node:test';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import * as metadata from '../lib/patient-diary-metadata.ts';
import * as scaleHistory from '../lib/scale-history.ts';
import { prepareScaleSubmission } from '../lib/scale-submission.ts';
import { TINETTI_POMA28 } from '../lib/scales/tinetti-poma28-v1.ts';
import { element, find, mountContract, text } from './settings/settings-presentation.test-support.ts';

const createdAt = new Date('2026-11-07T14:35:00Z');
function render(recordedBy?: string | null, extra: Record<string, unknown> = {}) {
    return mountContract('components/timeline-entry-card.tsx', 'TimelineEntryCard', {
        props: { patientDiary: true, entry: { id: 'synthetic-entry', patientId: 'synthetic-patient',
            type: 'visit', title: 'Controllo sintetico', content: 'Testo clinico sintetico',
            date: new Date('2020-01-01T08:00:00Z'), createdAt, recordedBy, ...extra } },
        imports: {
            './patient-entry-revisions': { PatientEntryRevisions: ({ children }: { children: unknown }) => children },
            'date-fns': { format }, 'date-fns/locale': { it }, '@/lib/scale-history': scaleHistory,
            '@/lib/db': {}, '@/components/ui/button': { Button: (props: Record<string, unknown>) => element('button', props) },
            '@/components/patient-sheet-menu': {}, '@/components/ui/lume-filo': {},
            '@/components/ui/ink-state': { InkState: (props: Record<string, unknown>) =>
                mountContract('components/ui/ink-state.tsx', 'InkState', { props }).render() },
            '@/lib/patient-diary-metadata': metadata,
            '@/components/clinical-rich-text-content': { ClinicalRichTextContent: ({ content }: { content: string }) => content },
            '@/components/privacy-blur': { default: ({ children }: { children: unknown }) => children },
            '@/lib/live-query': {}, '@/components/runtime-twin-design': { useRuntimeTwinDesign: () => ({ proposal: true }) },
        },
    }).render();
}
const timestamp = `il ${format(createdAt, 'dd MMMM yyyy', { locale: it })} alle ${format(createdAt, 'HH:mm', { locale: it })}`;

test('la scheda riassume il POMA-28 registrato e conserva testo e versione nei dettagli', () => {
    const stored = prepareScaleSubmission(TINETTI_POMA28.id, Object.fromEntries(
        TINETTI_POMA28.questions.map(question => [question.id, 0]),
    ));
    const tree = render(undefined, { type: 'scale', ...stored, content: `${stored.content}\nOsservazione sintetica registrata.` });
    const ordinaryView = text(tree, false);
    assert.match(ordinaryView, /Tinetti POMA-28\s+Punteggio\s+0\/28/u);
    assert.equal((ordinaryView.match(/Tinetti POMA-28/gu) ?? []).length, 1);
    assert.doesNotMatch(ordinaryView, /Osservazione sintetica|\(v1\)|mediflow\.poma28|Valutazione Tinetti/u);
    assert.match(text(tree), /mediflow\.poma28\.nonclassification\.v1\s+Osservazione sintetica registrata\./u);
});

test('la scheda storica mostra la valutazione registrata senza attribuirle il denominatore POMA-28', () => {
    const tree = render(undefined, { type: 'scale', title: 'Tinetti', content: 'Punteggio registrato: 17',
        metadata: { scaleId: 'tinetti', score: 17, interpretation: 'Interpretazione storica sintetica' } });
    const ordinaryView = text(tree, false);
    assert.match(ordinaryView, /Punteggio\s+17\s+Interpretazione storica sintetica/u);
    assert.match(ordinaryView, /Provenienza non verificabile/u);
    assert.doesNotMatch(ordinaryView, /17\/28|Punteggio registrato/u);
    assert.match(text(tree), /Punteggio registrato: 17/u);
});

test('la voce registrata mostra autore del server e orario di registrazione con punto asciutto', () => {
    const tree = render('Ada Sintetica', { metadata: { authorName: 'Nome nei metadati' } });
    const row = find(tree, node => node.props.className === 'fixture-registration');
    assert.equal(text(row).trim(), `Registrata da Ada Sintetica ${timestamp}`);
    assert.equal(find(row, node => node.props['data-ink'] === 'dry').props['data-ink'], 'dry');
    assert.doesNotMatch(text(row), /Nome nei metadati|2020/u);
});

test('le voci storiche senza autore mostrano solo data e ora senza ricavare nomi dai metadati', () => {
    for (const value of [undefined, null, '', ' ']) {
        const tree = render(value, { metadata: { authorName: 'Autore storico dichiarato' } });
        const row = find(tree, node => node.props.className === 'fixture-registration');
        assert.equal(text(row).trim(), `Registrata ${timestamp}`);
        assert.doesNotMatch(text(row), /Registrata da|Autore storico dichiarato/u);
    }
});

test('bozze, firme e metadati illeggibili conservano lo stato senza diventare una registrazione attribuita', () => {
    for (const [value, expected] of [[{ workflowStatus: 'draft' }, 'Bozza'],
        [{ workflowStatus: 'signed' }, 'Firmata'], ['ENC:synthetic', 'Stato non leggibile']] as const) {
        const tree = render('Ada Sintetica', { metadata: value });
        assert.match(text(tree), new RegExp(expected));
        assert.doesNotMatch(text(tree), /Registrata da Ada Sintetica/u);
    }
});

test('un orario assente o non valido non viene sostituito dalla data clinica', () => {
    for (const value of [undefined, null, new Date(NaN)]) {
        const row = find(render(null, { createdAt: value }), node => node.props.className === 'fixture-registration');
        assert.equal(text(row).trim(), 'Registrata');
    }
});
