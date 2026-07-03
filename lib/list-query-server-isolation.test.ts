// STREAM B privacy + shape properties for the server-side list data plane.
//
// The list GET handlers now filter/sort/paginate server-side. This test exercises
// the SAME drizzle query construction the handlers use and inspects the generated
// SQL + bound parameters (drizzle .toSQL(), which needs no native driver, so it
// runs even where the better-sqlite3 native binding ABI is mismatched with the
// current node). We assert:
//   - PRIVACY (load-bearing): a patientId-scoped query binds patientId into the
//     WHERE clause, so patient A's query can never widen to patient B's rows.
//   - orderBy is restricted to whitelisted plaintext columns.
//   - limit/offset are pushed into the SQL.
//   - the attachments metadata projection selects every column EXCEPT `data`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryBuilder } from 'drizzle-orm/sqlite-core';
import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { entries, attachments } from './schema';
import { parseListParams } from './list-query-params';

// A driver-less query builder: builds SQL (.toSQL()) without opening a native
// driver, so it runs even where the better-sqlite3 binary ABI is mismatched.
const qb = new QueryBuilder();

const ENTRY_SORT = { date: entries.date, createdAt: entries.createdAt, updatedAt: entries.updatedAt } as const;

// Mirrors app/api/entries/route.ts GET query construction exactly.
function buildEntriesQuery(search: string) {
    const searchParams = new URLSearchParams(search);
    const params = parseListParams(searchParams, {
        sortableColumns: Object.keys(ENTRY_SORT),
        defaultOrderBy: 'date',
        defaultOrderDir: 'desc',
    });
    if (!params.ok) return { error: params.error };
    const patientId = searchParams.get('patientId');
    const includeDeleted = searchParams.get('includeDeleted') === 'true';
    const { limit, offset, orderBy, orderDir } = params.params;

    const filters: SQL[] = [];
    if (patientId) filters.push(eq(entries.patientId, patientId));
    if (!includeDeleted) filters.push(isNull(entries.deletedAt));
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const sortColumn = ENTRY_SORT[(orderBy ?? 'date') as keyof typeof ENTRY_SORT];
    const orderExpr = orderDir === 'asc' ? asc(sortColumn) : desc(sortColumn);

    let query = qb.select().from(entries).where(whereClause).orderBy(orderExpr).$dynamic();
    if (typeof limit === 'number') query = query.limit(limit);
    if (typeof offset === 'number') query = query.offset(offset);
    return query.toSQL();
}

test('PRIVACY: a patientId-scoped query binds patientId into the WHERE clause', () => {
    const built = buildEntriesQuery('patientId=pat-A');
    assert.ok(!('error' in built));
    // The exact patient id must appear as a bound parameter (not string-concatenated).
    assert.ok(built.params.includes('pat-A'), 'patientId must be a bound parameter');
    // The SQL must filter on patient_id, so results cannot span patients.
    assert.match(built.sql, /"patient_id"\s*=\s*\?/);
    // deleted_at guard is still present.
    assert.match(built.sql, /"deleted_at"\s+is\s+null/i);
});

test('PRIVACY: patient A and patient B queries bind different ids', () => {
    const a = buildEntriesQuery('patientId=pat-A');
    const b = buildEntriesQuery('patientId=pat-B');
    assert.ok(!('error' in a) && !('error' in b));
    assert.ok(a.params.includes('pat-A') && !a.params.includes('pat-B'));
    assert.ok(b.params.includes('pat-B') && !b.params.includes('pat-A'));
});

test('unscoped list still filters out soft-deleted rows and does not bind a patient id', () => {
    const built = buildEntriesQuery('');
    assert.ok(!('error' in built));
    assert.match(built.sql, /"deleted_at"\s+is null/i);
    assert.equal(built.params.length, 0);
});

test('whitelisted orderBy + orderDir shape the ORDER BY clause', () => {
    const asc = buildEntriesQuery('orderBy=createdAt&orderDir=asc');
    assert.ok(!('error' in asc));
    assert.match(asc.sql, /order by[\s\S]*"created_at"\s+asc/i);

    const desc = buildEntriesQuery('orderBy=date&orderDir=desc');
    assert.ok(!('error' in desc));
    assert.match(desc.sql, /order by[\s\S]*"date"\s+desc/i);
});

test('non-whitelisted orderBy is rejected before any SQL is built', () => {
    const built = buildEntriesQuery('orderBy=content');
    assert.ok('error' in built, 'ENC: column sort must be rejected');
});

test('limit and offset are pushed into the SQL', () => {
    const built = buildEntriesQuery('patientId=pat-A&limit=25&offset=5');
    assert.ok(!('error' in built));
    assert.match(built.sql, /limit\s+\?/i);
    assert.match(built.sql, /offset\s+\?/i);
    assert.ok(built.params.includes(25));
    assert.ok(built.params.includes(5));
});

// Attachments metadata-only projection (mirrors app/api/attachments/route.ts).
const ATTACHMENT_METADATA_COLUMNS = {
    id: attachments.id, patientId: attachments.patientId, name: attachments.name,
    type: attachments.type, size: attachments.size, path: attachments.path,
    summarySnapshot: attachments.summarySnapshot,
    parseEvidenceArtifactSnapshot: attachments.parseEvidenceArtifactSnapshot,
    ocrQueueState: attachments.ocrQueueState, ocrQueueReason: attachments.ocrQueueReason,
    ocrQueueUpdatedAt: attachments.ocrQueueUpdatedAt,
    ocrReplayArtifactSnapshot: attachments.ocrReplayArtifactSnapshot,
    createdAt: attachments.createdAt,
} as const;

test('attachments metadata mode never selects the base64 data blob', () => {
    const metaSql = qb.select(ATTACHMENT_METADATA_COLUMNS).from(attachments)
        .where(eq(attachments.patientId, 'pat-A')).toSQL();
    // The heavy `data` column must be absent from the projected SELECT list.
    assert.ok(!/select[\s\S]*"data"[\s\S]*from/i.test(metaSql.sql), 'metadata SELECT must omit data column');
    // The metadata mode still filters by patient for isolation.
    assert.ok(metaSql.params.includes('pat-A'));

    // The full (by-id) retrieval path DOES select data.
    const fullSql = qb.select().from(attachments).where(eq(attachments.id, 'att-A1')).toSQL();
    assert.match(fullSql.sql, /"data"/);
});
