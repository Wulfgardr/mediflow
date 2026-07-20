import assert from 'node:assert/strict';
import test from 'node:test';

import { toFhirFullUrl, toFhirId } from './id';

/* @Codex */
test('toFhirId keeps normalized source identifiers distinct', () => {
    const sanitizedId = toFhirId('entry/a', 'encounter');
    const validId = toFhirId('entry-a', 'encounter');

    assert.notEqual(sanitizedId, validId);
    assert.notEqual(
        toFhirFullUrl('Encounter', sanitizedId),
        toFhirFullUrl('Encounter', validId),
    );
    assert.match(sanitizedId, /^[A-Za-z0-9-.]{1,64}$/);
    assert.equal(toFhirId('entry-a', 'encounter'), 'entry-a');
});
