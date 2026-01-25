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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 md:p-8 animation-in fade-in duration-200">
            <div className="bg-white rounded-2xl w-full h-full max-w-6xl flex flex-col overflow-hidden shadow-2xl">
                <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <FileText className="w-5 h-5" />
                        </div>
                        <h3 className="font-bold text-gray-800">{fileName}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500 hover:text-red-500"
                        aria-label="Chiudi"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex-1 bg-gray-100 relative">
                    {url ? (
                        <iframe
                            src={url}
                            className="w-full h-full border-none"
                            title="Document Preview"
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-400">
                            Caricamento anteprima...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
