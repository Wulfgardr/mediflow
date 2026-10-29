type Transport = (tab: string, action: 'renew' | 'release') => Promise<{ status: number }>;

export function startLocalUiDocumentLease(page: Pick<Window, 'addEventListener' | 'removeEventListener'>, send: Transport) {
    let tab = crypto.randomUUID(), running = false;
    let phase: 'active' | 'suspended' | 'unavailable' | 'closed' = 'active';
    const renew = async () => {
        if (phase !== 'active' || running) return;
        const documentId = tab;
        running = true;
        try {
            const response = await send(documentId, 'renew');
            if (tab === documentId && phase === 'active' && response.status === 404) phase = 'unavailable';
        } catch { /* The server expires a document it can no longer hear. */ }
        finally {
            running = false;
            if (phase === 'active' && tab !== documentId) void renew();
        }
    };
    const hide = () => {
        if (phase === 'closed') return;
        phase = 'suspended';
        void send(tab, 'release').catch(() => {});
    };
    const show = () => {
        if (phase !== 'suspended') return;
        tab = crypto.randomUUID(); phase = 'active'; void renew();
    };
    const timer = setInterval(() => { void renew(); }, 3000);
    page.addEventListener('pagehide', hide);
    page.addEventListener('pageshow', show);
    void renew();
    return () => {
        clearInterval(timer); page.removeEventListener('pagehide', hide); page.removeEventListener('pageshow', show);
        hide(); phase = 'closed';
    };
}
