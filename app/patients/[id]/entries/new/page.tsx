'use client';

import { useCallback, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useDropzone } from 'react-dropzone';
import { v4 as uuidv4 } from 'uuid';
import { AlertTriangle, Building2, Calendar, CheckCircle2, ClipboardList, Clock, FileCheck2, FileText, History, Home, Loader2, Mic, MicOff, Paperclip, Pause, Play, RotateCcw, Save, ShieldCheck, Sparkles, Square, Stethoscope, Upload, Video, Wand2, X } from 'lucide-react';

/* @Codex */
import { ClinicalRichTextEditor } from '@/components/clinical-rich-text-editor';
import { Kree8WorkspaceShell, type Kree8WorkspaceNavItem } from '@/components/kree8/kree8-workspace-shell';
import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';
import { db, type Attachment, type ClinicalEntry } from '@/lib/db';
/* @Codex */
import { isClinicalRichTextBlank, sanitizeClinicalRichTextHtml } from '@/lib/clinical-rich-text';
import { serializeDocumentParseEvidenceArtifact } from '@/lib/domain/documents/document-parse-evidence-artifact';
import { synthesizeDocument } from '@/lib/domain/documents/document-synthesis-service';
import { extractPatientDataSmart, extractDocumentTextForSummary, isImageDocumentInput, isPdfDocumentInput } from '@/lib/pdf-service';
import { refreshPatientSummaryIfEnabled, getAiModelLabels } from '@/lib/ai-summary-service';
import { useLiveQuery } from '@/lib/live-query';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast-provider';
import type { VisitMedicationCandidate, VisitSessionEvent, VisitSessionState } from '@/lib/visit-transcript-draft';

/* @Codex WUL-420 */
const VISIT_DRAFT_PLACEHOLDER = [
    'S: motivo della visita, sintomi riferiti, contesto funzionale',
    'O: parametri, esame obiettivo, elementi documentali',
    'A: valutazione clinica da rivedere',
    'P: piano, follow-up, indicazioni condivise',
].join('\n');

