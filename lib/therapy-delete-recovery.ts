import { getLockedFields, isEncryptedFieldValue, isLockedDataPlaceholder } from './locked-field-guard';

/** In-memory recovery for one explicit therapy deletion; no persistence or logging. */
export type DeletableTherapy = { id: string; patientId: string; version?: number; deletedAt?: Date | null };

export function isTherapyReadableForDeletion(item: DeletableTherapy): boolean {
    const record = item as DeletableTherapy & Record<string, unknown>;
    return getLockedFields(item).length === 0
        && ['drugName', 'activePrinciple', 'aic', 'dosage', 'motivation', 'diagnosisName', 'status']
            .every(field => !isLockedDataPlaceholder(record[field]) && !isEncryptedFieldValue(record[field]));
}
export type DeleteRecovery<T> = {
    original: T;
    reason: string;
    phase: 'prompt' | 'writing' | 'conflict' | 'uncertain' | 'reading' | 'unavailable' | 'absent' | 'ready' | 'confirming';
    current?: T;
};

type Ports<T> = {
    patientId: string;
    isCurrent: () => boolean;
    signal: () => AbortSignal;
    readParent: (id: string, signal: AbortSignal) => Promise<{ id: string } | undefined>;
    readTherapies: (id: string, signal: AbortSignal) => Promise<T[]>;
    remove: (id: string, options: { version: number; deletionReason: string; deleteContext: { signal: AbortSignal; isCurrent: () => boolean } }) => Promise<unknown>;
    isConflict: (error: unknown) => boolean;
    changed: (state: DeleteRecovery<T> | null) => void;
    succeeded: () => void;
};

export function createTherapyDeleteRecovery<T extends DeletableTherapy>(ports: Ports<T>) {
    let state: DeleteRecovery<T> | null = null;
    let live = true;
    let generation = 0;
    let reviewedSignal: AbortSignal | undefined;
    // Discarding a reason must not make an unresolved write safe to repeat.
    const unresolved = new Map<string, T>();
    const validVersion = (item: T) => Number.isSafeInteger(item.version) && (item.version ?? 0) > 0;
    const current = (token: number) => live && generation === token && ports.isCurrent();
    const publish = (next: DeleteRecovery<T> | null) => { state = next; ports.changed(next); };
    const snapshot = (): DeleteRecovery<T> | null => state;
    const pending = () => !!state && ['prompt', 'writing', 'reading', 'confirming'].includes(state.phase);
    async function write(token: number, item: T, reason: string, signal: AbortSignal) {
        if (!current(token) || signal.aborted || !validVersion(item) || item.patientId !== ports.patientId) return;
        publish({ ...state!, reason, phase: 'writing', current: undefined });
        reviewedSignal = undefined;
        unresolved.set(item.id, state!.original);
        try {
            await ports.remove(item.id, {
                version: item.version!, deletionReason: reason,
                deleteContext: { signal, isCurrent: () => current(token) },
            });
            if (!current(token)) return;
            if (signal.aborted) { publish({ ...state!, phase: 'uncertain' }); return; }
            unresolved.delete(item.id);
            publish(null);
            ports.succeeded();
        } catch (error) {
            if (current(token)) publish({ ...state!, phase: ports.isConflict(error) ? 'conflict' : 'uncertain' });
        }
    }
    return {
        get blocked() { return !!state; },
        get snapshot() { return snapshot(); },
        activate() { live = true; },
        dispose() { live = false; generation++; state = null; reviewedSignal = undefined; unresolved.clear(); },
        cancel() {
            if (!live || pending()) return;
            generation++;
            reviewedSignal = undefined;
            publish(null);
        },
        async begin(item: T, confirm: () => Promise<{ confirmed: boolean; reason?: string }>) {
            if (!live || !ports.isCurrent() || state || item.patientId !== ports.patientId || !validVersion(item)) return;
            const token = ++generation;
            const previous = unresolved.get(item.id);
            if (previous) {
                publish({ original: previous, reason: '', phase: 'uncertain' });
                return;
            }
            const original = { ...item };
            publish({ original, reason: '', phase: 'prompt' });
            try {
                const signal = ports.signal();
                signal.throwIfAborted();
                const result = await confirm();
                if (!current(token)) return;
                if (!result.confirmed || !result.reason?.trim()) { publish(null); return; }
                // Preserve the reason before any write, including a session change during the prompt.
                publish({ original, reason: result.reason, phase: 'unavailable' });
                if (signal.aborted) return;
                await write(token, original, result.reason, signal);
            } catch {
                const latest = snapshot();
                if (current(token)) publish(latest?.reason ? { ...latest, phase: 'unavailable' } : null);
            }
        },
        async reread() {
            if (!live || !ports.isCurrent() || !state || pending()) return;
            const token = ++generation;
            reviewedSignal = undefined;
            publish({ ...state, phase: 'reading', current: undefined });
            try {
                const signal = ports.signal();
                signal.throwIfAborted();
                const [items, parent] = await Promise.all([
                    ports.readTherapies(ports.patientId, signal), ports.readParent(ports.patientId, signal),
                ]);
                signal.throwIfAborted();
                if (!current(token)) return;
                const item = items.find(item => item.id === state!.original.id);
                if (!parent || parent.id !== ports.patientId || (item && (item.patientId !== ports.patientId || !validVersion(item) || item.deletedAt || !isTherapyReadableForDeletion(item)))) {
                    throw new Error('Unavailable therapy');
                }
                reviewedSignal = signal;
                publish({ ...state!, phase: item ? 'ready' : 'absent', current: item ? { ...item } : undefined });
            } catch {
                if (current(token)) publish({ ...state!, phase: 'unavailable', current: undefined });
            }
        },
        async retry(confirm: () => Promise<{ confirmed: boolean; reason?: string }>) {
            if (!live || !ports.isCurrent() || state?.phase !== 'ready' || !state.current) return;
            const signal = reviewedSignal;
            if (!signal || signal.aborted) { publish({ ...state, phase: 'unavailable', current: undefined }); return; }
            const token = ++generation;
            const item = state.current;
            const reason = state.reason;
            publish({ ...state, phase: 'confirming' });
            try {
                const result = await confirm();
                if (!current(token)) return;
                if (signal.aborted) { publish({ ...state!, phase: 'unavailable', current: undefined }); return; }
                if (!result.confirmed) { publish({ ...state!, phase: 'ready' }); return; }
                const nextReason = reason || result.reason;
                if (!nextReason?.trim()) { publish({ ...state!, phase: 'ready' }); return; }
                await write(token, item, nextReason, signal);
            } catch {
                if (current(token)) publish({ ...state!, phase: 'unavailable', current: undefined });
            }
        },
    };
}
