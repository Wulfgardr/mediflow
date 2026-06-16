'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Activity,
    ArrowUpRight,
    Building2,
    CalendarClock,
    Copy,
    FileSearch,
    HeartPulse,
    RotateCcw,
    Scissors,
    Search,
    ShieldCheck,
    UserPlus,
} from 'lucide-react';

import { CaseLensPanel } from '@/components/case-lens-panel';
import { ClinicalStreamRow } from '@/components/clinical-stream-row';
import { GlassCommandCapsule } from '@/components/glass-command-capsule';
import { PatientAgendaWorklist } from '@/components/patient-agenda-worklist';
import PrivacyBlur from '@/components/privacy-blur';
import { db, type Ambulatory, type Patient } from '@/lib/db';
import { usePatientClipboard } from '@/hooks/use-patient-clipboard';
import { useLiveQuery, notifyDbChange } from '@/lib/live-query';
import { calculateAge, estimateBirthYearFromTaxCode } from '@/lib/utils';

function readCookie(name: string) {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
    return match?.[2] ?? null;
}

const AMBULATORY_COLORS = [
    { dot: 'bg-emerald-600' },
    { dot: 'bg-[color:var(--mf-accent)]' },
    { dot: 'bg-[color:var(--mf-plum)]' },
    { dot: 'bg-amber-600' },
    { dot: 'bg-rose-600' },
    { dot: 'bg-teal-600' },
    { dot: 'bg-orange-600' },
    { dot: 'bg-fuchsia-600' },
];

function getAmbulatoryColor(id: string): typeof AMBULATORY_COLORS[0] {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
        hash = ((hash << 5) - hash) + id.charCodeAt(index);
        hash |= 0;
    }
    return AMBULATORY_COLORS[Math.abs(hash) % AMBULATORY_COLORS.length];
}

/* @Codex */
function getPatientAgeLabel(patient: Patient): string {
    const birthYear = patient.birthDate
        ? new Date(patient.birthDate).getFullYear()
        : estimateBirthYearFromTaxCode(patient.taxCode);

    return birthYear ? `${calculateAge(birthYear)} anni` : 'Età n/d';
}

/* @Codex */
function getPatientLeadDiagnosis(patient: Patient): string {
    const diagnosis = Array.isArray(patient.diagnoses) ? patient.diagnoses[0] : null;
    if (diagnosis) return `${diagnosis.code} · ${diagnosis.description}`;
    if (patient.isArchived) return 'Percorso chiuso, consultabile come storico clinico.';
    if (patient.isAdi) return 'Percorso territoriale attivo con continuità domiciliare.';
    return 'Scheda pronta per diario, documenti e revisione clinica.';
}

/* @Codex */
function formatTouchedLabel(patient?: Patient | null): string {
    if (!patient) return 'Nessun caso';
    const rawDate = patient.updatedAt || patient.createdAt;
    if (!rawDate) return 'Nessun aggiornamento';
    return new Intl.DateTimeFormat('it-IT', {
        day: '2-digit',
        month: 'short',
    }).format(new Date(rawDate));
}

interface PatientGroup {
    ambulatory: Ambulatory | null;
    patients: Patient[];
    color: typeof AMBULATORY_COLORS[0];
}

