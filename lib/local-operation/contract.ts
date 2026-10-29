import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { TerritorialPackCapability } from '../territorial-pack-contract.ts';

const id = z.string().min(1).max(256);
export const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const destinationSchema = z.object({ origin: z.string().url(), path: z.string().startsWith('/').max(256),
    method: z.enum(['GET', 'POST']), purpose: z.enum(['observe', 'prepare', 'act', 'reconcile']) }).strict();
export const planSchema = z.object({
    operationId: id, patientId: id, practiceId: id, installationId: id, archiveGeneration: id,
    procedureId: id, contractVersion: id, adapterVersion: id, uiVersion: id, catalogVersion: id,
    sourceVersion: id, portalAccountId: id, operatorId: id, territory: z.enum(['it', 'lom']),
    finalAct: z.enum(['protected', 'manual']),
    sources: z.array(z.object({ ref: id, version: id, verifiedAt: z.number().int().nonnegative() }).strict()).min(1).max(64),
    destinations: z.array(destinationSchema).min(1).max(32),
    fields: z.array(z.object({ name: id, classification: z.enum(['identity', 'clinical', 'administrative']),
        value: z.string().max(8192), sourceRef: id, sourceVersion: id, transformation: z.literal('none'), required: z.boolean() }).strict()).min(1).max(128),
    parts: z.array(id).min(1).max(64),
}).strict();
export type LocalOperationPlan = z.infer<typeof planSchema>;
export type Destination = z.infer<typeof destinationSchema>;
export const receiptSchema = z.object({ operationId: id, patientId: id, practiceId: id, planDigest: digestSchema,
    receiptId: id, serviceState: id, destination: destinationSchema,
    parts: z.array(z.object({ id, state: z.enum(['confirmed', 'unresolved']) }).strict()).min(1).max(64),
    evidence: z.string().min(1).max(16384),
}).strict();
export type LocalOperationReceipt = z.infer<typeof receiptSchema>;
export const states = ['prepared', 'saved', 'suspended', 'awaiting_manual_act', 'suspended_pack_disabled',
    'authorized', 'attempt_started', 'uncertain', 'confirmed_pending_recording', 'confirmed'] as const;
export const recordSchema = z.object({
    operationId: id, patientId: id, practiceId: id, installationId: id, archiveGeneration: id,
    procedureId: id, territory: z.enum(['it', 'lom']),
    revision: z.number().int().positive(), planDigest: digestSchema, state: z.enum(states),
    resumeState: z.enum(states).nullable(), reason: z.enum(['choice', 'context_changed', 'human_intervention', 'adapter_rejected', 'pack_disabled', 'recovery']).nullable(),
    suspensionNote: z.string().max(4096).nullable(),
    attempt: z.number().int().nonnegative(), effectPossible: z.boolean(),
    receipt: receiptSchema.nullable(), updatedAt: z.number().int().nonnegative(),
}).strict();
export type LocalOperationRecord = z.infer<typeof recordSchema>;
export type LocalOperationState = LocalOperationRecord['state'];
export type LiveContext = Readonly<{
    installationId: string; archiveGeneration: string; sessionId: string; clientId: string; operatorId: string;
    patientId: string; practiceId: string; portalAccountId: string; role: 'physician';
    expiresAt: number; revocationEpoch: number; humanRevision: number;
}>;
export const observationSchema = z.object({ patientId: id, practiceId: id, portalAccountId: id,
    uiVersion: id, humanRevision: z.number().int().nonnegative(), planDigest: digestSchema.nullable(),
    census: z.enum(['complete', 'unverifiable']), unclassifiedFields: z.array(z.string().max(256)).max(1024) }).strict();
export type Observation = Readonly<z.infer<typeof observationSchema>>;
export type AdapterContext = Readonly<{
    operationId: string; attempt: number; revision: number; signal: AbortSignal;
    assertCurrent(): void;
    authorizeRequest(destination: Destination): void;
}>;

/** Every request, redirect, frame, resource and background task must use authorizeRequest immediately before dispatch. */
export interface LocalOperationAdapter {
    readonly version: string;
    readonly protectedFinalAct: boolean;
    observe(context: AdapterContext): Promise<Observation>;
    prepare(context: AdapterContext, plan: Readonly<LocalOperationPlan>): Promise<void>;
    act(context: AdapterContext, plan: Readonly<LocalOperationPlan>): Promise<unknown>;
    reconcile(context: AdapterContext, plan: Readonly<LocalOperationPlan>): Promise<unknown>;
    verifyReceipt(context: AdapterContext, receipt: LocalOperationReceipt): Promise<boolean>;
    stop(): void;
}
export interface LocalOperationJournal {
    read(operationId: string): LocalOperationRecord | null;
    create(record: LocalOperationRecord, assertCurrent: () => void): LocalOperationRecord;
    save(record: LocalOperationRecord, expectedRevision: number, assertCurrent: () => void,
        lane: 'core' | 'territorial'): LocalOperationRecord;
}
/** Trusted origin guard must compare the connection, archive generation, installation and key before journal access. */
export type ArchiveAuthority = Readonly<{ assertCurrent(): void }>;
export type LocalOperationPorts = Readonly<{
    captureArchive(): ArchiveAuthority;
    journal: LocalOperationJournal;
    adapter: LocalOperationAdapter;
    currentContext(): LiveContext | null;
    currentTerritory(): TerritorialPackCapability;
    resolvePlan(operationId: string): LocalOperationPlan;
    confirmExactPlan(plan: Readonly<LocalOperationPlan>): Promise<boolean>;
    subscribeInvalidation(listener: () => void): () => void;
    now(): number;
}>;
export class LocalOperationError extends Error {
    constructor(readonly code: 'denied' | 'conflict' | 'missing' | 'corrupt' | 'storage_unavailable' | 'reconciliation_required') { super(code); }
}
export function deny(): never { throw new LocalOperationError('denied'); }
export function planDigest(plan: LocalOperationPlan): string {
    const parsed = planSchema.parse(plan);
    if (new Set(parsed.fields.map(field => field.name)).size !== parsed.fields.length
        || new Set(parsed.parts).size !== parsed.parts.length
        || parsed.fields.some(field => (field.required && !field.value) || !parsed.sources.some(source => source.ref === field.sourceRef && source.version === field.sourceVersion))) deny();
    for (const destination of parsed.destinations) {
        const url = new URL(destination.origin);
        if (url.origin !== destination.origin || url.username || url.password || /[?#\\]/.test(destination.path)
            || new URL(destination.path, destination.origin).origin !== destination.origin) deny();
    }
    return createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
}
export function territorialAllows(capability: TerritorialPackCapability, pack: 'it' | 'lom'): boolean {
    return capability.schemaVersion === 'mediflow.territorial-packs.v1' && capability.status === 'ready'
        && Number.isSafeInteger(capability.revision) && capability.revision !== null
        && (pack === 'lom' ? capability.preset === 'core+it+lom' : ['core+it', 'core+it+lom'].includes(capability.preset));
}
