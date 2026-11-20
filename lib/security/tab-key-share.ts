import type { SessionKeyWrapping } from './client-security-session';

export type SharedTabKey<T> = { key: CryptoKey; user: T; wrapping: SessionKeyWrapping | null };
type Packet<T> =
    | { type: 'request'; requestId: string; recipient: string }
    | { type: 'key'; requestId: string; binding: string; value: SharedTabKey<T> }
    | { type: 'retired'; binding: string };
type Channel = Pick<BroadcastChannel, 'postMessage' | 'close' | 'addEventListener' | 'removeEventListener'>;
type Access = {
    currentBinding(): string | null;
    recipient(): Promise<string>;
    offer(recipient: string): Promise<boolean>;
    accept(): Promise<string | null>;
    reconcile(): void;
};

export function createTabKeyShare<T>(channel: Channel, access: Access) {
    let published: { binding: string; value: SharedTabKey<T> } | null = null;
    let epoch = 0;
    let disposed = false;
    const pending = new Map<string, { epoch: number; accepting: boolean; finish(value: SharedTabKey<T> | null): void }>();
    const validKey = (key: unknown): key is CryptoKey => key instanceof CryptoKey && !key.extractable && key.type === 'secret'
        && key.algorithm.name === 'AES-GCM' && 'length' in key.algorithm && key.algorithm.length === 256
        && key.usages.length === 2 && key.usages.includes('encrypt') && key.usages.includes('decrypt');
    const onMessage = (event: MessageEvent<Packet<T>>) => {
        const packet = event.data;
        if (!packet || disposed) return;
        if (packet.type === 'retired') {
            if (packet.binding === access.currentBinding()) access.reconcile();
            return;
        }
        if (typeof packet.requestId !== 'string') return;
        const snapshot = epoch;
        if (packet.type === 'request') {
            const state = published;
            if (!state || access.currentBinding() !== state.binding || !/^[a-f0-9]{64}$/u.test(packet.recipient)) return;
            void access.offer(packet.recipient).then(offered => {
                if (offered && !disposed && epoch === snapshot && published === state && access.currentBinding() === state.binding) {
                    channel.postMessage({ type: 'key', requestId: packet.requestId, binding: state.binding, value: state.value });
                }
            }).catch(() => undefined);
        } else if (packet.type === 'key') {
            const request = pending.get(packet.requestId);
            if (!request || request.epoch !== epoch || request.accepting || typeof packet.binding !== 'string'
                || !packet.value || !validKey(packet.value.key)) return;
            request.accepting = true;
            void access.accept().then(binding => {
                if (!disposed && epoch === snapshot && pending.get(packet.requestId) === request && binding === packet.binding) {
                    request.finish(packet.value);
                } else request.finish(null);
            }).catch(() => request.finish(null));
        }
    };
    channel.addEventListener('message', onMessage as EventListener);
    return {
        async publish(value: SharedTabKey<T>): Promise<void> {
            const snapshot = ++epoch;
            published = null;
            const binding = access.currentBinding();
            if (!binding || disposed) return;
            let key = value.key;
            if (key.extractable) {
                const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
                try { key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
                finally { raw.fill(0); }
            }
            if (validKey(key) && snapshot === epoch && !disposed && access.currentBinding() === binding) published = { binding, value: { ...value, key } };
        },
        async request(timeoutMs = 3000): Promise<SharedTabKey<T> | null> {
            const snapshot = epoch;
            const recipient = await access.recipient();
            if (disposed || epoch !== snapshot) return null;
            const requestId = crypto.randomUUID();
            return new Promise(resolve => {
                const timer = setTimeout(() => pending.get(requestId)?.finish(null), timeoutMs);
                pending.set(requestId, { epoch: snapshot, accepting: false, finish(value) {
                    if (!pending.delete(requestId)) return;
                    clearTimeout(timer); resolve(value);
                } });
                channel.postMessage({ type: 'request', requestId, recipient });
            });
        },
        announceRetirement(binding: string): void {
            channel.postMessage({ type: 'retired', binding });
        },
        clear(): void {
            ++epoch; published = null;
            for (const request of pending.values()) request.finish(null);
        },
        dispose(): void {
            this.clear(); disposed = true;
            channel.removeEventListener('message', onMessage as EventListener); channel.close();
        },
    };
}
