'use client';

import { useLiveQuery } from '@/lib/live-query';
import { db } from '@/lib/db';
import { useParams } from 'next/navigation';
import { User, Phone, MapPin, Calendar, Plus, FileText, Activity, Pencil, HeartHandshake, Info, Ticket, Download } from 'lucide-react';
import Timeline from '@/components/timeline';
import DocumentUpload from '@/components/document-upload';
import TherapyManager from '@/components/therapy-manager';
/* @Codex */
import ObservationManager from '@/components/observation-manager';
import AIPatientInsight from '@/components/ai-patient-insight';
import DocumentInsightsPanel from '@/components/document-insights-panel';
/* @Codex */
import PatientSmartImportPanel from '@/components/patient-smart-import-panel';
import PatientActionModal from '@/components/patient-action-modal';
import { useState, type ReactNode } from 'react';

import Link from 'next/link';
import { estimateBirthYearFromTaxCode, calculateAge } from '@/lib/utils';
import PrivacyBlur from '@/components/privacy-blur';

/* @Codex */
type ValidationSummary = {
    total: number;
    withErrors: number;
    withWarnings: number;
    errorCount: number;
    warningCount: number;
};

/* @Codex */
type ValidatePatientExportResponse = {
    patientId: string;
    hasErrors: boolean;
    hasWarnings: boolean;
    therapyMedication: ValidationSummary;
    observationVitals: ValidationSummary;
};

/* @Codex */
function buildValidationMessage(validation: ValidatePatientExportResponse): string {
    return [
        `Terapie: ${validation.therapyMedication.total} record, ${validation.therapyMedication.errorCount} errori, ${validation.therapyMedication.warningCount} warning`,
        `Osservazioni: ${validation.observationVitals.total} record, ${validation.observationVitals.errorCount} errori, ${validation.observationVitals.warningCount} warning`,
    ].join('\n');
}

