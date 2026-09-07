/* @Codex */
const objectFreeze = Object.freeze;
const jsonParse = JSON.parse;
const SetConstructor = Set;
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const decodeUtf8 = textDecoder.decode.bind(textDecoder) as (input: AllowSharedBufferSource) => string;
const requestDecoder = new TextDecoder('utf-8');
const decodeRequestUtf8 = requestDecoder.decode.bind(requestDecoder);
const textEncoder = new TextEncoder();
const encodeUtf8 = textEncoder.encode.bind(textEncoder) as (input?: string) => Uint8Array;
const Uint8ArrayConstructor = Uint8Array;
const arrayPush = Function.call.bind(Array.prototype.push) as (target: Uint8Array[], value: Uint8Array) => number;
const stringSlice = Function.call.bind(String.prototype.slice) as (value: string, start?: number, end?: number) => string;

export type BoundedJsonReadControl = Readonly<{ signal: AbortSignal; deadline: number }>;

export type BoundedJsonBody = Readonly<{ ok: true; value: unknown; byteLength: number }>
    | Readonly<{ ok: false; status: 400 | 413 }>;

function cancel(reader: ReadableStreamDefaultReader<Uint8Array>) {
    try { void reader.cancel().catch(() => {}); } catch { /* cancellation is best effort after a stream failure */ }
}

function cancelBody(body: ReadableStream<Uint8Array> | null) {
    if (!body) return;
    try { void body.cancel().catch(() => {}); } catch { /* cancellation is best effort after a stream failure */ }
}

function declaredLength(request: Request): number | null {
    const raw = request.headers.get('content-length');
    if (raw === null || !/^[0-9]+$/.test(raw)) return null;
    const length = Number.parseInt(raw, 10);
    return length; // Very large decimal headers (including Infinity) still exceed a finite cap.
}

function duplicateObjectKey(source: string): boolean {
    let index = 0;
    const whitespace = () => { while (source[index] === ' ' || source[index] === '\n' || source[index] === '\r' || source[index] === '\t') index += 1; };
    const string = (): string | null => {
        whitespace();
        if (source[index] !== '"') return null;
        const start = index; index += 1;
        while (index < source.length) {
            const character = source[index]!;
            if (character === '\\') { index += 2; continue; }
            index += 1;
            if (character === '"') {
                try { return jsonParse(stringSlice(source, start, index)) as string; } catch { return null; }
            }
        }
        return null;
    };
    const value = (): boolean => {
        whitespace();
        if (source[index] === '{') return object();
        if (source[index] === '[') return array();
        if (source[index] === '"') return string() === null;
        while (index < source.length && source[index] !== ' ' && source[index] !== '\n' && source[index] !== '\r' && source[index] !== '\t'
            && source[index] !== ',' && source[index] !== '}' && source[index] !== ']') index += 1;
        return false;
    };
    const object = (): boolean => {
        index += 1; whitespace();
        const keys = new SetConstructor<string>();
        if (source[index] === '}') { index += 1; return false; }
        while (index < source.length) {
            const key = string();
            if (key === null) return false;
            if (keys.has(key)) return true;
            keys.add(key); whitespace();
            if (source[index] !== ':') return false;
            index += 1;
            if (value()) return true;
            whitespace();
            if (source[index] === '}') { index += 1; return false; }
            if (source[index] !== ',') return false;
            index += 1;
        }
        return false;
    };
    const array = (): boolean => {
        index += 1; whitespace();
        if (source[index] === ']') { index += 1; return false; }
        while (index < source.length) {
            if (value()) return true;
            whitespace();
            if (source[index] === ']') { index += 1; return false; }
            if (source[index] !== ',') return false;
            index += 1;
        }
        return false;
    };
    try { return value(); } catch { return false; }
}

/** Accumulates at most the budget; rejects the crossing chunk before decoding/parsing. */
export async function readBoundedJsonBody(
    request: Request,
    maximumBytes: number,
    semantics: 'strict' | 'request-json' = 'strict',
    control?: BoundedJsonReadControl,
): Promise<BoundedJsonBody> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new RangeError('Invalid JSON byte budget');
    const interrupted = () => control !== undefined && (control.signal.aborted || performance.now() >= control.deadline);
    if (interrupted()) return objectFreeze({ ok: false, status: 400 });
    const declared = declaredLength(request);
    if (declared !== null && declared > maximumBytes) {
        cancelBody(request.body);
        return objectFreeze({ ok: false, status: 413 });
    }
    if (!request.body) return objectFreeze({ ok: false, status: 400 });

    const reader = request.body.getReader();
    // Only attachment reads opt in. Cancel settles the pending read without racing the consumer.
    const abort = () => cancel(reader);
    control?.signal.addEventListener('abort', abort, { once: true });
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
        while (true) {
            if (interrupted()) { cancel(reader); return objectFreeze({ ok: false, status: 400 }); }
            const step = await reader.read();
            if (interrupted()) { cancel(reader); return objectFreeze({ ok: false, status: 400 }); }
            if (step.done) break;
            if (!(step.value instanceof Uint8ArrayConstructor)) {
                cancel(reader);
                return objectFreeze({ ok: false, status: 400 });
            }
            byteLength += step.value.byteLength;
            if (byteLength > maximumBytes) {
                cancel(reader);
                return objectFreeze({ ok: false, status: 413 });
            }
            if (step.value.byteLength > 0) arrayPush(chunks, step.value);
        }
    } catch {
        cancel(reader);
        return objectFreeze({ ok: false, status: 400 });
    } finally {
        control?.signal.removeEventListener('abort', abort);
        try { reader.releaseLock(); } catch { /* reader is already closed */ }
    }

    try {
        const bytes = new Uint8ArrayConstructor(byteLength);
        let offset = 0;
        for (let index = 0; index < chunks.length; index += 1) {
            const chunk = chunks[index]!;
            bytes.set(chunk, offset); offset += chunk.byteLength;
        }
        const source = semantics === 'request-json' ? decodeRequestUtf8(bytes) : decodeUtf8(bytes);
        if (semantics === 'strict' && duplicateObjectKey(source)) return objectFreeze({ ok: false, status: 400 });
        return objectFreeze({ ok: true, value: jsonParse(source), byteLength });
    } catch {
        return objectFreeze({ ok: false, status: 400 });
    }
}

/** Rechecks the parsed sealed value against the same byte budget without Buffer. */
export function utf8ByteLength(value: string): number {
    return encodeUtf8(value).byteLength;
}
