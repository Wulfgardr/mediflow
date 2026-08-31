/* @Codex */
'use strict';

/*
 * P3 activation composes the explicit P2 control state and P3 cell state.  A
 * single prepared activation is held by the caller-owned activation state;
 * no module-global capability registry is used.
 */
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
const ACTIVATION_STATE = Symbol('mediflow.session-activation.state');
const opaque = () => objectFreeze(objectCreate(null));
const isText = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256;
const isTime = (value) => typeof value === 'number' && numberIsSafeInteger(value) && value >= 0;
const isObjectLike = (value) => (typeof value === 'object' && value !== null) || typeof value === 'function';

function trustedState(value) {
    if (!value || typeof value !== 'object' || isProxy(value)) return false;
    try {
        return objectGetPrototypeOf(value) === null
            && objectGetOwnPropertyDescriptor(value, ACTIVATION_STATE)?.value === true;
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

/** Allocates the one-owner activation coordination state. */
function createSessionActivationState() {
    const state = objectCreate(null);
    state[ACTIVATION_STATE] = true;
    state.record = null;
    state.operationActive = false;
    return state;
}

/** Prepares both sides of one exact activation before the final CAS. */
function prepareActivation(state, controlState, cellState, ticket, port, sessionId, at) {
    if (!trustedState(state) || state.operationActive || !isText(sessionId)) return null;
    const current = currentTime(at);
    if (current === null || !isObjectLike(ticket) || isProxy(ticket) || !isObjectLike(port) || isProxy(port)
        || state.record !== null) return null;
    state.operationActive = true;
    let cellCapability = null;
    let controlCapability = null;
    try {
        cellCapability = cells.prepareActivationCell(cellState, port, sessionId, current);
        if (!cellCapability) return null;
        controlCapability = control.prepareAuthControlActivation(controlState, ticket, sessionId);
        if (!controlCapability) {
            cells.abortActivationCell(cellState, cellCapability);
            return null;
        }
        const capability = opaque();
        state.record = { lifecycle: 'prepared', capability, cellCapability, controlCapability,
            port, sessionId };
        return capability;
    } catch {
        if (controlCapability) control.abortPreparedAuthControlActivation(controlState, controlCapability);
        if (cellCapability) cells.abortActivationCell(cellState, cellCapability);
        return null;
    } finally {
        state.operationActive = false;
    }
}

/**
 * Performs P2 CAS and then only the lexical ARMED_ACTIVATE -> ACTIVE flip.
 * All fallible work is completed by prepareActivation; these calls allocate no
 * user objects and invoke no callback between CAS and the cell transition.
 */
function commitActivation(state, controlState, cellState, capability) {
    if (!trustedState(state)) return false;
    const record = state.record;
    if (!record) return false;
    state.record = null;
    const exact = capability === record.capability && record.lifecycle === 'prepared';
    if (!exact) {
        record.lifecycle = 'denied';
        control.abortPreparedAuthControlActivation(controlState, record.controlCapability);
        cells.abortActivationCell(cellState, record.cellCapability);
        return false;
    }
    record.lifecycle = 'committing';
    if (!cells.takeActivationCellCommit(cellState, record.cellCapability)) {
        control.abortPreparedAuthControlActivation(controlState, record.controlCapability);
        return false;
    }
    let result = 0;
    try { result = control.commitPreparedAuthControlActivation(controlState, record.controlCapability); }
    catch { /* P2 denial is handled before the commit-last seam. */ }
    if (result !== 1) {
        record.lifecycle = 'denied';
        cells.denyActivationCellCommit(cellState);
        return false;
    }
    cells.commitActivationCell(cellState);
    return true;
}

/** Burns both prepared capabilities and tombstones the still-inert cell. */
function abortActivation(state, controlState, cellState, capability) {
    if (!trustedState(state)) return false;
    const record = state.record;
    if (!record) return false;
    const exact = capability === record.capability && record.lifecycle === 'prepared';
    state.record = null;
    record.lifecycle = 'denied';
    control.abortPreparedAuthControlActivation(controlState, record.controlCapability);
    cells.abortActivationCell(cellState, record.cellCapability);
    return exact;
}

/** Tests the exact active binding without exposing control or cell internals. */
function isCurrentActivation(state, controlState, cellState, ticket, port, sessionId, at) {
    if (!trustedState(state) || !isText(sessionId)) return false;
    const current = currentTime(at);
    if (current === null) return false;
    const cell = cells.getCellForPort(cellState, port);
    return Boolean(cell && cell.state === 'ACTIVE' && cell.sessionId === sessionId
        && cells.getCellBySessionId(cellState, sessionId) === cell
        && control.isCurrentAuthControlSessionBinding(controlState, ticket, sessionId)
        && cell.session.expiresAt > current);
}

module.exports = objectFreeze({
    createSessionActivationState,
    prepareActivation,
    commitActivation,
    abortActivation,
    isCurrentActivation,
});
