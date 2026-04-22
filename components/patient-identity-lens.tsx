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
    actions: ReactNode;
    /* @Codex */
    summary?: string;
    /* @Codex */
    nextStep?: string;
    /* @Codex */
    exemptionDetails?: PatientExemptionLensItem[];
}

/* @Codex */
function isIcd11Diagnosis(diagnosis: Diagnosis) {
    return diagnosis.system?.toUpperCase() === 'ICD-11';
}

/* @Codex */
function getFeaturedDiagnoses(diagnoses: Diagnosis[]) {
    return diagnoses.filter(isIcd11Diagnosis).slice(0, 4);
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
    /* @Codex */
    const icd11DiagnosisCount = diagnoses.filter(isIcd11Diagnosis).length;
    /* @Codex */
    const leadDiagnosis = featuredDiagnoses[0];
    /* @Codex */
    const secondaryDiagnoses = featuredDiagnoses.slice(1);
    /* @Codex */
    const remainingIcd11Count = Math.max(icd11DiagnosisCount - featuredDiagnoses.length, 0);
    /* @Codex */
    const remainingExemptionCount = Math.max(exemptions.length - featuredExemptions.length, 0);

    if (variant === 'reader') {
        return (
            <section className="patient-identity-lens patient-identity-lens-reader relative overflow-hidden rounded-[22px] border border-[color:rgba(112,106,100,0.12)] bg-[color:rgba(255,252,247,0.9)] p-5 shadow-[0_18px_36px_rgba(35,27,22,0.08)] backdrop-blur-xl md:p-6">
                <div className="relative z-10 grid gap-4 xl:grid-cols-[minmax(0,1.38fr)_340px] xl:items-start">
                    <div className="min-w-0 space-y-4">
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.02fr)_minmax(320px,0.98fr)] lg:items-start">
                            <div className="min-w-0 rounded-[18px] border border-[color:rgba(112,106,100,0.1)] bg-[color:rgba(255,255,255,0.46)] p-5">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--mf-muted)]">
                                    Scheda paziente
                                </p>
                                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--mf-ink)] md:text-3xl">
                                    <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                                </h1>
                                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[color:var(--mf-muted)]">
                                    <span className="font-mono text-[12px] tracking-tight">
                                        <PrivacyBlur intensity="sm">{patient.taxCode}</PrivacyBlur>
                                    </span>
                                    <span>{ageLabel}</span>
                                    <span className="inline-flex items-center gap-1.5">
                                        <Calendar className="h-3.5 w-3.5" />
                                        {birthDateLabel}
                                    </span>
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2">
                                    <StatusGlyph
                                        kind={patient.isArchived ? 'archived' : patient.isAdi ? 'active' : 'follow-up'}
                                        label={patient.isArchived ? 'Archiviato' : patient.isAdi ? 'Attivo' : 'Follow-up'}
                                    />
                                    {icd11DiagnosisCount > 0 ? <StatusGlyph kind="review" label={`${icd11DiagnosisCount} ICD-11`} /> : null}
                                    {exemptions.length > 0 ? <StatusGlyph kind="completed" label={`${exemptions.length} esenzioni`} /> : null}
                                </div>
                            </div>

                            <div className="identity-lens-pane rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/78 p-5 dark:bg-white/4">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                    In Due Righe
                                </p>
                                <p className="mt-3 text-[15px] leading-7 text-[color:var(--mf-ink)]">
                                    {summary ?? 'Caso pronto per revisione clinica locale.'}
                                </p>
                                {nextStep ? (
                                    <div className="mt-4 border-t border-[color:rgba(112,106,100,0.12)] pt-4">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                            Prossimo step
                                        </p>
                                        <p className="mt-2 text-sm leading-6 text-[color:var(--mf-ink)]">
                                            {nextStep}
                                        </p>
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div className="identity-lens-pane rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/76 p-5 dark:bg-white/4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                        Quadro clinico
                                    </p>
                                    <h2 className="mt-1 text-base font-semibold text-[color:var(--mf-ink)]">
                                        Diagnosi attive ed esenzioni
                                    </h2>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <span className="apple-chip">{icd11DiagnosisCount} ICD-11</span>
                                    <span className="apple-chip">{exemptions.length} esenzioni</span>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-6">
                                <div className="min-w-0">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                        Diagnosi ICD-11
                                    </p>
                                    {leadDiagnosis ? (
                                        <div className="mt-3 rounded-[16px] border border-[color:rgba(94,53,95,0.12)] bg-[linear-gradient(180deg,rgba(94,53,95,0.07),rgba(94,53,95,0.03))] p-4">
                                            <div className="flex flex-wrap items-start gap-3">
                                                <span className="inline-flex items-center rounded-full border border-[color:rgba(94,53,95,0.14)] bg-white/84 px-3 py-1 text-sm font-semibold text-[color:var(--mf-ink)]">
                                                    {leadDiagnosis.code}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-medium leading-6 text-[color:var(--mf-ink)]">
                                                        {leadDiagnosis.description}
                                                    </p>
                                                    <p className="mt-1 text-xs leading-5 text-[color:var(--mf-muted)]">
                                                        Prima diagnosi da tenere in primo piano nella scheda clinica.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="mt-3 rounded-[16px] border border-dashed border-[color:rgba(112,106,100,0.18)] px-4 py-4 text-sm leading-6 text-[color:var(--mf-muted)]">
                                            {diagnoses.length > 0
                                                ? 'Sono presenti diagnosi codificate, ma nessuna ICD-11 in primo piano.'
                                                : 'Nessuna diagnosi ICD-11 strutturata in primo piano.'}
                                        </div>
                                    )}

                                    {secondaryDiagnoses.length > 0 ? (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {secondaryDiagnoses.map((diagnosis) => (
                                                <span
                                                    key={`${diagnosis.system}-${diagnosis.code}`}
                                                    className="inline-flex max-w-full items-center gap-2 rounded-full border border-[color:rgba(94,53,95,0.12)] bg-[color:rgba(94,53,95,0.05)] px-3 py-1.5 text-xs text-[color:var(--mf-ink)]"
                                                >
                                                    <span className="font-semibold">{diagnosis.code}</span>
                                                    <span className="truncate">{diagnosis.description}</span>
                                                </span>
                                            ))}
                                        </div>
                                    ) : null}

                                    {remainingIcd11Count > 0 ? (
                                        <p className="mt-3 text-xs text-[color:var(--mf-muted)]">
                                            +{remainingIcd11Count} altre diagnosi ICD-11 presenti in scheda.
                                        </p>
                                    ) : null}
                                </div>

                                <div className="min-w-0 lg:border-l lg:border-[color:rgba(112,106,100,0.12)] lg:pl-6">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                        Esenzioni
                                    </p>
                                    {featuredExemptions.length > 0 ? (
                                        <div className="mt-3 space-y-2">
                                            {featuredExemptions.map((exemption) => (
                                                <div
                                                    key={exemption.code}
                                                    className="rounded-[14px] border border-[color:rgba(15,123,104,0.12)] bg-[color:rgba(15,123,104,0.05)] px-3 py-3"
                                                >
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="inline-flex items-center rounded-full border border-[color:rgba(15,123,104,0.12)] bg-white/84 px-2.5 py-1 text-xs font-semibold text-[color:var(--mf-ink)]">
                                                            {exemption.code}
                                                        </span>
                                                        <p className="text-sm leading-6 text-[color:var(--mf-ink)]">
                                                            {exemption.description || 'Esenzione registrata nel profilo paziente.'}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="mt-3 rounded-[16px] border border-dashed border-[color:rgba(112,106,100,0.18)] px-4 py-4 text-sm leading-6 text-[color:var(--mf-muted)]">
                                            Nessuna esenzione strutturata registrata.
                                        </div>
                                    )}

                                    {remainingExemptionCount > 0 ? (
                                        <p className="mt-3 text-xs text-[color:var(--mf-muted)]">
                                            +{remainingExemptionCount} altre esenzioni registrate in scheda.
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="identity-lens-pane rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/78 p-5 dark:bg-white/4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                Contesto rapido
                            </p>
                            <div className="mt-3 space-y-3 text-sm text-[color:var(--mf-ink)]">
                                <p className="inline-flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5 text-[color:var(--mf-muted)]" />
                                    <PrivacyBlur intensity="sm">{patient.phone || 'Telefono non disponibile'}</PrivacyBlur>
                                </p>
                                <p className="inline-flex items-center gap-1.5">
                                    <MapPin className="h-3.5 w-3.5 text-[color:var(--mf-muted)]" />
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
        <section className="patient-identity-lens relative overflow-hidden rounded-[34px] border border-[color:var(--glass-border)] bg-[color:var(--glass-bg)] p-6 shadow-[var(--glass-panel-shadow)] backdrop-blur-3xl md:p-8">
            <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 space-y-4">
                    <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--mf-muted)]">
                            Identity Lens
                        </p>
                        <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--mf-ink)] md:text-4xl">
                            <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                        </h1>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[color:var(--mf-muted)]">
                            <span className="font-mono text-[12px] tracking-tight">
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
                        />
                        <StatusGlyph kind="review" label="Percorso clinico" />
                        {exemptions.length > 0 ? (
                            <StatusGlyph kind="completed" label={`${exemptions.length} esenzioni`} />
                        ) : null}
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                        <div className="identity-lens-pane rounded-[22px] border border-[color:rgba(112,106,100,0.12)] bg-white/70 p-4 dark:bg-white/4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                Quadro clinico
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {diagnoses.length > 0 ? (
                                    diagnoses.map((diagnosis) => (
                                        <span
                                            key={`${diagnosis.system}-${diagnosis.code}`}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-[color:rgba(94,53,95,0.14)] bg-[color:rgba(94,53,95,0.08)] px-3 py-1 text-[12px] font-medium text-[color:var(--mf-ink)]"
                                        >
                                            <span className="font-semibold text-[color:var(--mf-plum)]">{diagnosis.code}</span>
                                            {diagnosis.description}
                                        </span>
                                    ))
                                ) : (
                                    <p className="text-sm text-[color:var(--mf-muted)]">
                                        Nessuna diagnosi strutturata in primo piano.
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="identity-lens-pane rounded-[22px] border border-[color:rgba(112,106,100,0.12)] bg-white/70 p-4 dark:bg-white/4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                Contesto rapido
                            </p>
                            <div className="mt-3 space-y-2 text-sm text-[color:var(--mf-ink)]">
                                <p className="inline-flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5 text-[color:var(--mf-muted)]" />
                                    <PrivacyBlur intensity="sm">{patient.phone || 'Telefono non disponibile'}</PrivacyBlur>
                                </p>
                                <p className="inline-flex items-center gap-1.5">
                                    <MapPin className="h-3.5 w-3.5 text-[color:var(--mf-muted)]" />
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
