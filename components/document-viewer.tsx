'use client';

import { X, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';

interface DocumentViewerProps {
    file: Blob | string;
    fileName: string;
    onClose: () => void;
}

export default function DocumentViewer({ file, fileName, onClose }: DocumentViewerProps) {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const url = typeof file === 'string' ? file : blobUrl;

    useEffect(() => {
        if (file && typeof file !== 'string') {
            const objectUrl = URL.createObjectURL(file);
            setBlobUrl(objectUrl);
            return () => URL.revokeObjectURL(objectUrl);
        }
        if (!file) setBlobUrl(null);
    }, [file]);

    return (
        // @Codex WUL-229: full-screen document viewer reuses specular chrome + vitreous canvas
        <div className="mf-modal-backdrop p-4 md:p-8 animate-in fade-in duration-200" style={{ zIndex: 100 }}>
            <button
                type="button"
                aria-label="Chiudi sfondo"
                className="absolute inset-0 cursor-default"
                onClick={onClose}
            />
            <div className="mf-modal-shell relative w-full h-full max-w-6xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 graphite-divider">
                    <div className="flex items-center gap-3">
                        <div
                            className="p-2 rounded-xl flex items-center justify-center"
                            style={{ background: 'rgba(15, 123, 104, 0.12)', color: 'var(--mf-primary)' }}
                        >
                            <FileText className="w-5 h-5" />
                        </div>
                        <h3 className="font-semibold text-sm md:text-base truncate" style={{ color: 'var(--mf-ink)' }}>{fileName}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="mf-btn-secondary !p-2 !rounded-full"
                        aria-label="Chiudi"
                        title="Chiudi"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div
                    className="flex-1 relative"
                    style={{ background: 'var(--mf-tier-vitreous-bg, rgba(255,252,247,0.55))' }}
                >
                    {url ? (
                        <iframe
                            src={url}
                            className="w-full h-full border-none"
                            title="Document Preview"
                        />
                    ) : (
                        <div
                            className="flex items-center justify-center h-full text-sm"
                            style={{ color: 'var(--mf-muted)' }}
                        >
                            Caricamento anteprima...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
