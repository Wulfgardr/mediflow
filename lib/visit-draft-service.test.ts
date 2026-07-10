import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createVisitDraft,
    normalizeVisitDraftRouteBody,
} from './visit-draft-service.ts';
import { buildVisitTranscriptDraft } from './visit-transcript-draft.ts';

const noCatalog = { fetchDrugCatalogCandidates: async () => [] };

test('createVisitDraft preserves the extracted web route normalization and response contract', async () => {
    const body = {
        patientId: 'ignored-web-only-patient-id',
        transcript: ' S: tosse persistente\nP: continuare terapia ',
        segments: [{ text: ' O: SpO2 97% ', speaker: 'medico', atMs: 1200 }, { text: '' }],
        events: [{ type: 'start', atMs: 0 }, { type: 'stop', atMs: 1600 }],
    };
    const normalized = normalizeVisitDraftRouteBody(body);
    const result = await createVisitDraft(body, noCatalog);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, buildVisitTranscriptDraft({ ...normalized, drugCatalog: [] }));
    assert.equal(result.value.safety.reviewRequired, true);
    assert.equal(result.value.safety.rawAudioPersisted, false);
    assert.deepEqual(result.value.safety.writesPerformed, []);
});

test('createVisitDraft applies the shared 400 and 413 transcript limits without persistence', async () => {
    let catalogCalls = 0;
    const deps = { fetchDrugCatalogCandidates: async () => { catalogCalls += 1; return []; } };

    const empty = await createVisitDraft({}, deps);
    assert.deepEqual(empty, { ok: false, status: 400, error: 'Transcript required' });

    const tooLong = await createVisitDraft({ transcript: 'x'.repeat(12_001) }, deps);
    assert.deepEqual(tooLong, { ok: false, status: 413, error: 'Transcript too long' });
    assert.equal(catalogCalls, 0);
});
