import { format } from 'date-fns';
import { scaleHistoryNotice } from '@/lib/scale-history'; // @Codex MF085-002

import { it } from 'date-fns/locale';
import { ClinicalEntry, Attachment, db } from '@/lib/db';
import { FileText, Stethoscope, Activity, Trash2, AlertCircle, Undo, Phone, Home, Building2, Paperclip } from 'lucide-react';
/* @Codex */
import { ClinicalRichTextContent } from '@/components/clinical-rich-text-content';
import PrivacyBlur from '@/components/privacy-blur';
import { useLiveQuery } from '@/lib/live-query';
import { LumeFilo, LumeFiloNodo } from '@/components/ui/lume-filo';

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
    /* @Codex */
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
                            <p className="text-xs font-bold truncate">{file.name}</p>
                            <p className="text-[10px]" style={{ color: 'var(--lume-ink-muted)' }}>{file.summarySnapshot ? 'Analisi IA disponibile' : 'Allegato'}</p>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

interface TimelineEntryCardProps {
    entry: TimelineEntryData;
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
    active = false,
    position,
    setSize,
    onActivate,
    onDelete,
    onRestore,
    onViewAttachment,
}: TimelineEntryCardProps) {
    const isDeleted = !!entry.deletedAt;
    const Icon = TYPE_ICONS[entry.type] || FileText;
    const presentation = presentEntry(entry);

    return (
        <article
            className={`group relative pl-8 outline-none ${isDeleted ? 'opacity-60 grayscale' : ''}`}
            data-active={active ? 'true' : 'false'}
            data-lume-entry-state={presentation.draft ? 'draft' : 'settled'}
            aria-current={active ? 'true' : undefined}
            aria-posinset={position}
            aria-setsize={setSize}
            tabIndex={0}
            onClick={onActivate}
            onFocus={onActivate}
        >
            <LumeFiloNodo
                data-lume-timeline-node
                className="absolute -left-2 top-0 h-4 w-4"
                fillTone={isDeleted ? 'critical' : 'field'}
                tone={isDeleted ? 'critical' : 'accent'}
            />

            {/* Content */}
            <div className={`rounded-[var(--lume-radius-card)] p-5 group-focus-visible:shadow-[var(--lume-focus-ring)] ${isDeleted ? 'border border-[color:var(--lume-signal-critical)] bg-[color:var(--lume-surface-field)]' : active ? 'lume-focal' : 'bg-[color:var(--lume-surface-field)]'}`}>
                <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                        <div className={`mf-icon-disc h-8 w-8 !rounded-[12px] ${isDeleted ? '!text-[color:var(--lume-signal-critical)]' : ''}`}>
                            <Icon className="w-4 h-4" />
                        </div>
                        <div>
                            <span className="block text-xs font-bold uppercase" style={{ color: isDeleted ? 'var(--lume-signal-critical)' : 'var(--lume-accent)' }}>
                                {TYPE_LABELS[entry.type] || entry.type}
                                {entry.patientName && <span className="ml-1 font-normal normal-case" style={{ color: 'var(--lume-ink-muted)' }}> - {entry.patientName}</span>}
                            </span>
                            <div className="lume-registro mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--lume-ink-muted)' }}>
                                <span className="rounded-md border border-[color:var(--lume-border-color)] px-1.5 py-0.5 font-semibold uppercase">
                                    {presentation.stateLabel}
                                </span>
                                <span className="lume-registro">{format(new Date(entry.date), 'dd MMMM yyyy HH:mm', { locale: it })}</span>
                                <span>Fonte: {presentation.source}</span>
                                {presentation.author ? <span>Autore: {presentation.author}</span> : null}
                                {entry.setting && (
                                    <span className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${entry.setting === 'home' ? 'border-[color:var(--lume-signal-warning)] text-[color:var(--lume-signal-warning)]' : 'border-[color:var(--lume-signal-success)] text-[color:var(--lume-signal-success)]'}`}>
                                        {entry.setting === 'home' ? <Home className="w-3 h-3" /> : <Building2 className="w-3 h-3" />}
                                        {entry.setting === 'home' ? 'Dom' : 'Amb'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

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
                                    className="mf-btn-secondary !p-1.5 hover:!text-[color:var(--lume-signal-critical)]"
                                    title="Elimina con motivazione"
                                    aria-label="Elimina voce clinica con motivazione"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )
                        )}
                    </div>
                </div>

                {/* Deleted Reason Banner */}
                {isDeleted && (
                    <div className="mf-alert mf-alert-critical mb-3 !flex items-start gap-2 text-xs">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                            <span className="font-bold">ELIMINATO: </span>
                            {/* Window check to prevent hydration mismatch if SSR (though this is Client Component) */}
                            {typeof window !== 'undefined' && <span className="italic">{entry.deletionReason}</span>}
                            <div className="text-[10px] opacity-70 mt-0.5">
                                {entry.deletedAt && <span className="lume-registro">{format(new Date(entry.deletedAt), 'dd/MM/yyyy HH:mm', { locale: it })}</span>}
                            </div>
                        </div>
                    </div>
                )}

                {/* Main Text Content */}
                <div style={{ color: presentation.draft ? 'var(--lume-ink-muted)' : 'var(--lume-ink)' }}>
                    <PrivacyBlur>
                        {/* @Codex */}
                        <ClinicalRichTextContent content={entry.content} className="prose prose-sm max-w-none prose-p:leading-relaxed dark:prose-invert" />
                    </PrivacyBlur>
                </div>

                {/* Attachments List */}
                {entry.attachments && entry.attachments.length > 0 && !isDeleted && onViewAttachment && (
                    <EntryAttachments attachmentIds={entry.attachments} onView={onViewAttachment} />
                )}

                {/* @Codex MF085-002: descriptive provenance; never recompute a recorded score. */}
                {entry.type === 'scale' && scaleHistoryNotice(entry.metadata, entry.title) && (
                    <p className="mt-3 text-xs text-[color:var(--lume-ink-muted)]" data-testid="scale-provenance-notice">
                        {scaleHistoryNotice(entry.metadata, entry.title)}
                    </p>
                )}

                {/* Scale Metadata Viz */}
                {entry.metadata?.score !== undefined && (
                    <div className="mf-alert mf-alert-info mt-3 !flex items-center justify-between">
                        <div>
                            <p className="text-xs font-bold uppercase">{entry.metadata.title as string}</p>
                            <div className="text-sm font-medium">
                                <PrivacyBlur>{entry.metadata.interpretation as string}</PrivacyBlur>
                            </div>
                        </div>
                        <div className="text-2xl font-bold">
                            {entry.metadata.score as number}
                        </div>
                    </div>
                )}
            </div>
        </article>
    );
}
