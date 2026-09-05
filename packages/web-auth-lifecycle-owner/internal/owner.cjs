/* @Codex */
'use strict';

const { types: { isProxy } } = require('node:util');
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
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetOwnPropertyNames = Object.getOwnPropertyNames;
const objectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const reflectApply = Reflect.apply;
const dateNow = Date.now;
const numberIsSafeInteger = Number.isSafeInteger;
const numberConstructor = Number;
const stringCharCodeAt = String.prototype.charCodeAt;
const mapClear = Map.prototype.clear;
const mapDelete = Map.prototype.delete;
const mapEntries = Map.prototype.entries;
const mapGet = Map.prototype.get;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size').get;
const mapSet = Map.prototype.set;
const mapValues = Map.prototype.values;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const setHas = Set.prototype.has;
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size').get;
const setValues = Set.prototype.values;
const weakMapDelete = WeakMap.prototype.delete;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const IDEMPOTENCY_TTL_MS = 300_000;
const IDEMPOTENCY_CAP = 64;

function readSessionTtl() {
    let raw;
    try { raw = process.env.MEDIFLOW_SESSION_TTL_MS; } catch { return null; }
    if (raw === undefined) return DEFAULT_SESSION_TTL_MS;
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 16) return null;
    for (let index = 0; index < raw.length; index += 1) {
        const code = reflectApply(stringCharCodeAt, raw, [index]);
        if (code < 48 || code > 57) return null;
    }
    const value = numberConstructor(raw);
    return numberIsSafeInteger(value) && value > 0 ? value : null;
}

const SESSION_TTL_MS = readSessionTtl();

function frozenRecord(values) {
    const value = objectCreate(null);
    for (const [key, item] of reflectApply(objectEntries, Object, [values])) value[key] = item;
    return objectFreeze(value);
}

