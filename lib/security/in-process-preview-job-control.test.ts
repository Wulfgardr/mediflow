/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createInProcessPreviewJobControl, type InProcessPreviewJobScope } from './in-process-preview-job-control.ts';

const SCOPE: InProcessPreviewJobScope = Object.freeze({ agentRef: 'agent_a', capabilityId: 'cap_preview', sessionRef: 'session_a', leaseRef: 'lease_a' });
const command = (key = 'key_a', digest = 'digest_a', scope: InProcessPreviewJobScope = SCOPE) => ({ scope, idempotencyKey: key, commandDigest: digest });
function subject() {
    let status: 'active' | 'expired' | 'revoked' = 'active'; let rate: 'allowed' | 'rate_limited' = 'allowed'; let now = 10; let refs = 0; const allowances: object[] = [];
    const controlled = createInProcessPreviewJobControl({ clock: () => now, jobRef: () => `job_${++refs}`, leaseGuard: { status: () => status }, rateLimitPolicy: { consume: (scope) => { allowances.push(scope); return rate; } } });
    return { jobs: controlled, allowances, setRate: (value: typeof rate) => { rate = value; }, setStatus: (value: typeof status) => { status = value; }, setNow: (value: number) => { now = value; } };
}
async function rejects(action: () => unknown, code: string) { await assert.rejects(async () => action(), (error: unknown) => error instanceof Error && (error as { code?: string }).code === code); }

test('creates an opaque queued job at revision zero', () => {
    const jobs = createInProcessPreviewJobControl({ clock: () => 10, jobRef: () => 'job_synthetic', leaseGuard: { status: () => 'active' }, rateLimitPolicy: { consume: () => 'allowed' } });
    assert.deepEqual(jobs.submit({ scope: { agentRef: 'agent_a', capabilityId: 'cap_preview', sessionRef: 'session_a', leaseRef: 'lease_a' }, idempotencyKey: 'key_a', commandDigest: 'digest_a' }), { jobRef: 'job_synthetic', revision: 0, state: 'queued' });
});

test('expires a job as a terminal expected-revision transition', () => {
    const current = subject(); const created = current.jobs.submit(command());
    assert.deepEqual(current.jobs.expire({ jobRef: created.jobRef, expectedRevision: 0 }), { jobRef: created.jobRef, revision: 1, state: 'expired' });
});

test('replays an identical submission without a new allowance and fences key conflicts', async () => {
    const current = subject(); const first = current.jobs.submit(command()); const replay = current.jobs.submit(command());
    assert.deepEqual(replay, first); assert.equal(current.allowances.length, 1); await rejects(() => current.jobs.submit(command('key_a', 'digest_b')), 'idempotency_conflict'); await rejects(() => current.jobs.submit(command('key_a', 'digest_a', { ...SCOPE, sessionRef: 'session_b' })), 'idempotency_conflict');
    assert.equal(current.allowances.length, 1);
});

test('keeps stale revisions immutable and makes cancellation and terminal states final', async () => {
    const current = subject(); const queued = current.jobs.submit(command()); await rejects(() => current.jobs.start({ jobRef: queued.jobRef, expectedRevision: 1 }), 'revision_conflict');
    assert.deepEqual(current.jobs.cancel({ jobRef: queued.jobRef, expectedRevision: 0 }), { jobRef: queued.jobRef, revision: 1, state: 'cancelled' }); await rejects(() => current.jobs.start({ jobRef: queued.jobRef, expectedRevision: 1 }), 'job_terminal');
    const running = current.jobs.submit(command('key_b')); assert.equal(current.jobs.start({ jobRef: running.jobRef, expectedRevision: 0 }).state, 'running'); assert.equal(current.jobs.cancel({ jobRef: running.jobRef, expectedRevision: 1 }).state, 'cancelled');
    const completed = current.jobs.submit(command('key_c')); current.jobs.start({ jobRef: completed.jobRef, expectedRevision: 0 }); assert.equal(current.jobs.complete({ jobRef: completed.jobRef, expectedRevision: 1 }).state, 'completed'); await rejects(() => current.jobs.fail({ jobRef: completed.jobRef, expectedRevision: 2 }), 'job_terminal'); const failed = current.jobs.submit(command('key_d')); current.jobs.start({ jobRef: failed.jobRef, expectedRevision: 0 }); assert.equal(current.jobs.fail({ jobRef: failed.jobRef, expectedRevision: 1 }).state, 'failed');
});

test('denies expired or revoked leases before any submit or later mutation', async () => {
    const current = subject(); current.setStatus('expired'); await rejects(() => current.jobs.submit(command()), 'lease_expired'); assert.equal(current.allowances.length, 0);
    current.setStatus('active'); const expired = current.jobs.submit(command()); current.setStatus('expired'); await rejects(() => current.jobs.start({ jobRef: expired.jobRef, expectedRevision: 0 }), 'lease_expired'); current.setStatus('active'); assert.equal(current.jobs.start({ jobRef: expired.jobRef, expectedRevision: 0 }).state, 'running');
    const revoked = current.jobs.submit(command('key_b')); current.setStatus('revoked'); await rejects(() => current.jobs.start({ jobRef: revoked.jobRef, expectedRevision: 0 }), 'lease_revoked'); current.setStatus('active'); assert.equal(current.jobs.revoke({ jobRef: revoked.jobRef, expectedRevision: 0 }).state, 'revoked'); await rejects(() => current.jobs.cancel({ jobRef: revoked.jobRef, expectedRevision: 1 }), 'job_terminal');
});

test('rates every novel submit by exact agent capability and session only', async () => {
    const current = subject(); const scopes = [SCOPE, { ...SCOPE, agentRef: 'agent_b' }, { ...SCOPE, capabilityId: 'cap_other' }, { ...SCOPE, sessionRef: 'session_b' }];
    for (const [index, scope] of scopes.entries()) current.jobs.submit(command(`key_${index}`, `digest_${index}`, scope));
    assert.deepEqual(current.allowances, scopes.map(({ agentRef, capabilityId, sessionRef }) => ({ agentRef, capabilityId, sessionRef }))); assert.equal(current.allowances.every((scope) => !('leaseRef' in scope)), true);
    current.setRate('rate_limited'); await rejects(() => current.jobs.submit(command('key_rate')), 'rate_limited'); assert.equal(current.allowances.length, 5);
});

test('keeps the kernel closure-local and outside server, provider, route, and apply boundaries', () => {
    const source = readFileSync(new URL('./in-process-preview-job-control.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /server-only|node:|globalThis|fabric|provider|route|\.apply\(|setTimeout|setInterval|dispatch|invoke/iu);
});
