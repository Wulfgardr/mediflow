/* @Codex */
'use strict';

const objectCreate = Object.create;
const objectEntries = Object.entries;
const objectFreeze = Object.freeze;
const reflectApply = Reflect.apply;
const numberIsSafeInteger = Number.isSafeInteger;
const mapGet = Map.prototype.get;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;

function frozenRecord(values) {
    const record = objectCreate(null);
    for (const [key, value] of reflectApply(objectEntries, Object, [values])) record[key] = value;
    return objectFreeze(record);
}

const absent = frozenRecord({ status: 'absent' });
const ownedDenied = frozenRecord({ status: 'owned_denied' });

function mapValue(registry, key) {
    try { return reflectApply(mapGet, registry, [key]); } catch { return undefined; }
}

function projectionBinding(state, value) {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return null;
    try { return reflectApply(weakMapGet, state.projections, [value]) ?? null; } catch { return null; }
}

function authenticProjectionCell(state, projection) {
    const binding = projectionBinding(state, projection);
    if (!binding || binding.projection !== projection || binding.cell.state !== 'ACTIVE') return null;
    const cell = mapValue(state.sessions, binding.cell.session.id);
    if (cell !== binding.cell || cell.session.id !== binding.sessionId || cell.session.authChannel !== 'web') return null;
    let now;
    try { now = state.now(); } catch { return null; }
    if (state.poisoned?.() || !numberIsSafeInteger(now) || now < 0 || cell.session.expiresAt <= now) return null;
    return cell;
}

function resolve(state, locator) {
    if (typeof locator !== 'string' || locator.length === 0 || locator.length > 256) return absent;
    const cell = mapValue(state.sessions, locator);
    if (!cell) return absent;
    if (cell.state !== 'ACTIVE' || cell.session.id !== locator || cell.session.authChannel !== 'web') return ownedDenied;
    let now;
    try { now = state.now(); } catch { return ownedDenied; }
    if (state.poisoned?.() || !numberIsSafeInteger(now) || now < 0) return ownedDenied;
    if (cell.session.expiresAt <= now) {
        try { state.retireExpired(cell); } catch { /* expiry remains denied */ }
        return ownedDenied;
    }
    const projection = frozenRecord({
        id: cell.session.id,
        userId: cell.session.userId,
        username: cell.session.username,
        role: cell.session.role,
        authChannel: 'web',
        createdAt: cell.session.createdAt,
        expiresAt: cell.session.expiresAt,
    });
    const binding = frozenRecord({ projection, cell, sessionId: locator });
    if (state.poisoned?.()) return ownedDenied;
    try { reflectApply(weakMapSet, state.projections, [projection, binding]); } catch { return ownedDenied; }
    return frozenRecord({ status: 'active', projection });
}

module.exports = objectFreeze({ authenticProjectionCell, resolve });
