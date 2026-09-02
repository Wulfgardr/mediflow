/* @Codex */
import 'server-only';

import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { and, asc, eq } from 'drizzle-orm';

import {
    createPatientOpenLoopsReadServiceV1,
    PatientOpenLoopsReadV1Error,
} from '../../packages/aip/src/patient-open-loops';
import { dbServer } from '../db-server';
import {
    deriveOpenLoops,
    RESULTS_PENDING_AFTER_DAYS,
    STALL_FACTOR,
    type OpenLoopObservation,
    type OpenLoopServicePrescriptionItem,
} from '../patient-open-loops';
import { observations, patientsToAmbulatories, servicePrescriptionItems } from '../schema';

const SOURCE_KEYS = ['now', 'current', 'beginPermit', 'bindPermit', 'finalizeBoundPermit', 'denyPermit',
    'resolveHostScope', 'writeAudit'] as const;
const SCOPE_KEYS = ['status', 'patientId', 'ambulatoryId', 'scopeDigest', 'generation', 'revocationGeneration',
    'selectionEpoch', 'restartGeneration', 'expiresAt'] as const;
const REQUEST_KEYS = ['limit', 'signal'] as const;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const DAY_MS = 86_400_000;
const HOST_ID_MAX_BYTES = 256;
const DB_SOURCE_ROW_LIMIT = 1_024;
const isProxy = types.isProxy;

type Scope = Readonly<{
    status: 'available'; patientId: string; ambulatoryId: string; scopeDigest: string;
    generation: number; revocationGeneration: number; selectionEpoch: number;
    restartGeneration: number; expiresAt: number;
}>;
type Projection = Readonly<{ fingerprint: string; items: readonly Readonly<Record<string, unknown>>[]; truncated: boolean }>;
type SnapshotRecord = Readonly<{ scope: Scope; fingerprint: string; revision: number }>;

function record<T extends object>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}

function exact(value: unknown, keys: readonly string[], canonical: boolean): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || isProxy(value) || Array.isArray(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        if ((canonical && (prototype !== null || !Object.isFrozen(value)))
            || (!canonical && prototype !== null && prototype !== Object.prototype)) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length) return null;
        const output = Object.create(null) as Record<string, unknown>;
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            if (own[index] !== key) return null;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor?.enumerable || !('value' in descriptor)
                || (canonical && (descriptor.writable || descriptor.configurable))) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function integer(value: unknown, minimum = 0): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function hostId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.trim() === value
        && Buffer.byteLength(value, 'utf8') <= HOST_ID_MAX_BYTES;
}

function opaque(value: unknown): value is object {
    try {
        return !!value && typeof value === 'object' && !isProxy(value) && Object.getPrototypeOf(value) === null
            && Object.isFrozen(value) && Reflect.ownKeys(value).length === 0;
    } catch { return false; }
}

function digest(domain: string, value: string): string {
    return `sha256:${createHash('sha256').update(domain).update('\0').update(value).digest('hex')}`;
}

function scope(value: unknown): Scope | null {
    const candidate = exact(value, SCOPE_KEYS, true);
    if (!candidate || candidate.status !== 'available'
        || !hostId(candidate.patientId) || !hostId(candidate.ambulatoryId)
        || typeof candidate.scopeDigest !== 'string' || !DIGEST.test(candidate.scopeDigest)
        || !integer(candidate.generation, 1) || !integer(candidate.revocationGeneration)
        || !integer(candidate.selectionEpoch) || !integer(candidate.restartGeneration, 1)
        || !integer(candidate.expiresAt, 1)) return null;
    return record({
        status: 'available' as const,
        patientId: candidate.patientId,
        ambulatoryId: candidate.ambulatoryId,
        scopeDigest: candidate.scopeDigest,
        generation: candidate.generation,
        revocationGeneration: candidate.revocationGeneration,
        selectionEpoch: candidate.selectionEpoch,
        restartGeneration: candidate.restartGeneration,
        expiresAt: candidate.expiresAt,
    }) as Scope;
}

function sameScope(left: Scope, right: Scope): boolean {
    return SCOPE_KEYS.every((key) => left[key] === right[key]);
}

