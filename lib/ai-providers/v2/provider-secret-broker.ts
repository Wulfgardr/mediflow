/* @Codex */

export const PROVIDER_SECRET_LEASE_SCHEMA = 'mediflow.ai.provider-secret-lease.v2' as const;
export const PROVIDER_SECRET_LEASE_TTL_MS = 30_000;

const OPERATIONS = ['patient_insight', 'smart_import', 'document_synthesis', 'ocr', 'treatment_reasoning'] as const;
const SOURCE_KEYS = ['now', 'readEnv'] as const;
const ISSUE_KEYS = ['providerId', 'operation', 'generation', 'secretRef'] as const;
const CLAIM_KEYS = ['providerId', 'operation', 'generation'] as const;
const REF_KEYS = ['scheme', 'name'] as const;
const SECRET_NAMES = Object.freeze({ openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' } as const);

type CloudProviderId = keyof typeof SECRET_NAMES;
type ProviderOperation = typeof OPERATIONS[number];
type LeaseState = 'available' | 'consumed' | 'expired' | 'revoked';
declare const LEASE_BRAND: unique symbol;
export type ProviderSecretLeaseV2 = Readonly<{ [LEASE_BRAND]: true }>;
export type ProviderSecretLeaseSnapshotV2 = Readonly<{
    schemaVersion: typeof PROVIDER_SECRET_LEASE_SCHEMA; providerId: CloudProviderId;
    operation: ProviderOperation; generation: number; expiresAt: number; state: LeaseState;
}>;
export type ProviderHeaderInjectorV2 = (sink: { set(name: string, value: string): unknown }) => void;

export type ProviderSecretBrokerV2ErrorCode = 'input_invalid' | 'secret_ref_invalid' | 'secret_absent'
    | 'clock_invalid' | 'lease_invalid' | 'lease_expired' | 'lease_revoked' | 'lease_consumed'
    | 'provider_mismatch' | 'operation_mismatch' | 'generation_mismatch' | 'injection_failed' | 'injection_missing';

export class ProviderSecretBrokerV2Error extends Error {
    constructor(public readonly code: ProviderSecretBrokerV2ErrorCode) {
        super(`Provider secret broker rejected: ${code}`); this.name = 'ProviderSecretBrokerV2Error';
    }
}

type SecretCell = { value: string };
type LeaseRecord = {
    providerId: CloudProviderId; operation: ProviderOperation; generation: number;
    expiresAt: number; state: LeaseState; secretRef: string | null; cell: SecretCell;
};

function exactRecord(value: unknown, keys: readonly string[], code: ProviderSecretBrokerV2ErrorCode): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderSecretBrokerV2Error(code);
    let prototype: object | null; let ownKeys: (string | symbol)[];
    try { prototype = Object.getPrototypeOf(value); ownKeys = Reflect.ownKeys(value); } catch { throw new ProviderSecretBrokerV2Error(code); }
    if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
        || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) throw new ProviderSecretBrokerV2Error(code);
    return value as Record<string, unknown>;
}
function read(source: Record<string, unknown>, keys: readonly string[], code: ProviderSecretBrokerV2ErrorCode): unknown[] {
    try { return keys.map((key) => source[key]); } catch { throw new ProviderSecretBrokerV2Error(code); }
}
function clear(record: LeaseRecord): void { record.cell.value = ''; record.secretRef = null; }

