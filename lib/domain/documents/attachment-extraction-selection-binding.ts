/* @Codex */
import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import { types } from 'node:util';
import { dbServer } from '../../db-server';
import type { ServerSession } from '../../security/server-session';
import { serverSessionProjectionOwnerRegistry } from '../../security/server-session-projection-owner-production';
import {
    abortResourceUse,
    beginResourceUse,
    commitResourceUse,
    mintResourcePort,
    releaseResourcePort,
    type WebResourcePort,
    type WebResourceUse,
} from '../../security/web-auth-lifecycle-owner-adapter';

type Pair = Readonly<{ attachmentId: string; patientId: string; ambulatoryId: string }>;
const SESSION_KEYS = ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt'];
const PAIR_KEYS = ['attachmentId', 'patientId', 'ambulatoryId'];
const arrayIsArray = Array.isArray, isProxy = types.isProxy;
const getDescriptor = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys, objectCreate = Object.create, objectFreeze = Object.freeze;
const databaseAll = dbServer.all.bind(dbServer) as (query: SQL) => unknown;
let active = false;

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || isProxy(value) || arrayIsArray(value)
        || getPrototype(value) !== Object.prototype) return null;
    const found = ownKeys(value); if (found.length !== keys.length) return null;
    const result: Record<string, unknown> = objectCreate(null);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!; if (found[index] !== key) return null;
        const descriptor = getDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true
            || descriptor.configurable !== true || descriptor.writable !== true) return null;
        result[key] = descriptor.value;
    }
    return result;
}

function validSession(value: unknown): value is ServerSession {
    if (!value || typeof value !== 'object' || isProxy(value) || arrayIsArray(value)) return false;
    try {
        const prototype = getPrototype(value);
        if (prototype !== null && prototype !== Object.prototype) return false;
        const found = ownKeys(value);
        if (found.length !== SESSION_KEYS.length) return false;
        const fields: Record<string, unknown> = objectCreate(null);
        for (let index = 0; index < SESSION_KEYS.length; index += 1) {
            const key = SESSION_KEYS[index]!;
            if (found[index] !== key) return false;
            const descriptor = getDescriptor(value, key);
            if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return false;
            fields[key] = descriptor.value;
        }
        return typeof fields.id === 'string' && fields.id.length > 0
            && typeof fields.userId === 'string' && fields.userId.length > 0
            && typeof fields.username === 'string' && fields.username.length > 0
            && typeof fields.role === 'string' && fields.role.length > 0
            && fields.authChannel === 'web'
            && Number.isFinite(fields.createdAt) && Number.isFinite(fields.expiresAt);
    } catch { return false; }
}

function target(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value
        && !/[\u0000-\u001f\u007f]/u.test(value) ? value : null;
}

function readUniquePair(attachmentId: string): Pair | null {
    let candidate: unknown;
    try {
        candidate = databaseAll(sql`SELECT a.id AS attachmentId, a.patient_id AS patientId,
            m.ambulatory_id AS ambulatoryId FROM attachments a
            INNER JOIN patients p ON p.id = a.patient_id AND p.deleted_at IS NULL
            INNER JOIN patients_to_ambulatories m ON m.patient_id = p.id
            WHERE a.id = ${attachmentId} LIMIT 2`);
    } catch { return null; }
    if (!candidate || typeof candidate !== 'object' || isProxy(candidate) || !arrayIsArray(candidate)) return null;
    const length = getDescriptor(candidate, 'length'); const item = getDescriptor(candidate, '0');
    if (!length || !('value' in length) || length.value !== 1 || !item || !('value' in item)) return null;
    const fields = exact(item.value, PAIR_KEYS);
    if (!fields || fields.attachmentId !== attachmentId || typeof fields.patientId !== 'string'
        || fields.patientId.length < 1 || typeof fields.ambulatoryId !== 'string' || fields.ambulatoryId.length < 1) return null;
    return objectFreeze({ attachmentId, patientId: fields.patientId, ambulatoryId: fields.ambulatoryId });
}

/** Selects the unique host-owned clinical pair for one attachment without returning its authority. */
export function bindAttachmentExtractionSelection(sessionValue: unknown, attachmentIdValue: unknown): object | null {
    if (active) return null;
    active = true;
    let port: WebResourcePort | null = null;
    let use: WebResourceUse | null = null;
    let committed = false;
    try {
        const success = objectFreeze(objectCreate(null)) as object;
        if (!validSession(sessionValue)) return null;
        port = mintResourcePort(sessionValue);
        if (!port) return null;
        use = beginResourceUse(port);
        if (!use) return null;
        const attachmentId = target(attachmentIdValue); if (!attachmentId) return null;
        const owner = serverSessionProjectionOwnerRegistry.acquire(sessionValue);
        const expectedEpoch = owner.snapshotSelectionEpoch(sessionValue);
        const pair = readUniquePair(attachmentId); if (!pair) return null;
        owner.issueSelection({ expectedEpoch, patientId: pair.patientId, ambulatoryId: pair.ambulatoryId });
        committed = commitResourceUse(use);
        if (!committed) return null;
        return success;
    } catch { return null; }
    finally {
        if (use && !committed) abortResourceUse(use);
        if (port) releaseResourcePort(port);
        active = false;
    }
}
