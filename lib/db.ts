// API Client Facade for SQLite Backend
// Replaces Dexie DB with Fetch calls

import { encryptData, decryptData } from './security/security';
import { notifyDbChange } from './live-query';
import {
    LOCKED_DATA_PLACEHOLDER,
    isLockedDataPlaceholder,
    isEncryptedFieldValue,
    rememberLockedCiphertext,
    takeLockedCiphertext,
} from './locked-field-guard';
/* @Codex */
import { isPatientVersionConflictPayload, type PatientVersionConflictPayload } from './patient-concurrency';
/* @Codex */
import type { EntryVersionConflictPayload } from './entry-concurrency';
/* @Codex */
import type { CheckupVersionConflictPayload } from './checkup-concurrency';
/* @Codex */
import { isVersionConflictPayload, type VersionConflictPayload } from './version-concurrency';
/* @Codex */
import { revivePatientStructuredFields } from './patient-structured-fields';
/* @Codex */
import type { BackupRestorePreflightResult } from './backup-restore-preflight';
/* @Codex */
import type { DocumentEvidencePack } from './domain/documents/document-evidence-pack';
import type { DocumentOcrQueueReason, DocumentOcrQueueState } from './domain/documents/document-ocr-queue';
/* @Codex */
import {
    buildApiTableFetchErrorMessage,
    isApiTableAuthUnavailableStatus,
    isApiTableUnavailableStatus,
    notifyApiAuthUnavailable,
} from './api-table-response';

/* @Codex */
export type ApiVersionConflictPayload =
    | PatientVersionConflictPayload
    | EntryVersionConflictPayload
    | CheckupVersionConflictPayload
    | VersionConflictPayload;

/* @Codex */
function isApiVersionConflictPayload(value: unknown): value is ApiVersionConflictPayload {
    if (isPatientVersionConflictPayload(value)) return true;
    if (isVersionConflictPayload(value)) return true;
    if (!value || typeof value !== 'object') return false;

    const payload = value as Record<string, unknown>;
    return payload.code === 'VERSION_CONFLICT'
        && (payload.entity === 'entry' || payload.entity === 'checkup')
        && typeof payload.recordId === 'string';
}
// Document insight from OCR + AI synthesis
/* @Codex */
export type DocumentQualityLevel = 'green' | 'yellow' | 'red';

/* @Codex */
export interface DocumentDiagnosisSuggestion {
    code: string;
    description: string;
    system: 'ICD-9' | 'ICD-10' | 'ICD-11';
    evidence?: string;
    confidence?: 'high' | 'medium' | 'low';
}

export interface DocumentInsight {
    id: string;
    /* @Codex */
    attachmentId?: string;
    date: Date;
    fileName: string;
    rawMarkdown: string;  // DeepSeek-OCR output
    summary: string;      // Qwen synthesis on top of OCR text
    /* @Codex */
    evidencePack?: DocumentEvidencePack;
    quality?: {
        level: DocumentQualityLevel;
        reason?: string;
    };
    extractedData?: {
        diagnosis?: string;
        medications?: string[];
        labs?: Record<string, string>;
        diagnoses?: DocumentDiagnosisSuggestion[];
    };
    autofill?: {
        appliedDiagnoses?: string[];
    };
    // Classificazione deterministica pre-LLM (router di classe) e data documento
    // dal nome file: segnali additivi, non alterano il flusso di sintesi.
    routedClass?: {
        classification: string;
        confidence: string;
        synthesis?: {
            kind: 'deterministic';
            rationale: string;
        };
    };
    documentDate?: string;
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
    archiveReason?: string | null;
    archiveNote?: string | null;
    aiSummary?: string;
    // Ciclo di vita dell'insight: quando e stato generato e hash deterministico del
    // contesto clinico su cui poggia. Non PHI (id + timestamp), quindi non cifrati.
    aiSummaryGeneratedAt?: Date;
    aiSummaryContextHash?: string;
    documentInsights?: DocumentInsight[]; // Last 3 scanned docs
    /* @Codex */
    exemptions?: string[];
    notes?: string;
    monitoringProfile?: string;
    diagnoses?: Diagnosis[];
    ambulatoryId?: string;
    /* @Codex */
    version?: number;
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
    version?: number;
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
    deletedAt?: Date | null;
    deletionReason?: string | null;
    /* @Codex */
    version?: number;
    metadata?: Record<string, unknown>;
    attachments?: string[];
    setting?: 'home' | 'hospital' | 'ambulatory';
}

