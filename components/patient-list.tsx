'use client';

import { useLiveQuery } from '@/lib/live-query';
import { db, Ambulatory, Patient } from '@/lib/db';
import { Search, UserPlus, Archive, Copy, Scissors, Activity, RefreshCw, Users, Building2 } from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { estimateBirthYearFromTaxCode, calculateAge } from '@/lib/utils';
import PrivacyBlur from '@/components/privacy-blur';
import { usePatientClipboard } from '@/hooks/use-patient-clipboard';
import { notifyDbChange } from '@/lib/live-query';

function useCookie(name: string) {
    const [value, setValue] = useState<string | null>(null);
    useEffect(() => {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        if (match && match[2] !== value) setValue(match[2]);
    }, [name, value]);
    return value;
}

const AMBULATORY_COLORS = [
    { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', dark: 'dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300', dot: 'bg-blue-500' },
    { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dark: 'dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300', dot: 'bg-emerald-500' },
    { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', dark: 'dark:bg-violet-900/20 dark:border-violet-800 dark:text-violet-300', dot: 'bg-violet-500' },
    { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dark: 'dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300', dot: 'bg-amber-500' },
    { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', dark: 'dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300', dot: 'bg-rose-500' },
    { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', dark: 'dark:bg-cyan-900/20 dark:border-cyan-800 dark:text-cyan-300', dot: 'bg-cyan-500' },
    { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dark: 'dark:bg-orange-900/20 dark:border-orange-800 dark:text-orange-300', dot: 'bg-orange-500' },
    { bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', text: 'text-fuchsia-700', dark: 'dark:bg-fuchsia-900/20 dark:border-fuchsia-800 dark:text-fuchsia-300', dot: 'bg-fuchsia-500' },
];

function getAmbulatoryColor(id: string): typeof AMBULATORY_COLORS[0] {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = ((hash << 5) - hash) + id.charCodeAt(i);
        hash |= 0;
    }
    return AMBULATORY_COLORS[Math.abs(hash) % AMBULATORY_COLORS.length];
}

function getPatientAgeLabel(patient: Patient): string {
    const estimatedYear = estimateBirthYearFromTaxCode(patient.taxCode);
    const finalAge = patient.birthDate && !isNaN(new Date(patient.birthDate).getTime())
        ? new Date().getFullYear() - new Date(patient.birthDate).getFullYear()
        : (estimatedYear ? calculateAge(estimatedYear) : null);
    return finalAge !== null ? `${finalAge} anni` : 'Età n/d';
}

function getPatientStatusPresentation(patient: Patient) {
    if (patient.isArchived) {
        return {
            label: 'Archiviato',
            classes: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-900/10 dark:text-amber-300',
        };
    }

    if (patient.isAdi) {
        return {
            label: 'ADI attiva',
            classes: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-900/10 dark:text-emerald-300',
        };
    }

    return {
        label: 'Ambulatoriale',
        classes: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300',
    };
}

interface PatientGroup {
    ambulatory: Ambulatory | null;
    patients: Patient[];
    color: typeof AMBULATORY_COLORS[0];
}

export default function PatientList() {
    const [viewMode, setViewMode] = useState<'active' | 'archived'>('active');
    const [search, setSearch] = useState('');
    /* @Codex */
    const [sortMode, setSortMode] = useState<'alpha' | 'recent'>('recent');

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isMoving, setIsMoving] = useState(false);
    const [targetAmbulatory, setTargetAmbulatory] = useState<string>('');
    const [showMoveModal, setShowMoveModal] = useState(false);
    const { copy, cut, paste, clipboard } = usePatientClipboard();
    const currentAmbulatoryId = useCookie('ambulatory_id');

    const ambulatories = useLiveQuery(() => db.ambulatories.toArray());

    /* @Codex */
    const sortPatients = (items: Patient[]) => {
        const sorted = [...items];
        if (sortMode === 'alpha') {
            sorted.sort((a, b) => {
                const last = a.lastName.localeCompare(b.lastName);
                if (last !== 0) return last;
                return a.firstName.localeCompare(b.firstName);
            });
            return sorted;
        }
        sorted.sort((a, b) => {
            const aTime = (a.updatedAt || a.createdAt) ? new Date(a.updatedAt || a.createdAt).getTime() : 0;
            const bTime = (b.updatedAt || b.createdAt) ? new Date(b.updatedAt || b.createdAt).getTime() : 0;
            return bTime - aTime;
        });
        return sorted;
    };

    const patients = useLiveQuery(
        async () => {
            let collection = db.patients.orderBy('lastName');

            if (viewMode === 'active') {
                collection = collection.filter((p) => !p.isArchived);
            } else {
                collection = collection.filter((p) => !!p.isArchived);
            }

            if (search) {
                const terms = search.toLowerCase().trim().split(/\s+/);
                const results = await collection.filter((p) => {
                    const searchableText = `${p.lastName} ${p.firstName} ${p.taxCode || ''}`.toLowerCase();
                    return terms.every((term) => searchableText.includes(term));
                }).toArray();
                return sortPatients(results);
            }

            const results = await collection.toArray();
            return sortPatients(results);
        },
        [search, viewMode, currentAmbulatoryId, sortMode]
    );

    const patientGroups = useMemo<PatientGroup[]>(() => {
        if (!patients || !ambulatories || currentAmbulatoryId) return [];

        const groups = new Map<string, Patient[]>();
        const unassigned: Patient[] = [];

        patients.forEach((p) => {
            if (p.ambulatoryId) {
                const existing = groups.get(p.ambulatoryId) || [];
                existing.push(p);
                groups.set(p.ambulatoryId, existing);
            } else {
                unassigned.push(p);
            }
        });

        const result: PatientGroup[] = [];

        const sortedAmbs = [...ambulatories].sort((a, b) => {
            if (!a.parentId && b.parentId) return -1;
            if (a.parentId && !b.parentId) return 1;
            return a.name.localeCompare(b.name);
        });

        sortedAmbs.forEach((amb) => {
            const patientsInAmb = groups.get(amb.id);
            if (patientsInAmb && patientsInAmb.length > 0) {
                result.push({
                    ambulatory: amb,
                    patients: patientsInAmb,
                    color: getAmbulatoryColor(amb.id),
                });
            }
        });

        if (unassigned.length > 0) {
            result.push({
                ambulatory: null,
                patients: unassigned,
                color: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', dark: 'dark:bg-gray-900/20 dark:border-gray-800 dark:text-gray-300', dot: 'bg-gray-400' },
            });
        }

        return result;
    }, [patients, ambulatories, currentAmbulatoryId]);

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const handleSelectAll = useCallback(() => {
        if (!patients) return;
        if (selectedIds.size === patients.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(patients.map((p) => p.id)));
        }
    }, [patients, selectedIds]);

    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

            const isCtrl = e.metaKey || e.ctrlKey;

            if (isCtrl && e.key === 'a') {
                e.preventDefault();
                handleSelectAll();
            }

            if (isCtrl && e.key === 'c') {
                e.preventDefault();
                if (selectedIds.size > 0 && currentAmbulatoryId) {
                    copy(Array.from(selectedIds), currentAmbulatoryId);
                }
            }

            if (isCtrl && e.key === 'x') {
                e.preventDefault();
                if (selectedIds.size > 0 && currentAmbulatoryId) {
                    cut(Array.from(selectedIds), currentAmbulatoryId);
                }
            }

            if (isCtrl && e.key === 'v') {
                e.preventDefault();
                if (clipboard.patientIds.length > 0 && currentAmbulatoryId) {
                    const isTest = ambulatories?.find((a) => a.id === currentAmbulatoryId)?.type === 'test';
                    const opName = clipboard.operation === 'copy' ? 'Copia' : 'Sposta';
                    if (confirm(`${opName} di ${clipboard.patientIds.length} pazienti qui?`)) {
                        const success = await paste(currentAmbulatoryId, !!isTest);
                        if (success) {
                            if (clipboard.operation === 'cut') setSelectedIds(new Set());
                            notifyDbChange();
                        }
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedIds, currentAmbulatoryId, clipboard, copy, cut, paste, ambulatories, handleSelectAll]);

    const handleMove = async () => {
        if (!targetAmbulatory) return;
        setIsMoving(true);
        try {
            const res = await fetch('/api/patients/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patientIds: Array.from(selectedIds),
                    targetAmbulatoryId: targetAmbulatory,
                    /* @Codex */
                    sourceAmbulatoryId: currentAmbulatoryId,
                }),
            });

            if (!res.ok) throw new Error("Move failed");

            setSelectedIds(new Set());
            setShowMoveModal(false);
            setTargetAmbulatory('');
            notifyDbChange();
        } catch (error) {
            console.error(error);
            alert("Errore durante lo spostamento");
        } finally {
            setIsMoving(false);
        }
    };

    const renderPatientRow = (patient: Patient, color?: typeof AMBULATORY_COLORS[0]) => {
        const status = getPatientStatusPresentation(patient);
        const selectionVisible = selectedIds.size > 0 || selectedIds.has(patient.id);

        return (
            <div
                key={patient.id}
                className={`group rounded-[26px] border px-3.5 py-3.5 backdrop-blur-xl transition-all ${
                    selectedIds.has(patient.id)
                        ? 'border-sky-300 bg-[linear-gradient(135deg,rgba(224,242,255,0.92),rgba(245,250,255,0.82))] ring-2 ring-sky-500/15 shadow-[0_18px_36px_rgba(14,116,217,0.10)] dark:border-sky-500/30 dark:bg-sky-900/10'
                        : 'border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(248,250,255,0.7))] shadow-[0_14px_30px_rgba(15,23,42,0.05)] hover:border-white hover:shadow-[0_18px_38px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20'
                }`}
            >
                <div className="flex items-center gap-3">
                    <div className={`shrink-0 transition-opacity ${selectionVisible ? 'opacity-100' : 'opacity-60 md:opacity-0 md:group-hover:opacity-100'}`}>
                        <input
                            type="checkbox"
                            checked={selectedIds.has(patient.id)}
                            onChange={() => toggleSelection(patient.id)}
                            aria-label={`Seleziona paziente ${patient.firstName || ''} ${patient.lastName || patient.id}`}
                            className="h-4.5 w-4.5 cursor-pointer rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                        />
                    </div>

                    <Link href={`/patients/${patient.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <div
                                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] text-sm font-semibold shadow-[0_12px_24px_rgba(15,23,42,0.12)] ${
                                    patient.isArchived
                                        ? 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300'
                                        : color
                                            ? `${color.bg} ${color.text} ${color.dark}`
                                            : 'bg-sky-100 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
                                }`}
                            >
                                {patient.firstName[0]}{patient.lastName[0]}
                            </div>

                            <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
                                    <p className="truncate text-base font-semibold text-slate-900 dark:text-white">
                                        <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                                    </p>
                                </div>
                                <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                                    <PrivacyBlur intensity="sm">{patient.taxCode}</PrivacyBlur>
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 md:hidden">
                                    <span className="apple-chip py-1">{getPatientAgeLabel(patient)}</span>
                                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${status.classes}`}>
                                        {status.label}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="hidden items-center gap-3 md:flex">
                            <div className="text-right">
                                <p className="section-kicker">Età</p>
                                <p className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {getPatientAgeLabel(patient)}
                                </p>
                            </div>
                            <span className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium ${status.classes}`}>
                                {status.label}
                            </span>
                        </div>
                    </Link>
                </div>
            </div>
        );
    };

    const isGlobalView = !currentAmbulatoryId;
    const currentAmbulatory = currentAmbulatoryId ? ambulatories?.find((a) => a.id === currentAmbulatoryId) : null;

    return (
        <div className="space-y-6">
            <div className="glass-panel liquid-hero p-6 md:p-7">
                <div className="liquid-orb -left-8 top-0 h-28 w-28 bg-sky-300/35" />
                <div className="liquid-orb right-0 top-4 h-24 w-24 bg-rose-300/30" />
                <div className="liquid-orb bottom-0 left-1/3 h-20 w-20 bg-emerald-200/20" />
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="relative z-10 space-y-3">
                        <div className="flex items-center gap-2">
                            {currentAmbulatoryId && (
                                <div className={`h-3 w-3 rounded-full ${getAmbulatoryColor(currentAmbulatoryId).dot}`} />
                            )}
                            <p className="section-kicker">
                                {isGlobalView ? 'Vista cumulativa' : 'Ambulatorio attivo'}
                            </p>
                        </div>

                        <div>
                            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white md:text-4xl">
                                {currentAmbulatory?.name || (isGlobalView ? 'Pazienti' : 'Caricamento...')}
                            </h1>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                                {isGlobalView ? (
                                    <>
                                        {patientGroups.length} gruppi attivi, {patients?.length || 0} pazienti visibili. Una lettura piu densa, piu morbida e meno “a scatole”.
                                    </>
                                ) : currentAmbulatory?.parentId ? (
                                    <>
                                        {ambulatories?.find((a) => a.id === currentAmbulatory.parentId)?.name} / {currentAmbulatory.name}
                                    </>
                                ) : (
                                    'Schede paziente organizzate per lavoro quotidiano, con ricerca e operazioni rapide.'
                                )}
                            </p>
                        </div>
                    </div>

                    <div className="relative z-10 flex flex-wrap items-center gap-2">
                        <Link
                            href="/analytics"
                            className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/76 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.06)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-white hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-white/20"
                        >
                            <Activity className="h-4 w-4 text-slate-400" />
                            Statistiche
                        </Link>
                        <button
                            onClick={() => window.location.reload()}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-white/76 text-slate-500 shadow-[0_12px_28px_rgba(15,23,42,0.06)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-white hover:bg-white/90 hover:text-sky-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/20 dark:hover:text-sky-300"
                            title="Aggiorna lista"
                        >
                            <RefreshCw className="h-4 w-4" />
                        </button>
                        <Link
                            href="/patients/new"
                            className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#0A84FF,#5AC8FA)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_18px_34px_rgba(10,132,255,0.28)] transition-all hover:-translate-y-0.5 hover:shadow-[0_22px_40px_rgba(10,132,255,0.34)]"
                        >
                            <UserPlus className="h-4 w-4" />
                            Nuovo paziente
                        </Link>
                    </div>
                </div>

                <div className="relative z-10 mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="relative group">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <Search className="h-5 w-5 text-slate-400 transition-colors group-focus-within:text-sky-500" />
                        </div>
                        <input
                            type="text"
                            className="block w-full rounded-full border border-white/70 bg-white/76 py-3.5 pl-10 pr-4 text-slate-800 shadow-[0_12px_28px_rgba(15,23,42,0.06)] outline-none backdrop-blur-md transition-all placeholder:text-slate-400 focus:border-white focus:ring-2 focus:ring-sky-500/20 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-500/30"
                            placeholder="Cerca per nome, cognome o codice fiscale..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="section-kicker">Ordina</span>
                        <button
                            onClick={() => setSortMode('recent')}
                            className={`rounded-full px-3.5 py-2 text-xs font-medium transition-all ${
                                sortMode === 'recent'
                                    ? 'bg-sky-100/90 text-sky-700 shadow-[0_10px_22px_rgba(14,116,217,0.10)] dark:bg-sky-900/20 dark:text-sky-300'
                                    : 'bg-white/72 text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.04)] hover:bg-white/90 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
                            }`}
                        >
                            Recenti
                        </button>
                        <button
                            onClick={() => setSortMode('alpha')}
                            className={`rounded-full px-3.5 py-2 text-xs font-medium transition-all ${
                                sortMode === 'alpha'
                                    ? 'bg-sky-100/90 text-sky-700 shadow-[0_10px_22px_rgba(14,116,217,0.10)] dark:bg-sky-900/20 dark:text-sky-300'
                                    : 'bg-white/72 text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.04)] hover:bg-white/90 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
                            }`}
                        >
                            A-Z
                        </button>
                    </div>
                </div>

                <div className="relative z-10 mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                        {selectedIds.size > 0 ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-sky-200/80 bg-[linear-gradient(135deg,rgba(224,242,255,0.92),rgba(244,249,255,0.82))] px-4 py-3 text-sm text-sky-700 shadow-[0_14px_30px_rgba(14,116,217,0.10)] dark:border-sky-500/20 dark:bg-sky-900/10 dark:text-sky-300">
                                <span className="font-semibold">{selectedIds.size} selezionati</span>
                                <button onClick={() => setShowMoveModal(true)} className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-sky-700 hover:bg-white dark:bg-white/10 dark:text-sky-200 dark:hover:bg-white/15">
                                    Sposta
                                </button>
                                <button
                                    onClick={() => currentAmbulatoryId && copy(Array.from(selectedIds), currentAmbulatoryId)}
                                    className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-sky-700 hover:bg-white dark:bg-white/10 dark:text-sky-200 dark:hover:bg-white/15"
                                    title="Copia (Ctrl+C)"
                                >
                                    <Copy className="h-3 w-3" />
                                    Copia
                                </button>
                                <button
                                    onClick={() => currentAmbulatoryId && cut(Array.from(selectedIds), currentAmbulatoryId)}
                                    className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-sky-700 hover:bg-white dark:bg-white/10 dark:text-sky-200 dark:hover:bg-white/15"
                                    title="Taglia (Ctrl+X)"
                                >
                                    <Scissors className="h-3 w-3" />
                                    Taglia
                                </button>
                                <button onClick={() => setSelectedIds(new Set())} className="text-xs text-sky-500 hover:text-sky-700 dark:text-sky-300 dark:hover:text-white">
                                    Annulla
                                </button>
                            </div>
                        ) : (
                            <>
                                <button
                                    onClick={() => setViewMode('active')}
                                    className={`rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
                                        viewMode === 'active'
                                            ? 'bg-sky-100/90 text-sky-700 shadow-[0_12px_24px_rgba(14,116,217,0.10)] dark:bg-sky-900/20 dark:text-sky-300'
                                            : 'bg-white/72 text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.04)] hover:bg-white/90 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
                                    }`}
                                >
                                    Attivi
                                </button>
                                <button
                                    onClick={() => setViewMode('archived')}
                                    className={`rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
                                        viewMode === 'archived'
                                            ? 'bg-amber-100/90 text-amber-700 shadow-[0_12px_24px_rgba(217,119,6,0.10)] dark:bg-amber-900/20 dark:text-amber-300'
                                            : 'bg-white/72 text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.04)] hover:bg-white/90 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
                                    }`}
                                >
                                    Archiviati
                                </button>
                            </>
                        )}
                    </div>

                    {patients && patients.length > 0 && (
                        <button
                            onClick={handleSelectAll}
                            className="self-start rounded-full border border-white/70 bg-white/76 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-[0_12px_26px_rgba(15,23,42,0.05)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-white hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-white/20"
                        >
                            {selectedIds.size === patients.length ? 'Deseleziona tutto' : 'Seleziona tutto'}
                        </button>
                    )}
                </div>
            </div>

            {showMoveModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-[#161b22]">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Sposta pazienti</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                            Seleziona l&apos;ambulatorio di destinazione per <strong>{selectedIds.size}</strong> pazienti.
                        </p>
                        <div className="mt-5 max-h-60 space-y-3 overflow-y-auto">
                            {ambulatories?.map((amb) => (
                                <label
                                    key={amb.id}
                                    className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 px-3 py-3 transition-colors hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"
                                >
                                    <input
                                        type="radio"
                                        name="targetAmb"
                                        value={amb.id}
                                        checked={targetAmbulatory === amb.id}
                                        onChange={(e) => setTargetAmbulatory(e.target.value)}
                                        className="h-4 w-4 text-sky-600"
                                    />
                                    <div className={`h-3 w-3 rounded-full ${getAmbulatoryColor(amb.id).dot}`} />
                                    <div>
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{amb.name}</p>
                                        <div className="flex items-center gap-2">
                                            {amb.type === 'test' && (
                                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                                                    Test
                                                </span>
                                            )}
                                            <p className="text-xs text-slate-500 dark:text-slate-400">{amb.address || 'Nessun indirizzo'}</p>
                                        </div>
                                    </div>
                                </label>
                            ))}
                        </div>
                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                onClick={() => setShowMoveModal(false)}
                                disabled={isMoving}
                                className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleMove}
                                disabled={!targetAmbulatory || isMoving}
                                className="rounded-2xl bg-[#0A84FF] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0077ED] disabled:opacity-50"
                            >
                                {isMoving ? 'Spostamento...' : 'Conferma'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isGlobalView ? (
                patientGroups.length > 0 ? (
                    <div className="space-y-4">
                        {patientGroups.map((group) => (
                            <div key={group.ambulatory?.id || 'unassigned'} className="glass-panel p-5 md:p-6">
                                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`h-3 w-3 rounded-full shadow-[0_0_0_6px_rgba(255,255,255,0.45)] ${group.color.dot}`} />
                                        <div>
                                            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                                                {group.ambulatory?.name || 'Non assegnati'}
                                            </h2>
                                            {group.ambulatory?.parentId && (
                                                <p className="text-xs text-slate-500 dark:text-slate-400">Sotto-ambulatorio</p>
                                            )}
                                        </div>
                                    </div>
                                    <span className="apple-chip">
                                        <Users className="h-3.5 w-3.5" />
                                        {group.patients.length} pazienti
                                    </span>
                                </div>

                                <div className="space-y-3">
                                    {group.patients.map((patient) => renderPatientRow(patient, group.color))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="glass-panel p-8 text-center">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500">
                            <Building2 className="h-8 w-8" />
                        </div>
                        <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">Nessun paziente visibile</h3>
                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                            Aggiungi pazienti o seleziona un ambulatorio specifico dalla sidebar.
                        </p>
                    </div>
                )
            ) : (
                <div className="glass-panel p-5 md:p-6">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                            <p className="section-kicker">Vista elenco</p>
                            <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                                {patients?.length || 0} pazienti
                            </h2>
                        </div>
                        {currentAmbulatory && (
                            <span className="apple-chip">
                                <Building2 className="h-3.5 w-3.5" />
                                {currentAmbulatory.name}
                            </span>
                        )}
                    </div>

                    {patients && patients.length > 0 ? (
                        <div className="space-y-3">
                            {patients.map((patient) => renderPatientRow(patient))}
                        </div>
                    ) : (
                        <div className="py-12 text-center">
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500">
                                {viewMode === 'active' ? <UserPlus className="h-8 w-8" /> : <Archive className="h-8 w-8" />}
                            </div>
                            <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">
                                {viewMode === 'active' ? 'Nessun paziente attivo' : 'Nessun paziente in archivio'}
                            </h3>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                {viewMode === 'active'
                                    ? 'Aggiungi un nuovo paziente o sposta qui schede gia esistenti.'
                                    : 'Le schede archiviate compariranno qui quando necessario.'}
                            </p>
                            {viewMode === 'active' && (
                                <Link
                                    href="/patients/new"
                                    className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[#0A84FF] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0077ED]"
                                >
                                    <UserPlus className="h-4 w-4" />
                                    Aggiungi primo paziente
                                </Link>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
