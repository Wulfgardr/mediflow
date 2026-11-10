import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

test('ogni numero di ADR identifica un solo documento, addendum a parte', () => {
    const owners = new Map<string, string[]>();
    for (const name of readdirSync('docs/adr')) {
        const number = /^(\d{4})-.+\.md$/u.exec(name)?.[1];
        if (!number || name.endsWith('-addendum.md')) continue;
        owners.set(number, [...(owners.get(number) ?? []), name]);
    }
    assert.deepEqual([...owners].filter(([, names]) => names.length > 1), []);
});
