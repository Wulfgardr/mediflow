/* @Codex — pure protocol validation. This module cannot issue product authority. */
import { ExecutionError } from './execution-contract';
export type MacOwnerFrame = Readonly<{ sequence: number; kind: 'START' | 'LIVE' | 'STOP' | 'ERROR'; value: number; detail: number }>;
export function parseMacOwnerFrame(line: string, nonce: string): MacOwnerFrame {
    if (!/^[a-f0-9]{32}$/u.test(nonce) || Buffer.byteLength(line) > 160) throw new ExecutionError('unqualified_boundary');
    const match = /^MFM1 ([a-f0-9]{32}) ([1-9][0-9]{0,7}) (START|LIVE|STOP|ERROR) (-?[0-9]{1,10}) ([0-9]{1,3})$/u.exec(line);
    if (!match || match[1] !== nonce) throw new ExecutionError('unqualified_boundary');
    const value = Number(match[4]), detail = Number(match[5]);
    if (!Number.isSafeInteger(value) || value < -255 || value > 2147483647 || detail > 3) throw new ExecutionError('unqualified_boundary');
    const kind = match[3] as MacOwnerFrame['kind'];
    if ((kind === 'START' || kind === 'LIVE') && (value <= 1 || detail !== 0)
        || kind === 'ERROR' && (value < 1 || value > 6)) throw new ExecutionError('unqualified_boundary');
    return Object.freeze({ sequence: Number(match[2]), kind, value, detail });
}
/** Pure reducer for testing malformed/reordered/stale observations. An instance
 * or copied state is NOT a witness; only the concrete producer owns an issuer. */
export class MacOwnerSequence {
    #sequence = 0;
    #pid: number | null = null;
    #last = -Infinity;
    #failed = false;
    #invalid = false;
    #noChild = false;
    #exitAccepted = false;
    #stop: MacOwnerFrame | null = null;
    #exited = false;
    accept(frame: MacOwnerFrame, observedAt: number): void {
        if (!Number.isFinite(observedAt) || observedAt < this.#last || this.#stop || this.#exited || frame.sequence !== this.#sequence + 1) {
            this.#invalid = true; this.#failed = true; throw new ExecutionError('unqualified_boundary');
        }
        this.#sequence = frame.sequence; this.#last = observedAt;
        if (frame.kind === 'ERROR') {
            if (frame.value <= 3 && this.#pid === null) this.#noChild = true;
            this.#failed = true; return;
        }
        if (this.#noChild) { this.#invalid = true; throw new ExecutionError('unqualified_boundary'); }
        if (frame.kind === 'START') {
            if (this.#pid !== null) { this.#invalid = true; this.#failed = true; throw new ExecutionError('unqualified_boundary'); }
            this.#pid = frame.value;
        } else if (frame.kind === 'LIVE') {
            if (this.#pid !== frame.value) { this.#invalid = true; this.#failed = true; throw new ExecutionError('unqualified_boundary'); }
        } else {
            if (this.#pid === null) { this.#invalid = true; this.#failed = true; }
            if (frame.detail >= 2) this.#failed = true; // Expiry/policy change never seals a result.
            this.#stop = frame;
        }
    }
    invalidate(protocolInvalid = false): void { this.#failed = true; this.#invalid ||= protocolInvalid; }
    exited(code: number | null, signal: NodeJS.Signals | null): void {
        this.#exited = true;
        this.#exitAccepted = signal === null && (code === 0 || code === 78);
        if (code !== 0 || signal !== null || !this.#stop) this.#failed = true;
    }
    live(now: number): boolean {
        return !this.#failed && !this.#exited && !this.#stop && this.#pid !== null
            && Number.isFinite(now) && now >= this.#last && now - this.#last <= 350;
    }
    get started(): boolean { return this.#pid !== null && !this.#failed; }
    get failed(): boolean { return this.#failed; }
    get drained(): boolean { return !this.#invalid && this.#exited && this.#exitAccepted && (this.#noChild || this.#stop !== null); }
    get exitCode(): number | null { return this.#stop?.value ?? null; }
    get reason(): number | null { return this.#stop?.detail ?? null; }
}
