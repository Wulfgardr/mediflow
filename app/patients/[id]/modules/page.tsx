'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Accessibility, Activity, Download, FileText, Pencil, Pill, Plus, ShieldCheck, Stethoscope } from 'lucide-react';

import AIPatientInsight from '@/components/ai-patient-insight';
import { ClinicalRiverTimeline } from '@/components/clinical-river-timeline';
import { PatientSynopticSheet, type SynopticMeasure, type SynopticSignal, type SynopticTherapyLine } from '@/components/patient-synoptic-sheet';
import { CollapsibleSection } from '@/components/kree8/collapsible-section';
import DocumentInsightsPanel from '@/components/document-insights-panel';
import DocumentUpload from '@/components/document-upload';
import { EvidenceStackTile } from '@/components/evidence-stack-tile';
import ObservationManager from '@/components/observation-manager';
import type { ObservationPrefill } from '@/lib/observation-prefill';
import PatientActionModal from '@/components/patient-action-modal';
import { PatientIdentityLens } from '@/components/patient-identity-lens';
import PatientReviewQueueSummaryPanel from '@/components/patient-review-queue-summary';
import PatientSmartImportPanel, { countUsableSources } from '@/components/patient-smart-import-panel';
import ProstheticPrescriptionManager from '@/components/prosthetic-prescription-manager';
import ServicePrescriptionManager from '@/components/service-prescription-manager';
import SissHandoffDiary from '@/components/siss-handoff-diary';
import SissPatientContextPanel from '@/components/siss-patient-context-panel';
import TherapyManager from '@/components/therapy-manager';
import TreatmentReasoningPanel from '@/components/treatment-reasoning-panel';
import Timeline from '@/components/timeline';
import { Kree8WorkspaceShell, type Kree8WorkspaceNavItem } from '@/components/kree8/kree8-workspace-shell';
import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';
import { AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY, isAiDocumentSynthesisEnabledValue } from '@/lib/ai-document-synthesis-kill-switch';
import { AI_PATIENT_INSIGHT_KILL_SWITCH_KEY, isAiPatientInsightEnabledValue } from '@/lib/ai-patient-insight-kill-switch';
import { AI_SMART_IMPORT_KILL_SWITCH_KEY, isAiSmartImportEnabledValue } from '@/lib/ai-smart-import-kill-switch';
import { db, type Checkup, type ExemptionCode } from '@/lib/db';
import { buildValidationMessage, type ValidatePatientExportResponse } from '@/lib/fse-validate-patient-contract';
import { useLiveQuery, useLiveQueryState } from '@/lib/live-query';
import { buildPatientWorkspaceFromRecords } from '@/lib/patient-workspace';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast-provider';
import { buildPatientReviewQueueSummary, type SmartImportReviewSnapshot } from '@/lib/domain/documents/patient-review-queue-summary';
import { classifyInsightReadability } from '@/lib/patient-insight-view-model';
import { classifyObservationRange, toNumericValue } from '@/lib/observation-range';
import { resolveStaticTerminology } from '@/lib/terminology';
import { projectFollowupSuggestions } from '@/lib/patient-followup-projection';
import { deriveOpenLoops, type OpenLoop } from '@/lib/patient-open-loops';
import FollowupSuggestions from '@/components/followup-suggestions';
import { calculateAge, estimateBirthYearFromTaxCode } from '@/lib/utils';

