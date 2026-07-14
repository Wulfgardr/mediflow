import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { ClinicalEntry, Attachment, db } from '@/lib/db';
import { FileText, Stethoscope, Activity, Trash2, AlertCircle, Undo, Phone, Home, Building2, Paperclip } from 'lucide-react';
/* @Codex */
import { ClinicalRichTextContent } from '@/components/clinical-rich-text-content';
import PrivacyBlur from '@/components/privacy-blur';
import { useLiveQuery } from '@/lib/live-query';
import { LumeFilo } from '@/components/ui/lume-filo';

export type TimelineEntryData = ClinicalEntry & { patientName?: string };

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

function EntryAttachments({ attachmentIds, onView }: { attachmentIds: string[], onView: (file: Attachment) => void }) {
    const attachments = useLiveQuery(
        async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await db.attachments.filter((a: any) => attachmentIds.includes(a.id)).toArray();
        },
        [attachmentIds]
    );

    if (!attachments?.length) return null;

    return (
        <div className="relative mt-4 pl-5">
            <LumeFilo variant="connettore" fill={100} className="absolute left-0 top-0 h-4 w-5" />
            <div className="grid grid-cols-1 gap-2 border-t border-[color:rgba(112,106,100,0.12)] pt-3 sm:grid-cols-2">
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
                            <p className="text-[10px]" style={{ color: 'var(--mf-muted)' }}>{file.summarySnapshot ? 'Analisi IA disponibile' : 'Allegato'}</p>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

interface TimelineEntryCardProps {
    entry: TimelineEntryData;
    onDelete?: (entry: TimelineEntryData) => void;
    onRestore?: (entry: TimelineEntryData) => void;
    onViewAttachment?: (file: Attachment) => void;
}

export function TimelineEntryCard({ entry, onDelete, onRestore, onViewAttachment }: TimelineEntryCardProps) {
    const isDeleted = !!entry.deletedAt;
    const Icon = TYPE_ICONS[entry.type] || FileText;

    return (
        <div className={`relative pl-8 ${isDeleted ? 'opacity-60 grayscale' : ''}`}>
            {/* Dot */}
            <div data-lume-timeline-node className={`absolute -left-2 top-0 h-4 w-4 rounded-full border-2 border-[color:var(--mf-bg)] ${isDeleted ? 'bg-[color:var(--mf-critical)]' : 'bg-[color:var(--mf-primary)]'}`}></div>

            {/* Content */}
            <div className={`mf-section p-5 ${isDeleted ? 'border-[color:rgba(163,58,47,0.26)] bg-[color:rgba(163,58,47,0.08)]' : ''}`}>
                <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                        <div className={`mf-icon-disc h-8 w-8 !rounded-[12px] ${isDeleted ? '!text-[color:var(--mf-critical)]' : ''}`}>
                            <Icon className="w-4 h-4" />
                        </div>
                        <div>
                            <span className="block text-xs font-bold uppercase" style={{ color: isDeleted ? 'var(--mf-critical)' : 'var(--mf-primary)' }}>
                                {TYPE_LABELS[entry.type] || entry.type}
                                {entry.patientName && <span className="ml-1 font-normal normal-case" style={{ color: 'var(--mf-muted)' }}> - {entry.patientName}</span>}
                            </span>
                            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--mf-muted)' }}>
                                <span className="lume-registro">{format(new Date(entry.date), 'dd MMMM yyyy HH:mm', { locale: it })}</span>
                                {entry.setting && (
                                    <span className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${entry.setting === 'home' ? 'border-[color:rgba(197,138,47,0.28)] text-[color:var(--mf-warning)]' : 'border-[color:rgba(63,122,76,0.26)] text-[color:var(--mf-success)]'}`}>
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
                                    className="mf-btn-secondary !p-1.5 !text-[color:var(--mf-success)]"
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
                                    className="mf-btn-secondary !p-1.5 hover:!text-[color:var(--mf-critical)]"
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
                <div style={{ color: 'var(--mf-ink)' }}>
                    <PrivacyBlur>
                        {/* @Codex */}
                        <ClinicalRichTextContent content={entry.content} className="prose prose-sm max-w-none prose-p:leading-relaxed dark:prose-invert" />
                    </PrivacyBlur>
                </div>

                {/* Attachments List */}
                {entry.attachments && entry.attachments.length > 0 && !isDeleted && onViewAttachment && (
                    <EntryAttachments attachmentIds={entry.attachments} onView={onViewAttachment} />
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
        </div>
    );
}
