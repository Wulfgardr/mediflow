/* @Codex */
'use strict';

const control = require('./control-record.cjs');
const activation = require('./session-activation.cjs');
const cells = require('./session-cell.cjs');
const resolver = require('./session-resolver.cjs');
const resources = require('./session-resource.cjs');
const retirement = require('./session-retirement.cjs');
const { successorFence } = require('./support/successor-fence.cjs');

const objectCreate = Object.create;
const objectEntries = Object.entries;
const objectFreeze = Object.freeze;
const reflectApply = Reflect.apply;
const dateNow = Date.now;
const numberIsSafeInteger = Number.isSafeInteger;
const mapSet = Map.prototype.set;
const mapValues = Map.prototype.values;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const setValues = Set.prototype.values;
const weakMapDelete = WeakMap.prototype.delete;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;

const SESSION_TTL_MS = 8 * 60 * 60 * 1_000;

function frozenRecord(values) {
    const value = objectCreate(null);
    for (const [key, item] of reflectApply(objectEntries, Object, [values])) value[key] = item;
    return objectFreeze(value);
}

function opaque() { return objectFreeze(objectCreate(null)); }
function retirementReason(value) {
    return value === 'lock' || value === 'dispose' || value === 'expired' || value === 'delete' || value === 'clear';
}

function weakValue(registry, key) {
    if ((typeof key !== 'object' || key === null) && typeof key !== 'function') return undefined;
    try { return reflectApply(weakMapGet, registry, [key]); } catch { return undefined; }
}

