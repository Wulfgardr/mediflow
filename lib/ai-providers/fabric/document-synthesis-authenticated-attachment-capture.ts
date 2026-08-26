/* @Codex */
import 'server-only';

import { types } from 'node:util';

import type { ServerSession } from '../../security/server-session';
import type { ServerSessionProjectionOwner } from '../../security/server-session-projection-owner';

type SessionContext = Readonly<{ session: ServerSession; owner: ServerSessionProjectionOwner }>;
type SelectedPair = Readonly<{ patientId: string; ambulatoryId: string }>;
type Currentness = Readonly<{ documentSourceRef: string; documentRevision: number; documentFreshnessEpoch: number }>;
type CaptureRecord = Readonly<{
    selected: true;
    currentness: Currentness;
    selectionEpoch: number;
    reviewContextEpoch: number;
    scope: 'document_synthesis_attachment_capture';
    revocationGeneration: number;
}>;
type Broker = { records: Map<string, CaptureRecord>; dispose: () => void; publish: (handle: string, record: CaptureRecord) => boolean };

export type DocumentSynthesisAuthenticatedAttachmentCaptureResult =
    | Readonly<{ status: 'available'; captureHandle: string }>
    | Readonly<{ status: 'denied'; captureHandle: null }>;

export type DocumentSynthesisAuthenticatedAttachmentCaptureSources = Readonly<{
    acquireContext: () => Promise<SessionContext | null>;
    lookup(selection: SelectedPair, attachmentId: string): unknown;
    registerSessionResource(sessionId: string, dispose: () => void): (() => void) | null;
    entropy: () => Uint8Array;
}>;

const OBJECT = Object.prototype;
const KEYS = ['attachmentId'] as const;
const ROW_KEYS = ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch'] as const;
const HANDLE = /^dsc_[a-f0-9]{32}$/u;
const SOURCE_REF = /^[0-9a-f]{64}$/u;
const MAX_ATTACHMENT_ID_LENGTH = 256;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const reflectOwnKeys = Reflect.ownKeys;
const stringTrim = Function.call.bind(String.prototype.trim) as (value: string) => string;
const regexpTest = Function.call.bind(RegExp.prototype.test) as (expression: RegExp, value: string) => boolean;
const mapHas = Function.call.bind(Map.prototype.has) as (map: Map<string, unknown>, key: string) => boolean;
const mapSet = Function.call.bind(Map.prototype.set) as (map: Map<string, unknown>, key: string, value: unknown) => Map<string, unknown>;
const mapClear = Function.call.bind(Map.prototype.clear) as (map: Map<string, unknown>) => void;

function frozen<T extends Record<string, unknown>>(value: T): Readonly<T> {
    return objectFreeze(Object.assign(objectCreate(null) as T, value));
}

function denied(): DocumentSynthesisAuthenticatedAttachmentCaptureResult {
    return frozen({ status: 'denied' as const, captureHandle: null });
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || Array.isArray(value) || types.isProxy(value)
            || objectGetPrototypeOf(value) !== OBJECT || reflectOwnKeys(value).length !== keys.length) return null;
        const descriptors = objectGetOwnPropertyDescriptors(value);
        const output = objectCreate(null) as Record<string, unknown>;
        for (const key of keys) {
            const descriptor = objectGetOwnPropertyDescriptor(descriptors, key);
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
            const field = descriptor.value as PropertyDescriptor;
            if (!field || field.enumerable !== true || !Object.hasOwn(field, 'value')) return null;
            output[key] = field.value;
        }
        return output;
    } catch { return null; }
}

function attachmentIntent(value: unknown): string | null {
    const input = exact(value, KEYS);
    const attachmentId = input?.attachmentId;
    return typeof attachmentId === 'string' && attachmentId.length > 0 && attachmentId.length <= MAX_ATTACHMENT_ID_LENGTH
        && attachmentId === stringTrim(attachmentId) ? attachmentId : null;
}

