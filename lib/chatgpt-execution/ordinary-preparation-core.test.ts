void import.meta.url;
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockOrdinaryModule } from './ordinary-module.test-support.ts';
import { profiles, configuration } from './ordinary-content.test-support.ts';
let attempts = 0;
mockOrdinaryModule(import.meta.url, '../ai-preparation/preparation-core', { namedExports: {
    createContentPreparation() { attempts++; throw new Error('ai_preparation_invalid'); },
    readPreparedContent() { throw new Error('ai_preparation_invalid'); },
    isPreparedContentCurrent() { return false; },
} });
const { createOrdinaryPreparation } = await import('./ordinary-preparation');
test('every ordinary adapter must enter the shared core and propagate its refusal', () => {
    for (const profile of profiles()) {
        const before = attempts;
        assert.throws(() => createOrdinaryPreparation(profile, configuration), /ordinary_preparation_invalid/);
        assert.equal(attempts, before + 1);
    }
});
