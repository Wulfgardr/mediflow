/* @Codex: diary-only input boundary; existing clinical normalizers remain shared and unchanged. */
import { v4 as uuidv4 } from 'uuid';
import { readBoundedJsonBody } from './bounded-request-body';
import { normalizeEntryCreateInput, normalizeEntryUpdateInput } from './api-v1-clinical-write-normalization';

export type EntrySurface = 'web' | 'v1' | 'network';
type Invalid = { ok: false; error: string; status: 400 | 413 };
const invalid = (error = 'Richiesta non valida.', status: 400 | 413 = 400): Invalid => ({ ok: false, error, status });
const hasOwn = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const CREATE_FIELDS = new Set(['id', 'type', 'title', 'date', 'content', 'setting', 'metadata', 'attachments']);
const UPDATE_FIELDS = new Set(['version', 'type', 'title', 'date', 'content', 'setting', 'metadata',
    'attachments', 'deletedAt', 'deletionReason']);
const DELETE_FIELDS = new Set(['version', 'deletedAt', 'deletionReason']);
const LOCAL_ENTRY_JSON_MAX_BYTES = 4_194_304;

/* @Codex: request-json compatibility, including duplicate-key behavior, without treating arrays as objects. */
export function entryJsonObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

export async function readEntryJsonObject(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | Invalid> {
    const parsed = await readBoundedJsonBody(request, LOCAL_ENTRY_JSON_MAX_BYTES, 'request-json');
    if (!parsed.ok) return invalid(parsed.status === 413 ? 'Richiesta troppo grande.' : 'Richiesta non valida.', parsed.status);
    const body = entryJsonObject(parsed.value);
    return body ? { ok: true, body } : invalid();
}

function allowed(body: Record<string, unknown>, fields: Set<string>): boolean {
    return Object.keys(body).every((key) => fields.has(key));
}

function dateValue(value: unknown, nullable = false): boolean {
    if (nullable && (value === null || value === '')) return true;
    if (typeof value === 'string') return value.trim().length > 0 && Number.isFinite(new Date(value).getTime());
    return typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
}

function validProvidedDates(body: Record<string, unknown>, names: readonly string[], nullable: readonly string[] = []): boolean {
    return names.every((name) => !hasOwn(body, name) || dateValue(body[name], nullable.includes(name)));
}

export function entryExpectedVersion(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER
        ? value : null;
}

export function prepareEntryCreate(body: Record<string, unknown>, surface: EntrySurface, patientId: string) {
    const fields = new Set(CREATE_FIELDS);
    if (surface === 'web') fields.add('patientId');
    if (surface !== 'network') { fields.add('createdAt'); fields.add('updatedAt'); }
    if (!allowed(body, fields)) return invalid();
    if (hasOwn(body, 'id') && (typeof body.id !== 'string' || body.id.trim().length === 0)) return invalid('Invalid id');
    if (surface === 'web' && (typeof body.patientId !== 'string' || body.patientId.trim().length === 0)) {
        return invalid('Invalid patientId');
    }
    if (!validProvidedDates(body, ['date', 'createdAt', 'updatedAt'])) return invalid('Invalid date');
    const id = hasOwn(body, 'id') ? body.id as string : uuidv4();
    const normalized = normalizeEntryCreateInput(body, { id, patientId });
    if (!normalized.ok) return invalid(normalized.error);
    return { ok: true as const, id, values: normalized.values,
        changedFields: Object.keys(normalized.values).filter((key) => !['id', 'patientId', 'version', 'createdAt', 'updatedAt'].includes(key)) };
}

export function prepareEntryUpdate(body: Record<string, unknown>, surface: EntrySurface, isDelete = false) {
    const fields = isDelete ? DELETE_FIELDS : new Set(UPDATE_FIELDS);
    if (!isDelete && surface !== 'network') fields.add('updatedAt');
    if (!allowed(body, fields)) return invalid();
    const expectedVersion = entryExpectedVersion(body.version);
    if (expectedVersion === null) return invalid('Version is required');
    if (isDelete) {
        const deletedAt = body.deletedAt;
        if (hasOwn(body, 'deletedAt') && !(deletedAt instanceof Date && Number.isFinite(deletedAt.getTime()))
            && !dateValue(deletedAt)) return invalid('Invalid deletedAt');
    } else if (!validProvidedDates(body, ['date', 'updatedAt', 'deletedAt'], ['deletedAt'])) {
        return invalid('Invalid date');
    }
    for (const name of ['type', 'content']) {
        if (hasOwn(body, name) && typeof body[name] !== 'string') return invalid(`Invalid ${name}`);
    }
    const normalized = normalizeEntryUpdateInput(body);
    if (!normalized.ok) return invalid(normalized.error);
    const changedFields = Object.entries(normalized.values)
        .filter(([name, value]) => value !== undefined && (name !== 'updatedAt' || hasOwn(body, 'updatedAt')))
        .map(([name]) => name);
    return { ok: true as const, expectedVersion, values: normalized.values, changedFields };
}

/* @Codex: DELETE keeps the legacy empty-body default, then validates only its own three fields. */
export async function parseEntryDeleteInput(request: Request, defaultReason: string) {
    const parsed = await readEntryJsonObject(request);
    if (!parsed.ok) return parsed;
    const body = parsed.body;
    if (!allowed(body, DELETE_FIELDS)) return invalid();
    if (hasOwn(body, 'deletedAt') && (body.deletedAt === null || body.deletedAt === '')) return invalid('Invalid deletedAt');
    const reason = hasOwn(body, 'deletionReason') ? body.deletionReason : defaultReason;
    if (typeof reason !== 'string' || !reason.trim()) return invalid('Invalid deletionReason');
    return { ok: true as const, body: {
        version: body.version,
        deletedAt: hasOwn(body, 'deletedAt') ? body.deletedAt : new Date(),
        deletionReason: reason.trim(),
    } };
}