function currentness(value: unknown): Currentness | null {
    if (types.isPromise(value)) return null;
    const row = exact(value, ROW_KEYS);
    if (!row || typeof row.documentSourceRef !== 'string' || !regexpTest(SOURCE_REF, row.documentSourceRef)
        || typeof row.documentRevision !== 'number' || !Number.isSafeInteger(row.documentRevision) || row.documentRevision < 1
        || typeof row.documentFreshnessEpoch !== 'number' || !Number.isSafeInteger(row.documentFreshnessEpoch) || row.documentFreshnessEpoch < 1) return null;
    return frozen({ documentSourceRef: row.documentSourceRef, documentRevision: row.documentRevision, documentFreshnessEpoch: row.documentFreshnessEpoch });
}

function handle(bytes: unknown): string | null {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 16) return null;
    let output = 'dsc_';
    for (let index = 0; index < bytes.length; index += 1) {
        const byte = bytes[index];
        if (typeof byte !== 'number' || !Number.isSafeInteger(byte) || byte < 0 || byte > 255) return null;
        output += '0123456789abcdef'[byte >>> 4]! + '0123456789abcdef'[byte & 15]!;
    }
    return regexpTest(HANDLE, output) ? output : null;
}

/** Captures only host-owned attachment currentness; no text, route, provider, or preview is exposed here. */
export function createDocumentSynthesisAuthenticatedAttachmentCapture(sources: DocumentSynthesisAuthenticatedAttachmentCaptureSources): Readonly<{
    capture(input: unknown): Promise<DocumentSynthesisAuthenticatedAttachmentCaptureResult>;
}> {
    const owners = new WeakMap<object, WeakMap<object, Broker>>();

    const brokerFor = (context: SessionContext): Broker => {
        let sessions = owners.get(context.owner);
        if (!sessions) { sessions = new WeakMap<object, Broker>(); owners.set(context.owner, sessions); }
        let broker = sessions.get(context.session);
        if (broker) return broker;
        const records = new Map<string, CaptureRecord>();
        let disposed = false;
        let unregister: (() => void) | null = null;
        const dispose = () => {
            if (disposed) return;
            disposed = true;
            mapClear(records);
            unregister?.();
            unregister = null;
            sessions?.delete(context.session);
        };
        broker = {
            records,
            dispose,
            publish(captureHandle, record) {
                if (disposed || mapHas(records, captureHandle)) return false;
                let registered: (() => void) | null;
                try { registered = unregister ?? sources.registerSessionResource(context.session.id, dispose); } catch { return false; }
                if (!registered) return false;
                unregister = registered;
                if (disposed || mapHas(records, captureHandle)) return false;
                mapSet(records, captureHandle, record);
                return true;
            },
        };
        sessions.set(context.session, broker);
        return broker;
    };

    return objectFreeze({
        async capture(input: unknown): Promise<DocumentSynthesisAuthenticatedAttachmentCaptureResult> {
            const attachmentId = attachmentIntent(input);
            if (!attachmentId) return denied();
            let context: SessionContext | null;
            try { context = await sources.acquireContext(); } catch { return denied(); }
            if (!context) return denied();
            try {
                const broker = brokerFor(context);
                return context.owner.withLeaseCriticalSection(context.session, (selection) => {
                    const row = sources.lookup(selection, attachmentId);
                    const tuple = currentness(row);
                    if (!tuple) return denied();
                    const selectionEpoch = context.owner.snapshotSelectionEpoch(context.session);
                    const reviewContextEpoch = context.owner.snapshotReviewContextEpoch(context.session);
                    const captureHandle = handle(sources.entropy());
                    if (!captureHandle) return denied();
                    const record = frozen<CaptureRecord>({
                        selected: true,
                        currentness: tuple,
                        selectionEpoch,
                        reviewContextEpoch,
                        scope: 'document_synthesis_attachment_capture',
                        revocationGeneration: 0,
                    });
                    return broker.publish(captureHandle, record)
                        ? frozen({ status: 'available' as const, captureHandle })
                        : denied();
                });
            } catch { return denied(); }
        },
    });
}