function opaque() { return objectFreeze(objectCreate(null)); }
function opaqueToken(value) {
    if (typeof value !== 'string' || value.length !== 64) return false;
    for (let index = 0; index < value.length; index += 1) {
        const code = reflectApply(stringCharCodeAt, value, [index]);
        if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) return false;
    }
    return true;
}
function boundedText(value) { return typeof value === 'string' && value.length >= 16 && value.length <= 256; }
function exactTransport(value) {
    if (!value || typeof value !== 'object' || isProxy(value)) return null;
    try {
        if (objectGetPrototypeOf(value) !== objectPrototype || objectGetOwnPropertySymbols(value).length !== 0) return null;
        const names = objectGetOwnPropertyNames(value);
        if (names.length !== 3 || names[0] !== 'controlId' || names[1] !== 'ifMatch'
            || names[2] !== 'idempotencyKey') return null;
        const controlId = objectGetOwnPropertyDescriptor(value, 'controlId');
        const ifMatch = objectGetOwnPropertyDescriptor(value, 'ifMatch');
        const idempotencyKey = objectGetOwnPropertyDescriptor(value, 'idempotencyKey');
        if (!controlId || !ifMatch || !idempotencyKey || !('value' in controlId) || !('value' in ifMatch)
            || !('value' in idempotencyKey) || !controlId.enumerable || !ifMatch.enumerable
            || !idempotencyKey.enumerable || !opaqueToken(controlId.value) || !opaqueToken(ifMatch.value)
            || !boundedText(idempotencyKey.value)) return null;
        return frozenRecord({ controlId: controlId.value, ifMatch: ifMatch.value, idempotencyKey: idempotencyKey.value });
    } catch { return null; }
}
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
    const controls = new Map();
    const attempts = new WeakMap();
    const attemptRecords = new Set();
    const projections = new WeakMap();
    const cellBindings = new WeakMap();
    const userRetirementCapabilities = new WeakMap();
    const userRetirements = new Set();
    const resetCapabilities = new WeakMap();
    let loginEpoch = 0;
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

    function mapValue(registry, key) {
        try { return reflectApply(mapGet, registry, [key]); } catch { return undefined; }
    }

    function snapshot(entry) {
        try { return entry ? control.snapshotControlRecord(entry.state) : null; } catch { return null; }
    }

    function currentControl(controlId) {
        if (!opaqueToken(controlId)) return null;
        const entry = mapValue(controls, controlId);
        const observed = snapshot(entry);
        return entry && observed?.controlId === controlId ? entry : null;
    }

    function purgeReplays(entry, at) {
        try {
            const iterator = reflectApply(mapEntries, entry.replays, []);
            for (const [key, replay] of iterator) {
                if (!replay || !numberIsSafeInteger(replay.createdAt) || replay.createdAt < 0
                    || at - replay.createdAt >= IDEMPOTENCY_TTL_MS) {
                    reflectApply(mapDelete, entry.replays, [key]);
                }
            }
        } catch { return false; }
        return true;
    }

    function replayFor(entry, key) {
        try { return reflectApply(mapGet, entry.replays, [key]) ?? null; } catch { return null; }
    }

    function canAddReplay(entry, at) {
        return purgeReplays(entry, at)
            && reflectApply(mapSize, entry.replays, []) < IDEMPOTENCY_CAP;
    }

    function bootstrapControl(controlId) {
        if (!enter()) return null;
        try {
            if (controlId !== undefined && controlId !== null && !opaqueToken(controlId)) return null;
            const existing = currentControl(controlId);
            const existingSnapshot = snapshot(existing);
            if (existing && existingSnapshot && !operationPoisoned) {
                return frozenRecord({ controlId: existingSnapshot.controlId, etag: existingSnapshot.fence });
            }
            const nextControlId = successorFence();
            const fence = successorFence();
            if (!nextControlId || !fence || nextControlId === fence || operationPoisoned
                || currentControl(nextControlId)) return null;
            const state = control.createControlRecordState({ controlId: nextControlId, fence });
            const entry = { controlId: nextControlId, state, replays: new Map(), lockFailure: null };
            reflectApply(mapSet, controls, [nextControlId, entry]);
            if (operationPoisoned) {
                reflectApply(mapDelete, controls, [nextControlId]);
                control.terminallyResetControlRecord(state);
                return null;
            }
            return frozenRecord({ controlId: nextControlId, etag: fence });
        } catch { return null; }
        finally { leave(); }
    }

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
        if (!record || (record.state !== 'pending' && record.state !== 'replay')) return;
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
        if (record.replay?.state === 'pending') record.replay.state = 'aborted';
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

    function retireUserCells(userId) {
        const reason = 'delete';
        const roster = [];
        for (const cell of [...reflectApply(mapValues, sessions, [])]) {
            if (cell.state === 'ACTIVE' && cell.session.userId === userId) roster.push(cell);
        }
        let at;
        try { at = now(); } catch { return 'denied'; }
        if (operationPoisoned || !numberIsSafeInteger(at) || at < 0) return 'denied';

        let outcome = 'completed';
        const cleanupRoster = [];
        for (const cell of roster) {
            const binding = bindingForCell(cell);
            if (!binding || binding.cell !== cell || binding.sessionId !== cell.session.id) {
                outcome = 'denied';
                continue;
            }
            let capability = null;
            let committed = 0;
            try {
                capability = retirement.prepareRetirement(retirementState, binding.controlState, cellState,
                    binding.ticket, binding.port, binding.sessionId, reason, at);
                if (capability) {
                    committed = retirement.commitRetirement(retirementState, binding.controlState,
                        cellState, capability);
                }
            } catch { /* inspect and abort this exact capability below */ }
            const observation = cells.inspectCell(cellState, binding.port);
            if (observation?.state === 'RETIRED') cleanupRoster.push(binding);
            if (!capability || committed !== 2 || observation?.state !== 'RETIRED') {
                outcome = 'denied';
                if (capability) {
                    try {
                        retirement.abortRetirement(retirementState, binding.controlState,
                            cellState, capability);
                    } catch { /* terminal denial remains */ }
                }
            }
        }

        // Cleanup is intentionally delayed until every same-user cell has reached
        // its terminal authority state, so disposer re-entry cannot strand siblings.
        for (const binding of cleanupRoster) {
            const cleanup = cleanupRetired(binding, reason);
            if (cleanup.outcome !== 'completed') outcome = 'failed';
        }
        return operationPoisoned ? 'failed' : outcome;
    }

    function begin(kind, transport) {
        if (!enter()) return null;
        try {
            if ((kind !== 'login' && kind !== 'setup')
                || reflectApply(setSize, userRetirements, []) !== 0) return null;
            const request = exactTransport(transport);
            const at = now();
            const entry = request && currentControl(request.controlId);
            const observed = snapshot(entry);
            if (!request || !entry || !observed || !numberIsSafeInteger(at) || at < 0
                || entry.lockFailure !== null || !purgeReplays(entry, at)) return null;
            const prior = replayFor(entry, request.idempotencyKey);
            if (prior) {
                if (prior.kind !== kind || prior.requestFence !== request.ifMatch || prior.state !== 'issued') return null;
                const attempt = opaque();
                const record = { state: 'replay', attempt, replay: prior, controlEntry: entry, loginEpoch };
                reflectApply(weakMapSet, attempts, [attempt, record]);
                reflectApply(setAdd, attemptRecords, [record]);
                return operationPoisoned ? null : attempt;
            }
            if (observed.fence !== request.ifMatch) return null;
            if (!canAddReplay(entry, at)) return null;
            const operation = successorFence();
            const fingerprint = successorFence();
            if (!numberIsSafeInteger(at) || at < 0 || !operation || !fingerprint || operation === fingerprint) return null;
            const opened = control.beginControlOperation(entry.state, kind, operation, fingerprint, at);
            if (!opened?.ok) return null;
            const attempt = opaque();
            const replay = {
                kind, state: 'pending', requestFence: request.ifMatch,
                createdAt: at, issue: null,
            };
            const record = {
                state: 'pending', attempt, controlState: entry.state, controlEntry: entry,
                replay, operation, fingerprint, fence: opened.fence, generation: opened.generation,
                loginEpoch,
            };
            reflectApply(mapSet, entry.replays, [request.idempotencyKey, replay]);
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
            if (!record || (record.state !== 'pending' && record.state !== 'replay')) return null;
            if (record.loginEpoch !== loginEpoch || reflectApply(setSize, userRetirements, []) !== 0) {
                const at = now();
                if (record.state === 'pending' && numberIsSafeInteger(at) && at >= 0) cancelAttempt(record, at);
                else burnAttempt(record);
                if (record.replay?.state === 'pending') record.replay.state = 'aborted';
                return null;
            }
            if (record.controlEntry?.lockFailure !== null) {
                burnAttempt(record);
                if (record.replay?.state === 'pending') record.replay.state = 'aborted';
                return null;
            }
            if (record.state === 'replay') {
                const replayed = record.replay?.state === 'issued' ? record.replay.issue : null;
                burnAttempt(record);
                return operationPoisoned ? null : replayed;
            }
            burnAttempt(record);
            const at = now();
            if (operationPoisoned) return null;
            const sessionId = successorFence();
            const expiresAt = SESSION_TTL_MS === null ? null : at + SESSION_TTL_MS;
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
            const binding = frozenRecord({ cell, controlState: record.controlState, ticket, port, sessionId });
            reflectApply(mapSet, sessions, [sessionId, cell]);
            reflectApply(weakMapSet, cellBindings, [cell, binding]);
            if (!activation.commitActivation(activationState, record.controlState, cellState, preparedActivation)) return null;
            const observed = snapshot(record.controlEntry);
            if (!observed || observed.active !== true || observed.fence === record.fence) return null;
            const result = frozenRecord({ ok: true, sessionId, etag: observed.fence });
            record.replay.state = 'issued';
            record.replay.issue = result;
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
            if (record?.replay?.state === 'pending') record.replay.state = 'aborted';
            return null;
        } finally {
            if (record?.replay?.state === 'pending') record.replay.state = 'aborted';
            leave();
        }
    }

    function abort(attempt) {
        if (!enter()) return false;
        try {
            const record = weakValue(attempts, attempt);
            if (record?.state === 'replay') {
                burnAttempt(record);
                return !operationPoisoned;
            }
            const at = now();
            return !operationPoisoned && numberIsSafeInteger(at) && at >= 0 && cancelAttempt(record, at);
        } catch { return false; }
        finally { leave(); }
    }

    function resolve(sessionId, controlId) {
        if (!enter()) return frozenRecord({ status: 'owned_denied' });
        try {
            const resolution = resolver.resolve(resolverState, sessionId);
            if (resolution.status !== 'active') return resolution;
            const cell = resolver.authenticProjectionCell(resolverState, resolution.projection);
            const binding = cell && bindingForCell(cell);
            const entry = currentControl(controlId);
            if (!cell || !binding || !entry || binding.controlState !== entry.state
                || !control.isCurrentAuthControlSessionBinding(entry.state, binding.ticket, binding.sessionId)
                || operationPoisoned) return frozenRecord({ status: 'owned_denied' });
            return resolution;
        }
        catch { return frozenRecord({ status: 'owned_denied' }); }
        finally { leave(); }
    }

    function burnAttemptsForControl(controlState) {
        const roster = [...reflectApply(setValues, attemptRecords, [])];
        for (const record of roster) {
            if (record.controlState !== controlState || record.state !== 'pending') continue;
            record.replay.state = 'aborted';
            burnAttempt(record);
        }
    }

    function retire(projection, reason, transport) {
        if (!enter()) return frozenRecord({ outcome: 'denied' });
        try {
            if (reason === 'lock') {
                const request = exactTransport(transport);
                const at = now();
                const entry = request && currentControl(request.controlId);
                const before = snapshot(entry);
                if (!request || !entry || !before || !numberIsSafeInteger(at) || at < 0) {
                    return frozenRecord({ outcome: 'denied' });
                }
                const deniedWithCurrentFence = () => frozenRecord({ outcome: 'denied', etag: before.fence });
                if (!purgeReplays(entry, at)) return deniedWithCurrentFence();
                const prior = replayFor(entry, request.idempotencyKey);
                if (prior) {
                    return prior.kind === 'lock' && prior.requestFence === request.ifMatch
                        && prior.state === 'locked' && prior.receipt
                        ? prior.receipt : deniedWithCurrentFence();
                }
                if (before.fence !== request.ifMatch) return deniedWithCurrentFence();
                if (entry.lockFailure !== null) return entry.lockFailure;
                if (!canAddReplay(entry, at)) return deniedWithCurrentFence();
                const replay = { kind: 'lock', state: 'pending', requestFence: request.ifMatch, createdAt: at, receipt: null };
                reflectApply(mapSet, entry.replays, [request.idempotencyKey, replay]);
                if (!before.active) {
                    const advanced = control.advanceLockControlRecord(entry.state, request.ifMatch, at);
                    if (!advanced?.ok || operationPoisoned) {
                        replay.state = 'aborted';
                        return deniedWithCurrentFence();
                    }
                    burnAttemptsForControl(entry.state);
                    const receipt = frozenRecord({ outcome: 'completed', etag: advanced.fence });
                    replay.state = 'locked';
                    replay.receipt = receipt;
                    return receipt;
                }
                const cell = resolver.authenticProjectionCell(resolverState, projection);
                const binding = cell && bindingForCell(cell);
                if (!cell || !binding || binding.controlState !== entry.state || operationPoisoned) {
                    replay.state = 'aborted';
                    return deniedWithCurrentFence();
                }
                const outcome = retireCell(cell, 'lock');
                const after = snapshot(entry);
                if (!after || after.fence === before.fence) {
                    replay.state = 'aborted';
                    return deniedWithCurrentFence();
                }
                const receipt = frozenRecord({ outcome: outcome === 'completed' ? 'completed' : 'failed', etag: after.fence });
                replay.state = 'locked';
                replay.receipt = receipt;
                if (receipt.outcome === 'failed') entry.lockFailure = receipt;
                return receipt;
            }
            if (transport !== undefined) return frozenRecord({ outcome: 'denied' });
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

    function prepareUserRetirement(projection) {
        if (!enter()) return null;
        try {
            const authorityCell = resolver.authenticProjectionCell(resolverState, projection);
            const userId = authorityCell?.session?.userId;
            const nextEpoch = loginEpoch + 1;
            if (!authorityCell || typeof userId !== 'string' || userId.length === 0
                || !numberIsSafeInteger(nextEpoch) || nextEpoch <= loginEpoch || operationPoisoned) return null;
            loginEpoch = nextEpoch;
            const capability = opaque();
            const binding = { state: 'prepared', capability, userId };
            reflectApply(weakMapSet, userRetirementCapabilities, [capability, binding]);
            reflectApply(setAdd, userRetirements, [binding]);
            if (operationPoisoned) {
                binding.state = 'aborted';
                reflectApply(weakMapDelete, userRetirementCapabilities, [capability]);
                reflectApply(setDelete, userRetirements, [binding]);
                return null;
            }
            return capability;
        } catch { return null; }
        finally { leave(); }
    }

    function abortUserRetirement(capability) {
        if (!enter()) return false;
        try {
            const binding = weakValue(userRetirementCapabilities, capability);
            if (!binding || binding.state !== 'prepared' || binding.capability !== capability
                || !reflectApply(setHas, userRetirements, [binding])) return false;
            binding.state = 'aborted';
            reflectApply(weakMapDelete, userRetirementCapabilities, [capability]);
            reflectApply(setDelete, userRetirements, [binding]);
            return !operationPoisoned;
        } catch { return false; }
        finally { leave(); }
    }

    function commitUserRetirement(capability) {
        if (!enter()) return frozenRecord({ outcome: 'denied' });
        let binding = null;
        let commitStarted = false;
        try {
            binding = weakValue(userRetirementCapabilities, capability);
            if (!binding || binding.state !== 'prepared' || binding.capability !== capability
                || !reflectApply(setHas, userRetirements, [binding]) || operationPoisoned) {
                return frozenRecord({ outcome: 'denied' });
            }
            binding.state = 'committing';
            commitStarted = true;
            const outcome = retireUserCells(binding.userId);
            binding.state = 'committed';
            return frozenRecord({ outcome });
        } catch { return frozenRecord({ outcome: commitStarted ? 'failed' : 'denied' }); }
        finally {
            if (binding && binding.state !== 'prepared') {
                try { reflectApply(weakMapDelete, userRetirementCapabilities, [capability]); } catch { /* one-shot */ }
                try { reflectApply(setDelete, userRetirements, [binding]); } catch { /* one-shot */ }
            }
            leave();
        }
    }

    function prepareAdminReset(projection) {
        if (!enter()) return null;
        try {
            const cell = resolver.authenticProjectionCell(resolverState, projection);
            if (!cell || cell.session.role !== 'admin' || operationPoisoned || resetRecord !== null
                || reflectApply(setSize, userRetirements, []) !== 0
                || !cells.canTerminallyResetAllCells(cellState)) return null;
            const attemptRoster = [...reflectApply(setValues, attemptRecords, [])];
            const cellRoster = [...reflectApply(mapValues, sessions, [])];
            const bindingRoster = [];
            const controlStates = new Set();
            for (const entry of [...reflectApply(mapValues, controls, [])]) {
                reflectApply(setAdd, controlStates, [entry.state]);
            }
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
            reflectApply(mapClear, controls, []);
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

    function withCurrentResourceBinding(use, operation) {
        if (!enter()) return false;
        try {
            return resources.withCurrentResourceBinding(resourceState, use, operation)
                && !operationPoisoned;
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
        bootstrapControl, begin, issue, abort, resolve, retire, retireForUser,
        prepareUserRetirement, commitUserRetirement, abortUserRetirement,
        prepareAdminReset, commitAdminReset, abortAdminReset,
        mintResourcePort, releaseResourcePort, beginResourceUse, commitResourceUse, abortResourceUse,
        withCurrentResourceBinding, registerPrivateResource, unregisterPrivateResource,
    });
}

module.exports = objectFreeze({ createOwner });
