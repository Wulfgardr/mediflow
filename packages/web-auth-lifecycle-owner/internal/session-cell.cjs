/* @Codex */
'use strict';

/*
 * P3 cells are owned by the explicit state below.  Nothing in this file is a
 * process-global session registry; the owner factory allocates one state and
 * supplies it to every operation.  The only values returned to callers are
 * opaque frozen ports/capabilities or fresh read-only data projections.
 */
const { types: { isProxy } } = require('node:util');

const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetOwnPropertyNames = Object.getOwnPropertyNames;
const objectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const objectPrototype = Object.prototype;
const hasOwn = Object.prototype.hasOwnProperty;
const reflectApply = Reflect.apply;
const dateNow = Date.now;
const numberIsSafeInteger = Number.isSafeInteger;
const CELL_STATE = Symbol('mediflow.session-cell.state');
const opaque = () => objectFreeze(objectCreate(null));
const isText = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256;
const isTime = (value) => typeof value === 'number' && numberIsSafeInteger(value) && value >= 0;
const isObjectLike = (value) => (typeof value === 'object' && value !== null) || typeof value === 'function';
const isReason = (value) => value === 'lock' || value === 'dispose' || value === 'expired'
    || value === 'delete' || value === 'clear';

function trustedState(value) {
    if (!value || typeof value !== 'object' || isProxy(value)) return false;
    try {
        return objectGetPrototypeOf(value) === null
            && objectGetOwnPropertyDescriptor(value, CELL_STATE)?.value === true;
    } catch {
        return false;
    }
}

function now(value) {
    if (value !== undefined) return isTime(value) ? value : null;
    try {
        const result = reflectApply(dateNow, Date, []);
        return isTime(result) ? result : null;
    } catch {
        return null;
    }
}

function objectIsExactData(value, names) {
    if (!value || typeof value !== 'object' || isProxy(value)) return false;
    try {
        return objectGetPrototypeOf(value) === objectPrototype
            && objectGetOwnPropertySymbols(value).length === 0
            && objectGetOwnPropertyNames(value).length === names.length
            && names.every((name) => {
                const descriptor = objectGetOwnPropertyDescriptor(value, name);
                return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable);
            });
    } catch {
        return false;
    }
}

function exactUser(value) {
    if (!objectIsExactData(value, ['id', 'username', 'role'])) return null;
    try {
        const id = objectGetOwnPropertyDescriptor(value, 'id').value;
        const username = objectGetOwnPropertyDescriptor(value, 'username').value;
        const role = objectGetOwnPropertyDescriptor(value, 'role').value;
        if (!isText(id) || !isText(username) || !isText(role)) return null;
        return objectFreeze({ id, username, role });
    } catch {
        return null;
    }
}

function exactSessionId(value) {
    return isText(value) ? value : null;
}

function enter(state) {
    if (state.lifecycle !== 'idle') {
        state.lifecyclePoisoned = true;
        return false;
    }
    state.lifecycle = 'active';
    state.lifecyclePoisoned = false;
    return true;
}

function leave(state) {
    state.lifecycle = 'idle';
    state.lifecyclePoisoned = false;
}

function byId(state, id) {
    if (!isText(id)) return null;
    try { return hasOwn.call(state.cellsById, id) ? state.cellsById[id] : null; } catch { return null; }
}

function cellForPort(state, port) {
    if (!trustedState(state) || !isObjectLike(port) || isProxy(port)) return null;
    try { return state.ports.get(port) || null; } catch { return null; }
}

function preparedFor(state, capability) {
    if (!trustedState(state) || !isObjectLike(capability) || isProxy(capability)) return null;
    try { return state.prepared.get(capability) || null; } catch { return null; }
}

function stageFor(state, capsule) {
    if (!trustedState(state) || !isObjectLike(capsule) || isProxy(capsule)) return null;
    try { return state.staged.get(capsule) || null; } catch { return null; }
}

function reservationFor(state, capability) {
    if (!trustedState(state) || !isObjectLike(capability) || isProxy(capability)) return null;
    try { return state.reservations.get(capability) || null; } catch { return null; }
}

function revokePreparedRecord(state, record) {
    if (!record || !record.active) return false;
    record.active = false;
    try {
        if (hasOwn.call(state.preparedById, record.session.id)
            && state.preparedById[record.session.id] === record) delete state.preparedById[record.session.id];
    } catch {
        return false;
    }
    return true;
}

