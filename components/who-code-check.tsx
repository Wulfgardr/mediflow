'use client';

/* @Codex */
import { useEffect, useRef, useState } from 'react';
import { checkWhoCode, whoCodeCheckErrorMessage } from '@/lib/icd-code-check-client';
import { isWhoCheckCode, type WhoCodeCheckResult } from '@/lib/reference-data/icd11-who-code-check-contract';

/** Parent keys this control to the displayed code and source; results never edit the form. */
export function WhoCodeCheck({ code, release = '2026-01' }: { code: string; release?: string }) {
    const active = useRef<AbortController | null>(null);
    const [state, setState] = useState<{ kind: 'idle' | 'running' } | { kind: 'error'; message: string } | { kind: 'done'; result: WhoCodeCheckResult }>({ kind: 'idle' });
    useEffect(() => () => active.current?.abort(), []);
    async function verify() {
        if (active.current) return;
        const controller = new AbortController(); active.current = controller;
        setState({ kind: 'running' });
        try {
            const result = await checkWhoCode(code, release, controller.signal);
            if (!controller.signal.aborted) setState({ kind: 'done', result });
        } catch (error) {
            if (!controller.signal.aborted) setState({ kind: 'error', message: whoCodeCheckErrorMessage(error) });
        } finally { if (active.current === controller) active.current = null; }
    }
    return <div className="mt-3 space-y-2 text-sm" aria-label={`Verifica WHO del codice ${code || 'non inserito'}`}>
        <button type="button" className="ui-btn-secondary min-h-11" disabled={!isWhoCheckCode(code) || state.kind === 'running'} onClick={() => void verify()}>
            {state.kind === 'running' ? 'Verifica in corso…' : 'Verifica codice WHO'}
        </button>
        {state.kind === 'error' && <p role="alert">{state.message}</p>}
        {state.kind === 'done' && <div role="status" className="space-y-1">
            <p className="font-medium">{state.result.status === 'found'
                ? `${state.result.code} riconosciuto da WHO · MMS 2026-01`
                : `${state.result.code} non trovato in MMS 2026-01`}</p>
            {state.result.entry && <p>{/[&/]/u.test(code) ? 'Codice base: ' : ''}{state.result.entry.stemTitle}
                {/[&/]/u.test(code) ? ` (${state.result.entry.stemCode}). Il titolo si riferisce al codice base.` : ''}</p>}
            <p className="text-[color:var(--lume-ink-muted)]">Verifica della codifica in inglese, senza modifiche alla cartella.</p>
            <details className="pt-1 text-sm">
                <summary className="cursor-pointer">Fonte e data della verifica</summary>
                <p>Servizio WHO locale · {new Date(state.result.receipt.checkedAt).toLocaleString('it-IT')}</p>
                {state.result.entry && <p className="break-all">{state.result.entry.canonicalUri}</p>}
                <p className="break-all">Dataset: {state.result.receipt.datasetSnapshotId}</p>
            </details>
        </div>}
    </div>;
}

export function WhoCodeCheckForm() {
    const [code, setCode] = useState('');
    return <div className="mt-5 border-t border-[color:var(--lume-border-color)] pt-5">
        <label className="block space-y-2 text-sm font-medium">
            <span>Verifica un codice ICD-11</span>
            <input className="mf-input max-w-sm" value={code} maxLength={32} autoCapitalize="characters" spellCheck={false}
                onChange={event => setCode(event.target.value)} placeholder="Es. 1A00" />
        </label>
        <WhoCodeCheck key={code} code={code} />
    </div>;
}
