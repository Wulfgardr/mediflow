export function unique<T>(values: readonly T[]): T {
    if (values.length !== 1) throw new Error('unverifiable');
    for (const value of values) return value;
    throw new Error('unverifiable');
}
