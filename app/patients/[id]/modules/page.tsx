'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Activity, Calendar, Download, FileText, Pencil, Plus } from 'lucide-react';

import AIPatientInsight from '@/components/ai-patient-insight';
import { ClinicalRiverTimeline } from '@/components/clinical-river-timeline';
import DocumentInsightsPanel from '@/components/document-insights-panel';
import DocumentUpload from '@/components/document-upload';
import { EvidenceStackTile } from '@/components/evidence-stack-tile';
import ObservationManager from '@/components/observation-manager';
import PatientActionModal from '@/components/patient-action-modal';
import { PatientIdentityLens } from '@/components/patient-identity-lens';
import PatientReviewQueueSummaryPanel from '@/components/patient-review-queue-summary';
import PatientSmartImportPanel, { countUsableSources } from '@/components/patient-smart-import-panel';
import ProstheticPrescriptionManager from '@/components/prosthetic-prescription-manager';
import ServicePrescriptionManager from '@/components/service-prescription-manager';
import SissHandoffDiary from '@/components/siss-handoff-diary';
import SissPatientContextPanel from '@/components/siss-patient-context-panel';
import TherapyManager from '@/components/therapy-manager';
import Timeline from '@/components/timeline';
import { Kree8WorkspaceShell, type Kree8WorkspaceNavItem } from '@/components/kree8/kree8-workspace-shell';
import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';
import { AI_PATIENT_INSIGHT_KILL_SWITCH_KEY, isAiPatientInsightEnabledValue } from '@/lib/ai-patient-insight-kill-switch';
import { AI_SMART_IMPORT_KILL_SWITCH_KEY, isAiSmartImportEnabledValue } from '@/lib/ai-smart-import-kill-switch';
import { db, type Attachment, type Checkup, type ClinicalEntry, type ExemptionCode } from '@/lib/db';
import { buildValidationMessage, type ValidatePatientExportResponse } from '@/lib/fse-validate-patient-contract';
import { useLiveQuery } from '@/lib/live-query';
import { buildPatientReviewQueueSummary, type SmartImportReviewSnapshot } from '@/lib/patient-review-queue-summary';
import { calculateAge, estimateBirthYearFromTaxCode } from '@/lib/utils';

