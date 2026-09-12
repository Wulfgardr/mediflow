/* @Codex — internal list unit tests; installed-root tests prove runtime authority. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../packages/web-auth-lifecycle-owner/internal/session-resource.cjs', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
function fixture() {
    const unitModule = { exports: {} };
    const cellPort = Object.freeze({});
    const cell = { state: 'ACTIVE', resourcePortsRevoked: false, resourcePortHead: null,
        sessionId: 'synthetic', session: { id: 'synthetic', userId: 'synthetic', authChannel: 'web', expiresAt: Date.now() + 60000 } };
    const cellState = {};
    runInThisContext(`(function(require,module){${source}\n})`)(name => name === './session-cell.cjs'
        ? { getCellForPort: (state, port) => state === cellState && port === cellPort ? cell : null }
        : require(name), unitModule);
    const api = unitModule.exports, state = api.createSessionResourceState();
    const mint = () => api.createResourcePort(state, cellState, cellPort);
    return { api, state, cell, cellState, cellPort, mint };
}
function count(head) { let n = 0; for (let record = head; record; record = record.next) { assert.ok(++n < 10000); } return n; }

test('repeated admissions retain only live ports and uses, without global historical heads', () => {
    const f = fixture(), persistent = f.mint();
    const persistentRecord = f.api.getResourceRecord(f.state, persistent);
    const liveUse = f.api.prepareResourceUse(f.state, persistent);
    for (let i = 0; i < 1000; i++) {
        const port = f.mint(), use = f.api.prepareResourceUse(f.state, port);
        assert.equal(f.api.consumeResourceUse(f.state, use), true);
        assert.equal(f.api.consumeResourceUse(f.state, use), false);
        assert.equal(f.api.releaseResourcePort(f.state, port), true);
        assert.equal(f.api.getResourceRecord(f.state, port), null);
        const status = f.api.prepareResourceUse(f.state, persistent);
        assert.equal(f.api.consumeResourceUse(f.state, status), true);
    }
    assert.equal(count(f.cell.resourcePortHead), 1);
    assert.equal(count(persistentRecord.useHead), 1);
    assert.equal(f.api.isCurrentResourceUse(f.state, liveUse), true);
    for (const name of ['portHead', 'useHead', 'registrationHead']) assert.equal(Object.hasOwn(f.state, name), false);
    f.api.releaseResourcePort(f.state, persistent);
    assert.equal(f.cell.resourcePortHead, null);
    assert.equal(f.api.isCurrentResourceUse(f.state, liveUse), false);
    assert.equal(persistentRecord.session, null);
});

test('removal preserves neighbouring resources and unregister never invokes disposers', () => {
    const f = fixture(), ports = [f.mint(), f.mint(), f.mint()];
    f.api.releaseResourcePort(f.state, ports[1]);
    assert.equal(count(f.cell.resourcePortHead), 2);
    const port = ports[0], record = f.api.getResourceRecord(f.state, port);
    let disposed = 0;
    const registrations = Array.from({ length: 3 }, () => f.api.registerResource(f.state, port, () => { disposed++; }));
    assert.equal(f.api.unregisterResource(f.state, port, registrations[1]), true);
    assert.equal(f.api.unregisterResource(f.state, port, registrations[1]), false);
    assert.equal(count(record.registrationHead), 2); assert.equal(disposed, 0);
    f.cell.state = 'RETIRED';
    assert.equal(f.api.cleanupRetiredCellResources(f.state, f.cellState, f.cellPort, 'lock').outcome, 'completed');
    assert.equal(disposed, 2); assert.equal(f.cell.resourcePortHead, null);
    assert.equal(record.registrationHead, null); assert.equal(record.session, null);
    assert.equal(f.api.getResourceRecord(f.state, port), null);
    f.api.cleanupRetiredCellResources(f.state, f.cellState, f.cellPort, 'lock');
    assert.equal(disposed, 2);
});

test('retirement clears concurrent uses and continues after a throwing disposer', () => {
    const f = fixture(), port = f.mint(), record = f.api.getResourceRecord(f.state, port);
    const uses = Array.from({ length: 3 }, () => f.api.prepareResourceUse(f.state, port));
    f.api.consumeResourceUse(f.state, uses[1]);
    let disposed = 0;
    f.api.registerResource(f.state, port, () => { disposed++; });
    f.api.registerResource(f.state, port, () => { throw new Error('synthetic cleanup failure'); });
    f.cell.state = 'RETIRED';
    assert.equal(f.api.cleanupRetiredCellResources(f.state, f.cellState, f.cellPort, 'lock').outcome, 'failed');
    assert.equal(disposed, 1); assert.equal(record.useHead, null); assert.equal(f.cell.resourcePortHead, null);
    for (const use of uses) assert.equal(f.api.isCurrentResourceUse(f.state, use), false);
});
