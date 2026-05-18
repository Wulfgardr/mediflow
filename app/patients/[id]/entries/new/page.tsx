'use client';

import { useCallback, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useDropzone } from 'react-dropzone';
import { v4 as uuidv4 } from 'uuid';
import { Building2, Calendar, Clock, FileText, Home, Loader2, Paperclip, Save, Sparkles, Stethoscope, Upload, Video, X } from 'lucide-react';

/* @Codex */
import { ClinicalRichTextEditor } from '@/components/clinical-rich-text-editor';
import { Kree8WorkspaceShell, type Kree8WorkspaceNavItem } from '@/components/kree8/kree8-workspace-shell';
import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';
import { db } from '@/lib/db';
/* @Codex */
import { isClinicalRichTextBlank, sanitizeClinicalRichTextHtml } from '@/lib/clinical-rich-text';
import { serializeDocumentParseEvidenceArtifact } from '@/lib/document-parse-evidence-artifact';
import { synthesizeDocument } from '@/lib/document-synthesis-service';
import { extractPatientDataSmart, extractDocumentTextForSummary, isImageDocumentInput, isPdfDocumentInput } from '@/lib/pdf-service';
import { regeneratePatientSummary, getAiModelLabels } from '@/lib/ai-summary-service';
import { useLiveQuery } from '@/lib/live-query';
import { cn } from '@/lib/utils';

