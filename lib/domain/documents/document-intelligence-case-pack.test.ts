/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DOCUMENT_INTELLIGENCE_CASE_PACK_SCHEMA_VERSION,
    collectDocumentIntelligenceFactKinds,
    parseDocumentIntelligenceCasePack,
} from './document-intelligence-case-pack.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFixture(name: string): unknown {
    const filePath = path.join(__dirname, '..', '..', '..', 'scripts', 'fixtures', name);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('parseDocumentIntelligenceCasePack accepts the canonical example fixture', () => {
    const casePack = parseDocumentIntelligenceCasePack(
        readFixture('document-intelligence-case-pack.example.json'),
    );

    assert.equal(casePack.schemaVersion, DOCUMENT_INTELLIGENCE_CASE_PACK_SCHEMA_VERSION);
    assert.equal(casePack.id, 'doc-lab-discharge-femur-001');
    assert.equal(casePack.archetype, 'discharge-letter');

    const kinds = collectDocumentIntelligenceFactKinds(casePack);
    assert.deepEqual(
        kinds.sort(),
        ['care_setting', 'followup', 'functional_status', 'medication', 'problem'],
    );

    assert.ok(casePack.expectedSmartImport?.diagnosisLabels?.includes('Frattura pertrocanterica del femore sinistro'));
    assert.ok(casePack.negativeAssertions.some((assertion) => assertion.reason === 'family_history'));
    assert.ok(casePack.negativeAssertions.some((assertion) => assertion.reason === 'historical_only'));
});

test('parseDocumentIntelligenceCasePack rejects required evidence kinds missing from gold facts', () => {
    const fixture = readFixture('document-intelligence-case-pack.example.json') as Record<string, unknown>;
    const broken = {
        ...fixture,
        expectedEvidencePack: {
            requiredKinds: ['problem', 'followup', 'care_setting', 'functional_status', 'medication', 'unknown_kind'],
        },
    };

    assert.throws(
        () => parseDocumentIntelligenceCasePack(broken),
        /Expected one of problem, medication, followup, care_setting, functional_status/,
    );
});

test('parseDocumentIntelligenceCasePack rejects unsupported schema versions', () => {
    const fixture = readFixture('document-intelligence-case-pack.example.json') as Record<string, unknown>;
    const broken = {
        ...fixture,
        schemaVersion: 'mediflow.document_case_pack.v9',
    };

    assert.throws(
        () => parseDocumentIntelligenceCasePack(broken),
        /Unsupported schemaVersion/,
    );
});
