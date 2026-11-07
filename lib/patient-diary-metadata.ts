import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { isEncryptedFieldValue, isLockedDataPlaceholder } from './locked-field-guard';

type DiaryMetadata = { state: 'absent' | 'unreadable'; value?: undefined }
    | { state: 'readable'; value: Record<string, unknown> };

const TEXT_FIELDS = ['authorName', 'author', 'signedBy', 'sourceLabel', 'source', 'workflowStatus', 'status'];

/** Read the existing object/JSON metadata forms without inventing a write or decrypt path. */
export function readPatientDiaryMetadata(input: unknown): DiaryMetadata {
    if (input === null || input === undefined || input === '') return { state: 'absent' };
    let value = input;
    if (typeof value === 'string') {
        if (!value.trim()) return { state: 'absent' };
        if (isEncryptedFieldValue(value) || isLockedDataPlaceholder(value)) return { state: 'unreadable' };
        try { value = JSON.parse(value); } catch { return { state: 'unreadable' }; }
    }
    if (value === null) return { state: 'absent' };
    if (typeof value !== 'object' || Array.isArray(value)) return { state: 'unreadable' };
    const record = value as Record<string, unknown>;
    for (const field of TEXT_FIELDS) {
        const text = record[field];
        if (text === null || text === undefined || text === '') continue;
        if (typeof text !== 'string' || isEncryptedFieldValue(text.trim()) || isLockedDataPlaceholder(text.trim())) return { state: 'unreadable' };
    }
    return { state: 'readable', value: record };
}

export function patientDiarySource(metadata: unknown, setting?: string): string {
    const read = readPatientDiaryMetadata(metadata);
    if (read.state === 'unreadable') return 'Fonte non disponibile';
    for (const key of ['sourceLabel', 'source']) {
        const value = read.value?.[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return ({ home: 'Assistenza domiciliare', hospital: 'Ospedale', ambulatory: 'Ambulatorio' } as Record<string, string>)[setting ?? ''] ?? 'Diario locale';
}

export type PatientDiaryWorkflowState = 'draft' | 'signed' | 'recorded' | 'unrecognized' | 'unreadable';

export const PATIENT_DIARY_WORKFLOW_LABELS: Readonly<Record<PatientDiaryWorkflowState, string>> = {
    draft: 'Bozza',
    signed: 'Firmata',
    recorded: 'Registrata',
    unrecognized: 'Stato non riconosciuto',
    unreadable: 'Stato non leggibile',
};

const WORKFLOW_VALUES: Readonly<Record<string, PatientDiaryWorkflowState>> = {
    draft: 'draft', bozza: 'draft',
    signed: 'signed', firmata: 'signed',
    registered: 'recorded', registrata: 'recorded',
};

/**
 * Stato di lavorazione di una voce di diario, unica regola per cockpit e
 * timeline (WUL-801). Senza valore la voce è quella salvata nell'archivio:
 * «Registrata» descrive il salvataggio, non una deduzione dal testo. Un valore
 * presente ma sconosciuto non diventa mai uno stato clinico certo.
 */
export function patientDiaryWorkflowState(metadata: unknown): PatientDiaryWorkflowState {
    const read = readPatientDiaryMetadata(metadata);
    if (read.state === 'unreadable') return 'unreadable';
    for (const key of ['workflowStatus', 'status']) {
        const value = read.value?.[key];
        if (typeof value === 'string' && value.trim()) {
            return WORKFLOW_VALUES[value.trim().toLocaleLowerCase('it-IT')] ?? 'unrecognized';
        }
    }
    return 'recorded';
}

export function patientDiaryRegistration(entry: { recordedBy?: string | null; createdAt?: Date | string | null }): string {
    const author = entry.recordedBy?.trim();
    const name = author && !isEncryptedFieldValue(author) && !isLockedDataPlaceholder(author) ? ` da ${author}` : '';
    const createdAt = entry.createdAt ? new Date(entry.createdAt) : null;
    const timestamp = createdAt && Number.isFinite(createdAt.getTime())
        ? ` il ${format(createdAt, 'dd MMMM yyyy', { locale: it })} alle ${format(createdAt, 'HH:mm', { locale: it })}` : '';
    return `Registrata${name}${timestamp}`;
}
