'use client';

import { useLiveQuery } from '@/lib/live-query';
import { db, Ambulatory, Patient } from '@/lib/db';
import { 
    Search, UserPlus, Activity, Building2,
    Copy, Scissors, RotateCcw, Layout, Maximize2
} from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { estimateBirthYearFromTaxCode, calculateAge } from '@/lib/utils';
import PrivacyBlur from '@/components/privacy-blur';
import { usePatientClipboard } from '@/hooks/use-patient-clipboard';
import { notifyDbChange } from '@/lib/live-query';
import { useUIStyle } from '@/components/ui-style-provider';

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
    const [density, setDensity] = useState<'compact' | 'wide'>('compact');

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isMoving, setIsMoving] = useState(false);
    const [targetAmbulatory, setTargetAmbulatory] = useState<string>('');
    const [showMoveModal, setShowMoveModal] = useState(false);
    const { copy, cut, paste, clipboard } = usePatientClipboard();
    const { uiStyleMode } = useUIStyle();
    const isLiquid = uiStyleMode === 'liquid';
    const currentAmbulatoryId = useCookie('ambulatory_id');
    const isGlobalView = !currentAmbulatoryId;

    const ambulatories = useLiveQuery(() => db.ambulatories.toArray());

    /* @Codex */
    const sortPatients = (items: Patient[]) => {
        const sorted = [...items];
        if (sortMode === 'alpha') {
            sorted.sort((a, b) => {
                const last = (a.lastName || '').localeCompare(b.lastName || '');
                if (last !== 0) return last;
                return (a.firstName || '').localeCompare(b.firstName || '');
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

    const renderPatientItem = (patient: Patient, color?: typeof AMBULATORY_COLORS[0]) => {
        const status = getPatientStatusPresentation(patient);
        const isSelected = selectedIds.has(patient.id);
        const selectionVisible = selectedIds.size > 0 || isSelected;
        const isWide = isGlobalView && density === 'wide';

        return (
            <div
                key={patient.id}
                className={`group relative flex items-center gap-3 transition-all duration-200 ${
                    isWide ? 'px-5 py-4' : 'px-3 py-1.5'
                } ${
                    isLiquid
                        ? isSelected
                            ? 'rounded-[18px] border border-sky-300/60 bg-white/82 shadow-[0_14px_28px_rgba(15,23,42,0.08)] ring-1 ring-sky-400/20 dark:border-sky-400/30 dark:bg-white/10'
                            : 'rounded-[18px] border border-transparent bg-transparent hover:-translate-y-0.5 hover:border-white/60 hover:bg-white/55 hover:shadow-[0_12px_26px_rgba(15,23,42,0.07)] dark:hover:border-white/10 dark:hover:bg-white/8'
                        : isSelected
                            ? 'bg-sky-50/90 dark:bg-sky-500/15'
                            : 'hover:bg-slate-50/80 dark:hover:bg-white/5'
                }`}
            >
                {isSelected && !isLiquid && (
                    <div className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-sky-500 dark:bg-sky-400" />
                )}
                <div className={`shrink-0 transition-opacity ${selectionVisible ? 'opacity-100' : 'opacity-40 md:opacity-0 md:group-hover:opacity-100'}`}>
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelection(patient.id)}
                        aria-label={`Seleziona paziente ${patient.firstName || ''} ${patient.lastName || patient.id}`}
                        className="h-4 w-4 cursor-pointer rounded border-slate-300 text-sky-600"
                    />
                </div>

                <Link href={`/patients/${patient.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-4">
                        <div
                            className={`flex shrink-0 items-center justify-center rounded-xl font-bold shadow-sm transition-all duration-300 ${
                                isWide ? 'h-11 w-11 text-xs' : 'h-8 w-8 text-[10px]'
                            } ${
                                patient.isArchived
                                    ? 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300'
                                    : color
                                        ? `${color.bg} ${color.text} ${color.dark}`
                                        : 'bg-sky-100 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
                            }`}
                        >
                            {patient.firstName?.[0]}{patient.lastName?.[0]}
                        </div>
                        <div className="min-w-0 space-y-0.5">
                            <p className={`truncate font-bold text-slate-900 dark:text-white transition-all duration-300 ${
                                isWide ? 'text-base' : 'text-sm'
                            }`}>
                                <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                            </p>
                            <p className={`truncate font-mono tracking-tight text-slate-500 transition-all duration-300 ${
                                isWide ? 'text-[12px]' : 'text-[10px]'
                            }`}>
                                <PrivacyBlur intensity="sm">{patient.taxCode}</PrivacyBlur>
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="hidden md:block text-right">
                            <p className={`font-medium text-slate-700 dark:text-slate-300 transition-all duration-300 ${
                                isWide ? 'text-sm' : 'text-[12px]'
                            }`}>
                                {getPatientAgeLabel(patient)}
                            </p>
                        </div>
                        <span className={`inline-flex items-center rounded-full border font-semibold transition-all duration-300 ${
                            isWide ? 'px-3 py-1 text-[11px]' : 'px-2 py-0.5 text-[10px]'
                        } ${status.classes}`}>
                            {status.label}
                        </span>
                    </div>
                </Link>
            </div>
        );
    };

    const currentAmbulatory = currentAmbulatoryId ? ambulatories?.find((a) => a.id === currentAmbulatoryId) : null;

    return (
        <div className="space-y-6">
            <div className={`glass-panel liquid-hero px-6 py-5 md:px-7 md:py-6 ${isLiquid ? '' : 'border-black/5 bg-white/80 shadow-[0_20px_44px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/8'}`}>
                <div className="liquid-orb -left-8 top-0 h-28 w-28 bg-sky-300/20" />
                <div className="liquid-orb right-0 top-4 h-24 w-24 bg-rose-300/15" />
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="relative z-10 space-y-1">
                        <div className="flex items-center gap-2">
                            {currentAmbulatoryId && (
                                <div className={`h-2.5 w-2.5 rounded-full ${getAmbulatoryColor(currentAmbulatoryId).dot}`} />
                            )}
                            <p className="section-kicker">
                                {isGlobalView ? 'Vista cumulativa' : 'Ambulatorio'}
                            </p>
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white md:text-3xl">
                                {currentAmbulatory?.name || (isGlobalView ? 'Pazienti' : 'Caricamento...')}
                            </h1>
                            <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
                                {isGlobalView ? (
                                    <>{patients?.length || 0} pazienti totali in {patientGroups.length} gruppi.</>
                                ) : (
                                    'Gestione rapida delle schede cliniche e del diario.'
                                )}
                            </p>
                        </div>
                    </div>

                    <div className="relative z-10 flex flex-wrap items-center gap-2">
                        <Link
                            href="/analytics"
                            className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-[13px] font-medium text-slate-700 transition-all dark:text-slate-200 ${
                                isLiquid
                                    ? 'rounded-full border border-white/60 bg-white/40 backdrop-blur-md hover:bg-white/80 dark:border-white/10 dark:bg-white/5'
                                    : 'rounded-2xl border border-slate-200/80 bg-white/92 shadow-sm hover:bg-white dark:border-white/10 dark:bg-white/8'
                            }`}
                        >
                            <Activity className="h-3.5 w-3.5" />
                            Statistiche
                        </Link>
                        <Link
                            href="/patients/new"
                            className={`ui-btn-primary px-4 py-1.5 text-[13px] font-bold ${isLiquid ? '' : 'rounded-2xl'}`}
                        >
                            <UserPlus className="h-3.5 w-3.5" />
                            Nuovo
                        </Link>
                    </div>
                </div>

                <div className="relative z-10 mt-5 grid gap-3 lg:grid-cols-[1fr_auto]">
                    <div className="relative group">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <Search className="h-4 w-4 text-slate-400" />
                        </div>
                        <input
                            type="text"
                            className="block w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-[14px] shadow-sm outline-none transition-all placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10 dark:border-white/10 dark:bg-white/5"
                            placeholder="Cerca paziente..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center gap-1.5 bg-slate-100/50 p-1 rounded-xl dark:bg-white/5">
                        <div className="flex border-r border-slate-200 pr-1.5 mr-1.5 dark:border-white/10">
                            <button
                                onClick={() => setViewMode('active')}
                                className={`rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all ${viewMode === 'active' ? 'bg-white shadow-sm text-sky-600 dark:bg-white/10' : 'text-slate-500 hover:text-slate-600'}`}
                            >
                                Attivi
                            </button>
                            <button
                                onClick={() => setViewMode('archived')}
                                className={`rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all ${viewMode === 'archived' ? 'bg-white shadow-sm text-amber-600 dark:bg-white/10' : 'text-slate-500 hover:text-slate-600'}`}
                            >
                                Archiviati
                            </button>
                        </div>
                        {isGlobalView && (
                            <div className="flex border-r border-slate-200 pr-1.5 mr-1.5 dark:border-white/10">
                                <button
                                    onClick={() => setDensity('compact')}
                                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all ${density === 'compact' ? 'bg-white shadow-sm text-sky-600 dark:bg-white/10' : 'text-slate-500 hover:text-slate-600'}`}
                                    title="Vista Compatta"
                                >
                                    <Layout className="h-3.5 w-3.5" />
                                    Compatta
                                </button>
                                <button
                                    onClick={() => setDensity('wide')}
                                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all ${density === 'wide' ? 'bg-white shadow-sm text-sky-600 dark:bg-white/10' : 'text-slate-500 hover:text-slate-600'}`}
                                    title="Vista Ampia"
                                >
                                    <Maximize2 className="h-3.5 w-3.5" />
                                    Ampia
                                </button>
                            </div>
                        )}
                        <button
                            onClick={() => setSortMode('recent')}
                            className={`rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all ${sortMode === 'recent' ? 'bg-white shadow-sm text-slate-900 dark:bg-white/10 dark:text-white' : 'text-slate-500'}`}
                        >
                            Recenti
                        </button>
                        <button
                            onClick={() => setSortMode('alpha')}
                            className={`rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all ${sortMode === 'alpha' ? 'bg-white shadow-sm text-slate-900 dark:bg-white/10 dark:text-white' : 'text-slate-500'}`}
                        >
                            A-Z
                        </button>
                        <button
                            onClick={() => notifyDbChange()}
                            className="ml-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white hover:text-sky-600 dark:hover:bg-white/10"
                            title="Aggiorna lista"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            </div>

            {patients && patients.length > 0 && (
                <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleSelectAll}
                            className="text-[12px] font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400"
                        >
                            {selectedIds.size === (patients?.length || 0) ? 'Deseleziona tutto' : 'Seleziona tutto'}
                        </button>
                    </div>
                </div>
            )}

            {selectedIds.size > 0 && (
                <div className="sticky top-4 z-30 flex animate-in fade-in slide-in-from-top-2 items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-white/80 p-2 shadow-lg backdrop-blur-md dark:border-sky-500/20 dark:bg-slate-900/90">
                    <div className="flex items-center gap-3">
                        <span className="pl-3 text-sm font-bold text-sky-700 dark:text-sky-300">{selectedIds.size} selezionati</span>
                        <div className="h-4 w-px bg-slate-200 dark:bg-white/10" />
                        <div className="flex items-center gap-1">
                            <button onClick={() => setShowMoveModal(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10">
                                <Building2 className="h-3.5 w-3.5" />
                                Sposta
                            </button>
                            <button onClick={() => { if (currentAmbulatoryId) { copy(Array.from(selectedIds), currentAmbulatoryId); setSelectedIds(new Set()); } }} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10">
                                <Copy className="h-3.5 w-3.5" />
                                Copia
                            </button>
                            <button onClick={() => { if (currentAmbulatoryId) { cut(Array.from(selectedIds), currentAmbulatoryId); setSelectedIds(new Set()); } }} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10">
                                <Scissors className="h-3.5 w-3.5" />
                                Taglia
                            </button>
                        </div>
                    </div>
                    <button onClick={() => setSelectedIds(new Set())} className="pr-2 text-[12px] font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400">
                        Annulla
                    </button>
                </div>
            )}

            {showMoveModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-[#161b22]">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Sposta pazienti</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                            Seleziona l&apos;ambulatorio di destinazione per <strong>{selectedIds.size}</strong> pazienti.
                        </p>
                        <div className="mt-5 max-h-60 space-y-3 overflow-y-auto pr-1">
                            {ambulatories?.map((amb) => (
                                <label
                                    key={amb.id}
                                    className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-3 transition-colors ${targetAmbulatory === amb.id ? 'border-sky-500 bg-sky-50 dark:bg-sky-500/10' : 'border-slate-200 hover:bg-slate-50 dark:border-white/10'}`}
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
                                    <div className="flex-1">
                                        <div className="flex items-center">
                                            <p className="text-sm font-semibold text-slate-900 dark:text-white">{amb.name}</p>
                                            {amb.type === 'test' && (
                                                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                                    Test
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-500">{amb.address || 'Nessun indirizzo'}</p>
                                    </div>
                                </label>
                            ))}
                        </div>
                        <div className="mt-6 flex justify-end gap-3">
                            <button onClick={() => setShowMoveModal(false)} className="rounded-full px-4 py-2 text-sm font-medium text-slate-600">Annulla</button>
                            <button
                                onClick={handleMove}
                                disabled={!targetAmbulatory || isMoving}
                                className="rounded-2xl bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
                            >
                                {isMoving ? 'Spostamento...' : 'Conferma'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="space-y-4">
                {isGlobalView ? (
                    patientGroups.length > 0 ? (
                        <div className="space-y-6">
                            {patientGroups.map((group) => (
                                <div key={group.ambulatory?.id || 'unassigned'} className="space-y-2.5">
                                    <div className="flex items-center justify-between px-1">
                                    <div className="flex items-center gap-2">
                                            <div className={`h-2 w-2 rounded-full ${group.color.dot}`} />
                                            <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                                                {group.ambulatory?.name || 'Non assegnati'}
                                            </h2>
                                        </div>
                                        <span className="text-[10px] font-bold text-slate-300">
                                            {group.patients.length} pazienti
                                        </span>
                                    </div>
                                    <div className={`overflow-hidden border dark:border-white/10 dark:bg-[#11151f]/80 dark:shadow-none ${
                                        isLiquid
                                            ? 'flex flex-col gap-2 rounded-[30px] border-white/60 bg-white/62 p-2 shadow-[0_22px_48px_-24px_rgba(87,98,182,0.22)] backdrop-blur-2xl'
                                            : 'rounded-2xl border-slate-200/70 bg-white/90 shadow-[0_14px_32px_-28px_rgba(15,23,42,0.18)] divide-y divide-slate-100 dark:divide-white/5'
                                    }`}>
                                        {group.patients.map((patient) => renderPatientItem(patient, group.color))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="glass-panel p-12 text-center">
                            <Building2 className="mx-auto h-12 w-12 text-slate-300" />
                            <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">Nessun paziente trovato</h3>
                            <p className="mt-2 text-sm text-slate-500">Prova a cambiare i filtri di ricerca.</p>
                        </div>
                    )
                ) : (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between px-1">
                            <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                                {patients?.length || 0} pazienti filtrati
                            </h2>
                        </div>
                        {patients && patients.length > 0 ? (
                            <div className={`overflow-hidden border dark:border-white/10 dark:bg-[#11151f]/80 dark:shadow-none ${
                                isLiquid
                                    ? 'flex flex-col gap-2 rounded-[30px] border-white/60 bg-white/62 p-2 shadow-[0_22px_48px_-24px_rgba(87,98,182,0.22)] backdrop-blur-2xl'
                                    : 'rounded-2xl border-slate-200/70 bg-white/90 shadow-[0_14px_32px_-28px_rgba(15,23,42,0.18)] divide-y divide-slate-100 dark:divide-white/5'
                            }`}>
                                {patients.map((patient) => renderPatientItem(patient))}
                            </div>
                        ) : (
                            <div className="glass-panel py-16 text-center">
                                <UserPlus className="mx-auto h-12 w-12 text-slate-300" />
                                <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">Nessun paziente</h3>
                                <p className="mt-2 text-sm text-slate-500">Inizia aggiungendo il primo paziente in questo ambulatorio.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
