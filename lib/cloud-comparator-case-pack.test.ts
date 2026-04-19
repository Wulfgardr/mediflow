/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CLOUD_COMPARATOR_CASE_PACK_SCHEMA_VERSION,
    hasCloudComparatorApproval,
    parseCloudComparatorCasePack,
} from './cloud-comparator-case-pack.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFixture(name: string): unknown {
    const filePath = path.join(__dirname, '..', 'scripts', 'fixtures', name);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('parseCloudComparatorCasePack accepts the canonical example fixture', () => {
    const casePack = parseCloudComparatorCasePack(
        readFixture('cloud-comparator-case-pack.example.json'),
    );

    assert.equal(casePack.schemaVersion, CLOUD_COMPARATOR_CASE_PACK_SCHEMA_VERSION);
    assert.equal(casePack.origin.storage, 'private-shadow-vault');
    assert.equal(casePack.origin.sourceKind, 'document-bundle');
    assert.ok(casePack.patientInsight);
    assert.ok(casePack.smartImport);
    assert.equal(casePack.patientInsight?.expected.preferredSourceIds?.includes('S8'), true);
    assert.equal(casePack.smartImport?.expected.therapies?.[0]?.therapyState, 'active');
    assert.equal(casePack.distillation?.learningObjectives?.length, 2);
    assert.equal(casePack.distillation?.hypothesisTags?.includes('focus-recency'), true);
    assert.equal(hasCloudComparatorApproval(casePack), true);
});

test('parseCloudComparatorCasePack rejects packs without target lanes', () => {
    const fixture = readFixture('cloud-comparator-case-pack.example.json') as Record<string, unknown>;
    const broken = {
        ...fixture,
        patientInsight: undefined,
        smartImport: undefined,
    };

    assert.throws(
        () => parseCloudComparatorCasePack(broken),
        /Expected at least one target lane/,
    );
});

test('parseCloudComparatorCasePack rejects unsupported schema versions', () => {
    const fixture = readFixture('cloud-comparator-case-pack.example.json') as Record<string, unknown>;
    const broken = {
        ...fixture,
        schemaVersion: 'mediflow.cloud_comparator_case_pack.v9',
    };

    assert.throws(
        () => parseCloudComparatorCasePack(broken),
        /Unsupported schemaVersion/,
    );
});
