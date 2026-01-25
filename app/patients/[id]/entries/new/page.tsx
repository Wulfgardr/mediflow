'use client';

import { useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { db } from '@/lib/db';
import { ArrowLeft, Save, Video, Stethoscope, FileText, Paperclip, Calendar, Clock, Upload, X, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { v4 as uuidv4 } from 'uuid';
import { cn } from '@/lib/utils';
import { useDropzone } from 'react-dropzone';
import { extractTextFromPdf, parsePatientData } from '@/lib/pdf-service';

export default function NewEntryPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;

    // Default to current time, formatted for datetime-local (YYYY-MM-DDTHH:mm)
    const now = new Date();
    const defaultDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);

    const [type, setType] = useState<'visit' | 'remote' | 'note'>('visit');
    const [content, setContent] = useState('');
    const [setting, setSetting] = useState<'ambulatory' | 'home'>('ambulatory');
    const [entryDate, setEntryDate] = useState(defaultDate);
    const [files, setFiles] = useState<File[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('');

    const onDrop = useCallback((acceptedFiles: File[]) => {
        setFiles(prev => [...prev, ...acceptedFiles]);
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

    const removeFile = (index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setUploadProgress('Salvataggio allegati...');

        try {
            const attachmentIds: string[] = [];

            // 1. Process and Upload Files
            for (const file of files) {
                let summary = "Allegato alla visita";

                // Construct a better summary if PDF
                if (file.type === 'application/pdf') {
                    try {
                        const text = await extractTextFromPdf(file);
                        const data = parsePatientData(text);
                        if (data.notes && data.notes.length > 5) {
                            summary = data.notes;
                        } else {
                            summary = "Documento allegato (analizzato)";
                        }
                    } catch (err) {
                        console.warn("PDF extraction failed", err);
                    }
                }

                // Convert to Base64
                const base64Data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                const attachmentId = uuidv4();
                await db.attachments.add({
                    id: attachmentId,
                    patientId: id,
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    path: `uploads/${file.name}`, // Placeholder path since we store in data
                    data: base64Data,
                    summarySnapshot: summary,
                    createdAt: new Date()
                });
                attachmentIds.push(attachmentId);
            }

            setUploadProgress('Salvataggio voce diario...');

            // 2. Create Entry
            const typeLabels: Record<string, string> = {
                visit: 'Visita Ambulatoriale',
                remote: 'Videoconsulto',
                note: 'Nota Clinica'
            };

            await db.entries.add({
                id: uuidv4(),
                patientId: id,
                type,
                title: typeLabels[type] || 'Nuova Voce',
                date: new Date(entryDate), // Authentic User-Specified Date
                content,
                setting,
                attachments: attachmentIds,
                createdAt: new Date(), // Audit Timestamp
                updatedAt: new Date(),
            });

            router.push(`/patients/${id}`);
        } catch (err) {
            console.error(err);
            alert("Errore durante il salvataggio. Riprova.");
            setIsSubmitting(false);
            setUploadProgress('');
        }
    };

    const types = [
        { id: 'visit', label: 'Visita', icon: Stethoscope },
        { id: 'remote', label: 'Remoto', icon: Video },
        { id: 'note', label: 'Nota', icon: FileText },
    ];

    return (
        <div className="max-w-3xl mx-auto">
            <div className="mb-6 flex items-center gap-4">
                <Link href={`/patients/${id}`} className="p-2 hover:bg-white/50 dark:hover:bg-white/10 rounded-full transition-colors">
                    <ArrowLeft className="w-6 h-6 text-gray-600 dark:text-gray-300" />
                </Link>
                <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Nuova Voce Diario</h1>
            </div>

            <div className="glass-panel p-8">
                <form onSubmit={handleSubmit} className="space-y-8">

                    {/* Date & Type Row */}
                    <div className="flex flex-col md:flex-row gap-6">
                        {/* Date Picker */}
                        <div className="w-full md:w-1/3 space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                Data e Ora
                            </label>
                            <div className="relative">
                                <Clock className="absolute left-4 top-3.5 w-5 h-5 text-gray-400 pointer-events-none" />
                                <input
                                    type="datetime-local"
                                    value={entryDate}
                                    onChange={(e) => setEntryDate(e.target.value)}
                                    className="w-full pl-12 pr-4 py-3 rounded-xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 focus:ring-2 focus:ring-indigo-500 outline-none text-gray-700 dark:text-gray-200 font-medium dark:[color-scheme:dark]"
                                    aria-label="Data e ora della visita"
                                    required
                                />
                            </div>
                            <p className="text-[10px] text-gray-400">
                                Puoi retrodatare l&apos;inserimento se necessario.
                            </p>
                        </div>

                        {/* Setting Selector */}
                        <div className="flex-1 space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Setting</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setSetting('ambulatory')}
                                    className={cn(
                                        "flex items-center justify-center gap-2 p-3 rounded-xl border font-medium transition-all h-[50px]",
                                        setting === 'ambulatory'
                                            ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-500 text-emerald-700 dark:text-emerald-400 shadow-sm"
                                            : "bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/10"
                                    )}
                                >
                                    <span className="text-lg">🏥</span>
                                    <span>Ambulatorio</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSetting('home')}
                                    className={cn(
                                        "flex items-center justify-center gap-2 p-3 rounded-xl border font-medium transition-all h-[50px]",
                                        setting === 'home'
                                            ? "bg-amber-50 dark:bg-amber-900/20 border-amber-500 text-amber-700 dark:text-amber-400 shadow-sm"
                                            : "bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/10"
                                    )}
                                >
                                    <span className="text-lg">🏠</span>
                                    <span>Domicilio</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Type Selector */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Tipo Attività</label>
                        <div className="grid grid-cols-3 gap-3">
                            {types.map((t) => {
                                const Icon = t.icon;
                                const isSelected = type === t.id;
                                return (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => setType(t.id as 'visit' | 'remote' | 'note')}
                                        className={cn(
                                            "flex flex-col items-center justify-center gap-2 p-4 rounded-xl border text-center transition-all",
                                            isSelected
                                                ? "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 text-indigo-700 dark:text-indigo-300 shadow-sm"
                                                : "bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 text-gray-500 dark:text-gray-400"
                                        )}
                                    >
                                        <Icon className={cn("w-6 h-6", isSelected ? "text-indigo-600 dark:text-indigo-400" : "text-gray-400 dark:text-gray-500")} />
                                        <span className="font-semibold text-sm">{t.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Resoconto Clinico (SOAP)</label>
                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            className="w-full h-64 p-5 rounded-2xl bg-white/70 dark:bg-white/5 border-0 shadow-inner resize-none focus:ring-2 focus:ring-indigo-500 focus:bg-white/90 dark:focus:bg-white/10 transition-all text-gray-800 dark:text-gray-200 placeholder-gray-400"
                            placeholder="S: Il paziente riferisce...&#10;O: PA 120/80, Sat 98%...&#10;A: Stazionarietà...&#10;P: Proseguire terapia..."
                            required
                        />
                    </div>

                    {/* Attachments Section */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                            <Paperclip className="w-4 h-4" />
                            Allegati & Documenti
                        </label>

                        {/* Dropzone */}
                        <div
                            {...getRootProps()}
                            className={cn(
                                "border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all",
                                isDragActive
                                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/10"
                                    : "border-gray-300 dark:border-white/10 hover:border-indigo-400 hover:bg-gray-50 dark:hover:bg-white/5 bg-white/50 dark:bg-white/5"
                            )}
                        >
                            <input {...getInputProps()} />
                            <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-full mb-3">
                                <Upload className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <p className="text-gray-700 dark:text-gray-300 font-medium text-sm">Clicca o trascina qui i file</p>
                            <p className="text-gray-400 text-xs mt-1">PDF, Immagini, Referti...</p>
                        </div>

                        {/* File List */}
                        {files.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                {files.map((file, idx) => (
                                    <div key={idx} className="flex items-center gap-3 p-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg shadow-sm group">
                                        <div className="p-2 bg-gray-100 dark:bg-white/10 rounded-md">
                                            <FileText className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate">{file.name}</p>
                                            <p className="text-[10px] text-gray-500">{(file.size / 1024).toFixed(0)} KB</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeFile(idx)}
                                            className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                            aria-label={`Rimuovi allegato ${file.name}`}
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end pt-4 border-t border-gray-100 dark:border-white/10">
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex items-center gap-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    <span>{uploadProgress || 'Salvataggio...'}</span>
                                </>
                            ) : (
                                <>
                                    <Save className="w-5 h-5" />
                                    <span>Registra nel Diario</span>
                                </>
                            )}
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
}
