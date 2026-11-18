import type { SessionKeyWrapping } from './client-security-session';

export type SharedTabKey<T> = { key: CryptoKey; user: T; wrapping: SessionKeyWrapping | null };
type Packet<T> = { type: 'request' | 'key'; requestId: string; binding: string; value?: SharedTabKey<T> };
type Channel = Pick<BroadcastChannel, 'postMessage' | 'close' | 'addEventListener' | 'removeEventListener'>;

export function createTabKeyShare<T>(channel: Channel, authority: () => Promise<string | null>, currentBinding: () => string | null) {
    let published: { binding: string; value: SharedTabKey<T> } | null = null;
    let epoch = 0;
    let disposed = false;
    const pending = new Map<string, { binding: string; epoch: number; finish(value: SharedTabKey<T> | null): void }>();
    const validKey = (key: unknown): key is CryptoKey => key instanceof CryptoKey && !key.extractable && key.type === 'secret'
        && key.algorithm.name === 'AES-GCM' && 'length' in key.algorithm && key.algorithm.length === 256
        && key.usages.length === 2 && key.usages.includes('encrypt') && key.usages.includes('decrypt');
    const onMessage = (event: MessageEvent<Packet<T>>) => {
        const packet = event.data;
        if (!packet || typeof packet.requestId !== 'string' || typeof packet.binding !== 'string' || disposed) return;
        const snapshot = epoch;
        if (packet.type === 'request') {
            const state = published;
            if (!state || state.binding !== packet.binding || currentBinding() !== state.binding) return;
            void authority().then(binding => {
                if (!disposed && epoch === snapshot && published === state && binding === state.binding && currentBinding() === binding)
                    channel.postMessage({ type: 'key', requestId: packet.requestId, binding, value: state.value });
            }).catch(() => undefined);
        } else if (packet.type === 'key') {
            const request = pending.get(packet.requestId);
            if (!request || request.epoch !== epoch || request.binding !== packet.binding || !packet.value || !validKey(packet.value.key)) return;
            void authority().then(binding => {
                if (!disposed && epoch === snapshot && pending.get(packet.requestId) === request && binding === request.binding
                    && currentBinding() === binding) request.finish(packet.value!);
            }).catch(() => request.finish(null));
        }
    };
    channel.addEventListener('message', onMessage as EventListener);
    return {
        async publish(value: SharedTabKey<T>): Promise<void> {
            const snapshot = ++epoch;
            published = null;
            const binding = currentBinding();
            if (!binding || disposed) return;
            let key = value.key;
            if (key.extractable) {
                const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
                try { key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
                finally { raw.fill(0); }
            }
            if (validKey(key) && snapshot === epoch && !disposed && currentBinding() === binding) published = { binding, value: { ...value, key } };
        },
        async request(timeoutMs = 1500): Promise<SharedTabKey<T> | null> {
            const snapshot = epoch;
            let binding: string | null;
            try { binding = await authority(); } catch { return null; }
            if (!binding || disposed || epoch !== snapshot || currentBinding() !== binding) return null;
            const requestId = crypto.randomUUID();
            return new Promise(resolve => {
                const timer = setTimeout(() => pending.get(requestId)?.finish(null), timeoutMs);
                pending.set(requestId, { binding, epoch: snapshot, finish(value) {
                    if (!pending.delete(requestId)) return;
                    clearTimeout(timer); resolve(value);
                } });
                channel.postMessage({ type: 'request', requestId, binding });
            });
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
