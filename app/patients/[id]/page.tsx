'use client';

import { useLiveQuery } from '@/lib/live-query';
import { db, type Checkup, type ClinicalEntry } from '@/lib/db';
import { useParams } from 'next/navigation';
import { Phone, MapPin, Calendar, Plus, FileText, Activity, Pencil, Download } from 'lucide-react';
import Timeline from '@/components/timeline';
import DocumentUpload from '@/components/document-upload';
import TherapyManager from '@/components/therapy-manager';
/* @Codex */
import ObservationManager from '@/components/observation-manager';
import AIPatientInsight from '@/components/ai-patient-insight';
import DocumentInsightsPanel from '@/components/document-insights-panel';
/* @Codex */
import PatientSmartImportPanel from '@/components/patient-smart-import-panel';
/* @Codex */
import SissPatientContextPanel from '@/components/siss-patient-context-panel';
import PatientActionModal from '@/components/patient-action-modal';
import { useState } from 'react';

import Link from 'next/link';
import { estimateBirthYearFromTaxCode, calculateAge } from '@/lib/utils';
import PrivacyBlur from '@/components/privacy-blur';
import { useUIStyle } from '@/components/ui-style-provider';
/* @Codex */
import { buildValidationMessage, type ValidatePatientExportResponse } from '@/lib/fse-validate-patient-contract';
/* @Codex */
import { usePreviewProfileState } from '@/components/preview-profile-chrome';

