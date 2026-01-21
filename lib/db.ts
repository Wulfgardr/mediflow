import Dexie, { type EntityTable } from 'dexie';

// --- Interfaces ---

export interface AppSetting {
    key: string;
    value: string;
}


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

// --- Database Class ---

import { encryptData, decryptData } from './security';

// Fields that should be encrypted for each table
const ENCRYPTED_FIELDS: Record<string, string[]> = {
    patients: ['address', 'phone', 'caregiver', 'notes', 'aiSummary', 'archiveNote', 'deletionReason'],
    entries: ['content', 'deletionReason'],
    therapies: ['motivation', 'deletionReason'], // We keep drugName visible for listing? Maybe encrypt everything sensitive.
    checkups: ['notes'],
    conversations: ['title'], // Messages are complex, let's treat them separately or encrypt content
    messages: ['content', 'reasoning']
};

class MedicalDatabase extends Dexie {
    patients!: EntityTable<Patient, 'id'>;
    entries!: EntityTable<ClinicalEntry, 'id'>;
    attachments!: EntityTable<Attachment, 'id'>;
    therapies!: EntityTable<Therapy, 'id'>;
    checkups!: EntityTable<Checkup, 'id'>;
    conversations!: EntityTable<Conversation, 'id'>;
    messages!: EntityTable<Message, 'id'>;
    drugs!: EntityTable<AifaDrug, 'aic'>;
    settings!: EntityTable<AppSetting, 'key'>;

    private masterKey: CryptoKey | null = null;

