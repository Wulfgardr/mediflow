import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListParams } from './list-query-params';

function sp(query: string): URLSearchParams {
    return new URLSearchParams(query);
}

const ENTRY_SPEC = {
    sortableColumns: ['date', 'createdAt', 'updatedAt'] as const,
    defaultOrderBy: 'date',
    defaultOrderDir: 'desc' as const,
};

test('no params yields defaults and backward-compatible shape', () => {
    const result = parseListParams(sp(''), ENTRY_SPEC);
    assert.ok(result.ok);
    assert.equal(result.params.limit, undefined);
    assert.equal(result.params.offset, undefined);
    assert.equal(result.params.orderBy, 'date');
    assert.equal(result.params.orderDir, 'desc');
    assert.equal(result.params.metadataOnly, false);
});

test('valid limit and offset parse to integers', () => {
    const result = parseListParams(sp('limit=50&offset=10'), ENTRY_SPEC);
    assert.ok(result.ok);
    assert.equal(result.params.limit, 50);
    assert.equal(result.params.offset, 10);
});

test('offset=0 is a valid explicit offset', () => {
    const result = parseListParams(sp('offset=0'), ENTRY_SPEC);
    assert.ok(result.ok);
    assert.equal(result.params.offset, 0);
});

test('garbage limit is rejected with 400-worthy error', () => {
    for (const bad of ['abc', '-1', '1.5', '', ' ', '1e3', '0x10']) {
        const result = parseListParams(sp(`limit=${encodeURIComponent(bad)}`), ENTRY_SPEC);
        assert.equal(result.ok, false, `limit='${bad}' should be rejected`);
    }
});

test('limit below 1 or above maxLimit is rejected', () => {
    assert.equal(parseListParams(sp('limit=0'), ENTRY_SPEC).ok, false);
    const big = parseListParams(sp('limit=100000'), { ...ENTRY_SPEC, maxLimit: 500 });
    assert.equal(big.ok, false);
});

test('garbage offset is rejected', () => {
    for (const bad of ['abc', '-5', '2.2', '']) {
        assert.equal(parseListParams(sp(`offset=${encodeURIComponent(bad)}`), ENTRY_SPEC).ok, false);
    }
});

test('orderBy must be in the whitelist; encrypted-column sort is rejected', () => {
    const ok = parseListParams(sp('orderBy=createdAt'), ENTRY_SPEC);
    assert.ok(ok.ok);
    assert.equal(ok.params.orderBy, 'createdAt');

    // 'content' and 'title' are ENC: columns and must never be sortable.
    for (const forbidden of ['content', 'title', 'notes', 'drop table', 'id; --']) {
        assert.equal(
            parseListParams(sp(`orderBy=${encodeURIComponent(forbidden)}`), ENTRY_SPEC).ok,
            false,
            `orderBy='${forbidden}' must be rejected`,
        );
    }
});

test('orderDir accepts asc/desc case-insensitively and rejects anything else', () => {
    assert.equal(parseListParams(sp('orderDir=asc'), ENTRY_SPEC).ok && parseListParams(sp('orderDir=asc'), ENTRY_SPEC).ok, true);
    const asc = parseListParams(sp('orderDir=ASC'), ENTRY_SPEC);
    assert.ok(asc.ok);
    assert.equal(asc.params.orderDir, 'asc');
    assert.equal(parseListParams(sp('orderDir=sideways'), ENTRY_SPEC).ok, false);
    assert.equal(parseListParams(sp('orderDir='), ENTRY_SPEC).ok, false);
});

test('metadata flag is rejected unless the spec opts in', () => {
    assert.equal(parseListParams(sp('metadata=true'), ENTRY_SPEC).ok, false);

    const attachmentSpec = {
        sortableColumns: ['createdAt', 'size', 'type'] as const,
        defaultOrderBy: 'createdAt',
        allowMetadataOnly: true,
    };
    const on = parseListParams(sp('metadata=true'), attachmentSpec);
    assert.ok(on.ok);
    assert.equal(on.params.metadataOnly, true);

    const off = parseListParams(sp('metadata=false'), attachmentSpec);
    assert.ok(off.ok);
    assert.equal(off.params.metadataOnly, false);

    assert.equal(parseListParams(sp('metadata=yes'), attachmentSpec).ok, false);
});
