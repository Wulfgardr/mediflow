/* @Codex — bounded async ownership; timers do not preempt synchronous browser work. */
import { PreviewError } from './document-viewer-policy.ts';

export class PreviewScope {
    private readonly controller = new AbortController();
    private readonly timer: ReturnType<typeof setTimeout>;
    private readonly parent: AbortSignal;
    private readonly parentAbort: () => void;
    readonly signal: AbortSignal;

    constructor(parent: AbortSignal, timeoutMs: number) {
        this.parent = parent;
        this.signal = this.controller.signal;
        this.parentAbort = () => this.stop(parent.reason instanceof PreviewError ? parent.reason : new PreviewError('cancelled'));
        this.timer = setTimeout(() => this.stop(new PreviewError('timeout')), timeoutMs);
        parent.addEventListener('abort', this.parentAbort, { once: true });
        if (parent.aborted) this.parentAbort();
    }
    stop(error: PreviewError): void {
        if (!this.signal.aborted) this.controller.abort(error);
    }
    check(): void {
        if (this.signal.aborted) throw this.signal.reason;
    }
    onAbort(action: () => void): () => void {
        this.signal.addEventListener('abort', action, { once: true });
        if (this.signal.aborted) action();
        return () => this.signal.removeEventListener('abort', action);
    }
    wait<T>(work: Promise<T>, releaseLate?: (value: T) => void): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const abort = () => {
                if (settled) return;
                settled = true;
                this.signal.removeEventListener('abort', abort);
                reject(this.signal.reason);
            };
            this.signal.addEventListener('abort', abort, { once: true });
            // Attach both handlers even when already aborted: no orphan rejection.
            work.then((value) => {
                if (settled) {
                    try { releaseLate?.(value); } catch { /* release is best-effort */ }
                    return;
                }
                settled = true;
                this.signal.removeEventListener('abort', abort);
                resolve(value);
            }, (error: unknown) => {
                if (settled) return;
                settled = true;
                this.signal.removeEventListener('abort', abort);
                reject(error);
            });
            if (this.signal.aborted) abort();
        });
    }
    async yield(): Promise<void> {
        this.check();
        await this.wait(new Promise<void>((resolve) => setTimeout(resolve, 0)));
        this.check();
    }
    finish(): void {
        clearTimeout(this.timer);
        this.parent.removeEventListener('abort', this.parentAbort);
    }
}
