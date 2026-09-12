/* @Codex */
'use strict';

/* Private resources are attached to P3 cells and never constitute authority. */
const { types: { isAsyncFunction, isGeneratorFunction, isPromise, isProxy } } = require('node:util');
const cells = require('./session-cell.cjs');

const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectApply = Reflect.apply;
const dateNow = Date.now;
const numberIsSafeInteger = Number.isSafeInteger;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const weakMapDelete = WeakMap.prototype.delete;
const promiseThen = Promise.prototype.then;
const functionToString = Function.prototype.toString;
const RESOURCE_STATE = Symbol('mediflow.session-resource.state');
const synchronousFunctionPrototype = objectGetPrototypeOf(function () {});
const opaque = () => objectFreeze(objectCreate(null));
const isTime = (value) => typeof value === 'number' && numberIsSafeInteger(value) && value >= 0;
const isObjectLike = (value) => (typeof value === 'object' && value !== null) || typeof value === 'function';
const isReason = (value) => value === 'lock' || value === 'dispose' || value === 'expired'
    || value === 'delete' || value === 'clear';
const ignoredRejection = () => {};

function trustedState(value) {
    if (!value || typeof value !== 'object' || isProxy(value)) return false;
    try {
        return objectGetPrototypeOf(value) === null
            && objectGetOwnPropertyDescriptor(value, RESOURCE_STATE)?.value === true;
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

function weakGet(map, value) {
    if (!isObjectLike(value) || isProxy(value)) return null;
    try { return reflectApply(weakMapGet, map, [value]) || null; } catch { return null; }
}

function weakSet(map, value, item) {
    try { reflectApply(weakMapSet, map, [value, item]); return true; } catch { return false; }
}

function weakDelete(map, value) {
    try { return reflectApply(weakMapDelete, map, [value]); } catch { return false; }
}

// Terminal records leave their intrusive lists immediately. No historical
// head retains a released port, consumed use or removed registration.
function forgetUse(state, record) {
    const resource = record.owner;
    if (record.previous) record.previous.next = record.next;
    else if (resource?.useHead === record) resource.useHead = record.next;
    if (record.next) record.next.previous = record.previous;
    weakDelete(state.uses, record.use);
    record.active = false;
    record.previous = record.next = record.owner = record.cell = record.session = record.port = record.use = null;
}

function forgetRegistration(state, record) {
    const resource = record.resource;
    if (record.previous) record.previous.next = record.next;
    else if (resource?.registrationHead === record) resource.registrationHead = record.next;
    if (record.next) record.next.previous = record.previous;
    weakDelete(state.registrations, record.registration);
    record.active = false;
    record.previous = record.next = record.resource = record.dispose = record.registration = null;
}

function forgetPort(state, record) {
    while (record.useHead) forgetUse(state, record.useHead);
    while (record.registrationHead) forgetRegistration(state, record.registrationHead);
    if (record.previous) record.previous.next = record.next;
    else if (record.cell?.resourcePortHead === record) record.cell.resourcePortHead = record.next;
    if (record.next) record.next.previous = record.previous;
    weakDelete(state.ports, record.port);
    record.active = false;
    record.revoked = true;
    record.previous = record.next = record.cell = record.session = record.port = record.sessionId = null;
}

function resourceFor(state, port) {
    if (!trustedState(state)) return null;
    return weakGet(state.ports, port);
}

function resourceUseFor(state, use) {
    if (!trustedState(state)) return null;
    return weakGet(state.uses, use);
}

function registrationFor(state, registration) {
    if (!trustedState(state)) return null;
    return weakGet(state.registrations, registration);
}

function liveResource(record, at) {
    const cell = record?.cell;
    const session = record?.session;
    return Boolean(record && record.active && !record.revoked && cell && session
        && cell.state === 'ACTIVE' && !cell.resourcePortsRevoked && cell.session === session
        && cell.session.id === record.sessionId && session.authChannel === 'web'
        && session.expiresAt > at);
}

/** Allocates the private resource state for one owner factory. */
function createSessionResourceState() {
    const state = objectCreate(null);
    state[RESOURCE_STATE] = true;
    state.ports = new WeakMap();
    state.uses = new WeakMap();
    state.registrations = new WeakMap();
    state.authenticationGenerations = new WeakMap();
    state.cleanupComplete = new WeakMap();
    return state;
}

function authenticationGenerationFor(state, cell) {
    let generation = weakGet(state.authenticationGenerations, cell);
    if (generation) return generation;
    generation = opaque();
    return weakSet(state.authenticationGenerations, cell, generation) ? generation : null;
}

function synchronousOperation(value) {
    return supportedDisposer(value) && !isAsyncFunction(value) && !isGeneratorFunction(value);
}

function observeRejectedResult(value) {
    if (!isPromise(value)) return;
    try { reflectApply(promiseThen, value, [undefined, ignoredRejection]); } catch { /* denial remains */ }
}

/** Emits the exact active-cell identity only while one resource use remains current. */
function withCurrentResourceBinding(state, use, operation) {
    if (!trustedState(state) || !isObjectLike(use) || isProxy(use) || !synchronousOperation(operation)) return false;
    const before = currentTime();
    const record = resourceUseFor(state, use);
    if (before === null || !record || !record.active || !liveResource(record.owner, before)
        || record.cell !== record.owner.cell || record.session !== record.owner.session) return false;
    const generation = authenticationGenerationFor(state, record.cell);
    if (!generation) return false;
    const binding = objectCreate(null);
    binding.principalRef = record.session.userId;
    binding.authenticationGeneration = generation;
    objectFreeze(binding);
    let result;
    try { result = reflectApply(operation, undefined, [binding]); }
    catch { return false; }
    if (result !== undefined) {
        observeRejectedResult(result);
        return false;
    }
    const after = currentTime();
    const finalRecord = resourceUseFor(state, use);
    return after !== null && finalRecord === record && record.active
        && liveResource(record.owner, after) && record.cell === record.owner.cell
        && weakGet(state.authenticationGenerations, record.cell) === generation;
}

/** Creates a private resource port bound to one exact active cell. */
function createResourcePort(state, cellState, cellPort, at) {
    if (!trustedState(state) || !isObjectLike(cellPort) || isProxy(cellPort)) return null;
    const current = currentTime(at);
    if (current === null) return null;
    const cell = cells.getCellForPort(cellState, cellPort);
    if (!cell || cell.state !== 'ACTIVE' || cell.resourcePortsRevoked || !cell.session
        || cell.session.authChannel !== 'web' || cell.session.expiresAt <= current) return null;
    const port = opaque();
    const record = { active: true, revoked: false, cell, session: cell.session,
        sessionId: cell.sessionId, port, previous: null, next: cell.resourcePortHead, useHead: null, registrationHead: null };
    if (!weakSet(state.ports, port, record)) return null;
    if (record.next) record.next.previous = record;
    cell.resourcePortHead = record;
    return port;
}

/** Mints a one-use private resource use token for a live resource port. */
function prepareResourceUse(state, port, at) {
    if (!trustedState(state) || !isObjectLike(port) || isProxy(port)) return null;
    const current = currentTime(at);
    const record = resourceFor(state, port);
    if (current === null || !liveResource(record, current)) return null;
    const use = opaque();
    const useRecord = { active: true, use, port, owner: record, cell: record.cell, session: record.session,
        previous: null, next: record.useHead };
    if (!weakSet(state.uses, use, useRecord)) return null;
    if (useRecord.next) useRecord.next.previous = useRecord;
    record.useHead = useRecord;
    return use;
}

/** Consumes one exact resource use token while the cell is still ACTIVE. */
function consumeResourceUse(state, use, at) {
    if (!trustedState(state) || !isObjectLike(use) || isProxy(use)) return false;
    const current = currentTime(at);
    const record = resourceUseFor(state, use);
    if (current === null || !record || !record.active || !liveResource(record.owner, current)
        || record.cell !== record.owner.cell) return false;
    forgetUse(state, record);
    return true;
}

/** Observes a live use without consuming it. */
function isCurrentResourceUse(state, use, at) {
    if (!trustedState(state) || !isObjectLike(use) || isProxy(use)) return false;
    const current = currentTime(at);
    const record = resourceUseFor(state, use);
    return current !== null && Boolean(record && record.active && liveResource(record.owner, current)
        && record.cell === record.owner.cell);
}

function supportedDisposer(value) {
    if (typeof value !== 'function' || isProxy(value)) return false;
    try {
        if (objectGetPrototypeOf(value) !== synchronousFunctionPrototype) return false;
        const source = reflectApply(functionToString, value, []);
        return !/^\s*(?:async(?:\s|\()|class(?:\s|\{))/u.test(source) && !source.includes('[native code]');
    } catch { return false; }
}

/** Registers a disposer; it cannot run before the cell reaches RETIRED. */
function registerResource(state, port, disposer, at) {
    if (!trustedState(state) || !isObjectLike(port) || isProxy(port) || !supportedDisposer(disposer)) return null;
    const current = currentTime(at);
    const resource = resourceFor(state, port);
    if (current === null || !liveResource(resource, current)) return null;
    const registration = opaque();
    const record = { active: true, registration, resource, dispose: disposer,
        previous: null, next: resource.registrationHead };
    if (!weakSet(state.registrations, registration, record)) return null;
    if (record.next) record.next.previous = record;
    resource.registrationHead = record;
    return registration;
}

/** Revokes one exact resource port without invoking its private disposers. */
function releaseResourcePort(state, port) {
    if (!trustedState(state) || !isObjectLike(port) || isProxy(port)) return false;
    const resource = resourceFor(state, port);
    if (!resource || !resource.active) return false;
    forgetPort(state, resource);
    return true;
}

/** Removes one exact registration; no disposer runs on explicit unregister. */
function unregisterResource(state, port, registration) {
    if (!trustedState(state) || !isObjectLike(port) || isProxy(port)
        || !isObjectLike(registration) || isProxy(registration)) return false;
    const resource = resourceFor(state, port);
    const record = registrationFor(state, registration);
    if (!resource || !record || !record.active || record.resource !== resource) return false;
    forgetRegistration(state, record);
    return true;
}

/** Revokes ports and uses without invoking any disposer. */
function revokeCellResources(state, cell) {
    if (!trustedState(state) || !cell || (typeof cell !== 'object' && typeof cell !== 'function') || isProxy(cell)) return false;
    try {
        cell.resourcePortsRevoked = true;
        for (let resource = cell.resourcePortHead; resource; resource = resource.next) {
            resource.active = false;
            resource.revoked = true;
            for (let use = resource.useHead; use; use = use.next) use.active = false;
        }
        return true;
    } catch {
        return false;
    }
}

function disposeOne(state, record, reason) {
    const dispose = record.dispose;
    forgetRegistration(state, record);
    if (!dispose) return false;
    try {
        const outcome = reflectApply(dispose, undefined, [reason]);
        if (outcome === undefined) return false;
        try { reflectApply(promiseThen, outcome, [undefined, ignoredRejection]); } catch { /* opaque outcome */ }
        return true;
    } catch {
        return true;
    }
}

/** Performs resource cleanup only after a terminal RETIRED/TOMBSTONE state. */
function cleanupRetiredCellResources(state, cellState, cellOrPort, reason) {
    if (!trustedState(state) || !isReason(reason)) return objectFreeze({ outcome: 'denied' });
    const cell = cells.getCellForPort(cellState, cellOrPort);
    if (!cell || typeof cell !== 'object' || isProxy(cell)
        || (cell.state !== 'RETIRED' && cell.state !== 'TOMBSTONE')) return objectFreeze({ outcome: 'denied' });
    if (state.cleanupComplete.has(cell)) return objectFreeze({ outcome: 'completed' });
    let failed = false;
    try {
        revokeCellResources(state, cell);
        while (cell.resourcePortHead) {
            const resource = cell.resourcePortHead;
            while (resource.registrationHead) {
                if (disposeOne(state, resource.registrationHead, reason)) failed = true;
            }
            forgetPort(state, resource);
        }
        state.cleanupComplete.set(cell, failed ? 'failed' : 'completed');
        return objectFreeze({ outcome: failed ? 'failed' : 'completed' });
    } catch {
        try { state.cleanupComplete.set(cell, 'failed'); } catch { /* terminal state remains denied */ }
        return objectFreeze({ outcome: 'failed' });
    }
}

/** Internal exact lookup used by resolver code. */
function getResourceRecord(state, port) {
    return resourceFor(state, port);
}

module.exports = objectFreeze({
    createSessionResourceState,
    createResourcePort,
    prepareResourceUse,
    consumeResourceUse,
    isCurrentResourceUse,
    withCurrentResourceBinding,
    registerResource,
    releaseResourcePort,
    unregisterResource,
    revokeCellResources,
    cleanupRetiredCellResources,
    getResourceRecord,
});