export default function PatientDetailPage() {
    const params = useParams();
    const id = params.id as string;
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const [isDocumentUploadOpen, setIsDocumentUploadOpen] = useState(false);
    const [observationPrefill, setObservationPrefill] = useState<ObservationPrefill | undefined>();
    /* WUL-262: mirror of the Smart Import review counts reported by the panel. */
    const [smartImportReview, setSmartImportReview] = useState<SmartImportReviewSnapshot | null>(null);
    const confirm = useConfirm();
    const { showToast } = useToast();

    const patient = useLiveQuery(() => db.patients.get(id), [id], undefined, ['patients']);
    const entries = useLiveQuery(
        async () => {
            const items = await db.entries.query({ patientId: id, includeDeleted: true }).toArray();
            return items.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
        },
        [id],
        undefined,
        ['entries'],
    );
    /* @Codex WUL-UIUX Fase 7: stesso filtro del builder (ne completati ne
       annullati): cosi nextCheckup, la sezione Follow-up e i conteggi condivisi
       raccontano lo stesso insieme, e un appuntamento annullato non compare piu
       come prossimo follow-up. */
    const checkups = useLiveQuery(
        async () => {
            const items = await db.checkups.query({ patientId: id }).toArray();
            return items
                .filter((checkup: Checkup) => checkup.status !== 'completed' && checkup.status !== 'cancelled')
                .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
        },
        [id],
        undefined,
        ['checkups'],
    );
    /* WUL-262: same data the archive and Smart Import panels already read. */
    const attachments = useLiveQuery(
        async () => db.attachments.query({ patientId: id }).toArray(),
        [id],
        undefined,
        ['attachments'],
    );
    /* @Codex WUL-UIUX: conteggi per la striscia di segnali sopra la piega. */
    // Terapie attive complete (non solo il conteggio) per servire i principi attivi
    // con posologia direttamente nella cella, senza scendere al TherapyManager.
    const activeTherapies = useLiveQuery(
        async () => {
            const items = await db.therapies.query({ patientId: id }).toArray();
            return items
                .filter((therapy) => therapy.status === 'active' && !therapy.deletedAt)
                .sort((left, right) => {
                    const leftTime = left.startDate ? new Date(left.startDate).getTime() : 0;
                    const rightTime = right.startDate ? new Date(right.startDate).getTime() : 0;
                    return rightTime - leftTime;
                });
        },
        [id],
        undefined,
        ['therapies'],
    );
    /* @Codex WUL-UIUX Fase 7: array completi per buildPatientWorkspaceFromRecords,
       le stesse letture che il cockpit fa per il Quadro (tutte le terapie e tutte
       le osservazioni del paziente, senza filtri). */
    const therapies = useLiveQuery(
        async () => db.therapies.query({ patientId: id }).toArray(),
        [id],
        undefined,
        ['therapies'],
    );
    const observations = useLiveQuery(
        async () => db.observations.query({ patientId: id }).toArray(),
        [id],
        undefined,
        ['observations'],
    );
    const servicePrescriptionItems = useLiveQuery(
        async () => db.servicePrescriptionItems.query({ patientId: id }).toArray(),
        [id],
        undefined,
        ['service_prescription_items'],
    );
    const serviceCatalogItemIds = (servicePrescriptionItems ?? [])
        .map((item) => item.catalogEntryId)
        .filter((catalogEntryId): catalogEntryId is string => Boolean(catalogEntryId))
        .sort()
        .join('|');
    const linkedServiceCatalogEntries = useLiveQuery(
        async () => {
            const ids = [...new Set(serviceCatalogItemIds.split('|').filter(Boolean))];
            return (await Promise.all(ids.map((catalogEntryId) => db.serviceCatalogEntries.get(catalogEntryId))))
                .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
        },
        [serviceCatalogItemIds],
        undefined,
        ['service_catalog_entries'],
    );
    // Ultima osservazione registrata: data e valore per la cella Parametri.
    const latestObservation = useLiveQuery(
        async () => {
            const items = await db.observations.query({ patientId: id }).toArray();
            return items
                .filter((observation) => observation.observedAt)
                .sort((left, right) => new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime())[0] ?? null;
        },
        [id],
        undefined,
        ['observations'],
    );
    /* @Codex WUL-UIUX (Fase 4): ultima misura per il Foglio sinottico, con delta
       calcolato DENTRO il gruppo per codice (mai tra analiti diversi) e solo se
       stessa unita e valori numerici. Classificazione fuori-range da observation-range. */
    const latestMeasure = useLiveQuery<SynopticMeasure | null>(
        async () => {
            const items = await db.observations.query({ patientId: id }).toArray();
            const sorted = items
                .filter((observation) => observation.observedAt)
                .sort((left, right) => new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime());
            const latest = sorted[0];
            if (!latest) return null;
            const previous = sorted.find(
                (observation, index) => index > 0 && observation.code === latest.code && observation.unitCode === latest.unitCode,
            );
            let delta: SynopticMeasure['delta'];
            const latestNum = toNumericValue(latest.value);
            const previousNum = previous ? toNumericValue(previous.value) : null;
            if (latestNum !== null && previousNum !== null && previous) {
                const diff = Math.round((latestNum - previousNum) * 100) / 100;
                delta = {
                    direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
                    label: `${diff > 0 ? '+' : ''}${String(diff).replace('.', ',')}`,
                    sinceLabel: `dal ${new Date(previous.observedAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}`,
                };
            }
            return {
                display: resolveStaticTerminology('LOINC', latest.code)?.displayIt ?? latest.display,
                valueLabel: `${latest.value}${latest.unitCode ? ` ${latest.unitCode}` : ''}`,
                dateLabel: new Date(latest.observedAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }),
                delta,
                outOfRange: classifyObservationRange(latest.value, latest.refLow, latest.refHigh) ?? undefined,
            };
        },
        [id],
        undefined,
        ['observations'],
    );
    /* @Codex WUL-UIUX: conteggi leggeri per i chip delle sezioni collassabili. */
    const prestazioniCount = useLiveQuery(
        async () => db.servicePrescriptions.query({ patientId: id }).count(),
        [id],
        undefined,
        ['service_prescriptions'],
    );
    const protesicaCount = useLiveQuery(
        async () => db.prostheticPrescriptions.query({ patientId: id }).count(),
        [id],
        undefined,
        ['prosthetic_prescriptions'],
    );
    const sissHandoffCount = useLiveQuery(
        async () => db.sissHandoffs.query({ patientId: id }).count(),
        [id],
        undefined,
        ['siss_handoff_events'],
    );
    const { data: documentSynthesisKillSwitch, loading: documentSynthesisKillSwitchLoading } = useLiveQueryState(
        () => db.settings.get(AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY),
        [],
        undefined,
        ['settings'],
    );
    /* @Codex LUME-104/68: non derivare lo stato fail-closed del pannello mentre
       la preferenza e ancora in caricamento: aprirebbe la sezione per un falso
       "bloccato" e CollapsibleSection, correttamente, non la richiuderebbe. */
    const { data: patientInsightKillSwitch, loading: patientInsightKillSwitchLoading } = useLiveQueryState(
        () => db.settings.get(AI_PATIENT_INSIGHT_KILL_SWITCH_KEY),
        [],
        undefined,
        ['settings'],
    );
    const smartImportKillSwitch = useLiveQuery(
        () => db.settings.get(AI_SMART_IMPORT_KILL_SWITCH_KEY),
        [],
        undefined,
        ['settings'],
    );
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
        undefined,
        ['exemptions'],
    );

    /* @Codex WUL-UIUX Fase 7: stessa pipeline del Quadro (lib/patient-workspace).
       I numeri della Scheda con un omologo nel cockpit derivano da qui e non
       possono divergere per costruzione. Finche una query non e pronta il
       workspace resta undefined: mai zeri finti durante il caricamento. */
    const workspace = useMemo(
        () => (patient && entries && therapies && checkups && observations && attachments
            ? buildPatientWorkspaceFromRecords({ patient, entries, therapies, checkups, observations, attachments })
            : undefined),
        [patient, entries, therapies, checkups, observations, attachments],
    );
    const openLoops = useMemo(
        () => servicePrescriptionItems && observations
            ? deriveOpenLoops({ items: servicePrescriptionItems, observations, now: new Date() })
            : [],
        [observations, servicePrescriptionItems],
    );
    const serviceCatalogById = useMemo(
        () => new Map((linkedServiceCatalogEntries ?? []).map((entry) => [entry.id, entry])),
        [linkedServiceCatalogEntries],
    );

    if (!patient) {
        return (
            <Kree8WorkspaceShell
                eyebrow="Scheda clinica"
                title="Scheda paziente"
                subtitle="Recupero dei dati dalla cartella locale prima di aprire la scheda."
                backHref="/?area=incarico"
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
    /* @Codex WUL-UIUX: il Diario non deve mostrare le compilazioni scala (hanno
       la loro sezione). Manteniamo le voci cancellate per il toggle audit interno
       di Timeline; filtriamo solo il tipo scala, cosi il conteggio del chip torna. */
    const timelineEntries = (entries ?? []).filter((entry) => entry.type !== 'scale');
    const recentEvidence = documentInsights.slice(0, 4);
    const leadDiagnosis = diagnosisItems[0];
    const nextCheckup = (checkups ?? [])[0];
    // Proiezione read-only dei follow-up suggeriti dai documenti (nessun auto-write).
    const followupSuggestions = projectFollowupSuggestions(documentInsights);
    const openObservationForm = (loop: OpenLoop) => {
        const requestId = `${loop.kind}:${loop.sourceRef.id ?? loop.sourceRef.code ?? 'unknown'}:${Date.now()}`;
        let prefill: ObservationPrefill = { requestId };

        if (loop.kind === 'results_pending' && loop.sourceRef.id) {
            const item = servicePrescriptionItems?.find((candidate) => candidate.id === loop.sourceRef.id);
            const catalogEntry = item?.catalogEntryId ? serviceCatalogById.get(item.catalogEntryId) : undefined;
            const codeSystem = item?.codeSystem ?? catalogEntry?.codeSystem;
            const code = item?.serviceCode ?? catalogEntry?.serviceCode;
            const terminology = codeSystem?.trim().toUpperCase() === 'LOINC' && code
                ? resolveStaticTerminology('LOINC', code)
                : null;
            prefill = {
                requestId,
                codeSystem: terminology ? 'LOINC' : undefined,
                code: terminology?.code,
                display: terminology?.displayIt ?? terminology?.display ?? item?.catalogDisplayName ?? catalogEntry?.displayName,
                unitCode: terminology?.defaultUnit,
                servicePrescriptionItemId: item?.id,
                servicePrescriptionItem: item ? {
                    id: item.id,
                    serviceName: item.serviceName,
                    prescriptionDate: item.createdAt,
                } : undefined,
            };
        }

        if (loop.kind === 'series_stalled') {
            const latest = (observations ?? [])
                .filter((observation) => !observation.deletedAt
                    && observation.codeSystem === loop.sourceRef.codeSystem
                    && observation.code === loop.sourceRef.code)
                .sort((left, right) => new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime())[0];
            if (latest) {
                prefill = {
                    requestId,
                    codeSystem: latest.codeSystem === 'LOINC' ? 'LOINC' : undefined,
                    code: latest.code,
                    display: latest.display,
                    unitCode: latest.unitCode,
                };
            }
        }

        setObservationPrefill(prefill);
        window.location.hash = 'parametri';
        requestAnimationFrame(() => document.getElementById('parametri')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };
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
    // Staleness insight: l'insight e piu vecchio dell'ultimo dato clinico? Euristica
    // sui timestamp gia caricati. Epsilon di 5s per non falsare subito dopo la
    // generazione (la stessa update bumpa patient.updatedAt insieme a generatedAt).
    const insightGeneratedAt = patient.aiSummaryGeneratedAt ? new Date(patient.aiSummaryGeneratedAt).getTime() : null;
    const clinicalTimestamps: number[] = [
        patient.updatedAt ? new Date(patient.updatedAt).getTime() : 0,
        ...activeEntries.map((entry) => (entry.date ? new Date(entry.date).getTime() : 0)),
        ...(activeTherapies ?? []).map((therapy) => new Date(therapy.updatedAt ?? therapy.startDate).getTime()),
        /* @Codex WUL-UIUX: usa il max tra prelievo e registrazione, cosi una misura
           retrodatata trascritta oggi rende comunque stale l'insight. */
        latestObservation
            ? Math.max(
                latestObservation.observedAt ? new Date(latestObservation.observedAt).getTime() : 0,
                latestObservation.createdAt ? new Date(latestObservation.createdAt).getTime() : 0,
            )
            : 0,
    ];
    const maxClinicalTimestamp = clinicalTimestamps.reduce((max, value) => (value > max ? value : max), 0);
    const insightStale = Boolean(patient.aiSummary?.trim())
        && insightGeneratedAt !== null
        && maxClinicalTimestamp > insightGeneratedAt + 5000;
    const reviewQueueSummary = buildPatientReviewQueueSummary({
        insight: {
            enabled: isAiPatientInsightEnabledValue(patientInsightKillSwitch?.value),
            hasSummary: Boolean(patient.aiSummary?.trim()),
            stale: insightStale,
            readable: classifyInsightReadability(patient.aiSummary) !== 'unreadable',
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
    const reviewQueueAttentionRows = reviewQueueSummary.rows.filter((row) =>
        ['da-rivedere', 'bloccato', 'serve-testo', 'pronto-da-applicare'].includes(row.state),
    );
    /* @Codex WUL-UIUX: i numeri che contano subito, soprattutto su pazienti
       complessi. Nessun "fuori range": senza range di riferimento clinici non si
       inventano flag (resta onesto). */
    // Ultimo contatto = voce di diario piu recente; warning oltre 90 giorni se il
    // percorso e ancora aperto (rilevante soprattutto per l'ADI).
    const lastEntryDate = activeEntries[0]?.date ? new Date(activeEntries[0].date) : null;
    const daysSinceContact = lastEntryDate
        ? Math.floor((Date.now() - lastEntryDate.getTime()) / (1000 * 60 * 60 * 24))
        : null;
    const contactStale = daysSinceContact !== null && daysSinceContact > 90 && !patient.isArchived;
    // Documenti caricati senza sintesi: azionabile, a differenza del conteggio referti.
    const missingSynthesisCount = attachmentItems.length - attachmentsWithTextCount;
    /* @Codex WUL-UIUX (Fase 4): input per il Foglio sinottico. Terapie e ultima
       misura hanno righe dedicate; qui restano i segnali di contesto onesti senza
       una riga propria. Nessun flag fuori-range inventato. */
    const otherProblemsCount = Math.max(0, diagnosisItems.length - (leadDiagnosis ? 1 : 0));
    const synopticTherapies: SynopticTherapyLine[] | undefined = activeTherapies?.map((therapy) => ({
        id: therapy.id,
        drugName: therapy.drugName,
        dosage: therapy.dosage,
    }));
    const synopticSignals: SynopticSignal[] = [
        {
            label: 'Da rivedere',
            value: reviewQueueSummary.attentionCount,
            tone: reviewQueueSummary.attentionCount > 0 ? 'warning' : 'neutral',
            href: '#attenzione',
        },
        {
            label: 'Ultimo contatto',
            value: lastEntryDate ? lastEntryDate.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) : 'Nessuno',
            tone: contactStale ? 'warning' : 'neutral',
        },
        {
            label: 'Doc. da sintetizzare',
            value: missingSynthesisCount,
            tone: missingSynthesisCount > 0 ? 'warning' : 'neutral',
            href: '#documenti',
        },
        { label: 'Esenzioni', value: exemptionCodes.length },
    ];
    const nextCheckupLabel = nextCheckup
        ? new Date(nextCheckup.date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
        : undefined;
    const updatedLabel = new Date(patient.updatedAt).toLocaleDateString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
    /* @Codex LUME-104/68: il rail segue l'ordine clinico della superficie unica. */
    const workspaceNavItems: Kree8WorkspaceNavItem[] = [
        { href: '#attenzione', label: 'Attenzione', meta: String(reviewQueueSummary.attentionCount + openLoops.length) },
        { href: '#quadro', label: 'Quadro' },
        { href: '#identita', label: 'Identità' },
        { href: '#timeline', label: 'Timeline', meta: String(nonScaleEntries.length + (checkups ?? []).length + documentInsights.length) },
        { href: '#diario', label: 'Diario', meta: String(nonScaleEntries.length) },
        { href: '#terapie', label: 'Terapie', meta: workspace ? String(workspace.activeTherapiesCount) : undefined },
        { href: '#prestazioni', label: 'Prestazioni', meta: prestazioniCount !== undefined ? String(prestazioniCount) : undefined },
        { href: '#parametri', label: 'Parametri', meta: workspace ? String(workspace.observationsCount) : undefined },
        { href: '#protesica', label: 'Protesica', meta: protesicaCount !== undefined ? String(protesicaCount) : undefined },
        { href: '#siss', label: 'SISS/FSE' },
        { href: '#documenti', label: 'Documenti', meta: String(attachmentItems.length) },
        { href: '#scale', label: 'Scale' },
        { href: '#follow-up', label: 'Follow-up', meta: workspace ? String(workspace.pendingCheckupsCount) : undefined },
    ];

    const handleExportConfirm = async () => {
        try {
            const validationResponse = await fetch(`/api/fse/validate-patient?patientId=${encodeURIComponent(id)}`);
            if (!validationResponse.ok) {
                throw new Error('Validation pre-check failed');
            }
            const validation = await validationResponse.json() as ValidatePatientExportResponse;

            if (validation.hasErrors) {
                showToast({
                    tone: 'error',
                    title: 'Esportazione bloccata: risolvi gli errori di validazione FSE',
                    description: buildValidationMessage(validation),
                });
                return;
            }

            if (validation.hasWarnings) {
                const { confirmed } = await confirm({
                    title: 'Warning di validazione FSE',
                    message: `${buildValidationMessage(validation)}\n\nVuoi proseguire comunque con l'export?`,
                    confirmLabel: 'Esporta comunque',
                });
                if (!confirmed) return;
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

            showToast('Esportazione FHIR completata.', 'success');
        } catch (error) {
            console.error('Export failed', error);
            showToast("Errore durante l'esportazione.", 'error');
        }
    };

    const actionsDock = (
        <div className={workspaceStyles.actionsDock}>
            <Link
                href={`/patients/${id}/entries/new`}
                className={workspaceStyles.primaryAction}
            >
                <Plus className="h-4 w-4" />
                Nuova voce
            </Link>

            <div className={workspaceStyles.quietActions}>
                <Link
                    href={`/patients/${id}/edit`}
                    className={workspaceStyles.quietAction}
                >
                    <Pencil className="h-3.5 w-3.5" />
                    Modifica
                </Link>
                <button
                    type="button"
                    onClick={() => setIsExportModalOpen(true)}
                    className={workspaceStyles.quietAction}
                >
                    <Download className="h-3.5 w-3.5" />
                    Esporta FHIR
                </button>
                <button
                    type="button"
                    onClick={async () => {
                        const reportTherapies = await db.therapies.query({ patientId: id }).toArray();
                        const reportObservations = await db.observations.query({ patientId: id }).toArray();
                        const reportService = await import('@/lib/report-service');
                        reportService.generatePatientReport(patient, nonScaleEntries, scaleEntries, reportTherapies, reportObservations);
                    }}
                    className={workspaceStyles.quietAction}
                >
                    <FileText className="h-3.5 w-3.5" />
                    Report PDF
                </button>
            </div>
        </div>
    );

    return (
        <Kree8WorkspaceShell
            variant="clinical"
            eyebrow="Scheda clinica"
            title={`${patient.lastName} ${patient.firstName}`}
            subtitle=""
            backHref={`/patients/${id}`}
            backLabel="Quadro paziente"
            patientAtoms={[
                patient.taxCode ? `Codice ${patient.taxCode}` : 'Codice non disponibile',
                ageLabel,
                `Aggiornato ${updatedLabel}`,
            ]}
            navItems={workspaceNavItems}
        >
            <div className={workspaceStyles.clinicalStack}>
                <section id="attenzione" className={workspaceStyles.attentionBand} aria-labelledby="attention-title" data-testid="lume-scheda-attention">
                    <div className={workspaceStyles.attentionHead}>
                        <div>
                            <p className={workspaceStyles.sectionLabel}>Attenzione</p>
                            <h2 id="attention-title" className={workspaceStyles.sectionTitle}>Cosa fare adesso</h2>
                            <p className={workspaceStyles.sectionCopy}>Decisioni e attese aperte prima del resto della scheda.</p>
                        </div>
                    </div>
                    <div className={workspaceStyles.attentionContent}>
                        <div className={workspaceStyles.attentionList}>
                            {reviewQueueSummary.attentionCount > 0 ? (
                                <div data-lume-clinical-state="warning">
                                    <PatientReviewQueueSummaryPanel
                                        summary={{ ...reviewQueueSummary, rows: reviewQueueAttentionRows }}
                                        embedded
                                    />
                                </div>
                            ) : null}
                            {openLoops.map((loop) => {
                                const provenance = loop.sourceRef.type === 'service_prescription_item'
                                    ? (() => {
                                        const item = servicePrescriptionItems?.find((candidate) => candidate.id === loop.sourceRef.id);
                                        const date = item?.scheduledAt ?? item?.createdAt;
                                        const dateLabel = date
                                            ? new Date(date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
                                            : 'data non disponibile';
                                        return `Da prescrizione del ${dateLabel}: ${item?.serviceName ?? loop.sourceRef.serviceName ?? 'prestazione'}`;
                                    })()
                                    : (() => {
                                        const latest = (observations ?? [])
                                            .filter((observation) => observation.codeSystem === loop.sourceRef.codeSystem && observation.code === loop.sourceRef.code)
                                            .sort((left, right) => new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime())[0];
                                        return `Serie ${resolveStaticTerminology('LOINC', loop.sourceRef.code ?? '')?.displayIt ?? latest?.display ?? loop.sourceRef.code ?? 'non disponibile'}`;
                                    })();
                                return (
                                    <div
                                        key={`${loop.kind}:${loop.sourceRef.id ?? `${loop.sourceRef.codeSystem}:${loop.sourceRef.code}`}`}
                                        className={workspaceStyles.attentionRow}
                                        data-lume-clinical-state="warning"
                                    >
                                        <span className={workspaceStyles.attentionMarker} aria-hidden="true" />
                                        <div>
                                            <p className={workspaceStyles.attentionTitle}>{loop.label}</p>
                                            <p className={workspaceStyles.attentionNote}>{provenance}</p>
                                        </div>
                                        <button type="button" onClick={() => openObservationForm(loop)} className={workspaceStyles.attentionAction}>
                                            {loop.suggestedAction === 'insert_results' ? 'Inserisci risultato' : 'Inserisci misura'}
                                        </button>
                                    </div>
                                );
                            })}
                            {reviewQueueSummary.attentionCount === 0 && openLoops.length === 0 ? (
                                <p className={workspaceStyles.mutedText}>Nessuna decisione o attesa aperta al momento.</p>
                            ) : null}
                        </div>
                        {actionsDock}
                    </div>
                </section>

                <PatientSynopticSheet
                    leadDiagnosis={leadDiagnosis}
                    otherProblemsCount={otherProblemsCount}
                    signals={synopticSignals}
                    therapies={synopticTherapies}
                    therapiesTotal={workspace?.activeTherapiesCount}
                    latestMeasure={latestMeasure}
                    nextCheckupLabel={nextCheckupLabel}
                    nextCheckupTitle={nextCheckup?.title}
                />

                <CollapsibleSection id="identita" kicker="Identità" title="Identità, diagnosi ed esenzioni" surfaceClassName={workspaceStyles.clinicalSection} defaultOpen>
                    <PatientIdentityLens
                        variant="reader"
                        patient={patient}
                        ageLabel={ageLabel}
                        birthDateLabel={birthDateLabel}
                        diagnoses={diagnosisItems}
                        exemptions={exemptionCodes}
                        exemptionDetails={exemptionDetails ?? []}
                        summary={summaryText}
                        nextStep={nextStepText}
                    />
                </CollapsibleSection>

                <CollapsibleSection
                    id="timeline"
                    kicker="Timeline"
                    title="Timeline clinica"
                    count={`${nonScaleEntries.length + (checkups ?? []).length + documentInsights.length} eventi`}
                    summary="Diario, controlli e referti in ordine cronologico."
                    surfaceClassName={workspaceStyles.clinicalSection}
                >
                    <ClinicalRiverTimeline entries={nonScaleEntries} checkups={checkups ?? []} documentInsights={documentInsights} />
                </CollapsibleSection>

                <CollapsibleSection
                    id="diario"
                    kicker="Diario"
                    title="Diario clinico"
                    icon={FileText}
                    count={`${nonScaleEntries.length} voci`}
                    summary={nonScaleEntries.length === 0 ? 'Nessuna voce clinica registrata.' : 'Apri le voci attive del diario.'}
                    surfaceClassName={workspaceStyles.clinicalSection}
                    keepMounted
                >
                    {entries ? <Timeline entries={timelineEntries} /> : <p className={workspaceStyles.mutedText}>Diario in caricamento.</p>}
                </CollapsibleSection>

                    <CollapsibleSection
                        id="terapie"
                        kicker="Terapie"
                        title="Terapie farmacologiche"
                        icon={Pill}
                        count={workspace ? `${workspace.activeTherapiesCount} attive` : undefined}
                        summary={workspace?.activeTherapiesCount === 0 ? 'Nessuna terapia attiva registrata.' : undefined}
                        surfaceClassName={workspaceStyles.clinicalSection}
                        keepMounted
                    >
                        <div className="space-y-4">
                            <TherapyManager patientId={id} embedded />
                            <TreatmentReasoningPanel
                                patient={patient}
                                entries={entries}
                                therapies={therapies}
                                observations={observations}
                                attachments={attachments}
                            />
                        </div>
                    </CollapsibleSection>

                    <CollapsibleSection
                        id="prestazioni"
                        kicker="Prestazioni"
                        title="Prestazioni prescritte"
                        icon={Stethoscope}
                        count={prestazioniCount !== undefined ? String(prestazioniCount) : undefined}
                        summary={prestazioniCount === 0 ? 'Nessuna prestazione prescritta.' : undefined}
                        surfaceClassName={workspaceStyles.clinicalSection}
                        keepMounted
                    >
                        <ServicePrescriptionManager patientId={id} embedded />
                    </CollapsibleSection>

                    <CollapsibleSection
                        id="parametri"
                        kicker="Parametri"
                        title="Parametri clinici"
                        icon={Activity}
                        count={workspace ? String(workspace.observationsCount) : undefined}
                        summary={workspace?.observationsCount === 0 ? 'Nessun parametro registrato.' : undefined}
                        surfaceClassName={workspaceStyles.clinicalSection}
                        keepMounted
                    >
                        <ObservationManager patientId={id} embedded prefill={observationPrefill} />
                    </CollapsibleSection>

                    <CollapsibleSection
                        id="protesica"
                        kicker="Protesica"
                        title="Diario ausili e prescrizioni"
                        icon={Accessibility}
                        count={protesicaCount !== undefined ? String(protesicaCount) : undefined}
                        summary={protesicaCount === 0 ? 'Nessuna voce protesica registrata.' : undefined}
                        surfaceClassName={workspaceStyles.clinicalSection}
                        keepMounted
                    >
                        <ProstheticPrescriptionManager patientId={id} embedded />
                    </CollapsibleSection>

                    <CollapsibleSection
                        id="siss"
                        kicker="SISS / FSE"
                        title="SISS e FSE"
                        icon={ShieldCheck}
                        count={sissHandoffCount !== undefined ? `${sissHandoffCount} passaggi` : undefined}
                        summary="Apertura assistita dei portali regionali e diario dei passaggi."
                        surfaceClassName={workspaceStyles.clinicalSection}
                    >
                        <div className="space-y-4">
                            <SissPatientContextPanel
                                patientId={id}
                                patientTaxCode={patient.taxCode}
                                embedded
                            />
                            <SissHandoffDiary patientId={id} embedded />
                        </div>
                    </CollapsibleSection>
                <CollapsibleSection
                    id="documenti"
                    kicker="Documenti"
                    title="Archivio documenti ed evidenze"
                    count={attachmentItems.length > 0 ? `${attachmentItems.length} file` : undefined}
                    summary={attachmentItems.length > 0 ? 'Apri evidenze, insight e archivio.' : 'Nessun documento ancora caricato.'}
                    surfaceClassName={workspaceStyles.clinicalSection}
                    defaultOpen={!documentSynthesisKillSwitchLoading
                        && !patientInsightKillSwitchLoading
                        && (!documentSynthesisKillSwitch || isAiDocumentSynthesisEnabledValue(documentSynthesisKillSwitch.value))
                        && (Boolean(patient.aiSummary?.trim())
                            || smartImportSourceCount > 0
                            || reviewQueueSummary.rows.some((row) => row.id === 'insight' && row.state === 'bloccato'))}
                >
                    <div className="space-y-5">
                        <AIPatientInsight patient={patient} stale={insightStale} />
                        <div>
                            <p className={workspaceStyles.sectionLabel}>Referti recenti</p>
                        {recentEvidence.length > 0 ? (
                            <div className={workspaceStyles.evidenceList}>
                                {recentEvidence.map((insight) => (
                                    <EvidenceStackTile key={insight.id} insight={insight} />
                                ))}
                            </div>
                        ) : (
                            <p className={workspaceStyles.emptyState}>Nessuna evidenza documentale in primo piano.</p>
                        )}
                        </div>
                        {smartImportSourceCount > 0 ? (
                            <PatientSmartImportPanel
                                patient={patient}
                                entries={entries}
                                onReviewSnapshotChange={setSmartImportReview}
                            />
                        ) : null}
                        <DocumentInsightsPanel patient={patient} />
                        <div>
                            <p className={workspaceStyles.sectionLabel}>Archivio</p>
                            {patient.aiSummary?.trim() && !isDocumentUploadOpen ? (
                                <button type="button" className={workspaceStyles.rowLink} onClick={() => setIsDocumentUploadOpen(true)}>
                                    Apri caricamento documenti
                                </button>
                            ) : <DocumentUpload patientId={id} />}
                        </div>
                    </div>
                </CollapsibleSection>

                    <CollapsibleSection
                        id="scale"
                        kicker="Scale"
                        title="Scale di valutazione"
                        icon={Activity}
                        surfaceClassName={workspaceStyles.clinicalSection}
                        summary="Tinetti, MMSE, ADL (Katz), GDS e libreria completa."
                    >
                        <div className="space-y-3">
                            <Link href={`/patients/${id}/scales/tinetti`} className={workspaceStyles.rowLink}>
                                <span>Tinetti</span>
                                <Plus className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                            </Link>
                            <Link href={`/patients/${id}/scales/mmse`} className={workspaceStyles.rowLink}>
                                <span>MMSE</span>
                                <Plus className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                            </Link>
                            <Link href={`/patients/${id}/scales/adl`} className={workspaceStyles.rowLink}>
                                <span>ADL (Katz)</span>
                                <Plus className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                            </Link>
                            <Link href={`/patients/${id}/scales/gds`} className={workspaceStyles.rowLink}>
                                <span>GDS</span>
                                <Plus className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                            </Link>
                            <Link href={`/patients/${id}/scales`} className={workspaceStyles.rowLink}>
                                Apri libreria scale
                            </Link>
                        </div>
                    </CollapsibleSection>

                <CollapsibleSection
                    id="follow-up"
                    kicker="Pianificazione"
                    title="Follow-up"
                    count={workspace ? String(workspace.pendingCheckupsCount) : undefined}
                    summary={(checkups ?? []).length === 0 ? 'Nessun follow-up pianificato.' : 'Apri i prossimi passaggi pianificati.'}
                    surfaceClassName={workspaceStyles.clinicalSection}
                >
                        {!checkups || checkups.length === 0 ? (
                            <div>
                                <p className={workspaceStyles.emptyState}>Nessun follow-up pianificato.</p>
                                <Link href={`/patients/${id}/edit`} className={workspaceStyles.rowLink}>
                                    Aggiungi follow-up
                                </Link>
                            </div>
                        ) : (
                            <div className={workspaceStyles.followupList}>
                                {checkups.map((checkup) => (
                                    <div key={checkup.id} className={workspaceStyles.followupRow}>
                                        <div className={workspaceStyles.followupHeader}>
                                            <div>
                                                <p className="text-sm font-semibold text-[color:var(--lume-ink)]">{checkup.title}</p>
                                                {checkup.notes ? (
                                                    <p className="mt-1 text-xs leading-5 text-[color:var(--lume-ink-muted)]">{checkup.notes}</p>
                                                ) : null}
                                            </div>
                                            <span className={`${workspaceStyles.followupDate} lume-registro`} data-testid="lume-register-value">{new Date(checkup.date).toLocaleDateString('it-IT')}</span>
                                        </div>
                                    </div>
                                ))}
                                <Link href={`/patients/${id}/edit`} className={workspaceStyles.rowLink}>
                                    Gestisci follow-up
                                </Link>
                            </div>
                        )}

                        <FollowupSuggestions
                            patientId={id}
                            suggestions={followupSuggestions}
                            existingTitles={(checkups ?? []).map((checkup) => checkup.title)}
                        />
                </CollapsibleSection>
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
