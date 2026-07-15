'use client';

import type { ReactNode } from 'react';
import { Calendar, MapPin, Phone } from 'lucide-react';

import PrivacyBlur from '@/components/privacy-blur';
import { StatusGlyph } from '@/components/status-glyph';
import type { Diagnosis, Patient } from '@/lib/db';

/* @Codex */
interface PatientExemptionLensItem {
    code: string;
    description?: string;
}

interface PatientIdentityLensProps {
    /* @Codex */
    variant?: 'atlas' | 'reader';
    patient: Patient;
    ageLabel: string;
    birthDateLabel: string;
    diagnoses: Diagnosis[];
    exemptions: string[];
    /* @Codex WUL-UIUX: opzionale: come livello 2 sotto il Foglio sinottico la lens
       non ripete il dock azioni (vive nel Foglio). {actions} rende nulla se assente. */
    actions?: ReactNode;
    /* @Codex */
    summary?: string;
    /* @Codex */
    nextStep?: string;
    /* @Codex */
    exemptionDetails?: PatientExemptionLensItem[];
}

function isCodedDiagnosis(diagnosis: Diagnosis) {
    return Boolean(diagnosis.code?.trim());
}

function diagnosisSystemLabel(system?: string) {
    const normalized = system?.trim().toUpperCase();
    if (!normalized) return 'Codice';
    if (normalized.startsWith('ICD-11') || normalized === 'ICD11') return 'ICD-11';
    if (normalized.startsWith('ICD-10') || normalized === 'ICD10') return 'ICD-10';
    if (normalized.startsWith('ICD-9') || normalized === 'ICD9' || normalized === 'ICD-9-CM') return 'ICD-9';
    return normalized;
}

function getFeaturedDiagnoses(diagnoses: Diagnosis[]) {
    return diagnoses.filter(isCodedDiagnosis).slice(0, 4);
}

/* @Codex */
function getFeaturedExemptions(exemptions: string[], exemptionDetails: PatientExemptionLensItem[]) {
    const detailByCode = new Map(
        exemptionDetails.map((item) => [item.code.trim().toUpperCase(), item]),
    );

    return exemptions
        .map((code) => {
            const normalizedCode = code.trim().toUpperCase();
            const detail = detailByCode.get(normalizedCode);
            return {
                code: normalizedCode,
                description: detail?.description?.trim() || '',
            };
        })
        .slice(0, 4);
}

