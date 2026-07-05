import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// WUL-268 (STREAM A): happy-path test for the schema drift check. On a clean
// checkout, lib/schema.ts and the runtime bootstrap (drizzle migrations +
// applySchemaGuards) agree, so the check must exit 0 and print an OK line.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK_SCRIPT = path.join(HERE, 'check-schema-drift.mjs');

test('check:schema-drift passes on a clean checkout', () => {
    const result = spawnSync(process.execPath, [CHECK_SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env },
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(
        result.status,
        0,
        `expected exit 0 from check-schema-drift, got ${result.status}. Output:\n${output}`,
    );
    assert.match(output, /\[schema-drift\] OK:/);
});
