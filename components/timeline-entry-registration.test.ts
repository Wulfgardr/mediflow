import assert from 'node:assert/strict';
import test from 'node:test';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import * as metadata from '../lib/patient-diary-metadata.ts';
import { element, find, mountContract, text } from './settings/settings-presentation.test-support.ts';

const createdAt = new Date('2026-11-07T14:35:00Z');
function render(recordedBy?: string | null, extra: Record<string, unknown> = {}) {
    return mountContract('components/timeline-entry-card.tsx', 'TimelineEntryCard', {
        props: { patientDiary: true, entry: { id: 'synthetic-entry', patientId: 'synthetic-patient',
            type: 'visit', title: 'Controllo sintetico', content: 'Testo clinico sintetico',
            date: new Date('2020-01-01T08:00:00Z'), createdAt, recordedBy, ...extra } },
        imports: {
            'date-fns': { format }, 'date-fns/locale': { it }, '@/lib/scale-history': { scaleHistoryNotice: () => null },
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
