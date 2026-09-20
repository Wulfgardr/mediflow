/* @Codex — bounded, revocable JSON admission after the authentic grant claim. */
import { parseStrictJson } from '../bounded-request-body';
import { NATIVE_PROJECTION_MAX_BYTES } from './native-ordinary-projection-wire';
import { ProductError } from './product-contract';
type LiveRead = Readonly<{ signal: AbortSignal; current(): boolean }>;
export async function readNativeOrdinaryProjectionJson(request: Request, use: LiveRead): Promise<unknown> {
    const invalid = (): never => { throw new ProductError('invalid_request'); };
    if (request.headers.get('content-type') !== 'application/json' || request.headers.has('content-encoding') || !request.body) return invalid();
    const raw = request.headers.get('content-length');
    const declared = raw === null ? null : Number(raw);
    if (raw !== null && (!/^[1-9][0-9]*$/u.test(raw) || !Number.isSafeInteger(declared) || declared! > NATIVE_PROJECTION_MAX_BYTES)) return invalid();
    const bytes = new Uint8Array(declared ?? NATIVE_PROJECTION_MAX_BYTES);
    const reader = request.body.getReader(); let length = 0;
    const current = () => !request.signal.aborted && !use.signal.aborted && use.current();
    const cancel = () => { bytes.fill(0); void reader.cancel().catch(() => {}); };
    request.signal.addEventListener('abort', cancel, { once: true });
    use.signal.addEventListener('abort', cancel, { once: true });
    try {
        while (true) {
            if (!current()) return invalid();
            const next = await reader.read();
            if (!current()) return invalid();
            if (next.done) break;
            if (!(next.value instanceof Uint8Array) || next.value.byteLength > bytes.byteLength - length) return invalid();
            bytes.set(next.value, length); length += next.value.byteLength;
        }
        if (!length || (declared !== null && length !== declared) || !current()) return invalid();
        const result = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
        if (!current()) return invalid();
        return result;
    } catch { return invalid(); }
    finally {
        bytes.fill(0); request.signal.removeEventListener('abort', cancel); use.signal.removeEventListener('abort', cancel);
        void reader.cancel().catch(() => {}); reader.releaseLock();
    }
}
