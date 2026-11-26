import { MicrophoneUnavailable, openMicrophone, type OpenMicrophone } from './microphone';
import { applySuggestion, rebaseSuggestions, swapSpeakers, type ReviewSuggestion } from './review-text';
import type { LocalVoiceAvailability, LocalVoiceForeign, LocalVoiceMode, LocalVoicePageSnapshot } from './web-bridge';

export type RecorderNotice =
    | 'off' | 'unsupported' | 'model-missing' | 'model-incomplete' | 'model-invalid' | 'permission-denied' | 'audio-missing' | 'audio-lost'
    | 'engine-failed' | 'no-microphone' | 'draining' | 'stop-retry' | 'subject-mismatch' | 'failed';

export type RecorderView = Readonly<{
    phase: 'checking' | 'unavailable' | 'idle' | 'opening' | 'live' | 'review' | 'foreign';
    availability: LocalVoiceAvailability | null;
    foreign: { session: string | null; owner: LocalVoiceForeign } | null;
    snapshot: LocalVoicePageSnapshot | null;
    review: { text: string; suggestions: ReviewSuggestion[]; mode: LocalVoiceMode } | null;
    notice: RecorderNotice | null;
    pending: 'start' | 'pause' | 'resume' | 'stop' | 'discard' | null;
}>;

type Reply = { status: number; body: Record<string, unknown> | null };

const POLL_MS = 500;
const ACTIVE = new Set(['ready', 'preparing', 'recording', 'paused', 'finalizing']);
const LISTENING = new Set(['preparing', 'recording']);
const FAULTS = new Set<RecorderNotice>(['model-missing', 'model-invalid', 'permission-denied', 'audio-missing', 'audio-lost', 'engine-failed', 'unsupported']);
const INITIAL: RecorderView = { phase: 'checking', availability: null, foreign: null, snapshot: null, review: null, notice: null, pending: null };

