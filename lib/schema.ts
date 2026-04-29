import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
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

// --- Ambulatories (Multi-Tenant) ---
export const ambulatories = sqliteTable('ambulatories', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    address: text('address'),
    parentId: text('parent_id'), // Hierarchy
    type: text('type').default('live'), // 'live' | 'test'
    description: text('description'),
    isDefault: integer('is_default', { mode: 'boolean' }).default(false),
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
    documentInsights: text('document_insights'), // JSON array of DocumentInsight
    isAdi: integer('is_adi', { mode: 'boolean' }).default(false),
    isArchived: integer('is_archived', { mode: 'boolean' }).default(false),
    /* @Codex */
    version: integer('version').notNull().default(1),
    ambulatoryId: text('ambulatory_id').references(() => ambulatories.id),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

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
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    /* @Codex */
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

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
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

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
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

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
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

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
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

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
});

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
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

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
});

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
