import { randomBytes } from 'node:crypto';
import { LOCAL_OPERATION_SCHEMA, localOperationInputSchema, type LocalOperationResult } from '../../packages/mcp/src/local-operation-contract.ts';
import type { createLocalOperationService, LocalCapability } from './service.ts';

/** The authenticated host creates one binding per child. Only binding.remote is passed to MCP/AIP. */
export function createLocalOperationRemoteHost(ports: {
    service: ReturnType<typeof createLocalOperationService>;
    currentSessionBinding(): string | null;
    requestOpen(): Promise<void>;
    requestResume(capability: LocalCapability): Promise<void>;
    now(): number;
}) {
    const session = ports.currentSessionBinding();
    const refs = new Map<string, LocalCapability>();
    let selectedRef: string | null = null;
    let closed = false, requests = 0, lastRequest = -Infinity;
    const available = () => !closed && !!session && ports.currentSessionBinding() === session;
    const result = (status: LocalOperationResult['status'], ref?: string): LocalOperationResult => ({ schema: LOCAL_OPERATION_SCHEMA, status, ...(ref ? { ref } : {}) });
    return Object.freeze({
        publish(capability: LocalCapability) {
            if (!available() || refs.size >= 16) throw new Error('denied');
            ports.service.publicStatus(capability);
            const ref = `lo_${randomBytes(16).toString('hex')}`;
            refs.set(ref, capability); selectedRef = ref; return ref;
        },
        remote: Object.freeze({
            close() { closed = true; refs.clear(); selectedRef = null; },
            async request(input: unknown): Promise<LocalOperationResult> {
                const parsed = localOperationInputSchema.safeParse(input);
                if (!available() || !parsed.success || ++requests > 32 || ports.now() - lastRequest < 250) return result('unavailable');
                lastRequest = ports.now();
                try {
                    if (parsed.data.action === 'open') {
                        await ports.requestOpen();
                        if (!available()) return result('unavailable');
                        if (selectedRef) {
                            const capability = refs.get(selectedRef);
                            if (capability) {
                                try { ports.service.publicStatus(capability); return result('continue_in_mediflow', selectedRef); }
                                catch { refs.delete(selectedRef); selectedRef = null; }
                            }
                        }
                        return result('continue_in_mediflow');
                    }
                    const { ref } = parsed.data;
                    const capability = refs.get(ref);
                    if (!capability) return result('unavailable');
                    ports.service.publicStatus(capability);
                    if (parsed.data.action === 'resume') await ports.requestResume(capability);
                    if (!available()) return result('unavailable');
                    const status = ports.service.publicStatus(capability);
                    return result(parsed.data.action === 'resume' ? 'continue_in_mediflow' : status, ref);
                } catch { return result('unavailable'); }
            },
        }),
    });
}
