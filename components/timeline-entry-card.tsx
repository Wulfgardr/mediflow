import { format } from 'date-fns';
import { scaleHistoryNotice } from '@/lib/scale-history'; // MF085-002

import { it } from 'date-fns/locale';
import { ClinicalEntry, Attachment, db } from '@/lib/db';
import { FileText, Stethoscope, Activity, Trash2, AlertCircle, Undo, Phone, Home, Building2, Paperclip, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PatientSheetMenu } from '@/components/patient-sheet-menu';
import { InkState } from '@/components/ui/ink-state';
import { readPatientDiaryMetadata } from '@/lib/patient-diary-metadata';
import { ClinicalRichTextContent } from '@/components/clinical-rich-text-content';
import PrivacyBlur from '@/components/privacy-blur';
import { useLiveQuery } from '@/lib/live-query';
import { LumeFilo, LumeFiloNodo } from '@/components/ui/lume-filo';
/* a reading-led diary presentation uses the same entry and actions. */
import { useRuntimeTwinDesign } from '@/components/runtime-twin-design';
import twin from './twin-diary.module.css';

export type TimelineEntryData = ClinicalEntry & { patientName?: string };

type EntryPresentation = {
    author?: string;
    draft: boolean;
    source: string;
    stateLabel: string;
};

const TYPE_ICONS: Record<string, React.ElementType> = {
    'visit': Stethoscope,
    'remote': Phone,
    'note': FileText,
    'scale': Activity
};

const TYPE_LABELS: Record<string, string> = {
    'visit': 'Visita',
    'remote': 'Remoto',
    'note': 'Nota',
    'scale': 'Scala'
};

const PATIENT_TYPE_LABELS: Record<string, string> = {
    'phone': 'Telefonata',
    'exam': 'Esame',
    'hospitalization': 'Ricovero',
    'access': 'Accesso'
};

function firstMetadataText(metadata: unknown, keys: string[]): string | undefined {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
    const record = metadata as Record<string, unknown>;
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
}

function presentEntry(entry: TimelineEntryData): EntryPresentation {
    const workflowState = firstMetadataText(entry.metadata, ['workflowStatus', 'status'])?.toLocaleLowerCase('it-IT');
    const draft = workflowState === 'draft' || workflowState === 'bozza';
    const signed = workflowState === 'signed' || workflowState === 'firmata';
    const settingSource = entry.setting === 'home'
        ? 'Assistenza domiciliare'
        : entry.setting === 'hospital'
            ? 'Ospedale'
            : entry.setting === 'ambulatory'
                ? 'Ambulatorio'
                : undefined;

    return {
        author: firstMetadataText(entry.metadata, ['authorName', 'author', 'signedBy']),
        draft,
        source: firstMetadataText(entry.metadata, ['sourceLabel', 'source']) ?? settingSource ?? 'Diario locale',
        stateLabel: entry.deletedAt ? 'Eliminata' : draft ? 'Bozza' : signed ? 'Firmata' : 'Registrata',
    };
}

