/* @Codex — per-session preparation with a backend-wide, crash-persistent hold.
 * Files and receipts never qualify a host. Only the concrete issuer does. */
import 'server-only';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from '../data-dir';
import { ExecutionError } from './execution-contract';
import { prepareMacProductQualification, MacQualificationFailure, type MacQualificationAudit } from './execution-mac-qualification';
import { resolveInstalledMacExecutionAssets } from './execution-mac-assets';
import { createReviewedMacProductPlatform, executionPlatformSnapshot, type ProductExecutionPlatform } from './execution-platform';
import type { ProductPreparation } from '../chatgpt-product/product-contract';

type Prepared = Awaited<ReturnType<typeof prepareMacProductQualification>>;
/** Kept even when the owning Web session disappears. Never clear a hold merely
 * because a PID is absent, a request ended or this backend restarted. */
function reserveDirectory(directory: string): () => void {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const root = lstatSync(directory);
    if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== process.getuid?.() || (root.mode & 0o077) !== 0)
        throw new ExecutionError('unqualified_boundary');
    const path = join(directory, 'mac-preparation.hold');
    let fd: number;
    try { fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
    catch { throw new ExecutionError('busy'); }
    const identity = fstatSync(fd); closeSync(fd);
    let released = false;
    return () => {
        if (released) return;
        const current = lstatSync(path), parent = lstatSync(directory);
        if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino
            || parent.isSymbolicLink() || parent.dev !== root.dev || parent.ino !== root.ino)
            throw new ExecutionError('unqualified_boundary');
        unlinkSync(path); released = true;
    };
}
function closed(audit: MacQualificationAudit): boolean {
    return audit.cleanupComplete && audit.ownedTreeCeased && !audit.resourcesRetained;
}
/** Server-only seams allow deterministic lifecycle tests. The actual production
 * root supplies no substitute issuer, observer, runtime path or success flag. */
export function createMacProductPlatformManager(options: {
    prepare?: typeof prepareMacProductQualification;
    assets?: typeof resolveInstalledMacExecutionAssets;
    reservationDirectory?: () => string;
} = {}) {
    let reserved = false;
    const issue = options.prepare ?? prepareMacProductQualification;
    return Object.freeze({ createPlatform(): ProductExecutionPlatform {
        let prepared: Prepared | undefined;
        let reviewed: ProductExecutionPlatform | undefined;
        let projection: ProductPreparation = Object.freeze({ state: 'not_prepared', expiresAt: null });
        let pending: Promise<void> | undefined;
        let draining: Promise<void> | undefined;
        let controller: AbortController | undefined;
        let release: (() => void) | undefined;
        let taken = false;
        const setState = (state: ProductPreparation['state']) => { projection = Object.freeze({ ...projection, state }); };
        function relinquish() {
            if (!release) return;
            try { release(); release = undefined; reserved = false; setState('closed'); }
            catch { setState('blocked'); }
        }
        async function drain(owned: Prepared) {
            try { await owned.close(); }
            catch { /* A rejected close is not evidence of resource cessation. */ }
            if (closed(owned.audit())) relinquish(); else setState('blocked');
        }
        function close(): Promise<void> {
            controller?.abort(); reviewed = undefined;
            if (projection.state === 'not_prepared' || projection.state === 'closed' || projection.state === 'blocked' && !prepared && !pending) return Promise.resolve();
            if (draining) return draining;
            setState('closing');
            // Keep the original startup promise and its closure, even if the HTTP
            // waiter timed out. It alone receives and drains a late owned handle.
            draining = prepared ? drain(prepared) : (pending ?? Promise.resolve()).then(() => {}, () => {});
            return draining;
        }
        return Object.freeze({
            snapshot: () => reviewed?.snapshot() ?? executionPlatformSnapshot(),
            preparation: () => projection,
            close,
            async prepare(signal: AbortSignal, lifetimeMs: number) {
                if (reserved || pending || !['not_prepared', 'closed'].includes(projection.state)) throw new ExecutionError('busy');
                if (signal.aborted || lifetimeMs <= 0) throw new ExecutionError('canceled');
                // Resolve before reserving; missing installation files cannot leave
                // a resource hold, and no process is launched by this resolver.
                const assets = (options.assets ?? resolveInstalledMacExecutionAssets)();
                release = reserveDirectory((options.reservationDirectory ?? (() => join(getDataDir(), 'chatgpt-execution')))());
                reserved = true; taken = false; draining = undefined; prepared = undefined;
                controller = new AbortController();
                const local = controller;
                const abort = () => { local.abort(); setState('closing'); void close(); };
                signal.addEventListener('abort', abort, { once: true });
                projection = Object.freeze({ state: 'preparing', expiresAt: Math.floor(Date.now() + lifetimeMs) });
                // Reservation and withdrawal exist BEFORE the first await.
                pending = Promise.resolve().then(async () => {
                    try {
                        const owned = await issue({ ...assets, signal: local.signal, lifetimeMs });
                        prepared = owned;
                        if (signal.aborted || local.signal.aborted) { await drain(owned); throw new ExecutionError('canceled'); }
                        reviewed = createReviewedMacProductPlatform({ binaryPath: owned.binaryPath, qualification: owned.authority });
                        if (reviewed.snapshot().state !== 'qualified') { await drain(owned); throw new ExecutionError('unqualified_boundary'); }
                        setState('ready');
                    } catch (error) {
                        reviewed = undefined;
                        if (!prepared) {
                            if (error instanceof MacQualificationFailure && (closed(error.audit)
                                || !error.audit.resourcesRetained && ['platform', 'sources'].includes(error.stage))) relinquish();
                            else setState('blocked');
                        }
                        throw error;
                    } finally { signal.removeEventListener('abort', abort); }
                });
                try { await pending; }
                finally { pending = undefined; }
            },
            async create(signal: AbortSignal) {
                if (signal.aborted || taken || projection.state !== 'ready' || !reviewed) throw new ExecutionError('unqualified_boundary');
                taken = true; setState('in_use');
                try { return await reviewed.create(signal); }
                catch (error) { await close(); throw error; }
            },
        });
    } });
}

// One production manager across DEMO, ordinary functions and route chunks.
const sharedManagerKey = Symbol.for('mediflow.chatgpt.mac-platform-manager.v1');
const sharedManagers = globalThis as typeof globalThis & { [sharedManagerKey]?: ReturnType<typeof createMacProductPlatformManager> };
export function createSharedMacProductPlatform() {
    return (sharedManagers[sharedManagerKey] ??= createMacProductPlatformManager()).createPlatform();
}
