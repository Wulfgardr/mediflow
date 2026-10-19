/** Synthetic process fixture: never invoked by the application or a provider. */
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { basename, join } from 'node:path';
import { once } from 'node:events';
import { installNetworkPatientCookieFixture } from './network-patient-authority-test-fixture';
import { issueSyntheticWebSessionContext } from './security/web-auth-lifecycle-owner-test-fixture';
import { clearAllSessions } from './security/server-session';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { isProfileNotesCommitView } from './patient-profile-notes-commit-contract';

const dataDir = process.env.MEDIFLOW_DATA_DIR;
if (process.env.MEDIFLOW_TEST_PROFILE_NOTES_PROCESS !== '1' || !dataDir || !basename(dataDir).startsWith('mediflow-profile-review-')) {
    throw new Error('A run-owned synthetic profile review directory is required');
}
const load = createRequire(import.meta.url);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server'); openDbServer();
const cookieDir = mkdtempSync(join(dataDir, 'process-cookies-'));
const cookieState = { cookies: new Map<string, string>() };
const cleanup = installNetworkPatientCookieFixture(cookieDir, cookieState);
const queryRoute = load('../app/api/patients/[id]/profile-query/route.ts') as typeof import('../app/api/patients/[id]/profile-query/route');
const commitRoute = load('../app/api/patients/[id]/notes-commit/route.ts') as typeof import('../app/api/patients/[id]/notes-commit/route');
const SYNTHETIC_USER = 'synthetic-review-user';
const PIN = '3817';
const user = { id: SYNTHETIC_USER, username: SYNTHETIC_USER, role: 'user' };
const session = issueSyntheticWebSessionContext(user, `profile-worker-${process.pid}`);
cookieState.cookies.set('mediflow_session', session.session.id); cookieState.cookies.set('mediflow_auth_control', session.controlId);
cookieState.cookies.set('ambulatory_id', 'synthetic-scope');
const context = { params: Promise.resolve({ id: 'synthetic-patient-a' }) };
function request(body: unknown, path = 'notes-commit') {
    return new Request(`http://127.0.0.1/api/patients/synthetic-patient-a/${path}`, { method: 'POST', headers: {
        'content-type': 'application/json', origin: 'http://127.0.0.1', 'sec-fetch-site': 'same-origin',
        'x-mediflow-archive-generation': currentArchiveGeneration(),
    }, body: JSON.stringify(body) });
}
function output(value: unknown) { process.stdout.write(`${JSON.stringify(value)}\n`); }
const mode = process.argv[2];
try {
    if (mode === 'recovery') {
        const input = JSON.parse(readFileSync(0, 'utf8')) as {
            reference: string; digest: string; pending: { reference: string; digest: string };
            oldSession: { id: string; expiresAt: number; controlId: string }; oldGeneration: string; legacyNotes?: string;
        };
        const ordinaryRoute = load('../app/api/patients/[id]/route.ts') as typeof import('../app/api/patients/[id]/route');
        const receiptInput = { kind: 'receipt', reference: input.reference, digest: input.digest };
        const summary: Record<string, { status: number; body: unknown }> = {};
        async function collect(name: string, response: Promise<Response>) {
            const value = await response; summary[name] = { status: value.status, body: await value.json() };
        }
        if (input.legacyNotes !== undefined) {
            const current = await ordinaryRoute.GET(request(null), context);
            if (current.status !== 200) throw new Error('Restored ordinary profile unavailable');
            const row = await current.json();
            await collect('write', ordinaryRoute.PUT(request({ version: row.version, notes: input.legacyNotes }), context));
        } else {
            cookieState.cookies.set('mediflow_session', input.oldSession.id);
            cookieState.cookies.set('mediflow_auth_control', input.oldSession.controlId);
            await collect('oldSession', commitRoute.POST(request(receiptInput), context));
            cookieState.cookies.set('mediflow_session', session.session.id);
            cookieState.cookies.set('mediflow_auth_control', session.controlId);
            const stale = request(receiptInput); stale.headers.set('x-mediflow-archive-generation', input.oldGeneration);
            await collect('oldGeneration', commitRoute.POST(stale, context));
            await collect('pending', commitRoute.POST(request({ kind: 'confirm', ...input.pending, candidatePin: PIN }), context));
            cookieState.cookies.set('ambulatory_id', 'synthetic-other-scope');
            await collect('scope', commitRoute.POST(request(receiptInput), context));
            cookieState.cookies.set('ambulatory_id', 'synthetic-scope');
            const other = issueSyntheticWebSessionContext({ id: 'synthetic-other-user', username: 'synthetic-other-user', role: 'user' }, `recovery-other-${process.pid}`);
            cookieState.cookies.set('mediflow_session', other.session.id); cookieState.cookies.set('mediflow_auth_control', other.controlId);
            await collect('actor', commitRoute.POST(request(receiptInput), context));
            cookieState.cookies.set('mediflow_session', session.session.id); cookieState.cookies.set('mediflow_auth_control', session.controlId);
        }
        await collect('legacy', ordinaryRoute.GET(request(null), context));
        await collect('scoped', queryRoute.POST(request({ kind: 'open', contractVersion: 1, projection: 'profile', expectedSelectionEpoch: 0 }, 'profile-query'), context));
        await collect('receipt', commitRoute.POST(request(receiptInput), context));
        await collect('replay', commitRoute.POST(request({ kind: 'confirm', reference: input.reference, digest: input.digest, candidatePin: '' }), context));
        output(summary);
    } else if (mode === 'receipt') {
        const response = await commitRoute.POST(request({ kind: 'receipt', reference: process.argv[3], digest: process.argv[4] }), context);
        output({ kind: 'result', status: response.status, body: await response.json() });
    } else {
        if (!mode || !['race', 'before-commit', 'after-commit'].includes(mode)) throw new Error('Unknown synthetic process mode');
        const selected = await queryRoute.POST(request({ kind: 'open', contractVersion: 1, projection: 'notes', expectedSelectionEpoch: 0 }, 'profile-query'), context);
        if (selected.status !== 200) throw new Error('Synthetic selection unavailable');
        const selection = await selected.json();
        const prepared = await commitRoute.POST(request({ kind: 'prepare', notes: null, expectedRevision: 4,
            expectedSelectionEpoch: selection.currentness.selectionEpoch }), context);
        const view: unknown = await prepared.json();
        if (prepared.status !== 200 || !isProfileNotesCommitView(view)) throw new Error('Synthetic preparation unavailable');
        output({ kind: 'ready', reference: view.reference, digest: view.digest });
        const [instruction] = await once(process.stdin, 'data');
        if (String(instruction).trim() !== 'go') throw new Error('Synthetic barrier unavailable');
        if (mode === 'before-commit') {
            dbServer.$client.function('synthetic_profile_commit_crash', () => {
                writeSync(1, `${JSON.stringify({ kind: 'crash', stage: mode })}\n`); process.kill(process.pid, 'SIGKILL'); return 0;
            });
            dbServer.$client.exec(`CREATE TEMP TRIGGER synthetic_profile_crash AFTER UPDATE OF version ON patients
                WHEN NEW.id = 'synthetic-patient-a' BEGIN SELECT synthetic_profile_commit_crash(); END`);
        }
        const response = await commitRoute.POST(request({ kind: 'confirm', reference: view.reference, digest: view.digest, candidatePin: PIN }), context);
        if (mode === 'after-commit') {
            if (response.status !== 200) throw new Error('Synthetic commit did not complete');
            writeSync(1, `${JSON.stringify({ kind: 'crash', stage: mode })}\n`);
            process.kill(process.pid, 'SIGKILL');
        }
        output({ kind: 'result', status: response.status, body: await response.json() });
    }
} finally {
    clearAllSessions(); cleanup(); dbServer.$client.close(); rmSync(cookieDir, { recursive: true, force: true });
}
