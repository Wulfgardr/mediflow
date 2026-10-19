export const PROFILE_QUERY_CONTRACT_VERSION = 1 as const;
export const PROFILE_QUERY_OPERATION_ID = 'patient-profile.read.v1' as const;
export const PROFILE_QUERY_RESULT_SCHEMA = 'mediflow.patient.profile-view.v1' as const;
export const PROFILE_QUERY_MAX_RESULT_BYTES = 32 * 1024;
export const PROFILE_QUERY_HANDLE_PATTERN = /^pph_[0-9a-f]{64}$/u;

export type ProfileProjection = 'profile' | 'notes';
export type ProfileQuery =
    | Readonly<{ kind: 'open'; contractVersion: 1; projection: ProfileProjection; expectedSelectionEpoch: number }>
    | Readonly<{ kind: 'read'; contractVersion: 1; projection: ProfileProjection; handle: string; expectedRevision: number }>;

export const PROFILE_FIELD_NAMES = Object.freeze([
    'firstName', 'lastName', 'taxCode', 'birthDate', 'address', 'phone', 'caregiver',
    'diagnoses', 'exemptions', 'notes', 'isAdi', 'isArchived', 'statusReason', 'archiveReason', 'archiveNote',
] as const);

export type ProfileFields = Readonly<{
    firstName: string; lastName: string; taxCode: string; birthDate: string | null;
    address: string | null; phone: string | null; caregiver: string | null;
    diagnoses: string | null; exemptions: string | null; notes: string | null;
    isAdi: boolean | null; isArchived: boolean | null;
    statusReason: string | null; archiveReason: string | null; archiveNote: string | null;
}>;
export type ProfileCurrentness = Readonly<{
    revision: number; selectionEpoch: number; observedAt: number; expiresAt: number;
}>;
type ProfileResultBase = Readonly<{
    schemaVersion: typeof PROFILE_QUERY_RESULT_SCHEMA;
    operationId: typeof PROFILE_QUERY_OPERATION_ID;
    contractVersion: 1;
    handle: string;
    currentness: ProfileCurrentness;
}>;
export type ProfileResult = ProfileResultBase & (
    | Readonly<{ projection: 'profile'; profile: ProfileFields }>
    | Readonly<{ projection: 'notes'; profile: Readonly<{ notes: string | null }> }>
);

export type ProfileQueryErrorCode =
    | 'input_invalid' | 'session_unavailable' | 'scope_denied' | 'selection_conflict'
    | 'handle_unavailable' | 'handle_expired' | 'revision_conflict' | 'query_unavailable' | 'output_too_large' | 'cancelled';

export class ProfileQueryError extends Error {
    readonly code: ProfileQueryErrorCode;
    constructor(code: ProfileQueryErrorCode) {
        super(`Patient profile query unavailable: ${code}`);
        this.code = code;
        this.name = 'ProfileQueryError';
    }
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== null && prototype !== Object.prototype) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return null;
        const result: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor?.enumerable || !('value' in descriptor)) return null;
            result[key] = descriptor.value;
        }
        return result;
    } catch { return null; }
}

function integer(value: unknown, minimum: number): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum;
}

export function parseProfileQuery(value: unknown): ProfileQuery | null {
    const open = exact(value, ['kind', 'contractVersion', 'projection', 'expectedSelectionEpoch']);
    if (open?.kind === 'open' && open.contractVersion === PROFILE_QUERY_CONTRACT_VERSION
        && (open.projection === 'profile' || open.projection === 'notes') && integer(open.expectedSelectionEpoch, 0)) {
        return Object.freeze({ kind: 'open', contractVersion: 1, projection: open.projection,
            expectedSelectionEpoch: open.expectedSelectionEpoch });
    }
    const read = exact(value, ['kind', 'contractVersion', 'projection', 'handle', 'expectedRevision']);
    if (read?.kind === 'read' && read.contractVersion === PROFILE_QUERY_CONTRACT_VERSION
        && (read.projection === 'profile' || read.projection === 'notes')
        && typeof read.handle === 'string' && PROFILE_QUERY_HANDLE_PATTERN.test(read.handle) && integer(read.expectedRevision, 1)) {
        return Object.freeze({ kind: 'read', contractVersion: 1, projection: read.projection,
            handle: read.handle, expectedRevision: read.expectedRevision });
    }
    return null;
}

export function isProfileResult(value: unknown): value is ProfileResult {
    const result = exact(value, ['schemaVersion', 'operationId', 'contractVersion', 'handle', 'projection', 'currentness', 'profile']);
    if (!result || result.schemaVersion !== PROFILE_QUERY_RESULT_SCHEMA || result.operationId !== PROFILE_QUERY_OPERATION_ID
        || result.contractVersion !== PROFILE_QUERY_CONTRACT_VERSION || typeof result.handle !== 'string'
        || !PROFILE_QUERY_HANDLE_PATTERN.test(result.handle)) return false;
    const current = exact(result.currentness, ['revision', 'selectionEpoch', 'observedAt', 'expiresAt']);
    if (!current || !integer(current.revision, 1) || !integer(current.selectionEpoch, 1)
        || !integer(current.observedAt, 0) || !integer(current.expiresAt, 1) || current.expiresAt <= current.observedAt) return false;
    const fields = result.projection === 'profile' ? PROFILE_FIELD_NAMES : result.projection === 'notes' ? ['notes'] : null;
    if (!fields) return false;
    const profile = exact(result.profile, fields);
    if (!profile) return false;
    return fields.every(key => {
        const field = profile[key];
        if (key === 'isAdi' || key === 'isArchived') return field === null || typeof field === 'boolean';
        if (key === 'firstName' || key === 'lastName' || key === 'taxCode') return typeof field === 'string';
        return field === null || typeof field === 'string';
    });
}

export function assertProfileResultBudget(result: ProfileResult): void {
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PROFILE_QUERY_MAX_RESULT_BYTES) {
        throw new ProfileQueryError('output_too_large');
    }
}