/* @Codex */
export type SissHandoffOutcome = 'started' | 'completed' | 'blocked' | 'cancelled';

/* @Codex */
export interface SissHandoffEvent {
    id: string;
    patientId: string;
    action: string;
    moduleLabel: string;
    reason?: string;
    startedAt: Date;
    completedAt?: Date;
    outcome: SissHandoffOutcome;
    nextAction?: string;
    notes?: string;
    correlationId?: string;
    createdAt: Date;
    updatedAt: Date;
}

// Fields that should be encrypted for each table
const ENCRYPTED_FIELDS: Record<string, string[]> = {
    /* @Codex */
    patients: ['address', 'phone', 'caregiver', 'exemptions', 'diagnoses', 'statusReason', 'notes', 'aiSummary', 'documentInsights', 'archiveReason', 'archiveNote', 'deletionReason'],
    entries: ['title', 'content', 'metadata', 'attachments', 'deletionReason'],
    therapies: ['motivation', 'deletionReason'],
    checkups: ['notes', 'deletionReason'],
    /* @Codex */
    observations: ['notes', 'deletionReason'],
    /* @Codex */
    prosthetic_prescriptions: ['description', 'measures', 'clinicalReason', 'regionalPrescriptionId', 'supplier', 'collaudoOutcome', 'documentRefs', 'notes'],
    /* @Codex */
    service_prescriptions: ['serviceName', 'clinicalQuestion', 'provider', 'outcomeNote', 'requestReference', 'documentRefs', 'notes'],
    /* @Codex */
    service_prescription_items: ['serviceName', 'catalogDisplayName', 'evidence', 'notes', 'outcomeNote'],
    /* @Codex */
    siss_handoff_events: ['reason', 'nextAction', 'notes', 'correlationId'],
    conversations: ['title'],
    messages: ['content', 'metadata', 'attachmentBase64', 'reasoning'],
    /* @Codex */
    attachments: ['name', 'path', 'data', 'summarySnapshot', 'parseEvidenceArtifactSnapshot']
};

/* STREAM B: serializable list-query params consumed by the server list handlers.
   Only plaintext columns may appear in orderBy (the server whitelists them and
   returns 400 otherwise). metadataOnly is attachments-only. */
