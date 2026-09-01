import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// --- Users (Auth) ---
export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    username: text('username').notNull().unique(),
    displayName: text('display_name'),
    ambulatoryName: text('ambulatory_name'),
    role: text('role').default('user'),
    passwordHash: text('password_hash').notNull(),
    encryptedMasterKey: text('encrypted_master_key').notNull(),
    salt: text('salt').notNull(),
    /* @Codex */
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    /* @Codex */
    firstFailedLoginAt: integer('first_failed_login_at', { mode: 'timestamp' }),
    /* @Codex */
    lockedUntil: integer('locked_until', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

/* @Codex */
export const physicianReviewAttestations = sqliteTable('physician_review_attestations', {
    actorRef: text('actor_ref').primaryKey().references(() => users.id).notNull(),
    schemaVersion: text('schema_version').notNull(),
    capability: text('capability').notNull(),
    status: text('status').notNull(),
    attestationVersion: integer('attestation_version').notNull(),
    policyVersion: text('policy_version').notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

/* @Codex */
export const headlessSoapActiveRoleAttestations = sqliteTable('headless_soap_active_role_attestations', {
    attestationRef: text('attestation_ref').primaryKey().notNull(),
    actorRef: text('actor_ref').references(() => users.id, { onDelete: 'restrict' }).notNull().unique(),
    schemaVersion: text('schema_version').notNull(),
    role: text('role').notNull(),
    operationId: text('operation_id').notNull(),
    policyVersion: text('policy_version').notNull(),
    status: text('status').notNull(),
    attestationVersion: integer('attestation_version').notNull(),
    issuerRef: text('issuer_ref'),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    activatedAt: integer('activated_at', { mode: 'timestamp' }),
    revocationGeneration: integer('revocation_generation').notNull().default(0),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// --- Ambulatories (Multi-Tenant) ---
export const ambulatories = sqliteTable('ambulatories', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    address: text('address'),
    parentId: text('parent_id'), // Hierarchy
    type: text('type').default('live'), // 'live' | 'test'
    description: text('description'),
    isDefault: integer('is_default', { mode: 'boolean' }).default(false),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// --- Patients ---
export const patients = sqliteTable('patients', {
    id: text('id').primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    taxCode: text('tax_code').notNull(),
    birthDate: integer('birth_date', { mode: 'timestamp' }),
    address: text('address'),
    phone: text('phone'),
    caregiver: text('caregiver'),
    /* @Codex */
    exemptions: text('exemptions'),
    /* @Codex */
    diagnoses: text('diagnoses'),
    /* @Codex */
    monitoringProfile: text('monitoring_profile'),
    /* @Codex */
    statusReason: text('status_reason'),
    notes: text('notes'),
    aiSummary: text('ai_summary'),
    // Ciclo di vita dell'insight (S1): quando generato + hash del contesto clinico.
    aiSummaryGeneratedAt: integer('ai_summary_generated_at', { mode: 'timestamp' }),
    aiSummaryContextHash: text('ai_summary_context_hash'),
    documentInsights: text('document_insights'), // JSON array of DocumentInsight
    isAdi: integer('is_adi', { mode: 'boolean' }).default(false),
    isArchived: integer('is_archived', { mode: 'boolean' }).default(false),
    /* @Codex */
    archiveReason: text('archive_reason'),
    /* @Codex */
    archiveNote: text('archive_note'),
    // WUL-306 (ADR 0066): soft-delete tombstone, same lifecycle as entries/therapies/checkups
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
    deletionReason: text('deletion_reason'),
    /* @Codex */
    version: integer('version').notNull().default(1),
    ambulatoryId: text('ambulatory_id').references(() => ambulatories.id),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({
    // WUL-268 (STREAM A): secondary indices mirror the runtime guards in db-server.ts.
    deletedIdx: index('patients_deleted_idx').on(t.deletedAt),
    lastNameIdx: index('patients_last_name_idx').on(t.lastName),
}));

// --- Patient <-> Ambulatory (Many-to-Many) ---
export const patientsToAmbulatories = sqliteTable('patients_to_ambulatories', {
    patientId: text('patient_id').references(() => patients.id, { onDelete: 'cascade' }).notNull(),
    ambulatoryId: text('ambulatory_id').references(() => ambulatories.id, { onDelete: 'cascade' }).notNull(),
    assignedAt: integer('assigned_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({
    pk: primaryKey({ columns: [t.patientId, t.ambulatoryId] }),
}));

// --- Clinical Entries ---
export const entries = sqliteTable('entries', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    type: text('type').notNull(),
    /* @Codex */
    title: text('title').notNull().default('Voce clinica'),
    date: integer('date', { mode: 'timestamp' }).notNull(),
    content: text('content').notNull(),
    /* @Codex */
    setting: text('setting'),
    /* @Codex */
    metadata: text('metadata'),
    /* @Codex */
    attachments: text('attachments'),
    /* @Codex */
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
    /* @Codex */
    deletionReason: text('deletion_reason'),
    /* @Codex */
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    /* @Codex */
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({
    // WUL-268 (STREAM A): mirrors runtime guards in db-server.ts.
    patientIdx: index('entries_patient_idx').on(t.patientId),
    patientDeletedIdx: index('entries_patient_deleted_idx').on(t.patientId, t.deletedAt),
    dateIdx: index('entries_date_idx').on(t.date),
}));

// --- Therapies ---
export const therapies = sqliteTable('therapies', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    drugName: text('drug_name').notNull(),
    /* @Codex */
    aic: text('aic'),
    /* @Codex */
    atc: text('atc'),
    /* @Codex */
    activePrinciple: text('active_principle'),
    dosage: text('dosage').notNull(),
    /* @Codex */
    motivation: text('motivation'),
    /* @Codex */
    diagnosisCode: text('diagnosis_code'),
    /* @Codex */
    diagnosisName: text('diagnosis_name'),
    status: text('status').notNull(),
    startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
    endDate: integer('end_date', { mode: 'timestamp' }),
    /* @Codex */
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    /* @Codex */
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    /* @Codex */
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
    /* @Codex */
    deletionReason: text('deletion_reason'),
}, (t) => ({
    // WUL-268 (STREAM A): mirrors runtime guards in db-server.ts.
    patientIdx: index('therapies_patient_idx').on(t.patientId),
    patientDeletedIdx: index('therapies_patient_deleted_idx').on(t.patientId, t.deletedAt),
}));

/* @Codex */
export const observations = sqliteTable('observations', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    codeSystem: text('code_system').notNull(),
    code: text('code').notNull(),
    display: text('display').notNull(),
    unitSystem: text('unit_system').notNull(),
    unitCode: text('unit_code').notNull(),
    value: text('value').notNull(),
    notes: text('notes'),
    observedAt: integer('observed_at', { mode: 'timestamp' }).notNull(),
    source: text('source').default('manual'),
    // S6: range di riferimento. refLow/refHigh solo se numerici, refText per range
    // grezzi/qualitativi ("< 200", "Negativo"). Non cifrati (metadati come value).
    refLow: text('ref_low'),
    refHigh: text('ref_high'),
    refText: text('ref_text'),
    /* @Codex Link esplicito e locale tra un risultato registrato e la prestazione attesa. */
    servicePrescriptionItemId: text('service_prescription_item_id').references(
        () => servicePrescriptionItems.id,
        { onDelete: 'set null' },
    ),
    /* @Codex */
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    /* @Codex */
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    /* @Codex */
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
    /* @Codex */
    deletionReason: text('deletion_reason'),
}, (t) => ({
    // WUL-268 (STREAM A): mirrors runtime guards in db-server.ts.
    patientIdx: index('observations_patient_idx').on(t.patientId),
    codeIdx: index('observations_code_idx').on(t.codeSystem, t.code),
    patientDeletedIdx: index('observations_patient_deleted_idx').on(t.patientId, t.deletedAt),
    servicePrescriptionItemIdx: index('observations_service_prescription_item_idx').on(t.servicePrescriptionItemId),
}));

/* @Codex */
export const prostheticPrescriptions = sqliteTable('prosthetic_prescriptions', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    prescribedAt: integer('prescribed_at', { mode: 'timestamp' }).notNull(),
    status: text('status').notNull().default('prescribed'),
    category: text('category').notNull().default('standard'),
    isoCode: text('iso_code'),
    description: text('description').notNull(),
    measures: text('measures'),
    clinicalReason: text('clinical_reason'),
    regionalPrescriptionId: text('regional_prescription_id'),
    supplier: text('supplier'),
    collaudoAt: integer('collaudo_at', { mode: 'timestamp' }),
    collaudoOutcome: text('collaudo_outcome'),
    source: text('source').notNull().default('manual'),
    documentRefs: text('document_refs'),
    notes: text('notes'),
    /* @Codex */
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

/* @Codex */
export const servicePrescriptions = sqliteTable('service_prescriptions', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    prescribedAt: integer('prescribed_at', { mode: 'timestamp' }).notNull(),
    status: text('status').notNull().default('prescribed'),
    category: text('category').notNull().default('other'),
    priority: text('priority'),
    codeSystem: text('code_system'),
    serviceCode: text('service_code'),
    serviceName: text('service_name').notNull(),
    clinicalQuestion: text('clinical_question'),
    provider: text('provider'),
    scheduledAt: integer('scheduled_at', { mode: 'timestamp' }),
    performedAt: integer('performed_at', { mode: 'timestamp' }),
    reportReceivedAt: integer('report_received_at', { mode: 'timestamp' }),
    outcomeNote: text('outcome_note'),
    requestReference: text('request_reference'),
    source: text('source').notNull().default('manual'),
    documentRefs: text('document_refs'),
    notes: text('notes'),
    /* @Codex */
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

/* @Codex */
export const servicePrescriptionItems = sqliteTable('service_prescription_items', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    prescriptionId: text('prescription_id').references(() => servicePrescriptions.id).notNull(),
    ordinal: integer('ordinal').notNull().default(0),
    status: text('status').notNull().default('prescribed'),
    category: text('category'),
    codeSystem: text('code_system'),
    serviceCode: text('service_code'),
    serviceName: text('service_name').notNull(),
    catalogEntryId: text('catalog_entry_id'),
    catalogDisplayName: text('catalog_display_name'),
    matchStatus: text('match_status').notNull().default('unmatched'),
    confidence: text('confidence'),
    evidence: text('evidence'),
    notes: text('notes'),
    scheduledAt: integer('scheduled_at', { mode: 'timestamp' }),
    performedAt: integer('performed_at', { mode: 'timestamp' }),
    reportReceivedAt: integer('report_received_at', { mode: 'timestamp' }),
    outcomeNote: text('outcome_note'),
    /* @Codex */
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

/* @Codex */
export const serviceCatalogEntries = sqliteTable('service_catalog_entries', {
    id: text('id').primaryKey(),
    codeSystem: text('code_system').notNull(),
    serviceCode: text('service_code').notNull(),
    displayName: text('display_name').notNull(),
    category: text('category').notNull().default('other'),
    branchCode: text('branch_code'),
    synonyms: text('synonyms'),
    source: text('source').notNull().default('manual'),
    version: text('version'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    importedAt: integer('imported_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

/* @Codex */
export const sissHandoffEvents = sqliteTable('siss_handoff_events', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    action: text('action').notNull(),
    moduleLabel: text('module_label').notNull(),
    reason: text('reason'),
    startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    outcome: text('outcome').notNull().default('started'),
    nextAction: text('next_action'),
    notes: text('notes'),
    correlationId: text('correlation_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

/* @Codex */
export const documentDiagnosisProposals = sqliteTable('document_diagnosis_proposals', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    sourceDocumentKey: text('source_document_key').notNull(),
    attachmentId: text('attachment_id'),
    documentInsightId: text('document_insight_id'),
    candidateKey: text('candidate_key').notNull(),
    payload: text('payload').notNull(),
    status: text('status').notNull().default('pending'),
    confidence: text('confidence').notNull(),
    decidedAt: integer('decided_at', { mode: 'timestamp' }),
    decisionActorType: text('decision_actor_type'),
    decisionActorRef: text('decision_actor_ref'),
    decisionPayload: text('decision_payload'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({
    patientIdx: index('document_diagnosis_proposals_patient_idx').on(t.patientId),
    patientStatusIdx: index('document_diagnosis_proposals_patient_status_idx').on(t.patientId, t.status),
    sourceCandidateUnique: uniqueIndex('document_diagnosis_proposals_source_candidate_unique').on(
        t.patientId,
        t.sourceDocumentKey,
        t.candidateKey,
    ),
}));

/* @Codex */
export const durableReviewRecords = sqliteTable('durable_review_records', {
    id: text('id').primaryKey(), patientRef: text('patient_ref').notNull(), reviewId: text('review_id').notNull().unique(), reviewRevision: integer('review_revision').notNull(),
    receiptRef: text('receipt_ref').notNull(), provenanceRef: text('provenance_ref').notNull(),
    receiptBinding: text('receipt_binding').notNull(), provenanceBinding: text('provenance_binding').notNull(),
    presentationVersion: text('presentation_version').notNull(), sealedCiphertext: text('sealed_ciphertext').notNull(), sealedDigest: text('sealed_digest').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

/* @Codex */
export const durableReviewPatientLinks = sqliteTable('durable_review_patient_links', {
    reviewId: text('review_id').primaryKey().references(() => durableReviewRecords.reviewId).notNull(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

/* @Codex */
export const durableReviewOperations = sqliteTable('durable_review_operations', {
    id: text('id').primaryKey(), reviewId: text('review_id').notNull(), idempotencyKey: text('idempotency_key').notNull(),
    operation: text('operation').notNull(), expectedReviewRevision: integer('expected_review_revision').notNull(), operationDigest: text('operation_digest').notNull(), recordSnapshot: text('record_snapshot').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({ reviewKeyUnique: uniqueIndex('durable_review_operations_review_key_unique').on(t.reviewId, t.idempotencyKey) }));

/* @Codex */
export const durableReviewCommandStates = sqliteTable('durable_review_command_states', {
    reviewId: text('review_id').primaryKey(), reviewState: text('review_state').notNull(), revision: integer('revision').notNull(), action: text('action').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

/* @Codex */
export const durableReviewCommandOperations = sqliteTable('durable_review_command_operations', {
    id: text('id').primaryKey(), reviewId: text('review_id').notNull(), idempotencyKey: text('idempotency_key').notNull(), commandDigest: text('command_digest').notNull(),
    resultSnapshot: text('result_snapshot').notNull(), auditEventId: text('audit_event_id').notNull(), createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({ reviewKeyUnique: uniqueIndex('durable_review_command_operations_review_key_unique').on(t.reviewId, t.idempotencyKey) }));

// --- Checkups / Appointments ---
export const checkups = sqliteTable('checkups', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    date: integer('date', { mode: 'timestamp' }).notNull(),
    title: text('title').notNull(),
    /* @Codex */
    notes: text('notes'),
    status: text('status').default('pending'),
    /* @Codex */
    source: text('source'),
    /* @Codex */
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    /* @Codex */
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    /* @Codex */
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
    /* @Codex */
    deletionReason: text('deletion_reason'),
}, (t) => ({
    // WUL-268 (STREAM A): mirrors runtime guards in db-server.ts.
    patientIdx: index('checkups_patient_idx').on(t.patientId),
    patientDeletedIdx: index('checkups_patient_deleted_idx').on(t.patientId, t.deletedAt),
    dateIdx: index('checkups_date_idx').on(t.date),
}));

// --- Conversations (AI Chat) ---
export const conversations = sqliteTable('conversations', {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    isArchived: integer('is_archived', { mode: 'boolean' }).default(false),
    /* @Codex */
    isDeleted: integer('is_deleted', { mode: 'boolean' }).default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// --- Messages ---
export const messages = sqliteTable('messages', {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    metadata: text('metadata'),
    attachmentType: text('attachment_type'),
    attachmentBase64: text('attachment_base64'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({
    // WUL-268 (STREAM A): mirrors runtime guards in db-server.ts.
    conversationIdx: index('messages_conversation_idx').on(t.conversationId),
}));

// --- Settings ---
export const settings = sqliteTable('settings', {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
});

/* @Codex */
export const auditEvents = sqliteTable('audit_events', {
    eventId: text('event_id').primaryKey(),
    schemaVersion: integer('schema_version').notNull().default(1),
    eventType: text('event_type').notNull(),
    occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
    outcome: text('outcome').notNull(),
    actorType: text('actor_type').notNull(),
    actorRef: text('actor_ref').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectRef: text('subject_ref'),
    sourceSurface: text('source_surface').notNull(),
    requestId: text('request_id'),
    redactedMetadata: text('redacted_metadata'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

/* @Codex */
export const headlessSoapEntryCommits = sqliteTable('headless_soap_entry_commits', {
    idempotencyKey: text('idempotency_key').primaryKey().notNull(),
    approvalRef: text('approval_ref').notNull(),
    authorizationProofDigest: text('authorization_proof_digest').notNull(),
    commandId: text('command_id').notNull(),
    entryId: text('entry_id').references(() => entries.id, { onDelete: 'cascade' }).notNull(),
    auditEventId: text('audit_event_id').references(() => auditEvents.eventId, { onDelete: 'restrict' }).notNull(),
    receiptRef: text('receipt_ref').notNull(),
    bindingSnapshot: text('binding_snapshot').notNull(),
    bindingDigest: text('binding_digest').notNull(),
    entryDigest: text('entry_digest').notNull(),
    auditSnapshot: text('audit_snapshot').notNull(),
    auditDigest: text('audit_digest').notNull(),
    receiptSnapshot: text('receipt_snapshot').notNull(),
    receiptDigest: text('receipt_digest').notNull(),
    committedAt: integer('committed_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    commandIdUnique: uniqueIndex('headless_soap_entry_commits_command_id_unique').on(table.commandId),
    entryIdUnique: uniqueIndex('headless_soap_entry_commits_entry_id_unique').on(table.entryId),
    auditEventIdUnique: uniqueIndex('headless_soap_entry_commits_audit_event_id_unique').on(table.auditEventId),
    receiptRefUnique: uniqueIndex('headless_soap_entry_commits_receipt_ref_unique').on(table.receiptRef),
}));

// --- Attachments ---
export const attachments = sqliteTable('attachments', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    size: integer('size').notNull(),
    path: text('path').notNull(),
    data: text('data'), // Base64 content
    /* @Codex */
    summarySnapshot: text('summary_snapshot'),
    /* @Codex */
    parseEvidenceArtifactSnapshot: text('parse_evidence_artifact_snapshot'),
    ocrQueueState: text('ocr_queue_state'),
    ocrQueueReason: text('ocr_queue_reason'),
    ocrQueueUpdatedAt: integer('ocr_queue_updated_at', { mode: 'timestamp' }),
    ocrReplayArtifactSnapshot: text('ocr_replay_artifact_snapshot'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    /* @Codex */
    documentSourceRef: text('document_source_ref').notNull().unique(),
    /* @Codex */
    documentRevision: integer('document_revision').notNull(),
    /* @Codex */
    documentFreshnessEpoch: integer('document_freshness_epoch').notNull(),
}, (t) => ({
    // WUL-268 (STREAM A): mirrors runtime guards in db-server.ts.
    patientIdx: index('attachments_patient_idx').on(t.patientId),
}));

// --- AIFA Drugs (Local Cache) ---
export const drugs = sqliteTable('drugs', {
    aic: text('aic').primaryKey(),
    name: text('name').notNull(),
    activePrinciple: text('active_principle'),
    company: text('company'),
    packaging: text('packaging'),
    class: text('class'),
    price: integer('price'), // stored as cents or float? using integer for simplicity or check import logic
    atc: text('atc'),
    /* @Codex */
    aicSearch: text('aic_search'),
    /* @Codex */
    nameSearch: text('name_search'),
    /* @Codex */
    activePrincipleSearch: text('active_principle_search'),
    /* @Codex */
    packagingSearch: text('packaging_search'),
}, (t) => ({
    /* @Codex: aic is already indexed by the primary key; these cover accent-folded prefix search. */
    aicSearchIdx: index('drugs_aic_search_idx').on(t.aicSearch),
    nameSearchIdx: index('drugs_name_search_idx').on(t.nameSearch),
    activePrincipleSearchIdx: index('drugs_active_principle_search_idx').on(t.activePrincipleSearch),
}));

/* @Codex */
export const exemptions = sqliteTable('exemptions', {
    code: text('code').primaryKey(),
    description: text('description').notNull(),
    type: text('type'),
    source: text('source'),
    startDate: integer('start_date', { mode: 'timestamp' }),
    endDate: integer('end_date', { mode: 'timestamp' }),
    isPharma: integer('is_pharma', { mode: 'boolean' }),
    isSpecialist: integer('is_specialist', { mode: 'boolean' }),
    isNational: integer('is_national', { mode: 'boolean' }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});
