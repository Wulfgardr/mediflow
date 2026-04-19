import test from 'node:test';
import assert from 'node:assert/strict';
import type { DocumentInsight } from './db';
import { dedupeDocumentInsightsForContext } from './document-insight-context';

test('dedupeDocumentInsightsForContext keeps the richer document for the same dated episode', () => {
    const insights: DocumentInsight[] = [
        {
            id: 'ps-1',
            date: new Date('2025-03-05T08:00:00Z'),
            fileName: 'PS.pdf',
            rawMarkdown: 'Verbale di pronto soccorso\nFrattura pertrocanterica femore sinistro',
            summary: 'Accesso in PS per frattura pertrocanterica femore sinistro',
            extractedData: {
                diagnoses: [
                    {
                        code: 'S72.1',
                        description: 'Frattura pertrocanterica del femore sinistro',
                        system: 'ICD-10',
                    },
                ],
            },
        },
        {
            id: 'dim-1',
            date: new Date('2025-03-05T12:00:00Z'),
            fileName: 'dimissione.pdf',
            rawMarkdown: [
                'Diagnosi di dimissione',
                'Frattura pertrocanterica del femore sinistro',
                'Terapia alla dimissione',
                'Pregabalin 75 mg 1 cp ore 8',
                'Indicazioni alla dimissione',
                'FKT domiciliare',
            ].join('\n'),
            summary: 'Dimissione con follow-up ortopedico',
            extractedData: {
                diagnoses: [
                    {
                        code: 'S72.1',
                        description: 'Frattura pertrocanterica del femore sinistro',
                        system: 'ICD-10',
                    },
                ],
                medications: ['Pregabalin 75 mg 1 cp ore 8'],
            },
        },
        {
            id: 'lab-1',
            date: new Date('2025-03-06T09:00:00Z'),
            fileName: 'lab.pdf',
            rawMarkdown: 'Azotemia 67 mg/dL',
            summary: 'Azotemia in lieve aumento',
        },
    ];

    const result = dedupeDocumentInsightsForContext(insights);

    assert.equal(result.omittedCount, 1);
    assert.deepEqual(result.insights.map((insight) => insight.id), ['lab-1', 'dim-1']);
});
