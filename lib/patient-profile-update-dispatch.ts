import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { PATIENT_PROFILE_UPDATE_FIELDS, PATIENT_PROFILE_UPDATE_OPERATION,
    type PatientProfileUpdateEnvelope, type PatientProfileUpdatePayload } from './patient-profile-update-contract';
import { updatePatientOperation, type PatientUpdateOperationResult } from './patient-update-operation';
import type { normalizePatientUpdateInput } from './patient-write-normalization';
import type { NetworkPatientCommitGuard } from './network-patient-commit-authority';
import type { RequiredAuditContext } from './security/audit';

type HostUpdateInput = Readonly<{
    patientId: string; expectedVersion: number;
    values: Extract<ReturnType<typeof normalizePatientUpdateInput>, { ok: true }>['values'];
    setPrimaryAmbulatory: boolean;
    audit: RequiredAuditContext;
    scopeAmbulatoryId?: string; authorizeCommit?: NetworkPatientCommitGuard;
}>;

export type PatientProfileUpdateOutcome = Readonly<Pick<PatientProfileUpdateEnvelope,
    'operationId' | 'contractVersion' | 'purpose' | 'executionId' | 'correlationId' | 'idempotencyKey'>> & (
    | Readonly<{ kind: 'applied'; result: Extract<PatientUpdateOperationResult, { status: 200 }> }>
    | Readonly<{ kind: 'refused'; result: Exclude<PatientUpdateOperationResult, { status: 200 }> }>
    | Readonly<{ kind: 'uncertain'; error: unknown }>
);

class ProfileUpdateExecution {
    readonly command: PatientProfileUpdateEnvelope;
    readonly #audit: RequiredAuditContext;
    readonly #authorizeCommit: NetworkPatientCommitGuard | undefined;
    #result: Promise<PatientProfileUpdateOutcome> | undefined;

    constructor(input: HostUpdateInput) {
        if ((input.scopeAmbulatoryId === undefined) !== (input.authorizeCommit === undefined)) throw new Error('Patient profile admission mismatch');
        const payload = Object.fromEntries(PATIENT_PROFILE_UPDATE_FIELDS.flatMap(field => {
            const value = input.values[field];
            return value === undefined ? [] : [[field, value instanceof Date ? value.toISOString() : value]];
        })) as PatientProfileUpdatePayload;
        this.#audit = { ...input.audit, flags: [...input.audit.flags] };
        this.#authorizeCommit = input.authorizeCommit;
        this.command = Object.freeze({
            operationId: PATIENT_PROFILE_UPDATE_OPERATION.id,
            contractVersion: PATIENT_PROFILE_UPDATE_OPERATION.version,
            executionId: randomUUID(), correlationId: input.audit.requestId ?? null, idempotencyKey: randomUUID(),
            executor: 'legacy-node', purpose: 'patient-profile-update',
            author: Object.freeze({ kind: input.audit.actorType, ref: input.audit.actorRef, surface: input.audit.sourceSurface }),
            authorization: Object.freeze({ kind: 'existing-host-admission',
                commitGuard: input.authorizeCommit ? 'paired-transaction' : 'archive-audit' }),
            scope: Object.freeze(input.scopeAmbulatoryId === undefined ? { kind: 'local' } : { kind: 'ambulatory', ambulatoryId: input.scopeAmbulatoryId }),
            confirmation: 'legacy-not-attested',
            target: Object.freeze({ patientId: input.patientId, expectedVersion: input.expectedVersion }),
            payload: Object.freeze(payload), normalizedAt: input.values.updatedAt!.toISOString(),
            setPrimaryAmbulatory: input.setPrimaryAmbulatory,
        });
        Object.freeze(this);
    }

    dispatch(candidate: PatientProfileUpdateEnvelope): Promise<PatientProfileUpdateOutcome> {
        if (!isDeepStrictEqual(candidate, this.command)) return Promise.reject(new Error('Patient profile execution command mismatch'));
        if (this.#result) return this.#result;
        let resolve!: (result: PatientProfileUpdateOutcome) => void;
        const pending = new Promise<PatientProfileUpdateOutcome>(accept => { resolve = accept; });
        this.#result = pending;
        const identity = { operationId: this.command.operationId, contractVersion: this.command.contractVersion,
            purpose: this.command.purpose, executionId: this.command.executionId,
            correlationId: this.command.correlationId, idempotencyKey: this.command.idempotencyKey };
        try {
            const result = executeLegacyPatientProfileUpdate(this.command, this.#audit, this.#authorizeCommit);
            resolve(Object.freeze(result.status === 200 ? { ...identity, kind: 'applied', result } : { ...identity, kind: 'refused', result }));
        } catch (error) { resolve(Object.freeze({ ...identity, kind: 'uncertain', error })); }
        return pending;
    }
}

function executeLegacyPatientProfileUpdate(command: PatientProfileUpdateEnvelope, audit: RequiredAuditContext,
    authorizeCommit: NetworkPatientCommitGuard | undefined): PatientUpdateOperationResult {
    const values = { ...command.payload,
        birthDate: command.payload.birthDate === undefined ? undefined : command.payload.birthDate === null ? null : new Date(command.payload.birthDate),
        aiSummaryGeneratedAt: command.payload.aiSummaryGeneratedAt === undefined ? undefined : command.payload.aiSummaryGeneratedAt === null ? null : new Date(command.payload.aiSummaryGeneratedAt),
        version: command.target.expectedVersion + 1, updatedAt: new Date(command.normalizedAt) };
    return updatePatientOperation({
        operationId: command.operationId, contractVersion: command.contractVersion,
        patientId: command.target.patientId, expectedVersion: command.target.expectedVersion,
        values: values, setPrimaryAmbulatory: command.setPrimaryAmbulatory,
        scopeAmbulatoryId: command.scope.kind === 'ambulatory' ? command.scope.ambulatoryId : undefined,
        authorizeCommit: authorizeCommit, audit: audit,
    });
}

export function createPatientProfileUpdateExecution(input: HostUpdateInput): ProfileUpdateExecution {
    return new ProfileUpdateExecution(input);
}

export function dispatchPatientProfileUpdate(execution: ProfileUpdateExecution, command: PatientProfileUpdateEnvelope): Promise<PatientProfileUpdateOutcome> {
    if (!(execution instanceof ProfileUpdateExecution)) return Promise.reject(new Error('Patient profile execution unavailable'));
    return execution.dispatch(command);
}
