import { randomUUID } from 'node:crypto';

export class NativeChatWriteDenied extends Error {
    constructor() { super('Native chat write denied'); }
}
export const denyNativeChatWrite = (): never => { throw new NativeChatWriteDenied(); };
export type NativeChatWriteBinding = Readonly<{ session: object; scope: string; selection: number; resource: string }>;
type View = NativeChatWriteBinding & { at: number };
export type NativeChatWritePreview<T> = View & { command: T; at: number; viewAt: number; phase: 'preview' | 'verifying' | 'retired' };

export function createNativeChatWriteApprovals<T>(clock: () => number = Date.now) {
    const views = new Map<string, View>();
    const previews = new Map<string, NativeChatWritePreview<T>>();
    let lastTime = clock();
    function now() {
        const value = clock();
        if (!Number.isFinite(value) || value < lastTime) return denyNativeChatWrite();
        lastTime = value;
        return value;
    }
    function same(a: NativeChatWriteBinding, b: NativeChatWriteBinding) {
        return a.session === b.session && a.scope === b.scope && a.selection === b.selection && a.resource === b.resource;
    }
    function retire(id: string) {
        const preview = previews.get(id);
        if (preview) preview.phase = 'retired';
        previews.delete(id);
    }
    return {
        open(binding: NativeChatWriteBinding) {
            const at = now();
            for (const [id, view] of views) if (at - view.at >= 300_000) views.delete(id);
            if (views.size >= 256) return denyNativeChatWrite();
            const id = randomUUID();
            views.set(id, { ...binding, at });
            return id;
        },
        preview(id: string, binding: NativeChatWriteBinding, commandId: string, command: T, admit: () => void) {
            const at = now(), view = views.get(id);
            if (!view || !same(view, binding) || at - view.at >= 300_000) return denyNativeChatWrite();
            views.delete(id);
            admit();
            if (previews.has(commandId)) return denyNativeChatWrite();
            for (const [id, preview] of previews) if (at - preview.at >= 30_000) retire(id);
            if (previews.size >= 256) return denyNativeChatWrite();
            const preview: NativeChatWritePreview<T> = { ...binding, command, at, viewAt: view.at, phase: 'preview' };
            previews.set(commandId, preview);
            return preview;
        },
        consume(commandId: string, binding: Pick<NativeChatWriteBinding, 'session' | 'scope'>) {
            const preview = previews.get(commandId);
            if (!preview || preview.session !== binding.session || preview.scope !== binding.scope || preview.phase !== 'preview') return denyNativeChatWrite();
            preview.phase = 'verifying';
            return preview;
        },
        check(preview: NativeChatWritePreview<T>) {
            if (preview.phase !== 'verifying' || now() - preview.at >= 30_000 || now() - preview.viewAt >= 300_000) return denyNativeChatWrite();
        },
        revoke(commandId: string, binding: Pick<NativeChatWriteBinding, 'session' | 'scope'>) {
            const preview = previews.get(commandId);
            if (preview && (preview.session !== binding.session || preview.scope !== binding.scope)) return denyNativeChatWrite();
            retire(commandId);
        },
        finish: retire,
    };
}
