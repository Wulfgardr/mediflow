'use client';
/* @Codex */
import { useEffect, useRef, useState } from 'react';
import { ProstheticsOriginalLinks, type SourceWithDocuments } from './prosthetics-source-documents';
import { prostheticsRequest } from '@/lib/reference-data/prosthetics-catalog-client';
import { prostheticsSelection, type ProstheticsEntry, type ProstheticsSelection } from '@/lib/reference-data/prosthetics-catalog-contract';

const control = { minHeight: 'var(--lume-control-height, 44px)', borderRadius: 'var(--lume-control-radius, 10px)' };
/** The callback receives description + namespaced view data, never a prescription patch. */
export function ProstheticsCatalogLookup({ onCopyDescription, onSelect }: {
    onSelect?: (entry: ProstheticsEntry, revision: string) => void;
    onCopyDescription?: (description: string, viewData: ProstheticsSelection) => void;
}) {
    const [sourceId, setSourceId] = useState('');
    const [sources, setSources] = useState<SourceWithDocuments[]>([]);
    const [query, setQuery] = useState('');
    const [result, setResult] = useState<{ revision: string; entries: ProstheticsEntry[]; truncated: boolean } | null>(null);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const request = useRef<AbortController | null>(null);
    const mounted = useRef(true);
    useEffect(() => { const controller = new AbortController(); void prostheticsRequest<{ sources: SourceWithDocuments[] }>('sources', controller.signal).then(data => setSources(data.sources)).catch(() => {}); return () => controller.abort(); }, []);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
    async function search() {
        request.current?.abort();
        const controller = new AbortController(); request.current = controller;
        setBusy(true); setResult(null); setMessage('');
        try {
            const value = await prostheticsRequest<{ revision: string; entries: ProstheticsEntry[]; truncated: boolean }>(`search?q=${encodeURIComponent(query)}&sourceId=${encodeURIComponent(sourceId)}`, controller.signal);
            if (!controller.signal.aborted) setResult(value);
        } catch { if (!controller.signal.aborted) setMessage('Ricerca non riuscita. Verifica la sessione e riprova.'); }
        finally { if (!controller.signal.aborted) setBusy(false); }
    }
    async function copy(row: ProstheticsEntry) {
        const selection = prostheticsSelection(row);
        try {
            if (onSelect && result) onSelect(row, result.revision);
            else if (onCopyDescription) onCopyDescription(selection.description, selection);
            else await navigator.clipboard.writeText(selection.description);
            if (mounted.current) setMessage(onCopyDescription || onSelect
                ? 'Descrizione inserita nella bozza.'
                : 'Sola descrizione copiata. Il codice non è stato applicato alla prescrizione.');
        } catch { if (mounted.current) setMessage('Copia non disponibile: seleziona la descrizione e copiala manualmente.'); }
    }
    return <section aria-label="Consulta repertorio protesica" className="space-y-3">
        <h3 className="font-semibold">Consulta il repertorio</h3>
        <p className="text-sm leading-6">{onCopyDescription || onSelect
            ? 'Scegli una voce da usare nella bozza con la sua fonte. Il codice ISO si compila separatamente.'
            : 'Il codice conserva la codifica dichiarata dalla fonte. Puoi copiare la sola descrizione; MediFlow non lo converte in codice ISO.'}</p>
        <div role="search" className="flex flex-wrap gap-2" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); void search(); } }}>
            <label className="min-w-0 flex-1 text-sm">Codice, descrizione o codifica
                <input className="mf-input mt-1 w-full" style={control} maxLength={200} value={query}
                    onChange={event => { request.current?.abort(); setBusy(false); setResult(null); setQuery(event.target.value); }} />
            </label>
            <label className="text-sm">Fonte<select className="mf-input block min-h-11" value={sourceId} onChange={e => { request.current?.abort(); setBusy(false); setResult(null); setSourceId(e.target.value); }}><option value="">Tutte le fonti</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name} · {source.version}</option>)}</select></label>
            <button type="button" onClick={() => void search()} className="self-end border px-4 text-sm font-semibold" style={control} disabled={busy}>{busy ? 'Cerco…' : 'Cerca nel repertorio'}</button>
        </div>
        <p role="status" className="text-sm">{message}</p>
        {result && <>
            <p className="text-sm">{result.entries.length} {result.entries.length === 1 ? 'risultato' : 'risultati'}{result.truncated ? ' mostrati. Affina la ricerca per vedere gli altri.' : '.'}</p>
            <ul className="space-y-3">
                {result.entries.map(row => <li key={row.id} className="space-y-2 border p-4 text-sm leading-6" style={{ borderRadius: 'var(--lume-control-radius, 10px)', overflowWrap: 'anywhere' }}>
                    <p className="font-semibold">{row.description}</p>
                    <p>Codifica: {row.codeSystem} · Codice: {row.code}</p>
                    <p>Fonte: {row.source} · Versione: {row.version} · Ambito: {row.scope}</p>
                    {(row.startDate || row.endDate) && <p>Date dichiarate: {row.startDate ?? 'inizio non indicato'} / {row.endDate ?? 'fine non indicata'}</p>}
                    <ProstheticsOriginalLinks documents={sources.find(source => source.id === row.sourceId)?.documents ?? []} />
                    <details><summary className="cursor-pointer" style={{ minHeight: 'var(--lume-control-height, 44px)', alignContent: 'center' }}>Provenienza del file</summary><p>Importato: {row.importedAt}</p><p className="break-all">SHA-256: {row.sourceSha256}</p></details>
                    <button type="button" className="border px-4 font-semibold" style={control} onClick={() => void copy(row)}>{onSelect ? 'Usa voce nella bozza' : onCopyDescription ? 'Usa descrizione nella bozza' : 'Copia solo descrizione'}</button>
                </li>)}
            </ul>
        </>}
    </section>;
}
