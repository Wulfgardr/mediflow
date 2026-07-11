/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractClinicalDosageNeedles, normalizeClinicalText } from './clinical-text-normalization';

test('clinical text normalization keeps Italian accents and drug keys equivalent', () => {
    assert.equal(normalizeClinicalText('Terapìa domiciliare: già prescritta'), 'terapia domiciliare gia prescritta');
    assert.equal(
        normalizeClinicalText('Metformìna Cloridrato 1.000 mg'),
        normalizeClinicalText('metformina-cloridrato 1 000 MG'),
    );
});

test('clinical dosage needles normalize equivalent unit formats', () => {
    assert.deepEqual(
        extractClinicalDosageNeedles('Metformina 1,25 mg e insulina 4 UI'),
        ['1.25mg', '4ui'],
    );
});
