'use client';

import { db, Attachment } from '@/lib/db';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import DocumentViewer from './document-viewer';
import { TimelineEntryCard, TimelineEntryData } from './timeline-entry-card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast-provider';
import { LumeFilo } from '@/components/ui/lume-filo';

interface TimelineProps {
    entries: TimelineEntryData[];
}

export default function Timeline({ entries }: TimelineProps) {
    const [showDeleted, setShowDeleted] = useState(false);
    const [viewingFile, setViewingFile] = useState<Attachment | null>(null);
    const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
    const confirm = useConfirm();
    const { showToast } = useToast();

    const handleDelete = async (entry: TimelineEntryData) => {
        /* @Codex WUL-UIUX: motivazione obbligatoria raccolta in un dialogo
           accessibile e tematizzato, non piu con prompt() nativo. */
        const result = await confirm({
            title: 'Elimina voce clinica',
            message: "La voce verra spostata nel cestino. Indica la motivazione, richiesta per l'audit clinico.",
            tone: 'danger',
            confirmLabel: 'Elimina',
            requireReason: true,
            reasonLabel: 'Motivazione eliminazione',
            reasonPlaceholder: 'Es. errore di inserimento, duplicato...',
        });
        if (!result.confirmed || !result.reason) return;

        try {
            if (typeof entry.version !== 'number') {
                showToast('Versione voce clinica non disponibile. Ricarica la pagina e riprova.', 'error');
                return;
            }
            await db.entries.delete(entry.id, {
                version: entry.version,
                deletionReason: result.reason,
            });
            showToast('Voce spostata nel cestino.', 'success');
        } catch (error) {
            console.error('Delete failed', error);
            showToast("Errore nell'eliminazione della voce.", 'error');
        }
    };

    const handleRestore = async (entry: TimelineEntryData) => {
        const result = await confirm({
            title: 'Ripristina voce',
            message: 'Vuoi ripristinare questa voce clinica dal cestino?',
            confirmLabel: 'Ripristina',
        });
        if (!result.confirmed) return;

        try {
            if (typeof entry.version !== 'number') {
                showToast('Versione voce clinica non disponibile. Ricarica la pagina e riprova.', 'error');
                return;
            }
            await db.entries.update(entry.id, {
                deletedAt: null,
                deletionReason: null,
                version: entry.version,
            });
            showToast('Voce ripristinata.', 'success');
        } catch (error) {
            console.error('Restore failed', error);
            showToast('Errore nel ripristino della voce.', 'error');
        }
    };

    // Filter logic
    const visibleEntries = showDeleted
        ? entries
        : entries.filter(e => !e.deletedAt);
    const resolvedActiveEntryId = visibleEntries.some((entry) => entry.id === activeEntryId)
        ? activeEntryId
        : visibleEntries[0]?.id;

    const auditToggle = (
        <button
            onClick={() => setShowDeleted(!showDeleted)}
            className="text-xs flex items-center gap-1 text-[color:var(--lume-ink-muted)] transition-colors hover:text-[color:var(--lume-ink)]"
        >
            {showDeleted ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showDeleted ? "Nascondi eliminati" : "Mostra cestino / audit"}
        </button>
    );

    if (!visibleEntries.length) {
        return (
            <div className="space-y-4">
                <div className="flex justify-end">{auditToggle}</div>
                <div className="text-center py-10 italic text-[color:var(--lume-ink-muted)]">Nessuna voce visibile nel diario clinico.</div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-end">{auditToggle}</div>

            <div
                className="relative ml-3 space-y-3 pb-8"
                role="feed"
                aria-label="Diario clinico del paziente"
            >
                <LumeFilo
                    variant="spina"
                    nodeCount={visibleEntries.length}
                    anchorSelector="[data-lume-timeline-node]"
                    className="absolute left-[-0.5px] w-px"
                />
                {visibleEntries.map((entry, index) => (
                    <TimelineEntryCard
                        key={entry.id}
                        entry={entry}
                        active={entry.id === resolvedActiveEntryId}
                        position={index + 1}
                        setSize={visibleEntries.length}
                        onActivate={() => setActiveEntryId(entry.id)}
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