export interface ApiTableQuery {
    patientId?: string;
    conversationId?: string;
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDir?: 'asc' | 'desc';
    metadataOnly?: boolean;
    includeDeleted?: boolean;
}

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
    /* @Codex */
    private _includeDeleted?: boolean;
    /* STREAM B: server-side query params (kill the full-table fetch). Only set via
       .query(); serialized into buildListEndpoint so the server filters/sorts and
       we decrypt only what returns. */
    private _serverQuery?: ApiTableQuery;

    private clone(): ApiTable<T> {
        const copy = new ApiTable<T>(this.endpoint, this.tableName, this.getMasterKey);
        copy._filterFn = this._filterFn;
        copy._limit = this._limit;
        copy._reverse = this._reverse;
        copy._includeDeleted = this._includeDeleted;
        copy._serverQuery = this._serverQuery;
        return copy;
    }

    /* @Codex */
    includeDeleted(): ApiTable<T> {
        const clone = this.clone();
        clone._includeDeleted = true;
        return clone;
    }

    /* STREAM B: parametrized server-side query. Unlike .filter(fn) (a JS predicate
       that cannot be serialized), these params are pushed to the list endpoint so
       the server does the filtering/sorting/pagination and we only download and
       decrypt the rows that come back. Chainable + terminal-compatible with the
       Dexie shim: call .toArray() after. */
    query(params: ApiTableQuery): ApiTable<T> {
        const clone = this.clone();
        clone._serverQuery = { ...clone._serverQuery, ...params };
        return clone;
    }

    async toArray(): Promise<T[]> {
        const res = await fetch(this.buildListEndpoint(), { cache: 'no-store' });
        /* @Codex */
        if (isApiTableAuthUnavailableStatus(res.status)) {
            notifyApiAuthUnavailable(res.status);
            return [];
        }
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

    /* @Codex */
    private buildListEndpoint(): string {
        const search = new URLSearchParams();
        const q = this._serverQuery;
        if (q) {
            if (q.patientId) search.set('patientId', q.patientId);
            if (q.conversationId) search.set('conversationId', q.conversationId);
            if (typeof q.limit === 'number') search.set('limit', String(q.limit));
            if (typeof q.offset === 'number') search.set('offset', String(q.offset));
            if (q.orderBy) search.set('orderBy', q.orderBy);
            if (q.orderDir) search.set('orderDir', q.orderDir);
            if (q.metadataOnly) search.set('metadata', 'true');
        }
        // includeDeleted may come from either the chain shim or the query params.
        if (this._includeDeleted || q?.includeDeleted) search.set('includeDeleted', 'true');

        const qs = search.toString();
        if (!qs) return this.endpoint;
        const separator = this.endpoint.includes('?') ? '&' : '?';
        return `${this.endpoint}${separator}${qs}`;
    }



    // Deprecated orderBy shim (just returns self for chaining)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    orderBy(field: string) {
        return this;
    }

    async get(id: string): Promise<T | undefined> {
        const res = await fetch(`${this.endpoint}/${id}`, { cache: 'no-store' });
        /* @Codex */
        if (isApiTableAuthUnavailableStatus(res.status)) {
            notifyApiAuthUnavailable(res.status);
            return undefined;
        }
        if (isApiTableUnavailableStatus(res.status)) return undefined;
        if (!res.ok) throw new Error(buildApiTableFetchErrorMessage(this.endpoint, id, res.status, res.statusText));
        const item = this.reviveDates(await res.json());
        return await this.decryptItem(item);
    }

    /* @Codex */
    private buildVersionConflictError(payload: ApiVersionConflictPayload): ApiConflictError {
        return new ApiConflictError(payload);
    }

    /* @Codex */
    // STREAM B: scope the notification to this table so useLiveQuery subscribers
    // scoped to other tables don't needlessly re-run.
    private emitChange() {
        notifyDbChange(this.tableName);
    }

    /* @Codex */
    async add(item: T, options?: { suppressNotify?: boolean }): Promise<string> {
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
        if (!options?.suppressNotify) this.emitChange();
        return data.id;
    }

    /* @Codex */
    async prepareWritePayload(item: Partial<T>, isPartial = false): Promise<Partial<T>> {
        return this.encryptItem(item, isPartial);
    }

    // Alias for Dexie compatibility (Upsert-like behavior)
    /* @Codex */
    async put(item: T, options?: { suppressNotify?: boolean }): Promise<string> {
        return this.add(item, options);
    }

    /* @Codex */
    async update(id: string, changes: Partial<T>, options?: { suppressNotify?: boolean }): Promise<void> {
        /* @Codex */
        const maybeVersion = (changes as Record<string, unknown> | undefined)?.version;
        if (this.requiresVersionedWrite() && typeof maybeVersion !== 'number') {
            throw new Error(`Missing required version for ${this.versionedEntityLabel()} update`);
        }

        const encryptedChanges = await this.encryptItem(changes as T, true);
        const res = await fetch(`${this.endpoint}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(encryptedChanges)
        });
        if (!res.ok) {
            const payload = await res.json().catch(() => null);
            if (res.status === 409 && isApiVersionConflictPayload(payload)) {
                throw this.buildVersionConflictError(payload);
            }
            throw new Error("Failed to update item");
        }
        if (!options?.suppressNotify) this.emitChange();
    }

    /* @Codex */
    async delete(id: string, options?: { suppressNotify?: boolean; version?: number; deletionReason?: string }): Promise<void> {
        if (this.requiresVersionedWrite() && typeof options?.version !== 'number') {
            throw new Error(`Missing required version for ${this.versionedEntityLabel()} delete`);
        }

        const init: RequestInit = { method: 'DELETE' };
        const encryptsDeletionReason = ENCRYPTED_FIELDS[this.tableName]?.includes('deletionReason') ?? false;
        const rawDeletionReason = options?.deletionReason ?? (encryptsDeletionReason ? 'web-delete' : undefined);
        if (typeof options?.version === 'number' || typeof rawDeletionReason === 'string') {
            const deletionReason = typeof rawDeletionReason === 'string'
                ? await this.encryptDeleteField('deletionReason', rawDeletionReason)
                : undefined;
            init.headers = { 'Content-Type': 'application/json' };
            init.body = JSON.stringify({
                ...(typeof options?.version === 'number' ? { version: options.version } : {}),
                ...(typeof deletionReason === 'string' ? { deletionReason } : {}),
            });
        }

        const res = await fetch(`${this.endpoint}/${id}`, init);
        if (!res.ok) {
            const payload = await res.json().catch(() => null);
            if (res.status === 409 && isApiVersionConflictPayload(payload)) {
                throw this.buildVersionConflictError(payload);
            }
            throw new Error(`Failed to delete item: ${res.status} ${res.statusText}`);
        }
        if (!options?.suppressNotify) this.emitChange();
    }

    async bulkDelete(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        const versionsById = this.requiresVersionedWrite()
            ? await this.getVersionsByIdForDelete(ids)
            : new Map<string, number>();
        await Promise.all(ids.map(id => this.delete(id, {
            suppressNotify: true,
            version: versionsById.get(id),
        })));
        this.emitChange();
    }

    async bulkPut(items: T[]): Promise<void> {
        if (items.length === 0) return;

        // Optimization: send as single batch only where backend supports it.
        if (this.tableName === 'drugs') {
            const res = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(items)
            });
            if (!res.ok) throw new Error("Failed to bulk add items");
            this.emitChange();
            return;
        }

        /* @Codex */
        // Keep encryption path active for all other tables and avoid request storms on large imports.
        const chunkSize = 25;
        for (let i = 0; i < items.length; i += chunkSize) {
            const chunk = items.slice(i, i + chunkSize);
            await Promise.all(chunk.map(item => this.put(item, { suppressNotify: true })));
        }
        this.emitChange();
    }

    async clear(): Promise<void> {
        const res = await fetch(this.endpoint, { method: 'DELETE' });
        if (res.ok) {
            this.emitChange();
            return;
        }

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

        await Promise.all(items.map((item) => {
            const id = this.getItemIdentifier(item);
            if (!id) {
                throw new Error(`Failed to clear table ${this.tableName}: some records do not expose a supported identifier`);
            }
            const version = this.requiresVersionedWrite()
                ? this.getRecordVersion(item)
                : undefined;
            return this.delete(id, { suppressNotify: true, version });
        }));
        if (ids.length > 0) this.emitChange();
    }

    /* @Codex */
    private getItemIdentifier(item: unknown): string | null {
        if (!item || typeof item !== 'object') return null;

        const record = item as Record<string, unknown>;
        const candidate = record.id ?? record.key ?? record.code ?? record.aic;
        return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null;
    }

    /* @Codex */
    private getRecordVersion(item: unknown): number | undefined {
        if (!this.requiresVersionedWrite() || !item || typeof item !== 'object') return undefined;
        const record = item as Record<string, unknown>;
        return typeof record.version === 'number' ? record.version : undefined;
    }

    /* @Codex */
    private requiresVersionedWrite(): boolean {
        return this.tableName === 'patients'
            || this.tableName === 'ambulatories'
            || this.tableName === 'entries'
            || this.tableName === 'checkups'
            || this.tableName === 'therapies'
            || this.tableName === 'observations'
            || this.tableName === 'service_prescriptions'
            || this.tableName === 'service_prescription_items'
            || this.tableName === 'prosthetic_prescriptions';
    }

    /* @Codex */
    private versionedEntityLabel(): string {
        if (this.tableName === 'patients') return 'patient';
        if (this.tableName === 'ambulatories') return 'ambulatory';
        if (this.tableName === 'entries') return 'entry';
        if (this.tableName === 'checkups') return 'checkup';
        if (this.tableName === 'therapies') return 'therapy';
        if (this.tableName === 'observations') return 'observation';
        if (this.tableName === 'service_prescriptions') return 'service prescription';
        if (this.tableName === 'service_prescription_items') return 'service prescription item';
        if (this.tableName === 'prosthetic_prescriptions') return 'prosthetic prescription';
        return this.tableName;
    }

    /* @Codex */
    private async getVersionsByIdForDelete(ids: string[]): Promise<Map<string, number>> {
        const requestedIds = new Set(ids);
        const versionsById = new Map<string, number>();
        const items = await this.toArray();

        for (const item of items) {
            const id = this.getItemIdentifier(item);
            if (!id || !requestedIds.has(id)) continue;

            const version = this.getRecordVersion(item);
            if (typeof version !== 'number') {
                throw new Error(`Missing required version for ${this.versionedEntityLabel()} delete`);
            }
            versionsById.set(id, version);
        }

        const missingIds = ids.filter((id) => !versionsById.has(id));
        if (missingIds.length > 0) {
            throw new Error(`Missing required version for ${missingIds.length} ${this.versionedEntityLabel()} delete(s)`);
        }

        return versionsById;
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
        if (obj.deletedAt) obj.deletedAt = new Date(obj.deletedAt);
        /* @Codex */
        if (obj.startDate) obj.startDate = new Date(obj.startDate);
        /* @Codex */
        if (obj.endDate) obj.endDate = new Date(obj.endDate);
        /* @Codex */
        if (obj.observedAt) obj.observedAt = new Date(obj.observedAt);
        /* @Codex */
        if (obj.prescribedAt) obj.prescribedAt = new Date(obj.prescribedAt);
        /* @Codex */
        if (obj.collaudoAt) obj.collaudoAt = new Date(obj.collaudoAt);
        /* @Codex */
        if (obj.startedAt) obj.startedAt = new Date(obj.startedAt);
        /* @Codex */
        if (obj.completedAt) obj.completedAt = new Date(obj.completedAt);
        /* @Codex */
        if (obj.scheduledAt) obj.scheduledAt = new Date(obj.scheduledAt);
        /* @Codex */
        if (obj.performedAt) obj.performedAt = new Date(obj.performedAt);
        /* @Codex */
        if (obj.reportReceivedAt) obj.reportReceivedAt = new Date(obj.reportReceivedAt);
        /* @Codex */
        if (obj.importedAt) obj.importedAt = new Date(obj.importedAt);
        return obj;
    }

    // --- Encryption Helpers ---

    /* @Codex */
    private async encryptDeleteField(field: string, value: string): Promise<string> {
        const fields = ENCRYPTED_FIELDS[this.tableName];
        const key = this.getMasterKey();
        if (!fields?.includes(field) || !value) return value;
        if (!key) {
            throw new Error(`Encryption key unavailable for ${this.tableName}.${field}`);
        }

        const { iv, data } = await encryptData(value, key);
        return `ENC:${iv}:${data}`;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async encryptItem(item: any, isPartial = false): Promise<any> {
        if (!item) return item;

        const fields = ENCRYPTED_FIELDS[this.tableName];
        if (!fields) return item;

        const key = this.getMasterKey();
        const copy = { ...item };
        // WUL-323: the side-channel with ciphertext preserved by a failed decrypt
        // is not user data: strip it from the payload and use it to restore
        // locked fields instead of re-encrypting the placeholder over them.
        const lockedCiphertext = takeLockedCiphertext(copy);

        for (const field of fields) {
            if (isLockedDataPlaceholder(copy[field])) {
                const original = lockedCiphertext?.[field];
                if (isEncryptedFieldValue(original)) {
                    copy[field] = original;
                } else if (isPartial) {
                    console.warn(`Dropping locked field ${this.tableName}.${field} from update: original ciphertext unavailable`);
                    delete copy[field];
                } else {
                    throw new Error(`Refusing to persist '${LOCKED_DATA_PLACEHOLDER}' for ${this.tableName}.${field}: the original encrypted value is unavailable`);
                }
                continue;
            }
            if (copy[field] !== undefined && copy[field] !== null) {
                if (!key) {
                    throw new Error(`Encryption key unavailable for ${this.tableName}.${field}`);
                }
                try {
                    const { iv, data } = await encryptData(copy[field], key);
                    copy[field] = `ENC:${iv}:${data}`;
                } catch (error) {
                    throw new Error(`Encryption failed for ${this.tableName}.${field}`, { cause: error });
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
                        const decrypted = await decryptData(ciphertext, iv, key);
                        // decryptData returns null on failure (wrong/stale key):
                        // treat it like a thrown error, never expose null as data.
                        if (decrypted === null) {
                            rememberLockedCiphertext(item, field, item[field]);
                            item[field] = LOCKED_DATA_PLACEHOLDER;
                        } else {
                            item[field] = decrypted;
                        }
                    }
                } catch (e) {
                    console.error(`Decryption failed for ${this.tableName}.${field}`, e);
                    // WUL-323: keep the original ciphertext aside so a later save
                    // restores it; the placeholder is presentation-only.
                    rememberLockedCiphertext(item, field, item[field]);
                    item[field] = LOCKED_DATA_PLACEHOLDER;
                }
            }
        }

        if (this.tableName === 'patients' && item && typeof item === 'object') {
            return revivePatientStructuredFields(item);
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
    /* @Codex */
    observations: ApiTable<Observation>;
    /* @Codex */
    prostheticPrescriptions: ApiTable<ProstheticPrescription>;
    /* @Codex */
    servicePrescriptions: ApiTable<ServicePrescription>;
    /* @Codex */
    servicePrescriptionItems: ApiTable<ServicePrescriptionItem>;
    /* @Codex */
    serviceCatalogEntries: ApiTable<ServiceCatalogEntry>;
    /* @Codex */
    sissHandoffs: ApiTable<SissHandoffEvent>;
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
        /* @Codex */
        this.observations = new ApiTable<Observation>('/api/observations', 'observations', getKey);
        /* @Codex */
        this.prostheticPrescriptions = new ApiTable<ProstheticPrescription>('/api/prosthetic-prescriptions', 'prosthetic_prescriptions', getKey);
        /* @Codex */
        this.servicePrescriptions = new ApiTable<ServicePrescription>('/api/service-prescriptions', 'service_prescriptions', getKey);
        /* @Codex */
        this.servicePrescriptionItems = new ApiTable<ServicePrescriptionItem>('/api/service-prescription-items', 'service_prescription_items', getKey);
        /* @Codex */
        this.serviceCatalogEntries = new ApiTable<ServiceCatalogEntry>('/api/service-catalog', 'service_catalog_entries', getKey);
        /* @Codex */
        this.sissHandoffs = new ApiTable<SissHandoffEvent>('/api/siss-handoffs', 'siss_handoff_events', getKey);
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
    async applyPatientSmartImport(
        patientId: string,
        input: {
            version: number;
            diagnoses?: Diagnosis[];
            therapies: Therapy[];
        },
    ): Promise<void> {
        const patientPayload = input.diagnoses === undefined
            ? undefined
            : await this.patients.prepareWritePayload({ diagnoses: input.diagnoses }, true);
        const therapyPayloads = await Promise.all(
            input.therapies.map((therapy) => this.therapies.prepareWritePayload(therapy)),
        );

        const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/smart-import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                version: input.version,
                ...(patientPayload?.diagnoses !== undefined ? { diagnoses: patientPayload.diagnoses } : {}),
                therapies: therapyPayloads,
            }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            if (response.status === 409 && isApiVersionConflictPayload(payload)) {
                throw new ApiConflictError(payload);
            }
            throw new Error('Failed to apply Smart Import selection');
        }

        if (input.diagnoses !== undefined) notifyDbChange('patients');
        if (input.therapies.length > 0) notifyDbChange('therapies');
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

/* @Codex */
export class ApiConflictError extends Error {
    readonly payload: ApiVersionConflictPayload;

    constructor(payload: ApiVersionConflictPayload) {
        super('Conflitto di modifica: il record e stato aggiornato altrove. Ricarica e riprova.');
        this.name = 'ApiConflictError';
        this.payload = payload;
    }
}

/* @Codex */
export class BackupRestorePreflightError extends Error {
    readonly preflight: BackupRestorePreflightResult;

    constructor(message: string, preflight: BackupRestorePreflightResult) {
        super(message);
        this.name = 'BackupRestorePreflightError';
        this.preflight = preflight;
    }
}

export async function exportRawDatabase() {
    const response = await fetch('/api/system/backup-restore', { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Failed to export backup: ${response.status} ${response.statusText}`);
    }
    return await response.text();
}

