/* @Codex */
'use strict';

/*
 * P2 lives behind an explicit state object.  This module deliberately has no
 * process-global registry: the owner factory creates one state object for the
 * single Node realm and passes it to every operation below.
 */
const { types: { isProxy } } = require('node:util');
const { successorFence } = require('./support/successor-fence.cjs');

const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectPrototype = Object.prototype;
const hasOwn = Object.prototype.hasOwnProperty;
const reflectApply = Reflect.apply;
const dateNow = Date.now;
const numberIsSafeInteger = Number.isSafeInteger;
const bigint = BigInt;
const ZERO = bigint(0);
const ONE = bigint(1);
const MAX_U64 = bigint('18446744073709551615');
const MAX_TICKET_START = MAX_U64 - ONE;
const CONTROL_STATE = Symbol('mediflow.control-record.state');
const denied = objectFreeze({ ok: false });

const isText = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256;
const isTime = (value) => typeof value === 'number' && numberIsSafeInteger(value) && value >= 0;
const isGeneration = (value) => typeof value === 'bigint' && value >= ZERO && value <= MAX_U64;
const isRetirementReason = (value) => value === 'lock' || value === 'dispose' || value === 'expired'
    || value === 'delete' || value === 'clear';
const isObjectLike = (value) => (typeof value === 'object' && value !== null) || typeof value === 'function';
const opaque = () => objectFreeze(objectCreate(null));
const has = (table, value) => hasOwn.call(table, value);
const reserve = (table, value) => { table[value] = true; };
const release = (table, value) => { delete table[value]; };

function trustedState(value) {
    if (!value || typeof value !== 'object' || isProxy(value)) return false;
    try {
        return objectGetPrototypeOf(value) === null
            && objectGetOwnPropertyDescriptor(value, CONTROL_STATE)?.value === true;
    } catch {
        return false;
    }
}

function readConfig(value) {
    if (value === undefined) return objectCreate(null);
    if (!value || typeof value !== 'object' || isProxy(value)
        || objectGetPrototypeOf(value) !== objectPrototype) return null;
    try {
        const result = objectCreate(null);
        for (const key of ['controlId', 'fence', 'generation']) {
            const descriptor = objectGetOwnPropertyDescriptor(value, key);
            if (descriptor && 'value' in descriptor) result[key] = descriptor.value;
        }
        return result;
    } catch {
        return null;
    }
}

function currentTime(value) {
    if (value === undefined) {
        try {
            const now = reflectApply(dateNow, Date, []);
            return isTime(now) ? now : null;
        } catch {
            return null;
        }
    }
    return isTime(value) ? value : null;
}

function tick(state, at) {
    if (!isTime(at)) return null;
    if (at > state.clock) state.clock = at;
    const pending = state.record.pending;
    if (pending && state.clock - pending.createdAt >= state.pendingTtlMs) {
        state.record.pending = null;
        if (state.ticketedPending === pending) state.ticketedPending = null;
    }
    return state.clock;
}

function pendingMatches(state, fence, operation, generation, fingerprint) {
    const record = state.record;
    const pending = record.pending;
    return pending !== null && record.activeSessionId === null && state.ticketedPending === null
        && record.fence === fence && record.generation === generation
        && pending.operation === operation && pending.fingerprint === fingerprint
        && pending.generation === generation;
}

function clearTicketReservations(state, binding) {
    release(state.reserved, binding.activateFence);
    release(state.reserved, binding.retireFence);
    if (state.ticketedPending === binding.pending) state.ticketedPending = null;
}

function denyTicket(state, binding, clearPending) {
    if (!binding || binding.lifecycle === 'denied' || binding.lifecycle === 'retired') return;
    binding.lifecycle = 'denied';
    clearTicketReservations(state, binding);
    if (clearPending && state.record.pending === binding.pending) state.record.pending = null;
}

function entryFor(state, value) {
    if (!trustedState(state) || !isObjectLike(value) || isProxy(value)) return null;
    try { return state.tickets.get(value) || null; } catch { return null; }
}

function sameCurrentActivation(state, binding) {
    const record = state.record;
    return record.pending === binding.pending && record.activeSessionId === null
        && record.fence === binding.fence && record.generation === binding.generation
        && has(state.reserved, binding.activateFence) && has(state.reserved, binding.retireFence)
        && !has(state.used, binding.activateFence) && !has(state.used, binding.retireFence);
}

