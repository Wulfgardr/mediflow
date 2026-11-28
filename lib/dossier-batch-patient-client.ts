import { db } from './db';
import { clientArchiveGeneration } from './security/client-auth-api';
import { parsePatientDocumentReceipt, patientDocumentScope, requestPatientDocument } from './patient-document-create-client';
import type { DossierBatchRow } from './patient-document-batch-contract';
import type { DossierDraftSource } from './document-dossier-session';
import { PATIENT_IDENTIFIER_DUPLICATE } from './patient-identity';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STORAGE_EVENT = 'mediflow-dossier-batch-reference';
const prefix = (scope: string) => `mediflow:dossier-batch:v1:${scope}:`;

export async function readDossierBatchScope() {
    const generation = clientArchiveGeneration();
    const ambulatory = await patientDocumentScope(async () => (await db.ambulatories.toArray()).find(item => item.isDefault)?.id ?? null);
    return `${encodeURIComponent(generation)}:${encodeURIComponent(ambulatory)}`;
}

export const dossierBatchReceipts = {
    subscribe(callback: () => void) {
        window.addEventListener('storage', callback);
        window.addEventListener(STORAGE_EVENT, callback);
        return () => {
            window.removeEventListener('storage', callback);
            window.removeEventListener(STORAGE_EVENT, callback);
        };
    },
    snapshot(scope: string | null) {
        if (!scope) return '';
        try {
            const start = prefix(scope);
            const ids = Object.keys(localStorage).filter(key => key.startsWith(start))
                .map(key => key.slice(start.length)).filter(id => UUID.test(id));
            return ids.sort().join(',');
        } catch { return ''; }
    },
    write(scope: string, commandId: string) {
        try {
            if (!UUID.test(commandId)) return false;
            const key = prefix(scope) + commandId;
            localStorage.setItem(key, '1');
            window.dispatchEvent(new Event(STORAGE_EVENT));
            return localStorage.getItem(key) === '1';
        } catch { return false; }
    },
    clear(scope: string, commandId: string) {
        try {
            localStorage.removeItem(prefix(scope) + commandId);
            window.dispatchEvent(new Event(STORAGE_EVENT));
        } catch { return; }
    },
};

export type DossierBatchOutcome =
    | { kind: 'created'; patientId: string; warning?: string }
    | { kind: 'rejected'; reason: string }
    | { kind: 'uncertain'; commandId: string };

const ROW_REFUSALS: Record<string, string> = {
    'missing-name': 'Mancano nome o cognome.',
    'invalid-tax-code': 'Codice fiscale non valido.',
    'invalid-birth-date': 'Data di nascita mancante, non valida o diversa da quella del codice fiscale.',
    'discordant-identity': 'Il codice fiscale del paziente nel documento è diverso da quello della riga.',
    'mixed-identity': 'Il documento si riferisce a più persone.',
    'source-changed': 'Il documento è cambiato. Rileggi la cartella.',
    'duplicate-review-required': 'Possibile doppione. Verifica la scheda esistente.',
    'review-required': 'Il testo del documento non è leggibile.',
    'busy': 'Lettura del documento occupata. Riprova.',
};

export async function readDossierBatchOutcome(operation: 'receipt' | 'batch-revoke', scope: string, commandId: string,
    signal: AbortSignal, bytes: Uint8Array | null = null): Promise<DossierBatchOutcome> {
    try {
        const response = await requestPatientDocument({ operation, commandId }, AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
        const result = response.status === 200 ? parsePatientDocumentReceipt(response.body) : null;
        if (result?.outcome === 'retired') {
            dossierBatchReceipts.clear(scope, commandId);
            return { kind: 'rejected', reason: operation === 'batch-revoke' ? 'Lavorazione ritirata.' : 'La conferma è scaduta o i dati sono cambiati.' };
        }
        if (result?.outcome === 'applied') {
            dossierBatchReceipts.clear(scope, commandId);
            return await appliedOutcome(result, signal, bytes);
        }
    } catch { return { kind: 'uncertain', commandId }; }
    return { kind: 'uncertain', commandId };
}

async function appliedOutcome(receipt: { patientId: string; attachmentId: string }, signal: AbortSignal, bytes: Uint8Array | null): Promise<DossierBatchOutcome> {
    const verification = await db.verifyPatientDocumentAttachment(receipt.attachmentId, receipt.patientId, bytes,
        AbortSignal.any([signal, AbortSignal.timeout(30_000)])).catch(() => 'failed');
    return verification === 'failed'
        ? { kind: 'created', patientId: receipt.patientId, warning: 'Allegato da verificare.' }
        : { kind: 'created', patientId: receipt.patientId };
}

export async function createDossierBatchPatient(batchId: string, scope: string, row: DossierBatchRow, source: DossierDraftSource,
    signal: AbortSignal): Promise<DossierBatchOutcome> {
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    let commandId: string | undefined;
    try {
        bytes = new Uint8Array(await source.file.read());
        signal.throwIfAborted();
        const sealed = await db.sealPatientDocumentSource(bytes, source.fileName);
        const response = await requestPatientDocument({ operation: 'batch-stage', batchId, row, source: sealed },
            AbortSignal.any([signal, AbortSignal.timeout(75_000)]))
            .finally(() => sealed.fileKey.fill(0));
        if (response.status !== 200 || response.body?.status !== 'preview' || typeof response.body.commandId !== 'string') {
            const reason = response.body?.code === PATIENT_IDENTIFIER_DUPLICATE.code ? 'Codice fiscale già presente nell’ambulatorio.'
                : ROW_REFUSALS[String(response.body?.status)] ?? 'Preparazione non riuscita. Rivedi il lotto.';
            return { kind: 'rejected', reason };
        }
        commandId = response.body.commandId;
        if (!dossierBatchReceipts.write(scope, commandId)) {
            await requestPatientDocument({ operation: 'batch-revoke', commandId }, signal).catch(() => null);
            return { kind: 'rejected', reason: 'Il browser non ha conservato il riferimento della lavorazione.' };
        }
        const executed = await requestPatientDocument({ operation: 'batch-execute', batchId, commandId },
            AbortSignal.any([signal, AbortSignal.timeout(15_000)])).catch(() => null);
        const result = executed?.status === 200 ? parsePatientDocumentReceipt(executed.body) : null;
        if (result?.outcome === 'applied') {
            dossierBatchReceipts.clear(scope, commandId);
            return await appliedOutcome(result, signal, bytes);
        }
        return await readDossierBatchOutcome('receipt', scope, commandId, signal, bytes);
    } catch {
        return commandId ? { kind: 'uncertain', commandId } : { kind: 'rejected', reason: 'Documento non preparato.' };
    } finally { bytes?.fill(0); }
}