export default function NewEntryPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;

    const now = new Date();
    const defaultDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);

    const [type, setType] = useState<'visit' | 'remote' | 'note'>('visit');
    const [content, setContent] = useState('');
    const [setting, setSetting] = useState<'ambulatory' | 'home'>('ambulatory');
    const [entryDate, setEntryDate] = useState(defaultDate);
    const [files, setFiles] = useState<File[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('');
    /* @Codex */
    const patient = useLiveQuery(() => db.patients.get(id), [id]);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        setFiles((prev) => [...prev, ...acceptedFiles]);
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

    const removeFile = (index: number) => {
        setFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        /* @Codex */
        const normalizedContent = sanitizeClinicalRichTextHtml(content);

        if (isClinicalRichTextBlank(normalizedContent)) {
            alert('Inserisci un resoconto clinico prima di registrare la voce.');
            return;
        }

        setIsSubmitting(true);
        setUploadProgress('Salvataggio allegati...');

        try {
            const attachmentIds: string[] = [];
            const aiModels = await getAiModelLabels();

            for (const file of files) {
                let summary = 'Allegato alla voce clinica';
                let parseEvidenceArtifactSnapshot: string | undefined;
                const attachmentId = uuidv4();

                const isPdf = isPdfDocumentInput(file);
                const isImage = isImageDocumentInput(file);

                if (isPdf || isImage) {
                    try {
                        setUploadProgress(`AI OCR (${aiModels.ocr})...`);
                        const extracted = await extractPatientDataSmart(file);
                        let rawText = extracted.rawText;
                        if (!rawText || rawText.length < 200) {
                            rawText = await extractDocumentTextForSummary(file);
                        }

                        if (rawText) {
                            setUploadProgress(`Sintesi documento (${aiModels.clinical})...`);
                            const result = await synthesizeDocument(rawText, file.name, id, { attachmentId });
                            summary = result.insight.summary;
                            parseEvidenceArtifactSnapshot = serializeDocumentParseEvidenceArtifact(result.parseEvidenceArtifact);
                        } else if (extracted.notes && extracted.notes.length > 5) {
                            summary = extracted.notes;
                        } else {
                            summary = 'Documento allegato (analizzato)';
                        }
                    } catch (error) {
                        console.warn('Documento OCR/Sintesi fallita', error);
                    }
                }

                const base64Data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                await db.attachments.add({
                    id: attachmentId,
                    patientId: id,
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    path: `uploads/${file.name}`,
                    data: base64Data,
                    summarySnapshot: summary,
                    parseEvidenceArtifactSnapshot,
                    createdAt: new Date(),
                });
                attachmentIds.push(attachmentId);
            }

            setUploadProgress('Salvataggio voce diario...');

            const typeLabels: Record<string, string> = {
                visit: 'Visita ambulatoriale',
                remote: 'Contatto remoto',
                note: 'Nota clinica',
            };

            await db.entries.add({
                id: uuidv4(),
                patientId: id,
                type,
                title: typeLabels[type] || 'Nuova Voce',
                date: new Date(entryDate),
                content: normalizedContent,
                setting,
                attachments: attachmentIds,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            setUploadProgress('Aggiornamento riepilogo paziente...');
            await regeneratePatientSummary(id);

            router.push(`/patients/${id}`);
        } catch (error) {
            console.error(error);
            alert('Errore durante il salvataggio. Riprova.');
            setIsSubmitting(false);
            setUploadProgress('');
        }
    };

    const types = [
        { id: 'visit', label: 'Visita', icon: Stethoscope },
        { id: 'remote', label: 'Remoto', icon: Video },
        { id: 'note', label: 'Nota', icon: FileText },
    ];
    /* @Codex */
    const workspaceNavItems: Kree8WorkspaceNavItem[] = [
        { href: '#dati', label: 'Dati', meta: setting === 'home' ? 'domicilio' : 'ambulatorio' },
        { href: '#resoconto', label: 'Resoconto' },
        { href: '#allegati', label: 'Allegati', meta: String(files.length) },
        { href: '#guida', label: 'Guida' },
    ];

    return (
        <Kree8WorkspaceShell
            eyebrow="Diario clinico"
            title="Nuova voce clinica"
            subtitle="Registra una visita, un contatto remoto o una nota breve senza uscire dal lavoro sul paziente."
            backHref={`/patients/${id}`}
            backLabel="Torna al quadro paziente"
            patientLabel={patient ? `${patient.lastName} ${patient.firstName}` : undefined}
            statusLabel="Scrittura locale: allegati e sintesi documento restano sul dispositivo."
            navItems={workspaceNavItems}
        >
            <div className={workspaceStyles.workspaceGrid}>
                <div className={workspaceStyles.primaryStack}>
                    <div className="patient-detail-section glass-panel border p-6 md:p-7">
                        <form onSubmit={handleSubmit} className="space-y-8">
                            <div id="dati" className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
                                <div className="space-y-2">
                                    <label className="section-kicker flex items-center gap-2">
                                        <Calendar className="h-3.5 w-3.5" />
                                        Data e ora
                                    </label>
                                    <div className="relative">
                                        <Clock className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-[color:var(--mf-muted)]" />
                                        <input
                                            type="datetime-local"
                                            value={entryDate}
                                            onChange={(e) => setEntryDate(e.target.value)}
                                            className="w-full rounded-[18px] border border-[color:rgba(112,106,100,0.14)] bg-white/82 py-3 pl-12 pr-4 text-sm font-medium text-[color:var(--mf-ink)] outline-none transition-[border-color,box-shadow] focus:border-[color:rgba(182,106,60,0.3)] focus:shadow-[0_0_0_4px_rgba(182,106,60,0.08)] dark:border-white/10 dark:bg-white/5 dark:[color-scheme:dark]"
                                            aria-label="Data e ora della voce clinica"
                                            required
                                        />
                                    </div>
                                    <p className="text-xs leading-5 text-[color:var(--mf-muted)]">
                                        Puoi retrodatare la voce quando ricostruisci il diario.
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <label className="section-kicker">Luogo</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setSetting('ambulatory')}
                                            className={cn(
                                                'flex h-[56px] items-center justify-center gap-3 rounded-[18px] border px-4 text-sm font-semibold transition-[border-color,background-color,color,box-shadow,transform]',
                                                setting === 'ambulatory'
                                                    ? 'border-[color:rgba(15,123,104,0.22)] bg-[color:rgba(15,123,104,0.08)] text-[color:var(--mf-primary)] shadow-[0_12px_24px_rgba(15,123,104,0.08)]'
                                                    : 'border-[color:rgba(112,106,100,0.14)] bg-white/76 text-[color:var(--mf-muted)] hover:border-[color:rgba(112,106,100,0.2)] hover:bg-[color:rgba(255,252,247,0.94)]'
                                            )}
                                        >
                                            <Building2 className="h-4 w-4" />
                                            <span>Ambulatorio</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSetting('home')}
                                            className={cn(
                                                'flex h-[56px] items-center justify-center gap-3 rounded-[18px] border px-4 text-sm font-semibold transition-[border-color,background-color,color,box-shadow,transform]',
                                                setting === 'home'
                                                    ? 'border-[color:rgba(182,106,60,0.24)] bg-[color:rgba(182,106,60,0.08)] text-[color:var(--mf-accent)] shadow-[0_12px_24px_rgba(182,106,60,0.08)]'
                                                    : 'border-[color:rgba(112,106,100,0.14)] bg-white/76 text-[color:var(--mf-muted)] hover:border-[color:rgba(112,106,100,0.2)] hover:bg-[color:rgba(255,252,247,0.94)]'
                                            )}
                                        >
                                            <Home className="h-4 w-4" />
                                            <span>Domicilio</span>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="section-kicker">Tipo di voce</label>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                    {types.map((currentType) => {
                                        const Icon = currentType.icon;
                                        const isSelected = type === currentType.id;

                                        return (
                                            <button
                                                key={currentType.id}
                                                type="button"
                                                onClick={() => setType(currentType.id as 'visit' | 'remote' | 'note')}
                                                className={cn(
                                                    'flex items-center gap-3 rounded-[20px] border px-4 py-4 text-left transition-[border-color,background-color,color,box-shadow,transform]',
                                                    isSelected
                                                        ? 'border-[color:rgba(94,53,95,0.18)] bg-[color:rgba(94,53,95,0.08)] text-[color:var(--mf-ink)] shadow-[0_12px_24px_rgba(94,53,95,0.08)]'
                                                        : 'border-[color:rgba(112,106,100,0.14)] bg-white/76 text-[color:var(--mf-muted)] hover:border-[color:rgba(112,106,100,0.2)] hover:bg-[color:rgba(255,252,247,0.94)]'
                                                )}
                                            >
                                                <div className={cn(
                                                    'flex h-11 w-11 items-center justify-center rounded-[16px] border',
                                                    isSelected
                                                        ? 'border-[color:rgba(94,53,95,0.18)] bg-white/82 text-[color:var(--mf-plum)]'
                                                        : 'border-[color:rgba(112,106,100,0.14)] bg-white/82 text-[color:var(--mf-muted)]',
                                                )}>
                                                    <Icon className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold text-[color:var(--mf-ink)]">{currentType.label}</p>
                                                    <p className="mt-1 text-xs leading-5 text-[color:var(--mf-muted)]">
                                                        {currentType.id === 'visit'
                                                            ? 'In presenza, con esame obiettivo e piano.'
                                                            : currentType.id === 'remote'
                                                                ? 'Contatto a distanza, follow-up o riallineamento.'
                                                                : 'Nota breve, decisione o memo clinico.'}
                                                    </p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* @Codex */}
                            <section id="resoconto" className="rounded-[26px] border border-[color:rgba(112,106,100,0.12)] bg-[color:rgba(255,252,247,0.88)] p-5 shadow-[0_16px_30px_rgba(35,27,22,0.06)] md:p-6">
                                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <p className="section-kicker">Resoconto clinico</p>
                                        <h2 className="mt-1 text-xl font-semibold text-[color:var(--mf-ink)]">
                                            Scrivi la voce
                                        </h2>
                                        <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--mf-muted)]">
                                            Titoli, punti elenco e formattazioni leggere per separare sintomi, obiettivi, assessment e piano.
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <span className="apple-chip">SOAP-friendly</span>
                                        <span className="apple-chip">Compatibile timeline</span>
                                    </div>
                                </div>

                                <ClinicalRichTextEditor
                                    value={content}
                                    onChange={setContent}
                                    placeholder={'S: Sintomi e motivo della visita\nO: Parametri, esame obiettivo, dati oggettivi\nA: Valutazione clinica e ipotesi\nP: Piano, follow-up, indicazioni'}
                                />
                            </section>

                            <section id="allegati" className="rounded-[26px] border border-[color:rgba(112,106,100,0.12)] bg-[color:rgba(255,252,247,0.88)] p-5 shadow-[0_16px_30px_rgba(35,27,22,0.06)] md:p-6">
                                <div className="mb-4">
                                    <p className="section-kicker">Allegati</p>
                                    <h2 className="mt-1 text-xl font-semibold text-[color:var(--mf-ink)]">
                                        Documenti e referti collegati
                                    </h2>
                                </div>

                                <div className="space-y-3">
                                    <label className="flex items-center gap-2 text-sm font-medium text-[color:var(--mf-ink)]">
                                        <Paperclip className="h-4 w-4 text-[color:var(--mf-muted)]" />
                                        Allegati della voce
                                    </label>

                                    <div
                                        {...getRootProps()}
                                        className={cn(
                                            'rounded-[22px] border-2 border-dashed p-6 text-center transition-[border-color,background-color,color,box-shadow]',
                                            isDragActive
                                                ? 'border-[color:rgba(182,106,60,0.34)] bg-[color:rgba(182,106,60,0.08)]'
                                                : 'border-[color:rgba(112,106,100,0.18)] bg-white/68 hover:border-[color:rgba(182,106,60,0.24)] hover:bg-[color:rgba(255,252,247,0.92)]'
                                        )}
                                    >
                                        <input {...getInputProps()} />
                                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/82 text-[color:var(--mf-accent)]">
                                            <Upload className="h-5 w-5" />
                                        </div>
                                        <p className="text-sm font-semibold text-[color:var(--mf-ink)]">Clicca o trascina qui i file</p>
                                        <p className="mt-1 text-xs leading-5 text-[color:var(--mf-muted)]">PDF, immagini, referti e documenti clinici.</p>
                                    </div>

                                    {files.length > 0 ? (
                                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                            {files.map((file, index) => (
                                                <div key={index} className="flex items-center gap-3 rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/78 p-3 shadow-[0_10px_20px_rgba(35,27,22,0.04)]">
                                                    <div className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-[color:rgba(112,106,100,0.12)] bg-[color:rgba(255,252,247,0.9)] text-[color:var(--mf-muted)]">
                                                        <FileText className="h-4 w-4" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate text-sm font-semibold text-[color:var(--mf-ink)]">{file.name}</p>
                                                        <p className="text-xs text-[color:var(--mf-muted)]">{(file.size / 1024).toFixed(0)} KB</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeFile(index)}
                                                        className="rounded-[12px] p-2 text-[color:var(--mf-muted)] transition-colors hover:bg-[color:rgba(182,106,60,0.08)] hover:text-[color:var(--mf-accent)]"
                                                        aria-label={`Rimuovi allegato ${file.name}`}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            </section>

                            <div className="flex justify-end border-t border-[color:rgba(112,106,100,0.12)] pt-4">
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="ui-btn-primary px-8 py-3 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="h-5 w-5 animate-spin" />
                                            <span>{uploadProgress || 'Salvataggio...'}</span>
                                        </>
                                    ) : (
                                        <>
                                            <Save className="h-5 w-5" />
                                            <span>Registra nel diario</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                <aside id="guida" className={workspaceStyles.secondaryStack}>
                    <section className="patient-detail-side-section rounded-[20px] border p-5">
                        <div className="mb-4">
                            <p className="section-kicker">Scrittura</p>
                            <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-[color:var(--mf-ink)]">
                                <Sparkles className="h-5 w-5 text-[color:var(--mf-primary)]" />
                                Formattazione leggera
                            </h3>
                        </div>
                        <div className="space-y-3 text-sm leading-6 text-[color:var(--mf-muted)]">
                            <p>Usa titoli per separare i blocchi clinici e bullet point per terapie, alert o passi successivi.</p>
                            <p>Il contenuto resta leggibile anche in timeline, report PDF e contesto AI locale.</p>
                        </div>
                    </section>

                    <section className="patient-detail-side-section rounded-[20px] border p-5">
                        <div className="mb-4">
                            <p className="section-kicker">Struttura suggerita</p>
                            <h3 className="mt-1 text-lg font-semibold text-[color:var(--mf-ink)]">
                                Struttura che si rilegge in fretta
                            </h3>
                        </div>
                        <div className="space-y-3">
                            <div className="rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/74 px-4 py-3">
                                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">S</p>
                                <p className="mt-1 text-sm text-[color:var(--mf-ink)]">Motivo del contatto, sintomi, contesto funzionale.</p>
                            </div>
                            <div className="rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/74 px-4 py-3">
                                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">O</p>
                                <p className="mt-1 text-sm text-[color:var(--mf-ink)]">Parametri, esame obiettivo, referti o dati oggettivi.</p>
                            </div>
                            <div className="rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/74 px-4 py-3">
                                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">A / P</p>
                                <p className="mt-1 text-sm text-[color:var(--mf-ink)]">Assessment clinico, decisione e follow-up operativo.</p>
                            </div>
                        </div>
                    </section>
                </aside>
            </div>
        </Kree8WorkspaceShell>
    );
}
