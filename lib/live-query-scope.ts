/* @Codex */
export type DbChangeTable = string;
export type DbChangeScope = readonly DbChangeTable[] | undefined;

// An unscoped notification or subscription preserves the original broadcast
// behaviour. Otherwise only listeners interested in the changed table run.
export function shouldReactToChange(
    tables: DbChangeScope,
    changedTable: DbChangeTable | undefined,
): boolean {
    if (changedTable === undefined) return true;
    if (!tables || tables.length === 0) return true;
    return tables.includes(changedTable);
}

type DbChangeListener = () => void;
type DbChangeSubscription = {
    listener: DbChangeListener;
    resolveScope: () => DbChangeScope;
};

/* @Codex */
export function createDbChangeBus() {
    const subscriptions = new Set<DbChangeSubscription>();

    const subscribeWithScopeResolver = (
        listener: DbChangeListener,
        resolveScope: () => DbChangeScope,
    ) => {
        const subscription = { listener, resolveScope };
        subscriptions.add(subscription);
        return () => {
            subscriptions.delete(subscription);
        };
    };

    return {
        subscribe(listener: DbChangeListener, scope?: DbChangeScope) {
            return subscribeWithScopeResolver(listener, () => scope);
        },
        subscribeWithScopeResolver,
        notify(changedTable?: DbChangeTable) {
            subscriptions.forEach(({ listener, resolveScope }) => {
                if (shouldReactToChange(resolveScope(), changedTable)) listener();
            });
        },
    };
}