async function call(method: string, path: string, body?: unknown, audio?: Uint8Array): Promise<Reply> {
    const response = await fetch(path, {
        method,
        headers: audio ? { 'Content-Type': 'application/octet-stream' } : body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: audio ? new Blob([audio as BlobPart]) : body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try { parsed = text ? JSON.parse(text) as Record<string, unknown> : null; } catch { parsed = null; }
    return { status: response.status, body: parsed };
}

function noticeOf(reply: Reply): RecorderNotice {
    const code = typeof reply.body?.error === 'string' ? reply.body.error : '';
    if (code === 'off') return 'off';
    if (code === 'subject-mismatch') return 'subject-mismatch';
    if (FAULTS.has(code as RecorderNotice)) return code as RecorderNotice;
    return 'failed';
}

/** One recording for one subject (a patient or a first visit): audio and text live only in this object and in the service. */
export class LocalVoiceRecorder {
    private view: RecorderView = INITIAL;
    private readonly listeners = new Set<() => void>();
    private session: string | null = null;
    private microphone: OpenMicrophone | null = null;
    private blocks: Uint8Array[] = [];
    private sequence = 0;
    private sending = false;
    private pumping: Promise<void> = Promise.resolve();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;

    constructor(readonly subject: string) {}

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    getSnapshot = () => this.view;

    private set(change: Partial<RecorderView>) {
        if (this.disposed) return;
        this.view = { ...this.view, ...change };
        this.listeners.forEach((listener) => listener());
    }

    private path(suffix = '') {
        return `/api/local-voice/${this.session}${suffix}`;
    }

    private query() {
        return `subject=${encodeURIComponent(this.subject)}`;
    }

    async refresh(): Promise<void> {
        let reply: Reply;
        try { reply = await call('GET', `/api/local-voice?${this.query()}`); } catch { this.set({ phase: 'unavailable', notice: 'off' }); return; }
        if (this.disposed) return;
        const availability = reply.body?.availability as LocalVoiceAvailability | undefined;
        if (reply.status !== 200 || !availability) { this.set({ phase: 'unavailable', notice: 'off' }); return; }
        const current = reply.body?.session as { id: string | null; own: boolean; foreign?: LocalVoiceForeign } | null;
        if (current?.own && current.id) {
            this.session = current.id;
            this.set({ availability, foreign: null, notice: null });
            await this.poll();
            return;
        }
        if (current) { this.set({ phase: 'foreign', availability, foreign: { session: current.id, owner: current.foreign ?? { kind: 'other-user' } } }); return; }
        this.set({ phase: availability === 'ready' ? 'idle' : 'unavailable', availability, foreign: null, notice: availability === 'ready' ? null : availability });
    }

    private enqueue = (pcm: Uint8Array) => {
        this.blocks.push(pcm);
        if (this.sending) this.pump();
    };

    private pump() {
        this.pumping = this.pumping.then(async () => {
            while (this.sending && this.blocks.length && this.session && !this.disposed) {
                const block = this.blocks[0];
                let reply: Reply;
                try { reply = await call('POST', `${this.path('/audio')}?${this.query()}&seq=${this.sequence}`, undefined, block); } catch { reply = { status: 0, body: { error: 'off' } }; }
                const expected = typeof reply.body?.expected === 'number' ? reply.body.expected : null;
                if (reply.status === 202 && reply.body?.repeated !== true) {
                    this.blocks.shift()?.fill(0);
                    this.sequence += 1;
                    continue;
                }
                if ((reply.status === 202 || reply.body?.error === 'out-of-order') && expected !== null && expected !== this.sequence) {
                    this.sequence = expected;
                    continue;
                }
                this.sending = false;
                this.blocks.forEach((item) => item.fill(0));
                this.blocks = [];
                this.set({ notice: noticeOf(reply) });
            }
        });
        return this.pumping;
    }

    private async closeMicrophone(flush: boolean) {
        const microphone = this.microphone;
        this.microphone = null;
        if (!microphone) return;
        if (flush) await microphone.flush();
        await microphone.close();
    }

    private async openMicrophone(): Promise<boolean> {
        try {
            const microphone = await openMicrophone(this.enqueue);
            if (this.disposed) {
                await microphone.close();
                return false;
            }
            this.microphone = microphone;
            return true;
        } catch (error) {
            this.set({ notice: error instanceof MicrophoneUnavailable && error.reason === 'permission-denied' ? 'permission-denied' : 'no-microphone' });
            return false;
        }
    }

    private schedule() {
        if (this.timer || this.disposed) return;
        this.timer = setTimeout(() => { this.timer = null; void this.poll(); }, POLL_MS);
    }

    private stopTimer() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    private async apply(reply: Reply) {
        if (reply.status === 409 && reply.body?.error === 'subject-mismatch') {
            await this.forget();
            this.set({ phase: 'unavailable', snapshot: null, review: null, notice: 'subject-mismatch' });
            return;
        }
        if (reply.status === 404) { await this.forget(); await this.refresh(); return; }
        if (reply.status !== 200 && reply.status !== 202) { this.set({ notice: noticeOf(reply) }); return; }
        const snapshot = reply.body as unknown as LocalVoicePageSnapshot;
        if (snapshot.subject !== this.subject) {
            await this.forget();
            this.set({ phase: 'unavailable', snapshot: null, review: null, notice: 'subject-mismatch' });
            return;
        }
        const { review, ...rest } = snapshot;
        const view: LocalVoicePageSnapshot = { ...rest, review: null };
        if (snapshot.state === 'cancelled') { await this.forget(); this.set({ phase: 'idle', snapshot: null, review: null }); return; }
        const fault = snapshot.fault as RecorderNotice | null;
        if (!ACTIVE.has(snapshot.state)) await this.closeMicrophone(false);
        if (review && !this.view.review) {
            this.stopTimer();
            this.set({ phase: 'review', snapshot: view, review: { text: review.text, suggestions: review.drugSuggestions.map((item) => ({ ...item })), mode: snapshot.mode },
                notice: fault, pending: null });
            return;
        }
        this.set({ phase: this.view.review ? 'review' : 'live', snapshot: view, notice: fault ?? (this.view.notice === 'stop-retry' || this.view.notice === 'draining' ? this.view.notice : null) });
        if (LISTENING.has(snapshot.state) && this.microphone && !this.sending && this.view.pending === null) {
            this.sequence = snapshot.nextSequence;
            this.sending = true;
            void this.pump();
        }
        if (ACTIVE.has(snapshot.state) || (snapshot.state === 'error' && (fault === 'audio-lost' || fault === 'permission-denied'))) this.schedule();
    }

    private async poll() {
        if (!this.session || this.disposed) return;
        try { await this.apply(await call('GET', `${this.path()}?${this.query()}`)); } catch { this.set({ notice: 'off' }); this.schedule(); }
    }

    async start(mode: LocalVoiceMode, vocabulary: readonly string[]): Promise<void> {
        if (this.view.phase !== 'idle') return;
        this.set({ phase: 'opening', pending: 'start', notice: null });
        if (!await this.openMicrophone()) { this.set({ phase: 'idle', pending: null }); return; }
        let reply: Reply;
        try { reply = await call('POST', '/api/local-voice', { subject: this.subject, mode, vocabulary }); } catch { reply = { status: 0, body: { error: 'off' } }; }
        if (this.disposed) {
            if (reply.status === 200 && typeof reply.body?.id === 'string') {
                await call('DELETE', `/api/local-voice/${reply.body.id}?${this.query()}`).catch(() => undefined);
            }
            return;
        }
        if (reply.status !== 200 || typeof reply.body?.id !== 'string') {
            await this.closeMicrophone(false);
            this.blocks.forEach((item) => item.fill(0));
            this.blocks = [];
            this.set({ pending: null });
            if (reply.status === 409 && reply.body?.error === 'session-active') { await this.refresh(); return; }
            this.set({ phase: reply.status === 503 ? 'unavailable' : 'idle', notice: noticeOf(reply) });
            return;
        }
        this.session = reply.body.id;
        this.set({ pending: null });
        await this.apply(reply);
    }

    private async command(command: 'pause' | 'resume' | 'stop') {
        const reply = await call('POST', this.path('/commands'), { subject: this.subject, command }).catch((): Reply => ({ status: 0, body: { error: 'off' } }));
        if (reply.status !== 200) {
            const code = reply.body?.error;
            this.set({ pending: null, notice: code === 'draining' ? 'draining'
                : command === 'stop' && code !== 'off' && code !== 'subject-mismatch' ? 'stop-retry' : noticeOf(reply) });
            if (reply.body?.error === 'subject-mismatch') await this.apply(reply);
            else this.schedule();
            return false;
        }
        this.set({ pending: null, notice: null });
        await this.apply(reply);
        return true;
    }

    async pause(): Promise<void> {
        if (!this.session || this.view.pending) return;
        this.set({ pending: 'pause' });
        await this.closeMicrophone(true);
        await this.pump();
        this.sending = false;
        await this.command('pause');
    }

    async resume(): Promise<void> {
        if (!this.session || this.view.pending) return;
        this.set({ pending: 'resume' });
        if (!await this.openMicrophone()) { this.set({ pending: null }); return; }
        if (!await this.command('resume')) await this.closeMicrophone(false);
    }

    async stop(): Promise<void> {
        if (!this.session || this.view.pending) return;
        this.set({ pending: 'stop', notice: null });
        await this.closeMicrophone(true);
        await this.pump();
        this.sending = false;
        await this.command('stop');
    }

    edit(text: string) {
        const review = this.view.review;
        if (!review) return;
        this.set({ review: { ...review, text, suggestions: rebaseSuggestions(review.text, text, review.suggestions) } });
    }

    swap() {
        const review = this.view.review;
        if (!review || review.mode !== 'visit') return;
        this.set({ review: { ...review, ...swapSpeakers(review.text, review.suggestions) } });
    }

    suggest(index: number) {
        const review = this.view.review;
        const next = review && applySuggestion(review.text, review.suggestions, index);
        if (review && next) this.set({ review: { ...review, ...next } });
    }

    /** The reviewed text, handed over once and only for this subject; the service forgets it first. */
    async take(): Promise<string | null> {
        const { review, snapshot } = this.view;
        if (!review || !snapshot || snapshot.subject !== this.subject || !review.text.trim()) return null;
        const text = review.text;
        if (!await this.discard()) return null;
        return text;
    }

    async discard(): Promise<boolean> {
        if (!this.session) return false;
        this.set({ pending: 'discard' });
        const reply = await call('DELETE', `${this.path()}?${this.query()}`).catch((): Reply => ({ status: 0, body: { error: 'off' } }));
        if (reply.status !== 204 && reply.status !== 404) { this.set({ pending: null, notice: noticeOf(reply) }); return false; }
        await this.forget();
        this.set({ phase: 'idle', snapshot: null, review: null, notice: null, pending: null });
        return true;
    }

    async discardForeign(): Promise<void> {
        const foreign = this.view.foreign;
        if (!foreign?.session || foreign.owner.kind === 'other-user') return;
        this.set({ pending: 'discard' });
        const reply = await call('DELETE', `/api/local-voice/${foreign.session}?subject=${encodeURIComponent(foreign.owner.subject)}`)
            .catch((): Reply => ({ status: 0, body: { error: 'off' } }));
        this.set({ pending: null });
        if (reply.status !== 204 && reply.status !== 404) { this.set({ notice: noticeOf(reply) }); return; }
        await this.refresh();
    }

    private async forget() {
        this.stopTimer();
        this.sending = false;
        this.blocks.forEach((item) => item.fill(0));
        this.blocks = [];
        await this.closeMicrophone(false);
        this.session = null;
        this.sequence = 0;
    }

    dispose() {
        this.disposed = true;
        void this.forget();
        this.view = { ...INITIAL, phase: 'unavailable' };
        this.listeners.clear();
    }
}
