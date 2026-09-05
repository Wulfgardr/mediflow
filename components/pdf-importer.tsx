/* @Codex */
'use client';

import { useState, type ComponentType } from 'react';
import { useDropzone } from 'react-dropzone';
import { AlertCircle, FileText, Image as ImageIcon, ShieldCheck } from 'lucide-react';

import type { ExtractedPatientData } from '@/lib/pdf-service';
import { cn } from '@/lib/utils';

interface PdfImporterProps {
    onDataExtracted: (data: ExtractedPatientData) => void;
}

function PdfImporterUnavailable() {
    const [reviewMessage, setReviewMessage] = useState<string | null>(null);

    const onDrop = (acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        if (!file) return;
        setReviewMessage(
            'review_required · unsupported_local_extraction — il file deve prima essere salvato come allegato host-owned; dopo il salvataggio, avvia AnyDoc manualmente dalla cartella documenti.',
        );
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        maxFiles: 1,
        accept: {
            'application/pdf': ['.pdf'],
            'image/*': [],
        },
    });

    return (
        <div className="mb-8">
            <div
                {...getRootProps()}
                className={cn(
                    'relative cursor-pointer overflow-hidden rounded-[var(--lume-radius-card)] border bg-[color:var(--lume-surface-field)] p-6 transition-[background-color,border-color] duration-[var(--lume-dur-fuoco)] ease-[var(--lume-ease)]',
                    isDragActive
                        ? 'lume-focal border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] bg-[color:var(--lume-surface-focal)]'
                        : 'border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--lume-ink)_5%,var(--lume-surface-field))]',
                    reviewMessage && 'border-[color:color-mix(in_srgb,var(--lume-signal-warning)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_10%,var(--lume-surface-field))]',
                )}
            >
                <input {...getInputProps()} aria-label="Seleziona documento per revisione" />

                {reviewMessage ? (
                    <div className="flex flex-col items-center justify-center py-4 text-center text-[color:color-mix(in_srgb,var(--lume-signal-warning)_65%,var(--lume-ink))]" role="status">
                        <AlertCircle className="mb-2 h-8 w-8" />
                        <p className="font-bold">Revisione documentale richiesta</p>
                        <p className="mt-1 max-w-xl text-xs">{reviewMessage}</p>
                    </div>
                ) : (
                    <div className="flex items-center gap-4">
                        <div className="shrink-0 rounded-lg bg-[color:color-mix(in_srgb,var(--lume-accent)_11%,var(--lume-surface-field))] p-3">
                            <ShieldCheck className="h-6 w-6 text-[color:var(--lume-accent)]" />
                        </div>
                        <div>
                            <h3 className="flex flex-wrap items-center gap-2 font-bold text-[color:var(--lume-ink)]">
                                Documento prima della creazione del record
                                <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] px-2 py-0.5 text-xs font-normal text-[color:color-mix(in_srgb,var(--lume-signal-warning)_65%,var(--lume-ink))]">
                                    sola revisione
                                </span>
                            </h3>
                            <p className="text-sm text-[color:var(--lume-ink-muted)]">
                                Nessuna estrazione da File grezzo: anche un PDF con testo nativo deve prima essere salvato come allegato, poi elaborato con AnyDoc su gesto esplicito.
                            </p>
                            <div className="mt-1 flex flex-wrap gap-3 text-xs text-[color:var(--lume-ink-muted)]">
                                <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> PDF: salva prima</span>
                                <span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Immagini e scansioni: revisione manuale</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

const PdfImporter: ComponentType<PdfImporterProps> = PdfImporterUnavailable;
export default PdfImporter;