export async function importRawDatabase(jsonString: string) {
    const response = await fetch('/api/system/backup-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonString,
    });

    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const errorMessage = typeof payload?.error === 'string'
            ? payload.error
            : `Restore failed: ${response.status} ${response.statusText}`;
        if (payload?.preflight && typeof payload.preflight === 'object') {
            throw new BackupRestorePreflightError(
                errorMessage,
                payload.preflight as BackupRestorePreflightResult,
            );
        }
        throw new Error(errorMessage);
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
    /* @Codex */
    version?: number;
    updatedAt?: Date;
    /* @Codex */
    deletedAt?: Date | null;
    /* @Codex */
    deletionReason?: string | null;
}

/* @Codex */
export interface Observation {
    id: string;
    patientId: string;
    codeSystem: 'LOINC';
    code: string;
    display: string;
    unitSystem: 'UCUM';
    unitCode: string;
    value: number | string;
    notes?: string;
    // S6: range di riferimento. refLow/refHigh confrontabili solo se numerici;
    // refText per il range grezzo/qualitativo. Non PHI, non cifrati.
    refLow?: string | null;
    refHigh?: string | null;
    refText?: string | null;
    servicePrescriptionItemId?: string | null;
    observedAt: Date;
    source?: 'manual' | 'ai_suggestion';
    createdAt: Date;
    version?: number;
    updatedAt?: Date;
    deletedAt?: Date | null;
    deletionReason?: string | null;
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
    /* @Codex */
    parseEvidenceArtifactSnapshot?: string;
    ocrQueueState?: DocumentOcrQueueState;
    ocrQueueReason?: DocumentOcrQueueReason;
    ocrQueueUpdatedAt?: Date;
    // Artifact deterministico senza PHI (hash + enum), scritto lato server dal replay.
    ocrReplayArtifactSnapshot?: string;
    createdAt: Date;
}

