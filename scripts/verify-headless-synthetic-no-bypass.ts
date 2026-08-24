/* @Codex */
import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { createHeadlessSemanticOrchestrator, type HeadlessSemanticRequest } from '../lib/headless-semantic-orchestrator';
import { MINI_EXIT, MINI_STDIN_MAX_BYTES, parseMiniTransport, renderMiniTransport, runMiniTransport } from '../packages/mini/src/cli';
import { adaptMiniTransportToHeadlessRequest } from '../packages/mini/src/headless-intent-adapter';

type Scenario = 'stable' | 'revoked' | 'denied' | 'lease_drift' | 'mutation_drift'
    | 'bad_service' | 'bad_capability' | 'bad_fabric' | 'reentered';

export const HEADLESS_P6_SOURCE_DIGEST = '768c6f8eb430e02ca5882a5befd5769ac1bc026c00671fcfe7bd911e957319e1';
const SOURCE_SHA = '67204eb18e766553c8bc7d01368a10d2da9e1c76';
const SOURCE_BLOBS = Object.freeze([
    Object.freeze({ path: 'packages/mini/src/cli.ts', gitBlob: '4dbbe7727a92ceaf6f213e997c28c35db4dde3e0', sha256: '1230d0dc148b0ef7bc1ae97ca2534a77640e791f9f0ddf47f5d46755b93502d2' }),
    Object.freeze({ path: 'packages/mini/src/headless-intent-adapter.ts', gitBlob: '8474b5402402e2d656ab1b0635bc1d12553512c6', sha256: '1a7e421aae6a4b60726c82a005e4c40c7f9a285d56454b3641033005d5e13de6' }),
    Object.freeze({ path: 'lib/headless-semantic-orchestrator.ts', gitBlob: '13c11bc8a8b8c9be4be2b428a15ed734a04dac5c', sha256: '1271ab2d529df310455293a3b79d69ce34ec44a88a045cf06eabe8b691ccfd22' }),
]);
const SOURCE_BASIS = [SOURCE_SHA, ...SOURCE_BLOBS.map((file) => `${file.path}:${file.gitBlob}:${file.sha256}`)].join('\n');
const SCENARIOS = new Set<Scenario>(['stable', 'revoked', 'denied', 'lease_drift', 'mutation_drift', 'bad_service', 'bad_capability', 'bad_fabric', 'reentered']);

export class HeadlessSyntheticNoBypassError extends Error {
    constructor(readonly code: string) { super(code); this.name = 'HeadlessSyntheticNoBypassError'; }
}
function fail(code: string): never { throw new HeadlessSyntheticNoBypassError(code); }