/* @Codex */
function PatientMetaBlock({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
    return (
        <div className="apple-subsection p-3.5 md:p-4">
            <div className="section-kicker flex items-center gap-2">
                {icon}
                <span>{label}</span>
            </div>
            <div className="mt-2 text-sm leading-relaxed text-slate-800 dark:text-slate-100">
                {children}
            </div>
        </div>
    );
}

export default function PatientDetailPage() {
    const params = useParams();
    const id = params.id as string;
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);

    const patient = useLiveQuery(() => db.patients.get(id), [id]);
    const entries = useLiveQuery(
        async () => {
            const items = await db.entries.filter((e: any) => e.patientId === id).toArray();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return items.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        },
        [id]
    );
    const checkups = useLiveQuery(
        async () => {
            const items = await db.checkups.filter((c: any) => c.patientId === id).toArray();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return items.filter((c: any) => c.status !== 'completed').sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
        },
        [id]
    );

    if (!patient) {
        return <div className="p-8 text-center text-gray-500">Caricamento cartella paziente...</div>;
    }

    /* @Codex */
    const exemptionCodes = Array.isArray(patient.exemptions) ? patient.exemptions : [];
    /* @Codex */
    const diagnosisItems = Array.isArray(patient.diagnoses) ? patient.diagnoses : [];
    /* @Codex */
    const birthYear = patient.birthDate
        ? new Date(patient.birthDate).getFullYear()
        : estimateBirthYearFromTaxCode(patient.taxCode);
    /* @Codex */
    const birthDateLabel = patient.birthDate
        ? new Date(patient.birthDate).toLocaleDateString('it-IT')
        : birthYear
            ? `Stima da codice fiscale (${birthYear})`
            : 'Non disponibile';
    /* @Codex */
    const ageLabel = birthYear ? `${calculateAge(birthYear)} anni` : 'Età non disponibile';
    /* @Codex */
    const activeEntries = (entries ?? []).filter((entry) => !entry.deletedAt);
    /* @Codex */
    const nonScaleEntries = activeEntries.filter((entry) => entry.type !== 'scale');
    /* @Codex */
    const scaleEntries = activeEntries.filter((entry) => entry.type === 'scale');
    /* @Codex */
    const visibleDiagnoses = diagnosisItems.slice(0, 4);
    /* @Codex */
    const hiddenDiagnoses = diagnosisItems.slice(4);
    /* @Codex */
    const visibleExemptions = exemptionCodes.slice(0, 6);
    /* @Codex */
    const hiddenExemptions = exemptionCodes.slice(6);

    /* @Codex */
    const handleExportConfirm = async () => {
        try {
            const validationResponse = await fetch(`/api/fse/validate-patient?patientId=${encodeURIComponent(id)}`);
            if (!validationResponse.ok) {
                throw new Error('Validation pre-check failed');
            }
            const validation = await validationResponse.json() as ValidatePatientExportResponse;

            if (validation.hasErrors) {
                alert(`Esportazione bloccata: risolvi gli errori di validazione FSE prima del download.\n\n${buildValidationMessage(validation)}`);
                return;
            }

            if (validation.hasWarnings) {
                const proceed = confirm(
                    `Sono presenti warning di validazione FSE.\n\n${buildValidationMessage(validation)}\n\nVuoi proseguire comunque con l'export?`,
                );
                if (!proceed) return;
            }

            const { generatePatientBundle } = await import('@/lib/fhir/bundle-generator');
            const bundle = await generatePatientBundle(id);

            const jsonString = JSON.stringify(bundle, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `patient-${patient.lastName}-${patient.firstName}-fhir.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            alert("Esportazione FHIR completata con successo!");
        } catch (error) {
            console.error("Export failed", error);
            alert("Errore durante l'esportazione.");
        }
    };

    return (
        <div className="space-y-6">
            <div className="glass-panel liquid-hero p-6 md:p-8">
                <div className="liquid-orb -left-10 top-0 h-32 w-32 bg-sky-300/35" />
                <div className="liquid-orb right-8 top-8 h-28 w-28 bg-rose-300/28" />
                <div className="liquid-orb bottom-4 left-1/2 h-24 w-24 bg-emerald-200/20" />
                <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
                    <div className="relative z-10 flex-1 space-y-6">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                            <div className="flex items-start gap-4">
                                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[30px] bg-[linear-gradient(145deg,#0A84FF,#5AC8FA_58%,#34C759)] text-2xl font-semibold text-white shadow-[0_22px_44px_rgba(10,132,255,0.24)]">
                                    {patient.firstName[0]}{patient.lastName[0]}
                                </div>
                                <div className="space-y-3">
                                    <div className="section-kicker">Scheda paziente</div>
                                    <div>
                                        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white md:text-4xl">
                                            <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                                        </h1>
                                        <p className="mt-1 font-mono text-sm tracking-wide text-slate-500 dark:text-slate-400">
                                            <PrivacyBlur intensity="sm">{patient.taxCode}</PrivacyBlur>
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2.5">
                                        <span className="apple-chip">
                                            <Calendar className="h-3.5 w-3.5 text-sky-500" />
                                            {ageLabel}
                                        </span>
                                        <span className="apple-chip">
                                            <FileText className="h-3.5 w-3.5 text-slate-500" />
                                            Diario {nonScaleEntries.length}
                                        </span>
                                        <span className="apple-chip">
                                            <Activity className="h-3.5 w-3.5 text-indigo-500" />
                                            Scale {scaleEntries.length}
                                        </span>
                                        <span className="apple-chip">
                                            <Calendar className="h-3.5 w-3.5 text-emerald-500" />
                                            Controlli {checkups?.length ?? 0}
                                        </span>
                                        {patient.isAdi && <span className="apple-chip text-emerald-700 dark:text-emerald-300">ADI</span>}
                                    </div>
                                </div>
                            </div>

                            <Link
                                href={`/patients/${id}/edit`}
                                className="inline-flex items-center gap-2 self-start rounded-full border border-white/70 bg-white/76 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.06)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-white hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-white/20"
                            >
                                <Pencil className="h-4 w-4" />
                                Modifica scheda
                            </Link>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <PatientMetaBlock label="Nascita" icon={<Calendar className="h-3.5 w-3.5 text-sky-500" />}>
                                <div>{birthDateLabel}</div>
                                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{ageLabel}</div>
                            </PatientMetaBlock>

                            <PatientMetaBlock label="Telefono" icon={<Phone className="h-3.5 w-3.5 text-violet-500" />}>
                                <PrivacyBlur intensity="sm">{patient.phone || 'Non disponibile'}</PrivacyBlur>
                            </PatientMetaBlock>

                            <PatientMetaBlock label="Indirizzo" icon={<MapPin className="h-3.5 w-3.5 text-emerald-500" />}>
                                <PrivacyBlur intensity="sm">{patient.address || 'Non disponibile'}</PrivacyBlur>
                            </PatientMetaBlock>

                            <PatientMetaBlock label="Caregiver" icon={<HeartHandshake className="h-3.5 w-3.5 text-rose-500" />}>
                                <PrivacyBlur intensity="sm">{patient.caregiver || 'Non indicato'}</PrivacyBlur>
                            </PatientMetaBlock>
                        </div>

                        <div className="grid gap-4 xl:grid-cols-2">
                            <section className="apple-subsection space-y-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="section-kicker">Quadro clinico rapido</p>
                                        <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Diagnosi in scheda</h2>
                                    </div>
                                    <span className="apple-chip">{diagnosisItems.length} codifiche</span>
                                </div>

                                {diagnosisItems.length > 0 ? (
                                    <div className="space-y-3">
                                        <div className="flex flex-wrap gap-2.5">
                                            {visibleDiagnoses.map((diagnosis) => (
                                                <span
                                                    key={`${diagnosis.system}-${diagnosis.code}`}
                                                    className="rounded-full border border-rose-200/70 bg-[linear-gradient(135deg,rgba(255,241,242,0.92),rgba(255,255,255,0.75))] px-3.5 py-1.5 text-xs font-medium text-rose-700 shadow-[0_10px_20px_rgba(190,24,93,0.07)] dark:border-rose-500/20 dark:bg-rose-900/10 dark:text-rose-200"
                                                    title={`${diagnosis.system} ${diagnosis.code} · ${diagnosis.description}`}
                                                >
                                                    {diagnosis.system} {diagnosis.code} · {diagnosis.description}
                                                </span>
                                            ))}
                                        </div>

                                        {hiddenDiagnoses.length > 0 && (
                                            <details className="rounded-[24px] border border-white/70 bg-white/72 px-4 py-3 backdrop-blur-md dark:border-white/10 dark:bg-white/5">
                                                <summary className="cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300">
                                                    Mostra altre {hiddenDiagnoses.length} diagnosi
                                                </summary>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {hiddenDiagnoses.map((diagnosis) => (
                                                        <span
                                                            key={`${diagnosis.system}-${diagnosis.code}`}
                                                            className="rounded-full border border-rose-200/70 bg-[linear-gradient(135deg,rgba(255,241,242,0.92),rgba(255,255,255,0.75))] px-3.5 py-1.5 text-xs font-medium text-rose-700 shadow-[0_10px_20px_rgba(190,24,93,0.07)] dark:border-rose-500/20 dark:bg-rose-900/10 dark:text-rose-200"
                                                        >
                                                            {diagnosis.system} {diagnosis.code} · {diagnosis.description}
                                                        </span>
                                                    ))}
                                                </div>
                                            </details>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                                        Nessuna codifica ICD associata alla scheda.
                                    </p>
                                )}
                            </section>

                            <section className="apple-subsection space-y-4">
                                <div>
                                    <p className="section-kicker flex items-center gap-2">
                                        <Ticket className="h-3.5 w-3.5 text-indigo-500" />
                                        Assetto amministrativo
                                    </p>
                                    <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Esenzioni e note operative</h2>
                                </div>

                                {exemptionCodes.length > 0 ? (
                                    <div className="space-y-3">
                                        <div className="flex flex-wrap gap-2.5">
                                            {visibleExemptions.map((code) => (
                                                <span
                                                    key={code}
                                                    className="rounded-full border border-indigo-200/70 bg-[linear-gradient(135deg,rgba(238,242,255,0.92),rgba(255,255,255,0.76))] px-3.5 py-1.5 font-mono text-xs font-medium text-indigo-700 shadow-[0_10px_20px_rgba(79,70,229,0.07)] dark:border-indigo-500/20 dark:bg-indigo-900/10 dark:text-indigo-200"
                                                >
                                                    {code}
                                                </span>
                                            ))}
                                        </div>

                                        {hiddenExemptions.length > 0 && (
                                            <details className="rounded-[24px] border border-white/70 bg-white/72 px-4 py-3 backdrop-blur-md dark:border-white/10 dark:bg-white/5">
                                                <summary className="cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300">
                                                    Mostra altre {hiddenExemptions.length} esenzioni
                                                </summary>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {hiddenExemptions.map((code) => (
                                                        <span
                                                            key={code}
                                                            className="rounded-full border border-indigo-200/70 bg-[linear-gradient(135deg,rgba(238,242,255,0.92),rgba(255,255,255,0.76))] px-3.5 py-1.5 font-mono text-xs font-medium text-indigo-700 shadow-[0_10px_20px_rgba(79,70,229,0.07)] dark:border-indigo-500/20 dark:bg-indigo-900/10 dark:text-indigo-200"
                                                        >
                                                            {code}
                                                        </span>
                                                    ))}
                                                </div>
                                            </details>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                                        Nessuna esenzione associata alla scheda.
                                    </p>
                                )}

                                {patient.notes ? (
                                    <div className="rounded-[24px] border border-amber-200/75 bg-[linear-gradient(135deg,rgba(255,247,237,0.94),rgba(255,255,255,0.8))] p-4 text-sm leading-7 text-amber-950 shadow-[0_12px_28px_rgba(217,119,6,0.08)] dark:border-amber-500/20 dark:bg-amber-900/10 dark:text-amber-100">
                                        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                                            <Info className="h-3.5 w-3.5" />
                                            Nota clinico-operativa
                                        </div>
                                        <PrivacyBlur>{patient.notes}</PrivacyBlur>
                                    </div>
                                ) : (
                                    <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                                        Nessuna nota operativa aggiunta alla scheda.
                                    </p>
                                )}
                            </section>
                        </div>
                    </div>

                    <aside className="relative z-10 xl:w-[320px] xl:shrink-0">
                        <div className="apple-subsection space-y-3">
                            <div>
                                <p className="section-kicker">Azioni rapide</p>
                                <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Operazioni sulla scheda</h2>
                            </div>

                            <Link
                                href={`/patients/${id}/entries/new`}
                                className="flex items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#0A84FF,#5AC8FA)] px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_34px_rgba(10,132,255,0.28)] transition-all hover:-translate-y-0.5 hover:shadow-[0_22px_40px_rgba(10,132,255,0.34)]"
                            >
                                <Plus className="h-4 w-4" />
                                Nuova visita
                            </Link>

                            <button
                                onClick={() => setIsExportModalOpen(true)}
                                className="flex w-full items-center justify-center gap-2 rounded-full border border-white/70 bg-white/76 px-4 py-3 text-sm font-medium text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.06)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-white hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:border-white/20"
                            >
                                <Download className="h-4 w-4" />
                                Export FHIR
                            </button>

                            <button
                                onClick={async () => {
                                    const therapies = await db.therapies.filter((therapy) => therapy.patientId === id).toArray();
                                    /* @Codex */
                                    const observations = await db.observations.filter((observation) => observation.patientId === id).toArray();

                                    import('@/lib/report-service').then((mod) => {
                                        mod.generatePatientReport(patient, nonScaleEntries, scaleEntries, therapies, observations);
                                    });
                                }}
                                className="flex w-full items-center justify-center gap-2 rounded-full border border-white/70 bg-white/76 px-4 py-3 text-sm font-medium text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.06)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-white hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:border-white/20"
                            >
                                <FileText className="h-4 w-4" />
                                Scarica report PDF
                            </button>

                            <p className="text-xs leading-6 text-slate-500 dark:text-slate-400">
                                Il layer piu “liquido” resta qui: il contenuto clinico al centro, le azioni in una fascia separata e facile da raggiungere.
                            </p>
                        </div>
                    </aside>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.85fr)_minmax(320px,0.95fr)]">
                <div className="space-y-6">
                    <TherapyManager patientId={id} />
                    {/* @Codex */}
                    <ObservationManager patientId={id} />

                    <div className="glass-panel p-6 md:p-7">
                        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                                <p className="section-kicker">Percorso clinico</p>
                                <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-white">
                                    <FileText className="h-5 w-5 text-slate-400 dark:text-slate-500" />
                                    Diario clinico
                                </h2>
                            </div>
                            <span className="apple-chip self-start md:self-auto">{nonScaleEntries.length} voci attive</span>
                        </div>
                        {entries && <Timeline entries={entries} />}
                    </div>
                </div>

                <div className="space-y-6">
                    <AIPatientInsight patient={patient} />
                    {/* @Codex */}
                    <PatientSmartImportPanel patient={patient} entries={entries} />
                    <DocumentInsightsPanel patient={patient} />

                    <div className="glass-panel p-6">
                        <div className="mb-4">
                            <p className="section-kicker">Strumenti di scheda</p>
                            <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
                                <Activity className="h-5 w-5 text-sky-500" />
                                Valutazioni rapide
                            </h3>
                        </div>
                        <div className="space-y-3">
                            <Link href={`/patients/${id}/scales/tinetti`} className="apple-list-row">
                                <span>Tinetti</span>
                                <Plus className="h-4 w-4 text-sky-500" />
                            </Link>
                            <Link href={`/patients/${id}/scales/mmse`} className="apple-list-row">
                                <span>MMSE</span>
                                <Plus className="h-4 w-4 text-sky-500" />
                            </Link>
                            <Link href={`/patients/${id}/scales/adl`} className="apple-list-row">
                                <span>ADL (Katz)</span>
                                <Plus className="h-4 w-4 text-sky-500" />
                            </Link>
                            <Link href={`/patients/${id}/scales/gds`} className="apple-list-row">
                                <span>GDS</span>
                                <Plus className="h-4 w-4 text-sky-500" />
                            </Link>
                            <Link href={`/scales`} className="block pt-1 text-xs font-medium text-slate-500 transition-colors hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-300">
                                Vedi tutte le scale
                            </Link>
                        </div>
                    </div>

                    <div className="glass-panel p-6">
                        <div className="mb-4">
                            <p className="section-kicker">Archivio paziente</p>
                            <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">Documenti e referti</h3>
                        </div>
                        <DocumentUpload patientId={id} />
                    </div>

                    <div className="glass-panel p-6">
                        <div className="mb-4">
                            <p className="section-kicker">Pianificazione</p>
                            <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
                                <Calendar className="h-5 w-5 text-indigo-500" />
                                Prossimi controlli
                            </h3>
                        </div>

                        {!checkups || checkups.length === 0 ? (
                            <div className="rounded-[22px] border border-dashed border-slate-200 px-4 py-6 text-center dark:border-white/10">
                                <p className="text-sm italic text-slate-500 dark:text-slate-400">Nessun controllo programmato.</p>
                                <Link href={`/patients/${id}/edit`} className="mt-3 inline-block text-xs font-medium text-sky-600 hover:underline dark:text-sky-300">
                                    Aggiungi o pianifica
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {checkups.map((checkup) => (
                                    <div key={checkup.id} className="rounded-[22px] border border-slate-200/80 bg-white/78 px-4 py-3 dark:border-white/10 dark:bg-white/5">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white">{checkup.title}</p>
                                                {checkup.notes && (
                                                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{checkup.notes}</p>
                                                )}
                                            </div>
                                            <span className="apple-chip shrink-0">{new Date(checkup.date).toLocaleDateString('it-IT')}</span>
                                        </div>
                                    </div>
                                ))}
                                <Link href={`/patients/${id}/edit`} className="block pt-1 text-xs font-medium text-slate-500 transition-colors hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-300">
                                    Gestisci controlli
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <PatientActionModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
                onConfirm={async () => handleExportConfirm()}
                patientName={`${patient.firstName} ${patient.lastName}`}
                actionType="export"
            />
        </div>
    );
}
