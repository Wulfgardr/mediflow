'use client';

/* @Codex WUL-UIUX: banco di prova NON autenticato per la nuova composizione
   della Scheda su paziente complesso. Usa i componenti reali (identity lens,
   striscia segnali, sezioni collassabili, shell con scrollspy) con dati statici
   e placeholder al posto dei gestori pesanti, per testare disposizione, logica
   e fruibilita senza il PIN. Non e una rotta di produzione. */

import { Activity, Calendar, Droplets, FileText, FlaskConical, HeartPulse, Pill, Plus, Stethoscope } from 'lucide-react';

import { PatientClinicalSignals, type ClinicalSignal } from '@/components/patient-clinical-signals';
import { PatientIdentityLens } from '@/components/patient-identity-lens';
import { PrivacyProvider } from '@/components/privacy-provider';
import { CollapsibleSection } from '@/components/kree8/collapsible-section';
import { Kree8WorkspaceShell, type Kree8WorkspaceNavItem } from '@/components/kree8/kree8-workspace-shell';
import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';
import type { Diagnosis, Patient } from '@/lib/db';

const now = new Date('2026-06-18T09:00:00');

const mockPatient = {
    id: 'mock-complex',
    firstName: 'Giovanni',
    lastName: 'Bianchi Ferretti',
    taxCode: 'BNCGNN48M12F205K',
    address: 'Via dei Mille 14, Milano',
    phone: '02 5512 8841',
    isAdi: true,
    isArchived: false,
    caregiver: 'Figlia (Anna)',
    updatedAt: now,
    createdAt: now,
    exemptions: ['048', '013', '031', '6B00', 'C01', '002'],
    diagnoses: [] as Diagnosis[],
} as Patient;

const mockDiagnoses: Diagnosis[] = [
    { system: 'ICD-11', code: 'BA00', description: 'Ipertensione essenziale primaria', date: now },
    { system: 'ICD-11', code: '5A11', description: 'Diabete mellito di tipo 2 con complicanze renali', date: now },
    { system: 'ICD-11', code: 'BD10', description: 'Insufficienza cardiaca cronica (NYHA III)', date: now },
    { system: 'ICD-11', code: 'CA22', description: 'Broncopneumopatia cronica ostruttiva', date: now },
    { system: 'ICD-11', code: '8A00', description: 'Esiti di ictus ischemico con emiparesi destra', date: now },
    { system: 'ICD-11', code: 'FB81', description: 'Osteoartrosi del ginocchio bilaterale', date: now },
    { system: 'ICD-11', code: '6D80', description: 'Deterioramento cognitivo lieve', date: now },
    { system: 'ICD-11', code: 'GB61', description: 'Malattia renale cronica stadio 3b', date: now },
    { system: 'ICD-11', code: '5B81', description: 'Dislipidemia mista', date: now },
];

const exemptionDetails = [
    { code: '048', description: 'Patologia neoplastica maligna' },
    { code: '013', description: 'Diabete mellito' },
    { code: '031', description: "Ipertensione con danno d'organo" },
    { code: '6B00', description: 'Insufficienza cardiaca' },
];

const signals: ClinicalSignal[] = [
    { label: 'Problemi attivi', value: 9, hint: 'Ipertensione, diabete, scompenso', icon: Stethoscope, tone: 'neutral' },
    { label: 'Terapie attive', value: 8, hint: '2 ad alto rischio interazione', icon: Pill, tone: 'primary' },
    { label: 'Parametri fuori range', value: 3, hint: 'Creatinina, glicemia, PA', icon: FlaskConical, tone: 'critical' },
    { label: 'Referti', value: 14, hint: '2 da rivedere', icon: FileText, tone: 'neutral' },
    { label: 'Prossimo follow-up', value: '22 giu', hint: 'Controllo cardiologico', icon: Calendar, tone: 'warning' },
    { label: 'Esenzioni', value: 6, hint: '048, 013, 031, 6B00...', icon: HeartPulse, tone: 'neutral' },
];

