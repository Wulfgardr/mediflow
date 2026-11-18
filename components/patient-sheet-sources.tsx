'use client';

import { useCallback } from 'react';
import { FileText } from 'lucide-react';
import { DocumentOriginal } from './document-upload';
import { InkSectionHeading } from './ui/ink-state';
import PrivacyBlur from './privacy-blur';
import { usePrivacy } from './privacy-provider';
import { ClinicalRichTextContent } from './clinical-rich-text-content';
import { diaryTypeLabel } from '@/lib/patient-sheet-activity';
import { SheetDate } from './patient-sheet-activity';
import { recordDate } from '@/lib/patient-therapy-changes';
import type { Attachment, ClinicalEntry } from '@/lib/db';
import styles from './twin-synoptic-sheet.module.css';

export type SheetSource = { kind: 'entry' | 'document'; id: string };
export type SheetSourceSelection = { source: SheetSource | null; select: (source: SheetSource) => void; close: () => void };

export function PatientSheetSources({ patientId, selection, entries, data, loading, error, onRefresh, onCloseSource, archiveLink, closeLabel }: {
    patientId: string;
    selection: SheetSourceSelection;
    entries?: ClinicalEntry[];
    data: Attachment[] | undefined;
    loading: boolean;
    error: unknown;
    onRefresh: () => void;
    onCloseSource?: () => void;
    archiveLink?: boolean;
    closeLabel?: string;
}) {
    const { isPrivacyMode } = usePrivacy();
    const { source, select, close } = selection;
    const files = data?.filter(file => file.patientId === patientId);
    const recent = files?.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).slice(0, 3);
    const file = !loading && !error && source?.kind === 'document' ? files?.find(item => item.id === source.id) : undefined;
    const entry = source?.kind === 'entry' ? entries?.find(item => item.id === source.id && item.patientId === patientId && !item.deletedAt) : undefined;
    const registered = recordDate(entry?.createdAt);
    const pane = useCallback((element: HTMLDivElement | null) => { if (source) element?.focus(); }, [source]);
    const closePane = () => { close(); onCloseSource?.(); };
    return <section aria-label="Documenti recenti" data-source-open={Boolean(source)}>
        {source ? <div ref={pane} tabIndex={-1} className={styles.sourcePane}>
            {file ? <DocumentOriginal key={file.id} patientId={patientId} attachment={file} closeLabel={closeLabel}
                onClose={closePane} onRefreshList={() => { closePane(); onRefresh(); }} />
                : <>
                    <button type="button" className="mf-button-secondary" onClick={closePane}>{closeLabel ?? 'Chiudi'}</button>
                    {entry ? <section aria-label="Voce del diario">
                        <InkSectionHeading><PrivacyBlur>{entry.title}</PrivacyBlur></InkSectionHeading>
                        <p>{diaryTypeLabel(entry.type)}{registered ? <> · Registrata il <SheetDate date={registered} /></> : null}
                            {entry.recordedBy ? <> · <PrivacyBlur>{entry.recordedBy}</PrivacyBlur></> : null}</p>
                        <PrivacyBlur><ClinicalRichTextContent content={entry.content} /></PrivacyBlur>
                    </section> : <p role="status">Fonte non disponibile.</p>}
                </>}
        </div> : null}
        <InkSectionHeading>Documenti recenti</InkSectionHeading>
        {error ? <p className={styles.readState} role="alert">Documenti non disponibili. <button type="button" className="mf-button-text" onClick={onRefresh}>Riprova</button></p>
            : loading || !recent ? <p className={styles.readState} role="status">Lettura documenti…</p>
                : recent.length ? <ul className={styles.sourceList}>
                    {recent.map((item, index) => <li key={item.id}>
                        <button type="button" className={styles.sourceButton} aria-label={isPrivacyMode ? `Apri originale del documento ${index + 1}` : `Apri originale: ${item.name}`} onClick={() => select({ kind: 'document', id: item.id })}>
                            <FileText size={16} aria-hidden="true" /><PrivacyBlur>{item.name}</PrivacyBlur>
                        </button>
                    </li>)}
                </ul> : <p className={styles.readState}>Nessun documento registrato.</p>}
        {archiveLink && (data?.length ?? 0) > 0 ? <a className="mf-button-text" href="#documenti">Archivio documenti</a> : null}
    </section>;
}