function EntryAttachments({ attachmentIds, onView }: { attachmentIds: string[], onView: (file: Attachment) => void }) {
    const attachments = useLiveQuery(
        async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await db.attachments.filter((a: any) => attachmentIds.includes(a.id)).toArray();
        },
        [attachmentIds],
        undefined,
        ['attachments'],
    );

    if (!attachments?.length) return null;

    return (
        <div className="relative mt-4 pl-5">
            <LumeFilo variant="connettore" fill={100} className="absolute left-0 top-0 h-4 w-5" />
            <div className="grid grid-cols-1 gap-2 border-t border-[color:var(--lume-border-color)] pt-3 sm:grid-cols-2">
                {attachments.map(file => (
                    <button
                        key={file.id}
                        onClick={() => onView(file)}
                        className="mf-option-card !flex !grid-cols-none items-center gap-2 !rounded-[14px] !p-2 text-left"
                    >
                        <div className="mf-icon-disc h-7 w-7 !rounded-[10px]">
                            <Paperclip className="w-3 h-3" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold truncate">{file.name}</p>
                            <p className="text-xs" style={{ color: 'var(--lume-ink-muted)' }}>Allegato</p>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

interface TimelineEntryCardProps {
    entry: TimelineEntryData;
    patientDiary?: boolean;
    active?: boolean;
    position?: number;
    setSize?: number;
    onActivate?: () => void;
    onDelete?: (entry: TimelineEntryData) => void;
    onRestore?: (entry: TimelineEntryData) => void;
    onViewAttachment?: (file: Attachment) => void;
}

export function TimelineEntryCard({
    entry,
    patientDiary = false,
    active = false,
    position,
    setSize,
    onActivate,
    onDelete,
    onRestore,
    onViewAttachment,
}: TimelineEntryCardProps) {
    const { proposal } = useRuntimeTwinDesign();
    const diaryPresentation = proposal && patientDiary;
    const isDeleted = !!entry.deletedAt;
    const Icon = TYPE_ICONS[entry.type] || FileText;
    const diaryMetadata = diaryPresentation ? readPatientDiaryMetadata(entry.metadata) : null;
    const metadataUnreadable = diaryMetadata?.state === 'unreadable';
    const workflowStatus = firstMetadataText(diaryMetadata?.value, ['workflowStatus', 'status'])?.toLocaleLowerCase('it-IT');
    const stateRecognized = !workflowStatus || ['draft', 'bozza', 'signed', 'firmata', 'registered', 'registrata'].includes(workflowStatus);
    const settingLabel = entry.setting === 'home' ? 'Assistenza domiciliare' : entry.setting === 'hospital' ? 'Ospedale' : entry.setting === 'ambulatory' ? 'Ambulatorio' : undefined;
    const basePresentation = presentEntry(diaryMetadata ? { ...entry, metadata: diaryMetadata.value } : entry);
    const stateKnown = isDeleted || (!metadataUnreadable && stateRecognized);
    const presentation = { ...basePresentation,
        source: metadataUnreadable ? 'Non leggibile' : basePresentation.source,
        stateLabel: isDeleted ? basePresentation.stateLabel : metadataUnreadable ? 'Stato non leggibile' : !stateRecognized ? 'Stato non riconosciuto' : basePresentation.stateLabel,
    };

    return (
        <article
            className={`group relative pl-8 outline-none ${proposal ? twin.entry : ''} ${diaryPresentation ? twin.patientEntry : ''} ${isDeleted ? 'opacity-60 grayscale' : ''}`}
            data-active={active ? 'true' : 'false'}
            data-lume-entry-state={presentation.draft ? 'draft' : 'settled'}
            aria-current={active ? 'true' : undefined}
            aria-posinset={position}
            aria-setsize={setSize}
            tabIndex={0}
            onClick={onActivate}
            onFocus={onActivate}
        >
            {!proposal && <LumeFiloNodo
                data-lume-timeline-node
                className="absolute -left-2 top-0 h-4 w-4"
                fillTone={isDeleted ? 'critical' : 'field'}
                tone={isDeleted ? 'critical' : 'accent'}
            />}

            {diaryPresentation ? <time className={twin.margin} dateTime={new Date(entry.date).toISOString()}>
                <span>{format(new Date(entry.date), 'dd MMM yyyy', { locale: it })}</span>
                <span>{format(new Date(entry.date), 'HH:mm', { locale: it })}</span>
            </time> : null}

            {/* Content */}
            <div className={`rounded-[var(--lume-radius-card)] p-5 group-focus-visible:shadow-[var(--lume-focus-ring)] ${isDeleted ? 'border border-[color:var(--lume-signal-critical)] bg-[color:var(--lume-surface-field)]' : active && !proposal ? 'lume-focal' : 'bg-[color:var(--lume-surface-field)]'}`}>
                <div className={`flex justify-between items-start mb-3 ${proposal ? twin.header : ''}`}>
                    <div className="flex items-center gap-2">
                        {!proposal && <div className={`mf-icon-disc h-8 w-8 !rounded-[12px] ${isDeleted ? '!text-[color:var(--lume-signal-critical)]' : ''}`}>
                            <Icon className="w-4 h-4" />
                        </div>}
                        <div className={proposal ? twin.identity : undefined}>
                            <span className="block text-xs font-semibold uppercase" style={{ color: isDeleted ? 'var(--lume-signal-critical)' : 'var(--lume-accent)' }}>
                                {TYPE_LABELS[entry.type] || (diaryPresentation ? PATIENT_TYPE_LABELS[entry.type] : undefined) || (proposal && entry.type === 'phone' ? 'Telefonata' : entry.type)}
                                {entry.patientName && <span className="ml-1 font-normal normal-case" style={{ color: 'var(--lume-ink-muted)' }}> - <PrivacyBlur>{entry.patientName}</PrivacyBlur></span>}
                            </span>
                            <div className="lume-registro mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--lume-ink-muted)' }}>
                                {!diaryPresentation ? <span className="rounded-md border border-[color:var(--lume-border-color)] px-1.5 py-0.5 font-semibold uppercase">
                                    {presentation.stateLabel}
                                </span> : null}
                                {!diaryPresentation ? <span className="lume-registro">{format(new Date(entry.date), 'dd MMMM yyyy HH:mm', { locale: it })}</span> : null}
                                {diaryPresentation && settingLabel && settingLabel !== presentation.source ? <span>{settingLabel}</span> : null}
                                <span>{proposal && !diaryPresentation ? '' : 'Fonte: '}{presentation.source}</span>
                                {presentation.author && !diaryPresentation ? <span>Autore: {presentation.author}</span> : null}
                                {!proposal && entry.setting && (
                                    <span className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${entry.setting === 'home' ? 'border-[color:var(--lume-signal-warning)] text-[color:var(--lume-signal-warning)]' : 'border-[color:var(--lume-signal-success)] text-[color:var(--lume-signal-success)]'}`}>
                                        {entry.setting === 'home' ? <Home className="w-3 h-3" /> : <Building2 className="w-3 h-3" />}
                                        {entry.setting === 'home' ? 'Dom' : 'Amb'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {diaryPresentation ? <div className="shrink-0">
                        {isDeleted ? onRestore && <Button variant="text" onClick={() => onRestore(entry)} aria-label="Ripristina voce clinica"><Undo size={16} aria-hidden />Ripristina</Button>
                            : onDelete && <PatientSheetMenu label={`Azioni voce ${entry.title || 'clinica'}`}
                                trigger={props => <Button {...props} variant="icon" aria-label={`Azioni voce ${entry.title || 'clinica'}`}><MoreHorizontal size={16} aria-hidden /></Button>}>
                                <button type="button" role="menuitem" onClick={() => onDelete(entry)}>Elimina voce clinica con motivazione</button>
                            </PatientSheetMenu>}
                    </div> : <>
                    {/* Actions */}
                    <div className="flex items-center gap-2">
                        {isDeleted ? (
                            onRestore && (
                                <button
                                    onClick={() => onRestore(entry)}
                                    className="mf-btn-secondary !p-1.5 !text-[color:var(--lume-signal-success)]"
                                    title="Ripristina"
                                    aria-label="Ripristina voce clinica"
                                >
                                    <Undo className="w-4 h-4" />
                                </button>
                            )
                        ) : (
                            onDelete && (
                                <button
                                    onClick={() => onDelete(entry)}
                                    className="mf-btn-secondary !border-transparent !bg-transparent !p-1.5 !text-[color:var(--lume-ink-muted)] hover:!text-[color:var(--lume-signal-critical)]"
                                    title="Elimina con motivazione"
                                    aria-label="Elimina voce clinica con motivazione"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )
                        )}
                    </div>
                    </>}

                </div>

                {/* Deleted Reason Banner */}
                {isDeleted && (
                    <div className="mf-alert mf-alert-critical mb-3 !flex items-start gap-2 text-xs">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                            <span className="font-semibold">ELIMINATO: </span>
                            {/* Window check to prevent hydration mismatch if SSR (though this is Client Component) */}
                            {typeof window !== 'undefined' && <span className="italic">{entry.deletionReason}</span>}
                            <div className="text-xs opacity-70 mt-0.5">
                                {entry.deletedAt && <span className="lume-registro">{format(new Date(entry.deletedAt), 'dd/MM/yyyy HH:mm', { locale: it })}</span>}
                            </div>
                        </div>
                    </div>
                )}

                {diaryPresentation && entry.title ? <h4 className={twin.entryTitle}><PrivacyBlur>{entry.title}</PrivacyBlur></h4> : null}

                {/* Main Text Content */}
                <div style={{ color: presentation.draft ? 'var(--lume-ink-muted)' : 'var(--lume-ink)' }}>
                    <PrivacyBlur>
                        <ClinicalRichTextContent content={entry.content} className="prose prose-sm max-w-none prose-p:leading-relaxed dark:prose-invert" />
                    </PrivacyBlur>
                </div>

                {diaryPresentation ? <div className={twin.registration}>
                    {stateKnown ? <InkState state={presentation.draft ? 'fresh' : 'dry'}>{presentation.stateLabel}</InkState> : <span>{presentation.stateLabel}</span>}
                    {presentation.author ? <span>Autore: {presentation.author}</span> : null}
                </div> : null}

                {metadataUnreadable ? <p className={twin.metadataNotice} role="status">Metadati della voce non leggibili. Autore, fonte e stato non verificabili.</p> : null}

                {/* Attachments List */}
                {entry.attachments && entry.attachments.length > 0 && !isDeleted && onViewAttachment && (
                    <EntryAttachments attachmentIds={entry.attachments} onView={onViewAttachment} />
                )}

                {/* MF085-002: descriptive provenance; never recompute a recorded score. */}
                {entry.type === 'scale' && scaleHistoryNotice(entry.metadata, entry.title) && (
                    <p className="mt-3 text-xs text-[color:var(--lume-ink-muted)]" data-testid="scale-provenance-notice">
                        {scaleHistoryNotice(entry.metadata, entry.title)}
                    </p>
                )}

                {/* Scale Metadata Viz */}
                {entry.metadata?.score !== undefined && (
                    <div className="mf-alert mf-alert-info mt-3 !flex items-center justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase">{entry.metadata.title as string}</p>
                            <div className="text-sm font-medium">
                                <PrivacyBlur>{entry.metadata.interpretation as string}</PrivacyBlur>
                            </div>
                        </div>
                        <div className="text-lg font-semibold">
                            {entry.metadata.score as number}
                        </div>
                    </div>
                )}
            </div>
        </article>
    );
}
