import Dexie, { type EntityTable } from 'dexie';

// --- Interfaces ---

export interface Patient {
    id: string;
    firstName: string;
    lastName: string;
    taxCode: string;
    birthDate?: Date;
    address: string;
    phone: string;
    caregiver?: string;
    notes?: string;
    aiSummary?: string;
    monitoringProfile: MonitoringProfile;
    statusHistory?: StatusChange[];
    isAdi?: boolean;
    diagnoses?: Diagnosis[]; // ICD-9/10 Codes
    createdAt: Date;
    updatedAt: Date;
    // Deletion & Archive
    deletedAt?: Date;
    deletionReason?: string;
    isArchived?: boolean;
    archiveReason?: 'assigned_mmg' | 'deceased' | 'other';
    archiveNote?: string;
}

export type MonitoringProfile = 'taken_in_charge' | 'extemporaneous';

export interface Diagnosis {
    code: string;
    description: string;
    system: 'ICD-9' | 'ICD-10' | 'ICD-11';
    date: Date;
}

export interface StatusChange {
    date: Date;
    status: MonitoringProfile;
    reason: string;
}

export type ClinicalEntryType = 'visit' | 'remote' | 'note' | 'scale';

export interface ClinicalEntry {
    id: string;
    patientId: string;
    type: ClinicalEntryType;
    date: Date;
    content: string;
    setting?: 'ambulatory' | 'home'; // Context: Where was this done?
    metadata?: Record<string, unknown>;
    attachments: string[];
    // Soft Delete fields
    deletedAt?: Date;
    deletionReason?: string;
    createdAt: Date;
}

export interface Attachment {
    id: string;
    patientId: string;
    name: string;
    type: string;
    data: Blob;
    summarySnapshot?: string; // Cache of what was extracted from this file
    source?: 'visit' | 'manual'; // Origin of the file
    createdAt: Date;
}

export type TherapyStatus = 'active' | 'suspended' | 'ended';

export interface Therapy {
    id: string;
    patientId: string;
    drugName: string;         // Nome Commerciale
    activePrinciple?: string; // Principio Attivo
    dosage: string;           // Posologia
    motivation?: string;      // Motivazione / Note

    // Structured Data (FHIR/Coding)
    diagnosisCode?: string; // ICD-11 Linked Code
    diagnosisName?: string; // ICD-11 Diagnosis Description
    atcCode?: string;       // Anatomical Therapeutic Chemical code
    aicCode?: string;       // AIC (Italian Marketing Authorization)

    startDate: Date;
    endDate?: Date;
    status: TherapyStatus;
    // Soft Delete fields
    deletedAt?: Date;
    deletionReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface Checkup {
    id: string;
    patientId: string;
    date: Date;
    title: string;
    notes?: string;
    status: 'pending' | 'completed' | 'cancelled';
    source: 'manual' | 'ai_suggestion';
    createdAt: Date;
}

export interface Conversation {
    id: string;
    title: string;
    patientId?: string; // Optional link to a patient context
    isArchived?: boolean;
    updatedAt: Date;
    createdAt: Date;
}

export interface Message {
    id: string;
    conversationId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    attachmentBase64?: string; // For images
    attachmentType?: 'image' | 'file';
    metadata?: {
        latencyMs?: number;
        tokensIn?: number;
        tokensOut?: number;
        model?: string;
        reasoning?: string; // Parsed chain of thought
        contextUsed?: string; // "YES" | "NO" for debugging
    };
    createdAt: Date;
}

export interface AifaDrug {
    aic: string;              // Codice AIC (Primary Key)
    name: string;             // Nome Commerciale + Confezione (es. "TACHIPIRINA*30CPR 500MG")
    activePrinciple: string;  // Principio Attivo
    company: string;          // Azienda
    price?: number;
    class?: string;            // Fascia (A, C, H)
    packaging?: string;
    atc?: string;
    equivalenceGroup?: string; // Gruppo di equivalenza
    updatedAt: Date;
}

// --- Database Class ---

const db = new Dexie('MedicalRecordDB') as Dexie & {
    patients: EntityTable<Patient, 'id'>;
    entries: EntityTable<ClinicalEntry, 'id'>;
    attachments: EntityTable<Attachment, 'id'>;
    therapies: EntityTable<Therapy, 'id'>;
    checkups: EntityTable<Checkup, 'id'>;
    conversations: EntityTable<Conversation, 'id'>;
    messages: EntityTable<Message, 'id'>;
    drugs: EntityTable<AifaDrug, 'aic'>;
};

// Schema definition
db.version(3).stores({
    patients: 'id, lastName, taxCode, isAdi, deletedAt, isArchived',
    entries: 'id, patientId, date, type',
    attachments: 'id, patientId',
    therapies: 'id, patientId, status',
    checkups: 'id, patientId, date, status'
});

db.version(4).stores({
    conversations: 'id, patientId, updatedAt',
    messages: 'id, conversationId'
}).upgrade(() => {
    // Migration logic if needed, usually empty for simple additions
});

// AIFA Drug DB Migration
db.version(5).stores({
    drugs: 'aic, name, activePrinciple' // Indexed for search
});


export { db };