function revokeResourcesWithoutCleanup(cell) {
    cell.resourcePortsRevoked = true;
    for (let resource = cell.resourcePortHead; resource; resource = resource.next) {
        resource.active = false;
        resource.revoked = true;
        for (let use = resource.useHead; use; use = use.next) use.active = false;
    }
}

function tombstoneCell(state, cell, terminalState) {
    if (!cell) return false;
    if (cell.state === 'ACTIVE' || cell.state === 'ARMED_RETIRE' || cell.state === 'ARMED_ACTIVATE') {
        revokeResourcesWithoutCleanup(cell);
        cell.activationCapability = null;
        cell.retirementCapability = null;
        cell.tombstone = true;
        cell.state = terminalState || 'TOMBSTONE';
        if (state.activationRecord?.cell === cell) state.activationRecord = null;
        if (state.retirementRecord?.cell === cell) state.retirementRecord = null;
        if (state.activationCommitReady?.cell === cell) state.activationCommitReady = null;
        if (state.retirementCommitReady?.cell === cell) state.retirementCommitReady = null;
        return true;
    }
    return false;
}

/** Creates the P3 cell state used by one owner factory. */
function createSessionCellState() {
    const state = objectCreate(null);
    state[CELL_STATE] = true;
    state.staged = new WeakMap();
    state.prepared = new WeakMap();
    state.reservations = new WeakMap();
    state.ports = new WeakMap();
    state.stagedHead = null;
    state.preparedHead = null;
    state.cellHead = null;
    state.preparedById = objectCreate(null);
    state.cellsById = objectCreate(null);
    state.lifecycle = 'idle';
    state.lifecyclePoisoned = false;
    state.activationRecord = null;
    state.retirementRecord = null;
    state.activationCommitReady = null;
    state.retirementCommitReady = null;
    return state;
}

/** Stages exact Web user data without creating session authority. */
function stageWebSession(state, user, createdAt, expiresAt) {
    if (!trustedState(state) || !enter(state)) return null;
    let capsule = null;
    let record = null;
    try {
        const exact = exactUser(user);
        const created = now(createdAt);
        const expiry = expiresAt === undefined ? null : expiresAt;
        if (!exact || created === null || !isTime(expiry) || expiry <= created) return null;
        capsule = opaque();
        record = { active: true, userId: exact.id, username: exact.username, role: exact.role,
            createdAt: created, expiresAt: expiry, next: state.stagedHead };
        state.staged.set(capsule, record);
        state.stagedHead = record;
        return capsule;
    } catch {
        if (record) record.active = false;
        return null;
    } finally {
        leave(state);
    }
}

/** Consumes one staged capsule into a private, non-resolvable reservation. */
function prepareStagedWebSession(state, capsule, sessionId, at) {
    if (!trustedState(state) || !enter(state)) return null;
    let record = null;
    let prepared = null;
    try {
        record = stageFor(state, capsule);
        const current = now(at);
        const id = exactSessionId(sessionId);
        if (!record || !record.active || current === null || !id || record.expiresAt <= current
            || hasOwn.call(state.preparedById, id) || byId(state, id)) return null;
        prepared = opaque();
        const session = objectFreeze({ id, userId: record.userId, username: record.username, role: record.role,
            authChannel: 'web', createdAt: record.createdAt, expiresAt: record.expiresAt });
        const preparedRecord = { active: true, session, next: state.preparedHead };
        state.prepared.set(prepared, preparedRecord);
        state.reservations.set(prepared, preparedRecord);
        state.preparedById[id] = preparedRecord;
        state.preparedHead = preparedRecord;
        record.active = false;
        return prepared;
    } catch {
        if (prepared) {
            const failed = preparedFor(state, prepared);
            if (failed) revokePreparedRecord(state, failed);
        }
        if (record) record.active = false;
        return null;
    } finally {
        leave(state);
    }
}

