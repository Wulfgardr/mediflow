// STREAM B: pure scoped-invalidation predicate for the live-query layer.
//
// Kept in its own module (no React import) so it can be unit-tested under the
// strip-types test runner without pulling the client-only React hooks in
// live-query.ts.
//
// A scoped listener re-runs when: the notification is unscoped (changedTable
// undefined), or the subscriber is unscoped (tables empty/undefined), or the
// changed table is in the subscriber's set.
export function shouldReactToChange(
    tables: readonly string[] | undefined,
    changedTable: string | undefined,
): boolean {
    if (changedTable === undefined) return true;
    if (!tables || tables.length === 0) return true;
    return tables.includes(changedTable);
}
