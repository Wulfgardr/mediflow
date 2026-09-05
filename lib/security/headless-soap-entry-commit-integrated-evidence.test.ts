/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-soap-h10-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const sqlite = new Database(path.join(dataDir, 'medical.db'));
for (const fileName of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', fileName), 'utf8')
        .replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}

const nextEnvironmentBaseline = 'next/dist/server/node-environment-baseline.js';
await import(nextEnvironmentBaseline);
const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external.js');
const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external.js');
const { RequestCookiesAdapter } = await import('next/dist/server/web/spec-extension/adapters/request-cookies.js');
const { RequestCookies } = await import('next/dist/server/web/spec-extension/cookies.js');
const { bootstrapWebAuthControl } = await import('./web-auth-control-transport.ts');
const { POST: setup } = await import('../../app/api/auth/setup/route.ts');
const { dbServer } = await import('../db-server.ts');
const { ambulatories, patients, patientsToAmbulatories } = await import('../schema.ts');
const { enrollHeadlessSoapActiveRoleAttestation } = await import('./headless-soap-active-role-enrollment-production.ts');
const { issueAuthenticatedWebSessionSelection } = await import('./server-session-authenticated-selection-production.ts');
const { validateClinicianSoapWriteDraft } = await import('../headless/clinician-soap-write-contract.ts');
const { headlessSoapChildSessionLeaseService } = await import('./headless-soap-child-session-lease-production.ts');
const { headlessSoapProposalLifecycleService } = await import('./headless-soap-proposal-lifecycle-production.ts');
const { headlessSoapEntryFieldSetLifecycleService } = await import('./headless-soap-entry-field-set-lifecycle-production.ts');
const { headlessSoapEntryPresentationLifecycleProductionOwner: presentationOwner } =
    await import('./headless-soap-entry-presentation-lifecycle-production-internal.ts');
const { createClinicianSoapEntrySealOwner } = await import('../headless/clinician-soap-entry-seal.ts');
const { createClinicianSoapExplicitGestureOwner } = await import('../headless/clinician-soap-explicit-gesture.ts');
const { headlessSoapAuthorizationProofService } = await import('./headless-soap-authorization-proof-production.ts');
const { headlessSoapCommandBindingService } = await import('./headless-soap-command-binding-production.ts');
const { headlessSoapEntryCommitWebAdapter, headlessSoapEntryCommitChatAdapter } =
    await import('./headless-soap-entry-commit-surface-adapters.ts');
const { headlessSoapEntryCommitService } = await import('./headless-soap-entry-commit-production.ts');

const USERNAME = 'synthetic-h10-operator';
const PIN = '2468';
const PATIENT_ID = 'synthetic-h10-patient';
const AMBULATORY_ID = 'synthetic-h10-ambulatory';

function closed<Value extends Record<string, unknown>>(value: Value): Readonly<Value> {
    return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<Value>;
}

function responseCookie(response: Response, name: string): string {
    const values = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
    const cookie = values.find((value) => value.startsWith(`${name}=`));
    assert.ok(cookie);
    return cookie.slice(name.length + 1).split(';', 1)[0]!;
}

const control = bootstrapWebAuthControl(null);
assert.ok(control);
const setupResponse = await setup(new Request('http://127.0.0.1/api/auth/setup', {
    method: 'POST',
    headers: {
        'content-type': 'application/json',
        cookie: `mediflow_auth_control=${control.controlId}`,
        'if-match': `"${control.etag}"`,
        'idempotency-key': randomUUID(),
    },
    body: JSON.stringify({
        username: USERNAME, password: PIN, encryptedMasterKey: 'synthetic-wrapped-key',
        salt: 'synthetic-salt', displayName: 'Synthetic H10', ambulatoryName: 'Synthetic H10',
    }),
}));
assert.equal(setupResponse.status, 200);
const sessionId = responseCookie(setupResponse, 'mediflow_session');

const requestCookies = RequestCookiesAdapter.seal(new RequestCookies(new Headers({
    cookie: `mediflow_session=${sessionId}; mediflow_auth_control=${control.controlId}`,
})));
const requestStore = {
    type: 'request', phase: 'render', cookies: requestCookies,
    asyncApiPromises: { cookies: Promise.resolve(requestCookies) },
};
const workStore = { route: '/h10-evidence', page: '/h10-evidence/page', isStaticGeneration: false };
function inRequest<Value>(operation: () => Promise<Value>): Promise<Value> {
    return workAsyncStorage.run(workStore as never,
        () => workUnitAsyncStorage.run(requestStore as never, operation));
}

