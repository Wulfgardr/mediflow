/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSyntheticTrustedAgentService, type AgentServiceResult } from './trusted-service';

const request = (command: string, args: Record<string, unknown> = {}, requestId = `request-${command}`) => ({
    credential: 'synthetic-agent-credential', requestId, command, args,
});
function denial(result: AgentServiceResult): string {
    assert.equal(result.ok, false);
    return result.ok ? 'unexpected-success' : result.error;
}

test('espone il contratto sintetico read-only con receipt PHI-safe', () => {
    const service = createSyntheticTrustedAgentService();
    const result = service.execute(request('open-loops', { patientRef: 'synthetic-patient-001' }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal((result.data as { items: unknown[] }).items.length, 1);
    const receipt = JSON.stringify(result.receipt);
    assert.equal(receipt.includes('Paziente Sintetico'), false);
    assert.equal(receipt.includes('synthetic-patient-001'), false);
    assert.equal(receipt.includes('synthetic-agent-credential'), false);
});

test('rifiuta authority caller-supplied, proprietà ereditate e replay', () => {
    const service = createSyntheticTrustedAgentService();
    assert.equal(denial(service.execute({ ...request('whoami'), session: { revocationState: 'active' } })), 'REQUEST_INVALID');
    assert.equal(denial(service.execute({ ...request('whoami'), now: 0 })), 'REQUEST_INVALID');
    const inherited = Object.assign(Object.create({ lease: { patientRef: 'forged' } }), request('whoami'));
    assert.equal(denial(service.execute(inherited)), 'REQUEST_INVALID');
    let getterRead = false;
    const accessor = request('whoami');
    Object.defineProperty(accessor, 'credential', { enumerable: true, get: () => { getterRead = true; return 'synthetic-agent-credential'; } });
    assert.equal(denial(service.execute(accessor)), 'REQUEST_INVALID');
    assert.equal(getterRead, false);
    assert.equal(service.execute(request('whoami', {}, 'replay')).ok, true);
    assert.equal(denial(service.execute(request('whoami', {}, 'replay'))), 'REQUEST_REPLAYED');
});

test('nega credential, cross-patient e apply', () => {
    const service = createSyntheticTrustedAgentService();
    assert.equal(denial(service.execute({ ...request('whoami'), credential: 'local-api-token' })), 'CREDENTIAL_INVALID');
    assert.equal(denial(service.execute(request('open-loops', { patientRef: 'synthetic-patient-other' }))), 'PATIENT_MISMATCH');
    assert.equal(denial(service.execute(request('apply', { patientRef: 'synthetic-patient-001' }))), 'APPLY_DENIED');
});

test('usa expiry e revoca broker-owned', () => {
    const base = createSyntheticTrustedAgentService();
    base.revoke();
    assert.equal(denial(base.execute(request('whoami'))), 'SESSION_REVOKED');

    const now = Date.parse('2026-08-21T12:00:00.000Z');
    const expired = createSyntheticTrustedAgentService(now, () => now + 300_000);
    assert.equal(denial(expired.execute(request('whoami'))), 'SESSION_EXPIRED');
});