function denseStrings(value: unknown): readonly string[] {
    if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('transport_invalid');
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const length = descriptors.length;
    if (!length || !('value' in length) || !Number.isSafeInteger(length.value) || length.value < 0
        || Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') || Object.keys(descriptors).length !== length.value + 1) fail('transport_invalid');
    const result: string[] = [];
    for (let index = 0; index < length.value; index += 1) {
        const item = descriptors[String(index)];
        if (!item || !item.enumerable || !('value' in item) || typeof item.value !== 'string') fail('transport_invalid');
        result.push(item.value);
    }
    return Object.freeze(result);
}

export function createHeadlessSyntheticNoBypassHarness(scenario: Scenario = 'stable') {
    if (!SCENARIOS.has(scenario)) fail('scenario_invalid');
    if (createHash('sha256').update(SOURCE_BASIS).digest('hex') !== HEADLESS_P6_SOURCE_DIGEST) fail('source_basis_invalid');
    let executions = 0; let leaseEpoch = 7; let mutationEpoch = 11; let runner: ReturnType<typeof createHeadlessSemanticOrchestrator> | undefined;
    let activeRequest: HeadlessSemanticRequest | undefined;
    const context = () => ({
        sessionRef: 'ses_opaque0001', activeRole: 'role_clinician', leaseEpoch, mutationEpoch,
        revoked: scenario === 'revoked', maxOperations: 1,
    });
    const operation = {
        operationId: 'op.fixture.read', capabilityId: scenario === 'bad_capability' ? 'web-99' : 'web-01',
        applicationServiceRef: scenario === 'bad_service' ? 'rest:web-01' : 'appsvc:web-01', maximumStage: 'read' as const,
        fabricDependency: scenario === 'bad_fabric' ? 'fabric:provider@28a1a36b162f' : null, inputKeys: ['subjectRef'],
        execute: () => {
            executions += 1;
            if (scenario === 'lease_drift') leaseEpoch += 1;
            if (scenario === 'mutation_drift') mutationEpoch += 1;
            if (scenario === 'reentered') { try { runner!.run(activeRequest!); } catch { /* hostile service swallows */ } }
            return { outcome: 'read', response: 'synthetic-response: fixture ready' };
        },
    };
    const ensureRunner = () => runner ??= createHeadlessSemanticOrchestrator({
        acquireContext: context,
        plan: () => ({ operationId: 'op.fixture.read', input: { subjectRef: 'subject_opaque0001' } }),
        authorize: () => scenario === 'denied'
            ? ({ allowed: false, policyDecision: 'per_operation_deny' }) : ({ allowed: true, policyDecision: 'per_operation_allow' }),
        registry: [operation], clock: () => '2026-08-24T08:00:00.000Z', entropy: () => 'act_0123456789abcdef0123456789abcdef',
    });

    return Object.freeze({
        executionCount: () => executions,
        run(rawArgv: readonly string[], rawStdin: string) {
            const argv = denseStrings(rawArgv);
            if (typeof rawStdin !== 'string' || Buffer.byteLength(rawStdin, 'utf8') > MINI_STDIN_MAX_BYTES) fail('transport_invalid');
            const publicResult = runMiniTransport(argv, rawStdin);
            let publicState: unknown;
            try { publicState = JSON.parse(publicResult.stdout); } catch { fail('transport_binding_changed'); }
            if (publicResult.exitCode !== MINI_EXIT.BROKER_UNAVAILABLE || publicResult.stderr !== ''
                || !publicState || typeof publicState !== 'object' || (publicState as { error?: unknown }).error !== 'TRANSPORT_UNBOUND') fail('transport_binding_changed');
            const transport = parseMiniTransport(argv, rawStdin); if (!transport) fail('transport_invalid');
            const request = adaptMiniTransportToHeadlessRequest(transport); activeRequest = request;
            const result = ensureRunner().run(request);
            const receipt = Object.freeze({
                schemaVersion: 'mediflow.headless.synthetic-no-bypass-receipt.v1', headlessSourceSha: SOURCE_SHA,
                sourceDigest: HEADLESS_P6_SOURCE_DIGEST, sourceBlobs: SOURCE_BLOBS, transportState: 'TRANSPORT_UNBOUND',
                adapterKind: request.adapterKind, requestRef: result.receipt.requestRef, actionRef: result.receipt.actionRef,
                capabilityId: result.receipt.capabilityId, applicationServiceRef: 'appsvc:web-01', fabricDependency: null,
                outcome: result.receipt.outcome, policyDecision: result.receipt.policyDecision,
                revisionBinding: result.receipt.revisionBinding, createdAt: result.receipt.createdAt,
                writesPerformed: result.writesPerformed, applyPolicy: result.applyPolicy,
                claimCeiling: 'Candidate synthetic evidence only; not operational, integrated, release-ready, or released.',
            });
            const rendered = renderMiniTransport(receipt, transport.format);
            try { if (JSON.stringify(JSON.parse(rendered)) !== JSON.stringify(receipt)) fail('receipt_render_invalid'); }
            catch (error) { if (error instanceof HeadlessSyntheticNoBypassError) throw error; fail('receipt_render_invalid'); }
            return receipt;
        },
    });
}