await dbServer.insert(ambulatories).values({ id: AMBULATORY_ID, name: 'Synthetic H10', version: 1 }).run();
await dbServer.insert(patients).values({
    id: PATIENT_ID, firstName: 'Synthetic', lastName: 'Evidence', taxCode: 'SYNTHETIC-H10',
    version: 1, ambulatoryId: AMBULATORY_ID,
}).run();
await dbServer.insert(patientsToAmbulatories).values({ patientId: PATIENT_ID, ambulatoryId: AMBULATORY_ID }).run();
const attestation = await inRequest(() => enrollHeadlessSoapActiveRoleAttestation(PIN));
assert.equal((attestation as { status?: unknown }).status, 'active');

const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const sealOwner = createClinicianSoapEntrySealOwner({
    readAuthority: () => ({ key, generation: 1 }),
    crypto: {
        subtle: webcrypto.subtle as SubtleCrypto,
        getRandomValues(target) { webcrypto.getRandomValues(target); return target; },
    },
});
let selectionEpoch = 0;
let draftIndex = 0;

async function select() {
    const selection = await issueAuthenticatedWebSessionSelection({
        expectedEpoch: selectionEpoch, patientId: PATIENT_ID, ambulatoryId: AMBULATORY_ID,
    });
    selectionEpoch = selection.selectionEpoch;
    return selection;
}

async function authorize() {
    draftIndex += 1;
    await select();
    const accepted = validateClinicianSoapWriteDraft(closed({
        schema: 'mediflow.soap-draft.v1', operationId: 'mediflow.clinical_diary.append_soap.v1',
        subjective: `Synthetic H10 ${draftIndex}`, objective: '', assessment: '', plan: '',
    }));
    assert.equal(accepted.status, 'accepted');
    if (accepted.status !== 'accepted') throw new Error('H1 fixture denied');
    const lease = await headlessSoapChildSessionLeaseService.open();
    const inspectRef = await headlessSoapProposalLifecycleService.inspect(lease, accepted);
    const previewRef = await headlessSoapProposalLifecycleService.preview(inspectRef);
    const proposalRef = await headlessSoapProposalLifecycleService.proposal(previewRef);
    const entryRef = await headlessSoapEntryFieldSetLifecycleService.materialize(proposalRef);
    const handoff = await presentationOwner.service.present(entryRef);
    const gesture = createClinicianSoapExplicitGestureOwner({
        correlationToken: handoff.correlationToken,
        seal: (fieldSet: unknown) => sealOwner.seal(fieldSet),
        reopen: (bundle: unknown, fieldSet: unknown) => sealOwner.reopen(bundle, fieldSet),
        bindGestureSeal: (token: unknown, bundle: unknown) => presentationOwner.sealBindingController
            .bindGestureSeal(token, bundle),
        cancelPresentation: (token: unknown) => presentationOwner.service.cancel(token),
    });
    assert.equal((await gesture.prepare(handoff.fieldSet)).status, 'ready');
    assert.equal((await gesture.consumeExplicitGesture()).status, 'pin_required');
    const proof = await headlessSoapAuthorizationProofService.issue(handoff.correlationToken, PIN);
    const binding = await headlessSoapCommandBindingService.bind(proof.authorizationProof);
    const envelope = closed({
        approvalRef: binding.approvalRef, idempotencyKey: binding.idempotencyKey,
        authorizationProof: proof.authorizationProof,
    });
    return closed({ envelope, lease });
}

function counts(): readonly [number, number, number] {
    const count = (sql: string) => (sqlite.prepare(sql).get() as { value: number }).value;
    return [
        count("SELECT count(*) AS value FROM entries WHERE id GLOB 'hsei_*'"),
        count("SELECT count(*) AS value FROM audit_events WHERE event_type = 'entry.created' AND subject_ref GLOB 'hsei_*'"),
        count('SELECT count(*) AS value FROM headless_soap_entry_commits'),
    ];
}

function hasCode(code: string): (error: unknown) => boolean {
    return (error) => error instanceof Error
        && (error as Error & { code?: unknown }).code === code
        && error.message === `Headless SOAP entry commit rejected: ${code}`;
}

function receiptBytes(result: Readonly<{ receipt: object }>): string {
    return JSON.stringify(result.receipt);
}

