/* @Codex */
import 'server-only';
import { types } from 'node:util';

type AdapterKind = 'chat' | 'voice';
type Outcome = 'discovery' | 'read' | 'query' | 'orchestration' | 'preview' | 'proposal';
type Scalar = string | number | boolean;
type Input = Readonly<Record<string, Scalar>>;

export interface HeadlessSemanticRequest {
    adapterKind: AdapterKind;
    intent: string;
    requestRef: string;
    idempotencyRef: string;
}

export interface HeadlessSemanticOperation {
    operationId: string;
    capabilityId: string;
    applicationServiceRef: string;
    maximumStage: Outcome;
    fabricDependency: string | null;
    inputKeys: string[];
    execute(input: Input): unknown;
}

export interface HeadlessSemanticHost {
    acquireContext(): unknown;
    plan(intent: Readonly<{ adapterKind: AdapterKind; intent: string }>): unknown;
    authorize(input: Readonly<{ operationId: string; capabilityId: string; sessionRef: string; activeRole: string; leaseEpoch: number }>): unknown;
    registry: HeadlessSemanticOperation[];
    clock(): unknown;
    entropy(): unknown;
}

export class HeadlessSemanticError extends Error {
    constructor(readonly code: string) { super(code); this.name = 'HeadlessSemanticError'; }
}

const REQUEST_KEYS = ['adapterKind', 'intent', 'requestRef', 'idempotencyRef'] as const;
const HOST_KEYS = ['acquireContext', 'plan', 'authorize', 'registry', 'clock', 'entropy'] as const;
const OP_KEYS = ['operationId', 'capabilityId', 'applicationServiceRef', 'maximumStage', 'fabricDependency', 'inputKeys', 'execute'] as const;
const CONTEXT_KEYS = ['sessionRef', 'activeRole', 'leaseEpoch', 'revoked', 'maxOperations'] as const;
const PLAN_KEYS = ['operationId', 'input'] as const;
const AUTH_KEYS = ['allowed', 'policyDecision'] as const;
const OUTPUT_KEYS = ['outcome', 'response'] as const;
const OUTCOMES = new Set<Outcome>(['discovery', 'read', 'query', 'orchestration', 'preview', 'proposal']);
const REF = /^[a-z][a-z0-9-]*_[a-z0-9][a-z0-9.-]{7,63}$/;
const FORBIDDEN = /(?:^|[-_.:])(sql|sqlite|route|api|cli|provider|venue|authority|apply)(?:$|[-_.:])/i;
const SENSITIVE_INPUT = new Set(['name', 'codicefiscale', 'patientid', 'clinicalpayload', 'prompt', 'modeloutput', 'credential', 'cookie', 'token']);
const SENSITIVE_REF = /^(patient|clinical|prompt|model|credential|cookie|token)[-_.]/i;

function fail(code: string): never { throw new HeadlessSemanticError(code); }

function exactRecord(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') || Object.keys(descriptors).length !== keys.length) fail(code);
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail(code);
    }
    return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}

function denseStrings(value: unknown, code: string): string[] {
    if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length) fail(code);
    if (Reflect.ownKeys(value).some((key) => key !== 'length' && (typeof key !== 'string' || !/^\d+$/.test(key)))) fail(code);
    if (!value.every((item) => typeof item === 'string' && /^[a-z][A-Za-z0-9]{0,31}$/.test(item))) fail(code);
    return [...value];
}

function callable(value: unknown): value is (...args: never[]) => unknown {
    return typeof value === 'function' && !types.isProxy(value);
}

function safeScalar(value: unknown): value is Scalar {
    return typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value))
        || (typeof value === 'string' && REF.test(value) && !FORBIDDEN.test(value) && !SENSITIVE_REF.test(value));
}

function parseInput(value: unknown, keys: readonly string[]): Input {
    const input = exactRecord(value, keys, 'plan_invalid');
    if (!Object.values(input).every(safeScalar)) fail('plan_invalid');
    return Object.freeze(Object.assign(Object.create(null), input));
}

function parseContext(value: unknown) {
    const context = exactRecord(value, CONTEXT_KEYS, 'context_unavailable');
    if (typeof context.sessionRef !== 'string' || !REF.test(context.sessionRef) || typeof context.activeRole !== 'string' || !REF.test(context.activeRole)
        || !Number.isSafeInteger(context.leaseEpoch) || (context.leaseEpoch as number) < 1 || typeof context.revoked !== 'boolean'
        || !Number.isSafeInteger(context.maxOperations) || (context.maxOperations as number) < 1 || (context.maxOperations as number) > 66) fail('context_unavailable');
    if (context.revoked) fail('context_revoked');
    return context as { sessionRef: string; activeRole: string; leaseEpoch: number; revoked: false; maxOperations: number };
}

function sameContext(a: ReturnType<typeof parseContext>, b: ReturnType<typeof parseContext>) {
    return a.sessionRef === b.sessionRef && a.activeRole === b.activeRole && a.leaseEpoch === b.leaseEpoch && a.maxOperations === b.maxOperations;
}

