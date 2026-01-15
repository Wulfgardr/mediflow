'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, X, Eye, Loader2 } from 'lucide-react';
import { db, Attachment } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { cn } from '@/lib/utils';
import { useLiveQuery } from 'dexie-react-hooks';
import { extractTextFromPdf, parsePatientData } from '@/lib/pdf-service';
import DocumentViewer from '@/components/document-viewer';

interface DocumentUploadProps {
    patientId: string;
}

export default function DocumentUpload({ patientId }: DocumentUploadProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [viewingFile, setViewingFile] = useState<Attachment | null>(null);

    const attachments = useLiveQuery(
        () => db.attachments.where('patientId').equals(patientId).reverse().sortBy('createdAt'),
        [patientId]
    );



    // Logic to update Patient AI Summary REMOVED to avoid conflict with AIPatientInsight

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        setIsProcessing(true);
        // Limit total files if needed, here we just process
        for (const file of acceptedFiles) {
            try {
                // Auto-extract analysis on upload
                let summary = "Nessuna informazione rilevante trovata.";

                if (file.type === 'application/pdf') {
                    const text = await extractTextFromPdf(file);
                    const data = parsePatientData(text);
                    if (data.notes) {
                        summary = data.notes; // "Diagnosi: ..."
                    } else {
                        // Fallback: take first 100 chars of text as simplistic summary? No, better keep it clean.
                        summary = "Analisi completata (nessuna diagnosi esplicita rilevata)";
                    }
                }

                await db.attachments.add({
                    id: uuidv4(),
                    patientId: patientId,
                    name: file.name,
                    type: file.type,
                    data: file,
                    summarySnapshot: summary,
                    source: 'manual',
                    createdAt: new Date()
                });

                // Trigger global update REMOVED

            } catch (e) {
                console.error("Upload failed", e);
                alert("Errore caricamento file: " + file.name);
            }
        }
        setIsProcessing(false);
    }, [patientId]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

    const handleDelete = async (id: string) => {
        if (confirm("Sei sicuro di voler eliminare questo documento?")) {
            await db.attachments.delete(id);
            // Re-calculate summary REMOVED
        }
    };

    return (
        <div className="space-y-6">

            {/* AI Summary Card REMOVED */}

            {/* Upload Zone */}
            <div
                {...getRootProps()}
                className={cn(
                    "border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all",
                    isDragActive
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/10"
                        : "border-gray-300 dark:border-white/10 hover:border-blue-400 hover:bg-gray-50 dark:hover:bg-white/5 bg-white/50 dark:bg-white/5"
                )}
            >
                <input {...getInputProps()} />
                <div className="p-3 bg-blue-100/50 rounded-full mb-3">
                    {isProcessing ? <Loader2 className="w-6 h-6 text-blue-600 animate-spin" /> : <Upload className="w-6 h-6 text-blue-600" />}
                </div>
                <p className="text-gray-700 dark:text-gray-200 font-medium text-sm">Carica Documenti</p>
                <p className="text-gray-400 text-xs mt-1">L&apos;IA estrarrà il contesto (max 10 file).</p>
            </div>

            {/* File List */}
            <div className="flex flex-col gap-3">
                {attachments?.map((file) => (
                    <div key={file.id} className="glass-card p-3 flex items-center gap-3 group hover:border-blue-300 dark:hover:border-blue-500/30 transition-colors">
                        <div className="p-2 bg-red-50 dark:bg-red-900/10 rounded-lg text-red-500 dark:text-red-400 border border-red-100 dark:border-white/5">
                            <FileText className="w-5 h-5" />
                        </div>

                        <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-gray-800 dark:text-gray-100 text-sm truncate">{file.name}</h4>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                {new Date(file.createdAt).toLocaleDateString()}
                            </p>
                            {file.summarySnapshot && (
                                <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5 truncate">
                                    AI: {file.summarySnapshot}
                                </p>
                            )}
                        </div>

                        <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                                onClick={() => setViewingFile(file)}
                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Visualizza"
                            >
                                <Eye className="w-4 h-4" />
                            </button>

                            <button
                                onClick={() => handleDelete(file.id)}
                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="Elimina"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Viewer Modal */}
            {viewingFile && (
                <DocumentViewer
                    file={viewingFile.data}
                    fileName={viewingFile.name}
                    onClose={() => setViewingFile(null)}
                />
            )}
        </div>
    );
}