const navItems: Kree8WorkspaceNavItem[] = [
    { group: 'Quadro e decisioni', href: '#quadro', label: 'Quadro' },
    { group: 'Quadro e decisioni', href: '#insight', label: 'Sintesi AI' },
    { group: 'Quadro e decisioni', href: '#parametri', label: 'Parametri', meta: '24' },
    { group: 'Terapie e prescrizioni', href: '#terapie', label: 'Terapie', meta: '8' },
    { group: 'Terapie e prescrizioni', href: '#prestazioni', label: 'Prestazioni', meta: '5' },
    { group: 'Terapie e prescrizioni', href: '#protesica', label: 'Protesica', meta: '2' },
    { group: 'Terapie e prescrizioni', href: '#siss', label: 'SISS/FSE' },
    { group: 'Documenti e prove', href: '#documenti', label: 'Documenti', meta: '14' },
    { group: 'Diario e follow-up', href: '#diario', label: 'Diario', meta: '23' },
    { group: 'Diario e follow-up', href: '#follow-up', label: 'Follow-up', meta: '3' },
];

function PlaceholderBody({ lines }: { lines: number }) {
    return (
        <div className="space-y-2">
            {Array.from({ length: lines }).map((_, index) => (
                <div
                    key={index}
                    className="rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-white/60 px-4 py-3 text-sm text-[color:var(--lume-ink-muted)] dark:border-white/10 dark:bg-white/5"
                >
                    Contenuto del gestore reale (placeholder di prova).
                </div>
            ))}
        </div>
    );
}

