'use client';

import { useEffect, useState } from 'react';
import { prostheticsRequest } from '@/lib/reference-data/prosthetics-catalog-client';
import type { ProstheticsDocument, ProstheticsSourceRecord } from '@/lib/reference-data/prosthetics-catalog-contract';

export type SourceWithDocuments = ProstheticsSourceRecord & { documents: ProstheticsDocument[] };
export function ProstheticsOriginalLinks({ documents }: { documents: ProstheticsDocument[] }) {
    return documents.length ? <ul className="space-y-2">{documents.map(doc => <li key={doc.id}>
        <a className="inline-flex min-h-11 items-center underline" href={`/api/prosthetics/catalog/documents?id=${encodeURIComponent(doc.id)}&sha256=${doc.sha256}`}>
            {doc.name}{doc.page ? ` · pagina ${doc.page}` : ''}
        </a>
        <details><summary>Integrità originale</summary><p className="break-all">SHA-256: {doc.sha256}</p><p>{doc.size.toLocaleString('it-IT')} byte</p></details>
    </li>)}</ul> : <p>Nessun originale allegato.</p>;
}
function SourceDocuments({ source, revision, refresh }: { source: SourceWithDocuments; revision: string; refresh: () => Promise<void> }) {
    const [file, setFile] = useState<File | null>(null);
    const [page, setPage] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    async function attach() {
        if (!file || busy) return;
        setBusy(true); setMessage('');
        try {
            if (!file.size || file.size > 25 * 1024 * 1024) throw new Error('Scegli un originale non vuoto fino a 25 MiB.');
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            await prostheticsRequest('documents', new AbortController().signal, { sourceId: source.id, revision, name: file.name, base64: btoa(binary), page: page || null });
            await refresh(); setFile(null); setMessage('Originale allegato e fonte riletta.');
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Allegato non registrato. Rileggi le fonti prima di riprovare.'); }
        finally { setBusy(false); }
    }
    return <details className="border-t py-3">
        <summary className="min-h-11 cursor-pointer font-semibold">{source.name} · {source.version}</summary>
        <div className="space-y-3 py-3">
            <p>Ente: {source.authority} · Ambito: {source.scope} · Data: {source.date ?? 'non indicata'}</p>
            {source.notes && <p>{source.notes}</p>}
            <details><summary>Identità e file importato</summary><p className="break-all">Fonte: {source.id}</p><p className="break-all">SHA-256: {source.sha256}</p></details>
            <ProstheticsOriginalLinks documents={source.documents} />
            <label className="block">Originale per {source.name}<input className="block min-h-11 w-full" type="file" disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
            <label className="block">Pagina o sezione (facoltativa)<input className="input-field" maxLength={100} value={page} disabled={busy} onChange={e => setPage(e.target.value)} /></label>
            <button type="button" style={{ minHeight: 44 }} className="ui-btn-secondary min-h-11" disabled={!file || busy} onClick={() => void attach()}>Allega originale</button>
            <p role="status">{busy ? 'Registrazione originale…' : message}</p>
        </div>
    </details>;
}
export function ProstheticsSourcesPanel() {
    const [data, setData] = useState<{ sources: SourceWithDocuments[]; revision: string } | null>(null);
    const [message, setMessage] = useState('');
    async function refresh() { const value = await prostheticsRequest<{ sources: SourceWithDocuments[]; revision: string }>('sources', new AbortController().signal); setData(value); setMessage(''); }
    useEffect(() => {
        const controller = new AbortController();
        void prostheticsRequest<{ sources: SourceWithDocuments[]; revision: string }>('sources', controller.signal).then(setData)
            .catch(() => { if (!controller.signal.aborted) setMessage('Fonti non leggibili. Riprova la lettura.'); });
        return () => controller.abort();
    }, []);
    return <section aria-label="Fonti protesica" className="space-y-3 text-sm">
        <h3 className="font-semibold">Fonti e originali</h3>
        <p>Originali conservati in chiaro nell’archivio locale. Allega solo documenti di repertorio privi di dati dei pazienti.</p>
        <button type="button" style={{ minHeight: 44 }} className="ui-btn-secondary min-h-11" onClick={() => void refresh().catch(() => setMessage('Fonti non leggibili. Riprova.'))}>Rileggi fonti</button>
        <p role="status">{message || (data ? (data.sources.length ? `${data.sources.length} fonti` : 'Nessuna fonte importata.') : 'Lettura delle fonti…')}</p>
        {data?.sources.map(source => <SourceDocuments key={`${source.id}:${data.revision}`} source={source} revision={data.revision} refresh={refresh} />)}
    </section>;
}
