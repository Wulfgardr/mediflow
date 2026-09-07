'use client';

import type { ReactNode } from 'react';
import { Calendar, MapPin, Phone } from 'lucide-react';

import disclosure from '@/components/patient-disclosure.module.css';
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
    /* @Codex WUL-678: a reader instance owns exactly one navigable domain. */
    domain?: 'anagrafica' | 'clinica' | 'amministrazione';
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

function diagnosisSystemLabel(system?: string) {
    const normalized = system?.trim().toUpperCase();
    if (!normalized) return 'Codice';
    if (normalized.startsWith('ICD-11') || normalized === 'ICD11') return 'ICD-11';
    if (normalized.startsWith('ICD-10') || normalized === 'ICD10') return 'ICD-10';
    if (normalized.startsWith('ICD-9') || normalized === 'ICD9' || normalized === 'ICD-9-CM') return 'ICD-9';
    return normalized;
}

export function PatientIdentityLens({
    variant = 'atlas',
    domain = 'anagrafica',
    patient,
    ageLabel,
    birthDateLabel,
    diagnoses,
    exemptions,
    actions,
    exemptionDetails = [],
}: PatientIdentityLensProps) {
    /* @Codex WUL-678: normalize both lookup sides, preserving the original exemption contract. */
    const detailByCode = new Map(exemptionDetails.map((item) => [item.code.trim().toUpperCase(), item.description?.trim()]));
    /* @Codex WUL-678: only the requested domain is rendered in each destination. */
    if (variant === 'reader') {
        return (
            <div className={disclosure.identity}>
                {domain === 'anagrafica' ? <section aria-label="Dati anagrafici">
                    <dl className={disclosure.facts}>
                        <div><dt>Nome e cognome</dt><dd><PrivacyBlur>{patient.firstName} {patient.lastName}</PrivacyBlur></dd></div>
                        <div><dt>Codice fiscale</dt><dd><PrivacyBlur intensity="sm">{patient.taxCode || 'Non registrato'}</PrivacyBlur></dd></div>
                        <div><dt>Data di nascita</dt><dd>{birthDateLabel} · {ageLabel}</dd></div>
                        <div><dt>Telefono</dt><dd><PrivacyBlur intensity="sm">{patient.phone || 'Non registrato'}</PrivacyBlur></dd></div>
                        <div><dt>Indirizzo</dt><dd><PrivacyBlur intensity="sm">{patient.address || 'Non registrato'}</PrivacyBlur></dd></div>
                    </dl>
                </section> : null}
                {domain === 'clinica' ? <section aria-labelledby="patient-clinical-title">
                    <h2 id="patient-clinical-title">Diagnosi <span className={disclosure.count}>{diagnoses.length}</span></h2>
                    {diagnoses.length > 0 ? (
                        <ul className={disclosure.records} aria-label="Diagnosi registrate">
                            {diagnoses.map((diagnosis, index) => (
                                <li key={`${diagnosis.system}-${diagnosis.code}-${index}`}>
                                    <strong>{diagnosis.description || diagnosis.code}</strong>
                                    {diagnosis.code ? <span>{diagnosis.code} · {diagnosisSystemLabel(diagnosis.system)}</span> : <span>Diagnosi non codificata</span>}
                                </li>
                            ))}
                        </ul>
                    ) : <p>Nessuna diagnosi registrata.</p>}
                </section> : null}
                {domain === 'amministrazione' ? <section aria-labelledby="patient-administration-title">
                    <h2 id="patient-administration-title">Esenzioni <span className={disclosure.count}>{exemptions.length}</span></h2>
                    {exemptions.length > 0 ? (
                        <ul className={disclosure.records} aria-label="Esenzioni registrate">
                            {exemptions.map((code) => (
                                <li key={code}><strong>{code.trim().toUpperCase()}</strong><span>{detailByCode.get(code.trim().toUpperCase()) || 'Esenzione registrata nel profilo paziente.'}</span></li>
                            ))}
                        </ul>
                    ) : <p>Nessuna esenzione registrata.</p>}
                </section> : null}
                {actions}
            </div>
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
