import { types } from 'node:util';

const KNOWN_ERROR_KINDS: ReadonlyMap<string, string> = new Map([
    ['DrizzleQueryError', 'database_query'],
    ['SqliteError', 'sqlite'],
    ['AbortError', 'aborted'],
    ['TimeoutError', 'timeout'],
    ['TypeError', 'type_error'],
    ['RangeError', 'range_error'],
    ['SyntaxError', 'syntax_error'],
]);

function errorKind(error: unknown): string {
    if (error === undefined) return 'failure';
    if (typeof error !== 'object' || error === null || types.isProxy(error)) return 'unexpected_value';
    const prototype = Object.getPrototypeOf(error);
    const constructor = prototype && !types.isProxy(prototype)
        ? Reflect.getOwnPropertyDescriptor(prototype, 'constructor')?.value : undefined;
    const constructorName = typeof constructor === 'function' && !types.isProxy(constructor)
        ? Reflect.getOwnPropertyDescriptor(constructor, 'name')?.value : undefined;
    const ownName = Reflect.getOwnPropertyDescriptor(error, 'name')?.value;
    for (const name of [constructorName, ownName]) {
        const knownKind = typeof name === 'string' ? KNOWN_ERROR_KINDS.get(name) : undefined;
        if (knownKind) return knownKind;
    }
    return types.isNativeError(error) ? 'error' : 'unexpected_value';
}

function logServerFailure(level: 'error' | 'warn', operation: string, error: unknown, upstreamStatus?: number): void {
    const status = typeof upstreamStatus === 'number' && Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599
        ? upstreamStatus : undefined;
    console[level](JSON.stringify({ event: 'server.failure', level, operation, kind: errorKind(error), upstreamStatus: status }));
}

export function logServerError(operation: string, error?: unknown, upstreamStatus?: number): void {
    logServerFailure('error', operation, error, upstreamStatus);
}

export function logServerWarning(operation: string, error?: unknown): void {
    logServerFailure('warn', operation, error);
}
