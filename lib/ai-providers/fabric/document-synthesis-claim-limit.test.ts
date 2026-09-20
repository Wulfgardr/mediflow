/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { bindDocumentSynthesisClaimsToCitations } from './document-synthesis-claim-citations.ts';
import { digestDocumentSynthesisClaimCitations } from './document-synthesis-claim-citations-digest.ts';
import { normalizeDocumentSynthesisOutput } from './document-synthesis-output-contract.ts';
import { captureDocumentSynthesisSourceSet } from './document-synthesis-source-set-contract.ts';

const QUOTE = 'Fonte interamente sintetica per il solo controllo del contratto.';
function fixture(nestedItems: number, qualityReason = false) {
    const captured = captureDocumentSynthesisSourceSet({ sourceSetEpoch: BigInt(1), revocationGeneration: BigInt(1),
        sources: [{ documentSourceRef: 'document.synthetic.claim.limit', documentRevision: BigInt(1),
            documentFreshnessEpoch: BigInt(1), sourceText: QUOTE }],
    });
    assert.equal(captured.status, 'available');
    if (captured.status !== 'available') throw new Error('Synthetic source rejected');
    const output = { schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Sintesi sintetica.',
        data: { qualityLevel: 'green', ...(qualityReason ? { qualityReason: 'Fonte sintetica leggibile.' } : {}),
            medications: Array.from({ length: 64 }, (_, i) => `Voce sintetica ${i + 1}`),
            diagnoses: Array.from({ length: 32 }, (_, i) => ({ code: `SYN-${i + 1}`, description: `Diagnosi sintetica ${i + 1}`, system: 'ICD-10' })),
            problemStatements: Array.from({ length: 32 }, (_, i) => ({ label: `Problema sintetico ${i + 1}`, icdQuery: 'synthetic', confidence: 'low', evidence: QUOTE })),
            therapyCandidates: Array.from({ length: 32 }, (_, i) => ({ drugMention: `Voce sintetica ${i + 1}`, drugQuery: 'synthetic', confidence: 'low', evidence: QUOTE })),
            servicePrescriptions: [{ serviceName: 'Gruppo sintetico', confidence: 'low', evidence: QUOTE,
                items: Array.from({ length: nestedItems }, (_, i) => ({ serviceName: `Prestazione sintetica ${i + 1}`, confidence: 'low', evidence: QUOTE })) }],
        },
    };
    const paths = ['summary', 'data.qualityLevel', ...(qualityReason ? ['data.qualityReason'] : []),
        ...Array.from({ length: 64 }, (_, i) => `data.medications[${i}]`),
        ...Array.from({ length: 32 }, (_, i) => `data.diagnoses[${i}]`),
        ...Array.from({ length: 32 }, (_, i) => `data.problemStatements[${i}]`),
        ...Array.from({ length: 32 }, (_, i) => `data.therapyCandidates[${i}]`),
        'data.servicePrescriptions[0]',
        ...Array.from({ length: nestedItems }, (_, i) => `data.servicePrescriptions[0].items[${i}]`),
    ];
    return { sourceSet: captured.sourceSet, output, claims: paths.map((claimPath) => ({ claimPath, labels: ['S1'] })),
        citations: [{ label: 'S1', quote: QUOTE, startByte: 0, endByte: Buffer.byteLength(QUOTE),
            quoteSha256: createHash('sha256').update(QUOTE).digest('hex') }],
    };
}
for (const [nestedItems, withReason, expectedCount, allowed] of [
    [30, false, 193, true], [31, false, 194, true], [32, false, 195, false],
    [30, true, 194, true], [31, true, 195, false],
] as const) {
    test(`claim cap: ${expectedCount} paths, nested items=${nestedItems}, quality reason=${withReason}`, () => {
        const request = fixture(nestedItems, withReason);
        assert.equal(request.claims.length, expectedCount);
        // The nested collections remain individually valid: only the total claim budget changes.
        assert.equal(normalizeDocumentSynthesisOutput(request.output).status, 'available');
        const result = bindDocumentSynthesisClaimsToCitations(request);
        if (allowed) {
            assert.equal(result.status, 'available');
            if (result.status !== 'available') return;
            assert.equal(result.claims.length, expectedCount);
            assert.deepEqual(result.claims.map((claim) => claim.claimPath), request.claims.map((claim) => claim.claimPath));
            // Codec input shape only, not an authenticated U0/lease. The owner copies raw digest bytes.
            const codecInput = Object.freeze(Object.assign(Object.create(null), result,
                { sourceSetDigestSha256: Object.freeze([...request.sourceSet.sourceSetDigestSha256]) }));
            assert.equal(digestDocumentSynthesisClaimCitations(codecInput)?.length, 32);
        } else {
            assert.equal(result.status, 'denied');
            assert.deepEqual({ ...result }, { status: 'denied', code: 'input_invalid', output: null,
                outputSha256: null, citations: null, claims: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
        }
    });
}

test('claim cap cannot be met by dropping citations for the last nested item', () => {
    const request = fixture(32);
    request.claims.pop();
    assert.equal(request.claims.length, 194);
    assert.equal(bindDocumentSynthesisClaimsToCitations(request).status, 'denied');
});