/* @Codex */
export type ProstheticPrescriptionStatus = 'draft' | 'prescribed' | 'submitted' | 'authorized' | 'delivered' | 'tested' | 'cancelled';

/* @Codex */
export type ProstheticPrescriptionCategory = 'standard' | 'oxygen' | 'repair' | 'replacement' | 'trial' | 'other';

/* @Codex */
export interface ProstheticPrescription {
    id: string;
    patientId: string;
    prescribedAt: Date;
    status: ProstheticPrescriptionStatus;
    category: ProstheticPrescriptionCategory;
    isoCode?: string;
    description: string;
    measures?: string;
    clinicalReason?: string;
    regionalPrescriptionId?: string;
    supplier?: string;
    collaudoAt?: Date;
    collaudoOutcome?: string;
    source: 'manual' | 'document_review';
    documentRefs?: string;
    notes?: string;
    /* @Codex */
    version: number;
    createdAt: Date;
    updatedAt?: Date;
}

/* @Codex */
export type ServicePrescriptionStatus = 'prescribed' | 'booked' | 'performed' | 'report_received' | 'cancelled';

/* @Codex */
export type ServicePrescriptionCategory = 'lab' | 'imaging' | 'visit' | 'rehab' | 'screening' | 'procedure' | 'other';

/* @Codex */
export type ServicePrescriptionPriority = 'U' | 'B' | 'D' | 'P' | 'routine' | 'unknown';

