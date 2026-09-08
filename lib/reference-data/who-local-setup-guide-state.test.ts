/* @Codex: status presentation cannot confer installation or current availability. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { whoSetupGuideStatus } from './who-local-setup-guide-state.ts';

test('configured is not a successful live probe; available is an observation, not a new check', () => {
    assert.match(whoSetupGuideStatus('configured'), /non conferma una risposta/u);
    assert.match(whoSetupGuideStatus('available'), /risposta diretta osservata/u);
    assert.match(whoSetupGuideStatus('available'), /nuova verifica/u);
});
test('all known statuses give a bounded next action and unknown status never reports ready', () => {
    for (const value of ['disabled', 'configuration_required', 'unavailable', 'error', 'loading', 'credentials_absent', 'offline', undefined, 'invented']) {
        const message = whoSetupGuideStatus(value);
        assert.ok(message.length > 10 && message.length < 300); assert.doesNotMatch(message, /installazione riuscita|WHO pronto/u);
    }
    assert.match(whoSetupGuideStatus('error'), /Riprova/u);
    assert.match(whoSetupGuideStatus('unavailable'), /Recupera/u);
    assert.match(whoSetupGuideStatus(undefined), /non riconosciuto/u);
});
