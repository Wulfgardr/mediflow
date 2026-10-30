import { COMMAND_UUID } from './therapy-status-command-contract';

export type PatientDocumentCreateJournal = Readonly<{
    commandId: string; archiveGeneration: string; ambulatoryId: string;
    patientId: string | null; sourceId: string | null;
}>;
export function parsePatientDocumentCreateJournal(value: unknown): PatientDocumentCreateJournal | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as PatientDocumentCreateJournal;
    const keys = ['commandId', 'archiveGeneration', 'ambulatoryId', 'patientId', 'sourceId'];
    if (Object.keys(row).length !== keys.length || !keys.every(key => Object.hasOwn(row, key))
        || ![row.commandId, row.archiveGeneration].every(id => typeof id === 'string' && COMMAND_UUID.test(id))
        || typeof row.ambulatoryId !== 'string' || row.ambulatoryId.length < 1 || row.ambulatoryId.length > 128
        || /[\u0000-\u0020\u007f]/u.test(row.ambulatoryId)
        || ![row.patientId, row.sourceId].every(id => id === null || (typeof id === 'string' && COMMAND_UUID.test(id)))
        || (row.patientId === null) !== (row.sourceId === null)) return null;
    return Object.freeze({ ...row });
}