export default function MockSchedaPage() {
    const actionsDock = (
        <div className="patient-actions-dock rounded-[14px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-white/82 p-4 dark:bg-white/4">
            <button className="ui-btn-primary flex h-11 w-full items-center justify-center gap-2 px-4 text-sm font-semibold">
                <Plus className="h-4 w-4" />
                Nuova voce
            </button>
        </div>
    );

    return (
        <PrivacyProvider>
        <Kree8WorkspaceShell
            eyebrow="Scheda clinica"
            title="Scheda paziente"
            subtitle="Banco di prova composizione: paziente complesso."
            backHref="/"
            backLabel="Pazienti"
            patientLabel={`${mockPatient.lastName} ${mockPatient.firstName}`}
            statusLabel="9 problemi · 8 terapie · 3 fuori range · 14 referti"
            navItems={navItems}
        >
            <div id="quadro" className={workspaceStyles.anchorStack}>
                <PatientIdentityLens
                    variant="reader"
                    patient={mockPatient}
                    ageLabel="77 anni"
                    birthDateLabel="12/08/1948"
                    diagnoses={mockDiagnoses}
                    exemptions={mockPatient.exemptions ?? []}
                    exemptionDetails={exemptionDetails}
                    actions={actionsDock}
                    summary="Paziente pluripatologico in ADI: scompenso NYHA III e nefropatia diabetica in progressione. Creatinina e glicemia oltre range all'ultimo controllo."
                    nextStep="Rivedere la terapia diuretica e prenotare il controllo cardiologico del 22 giugno."
                />

                {/* Striscia di segnali: i numeri che contano, subito. */}
                <PatientClinicalSignals signals={signals} />
            </div>

            <div className={workspaceStyles.workspaceGrid}>
                <div className={workspaceStyles.primaryStack}>
                    {/* Narrativa clinica: aperta di default, in cima alla colonna larga. */}
                    <section id="insight" className="patient-detail-section border p-5 md:p-6 scroll-mt-28">
                        <p className="section-kicker">Sintesi AI</p>
                        <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-[color:var(--lume-ink)]">
                            <Activity className="h-5 w-5 text-[color:var(--lume-ink-muted)]" />
                            Quadro sintetico assistito
                        </h2>
                        <p className="mt-3 text-sm leading-6 text-[color:var(--lume-ink)]">
                            Anziano pluripatologico con scompenso cardiaco e nefropatia diabetica. Aderenza
                            terapeutica buona; ultimo accesso 14 giorni fa. Attenzione alla funzione renale in
                            calo e al rischio di interazione tra ACE-inibitore e diuretico risparmiatore.
                        </p>
                    </section>

                    <section id="diario" className="patient-detail-section border p-5 md:p-6 scroll-mt-28">
                        <span id="timeline" aria-hidden="true" />
                        <div className="mb-5 flex items-center justify-between gap-3">
                            <div>
                                <p className="section-kicker">Diario</p>
                                <h2 className="mt-1 text-xl font-semibold text-[color:var(--lume-ink)]">Diario clinico</h2>
                            </div>
                            <span className="apple-chip">23 eventi in totale</span>
                        </div>
                        <PlaceholderBody lines={3} />
                    </section>

                    {/* Gestori operativi: collassati di default (progressive disclosure). */}
                    <CollapsibleSection
                        id="parametri"
                        kicker="Parametri"
                        title="Parametri clinici"
                        icon={Droplets}
                        count="24 misure"
                        summary="Ultimo: PA 148/92, creatinina 1.8, glicemia 184 (18 giu)"
                    >
                        <PlaceholderBody lines={4} />
                    </CollapsibleSection>

                    <CollapsibleSection
                        id="terapie"
                        kicker="Terapie"
                        title="Terapie in corso"
                        icon={Pill}
                        count="8 attive"
                        summary="Ramipril, Furosemide, Metformina, Bisoprololo, Atorvastatina..."
                    >
                        <PlaceholderBody lines={4} />
                    </CollapsibleSection>

                    <CollapsibleSection
                        id="prestazioni"
                        kicker="Prestazioni"
                        title="Prestazioni e prescrizioni"
                        count="5 aperte"
                        summary="2 visite specialistiche, 3 esami in sospeso"
                    >
                        <PlaceholderBody lines={3} />
                    </CollapsibleSection>

                    <CollapsibleSection
                        id="protesica"
                        kicker="Protesica"
                        title="Prescrizione protesica"
                        count="2 attive"
                        summary="Carrozzina ad autospinta, deambulatore"
                    >
                        <PlaceholderBody lines={2} />
                    </CollapsibleSection>

                    <CollapsibleSection
                        id="siss"
                        kicker="SISS / FSE"
                        title="Contesto SISS e passaggi FSE"
                        summary="3 consultazioni FSE, 1 prescrizione SISS inviata"
                    >
                        <PlaceholderBody lines={3} />
                    </CollapsibleSection>
                </div>

                <div className={workspaceStyles.secondaryStack}>
                    <section id="documenti" className="patient-detail-side-section border p-5 scroll-mt-28">
                        <p className="section-kicker">Evidenze documentali</p>
                        <h3 className="mt-1 text-lg font-semibold text-[color:var(--lume-ink)]">Referti recenti</h3>
                        <div className="mt-4">
                            <PlaceholderBody lines={3} />
                        </div>
                    </section>

                    <section id="follow-up" className="patient-detail-side-section border p-5 scroll-mt-28">
                        <p className="section-kicker">Pianificazione</p>
                        <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-[color:var(--lume-ink)]">
                            <Calendar className="h-5 w-5 text-[color:var(--lume-ink-muted)]" />
                            Follow-up
                        </h3>
                        <div className="mt-4 space-y-2">
                            <div className="rounded-[12px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-white/82 px-4 py-3 dark:bg-white/5">
                                <p className="text-sm font-semibold text-[color:var(--lume-ink)]">Controllo cardiologico</p>
                                <span className="apple-chip">22/06/2026</span>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </Kree8WorkspaceShell>
        </PrivacyProvider>
    );
}