export default function PatientDetailPage() {
    const params = useParams();
    const id = params.id as string;
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    /* WUL-262: mirror of the Smart Import review counts reported by the panel. */
    const [smartImportReview, setSmartImportReview] = useState<SmartImportReviewSnapshot | null>(null);

    const patient = useLiveQuery(() => db.patients.get(id), [id]);
    const entries = useLiveQuery(
        async () => {
            const items = await db.entries.filter((entry: ClinicalEntry) => entry.patientId === id).toArray();
            return items.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
        },
        [id],
    );
    const checkups = useLiveQuery(
        async () => {
            const items = await db.checkups.filter((checkup: Checkup) => checkup.patientId === id).toArray();
            return items
                .filter((checkup) => checkup.status !== 'completed')
                .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
        },
        [id],
    );
    /* WUL-262: same data the archive and Smart Import panels already read. */
    const attachments = useLiveQuery(
        async () => db.attachments.filter((attachment: Attachment) => attachment.patientId === id).toArray(),
        [id],
    );
    const patientInsightKillSwitch = useLiveQuery(() => db.settings.get(AI_PATIENT_INSIGHT_KILL_SWITCH_KEY), []);
    const smartImportKillSwitch = useLiveQuery(() => db.settings.get(AI_SMART_IMPORT_KILL_SWITCH_KEY), []);
    /* @Codex */
    const exemptionCodes = Array.isArray(patient?.exemptions) ? patient.exemptions : [];
    /* @Codex */
    const exemptionDetails = useLiveQuery(
        async () => {
            const uniqueCodes = [...new Set(
                exemptionCodes
                    .map((code) => code.trim().toUpperCase())
                    .filter(Boolean),
            )];

            if (!uniqueCodes.length) return [];

            const response = await fetch(`/api/exemptions?codes=${encodeURIComponent(uniqueCodes.join(','))}`, {
                cache: 'no-store',
            });

            if (!response.ok) {
                return uniqueCodes.map((code) => ({ code, description: '' }));
            }

            const payload = await response.json() as ExemptionCode[];
            const detailByCode = new Map(
                payload.map((item) => [item.code.trim().toUpperCase(), item]),
            );

            return uniqueCodes.map((code) => ({
                code,
                description: detailByCode.get(code)?.description || '',
            }));
        },
        [exemptionCodes.join('|')],
    );

    if (!patient) {
        return (
            <Kree8WorkspaceShell
                eyebrow="Scheda clinica"
                title="Scheda paziente"
                subtitle="Recupero dei dati dalla cartella locale prima di aprire la scheda."
                backHref="/"
                backLabel="Pazienti"
            >
                <div className={workspaceStyles.loadingCard}>Caricamento scheda paziente...</div>
            </Kree8WorkspaceShell>
        );
    }

    const diagnosisItems = Array.isArray(patient.diagnoses) ? patient.diagnoses : [];
    const documentInsights = Array.isArray(patient.documentInsights) ? patient.documentInsights : [];
    const birthYear = patient.birthDate
        ? new Date(patient.birthDate).getFullYear()
        : estimateBirthYearFromTaxCode(patient.taxCode);
    const birthDateLabel = patient.birthDate
        ? new Date(patient.birthDate).toLocaleDateString('it-IT')
        : birthYear
            ? `Stima da codice fiscale (${birthYear})`
            : 'Non disponibile';
    const ageLabel = birthYear ? `${calculateAge(birthYear)} anni` : 'Età non disponibile';
    const activeEntries = (entries ?? []).filter((entry) => !entry.deletedAt);
    const nonScaleEntries = activeEntries.filter((entry) => entry.type !== 'scale');
    const scaleEntries = activeEntries.filter((entry) => entry.type === 'scale');
    const recentEvidence = documentInsights.slice(0, 4);
    const leadDiagnosis = diagnosisItems[0];
    const nextCheckup = (checkups ?? [])[0];
    const summaryText = leadDiagnosis
        ? `${leadDiagnosis.code} · ${leadDiagnosis.description}${patient.isAdi ? ' con continuita territoriale attiva.' : '.'}`
        : 'Nessuna diagnosi codificata nella scheda.';
    const nextStepText = nextCheckup
        ? `Preparare "${nextCheckup.title}" e riallineare il diario prima del ${new Date(nextCheckup.date).toLocaleDateString('it-IT')}.`
        : documentInsights.length > 0
            ? `Rivedere ${documentInsights[0].fileName} e verificare se va promosso nel quadro clinico.`
            : patient.isArchived
                ? 'Confermare chiusura o riaprire il percorso se torna attivo.'
                : 'Aprire il diario clinico e fissare il prossimo passaggio operativo.';
    /* WUL-262: review-queue summary derived from the same data the panels
       below already receive: read-only aggregation, no automatic write. */
    const attachmentItems = attachments ?? [];
    const attachmentsWithTextCount = attachmentItems.filter((attachment) => attachment.summarySnapshot?.trim()).length;
    const smartImportSourceCount = countUsableSources(patient, entries, attachmentsWithTextCount);
    const reviewQueueSummary = buildPatientReviewQueueSummary({
        insight: {
            enabled: isAiPatientInsightEnabledValue(patientInsightKillSwitch?.value),
            hasSummary: Boolean(patient.aiSummary?.trim()),
        },
        evidence: documentInsights.map((insight) => ({
            qualityLevel: insight.quality?.level,
            appliedDiagnosesCount: insight.autofill?.appliedDiagnoses?.length ?? 0,
        })),
        smartImport: {
            enabled: isAiSmartImportEnabledValue(smartImportKillSwitch?.value),
            sourceCount: smartImportSourceCount,
            analysis: smartImportReview ?? undefined,
        },
        archive: {
            attachmentsCount: attachmentItems.length,
            missingTextCount: attachmentItems.length - attachmentsWithTextCount,
        },
    });
    const workspaceNavItems: Kree8WorkspaceNavItem[] = [
        { href: '#quadro', label: 'Quadro' },
        { href: '#timeline', label: 'Timeline', meta: String(nonScaleEntries.length + (checkups ?? []).length + documentInsights.length) },
        { href: '#terapie', label: 'Terapie' },
        { href: '#prestazioni', label: 'Prestazioni' },
        { href: '#parametri', label: 'Parametri' },
        { href: '#diario', label: 'Diario', meta: String(nonScaleEntries.length) },
        { href: '#documenti', label: 'Documenti', meta: String(documentInsights.length) },
        { href: '#siss', label: 'SISS/FSE' },
        { href: '#scale', label: 'Scale' },
        { href: '#follow-up', label: 'Follow-up', meta: String((checkups ?? []).length) },
    ];

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

            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `patient-${patient.lastName}-${patient.firstName}-fhir.json`;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);

            alert('Esportazione FHIR completata con successo!');
        } catch (error) {
            console.error('Export failed', error);
            alert("Errore durante l'esportazione.");
        }
    };

    const actionsDock = (
        <div className="patient-actions-dock rounded-[14px] border border-[color:rgba(112,106,100,0.12)] bg-white/82 p-4 dark:bg-white/4">
            <Link
                href={`/patients/${id}/entries/new`}
                className="ui-btn-primary flex h-11 w-full items-center justify-center gap-2 px-4 text-sm font-semibold"
            >
                <Plus className="h-4 w-4" />
                Nuova voce
            </Link>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Link
                    href={`/patients/${id}/edit`}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-[color:rgba(15,23,42,0.12)] bg-white/88 px-3 text-xs font-semibold text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(15,23,42,0.24)] hover:bg-white dark:bg-white/6"
                >
                    <Pencil className="h-3.5 w-3.5" />
                    Modifica
                </Link>
                <button
                    type="button"
                    onClick={() => setIsExportModalOpen(true)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-[color:rgba(15,23,42,0.12)] bg-white/88 px-3 text-xs font-semibold text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(15,23,42,0.24)] hover:bg-white dark:bg-white/6"
                >
                    <Download className="h-3.5 w-3.5" />
                    Export FHIR
                </button>
                <button
                    type="button"
                    onClick={async () => {
                        const therapies = await db.therapies.filter((therapy) => therapy.patientId === id).toArray();
                        const observations = await db.observations.filter((observation) => observation.patientId === id).toArray();
                        const reportService = await import('@/lib/report-service');
                        reportService.generatePatientReport(patient, nonScaleEntries, scaleEntries, therapies, observations);
                    }}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-[color:rgba(15,23,42,0.12)] bg-white/88 px-3 text-xs font-semibold text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(15,23,42,0.24)] hover:bg-white dark:bg-white/6"
                >
                    <FileText className="h-3.5 w-3.5" />
                    Report PDF
                </button>
            </div>
        </div>
    );

    return (
        <Kree8WorkspaceShell
            eyebrow="Scheda clinica"
            title="Scheda paziente"
            subtitle="La cartella di lavoro del paziente: da qui registri, aggiorni ed esporti la documentazione clinica."
            backHref={`/patients/${id}`}
            backLabel="Quadro paziente"
            patientLabel={`${patient.lastName} ${patient.firstName}`}
            statusLabel={`${nonScaleEntries.length} eventi · ${(checkups ?? []).length} follow-up · ${documentInsights.length} evidenze`}
            navItems={workspaceNavItems}
        >
            <div id="quadro" className={workspaceStyles.anchorStack}>
                <PatientIdentityLens
                    variant="reader"
                    patient={patient}
                    ageLabel={ageLabel}
                    birthDateLabel={birthDateLabel}
                    diagnoses={diagnosisItems}
                    exemptions={exemptionCodes}
                    exemptionDetails={exemptionDetails ?? []}
                    actions={actionsDock}
                    summary={summaryText}
                    nextStep={nextStepText}
                />

                <PatientReviewQueueSummaryPanel summary={reviewQueueSummary} />
            </div>

            <div className={workspaceStyles.workspaceGrid}>
                <div className={workspaceStyles.primaryStack}>
                    <section id="timeline" className="patient-detail-section border p-5 md:p-6">
                        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                                <p className="section-kicker">Timeline</p>
                                <h2 className="mt-1 text-xl font-semibold text-[color:var(--mf-ink)]">
                                    Timeline clinica
                                </h2>
                                <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--mf-muted)]">
                                    Visite, controlli e referti del caso riuniti in un&apos;unica sequenza cronologica.
                                </p>
                            </div>
                            <span className="apple-chip self-start md:self-auto">
                                {nonScaleEntries.length + (checkups ?? []).length + documentInsights.length} elementi
                            </span>
                        </div>
                        <ClinicalRiverTimeline
                            entries={nonScaleEntries}
                            checkups={checkups ?? []}
                            documentInsights={documentInsights}
                        />
                    </section>

                    <div id="terapie" className={workspaceStyles.anchorStack}>
                        <TherapyManager patientId={id} />
                    </div>

                    <ServicePrescriptionManager patientId={id} />

                    <div id="parametri" className={workspaceStyles.anchorStack}>
                        <ObservationManager patientId={id} />
                    </div>

                    <ProstheticPrescriptionManager patientId={id} />

                    <section id="diario" className="patient-detail-section border p-5 md:p-6">
                        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                                <p className="section-kicker">Diario</p>
                                <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-[color:var(--mf-ink)]">
                                    <FileText className="h-5 w-5 text-[color:var(--mf-muted)]" />
                                    Diario clinico
                                </h2>
                            </div>
                            <span className="apple-chip self-start md:self-auto">{nonScaleEntries.length} voci attive</span>
                        </div>
                        {entries ? <Timeline entries={entries} /> : null}
                    </section>

                    <div id="siss" className={workspaceStyles.anchorStack}>
                        <span id="contesto" aria-hidden className="sr-only">SISS e FSE</span>
                        <SissPatientContextPanel
                            patientId={id}
                            patientTaxCode={patient.taxCode}
                        />

                        <SissHandoffDiary patientId={id} />
                    </div>
                </div>

                <div className={workspaceStyles.secondaryStack}>
                    <div id="insight" className={workspaceStyles.anchorStack}>
                        <AIPatientInsight patient={patient} />
                    </div>

                    <section id="documenti" className="patient-detail-side-section border p-5">
                        <div className="mb-4">
                            <p className="section-kicker">Evidenze documentali</p>
                            <h3 className="mt-1 text-lg font-semibold text-[color:var(--mf-ink)]">
                                Referti recenti
                            </h3>
                        </div>

                        {recentEvidence.length > 0 ? (
                            <div className="grid gap-3">
                                {recentEvidence.map((insight) => (
                                    <EvidenceStackTile key={insight.id} insight={insight} />
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-[12px] border border-dashed border-[color:rgba(112,106,100,0.18)] px-4 py-5 text-center dark:border-[color:rgba(255,247,240,0.12)]">
                                <p className="text-sm text-[color:var(--mf-muted)]">
                                    Nessuna evidenza documentale in primo piano. I nuovi referti compariranno qui.
                                </p>
                            </div>
                        )}
                    </section>

                    {smartImportSourceCount > 0 ? (
                        <div id="smart-import" className={workspaceStyles.anchorStack}>
                            <PatientSmartImportPanel
                                patient={patient}
                                entries={entries}
                                onReviewSnapshotChange={setSmartImportReview}
                            />
                        </div>
                    ) : null}
                    <DocumentInsightsPanel patient={patient} />

                    <section id="archivio" className="patient-detail-side-section border p-5">
                        <div className="mb-4">
                            <p className="section-kicker">Documenti</p>
                            <h3 className="mt-1 text-lg font-semibold text-[color:var(--mf-ink)]">Archivio documenti</h3>
                        </div>
                        <DocumentUpload patientId={id} />
                    </section>

                    <section id="scale" className="patient-detail-side-section border p-5">
                        <div className="mb-4">
                            <p className="section-kicker">Scale</p>
                            <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-[color:var(--mf-ink)]">
                                <Activity className="h-5 w-5 text-[color:var(--mf-muted)]" />
                                Scale di valutazione
                            </h3>
                        </div>
                        <div className="space-y-3">
                            <Link href={`/patients/${id}/scales/tinetti`} className="apple-list-row">
                                <span>Tinetti</span>
                                <Plus className="h-4 w-4 text-[color:var(--mf-muted)]" />
                            </Link>
                            <Link href={`/patients/${id}/scales/mmse`} className="apple-list-row">
                                <span>MMSE</span>
                                <Plus className="h-4 w-4 text-[color:var(--mf-muted)]" />
                            </Link>
                            <Link href={`/patients/${id}/scales/adl`} className="apple-list-row">
                                <span>ADL (Katz)</span>
                                <Plus className="h-4 w-4 text-[color:var(--mf-muted)]" />
                            </Link>
                            <Link href={`/patients/${id}/scales/gds`} className="apple-list-row">
                                <span>GDS</span>
                                <Plus className="h-4 w-4 text-[color:var(--mf-muted)]" />
                            </Link>
                            <Link href={`/patients/${id}/scales`} className="block pt-1 text-xs font-medium text-[color:var(--mf-muted)] transition-colors hover:text-[color:var(--mf-ink)]">
                                Apri libreria scale
                            </Link>
                        </div>
                    </section>

                    <section id="follow-up" className="patient-detail-side-section border p-5">
                        <div className="mb-4">
                            <p className="section-kicker">Pianificazione</p>
                            <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-[color:var(--mf-ink)]">
                                <Calendar className="h-5 w-5 text-[color:var(--mf-muted)]" />
                                Follow-up
                            </h3>
                        </div>

                        {!checkups || checkups.length === 0 ? (
                            <div className="rounded-[12px] border border-dashed border-[color:rgba(112,106,100,0.18)] px-4 py-5 text-center dark:border-[color:rgba(255,247,240,0.12)]">
                                <p className="text-sm italic text-[color:var(--mf-muted)]">Nessun follow-up pianificato.</p>
                                <Link href={`/patients/${id}/edit`} className="mt-3 inline-block text-xs font-medium text-[color:var(--mf-ink)] hover:underline">
                                    Aggiungi follow-up
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {checkups.map((checkup) => (
                                    <div key={checkup.id} className="rounded-[12px] border border-[color:rgba(112,106,100,0.12)] bg-white/82 px-4 py-3 dark:border-[color:rgba(255,247,240,0.08)] dark:bg-white/5">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-semibold text-[color:var(--mf-ink)]">{checkup.title}</p>
                                                {checkup.notes ? (
                                                    <p className="mt-1 text-xs leading-5 text-[color:var(--mf-muted)]">{checkup.notes}</p>
                                                ) : null}
                                            </div>
                                            <span className="apple-chip shrink-0">{new Date(checkup.date).toLocaleDateString('it-IT')}</span>
                                        </div>
                                    </div>
                                ))}
                                <Link href={`/patients/${id}/edit`} className="block pt-1 text-xs font-medium text-[color:var(--mf-muted)] transition-colors hover:text-[color:var(--mf-ink)]">
                                    Gestisci follow-up
                                </Link>
                            </div>
                        )}
                    </section>
                </div>
            </div>

            <PatientActionModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
                onConfirm={async () => handleExportConfirm()}
                patientName={`${patient.firstName} ${patient.lastName}`}
                actionType="export"
            />
        </Kree8WorkspaceShell>
    );
}