function sameCurrentRetirement(state, binding) {
    const record = state.record;
    return record.pending === null && record.activeSessionId === binding.sessionId
        && record.fence === binding.activateFence
        && record.generation === binding.generation + ONE
        && has(state.reserved, binding.retireFence) && !has(state.used, binding.retireFence);
}

/** Creates the process-local P2 state consumed by the owner factory. */
function createControlRecordState(initial) {
    const config = readConfig(initial);
    if (config === null) throw new TypeError('invalid control state');
    const controlId = config.controlId === undefined ? 'mediflow-web-auth-control' : config.controlId;
    const fence = config.fence === undefined ? successorFence() : config.fence;
    const generation = config.generation === undefined ? ZERO : config.generation;
    if (!isText(controlId) || !isText(fence) || !isGeneration(generation)) {
        throw new TypeError('invalid control state');
    }
    const state = objectCreate(null);
    state[CONTROL_STATE] = true;
    state.record = {
        controlId,
        fence,
        generation,
        pending: null,
        activeSessionId: null,
    };
    state.clock = 0;
    state.pendingTtlMs = 120_000;
    state.tickets = new WeakMap();
    state.reserved = objectCreate(null);
    state.used = objectCreate(null);
    state.ticketedPending = null;
    state.activationRecord = null;
    state.retirementRecord = null;
    state.operationActive = false;
    state.operationPoisoned = false;
    reserve(state.used, fence);
    return state;
}

/** Starts one owner-generated login/setup pending record. */
function beginControlOperation(state, kind, operation, fingerprint, at) {
    if (!trustedState(state) || state.operationActive) return denied;
    state.operationActive = true;
    state.operationPoisoned = false;
    try {
        const now = tick(state, currentTime(at));
        if ((kind !== 'login' && kind !== 'setup') || !isText(operation)
            || !isText(fingerprint) || now === null || state.record.pending || state.record.activeSessionId !== null) {
            return denied;
        }
        const pending = objectFreeze({ operation, fingerprint, generation: state.record.generation, createdAt: now });
        state.record.pending = pending;
        return objectFreeze({ ok: true, fence: state.record.fence, generation: state.record.generation });
    } catch {
        return denied;
    } finally {
        state.operationActive = false;
        state.operationPoisoned = false;
    }
}

/** Cancels one exact pending operation when no P2 ticket was published. */
function cancelPendingAuth(state, expectedFence, operation, expectedGeneration, fingerprint, at) {
    if (!trustedState(state) || state.operationActive) return 0;
    state.operationActive = true;
    state.operationPoisoned = false;
    try {
        const now = tick(state, currentTime(at));
        const pending = state.record.pending;
        if (now === null || !pending || state.ticketedPending === pending || state.record.activeSessionId !== null
            || state.record.fence !== expectedFence || state.record.generation !== expectedGeneration
            || pending.operation !== operation || pending.fingerprint !== fingerprint
            || pending.generation !== expectedGeneration) return 0;
        if (now - pending.createdAt >= state.pendingTtlMs) {
            state.record.pending = null;
            return 0;
        }
        state.record.pending = null;
        return 1;
    } catch {
        return 0;
    } finally {
        state.operationActive = false;
        state.operationPoisoned = false;
    }
}

/** Prepares one exact, opaque P2 ticket. */
function prepareAuthControlTicket(state, expectedFence, operation, expectedGeneration, fingerprint, sessionId, at) {
    if (!trustedState(state) || state.operationActive) return null;
    state.operationActive = true;
    state.operationPoisoned = false;
    let binding = null;
    let ticket = null;
    try {
        const now = tick(state, currentTime(at));
        if (now === null || !isText(expectedFence) || !isText(operation) || !isGeneration(expectedGeneration)
            || !isText(fingerprint) || !isText(sessionId) || !pendingMatches(state, expectedFence, operation, expectedGeneration, fingerprint)
            || expectedGeneration >= MAX_TICKET_START) return null;
        const activateFence = successorFence();
        const retireFence = successorFence();
        if (!isText(activateFence) || !isText(retireFence) || activateFence === retireFence
            || has(state.used, activateFence) || has(state.used, retireFence)
            || has(state.reserved, activateFence) || has(state.reserved, retireFence)) return null;
        ticket = opaque();
        binding = {
            lifecycle: 'prepared',
            state,
            pending: state.record.pending,
            controlId: state.record.controlId,
            fence: expectedFence,
            generation: expectedGeneration,
            operation,
            fingerprint,
            sessionId,
            activateFence,
            retireFence,
            retiredReason: null,
        };
        reserve(state.reserved, activateFence);
        reserve(state.reserved, retireFence);
        state.tickets.set(ticket, binding);
        state.ticketedPending = binding.pending;
        return ticket;
    } catch {
        if (binding) {
            binding.lifecycle = 'denied';
            clearTicketReservations(state, binding);
        }
        return null;
    } finally {
        state.operationActive = false;
        state.operationPoisoned = false;
    }
}

