'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Building2, Plus, Loader2, CornerDownRight } from 'lucide-react';
import { db, Ambulatory } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { useLiveQuery } from '@/lib/live-query';

interface AddAmbulatoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    parentId?: string | null;
}

export function AddAmbulatoryModal({ isOpen, onClose, parentId: initialParentId }: AddAmbulatoryModalProps) {
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [parentId, setParentId] = useState<string>('');
    const [type, setType] = useState<'live' | 'test'>('live');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [mounted, setMounted] = useState(false);

    const ambulatories = useLiveQuery(() => db.ambulatories.toArray());

    useEffect(() => {
        setMounted(true);
        return () => setMounted(false);
    }, []);

    useEffect(() => {
        if (initialParentId) setParentId(initialParentId);
    }, [initialParentId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        setIsSubmitting(true);
        try {
            const newAmbulatory: Ambulatory = {
                id: uuidv4(),
                name: name,
                address: address,
                parentId: parentId || null,
                type: type,
                isDefault: false,
                createdAt: new Date()
            };

            await db.ambulatories.add(newAmbulatory);
            onClose();
            setName('');
            setAddress('');
        } catch (error) {
            console.error(error);
            alert("Errore durante la creazione");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen || !mounted) return null;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            {/* Click outside to close */}
            <div className="absolute inset-0" onClick={onClose} />

            <div className="relative bg-white dark:bg-[#1c2128] w-full max-w-lg rounded-2xl shadow-2xl border border-gray-100 dark:border-[#30363d] overflow-hidden scale-100 animate-in zoom-in-95 duration-200">
                <div className="p-5 border-b border-gray-100 dark:border-[#30363d] flex justify-between items-center bg-gray-50/50 dark:bg-[#161b22]">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-blue-100 dark:bg-blue-900/30 rounded-xl text-blue-600 dark:text-blue-400">
                            <Building2 className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-800 dark:text-white leading-tight">Nuovo Ambulatorio</h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Crea una nuova unità operativa o sede</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 dark:hover:bg-[#30363d] rounded-full transition-colors" title="Chiudi">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div className="grid grid-cols-1 gap-5">
                        <div className="col-span-1">
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 ml-1">Nome Ambulatorio</label>
                            <input
                                autoFocus
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full px-4 py-3 text-base border border-gray-200 dark:border-[#30363d] rounded-xl bg-gray-50/50 dark:bg-[#0d1117] focus:bg-white dark:focus:bg-[#0d1117] focus:ring-2 focus:ring-blue-500/50 outline-none transition-all placeholder:text-gray-400"
                                placeholder="Es. Cardiologia - Piano Terra"
                            />
                        </div>

                        <div className="col-span-1">
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 ml-1">Indirizzo / Note</label>
                            <input
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                className="w-full px-4 py-3 text-sm border border-gray-200 dark:border-[#30363d] rounded-xl bg-gray-50/50 dark:bg-[#0d1117] focus:bg-white dark:focus:bg-[#0d1117] focus:ring-2 focus:ring-blue-500/50 outline-none transition-all"
                                placeholder="Opzionale (Es. Via Roma 1, Edificio B)"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-5 pt-2">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 ml-1">Gerarchia (Genitore)</label>
                            <div className="relative">
                                <select
                                    value={parentId}
                                    onChange={(e) => setParentId(e.target.value)}
                                    className="w-full pl-4 pr-8 py-2.5 text-sm border border-gray-200 dark:border-[#30363d] rounded-xl bg-gray-50/50 dark:bg-[#0d1117] focus:ring-2 focus:ring-blue-500/50 outline-none appearance-none cursor-pointer hover:bg-gray-100 dark:hover:bg-[#161b22] transition-colors"
                                    title="Seleziona Ambulatorio Genitore"
                                >
                                    <option value="">Nessuno (Root)</option>
                                    {ambulatories?.map(a => (
                                        <option key={a.id} value={a.id}>{a.name}</option>
                                    ))}
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                                    <CornerDownRight className="w-4 h-4" />
                                </div>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 ml-1">Tipologia</label>
                            <select
                                value={type}
                                onChange={(e) => setType(e.target.value as 'live' | 'test')}
                                className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-[#30363d] rounded-xl bg-gray-50/50 dark:bg-[#0d1117] focus:ring-2 focus:ring-blue-500/50 outline-none appearance-none cursor-pointer hover:bg-gray-100 dark:hover:bg-[#161b22] transition-colors"
                                title="Seleziona Tipo Ambulatorio"
                            >
                                <option value="live">Produzione (Reale)</option>
                                <option value="test">Test / Sandbox</option>
                            </select>
                        </div>
                    </div>

                    <div className="pt-6 flex justify-end gap-3 border-t border-gray-100 dark:border-[#30363d] mt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-5 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#30363d] rounded-xl font-medium transition-colors text-sm"
                        >
                            Annulla
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim() || isSubmitting}
                            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:shadow-none transition-all active:scale-95 text-sm"
                        >
                            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            Crea Ambulatorio
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