/** Installs one reservation in its final cell position, still inert. */
function armPreparedWebSession(state, capability) {
    if (!trustedState(state) || !enter(state)) return null;
    let prepared = null;
    let cell = null;
    let port = null;
    try {
        prepared = preparedFor(state, capability);
        if (!prepared || !prepared.active || reservationFor(state, capability) !== prepared) return null;
        const session = prepared.session;
        if (!session || session.authChannel !== 'web' || !isText(session.id)
            || hasOwn.call(state.cellsById, session.id)) return null;
        port = opaque();
        cell = {
            state: 'ARMED_ACTIVATE',
            tombstone: false,
            sessionId: session.id,
            session,
            port,
            next: state.cellHead,
            activationCapability: null,
            retirementCapability: null,
            retirementReason: null,
            resourcePortsRevoked: false,
            resourcePortHead: null,
        };
        state.cellHead = cell;
        state.cellsById[session.id] = cell;
        state.ports.set(port, cell);
        prepared.active = false;
        delete state.preparedById[session.id];
        return port;
    } catch {
        if (cell) tombstoneCell(state, cell);
        if (prepared) revokePreparedRecord(state, prepared);
        return null;
    } finally {
        leave(state);
    }
}

/** Returns only the exact locator of an authentic ARMED_ACTIVATE cell. */
function getArmedWebServerSessionId(state, port, at) {
    if (!trustedState(state) || !enter(state)) return null;
    try {
        const cell = cellForPort(state, port);
        const current = now(at);
        if (state.lifecyclePoisoned || !cell || cell.state !== 'ARMED_ACTIVATE' || current === null
            || byId(state, cell.sessionId) !== cell || !cell.session || cell.session.id !== cell.sessionId
            || cell.session.expiresAt <= current) {
            if (cell && cell.state === 'ARMED_ACTIVATE') tombstoneCell(state, cell);
            return null;
        }
        return cell.sessionId;
    } catch {
        return null;
    } finally {
        leave(state);
    }
}

/** Prepares the cell-side activation capability before the P2 CAS. */
function prepareActivationCell(state, port, exactSessionId, at) {
    if (!trustedState(state) || !enter(state)) return null;
    try {
        const cell = cellForPort(state, port);
        const current = now(at);
        if (!cell || cell.state !== 'ARMED_ACTIVATE' || state.activationRecord !== null
            || state.activationCommitReady !== null || current === null
            || !isText(exactSessionId) || cell.sessionId !== exactSessionId || byId(state, exactSessionId) !== cell
            || !cell.session || cell.session.expiresAt <= current) {
            if (cell && cell.state === 'ARMED_ACTIVATE') tombstoneCell(state, cell);
            return null;
        }
        const capability = opaque();
        const activation = { lifecycle: 'prepared', capability, cell, sessionId: exactSessionId };
        state.activationRecord = activation;
        cell.activationCapability = capability;
        return capability;
    } catch {
        return null;
    } finally {
        leave(state);
    }
}

/** Prevalidates and takes the total activation flip before the P2 CAS. */
function takeActivationCellCommit(state, capability) {
    if (!trustedState(state) || !enter(state)) return false;
    try {
        const activation = state.activationRecord;
        const cell = activation?.cell;
        if (!activation || state.activationCommitReady !== null
            || capability !== activation.capability || activation.lifecycle !== 'prepared'
            || cell.activationCapability !== capability || cell.state !== 'ARMED_ACTIVATE'
            || byId(state, activation.sessionId) !== cell || cell.session.id !== activation.sessionId) {
            if (activation) {
                state.activationRecord = null;
                activation.lifecycle = 'denied';
                tombstoneCell(state, cell);
            }
            return false;
        }
        state.activationRecord = null;
        activation.lifecycle = 'commit_ready';
        state.activationCommitReady = activation;
        return true;
    } catch {
        const activation = state.activationRecord;
        state.activationRecord = null;
        if (activation) {
            activation.lifecycle = 'denied';
            tombstoneCell(state, activation.cell);
        }
        return false;
    } finally {
        leave(state);
    }
}

/** Performs only the prevalidated ARMED_ACTIVATE -> ACTIVE flip after P2 CAS. */
function commitActivationCell(state) {
    const activation = state.activationCommitReady;
    state.activationCommitReady = null;
    activation.lifecycle = 'committed';
    activation.cell.activationCapability = null;
    activation.cell.state = 'ACTIVE';
}

/** Tombstones a taken activation when P2 denies before authority is granted. */
function denyActivationCellCommit(state) {
    if (!trustedState(state)) return false;
    const activation = state.activationCommitReady;
    if (!activation) return false;
    state.activationCommitReady = null;
    activation.lifecycle = 'denied';
    tombstoneCell(state, activation.cell);
    return true;
}

/** Burns an activation capability and leaves a terminal tombstone. */
function abortActivationCell(state, capability) {
    if (!trustedState(state)) return false;
    const activation = state.activationRecord;
    if (!activation) return false;
    const exact = capability === activation.capability && activation.lifecycle === 'prepared';
    state.activationRecord = null;
    activation.lifecycle = 'denied';
    tombstoneCell(state, activation.cell);
    return exact;
}

