import { createTherapyStatusConfirmation, type StatusTherapy, type StatusWriteJournal, type Status } from './therapy-status-confirmation';
import { THERAPY_STATUS_PROTOCOL, parseTherapyStatusCommand, type TherapyStatusCommand, type TherapyStatusReceipt } from './therapy-status-command-contract';
import type { TherapyCommandResponse } from './therapy-status-command-client';
import { getLockedFields, isEncryptedFieldValue, isLockedDataPlaceholder } from './locked-field-guard';
export type DurableStatusState<T> = {
    phase: 'confirm' | 'writing' | 'reading' | 'conflict' | 'rejected' | 'uncertain' | 'reviewed' | 'registered' | 'unavailable';
    patientLabel: string; original?: T; target?: Status; current?: T; conflict: boolean;
    reason?: 'admission' | 'journal' | 'therapy'; newAttemptNotSent?: boolean; checking?: boolean;
    readFailed?: boolean; writePending?: boolean; historical?: boolean; legacy?: boolean;
    receipt?: TherapyStatusReceipt; command?: TherapyStatusCommand;
};
type Environment = { storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; archive: () => string; locks: () => Pick<LockManager, 'request'> };
export function createTherapyCommandJournal(environment: Environment, legacy: StatusWriteJournal) {
    let generation: string | undefined;
    function key(patientId: string) {
        const current = environment.archive();
        if (!current || (generation !== undefined && generation !== current)) throw new Error('Archive unavailable');
        generation = current;
        return `mediflow:therapy-status-command:v1:${encodeURIComponent(current)}:${encodeURIComponent(patientId)}`;
    }
    function get(patientId: string): TherapyStatusCommand | null {
        const raw = environment.storage().getItem(key(patientId));
        if (raw === null) return null;
        const value: unknown = JSON.parse(raw);
        const command = parseTherapyStatusCommand(value, false);
        if (!command || command.patientId !== patientId || command.archiveGeneration !== generation) throw new Error('Invalid command marker');
        return command;
    }
    async function exclusive<T>(patientId: string, action: () => T): Promise<T> {
        const lock = key(patientId).replace('therapy-status-command', 'therapy-status-write');
        return environment.locks().request(lock, () => { key(patientId); return action(); });
    }
    return {
        get,
        inspect: (patientId: string) => exclusive(patientId, () => get(patientId)),
        async claim(command: TherapyStatusCommand) {
            return exclusive(command.patientId, () => {
                if (!parseTherapyStatusCommand(command, false) || get(command.patientId) || legacy.get(command.patientId)) return false;
                environment.storage().setItem(key(command.patientId), JSON.stringify(command));
                if (get(command.patientId)?.commandId !== command.commandId) throw new Error('Command marker unavailable');
                return true;
            });
        },
        async remove(command: TherapyStatusCommand) {
            await exclusive(command.patientId, () => {
                if (get(command.patientId)?.commandId === command.commandId) environment.storage().removeItem(key(command.patientId));
            });
        },
    };
}
type Ports<T> = {
    patientId: string; archive: () => string; journal: ReturnType<typeof createTherapyCommandJournal>; legacy: StatusWriteJournal;
    isCurrent: () => boolean; signal: () => AbortSignal; read: (signal: AbortSignal) => Promise<T[]>;
    request: (operation: 'execute' | 'receipt' | 'close', command: TherapyStatusCommand | (TherapyStatusCommand & { target: Status }), signal: AbortSignal) => Promise<TherapyCommandResponse>;
    changed: (state: DurableStatusState<T> | null) => void; refreshed: () => void; timeoutMs?: number;
};
export function createDurableTherapyStatusConfirmation<T extends StatusTherapy>(ports: Ports<T>) {
    let state: DurableStatusState<T> | null = null, live = true, epoch = 0, busy = false, legacyMode = false;
    const publish = (value: DurableStatusState<T> | null) => { state = value; ports.changed(value); };
    const legacy = createTherapyStatusConfirmation<T>({ patientId: ports.patientId, journal: ports.legacy, isCurrent: ports.isCurrent, signal: ports.signal,
        read: ports.read, write: async () => { throw new Error('Legacy recovery cannot submit new writes'); }, isConflict: () => false, isRejected: () => false,
        refreshed: ports.refreshed, changed: value => { if (legacyMode) publish(value ? { ...value, command: undefined, conflict: 'conflict' in value ? value.conflict : false, legacy: true } : null); } });
    const owns = (token: number) => live && token === epoch && ports.isCurrent();
    const current = (token: number, signal: AbortSignal) => owns(token) && !signal.aborted;
    const late = (token: number, signal: AbortSignal) => {
        if (current(token, signal)) return false;
        if (owns(token) && state?.command) publish({ ...state, phase: 'uncertain', writePending: false });
        return true;
    };
    const valid = (item: T) => item.patientId === ports.patientId && Number.isSafeInteger(item.version) && item.version! > 0
        && getLockedFields(item).length === 0 && [item.drugName, item.dosage, item.status].every(value => !isEncryptedFieldValue(value) && !isLockedDataPlaceholder(value));
    const unavailable = (reason: 'journal' | 'admission' | 'therapy', label = state?.patientLabel ?? '', newAttemptNotSent = true) => publish({ phase: 'unavailable', reason, patientLabel: label, conflict: false, newAttemptNotSent });
    async function finish(response: TherapyCommandResponse, command: TherapyStatusCommand, token: number, signal: AbortSignal) {
        if (late(token, signal)) return;
        if (response.outcome === 'unknown') { publish({ ...state!, phase: 'uncertain', writePending: false }); return; }
        publish({ ...state!, phase: 'reading', writePending: false });
        const items = await ports.read(signal);
        if (late(token, signal)) return;
        const item = items.find(value => value.id === command.therapyId);
        await ports.journal.remove(command);
        if (!current(token, signal)) return;
        publish({ ...state!, command: undefined, current: item, receipt: response.receipt, historical: response.historical,
            phase: response.receipt.outcome === 'applied' && !response.historical && item?.version === response.receipt.resultVersion && item?.status === response.receipt.target ? 'registered' : 'reviewed', writePending: false });
        ports.refreshed();
    }
    async function inspect(items: T[], patientLabel: string) {
        if (!live || !ports.isCurrent() || busy) return;
        if (state && ['writing', 'reading'].includes(state.phase) && state.command) publish({ ...state, phase: 'uncertain', writePending: false });
        if (legacyMode) { legacy.recover(items, patientLabel); return; }
        const token = epoch, signal = ports.signal();
        try {
            if (await ports.legacy.inspect(ports.patientId)) {
                if (!current(token, signal)) return;
                legacyMode = true; legacy.recover(items, patientLabel); return;
            }
            const command = await ports.journal.inspect(ports.patientId);
            if (!current(token, signal) || !command || state?.command?.commandId === command.commandId) return;
            publish({ phase: 'uncertain', command, original: items.find(item => item.id === command.therapyId), patientLabel, conflict: false });
        } catch { if (current(token, signal)) unavailable('journal', patientLabel, false); }
    }
    async function resolve(operation: 'receipt' | 'close') {
        if (legacyMode) { if (operation === 'receipt') await legacy.reread(); return; }
        const context = state;
        if (!context?.command || busy || !live || !ports.isCurrent()) return;
        const token = epoch, signal = ports.signal(); busy = true;
        publish({ ...context, phase: 'reading', readFailed: false });
        try { await finish(await ports.request(operation, context.command, signal), context.command, token, signal); }
        catch { if (owns(token)) publish({ ...context, phase: 'uncertain', readFailed: true, writePending: false }); }
        finally { busy = false; }
    }
    return {
        activate() { live = true; legacy.activate(); },
        dispose() { live = false; epoch++; legacy.dispose(); },
        get blocked() {
            if (legacyMode) return legacy.blocked;
            try { return busy || !!ports.journal.get(ports.patientId) || !!ports.legacy.get(ports.patientId) || (!!state && !['confirm', 'registered', 'reviewed'].includes(state.phase)); }
            catch { return true; }
        },
        recover: inspect,
        begin(item: T, target: Status, patientLabel: string) {
            if (busy || !live || !ports.isCurrent()) return;
            try { if (ports.legacy.get(ports.patientId) || ports.journal.get(ports.patientId)) { void inspect([item], patientLabel); return; } }
            catch { unavailable('journal', patientLabel); return; }
            if (!valid(item)) { unavailable('therapy', patientLabel); return; }
            legacyMode = false; epoch++;
            publish({ phase: 'confirm', original: item, target, patientLabel, conflict: false });
        },
        cancel() {
            if (legacyMode) { legacy.cancel(); return; }
            if (busy || (state && !['confirm', 'registered', 'reviewed'].includes(state.phase))) return;
            epoch++; publish(null);
        },
        async confirm() {
            const context = state;
            if (!context || context.phase !== 'confirm' || !context.original || !context.target || busy || !live || !ports.isCurrent()) return;
            const token = epoch, signal = ports.signal();
            if (signal.aborted || !valid(context.original)) { unavailable('admission'); return; }
            busy = true;
            let command: TherapyStatusCommand;
            try { command = { commandId: crypto.randomUUID(), protocol: THERAPY_STATUS_PROTOCOL, archiveGeneration: ports.archive(),
                patientId: ports.patientId, therapyId: context.original.id, expectedVersion: context.original.version! }; }
            catch { busy = false; unavailable('admission'); return; }
            publish({ ...context, phase: 'writing', command, writePending: true });
            let timer: ReturnType<typeof setTimeout> | undefined;
            let sent = false;
            const request = new AbortController();
            const abort = () => request.abort(); signal.addEventListener('abort', abort, { once: true });
            try {
                if (!await ports.journal.claim(command)) { if (current(token, signal)) unavailable('admission'); return; }
                if (late(token, signal)) return;
                sent = true;
                const response = await Promise.race([ports.request('execute', { ...command, target: context.target }, request.signal),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => { request.abort(); reject(new Error('Unconfirmed command')); }, ports.timeoutMs ?? 15000); })]);
                await finish(response, command, token, signal);
            } catch { if (owns(token)) {
                if (!sent) unavailable('admission');
                else publish({ ...context, command, phase: 'uncertain', writePending: false });
            } }
            finally { clearTimeout(timer); signal.removeEventListener('abort', abort); busy = false; }
        },
        reread: () => resolve('receipt'),
        close: () => resolve('close'),
        async recheck() {
            if (legacyMode) { await legacy.recheck(); return; }
            if (busy || state?.phase !== 'unavailable') return;
            const label = state.patientLabel; publish(null);
            try { await inspect(await ports.read(ports.signal()), label); }
            catch { unavailable('admission', label); }
        },
    };
}
