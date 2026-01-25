import { db, Attachment } from '@/lib/db';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import DocumentViewer from './document-viewer';
import { TimelineEntryCard, TimelineEntryData } from './timeline-entry-card';

interface TimelineProps {
    entries: TimelineEntryData[];
}

export default function Timeline({ entries }: TimelineProps) {
    const [showDeleted, setShowDeleted] = useState(false);
    const [viewingFile, setViewingFile] = useState<Attachment | null>(null);

    const handleDelete = async (entry: TimelineEntryData) => {
        const reason = prompt("Motivazione dell'eliminazione (obbligatoria):");
        if (reason === null) return; // Cancelled
        if (!reason.trim()) {
            alert("La motivazione è obbligatoria per eliminare una voce clinica.");
            return;
        }

        try {
            await db.entries.update(entry.id, {
                deletedAt: new Date(),
                deletionReason: reason
            });
        } catch (error) {
            console.error("Delete failed", error);
            alert("Errore nell'eliminazione.");
        }
    };

    const handleRestore = async (entry: TimelineEntryData) => {
        if (confirm("Ripristinare questa voce?")) {
            await db.entries.update(entry.id, {
                deletedAt: undefined,
                deletionReason: undefined
            });
        }
    };

    // Filter logic
    const visibleEntries = showDeleted
        ? entries
        : entries.filter(e => !e.deletedAt);

    if (!visibleEntries.length) {
        return (
            <div className="space-y-4">
                <div className="flex justify-end">
                    <button
                        onClick={() => setShowDeleted(!showDeleted)}
                        className="text-xs flex items-center gap-1 text-gray-500 hover:text-indigo-600 transition-colors"
                    >
                        {showDeleted ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        {showDeleted ? "Nascondi Eliminati" : "Mostra Cestino / Audit"}
                    </button>
                </div>
                <div className="text-center py-10 text-gray-400 dark:text-gray-500 italic">Nessuna voce visibile nel diario clinico.</div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-end">
                <button
                    onClick={() => setShowDeleted(!showDeleted)}
                    className="text-xs flex items-center gap-1 text-gray-500 hover:text-indigo-600 transition-colors"
                >
                    {showDeleted ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {showDeleted ? "Nascondi Eliminati" : "Mostra Cestino / Audit"}
                </button>
            </div>

            <div className="relative border-l-2 border-indigo-100 dark:border-white/10 ml-3 space-y-8 pb-8">
                {visibleEntries.map((entry) => (
                    <TimelineEntryCard
                        key={entry.id}
                        entry={entry}
                        onDelete={handleDelete}
                        onRestore={handleRestore}
                        onViewAttachment={setViewingFile}
                    />
                ))}
            </div>

            {/* Document Viewer Modal */}
            {viewingFile && viewingFile.data && (
                <DocumentViewer
                    file={viewingFile.data}
                    fileName={viewingFile.name}
                    onClose={() => setViewingFile(null)}
                />
            )}
        </div>
    );
}
