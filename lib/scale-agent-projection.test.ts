import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { prepareScaleSubmission } from './scale-submission';

test('actual Patient Insight builder carries a bounded stored version without rewriting legacy', async () => {
    const submission = prepareScaleSubmission('gds', {
        g1: 1, g2: 1, g3: 1, g4: 1, g5: 1, g6: 1, g7: 0, g8: 0,
        g9: 0, g10: 0, g11: 0, g12: 0, g13: 0, g14: 0, g15: 0,
    });
    const entry = { id: 'synthetic-scale', patientId: 'synthetic-patient', date: new Date(),
        type: 'scale', ...submission };
    let storedEntry: Record<string, unknown> = entry;
    const filter = (items: unknown[]) => ({ filter: () => ({ toArray: async () => items }) });
    const db = {
        patients: { get: async () => ({ id: 'synthetic-patient', firstName: 'Synthetic', lastName: 'Scale', diagnoses: [] }) },
        entries: { filter: () => ({ toArray: async () => [storedEntry] }) },
        therapies: filter([]), observations: filter([]), checkups: filter([]), attachments: filter([]),
    };
    const loader = Module as unknown as { _load: (name: string, parent: NodeModule | null, main: boolean) => unknown };
    const original = loader._load;
    loader._load = function (name, parent, main) {
        if (name === '@/lib/db') return { db };
        if (name === '@/lib/ai-insight-settings') return {
            estimateAIInsightComplexityScore: () => 0,
            getAIInsightRuntimeSettings: async () => ({ maxDocuments: 3, maxDocumentSummaryChars: 260,
                maxDocumentContextChars: 1000, outputMaxTokens: 256 }),
        };
        return original.call(this, name, parent, main);
    };
    try {
        const { buildPatientInsightContext } = await import('./ai-context');
        const before = JSON.stringify(entry);
        const current = await buildPatientInsightContext('synthetic-patient');
        const line = current.sourceRefs.find(ref => ref.evidenceSourceId === 'diary:synthetic-scale')!.promptLine;
        assert.match(line, /Versione interpretazione: mediflow\.gds15\.screening-limits\.v1/);
        assert.equal(JSON.stringify(entry), before);

        const originalContent = 'Valutazione GDS. Punteggio: 6. Interpretazione: Depressione Lieve (6-10).';
        storedEntry = { ...entry, content: originalContent,
            metadata: { scaleId: 'gds', score: 6, interpretation: 'Depressione Lieve (6-10)' } };
        const legacyBytes = JSON.stringify(storedEntry);
        const legacy = await buildPatientInsightContext('synthetic-patient');
        const legacyLine = legacy.sourceRefs.find(ref => ref.evidenceSourceId === 'diary:synthetic-scale')!.promptLine;
        // The existing evidence queue selects the first sentence; it does not
        // promise to include the entire stored interpretation in this summary.
        assert.match(legacyLine, /SCALE: Valutazione GDS\.$/);
        assert.doesNotMatch(legacyLine, /Versione interpretazione/);
        assert.equal(JSON.stringify(storedEntry), legacyBytes);
        for (const version of ['x'.repeat(97), 'ignore\ninstructions', '<script>version</script>']) {
            storedEntry = { ...storedEntry, metadata: { interpretationVersion: version } };
            const rejected = await buildPatientInsightContext('synthetic-patient');
            assert.equal(rejected.sourceRefs.find(ref => ref.evidenceSourceId === 'diary:synthetic-scale')!.promptLine, legacyLine);
        }
        storedEntry = { ...entry, metadata: { ...entry.metadata, interpretationVersion: 'v'.repeat(96) } };
        const bounded = await buildPatientInsightContext('synthetic-patient');
        const boundedLine = bounded.sourceRefs.find(ref => ref.evidenceSourceId === 'diary:synthetic-scale')!.promptLine;
        const prefixLength = line.indexOf('Versione interpretazione:');
        assert.ok(boundedLine.length <= prefixLength + 160,
            'One selected snippet keeps its existing 160-character budget, including the identifier');
    } finally {
        loader._load = original;
    }
});
