/* @Codex: invented test identities, issued by the real in-process lifecycle owner. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bootstrapControl, begin, issue, resolve } from '../../lib/security/web-auth-lifecycle-owner-adapter';

export function syntheticExemptionSession() {
    const control = bootstrapControl();
    assert.ok(control);
    const attempt = begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: randomUUID() });
    assert.ok(attempt);
    const issued = issue(attempt, { id: `synthetic-exemption-${randomUUID()}`, username: 'synthetic-exemption-operator', role: 'admin' });
    assert.ok(issued);
    const resolution = resolve(issued.sessionId, control.controlId);
    assert.equal(resolution.status, 'active');
    if (resolution.status !== 'active') throw new Error('Synthetic session unavailable');
    return resolution.projection;
}