/** Prepares the cell-side retirement transition; no cleanup callback runs here. */
function prepareRetirementCell(state, port, exactSessionId, reason, at) {
    if (!trustedState(state) || !enter(state)) return null;
    try {
        const cell = cellForPort(state, port);
        const current = now(at);
        if (!cell || cell.state !== 'ACTIVE' || state.retirementRecord !== null
            || state.retirementCommitReady !== null || current === null
            || !isText(exactSessionId) || cell.sessionId !== exactSessionId || !isReason(reason)
            || byId(state, exactSessionId) !== cell || !cell.session || cell.session.id !== exactSessionId) return null;
        const capability = opaque();
        const retirement = { lifecycle: 'prepared', capability, cell, sessionId: exactSessionId, reason };
        state.retirementRecord = retirement;
        cell.retirementCapability = capability;
        cell.retirementReason = reason;
        cell.state = 'ARMED_RETIRE';
        return capability;
    } catch {
        return null;
    } finally {
        leave(state);
    }
}

/** Prevalidates and takes the total retirement flip before the P2 CAS. */
function takeRetirementCellCommit(state, capability) {
    if (!trustedState(state) || !enter(state)) return false;
    try {
        const retirement = state.retirementRecord;
        const cell = retirement?.cell;
        if (!retirement || state.retirementCommitReady !== null
            || capability !== retirement.capability || retirement.lifecycle !== 'prepared'
            || cell.retirementCapability !== capability || cell.state !== 'ARMED_RETIRE'
            || byId(state, retirement.sessionId) !== cell || cell.session.id !== retirement.sessionId) {
            if (retirement) {
                state.retirementRecord = null;
                retirement.lifecycle = 'denied';
                cell.state = 'RETIRED';
                cell.tombstone = true;
                revokeResourcesWithoutCleanup(cell);
            }
            return false;
        }
        state.retirementRecord = null;
        retirement.lifecycle = 'commit_ready';
        state.retirementCommitReady = retirement;
        return true;
    } catch {
        const retirement = state.retirementRecord;
        state.retirementRecord = null;
        if (retirement) {
            retirement.lifecycle = 'denied';
            retirement.cell.state = 'RETIRED';
            retirement.cell.tombstone = true;
            revokeResourcesWithoutCleanup(retirement.cell);
        }
        return false;
    } finally {
        leave(state);
    }
}

/** Performs only the prevalidated ARMED_RETIRE -> RETIRED flip after P2 CAS. */
function commitRetirementCell(state) {
    const retirement = state.retirementCommitReady;
    state.retirementCommitReady = null;
    retirement.lifecycle = 'committed';
    retirement.cell.retirementCapability = null;
    retirement.cell.state = 'RETIRED';
}

/** Retires a taken cell terminally when P2 denies. */
function denyRetirementCellCommit(state) {
    if (!trustedState(state)) return false;
    const retirement = state.retirementCommitReady;
    if (!retirement) return false;
    state.retirementCommitReady = null;
    retirement.lifecycle = 'denied';
    retirement.cell.retirementCapability = null;
    retirement.cell.state = 'RETIRED';
    retirement.cell.tombstone = true;
    revokeResourcesWithoutCleanup(retirement.cell);
    return true;
}

/** Burns a retirement capability into a terminal retired tombstone. */
function abortRetirementCell(state, capability) {
    if (!trustedState(state)) return false;
    const retirement = state.retirementRecord;
    if (!retirement) return false;
    const exact = capability === retirement.capability && retirement.lifecycle === 'prepared';
    state.retirementRecord = null;
    retirement.lifecycle = 'denied';
    const cell = retirement.cell;
    cell.retirementCapability = null;
    if (cell.state === 'ARMED_RETIRE' || cell.state === 'ACTIVE') {
        cell.state = 'RETIRED';
        cell.tombstone = true;
        revokeResourcesWithoutCleanup(cell);
    }
    return exact;
}

/** Converts one still-inert cell into a terminal tombstone. */
function tombstoneArmedWebSession(state, port) {
    if (!trustedState(state) || !enter(state)) return false;
    try {
        const cell = cellForPort(state, port);
        return Boolean(cell && cell.state === 'ARMED_ACTIVATE' && tombstoneCell(state, cell));
    } catch {
        return false;
    } finally {
        leave(state);
    }
}