export function createProviderSecretBrokerV2(sourcesValue: unknown) {
    const sources = exactRecord(sourcesValue, SOURCE_KEYS, 'input_invalid');
    const [nowValue, readEnvValue] = read(sources, SOURCE_KEYS, 'input_invalid');
    if (typeof nowValue !== 'function' || typeof readEnvValue !== 'function') throw new ProviderSecretBrokerV2Error('input_invalid');
    const nowSource = nowValue as () => unknown;
    const readEnv = readEnvValue as (name: string) => unknown;
    let lastNow = -1;
    const leases = new WeakMap<object, LeaseRecord>();

    const now = (): number => {
        let value: unknown;
        try { value = nowSource(); } catch { throw new ProviderSecretBrokerV2Error('clock_invalid'); }
        if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < lastNow) throw new ProviderSecretBrokerV2Error('clock_invalid');
        lastNow = value as number; return lastNow;
    };
    const recordFor = (lease: unknown): LeaseRecord => {
        if (!lease || typeof lease !== 'object') throw new ProviderSecretBrokerV2Error('lease_invalid');
        const record = leases.get(lease as object);
        if (!record) throw new ProviderSecretBrokerV2Error('lease_invalid');
        return record;
    };
    const expire = (record: LeaseRecord): void => {
        if (record.state !== 'available' && record.state !== 'consumed') return;
        let observed: number;
        try { observed = now(); } catch (error) { record.state = 'revoked'; clear(record); throw error; }
        if (observed >= record.expiresAt) { record.state = 'expired'; clear(record); }
    };
    const snapshot = (lease: unknown): ProviderSecretLeaseSnapshotV2 => {
        const record = recordFor(lease); expire(record);
        return Object.freeze({ schemaVersion: PROVIDER_SECRET_LEASE_SCHEMA, providerId: record.providerId,
            operation: record.operation, generation: record.generation, expiresAt: record.expiresAt, state: record.state });
    };
    const issue = (value: unknown): ProviderSecretLeaseV2 => {
        const source = exactRecord(value, ISSUE_KEYS, 'input_invalid');
        const [providerId, operation, generation, refValue] = read(source, ISSUE_KEYS, 'input_invalid');
        const ref = exactRecord(refValue, REF_KEYS, 'secret_ref_invalid');
        const [scheme, name] = read(ref, REF_KEYS, 'secret_ref_invalid');
        if ((providerId !== 'openai' && providerId !== 'anthropic') || !OPERATIONS.includes(operation as never)
            || !Number.isSafeInteger(generation) || (generation as number) < 1 || scheme !== 'env'
            || typeof name !== 'string' || name !== SECRET_NAMES[providerId]) throw new ProviderSecretBrokerV2Error('secret_ref_invalid');
        const secretName = name as typeof SECRET_NAMES[CloudProviderId];
        const issuedAt = now();
        if (issuedAt > Number.MAX_SAFE_INTEGER - PROVIDER_SECRET_LEASE_TTL_MS) throw new ProviderSecretBrokerV2Error('clock_invalid');
        let secret: unknown;
        try { secret = readEnv(secretName); } catch { throw new ProviderSecretBrokerV2Error('secret_absent'); }
        if (typeof secret !== 'string' || !/^\S{16,512}$/.test(secret)) throw new ProviderSecretBrokerV2Error('secret_absent');
        const lease = Object.freeze(Object.create(null)) as ProviderSecretLeaseV2;
        leases.set(lease, { providerId, operation: operation as ProviderOperation, generation: generation as number,
            expiresAt: issuedAt + PROVIDER_SECRET_LEASE_TTL_MS, state: 'available', secretRef: secretName, cell: { value: secret } });
        return lease;
    };
    const revoke = (lease: unknown): boolean => {
        const record = recordFor(lease);
        if (record.state === 'revoked') return false;
        record.state = 'revoked'; clear(record); return true;
    };
    const consume = async <T>(lease: unknown, claimValue: unknown,
        run: (inject: ProviderHeaderInjectorV2) => T | Promise<T>): Promise<T> => {
        const claim = exactRecord(claimValue, CLAIM_KEYS, 'input_invalid');
        const [providerId, operation, generation] = read(claim, CLAIM_KEYS, 'input_invalid');
        if (typeof run !== 'function') throw new ProviderSecretBrokerV2Error('input_invalid');
        const record = recordFor(lease); expire(record);
        if (record.state === 'expired') throw new ProviderSecretBrokerV2Error('lease_expired');
        if (record.state === 'revoked') throw new ProviderSecretBrokerV2Error('lease_revoked');
        if (record.state !== 'available') throw new ProviderSecretBrokerV2Error('lease_consumed');
        const mismatch = (code: 'provider_mismatch' | 'operation_mismatch' | 'generation_mismatch'): never => {
            record.state = 'revoked'; clear(record); throw new ProviderSecretBrokerV2Error(code);
        };
        if (providerId !== record.providerId) mismatch('provider_mismatch');
        if (operation !== record.operation) mismatch('operation_mismatch');
        if (generation !== record.generation) mismatch('generation_mismatch');
        record.state = 'consumed'; let active = true; let injected = false;
        const inject: ProviderHeaderInjectorV2 = Object.freeze((sink) => {
            if (record.state === 'revoked') throw new ProviderSecretBrokerV2Error('lease_revoked');
            if (!active || injected) throw new ProviderSecretBrokerV2Error('lease_consumed');
            expire(record); if (record.state === 'expired') throw new ProviderSecretBrokerV2Error('lease_expired');
            if (record.state !== 'consumed' || !record.cell.value) throw new ProviderSecretBrokerV2Error('lease_consumed');
            try {
                const setter = sink?.set;
                if (typeof setter !== 'function') throw new Error('sink');
                Reflect.apply(setter, sink, [record.providerId === 'openai' ? 'Authorization' : 'x-api-key',
                    record.providerId === 'openai' ? `Bearer ${record.cell.value}` : record.cell.value]);
            } catch { throw new ProviderSecretBrokerV2Error('injection_failed'); }
            injected = true; clear(record);
        });
        try {
            const result = await run(inject);
            if (!injected) throw new ProviderSecretBrokerV2Error('injection_missing');
            return result;
        } catch (error) {
            if (error instanceof ProviderSecretBrokerV2Error) throw new ProviderSecretBrokerV2Error(error.code);
            throw new ProviderSecretBrokerV2Error('injection_failed');
        } finally { active = false; clear(record); }
    };
    return Object.freeze({ issue, snapshot, revoke, consume });
}
