/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { registerTreatmentReasoningProductionResource } from './treatment-reasoning-production-root.ts';

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const requireFromHere = createRequire(import.meta.url);
const webOwner = requireFromHere('@mediflow/web-auth-lifecycle-owner') as Record<string, (...args: unknown[]) => unknown>;

function issueP3Session() {
    const control = webOwner.bootstrapControl() as { controlId: string; etag: string } | null;
    assert.ok(control);
    const attempt = webOwner.begin('login', {
        controlId: control.controlId,
        ifMatch: control.etag,
        idempotencyKey: 'synthetic-treatment-reasoning-p3-login',
    });
    assert.ok(attempt);
    const issued = webOwner.issue(attempt, {
        id: 'user.synthetic.treatment-reasoning-p3',
        username: ['synthetic', 'treatment', 'reasoning', 'p3'].join('-'),
        role: 'clinician',
    }) as { sessionId: string; etag: string } | null;
    assert.ok(issued);
    const resolution = webOwner.resolve(issued.sessionId, control.controlId) as { status: string; projection?: Readonly<{ id: string }> };
    assert.equal(resolution.status, 'active');
    assert.ok(resolution.projection);
    return { control, issued, projection: resolution.projection };
}

test('roots Treatment Reasoning in authenticated selection, scoped revision, ATHENA lifecycle, and local runtime', () => {
    const root = source('./treatment-reasoning-production-root.ts');
    assert.match(root, /^import 'server-only';/u);
    for (const required of [
        'createTreatmentReasoningAuthenticatedProjectionBroker',
        'acquireOrdinaryApplicationContext',
        'registerOrdinaryApplicationResource',
        'patientsToAmbulatories',
        "createHostProviderLifecycleService({ provider: 'athena_mlx' })",
        'isAthenaMlxModelAvailable',
        'generateWithAthenaMlx',
        'AI_TREATMENT_REASONING_KILL_SWITCH_KEY',
        'createTreatmentReasoningProductionService',
    ]) assert.match(root, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.doesNotMatch(root, /requireSession|generatePatientTreatmentReasoningDraft|callerPrompt|providerChoice|fetch\(|apply|persist/u);
});

test('binds the Treatment Reasoning broker to the real P3 session lifecycle', () => {
    const { control, issued, projection } = issueP3Session();
    let legacyDisposals = 0;
    const legacyRegistration = (webOwner.serverSessions as unknown as Record<string, (...args: unknown[]) => unknown>)
        .registerServerSessionResource(projection.id, () => { legacyDisposals += 1; });
    assert.equal(legacyRegistration, null, 'a P3 session must not enter the legacy server-session registry');

    let disposals = 0;
    const unregister = registerTreatmentReasoningProductionResource(
        { session: projection, owner: Object.freeze(Object.create(null)) } as never,
        () => { disposals += 1; },
    );
    assert.ok(unregister);
    const retired = webOwner.retire(projection, 'lock', {
        controlId: control.controlId,
        ifMatch: issued.etag,
        idempotencyKey: 'synthetic-treatment-reasoning-p3-lock',
    }) as { outcome: string };
    assert.equal(retired.outcome, 'completed');
    assert.equal(disposals, 1);
    unregister();
    assert.equal(disposals, 1, 'cleanup after retirement must remain exactly once');
    assert.equal(legacyDisposals, 0);

    const root = source('./treatment-reasoning-production-root.ts');
    assert.match(root, /mintResourcePort/u, 'production must bind the broker through the P3 resource owner');
    assert.match(root, /registerPrivateResource/u);
    assert.match(root, /releaseResourcePort/u);
    assert.match(root, /context\.session\.authChannel !== 'web'/u);
    assert.match(root, /registerOrdinaryApplicationResource\(context\.session\.id, dispose\)/u);
    assert.match(root, /registerResource: registerTreatmentReasoningProductionResource/u);
});

test('exposes only the new authenticated ingest and preview routes', () => {
    const ingest = source('../../../app/api/ai/treatment-reasoning/ingest/route.ts');
    const preview = source('../../../app/api/ai/treatment-reasoning/preview/route.ts');
    assert.match(ingest, /createTreatmentReasoningIngestHttpHandler/u);
    assert.match(preview, /createTreatmentReasoningPreviewHttpHandler/u);
    assert.match(`${ingest}\n${preview}`, /treatment-reasoning-production-root/u);
    assert.doesNotMatch(`${ingest}\n${preview}`, /request\.json|requireSession|generateWithAthenaMlx|prompt|\bprovider\b|apply/u);
});
