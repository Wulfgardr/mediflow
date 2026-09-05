/* @Codex */
'use strict';

/* P3 retirement composes the explicit P2 control and P3 cell states. */
const { types: { isProxy } } = require('node:util');
const control = require('./control-record.cjs');
const cells = require('./session-cell.cjs');

const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectApply = Reflect.apply;
const dateNow = Date.now;
const numberIsSafeInteger = Number.isSafeInteger;
const RETIREMENT_STATE = Symbol('mediflow.session-retirement.state');
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
            && objectGetOwnPropertyDescriptor(value, RETIREMENT_STATE)?.value === true;
    } catch {
        return false;
    }
}

function currentTime(value) {
    if (value !== undefined) return isTime(value) ? value : null;
    try {
        const result = reflectApply(dateNow, Date, []);
        return isTime(result) ? result : null;
    } catch {
        return null;
    }
}

/** Allocates the one-owner retirement coordination state. */
function createSessionRetirementState() {
    const state = objectCreate(null);
    state[RETIREMENT_STATE] = true;
    state.record = null;
    state.operationActive = false;
    return state;
}

/** Prepares the exact cell transition and its matching P2 retirement CAS. */
function prepareRetirement(state, controlState, cellState, ticket, port, sessionId, reason, at) {
    if (!trustedState(state) || state.operationActive || !isText(sessionId) || !isReason(reason)
        || !isObjectLike(ticket) || isProxy(ticket) || !isObjectLike(port) || isProxy(port)) return null;
    const current = currentTime(at);
    if (current === null || state.record !== null) return null;
    state.operationActive = true;
    let cellCapability = null;
    let controlCapability = null;
    try {
        cellCapability = cells.prepareRetirementCell(cellState, port, sessionId, reason, current);
        if (!cellCapability) return null;
        controlCapability = control.prepareAuthControlRetirement(controlState, ticket, sessionId, reason);
        if (!controlCapability) {
            cells.abortRetirementCell(cellState, cellCapability);
            return null;
        }
        const capability = opaque();
        state.record = { lifecycle: 'prepared', capability, cellCapability, controlCapability,
            port, sessionId, reason };
        return capability;
    } catch {
        if (controlCapability) control.abortPreparedAuthControlRetirement(controlState, controlCapability);
        if (cellCapability) cells.abortRetirementCell(cellState, cellCapability);
        return null;
    } finally {
        state.operationActive = false;
    }
}

/** Performs P2 retirement CAS followed by the sole ARMED_RETIRE -> RETIRED flip. */
function commitRetirement(state, controlState, cellState, capability) {
    if (!trustedState(state)) return 0;
    const record = state.record;
    if (!record) return 0;
    state.record = null;
    const exact = capability === record.capability && record.lifecycle === 'prepared';
    if (!exact) {
        record.lifecycle = 'denied';
        control.abortPreparedAuthControlRetirement(controlState, record.controlCapability);
        cells.abortRetirementCell(cellState, record.cellCapability);
        return 0;
    }
    record.lifecycle = 'committing';
    if (!cells.takeRetirementCellCommit(cellState, record.cellCapability)) {
        control.abortPreparedAuthControlRetirement(controlState, record.controlCapability);
        return 0;
    }
    let result = 0;
    try { result = control.commitPreparedAuthControlRetirement(controlState, record.controlCapability); }
    catch { /* P2 denial is handled before the commit-last seam. */ }
    if (result !== 2) {
        record.lifecycle = 'denied';
        cells.denyRetirementCellCommit(cellState);
        return 0;
    }
    cells.commitRetirementCell(cellState);
    return 2;
}

/** Burns both capabilities and leaves the cell retired/tombstoned. */
function abortRetirement(state, controlState, cellState, capability) {
    if (!trustedState(state)) return false;
    const record = state.record;
    if (!record) return false;
    const exact = capability === record.capability && record.lifecycle === 'prepared';
    state.record = null;
    record.lifecycle = 'denied';
    control.abortPreparedAuthControlRetirement(controlState, record.controlCapability);
    cells.abortRetirementCell(cellState, record.cellCapability);
    return exact;
}

/** Returns whether a caller still owns the prepared retirement seam. */
function isPreparedRetirement(state, capability) {
    if (!trustedState(state)) return false;
    const record = state.record;
    return Boolean(record && record.lifecycle === 'prepared' && record.capability === capability);
}

module.exports = objectFreeze({
    createSessionRetirementState,
    prepareRetirement,
    commitRetirement,
    abortRetirement,
    isPreparedRetirement,
});