export function PatientIdentityLens({
    variant = 'atlas',
    patient,
    ageLabel,
    birthDateLabel,
    diagnoses,
    exemptions,
    actions,
    summary,
    nextStep,
    exemptionDetails = [],
}: PatientIdentityLensProps) {
    /* @Codex */
    const featuredDiagnoses = getFeaturedDiagnoses(diagnoses);
    /* @Codex */
    const featuredExemptions = getFeaturedExemptions(exemptions, exemptionDetails);
    const codedDiagnosisCount = diagnoses.filter(isCodedDiagnosis).length;
    /* @Codex */
    const leadDiagnosis = featuredDiagnoses[0];
    /* @Codex */
    const secondaryDiagnoses = featuredDiagnoses.slice(1);
    const remainingCodedCount = Math.max(codedDiagnosisCount - featuredDiagnoses.length, 0);
    /* @Codex */
    const remainingExemptionCount = Math.max(exemptions.length - featuredExemptions.length, 0);

    if (variant === 'reader') {
        return (
            <section className="patient-identity-lens patient-identity-lens-reader lume-panel relative overflow-hidden p-5 md:p-6">
                <div className="relative z-10 grid gap-5 xl:grid-cols-[minmax(0,1.38fr)_320px] xl:items-start">
                    <div className="min-w-0 space-y-5">
                        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.02fr)_minmax(320px,0.98fr)] lg:items-start lg:divide-x lg:divide-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)]">
                            <div className="min-w-0 lg:pr-5">
                                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--lume-ink-muted)]">
                                    Scheda paziente
                                </p>
                                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--lume-ink)] md:text-[28px]">
                                    <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                                </h1>
                                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[color:var(--lume-ink-muted)]">
                                    <span className="lume-registro text-[12px] tracking-tight">
                                        <PrivacyBlur intensity="sm">{patient.taxCode}</PrivacyBlur>
                                    </span>
                                    <span>{ageLabel}</span>
                                    <span className="inline-flex items-center gap-1.5">
                                        <Calendar className="h-3.5 w-3.5" />
                                        {birthDateLabel}
                                    </span>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                    <StatusGlyph
                                        kind={patient.isArchived ? 'archived' : patient.isAdi ? 'active' : 'follow-up'}
                                        label={patient.isArchived ? 'Archiviato' : patient.isAdi ? 'Attivo' : 'Follow-up'}
                                        tone="neutral"
                                    />
                                    {codedDiagnosisCount > 0 ? <StatusGlyph kind="review" label={`${codedDiagnosisCount} diagnosi`} tone="neutral" /> : null}
                                    {exemptions.length > 0 ? <StatusGlyph kind="completed" label={`${exemptions.length} esenzioni`} tone="neutral" /> : null}
                                </div>
                            </div>

                            <div className="lg:pl-5">
                                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                                    In due righe
                                </p>
                                <p className="mt-2 text-[15px] leading-7 text-[color:var(--lume-ink)]">
                                    {summary ?? 'Nessuna sintesi clinica disponibile.'}
                                </p>
                                {nextStep ? (
                                    <div className="mt-3 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] pt-3">
                                        <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                                            Prossimo passaggio
                                        </p>
                                        <p className="mt-1.5 text-sm leading-6 text-[color:var(--lume-ink)]">
                                            {nextStep}
                                        </p>
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div className="border-t border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] pt-5">
                            <div className="flex flex-wrap items-baseline justify-between gap-3">
                                <h2 className="text-sm font-medium uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                                    Quadro clinico
                                </h2>
                                <div className="flex flex-wrap gap-2 text-[11px] text-[color:var(--lume-ink-muted)]">
                                    <span>{codedDiagnosisCount} diagnosi</span>
                                    <span aria-hidden>·</span>
                                    <span>{exemptions.length} esenzioni</span>
                                </div>
                            </div>

                            <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-6">
                                <div className="min-w-0">
                                    <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                                        Diagnosi codificate
                                    </p>
                                    {leadDiagnosis ? (
                                        <div className="patient-diagnosis-card mt-2 rounded-[var(--lume-radius-control)] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] p-3">
                                            <div className="flex flex-wrap items-start gap-3">
                                                <span className="patient-code-pill patient-code-pill-primary lume-registro">
                                                    {leadDiagnosis.code}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-[15px] font-semibold leading-6 text-[color:var(--lume-ink)]">
                                                        {leadDiagnosis.description}
                                                    </p>
                                                    <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[color:var(--lume-ink-muted)]">
                                                        {diagnosisSystemLabel(leadDiagnosis.system)}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="mt-2 text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                                            Nessuna diagnosi codificata in primo piano.
                                        </p>
                                    )}

                                    {secondaryDiagnoses.length > 0 ? (
                                        /* @Codex: le diagnosi secondarie sono una lista informativa;
                                           la semantica nativa rende verificabile il nome accessibile dei chip. */
                                        <ul
                                            aria-label="Diagnosi codificate secondarie"
                                            className="mt-2 flex flex-wrap gap-1.5"
                                        >
                                            {secondaryDiagnoses.map((diagnosis) => (
                                                <li
                                                    key={`${diagnosis.system}-${diagnosis.code}`}
                                                    className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] px-2.5 py-1 text-xs text-[color:var(--lume-ink)]"
                                                >
                                                    <span className="lume-registro font-semibold">{diagnosis.code}</span>
                                                    <span className="truncate" title={diagnosis.description}>{diagnosis.description}</span>
                                                    <span className="shrink-0 text-[10px] uppercase tracking-[0.04em] text-[color:var(--lume-ink-muted)]">
                                                        {diagnosisSystemLabel(diagnosis.system)}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : null}

                                    {remainingCodedCount > 0 ? (
                                        <p className="mt-2 text-xs text-[color:var(--lume-ink-muted)]">
                                            +{remainingCodedCount} altre diagnosi codificate presenti in scheda.
                                        </p>
                                    ) : null}
                                </div>

                                <div className="min-w-0 lg:border-l lg:border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] lg:pl-6">
                                    <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                                        Esenzioni
                                    </p>
                                    {featuredExemptions.length > 0 ? (
                                        <ul className="mt-2 space-y-1.5">
                                            {featuredExemptions.map((exemption) => (
                                                <li
                                                    key={exemption.code}
                                                    className="flex flex-wrap items-baseline gap-2 text-sm leading-6 text-[color:var(--lume-ink)]"
                                                >
                                                    <span className="patient-code-pill patient-code-pill-primary">
                                                        {exemption.code}
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        {exemption.description || 'Esenzione registrata nel profilo paziente.'}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="mt-2 text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                                            Nessuna esenzione strutturata registrata.
                                        </p>
                                    )}

                                    {remainingExemptionCount > 0 ? (
                                        <p className="mt-2 text-xs text-[color:var(--lume-ink-muted)]">
                                            +{remainingExemptionCount} altre esenzioni registrate in scheda.
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="patient-quick-context-card rounded-[var(--lume-radius-control)] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 py-3">
                            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                                Contesto rapido
                            </p>
                            <div className="mt-2 space-y-1.5 text-sm text-[color:var(--lume-ink)]">
                                <p className="inline-flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5 text-[color:var(--lume-ink-muted)]" />
                                    <PrivacyBlur intensity="sm">{patient.phone || 'Telefono non disponibile'}</PrivacyBlur>
                                </p>
                                <p className="inline-flex items-center gap-1.5">
                                    <MapPin className="h-3.5 w-3.5 text-[color:var(--lume-ink-muted)]" />
                                    <PrivacyBlur intensity="sm">{patient.address || 'Indirizzo non disponibile'}</PrivacyBlur>
                                </p>
                            </div>
                        </div>
                        {actions}
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="patient-identity-lens lume-panel relative overflow-hidden p-6 md:p-8">
            <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 space-y-4">
                    <div className="space-y-2">
                        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--lume-ink-muted)]">
                            Identity Lens
                        </p>
                        <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--lume-ink)] md:text-4xl">
                            <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                        </h1>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[color:var(--lume-ink-muted)]">
                            <span className="lume-registro text-[12px] tracking-tight">
                                <PrivacyBlur intensity="sm">{patient.taxCode}</PrivacyBlur>
                            </span>
                            <span>{ageLabel}</span>
                            <span className="inline-flex items-center gap-1.5">
                                <Calendar className="h-3.5 w-3.5" />
                                {birthDateLabel}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <StatusGlyph
                            kind={patient.isArchived ? 'archived' : patient.isAdi ? 'active' : 'follow-up'}
                            label={patient.isArchived ? 'Archiviato' : patient.isAdi ? 'Attivo' : 'Follow-up'}
                            tone="neutral"
                        />
                        <StatusGlyph kind="review" label="Percorso clinico" tone="neutral" />
                        {exemptions.length > 0 ? (
                            <StatusGlyph kind="completed" label={`${exemptions.length} esenzioni`} tone="neutral" />
                        ) : null}
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                        <div className="identity-lens-pane rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-4">
                            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                                Quadro clinico
                            </p>
                            {diagnoses.length > 0 ? (
                                /* @Codex: il contenitore nomina la collezione; ogni voce
                                   conserva codice, descrizione e sistema come contenuto naturale. */
                                <ul
                                    aria-label="Diagnosi del quadro clinico"
                                    className="mt-3 flex flex-wrap gap-2"
                                >
                                    {diagnoses.map((diagnosis) => (
                                        <li
                                            key={`${diagnosis.system}-${diagnosis.code}`}
                                            className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] px-3 py-1 text-[12px] font-medium text-[color:var(--lume-ink)]"
                                        >
                                            <span className="lume-registro shrink-0 font-semibold text-[color:var(--lume-ink)]">{diagnosis.code}</span>
                                            <span className="min-w-0 truncate" title={diagnosis.description}>{diagnosis.description}</span>
                                            <span className="shrink-0 text-[10px] uppercase tracking-[0.04em] text-[color:var(--lume-ink-muted)]">
                                                {diagnosisSystemLabel(diagnosis.system)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="mt-3 text-sm text-[color:var(--lume-ink-muted)]">
                                    Nessuna diagnosi strutturata in primo piano.
                                </p>
                            )}
                        </div>

                        <div className="identity-lens-pane rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-4">
                            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                                Contesto rapido
                            </p>
                            <div className="mt-3 space-y-2 text-sm text-[color:var(--lume-ink)]">
                                <p className="inline-flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5 text-[color:var(--lume-ink-muted)]" />
                                    <PrivacyBlur intensity="sm">{patient.phone || 'Telefono non disponibile'}</PrivacyBlur>
                                </p>
                                <p className="inline-flex items-center gap-1.5">
                                    <MapPin className="h-3.5 w-3.5 text-[color:var(--lume-ink-muted)]" />
                                    <PrivacyBlur intensity="sm">{patient.address || 'Indirizzo non disponibile'}</PrivacyBlur>
                                </p>
                                <p>
                                    {exemptions.length > 0 ? `Esenzioni attive: ${exemptions.slice(0, 4).join(', ')}.` : 'Nessuna esenzione strutturata registrata.'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="xl:w-[360px] xl:max-w-[360px]">
                    {actions}
                </div>
            </div>
        </section>
    );
}