function time(value: Date | string | null | undefined): number {
    const candidate = value instanceof Date ? value : value ? new Date(value) : new Date(Number.NaN);
    return candidate.getTime();
}

function readProjection(selected: Scope, capturedAt: number, limit: number): Projection {
    const rows = dbServer.transaction((tx) => {
        const membership = tx.select({ patientId: patientsToAmbulatories.patientId })
            .from(patientsToAmbulatories)
            .where(and(eq(patientsToAmbulatories.patientId, selected.patientId),
                eq(patientsToAmbulatories.ambulatoryId, selected.ambulatoryId))).get();
        if (!membership) throw new PatientOpenLoopsReadV1Error('snapshot_unavailable');
        const itemRows = tx.select({
            id: servicePrescriptionItems.id, patientId: servicePrescriptionItems.patientId,
            prescriptionId: servicePrescriptionItems.prescriptionId, status: servicePrescriptionItems.status,
            codeSystem: servicePrescriptionItems.codeSystem, serviceCode: servicePrescriptionItems.serviceCode,
            scheduledAt: servicePrescriptionItems.scheduledAt, reportReceivedAt: servicePrescriptionItems.reportReceivedAt,
            createdAt: servicePrescriptionItems.createdAt, serviceName: servicePrescriptionItems.serviceName,
            version: servicePrescriptionItems.version,
        }).from(servicePrescriptionItems).where(eq(servicePrescriptionItems.patientId, selected.patientId))
            .orderBy(asc(servicePrescriptionItems.id)).limit(DB_SOURCE_ROW_LIMIT + 1).all();
        if (itemRows.length > DB_SOURCE_ROW_LIMIT) {
            throw new PatientOpenLoopsReadV1Error('snapshot_unavailable');
        }
        const observationRows = tx.select({
            id: observations.id, patientId: observations.patientId, codeSystem: observations.codeSystem,
            code: observations.code, display: observations.display, observedAt: observations.observedAt,
            deletedAt: observations.deletedAt, servicePrescriptionItemId: observations.servicePrescriptionItemId,
            version: observations.version,
        }).from(observations).where(eq(observations.patientId, selected.patientId))
            .orderBy(asc(observations.id)).limit(DB_SOURCE_ROW_LIMIT + 1).all();
        if (observationRows.length > DB_SOURCE_ROW_LIMIT) {
            throw new PatientOpenLoopsReadV1Error('snapshot_unavailable');
        }
        return { itemRows, observationRows };
    });
    const inputItems: OpenLoopServicePrescriptionItem[] = rows.itemRows.map((item) => ({
        id: item.id, patientId: item.patientId, prescriptionId: item.prescriptionId, status: item.status,
        codeSystem: item.codeSystem ?? undefined, serviceCode: item.serviceCode ?? undefined,
        scheduledAt: item.scheduledAt, reportReceivedAt: item.reportReceivedAt, createdAt: item.createdAt,
        serviceName: item.serviceName,
    }));
    const inputObservations: OpenLoopObservation[] = rows.observationRows.map((observation) => ({
        patientId: observation.patientId, codeSystem: observation.codeSystem, code: observation.code,
        display: observation.display, observedAt: observation.observedAt, deletedAt: observation.deletedAt,
        servicePrescriptionItemId: observation.servicePrescriptionItemId,
    }));
    const itemVersions = new Map(rows.itemRows.map((item) => [item.id, item.version]));
    const seriesVersions = new Map<string, number>();
    for (const observation of rows.observationRows) {
        const key = `${observation.codeSystem}\0${observation.code}`;
        seriesVersions.set(key, Math.max(seriesVersions.get(key) ?? 1, observation.version));
    }
    const projected = deriveOpenLoops({ items: inputItems, observations: inputObservations, now: new Date(capturedAt) })
        .map((loop) => {
            const openedAt = loop.status.sinceDate.getTime();
            if (loop.kind === 'results_pending') {
                return record({
                    loopRef: `aipl_${digest('mediflow.patient.open-loops.loop-ref.v1',
                        `${selected.scopeDigest}\0service_item\0${loop.sourceRef.id}`).slice(7)}`,
                    kind: loop.kind,
                    temporalState: 'overdue' as const,
                    openedAt,
                    dueAt: openedAt + RESULTS_PENDING_AFTER_DAYS * DAY_MS,
                    revision: itemVersions.get(loop.sourceRef.id) ?? 1,
                });
            }
            const key = `${loop.sourceRef.codeSystem}\0${loop.sourceRef.code}`;
            return record({
                loopRef: `aipl_${digest('mediflow.patient.open-loops.loop-ref.v1',
                    `${selected.scopeDigest}\0series\0${key}`).slice(7)}`,
                kind: loop.kind,
                temporalState: 'overdue' as const,
                openedAt,
                dueAt: openedAt + loop.status.typicalIntervalDays * STALL_FACTOR * DAY_MS,
                revision: seriesVersions.get(key) ?? 1,
            });
        });
    const limited = Object.freeze(projected.slice(0, limit));
    const fingerprintInput = JSON.stringify({
        items: rows.itemRows.map((item) => ({ ...item, scheduledAt: time(item.scheduledAt),
            reportReceivedAt: time(item.reportReceivedAt), createdAt: time(item.createdAt) })),
        observations: rows.observationRows.map((observation) => ({ ...observation,
            observedAt: time(observation.observedAt), deletedAt: time(observation.deletedAt) })),
        projected,
    });
    return record({ fingerprint: digest('mediflow.patient.open-loops.snapshot.v1', fingerprintInput),
        items: limited, truncated: projected.length > limit });
}

