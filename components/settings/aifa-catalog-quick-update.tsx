'use client';

import { useEffect, useRef, useState } from 'react';
import { AifaRemoteNotice, useAifaRemoteStatus } from './aifa-remote-notice';
import { createAifaUpdateGuide, INITIAL_AIFA_GUIDE_STATE } from '@/lib/aifa-update-guide';
import { getDrugCatalogStatus, updateAifaCatalog, importAifaCsv, clearDrugDatabase } from '@/lib/aifa-importer';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';

export function AifaCatalogQuickUpdate() {
    const confirm = useConfirm();
    const [state, setState] = useState(INITIAL_AIFA_GUIDE_STATE);
    const guide = useRef<ReturnType<typeof createAifaUpdateGuide> | null>(null);
    const busy = state.phase !== 'idle';
    const remote = useAifaRemoteStatus(state.catalog?.manifest?.importedAt, busy);
    useEffect(() => {
        const current = createAifaUpdateGuide({ read: getDrugCatalogStatus, update: updateAifaCatalog, importFile: importAifaCsv, clear: clearDrugDatabase }, setState);
        guide.current = current;
        return () => { guide.current = null; current.dispose(); };
    }, []);
    return <div className="type-meta space-y-2" style={{ gridColumn: '1 / -1' }}>
        <AifaRemoteNotice {...remote} />
        {remote.status?.networkAllowed && <Button variant="secondary" className="type-strong" style={{ minHeight: 44 }}
            disabled={busy || remote.checking || state.reconciliationRequired}
            onClick={() => void guide.current?.update(async message => (await confirm({
                title: 'Confermare la riduzione del catalogo?', message,
                confirmLabel: 'Conferma riduzione', tone: 'danger',
            })).confirmed)}>{busy ? 'Aggiornamento in corso…' : 'Aggiorna ora'}</Button>}
        {state.notice && <p role={state.notice.tone === 'error' ? 'alert' : 'status'}>{state.notice.text}</p>}
        {state.reconciliationRequired && <Button variant="secondary" disabled={busy} onClick={() => void guide.current?.refresh()}>Rileggi stato</Button>}
    </div>;
}
