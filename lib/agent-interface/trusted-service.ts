/* @Codex */
import { createHash } from 'node:crypto';

import { projectPatientOpenLoops, type PatientOpenLoopsProjection } from './projections/patient-open-loops';

export type MiniPilotCommand = 'whoami' | 'capabilities' | 'patient.search' | 'patient.show'
    | 'open-loops' | 'draft.preview' | 'apply';
export type AgentServiceError = 'REQUEST_INVALID' | 'CREDENTIAL_INVALID' | 'SESSION_EXPIRED'
    | 'SESSION_REVOKED' | 'REQUEST_REPLAYED' | 'PATIENT_NOT_FOUND' | 'PATIENT_MISMATCH' | 'APPLY_DENIED';
export type AgentServiceReceipt = Readonly<{
    schemaVersion: 'mediflow.agent.receipt.v1'; requestId: string; actionId: string;
    capability: MiniPilotCommand; stage: 'observe' | 'read' | 'preview' | 'apply';
    status: 'succeeded' | 'denied'; leaseRef: string | null; at: string;
    previewDigest?: string; issues: readonly AgentServiceError[];
}>;
export type AgentServiceResult = Readonly<{ ok: true; data: unknown; receipt: AgentServiceReceipt }>
    | Readonly<{ ok: false; error: AgentServiceError; receipt: AgentServiceReceipt }>;

type PatientDirectoryEntry = Readonly<{
    patientRef: string; displayName: string; birthYear: number; archived: boolean; version: number;
}>;
type TrustedPilotState = Readonly<{
    credential: string; sessionRef: string; ambulatoryRef: string; leaseRef: string;
    selectedPatientRef: string; issuedAt: number; expiresAt: number;
    directory: readonly PatientDirectoryEntry[]; projection: PatientOpenLoopsProjection;
}>;

const COMMANDS: Readonly<Record<MiniPilotCommand, { stage: AgentServiceReceipt['stage']; disposition: string }>> = Object.freeze({
    whoami: { stage: 'observe', disposition: 'available' }, capabilities: { stage: 'observe', disposition: 'available' },
    'patient.search': { stage: 'read', disposition: 'available' }, 'patient.show': { stage: 'read', disposition: 'available' },
    'open-loops': { stage: 'read', disposition: 'available' }, 'draft.preview': { stage: 'preview', disposition: 'proposal_only' },
    apply: { stage: 'apply', disposition: 'unavailable' },
});
const REQUEST_KEYS = ['args', 'command', 'credential', 'requestId'];
const ARG_KEYS: Readonly<Record<MiniPilotCommand, readonly string[]>> = Object.freeze({
    whoami: [], capabilities: [], 'patient.search': ['query'], 'patient.show': ['patientRef'],
    'open-loops': ['patientRef'], 'draft.preview': ['patientRef'], apply: ['patientRef'],
});

