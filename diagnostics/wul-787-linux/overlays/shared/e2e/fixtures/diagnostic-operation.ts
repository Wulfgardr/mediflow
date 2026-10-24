export function diagnosticFailure(operation: string, cause: unknown): Error {
    return new Error(`WUL787_DIAGNOSTIC_FAILURE[${operation}]: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
}

export function diagnosticOperation<T>(operation: string, action: () => T): T {
    try { return action(); }
    catch (cause) { throw diagnosticFailure(operation, cause); }
}

export async function diagnosticAsyncOperation<T>(operation: string, action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (cause) { throw diagnosticFailure(operation, cause); }
}

function failureText(error: unknown, seen = new Set<Error>()): string {
    if (!(error instanceof Error)) return String(error);
    if (seen.has(error)) return '[circular cause]';
    seen.add(error);
    return (error.stack ?? error.message) + (error.cause === undefined ? '' : '\n[cause]: ' + failureText(error.cause, seen));
}

export function rethrowCollectedFailures(failures: unknown[]): void {
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures,
        'AnyDoc keyboard/chooser and cleanup/report failures\n' + failures.map((error, index) =>
            `[${index}] ${failureText(error)}`).join('\n\n'),
        { cause: failures[0] });
}