/** Internal exact lookup for activation, resolver and resource modules. */
function getCellForPort(state, port) {
    return cellForPort(state, port);
}

/** Internal exact locator lookup retaining tombstones for owned_denied. */
function getCellBySessionId(state, sessionId) {
    return trustedState(state) ? byId(state, sessionId) : null;
}

/** Returns a fresh, inert data projection for an ACTIVE cell only. */
function readActiveSession(state, port, at) {
    if (!trustedState(state)) return null;
    const cell = cellForPort(state, port);
    const current = now(at);
    if (!cell || cell.state !== 'ACTIVE' || current === null || byId(state, cell.sessionId) !== cell
        || !cell.session || cell.session.expiresAt <= current) return null;
    const session = cell.session;
    return objectFreeze({ id: session.id, userId: session.userId, username: session.username,
        role: session.role, authChannel: session.authChannel, createdAt: session.createdAt, expiresAt: session.expiresAt });
}

/** Returns an immutable lifecycle observation for tests and resolver code. */
function inspectCell(state, port) {
    const cell = cellForPort(state, port);
    if (!cell) return null;
    return objectFreeze({ state: cell.state, tombstone: cell.tombstone, sessionId: cell.sessionId,
        resourcePortsRevoked: cell.resourcePortsRevoked });
}

/** Burns every non-active preparation and retires every active cell. */
function tombstoneAllCells(state) {
    if (!trustedState(state) || !enter(state)) return false;
    try {
        for (let staged = state.stagedHead; staged; staged = staged.next) staged.active = false;
        for (let prepared = state.preparedHead; prepared; prepared = prepared.next) revokePreparedRecord(state, prepared);
        for (let cell = state.cellHead; cell; cell = cell.next) {
            if (cell.state === 'ARMED_ACTIVATE' || cell.state === 'ACTIVE' || cell.state === 'ARMED_RETIRE') {
                cell.state = cell.state === 'ARMED_ACTIVATE' ? 'TOMBSTONE' : 'RETIRED';
                cell.tombstone = true;
                revokeResourcesWithoutCleanup(cell);
                cell.activationCapability = null;
                cell.retirementCapability = null;
            }
        }
        state.activationRecord = null;
        state.retirementRecord = null;
        state.activationCommitReady = null;
        state.retirementCommitReady = null;
        return true;
    } catch {
        return false;
    } finally {
        leave(state);
    }
}

/** Validates the cell store while reset preparation still may deny safely. */
function canTerminallyResetAllCells(state) {
    return trustedState(state) && state.lifecycle === 'idle';
}

/**
 * Revokes every prevalidated cell and preparation with no clock or callout.
 * This is the reset commit seam; resource disposal happens only afterwards.
 */
function terminallyResetAllCells(state) {
    for (let staged = state.stagedHead; staged; staged = staged.next) staged.active = false;
    for (let prepared = state.preparedHead; prepared; prepared = prepared.next) {
        prepared.active = false;
        delete state.preparedById[prepared.session.id];
    }
    for (let cell = state.cellHead; cell; cell = cell.next) {
        if (cell.state === 'ARMED_ACTIVATE' || cell.state === 'ACTIVE' || cell.state === 'ARMED_RETIRE') {
            revokeResourcesWithoutCleanup(cell);
            cell.activationCapability = null;
            cell.retirementCapability = null;
            cell.tombstone = true;
            cell.state = cell.state === 'ARMED_ACTIVATE' ? 'TOMBSTONE' : 'RETIRED';
        }
    }
    state.activationRecord = null;
    state.retirementRecord = null;
    state.activationCommitReady = null;
    state.retirementCommitReady = null;
}

module.exports = objectFreeze({
    createSessionCellState,
    stageWebSession,
    prepareStagedWebSession,
    armPreparedWebSession,
    getArmedWebServerSessionId,
    prepareActivationCell,
    takeActivationCellCommit,
    commitActivationCell,
    denyActivationCellCommit,
    abortActivationCell,
    prepareRetirementCell,
    takeRetirementCellCommit,
    commitRetirementCell,
    denyRetirementCellCommit,
    abortRetirementCell,
    tombstoneArmedWebSession,
    getCellForPort,
    getCellBySessionId,
    readActiveSession,
    inspectCell,
    tombstoneAllCells,
    canTerminallyResetAllCells,
    terminallyResetAllCells,
});
