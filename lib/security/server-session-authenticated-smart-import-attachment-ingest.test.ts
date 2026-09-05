/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import {
    createAuthenticatedSmartImportAttachmentIngestService,
} from './server-session-authenticated-smart-import-attachment-ingest.ts';
import { ServerSessionSmartImportAttachmentIngestError } from './server-session-smart-import-attachment-ingest.ts';
import { clearAllSessions, createSession } from './server-session.ts';
import { ServerSessionProjectionOwnerError } from './server-session-projection-owner.ts';

const USER = { id: 'synthetic-ingest-user', username: ['synthetic', 'ingest-clinician'].join('-'), role: 'clinician' };
const PAYLOAD = Object.freeze({ tuple: Object.freeze({ sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 1,
    patientRef: `ptr_${'2'.repeat(32)}`, ambulatoryRef: `abr_${'3'.repeat(32)}`, leaseRef: `lsr_${'4'.repeat(32)}` }),
    attachment: Object.freeze({ schemaVersion: 'mediflow.smart-import.projection-attachment.v1' }), requestId: 'request.synthetic.0001' });

afterEach(() => clearAllSessions());

function rejects(code: string) {
    return (error: unknown) => error instanceof ServerSessionSmartImportAttachmentIngestError && error.code === code;
}

test('acquires once and delegates the exact frozen session, owner, and input to return only an opaque handle', async () => {
    const session = createSession(USER); const owner = Object.freeze({}) as never;
    const context = Object.freeze({ session, owner });
    let acquisitions = 0; let received: unknown[] = [];
    const service = createAuthenticatedSmartImportAttachmentIngestService({ acquireContext: async () => {
        acquisitions += 1; return context;
    }, ingestWithOwner: (currentSession, currentOwner, input) => {
        received = [currentSession, currentOwner, input]; return `prj_${'a'.repeat(32)}`;
    } });

    const handle = await service.ingest(PAYLOAD);

    assert.match(handle, /^prj_[0-9a-f]{32}$/u);
    assert.deepEqual(received, [session, owner, PAYLOAD]);
    assert.equal(acquisitions, 1);
});

test('maps null and hostile acquisition failures to one fixed session-unavailable error', async () => {
    for (const acquireContext of [async () => null, async () => { throw new Error('synthetic raw acquisition marker'); }]) {
        let calls = 0;
        const service = createAuthenticatedSmartImportAttachmentIngestService({ acquireContext,
            ingestWithOwner: () => { calls += 1; return 'unused'; } });
        await assert.rejects(() => service.ingest(PAYLOAD), (error: unknown) => rejects('session_unavailable')(error)
            && !/synthetic raw/u.test(error instanceof Error ? error.message : ''));
        assert.equal(calls, 0);
    }
});

test('propagates typed ingest failures without a second acquisition or retry', async () => {
    const session = createSession(USER); const context = Object.freeze({ session, owner: Object.freeze({}) as never });
    let acquisitions = 0; let ingests = 0;
    const service = createAuthenticatedSmartImportAttachmentIngestService({ acquireContext: async () => {
        acquisitions += 1; return context;
    }, ingestWithOwner: () => { ingests += 1; throw new ServerSessionProjectionOwnerError('stale_selection'); } });

    await assert.rejects(() => service.ingest(PAYLOAD), (error: unknown) =>
        error instanceof ServerSessionProjectionOwnerError && error.code === 'stale_selection');
    assert.deepEqual({ acquisitions, ingests }, { acquisitions: 1, ingests: 1 });
});

test('composition and production boundary exclude routes, provider, lifecycle, preview, apply, selection, and global lookup', () => {
    const core = readFileSync(new URL('./server-session-authenticated-smart-import-attachment-ingest.ts', import.meta.url), 'utf8');
    const production = readFileSync(new URL('./server-session-authenticated-smart-import-attachment-ingest-production.ts', import.meta.url), 'utf8');

    assert.match(production, /acquireAuthenticatedWebSessionProjectionOwnerContext/u);
    assert.doesNotMatch(`${core}\n${production}`, /(?:route|provider|lifecycle|preview|apply|issueSelection|\.lookup\()/u);
});
