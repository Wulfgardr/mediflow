/* @Codex */
import 'server-only';

import { types } from 'node:util';
import type { ServerSession } from '../../security/server-session';
import { createAttachmentExtractionSourceAuthority } from './attachment-extraction-source-authority';
import { buildAnyDocLocalExtraction, type LocalExtractionResult } from './anydoc-local-extraction-contract';
import { extractAnyDocLocalBytes } from './anydoc-local-extraction-runner';

const getDescriptor = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
const isProxy = types.isProxy;

function attachmentId(value: unknown): string | null {
    if (!value || typeof value !== 'object' || isProxy(value) || getPrototype(value) !== Object.prototype) return null;
    const keys = ownKeys(value); if (keys.length !== 1 || keys[0] !== 'attachmentId') return null;
    const descriptor = getDescriptor(value, 'attachmentId');
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true || typeof descriptor.value !== 'string') return null;
    const id = descriptor.value;
    return id.length > 0 && id.length <= 200 && id.trim() === id ? id : null;
}

function denied(): LocalExtractionResult { return buildAnyDocLocalExtraction(null, ''); }

/** Runs one current host-owned attachment through the fixed local parser and publishes only after final currentness. */
export async function composeAnyDocCurrentSourceExtraction(session: ServerSession, selector: unknown): Promise<LocalExtractionResult> {
    const id = attachmentId(selector); if (!id) return denied();
    let authority: ReturnType<typeof createAttachmentExtractionSourceAuthority>;
    try { authority = createAttachmentExtractionSourceAuthority(session); }
    catch { return denied(); }
    let operation: object | null = null;
    try {
        const locator = authority.issue(selector); if (!locator) return denied();
        const begun = authority.consume(locator); if (begun.status !== 'begun') return denied();
        operation = begun.operation;
        let result: LocalExtractionResult;
        try { result = await extractAnyDocLocalBytes(id, begun.bytes); }
        catch { authority.abort(operation); operation = null; return denied(); }
        const final = authority.finalize(operation); operation = null;
        return final.status === 'spent' && final.evidenceAdmissible ? result : denied();
    } catch {
        if (operation) authority.abort(operation);
        return denied();
    } finally { authority.dispose(); }
}
