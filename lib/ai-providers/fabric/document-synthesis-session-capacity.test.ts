import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import Database from 'better-sqlite3';

// Rischio #9 (censimento macchine a stati, 11/11): ogni sintesi aggiunge due
// handle (cattura e anteprima) al broker della sessione, il tetto è 256 e gli
// handle consumati non vengono mai ritirati. Una sessione che ha completato
// 128 sintesi non deve vedersi negare la 129ª.
const DATA_DIRECTORY = mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR!, 'ds-capacity-'));
process.env.MEDIFLOW_DATA_DIR = DATA_DIRECTORY;
const bootstrap = new Database(path.join(DATA_DIRECTORY, 'medical.db'));
for (const file of readdirSync(path.resolve('drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    bootstrap.exec(readFileSync(path.join(path.resolve('drizzle'), file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
bootstrap.close();
(await import('../../db-server.ts')).openDbServer();
const { createFullPortProjectionOwnerFactory } = await import('../../security/server-session-projection-owner.ts');
const { clearAllSessions } = await import('../../security/server-session.ts');
const { createDocumentSynthesisProductionOperationForTest } = await import('./document-synthesis-production-operation.ts');
import { issueSyntheticWebSessionContext, retireSyntheticWebSession } from '../../security/web-auth-lifecycle-owner-test-fixture.ts';

const USER = Object.freeze({ id: 'user.synthetic.ds.capacity', username: 'clinician.synthetic', role: 'clinician' as const });
const PAIR = Object.freeze({ patientId: 'patient.synthetic.ds.capacity', ambulatoryId: 'ambulatory.synthetic.ds.capacity' });
const CURRENT = Object.freeze({ documentSourceRef: 'a'.repeat(64), documentRevision: 7, documentFreshnessEpoch: 11 });
let web: ReturnType<typeof issueSyntheticWebSessionContext> | null = null;
afterEach(() => { if (web) retireSyntheticWebSession(web.session); clearAllSessions(); });

function extracted(attachmentId: string, markdown = 'Fonte sintetica.') {
    const markdownSha256 = createHash('sha256').update(markdown).digest('hex');
    return Object.freeze({
        schemaVersion: 'mediflow.anydoc_local_extraction.v1',
        provenance: Object.freeze({ attachmentId, sourceSha256: 'b'.repeat(64), byteLength: 24 }),
        receipt: Object.freeze({ receiptId: 'c'.repeat(64), parser: 'anydoc-local', outcome: 'extracted', sourceSha256: 'b'.repeat(64),
            sourceByteLength: 24, markdownSha256, markdownByteLength: Buffer.byteLength(markdown) }),
        review: 'required', writes: 0, apply: 'none', status: 'extracted', markdown, candidateUse: 'review_only',
    });
}

test('una sessione che ha completato 128 sintesi può avviarne un\'altra', async () => {
    const registry = createFullPortProjectionOwnerFactory({
        clock: () => Date.now(),
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index + 1),
        resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }),
    });
    web = issueSyntheticWebSessionContext(USER, 'ds-capacity');
    const owner = registry.acquire(web.session);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const selected = Object.freeze({ session: web.session, owner });
    let entropy = 0;
    const factory = createDocumentSynthesisProductionOperationForTest(Object.freeze({
        acquireContext: async () => selected,
        readCurrentness: () => CURRENT,
        readLaneEnabled: () => true,
        extract: async (_session: unknown, attachmentId: string) => extracted(attachmentId),
        execute: async () => Object.freeze({ publication: 'synthetic' }),
        entropy: () => { entropy += 1; const bytes = new Uint8Array(16); new DataView(bytes.buffer).setUint32(0, entropy); return bytes; },
        registerResource: () => () => undefined,
    }));
    const operation = await factory.acquire(); assert.ok(operation);
    for (let index = 0; index < 128; index += 1) {
        const captured = await operation.capture({ attachmentId: 'attachment.synthetic.document' });
        assert.equal(captured.status, 'available', `sintesi ${index}: cattura`);
        const ingested = await operation.ingest({ captureHandle: captured.captureHandle });
        assert.equal(ingested.status, 'available', `sintesi ${index}: ingestione`);
        const preview = await operation.preview({ previewHandle: ingested.previewHandle });
        assert.equal(preview.status, 'available', `sintesi ${index}: anteprima`);
    }
    const next = await operation.capture({ attachmentId: 'attachment.synthetic.document' });
    assert.deepEqual({ status: next.status, code: next.code }, { status: 'available', code: null }, 'la 129ª sintesi della stessa sessione');
});
