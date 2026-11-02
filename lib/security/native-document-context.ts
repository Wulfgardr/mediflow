type Context = { scope: string | null; epoch: number; dependents: Set<() => void> };
/** Keyed by the owning session identity: a native session or a Web authentication generation. */
const contexts = new WeakMap<object, Context>();

function retire(context: Context) {
    context.epoch += 1;
    const retired = [...context.dependents];
    context.dependents.clear();
    for (const dispose of retired) dispose();
}

export function observeNativeDocumentContext(session: object, scope: string | null) {
    let context = contexts.get(session);
    if (!context) {
        context = { scope, epoch: 0, dependents: new Set() };
        contexts.set(session, context);
    } else if (context.scope !== scope) {
        context.scope = scope;
        retire(context);
    }
    const epoch = context.epoch;
    return {
        epoch,
        current: () => context.epoch === epoch,
        retire: () => { if (context.epoch === epoch) retire(context); },
        retain(dispose: () => void) {
            if (context.epoch !== epoch) throw new Error('Native document context retired');
            context.dependents.add(dispose);
            return () => { context.dependents.delete(dispose); };
        },
    };
}
