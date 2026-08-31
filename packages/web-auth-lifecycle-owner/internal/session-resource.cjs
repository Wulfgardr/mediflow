/* @Codex */
'use strict';

/* Private resources are attached to P3 cells and never constitute authority. */
const { types: { isProxy } } = require('node:util');
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
    state.portHead = null;
    state.useHead = null;
    state.registrationHead = null;
    state.cleanupComplete = new WeakMap();
    return state;
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
        sessionId: cell.sessionId, next: cell.resourcePortHead, useHead: null, registrationHead: null };
    if (!weakSet(state.ports, port, record)) return null;
    cell.resourcePortHead = record;
    state.portHead = record;
    return port;
}

/** Mints a one-use private resource use token for a live resource port. */
function prepareResourceUse(state, port, at) {
    if (!trustedState(state) || !isObjectLike(port) || isProxy(port)) return null;
    const current = currentTime(at);
    const record = resourceFor(state, port);
    if (current === null || !liveResource(record, current)) return null;
    const use = opaque();
    const useRecord = { active: true, port, owner: record, cell: record.cell, session: record.session,
        next: record.useHead };
    if (!weakSet(state.uses, use, useRecord)) return null;
    record.useHead = useRecord;
    state.useHead = useRecord;
    return use;
}

/** Consumes one exact resource use token while the cell is still ACTIVE. */
function consumeResourceUse(state, use, at) {
    if (!trustedState(state) || !isObjectLike(use) || isProxy(use)) return false;
    const current = currentTime(at);
    const record = resourceUseFor(state, use);
    if (current === null || !record || !record.active || !liveResource(record.owner, current)
        || record.cell !== record.owner.cell) return false;
    record.active = false;
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
        next: resource.registrationHead };
    if (!weakSet(state.registrations, registration, record)) return null;
    resource.registrationHead = record;
    state.registrationHead = record;
    return registration;
}

/** Revokes one exact resource port without invoking its private disposers. */
function releaseResourcePort(state, port) {
    if (!trustedState(state) || !isObjectLike(port) || isProxy(port)) return false;
    const resource = resourceFor(state, port);
    if (!resource || !resource.active) return false;
    resource.active = false;
    resource.revoked = true;
    for (let use = resource.useHead; use; use = use.next) use.active = false;
    let registration = resource.registrationHead;
    resource.registrationHead = null;
    while (registration) {
        registration.active = false;
        registration.dispose = null;
        registration.resource = null;
        weakDelete(state.registrations, registration.registration);
        registration = registration.next;
    }
    weakDelete(state.ports, port);
    return true;
}

/** Removes one exact registration; no disposer runs on explicit unregister. */
function unregisterResource(state, port, registration) {
    if (!trustedState(state) || !isObjectLike(port) || isProxy(port)
        || !isObjectLike(registration) || isProxy(registration)) return false;
    const resource = resourceFor(state, port);
    const record = registrationFor(state, registration);
    if (!resource || !record || !record.active || record.resource !== resource) return false;
    record.active = false;
    record.dispose = null;
    record.resource = null;
    weakDelete(state.registrations, registration);
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

function disposeOne(record, reason) {
    const dispose = record.dispose;
    record.active = false;
    record.dispose = null;
    record.resource = null;
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
        for (let resource = cell.resourcePortHead; resource; resource = resource.next) {
            let registration = resource.registrationHead;
            resource.registrationHead = null;
            resource.useHead = null;
            resource.active = false;
            resource.revoked = true;
            while (registration) {
                const next = registration.next;
                registration.next = null;
                if (disposeOne(registration, reason)) failed = true;
                weakDelete(state.registrations, registration.registration);
                registration = next;
            }
            for (let use = resource.useHead; use; use = use.next) use.active = false;
            resource.cell = null;
            resource.session = null;
        }
        cell.resourcePortHead = null;
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
    registerResource,
    releaseResourcePort,
    unregisterResource,
    revokeCellResources,
    cleanupRetiredCellResources,
    getResourceRecord,
});
