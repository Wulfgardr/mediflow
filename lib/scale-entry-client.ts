import { db, type ClinicalEntry } from './db';
import { notifyDbChange } from './live-query';

export class ScaleEntryWriteError extends Error {
    constructor(readonly code: 'SCALE_PATIENT_INACTIVE' | 'SCALE_IDEMPOTENCY_CONFLICT' | 'UNCONFIRMED') {
        super(code === 'SCALE_PATIENT_INACTIVE'
            ? 'Paziente archiviato o rimosso. Nessuna nuova registrazione. La bozza è conservata.'
            : code === 'SCALE_IDEMPOTENCY_CONFLICT'
                ? 'Questo invio è già associato a un contenuto diverso. Verifica gli esiti registrati.'
                : 'Registrazione non confermata. La bozza è conservata: riprova lo stesso invio.');
    }
}

export type PreparedScaleEntryCreate = { submit: () => Promise<{ id: string; alreadyRegistered: boolean }> };

export async function prepareScaleCreate(item: ClinicalEntry, isCurrent: () => boolean): Promise<PreparedScaleEntryCreate> {
    if (item.type !== 'scale') throw new Error('Scale entry required.');
    const entryId = item.id;
    const signal = db.getSessionReadSignal();
    const assertCurrent = () => {
        if (signal.aborted || db.getSessionReadSignal() !== signal || !isCurrent()) throw new ScaleEntryWriteError('UNCONFIRMED');
    };
    assertCurrent();
    const body = JSON.stringify(await db.entries.prepareWritePayload(item));
    assertCurrent();
    return { submit: async () => {
        assertCurrent();
        const response = await fetch('/api/entries', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body, signal });
        const result = await response.json();
        assertCurrent();
        if (!response.ok) throw new ScaleEntryWriteError(result.code === 'SCALE_PATIENT_INACTIVE'
            || result.code === 'SCALE_IDEMPOTENCY_CONFLICT' ? result.code : 'UNCONFIRMED');
        if (result.id !== entryId) throw new ScaleEntryWriteError('UNCONFIRMED');
        notifyDbChange('entries');
        return { id: result.id, alreadyRegistered: result.idempotent === true };
    } };
}
