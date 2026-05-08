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
        // @Codex WUL-229 — modal chrome aligned with specular tier
        <div className="mf-modal-backdrop animate-in fade-in duration-200">
            <button
                type="button"
                aria-label="Chiudi sfondo"
                className="absolute inset-0 cursor-default"
                onClick={onClose}
            />

            <div className="mf-modal-shell relative w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-5 graphite-divider flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl" style={{ background: 'rgba(15, 123, 104, 0.12)', color: 'var(--mf-primary)' }}>
                            <Building2 className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold leading-tight" style={{ color: 'var(--mf-ink)' }}>Nuovo Ambulatorio</h2>
                            <p className="text-xs font-medium" style={{ color: 'var(--mf-muted)' }}>Crea una nuova unità operativa o sede</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="mf-btn-secondary !p-2 !rounded-full" title="Chiudi">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div className="grid grid-cols-1 gap-5">
                        <div className="col-span-1">
                            <label className="mf-field-label">Nome Ambulatorio</label>
                            <input
                                autoFocus
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="mf-input"
                                placeholder="Es. Cardiologia - Piano Terra"
                            />
                        </div>

                        <div className="col-span-1">
                            <label className="mf-field-label">Indirizzo / Note</label>
                            <input
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                className="mf-input"
                                placeholder="Opzionale (es. Via Roma 1, Edificio B)"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2">
                        <div>
                            <label className="mf-field-label">Gerarchia (Genitore)</label>
                            <div className="relative">
                                <select
                                    value={parentId}
                                    onChange={(e) => setParentId(e.target.value)}
                                    className="mf-input mf-input-sm appearance-none pr-9 cursor-pointer"
                                    title="Seleziona Ambulatorio Genitore"
                                >
                                    <option value="">Nessuno (Root)</option>
                                    {ambulatories?.map(a => (
                                        <option key={a.id} value={a.id}>{a.name}</option>
                                    ))}
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--mf-muted)' }}>
                                    <CornerDownRight className="w-4 h-4" />
                                </div>
                            </div>
                        </div>
                        <div>
                            <label className="mf-field-label">Tipologia</label>
                            <select
                                value={type}
                                onChange={(e) => setType(e.target.value as 'live' | 'test')}
                                className="mf-input mf-input-sm appearance-none cursor-pointer"
                                title="Seleziona Tipo Ambulatorio"
                            >
                                <option value="live">Produzione (Reale)</option>
                                <option value="test">Test / Sandbox</option>
                            </select>
                        </div>
                    </div>

                    <div className="pt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-3 graphite-divider mt-4">
                        <button type="button" onClick={onClose} className="mf-btn-secondary">Annulla</button>
                        <button
                            type="submit"
                            disabled={!name.trim() || isSubmitting}
                            className="ui-btn-primary px-5 py-2.5 disabled:opacity-50"
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