/* @Codex WUL-420 */
function escapeClinicalDraftText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* @Codex WUL-420 */
function formatVisitDraftAsClinicalHtml(value: string): string {
    return value
        .trim()
        .split(/\n{2,}/)
        .map((block) => `<p>${escapeClinicalDraftText(block.trim()).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

/* @Codex WUL-420 */
function formatEntryDate(value: Date | string | number | null | undefined): string {
    if (!value) return 'data non disponibile';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'data non disponibile';
    return new Intl.DateTimeFormat('it-IT', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(date);
}

/* @Codex WUL-421 */
type VisitSessionUiState = VisitSessionState | 'processing' | 'processed';

export default function NewEntryPage() {
    const params = useParams();
    const router = useRouter();
    const { showToast } = useToast();
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
    /* @Codex WUL-420 */
    const [dictatedDraft, setDictatedDraft] = useState('');
    const [isDictatedDraftReviewed, setIsDictatedDraftReviewed] = useState(false);
    /* @Codex WUL-421 */
    const [visitSessionState, setVisitSessionState] = useState<VisitSessionUiState>('idle');
    const [visitSessionStartedAt, setVisitSessionStartedAt] = useState<number | null>(null);
    const [visitSessionEvents, setVisitSessionEvents] = useState<VisitSessionEvent[]>([]);
    const [visitDraftError, setVisitDraftError] = useState('');
    const [visitMedicationCandidates, setVisitMedicationCandidates] = useState<VisitMedicationCandidate[]>([]);
    /* @Codex */
    const patient = useLiveQuery(() => db.patients.get(id), [id], undefined, ['patients']);
    /* @Codex WUL-420 */
    const patientEntries = useLiveQuery<ClinicalEntry[], ClinicalEntry[]>(
        async () => db.entries.query({ patientId: id }).toArray(),
        [id],
        [],
        ['entries'],
    ) ?? [];
    /* @Codex WUL-420 */
    const patientAttachments = useLiveQuery<Attachment[], Attachment[]>(
        async () => db.attachments.query({ patientId: id }).toArray(),
        [id],
        [],
        ['attachments'],
    ) ?? [];

    const onDrop = useCallback((acceptedFiles: File[]) => {
        setFiles((prev) => [...prev, ...acceptedFiles]);
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

    const removeFile = (index: number) => {
        setFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    };

    /* @Codex WUL-420 */
    const handleDictatedDraftChange = (value: string) => {
        setDictatedDraft(value);
        setIsDictatedDraftReviewed(false);
        setVisitMedicationCandidates([]);
        setVisitDraftError('');
    };

    /* @Codex WUL-421 */
    const getVisitEventAtMs = useCallback(() => {
        if (visitSessionStartedAt === null) return 0;
        return Math.max(0, Math.round(performance.now() - visitSessionStartedAt));
    }, [visitSessionStartedAt]);

    const appendVisitEvent = useCallback((type: VisitSessionEvent['type']) => {
        setVisitSessionEvents((currentEvents) => [...currentEvents, { type, atMs: getVisitEventAtMs() }]);
    }, [getVisitEventAtMs]);

    const startVisitSession = () => {
        setVisitSessionStartedAt(performance.now());
        setVisitSessionEvents([{ type: 'start', atMs: 0 }]);
        setVisitMedicationCandidates([]);
        setVisitDraftError('');
        setVisitSessionState('recording');
    };

    const pauseVisitSession = () => {
        appendVisitEvent('pause');
        setVisitSessionState('paused');
    };

    const resumeVisitSession = () => {
        appendVisitEvent('resume');
        setVisitSessionState('recording');
    };

    const stopVisitSession = () => {
        appendVisitEvent('stop');
        setVisitSessionState('stopped');
    };

    const resetVisitSession = () => {
        setVisitSessionState('idle');
        setVisitSessionStartedAt(null);
        setVisitSessionEvents([]);
        setVisitMedicationCandidates([]);
        setVisitDraftError('');
        setIsDictatedDraftReviewed(false);
    };

    const processVisitDraft = async () => {
        if (!dictatedDraft.trim() || visitSessionState === 'processing') return;

        setVisitSessionState('processing');
        setVisitDraftError('');

        try {
            const response = await fetch('/api/visit-session/draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patientId: id,
                    transcript: dictatedDraft,
                    events: visitSessionEvents,
                }),
            });

            if (!response.ok) {
                throw new Error(`visit-draft-${response.status}`);
            }

            const result = await response.json() as {
                draftText?: string;
                medications?: VisitMedicationCandidate[];
            };

            setDictatedDraft(result.draftText || dictatedDraft);
            setVisitMedicationCandidates(result.medications || []);
            setIsDictatedDraftReviewed(false);
            setVisitSessionState('processed');
        } catch (_error) {
            setVisitDraftError('Elaborazione non riuscita. Il transcript resta modificabile manualmente.');
            setVisitSessionState(visitSessionEvents.some((event) => event.type === 'stop') ? 'stopped' : 'idle');
        }
    };

    /* @Codex WUL-420 */
    const insertReviewedDraft = () => {
        if (!dictatedDraft.trim() || !isDictatedDraftReviewed) return;

        const draftHtml = formatVisitDraftAsClinicalHtml(dictatedDraft);
        setContent((currentContent) => {
            const normalizedCurrentContent = sanitizeClinicalRichTextHtml(currentContent);
            if (isClinicalRichTextBlank(normalizedCurrentContent)) return draftHtml;
            return `${normalizedCurrentContent}<p><strong>Bozza dettata rivista</strong></p>${draftHtml}`;
        });
        setIsDictatedDraftReviewed(false);
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        /* @Codex */
        const normalizedContent = sanitizeClinicalRichTextHtml(content);

        if (isClinicalRichTextBlank(normalizedContent)) {
            showToast({ tone: 'warning', title: 'Resoconto clinico mancante', description: 'Inserisci un resoconto clinico prima di registrare la voce.' });
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
            const summaryRefresh = await refreshPatientSummaryIfEnabled(id);
            if (summaryRefresh.status === 'skipped' && summaryRefresh.reason === 'disabled') {
                console.info('[NewEntryPage] AI Patient Insight refresh skipped: kill switch disabled');
            }

            router.push(`/patients/${id}/modules`);
        } catch (error) {
            console.error(error);
            showToast({ tone: 'error', title: 'Errore durante il salvataggio', description: 'Riprova.' });
            setIsSubmitting(false);
            setUploadProgress('');
        }
    };

    const types = [
        { id: 'visit', label: 'Visita', icon: Stethoscope },
        { id: 'remote', label: 'Remoto', icon: Video },
        { id: 'note', label: 'Nota', icon: FileText },
    ];
    /* @Codex WUL-420 */
    const recentEntries = useMemo(() => {
        return [...patientEntries]
            .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
            .slice(0, 3);
    }, [patientEntries]);
    /* @Codex WUL-420 */
    const visitEntryCount = useMemo(() => {
        return patientEntries.filter((entry) => entry.type === 'visit').length;
    }, [patientEntries]);
    /* @Codex WUL-420 */
    const sourceCount = (patient?.documentInsights?.length ?? 0) + patientAttachments.length + files.length;
    const hasDictatedDraft = dictatedDraft.trim().length > 0;
    const canInsertReviewedDraft = type === 'visit' && hasDictatedDraft && isDictatedDraftReviewed;
    const acceptedNoteHasContent = !isClinicalRichTextBlank(content);
    /* @Codex WUL-421 */
    const visitSessionStatusLabel: Record<VisitSessionUiState, string> = {
        idle: 'Pronta locale',
        recording: 'In registrazione',
        paused: 'In pausa',
        stopped: 'Fermata',
        processing: 'Elaborazione',
        processed: 'Bozza pronta',
    };
    const canProcessVisitDraft = type === 'visit'
        && hasDictatedDraft
        && visitSessionState !== 'recording'
        && visitSessionState !== 'processing';
    /* @Codex */
    const workspaceNavItems: Kree8WorkspaceNavItem[] = [
        { href: '#dati', label: 'Dati', meta: setting === 'home' ? 'domicilio' : 'ambulatorio' },
        ...(type === 'visit' ? [{ href: '#sessione-visita', label: 'Sessione', meta: visitSessionStatusLabel[visitSessionState].toLowerCase() }] : []),
        { href: '#resoconto', label: 'Resoconto' },
        { href: '#allegati', label: 'Allegati', meta: String(files.length) },
        { href: '#contesto', label: 'Contesto', meta: String(sourceCount) },
    ];

    return (
        <Kree8WorkspaceShell
            eyebrow="Diario clinico"
            title="Nuova voce clinica"
            subtitle="Registra una visita, un contatto remoto o una nota breve."
            backHref={`/patients/${id}/modules`}
            backLabel="Torna alla scheda paziente"
            patientLabel={patient ? `${patient.lastName} ${patient.firstName}` : undefined}
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

                            {type === 'visit' ? (
                                /* @Codex WUL-420 */
                                <section id="sessione-visita" className="glass-panel p-5 md:p-6">
                                    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                        <div>
                                            <p className="section-kicker">Sessione visita</p>
                                            <h2 className="mt-1 text-xl font-semibold text-[color:var(--mf-ink)]">
                                                Bozza dettata e revisione
                                            </h2>
                                        </div>
                                        <div className="inline-flex items-center gap-2 rounded-[14px] border border-[color:rgba(146,64,14,0.18)] bg-[color:rgba(254,243,199,0.74)] px-3 py-2 text-xs font-semibold text-[color:#92400e]">
                                            <MicOff className="h-4 w-4" />
                                            <span>Audio non attivo</span>
                                        </div>
                                    </div>

                                    <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
                                        <div className="space-y-3 rounded-[20px] border border-[color:rgba(112,106,100,0.12)] bg-white/74 p-4">
                                            <div className="flex items-start gap-3">
                                                <div className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-[color:rgba(146,64,14,0.14)] bg-[color:rgba(254,243,199,0.68)] text-[color:#92400e]">
                                                    <AlertTriangle className="h-4 w-4" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-[color:var(--mf-ink)]">Transcript locale</p>
                                                    <p className="mt-1 text-xs leading-5 text-[color:var(--mf-muted)]">
                                                        Il backend elabora testo ed eventi pausa; nessun audio viene acquisito da questa vista.
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="grid gap-2 text-xs">
                                                <div className="flex items-center justify-between rounded-[14px] bg-[color:rgba(15,123,104,0.08)] px-3 py-2 text-[color:var(--mf-primary)]">
                                                    <span className="font-semibold">{visitSessionStatusLabel[visitSessionState]}</span>
                                                    {visitSessionState === 'processing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                                </div>
                                                <div className="flex items-center justify-between rounded-[14px] bg-white/64 px-3 py-2 text-[color:var(--mf-muted)]">
                                                    <span>Pause</span>
                                                    <span>{visitSessionEvents.filter((event) => event.type === 'pause').length}</span>
                                                </div>
                                                <div className="flex items-center justify-between rounded-[14px] bg-white/64 px-3 py-2 text-[color:var(--mf-muted)]">
                                                    <span>Eventi</span>
                                                    <span>{visitSessionEvents.length}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="flex flex-wrap gap-2">
                                                {visitSessionState === 'idle' || visitSessionState === 'processed' ? (
                                                    <button
                                                        type="button"
                                                        onClick={startVisitSession}
                                                        className="inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border border-[color:rgba(15,123,104,0.18)] bg-[color:rgba(15,123,104,0.08)] px-3 text-sm font-semibold text-[color:var(--mf-primary)]"
                                                    >
                                                        <Play className="h-4 w-4" />
                                                        <span>Avvia</span>
                                                    </button>
                                                ) : null}
                                                {visitSessionState === 'recording' ? (
                                                    <button
                                                        type="button"
                                                        onClick={pauseVisitSession}
                                                        className="inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border border-[color:rgba(146,64,14,0.18)] bg-[color:rgba(254,243,199,0.72)] px-3 text-sm font-semibold text-[color:#92400e]"
                                                    >
                                                        <Pause className="h-4 w-4" />
                                                        <span>Pausa</span>
                                                    </button>
                                                ) : null}
                                                {visitSessionState === 'paused' ? (
                                                    <button
                                                        type="button"
                                                        onClick={resumeVisitSession}
                                                        className="inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border border-[color:rgba(15,123,104,0.18)] bg-[color:rgba(15,123,104,0.08)] px-3 text-sm font-semibold text-[color:var(--mf-primary)]"
                                                    >
                                                        <Play className="h-4 w-4" />
                                                        <span>Riprendi</span>
                                                    </button>
                                                ) : null}
                                                {visitSessionState === 'recording' || visitSessionState === 'paused' ? (
                                                    <button
                                                        type="button"
                                                        onClick={stopVisitSession}
                                                        className="inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border border-[color:rgba(112,106,100,0.16)] bg-white/74 px-3 text-sm font-semibold text-[color:var(--mf-ink)]"
                                                    >
                                                        <Square className="h-4 w-4" />
                                                        <span>Ferma</span>
                                                    </button>
                                                ) : null}
                                                {visitSessionState === 'stopped' || visitSessionState === 'processed' ? (
                                                    <button
                                                        type="button"
                                                        onClick={resetVisitSession}
                                                        className="inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border border-[color:rgba(112,106,100,0.16)] bg-white/74 px-3 text-sm font-semibold text-[color:var(--mf-muted)]"
                                                    >
                                                        <RotateCcw className="h-4 w-4" />
                                                        <span>Reset</span>
                                                    </button>
                                                ) : null}
                                                <button
                                                    type="button"
                                                    disabled={!canProcessVisitDraft}
                                                    onClick={processVisitDraft}
                                                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border border-[color:rgba(94,53,95,0.18)] bg-[color:rgba(94,53,95,0.08)] px-3 text-sm font-semibold text-[color:var(--mf-plum)] transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
                                                >
                                                    {visitSessionState === 'processing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                                                    <span>Elabora bozza</span>
                                                </button>
                                            </div>
                                            {visitDraftError ? (
                                                <div className="rounded-[14px] border border-[color:rgba(190,18,60,0.16)] bg-[color:rgba(254,226,226,0.64)] px-3 py-2 text-xs font-semibold text-[color:#be123c]">
                                                    {visitDraftError}
                                                </div>
                                            ) : null}
                                            <div className="space-y-2">
                                                <label htmlFor="dictated-draft" className="section-kicker flex items-center gap-2">
                                                    {visitSessionState === 'recording' ? <Mic className="h-3.5 w-3.5" /> : <ClipboardList className="h-3.5 w-3.5" />}
                                                    Bozza dettata o transcript
                                                </label>
                                                <textarea
                                                    id="dictated-draft"
                                                    value={dictatedDraft}
                                                    onChange={(event) => handleDictatedDraftChange(event.target.value)}
                                                    placeholder={VISIT_DRAFT_PLACEHOLDER}
                                                    className="min-h-[180px] w-full resize-y rounded-[20px] border border-[color:rgba(112,106,100,0.14)] bg-white/82 px-4 py-3 text-sm leading-6 text-[color:var(--mf-ink)] outline-none transition-[border-color,box-shadow] placeholder:text-[color:rgba(71,85,105,0.58)] focus:border-[color:rgba(15,123,104,0.28)] focus:shadow-[0_0_0_4px_rgba(15,123,104,0.08)]"
                                                />
                                            </div>

                                            <div className="flex flex-col gap-3 rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/72 p-4 md:flex-row md:items-center md:justify-between">
                                                <label className="flex min-w-0 items-start gap-3 text-sm leading-5 text-[color:var(--mf-ink)]">
                                                    <input
                                                        type="checkbox"
                                                        checked={isDictatedDraftReviewed}
                                                        disabled={!hasDictatedDraft}
                                                        onChange={(event) => setIsDictatedDraftReviewed(event.target.checked)}
                                                        className="mt-1 h-4 w-4 rounded border-[color:rgba(112,106,100,0.22)] text-[color:var(--mf-primary)]"
                                                    />
                                                    <span>
                                                        Ho rivisto questa bozza prima di usarla nel resoconto.
                                                    </span>
                                                </label>
                                                <button
                                                    type="button"
                                                    disabled={!canInsertReviewedDraft}
                                                    onClick={insertReviewedDraft}
                                                    className="inline-flex h-11 items-center justify-center gap-2 rounded-[14px] border border-[color:rgba(15,123,104,0.18)] bg-[color:rgba(15,123,104,0.08)] px-4 text-sm font-semibold text-[color:var(--mf-primary)] transition-[background-color,border-color,color] hover:bg-[color:rgba(15,123,104,0.12)] disabled:cursor-not-allowed disabled:opacity-45"
                                                >
                                                    <FileCheck2 className="h-4 w-4" />
                                                    <span>Porta nel resoconto</span>
                                                </button>
                                            </div>

                                            {visitMedicationCandidates.length > 0 ? (
                                                <div className="space-y-2 rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/72 p-4">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <p className="section-kicker">Farmaci rilevati</p>
                                                        <span className="rounded-full border border-[color:rgba(146,64,14,0.16)] bg-[color:rgba(254,243,199,0.64)] px-2.5 py-1 text-[11px] font-semibold text-[color:#92400e]">
                                                            Non importati
                                                        </span>
                                                    </div>
                                                    <div className="grid gap-2">
                                                        {visitMedicationCandidates.map((candidate) => (
                                                            <div key={`${candidate.drugMention}-${candidate.evidence}`} className="rounded-[14px] border border-[color:rgba(112,106,100,0.1)] bg-white/78 px-3 py-2">
                                                                <p className="text-sm font-semibold text-[color:var(--mf-ink)]">{candidate.drugMention}</p>
                                                                <p className="mt-1 text-xs leading-5 text-[color:var(--mf-muted)]">
                                                                    {candidate.match
                                                                        ? `${candidate.match.name}${candidate.match.atc ? ` · ATC ${candidate.match.atc}` : ''}`
                                                                        : 'Match catalogo non trovato'}
                                                                </p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null}

                                            <div className="grid gap-3 md:grid-cols-2">
                                                <div className="rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/68 px-4 py-3">
                                                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">Bozza</p>
                                                    <p className="mt-1 text-sm font-semibold text-[color:var(--mf-ink)]">
                                                        {hasDictatedDraft ? 'Da revisione' : 'Vuota'}
                                                    </p>
                                                </div>
                                                <div className="rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/68 px-4 py-3">
                                                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">Resoconto</p>
                                                    <p className="mt-1 text-sm font-semibold text-[color:var(--mf-ink)]">
                                                        {acceptedNoteHasContent ? 'In compilazione' : 'Vuoto'}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            ) : null}

                            {/* @Codex */}
                            <section id="resoconto" className="glass-panel p-5 md:p-6">
                                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <p className="section-kicker">Resoconto clinico</p>
                                        <h2 className="mt-1 text-xl font-semibold text-[color:var(--mf-ink)]">
                                            Scrivi la voce
                                        </h2>
                                    </div>
                                </div>

                                <ClinicalRichTextEditor
                                    value={content}
                                    onChange={setContent}
                                    placeholder={'S: Sintomi e motivo della visita\nO: Parametri, esame obiettivo, dati oggettivi\nA: Valutazione clinica e ipotesi\nP: Piano, follow-up, indicazioni'}
                                />
                            </section>

                            <section id="allegati" className="glass-panel p-5 md:p-6">
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

                <aside id="contesto" className={workspaceStyles.secondaryStack}>
                    <section className="patient-detail-side-section rounded-[20px] border p-5">
                        <div className="mb-4">
                            <p className="section-kicker">Contesto paziente</p>
                            <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-[color:var(--mf-ink)]">
                                <ShieldCheck className="h-5 w-5 text-[color:var(--mf-primary)]" />
                                Sessione ancorata
                            </h3>
                        </div>
                        <div className="space-y-3">
                            <div className="rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/74 px-4 py-3">
                                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">Paziente</p>
                                <p className="mt-1 text-sm font-semibold text-[color:var(--mf-ink)]">
                                    {patient ? `${patient.lastName} ${patient.firstName}` : 'Caricamento...'}
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="rounded-[16px] border border-[color:rgba(112,106,100,0.12)] bg-white/70 px-3 py-2">
                                    <p className="text-xs text-[color:var(--mf-muted)]">Visite</p>
                                    <p className="text-sm font-semibold text-[color:var(--mf-ink)]">{visitEntryCount}</p>
                                </div>
                                <div className="rounded-[16px] border border-[color:rgba(112,106,100,0.12)] bg-white/70 px-3 py-2">
                                    <p className="text-xs text-[color:var(--mf-muted)]">Fonti</p>
                                    <p className="text-sm font-semibold text-[color:var(--mf-ink)]">{sourceCount}</p>
                                </div>
                            </div>
                            {patient?.diagnoses?.length ? (
                                <div className="flex flex-wrap gap-2">
                                    {patient.diagnoses.slice(0, 3).map((diagnosis) => (
                                        <span key={`${diagnosis.system}-${diagnosis.code}-${diagnosis.description}`} className="rounded-full border border-[color:rgba(15,123,104,0.16)] bg-[color:rgba(15,123,104,0.08)] px-3 py-1 text-xs font-semibold text-[color:var(--mf-primary)]">
                                            {diagnosis.description}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </section>

                    <section className="patient-detail-side-section rounded-[20px] border p-5">
                        <div className="mb-4">
                            <p className="section-kicker">Revisione recente</p>
                            <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-[color:var(--mf-ink)]">
                                <History className="h-5 w-5 text-[color:var(--mf-primary)]" />
                                Diario paziente
                            </h3>
                        </div>
                        <div className="space-y-3">
                            {recentEntries.length > 0 ? recentEntries.map((entry) => (
                                <div key={entry.id} className="rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/74 px-4 py-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">{formatEntryDate(entry.date)}</p>
                                    <p className="mt-1 text-sm font-semibold text-[color:var(--mf-ink)]">{entry.title}</p>
                                </div>
                            )) : (
                                <div className="rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/74 px-4 py-3">
                                    <p className="text-sm text-[color:var(--mf-muted)]">Nessuna voce recente disponibile.</p>
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="patient-detail-side-section rounded-[20px] border p-5">
                        <div className="mb-4">
                            <p className="section-kicker">Sicurezza</p>
                            <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-[color:var(--mf-ink)]">
                                <Sparkles className="h-5 w-5 text-[color:var(--mf-primary)]" />
                                Revisione manuale
                            </h3>
                        </div>
                        <div className="space-y-3 text-sm leading-6 text-[color:var(--mf-muted)]">
                            <p>La bozza dettata resta fuori dal diario finche non la porti nel resoconto.</p>
                            <p>Il salvataggio crea una voce clinica solo quando premi Registra nel diario.</p>
                        </div>
                    </section>
                </aside>
            </div>
        </Kree8WorkspaceShell>
    );
}
