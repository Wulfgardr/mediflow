import assert from 'node:assert/strict';
import test from 'node:test';

import {
    PROFILE_OBSERVATION_VITALS,
    PROFILE_THERAPY_MEDICATION,
    validateObservationDocument,
    validateProfileDocumentWithLookup,
    validateTherapyDocumentWithLookup,
} from './fse-validation';

test('validateTherapyDocumentWithLookup reports blocking errors and warnings separately', async () => {
    const result = await validateTherapyDocumentWithLookup(
        {
            drugName: '',
            atc: 'A10',
        },
        async () => false,
    );

    assert.deepEqual(
        result.errors.map((issue) => issue.code),
        ['REQUIRED'],
    );
    assert.deepEqual(
        result.warnings.map((issue) => issue.code),
        ['MISSING_AIC', 'ATC_FORMAT', 'ATC_NOT_FOUND'],
    );
});

test('validateTherapyDocumentWithLookup accepts a known ATC profile without warnings', async () => {
    const result = await validateTherapyDocumentWithLookup(
        {
            drugName: 'Metformin',
            aic: '012345678',
            atc: 'A10BA02',
        },
        async (code) => code === 'A10BA02',
    );

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
});

test('validateObservationDocument enforces LOINC, UCUM and numeric value', () => {
    const result = validateObservationDocument({
        codeSystem: 'SNOMED-CT',
        code: '9999-9',
        unitSystem: 'mg',
        unitCode: 'mg',
        value: 'abc',
    });

    assert.deepEqual(
        result.errors.map((issue) => issue.code),
        ['LOINC_REQUIRED', 'UNKNOWN_LOINC', 'UCUM_REQUIRED', 'UNKNOWN_UCUM', 'NUMERIC_REQUIRED'],
    );
    assert.deepEqual(result.warnings, []);
});

test('validateProfileDocumentWithLookup returns ok=true when only warnings are present', async () => {
    const result = await validateProfileDocumentWithLookup(
        PROFILE_THERAPY_MEDICATION,
        {
            drugName: 'Ramipril',
            atc: 'C09AA05',
        },
        async () => false,
    );

    assert.ok(result);
    assert.equal(result?.ok, true);
    assert.deepEqual(result?.errors, []);
    assert.deepEqual(
        result?.warnings.map((issue) => issue.code),
        ['MISSING_AIC', 'ATC_NOT_FOUND'],
    );
});

test('validateProfileDocumentWithLookup returns ok=false when observation profile has blocking errors', async () => {
    const result = await validateProfileDocumentWithLookup(
        PROFILE_OBSERVATION_VITALS,
        {
            codeSystem: 'LOINC',
            code: '8480-6',
            unitSystem: 'UCUM',
            unitCode: 'mm[Hg]',
            value: 'abc',
        },
        async () => true,
    );

    assert.ok(result);
    assert.equal(result?.ok, false);
    assert.deepEqual(result?.errors.map((issue) => issue.code), ['NUMERIC_REQUIRED']);
    assert.deepEqual(result?.warnings, []);
});

test('validateProfileDocumentWithLookup returns null for unsupported profiles', async () => {
    const result = await validateProfileDocumentWithLookup(
        'unsupported-profile',
        {},
        async () => true,
    );

    assert.equal(result, null);
});