export default function PatientList() {
    const [viewMode, setViewMode] = useState<'active' | 'archived'>('active');
    const [search, setSearch] = useState('');
    const [sortMode, setSortMode] = useState<'alpha' | 'recent'>('recent');
    const [density, setDensity] = useState<'compact' | 'wide'>('compact');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [focusedPatientId, setFocusedPatientId] = useState<string | null>(null);
    const [isMoving, setIsMoving] = useState(false);
    const [targetAmbulatory, setTargetAmbulatory] = useState<string>('');
    const [showMoveModal, setShowMoveModal] = useState(false);

    const { copy, cut, paste, clipboard } = usePatientClipboard();
    const currentAmbulatoryId = readCookie('ambulatory_id');
    const isGlobalView = !currentAmbulatoryId;

    const ambulatories = useLiveQuery(() => db.ambulatories.toArray());

    const sortPatients = useCallback((items: Patient[]) => {
        const sorted = [...items];
        if (sortMode === 'alpha') {
            sorted.sort((left, right) => {
                const byLastName = (left.lastName || '').localeCompare(right.lastName || '');
                if (byLastName !== 0) return byLastName;
                return (left.firstName || '').localeCompare(right.firstName || '');
            });
            return sorted;
        }

        sorted.sort((left, right) => {
            const leftTime = (left.updatedAt || left.createdAt)
                ? new Date(left.updatedAt || left.createdAt).getTime()
                : 0;
            const rightTime = (right.updatedAt || right.createdAt)
                ? new Date(right.updatedAt || right.createdAt).getTime()
                : 0;
            return rightTime - leftTime;
        });
        return sorted;
    }, [sortMode]);

    const patients = useLiveQuery(
        async () => {
            let collection = db.patients.orderBy('lastName');

            if (viewMode === 'active') {
                collection = collection.filter((patient) => !patient.isArchived);
            } else {
                collection = collection.filter((patient) => Boolean(patient.isArchived));
            }

            if (search.trim()) {
                const terms = search.toLowerCase().trim().split(/\s+/);
                const filtered = await collection.filter((patient) => {
                    const searchableText = `${patient.lastName} ${patient.firstName} ${patient.taxCode || ''}`.toLowerCase();
                    const diagnosisText = Array.isArray(patient.diagnoses)
                        ? patient.diagnoses.map((diagnosis) => `${diagnosis.code} ${diagnosis.description}`).join(' ').toLowerCase()
                        : '';
                    return terms.every((term) => `${searchableText} ${diagnosisText}`.includes(term));
                }).toArray();
                return sortPatients(filtered);
            }

            const items = await collection.toArray();
            return sortPatients(items);
        },
        [search, sortMode, viewMode],
    );

    const patientGroups = useMemo<PatientGroup[]>(() => {
        if (!patients || !ambulatories || currentAmbulatoryId) return [];

        const groupedPatients = new Map<string, Patient[]>();
        const unassigned: Patient[] = [];

        patients.forEach((patient) => {
            if (patient.ambulatoryId) {
                const currentItems = groupedPatients.get(patient.ambulatoryId) ?? [];
                currentItems.push(patient);
                groupedPatients.set(patient.ambulatoryId, currentItems);
            } else {
                unassigned.push(patient);
            }
        });

        const result: PatientGroup[] = [];
        const sortedAmbulatories = [...ambulatories].sort((left, right) => {
            if (!left.parentId && right.parentId) return -1;
            if (left.parentId && !right.parentId) return 1;
            return left.name.localeCompare(right.name);
        });

        sortedAmbulatories.forEach((ambulatory) => {
            const items = groupedPatients.get(ambulatory.id);
            if (!items || items.length === 0) return;
            result.push({
                ambulatory,
                patients: items,
                color: getAmbulatoryColor(ambulatory.id),
            });
        });

        if (unassigned.length > 0) {
            result.push({
                ambulatory: null,
                patients: unassigned,
                color: { dot: 'bg-stone-400' },
            });
        }

        return result;
    }, [ambulatories, currentAmbulatoryId, patients]);

    const focusedPatient = useMemo(
        () => patients?.find((patient) => patient.id === focusedPatientId) ?? null,
        [focusedPatientId, patients],
    );

    const focusedAmbulatoryName = useMemo(() => {
        if (!focusedPatient) return undefined;
        if (focusedPatient.ambulatoryId) {
            return ambulatories?.find((ambulatory) => ambulatory.id === focusedPatient.ambulatoryId)?.name;
        }
        return currentAmbulatoryId
            ? ambulatories?.find((ambulatory) => ambulatory.id === currentAmbulatoryId)?.name
            : undefined;
    }, [ambulatories, currentAmbulatoryId, focusedPatient]);

    const currentAmbulatory = currentAmbulatoryId
        ? ambulatories?.find((ambulatory) => ambulatory.id === currentAmbulatoryId)
        : null;

    /* @Codex */
    const activeAmbulatoryCount = patientGroups.length || (currentAmbulatory ? 1 : 0);

    /* @Codex */
    const workbenchScopeLabel = isGlobalView
        ? `${activeAmbulatoryCount} contenitori`
        : currentAmbulatory?.name || 'Ambulatorio locale';

    /* @Codex */
    const heroStatusLabel = focusedPatient?.isArchived
        ? 'Archiviato'
        : focusedPatient?.isAdi
            ? 'Territorio attivo'
            : 'Follow-up';

    useEffect(() => {
        if (!patients || patients.length === 0) {
            setFocusedPatientId(null);
            return;
        }

        const hasFocusedPatient = focusedPatientId && patients.some((patient) => patient.id === focusedPatientId);
        if (!hasFocusedPatient) {
            setFocusedPatientId(patients[0].id);
        }
    }, [focusedPatientId, patients]);

    const toggleSelection = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const handleSelectAll = useCallback(() => {
        if (!patients) return;
        if (selectedIds.size === patients.length) {
            setSelectedIds(new Set());
            return;
        }
        setSelectedIds(new Set(patients.map((patient) => patient.id)));
    }, [patients, selectedIds]);

    /* @Codex */
    const isFiltered = Boolean(search.trim()) || viewMode !== 'active';

    const clearFilters = useCallback(() => {
        setSearch('');
        setViewMode('active');
    }, []);

    useEffect(() => {
        const handleKeyDown = async (event: KeyboardEvent) => {
            if (['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) return;
            const isCtrl = event.metaKey || event.ctrlKey;

            if (isCtrl && event.key === 'a') {
                event.preventDefault();
                handleSelectAll();
            }

            if (isCtrl && event.key === 'c') {
                event.preventDefault();
                if (selectedIds.size > 0 && currentAmbulatoryId) {
                    copy(Array.from(selectedIds), currentAmbulatoryId);
                }
            }

            if (isCtrl && event.key === 'x') {
                event.preventDefault();
                if (selectedIds.size > 0 && currentAmbulatoryId) {
                    cut(Array.from(selectedIds), currentAmbulatoryId);
                }
            }

            if (isCtrl && event.key === 'v') {
                event.preventDefault();
                if (clipboard.patientIds.length === 0 || !currentAmbulatoryId) return;

                const isTest = ambulatories?.find((ambulatory) => ambulatory.id === currentAmbulatoryId)?.type === 'test';
                const operationName = clipboard.operation === 'copy' ? 'Copia' : 'Sposta';
                if (confirm(`${operationName} di ${clipboard.patientIds.length} pazienti qui?`)) {
                    const success = await paste(currentAmbulatoryId, Boolean(isTest));
                    if (success) {
                        if (clipboard.operation === 'cut') setSelectedIds(new Set());
                        notifyDbChange();
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [ambulatories, clipboard, copy, currentAmbulatoryId, cut, handleSelectAll, paste, selectedIds]);

    const handleMove = async () => {
        if (!targetAmbulatory) return;

        setIsMoving(true);
        try {
            const response = await fetch('/api/patients/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patientIds: Array.from(selectedIds),
                    targetAmbulatoryId: targetAmbulatory,
                    sourceAmbulatoryId: currentAmbulatoryId,
                }),
            });

            if (!response.ok) throw new Error('Move failed');

            setSelectedIds(new Set());
            setShowMoveModal(false);
            setTargetAmbulatory('');
            notifyDbChange();
        } catch (error) {
            console.error(error);
            alert('Errore durante lo spostamento');
        } finally {
            setIsMoving(false);
        }
    };

    const renderStream = (items: Patient[], ambulatoryName?: string) => (
        <div className="patient-liquid-stream grid gap-3">
            {items.map((patient) => (
                <ClinicalStreamRow
                    key={patient.id}
                    variant="mailbox"
                    patient={patient}
                    ambulatoryName={ambulatoryName}
                    isSelected={focusedPatientId === patient.id}
                    isMarked={selectedIds.has(patient.id)}
                    onSelect={setFocusedPatientId}
                    onToggleMark={toggleSelection}
                />
            ))}
        </div>
    );

    const selectionToolbar = selectedIds.size > 0 ? (
        <div className="sticky top-4 z-30 flex animate-in fade-in slide-in-from-top-2 items-center justify-between gap-3 rounded-[16px] border border-[color:rgba(15,123,104,0.18)] bg-[color:rgba(255,252,247,0.94)] p-2.5 shadow-[0_14px_28px_rgba(35,27,22,0.08)] backdrop-blur-xl dark:bg-[color:rgba(28,23,27,0.94)]">
            <div className="flex flex-wrap items-center gap-2">
                <span className="pl-3 text-sm font-semibold text-[color:var(--mf-primary)]">
                    {selectedIds.size} selezionati
                </span>
                <div className="mx-1 hidden h-4 w-px bg-[color:rgba(112,106,100,0.18)] sm:block" />
                <button
                    type="button"
                    onClick={() => setShowMoveModal(true)}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold text-[color:var(--mf-ink)] transition-colors hover:bg-white/72 dark:hover:bg-white/8"
                >
                    <Building2 className="h-3.5 w-3.5" />
                    Sposta
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (currentAmbulatoryId) {
                            copy(Array.from(selectedIds), currentAmbulatoryId);
                            setSelectedIds(new Set());
                        }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold text-[color:var(--mf-ink)] transition-colors hover:bg-white/72 dark:hover:bg-white/8"
                >
                    <Copy className="h-3.5 w-3.5" />
                    Copia
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (currentAmbulatoryId) {
                            cut(Array.from(selectedIds), currentAmbulatoryId);
                            setSelectedIds(new Set());
                        }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold text-[color:var(--mf-ink)] transition-colors hover:bg-white/72 dark:hover:bg-white/8"
                >
                    <Scissors className="h-3.5 w-3.5" />
                    Taglia
                </button>
            </div>
            <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="pr-2 text-[12px] font-medium text-[color:var(--mf-muted)] hover:text-[color:var(--mf-ink)]"
            >
                Annulla
            </button>
        </div>
    ) : null;

    const workbenchContent = (
        <div className="patient-liquid-workbench space-y-5">
            <section className="patient-liquid-commandbar glass-command-capsule border p-3">
                <GlassCommandCapsule
                    variant="workbench"
                    search={search}
                    onSearchChange={setSearch}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    sortMode={sortMode}
                    onSortModeChange={setSortMode}
                    density={isGlobalView ? density : undefined}
                    onDensityChange={isGlobalView ? setDensity : undefined}
                    className="border-0 bg-transparent p-0 shadow-none"
                />
            </section>

            <section className="patient-liquid-hero grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
                <article className="patient-liquid-lens mediflow-vitreous-panel relative overflow-hidden rounded-[32px] border p-6 md:p-8">
                    <div className="relative z-10 max-w-3xl">
                        <p className="section-kicker">
                            {isGlobalView ? 'Tutte le schede' : 'Questo ambulatorio'}
                        </p>
                        <h1 className="patient-liquid-name mt-4 text-[clamp(2.65rem,7vw,6rem)] font-semibold leading-[0.9] text-[color:var(--mf-ink)]">
                            {focusedPatient ? (
                                <PrivacyBlur>{focusedPatient.lastName} {focusedPatient.firstName}</PrivacyBlur>
                            ) : (
                                'Inbox pazienti'
                            )}
                        </h1>
                        <p className="mt-5 max-w-2xl text-sm leading-6 text-[color:var(--mf-muted)] md:text-base">
                            {focusedPatient
                                ? getPatientLeadDiagnosis(focusedPatient)
                                : `${patients?.length || 0} casi visibili. Seleziona un paziente per aprire la lente clinica.`}
                        </p>
                    </div>

                    <div className="patient-liquid-chip-row relative z-10 mt-8 flex flex-wrap gap-2">
                        <span className="graphite-chip rounded-full border border-[color:rgba(112,106,100,0.14)] bg-white/56 px-3 py-2 text-[12px] font-semibold text-[color:var(--mf-ink)] dark:bg-white/6">
                            {heroStatusLabel}
                        </span>
                        <span className="graphite-chip rounded-full border border-[color:rgba(112,106,100,0.14)] bg-white/56 px-3 py-2 text-[12px] font-semibold text-[color:var(--mf-ink)] dark:bg-white/6">
                            {focusedPatient ? getPatientAgeLabel(focusedPatient) : workbenchScopeLabel}
                        </span>
                        <span className="graphite-chip rounded-full border border-[color:rgba(112,106,100,0.14)] bg-white/56 px-3 py-2 text-[12px] font-semibold text-[color:var(--mf-ink)] dark:bg-white/6">
                            {patients?.length || 0} casi visibili
                        </span>
                        <span className="graphite-chip rounded-full border border-[color:rgba(112,106,100,0.14)] bg-white/56 px-3 py-2 text-[12px] font-semibold text-[color:var(--mf-ink)] dark:bg-white/6">
                            Nessun egress cloud
                        </span>
                    </div>
                </article>

                <aside className="patient-liquid-signals mediflow-vitreous-side-panel rounded-[32px] border p-4 md:p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="section-kicker">Segnali</p>
                            <h2 className="mt-2 text-xl font-semibold text-[color:var(--mf-ink)]">
                                Nodo operativo
                            </h2>
                        </div>
                        <ShieldCheck className="h-5 w-5 text-[color:var(--mf-primary)]" />
                    </div>

                    <div className="mt-5 grid gap-2">
                        <div className="patient-liquid-signal">
                            <FileSearch className="h-4 w-4 text-[color:var(--mf-primary)]" />
                            <div>
                                <p className="text-sm font-semibold text-[color:var(--mf-ink)]">Caso in lente</p>
                                <p className="text-xs text-[color:var(--mf-muted)]">
                                    {focusedPatient ? formatTouchedLabel(focusedPatient) : 'Nessuna selezione'}
                                </p>
                            </div>
                            <span>{focusedPatient ? 'live' : 'idle'}</span>
                        </div>

                        <div className="patient-liquid-signal">
                            <CalendarClock className="h-4 w-4 text-[color:var(--mf-accent)]" />
                            <div>
                                <p className="text-sm font-semibold text-[color:var(--mf-ink)]">Ambito</p>
                                <p className="text-xs text-[color:var(--mf-muted)]">{workbenchScopeLabel}</p>
                            </div>
                            <span>{viewMode === 'active' ? 'attivi' : 'storico'}</span>
                        </div>
                    </div>

                    <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                        <Link
                            href={focusedPatient ? `/patients/${focusedPatient.id}` : '/patients/new'}
                            className="ui-btn-primary inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold"
                        >
                            {focusedPatient ? 'Apri scheda' : 'Nuovo caso'}
                            <ArrowUpRight className="h-4 w-4" />
                        </Link>
                        <Link
                            href={focusedPatient ? `/patients/${focusedPatient.id}/entries/new` : '/analytics'}
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:rgba(112,106,100,0.14)] bg-white/68 px-4 py-2.5 text-sm font-semibold text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(15,123,104,0.24)] hover:text-[color:var(--mf-primary)] dark:bg-white/6"
                        >
                            {focusedPatient ? 'Nuova voce clinica' : 'Board operativa'}
                            <HeartPulse className="h-4 w-4" />
                        </Link>
                    </div>
                </aside>
            </section>

            <div className="patient-workbench-shell grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_390px] xl:items-start">
                <section className="patient-inbox-pane rounded-[24px] border p-4">
                    <div className="patient-workbench-header mb-4 flex flex-col gap-3 border-b border-[color:rgba(112,106,100,0.12)] pb-4 lg:flex-row lg:items-end lg:justify-between">
                        <div className="space-y-1.5">
                            <p className="section-kicker">
                                Timeline pazienti
                            </p>
                            <h2 className="text-xl font-semibold tracking-tight text-[color:var(--mf-ink)]">
                                {currentAmbulatory?.name || 'Flusso clinico'}
                            </h2>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <Link
                                href="/analytics"
                                className="inline-flex items-center gap-2 rounded-full border border-[color:rgba(112,106,100,0.14)] bg-white/76 px-3.5 py-2 text-[12px] font-semibold text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(15,123,104,0.24)] hover:text-[color:var(--mf-primary)] dark:bg-white/6"
                            >
                                <Activity className="h-4 w-4" />
                                Board operativa
                            </Link>
                            <button
                                type="button"
                                onClick={() => notifyDbChange()}
                                className="inline-flex items-center gap-2 rounded-full border border-[color:rgba(112,106,100,0.14)] bg-white/76 px-3.5 py-2 text-[12px] font-semibold text-[color:var(--mf-muted)] transition-colors hover:text-[color:var(--mf-primary)] dark:bg-white/6"
                            >
                                <RotateCcw className="h-4 w-4" />
                                Aggiorna
                            </button>
                        </div>
                    </div>

                {patients && patients.length > 0 ? (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1">
                        <button
                            type="button"
                            onClick={handleSelectAll}
                            className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-primary)] hover:text-[color:rgba(15,123,104,0.8)]"
                        >
                            {selectedIds.size === patients.length ? 'Deseleziona tutto' : 'Seleziona tutto'}
                        </button>
                        <div className="text-[12px] font-medium text-[color:var(--mf-muted)]">
                            {patients.length} casi visibili
                        </div>
                    </div>
                ) : null}

                <div className="mt-4 space-y-4">
                    {selectionToolbar}

                    {patients && patients.length > 0 ? (
                        <PatientAgendaWorklist patients={patients} />
                    ) : null}

                    {isGlobalView ? (
                        patientGroups.length > 0 ? (
                            patientGroups.map((group) => (
                                <section key={group.ambulatory?.id || 'unassigned'} className="patient-inbox-section space-y-2">
                                    <div className="flex items-center justify-between px-1">
                                        <div className="flex items-center gap-2">
                                            <div className={`h-2 w-2 rounded-full ${group.color.dot}`} />
                                            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--mf-muted)]">
                                                {group.ambulatory?.name || 'Non assegnati'}
                                            </h2>
                                        </div>
                                        <span className="text-[11px] font-medium text-[color:var(--mf-muted)]">
                                            {group.patients.length} casi
                                        </span>
                                    </div>
                                    <div className="patient-liquid-stream-shell overflow-hidden rounded-[26px] border border-[color:rgba(112,106,100,0.1)] bg-[color:rgba(255,255,255,0.58)] p-2 dark:bg-white/4">
                                        {renderStream(
                                            group.patients,
                                            density === 'wide' ? group.ambulatory?.name ?? undefined : undefined,
                                        )}
                                    </div>
                                </section>
                            ))
                        ) : isFiltered ? (
                            <div className="rounded-[18px] border border-dashed border-[color:rgba(112,106,100,0.18)] px-4 py-10 text-center">
                                <Search className="mx-auto h-10 w-10 text-[color:rgba(112,106,100,0.34)]" />
                                <h3 className="mt-3 text-lg font-semibold text-[color:var(--mf-ink)]">Nessun caso trovato</h3>
                                <p className="mt-2 text-sm text-[color:var(--mf-muted)]">
                                    Filtri o ricerca attuali non producono risultati.
                                </p>
                                <button
                                    type="button"
                                    onClick={clearFilters}
                                    className="mt-5 inline-flex items-center gap-2 rounded-full border border-[color:rgba(112,106,100,0.14)] bg-white/84 px-3.5 py-2 text-[12px] font-semibold text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(15,123,104,0.24)] hover:text-[color:var(--mf-primary)] dark:bg-white/6"
                                >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    Cancella filtri
                                </button>
                            </div>
                        ) : (
                            <div className="rounded-[18px] border border-dashed border-[color:rgba(112,106,100,0.18)] px-4 py-10 text-center">
                                <UserPlus className="mx-auto h-10 w-10 text-[color:rgba(112,106,100,0.34)]" />
                                <h3 className="mt-3 text-lg font-semibold text-[color:var(--mf-ink)]">Nessun paziente</h3>
                                <p className="mt-2 text-sm text-[color:var(--mf-muted)]">
                                    Aggiungi il primo caso per iniziare a costruire la cartella.
                                </p>
                                <Link
                                    href="/patients/new"
                                    className="mt-5 inline-flex items-center justify-center gap-2 rounded-[12px] bg-[color:var(--mf-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[color:rgba(15,123,104,0.88)]"
                                >
                                    <UserPlus className="h-4 w-4" />
                                    Aggiungi primo paziente
                                </Link>
                            </div>
                        )
                    ) : patients && patients.length > 0 ? (
                        <section className="patient-inbox-section space-y-2">
                            <div className="flex items-center justify-between px-1">
                                <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--mf-muted)]">
                                    Lista pazienti
                                </h2>
                                <span className="text-[11px] font-medium text-[color:var(--mf-muted)]">
                                    {patients.length} casi
                                </span>
                            </div>
                            <div className="patient-liquid-stream-shell overflow-hidden rounded-[26px] border border-[color:rgba(112,106,100,0.1)] bg-[color:rgba(255,255,255,0.58)] p-2 dark:bg-white/4">
                                {renderStream(patients, currentAmbulatory?.name)}
                            </div>
                        </section>
                    ) : isFiltered ? (
                        <div className="rounded-[18px] border border-dashed border-[color:rgba(112,106,100,0.18)] px-4 py-10 text-center">
                            <Search className="mx-auto h-10 w-10 text-[color:rgba(112,106,100,0.34)]" />
                            <h3 className="mt-3 text-lg font-semibold text-[color:var(--mf-ink)]">Nessun caso trovato</h3>
                            <p className="mt-2 text-sm text-[color:var(--mf-muted)]">
                                Filtri o ricerca attuali non producono risultati.
                            </p>
                            <button
                                type="button"
                                onClick={clearFilters}
                                className="mt-5 inline-flex items-center gap-2 rounded-full border border-[color:rgba(112,106,100,0.14)] bg-white/84 px-3.5 py-2 text-[12px] font-semibold text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(15,123,104,0.24)] hover:text-[color:var(--mf-primary)] dark:bg-white/6"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Cancella filtri
                            </button>
                        </div>
                    ) : (
                        <div className="rounded-[18px] border border-dashed border-[color:rgba(112,106,100,0.18)] px-4 py-10 text-center">
                            <UserPlus className="mx-auto h-10 w-10 text-[color:rgba(112,106,100,0.34)]" />
                            <h3 className="mt-3 text-lg font-semibold text-[color:var(--mf-ink)]">Nessun paziente</h3>
                            <p className="mt-2 text-sm text-[color:var(--mf-muted)]">
                                Aggiungi il primo caso in questo ambulatorio per iniziare.
                            </p>
                            <Link
                                href="/patients/new"
                                className="mt-5 inline-flex items-center justify-center gap-2 rounded-[12px] bg-[color:var(--mf-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[color:rgba(15,123,104,0.88)]"
                            >
                                <UserPlus className="h-4 w-4" />
                                Aggiungi primo paziente
                            </Link>
                        </div>
                    )}
                </div>
                </section>

                <CaseLensPanel variant="reader" patient={focusedPatient} ambulatoryName={focusedAmbulatoryName} />
            </div>
        </div>
    );

    return (
        <>
            {showMoveModal ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-[30px] border border-[color:var(--glass-border)] bg-[color:var(--mf-bg-elevated)] p-6 shadow-[0_26px_60px_rgba(35,27,22,0.16)] dark:bg-[color:rgba(28,23,27,0.95)]">
                        <h3 className="text-lg font-semibold text-[color:var(--mf-ink)]">Sposta casi</h3>
                        <p className="mt-2 text-sm leading-6 text-[color:var(--mf-muted)]">
                            Seleziona il contenitore clinico di destinazione per <strong>{selectedIds.size}</strong> pazienti.
                        </p>
                        <div className="mt-5 max-h-60 space-y-3 overflow-y-auto pr-1">
                            {ambulatories?.map((ambulatory) => (
                                <label
                                    key={ambulatory.id}
                                    className={`flex cursor-pointer items-center gap-3 rounded-[22px] border px-3 py-3 transition-colors ${
                                        targetAmbulatory === ambulatory.id
                                            ? 'border-[color:rgba(15,123,104,0.28)] bg-[color:rgba(15,123,104,0.08)]'
                                            : 'border-[color:rgba(112,106,100,0.14)] bg-white/72 hover:bg-white/90 dark:bg-white/6'
                                    }`}
                                >
                                    <input
                                        type="radio"
                                        name="targetAmb"
                                        value={ambulatory.id}
                                        checked={targetAmbulatory === ambulatory.id}
                                        onChange={(event) => setTargetAmbulatory(event.target.value)}
                                        className="h-4 w-4 text-[color:var(--mf-primary)]"
                                    />
                                    <div className={`h-3 w-3 rounded-full ${getAmbulatoryColor(ambulatory.id).dot}`} />
                                    <div className="flex-1">
                                        <div className="flex items-center">
                                            <p className="text-sm font-semibold text-[color:var(--mf-ink)]">{ambulatory.name}</p>
                                            {ambulatory.type === 'test' ? (
                                                <span className="ml-2 rounded-full bg-[color:rgba(197,138,47,0.12)] px-2 py-0.5 text-[10px] font-bold text-[color:var(--mf-warning)]">
                                                    Test
                                                </span>
                                            ) : null}
                                        </div>
                                        <p className="text-xs text-[color:var(--mf-muted)]">{ambulatory.address || 'Nessun indirizzo'}</p>
                                    </div>
                                </label>
                            ))}
                        </div>
                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setShowMoveModal(false)}
                                className="rounded-full px-4 py-2 text-sm font-medium text-[color:var(--mf-muted)]"
                            >
                                Annulla
                            </button>
                            <button
                                type="button"
                                onClick={handleMove}
                                disabled={!targetAmbulatory || isMoving}
                                className="ui-btn-primary px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
                            >
                                {isMoving ? 'Spostamento...' : 'Conferma'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
            {workbenchContent}
        </>
    );
}
