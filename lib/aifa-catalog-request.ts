import { AifaUpdateError } from './aifa-catalog-lock';

export async function assertEmptyAifaRequestBody(request: Request, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!request.body) return;
    const reader = request.body.getReader();
    const invalid = () => new AifaUpdateError('La richiesta AIFA non accetta parametri o contenuti', 400);
    let rejectRead!: (reason: unknown) => void;
    const stopped = new Promise<never>((_resolve, reject) => { rejectRead = reject; });
    const cancel = () => rejectRead(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    const deadline = Date.now() + 1_000;
    const timer = setTimeout(() => rejectRead(invalid()), 1_000);
    try {
        for (let reads = 0; reads < 32; reads++) {
            signal.throwIfAborted();
            if (Date.now() >= deadline) throw invalid();
            const chunk = await Promise.race([reader.read(), stopped]);
            signal.throwIfAborted();
            if (Date.now() >= deadline) throw invalid();
            if (chunk.done) return;
            if (chunk.value.byteLength !== 0) throw invalid();
        }
        throw invalid();
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

