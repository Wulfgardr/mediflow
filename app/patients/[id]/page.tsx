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
import { useState } from 'react';

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
        <div className="space-y-8">
            {/* ... (Header Card unchanged) ... */}

            {/* Same layout... */}

            {/* Note: In the lower section, replacing the placeholder */}

            {/* ... */}

            {/* Patient Header Card */}
            {/* Patient Header Card */}
            <div className="glass-panel p-8 relative">
                {/* Background Decoration */}
                <div className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
                    <div className="absolute top-0 right-0 p-6 opacity-30">
                        <User className="w-32 h-32 text-blue-900/10" />
                    </div>
                </div>

                <div className="relative z-10 flex flex-col md:flex-row gap-8 items-start">
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-3xl font-bold shadow-lg shadow-blue-500/30">
                        {patient.firstName[0]}{patient.lastName[0]}
                    </div>

                    <div className="flex-1 space-y-4">
                        <div className="flex justify-between items-start">
                            <div>
                                <h1 className="text-3xl font-bold text-gray-800 dark:text-white">
                                    <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                                </h1>
                                <p className="text-gray-500 dark:text-gray-400 font-mono tracking-wide flex items-center gap-2">
                                    <PrivacyBlur intensity="sm">{patient.taxCode}</PrivacyBlur>
                                </p>
                            </div>

                            <Link
                                href={`/patients/${id}/edit`}
                                className="flex items-center gap-2 px-3 py-1.5 bg-white/60 hover:bg-white text-gray-700 rounded-lg text-sm font-medium transition-colors border border-gray-200/50"
                            >
                                <Pencil className="w-4 h-4" />
                                Modifica
                            </Link>
                        </div>

                        <div className="flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-300">
                            <div className="flex items-center gap-2 bg-white/50 dark:bg-white/5 px-3 py-1.5 rounded-lg border border-transparent dark:border-white/10">
                                <Calendar className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                                {patient.birthDate
                                    ? new Date(patient.birthDate).toLocaleDateString('it-IT')
                                    : (patient.taxCode && estimateBirthYearFromTaxCode(patient.taxCode)
                                        ? `Stima: ${estimateBirthYearFromTaxCode(patient.taxCode)} (~${calculateAge(estimateBirthYearFromTaxCode(patient.taxCode)!)} anni)`
                                        : 'Data nascita assente')}
                            </div>
                            <div className="flex items-center gap-2 bg-white/50 dark:bg-white/5 px-3 py-1.5 rounded-lg border border-transparent dark:border-white/10">
                                <MapPin className="w-4 h-4 text-green-500 dark:text-green-400" />
                                <PrivacyBlur intensity="sm">{patient.address || 'Nessun indirizzo'}</PrivacyBlur>
                            </div>
                            {patient.phone && (
                                <div className="flex items-center gap-2 bg-white/50 dark:bg-white/5 px-3 py-1.5 rounded-lg border border-transparent dark:border-white/10">
                                    <Phone className="w-4 h-4 text-purple-500 dark:text-purple-400" />
                                    <PrivacyBlur intensity="sm">{patient.phone}</PrivacyBlur>
                                </div>
                            )}
                            {patient.caregiver && (
                                <div className="flex items-center gap-2 bg-pink-50/80 dark:bg-pink-900/20 px-3 py-1.5 rounded-lg border border-pink-100 dark:border-pink-900/30 text-pink-700 dark:text-pink-300">
                                    <HeartHandshake className="w-4 h-4" />
                                    <PrivacyBlur intensity="sm">{patient.caregiver}</PrivacyBlur>
                                </div>
                            )}

                            {patient.isAdi && (
                                <div className="px-3 py-1.5 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-bold border border-green-200 dark:border-green-800">
                                    Paziente ADI
                                </div>
                            )}
                        </div>

                        {/* Diagnoses / ICD */}
                        {diagnosisItems.length > 0 && (
                            <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50/70 p-3 dark:border-rose-900/30 dark:bg-rose-900/20">
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                                    Diagnosi in scheda
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {diagnosisItems.map((diagnosis) => (
                                        <span
                                            key={`${diagnosis.system}-${diagnosis.code}`}
                                            className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 dark:border-rose-700/40 dark:bg-rose-950/30 dark:text-rose-200"
                                        >
                                            {diagnosis.system} {diagnosis.code} · {diagnosis.description}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}


                        {(patient.notes) && (
                            <div className="mt-2 p-3 bg-amber-50/80 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 rounded-xl text-sm text-amber-900 dark:text-amber-100 flex gap-2 items-start">
                                <Info className="w-4 h-4 mt-0.5 text-amber-500 dark:text-amber-400 shrink-0" />
                                <div className="flex-1">
                                    <PrivacyBlur>{patient.notes}</PrivacyBlur>
                                </div>
                            </div>
                        )}

                        {/* @Codex */}
                        {exemptionCodes.length > 0 && (
                            <div className="mt-3 p-3 bg-indigo-50/80 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/30 rounded-xl">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300 mb-2 flex items-center gap-1.5">
                                    <Ticket className="w-3.5 h-3.5" />
                                    Esenzioni associate
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {exemptionCodes.slice(0, 10).map((code) => (
                                        <span
                                            key={code}
                                            className="font-mono text-xs px-2 py-1 rounded-md bg-white dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-700/40 text-indigo-700 dark:text-indigo-200"
                                        >
                                            {code}
                                        </span>
                                    ))}
                                    {exemptionCodes.length > 10 && (
                                        <span className="text-xs text-indigo-600 dark:text-indigo-300 px-2 py-1">
                                            +{exemptionCodes.length - 10} altri
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}






                    </div>

                    <div className="flex flex-col gap-3 min-w-[200px]">
                        <button
                            onClick={() => setIsExportModalOpen(true)}
                            className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-95"
                        >
                            <Download className="w-4 h-4" />
                            Export FHIR
                        </button>

                        <button
                            onClick={async () => {
                                // Filter 'scale' type entries for the scales section
                                const scaleEntries = entries?.filter(e => e.type === 'scale') || [];

                                // Fetch therapies for the report
                                // Fetch therapies for the report
                                const therapies = await db.therapies.filter((t: any) => t.patientId === id).toArray();

                                import('@/lib/report-service').then(mod => {
                                    if (patient && entries) {
                                        mod.generatePatientReport(patient, entries, scaleEntries, therapies);
                                    }
                                });
                            }}
                            className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
                        >
                            <FileText className="w-4 h-4" />
                            Scarica Report PDF
                        </button>

                        <Link
                            href={`/patients/${id}/entries/new`}
                            className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-95"
                        >
                            <Plus className="w-4 h-4" />
                            Nuova Visita
                        </Link>

                        <button
                            onClick={async () => {
                                const { openSissPrescrizione } = await import('@/lib/siss');
                                const result = await openSissPrescrizione(patient.taxCode);
                                if (result.success) {
                                    // Show a simple browser alert for now (could be replaced with toast)
                                    alert(result.message);
                                } else {
                                    alert("⚠️ " + result.message);
                                }
                            }}
                            className="flex items-center justify-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl shadow-lg shadow-teal-500/20 transition-all active:scale-95"
                            title="Apri SISS e copia CF negli appunti"
                        >
                            <FileText className="w-4 h-4" />
                            Prescrizione SISS
                        </button>
                    </div>
                </div>
            </div>



            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Main Timeline Column */}
                <div className="lg:col-span-2 space-y-8">

                    {/* Therapies Section */}
                    <TherapyManager patientId={id} />
                    {/* @Codex */}
                    <ObservationManager patientId={id} />

                    <div className="space-y-6">
                        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                            <FileText className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                            Diario Clinico
                        </h2>
                        {entries && <Timeline entries={entries} />}
                    </div>
                </div>

                {/* Sidebar / Stats Column */}
                <div className="space-y-6">

                    {/* @Codex */}
                    <PatientSmartImportPanel patient={patient} entries={entries} />

                    {/* NEW AI Insight Location */}
                    <AIPatientInsight patient={patient} />

                    {/* Document Insights - Archivio Intelligente */}
                    <DocumentInsightsPanel patient={patient} />

                    {/* Quick Scales Widget */}
                    <div className="glass-panel p-6">
                        <h3 className="font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
                            <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            Valutazioni Rapide
                        </h3>
                        <div className="grid grid-cols-1 gap-3">
                            <Link
                                href={`/patients/${id}/scales/tinetti`}
                                className="flex items-center justify-between p-3 rounded-xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 hover:border-blue-200 dark:hover:border-blue-500/30 hover:shadow-md transition-all group"
                            >
                                <span className="text-gray-700 dark:text-gray-200 font-medium group-hover:text-blue-700 dark:group-hover:text-blue-400">Tinetti</span>
                                <Plus className="w-4 h-4 text-blue-400 group-hover:text-blue-600" />
                            </Link>
                            <Link
                                href={`/patients/${id}/scales/mmse`}
                                className="flex items-center justify-between p-3 rounded-xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 hover:border-blue-200 dark:hover:border-blue-500/30 hover:shadow-md transition-all group"
                            >
                                <span className="text-gray-700 dark:text-gray-200 font-medium group-hover:text-blue-700 dark:group-hover:text-blue-400">MMSE</span>
                                <Plus className="w-4 h-4 text-blue-400 group-hover:text-blue-600" />
                            </Link>
                            <Link
                                href={`/patients/${id}/scales/adl`}
                                className="flex items-center justify-between p-3 rounded-xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 hover:border-blue-200 dark:hover:border-blue-500/30 hover:shadow-md transition-all group"
                            >
                                <span className="text-gray-700 dark:text-gray-200 font-medium group-hover:text-blue-700 dark:group-hover:text-blue-400">ADL (Katz)</span>
                                <Plus className="w-4 h-4 text-blue-400 group-hover:text-blue-600" />
                            </Link>
                            <Link
                                href={`/patients/${id}/scales/gds`}
                                className="flex items-center justify-between p-3 rounded-xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 hover:border-blue-200 dark:hover:border-blue-500/30 hover:shadow-md transition-all group"
                            >
                                <span className="text-gray-700 dark:text-gray-200 font-medium group-hover:text-blue-700 dark:group-hover:text-blue-400">GDS</span>
                                <Plus className="w-4 h-4 text-blue-400 group-hover:text-blue-600" />
                            </Link>

                            <Link
                                href={`/scales`}
                                className="text-xs text-center text-gray-400 hover:text-blue-600 mt-2 block"
                            >
                                Vedi tutte le scale...
                            </Link>
                        </div>
                    </div>

                    <div className="glass-panel p-6">
                        <h3 className="font-bold text-gray-800 dark:text-white mb-4">Documenti & Referti</h3>
                        <DocumentUpload patientId={id} />
                    </div>

                    <div className="glass-panel p-6">
                        <h3 className="font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-indigo-500" />
                            Prossimi Controlli
                        </h3>

                        {!checkups || checkups.length === 0 ? (
                            <div className="text-center py-4">
                                <p className="text-sm text-gray-400 italic mb-2">Nessun controllo programmato.</p>
                                <Link href={`/patients/${id}/edit`} className="text-xs text-indigo-600 font-bold hover:underline">
                                    + Aggiungi
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {checkups.map(checkup => (
                                    <div key={checkup.id} className="p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-500/20 relative group">
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 rounded-full">
                                                {new Date(checkup.date).toLocaleDateString()}
                                            </span>
                                        </div>
                                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{checkup.title}</p>
                                        {checkup.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{checkup.notes}</p>}
                                    </div>
                                ))}
                                <Link href={`/patients/${id}/edit`} className="block text-center text-xs text-indigo-600 font-bold hover:underline mt-2">
                                    Gestisci Controlli
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