export default function PatientDetailPage() {
    const params = useParams();
    const id = params.id as string;
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const { uiStyleMode } = useUIStyle();
    const isLiquid = uiStyleMode === 'liquid';
    /* @Codex */
    const { hasFeature } = usePreviewProfileState();
    /* @Codex */
    const isSissContextPreviewEnabled = hasFeature('siss-context-preview');

    const patient = useLiveQuery(() => db.patients.get(id), [id]);
    const entries = useLiveQuery(
        async () => {
            const items = await db.entries.filter((entry: ClinicalEntry) => entry.patientId === id).toArray();
            return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        },
        [id]
    );
    const checkups = useLiveQuery(
        async () => {
            const items = await db.checkups.filter((checkup: Checkup) => checkup.patientId === id).toArray();
            return items.filter((checkup) => checkup.status !== 'completed').sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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
            {/* Top Functional Layer: Liquid Glass Header */}
            <div className="relative z-20 -mx-4 -mt-2 px-4 pb-4 md:mx-0 md:mt-0 md:px-0">
                <div className={`glass-panel overflow-hidden rounded-[32px] backdrop-blur-2xl ${
                    isLiquid
                        ? 'border-white/40 bg-white/70 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] dark:border-white/10 dark:bg-white/10'
                        : 'border-black/5 bg-white/84 shadow-[0_22px_48px_-20px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/8'
                }`}>
                    <div className="liquid-orb -left-10 -top-10 h-40 w-40 bg-sky-400/20 blur-3xl" />
                    <div className="liquid-orb -bottom-10 right-0 h-40 w-40 bg-rose-400/15 blur-3xl" />
                    
                    <div className="relative z-10 p-6 md:p-8">
                        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                            {/* Identity & Status Layer */}
                            <div className="flex items-center gap-5">
                                <div className={`flex h-20 w-20 shrink-0 items-center justify-center text-2xl font-semibold text-white ${
                                    isLiquid
                                        ? 'rounded-[30px] bg-[linear-gradient(145deg,#0A84FF,#5AC8FA_58%,#34C759)] shadow-[0_20px_40px_rgba(10,132,255,0.25)]'
                                        : 'rounded-[24px] bg-sky-600 shadow-[0_14px_28px_rgba(10,132,255,0.18)]'
                                }`}>
                                    {patient.firstName[0]}{patient.lastName[0]}
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-3">
                                        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                                            <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                                        </h1>
                                        {patient.isAdi && (
                                            <span className="inline-flex items-center rounded-[18px] bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                                ADI
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                                        <span className="font-mono tracking-tight"><PrivacyBlur intensity="sm">{patient.taxCode}</PrivacyBlur></span>
                                        <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                                        <span>{ageLabel}</span>
                                        <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                                        <span className="flex items-center gap-1.5">
                                            <Calendar className="h-3.5 w-3.5" />
                                            {birthDateLabel}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Integrated Control Layer */}
                            <div className="flex flex-wrap items-center gap-3">
                                <Link
                                    href={`/patients/${id}/entries/new`}
                                    className={`ui-btn-primary h-11 px-6 ${isLiquid ? 'rounded-[28px]' : 'rounded-2xl'}`}
                                >
                                    <Plus className="h-4 w-4" />
                                    Nuova visita
                                </Link>

                                <div className={`flex h-11 items-center overflow-hidden p-1 ${
                                    isLiquid
                                        ? 'rounded-[28px] border border-white/60 bg-white/35 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5'
                                        : 'rounded-2xl border border-slate-200/80 bg-white/92 shadow-[0_10px_24px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/8'
                                }`}>
                                    <button
                                        onClick={() => setIsExportModalOpen(true)}
                                        className="flex h-full items-center gap-2 rounded-[22px] px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-white/70 dark:text-slate-200 dark:hover:bg-white/10"
                                    >
                                        <Download className="h-3.5 w-3.5" />
                                        Export FHIR
                                    </button>
                                    <div className="mx-1 h-5 w-px bg-slate-300/50 dark:bg-white/10" />
                                    <button
                                        onClick={async () => {
                                            const therapies = await db.therapies.filter((t) => t.patientId === id).toArray();
                                            const observations = await db.observations.filter((o) => o.patientId === id).toArray();
                                            import('@/lib/report-service').then((m) => {
                                                m.generatePatientReport(patient, nonScaleEntries, scaleEntries, therapies, observations);
                                            });
                                        }}
                                        className="flex h-full items-center gap-2 rounded-[22px] px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-white/70 dark:text-slate-200 dark:hover:bg-white/10"
                                        >
                                        <FileText className="h-3.5 w-3.5" />
                                        Report PDF
                                    </button>
                                    <div className="mx-1 h-5 w-px bg-slate-300/50 dark:bg-white/10" />
                                    <Link
                                        href={`/patients/${id}/edit`}
                                        className="flex h-8 w-8 items-center justify-center rounded-[18px] text-slate-600 transition-colors hover:bg-white/70 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                                        title="Modifica scheda"
                                        aria-label="Modifica scheda"
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Link>
                                </div>
                            </div>
                        </div>

                        {/* Quick Clinical Visibility Layer */}
                        <div className="mt-8 grid gap-4 lg:grid-cols-3">
                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Quadro Clinico</span>
                                <div className="flex flex-wrap gap-2">
                                    {diagnosisItems.length > 0 ? (
                                        visibleDiagnoses.map((d) => (
                                            <span key={`${d.system}-${d.code}`} className="inline-flex items-center gap-1.5 rounded-[18px] border border-rose-100 bg-rose-50/50 px-2.5 py-1 text-xs font-medium text-rose-700 dark:border-rose-900/30 dark:bg-rose-900/20 dark:text-rose-300">
                                                {d.code} · {d.description}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-xs italic text-slate-400">Nessuna diagnosi codificata</span>
                                    )}
                                    {hiddenDiagnoses.length > 0 && (
                                        <span className="inline-flex items-center rounded-[18px] bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500 dark:bg-white/10">
                                            +{hiddenDiagnoses.length}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Esenzioni & Stato</span>
                                <div className="flex flex-wrap gap-2">
                                    {exemptionCodes.length > 0 ? (
                                        <>
                                            {visibleExemptions.map((c) => (
                                                <span key={c} className="inline-flex items-center rounded-[18px] border border-sky-100 bg-sky-50/50 px-2.5 py-1 font-mono text-xs font-bold text-sky-700 dark:border-sky-900/30 dark:bg-sky-900/20 dark:text-sky-300">
                                                    {c}
                                                </span>
                                            ))}
                                            {hiddenExemptions.length > 0 && (
                                                <span className="inline-flex items-center rounded-[18px] bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500 dark:bg-white/10">
                                                    +{hiddenExemptions.length}
                                                </span>
                                            )}
                                        </>
                                    ) : (
                                        <span className="text-xs italic text-slate-400">Nessuna esenzione</span>
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Contatti Rapidi</span>
                                <div className="flex items-center gap-4 text-xs font-medium text-slate-600 dark:text-slate-300">
                                    <div className="flex items-center gap-1.5">
                                        <Phone className="h-3.5 w-3.5 text-slate-400" />
                                        <PrivacyBlur intensity="sm">{patient.phone || 'n/d'}</PrivacyBlur>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <MapPin className="h-3.5 w-3.5 text-slate-400" />
                                        <PrivacyBlur intensity="sm">{patient.address || 'n/d'}</PrivacyBlur>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.85fr)_minmax(320px,0.95fr)]">
                <div className="space-y-6">
                    {isSissContextPreviewEnabled ? (
                        <SissPatientContextPanel
                            patientId={id}
                            patientTaxCode={patient.taxCode}
                        />
                    ) : null}
                    <TherapyManager
                        patientId={id}
                        showLegacySissPrescriptionPanel={!isSissContextPreviewEnabled}
                    />
                    {/* @Codex */}
                    <ObservationManager patientId={id} />

                    <div className="glass-panel rounded-[28px] p-6 md:p-7">
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

                    <div className="glass-panel rounded-[28px] p-6">
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

                    <div className="glass-panel rounded-[28px] p-6">
                        <div className="mb-4">
                            <p className="section-kicker">Archivio paziente</p>
                            <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">Documenti e referti</h3>
                        </div>
                        <DocumentUpload patientId={id} />
                    </div>

                    <div className="glass-panel rounded-[28px] p-6">
                        <div className="mb-4">
                            <p className="section-kicker">Pianificazione</p>
                            <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
                                <Calendar className="h-5 w-5 text-indigo-500" />
                                Prossimi controlli
                            </h3>
                        </div>

                        {!checkups || checkups.length === 0 ? (
                            <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-6 text-center dark:border-white/10">
                                <p className="text-sm italic text-slate-500 dark:text-slate-400">Nessun controllo programmato.</p>
                                <Link href={`/patients/${id}/edit`} className="mt-3 inline-block text-xs font-medium text-sky-600 hover:underline dark:text-sky-300">
                                    Aggiungi o pianifica
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {checkups.map((checkup) => (
                                    <div key={checkup.id} className="rounded-[24px] border border-slate-200/80 bg-white/78 px-4 py-3 dark:border-white/10 dark:bg-white/5">
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