/** DB-backed candidate; only a future host registry may resolve an exact scope from the opaque permit execution. */
export function createPatientOpenLoopsReadInternalCandidateV1(sourcesValue: unknown) {
    const sources = exact(sourcesValue, SOURCE_KEYS, false);
    if (!sources || SOURCE_KEYS.some((key) => typeof sources[key] !== 'function' || isProxy(sources[key]))
        || (sources.resolveHostScope as (execution: object) => unknown).length !== 1) {
        throw new PatientOpenLoopsReadV1Error('operation_unavailable');
    }
    const nowSource = sources.now as () => unknown;
    const resolveScopeSource = sources.resolveHostScope as (execution: object) => unknown;
    let lastNow = -1;
    let activeExecution: object | null = null;
    const resolveScope = (execution: unknown): Scope => {
        if (!opaque(execution)) throw new PatientOpenLoopsReadV1Error('lease_unavailable');
        let value: unknown;
        try { value = resolveScopeSource(execution); } catch {
            throw new PatientOpenLoopsReadV1Error('lease_unavailable');
        }
        if (types.isPromise(value)) throw new PatientOpenLoopsReadV1Error('lease_unavailable');
        return scope(value) ?? (() => { throw new PatientOpenLoopsReadV1Error('lease_unavailable'); })();
    };
    const readActiveScope = (): Scope => activeExecution
        ? resolveScope(activeExecution) : (() => { throw new PatientOpenLoopsReadV1Error('lease_unavailable'); })();
    const ownerIdentity = Object.freeze(Object.create(null));
    const leaseIdentity = Object.freeze(Object.create(null));
    const ownerRef = `aipo_${randomBytes(32).toString('hex')}`;
    const leaseRef = `aile_${randomBytes(32).toString('hex')}`;
    const snapshots = new WeakMap<object, SnapshotRecord>();
    let activeScope: Scope | null = null;
    let activeBinding: object | null = null;
    let activeSnapshot: SnapshotRecord | null = null;
    let publicationFenceArmed = false;
    let revision = 0;
    const assertPublicationCurrent = (capturedAt: number): void => {
        if (!publicationFenceArmed || !activeScope || !activeSnapshot) return;
        const selected = readActiveScope();
        if (!sameScope(activeScope, selected) || !sameScope(activeSnapshot.scope, selected)) {
            throw new PatientOpenLoopsReadV1Error('scope_changed');
        }
        const projection = readProjection(selected, capturedAt, 32);
        if (projection.fingerprint !== activeSnapshot.fingerprint) {
            throw new PatientOpenLoopsReadV1Error('scope_changed');
        }
    };
    const now = (): number => {
        let value: unknown;
        try { value = nowSource(); } catch { throw new PatientOpenLoopsReadV1Error('operation_unavailable'); }
        if (!integer(value) || value < lastNow || types.isPromise(value)) {
            throw new PatientOpenLoopsReadV1Error('operation_unavailable');
        }
        lastNow = value;
        assertPublicationCurrent(value);
        return value;
    };
    const core = createPatientOpenLoopsReadServiceV1(record({
        now,
        nextRef: () => `aipr_${randomBytes(32).toString('hex')}`,
        hashRef: (value: string) => digest('mediflow.patient.open-loops.audit-ref.v1', value),
        current: sources.current,
        beginPermit: sources.beginPermit,
        bindPermit: sources.bindPermit,
        finalizeBoundPermit: sources.finalizeBoundPermit,
        denyPermit: sources.denyPermit,
        acquireLease: (execution: object) => {
            const selected = resolveScope(execution);
            if (now() >= selected.expiresAt) throw new PatientOpenLoopsReadV1Error('expired');
            activeExecution = execution;
            activeScope = selected;
            return record({ status: 'available' as const, ownerIdentity, leaseIdentity, ownerRef, leaseRef,
                purposeCode: 'care_coordination' as const, operationId: 'mediflow.patient.open_loops.read.v1' as const,
                capabilityId: 'mediflow.patient.open_loops.read.v1' as const, maxStage: 'read_only' as const,
                scopeDigest: selected.scopeDigest, generation: selected.generation,
                revocationGeneration: selected.revocationGeneration, selectionEpoch: selected.selectionEpoch,
                restartGeneration: selected.restartGeneration, expiresAt: selected.expiresAt });
        },
        readSnapshot: (binding: object, requestValue: unknown) => new Promise((resolve, reject) => {
            try {
                const request = exact(requestValue, REQUEST_KEYS, true);
                const selected = readActiveScope();
                if (!request || !integer(request.limit, 1) || request.limit > 32
                    || !(request.signal instanceof AbortSignal) || request.signal.aborted
                    || !activeScope || !sameScope(activeScope, selected)) {
                    throw new PatientOpenLoopsReadV1Error('snapshot_unavailable');
                }
                const capturedAt = now();
                const projection = readProjection(selected, capturedAt, request.limit);
                if (request.signal.aborted || !sameScope(selected, readActiveScope())) {
                    throw new PatientOpenLoopsReadV1Error('snapshot_unavailable');
                }
                activeBinding = binding;
                const snapshotIdentity = Object.freeze(Object.create(null));
                revision += 1;
                snapshots.set(snapshotIdentity, record({ scope: selected, fingerprint: projection.fingerprint, revision }));
                resolve(record({ status: 'available' as const, ownerIdentity, leaseIdentity, snapshotIdentity,
                    scopeDigest: selected.scopeDigest, generation: selected.generation,
                    revocationGeneration: selected.revocationGeneration, selectionEpoch: selected.selectionEpoch,
                    restartGeneration: selected.restartGeneration, revision, capturedAt,
                    truncated: projection.truncated, items: projection.items }));
            } catch (error) { reject(error); }
        }),
        readCurrentness: (binding: object, snapshotIdentity: object) => {
            const snapshot = snapshots.get(snapshotIdentity);
            const selected = readActiveScope();
            if (!snapshot || binding !== activeBinding || !activeScope || !sameScope(activeScope, selected)
                || !sameScope(snapshot.scope, selected)) throw new PatientOpenLoopsReadV1Error('scope_changed');
            const finalSelected = readActiveScope();
            if (!sameScope(selected, finalSelected)) throw new PatientOpenLoopsReadV1Error('scope_changed');
            const projection = readProjection(finalSelected, now(), 32);
            if (projection.fingerprint !== snapshot.fingerprint) {
                throw new PatientOpenLoopsReadV1Error('scope_changed');
            }
            activeSnapshot = snapshot;
            publicationFenceArmed = true;
            return record({ status: 'current' as const, ownerIdentity, leaseIdentity, snapshotIdentity,
                scopeDigest: selected.scopeDigest, generation: selected.generation,
                revocationGeneration: selected.revocationGeneration, selectionEpoch: selected.selectionEpoch,
                restartGeneration: selected.restartGeneration, revision: snapshot.revision });
        },
        writeAudit: sources.writeAudit,
        timeoutMs: 500,
    }));
    return record({ service: core });
}
