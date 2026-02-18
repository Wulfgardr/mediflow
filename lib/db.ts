// API Client Facade for SQLite Backend
// Replaces Dexie DB with Fetch calls

import { encryptData, decryptData } from './security';

// Document insight from OCR + AI synthesis
export interface DocumentInsight {
    id: string;
    date: Date;
    fileName: string;
    rawMarkdown: string;  // DeepSeek-OCR output
    summary: string;      // MedGemma synthesis
    extractedData?: {
        diagnosis?: string;
        medications?: string[];
        labs?: Record<string, string>;
    };
}

export interface Patient {
    id: string;
    firstName: string;
    lastName: string;
    taxCode: string;
    birthDate?: Date;
    address: string;
    phone: string;
    isAdi?: boolean;
    isArchived?: boolean;
    caregiver?: string;
    updatedAt: Date;
    createdAt: Date;
    deletedAt?: Date;
    deletionReason?: string;
    aiSummary?: string;
    documentInsights?: DocumentInsight[]; // Last 3 scanned docs
    /* @Codex */
    exemptions?: string[];
    notes?: string;
    monitoringProfile?: string;
    diagnoses?: Diagnosis[];
    ambulatoryId?: string;
}

export interface PatientAmbulatory {
    patientId: string;
    ambulatoryId: string;
    assignedAt: Date;
}

export interface Ambulatory {
    id: string;
    name: string;
    address?: string;
    parentId?: string | null;
    type?: 'live' | 'test';
    description?: string;
    isDefault?: boolean;
    createdAt: Date;
}

export interface Diagnosis {
    code: string;
    description: string;
    system: string;
    date: Date;
}

export interface ClinicalEntry {
    id: string;
    patientId: string;
    date: Date;
    type: 'visit' | 'phone' | 'exam' | 'hospitalization' | 'access' | 'note' | 'scale' | 'remote';
    title: string;
    content: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date;
    deletionReason?: string;
    metadata?: Record<string, unknown>;
    attachments?: string[];
    setting?: 'home' | 'hospital' | 'ambulatory';
}

// Fields that should be encrypted for each table
const ENCRYPTED_FIELDS: Record<string, string[]> = {
    /* @Codex */
    patients: ['address', 'phone', 'caregiver', 'exemptions', 'diagnoses', 'statusReason', 'notes', 'aiSummary', 'documentInsights', 'archiveNote', 'deletionReason'],
    entries: ['content', 'deletionReason'],
    therapies: ['motivation', 'deletionReason'],
    checkups: ['notes'],
    conversations: ['title'],
    messages: ['content', 'reasoning'],
    /* @Codex */
    attachments: ['name', 'path', 'data', 'summarySnapshot']
};

class ApiTable<T> {
    private endpoint: string;
    private tableName: string;
    private getMasterKey: () => CryptoKey | null;

    constructor(endpoint: string, tableName: string, getMasterKey: () => CryptoKey | null) {
        this.endpoint = endpoint;
        this.tableName = tableName;
        this.getMasterKey = getMasterKey;
    }

    // --- Dexie Compatibility Query Builder ---

    filter(fn: (item: T) => boolean): ApiTable<T> {
        const clone = this.clone();
        clone._filterFn = fn;
        return clone;
    }

    limit(n: number): ApiTable<T> {
        const clone = this.clone();
        clone._limit = n;
        return clone;
    }

    reverse(): ApiTable<T> {
        const clone = this.clone();
        clone._reverse = true;
        return clone;
    }

    // Internal state for query building
    private _filterFn?: (item: T) => boolean;
    private _limit?: number;
    private _reverse?: boolean;

    private clone(): ApiTable<T> {
        const copy = new ApiTable<T>(this.endpoint, this.tableName, this.getMasterKey);
        copy._filterFn = this._filterFn;
        copy._limit = this._limit;
        copy._reverse = this._reverse;
        return copy;
    }

    async toArray(): Promise<T[]> {
        const res = await fetch(this.endpoint);
        /* @Codex */
        if (res.status === 401 || res.status === 403) return [];
        if (!res.ok) throw new Error(`Failed to fetch ${this.endpoint}`);
        const rawJson = await res.json();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data = await Promise.all(rawJson.map(async (item: any) => {
            const revived = this.reviveDates(item);
            return await this.decryptItem(revived);
        }));

        if (this._filterFn) {
            data = data.filter(this._filterFn);
        }

        if (this._reverse) {
            data.reverse();
        }

        if (this._limit) {
            data = data.slice(0, this._limit);
        }

        return data;
    }

    async count(): Promise<number> {
        return (await this.toArray()).length;
    }



