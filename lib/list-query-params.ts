// Server-side list query parameter parsing + whitelisting.
//
// STREAM B (kill full-table fetch+decrypt): the list GET handlers used to fetch
// entire tables and let the client filter/sort/limit in memory after decrypting
// every row. This module gives each handler a small, table-scoped validator so it
// can filter and sort server-side on PLAINTEXT columns only.
//
// SECURITY: we only ever sort/filter on plaintext columns (patient_id, ids,
// timestamps). Encrypted (ENC:) columns are opaque server-side and must never be
// used as an orderBy/filter target: sorting ciphertext is meaningless and could
// leak ordering. Every sortable column here is whitelisted per table.

export type ListSortDir = 'asc' | 'desc';

export interface ParsedListParams {
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDir: ListSortDir;
    /* attachments-only: when true the list omits the heavy base64 `data` blob. */
    metadataOnly: boolean;
}

export type ParseListParamsResult =
    | { ok: true; params: ParsedListParams }
    | { ok: false; error: string };

export interface ListParamsSpec {
    // Whitelist of plaintext columns that may be used as orderBy targets.
    // MUST NOT include any ENC:-encrypted column.
    sortableColumns: readonly string[];
    // Default column to order by when none is requested (must be in sortableColumns).
    defaultOrderBy?: string;
    defaultOrderDir?: ListSortDir;
    // Upper bound on limit to keep responses bounded.
    maxLimit?: number;
    // When true, the `metadata` param is recognised (attachments list mode).
    allowMetadataOnly?: boolean;
}

const DEFAULT_MAX_LIMIT = 500;

function parseNonNegativeInt(raw: string | null): number | null | 'invalid' {
    if (raw === null) return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return 'invalid';
    // Reject anything that is not a plain base-10 non-negative integer.
    if (!/^\d+$/.test(trimmed)) return 'invalid';
    const value = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(value)) return 'invalid';
    return value;
}

// Parse and whitelist the generic list params (limit/offset/orderBy/orderDir and
// the attachments metadata flag). patientId/conversationId are handled directly by
// the route because they map to a required equality filter, not a shape option.
export function parseListParams(
    searchParams: URLSearchParams,
    spec: ListParamsSpec,
): ParseListParamsResult {
    const maxLimit = spec.maxLimit ?? DEFAULT_MAX_LIMIT;

    const limitRaw = parseNonNegativeInt(searchParams.get('limit'));
    if (limitRaw === 'invalid') return { ok: false, error: 'Invalid limit' };
    if (limitRaw !== null && (limitRaw < 1 || limitRaw > maxLimit)) {
        return { ok: false, error: `limit must be between 1 and ${maxLimit}` };
    }

    const offsetRaw = parseNonNegativeInt(searchParams.get('offset'));
    if (offsetRaw === 'invalid') return { ok: false, error: 'Invalid offset' };
    // SQLite rejects OFFSET without an accompanying LIMIT, so an offset alone
    // would 500 at query time. Require a limit whenever offset is supplied.
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
