/** Software interpretation versions are separate from instrument editions and permissions.
 * Source evidence and unresolved human decisions: CREDITS.md#clinical-scales.
 * This register records review gaps; it is not an admission gate or an approval.
 */
export const MMSE_INTERPRETATION_VERSION = 'mediflow.mmse.screening-limits.v1';
export const GDS_INTERPRETATION_VERSION = 'mediflow.gds15.screening-limits.v1';
export const ADL_INTERPRETATION_VERSION = 'mediflow.adl.local-interpretation.v1';
export const IADL_INTERPRETATION_VERSION = 'mediflow.iadl.local-interpretation.v1';
export const POMA_INTERPRETATION_VERSION = 'mediflow.poma28.nonclassification.v1';

export function currentScaleInterpretation(scaleId: string, score: number, existingInterpretation: () => string): {
    interpretation: string;
    interpretationVersion: string;
} | null {
    if (scaleId === 'mmse') return {
        interpretationVersion: MMSE_INTERPRETATION_VERSION,
        interpretation: `Punteggio grezzo MMSE: ${score}/30. Screening cognitivo: il punteggio da solo non conferma né esclude una demenza. Interpretazione clinica richiesta; nessuna correzione per età, scolarità o lingua applicata.`,
    };
    if (scaleId === 'gds') return {
        interpretationVersion: GDS_INTERPRETATION_VERSION,
        interpretation: `Punteggio grezzo GDS-15: ${score}/15. Screening dei sintomi depressivi: il punteggio non formula una diagnosi né stabilisce la gravità. Valutazione clinica richiesta; versione italiana e periodo di riferimento da verificare.`,
    };
    // Identify the existing software wording without changing or approving it.
    const version = scaleId === 'adl' ? ADL_INTERPRETATION_VERSION
        : scaleId === 'iadl' ? IADL_INTERPRETATION_VERSION
            : scaleId === 'tinetti-poma28-v1' ? POMA_INTERPRETATION_VERSION : null;
    return version ? { interpretation: existingInterpretation(), interpretationVersion: version } : null;
}

const common = {
    evidenceCheckedOn: '2026-10-08',
    evidenceReference: 'CREDITS.md#clinical-scales',
    language: 'it-IT',
    missingAnswers: 'reject-incomplete-no-imputation',
    clinicalReviewer: null,
    rightsReviewer: null,
    permissionReference: null,
    permissionAttestation: 'project-owner-attested-2026-10-11',
    // This is an unresolved proposal, not a statement that new use is blocked.
    newUseDecision: 'hold-proposed-not-enforced',
} as const;

export const SCALE_USE_CONTRACTS = Object.freeze({
    'tinetti-poma28-v1': Object.freeze({
        ...common,
        definitionVersion: 'mediflow.poma28.v1',
        sourceId: 'shrops-nhs-fps006-v1-2012-07',
        sourceBinding: 'mapped-in-ADR-0118',
        population: 'mobility-assessment; local applicability requires review',
        scoring: '20 scored components; balance 16 + gait 12; total 0–28',
        interpretation: 'unchanged; no automatic fall-risk category',
        interpretationVersion: POMA_INTERPRETATION_VERSION,
        translation: 'local-unvalidated',
        rights: 'owner-attested-permission-not-inspected',
        reviewGap: 'Identify permission metadata and intended use; unvalidated does not mean invalid.',
    }),
    adl: Object.freeze({
        ...common,
        definitionVersion: 'unversioned-local-definition-at-db7232d',
        sourceId: 'hign-try-this-2-katz',
        sourceBinding: 'comparison-only; exact local adaptation unidentified',
        population: 'older adults; local applicability not established',
        scoring: '6 explicit binary answers; total 0–6',
        interpretation: 'legacy categories retained; not approved by this change',
        interpretationVersion: ADL_INTERPRETATION_VERSION,
        translation: 'local-source-unidentified',
        rights: 'owner-attested-permission-not-inspected',
        reviewGap: 'Dressing anchor and severity categories differ from HIGN; requires versioned instrument decision.',
    }),
    iadl: Object.freeze({
        ...common,
        definitionVersion: 'unversioned-local-definition-at-db7232d',
        sourceId: 'hign-try-this-23-lawton',
        sourceBinding: 'comparison-only; exact local adaptation unidentified',
        population: 'older adults; source excludes institutionalized use; local applicability needs review',
        scoring: '8 explicit binary answers for every assessment; total 0–8',
        interpretation: 'legacy functional summary retained; no sex-based denominator',
        interpretationVersion: IADL_INTERPRETATION_VERSION,
        translation: 'local-source-unidentified',
        rights: 'owner-attested-permission-not-inspected',
        reviewGap: 'Identify adopted item anchors, translation and metadata of the attested permission.',
    }),
    mmse: Object.freeze({
        ...common,
        definitionVersion: 'unversioned-local-definition-at-db7232d',
        sourceId: 'par-mmse; nice-ng97-1.2.4',
        sourceBinding: 'edition-and-Italian-translation-unidentified',
        population: 'cognitive screening; local language and normative applicability unverified',
        scoring: '28 required components; lang4 0–3, other components 0–1; total 0–30',
        interpretation: MMSE_INTERPRETATION_VERSION,
        interpretationVersion: MMSE_INTERPRETATION_VERSION,
        translation: 'local-source-unidentified',
        rights: 'owner-attested-permission-not-inspected',
        reviewGap: 'Identify edition, translation and metadata of the attested permission; private agreement not inspected.',
    }),
    gds: Object.freeze({
        ...common,
        definitionVersion: 'unversioned-local-definition-at-db7232d',
        sourceId: 'yesavage-gds-short-form-1986',
        sourceBinding: 'original-source-only; exact Italian version unidentified',
        population: 'depression screening in older adults; local applicability unverified',
        scoring: '15 explicit binary scored answers; total 0–15; no prorating',
        interpretation: GDS_INTERPRETATION_VERSION,
        interpretationVersion: GDS_INTERPRETATION_VERSION,
        translation: 'local-source-and-timeframe-unidentified',
        rights: 'original-public-domain; local-permission-owner-attested-not-inspected',
        reviewGap: 'Identify translation, reference period and metadata of the attested permission; original public-domain status is not an endorsement of this version.',
    }),
});
