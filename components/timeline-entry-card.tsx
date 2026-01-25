import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { ClinicalEntry, Attachment, db } from '@/lib/db';
import { FileText, Stethoscope, Activity, Trash2, AlertCircle, Undo, Phone, Home, Building2, Paperclip } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import PrivacyBlur from '@/components/privacy-blur';
import { useLiveQuery } from 'dexie-react-hooks';

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
        <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {attachments.map(file => (
                <button
                    key={file.id}
                    onClick={() => onView(file)}
                    className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-gray-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-all text-left group"
                >
                    <div className="p-1.5 bg-white rounded border border-gray-100 group-hover:border-blue-100 text-gray-400 group-hover:text-blue-500">
                        <Paperclip className="w-3 h-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold truncate">{file.name}</p>
                        <p className="text-[10px] text-gray-400">{file.summarySnapshot ? 'Analisi IA disponibile' : 'Allegato'}</p>
                    </div>
                </button>
            ))}
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
            <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white ${isDeleted ? 'bg-red-400' : 'bg-indigo-600'}`}></div>

            {/* Content */}
            <div className={`bg-white rounded-2xl p-5 shadow-sm border ${isDeleted ? 'border-red-100 bg-red-50/30' : 'border-gray-100'}`}>
                <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${isDeleted ? 'bg-red-100 text-red-600' : 'bg-indigo-50 text-indigo-600'}`}>
                            <Icon className="w-4 h-4" />
                        </div>
                        <div>
                            <span className="text-xs font-bold uppercase tracking-wider text-indigo-900 block">
                                {TYPE_LABELS[entry.type] || entry.type}
                                {entry.patientName && <span className="text-gray-400 font-normal normal-case ml-1"> - {entry.patientName}</span>}
                            </span>
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                                <span>{format(new Date(entry.date), 'dd MMMM yyyy HH:mm', { locale: it })}</span>
                                {entry.setting && (
                                    <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${entry.setting === 'home' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
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
                                    className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                    title="Ripristina"
                                >
                                    <Undo className="w-4 h-4" />
                                </button>
                            )
                        ) : (
                            onDelete && (
                                <button
                                    onClick={() => onDelete(entry)}
                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Elimina con motivazione"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )
                        )}
                    </div>
                </div>

                {/* Deleted Reason Banner */}
                {isDeleted && (
                    <div className="mb-3 p-2 bg-red-100 rounded-lg text-xs text-red-800 flex items-start gap-2 border border-red-200">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                            <span className="font-bold">ELIMINATO: </span>
                            {/* Window check to prevent hydration mismatch if SSR (though this is Client Component) */}
                            {typeof window !== 'undefined' && <span className="italic">{entry.deletionReason}</span>}
                            <div className="text-[10px] opacity-70 mt-0.5">
                                {entry.deletedAt && format(new Date(entry.deletedAt), 'dd/MM/yyyy HH:mm', { locale: it })}
                            </div>
                        </div>
                    </div>
                )}

                {/* Main Text Content */}
                <div className="prose prose-sm max-w-none text-gray-600 prose-p:leading-relaxed">
                    <PrivacyBlur>
                        <ReactMarkdown>{entry.content}</ReactMarkdown>
                    </PrivacyBlur>
                </div>

                {/* Attachments List */}
                {entry.attachments && entry.attachments.length > 0 && !isDeleted && onViewAttachment && (
                    <EntryAttachments attachmentIds={entry.attachments} onView={onViewAttachment} />
                )}

                {/* Scale Metadata Viz */}
                {entry.metadata?.score !== undefined && (
                    <div className="mt-3 p-3 bg-blue-50/50 rounded-xl border border-blue-100 flex items-center justify-between">
                        <div>
                            <p className="text-xs text-blue-800 font-bold uppercase">{entry.metadata.title as string}</p>
                            <div className="text-sm text-blue-900 font-medium">
                                <PrivacyBlur>{entry.metadata.interpretation as string}</PrivacyBlur>
                            </div>
                        </div>
                        <div className="text-2xl font-bold text-blue-600">
                            {entry.metadata.score as number}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
