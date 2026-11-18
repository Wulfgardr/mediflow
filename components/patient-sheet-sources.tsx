'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { DocumentOriginal } from './document-upload';
import { InkSectionHeading } from './ui/ink-state';
import PrivacyBlur from './privacy-blur';
import { usePrivacy } from './privacy-provider';
import type { Attachment } from '@/lib/db';
import styles from './twin-synoptic-sheet.module.css';

export function PatientSheetSources({ patientId, data, loading, error, onRefresh, onCloseSource, archiveLink }: {
    patientId: string;
    data: Attachment[] | undefined;
    loading: boolean;
    error: unknown;
    onRefresh: () => void;
    onCloseSource?: () => void;
    archiveLink?: boolean;
}) {
    const { isPrivacyMode } = usePrivacy();
    const [selected, setSelected] = useState<string | null>(null);
    const recent = data?.filter(file => file.patientId === patientId)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, 3);
    const file = recent?.find(item => item.id === selected);
    return <section aria-label="Documenti recenti">
        <InkSectionHeading>Documenti recenti</InkSectionHeading>
        {error ? <p className={styles.readState} role="alert">Documenti non disponibili. <button type="button" className="mf-button-text" onClick={onRefresh}>Riprova</button></p>
            : loading || !recent ? <p className={styles.readState} role="status">Lettura documenti…</p>
                : recent.length ? <ul className={styles.sourceList}>
                    {recent.map((item, index) => <li key={item.id}>
                        <button type="button" className={styles.sourceButton} aria-label={isPrivacyMode ? `Apri originale del documento ${index + 1}` : `Apri originale: ${item.name}`} onClick={() => setSelected(item.id)}>
                            <FileText size={16} aria-hidden="true" /><PrivacyBlur>{item.name}</PrivacyBlur>
                        </button>
                    </li>)}
                </ul> : <p className={styles.readState}>Nessun documento registrato.</p>}
        {file && !loading && !error ? <DocumentOriginal key={file.id} patientId={patientId} attachment={file} inline={false}
            onClose={() => { setSelected(null); onCloseSource?.(); }}
            onRefreshList={() => { setSelected(null); onRefresh(); }} /> : null}
        {archiveLink && (data?.length ?? 0) > 0 ? <a className="mf-button-text" href="#documenti">Archivio documenti</a> : null}
    </section>;
}