    // Deprecated orderBy shim (just returns self for chaining)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    orderBy(field: string) {
        return this;
    }

    async get(id: string): Promise<T | undefined> {
        const res = await fetch(`${this.endpoint}/${id}`);
        if (res.status === 404) return undefined;
        if (!res.ok) throw new Error(`Failed to fetch item ${id}`);
        const item = this.reviveDates(await res.json());
        return await this.decryptItem(item);
    }

    async add(item: T): Promise<string> {
        const encryptedItem = await this.encryptItem(item);
        const res = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(encryptedItem)
        });
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Failed to add item: ${res.status} ${res.statusText} - ${errorText}`);
        }
        const data = await res.json();
        return data.id;
    }

    // Alias for Dexie compatibility (Upsert-like behavior)
    async put(item: T): Promise<string> {
        return this.add(item);
    }

    async update(id: string, changes: Partial<T>): Promise<void> {
        const encryptedChanges = await this.encryptItem(changes as T, true);
        const res = await fetch(`${this.endpoint}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(encryptedChanges)
        });
        if (!res.ok) throw new Error("Failed to update item");
    }

    async delete(id: string): Promise<void> {
        const res = await fetch(`${this.endpoint}/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            throw new Error(`Failed to delete item: ${res.status} ${res.statusText}`);
        }
    }

    async bulkDelete(ids: string[]): Promise<void> {
        await Promise.all(ids.map(id => this.delete(id)));
    }

    async bulkPut(items: T[]): Promise<void> {
        // Optimization: send as single batch only where backend supports it.
        if (this.tableName === 'drugs') {
            const res = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(items)
            });
            if (!res.ok) throw new Error("Failed to bulk add items");
            return;
        }

        /* @Codex */
        // Keep encryption path active for all other tables and avoid request storms on large imports.
        const chunkSize = 25;
        for (let i = 0; i < items.length; i += chunkSize) {
            const chunk = items.slice(i, i + chunkSize);
            await Promise.all(chunk.map(item => this.put(item)));
        }
    }

    async clear(): Promise<void> {
        const res = await fetch(this.endpoint, { method: 'DELETE' });
        if (res.ok) return;

        // @Codex: fallback for resources that expose only item-level DELETE.
        if (res.status !== 404 && res.status !== 405) {
            throw new Error(`Failed to clear table: ${res.status} ${res.statusText}`);
        }

        const items = await this.toArray();
        const ids = items
            .map((item) => this.getItemIdentifier(item))
            .filter((value): value is string => Boolean(value));

        if (items.length > 0 && ids.length !== items.length) {
            throw new Error(`Failed to clear table ${this.tableName}: some records do not expose a supported identifier`);
        }

        await Promise.all(ids.map((id) => this.delete(id)));
    }

    /* @Codex */
    private getItemIdentifier(item: unknown): string | null {
        if (!item || typeof item !== 'object') return null;

        const record = item as Record<string, unknown>;
        const candidate = record.id ?? record.key ?? record.code ?? record.aic;
        return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null;
    }

    // Helper to fix JSON date strings back to Date objects
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private reviveDates(obj: any): T {
        if (!obj) return obj;
        if (obj.createdAt) obj.createdAt = new Date(obj.createdAt);
        if (obj.updatedAt) obj.updatedAt = new Date(obj.updatedAt);
        if (obj.birthDate) obj.birthDate = new Date(obj.birthDate);
        if (obj.date) obj.date = new Date(obj.date);
        /* @Codex */
        if (obj.startDate) obj.startDate = new Date(obj.startDate);
        /* @Codex */
        if (obj.endDate) obj.endDate = new Date(obj.endDate);
        return obj;
    }

    // --- Encryption Helpers ---

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    private async encryptItem(item: any, isPartial = false): Promise<any> {
        const key = this.getMasterKey();
        if (!key || !item) return item;

        const fields = ENCRYPTED_FIELDS[this.tableName];
        if (!fields) return item;

        const copy = { ...item };

        for (const field of fields) {
            if (copy[field]) {
                try {
                    const { iv, data } = await encryptData(copy[field], key);
                    copy[field] = `ENC:${iv}:${data}`;
                } catch (e) {
                    console.error(`Failed to encrypt ${this.tableName}.${field}`, e);
                }
            }
        }
        return copy;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async decryptItem(item: any): Promise<any> {
        const key = this.getMasterKey();
        if (!key || !item) return item;

        const fields = ENCRYPTED_FIELDS[this.tableName];
        if (!fields) return item;

        for (const field of fields) {
            if (item[field] && typeof item[field] === 'string' && item[field].startsWith('ENC:')) {
                try {
                    const parts = item[field].split(':');
                    if (parts.length === 3) {
                        const iv = parts[1];
                        const ciphertext = parts[2];
                        item[field] = await decryptData(ciphertext, iv, key);
                    }
                } catch (e) {
                    console.error(`Decryption failed for ${this.tableName}.${field}`, e);
                    item[field] = '[LOCKED DATA]';
                }
            }
        }
        return item;
    }
}

class MedicalApiClient {
    private masterKey: CryptoKey | null = null;

    patients: ApiTable<Patient>;
    ambulatories: ApiTable<Ambulatory>;
    entries: ApiTable<ClinicalEntry>;
    therapies: ApiTable<Therapy>;
    conversations: ApiTable<Conversation>;
    messages: ApiTable<Message>;
    checkups: ApiTable<Checkup>;
    attachments: ApiTable<Attachment>;
    drugs: ApiTable<AifaDrug>;
    /* @Codex */
    exemptions: ApiTable<ExemptionCode>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: ApiTable<any>;
    patientsToAmbulatories: ApiTable<PatientAmbulatory>;

    constructor() {
        const getKey = () => this.masterKey;
        this.patients = new ApiTable<Patient>('/api/patients', 'patients', getKey);
        this.ambulatories = new ApiTable<Ambulatory>('/api/ambulatories', 'ambulatories', getKey);
        // ... (existing)
        this.entries = new ApiTable<ClinicalEntry>('/api/entries', 'entries', getKey);
        this.therapies = new ApiTable<Therapy>('/api/therapies', 'therapies', getKey);
        this.conversations = new ApiTable<Conversation>('/api/conversations', 'conversations', getKey);
        this.messages = new ApiTable<Message>('/api/messages', 'messages', getKey);
        this.checkups = new ApiTable<Checkup>('/api/checkups', 'checkups', getKey);
        this.attachments = new ApiTable<Attachment>('/api/attachments', 'attachments', getKey);
        this.drugs = new ApiTable<AifaDrug>('/api/drugs', 'drugs', getKey);
        /* @Codex */
        this.exemptions = new ApiTable<ExemptionCode>('/api/exemptions', 'exemptions', getKey);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.settings = new ApiTable<any>('/api/settings', 'settings', getKey);
        this.patientsToAmbulatories = new ApiTable<PatientAmbulatory>('/api/patients/assign', 'patients_to_ambulatories', getKey);
    }

    /* @Codex */
    setKey(key: CryptoKey | null) {
        this.masterKey = key;
    }

    isKeySet(): boolean {
        return !!this.masterKey;
    }
}

export const db = new MedicalApiClient();

export async function exportRawDatabase() {
    console.warn("Export raw database not yet implemented for SQLite adapter");
    return new Blob(["SQLite Backup Not Implemented"], { type: "text/plain" });
}

export async function importRawDatabase(jsonString: string) {
    try {
        const data = JSON.parse(jsonString);

        if (data.patients && Array.isArray(data.patients)) {
            await db.patients.bulkPut(data.patients);
        }
        if (data.entries && Array.isArray(data.entries)) {
            await db.entries.bulkPut(data.entries);
        }
        if (data.checkups && Array.isArray(data.checkups)) {
            await db.checkups.bulkPut(data.checkups);
        }
        if (data.therapies && Array.isArray(data.therapies)) {
            await db.therapies.bulkPut(data.therapies);
        }
        if (data.settings && Array.isArray(data.settings)) {
            await db.settings.bulkPut(data.settings);
        }
        console.log("Import completed");
    } catch (e) {
        console.error("Import failed", e);
        throw e;
    }
}

export interface Conversation {
    id: string;
    title: string;
    isArchived?: boolean;
    isDeleted?: boolean;
    updatedAt: Date;
    createdAt: Date;
}

export interface Message {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    attachmentType?: string;
    attachmentBase64?: string;
    createdAt: Date;
    metadata?: string;
    reasoning?: string;
}

export interface Checkup {
    id: string;
    patientId: string;
    date: Date;
    title: string;
    /* @Codex */
    type?: 'blood_pressure' | 'weight' | 'glycemia' | 'sp02' | 'heart_rate' | 'adl' | 'iadl' | 'tinetti' | 'pain';
    /* @Codex */
    value?: number;
    maxValue?: number;
    unit?: string;
    notes?: string;
    /* @Codex */
    status?: 'pending' | 'completed' | 'cancelled';
    /* @Codex */
    source?: 'manual' | 'ai_suggestion';
    createdAt: Date;
    updatedAt?: Date;
}

export interface Attachment {
    id: string;
    patientId: string;
    name: string;
    type: string; // MIME type
    size: number; // Bytes
    path: string;
    data?: string; // Base64 content for storage
    summarySnapshot?: string;
    createdAt: Date;
}

export interface AifaDrug {
    aic: string;
    name: string;
    activePrinciple?: string;
    company?: string;
    packaging?: string;
    class?: string;
    price?: number;
    atc?: string;
    updatedAt?: Date;
}

/* @Codex */
export interface ExemptionCode {
    code: string;
    description: string;
    type?: string;
    source?: string;
    startDate?: Date;
    endDate?: Date;
    isPharma?: boolean;
    isSpecialist?: boolean;
    isNational?: boolean;
    updatedAt?: Date;
}

export interface Therapy {
    id: string;
    patientId: string;
    drugName: string;
    /* @Codex */
    aic?: string;
    /* @Codex */
    atc?: string;
    activePrinciple?: string;
    dosage: string;
    motivation?: string;
    diagnosisCode?: string;
    diagnosisName?: string;
    /* @Codex */
    status: 'active' | 'suspended' | 'completed';
    startDate: Date;
    endDate?: Date;
    createdAt: Date;
    updatedAt?: Date;
}