function createOwner() {
    const cellState = cells.createSessionCellState();
    const activationState = activation.createSessionActivationState();
    const retirementState = retirement.createSessionRetirementState();
    const resourceState = resources.createSessionResourceState();
    const sessions = new Map();
    const attempts = new WeakMap();
    const attemptRecords = new Set();
    const projections = new WeakMap();
    const cellBindings = new WeakMap();
    const resetCapabilities = new WeakMap();
    let operationActive = false;
    let operationPoisoned = false;
    let resetRecord = null;

    const now = () => reflectApply(dateNow, Date, []);
    const resolverState = {
        sessions,
        projections,
        now,
        poisoned: () => operationPoisoned,
        retireExpired: (cell) => retireCell(cell, 'expired'),
    };

    function enter(kind = 'normal') {
        if (operationActive) {
            operationPoisoned = true;
            return false;
        }
        if (kind === 'normal' && resetRecord?.state === 'prepared') return false;
        operationActive = true;
        operationPoisoned = false;
        return true;
    }

    function leave() {
        operationActive = false;
        operationPoisoned = false;
    }

    function burnAttempt(record) {
        if (!record || record.state !== 'pending') return;
        record.state = 'burned';
        try { reflectApply(weakMapDelete, attempts, [record.attempt]); } catch { /* terminal record remains burned */ }
        try { reflectApply(setDelete, attemptRecords, [record]); } catch { /* terminal record remains burned */ }
    }

    function cancelAttempt(record, at) {
        if (!record || record.state !== 'pending') return false;
        let result = 0;
        try {
            result = control.cancelPendingAuth(record.controlState, record.fence, record.operation,
                record.generation, record.fingerprint, at);
        } catch { /* pending capability is burned below */ }
        burnAttempt(record);
        return result === 1;
    }

    function bindingForCell(cell) { return weakValue(cellBindings, cell); }

    function cleanupRetired(binding, reason) {
        if (!binding) return frozenRecord({ outcome: 'denied' });
        try { return resources.cleanupRetiredCellResources(resourceState, cellState, binding.port, reason); }
        catch { return frozenRecord({ outcome: 'failed' }); }
    }

    function retireCell(cell, reason) {
        if (!cell || cell.state !== 'ACTIVE' || !retirementReason(reason)) return 'denied';
        const binding = bindingForCell(cell);
        if (!binding || binding.cell !== cell || binding.sessionId !== cell.session.id) return 'denied';
        let at;
        try { at = now(); } catch { return 'denied'; }
        if (operationPoisoned || !numberIsSafeInteger(at) || at < 0) return 'denied';
        let capability = null;
        try {
            capability = retirement.prepareRetirement(retirementState, binding.controlState, cellState,
                binding.ticket, binding.port, binding.sessionId, reason, at);
            if (!capability) {
                const observation = cells.inspectCell(cellState, binding.port);
                if (observation?.state === 'RETIRED') cleanupRetired(binding, reason);
                return 'denied';
            }
            const committed = retirement.commitRetirement(retirementState, binding.controlState, cellState, capability);
            const cleanup = cleanupRetired(binding, reason);
            return committed === 2 && !operationPoisoned ? cleanup.outcome : 'denied';
        } catch {
            if (capability) {
                try { retirement.abortRetirement(retirementState, binding.controlState, cellState, capability); }
                catch { /* terminal denial remains */ }
            }
            const observation = cells.inspectCell(cellState, binding.port);
            if (observation?.state === 'RETIRED') cleanupRetired(binding, reason);
            return 'denied';
        }
    }

    function begin(kind) {
        if (!enter()) return null;
        try {
            if (kind !== 'login' && kind !== 'setup') return null;
            const at = now();
            if (operationPoisoned) return null;
            const operation = successorFence();
            const fingerprint = successorFence();
            if (!numberIsSafeInteger(at) || at < 0 || !operation || !fingerprint || operation === fingerprint) return null;
            const controlState = control.createControlRecordState();
            const opened = control.beginControlOperation(controlState, kind, operation, fingerprint, at);
            if (!opened?.ok) return null;
            const attempt = opaque();
            const record = {
                state: 'pending', attempt, controlState, operation, fingerprint,
                fence: opened.fence, generation: opened.generation,
            };
            reflectApply(weakMapSet, attempts, [attempt, record]);
            reflectApply(setAdd, attemptRecords, [record]);
            return attempt;
        } catch { return null; }
        finally { leave(); }
    }

    function issue(attempt, user) {
        if (!enter()) return null;
        let record;
        let port = null;
        let ticket = null;
        let preparedActivation = null;
        try {
            record = weakValue(attempts, attempt);
            if (!record || record.state !== 'pending') return null;
            burnAttempt(record);
            const at = now();
            if (operationPoisoned) return null;
            const sessionId = successorFence();
            const expiresAt = at + SESSION_TTL_MS;
            if (!numberIsSafeInteger(at) || at < 0 || !numberIsSafeInteger(expiresAt) || !sessionId) return null;
            const staged = cells.stageWebSession(cellState, user, at, expiresAt);
            if (!staged) return null;
            const prepared = cells.prepareStagedWebSession(cellState, staged, sessionId, at);
            if (!prepared) return null;
            port = cells.armPreparedWebSession(cellState, prepared);
            if (!port) return null;
            const cell = cells.getCellForPort(cellState, port);
            if (!cell || cell.state !== 'ARMED_ACTIVATE' || cell.session.id !== sessionId) {
                cells.tombstoneArmedWebSession(cellState, port);
                return null;
            }
            ticket = control.prepareAuthControlTicket(record.controlState, record.fence, record.operation,
                record.generation, record.fingerprint, sessionId, at);
            if (!ticket) {
                cells.tombstoneArmedWebSession(cellState, port);
                return null;
            }
            preparedActivation = activation.prepareActivation(activationState, record.controlState, cellState,
                ticket, port, sessionId, at);
            if (!preparedActivation) {
                control.abortPreparedAuthControlTicket(record.controlState, ticket);
                cells.tombstoneArmedWebSession(cellState, port);
                return null;
            }
            const result = frozenRecord({ ok: true, sessionId });
            const binding = frozenRecord({ cell, controlState: record.controlState, ticket, port, sessionId });
            reflectApply(mapSet, sessions, [sessionId, cell]);
            reflectApply(weakMapSet, cellBindings, [cell, binding]);
            if (!activation.commitActivation(activationState, record.controlState, cellState, preparedActivation)) return null;
            return result;
        } catch {
            if (preparedActivation && record) {
                try { activation.abortActivation(activationState, record.controlState, cellState, preparedActivation); }
                catch { /* terminal denial remains */ }
            } else if (ticket && record) {
                try { control.abortPreparedAuthControlTicket(record.controlState, ticket); } catch { /* terminal */ }
            }
            if (port) {
                try { cells.tombstoneArmedWebSession(cellState, port); } catch { /* terminal */ }
            }
            return null;
        } finally { leave(); }
    }

    function abort(attempt) {
        if (!enter()) return false;
        try {
            const record = weakValue(attempts, attempt);
            const at = now();
            return !operationPoisoned && numberIsSafeInteger(at) && at >= 0 && cancelAttempt(record, at);
        } catch { return false; }
        finally { leave(); }
    }

    function resolve(sessionId) {
        if (!enter()) return frozenRecord({ status: 'owned_denied' });
        try { return resolver.resolve(resolverState, sessionId); }
        catch { return frozenRecord({ status: 'owned_denied' }); }
        finally { leave(); }
    }

    function retire(projection, reason) {
        if (!enter()) return frozenRecord({ outcome: 'denied' });
        try {
            const cell = resolver.authenticProjectionCell(resolverState, projection);
            const outcome = cell && !operationPoisoned ? retireCell(cell, reason) : 'denied';
            return frozenRecord({ outcome: operationPoisoned ? 'denied' : outcome });
        } catch { return frozenRecord({ outcome: 'denied' }); }
        finally { leave(); }
    }

    function retireForUser(projection) {
        if (!enter()) return frozenRecord({ outcome: 'denied' });
        try {
            const authorityCell = resolver.authenticProjectionCell(resolverState, projection);
            if (!authorityCell || operationPoisoned) return frozenRecord({ outcome: 'denied' });
            const userId = authorityCell.session.userId;
            const reason = 'delete';
            let outcome = 'completed';
            const roster = [...reflectApply(mapValues, sessions, [])];
            for (const cell of roster) {
                if (cell.state !== 'ACTIVE' || cell.session.userId !== userId) continue;
                const result = retireCell(cell, reason);
                if (result === 'failed') outcome = 'failed';
                else if (result === 'denied') return frozenRecord({ outcome: 'denied' });
            }
            return frozenRecord({ outcome: operationPoisoned ? 'denied' : outcome });
        } catch { return frozenRecord({ outcome: 'denied' }); }
        finally { leave(); }
    }

    function prepareAdminReset(projection) {
        if (!enter()) return null;
        try {
            const cell = resolver.authenticProjectionCell(resolverState, projection);
            if (!cell || cell.session.role !== 'admin' || operationPoisoned || resetRecord !== null
                || !cells.canTerminallyResetAllCells(cellState)) return null;
            const attemptRoster = [...reflectApply(setValues, attemptRecords, [])];
            const cellRoster = [...reflectApply(mapValues, sessions, [])];
            const bindingRoster = [];
            const controlStates = new Set();
            for (const record of attemptRoster) reflectApply(setAdd, controlStates, [record.controlState]);
            for (const current of cellRoster) {
                const binding = bindingForCell(current);
                if (!binding) continue;
                bindingRoster.push(binding);
                reflectApply(setAdd, controlStates, [binding.controlState]);
            }
            const controlRoster = [...reflectApply(setValues, controlStates, [])];
            for (const controlState of controlRoster) {
                if (!control.canTerminallyResetControlRecord(controlState)) return null;
            }
            const capability = opaque();
            const binding = {
                state: 'prepared', capability, attemptRoster, bindingRoster, controlRoster,
            };
            reflectApply(weakMapSet, resetCapabilities, [capability, binding]);
            resetRecord = binding;
            return capability;
        } catch { return null; }
        finally { leave(); }
    }

    function abortAdminReset(capability) {
        if (!enter('reset')) return false;
        try {
            const binding = weakValue(resetCapabilities, capability);
            if (!binding || binding !== resetRecord || binding.state !== 'prepared'
                || binding.capability !== capability) return false;
            binding.state = 'aborted';
            reflectApply(weakMapDelete, resetCapabilities, [capability]);
            resetRecord = null;
            return true;
        } catch { return false; }
        finally { leave(); }
    }

    function commitAdminReset(capability) {
        if (!enter('reset')) return frozenRecord({ outcome: 'denied' });
        let terminal = false;
        try {
            const binding = weakValue(resetCapabilities, capability);
            if (!binding || binding !== resetRecord || binding.state !== 'prepared'
                || binding.capability !== capability) return frozenRecord({ outcome: 'denied' });
            binding.state = 'committing';
            for (let index = 0; index < binding.attemptRoster.length; index += 1) {
                binding.attemptRoster[index].state = 'burned';
            }
            for (let index = 0; index < binding.controlRoster.length; index += 1) {
                control.terminallyResetControlRecord(binding.controlRoster[index]);
            }
            cells.terminallyResetAllCells(cellState);
            terminal = true;
            binding.state = 'committed';
            resetRecord = null;
            reflectApply(weakMapDelete, resetCapabilities, [capability]);
            for (let index = 0; index < binding.attemptRoster.length; index += 1) {
                const record = binding.attemptRoster[index];
                try { reflectApply(weakMapDelete, attempts, [record.attempt]); } catch { /* already terminal */ }
                try { reflectApply(setDelete, attemptRecords, [record]); } catch { /* already terminal */ }
            }
            let outcome = 'completed';
            for (let index = 0; index < binding.bindingRoster.length; index += 1) {
                const current = binding.bindingRoster[index];
                const cleanup = cleanupRetired(current, 'clear');
                if (cleanup.outcome !== 'completed') outcome = 'failed';
            }
            return frozenRecord({ outcome: operationPoisoned ? 'failed' : outcome });
        } catch { return frozenRecord({ outcome: terminal ? 'failed' : 'denied' }); }
        finally { leave(); }
    }

    function mintResourcePort(projection) {
        if (!enter()) return null;
        try {
            const cell = resolver.authenticProjectionCell(resolverState, projection);
            const binding = cell && bindingForCell(cell);
            const at = binding ? now() : null;
            return binding && !operationPoisoned
                ? resources.createResourcePort(resourceState, cellState, binding.port, at)
                : null;
        } catch { return null; }
        finally { leave(); }
    }

    function releaseResourcePort(port) {
        if (!enter()) return false;
        try { return resources.releaseResourcePort(resourceState, port); }
        catch { return false; }
        finally { leave(); }
    }

    function beginResourceUse(port) {
        if (!enter()) return null;
        try {
            const at = now();
            return operationPoisoned ? null : resources.prepareResourceUse(resourceState, port, at);
        }
        catch { return null; }
        finally { leave(); }
    }

    function commitResourceUse(use) {
        if (!enter()) return false;
        try {
            const at = now();
            return !operationPoisoned && resources.consumeResourceUse(resourceState, use, at);
        }
        catch { return false; }
        finally { leave(); }
    }

    function abortResourceUse(use) {
        if (!enter()) return false;
        try {
            const at = now();
            return !operationPoisoned && resources.consumeResourceUse(resourceState, use, at);
        }
        catch { return false; }
        finally { leave(); }
    }

    function registerPrivateResource(port, dispose) {
        if (!enter()) return null;
        try {
            const at = now();
            return operationPoisoned ? null : resources.registerResource(resourceState, port, dispose, at);
        }
        catch { return null; }
        finally { leave(); }
    }

    function unregisterPrivateResource(port, registration) {
        if (!enter()) return false;
        try { return resources.unregisterResource(resourceState, port, registration); }
        catch { return false; }
        finally { leave(); }
    }

    return objectFreeze({
        begin, issue, abort, resolve, retire, retireForUser,
        prepareAdminReset, commitAdminReset, abortAdminReset,
        mintResourcePort, releaseResourcePort, beginResourceUse, commitResourceUse, abortResourceUse,
        registerPrivateResource, unregisterPrivateResource,
    });
}

module.exports = objectFreeze({ createOwner });