/** Burns one exact P2 ticket and clears its pending operation. */
function abortPreparedAuthControlTicket(state, ticket) {
    if (!trustedState(state)) return false;
    const binding = entryFor(state, ticket);
    if (!binding || binding.lifecycle !== 'prepared') return false;
    denyTicket(state, binding, true);
    return true;
}

/** Prepares the exact activation capability consumed by the final CAS. */
function prepareAuthControlActivation(state, ticket, exactSessionId) {
    if (!trustedState(state) || state.operationActive) return null;
    const binding = entryFor(state, ticket);
    if (!binding || binding.lifecycle !== 'prepared' || !isText(exactSessionId)
        || binding.sessionId !== exactSessionId || !sameCurrentActivation(state, binding)
        || state.activationRecord !== null) {
        if (binding?.lifecycle === 'prepared') denyTicket(state, binding, true);
        return null;
    }
    const capability = opaque();
    const activation = { lifecycle: 'prepared', capability, binding };
    state.activationRecord = activation;
    binding.lifecycle = 'activation_prepared';
    return capability;
}

/** Performs only the prepared activation CAS; caller work cannot enter this seam. */
function commitPreparedAuthControlActivation(state, prepared) {
    if (!trustedState(state)) return 0;
    const activation = state.activationRecord;
    if (activation === null) return 0;
    state.activationRecord = null;
    const binding = activation.binding;
    if (prepared !== activation.capability || activation.lifecycle !== 'prepared'
        || binding.lifecycle !== 'activation_prepared' || !sameCurrentActivation(state, binding)) {
        activation.lifecycle = 'denied';
        denyTicket(state, binding, true);
        return 0;
    }
    release(state.reserved, binding.activateFence);
    reserve(state.used, binding.activateFence);
    state.record.activeSessionId = binding.sessionId;
    state.record.pending = null;
    state.record.fence = binding.activateFence;
    state.record.generation = binding.generation + ONE;
    binding.lifecycle = 'active';
    activation.lifecycle = 'committed';
    state.ticketedPending = null;
    return 1;
}

/** Burns one prepared activation without granting authority. */
function abortPreparedAuthControlActivation(state, prepared) {
    if (!trustedState(state)) return false;
    const activation = state.activationRecord;
    if (!activation) return false;
    const exact = prepared === activation.capability && activation.lifecycle === 'prepared';
    state.activationRecord = null;
    activation.lifecycle = 'denied';
    denyTicket(state, activation.binding, true);
    return exact;
}

/** Observes the exact ACTIVE binding without exposing its internal record. */
function isCurrentAuthControlSessionBinding(state, ticket, exactSessionId) {
    if (!trustedState(state) || !isText(exactSessionId)) return false;
    const binding = entryFor(state, ticket);
    if (!binding || binding.lifecycle !== 'active' || binding.sessionId !== exactSessionId) return false;
    const record = state.record;
    return record.pending === null && record.activeSessionId === binding.sessionId
        && record.fence === binding.activateFence && record.generation === binding.generation + ONE
        && has(state.used, binding.activateFence) && has(state.reserved, binding.retireFence)
        && !has(state.used, binding.retireFence);
}

/** Prepares an exact ACTIVE binding for one controlled retirement. */
function prepareAuthControlRetirement(state, ticket, exactSessionId, exactReason) {
    if (!trustedState(state) || state.operationActive) return null;
    const binding = entryFor(state, ticket);
    if (!binding || binding.lifecycle !== 'active' || !isText(exactSessionId)
        || binding.sessionId !== exactSessionId || !isRetirementReason(exactReason)
        || !sameCurrentRetirement(state, binding) || state.retirementRecord !== null) return null;
    const capability = opaque();
    const retirement = { lifecycle: 'prepared', capability, binding, reason: exactReason };
    state.retirementRecord = retirement;
    binding.lifecycle = 'retirement_prepared';
    return capability;
}

