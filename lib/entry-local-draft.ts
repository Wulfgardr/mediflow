export type EntryLocalDraft = {
    type: 'visit' | 'remote' | 'note';
    content: string;
    setting: 'ambulatory' | 'home';
    entryDate: string;
    dictatedDraft: string;
};
type Scope = { archive: string; user: string; patient: string };
type Cipher = { sealLocalDraft(value: unknown): Promise<string>; openLocalDraft(value: string): Promise<unknown> };

export function createEntryLocalDraft(scope: Scope, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, cipher: Cipher, locks: LockManager) {
    const key = `mediflow:entry-draft:v1:${JSON.stringify(scope)}`;
    let observed: string | null = null, tail = Promise.resolve(), disposed = false;
    const exclusive = async <T>(work: () => Promise<T>): Promise<T> => await locks.request(key, work) as T;
    return {
        async read(): Promise<EntryLocalDraft | null> {
            observed = storage.getItem(key);
            if (!observed) return null;
            const envelope = await cipher.openLocalDraft(observed) as { scope: Scope; draft: EntryLocalDraft };
            if (JSON.stringify(envelope.scope) !== JSON.stringify(scope) || !envelope.draft
                || !['visit', 'remote', 'note'].includes(envelope.draft.type)
                || !['ambulatory', 'home'].includes(envelope.draft.setting)
                || !['content', 'entryDate', 'dictatedDraft'].every(field => typeof envelope.draft[field as keyof EntryLocalDraft] === 'string')) {
                throw new Error('Bozza non riconosciuta.');
            }
            return envelope.draft;
        },
        save(draft: EntryLocalDraft | null) {
            const task = tail.then(() => exclusive(async () => {
                if (disposed) return;
                if (storage.getItem(key) !== observed) throw new Error('La bozza è cambiata in un’altra scheda. Il testo resta in questa schermata.');
                const encrypted = draft ? await cipher.sealLocalDraft({ scope, draft }) : null;
                if (disposed) return;
                if (encrypted === null) storage.removeItem(key); else storage.setItem(key, encrypted);
                observed = encrypted;
            }));
            tail = task.catch(() => {});
            return task;
        },
        dispose() { disposed = true; },
    };
}
