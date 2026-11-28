import assert from 'node:assert/strict';
import test from 'node:test';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import * as metadata from '../lib/patient-diary-metadata.ts';
import * as scaleHistory from '../lib/scale-history.ts';
import { element, find, mountContract, text } from './settings/settings-presentation.test-support.ts';

process.env.TZ = 'Europe/Rome';

function margin(extra: Record<string, unknown>) {
    const tree = mountContract('components/timeline-entry-card.tsx', 'TimelineEntryCard', {
        props: { patientDiary: true, entry: { id: 'synthetic-entry', patientId: 'synthetic-patient', type: 'note',
            title: 'Contesto sintetico', content: 'Testo clinico sintetico', createdAt: new Date('2026-11-18T09:12:00Z'), ...extra } },
        imports: {
            './patient-entry-revisions': { PatientEntryRevisions: ({ children }: { children: unknown }) => children },
            'date-fns': { format }, 'date-fns/locale': { it }, '@/lib/scale-history': scaleHistory,
            '@/lib/db': {}, '@/components/ui/button': { Button: (props: Record<string, unknown>) => element('button', props) },
            '@/components/patient-sheet-menu': {}, '@/components/ui/lume-filo': {},
            '@/components/ui/ink-state': { InkState: (props: Record<string, unknown>) => element('span', props) },
            '@/lib/patient-diary-metadata': metadata,
            '@/components/clinical-rich-text-content': { ClinicalRichTextContent: ({ content }: { content: string }) => content },
            '@/components/privacy-blur': { default: ({ children }: { children: unknown }) => children },
            '@/lib/live-query': {}, '@/components/runtime-twin-design': { useRuntimeTwinDesign: () => ({ proposal: true }) },
        },
    }).render();
    const node = find(tree, candidate => candidate.type === 'time');
    return { text: text(node).trim(), dateTime: node.props.dateTime };
}

const dossier = { dossier: { factRef: 'sintetico:fatto', kind: 'care_context' } };

test('una voce da documento con la sola data mostra il giorno senza inventare un orario', () => {
    const shown = margin({ date: new Date('2026-03-18T00:00:00.000Z'), metadata: dossier });
    assert.doesNotMatch(shown.text, /\d{1,2}:\d{2}/u);
    assert.match(shown.text, /18 mar 2026/u);
    assert.equal(shown.dateTime, '2026-03-18');
});

test('la sola data resta lo stesso giorno anche in un fuso a ovest di Greenwich', () => {
    process.env.TZ = 'America/New_York';
    try {
        assert.match(margin({ date: new Date('2026-03-18T00:00:00.000Z'), metadata: dossier }).text, /^18 mar 2026$/u);
    } finally { process.env.TZ = 'Europe/Rome'; }
});

test('una voce con orario conserva l’ora, anche se nata a mezzanotte fuori dai documenti', () => {
    assert.match(margin({ date: new Date('2026-03-18T09:30:00.000Z') }).text, /18 mar 2026\s+10:30/u);
    assert.match(margin({ date: new Date('2026-03-18T00:00:00.000Z') }).text, /18 mar 2026\s+01:00/u);
    assert.match(margin({ date: new Date('2026-03-18T07:45:00.000Z'), metadata: dossier }).text, /18 mar 2026\s+08:45/u);
});
