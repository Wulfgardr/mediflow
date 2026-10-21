import { getLockedFields, isEncryptedFieldValue, isLockedDataPlaceholder } from './locked-field-guard';

type Status = 'active' | 'suspended' | 'completed';
export type StatusTherapy = {
    id: string; patientId: string; version?: number; drugName: string; dosage: string; status: Status;
};
export type StatusConfirmation<T> = {
    original: T;
    target: Status;
    patientLabel: string;
    phase: 'confirm' | 'writing' | 'reading' | 'conflict' | 'uncertain' | 'reviewed' | 'registered';
    current?: T;
    conflict: boolean;
    readFailed?: boolean;
    writePending?: boolean;
};
type Ports<T> = {
    patientId: string;
    isCurrent: () => boolean;
    signal: () => AbortSignal;
    read: (signal: AbortSignal) => Promise<T[]>;
    write: (item: T, target: Status, signal: AbortSignal) => Promise<unknown>;
    isConflict: (error: unknown) => boolean;
    changed: (value: StatusConfirmation<T> | null) => void;
    refreshed: () => void;
    timeoutMs?: number;
};

export function createTherapyStatusConfirmation<T extends StatusTherapy>(ports: Ports<T>) {
    let state: StatusConfirmation<T> | null = null;
    let live = true;
    let generation = 0;
    let reviewedSignal: AbortSignal | undefined;
    const publish = (value: StatusConfirmation<T> | null) => { state = value; ports.changed(value); };
    const valid = (item: T) => item.patientId === ports.patientId && Number.isSafeInteger(item.version)
        && (item.version ?? 0) > 0 && getLockedFields(item).length === 0
        && [item.drugName, item.dosage, item.status].every(value => !isLockedDataPlaceholder(value) && !isEncryptedFieldValue(value));
    const current = (token: number) => live && generation === token && ports.isCurrent();
    const blocked = () => !!state && !['confirm', 'reviewed', 'registered'].includes(state.phase);
    async function reread() {
        if (!live || !ports.isCurrent() || !state || state.writePending || ['confirm', 'writing', 'reading'].includes(state.phase)) return;
        const context = state;
        const token = ++generation;
        publish({ ...context, phase: 'reading', readFailed: false });
        try {
            const signal = ports.signal();
            signal.throwIfAborted();
            const items = await ports.read(signal);
            signal.throwIfAborted();
            if (!current(token)) return;
            const item = items.find(item => item.id === context.original.id);
            if (!item || !valid(item)) throw new Error('Therapy unavailable');
            const applied = !context.conflict && item.status === context.target
                && item.version! > context.original.version!
                && item.drugName === context.original.drugName && item.dosage === context.original.dosage;
            reviewedSignal = undefined;
            publish({ ...context, current: { ...item }, phase: applied ? 'registered' : 'reviewed', readFailed: false });
            ports.refreshed();
        } catch {
            if (current(token)) publish({ ...context, phase: context.conflict ? 'conflict' : 'uncertain', readFailed: true });
        }
    }
    return {
        get blocked() { return blocked(); },
        get snapshot() { return state; },
        activate() { live = true; },
        dispose() { live = false; generation++; state = null; reviewedSignal = undefined; },
        cancel() {
            if (!live || blocked()) return;
            generation++;
            reviewedSignal = undefined;
            publish(null);
        },
        begin(item: T, target: Status, patientLabel: string) {
            if (!live || !ports.isCurrent() || blocked() || !valid(item)) return;
            const signal = ports.signal();
            if (signal.aborted) return;
            generation++;
            reviewedSignal = signal;
            publish({ original: { ...item }, target, patientLabel, phase: 'confirm', conflict: false });
        },
        async confirm() {
            if (!state || state.phase !== 'confirm' || !live || !ports.isCurrent()) return;
            const context = state;
            const signal = reviewedSignal;
            if (!signal || signal.aborted) { publish(null); return; }
            const token = ++generation;
            reviewedSignal = undefined;
            publish({ ...context, phase: 'writing', writePending: true });
            const request = new AbortController();
            let writePending = true;
            let timedOut = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([
                    (async () => {
                        try {
                            return await ports.write(context.original, context.target, request.signal);
                        } finally {
                            writePending = false;
                            if (current(token) && state?.phase === 'uncertain') publish({ ...state, writePending: false });
                        }
                    })(),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => {
                        timedOut = true;
                        reject(new Error('Unconfirmed write'));
                        request.abort();
                    }, ports.timeoutMs ?? 15_000); }),
                ]);
                if (!current(token)) return;
                publish({ ...context, phase: 'uncertain' });
                if (!signal.aborted) await reread();
            } catch (error) {
                const conflict = !timedOut && ports.isConflict(error);
                if (current(token)) publish({ ...context, phase: conflict ? 'conflict' : 'uncertain', conflict, writePending });
            } finally {
                clearTimeout(timer);
            }
        },
        reread,
    };
}