/** Performs only the prepared retirement CAS and returns the P2 result 0 or 2. */
function commitPreparedAuthControlRetirement(state, prepared) {
    if (!trustedState(state)) return 0;
    const retirement = state.retirementRecord;
    if (!retirement) return 0;
    state.retirementRecord = null;
    const binding = retirement.binding;
    if (prepared !== retirement.capability || retirement.lifecycle !== 'prepared'
        || binding.lifecycle !== 'retirement_prepared' || !sameCurrentRetirement(state, binding)) {
        retirement.lifecycle = 'denied';
        denyTicket(state, binding, false);
        state.record.activeSessionId = null;
        state.record.pending = null;
        return 0;
    }
    release(state.reserved, binding.retireFence);
    reserve(state.used, binding.retireFence);
    binding.retiredReason = retirement.reason;
    state.record.activeSessionId = null;
    state.record.pending = null;
    state.record.fence = binding.retireFence;
    state.record.generation = binding.generation + ONE + ONE;
    binding.lifecycle = 'retired';
    retirement.lifecycle = 'committed';
    return 2;
}

/** Burns a prepared retirement capability without changing the ACTIVE binding. */
function abortPreparedAuthControlRetirement(state, prepared) {
    if (!trustedState(state)) return false;
    const retirement = state.retirementRecord;
    if (!retirement) return false;
    const exact = prepared === retirement.capability && retirement.lifecycle === 'prepared';
    state.retirementRecord = null;
    retirement.lifecycle = 'denied';
    const binding = retirement.binding;
    if (binding.lifecycle === 'retirement_prepared') binding.lifecycle = 'active';
    return exact;
}

/** Advances an idle or pending control fence for lock before any cleanup. */
function advanceLockControlRecord(state, expectedFence, at) {
    if (!trustedState(state) || state.operationActive) return null;
    state.operationActive = true;
    state.operationPoisoned = false;
    try {
        const now = tick(state, currentTime(at));
        const record = state.record;
        if (now === null || !isText(expectedFence) || record.fence !== expectedFence
            || record.activeSessionId !== null || state.activationRecord !== null
            || state.retirementRecord !== null) return null;
        const nextFence = successorFence();
        if (!isText(nextFence) || record.generation === MAX_U64
            || has(state.used, nextFence) || has(state.reserved, nextFence)) return null;
        record.pending = null;
        state.ticketedPending = null;
        reserve(state.used, nextFence);
        record.fence = nextFence;
        record.generation += ONE;
        return objectFreeze({ ok: true, fence: nextFence, generation: record.generation });
    } catch {
        return null;
    } finally {
        state.operationActive = false;
        state.operationPoisoned = false;
    }
}

/** Returns immutable ordering data only; no internal record escapes. */
function snapshotControlRecord(state) {
    if (!trustedState(state)) return null;
    return objectFreeze({
        controlId: state.record.controlId,
        fence: state.record.fence,
        generation: state.record.generation,
        pending: state.record.pending !== null,
        active: state.record.activeSessionId !== null,
    });
}

/** Validates one idle control state before an owner-wide reset is published. */
function canTerminallyResetControlRecord(state) {
    return trustedState(state) && state.operationActive === false;
}

/**
 * Revokes one prevalidated control state without clocks, allocation or callouts.
 * The owner invokes this only while its reset fence excludes all other work.
 */
function terminallyResetControlRecord(state) {
    state.record.pending = null;
    state.record.activeSessionId = null;
    state.ticketedPending = null;
    state.activationRecord = null;
    state.retirementRecord = null;
    state.operationPoisoned = true;
}

module.exports = objectFreeze({
    createControlRecordState,
    beginControlOperation,
    cancelPendingAuth,
    prepareAuthControlTicket,
    abortPreparedAuthControlTicket,
    prepareAuthControlActivation,
    commitPreparedAuthControlActivation,
    abortPreparedAuthControlActivation,
    isCurrentAuthControlSessionBinding,
    prepareAuthControlRetirement,
    commitPreparedAuthControlRetirement,
    abortPreparedAuthControlRetirement,
    advanceLockControlRecord,
    snapshotControlRecord,
    canTerminallyResetControlRecord,
    terminallyResetControlRecord,
    CONTROL_PENDING_TTL_MS: 120_000,
});
