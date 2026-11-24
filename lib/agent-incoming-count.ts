'use client';

let count = 0;
const listeners = new Set<() => void>();

export function agentIncomingCountSnapshot(): number {
    return count;
}

export function agentIncomingCountServerSnapshot(): number {
    return 0;
}

export function subscribeAgentIncomingCount(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function publishAgentIncomingCount(next: number): void {
    if (count === next) return;
    count = next;
    for (const listener of listeners) listener();
}
