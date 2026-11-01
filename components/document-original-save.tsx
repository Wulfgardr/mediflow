'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export default function DocumentOriginalSave({ file, fileName, signal }: { file: Blob | string; fileName: string; signal?: AbortSignal }) {
    const source = useMemo(() => ({ file, fileName }), [file, fileName]);
    const [confirmation, setConfirmation] = useState<typeof source | null>(null);
    const [failed, setFailed] = useState<typeof source | null>(null);
    const urls = useRef(new Map<string, number>());
    const trigger = useRef<HTMLButtonElement>(null);
    const confirm = useRef<HTMLButtonElement>(null);
    const asking = confirmation === source;
    useEffect(() => { if (asking) confirm.current?.focus(); }, [asking]);
    useEffect(() => {
        const current = urls.current;
        const clear = () => {
            for (const [url, timer] of current) { window.clearTimeout(timer); URL.revokeObjectURL(url); }
            current.clear();
            setConfirmation(null);
            setFailed(null);
        };
        window.addEventListener('pagehide', clear);
        return () => { window.removeEventListener('pagehide', clear); clear(); };
    }, [source]);
    const save = () => {
        if (!asking || signal?.aborted) return;
        setConfirmation(null);
        setFailed(null);
        try {
            let href: string;
            if (file instanceof Blob) {
                href = URL.createObjectURL(file);
                const timer = window.setTimeout(() => { URL.revokeObjectURL(href); urls.current.delete(href); }, 1000);
                urls.current.set(href, timer);
            } else {
                if (!/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?;base64,/iu.test(file.slice(0, 256))) throw new Error('Invalid original');
                href = file;
            }
            const link = document.createElement('a');
            link.href = href;
            link.download = fileName.split(/[\\/]/u).at(-1)?.replace(/[\u0000-\u001f\u007f]/gu, '') || 'documento';
            document.body.append(link);
            try { link.click(); } finally { link.remove(); }
        } catch { setFailed(source); }
    };
    return <section className="flex flex-wrap items-center gap-3 p-3" aria-label="Salvataggio originale">
        {asking ? <>
            <p role="alert">Verrà salvata una copia decifrata sul computer. Chiunque abbia accesso al file potrà leggerlo. Scegli una cartella privata, fuori dalle cartelle sincronizzate.</p>
            <button ref={confirm} type="button" className="mf-btn-secondary" onClick={save}>Salva copia decifrata</button>
            <button type="button" className="mf-btn-secondary" onClick={() => { setConfirmation(null); window.requestAnimationFrame(() => trigger.current?.focus()); }}>Annulla</button>
        </> : <button ref={trigger} type="button" className="mf-btn-secondary" disabled={signal?.aborted} onClick={() => { if (!signal?.aborted) { setFailed(null); setConfirmation(source); } }}>Salva originale</button>}
        {failed === source && <p role="alert">Non è stato possibile salvare l’originale. Riapri il documento e riprova.</p>}
    </section>;
}
