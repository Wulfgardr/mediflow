import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiFunctionUnavailableError } from '../../ai-function-availability.ts';
import { createTreatmentReasoningProductionService, createTreatmentReasoningPortableProductionService } from './treatment-reasoning-production-operation.ts';
import { createTreatmentReasoningChatGptService } from './treatment-reasoning-chatgpt-production.ts';

for (const [name, factory] of [
    ['ATHENA / MLX', createTreatmentReasoningProductionService],
    ['ATHENA portabile', createTreatmentReasoningPortableProductionService],
    ['ChatGPT', createTreatmentReasoningChatGptService],
] as const) test(`${name}: saved enabled and available model cannot acquire execution or consume context`, async () => {
    const calls: string[] = [];
    const service = factory({
        projectionBroker: { acquirePreview: async () => { calls.push('projection'); throw new Error('unexpected projection'); } },
        killSwitch: { read: async () => ({ status: 'enabled' }) },
        lifecycle: { read: () => ({ status: 'available', record: { version: 1, lifecycle: { status: 'available_unqualified', provider: 'athena_mlx', credentialClass: 'local_model' } } }) },
        runtime: { available: () => true, invoke: async () => { calls.push('local or remote invocation'); return ''; } },
        prepare: async () => { calls.push('model startup'); throw new Error('unexpected startup'); },
        entropy: () => new Uint8Array(32),
    } as never);
    await assert.rejects(service.acquirePreview(), (error: unknown) => error instanceof AiFunctionUnavailableError && error.code === 'treatment_reasoning_unavailable_in_release');
    assert.deepEqual(calls, []);
});

test('ingest keeps its authenticated projection contract without executing a model', async () => {
    let ingests = 0;
    const operation = { ingest: () => { ingests++; return 'synthetic-handle'; } };
    const service = createTreatmentReasoningProductionService({ projectionBroker: { acquireIngest: async () => operation } } as never);
    assert.equal(await service.acquireIngest(), operation); assert.equal(ingests, 0);
});
