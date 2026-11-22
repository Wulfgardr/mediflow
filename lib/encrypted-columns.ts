export const ENCRYPTED_COLUMNS_BY_TABLE = {
    patients: [
        'address',
        'phone',
        'caregiver',
        'exemptions',
        'diagnoses',
        'allergies',
        'statusReason',
        'notes',
        'aiSummary',
        'documentInsights',
        'archiveReason',
        'archiveNote',
        'deletionReason',
    ],
    entries: [
        'title',
        'content',
        'metadata',
        'attachments',
        'deletionReason',
    ],
    entry_revisions: [
        'title',
        'content',
    ],
    therapies: [
        'motivation',
        'deletionReason',
    ],
    checkups: [
        'notes',
        'deletionReason',
    ],
    observations: [
        'notes',
        'deletionReason',
    ],
    prosthetic_prescriptions: [
        'description',
        'measures',
        'clinicalReason',
        'regionalPrescriptionId',
        'supplier',
        'collaudoOutcome',
        'documentRefs',
        'notes',
    ],
    service_prescriptions: [
        'serviceName',
        'clinicalQuestion',
        'provider',
        'outcomeNote',
        'requestReference',
        'documentRefs',
        'notes',
    ],
    service_prescription_items: [
        'serviceName',
        'catalogDisplayName',
        'evidence',
        'notes',
        'outcomeNote',
    ],
    siss_handoff_events: [
        'reason',
        'nextAction',
        'notes',
        'correlationId',
    ],
    conversations: [
        'title',
    ],
    messages: [
        'content',
        'metadata',
        'attachmentBase64',
    ],
    attachments: [
        'name',
        'path',
        'data',
        'summarySnapshot',
        'parseEvidenceArtifactSnapshot',
    ],
} as const;

export type EncryptedFieldsTable = keyof typeof ENCRYPTED_COLUMNS_BY_TABLE;
export type EncryptedColumnName<T extends EncryptedFieldsTable> = (typeof ENCRYPTED_COLUMNS_BY_TABLE)[T][number];
