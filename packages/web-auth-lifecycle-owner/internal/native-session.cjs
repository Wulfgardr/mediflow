/* @Codex: relocated session lifecycle; the root constructs one private instance. */
'use strict';
const crypto = require('node:crypto');
const { types } = require('node:util');
function createServerSessionOwner() {
    /* @Codex */
    /* @Codex: after O1-C the historical P3 owner cannot acquire P2 authority. */
    function prepareAuthControlActivation(_ticket, _exactSessionId) {
        return null;
    }
    /* @Codex */
    function commitPreparedAuthControlActivation(_prepared) {
        return 0;
    }
    /* @Codex */
    function abortPreparedAuthControlActivation(_prepared) {
        return false;
    }
    /* @Codex */
    function prepareAuthControlRetirement(_ticket, _exactSessionId, _exactReason) {
        return null;
    }
    /* @Codex */
    function commitPreparedAuthControlRetirement(_prepared) {
        return 0;
    }
    /* @Codex */
    function abortPreparedAuthControlRetirement(_prepared) {
        return false;
    }
    const SESSION_COOKIE_NAME = 'mediflow_session';
    const SESSION_TTL_MS = Number(process.env.MEDIFLOW_SESSION_TTL_MS || 1000 * 60 * 60 * 8);
    const MapConstructor = Map;
    const SetConstructor = Set;
    const WeakMapConstructor = WeakMap;
    const DateNow = Date.now;
    const ObjectCreate = Object.create;
    const ObjectPrototype = Object.prototype;
    const ObjectGetPrototypeOf = Object.getPrototypeOf;
    const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
    const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
    const ObjectFreeze = Object.freeze;
    const NumberIsFinite = Number.isFinite;
    const NumberIsSafeInteger = Number.isSafeInteger;
    const applyIntrinsic = Reflect.apply;
    const functionToString = Function.prototype.toString;
    const synchronousFunctionPrototype = ObjectGetPrototypeOf(function () { });
    const promiseThen = Promise.prototype.then;
    const mapGet = Map.prototype.get;
    const mapHas = Map.prototype.has;
    const mapSet = Map.prototype.set;
    const mapDelete = Map.prototype.delete;
    const mapClear = Map.prototype.clear;
    const mapKeys = Map.prototype.keys;
    const mapValues = Map.prototype.values;
    const mapIteratorNext = ObjectGetPrototypeOf(new MapConstructor().keys()).next;
    const setAdd = Set.prototype.add;
    const setClear = Set.prototype.clear;
    const setDelete = Set.prototype.delete;
    const setHas = Set.prototype.has;
    const setValues = Set.prototype.values;
    const setIteratorNext = ObjectGetPrototypeOf(new SetConstructor().values()).next;
    const setSize = ObjectGetOwnPropertyDescriptor(Set.prototype, 'size').get;
    const weakMapGet = WeakMap.prototype.get;
    const weakMapSet = WeakMap.prototype.set;
    const weakMapDelete = WeakMap.prototype.delete;
    const cryptoRandomBytes = crypto.randomBytes;
    const bufferToString = Buffer.prototype.toString;
    const arrayPush = Array.prototype.push;
    const isProxy = types.isProxy;
    function getMapValue(registry, key) {
        return applyIntrinsic(mapGet, registry, [key]);
    }
    function hasMapValue(registry, key) {
        return applyIntrinsic(mapHas, registry, [key]);
    }
    function setMapValue(registry, key, value) {
        applyIntrinsic(mapSet, registry, [key, value]);
    }
    function deleteMapValue(registry, key) {
        applyIntrinsic(mapDelete, registry, [key]);
    }
    function clearMap(registry) {
        applyIntrinsic(mapClear, registry, []);
    }
    function nextMapIterator(iterator) {
        return applyIntrinsic(mapIteratorNext, iterator, []);
    }
    function mapKeysOf(registry) {
        return applyIntrinsic(mapKeys, registry, []);
    }
    function mapValuesOf(registry) {
        return applyIntrinsic(mapValues, registry, []);
    }
    function addSetValue(registry, value) {
        applyIntrinsic(setAdd, registry, [value]);
    }
    function deleteSetValue(registry, value) {
        return applyIntrinsic(setDelete, registry, [value]);
    }
    function hasSetValue(registry, value) {
        return applyIntrinsic(setHas, registry, [value]);
    }
    function clearSet(registry) {
        applyIntrinsic(setClear, registry, []);
    }
    function nextSetIterator(iterator) {
        return applyIntrinsic(setIteratorNext, iterator, []);
    }
    function setSizeOf(registry) {
        return applyIntrinsic(setSize, registry, []);
    }
    function getWeakMapValue(registry, key) {
        return applyIntrinsic(weakMapGet, registry, [key]);
    }
    function setWeakMapValue(registry, key, value) {
        applyIntrinsic(weakMapSet, registry, [key, value]);
    }
    function deleteWeakMapValue(registry, key) {
        return applyIntrinsic(weakMapDelete, registry, [key]);
    }
    function appendArrayValue(target, value) {
        applyIntrinsic(arrayPush, target, [value]);
    }
    function createWebServerSessionRetirementCleanupReceipt(outcome) {
        const receipt = ObjectCreate(null);
        receipt.outcome = outcome;
        return ObjectFreeze(receipt);
    }
    const completedWebSessionRetirementCleanupReceipt = createWebServerSessionRetirementCleanupReceipt('completed');
    const failedWebSessionRetirementCleanupReceipt = createWebServerSessionRetirementCleanupReceipt('failed');
    const deniedWebSessionRetirementCleanupReceipt = createWebServerSessionRetirementCleanupReceipt('denied');
    /* @Codex */
    function createNativeSystemSessionOperationReceipt(outcome) {
        const receipt = ObjectCreate(null);
        receipt.outcome = outcome;
        return ObjectFreeze(receipt);
    }
    const completedNativeSystemSessionOperationReceipt = createNativeSystemSessionOperationReceipt('completed');
    const failedNativeSystemSessionOperationReceipt = createNativeSystemSessionOperationReceipt('failed');
    const deniedNativeSystemSessionOperationReceipt = createNativeSystemSessionOperationReceipt('denied');
    const retiredWebSessionSentinel = ObjectFreeze({
        id: '', userId: '', username: '', role: '', authChannel: 'web', createdAt: 0, expiresAt: 0,
    });
    const sessions = new MapConstructor();
    const nativeSessionBindings = new WeakMap();
    const sessionResources = new MapConstructor();
    const sessionCleanupOutcomes = new MapConstructor();
    const stagedWebSessionRecords = new WeakMapConstructor();
    const stagedWebSessions = new SetConstructor();
    const preparedWebSessionRecords = new WeakMapConstructor();
    const preparedWebSessionReservations = new MapConstructor();
    const armedWebSessionPortRecords = new WeakMapConstructor();
    const activeWebSessionCellsBySession = new WeakMapConstructor();
    const activeWebSessionResourcePortRecords = new WeakMapConstructor();
    const activeWebSessionResourceUseRecords = new WeakMapConstructor();
    const nativeSystemSessionOperationRecords = new WeakMapConstructor();
    const nativeLoginSessionFenceRecords = new WeakMapConstructor();
    /* @Codex: only exact paired-session preparations may cross into Web credential retirement. */
    const nativePinRetirementProofs = new WeakMapConstructor();
    const nativeLoginUserRetirementEpochs = new MapConstructor();
    let nativeSystemSessionOperation = null;
    let nativeLoginRetirementEpoch = 0;
    let nativeLoginAdminResetEpoch = 0;
    let nativeLoginFenceStateAvailable = true;
    let activeWebSessionPrivateResourceRegistrationHead = null;
    const invalidRetirementTurnUser = Symbol('invalid_retirement_turn_user');
    let userRetirementTurnHead = null;
    const armedWebSessionCellsById = ObjectCreate(null);
    let armedWebSessionCellHead = null;
    let webSessionPrepareInProgress = false;
    let webSessionPreparePoisoned = false;
    let webSessionCellLifecycle = 'idle';
    let webSessionCellLifecyclePoisoned = false;
    function sessionUserIdForRetirementTurn(value) {
        try {
            if (!value || typeof value !== 'object' || isProxy(value))
                return invalidRetirementTurnUser;
            const descriptor = ObjectGetOwnPropertyDescriptor(value, 'id');
            return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
                ? descriptor.value
                : invalidRetirementTurnUser;
        }
        catch {
            return invalidRetirementTurnUser;
        }
    }
    function beginUserRetirementTurn(userId) {
        for (let active = userRetirementTurnHead; active; active = active.next) {
            if (active.active && active.userId === userId) {
                active.poisoned = true;
                return null;
            }
        }
        const turn = { active: true, poisoned: false, userId, next: userRetirementTurnHead };
        userRetirementTurnHead = turn;
        return turn;
    }
    function endUserRetirementTurn(userId, turn) {
        if (!turn.active || turn.userId !== userId)
            return;
        turn.active = false;
        if (userRetirementTurnHead === turn)
            userRetirementTurnHead = turn.next;
        else {
            for (let prior = userRetirementTurnHead; prior; prior = prior.next) {
                if (prior.next === turn) {
                    prior.next = turn.next;
                    break;
                }
            }
        }
        turn.next = null;
    }
    function denyUserRetirementTurn(userId) {
        for (let active = userRetirementTurnHead; active; active = active.next) {
            if (active.active && active.userId === userId) {
                active.poisoned = true;
                return true;
            }
        }
        return false;
    }
    function poisonUserRetirementTurns() {
        let poisoned = false;
        for (let active = userRetirementTurnHead; active; active = active.next) {
            if (active.active) {
                active.poisoned = true;
                poisoned = true;
            }
        }
        return poisoned;
    }
    /* @Codex */
    function advanceNativeLoginRetirementEpoch(userId) {
        if (!nativeLoginFenceStateAvailable)
            return false;
        try {
            const nextEpoch = nativeLoginRetirementEpoch + 1;
            if (!NumberIsSafeInteger(nextEpoch))
                throw new Error('native_login_epoch_unavailable');
            if (userId === null)
                nativeLoginAdminResetEpoch = nextEpoch;
            else
                setMapValue(nativeLoginUserRetirementEpochs, userId, nextEpoch);
            nativeLoginRetirementEpoch = nextEpoch;
            return true;
        }
        catch {
            nativeLoginFenceStateAvailable = false;
            return false;
        }
    }
    /* @Codex */
    function nativeLoginFenceAllowsUser(epoch, userId) {
        if (!nativeLoginFenceStateAvailable || epoch === null)
            return false;
        try {
            return nativeLoginAdminResetEpoch <= epoch
                && (getMapValue(nativeLoginUserRetirementEpochs, userId) ?? 0) <= epoch;
        }
        catch {
            nativeLoginFenceStateAvailable = false;
            return false;
        }
    }
    /* @Codex */
    function consumeNativeLoginSessionFence(fence, userId) {
        try {
            if (!fence || typeof fence !== 'object' || isProxy(fence)
                || ObjectGetPrototypeOf(fence) !== null)
                return null;
            const record = getWeakMapValue(nativeLoginSessionFenceRecords, fence);
            if (!record || !record.active)
                return null;
            record.active = false;
            deleteWeakMapValue(nativeLoginSessionFenceRecords, fence);
            return nativeLoginFenceAllowsUser(record.epoch, userId) ? record.epoch : null;
        }
        catch {
            return null;
        }
    }
    /* @Codex */
    function nativeSystemOperationBlocksCreation(user, authChannel) {
        const operation = nativeSystemSessionOperation;
        if (!operation || (operation.state !== 'prepared' && operation.state !== 'committing'))
            return false;
        if (operation.kind === 'admin_reset')
            return authChannel === 'native' || authChannel === 'system';
        if (authChannel !== 'native' || !operation.userId)
            return false;
        try {
            if (!user || typeof user !== 'object' || isProxy(user))
                return true;
            const sessionUserId = ObjectGetOwnPropertyDescriptor(user, 'userId');
            if (sessionUserId && 'value' in sessionUserId && typeof sessionUserId.value === 'string') {
                return sessionUserId.value === operation.userId;
            }
            return sessionUserIdForRetirementTurn(user) === operation.userId;
        }
        catch {
            return true;
        }
    }
    function prepareNativeSystemSessionOperation(kind, userId) {
        const active = nativeSystemSessionOperation;
        if (active) {
            if (active.state === 'committing') {
                active.poisoned = true;
                return null;
            }
            if (active.state === 'prepared' && kind === 'user_retirement'
                && active.kind === kind && active.userId === userId) {
                const alias = ObjectFreeze(ObjectCreate(null));
                try {
                    addSetValue(active.capabilities, alias);
                    setWeakMapValue(nativeSystemSessionOperationRecords, alias, active);
                    if (active.state !== 'prepared' || nativeSystemSessionOperation !== active
                        || !hasSetValue(active.capabilities, alias))
                        throw new Error('native_session_operation_alias_denied');
                    return alias;
                }
                catch {
                    try {
                        deleteWeakMapValue(nativeSystemSessionOperationRecords, alias);
                    }
                    catch { /* alias stays inert */ }
                    try {
                        deleteSetValue(active.capabilities, alias);
                    }
                    catch { /* alias stays inert */ }
                    return null;
                }
            }
            return null;
        }
        const capability = ObjectFreeze(ObjectCreate(null));
        const record = {
            state: 'prepared',
            kind,
            capabilities: new SetConstructor(),
            userId,
            targets: [],
            poisoned: false,
        };
        nativeSystemSessionOperation = record;
        try {
            addSetValue(record.capabilities, capability);
            const iterator = mapValuesOf(sessions);
            for (let next = nextMapIterator(iterator); !next.done; next = nextMapIterator(iterator)) {
                const session = next.value;
                const authorityTarget = kind === 'admin_reset'
                    ? session.authChannel === 'native' || session.authChannel === 'system'
                    : session.authChannel === 'native' && session.userId === userId;
                const cleanupOnly = kind === 'user_retirement'
                    && session.authChannel === 'web'
                    && session.userId === userId
                    && !armedWebSessionCellsById[session.id];
                if (authorityTarget || cleanupOnly) {
                    appendArrayValue(record.targets, {
                        sessionId: session.id,
                        session,
                        cleanupOnly,
                    });
                }
            }
            if (record.poisoned || nativeSystemSessionOperation !== record)
                throw new Error('native_session_operation_poisoned');
            setWeakMapValue(nativeSystemSessionOperationRecords, capability, record);
            if (record.poisoned || nativeSystemSessionOperation !== record)
                throw new Error('native_session_operation_poisoned');
            return capability;
        }
        catch {
            try {
                deleteWeakMapValue(nativeSystemSessionOperationRecords, capability);
            }
            catch { /* unpublished capability stays inert */ }
            record.state = 'aborted';
            clearSet(record.capabilities);
            record.targets.length = 0;
            record.userId = null;
            if (nativeSystemSessionOperation === record)
                nativeSystemSessionOperation = null;
            return null;
        }
    }
    function nativeSystemSessionOperationRecord(capability, kind) {
        try {
            if (!capability || typeof capability !== 'object' || isProxy(capability)
                || ObjectGetPrototypeOf(capability) !== null)
                return null;
            const record = getWeakMapValue(nativeSystemSessionOperationRecords, capability);
            return record && record.kind === kind && hasSetValue(record.capabilities, capability)
                && record.state === 'prepared' && nativeSystemSessionOperation === record
                ? record
                : null;
        }
        catch {
            return null;
        }
    }
    function revokeNativeSystemSessionOperationCapabilities(record) {
        let failed = false;
        const iterator = applyIntrinsic(setValues, record.capabilities, []);
        for (let next = nextSetIterator(iterator); !next.done; next = nextSetIterator(iterator)) {
            try {
                if (!deleteWeakMapValue(nativeSystemSessionOperationRecords, next.value))
                    failed = true;
            }
            catch {
                failed = true;
            }
        }
        try {
            clearSet(record.capabilities);
        }
        catch {
            failed = true;
        }
        return !failed;
    }
    function sessionMatchesNativeSystemOperation(session, kind, userId) {
        return kind === 'admin_reset'
            ? session.authChannel === 'native' || session.authChannel === 'system'
            : session.authChannel === 'native' && session.userId === userId;
    }
    function commitNativeSystemSessionOperation(capability, kind) {
        const record = nativeSystemSessionOperationRecord(capability, kind);
        if (!record || typeof capability !== 'object' || capability === null) {
            return deniedNativeSystemSessionOperationReceipt;
        }
        const retirementUserId = kind === 'user_retirement' ? record.userId : null;
        record.state = 'committing';
        let failed = record.poisoned || !revokeNativeSystemSessionOperationCapabilities(record);
        if ((kind === 'user_retirement' && !retirementUserId)
            || !advanceNativeLoginRetirementEpoch(retirementUserId)) {
            failed = true;
        }
        try {
            for (let index = 0; index < record.targets.length; index += 1) {
                const target = record.targets[index];
                const current = getMapValue(sessions, target.sessionId);
                if (!current)
                    continue;
                if (current !== target.session) {
                    failed = true;
                    if (!target.cleanupOnly && sessionMatchesNativeSystemOperation(current, kind, record.userId)) {
                        try {
                            deleteWeakMapValue(nativeSessionBindings, current);
                        }
                        catch {
                            failed = true;
                        }
                        const replacement = terminateSession(target.sessionId, 'session_deleted');
                        if (!replacement.authorityAbsent || replacement.cleanupOutcome === 'failed')
                            failed = true;
                    }
                    continue;
                }
                if (!target.cleanupOnly) {
                    try {
                        deleteWeakMapValue(nativeSessionBindings, current);
                    }
                    catch {
                        failed = true;
                    }
                }
                const result = terminateSession(target.sessionId, 'session_deleted');
                if (!result.authorityAbsent || result.cleanupOutcome === 'failed')
                    failed = true;
            }
            const iterator = mapValuesOf(sessions);
            for (let next = nextMapIterator(iterator); !next.done; next = nextMapIterator(iterator)) {
                if (sessionMatchesNativeSystemOperation(next.value, kind, record.userId)) {
                    failed = true;
                    try {
                        deleteWeakMapValue(nativeSessionBindings, next.value);
                    }
                    catch { /* authority removal continues */ }
                    const result = terminateSession(next.value.id, 'session_deleted');
                    if (!result.authorityAbsent || result.cleanupOutcome === 'failed')
                        failed = true;
                }
            }
            if (record.poisoned)
                failed = true;
        }
        catch {
            failed = true;
        }
        finally {
            record.state = 'committed';
            try {
                clearSet(record.capabilities);
            }
            catch { /* terminal record remains inert */ }
            record.targets.length = 0;
            record.userId = null;
            if (nativeSystemSessionOperation === record)
                nativeSystemSessionOperation = null;
        }
        return failed ? failedNativeSystemSessionOperationReceipt : completedNativeSystemSessionOperationReceipt;
    }
    function abortNativeSystemSessionOperation(capability, kind) {
        const record = nativeSystemSessionOperationRecord(capability, kind);
        if (!record || typeof capability !== 'object' || capability === null)
            return false;
        let removed = false;
        try {
            removed = deleteSetValue(record.capabilities, capability);
            if (!removed)
                return false;
            deleteWeakMapValue(nativeSystemSessionOperationRecords, capability);
        }
        catch {
            return false;
        }
        if (setSizeOf(record.capabilities) !== 0)
            return true;
        record.state = 'aborted';
        record.targets.length = 0;
        record.userId = null;
        if (nativeSystemSessionOperation === record)
            nativeSystemSessionOperation = null;
        return true;
    }
    function rollbackSessionPublication(session) {
        try {
            deleteWeakMapValue(nativeSessionBindings, session);
        }
        catch { /* authority rollback continues */ }
        try {
            deleteMapValue(sessions, session.id);
        }
        catch { /* the exact publication remains denied */ }
    }
    function isSupportedSynchronousDisposer(candidate) {
        if (typeof candidate !== 'function' || isProxy(candidate))
            return false;
        try {
            const source = applyIntrinsic(functionToString, candidate, []);
            return !/^\s*async(?:\s|\()/u.test(source) && !source.includes('[native code]');
        }
        catch {
            return false;
        }
    }
    function isSupportedPrivateResourceDisposer(candidate) {
        if (typeof candidate !== 'function' || isProxy(candidate))
            return false;
        try {
            const source = applyIntrinsic(functionToString, candidate, []);
            return ObjectGetPrototypeOf(candidate) === synchronousFunctionPrototype
                && !/^\s*(?:async(?:\s|\()|class(?:\s|\{))/u.test(source)
                && !source.includes('[native code]');
        }
        catch {
            return false;
        }
    }
    function readPrivateResourceClock() {
        try {
            const now = DateNow();
            return NumberIsFinite(now) && NumberIsSafeInteger(now) && now >= 0 ? now : null;
        }
        catch {
            return null;
        }
    }
    function recordCleanupOutcome(sessionId, failed) {
        const prior = getMapValue(sessionCleanupOutcomes, sessionId);
        const outcome = prior === 'failed' || failed ? 'failed' : 'completed';
        setMapValue(sessionCleanupOutcomes, sessionId, outcome);
        return outcome;
    }
    function disposeSessionResources(sessionId, reason) {
        const registrations = getMapValue(sessionResources, sessionId);
        deleteMapValue(sessionResources, sessionId);
        if (!registrations)
            return false;
        let disposalFailed = false;
        const iterator = applyIntrinsic(setValues, registrations, []);
        for (let next = nextSetIterator(iterator); !next.done; next = nextSetIterator(iterator)) {
            const registration = next.value;
            if (!registration.active)
                continue;
            registration.active = false;
            try {
                const outcome = registration.dispose(reason);
                if (outcome !== undefined)
                    disposalFailed = true;
            }
            catch {
                // Session authority is already removed; cleanup failures stay opaque.
                disposalFailed = true;
            }
        }
        return disposalFailed;
    }
    function completeSessionTermination(sessionId, sessionBeforeDeletion, reason) {
        const registrations = getMapValue(sessionResources, sessionId);
        const disposalFailed = disposeSessionResources(sessionId, reason);
        const cleanupOutcome = sessionBeforeDeletion || registrations
            ? recordCleanupOutcome(sessionId, disposalFailed)
            : getMapValue(sessionCleanupOutcomes, sessionId) ?? 'unknown';
        return { sessionBeforeDeletion, cleanupOutcome, authorityAbsent: getMapValue(sessions, sessionId) === undefined };
    }
    function terminateSession(sessionId, reason) {
        const sessionBeforeDeletion = getMapValue(sessions, sessionId) ?? null;
        deleteMapValue(sessions, sessionId);
        return completeSessionTermination(sessionId, sessionBeforeDeletion, reason);
    }
    function registerServerSessionResource(sessionId, dispose) {
        if (!isSupportedSynchronousDisposer(dispose))
            return null;
        const session = getMapValue(sessions, sessionId);
        if (!session)
            return null;
        if (session.expiresAt <= DateNow()) {
            terminateSession(sessionId, 'session_expired');
            return null;
        }
        const registration = { active: true, dispose };
        const registrations = getMapValue(sessionResources, sessionId) ?? new SetConstructor();
        addSetValue(registrations, registration);
        setMapValue(sessionResources, sessionId, registrations);
        return () => {
            const activeRegistrations = getMapValue(sessionResources, sessionId);
            if (!activeRegistrations || !deleteSetValue(activeRegistrations, registration))
                return;
            registration.active = false;
            if (setSizeOf(activeRegistrations) === 0)
                deleteMapValue(sessionResources, sessionId);
        };
    }
    function createSession(user, authChannel = 'web') {
        if (nativeSystemOperationBlocksCreation(user, authChannel)) {
            throw new Error('native_session_operation_in_progress');
        }
        if (authChannel !== 'system') {
            const userId = sessionUserIdForRetirementTurn(user);
            if (userId === invalidRetirementTurnUser) {
                if (poisonUserRetirementTurns())
                    throw new Error('session_retirement_in_progress');
            }
            else if (denyUserRetirementTurn(userId))
                throw new Error('session_retirement_in_progress');
        }
        const now = DateNow();
        const session = {
            id: crypto.randomBytes(32).toString('hex'),
            userId: user.id,
            username: user.username,
            role: user.role,
            authChannel,
            createdAt: now,
            expiresAt: now + SESSION_TTL_MS
        };
        if (getMapValue(sessions, session.id) || getMapValue(preparedWebSessionReservations, session.id)
            || armedWebSessionCellsById[session.id]) {
            throw new Error('server session id unavailable');
        }
        try {
            setMapValue(sessions, session.id, session);
            if (nativeSystemOperationBlocksCreation(session, authChannel)) {
                throw new Error('native_session_operation_in_progress');
            }
            if (authChannel !== 'system' && denyUserRetirementTurn(session.userId)) {
                throw new Error('session_retirement_in_progress');
            }
            return session;
        }
        catch (error) {
            rollbackSessionPublication(session);
            throw error;
        }
    }
    /** Captures an opaque one-shot fence before native credential verification. */
    /* @Codex */
    function captureNativeLoginSessionFence() {
        const fence = ObjectFreeze(ObjectCreate(null));
        const record = {
            active: true,
            epoch: nativeLoginFenceStateAvailable ? nativeLoginRetirementEpoch : null,
        };
        try {
            setWeakMapValue(nativeLoginSessionFenceRecords, fence, record);
        }
        catch {
            record.active = false;
            record.epoch = null;
            nativeLoginFenceStateAvailable = false;
        }
        return fence;
    }
    /* @Codex: native authority is server-tagged and bound to the admitted paired client. */
    function createNativeServerSession(user, binding, loginFence) {
        if (!isNativeBinding(binding))
            throw new Error('invalid native session binding');
        let admittedEpoch = null;
        let nativeUser = user;
        if (loginFence !== undefined) {
            if (!isStrictWebSessionUser(user))
                throw new Error('invalid native session user');
            nativeUser = ObjectFreeze({ id: user.id, username: user.username, role: user.role });
            admittedEpoch = consumeNativeLoginSessionFence(loginFence, nativeUser.id);
            if (admittedEpoch === null)
                throw new Error('native_login_session_fence_stale');
        }
        const session = createSession(nativeUser, 'native');
        try {
            setWeakMapValue(nativeSessionBindings, session, ObjectFreeze({ ...binding }));
            if (nativeSystemOperationBlocksCreation(session, 'native'))
                throw new Error('native_session_operation_in_progress');
            if (denyUserRetirementTurn(session.userId))
                throw new Error('session_retirement_in_progress');
            if (loginFence !== undefined && !nativeLoginFenceAllowsUser(admittedEpoch, session.userId)) {
                throw new Error('native_login_session_fence_stale');
            }
            return session;
        }
        catch (error) {
            rollbackSessionPublication(session);
            throw error;
        }
    }
    /** Compatibility accepts only the exact process-local native session and its admitted pair. */
    /* @Codex */
    function isPairedNativeServerSession(session, binding) {
        if (!isNativeBinding(binding) || !isExactStoredSession(session))
            return false;
        const tagged = nativeSessionBindings.get(session);
        return Boolean(session.authChannel === 'native' && tagged && tagged.clientId === binding.clientId
            && tagged.clientPlatform === binding.clientPlatform && tagged.tokenHash === binding.tokenHash);
    }
    function isNativeBinding(value) {
        try {
            if (!value || typeof value !== 'object' || isProxy(value) || ObjectGetPrototypeOf(value) !== Object.prototype)
                return false;
            const tokenHash = ObjectGetOwnPropertyDescriptor(value, 'tokenHash');
            if (tokenHash && (!('value' in tokenHash) || !tokenHash.enumerable
                || typeof tokenHash.value !== 'string' || !/^[a-f0-9]{64}$/u.test(tokenHash.value)))
                return false;
            if (ObjectGetOwnPropertySymbols(value).length || ObjectGetOwnPropertyNames(value).length !== (tokenHash ? 3 : 2))
                return false;
            const clientId = ObjectGetOwnPropertyDescriptor(value, 'clientId');
            const clientPlatform = ObjectGetOwnPropertyDescriptor(value, 'clientPlatform');
            return Boolean(clientId && clientPlatform && 'value' in clientId && 'value' in clientPlatform && clientId.enumerable && clientPlatform.enumerable
                && typeof clientId.value === 'string' && (clientPlatform.value === 'macos' || clientPlatform.value === 'ios' || clientPlatform.value === 'ipados'));
        }
        catch {
            return false;
        }
    }
    function isExactStoredSession(value) {
        try {
            if (!value || typeof value !== 'object' || isProxy(value) || ObjectGetPrototypeOf(value) !== Object.prototype)
                return false;
            const id = ObjectGetOwnPropertyDescriptor(value, 'id');
            return Boolean(id && 'value' in id && typeof id.value === 'string' && getMapValue(sessions, id.value) === value);
        }
        catch {
            return false;
        }
    }
    function isStrictWebSessionUser(value) {
        try {
            if (!value || typeof value !== 'object' || isProxy(value) || ObjectGetPrototypeOf(value) !== ObjectPrototype)
                return false;
            if (ObjectGetOwnPropertySymbols(value).length || ObjectGetOwnPropertyNames(value).length !== 3)
                return false;
            const id = ObjectGetOwnPropertyDescriptor(value, 'id');
            const username = ObjectGetOwnPropertyDescriptor(value, 'username');
            const role = ObjectGetOwnPropertyDescriptor(value, 'role');
            return Boolean(id && username && role
                && 'value' in id && 'value' in username && 'value' in role
                && id.enumerable && username.enumerable && role.enumerable
                && typeof id.value === 'string' && typeof username.value === 'string' && typeof role.value === 'string');
        }
        catch {
            return false;
        }
    }
    function stagedWebSessionRecord(capsule) {
        try {
            if (!capsule || typeof capsule !== 'object' || isProxy(capsule) || ObjectGetPrototypeOf(capsule) !== null)
                return null;
            if (ObjectGetOwnPropertySymbols(capsule).length || ObjectGetOwnPropertyNames(capsule).length)
                return null;
            return getWeakMapValue(stagedWebSessionRecords, capsule) ?? null;
        }
        catch {
            return null;
        }
    }
    function revokeStagedWebSession(record) {
        if (!record.active)
            return false;
        record.active = false;
        deleteSetValue(stagedWebSessions, record);
        return true;
    }
    function revokeStagedWebSessionsForUser(userId) {
        const iterator = applyIntrinsic(setValues, stagedWebSessions, []);
        for (let next = nextSetIterator(iterator); !next.done; next = nextSetIterator(iterator)) {
            if (next.value.userId === userId)
                revokeStagedWebSession(next.value);
        }
    }
    function revokeAllStagedWebSessions() {
        const iterator = applyIntrinsic(setValues, stagedWebSessions, []);
        for (let next = nextSetIterator(iterator); !next.done; next = nextSetIterator(iterator))
            revokeStagedWebSession(next.value);
    }
    function preparedWebSessionRecord(capability) {
        try {
            if (!capability || typeof capability !== 'object' || isProxy(capability) || ObjectGetPrototypeOf(capability) !== null)
                return null;
            if (ObjectGetOwnPropertySymbols(capability).length || ObjectGetOwnPropertyNames(capability).length)
                return null;
            return getWeakMapValue(preparedWebSessionRecords, capability) ?? null;
        }
        catch {
            return null;
        }
    }
    function armedWebSessionCellRecord(port) {
        try {
            if (!port || typeof port !== 'object' || isProxy(port) || ObjectGetPrototypeOf(port) !== null)
                return null;
            if (ObjectGetOwnPropertySymbols(port).length || ObjectGetOwnPropertyNames(port).length)
                return null;
            return getWeakMapValue(armedWebSessionPortRecords, port) ?? null;
        }
        catch {
            return null;
        }
    }
    function activeWebSessionResourceRecord(port) {
        try {
            if (!port || typeof port !== 'object' || isProxy(port) || ObjectGetPrototypeOf(port) !== null)
                return null;
            if (ObjectGetOwnPropertySymbols(port).length || ObjectGetOwnPropertyNames(port).length)
                return null;
            return getWeakMapValue(activeWebSessionResourcePortRecords, port) ?? null;
        }
        catch {
            return null;
        }
    }
    function activeWebSessionResourceUseRecord(use) {
        try {
            if (!use || typeof use !== 'object' || isProxy(use) || ObjectGetPrototypeOf(use) !== null)
                return null;
            if (ObjectGetOwnPropertySymbols(use).length || ObjectGetOwnPropertyNames(use).length)
                return null;
            return getWeakMapValue(activeWebSessionResourceUseRecords, use) ?? null;
        }
        catch {
            return null;
        }
    }
    function takeActiveWebSessionPrivateResourceRegistration(registration) {
        let previous = null;
        let current = activeWebSessionPrivateResourceRegistrationHead;
        while (current) {
            if (current.registration === registration) {
                if (previous)
                    previous.next = current.next;
                else
                    activeWebSessionPrivateResourceRegistrationHead = current.next;
                current.next = null;
                return current;
            }
            previous = current;
            current = current.next;
        }
        return null;
    }
    function burnActiveWebSessionPrivateResourceRegistration(record) {
        const detached = takeActiveWebSessionPrivateResourceRegistration(record.registration) ?? record;
        detached.resource = null;
        detached.dispose = null;
        detached.next = null;
    }
    function activeWebSessionPrivateResourceIsCurrent(record) {
        if (!record.active || record.revoked || !record.cell || !record.session)
            return false;
        const cell = record.cell;
        const session = record.session;
        const sessionId = session.id;
        return !webSessionCellLifecyclePoisoned && !cell.resourcePortsRevoked
            && cell.state === 'ACTIVE' && cell.session === session
            && armedWebSessionCellsById[sessionId] === cell && session.id === sessionId && session.authChannel === 'web'
            && getMapValue(sessions, sessionId) === undefined && !hasMapValue(sessions, sessionId)
            && !webSessionCellLifecyclePoisoned;
    }
    function activeWebSessionPrivateResourceIsLiveAt(record, now) {
        return activeWebSessionPrivateResourceIsCurrent(record) && record.session.expiresAt > now;
    }
    function activeWebSessionResourceUseIsLive(record) {
        const owner = record.owner;
        const port = record.port;
        return record.active && owner !== null && port !== null && owner.active && !owner.revoked
            && getWeakMapValue(activeWebSessionResourcePortRecords, port) === owner
            && owner.cell === record.cell && owner.session === record.session
            && activeWebSessionResourceIsLive(owner);
    }
    function burnActiveWebSessionResourceUse(record) {
        if (!record.active)
            return false;
        record.active = false;
        return true;
    }
    function activeWebSessionResourceIsLive(record) {
        if (!record.active || record.revoked || !record.cell || !record.session)
            return false;
        const cell = record.cell;
        const session = record.session;
        const sessionId = session.id;
        const expiry = session.expiresAt;
        const now = DateNow();
        return !webSessionCellLifecyclePoisoned && !cell.resourcePortsRevoked
            && cell.state === 'ACTIVE' && cell.session === session
            && armedWebSessionCellsById[sessionId] === cell && session.id === sessionId && session.authChannel === 'web'
            && expiry > now && getMapValue(sessions, sessionId) === undefined;
    }
    function revokeActiveWebSessionResourceUses(record) {
        for (let use = record.useHead; use; use = use.next)
            use.active = false;
    }
    function revokeActiveWebSessionResourcePortsForCell(cell) {
        cell.resourcePortsRevoked = true;
        for (let resource = cell.resourcePortHead; resource; resource = resource.next) {
            resource.revoked = true;
            revokeActiveWebSessionResourceUses(resource);
        }
    }
    function releaseActiveWebSessionResourceRecord(record) {
        if (!record.active)
            return false;
        record.active = false;
        record.revoked = true;
        revokeActiveWebSessionResourceUses(record);
        return true;
    }
    function isWebServerSessionRetirementReason(value) {
        return value === 'lock' || value === 'dispose' || value === 'expired' || value === 'delete' || value === 'clear';
    }
    function tombstoneArmedWebSessionCellRecord(record) {
        if (record.state !== 'ARMED_ACTIVATE')
            return false;
        revokeActiveWebSessionResourcePortsForCell(record);
        record.activationTicket = null;
        record.retirement = null;
        record.state = 'TOMBSTONE';
        return true;
    }
    function retireArmedWebSessionCellRecord(record) {
        if (record.state !== 'ACTIVE' && record.state !== 'ARMED_RETIRE')
            return false;
        revokeActiveWebSessionResourcePortsForCell(record);
        record.state = 'RETIRED';
        return true;
    }
    function unlinkArmedWebSessionCellRecord(record) {
        let previous = null;
        let current = armedWebSessionCellHead;
        while (current && current !== record) {
            previous = current;
            current = current.next;
        }
        if (!current)
            return false;
        if (previous)
            previous.next = current.next;
        else
            armedWebSessionCellHead = current.next;
        current.next = null;
        return true;
    }
    function detachActiveWebSessionPrivateResourcesForCell(cell) {
        let detached = null;
        let previous = null;
        let current = activeWebSessionPrivateResourceRegistrationHead;
        while (current) {
            const next = current.next;
            if (current.resource?.cell === cell) {
                if (previous)
                    previous.next = next;
                else
                    activeWebSessionPrivateResourceRegistrationHead = next;
                current.next = detached;
                detached = current;
            }
            else
                previous = current;
            current = next;
        }
        return detached;
    }
    function ignorePrivateResourceCleanupRejection() { }
    function disposeDetachedActiveWebSessionPrivateResources(detached, reason) {
        let failed = false;
        while (detached) {
            const current = detached;
            detached = current.next;
            const dispose = current.dispose;
            current.next = null;
            current.resource = null;
            current.dispose = null;
            if (!dispose || !reason) {
                failed = true;
                continue;
            }
            try {
                const outcome = dispose(reason);
                if (outcome !== undefined) {
                    failed = true;
                    try {
                        applyIntrinsic(promiseThen, outcome, [undefined, ignorePrivateResourceCleanupRejection]);
                    }
                    catch { /* non-Promise and hostile outcomes stay opaque */ }
                }
            }
            catch {
                failed = true;
            }
        }
        return failed;
    }
    function compactRetiredWebSessionCellRecord(record, session) {
        let failed = !record.retirementCommitted;
        record.state = 'RETIRED_CLEANUP';
        record.cleanupReceipt = failedWebSessionRetirementCleanupReceipt;
        const detachedPrivateResources = detachActiveWebSessionPrivateResourcesForCell(record);
        record.resourcePortsRevoked = true;
        let resource = record.resourcePortHead;
        record.resourcePortHead = null;
        while (resource) {
            const nextResource = resource.next;
            let use = resource.useHead;
            resource.active = false;
            resource.revoked = true;
            resource.useHead = null;
            resource.next = null;
            while (use) {
                const nextUse = use.next;
                use.active = false;
                use.port = null;
                use.owner = null;
                use.cell = null;
                use.session = null;
                use.next = null;
                use = nextUse;
            }
            resource.cell = null;
            resource.session = null;
            resource = nextResource;
        }
        try {
            if (!deleteWeakMapValue(activeWebSessionCellsBySession, session))
                failed = true;
        }
        catch {
            failed = true;
        }
        if (!unlinkArmedWebSessionCellRecord(record) || webSessionCellLifecyclePoisoned)
            failed = true;
        record.session = retiredWebSessionSentinel;
        record.activationTicket = null;
        record.retirement = null;
        record.next = null;
        if (disposeDetachedActiveWebSessionPrivateResources(detachedPrivateResources, record.retirementReason))
            failed = true;
        if (webSessionCellLifecyclePoisoned)
            failed = true;
        record.cleanupReceipt = failed
            ? failedWebSessionRetirementCleanupReceipt
            : completedWebSessionRetirementCleanupReceipt;
        record.state = 'RETIRED_TOMBSTONE';
        return record.cleanupReceipt;
    }
    function denyNestedWebSessionCellInput(value) {
        const prepared = preparedWebSessionRecord(value);
        if (prepared)
            revokePreparedWebSession(prepared);
        const cell = armedWebSessionCellRecord(value);
        if (cell)
            tombstoneArmedWebSessionCellRecord(cell);
        const registration = takeActiveWebSessionPrivateResourceRegistration(value);
        if (registration)
            burnActiveWebSessionPrivateResourceRegistration(registration);
    }
    function beginWebSessionCellLifecycle(value) {
        if (webSessionCellLifecycle === 'idle') {
            webSessionCellLifecycle = 'active';
            webSessionCellLifecyclePoisoned = false;
            return true;
        }
        webSessionCellLifecyclePoisoned = true;
        if (webSessionCellLifecycle === 'active') {
            webSessionCellLifecycle = 'cleanup';
            try {
                denyNestedWebSessionCellInput(value);
            }
            catch { /* denial remains terminal */ }
            finally {
                webSessionCellLifecycle = 'active';
            }
        }
        return false;
    }
    function endWebSessionCellLifecycle() {
        webSessionCellLifecyclePoisoned = false;
        webSessionCellLifecycle = 'idle';
    }
    function poisonWebSessionCellLifecycle() {
        if (webSessionCellLifecycle !== 'idle')
            webSessionCellLifecyclePoisoned = true;
    }
    function tombstoneArmedWebSessionCellForId(sessionId) {
        poisonWebSessionCellLifecycle();
        const record = armedWebSessionCellsById[sessionId];
        if (record) {
            revokeActiveWebSessionResourcePortsForCell(record);
            tombstoneArmedWebSessionCellRecord(record);
        }
    }
    function tombstoneArmedWebSessionCellsForUser(userId) {
        poisonWebSessionCellLifecycle();
        for (let record = armedWebSessionCellHead; record; record = record.next) {
            if (record.session.userId === userId) {
                revokeActiveWebSessionResourcePortsForCell(record);
                tombstoneArmedWebSessionCellRecord(record);
            }
        }
    }
    function tombstoneAllArmedWebSessionCells() {
        poisonWebSessionCellLifecycle();
        for (let record = armedWebSessionCellHead; record; record = record.next) {
            revokeActiveWebSessionResourcePortsForCell(record);
            tombstoneArmedWebSessionCellRecord(record);
        }
    }
    function revokePreparedWebSession(record) {
        const wasActive = record.active;
        record.active = false;
        try {
            if (getMapValue(preparedWebSessionReservations, record.session.id) === record) {
                deleteMapValue(preparedWebSessionReservations, record.session.id);
            }
            return wasActive;
        }
        catch {
            return false;
        }
    }
    function revokePreparedWebSessionsForUser(userId) {
        const iterator = mapValuesOf(preparedWebSessionReservations);
        for (let next = nextMapIterator(iterator); !next.done; next = nextMapIterator(iterator)) {
            if (next.value.session.userId === userId)
                revokePreparedWebSession(next.value);
        }
    }
    function revokeAllPreparedWebSessions() {
        const iterator = mapValuesOf(preparedWebSessionReservations);
        for (let next = nextMapIterator(iterator); !next.done; next = nextMapIterator(iterator))
            revokePreparedWebSession(next.value);
    }
    function revokePreparedWebSessionForId(sessionId) {
        const record = getMapValue(preparedWebSessionReservations, sessionId);
        if (record)
            revokePreparedWebSession(record);
    }
    /** Stages only exact host-owned Web user data; the capsule has no observable session fields. */
    /* @Codex */
    function stageWebServerSession(user) {
        if (!isStrictWebSessionUser(user)) {
            poisonUserRetirementTurns();
            return null;
        }
        if (denyUserRetirementTurn(user.id))
            return null;
        let capsule = null;
        let record = null;
        try {
            const now = DateNow();
            capsule = ObjectFreeze(ObjectCreate(null));
            record = {
                active: true,
                userId: user.id,
                username: user.username,
                role: user.role,
                createdAt: now,
                expiresAt: now + SESSION_TTL_MS,
            };
            setWeakMapValue(stagedWebSessionRecords, capsule, record);
            addSetValue(stagedWebSessions, record);
            if (denyUserRetirementTurn(record.userId))
                throw new Error('session_retirement_in_progress');
            return capsule;
        }
        catch {
            if (record) {
                record.active = false;
                try {
                    deleteSetValue(stagedWebSessions, record);
                }
                catch { /* terminal record remains inactive */ }
            }
            if (capsule) {
                try {
                    deleteWeakMapValue(stagedWebSessionRecords, capsule);
                }
                catch { /* inactive record cannot recover */ }
            }
            return null;
        }
    }
    /** Consumes a staged Web capsule into one private, unpublishable Web-session reservation. */
    /* @Codex */
    function prepareStagedWebServerSession(capsule) {
        const record = stagedWebSessionRecord(capsule);
        if (record && denyUserRetirementTurn(record.userId))
            return null;
        if (webSessionPrepareInProgress) {
            webSessionPreparePoisoned = true;
            if (record)
                revokeStagedWebSession(record);
            return null;
        }
        webSessionPrepareInProgress = true;
        try {
            if (!record || !record.active)
                return null;
            if (record.expiresAt <= DateNow()) {
                revokeStagedWebSession(record);
                return null;
            }
            let preparedRecord = null;
            try {
                const bytes = applyIntrinsic(cryptoRandomBytes, crypto, [32]);
                const sessionId = applyIntrinsic(bufferToString, bytes, ['hex']);
                if (webSessionPreparePoisoned || !record.active || record.expiresAt <= DateNow()) {
                    revokeStagedWebSession(record);
                    return null;
                }
                if (getMapValue(sessions, sessionId) || getMapValue(preparedWebSessionReservations, sessionId)
                    || armedWebSessionCellsById[sessionId]) {
                    revokeStagedWebSession(record);
                    return null;
                }
                const capability = ObjectFreeze(ObjectCreate(null));
                preparedRecord = {
                    active: true,
                    session: {
                        id: sessionId,
                        userId: record.userId,
                        username: record.username,
                        role: record.role,
                        authChannel: 'web',
                        createdAt: record.createdAt,
                        expiresAt: record.expiresAt,
                    },
                };
                setWeakMapValue(preparedWebSessionRecords, capability, preparedRecord);
                setMapValue(preparedWebSessionReservations, sessionId, preparedRecord);
                if (!revokeStagedWebSession(record)) {
                    revokePreparedWebSession(preparedRecord);
                    return null;
                }
                return capability;
            }
            catch {
                if (preparedRecord)
                    revokePreparedWebSession(preparedRecord);
                revokeStagedWebSession(record);
                return null;
            }
        }
        finally {
            webSessionPrepareInProgress = false;
            webSessionPreparePoisoned = false;
        }
    }
    /** Returns only the reserved ID to the holder of the exact private capability. */
    /* @Codex */
    function getPreparedWebServerSessionId(capability) {
        const record = preparedWebSessionRecord(capability);
        if (!record || !record.active)
            return null;
        if (record.session.expiresAt <= DateNow() || getMapValue(preparedWebSessionReservations, record.session.id) !== record
            || getMapValue(sessions, record.session.id)) {
            revokePreparedWebSession(record);
            return null;
        }
        return record.session.id;
    }
    /** Burns one prepared capability into its final inert, non-resolvable session cell. */
    /* @Codex */
    function armPreparedWebServerSession(capability) {
        const prepared = preparedWebSessionRecord(capability);
        if (prepared && denyUserRetirementTurn(prepared.session.userId))
            return null;
        if (!beginWebSessionCellLifecycle(capability))
            return null;
        let cell = null;
        try {
            if (webSessionCellLifecyclePoisoned || !prepared || !prepared.active)
                return null;
            const session = prepared.session;
            if (session.expiresAt <= DateNow() || getMapValue(preparedWebSessionReservations, session.id) !== prepared
                || getMapValue(sessions, session.id) || armedWebSessionCellsById[session.id]) {
                revokePreparedWebSession(prepared);
                return null;
            }
            ObjectFreeze(session);
            const port = ObjectFreeze(ObjectCreate(null));
            cell = {
                state: 'ARMED_ACTIVATE', sessionId: session.id, session, next: armedWebSessionCellHead,
                activationTicket: null, retirement: null, retirementReason: null, cleanupReceipt: null,
                retirementCommitted: false, resourcePortsRevoked: false, resourcePortHead: null,
            };
            armedWebSessionCellHead = cell;
            armedWebSessionCellsById[session.id] = cell;
            setWeakMapValue(armedWebSessionPortRecords, port, cell);
            setWeakMapValue(activeWebSessionCellsBySession, session, cell);
            const burned = revokePreparedWebSession(prepared);
            if (webSessionCellLifecyclePoisoned || !burned) {
                tombstoneArmedWebSessionCellRecord(cell);
                return null;
            }
            return port;
        }
        catch {
            if (cell)
                tombstoneArmedWebSessionCellRecord(cell);
            const prepared = preparedWebSessionRecord(capability);
            if (prepared)
                revokePreparedWebSession(prepared);
            return null;
        }
        finally {
            endWebSessionCellLifecycle();
        }
    }
    /** Returns only the exact private ID of an authentic armed cell; it grants no session authority. */
    /* @Codex */
    function getArmedWebServerSessionId(port) {
        if (!beginWebSessionCellLifecycle(port))
            return null;
        try {
            const cell = armedWebSessionCellRecord(port);
            if (webSessionCellLifecyclePoisoned || !cell || cell.state !== 'ARMED_ACTIVATE'
                || armedWebSessionCellsById[cell.session.id] !== cell)
                return null;
            const session = cell.session;
            const sessionId = session.id;
            const now = DateNow();
            if (webSessionCellLifecyclePoisoned || cell.state !== 'ARMED_ACTIVATE' || cell.session !== session
                || session.id !== sessionId || armedWebSessionCellsById[sessionId] !== cell || session.expiresAt <= now) {
                tombstoneArmedWebSessionCellRecord(cell);
                return null;
            }
            return sessionId;
        }
        catch {
            return null;
        }
        finally {
            endWebSessionCellLifecycle();
        }
    }
    /** Converts an authentic armed cell to its terminal, non-reactivatable tombstone. */
    /* @Codex */
    function tombstoneArmedWebServerSession(port) {
        if (!beginWebSessionCellLifecycle(port))
            return false;
        try {
            const cell = armedWebSessionCellRecord(port);
            if (webSessionCellLifecyclePoisoned || !cell || armedWebSessionCellsById[cell.session.id] !== cell)
                return false;
            return tombstoneArmedWebSessionCellRecord(cell);
        }
        catch {
            return false;
        }
        finally {
            endWebSessionCellLifecycle();
        }
    }
    /** Atomically splices one exact P2 CAS into its already-installed inert P3 cell. */
    /* @Codex */
    function activateArmedWebServerSession(port, ticket) {
        const sessionId = getArmedWebServerSessionId(port);
        const activationCell = armedWebSessionCellRecord(port);
        if (activationCell && denyUserRetirementTurn(activationCell.session.userId))
            return false;
        const preparedActivation = prepareAuthControlActivation(ticket, sessionId);
        if (!sessionId || !preparedActivation) {
            tombstoneArmedWebServerSession(port);
            return false;
        }
        if (!beginWebSessionCellLifecycle(port)) {
            const deniedCell = armedWebSessionCellRecord(port);
            if (deniedCell)
                tombstoneArmedWebSessionCellRecord(deniedCell);
            abortPreparedAuthControlActivation(preparedActivation);
            return false;
        }
        let cell = null;
        try {
            cell = armedWebSessionCellRecord(port);
            const session = cell?.session ?? null;
            const visibleSession = getMapValue(sessions, sessionId);
            const now = DateNow();
            if (webSessionCellLifecyclePoisoned || !cell || cell.state !== 'ARMED_ACTIVATE'
                || armedWebSessionCellsById[sessionId] !== cell || !session || cell.session !== session
                || session.id !== sessionId || session.authChannel !== 'web' || session.expiresAt <= now || visibleSession) {
                if (cell)
                    cell.state = 'TOMBSTONE';
                abortPreparedAuthControlActivation(preparedActivation);
                webSessionCellLifecyclePoisoned = false;
                webSessionCellLifecycle = 'idle';
                return false;
            }
            cell.activationTicket = ticket;
            if (denyUserRetirementTurn(session.userId)) {
                cell.state = 'TOMBSTONE';
                cell.activationTicket = null;
                abortPreparedAuthControlActivation(preparedActivation);
                webSessionCellLifecyclePoisoned = false;
                webSessionCellLifecycle = 'idle';
                return false;
            }
        }
        catch {
            if (cell)
                tombstoneArmedWebSessionCellRecord(cell);
            try {
                abortPreparedAuthControlActivation(preparedActivation);
            }
            catch { /* prepared P2 denial stays terminal */ }
            webSessionCellLifecyclePoisoned = false;
            webSessionCellLifecycle = 'idle';
            return false;
        }
        if (commitPreparedAuthControlActivation(preparedActivation) === 1) {
            cell.state = 'ACTIVE';
            webSessionCellLifecyclePoisoned = false;
            webSessionCellLifecycle = 'idle';
            return true;
        }
        cell.activationTicket = null;
        cell.retirement = null;
        cell.state = 'TOMBSTONE';
        webSessionCellLifecyclePoisoned = false;
        webSessionCellLifecycle = 'idle';
        return false;
    }
    function retireActiveWebServerSessionCell(cell, reason, observation = null) {
        const sessionId = cell.sessionId;
        if (armedWebSessionCellsById[sessionId] !== cell || cell.state !== 'ACTIVE'
            || cell.session.id !== sessionId || !cell.activationTicket)
            return false;
        const session = cell.session;
        const ticket = cell.activationTicket;
        cell.retirementReason = reason;
        const preparedRetirement = prepareAuthControlRetirement(ticket, sessionId, reason);
        if (!preparedRetirement) {
            if (cell.state === 'ACTIVE' && armedWebSessionCellsById[sessionId] === cell && cell.session === session) {
                retireArmedWebSessionCellRecord(cell);
            }
            return false;
        }
        if (!beginWebSessionCellLifecycle(sessionId)) {
            if (cell.state === 'ACTIVE' && armedWebSessionCellsById[sessionId] === cell && cell.session === session) {
                retireArmedWebSessionCellRecord(cell);
            }
            abortPreparedAuthControlRetirement(preparedRetirement);
            return false;
        }
        try {
            const now = observation ? observation.now : DateNow();
            const exact = armedWebSessionCellsById[sessionId] === cell && cell.state === 'ACTIVE'
                && cell.session === session && cell.activationTicket === ticket && session.id === sessionId
                && session.authChannel === 'web'
                && (!observation || (reason === 'expired' && session.expiresAt === observation.expiresAt))
                && (reason === 'expired' ? session.expiresAt <= now : session.expiresAt > now);
            if (webSessionCellLifecyclePoisoned || !exact) {
                retireArmedWebSessionCellRecord(cell);
                abortPreparedAuthControlRetirement(preparedRetirement);
                webSessionCellLifecyclePoisoned = false;
                webSessionCellLifecycle = 'idle';
                return false;
            }
            cell.retirement = preparedRetirement;
            cell.state = 'ARMED_RETIRE';
            if (webSessionCellLifecyclePoisoned || armedWebSessionCellsById[sessionId] !== cell
                || cell.state !== 'ARMED_RETIRE' || cell.session !== session || cell.activationTicket !== ticket) {
                cell.state = 'RETIRED';
                abortPreparedAuthControlRetirement(preparedRetirement);
                cell.retirement = null;
                webSessionCellLifecyclePoisoned = false;
                webSessionCellLifecycle = 'idle';
                return false;
            }
        }
        catch {
            if (cell.state === 'ACTIVE' || cell.state === 'ARMED_RETIRE')
                cell.state = 'RETIRED';
            try {
                abortPreparedAuthControlRetirement(preparedRetirement);
            }
            catch { /* terminal denial remains */ }
            cell.retirement = null;
            webSessionCellLifecyclePoisoned = false;
            webSessionCellLifecycle = 'idle';
            return false;
        }
        const retirementResult = commitPreparedAuthControlRetirement(preparedRetirement);
        if (retirementResult === 2) {
            cell.retirementCommitted = true;
            cell.state = 'RETIRED';
            webSessionCellLifecyclePoisoned = false;
            webSessionCellLifecycle = 'idle';
            return true;
        }
        cell.state = 'RETIRED';
        webSessionCellLifecyclePoisoned = false;
        webSessionCellLifecycle = 'idle';
        return false;
    }
    /** Retires one exact ACTIVE Web cell through its privately retained P2 ticket. */
    /* @Codex */
    function retireActiveWebServerSession(sessionId, reason) {
        if (typeof sessionId !== 'string' || !sessionId || !isWebServerSessionRetirementReason(reason))
            return false;
        const cell = armedWebSessionCellsById[sessionId];
        return cell ? retireActiveWebServerSessionCell(cell, reason) : false;
    }
    function commitPreparedWebServerSessionInternally(capability, returnSession) {
        const deniedResult = returnSession ? null : false;
        const record = preparedWebSessionRecord(capability);
        if (record && denyUserRetirementTurn(record.session.userId))
            return deniedResult;
        if (!record || !record.active)
            return deniedResult;
        let publicationAttempted = false;
        try {
            const session = record.session;
            if (record.session.expiresAt <= DateNow() || getMapValue(preparedWebSessionReservations, record.session.id) !== record
                || getMapValue(sessions, record.session.id)) {
                revokePreparedWebSession(record);
                return deniedResult;
            }
            const terminalResult = returnSession ? session : true;
            record.active = false;
            deleteMapValue(preparedWebSessionReservations, record.session.id);
            publicationAttempted = true;
            setMapValue(sessions, session.id, session);
            if (denyUserRetirementTurn(session.userId))
                throw new Error('session_retirement_in_progress');
            return terminalResult;
        }
        catch {
            if (publicationAttempted)
                rollbackSessionPublication(record.session);
            revokePreparedWebSession(record);
            return deniedResult;
        }
    }
    /** Commits a prepared Web session once without exposing session authority. */
    /* @Codex */
    function commitPreparedWebServerSession(capability) {
        return commitPreparedWebServerSessionInternally(capability, false);
    }
    /** Aborts a private prepared Web-session reservation without publication. */
    /* @Codex */
    function abortPreparedWebServerSession(capability) {
        const record = preparedWebSessionRecord(capability);
        return Boolean(record && revokePreparedWebSession(record));
    }
    /** Compatibility wrapper for callers that do not need an external terminal turn. */
    /* @Codex */
    function activateStagedWebServerSession(capsule) {
        const capability = prepareStagedWebServerSession(capsule);
        return capability ? commitPreparedWebServerSessionInternally(capability, true) : null;
    }
    /** Aborts a pending Web session without ever publishing it. */
    /* @Codex */
    function abortStagedWebServerSession(capsule) {
        const record = stagedWebSessionRecord(capsule);
        return Boolean(record && revokeStagedWebSession(record));
    }
    /** Resolves only one exact ACTIVE P3 Web cell without publishing it to the legacy session map. */
    /* @Codex */
    function resolveActiveWebServerSession(sessionId) {
        if (!beginWebSessionCellLifecycle(sessionId))
            return null;
        let expired = null;
        try {
            if (typeof sessionId !== 'string' || !sessionId)
                return null;
            const cell = armedWebSessionCellsById[sessionId];
            if (webSessionCellLifecyclePoisoned || !cell || cell.state !== 'ACTIVE')
                return null;
            const session = cell.session;
            const expiry = session.expiresAt;
            const now = DateNow();
            if (webSessionCellLifecyclePoisoned || armedWebSessionCellsById[sessionId] !== cell
                || cell.state !== 'ACTIVE' || cell.session !== session || session.id !== sessionId
                || session.authChannel !== 'web' || session.expiresAt !== expiry)
                return null;
            if (expiry <= now) {
                expired = { cell, expiresAt: expiry, now };
                return null;
            }
            const finalVisibleSession = getMapValue(sessions, sessionId);
            const finalVisibleSessionPresent = hasMapValue(sessions, sessionId);
            if (webSessionCellLifecyclePoisoned || finalVisibleSession || finalVisibleSessionPresent
                || armedWebSessionCellsById[sessionId] !== cell
                || cell.state !== 'ACTIVE' || cell.session !== session || session.id !== sessionId
                || session.authChannel !== 'web' || session.expiresAt !== expiry)
                return null;
            return session;
        }
        catch {
            return null;
        }
        finally {
            endWebSessionCellLifecycle();
            if (expired) {
                try {
                    dispatchActiveWebServerSessionCellRetirement(expired.cell, 'expired', expired);
                }
                catch { /* expiry denial remains fail-closed */ }
            }
        }
    }
    /** Mints one opaque resource identity for the exact process-local ACTIVE Web session. */
    /* @Codex */
    function mintActiveWebSessionResourcePort(session) {
        if (!beginWebSessionCellLifecycle(session))
            return null;
        let record = null;
        try {
            if (!session || typeof session !== 'object' || isProxy(session))
                return null;
            const cell = getWeakMapValue(activeWebSessionCellsBySession, session);
            if (webSessionCellLifecyclePoisoned || !cell || cell.state !== 'ACTIVE' || cell.session !== session)
                return null;
            const exactSession = cell.session;
            const sessionId = exactSession.id;
            const expiry = exactSession.expiresAt;
            const now = DateNow();
            if (webSessionCellLifecyclePoisoned || cell.state !== 'ACTIVE' || cell.resourcePortsRevoked || cell.session !== exactSession
                || armedWebSessionCellsById[sessionId] !== cell || exactSession.id !== sessionId
                || exactSession.authChannel !== 'web' || exactSession.expiresAt !== expiry || expiry <= now
                || getMapValue(sessions, sessionId))
                return null;
            const port = ObjectFreeze(ObjectCreate(null));
            record = {
                active: true, revoked: false, cell, session: exactSession,
                next: cell.resourcePortHead, useHead: null,
            };
            cell.resourcePortHead = record;
            setWeakMapValue(activeWebSessionResourcePortRecords, port, record);
            if (webSessionCellLifecyclePoisoned || cell.state !== 'ACTIVE' || cell.resourcePortsRevoked || cell.session !== exactSession
                || armedWebSessionCellsById[sessionId] !== cell || exactSession.expiresAt !== expiry
                || getMapValue(sessions, sessionId)) {
                releaseActiveWebSessionResourceRecord(record);
                return null;
            }
            return port;
        }
        catch {
            if (record)
                releaseActiveWebSessionResourceRecord(record);
            return null;
        }
        finally {
            endWebSessionCellLifecycle();
        }
    }
    /** Releases one exact resource identity without invoking consumer code. */
    /* @Codex */
    function releaseActiveWebSessionResourcePort(port) {
        if (!beginWebSessionCellLifecycle(port))
            return false;
        try {
            const record = activeWebSessionResourceRecord(port);
            if (webSessionCellLifecyclePoisoned || !record || !record.active)
                return false;
            return releaseActiveWebSessionResourceRecord(record);
        }
        catch {
            return false;
        }
        finally {
            endWebSessionCellLifecycle();
        }
    }
    /** Begins one opaque, process-local resource use for the exact active port. */
    /* @Codex */
    function beginActiveWebSessionResourceUse(port) {
        if (!beginWebSessionCellLifecycle(port))
            return null;
        let record = null;
        try {
            const owner = activeWebSessionResourceRecord(port);
            if (webSessionCellLifecyclePoisoned || !owner || !activeWebSessionResourceIsLive(owner))
                return null;
            const use = ObjectFreeze(ObjectCreate(null));
            record = {
                active: true, port: port, owner,
                cell: owner.cell, session: owner.session, next: owner.useHead,
            };
            owner.useHead = record;
            setWeakMapValue(activeWebSessionResourceUseRecords, use, record);
            if (webSessionCellLifecyclePoisoned || !activeWebSessionResourceIsLive(owner)) {
                burnActiveWebSessionResourceUse(record);
                return null;
            }
            return use;
        }
        catch {
            if (record)
                burnActiveWebSessionResourceUse(record);
            return null;
        }
        finally {
            endWebSessionCellLifecycle();
        }
    }
    function finishActiveWebSessionResourceUse(use) {
        if (!beginWebSessionCellLifecycle(use))
            return false;
        let record = null;
        try {
            record = activeWebSessionResourceUseRecord(use);
            if (!record || webSessionCellLifecyclePoisoned || !activeWebSessionResourceUseIsLive(record)) {
                if (record)
                    burnActiveWebSessionResourceUse(record);
                return false;
            }
            return burnActiveWebSessionResourceUse(record);
        }
        catch {
            if (record)
                burnActiveWebSessionResourceUse(record);
            return false;
        }
        finally {
            endWebSessionCellLifecycle();
        }
    }
    /** Commits one exact use; consumers publish staged effects only after true. */
    /* @Codex */
    function commitActiveWebSessionResourceUse(use) {
        return finishActiveWebSessionResourceUse(use);
    }
    /** Aborts one exact use without invoking consumer code. */
    /* @Codex */
    function abortActiveWebSessionResourceUse(use) {
        return finishActiveWebSessionResourceUse(use);
    }
    /** Registers one opaque, one-use cleanup against an exact ACTIVE Web resource port. */
    /* @Codex */
    function registerActiveWebSessionPrivateResource(port, dispose) {
        if (!beginWebSessionCellLifecycle(port))
            return null;
        let record = null;
        let expired = null;
        try {
            if (webSessionCellLifecyclePoisoned || !isSupportedPrivateResourceDisposer(dispose))
                return null;
            const resource = activeWebSessionResourceRecord(port);
            const now = readPrivateResourceClock();
            if (!resource || now === null || !activeWebSessionPrivateResourceIsCurrent(resource))
                return null;
            const cell = resource.cell;
            const session = resource.session;
            const expiry = session.expiresAt;
            if (expiry <= now) {
                expired = { cell, expiresAt: expiry, now };
                return null;
            }
            const registration = ObjectFreeze(ObjectCreate(null));
            record = { registration, resource, dispose, next: activeWebSessionPrivateResourceRegistrationHead };
            activeWebSessionPrivateResourceRegistrationHead = record;
            const finalNow = readPrivateResourceClock();
            if (finalNow === null || webSessionCellLifecyclePoisoned || record.resource !== resource
                || record.dispose !== dispose || !activeWebSessionPrivateResourceIsLiveAt(resource, finalNow)) {
                if (finalNow !== null && !webSessionCellLifecyclePoisoned && activeWebSessionPrivateResourceIsCurrent(resource)
                    && expiry <= finalNow)
                    expired = { cell, expiresAt: expiry, now: finalNow };
                burnActiveWebSessionPrivateResourceRegistration(record);
                return null;
            }
            return registration;
        }
        catch {
            if (record)
                burnActiveWebSessionPrivateResourceRegistration(record);
            return null;
        }
        finally {
            endWebSessionCellLifecycle();
            if (expired) {
                try {
                    dispatchActiveWebServerSessionCellRetirement(expired.cell, 'expired', expired);
                }
                catch { /* expiry denial remains fail-closed */ }
            }
        }
    }
    /** Burns one exact cleanup registration without invoking consumer code. */
    /* @Codex */
    function unregisterActiveWebSessionPrivateResource(port, registration) {
        if (!beginWebSessionCellLifecycle(registration))
            return false;
        const record = takeActiveWebSessionPrivateResourceRegistration(registration);
        const resource = record?.resource ?? null;
        if (record) {
            record.resource = null;
            record.dispose = null;
            record.next = null;
        }
        try {
            return !!(record && resource && !webSessionCellLifecyclePoisoned
                && activeWebSessionResourceRecord(port) === resource && activeWebSessionPrivateResourceIsCurrent(resource)
                && !webSessionCellLifecyclePoisoned);
        }
        catch {
            return false;
        }
        finally {
            endWebSessionCellLifecycle();
        }
    }
    function getSession(sessionId) {
        if (!sessionId)
            return null;
        const session = getMapValue(sessions, sessionId);
        if (!session)
            return null;
        const now = DateNow();
        if (session.expiresAt <= now) {
            terminateSession(sessionId, 'session_expired');
            return null;
        }
        // Sliding expiration on access
        session.expiresAt = now + SESSION_TTL_MS;
        setMapValue(sessions, sessionId, session);
        return session;
    }
    /* @Codex */
    function peekSession(sessionId) {
        if (!sessionId)
            return null;
        const session = getMapValue(sessions, sessionId);
        if (!session)
            return null;
        if (session.expiresAt <= DateNow()) {
            terminateSession(sessionId, 'session_expired');
            return null;
        }
        return session;
    }
    function deleteSession(sessionId) {
        if (!sessionId)
            return;
        tombstoneArmedWebSessionCellForId(sessionId);
        revokePreparedWebSessionForId(sessionId);
        terminateSession(sessionId, 'session_deleted');
    }
    /* @Codex: WUL-522 application lock keeps deletion and cleanup in one server-only primitive. */
    function invalidateServerSessionForApplicationLock(sessionId) {
        tombstoneArmedWebSessionCellForId(sessionId);
        revokePreparedWebSessionForId(sessionId);
        return terminateSession(sessionId, 'application_locked');
    }
    /* @Codex */
    function invalidateSessionsForUser(userId) {
        if (!userId)
            return;
        tombstoneArmedWebSessionCellsForUser(userId);
        revokeStagedWebSessionsForUser(userId);
        revokePreparedWebSessionsForUser(userId);
        const sessionIds = [];
        const iterator = mapValuesOf(sessions);
        for (let next = nextMapIterator(iterator); !next.done; next = nextMapIterator(iterator)) {
            if (next.value.userId === userId)
                appendArrayValue(sessionIds, next.value.id);
        }
        for (let index = 0; index < sessionIds.length; index += 1) {
            deleteSession(sessionIds[index]);
        }
    }
    /** Prepares the native/system half of the fixed administrative reset.
     * The capability owns only server-marked native/system authority. */
    /* @Codex */
    function prepareNativeSystemAdminReset() {
        return prepareNativeSystemSessionOperation('admin_reset', null);
    }
    /** Commits one exact prepared native/system administrative reset. */
    /* @Codex */
    function commitNativeSystemAdminReset(capability) {
        return commitNativeSystemSessionOperation(capability, 'admin_reset');
    }
    /** Burns one exact prepared native/system reset without changing sessions. */
    /* @Codex */
    function abortNativeSystemAdminReset(capability) {
        return abortNativeSystemSessionOperation(capability, 'admin_reset');
    }
    /** Prepares native authority retirement for one user and snapshots only inert legacy-Web cleanup. */
    /* @Codex */
    function prepareNativeLegacyUserRetirement(userId) {
        if (typeof userId !== 'string' || !userId)
            return null;
        return prepareNativeSystemSessionOperation('user_retirement', userId);
    }
    /** Prepares PIN retirement from exact live native authority, never from a caller userId. */
    /* @Codex */
    function preparePairedNativePinRetirement(session) {
        if (!isExactStoredSession(session) || session.authChannel !== 'native'
            || peekSession(session.id) !== session)
            return null;
        const binding = getWeakMapValue(nativeSessionBindings, session);
        if (!binding?.tokenHash || !isPairedNativeServerSession(session, binding))
            return null;
        const capability = prepareNativeLegacyUserRetirement(session.userId);
        if (!capability)
            return null;
        setWeakMapValue(nativePinRetirementProofs, capability, { session, binding, claimed: false });
        return capability;
    }
    /* @Codex: private fixed-purpose bridge; never exposed on the package root. */
    function claimPreparedNativePinRetirement(capability) {
        const operation = nativeSystemSessionOperationRecord(capability, 'user_retirement');
        if (!operation || operation.state !== 'prepared' || !capability || typeof capability !== 'object')
            return null;
        const proof = getWeakMapValue(nativePinRetirementProofs, capability);
        if (!proof || proof.claimed)
            return null;
        proof.claimed = true;
        if (operation.userId !== proof.session.userId || peekSession(proof.session.id) !== proof.session
            || getWeakMapValue(nativeSessionBindings, proof.session) !== proof.binding
            || !isPairedNativeServerSession(proof.session, proof.binding))
            return null;
        return operation.userId;
    }
    /** Commits the exact native authority retirement and inert legacy-Web cleanup prepared for one user. */
    /* @Codex */
    function commitNativeLegacyUserRetirement(capability) {
        return commitNativeSystemSessionOperation(capability, 'user_retirement');
    }
    /** Burns one exact prepared per-user native retirement without changing sessions. */
    /* @Codex */
    function abortNativeLegacyUserRetirement(capability) {
        return abortNativeSystemSessionOperation(capability, 'user_retirement');
    }
    /* @Codex */
    function clearAllSessions() {
        tombstoneAllArmedWebSessionCells();
        revokeAllStagedWebSessions();
        revokeAllPreparedWebSessions();
        const sessionIds = [];
        const sessionSnapshots = new MapConstructor();
        const sessionIterator = mapKeysOf(sessions);
        for (let next = nextMapIterator(sessionIterator); !next.done; next = nextMapIterator(sessionIterator)) {
            appendArrayValue(sessionIds, next.value);
            const session = getMapValue(sessions, next.value);
            if (session)
                setMapValue(sessionSnapshots, next.value, session);
        }
        const resourceIterator = mapKeysOf(sessionResources);
        for (let next = nextMapIterator(resourceIterator); !next.done; next = nextMapIterator(resourceIterator)) {
            const sessionId = next.value;
            let known = false;
            for (let index = 0; index < sessionIds.length; index += 1) {
                if (sessionIds[index] === sessionId) {
                    known = true;
                    break;
                }
            }
            if (!known)
                appendArrayValue(sessionIds, sessionId);
        }
        clearMap(sessions);
        for (let index = 0; index < sessionIds.length; index += 1) {
            completeSessionTermination(sessionIds[index], getMapValue(sessionSnapshots, sessionIds[index]) ?? null, 'sessions_cleared');
        }
    }
    function retireServerSessionForFixedCause(sessionId, webReason, legacyReason, requireExpired) {
        if (typeof sessionId !== 'string' || !sessionId)
            return deniedWebSessionRetirementCleanupReceipt;
        // P3 ownership is authoritative even when a legacy Map entry collides with it.
        if (armedWebSessionCellsById[sessionId]) {
            return dispatchActiveWebServerSessionRetirement(sessionId, webReason);
        }
        try {
            const session = getMapValue(sessions, sessionId);
            if (!session)
                return deniedWebSessionRetirementCleanupReceipt;
            if (session.authChannel === 'system')
                return deniedWebSessionRetirementCleanupReceipt;
            if (requireExpired) {
                const now = DateNow();
                if (getMapValue(sessions, sessionId) !== session || session.expiresAt > now) {
                    return deniedWebSessionRetirementCleanupReceipt;
                }
            }
            const result = terminateSession(sessionId, legacyReason);
            if (!result.authorityAbsent || result.cleanupOutcome === 'failed') {
                return failedWebSessionRetirementCleanupReceipt;
            }
            return result.cleanupOutcome === 'completed'
                ? completedWebSessionRetirementCleanupReceipt
                : deniedWebSessionRetirementCleanupReceipt;
        }
        catch {
            return failedWebSessionRetirementCleanupReceipt;
        }
    }
    /** Retires one exact Web or legacy session for a server-owned logout/delete cause. */
    /* @Codex */
    function retireServerSessionForLogout(sessionId) {
        return retireServerSessionForFixedCause(sessionId, 'delete', 'session_deleted', false);
    }
    /** Retires one exact Web or legacy session for a server-owned lock/dispose cause. */
    /* @Codex */
    function retireServerSessionForApplicationLock(sessionId) {
        return retireServerSessionForFixedCause(sessionId, 'lock', 'application_locked', false);
    }
    /** Retires one exact Web or legacy session only after server-owned expiry observation. */
    /* @Codex */
    function retireExpiredServerSession(sessionId) {
        return retireServerSessionForFixedCause(sessionId, 'expired', 'session_expired', true);
    }
    function worseWebServerSessionRetirementOutcome(current, next) {
        if (current === 'failed' || next === 'failed')
            return 'failed';
        if (current === 'denied' || next === 'denied')
            return 'denied';
        return 'completed';
    }
    function retireLegacyServerSessionForUser(sessionId, userId) {
        try {
            // A P3 cell or a changed channel/user wins over a stale legacy snapshot.
            if (armedWebSessionCellsById[sessionId])
                return deniedWebSessionRetirementCleanupReceipt;
            const current = getMapValue(sessions, sessionId);
            if (current && (current.userId !== userId || (current.authChannel !== 'web' && current.authChannel !== 'native'))) {
                return deniedWebSessionRetirementCleanupReceipt;
            }
            // Preserve deleteSession semantics while retaining the cleanup outcome for aggregation.
            tombstoneArmedWebSessionCellForId(sessionId);
            revokePreparedWebSessionForId(sessionId);
            const result = terminateSession(sessionId, 'session_deleted');
            if (!result.authorityAbsent || result.cleanupOutcome === 'failed') {
                return failedWebSessionRetirementCleanupReceipt;
            }
            return result.cleanupOutcome === 'completed'
                ? completedWebSessionRetirementCleanupReceipt
                : deniedWebSessionRetirementCleanupReceipt;
        }
        catch {
            return failedWebSessionRetirementCleanupReceipt;
        }
    }
    /** Retires every exact P3 and legacy Web/native session owned by one canonical user.
     * The receipt is an outcome value for this invocation; no operation record is retained. */
    /* @Codex */
    function retireServerSessionsForUser(userId) {
        if (typeof userId !== 'string' || !userId)
            return deniedWebSessionRetirementCleanupReceipt;
        const turn = beginUserRetirementTurn(userId);
        if (!turn)
            return deniedWebSessionRetirementCleanupReceipt;
        const p3Targets = [];
        const legacySessionIds = [];
        try {
            // Snapshot both registries before any retirement, cleanup, revocation, or unlink mutation.
            for (let record = armedWebSessionCellHead; record;) {
                const next = record.next;
                const isTarget = (record.state === 'ARMED_ACTIVATE' || record.state === 'ACTIVE' || record.state === 'RETIRED')
                    && armedWebSessionCellsById[record.sessionId] === record
                    && record.session.id === record.sessionId
                    && record.session.userId === userId
                    && record.session.authChannel === 'web';
                if (isTarget) {
                    let duplicate = false;
                    for (let index = 0; index < p3Targets.length; index += 1) {
                        if (p3Targets[index].sessionId === record.sessionId) {
                            duplicate = true;
                            break;
                        }
                    }
                    if (!duplicate) {
                        const reason = record.state === 'RETIRED' && record.retirementReason
                            ? record.retirementReason
                            : 'delete';
                        appendArrayValue(p3Targets, { cell: record, sessionId: record.sessionId, state: record.state, reason });
                    }
                }
                record = next;
            }
            const legacyIterator = mapValuesOf(sessions);
            for (let next = nextMapIterator(legacyIterator); !next.done; next = nextMapIterator(legacyIterator)) {
                if (next.value.userId !== userId || (next.value.authChannel !== 'web' && next.value.authChannel !== 'native'))
                    continue;
                // P3 identity is authoritative even when a legacy Map entry collides with it.
                if (armedWebSessionCellsById[next.value.id])
                    continue;
                let duplicate = false;
                for (let index = 0; index < legacySessionIds.length; index += 1) {
                    if (legacySessionIds[index] === next.value.id) {
                        duplicate = true;
                        break;
                    }
                }
                if (!duplicate)
                    appendArrayValue(legacySessionIds, next.value.id);
            }
            let outcome = 'completed';
            for (let index = 0; index < p3Targets.length; index += 1) {
                const target = p3Targets[index];
                let receipt;
                try {
                    const current = armedWebSessionCellsById[target.sessionId];
                    if (current !== target.cell || current.state !== target.state) {
                        receipt = deniedWebSessionRetirementCleanupReceipt;
                    }
                    else if (target.state === 'ARMED_ACTIVATE') {
                        receipt = tombstoneArmedWebSessionCellRecord(current)
                            ? completedWebSessionRetirementCleanupReceipt
                            : deniedWebSessionRetirementCleanupReceipt;
                    }
                    else {
                        receipt = target.reason === 'delete'
                            ? retireServerSessionForLogout(target.sessionId)
                            : dispatchActiveWebServerSessionRetirement(target.sessionId, target.reason);
                    }
                }
                catch {
                    receipt = failedWebSessionRetirementCleanupReceipt;
                }
                outcome = worseWebServerSessionRetirementOutcome(outcome, receipt.outcome);
            }
            try {
                revokeStagedWebSessionsForUser(userId);
            }
            catch {
                outcome = 'failed';
            }
            try {
                revokePreparedWebSessionsForUser(userId);
            }
            catch {
                outcome = 'failed';
            }
            for (let index = 0; index < legacySessionIds.length; index += 1) {
                const receipt = retireLegacyServerSessionForUser(legacySessionIds[index], userId);
                outcome = worseWebServerSessionRetirementOutcome(outcome, receipt.outcome);
            }
            // Do not report completion if reentrant cleanup introduced a matching armed authority.
            for (let record = armedWebSessionCellHead; record; record = record.next) {
                if (record.state === 'ARMED_ACTIVATE' && armedWebSessionCellsById[record.sessionId] === record
                    && record.session.id === record.sessionId && record.session.userId === userId
                    && record.session.authChannel === 'web') {
                    outcome = worseWebServerSessionRetirementOutcome(outcome, 'denied');
                    break;
                }
            }
            const finalOutcome = turn.poisoned
                ? worseWebServerSessionRetirementOutcome(outcome, 'denied')
                : outcome;
            return finalOutcome === 'failed'
                ? failedWebSessionRetirementCleanupReceipt
                : finalOutcome === 'denied'
                    ? deniedWebSessionRetirementCleanupReceipt
                    : completedWebSessionRetirementCleanupReceipt;
        }
        finally {
            endUserRetirementTurn(userId, turn);
        }
    }
    /** Retires only one user's P3 Web authority and its uncommitted P3 Web work. */
    /* @Codex */
    function retireWebP3SessionsForUser(userId) {
        if (typeof userId !== 'string' || !userId)
            return deniedWebSessionRetirementCleanupReceipt;
        const turn = beginUserRetirementTurn(userId);
        if (!turn)
            return deniedWebSessionRetirementCleanupReceipt;
        const targets = [];
        try {
            // This registry contains only P3 cells. Do not enumerate the legacy session map here.
            for (let record = armedWebSessionCellHead; record;) {
                const next = record.next;
                const isTarget = (record.state === 'ARMED_ACTIVATE' || record.state === 'ACTIVE' || record.state === 'RETIRED')
                    && armedWebSessionCellsById[record.sessionId] === record
                    && record.session.id === record.sessionId
                    && record.session.userId === userId
                    && record.session.authChannel === 'web';
                if (isTarget) {
                    const reason = record.state === 'RETIRED' && record.retirementReason
                        ? record.retirementReason
                        : 'delete';
                    appendArrayValue(targets, { cell: record, sessionId: record.sessionId, state: record.state, reason });
                }
                record = next;
            }
            let outcome = 'completed';
            for (let index = 0; index < targets.length; index += 1) {
                const target = targets[index];
                let receipt;
                try {
                    const current = armedWebSessionCellsById[target.sessionId];
                    if (current !== target.cell || current.state !== target.state) {
                        receipt = deniedWebSessionRetirementCleanupReceipt;
                    }
                    else if (target.state === 'ARMED_ACTIVATE') {
                        receipt = tombstoneArmedWebSessionCellRecord(current)
                            ? completedWebSessionRetirementCleanupReceipt
                            : deniedWebSessionRetirementCleanupReceipt;
                    }
                    else {
                        receipt = dispatchActiveWebServerSessionRetirement(target.sessionId, target.reason);
                    }
                }
                catch {
                    receipt = failedWebSessionRetirementCleanupReceipt;
                }
                outcome = worseWebServerSessionRetirementOutcome(outcome, receipt.outcome);
            }
            try {
                revokeStagedWebSessionsForUser(userId);
            }
            catch {
                outcome = 'failed';
            }
            try {
                revokePreparedWebSessionsForUser(userId);
            }
            catch {
                outcome = 'failed';
            }
            // A same-user P3 authority that appears during cleanup keeps this invocation fail-closed.
            for (let record = armedWebSessionCellHead; record; record = record.next) {
                if ((record.state === 'ARMED_ACTIVATE' || record.state === 'ACTIVE')
                    && armedWebSessionCellsById[record.sessionId] === record
                    && record.session.id === record.sessionId && record.session.userId === userId
                    && record.session.authChannel === 'web') {
                    outcome = worseWebServerSessionRetirementOutcome(outcome, 'denied');
                    break;
                }
            }
            const stagedIterator = applyIntrinsic(setValues, stagedWebSessions, []);
            for (let next = nextSetIterator(stagedIterator); !next.done; next = nextSetIterator(stagedIterator)) {
                if (next.value.active && next.value.userId === userId) {
                    outcome = worseWebServerSessionRetirementOutcome(outcome, 'denied');
                    break;
                }
            }
            const preparedIterator = mapValuesOf(preparedWebSessionReservations);
            for (let next = nextMapIterator(preparedIterator); !next.done; next = nextMapIterator(preparedIterator)) {
                if (next.value.active && next.value.session.userId === userId) {
                    outcome = worseWebServerSessionRetirementOutcome(outcome, 'denied');
                    break;
                }
            }
            const finalOutcome = turn.poisoned
                ? worseWebServerSessionRetirementOutcome(outcome, 'denied')
                : outcome;
            return finalOutcome === 'failed'
                ? failedWebSessionRetirementCleanupReceipt
                : finalOutcome === 'denied'
                    ? deniedWebSessionRetirementCleanupReceipt
                    : completedWebSessionRetirementCleanupReceipt;
        }
        finally {
            endUserRetirementTurn(userId, turn);
        }
    }
    function cleanupRetiredWebServerSessionCell(cell, reason) {
        const sessionId = cell.sessionId;
        if (armedWebSessionCellsById[sessionId] !== cell)
            return deniedWebSessionRetirementCleanupReceipt;
        if (cell.state === 'RETIRED_CLEANUP') {
            beginWebSessionCellLifecycle(sessionId);
            return deniedWebSessionRetirementCleanupReceipt;
        }
        if (cell.state === 'RETIRED_TOMBSTONE') {
            return cell.sessionId === sessionId && cell.retirementReason === reason && cell.cleanupReceipt
                ? cell.cleanupReceipt
                : deniedWebSessionRetirementCleanupReceipt;
        }
        if (cell.state !== 'RETIRED' || cell.sessionId !== sessionId || cell.session.id !== sessionId
            || cell.retirementReason !== reason || !beginWebSessionCellLifecycle(sessionId)) {
            return deniedWebSessionRetirementCleanupReceipt;
        }
        try {
            if (webSessionCellLifecyclePoisoned || armedWebSessionCellsById[sessionId] !== cell
                || cell.state !== 'RETIRED' || cell.sessionId !== sessionId || cell.session.id !== sessionId
                || cell.retirementReason !== reason)
                return deniedWebSessionRetirementCleanupReceipt;
            return compactRetiredWebSessionCellRecord(cell, cell.session);
        }
        catch {
            cell.session = retiredWebSessionSentinel;
            cell.activationTicket = null;
            cell.retirement = null;
            cell.next = null;
            cell.cleanupReceipt = failedWebSessionRetirementCleanupReceipt;
            cell.state = 'RETIRED_TOMBSTONE';
            return failedWebSessionRetirementCleanupReceipt;
        }
        finally {
            endWebSessionCellLifecycle();
        }
    }
    /** Compacts one exact RETIRED Web cell into its terminal owner-private tombstone. */
    /* @Codex */
    function cleanupRetiredWebServerSession(sessionId, reason) {
        if (typeof sessionId !== 'string' || !sessionId || !isWebServerSessionRetirementReason(reason)) {
            return deniedWebSessionRetirementCleanupReceipt;
        }
        const cell = armedWebSessionCellsById[sessionId];
        return cell ? cleanupRetiredWebServerSessionCell(cell, reason) : deniedWebSessionRetirementCleanupReceipt;
    }
    function dispatchActiveWebServerSessionCellRetirement(cell, reason, observation) {
        retireActiveWebServerSessionCell(cell, reason, observation);
        return cleanupRetiredWebServerSessionCell(cell, reason);
    }
    /** Retires and terminally compacts one exact ACTIVE Web session by controlled reason. */
    /* @Codex */
    function dispatchActiveWebServerSessionRetirement(sessionId, reason) {
        if (typeof sessionId !== 'string' || !sessionId || !isWebServerSessionRetirementReason(reason)) {
            return deniedWebSessionRetirementCleanupReceipt;
        }
        retireActiveWebServerSession(sessionId, reason);
        return cleanupRetiredWebServerSession(sessionId, reason);
    }

    return ObjectFreeze({ api: ObjectFreeze({ SESSION_COOKIE_NAME, registerServerSessionResource, createSession, captureNativeLoginSessionFence, createNativeServerSession, isPairedNativeServerSession, stageWebServerSession, prepareStagedWebServerSession, getPreparedWebServerSessionId, armPreparedWebServerSession, getArmedWebServerSessionId, tombstoneArmedWebServerSession, activateArmedWebServerSession, retireActiveWebServerSession, commitPreparedWebServerSession, abortPreparedWebServerSession, activateStagedWebServerSession, abortStagedWebServerSession, resolveActiveWebServerSession, mintActiveWebSessionResourcePort, releaseActiveWebSessionResourcePort, beginActiveWebSessionResourceUse, commitActiveWebSessionResourceUse, abortActiveWebSessionResourceUse, registerActiveWebSessionPrivateResource, unregisterActiveWebSessionPrivateResource, getSession, peekSession, deleteSession, invalidateServerSessionForApplicationLock, invalidateSessionsForUser, prepareNativeSystemAdminReset, commitNativeSystemAdminReset, abortNativeSystemAdminReset, prepareNativeLegacyUserRetirement, preparePairedNativePinRetirement, commitNativeLegacyUserRetirement, abortNativeLegacyUserRetirement, clearAllSessions, retireServerSessionForLogout, retireServerSessionForApplicationLock, retireExpiredServerSession, retireServerSessionsForUser, retireWebP3SessionsForUser, cleanupRetiredWebServerSession, dispatchActiveWebServerSessionRetirement }), claimPreparedNativePinRetirement });
}
module.exports = { createServerSessionOwner };