function isPlainExact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const own = Reflect.ownKeys(value);
    return own.length === keys.length && own.every((key) => typeof key === 'string' && keys.includes(key))
        && own.every((key) => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor?.enumerable === true && 'value' in descriptor; });
}
function isText(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function isCommand(value: unknown): value is MiniPilotCommand { return isText(value) && Object.hasOwn(COMMANDS, value); }

export type TrustedAgentService = Readonly<{
    execute(input: unknown): AgentServiceResult;
    revoke(): void;
}>;

class TrustedAgentInterfaceService implements TrustedAgentService {
    readonly #state: TrustedPilotState;
    readonly #clock: () => number;
    readonly #seen = new Set<string>();
    #revoked = false;

    constructor(state: TrustedPilotState, clock: () => number) {
        this.#state = structuredClone(state);
        this.#clock = clock;
    }

    revoke(): void { this.#revoked = true; }

    execute(input: unknown): AgentServiceResult {
        const fallback = this.#receipt('invalid', 'capabilities', 'denied', null, ['REQUEST_INVALID']);
        if (!isPlainExact(input, REQUEST_KEYS) || !isText(input.requestId) || !isText(input.credential)
            || !isCommand(input.command) || !isPlainExact(input.args, ARG_KEYS[input.command])) {
            return { ok: false, error: 'REQUEST_INVALID', receipt: fallback };
        }
        const { requestId, credential, command, args } = input;
        const deny = (error: AgentServiceError) => ({ ok: false, error, receipt: this.#receipt(requestId, command, 'denied', null, [error]) } as const);
        if (credential !== this.#state.credential) return deny('CREDENTIAL_INVALID');
        if (this.#revoked) return deny('SESSION_REVOKED');
        if (this.#clock() >= this.#state.expiresAt) return deny('SESSION_EXPIRED');
        if (this.#seen.has(requestId)) return deny('REQUEST_REPLAYED');
        this.#seen.add(requestId);
        if (command === 'apply') return deny('APPLY_DENIED');

        const patientRef = args.patientRef;
        if (patientRef !== undefined && !isText(patientRef)) return deny('REQUEST_INVALID');
        if ((command === 'open-loops' || command === 'draft.preview') && patientRef !== this.#state.selectedPatientRef) return deny('PATIENT_MISMATCH');
        const patient = isText(patientRef) ? this.#state.directory.find((item) => item.patientRef === patientRef) : undefined;
        if (command === 'patient.show' && !patient) return deny('PATIENT_NOT_FOUND');

        let data: unknown;
        if (command === 'whoami') data = { sessionRef: this.#state.sessionRef, ambulatoryRef: this.#state.ambulatoryRef, expiresAt: new Date(this.#state.expiresAt).toISOString() };
        else if (command === 'capabilities') data = Object.entries(COMMANDS).map(([name, value]) => ({ command: name, ...value }));
        else if (command === 'patient.search') {
            if (typeof args.query !== 'string') return deny('REQUEST_INVALID');
            const query = args.query.trim().toLocaleLowerCase('it');
            data = this.#state.directory.filter((item) => item.displayName.toLocaleLowerCase('it').includes(query));
        } else if (command === 'patient.show') data = patient;
        else if (command === 'open-loops') data = this.#state.projection;
        else {
            const draft = { kind: 'follow_up', text: 'Anteprima sintetica: verificare gli open loop selezionati.' };
            const digest = createHash('sha256').update(JSON.stringify(draft)).digest('hex');
            return { ok: true, data: draft, receipt: this.#receipt(requestId, command, 'succeeded', digest, []) };
        }
        return { ok: true, data, receipt: this.#receipt(requestId, command, 'succeeded', null, []) };
    }

    #receipt(requestId: string, command: MiniPilotCommand, status: AgentServiceReceipt['status'], digest: string | null, issues: readonly AgentServiceError[]): AgentServiceReceipt {
        return Object.freeze({ schemaVersion: 'mediflow.agent.receipt.v1', requestId, actionId: `action:${requestId}`,
            capability: command, stage: COMMANDS[command].stage, status,
            leaseRef: status === 'succeeded' ? this.#state.leaseRef : null, at: new Date(this.#clock()).toISOString(),
            ...(digest ? { previewDigest: digest } : {}), issues: Object.freeze([...issues]) });
    }
}

export function createSyntheticTrustedAgentService(
    now = Date.parse('2026-08-21T12:00:00.000Z'), clock: () => number = () => now,
): TrustedAgentService {
    const patientRef = 'synthetic-patient-001';
    return new TrustedAgentInterfaceService({
        credential: 'synthetic-agent-credential', sessionRef: 'session-synthetic-001', ambulatoryRef: 'ambulatory-synthetic-001',
        leaseRef: 'lease-synthetic-001', selectedPatientRef: patientRef, issuedAt: now - 60_000, expiresAt: now + 300_000,
        directory: [{ patientRef, displayName: 'Paziente Sintetico Uno', birthYear: 1970, archived: false, version: 3 }],
        projection: projectPatientOpenLoops({ patientRef, expectedSourceVersion: 3, items: [{ id: 'synthetic-item-001', patientId: patientRef,
            prescriptionId: 'synthetic-prescription-001', status: 'prescribed', serviceName: 'Controllo sintetico', createdAt: '2026-08-01T00:00:00.000Z' }],
        observations: [], now: new Date(now) }),
    }, clock);
}