    constructor() {
        super('MedicalRecordDB');

        // Schema definition
        this.version(3).stores({
            patients: 'id, lastName, taxCode, isAdi, deletedAt, isArchived',
            entries: 'id, patientId, date, type',
            attachments: 'id, patientId',
            therapies: 'id, patientId, status',
            checkups: 'id, patientId, date, status'
        });

        this.version(4).stores({
            conversations: 'id, patientId, updatedAt',
            messages: 'id, conversationId'
        });

        // AIFA Drug DB Migration
        this.version(5).stores({
            drugs: 'aic, name, activePrinciple'
        });

        // User Profile & Settings
        this.version(6).stores({
            settings: 'key'
        });

        // --- Encryption Middleware ---
        this.use({
            stack: 'dbcore',
            name: 'encryptionMiddleware',
            create: (downlevelDatabase) => {
                return {
                    ...downlevelDatabase,
                    table: (tableName) => {
                        const downlevelTable = downlevelDatabase.table(tableName);
                        const fieldsToEncrypt = ENCRYPTED_FIELDS[tableName];

                        if (!fieldsToEncrypt) {
                            return downlevelTable;
                        }

                        return {
                            ...downlevelTable,
                            mutate: async (req) => {
                                if (!this.masterKey) {
                                    // If no key is set (e.g. locked), we shouldn't allow writing sensitive data
                                    // Or we throw error? For now, let's allow it but warn, or maybe just proceed (legacy mode?)
                                    // Better: FAIL SAFE. If app is open, key MUST be present.
                                    // But during initial load or specialized tasks it might be tricky.
                                    // Let's assume if authenticated -> key exists.
                                    if (req.type === 'add' || req.type === 'put') {
                                        console.warn(`Writing to ${tableName} without encryption key! Data will be plain text.`);
                                    }
                                    return downlevelTable.mutate(req);
                                }

                                if (req.type === 'delete' || req.type === 'deleteRange') {
                                    return downlevelTable.mutate(req);
                                }

                                const key = this.masterKey;

                                // Clone request to avoid mutating original objects in place unexpectedly
                                const values = req.values ? [...req.values] : [];

                                // Encrypt specified fields
                                const encryptedValues = await Promise.all(values.map(async (row: any) => {
                                    const encryptedRow = { ...row };
                                    for (const field of fieldsToEncrypt) {
                                        if (encryptedRow[field]) {
                                            try {
                                                const { iv, data } = await encryptData(encryptedRow[field], key);
                                                // Store format: "ENC:iv:ciphertext"
                                                encryptedRow[field] = `ENC:${iv}:${data}`;
                                            } catch (e) {
                                                console.error(`Failed to encrypt field ${field}`, e);
                                                // Fallback? Throw?
                                            }
                                        }
                                    }
                                    return encryptedRow;
                                }));

                                return downlevelTable.mutate({
                                    ...req,
                                    values: encryptedValues
                                });
                            },
                            get: async (req) => {
                                const result = await downlevelTable.get(req);
                                if (result && this.masterKey) {
                                    // Decrypt in place (or clone)
                                    const key = this.masterKey;
                                    for (const field of fieldsToEncrypt) {
                                        if (result[field] && typeof result[field] === 'string' && result[field].startsWith('ENC:')) {
                                            try {
                                                const parts = result[field].split(':');
                                                if (parts.length === 3) {
                                                    const iv = parts[1];
                                                    const ciphertext = parts[2];
                                                    result[field] = await decryptData(ciphertext, iv, key);
                                                }
                                            } catch (e) {
                                                console.error(`Decryption failed for ${tableName}.${field}`, e);
                                                result[field] = '[DECRYPTION ERROR]';
                                            }
                                        }
                                    }
                                }
                                return result;
                            },
                            query: async (req) => {
                                // Query returns a Promise<any> which is a cursor or array. 
                                // Dexie Middleware 'query' intercepts the *opening* of the cursor/collection.
                                // It's hard to intercept individual results here easily without wrapping the openCursor result.
                                // For simplicity in Dexie 4 middleware, we might intercept `openCursor` functionality if needed,
                                // but `query` method in DBCore usually returns a promise resolving to a collection/result.

                                // Actually, for 'getAll' (which uses query internally in some cases) or 'toArray', 
                                // interception is complex at DBCore level for *reading* lists.

                                // STRATEGY: We will rely on higher-level Hooks (useLiveQuery) if possible?
                                // No, middleware is best. 
                                // Let's try to intercept via `openCursor`.
                                return downlevelTable.query(req).then(res => {
                                    // This level is tricky. Let's simplify:
                                    // Most reads use `get` (single) or `openCursor` (iterative).
                                    // We need to override `openCursor`.
                                    return res;
                                });
                            },
                            openCursor: async (req) => {
                                const cursor = await downlevelTable.openCursor(req);
                                if (!cursor) return null;

                                const proxyCursor = Object.create(cursor);

                                // Shadow read-only getters with writable properties
                                Object.defineProperties(proxyCursor, {
                                    key: { value: cursor.key, writable: true, configurable: true },
                                    primaryKey: { value: cursor.primaryKey, writable: true, configurable: true },
                                    value: { value: cursor.value, writable: true, configurable: true }
                                });

                                const decryptCurrent = async () => {
                                    if (this.masterKey && proxyCursor.key) {
                                        const key = this.masterKey;
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        const valContainer = proxyCursor as any;

                                        if (valContainer.value) {
                                            for (const field of fieldsToEncrypt) {
                                                const val = valContainer.value[field];
                                                if (val && typeof val === 'string' && val.startsWith('ENC:')) {
                                                    try {
                                                        const parts = val.split(':');
                                                        if (parts.length === 3) {
                                                            valContainer.value[field] = await decryptData(parts[2], parts[1], key);
                                                        }
                                                    } catch (e) { }
                                                }
                                            }
                                        }
                                    }
                                };

                                await decryptCurrent();

                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                proxyCursor.continue = async (key?: any) => {
                                    await cursor.continue(key);
                                    if (cursor.key) {
                                        // Update shadowed properties manually since they are now values
                                        proxyCursor.key = cursor.key;
                                        proxyCursor.primaryKey = cursor.primaryKey;
                                        proxyCursor.value = cursor.value;
                                        await decryptCurrent();
                                    } else {
                                        // End of cursor - IMPORTANT: must clear properties to signal EOF
                                        proxyCursor.key = undefined;
                                        proxyCursor.primaryKey = undefined;
                                        proxyCursor.value = undefined;
                                    }
                                };

                                return proxyCursor;
                            }
                        };
                    }
                };
            }
        });
    }

