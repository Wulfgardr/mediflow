'use client';

/* @Codex */
import Link from 'next/link';
/* @Codex */
import { useMemo } from 'react';
/* @Codex */
import {
    ArrowUpRight,
    CalendarClock,
    Clock3,
    FileSearch,
    HeartPulse,
    ShieldCheck,
    Stethoscope,
} from 'lucide-react';

/* @Codex */
import PrivacyBlur from '@/components/privacy-blur';
/* @Codex */
import { StatusGlyph } from '@/components/status-glyph';
/* @Codex */
import { db, type Checkup, type ClinicalEntry, type Diagnosis, type DocumentInsight, type Patient } from '@/lib/db';
/* @Codex */
import { useLiveQuery } from '@/lib/live-query';
/* @Codex */
import { estimateBirthYearFromTaxCode, calculateAge } from '@/lib/utils';

interface CaseLensPanelProps {
    /* @Codex */
    variant?: 'atlas' | 'reader';
    patient: Patient | null;
    ambulatoryName?: string;
}

function getAgeLabel(patient: Patient): string {
    const birthYear = patient.birthDate
        ? new Date(patient.birthDate).getFullYear()
        : estimateBirthYearFromTaxCode(patient.taxCode);

    return birthYear ? `${calculateAge(birthYear)} anni` : 'Età n/d';
}

/* @Codex */
function getDiagnosisList(patient: Patient): Diagnosis[] {
    return Array.isArray(patient.diagnoses) ? patient.diagnoses.slice(0, 3) : [];
}