export function createHeadlessSemanticOrchestrator(candidate: HeadlessSemanticHost) {
    const host = exactRecord(candidate, HOST_KEYS, 'host_invalid');
    for (const key of ['acquireContext', 'plan', 'authorize', 'clock', 'entropy']) if (!callable(host[key])) fail('host_invalid');
    if (!Array.isArray(host.registry) || types.isProxy(host.registry) || Object.getPrototypeOf(host.registry) !== Array.prototype || host.registry.length < 1 || host.registry.length > 66
        || Object.keys(host.registry).length !== host.registry.length
        || Reflect.ownKeys(host.registry).some((key) => key !== 'length' && (typeof key !== 'string' || !/^\d+$/.test(key)))) fail('host_invalid');
    const operations = new Map<string, HeadlessSemanticOperation>();
    for (const raw of host.registry) {
        const op = exactRecord(raw, OP_KEYS, 'registry_invalid');
        const keys = denseStrings(op.inputKeys, 'registry_invalid');
        if (typeof op.operationId !== 'string' || !/^op\.[a-z0-9.-]+$/.test(op.operationId) || FORBIDDEN.test(op.operationId)
            || typeof op.capabilityId !== 'string' || !/^web-(0[1-9]|[1-5]\d|6[0-6])-[a-z0-9-]+$/.test(op.capabilityId)
            || typeof op.applicationServiceRef !== 'string' || !/^appsvc:[a-z0-9-]+$/.test(op.applicationServiceRef) || FORBIDDEN.test(op.applicationServiceRef)
            || typeof op.maximumStage !== 'string' || !OUTCOMES.has(op.maximumStage as Outcome)
            || !(op.fabricDependency === null || (typeof op.fabricDependency === 'string' && /^fabric:[a-z0-9-]+$/.test(op.fabricDependency)))
            || keys.some((key) => FORBIDDEN.test(key) || SENSITIVE_INPUT.has(key.toLowerCase()))
            || !callable(op.execute) || operations.has(op.operationId)) fail('registry_invalid');
        operations.set(op.operationId, Object.freeze({ ...op, inputKeys: Object.freeze(keys) }) as HeadlessSemanticOperation);
    }

    const seen = new Set<string>();
    let busy = false;
    let poisoned = false;
    const invoke = (fn: unknown, args: unknown[], code: string) => {
        let value: unknown;
        try { value = (fn as (...values: unknown[]) => unknown)(...args); } catch { if (poisoned) fail('operation_reentered'); fail(code); }
        if (poisoned) fail('operation_reentered');
        return value;
    };

    return Object.freeze({
        run(rawRequest: HeadlessSemanticRequest) {
            if (busy) { poisoned = true; fail('operation_reentered'); }
            busy = true; poisoned = false;
            try {
                const request = exactRecord(rawRequest, REQUEST_KEYS, 'request_invalid');
                if ((request.adapterKind !== 'chat' && request.adapterKind !== 'voice') || typeof request.intent !== 'string'
                    || !request.intent.startsWith('synthetic: ') || request.intent.length > 160 || /\b(sql|sqlite)\b/i.test(request.intent)
                    || typeof request.requestRef !== 'string' || !REF.test(request.requestRef)
                    || typeof request.idempotencyRef !== 'string' || !REF.test(request.idempotencyRef)) fail('request_invalid');
                const first = parseContext(invoke(host.acquireContext, [], 'context_unavailable'));
                const plan = exactRecord(invoke(host.plan, [Object.freeze({ adapterKind: request.adapterKind, intent: request.intent })], 'plan_unavailable'), PLAN_KEYS, 'plan_invalid');
                if (typeof plan.operationId !== 'string') fail('plan_invalid');
                const operation = operations.get(plan.operationId); if (!operation) fail('operation_unavailable');
                const input = parseInput(plan.input, operation.inputKeys);
                const auth = exactRecord(invoke(host.authorize, [Object.freeze({ operationId: operation.operationId, capabilityId: operation.capabilityId, sessionRef: first.sessionRef, activeRole: first.activeRole, leaseEpoch: first.leaseEpoch })], 'authorization_unavailable'), AUTH_KEYS, 'authorization_invalid');
                if (typeof auth.allowed !== 'boolean' || typeof auth.policyDecision !== 'string' || !/^per_operation_(allow|deny)$/.test(auth.policyDecision)) fail('authorization_invalid');
                if (!auth.allowed || auth.policyDecision !== 'per_operation_allow') fail('authorization_denied');
                const before = parseContext(invoke(host.acquireContext, [], 'context_unavailable'));
                if (!sameContext(first, before)) fail('context_stale');
                if (seen.has(request.idempotencyRef) || seen.has(request.requestRef)) fail('idempotency_replayed');
                seen.add(request.idempotencyRef); seen.add(request.requestRef);
                const output = exactRecord(invoke(operation.execute, [input], 'execution_unavailable'), OUTPUT_KEYS, 'service_output_invalid');
                if (output.outcome !== operation.maximumStage || typeof output.response !== 'string' || !output.response.startsWith('synthetic-response: ') || output.response.length > 200) fail('service_output_invalid');
                const actionRef = invoke(host.entropy, [], 'receipt_unavailable');
                const createdAt = invoke(host.clock, [], 'receipt_unavailable');
                const final = parseContext(invoke(host.acquireContext, [], 'context_unavailable'));
                if (!sameContext(first, final)) fail('context_stale');
                if (typeof actionRef !== 'string' || !REF.test(actionRef) || typeof createdAt !== 'string'
                    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) || new Date(createdAt).toISOString() !== createdAt) fail('receipt_unavailable');
                return Object.freeze({ response: output.response, receipt: Object.freeze({ requestRef: request.requestRef, actionRef, capabilityId: operation.capabilityId, outcome: output.outcome, policyDecision: auth.policyDecision, revisionBinding: `lease:${first.leaseEpoch}`, createdAt }), writesPerformed: 0 as const, applyPolicy: 'none' as const });
            } finally { busy = false; poisoned = false; }
        },
    });
}
