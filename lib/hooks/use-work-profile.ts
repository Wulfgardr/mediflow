'use client';

/* @Codex */
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseWorkProfileState, WorkProfileError, type WorkProfileCommand, type WorkProfileState } from '@/lib/work-profile';

const ENDPOINT = '/api/onboarding/work-profile';
const ERRORS: Record<string, string> = {
    conflict: 'Il profilo è cambiato in un’altra scheda. Rileggi lo stato prima di continuare.',
    state_invalid: 'Il profilo salvato non è leggibile. La cartella resta accessibile; il profilo non è stato cancellato.',
    preview_required: 'Completa e rileggi l’anteprima prima di confermare.',
    rollback_unavailable: 'Non è disponibile una scelta precedente da ripristinare.',
    input_invalid: 'La scelta non è valida. Rileggi lo stato e riprova.',
};

function message(error: unknown, fallback: string) {
    if (error instanceof WorkProfileError) return ERRORS[error.code] ?? fallback;
    if (error instanceof TypeError || error instanceof SyntaxError || error instanceof DOMException) return fallback;
    return error instanceof Error ? error.message : fallback;
}

async function read() {
    const response = await fetch(ENDPOINT, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    const value = await response.json();
    if (!response.ok) throw new Error(ERRORS[value.code] ?? 'Impossibile leggere il profilo. Verifica la sessione e riprova.');
    return parseWorkProfileState(value);
}

export function useWorkProfile() {
    const [state, setState] = useState<WorkProfileState | null>(null);
    const [busy, setBusy] = useState(true);
    const [snapshotVersion, setSnapshotVersion] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const inFlight = useRef(false);
    const generation = useRef(0);

    const reload = useCallback(async () => {
        if (inFlight.current) return;
        const current = ++generation.current;
        inFlight.current = true;
        setBusy(true);
        try {
            const fresh = await read();
            if (generation.current === current) { setState(fresh); setSnapshotVersion(value => value + 1); setError(null); }
        } catch (e) {
            if (generation.current === current) setError(message(e, 'Impossibile leggere il profilo. Verifica la sessione e riprova.'));
        } finally {
            inFlight.current = false;
            if (generation.current === current) setBusy(false);
        }
    }, []);

    useEffect(() => { void reload(); }, [reload]);

    async function change(action: WorkProfileCommand['action'], draft?: WorkProfileCommand['draft']) {
        if (!state || inFlight.current || error) return;
        inFlight.current = true;
        setBusy(true);
        const current = ++generation.current;
        try {
            const response = await fetch(ENDPOINT, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(15_000),
                body: JSON.stringify({ id: crypto.randomUUID(), expectedRevision: state.revision, action, ...(draft ? { draft } : {}) }),
            });
            const value = await response.json();
            if (!response.ok) throw new Error(ERRORS[value.code] ?? 'Salvataggio non confermato. Rileggi lo stato prima di riprovare.');
            const committed = parseWorkProfileState(value);
            const fresh = await read();
            if (fresh.revision !== committed.revision) throw new Error(ERRORS.conflict);
            if (generation.current === current) { setState(fresh); setSnapshotVersion(value => value + 1); setError(null); }
        } catch (e) {
            if (generation.current === current) setError(message(e, 'Salvataggio non confermato. Rileggi lo stato prima di continuare.'));
        } finally {
            inFlight.current = false;
            if (generation.current === current) setBusy(false);
        }
    }

    return { state, snapshotVersion, busy, error, reload, change };
}
export type WorkProfileController = ReturnType<typeof useWorkProfile>;
