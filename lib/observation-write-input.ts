/* @Codex: ordinary observation JSON and own-key validation; shared clinical normalizers remain unchanged. */
import { v4 as uuidv4 } from 'uuid';
import { readBoundedJsonBody } from './bounded-request-body';

export type ObservationSurface = 'web' | 'v1' | 'network';
export type ObservationMutation = 'create' | 'update' | 'delete';
type Invalid = { ok: false; status: 400; error: string };
const invalid = (error = 'Invalid JSON body'): Invalid => ({ ok: false, status: 400, error });
const hasOwn = (body: Record<string, unknown>, name: string) => Object.prototype.hasOwnProperty.call(body, name);
const LOCAL_OBSERVATION_JSON_MAX_BYTES = 4_194_304;
const CLINICAL_FIELDS = ['codeSystem', 'code', 'display', 'unitSystem', 'unitCode', 'value',
    'notes', 'refLow', 'refHigh', 'refText', 'observedAt', 'source'];
const CREATE_FIELDS = new Set(['id', ...CLINICAL_FIELDS]);
const UPDATE_FIELDS = new Set(['version', ...CLINICAL_FIELDS, 'deletedAt', 'deletionReason']);
const DELETE_FIELDS = new Set(['version', 'deletedAt', 'deletionReason']);

export function observationJsonObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

/* @Codex: only local ingress uses this NEW byte cap, after the route auth gate. */
export async function readObservationJsonObject(request: Request) {
    const parsed = await readBoundedJsonBody(request, LOCAL_OBSERVATION_JSON_MAX_BYTES, 'request-json');
    if (!parsed.ok) return parsed.status === 413
        ? { ok: false as const, status: 413 as const, error: 'Richiesta troppo grande.' }
        : invalid();
    const body = observationJsonObject(parsed.value);
    return body ? { ok: true as const, body } : invalid();
}

function dateValue(value: unknown, nullable = false): boolean {
    if (nullable && (value === null || value === '')) return true;
    if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) return false;
    if (typeof value === 'string' && !value.trim()) return false;
    return Number.isFinite(new Date(value).getTime());
}

function allowedFields(surface: ObservationSurface, operation: ObservationMutation): Set<string> {
    if (operation === 'delete') return DELETE_FIELDS;
    const fields = new Set(operation === 'create' ? CREATE_FIELDS : UPDATE_FIELDS);
    if (operation === 'create') {
        if (surface === 'web') fields.add('patientId');
        if (surface !== 'network') { fields.add('createdAt'); fields.add('updatedAt'); }
    } else {
        if (surface !== 'network') fields.add('updatedAt');
        if (surface === 'web') fields.add('servicePrescriptionItemId');
    }
    if (surface === 'web' && operation === 'create') fields.add('servicePrescriptionItemId');
    return fields;
}

export function validateObservationInput(body: Record<string, unknown>, surface: ObservationSurface,
    operation: ObservationMutation): Invalid | null {
    if (!Object.keys(body).every((name) => allowedFields(surface, operation).has(name))) return invalid();
    if (operation === 'create' && hasOwn(body, 'id') && (typeof body.id !== 'string' || !body.id.trim())) {
        return invalid('Invalid id');
    }
    if (operation === 'delete') return null;
    for (const name of ['observedAt', 'updatedAt', 'createdAt', 'deletedAt'] as const) {
        if (!hasOwn(body, name)) continue;
        if (!dateValue(body[name], name === 'deletedAt')) return invalid(`Invalid ${name}`);
    }
    return null;
}

export function observationCreateId(body: Record<string, unknown>): string {
    return hasOwn(body, 'id') ? body.id as string : uuidv4();
}

export function safeObservationExpectedVersion(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER
        ? value : null;
}

export function parseObservationDeleteInput(body: Record<string, unknown>, defaultReason: string) {
    const shape = validateObservationInput(body, 'web', 'delete');
    if (shape) return shape;
    if (hasOwn(body, 'deletedAt') && (body.deletedAt === null || body.deletedAt === '' || !dateValue(body.deletedAt))) {
        return invalid('Invalid deletedAt');
    }
    const deletionReason = hasOwn(body, 'deletionReason') ? body.deletionReason : defaultReason;
    if (typeof deletionReason !== 'string' || !deletionReason.trim()) return invalid('Invalid deletionReason');
    const expectedVersion = safeObservationExpectedVersion(body.version);
    if (expectedVersion === null) return invalid('Version is required');
    return { ok: true as const, expectedVersion, body: {
        deletedAt: hasOwn(body, 'deletedAt') ? body.deletedAt : new Date(), deletionReason: deletionReason.trim(),
    } };
}

export function observationChangedFields(values: Record<string, unknown>, body: Record<string, unknown>): string[] {
    return Object.keys(body).filter((name) => hasOwn(values, name) && values[name] !== undefined
        && !['id', 'patientId', 'version', 'createdAt'].includes(name)
        && !(name === 'updatedAt' && hasOwn(values, 'id')));
}
