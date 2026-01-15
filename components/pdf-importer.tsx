'use client';

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileText, Loader2, CheckCircle } from 'lucide-react';
import { extractTextFromPdf, parsePatientData, ExtractedPatientData } from '@/lib/pdf-service';
import { cn } from '@/lib/utils'; // Assuming cn exists

interface PdfImporterProps {
    onDataExtracted: (data: ExtractedPatientData) => void;
}

export default function PdfImporter({ onDataExtracted }: PdfImporterProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [success, setSuccess] = useState(false);

    const onDrop = async (acceptedFiles: File[]) => {
        if (acceptedFiles.length === 0) return;

        const file = acceptedFiles[0];
        if (file.type !== 'application/pdf') {
            alert('Per favore carica solo file PDF.');
            return;
        }

        setIsProcessing(true);
        setSuccess(false);

        try {
            const text = await extractTextFromPdf(file);
            const data = parsePatientData(text);
            onDataExtracted(data);
            setSuccess(true);
        } catch (err) {
            console.error(err);
            alert('Errore nella lettura del PDF.');
        } finally {
            setIsProcessing(false);
        }
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        maxFiles: 1,
        accept: { 'application/pdf': ['.pdf'] }
    });

    return (
        <div className="mb-8">
            <div
                {...getRootProps()}
                className={cn(
                    "relative border-2 border-dashed rounded-xl p-6 transition-all cursor-pointer overflow-hidden backdrop-blur-sm",
                    isDragActive ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-200 dark:border-white/10 hover:border-blue-400 hover:bg-gray-50 dark:hover:bg-white/5",
                    success ? "border-green-500 bg-green-50 dark:bg-green-900/20" : ""
                )}
            >
                <input {...getInputProps()} />

                {isProcessing ? (
                    <div className="flex flex-col items-center justify-center py-4 text-blue-600">
                        <Loader2 className="w-8 h-8 animate-spin mb-2" />
                        <p className="font-medium animate-pulse">Analisi documento in corso...</p>
                    </div>
                ) : success ? (
                    <div className="flex flex-col items-center justify-center py-4 text-green-600">
                        <CheckCircle className="w-8 h-8 mb-2" />
                        <p className="font-bold">Dati estratti con successo!</p>
                        <p className="text-xs text-green-700">Controlla i campi compilati qui sotto.</p>
                    </div>
                ) : (
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-100 text-blue-600 rounded-lg shrink-0">
                            <FileText className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800 dark:text-gray-200">Importa da Documento</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Trascina qui un PDF (referto, scheda) per compilare automaticamente i campi.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
