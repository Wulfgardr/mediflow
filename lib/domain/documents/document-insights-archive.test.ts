import test from 'node:test';
import assert from 'node:assert/strict';
import { persistDocumentInsightsArchive } from './document-insights-archive';

test('document insights archive persists with the patient version', async () => {
    let receivedChanges: Record<string, unknown> | undefined;

    await persistDocumentInsightsArchive({
        updatePatient: async (_patientId, changes) => {
            receivedChanges = changes;
            if (typeof changes.version !== 'number') {
                throw new Error('Missing required version for patient update');
            }
        },
        now: () => new Date('2026-07-10T10:00:00.000Z'),
    }, {
        id: 'patient-document-insights',
        version: 7,
    }, []);

    assert.deepEqual(receivedChanges, {
        documentInsights: [],
        updatedAt: new Date('2026-07-10T10:00:00.000Z'),
        version: 7,
    });
});