/* @Codex */
export interface ServicePrescription {
    id: string;
    patientId: string;
    prescribedAt: Date;
    status: ServicePrescriptionStatus;
    category: ServicePrescriptionCategory;
    priority?: ServicePrescriptionPriority;
    codeSystem?: string;
    serviceCode?: string;
    serviceName: string;
    clinicalQuestion?: string;
    provider?: string;
    scheduledAt?: Date;
    performedAt?: Date;
    reportReceivedAt?: Date;
    outcomeNote?: string;
    requestReference?: string;
    source: 'manual' | 'document_review' | 'legacy_therapy_cleanup';
    documentRefs?: string;
    notes?: string;
    /* @Codex */
    version: number;
    createdAt: Date;
    updatedAt?: Date;
}

/* @Codex */
export type ServicePrescriptionItemMatchStatus = 'unmatched' | 'candidate' | 'matched' | 'manual' | 'not_found';

/* @Codex */
export interface ServicePrescriptionItem {
    id: string;
    patientId: string;
    prescriptionId: string;
    ordinal: number;
    status: ServicePrescriptionStatus;
    category?: ServicePrescriptionCategory;
    codeSystem?: string;
    serviceCode?: string;
    serviceName: string;
    catalogEntryId?: string;
    catalogDisplayName?: string;
    matchStatus: ServicePrescriptionItemMatchStatus;
    confidence?: 'high' | 'medium' | 'low';
    evidence?: string;
    notes?: string;
    scheduledAt?: Date;
    performedAt?: Date;
    reportReceivedAt?: Date;
    outcomeNote?: string;
    /* @Codex */
    version: number;
    createdAt: Date;
    updatedAt?: Date;
}

/* @Codex */
export interface ServiceCatalogEntry {
    id: string;
    codeSystem: string;
    serviceCode: string;
    displayName: string;
    category: ServicePrescriptionCategory;
    branchCode?: string;
    synonyms?: string;
    source: string;
    version?: string;
    active: boolean;
    importedAt?: Date;
    updatedAt?: Date;
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
    endDate?: Date | null;
    createdAt: Date;
    updatedAt?: Date;
    version?: number;
    /* @Codex */
    deletedAt?: Date | null;
    /* @Codex */
    deletionReason?: string | null;
}