    /**
     * Set the Master Key for encryption/decryption operations.
     * Should be called after successful PIN unlock.
     */
    setKey(key: CryptoKey) {
        this.masterKey = key;
    }

    isKeySet(): boolean {
        return !!this.masterKey;
    }
}

// --- Backup & Restore Utilities ---

import { SECURITY_CONFIG } from './security';

interface BackupData {
    meta: {
        version: number;
        timestamp: string;
        tables: string[];
    };
    security: {
        salt: string | null;
        encryptedMasterKey: string | null;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any[]>;
}

/**
 * Exports the entire database in its native encrypted state.
 * Uses low-level IDB to bypass decryption middleware.
 */
export async function exportRawDatabase(): Promise<string> {
    const backup: BackupData = {
        meta: {
            version: 1,
            timestamp: new Date().toISOString(),
            tables: []
        },
        security: {
            salt: localStorage.getItem(SECURITY_CONFIG.PIN_SALT_KEY),
            encryptedMasterKey: localStorage.getItem(SECURITY_CONFIG.ENCRYPTED_MASTER_KEY)
        },
        data: {}
    };

    if (!db.backendDB()) {
        await db.open();
    }

    // Use Dexie's backend DB (raw IDB) to read data without middleware
    const idb = db.backendDB();
    const tables = db.tables.map(t => t.name);
    backup.meta.tables = tables;

    // Use a transaction on the raw IDB
    const tx = idb.transaction(tables, 'readonly');

    await Promise.all(tables.map(async (tableName) => {
        return new Promise<void>((resolve, reject) => {
            const store = tx.objectStore(tableName);
            const request = store.getAll();

            request.onsuccess = () => {
                backup.data[tableName] = request.result;
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }));

    return JSON.stringify(backup);
}

/**
 * Wipes the current DB and imports data from a backup.
 * DANGER: This is destructive.
 */
export async function importRawDatabase(jsonString: string): Promise<void> {
    const backup: BackupData = JSON.parse(jsonString);

    // 1. Validate structure
    if (!backup.meta || !backup.security || !backup.data) {
        throw new Error("Invalid backup format");
    }

    // 2. Restore Security Keys first (needed for future access)
    // We don't need to decrypt them now, just store them.
    if (backup.security.salt) {
        localStorage.setItem(SECURITY_CONFIG.PIN_SALT_KEY, backup.security.salt);
    }
    if (backup.security.encryptedMasterKey) {
        localStorage.setItem(SECURITY_CONFIG.ENCRYPTED_MASTER_KEY, backup.security.encryptedMasterKey);
    }

    if (!db.isOpen()) {
        await db.open();
    }
    const idb = db.backendDB();
    const tables = backup.meta.tables;

    // Clear all tables first
    const clearTx = idb.transaction(tables, 'readwrite');
    await Promise.all(tables.map(table => {
        return new Promise<void>((resolve, reject) => {
            const store = clearTx.objectStore(table);
            const clearReq = store.clear();
            clearReq.onsuccess = () => resolve();
            clearReq.onerror = () => reject(clearReq.error);
        });
    }));

    // Import data
    const importTx = idb.transaction(tables, 'readwrite');
    await Promise.all(tables.map(async (table) => {
        if (!backup.data[table]) return;

        const rows = backup.data[table];
        if (rows.length === 0) return;

        const store = importTx.objectStore(table);

        for (const row of rows) {
            store.put(row);
        }
    }));

    // Wait for transaction completion
    return new Promise((resolve, reject) => {
        importTx.oncomplete = () => resolve();
        importTx.onerror = () => reject(importTx.error);
        importTx.onabort = () => reject(new Error("Transaction aborted"));
    });
}

const db = new MedicalDatabase();

export { db };