/* @Codex */
function getDocumentInsights(patient: Patient): DocumentInsight[] {
    if (!Array.isArray(patient.documentInsights)) return [];
    return [...patient.documentInsights].sort(
        (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
    );
}

/* @Codex */
function getStatusGlyph(patient: Patient) {
    if (patient.isArchived) return { kind: 'archived' as const, label: 'Archiviato' };
    if (patient.isAdi) return { kind: 'active' as const, label: 'Attivo' };
    return { kind: 'follow-up' as const, label: 'Follow-up' };
}

/* @Codex */
function formatDateLabel(date?: Date) {
    if (!date) return 'Nessuna data';
    return new Intl.DateTimeFormat('it-IT', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(new Date(date));
}

/* @Codex */
function buildReaderSummary(patient: Patient, diagnoses: Diagnosis[], nextCheckup?: Checkup) {
    const leadDiagnosis = diagnoses[0];
    const diagnosisText = leadDiagnosis
        ? `${leadDiagnosis.code} · ${leadDiagnosis.description}`
        : 'Scheda senza diagnosi strutturate in primo piano.';

    if (patient.isArchived) {
        return `${diagnosisText} Percorso chiuso: serve solo una verifica per eventuale riapertura.`;
    }

    if (nextCheckup) {
        return `${diagnosisText} Prossimo controllo pianificato per il ${formatDateLabel(nextCheckup.date)}.`;
    }

    if (patient.isAdi) {
        return `${diagnosisText} Continuità territoriale attiva con bisogno di riallineare diario e controlli.`;
    }

    return `${diagnosisText} Il caso è pronto per revisione, diario ed eventuale supporto AI.`;
}

/* @Codex */
function buildNextStep(patient: Patient, nextCheckup?: Checkup, latestEntry?: ClinicalEntry, latestDocument?: DocumentInsight) {
    if (patient.isArchived) {
        return 'Conferma chiusura oppure riapri la scheda se il percorso torna attivo.';
    }
    if (nextCheckup) {
        return `Preparare il controllo "${nextCheckup.title}" e riallineare la scheda prima della data prevista.`;
    }
    if (latestDocument) {
        return `Rivedere il referto "${latestDocument.fileName}" e verificare se va promosso nel quadro clinico.`;
    }
    if (latestEntry) {
        return `Ripartire dall'ultima nota "${latestEntry.title || 'Voce clinica'}" e aggiornare il diario del caso.`;
    }
    return patient.isAdi
        ? 'Allineare stato territoriale, diario ed eventuali esenzioni.'
        : 'Aprire la scheda completa e fissare il prossimo step clinico.';
}

export function CaseLensPanel({ variant = 'atlas', patient, ambulatoryName }: CaseLensPanelProps) {
    const isReader = variant === 'reader';

    const activity = useLiveQuery(async () => {
        if (!patient) return { entries: [] as ClinicalEntry[], checkups: [] as Checkup[] };

        const [entries, checkups] = await Promise.all([
            db.entries
                .filter((entry: ClinicalEntry) => entry.patientId === patient.id && !entry.deletedAt)
                .toArray(),
            db.checkups
                .filter((checkup: Checkup) => checkup.patientId === patient.id && checkup.status !== 'completed')
                .toArray(),
        ]);

        return {
            entries: [...entries].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()),
            checkups: [...checkups].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime()),
        };
    }, [patient?.id]);

    const diagnoses = useMemo(() => (patient ? getDiagnosisList(patient) : []), [patient]);
    const documents = useMemo(() => (patient ? getDocumentInsights(patient) : []), [patient]);
    const latestEntry = activity?.entries[0];
    const nextCheckup = activity?.checkups[0];
    const latestDocument = documents[0];

    if (!patient) {
        return (
            <aside className="case-lens-panel case-lens-empty rounded-[24px] border border-[color:rgba(112,106,100,0.12)] bg-[color:rgba(255,252,247,0.76)] p-5 shadow-[0_16px_30px_rgba(35,27,22,0.06)] backdrop-blur-2xl">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--mf-muted)]">
                    {isReader ? 'Chart Reader' : 'Case Lens'}
                </p>
                <h2 className="mt-3 text-lg font-semibold text-[color:var(--mf-ink)]">
                    {isReader ? 'Seleziona un paziente dall’inbox' : 'Seleziona un caso dal flusso clinico'}
                </h2>
                <p className="mt-3 text-sm leading-6 text-[color:var(--mf-muted)]">
                    {isReader
                        ? 'Il pannello laterale resta sempre nello stesso posto: lista a sinistra, lettura del caso a destra.'
                        : 'La lente contestuale mostra percorso, segnali e prossimo passo senza trasformare la home in una tabella.'}
                </p>
                <div className="case-lens-placeholder mt-6 rounded-[18px] border border-dashed border-[color:rgba(112,106,100,0.18)] px-4 py-5 text-sm text-[color:var(--mf-muted)]">
                    {isReader
                        ? 'Qui compariranno quadro rapido, prossimi controlli ed evidenze recenti del paziente selezionato.'
                        : 'Ogni caso selezionato porta qui il suo quadro rapido, la priorità corrente e un punto di ingresso diretto alla scheda.'}
                </div>
            </aside>
        );
    }

    const status = getStatusGlyph(patient);
    const summary = buildReaderSummary(patient, diagnoses, nextCheckup);
    const nextStep = buildNextStep(patient, nextCheckup, latestEntry, latestDocument);

    if (isReader) {
        return (
            <aside className="case-lens-panel patient-reader-panel sticky top-6 rounded-[20px] border border-[color:rgba(112,106,100,0.12)] bg-[color:rgba(255,252,247,0.9)] p-5 shadow-[0_18px_36px_rgba(35,27,22,0.08)] backdrop-blur-xl">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--mf-muted)]">
                            Chart Reader
                        </p>
                        <h2 className="mt-2 text-xl font-semibold text-[color:var(--mf-ink)]">
                            <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                        </h2>
                        <p className="mt-1 text-sm text-[color:var(--mf-muted)]">
                            {getAgeLabel(patient)} · {ambulatoryName ?? 'Ambulatorio locale'}
                        </p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[color:rgba(15,123,104,0.08)] text-[color:var(--mf-primary)]">
                        <FileSearch className="h-4.5 w-4.5" />
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                    <StatusGlyph kind={status.kind} label={status.label} />
                    {patient.isAdi ? <StatusGlyph kind="review" label="Territorio" /> : null}
                    {documents.length > 0 ? <StatusGlyph kind="review" label={`${documents.length} evidenze`} /> : null}
                </div>

                <section className="mt-5 border-t border-[color:rgba(112,106,100,0.12)] pt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                        In Due Righe
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--mf-ink)]">
                        {summary}
                    </p>
                </section>

                <section className="mt-5 border-t border-[color:rgba(112,106,100,0.12)] pt-4">
                    <div className="flex items-center gap-2 text-[color:var(--mf-primary)]">
                        <Clock3 className="h-4 w-4" />
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            Prossimo Step
                        </p>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--mf-ink)]">
                        {nextStep}
                    </p>
                </section>

                <section className="mt-5 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-[14px] border border-[color:rgba(112,106,100,0.12)] bg-white/72 px-3 py-3 dark:bg-white/4">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            Diario
                        </p>
                        <p className="mt-1 text-lg font-semibold text-[color:var(--mf-ink)]">{activity?.entries.length ?? 0}</p>
                    </div>
                    <div className="rounded-[14px] border border-[color:rgba(112,106,100,0.12)] bg-white/72 px-3 py-3 dark:bg-white/4">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            Follow-up
                        </p>
                        <p className="mt-1 text-lg font-semibold text-[color:var(--mf-ink)]">{activity?.checkups.length ?? 0}</p>
                    </div>
                    <div className="rounded-[14px] border border-[color:rgba(112,106,100,0.12)] bg-white/72 px-3 py-3 dark:bg-white/4">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            Documenti
                        </p>
                        <p className="mt-1 text-lg font-semibold text-[color:var(--mf-ink)]">{documents.length}</p>
                    </div>
                </section>

                <section className="mt-5 border-t border-[color:rgba(112,106,100,0.12)] pt-4">
                    <div className="flex items-center gap-2 text-[color:var(--mf-plum)]">
                        <Stethoscope className="h-4 w-4" />
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            Ultimo Segnale
                        </p>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-[color:var(--mf-ink)]">
                        {latestEntry ? (
                            <p>
                                <span className="font-semibold">{latestEntry.title || 'Voce clinica'}</span>
                                {' '}· {formatDateLabel(latestEntry.date)}
                            </p>
                        ) : latestDocument ? (
                            <p>
                                <span className="font-semibold">{latestDocument.fileName}</span>
                                {' '}· {formatDateLabel(latestDocument.date)}
                            </p>
                        ) : (
                            <p className="text-[color:var(--mf-muted)]">
                                Nessun segnale recente in primo piano.
                            </p>
                        )}
                        {latestDocument ? (
                            <p className="line-clamp-3 text-[color:var(--mf-muted)]">
                                {latestDocument.summary || 'Documento pronto per revisione contestuale.'}
                            </p>
                        ) : null}
                    </div>
                </section>

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    <Link
                        href={`/patients/${patient.id}`}
                        className="inline-flex items-center justify-center gap-2 rounded-[12px] bg-[color:var(--mf-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[color:rgba(15,123,104,0.88)]"
                    >
                        Apri scheda
                        <ArrowUpRight className="h-4 w-4" />
                    </Link>
                    <Link
                        href={`/patients/${patient.id}/entries/new`}
                        className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-[color:rgba(112,106,100,0.14)] bg-white/84 px-4 py-2.5 text-sm font-semibold text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(15,123,104,0.24)] hover:text-[color:var(--mf-primary)] dark:bg-white/6"
                    >
                        Nuova visita
                        <HeartPulse className="h-4 w-4" />
                    </Link>
                </div>

                <div className="mt-4 flex items-center gap-2 text-[11px] text-[color:var(--mf-muted)]">
                    <ShieldCheck className="h-3.5 w-3.5 text-[color:var(--mf-primary)]" />
                    Supporto locale, nessun egress cloud.
                </div>
            </aside>
        );
    }

    return (
        <aside className="case-lens-panel sticky top-8 rounded-[30px] border border-[color:rgba(112,106,100,0.12)] bg-[color:rgba(255,249,240,0.76)] p-6 shadow-[0_24px_44px_rgba(35,27,22,0.08)] backdrop-blur-3xl">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--mf-muted)]">
                        Case Lens
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-[color:var(--mf-ink)]">
                        <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                    </h2>
                    <p className="mt-1 text-sm text-[color:var(--mf-muted)]">
                        {getAgeLabel(patient)} · {ambulatoryName ?? 'Ambulatorio locale'}
                    </p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-[18px] bg-[linear-gradient(145deg,rgba(15,123,104,0.14),rgba(94,53,95,0.12))] text-[color:var(--mf-primary)]">
                    <FileSearch className="h-5 w-5" />
                </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
                <StatusGlyph kind={status.kind} label={status.label} />
                <StatusGlyph kind="review" label="Monitoraggio" />
            </div>

            <div className="mt-6 space-y-4">
                <section className="case-lens-section rounded-[22px] border border-[color:rgba(112,106,100,0.12)] bg-white/66 p-4 dark:bg-white/4">
                    <div className="flex items-center gap-2 text-[color:var(--mf-primary)]">
                        <Stethoscope className="h-4 w-4" />
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            Focus clinico
                        </p>
                    </div>
                    <div className="mt-3 space-y-2">
                        {diagnoses.length > 0 ? (
                            diagnoses.map((diagnosis) => (
                                <p key={`${diagnosis.system}-${diagnosis.code}`} className="text-sm text-[color:var(--mf-ink)]">
                                    <span className="font-semibold">{diagnosis.code}</span> · {diagnosis.description}
                                </p>
                            ))
                        ) : (
                            <p className="text-sm text-[color:var(--mf-muted)]">
                                Nessuna diagnosi codificata in primo piano. Usa la scheda per strutturare il caso.
                            </p>
                        )}
                    </div>
                </section>

                <section className="case-lens-section rounded-[22px] border border-[color:rgba(112,106,100,0.12)] bg-white/66 p-4 dark:bg-white/4">
                    <div className="flex items-center gap-2 text-[color:var(--mf-accent)]">
                        <CalendarClock className="h-4 w-4" />
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            Prossimo passo
                        </p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[color:var(--mf-ink)]">
                        {nextStep}
                    </p>
                </section>
            </div>

            <div className="case-lens-footer mt-6 flex items-center justify-between rounded-[22px] border border-[color:rgba(112,106,100,0.12)] bg-white/72 p-4 dark:bg-white/4">
                <div className="flex items-center gap-2 text-sm text-[color:var(--mf-muted)]">
                    <ShieldCheck className="h-4 w-4 text-[color:var(--mf-primary)]" />
                    Supporto locale, nessun egress cloud.
                </div>
                <Link
                    href={`/patients/${patient.id}`}
                    className="inline-flex items-center gap-2 rounded-full border border-[color:rgba(112,106,100,0.14)] bg-white/84 px-3.5 py-2 text-[13px] font-semibold text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(15,123,104,0.26)] hover:text-[color:var(--mf-primary)] dark:bg-white/6"
                >
                    Apri caso
                    <ArrowUpRight className="h-4 w-4" />
                </Link>
            </div>
        </aside>
    );
}
