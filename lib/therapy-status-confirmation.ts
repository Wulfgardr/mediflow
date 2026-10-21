import { getLockedFields, isEncryptedFieldValue, isLockedDataPlaceholder } from './locked-field-guard';

export type Status = 'active' | 'suspended' | 'completed';
export type StatusTherapy = {
    id: string; patientId: string; version?: number; drugName: string; dosage: string; status: Status;
};
export type StatusConfirmation<T> = {
    original: T;
    target: Status;
    patientLabel: string;
    phase: 'confirm' | 'writing' | 'reading' | 'conflict' | 'rejected' | 'uncertain' | 'reviewed' | 'registered';
    current?: T;
    conflict: boolean;
    readFailed?: boolean;
    writePending?: boolean;
    recovered?: boolean;
    command?: PendingStatusWrite;
};
export type PendingStatusWrite = {
    id: string;
    therapyId: string;
    patientId: string;
    version: number;
    outcome: 'unknown' | 'accepted' | 'rejected';
};
export type StatusWriteJournal = {
    get: (patientId: string) => PendingStatusWrite | null;
    claim: (value: PendingStatusWrite) => Promise<boolean>;
    settle: (value: PendingStatusWrite) => Promise<void>;
    remove: (value: PendingStatusWrite) => Promise<void>;
};

type JournalEnvironment = {
    storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    archive: () => string;
    locks: () => Pick<LockManager, 'request'>;
};

export function createTherapyStatusWriteJournal(environment: JournalEnvironment): StatusWriteJournal {
    let archive: string | undefined;
    const key = (patientId: string) => {
        const current = environment.archive();
        if (!current || (archive !== undefined && archive !== current)) throw new Error('Archive unavailable');
        archive = current;
        return `mediflow:therapy-status-write:v1:${encodeURIComponent(archive)}:${encodeURIComponent(patientId)}`;
    };
    const get = (patientId: string): PendingStatusWrite | null => {
        const raw = environment.storage().getItem(key(patientId));
        if (raw === null) return null;
        const value = JSON.parse(raw) as PendingStatusWrite;
        if (!value || value.patientId !== patientId || typeof value.id !== 'string' || !value.id
            || typeof value.therapyId !== 'string' || !value.therapyId
            || !Number.isSafeInteger(value.version) || value.version < 1
            || !['unknown', 'accepted', 'rejected'].includes(value.outcome)) throw new Error('Unresolved therapy write unavailable');
        return value;
    };
    const exclusive = async (patientId: string, action: () => void) => {
        await environment.locks().request(key(patientId), () => { key(patientId); action(); });
    };
    return {
        get,
        async claim(value) {
            let claimed = false;
            await exclusive(value.patientId, () => {
                if (get(value.patientId)) return;
                const marker: PendingStatusWrite = { id: value.id, patientId: value.patientId,
                    therapyId: value.therapyId, version: value.version, outcome: 'unknown' };
                environment.storage().setItem(key(value.patientId), JSON.stringify(marker));
                claimed = true;
            });
            return claimed;
        },
        async settle(value) {
            await exclusive(value.patientId, () => {
                const stored = get(value.patientId);
                if (stored?.id === value.id) environment.storage().setItem(key(value.patientId), JSON.stringify({ ...stored, outcome: value.outcome }));
            });
        },
        async remove(value) {
            await exclusive(value.patientId, () => {
                if (get(value.patientId)?.id === value.id) environment.storage().removeItem(key(value.patientId));
            });
        },
    };
}

type Ports<T> = {
    journal: StatusWriteJournal;
    isRejected: (error: unknown) => boolean;
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
    const pending = () => ports.journal.get(ports.patientId);
    const blocked = () => {
        try { return !!pending() || (!!state && !['confirm', 'reviewed', 'registered'].includes(state.phase)); }
        catch { return true; }
    };
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
            const stored = pending();
            const command = stored?.id === context.command?.id ? stored : context.command;
            if (!command || command.therapyId !== item.id) throw new Error('Write context unavailable');
            const resolved = item.version! > command.version
                || (command.outcome === 'rejected' && item.version! === command.version);
            if (!resolved) {
                publish({ ...context, current: { ...item }, phase: 'uncertain', readFailed: false });
                ports.refreshed();
                return;
            }
            await ports.journal.remove(command);
            if (!current(token) || signal.aborted) return;
            const applied = command?.outcome === 'accepted' && !context.recovered && !context.conflict && item.status === context.target
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
        recover(items: T[], patientLabel: string) {
            if (!live || !ports.isCurrent()) return;
            try {
                const command = pending();
                if (!command || (state?.command?.id === command.id && !['confirm', 'reviewed', 'registered'].includes(state.phase))) return;
                const item = items.find(item => item.id === command.therapyId);
                if (!item || !valid(item)) return;
                publish({ original: { ...item, version: command.version }, target: item.status, patientLabel,
                    phase: command.outcome === 'rejected' ? 'rejected' : 'uncertain', conflict: false, recovered: true, command });
            } catch { return; }
        },
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
            if (!state || state.phase !== 'confirm' || !live || !ports.isCurrent() || blocked()) return;
            const context = state;
            const signal = reviewedSignal;
            if (!signal || signal.aborted) { publish(null); return; }
            const command: PendingStatusWrite = { id: crypto.randomUUID(), therapyId: context.original.id,
                patientId: ports.patientId, version: context.original.version!, outcome: 'unknown' };
            const token = ++generation;
            reviewedSignal = undefined;
            publish({ ...context, command, phase: 'writing', writePending: true });
            try {
                if (!await ports.journal.claim(command)) {
                    if (current(token)) { publish(null); ports.refreshed(); }
                    return;
                }
                if (!current(token) || signal.aborted) {
                    await ports.journal.remove(command);
                    if (current(token)) publish(null);
                    return;
                }
            } catch {
                if (current(token)) publish({ ...context, command, phase: 'uncertain', readFailed: true });
                return;
            }
            const attempted = { ...context, command };
            const request = new AbortController();
            let writePending = true;
            let timedOut = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([
                    (async () => {
                        try {
                            const result = await ports.write(context.original, context.target, request.signal);
                            await ports.journal.settle({ ...command, outcome: 'accepted' });
                            return result;
                        } catch (error) {
                            if (ports.isConflict(error) || ports.isRejected(error)) {
                                await ports.journal.settle({ ...command, outcome: 'rejected' });
                            }
                            throw error;
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
                publish({ ...attempted, phase: 'uncertain' });
                if (!signal.aborted) await reread();
            } catch (error) {
                const conflict = !timedOut && ports.isConflict(error);
                const rejected = !timedOut && ports.isRejected(error);
                if (current(token)) publish({ ...attempted, phase: conflict ? 'conflict' : rejected ? 'rejected' : 'uncertain', conflict, writePending });
            } finally {
                clearTimeout(timer);
            }
        },
        reread,
    };
}
