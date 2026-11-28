export function confirmAgentUnlock(gesture: { ticket: string } | { sharedTab: string; etag: string }): Promise<boolean> {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if ('etag' in gesture) headers.set('If-Match', gesture.etag);
    const body = 'ticket' in gesture ? { ticket: gesture.ticket } : { sharedTab: gesture.sharedTab };
    return fetch('/api/agent-mandates/unlock', { method: 'POST', cache: 'no-store', headers, body: JSON.stringify(body),
        signal: AbortSignal.timeout(4000) }).then(response => response.ok, () => false);
}
