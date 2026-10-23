import { AIP_OPERATION_RPC_ENV_KEY_V1 } from '../../aip/src/child-ipc-contract.ts';
import { LOCAL_OPERATION_DESCRIPTOR, LOCAL_OPERATION_RPC_MODE, LOCAL_OPERATION_SCHEMA,
    localOperationInputSchema, localOperationResultSchema, type LocalOperationInput, type LocalOperationResult } from './local-operation-contract.ts';

export function createLocalOperationIpcClient() {
    let closed = process.env[AIP_OPERATION_RPC_ENV_KEY_V1] !== LOCAL_OPERATION_RPC_MODE || !process.connected;
    let sequence = 0;
    const unavailable = (): LocalOperationResult => ({ schema: LOCAL_OPERATION_SCHEMA, status: 'unavailable' });
    const pending = new Map<string, (value: LocalOperationResult) => void>();
    const close = () => {
        closed = true;
        for (const finish of [...pending.values()]) finish(unavailable());
        process.off('message', onMessage); process.off('disconnect', close);
    };
    const onMessage = (frame: unknown) => {
        if (typeof frame !== 'string' || Buffer.byteLength(frame) > 4096) return close();
        try {
            const response = JSON.parse(frame);
            const finish = pending.get(response.requestId);
            if (!finish) return;
            const result = localOperationResultSchema.safeParse(response.result?.value);
            if (response.schemaVersion !== 'mediflow.aip.operation.result.v1' || response.outcome !== 'completed'
                || JSON.stringify(response.result?.operation) !== JSON.stringify(LOCAL_OPERATION_DESCRIPTOR) || !result.success) finish(unavailable());
            else finish(result.data);
        } catch { close(); }
    };
    process.on('message', onMessage); process.once('disconnect', close);
    return Object.freeze({ close, request(input: LocalOperationInput): Promise<LocalOperationResult> {
        const parsed = localOperationInputSchema.safeParse(input);
        if (closed || !parsed.success || sequence >= 64 || pending.size) return Promise.resolve(unavailable());
        const requestId = `rpc_lo_${++sequence}`;
        return new Promise(resolve => {
            const timer = setTimeout(() => finish(unavailable()), 5_000);
            const finish = (result: LocalOperationResult) => {
                if (!pending.delete(requestId)) return;
                clearTimeout(timer); resolve(result);
            };
            pending.set(requestId, finish);
            try { process.send!(JSON.stringify({ schemaVersion: 'mediflow.aip.operation.request.v1', method: 'call',
                requestId, operationId: LOCAL_OPERATION_DESCRIPTOR.operationId, input: parsed.data }),
            undefined, undefined, (error: Error | null) => { if (error) finish(unavailable()); }); }
            catch { finish(unavailable()); }
        });
    } });
}
