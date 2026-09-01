/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { COMPLIANCE_EVIDENCE_INVENTORY } from './compliance-evidence-inventory.ts';

test('espone un inventario tecnico con un claim ceiling non legale', () => {
    assert.equal(COMPLIANCE_EVIDENCE_INVENTORY.schemaVersion, 'mediflow.compliance-evidence.v1');
    assert.equal(COMPLIANCE_EVIDENCE_INVENTORY.claimCeiling, 'technical_evidence_inventory_only');
    assert.equal(COMPLIANCE_EVIDENCE_INVENTORY.legalVerdict, 'not_assessed');
    assert.deepEqual(
        COMPLIANCE_EVIDENCE_INVENTORY.records.map(({ id }) => id),
        [
            'data_protection_by_design',
            'security_controls',
            'backup_and_restore',
            'data_subject_workflows',
            'ai_transparency',
            'legal_applicability',
        ],
    );

    for (const record of COMPLIANCE_EVIDENCE_INVENTORY.records) {
        assert.ok(record.evidence.length > 0, `${record.id}: evidence`);
        assert.ok(record.limitation.length > 0, `${record.id}: limitation`);
        assert.ok(record.owner.length > 0, `${record.id}: owner`);
        assert.ok([
            'source_evidence',
            'source_evidence_with_limit',
            'external_assessment_required',
        ].includes(record.status), `${record.id}: status`);
    }

    assert.equal(Object.isFrozen(COMPLIANCE_EVIDENCE_INVENTORY), true);
    assert.equal(Object.isFrozen(COMPLIANCE_EVIDENCE_INVENTORY.records), true);
    assert.equal(
        COMPLIANCE_EVIDENCE_INVENTORY.records.at(-1)?.status,
        'external_assessment_required',
    );
});

test('mantiene i riferimenti normativi come input esterni senza classificare il prodotto', () => {
    const legal = COMPLIANCE_EVIDENCE_INVENTORY.records.at(-1);
    assert.equal(legal?.id, 'legal_applicability');
    assert.deepEqual(
        legal?.externalReferences.map(({ href }) => href),
        [
            'https://eur-lex.europa.eu/eli/reg/2016/679/art_25/oj/eng',
            'https://eur-lex.europa.eu/eli/reg/2016/679/art_32/oj/eng',
            'https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en',
        ],
    );
    assert.equal(legal?.owner, 'Organizzazione, referente legale e DPO');

    const serialized = JSON.stringify(COMPLIANCE_EVIDENCE_INVENTORY).toLowerCase();
    for (const forbidden of [
        'legal_verdict_compliant',
        'certified_compliant',
        'ai_act_classified',
        'gdpr_certified',
    ]) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
    }
});

test('la superficie Impostazioni e statica, sola lettura e dichiara il proprio limite', () => {
    const page = readFileSync('app/settings/compliance/page.tsx', 'utf8');
    assert.match(page, /COMPLIANCE_EVIDENCE_INVENTORY/u);
    assert.match(page, /Inventario di evidenze, non attestazione/u);
    assert.match(page, /data-testid="settings-compliance-section"/u);
    assert.doesNotMatch(page, /['"]use client['"]/u);
    assert.doesNotMatch(page, /<(?:form|button|input|select|textarea)\b/iu);
    assert.doesNotMatch(page, /\b(?:fetch|db\.)\s*\(/u);
});
