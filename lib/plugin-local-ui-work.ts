export const LOCAL_UI_REVOKE_EVENT = 'mediflow-local-ui-revoke';

export type LocalUiWorkScope = Readonly<{ request: string; link: string }>;
type Opening = Readonly<{
    scope: LocalUiWorkScope;
    intent: string;
    patientId: string;
    anchor: string;
}>;

export function readLocalUiWorkScope(id: string | undefined): LocalUiWorkScope | null {
    const match = id?.match(/^([a-f0-9-]{36})\/(initial|[a-f0-9-]{36})$/u);
    return match ? { request: match[1], link: match[2] } : null;
}

export function createLocalUiWork() {
    let opening: Opening | null = null;
    const revokedLinks = new Set<string>();
    const running = new Set<{ scope: LocalUiWorkScope; stop: () => void }>();
    const retire = (matches: (scope: LocalUiWorkScope) => boolean) => {
        if (opening && matches(opening.scope)) opening = null;
        for (const work of [...running]) {
            if (!matches(work.scope)) continue;
            running.delete(work);
            work.stop();
        }
    };
    return {
        isRevoked(scope: LocalUiWorkScope) { return revokedLinks.has(scope.link); },
        open(value: Opening | null) { opening = value && !revokedLinks.has(value.scope.link) ? value : null; },
        move(hash: string) { if (opening && hash !== opening.anchor) opening = null; },
        begin(intent: string, patientId: string, stop: () => void) {
            if (opening?.intent !== intent || opening.patientId !== patientId) return null;
            const work = { scope: opening.scope, stop };
            opening = null;
            running.add(work);
            return () => { running.delete(work); };
        },
        cancel(request: string) { retire(scope => scope.request === request); },
        revoke(link: string) {
            revokedLinks.add(link);
            retire(scope => scope.link === link);
        },
        reset() { retire(() => true); },
    };
}
