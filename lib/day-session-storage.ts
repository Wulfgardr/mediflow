import { daySessionEntriesSchema, type DaySessionDecision, type DaySessionEntry } from './day-session';

export type DaySessionScope = { archive: string; user: string };
type Cipher = { sealLocalDraft(value: unknown): Promise<string>; openLocalDraft(value: string): Promise<unknown> };

export const daySessionStorageKey = ({ archive, user }: DaySessionScope) => `mediflow:day-session:v1:${JSON.stringify([archive, user])}`;

export async function openDaySession(scope: DaySessionScope, encrypted: string | null, cipher: Cipher) {
    if (encrypted === null) return [];
    const value = await cipher.openLocalDraft(encrypted) as { archive: string; user: string; entries: unknown };
    if (value.archive !== scope.archive || value.user !== scope.user) throw new Error('Day session scope mismatch');
    return daySessionEntriesSchema.parse(value.entries);
}

export async function updateDaySession(scope: DaySessionScope, cipher: Cipher, storage: Storage, locks: LockManager, signal: AbortSignal,
    update: (entries: DaySessionEntry[]) => DaySessionEntry[] | Promise<DaySessionEntry[]>) {
    const key = daySessionStorageKey(scope);
    await locks.request(key, { signal }, async () => {
        signal.throwIfAborted();
        const entries = await openDaySession(scope, storage.getItem(key), cipher);
        const next = daySessionEntriesSchema.parse(await update(entries));
        const encrypted = await cipher.sealLocalDraft({ ...scope, entries: next });
        signal.throwIfAborted();
        storage.setItem(key, encrypted);
    });
}

export function replaceDaySession(entries: DaySessionEntry[], imported: DaySessionEntry[]) {
    const day = imported[0].day;
    const previous = new Map(entries.filter(entry => entry.day === day).map(entry => [entry.id, entry]));
    return [...entries.filter(entry => entry.day !== day), ...imported.map(entry => {
        const old = previous.get(entry.id);
        return old?.fingerprint === entry.fingerprint ? { ...entry, decision: old.decision } : entry;
    })];
}

export function recordDaySessionDecision(entries: DaySessionEntry[], source: DaySessionEntry, decision: DaySessionDecision) {
    const current = entries.find(entry => entry.id === source.id);
    if (current?.type !== 'pending' || current.fingerprint !== source.fingerprint || current.decision) {
        throw new Error('Day session entry changed');
    }
    return entries.map(entry => entry === current ? { ...entry, decision } : entry);
}
