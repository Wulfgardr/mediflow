/* @Codex: therapy-specific object, own-key and date boundary; shared clinical normalizers are unchanged. */
import { v4 as uuidv4 } from 'uuid';
import { readBoundedJsonBody } from './bounded-request-body';

export type TherapySurface = 'web' | 'v1' | 'network';
export type TherapyMutation = 'create' | 'update' | 'delete';
type Invalid = { ok: false; status: 400; error: string };
const invalid = (error = 'Invalid JSON body'): Invalid => ({ ok: false, status: 400, error });
const hasOwn = (body: Record<string, unknown>, name: string) => Object.prototype.hasOwnProperty.call(body, name);

const CREATE_FIELDS = new Set(['id', 'drugName', 'aic', 'atc', 'activePrinciple', 'dosage', 'motivation',
    'diagnosisCode', 'diagnosisName', 'status', 'startDate', 'endDate']);
const UPDATE_FIELDS = new Set(['version', 'drugName', 'aic', 'atc', 'activePrinciple', 'dosage',
    'motivation', 'diagnosisCode', 'diagnosisName', 'status', 'startDate', 'endDate']);
const DELETE_FIELDS = new Set(['version', 'deletedAt', 'deletionReason']);
const LOCAL_THERAPY_JSON_MAX_BYTES = 4_194_304;

export function therapyJsonObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

/* @Codex: bounded request-json read occurs after route auth, before any DB effects. */
export async function readTherapyJsonObject(request: Request, surface: TherapySurface, operation: TherapyMutation) {
    const parsed = await readBoundedJsonBody(request, LOCAL_THERAPY_JSON_MAX_BYTES, 'request-json');
    if (!parsed.ok) return parsed.status === 413
        ? { ok: false as const, status: 413 as const, error: 'Richiesta troppo grande.' }
        : invalid(operation === 'delete' || surface !== 'web' ? 'Invalid JSON body' : 'Payload non valido');
    const body = therapyJsonObject(parsed.value);
    return body ? { ok: true as const, body }
        : invalid(operation === 'delete' || surface !== 'web' ? 'Invalid JSON body' : 'Payload non valido');
}

function dateValue(value: unknown, nullable = false): boolean {
    if (nullable && (value === null || value === '')) return true;
    if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) return false;
    if (typeof value === 'string' && !value.trim()) return false;
    return Number.isFinite(new Date(value).getTime());
}

function allowedFields(surface: TherapySurface, operation: TherapyMutation): Set<string> {
    if (operation === 'delete') return DELETE_FIELDS;
    const fields = new Set(operation === 'create' ? CREATE_FIELDS : UPDATE_FIELDS);
    if (operation === 'create') {
        if (surface === 'web') fields.add('patientId');
        if (surface !== 'network') { fields.add('createdAt'); fields.add('updatedAt'); }
    } else {
        if (surface !== 'web') { fields.add('deletedAt'); fields.add('deletionReason'); }
        if (surface === 'v1' || surface === 'web') fields.add('updatedAt');
    }
    return fields;
}

/* @Codex: Web keeps Zod and route mapping; this guards only inputs that Zod strips or coerces. */
export function validateTherapyInput(body: Record<string, unknown>, surface: TherapySurface, operation: TherapyMutation): Invalid | null {
    if (!Object.keys(body).every((name) => allowedFields(surface, operation).has(name))) return invalid();
    if (operation === 'create' && hasOwn(body, 'id') && (typeof body.id !== 'string' || !body.id.trim())) return invalid('Invalid id');
    if (operation === 'delete') return null;
    for (const name of ['startDate', 'endDate', 'updatedAt', 'createdAt', 'deletedAt'] as const) {
        if (!hasOwn(body, name)) continue;
        if (!dateValue(body[name], name === 'endDate' || name === 'deletedAt')) {
            if (surface === 'web' && name !== 'updatedAt' && name !== 'createdAt') return invalid('Payload non valido');
            return invalid(`Invalid ${name}`);
        }
    }
    return null;
}

export function therapyCreateId(body: Record<string, unknown>): string {
    return hasOwn(body, 'id') ? body.id as string : uuidv4();
}

export function safeTherapyExpectedVersion(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER
        ? value : null;
}

export function parseTherapyDeleteInput(body: Record<string, unknown>, defaultReason: string) {
    const shape = validateTherapyInput(body, 'web', 'delete');
    if (shape) return shape;
    if (hasOwn(body, 'deletedAt') && (body.deletedAt === null || body.deletedAt === '' || !dateValue(body.deletedAt))) {
        return invalid('Invalid deletedAt');
    }
    const deletionReason = hasOwn(body, 'deletionReason') ? body.deletionReason : defaultReason;
    if (typeof deletionReason !== 'string' || !deletionReason.trim()) return invalid('Invalid deletionReason');
    const expectedVersion = safeTherapyExpectedVersion(body.version);
    if (expectedVersion === null) return invalid('Version is required');
    return { ok: true as const, expectedVersion, body: {
        deletedAt: hasOwn(body, 'deletedAt') ? body.deletedAt : new Date(),
        deletionReason: deletionReason.trim(),
    } };
}

export function therapyChangedFields(values: Record<string, unknown>, body: Record<string, unknown>): string[] {
    return Object.keys(body).filter((name) => hasOwn(values, name) && values[name] !== undefined
        && !['id', 'patientId', 'version', 'createdAt'].includes(name)
        && (name !== 'updatedAt' || !hasOwn(values, 'id')));
}
