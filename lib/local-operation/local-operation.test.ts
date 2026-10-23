import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalOperationProtocol } from '../../packages/mcp/src/local-operation-server.ts';
import { localOperationResultSchema } from '../../packages/mcp/src/local-operation-contract.ts';

test('CU-1a: protocollo chiuso senza eco, canali laterali o approvazione remota', async () => {
    const protocol = createLocalOperationProtocol({ request: async () => ({ schema: 'mediflow.local-operation.v1', status: 'continue_in_mediflow' }) });
    const call = (id: unknown, args: unknown) => protocol.receive(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'mediflow.local_operation.v1', arguments: args } }));
    await protocol.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic', version: '1' } } }));
    const result = JSON.parse((await call(2, { action: 'open' }))!);
    assert.equal(result.result.structuredContent.status, 'continue_in_mediflow');
    assert.ok(localOperationResultSchema.safeParse(result.result.structuredContent).success);
    for (const input of [{ action: 'approve', approved: true }, { action: 'open', patientId: 'SENTINEL_IDENTITY' }, { action: 'status', ref: 'SENTINEL_CLINICAL' }]) {
        const wire = (await call(3, input))!;
        assert.ok(!wire.includes('SENTINEL'));
        assert.equal(JSON.parse(wire).error.message, 'MediFlow unavailable.');
    }
    const invalidId = (await call('SENTINEL_IDENTITY', { action: 'open' }))!;
    assert.equal(JSON.parse(invalidId).id, null);
    assert.ok(!invalidId.includes('SENTINEL'));
});