test('H10 integrates the exact H1-H8 production composition', async (t) => {
    await t.test('1 Denial: malformed, foreign, and stale inputs write nothing', async () => {
        const malformedDraft = validateClinicianSoapWriteDraft(closed({
            schema: 'mediflow.soap-draft.v1', operationId: 'mediflow.clinical_diary.append_soap.v1',
            subjective: 'Synthetic denial', objective: '', assessment: '', plan: '', extra: true,
        }));
        assert.deepEqual({ ...malformedDraft }, { status: 'denied', code: 'invalid_input' });
        const live = await inRequest(authorize);
        const before = counts();
        for (const [candidate, code] of [
            [closed({ ...live.envelope, extra: true }), 'envelope_unavailable'],
            [closed({ ...live.envelope, authorizationProof: 'malformed' }), 'envelope_unavailable'],
            [closed({ ...live.envelope, approvalRef: `hsaa_${'0'.repeat(64)}` }), 'approval_unavailable'],
            [closed({ ...live.envelope, authorizationProof: `hsap_${'0'.repeat(64)}` }), 'approval_unavailable'],
        ] as const) {
            await assert.rejects(inRequest(() => headlessSoapEntryCommitWebAdapter.execute(candidate)), hasCode(code));
        }
        assert.deepEqual(counts(), before);
        await inRequest(() => headlessSoapEntryCommitWebAdapter.execute(live.envelope));
        const stale = await inRequest(authorize);
        await inRequest(select);
        const staleBefore = counts();
        await assert.rejects(inRequest(() => headlessSoapEntryCommitWebAdapter.execute(stale.envelope)),
            hasCode('approval_unavailable'));
        assert.deepEqual(counts(), staleBefore);
        await assert.rejects(headlessSoapChildSessionLeaseService.recheck(stale.lease),
            (error: unknown) => error instanceof Error
                && (error as Error & { code?: unknown }).code === 'lease_unavailable'
                && error.message === 'Headless SOAP child session lease rejected: lease_unavailable');
    });

    await t.test('2 Race: Web and chat materialize one byte-identical receipt', async () => {
        const { envelope } = await inRequest(authorize);
        const before = counts();
        const settled = await Promise.allSettled([
            inRequest(() => headlessSoapEntryCommitWebAdapter.execute(envelope)),
            inRequest(() => headlessSoapEntryCommitChatAdapter.execute(envelope)),
        ]);
        const observed: string[] = [];
        for (const outcome of settled) {
            if (outcome.status === 'fulfilled') observed.push(receiptBytes(outcome.value));
            else assert.equal(hasCode('approval_unavailable')(outcome.reason)
                || hasCode('lifecycle_unavailable')(outcome.reason), true);
        }
        const replay = await inRequest(() => headlessSoapEntryCommitWebAdapter.execute(envelope));
        observed.push(receiptBytes(replay));
        assert.ok(observed.length >= 2);
        assert.equal(new Set(observed).size, 1);
        assert.deepEqual(counts().map((value, index) => value - before[index]!), [1, 1, 1]);
    });

    await t.test('3 Rollback: ledger abort rolls back and spends the authority', async () => {
        const { envelope } = await inRequest(authorize);
        const before = counts();
        sqlite.exec(`CREATE TRIGGER h10_abort_ledger BEFORE INSERT ON headless_soap_entry_commits
            BEGIN SELECT RAISE(ABORT, 'synthetic H10 rollback'); END`);
        try {
            await assert.rejects(inRequest(() => headlessSoapEntryCommitWebAdapter.execute(envelope)),
                hasCode('storage_unavailable'));
        } finally {
            sqlite.exec('DROP TRIGGER h10_abort_ledger');
        }
        assert.deepEqual(counts(), before);
        await assert.rejects(inRequest(() => headlessSoapEntryCommitWebAdapter.execute(envelope)),
            hasCode('approval_unavailable'));
        assert.deepEqual(counts(), before);
    });

    await t.test('4 Replay: reselection cannot alter the durable receipt', async () => {
        const { envelope } = await inRequest(authorize);
        const first = await inRequest(() => headlessSoapEntryCommitWebAdapter.execute(envelope));
        await inRequest(select);
        const before = counts();
        const replay = await inRequest(() => headlessSoapEntryCommitChatAdapter.execute(envelope));
        assert.equal(receiptBytes(replay), receiptBytes(first));
        assert.deepEqual(counts(), before);
    });

    await t.test('5 Conflict: foreign authority stays usable and durable tamper is denied', async () => {
        const a = await inRequest(authorize);
        const committedA = await inRequest(() => headlessSoapEntryCommitWebAdapter.execute(a.envelope));
        const b = await inRequest(authorize);
        const approvalConflict = closed({ approvalRef: b.envelope.approvalRef,
            idempotencyKey: a.envelope.idempotencyKey, authorizationProof: a.envelope.authorizationProof });
        const proofConflict = closed({ approvalRef: a.envelope.approvalRef,
            idempotencyKey: a.envelope.idempotencyKey, authorizationProof: b.envelope.authorizationProof });
        const before = counts();
        for (const candidate of [approvalConflict, proofConflict]) {
            await assert.rejects(inRequest(() => headlessSoapEntryCommitChatAdapter.execute(candidate)),
                hasCode('idempotency_conflict'));
        }
        assert.deepEqual(counts(), before);
        assert.equal(receiptBytes(await inRequest(() => headlessSoapEntryCommitWebAdapter.execute(a.envelope))),
            receiptBytes(committedA));
        const committedB = await inRequest(() => headlessSoapEntryCommitWebAdapter.execute(b.envelope));
        assert.deepEqual(counts().map((value, index) => value - before[index]!), [1, 1, 1]);
        for (const column of ['binding_snapshot', 'receipt_snapshot'] as const) {
            const original = sqlite.prepare(`SELECT ${column} AS value FROM headless_soap_entry_commits
                WHERE idempotency_key = ?`).get(b.envelope.idempotencyKey) as { value: string };
            sqlite.prepare(`UPDATE headless_soap_entry_commits SET ${column} = '{}' WHERE idempotency_key = ?`)
                .run(b.envelope.idempotencyKey);
            await assert.rejects(inRequest(() => headlessSoapEntryCommitChatAdapter.execute(b.envelope)),
                hasCode('receipt_unavailable'));
            sqlite.prepare(`UPDATE headless_soap_entry_commits SET ${column} = ? WHERE idempotency_key = ?`)
                .run(original.value, b.envelope.idempotencyKey);
        }
        assert.equal(receiptBytes(await inRequest(() => headlessSoapEntryCommitWebAdapter.execute(b.envelope))),
            receiptBytes(committedB));
    });

    await t.test('6 Authority union: aliases stay closed and Mini stays unbound', async () => {
        assert.equal(headlessSoapEntryCommitWebAdapter, headlessSoapEntryCommitChatAdapter);
        assert.equal(headlessSoapEntryCommitWebAdapter, headlessSoapEntryCommitService);
        const source = await inRequest(authorize);
        const receipt = (await inRequest(() => headlessSoapEntryCommitService.execute(source.envelope))).receipt;
        const candidate = await inRequest(authorize);
        const draftDto = closed({ schema: 'mediflow.soap-draft.v1',
            operationId: 'mediflow.clinical_diary.append_soap.v1', subjective: 'Synthetic H9 DTO',
            objective: '', assessment: '', plan: '' });
        const fabricReceipt = closed({ schemaVersion: 'mediflow.patient-insight.host-receipt.v1',
            reference: 'receipt_synthetic_h10', capability: 'patient_insight', authority: 'host_service',
            writesPerformed: 0, applyPolicy: 'none' });
        const union = closed({
            approvalRef: candidate.envelope.approvalRef, idempotencyKey: candidate.envelope.idempotencyKey,
            authorizationProof: candidate.envelope.authorizationProof, receipt,
            provider: 'synthetic-local', venue: 'synthetic-host', miniCommandId: 'draft preview',
            patientId: PATIENT_ID, operationId: 'mediflow.clinical_diary.append_soap.v1',
        });
        const before = counts();
        await assert.rejects(inRequest(() => headlessSoapEntryCommitWebAdapter.execute(union)),
            hasCode('envelope_unavailable'));
        for (const substitute of [draftDto, receipt, fabricReceipt, setup, headlessSoapEntryCommitWebAdapter]) {
            await assert.rejects(inRequest(() => headlessSoapEntryCommitChatAdapter.execute(substitute)),
                hasCode('envelope_unavailable'));
        }
        assert.deepEqual(counts(), before);
        const mini = spawnSync(process.execPath, [
            '--experimental-strip-types', '--import', path.join(root, 'scripts/register-strip-types-loader.mjs'),
            path.join(root, 'packages/mini/src/cli.ts'),
        ], { input: '{"command":"status","args":{}}', encoding: 'utf8', timeout: 5_000 });
        assert.equal(mini.status, 69);
        assert.equal(mini.stderr, '');
        assert.equal(mini.stdout, '{"schemaVersion":"mediflow.mini.transport.v1","ok":false,"error":{"code":"TRANSPORT_UNBOUND"}}\n');
        await inRequest(() => headlessSoapEntryCommitService.execute(candidate.envelope));
        assert.deepEqual(counts().map((value, index) => value - before[index]!), [1, 1, 1]);
    });
});

test.after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});
