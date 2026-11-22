import encryptedFields from './backup-encrypted-fields.json';
import type { EncryptedColumnName, EncryptedFieldsTable } from './encrypted-columns';

export type { EncryptedColumnName, EncryptedFieldsTable };
export type ListSortDir = 'asc' | 'desc';

export type PlaintextSortMap<T extends EncryptedFieldsTable, TColumns extends Record<string, unknown>> = {
    readonly [K in keyof TColumns]: K extends EncryptedColumnName<T> ? never : TColumns[K];
};

export interface ParsedListParams {
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDir: ListSortDir;
    metadataOnly: boolean;
}

export type ParseListParamsResult =
    | { ok: true; params: ParsedListParams }
    | { ok: false; error: string };

export interface ListParamsSpec<T extends EncryptedFieldsTable = EncryptedFieldsTable> {
    table?: T;
    sortableColumns: readonly string[];
    defaultOrderBy?: string;
    defaultOrderDir?: ListSortDir;
    maxLimit?: number;
    allowMetadataOnly?: boolean;
}

const DEFAULT_MAX_LIMIT = 500;

function assertPlaintextColumns(table: EncryptedFieldsTable, columns: readonly string[]): void {
    const forbidden = new Set<string>(encryptedFields[table]);
    for (const column of columns) {
        if (forbidden.has(column)) {
            throw new Error(
                `Encrypted column "${column}" on table "${table}" cannot be used for server-side sorting (see lib/backup-encrypted-fields.json).`,
            );
        }
    }
}

export function definePlaintextSortColumns<
    T extends EncryptedFieldsTable,
    TColumns extends Record<string, unknown>,
>(table: T, columns: TColumns & PlaintextSortMap<T, TColumns>): Readonly<TColumns> {
    assertPlaintextColumns(table, Object.keys(columns));
    return Object.freeze({ ...columns });
}

function parseNonNegativeInt(raw: string | null): number | null | 'invalid' {
    if (raw === null) return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return 'invalid';
    if (!/^\d+$/.test(trimmed)) return 'invalid';
    const value = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(value)) return 'invalid';
    return value;
}

export function parseListParams<T extends EncryptedFieldsTable = EncryptedFieldsTable>(
    searchParams: URLSearchParams,
    spec: ListParamsSpec<T>,
): ParseListParamsResult {
    if (spec.table) assertPlaintextColumns(spec.table, spec.sortableColumns);
    const maxLimit = spec.maxLimit ?? DEFAULT_MAX_LIMIT;

    const limitRaw = parseNonNegativeInt(searchParams.get('limit'));
    if (limitRaw === 'invalid') return { ok: false, error: 'Invalid limit' };
    if (limitRaw !== null && (limitRaw < 1 || limitRaw > maxLimit)) {
        return { ok: false, error: `limit must be between 1 and ${maxLimit}` };
    }

    const offsetRaw = parseNonNegativeInt(searchParams.get('offset'));
    if (offsetRaw === 'invalid') return { ok: false, error: 'Invalid offset' };
    if (offsetRaw !== null && limitRaw === null) {
        return { ok: false, error: 'offset richiede limit' };
    }

    const orderByRaw = searchParams.get('orderBy');
    let orderBy: string | undefined = spec.defaultOrderBy;
    if (orderByRaw !== null) {
        const candidate = orderByRaw.trim();
        if (!spec.sortableColumns.includes(candidate)) {
            return { ok: false, error: `Cannot sort by '${candidate}'` };
        }
        orderBy = candidate;
    }

    const orderDirRaw = searchParams.get('orderDir');
    let orderDir: ListSortDir = spec.defaultOrderDir ?? 'desc';
    if (orderDirRaw !== null) {
        const candidate = orderDirRaw.trim().toLowerCase();
        if (candidate !== 'asc' && candidate !== 'desc') {
            return { ok: false, error: `Invalid orderDir '${orderDirRaw}'` };
        }
        orderDir = candidate;
    }

    let metadataOnly = false;
    const metadataRaw = searchParams.get('metadata');
    if (metadataRaw !== null) {
        if (!spec.allowMetadataOnly) {
            return { ok: false, error: 'metadata mode not supported for this resource' };
        }
        if (metadataRaw !== 'true' && metadataRaw !== 'false') {
            return { ok: false, error: `Invalid metadata flag '${metadataRaw}'` };
        }
        metadataOnly = metadataRaw === 'true';
    }

    return {
        ok: true,
        params: {
            limit: limitRaw ?? undefined,
            offset: offsetRaw ?? undefined,
            orderBy,
            orderDir,
            metadataOnly,
        },
    };
}

export function parseCappedLimit(raw: string | null, max: number): number | null {
    const parsed = parseNonNegativeInt(raw);
    if (parsed === null || parsed === 'invalid' || parsed < 1) return null;
    return Math.min(parsed, max);
}

export function parseDateParam(raw: string | null): Date | null {
    if (raw === null) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
